// URL-hash-encoded calculator state. The whole reactive state of a calculator
// is serialized into the URL hash so any configuration is a shareable link.
//
// Encoding:
//   <hash> = "#s=" + base64url(JSON.stringify(state))
//
// Hash-based (not query string) so:
//   - state never reaches the server / analytics
//   - there is no length-limit risk from query strings
//   - replaceState updates do not pollute browser history
//
// Encoder uses base64url (RFC 4648) instead of plain base64 so the hash does
// not contain `+`, `/`, or `=`, which can be problematic in URLs.

import { watch, nextTick, onBeforeUnmount } from 'vue'

const HASH_KEY = 's'

// btoa/atob handle Latin-1 only; the unescape/encodeURIComponent dance gives
// us round-trippable Unicode without pulling in a TextEncoder polyfill.
function utf8ToBase64(str) {
  if (typeof window === 'undefined') return ''
  return btoa(unescape(encodeURIComponent(str)))
}

function base64ToUtf8(b64) {
  if (typeof window === 'undefined') return ''
  return decodeURIComponent(escape(atob(b64)))
}

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return b64
}

export function encodeState(state) {
  try {
    const json = JSON.stringify(state)
    return toBase64Url(utf8ToBase64(json))
  } catch {
    return ''
  }
}

export function decodeState(s) {
  if (!s) return null
  try {
    const json = base64ToUtf8(fromBase64Url(s))
    return JSON.parse(json)
  } catch {
    return null
  }
}

function readHashState() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  // Hash may contain other params; we look for s=<value>
  const params = new URLSearchParams(hash)
  return decodeState(params.get(HASH_KEY))
}

function writeHashState(state) {
  if (typeof window === 'undefined') return
  const enc = encodeState(state)
  if (!enc) return
  const url = new URL(window.location.href)
  url.hash = `${HASH_KEY}=${enc}`
  // replaceState — never pollute history with every keystroke
  window.history.replaceState(window.history.state, '', url.toString())
}

/**
 * Wire reactive state to the URL hash.
 *   - On mount: optionally seed from `initialStateB64` prop, then
 *     overwrite from #s= if present (URL takes precedence so shared
 *     links always win)
 *   - On any change: debounced replaceState writes new encoded state
 *
 * Returns a function to manually trigger a hydrate (useful after dynamic
 * default replacement) and a current shareable URL accessor.
 */
export function useCalcState(state, { hydrate, debounceMs = 300, initialStateB64 = null } = {}) {
  if (typeof window === 'undefined') return { reload() {}, currentUrl() { return '' } }

  function hydrateNow() {
    // 1. Seed from prop (page-author-controlled defaults) — applied first
    //    so a URL-hash override can still take precedence.
    if (initialStateB64) {
      const seed = decodeState(initialStateB64)
      if (seed) {
        if (typeof hydrate === 'function') hydrate(seed)
        else for (const k of Object.keys(seed)) if (k in state) state[k] = seed[k]
      }
    }
    // 2. URL-hash override — winning source for shared links
    const incoming = readHashState()
    if (!incoming) return
    if (typeof hydrate === 'function') {
      hydrate(incoming)
    } else {
      for (const k of Object.keys(incoming)) {
        if (k in state) state[k] = incoming[k]
      }
    }
  }

  // Initial hydrate before the first watcher fires
  hydrateNow()

  let timer = null
  let hydrating = false
  watch(
    () => JSON.stringify(state),
    () => {
      if (hydrating) return
      clearTimeout(timer)
      timer = setTimeout(() => writeHashState(state), debounceMs)
    },
  )

  // Listen for hashchange (e.g. user navigates back / pastes new URL into bar)
  function onHashChange() {
    hydrating = true
    hydrateNow()
    nextTick(() => { hydrating = false })
  }
  window.addEventListener('hashchange', onHashChange)
  onBeforeUnmount(() => {
    window.removeEventListener('hashchange', onHashChange)
    clearTimeout(timer)
  })

  return {
    reload: hydrateNow,
    currentUrl() {
      const enc = encodeState(state)
      const url = new URL(window.location.href)
      url.hash = enc ? `${HASH_KEY}=${enc}` : ''
      return url.toString()
    },
    /**
     * Build a shareable URL that targets the standalone view of this
     * calculator regardless of which view we are currently rendered in.
     */
    standaloneUrl(standalonePath) {
      const enc = encodeState(state)
      const url = new URL(standalonePath, window.location.origin)
      url.hash = enc ? `${HASH_KEY}=${enc}` : ''
      return url.toString()
    },
    /**
     * Build an iframe-ready embed URL for the embed view of this calculator.
     */
    embedUrl(embedPath) {
      const enc = encodeState(state)
      const url = new URL(embedPath, window.location.origin)
      url.hash = enc ? `${HASH_KEY}=${enc}` : ''
      return url.toString()
    },
  }
}
