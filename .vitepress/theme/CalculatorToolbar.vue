<script setup>
import { ref } from 'vue'
import { copyText } from './lib/calc-export.js'

const props = defineProps({
  calcName:        { type: String, required: true }, // 'cost' | 'risk'
  shareUrl:        { type: Function, required: true }, // () => string  (standalone URL)
  embedUrl:        { type: Function, required: true }, // () => string  (embed URL)
  onCopyMarkdown:  { type: Function, required: true },
  onDownloadCsv:   { type: Function, required: true },
  onDownloadPng:   { type: Function, required: true },
  /** Hide the Embed button on the embed page itself. */
  showEmbed:       { type: Boolean, default: true },
})

// transient label flashes — "Copied!" feedback for ~1.6s
const flash = ref({}) // { share: 'Copied!', md: 'Copied!', ... }
function setFlash(key, msg) {
  flash.value = { ...flash.value, [key]: msg }
  setTimeout(() => {
    flash.value = { ...flash.value, [key]: undefined }
  }, 1600)
}

async function share() {
  const url = props.shareUrl()
  const ok = await copyText(url)
  setFlash('share', ok ? 'Link copied' : 'Copy failed')
}

async function copyMarkdown() {
  try {
    await props.onCopyMarkdown()
    setFlash('md', 'Copied')
  } catch {
    setFlash('md', 'Failed')
  }
}

async function downloadCsv() {
  try {
    props.onDownloadCsv()
    setFlash('csv', 'Downloaded')
  } catch {
    setFlash('csv', 'Failed')
  }
}

const pngBusy = ref(false)
async function downloadPng() {
  if (pngBusy.value) return
  pngBusy.value = true
  try {
    await props.onDownloadPng()
    setFlash('png', 'Saved')
  } catch (e) {
    console.error('PNG export failed', e)
    setFlash('png', 'Failed')
  } finally {
    pngBusy.value = false
  }
}

// Embed modal
const showEmbedModal = ref(false)
const embedHeight = ref(820)
const embedSnippet = () => {
  const url = props.embedUrl()
  return `<iframe src="${url}" width="100%" height="${embedHeight.value}" frameborder="0" loading="lazy" title="Cycles ${props.calcName} calculator"></iframe>`
}
async function copyEmbed() {
  const ok = await copyText(embedSnippet())
  setFlash('embed', ok ? 'Snippet copied' : 'Copy failed')
}
</script>

<template>
  <div class="calc-toolbar">
    <button type="button" class="tb-btn tb-primary" @click="share" :data-flash="flash.share">
      <span v-if="!flash.share">Share</span>
      <span v-else>{{ flash.share }}</span>
    </button>
    <button type="button" class="tb-btn" @click="copyMarkdown" :data-flash="flash.md">
      <span v-if="!flash.md">Copy</span>
      <span v-else>{{ flash.md }}</span>
    </button>
    <button type="button" class="tb-btn" @click="downloadCsv" :data-flash="flash.csv">
      <span v-if="!flash.csv">CSV</span>
      <span v-else>{{ flash.csv }}</span>
    </button>
    <button type="button" class="tb-btn" @click="downloadPng" :disabled="pngBusy" :data-flash="flash.png">
      <span v-if="pngBusy">Capturing…</span>
      <span v-else-if="flash.png">{{ flash.png }}</span>
      <span v-else>PNG</span>
    </button>
    <button v-if="showEmbed" type="button" class="tb-btn tb-ghost" @click="showEmbedModal = true">Embed</button>
  </div>

  <Teleport v-if="showEmbed" to="body">
    <div v-if="showEmbedModal" class="embed-overlay" @click.self="showEmbedModal = false">
      <div class="embed-modal" role="dialog" aria-labelledby="embed-title">
        <header class="embed-header">
          <h2 id="embed-title" class="embed-title">Embed this calculator</h2>
          <button type="button" class="embed-close" aria-label="Close" @click="showEmbedModal = false">×</button>
        </header>
        <p class="embed-desc">
          Copy this snippet into any HTML page or content management system.
          The current configuration is preserved in the embed URL — visitors see
          the same numbers you set up.
        </p>
        <label class="embed-height">
          <span>Height (px)</span>
          <input v-model.number="embedHeight" type="number" min="400" max="2000" step="20" />
        </label>
        <textarea readonly class="embed-snippet" :value="embedSnippet()" @click="$event.target.select()"></textarea>
        <button type="button" class="tb-btn tb-primary embed-copy" @click="copyEmbed" :data-flash="flash.embed">
          <span v-if="!flash.embed">Copy snippet</span>
          <span v-else>{{ flash.embed }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.calc-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.tb-btn {
  padding: 7px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  white-space: nowrap;
}
.tb-btn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.tb-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
.tb-btn.tb-primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
}
.tb-btn.tb-primary:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
  border-color: var(--vp-c-brand-2);
  color: var(--vp-c-bg);
}
.tb-btn.tb-ghost {
  background: transparent;
}

.embed-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.embed-modal {
  width: min(640px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.embed-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.embed-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--vp-c-text-1); }
.embed-close {
  width: 28px; height: 28px;
  border: 1px solid transparent; border-radius: 50%;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 18px; line-height: 1; cursor: pointer;
}
.embed-close:hover { color: var(--vp-c-text-1); border-color: var(--vp-c-divider); }
.embed-desc {
  margin: 4px 0 16px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}
.embed-height {
  display: flex; align-items: center; gap: 10px;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  margin-bottom: 12px;
}
.embed-height input {
  width: 90px;
  padding: 5px 10px;
  border: 1px solid var(--vp-c-divider); border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.embed-snippet {
  width: 100%;
  min-height: 100px;
  padding: 12px;
  border: 1px solid var(--vp-c-divider); border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono, monospace);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  margin-bottom: 12px;
}
.embed-copy { width: 100%; }
</style>
