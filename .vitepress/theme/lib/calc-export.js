// Export helpers: Markdown, CSV, PNG.
// Every artifact carries Cycles attribution so screenshots and shared files
// remain traceable back to the source. Branding is opt-in via the `brand`
// config but every calculator should pass it.

const ATTRIBUTION_HOST = 'runcycles.io'

// Cycles brand colors lifted from the logo (so PNG branding matches the
// wordmark even when the source page is on a different theme).
const BRAND_TEAL_LIGHT = '#00C9A7'
const BRAND_TEAL_DARK  = '#1D9E75'

// The actual runcycles logo, inlined so PNG export does not depend on a
// network fetch and html2canvas-pro can rasterize it deterministically.
// Source of truth: /public/runcycles-logo.svg.
const RUNCYCLES_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true">
  <path d="M 338.2 79.7 A 194.6 194.6 0 1 1 173.8 79.7"
        fill="none" stroke="${BRAND_TEAL_LIGHT}" stroke-width="73" stroke-linecap="round"/>
  <path fill-rule="evenodd" fill="${BRAND_TEAL_DARK}"
        d="M 256,128.3 L 366.5,192.2 L 366.5,319.8 L 256,383.7 L 145.5,319.8 L 145.5,192.2 Z
           M 326.5,256 A 70.5,70.5 0 1 1 185.5,256 A 70.5,70.5 0 1 1 326.5,256 Z"/>
</svg>
`.trim()

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

/**
 * Generate a GitHub-flavored Markdown table.
 *
 * `brand` (optional) seeds attribution lines around the table:
 *   - calcName: e.g., 'Cycles Blast Radius Risk Calculator'
 *   - subjectName / subjectDescription: identifies WHAT the calculation is for
 *     (agent name + short description)
 *   - sourceUrl: shareable URL pointing at the standalone view with state
 *   - summary: one-line totals/result line
 */
export function toMarkdownTable(headers, rows, opts = {}) {
  const { title, footer, brand } = opts
  const out = []

  if (brand?.calcName)         out.push(`### ${brand.calcName}`)
  else if (title)              out.push(`### ${title}`)
  if (brand?.subjectName)      out.push(`**${brand.subjectLabel || 'Subject'}:** ${brand.subjectName}`)
  if (brand?.subjectDescription) out.push(`*${brand.subjectDescription}*`)
  if (out.length) out.push('')

  out.push('| ' + headers.join(' | ') + ' |')
  out.push('| ' + headers.map(() => '---').join(' | ') + ' |')
  for (const r of rows) out.push('| ' + r.join(' | ') + ' |')

  if (brand?.summary) out.push('', `_${brand.summary}_`)
  if (footer)         out.push('', `_${footer}_`)

  if (brand?.sourceUrl || brand?.calcName) {
    out.push('')
    const lines = []
    if (brand.sourceUrl) lines.push(`Configured at: ${brand.sourceUrl}`)
    lines.push(`Generated ${todayIso()} with the ${brand.calcName || 'Cycles calculator'} — ${ATTRIBUTION_HOST}/calculators`)
    out.push(`_${lines.join('  —  ')}_`)
  }

  return out.join('\n')
}

/**
 * Generate a CSV string. Quotes any cell containing comma, quote, or newline.
 * `brand` adds `# ...` comment lines at the top so the artifact identifies
 * itself when opened in a spreadsheet that displays them as a header band.
 */
export function toCsv(headers, rows, opts = {}) {
  const { brand } = opts
  const esc = (v) => {
    const s = String(v ?? '')
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const out = []
  if (brand?.calcName)             out.push(esc(`# ${brand.calcName}`))
  if (brand?.subjectName)          out.push(esc(`# ${brand.subjectLabel || 'Subject'}: ${brand.subjectName}`))
  if (brand?.subjectDescription)   out.push(esc(`# Description: ${brand.subjectDescription}`))
  if (brand?.sourceUrl)            out.push(esc(`# Source: ${brand.sourceUrl}`))
  if (brand?.summary)              out.push(esc(`# ${brand.summary}`))
  out.push(esc(`# Generated ${todayIso()} via ${ATTRIBUTION_HOST}/calculators`))
  out.push('')
  out.push(headers.map(esc).join(','))
  for (const r of rows) out.push(r.map(esc).join(','))
  return out.join('\r\n')
}

/**
 * Trigger a browser download of arbitrary text content.
 */
export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Capture a DOM element to PNG. Wraps the captured region in a branded
 * frame (logo + title + subject + footer) so the resulting image is
 * self-contained — anyone who sees the screenshot can find the source.
 *
 * `brand` keys:
 *   calcName            — title shown next to the brand mark
 *   subjectLabel        — e.g., 'Agent', 'Workload' (defaults 'Subject')
 *   subjectName         — the named subject of the calculation
 *   subjectDescription  — one-line elaboration
 *   sourceUrl           — shareable URL with encoded state, included in footer
 *   summary             — one-line result (e.g., totals)
 *
 * Form controls in the source element are replaced with styled <span>s
 * before capture, because html2canvas misaligns input/select rendering.
 */
export async function captureElementToPng(el, opts = {}) {
  const { filename = 'cycles-calculator.png', scale = 2, brand } = opts
  if (!el) throw new Error('captureElementToPng: element is null')

  // --- 1. Clone the source element and inline form values --------------------
  const innerClone = el.cloneNode(true)

  // Properties that affect text layout / rendering. The `font` shorthand
  // does NOT include letter-spacing, word-spacing, font-variant-numeric,
  // text-rendering, or white-space, and html2canvas-pro will collapse
  // word spacing if those are missing — the visible artifact is words
  // running together ("codingagent", "DELETEtable", etc.). Set them
  // explicitly.
  const TEXT_LAYOUT_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'fontVariantNumeric', 'fontStretch', 'fontKerning',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'whiteSpace',
    'textAlign', 'textTransform', 'textRendering', 'textIndent',
    'color',
  ]
  const BOX_PROPS = [
    'width', 'height', 'minWidth', 'maxWidth',
    'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
    'borderRadius', 'boxSizing',
    'backgroundColor',
  ]

  const replaceFormControl = (sourceEl, cloneEl) => {
    // Range inputs (sliders) do not render meaningfully in a static export
    // — drop them entirely. Adjacent number inputs already display the
    // same value via shared v-model.
    if (sourceEl.tagName === 'INPUT' && sourceEl.type === 'range') {
      cloneEl.remove()
      return
    }
    const span = document.createElement('span')
    span.className = cloneEl.className || ''
    if (sourceEl.tagName === 'SELECT') {
      const opt = sourceEl.options[sourceEl.selectedIndex]
      span.textContent = opt ? opt.text : ''
    } else {
      span.textContent = sourceEl.value ?? ''
    }
    const cs = getComputedStyle(sourceEl)
    span.style.display = 'inline-block'
    span.style.verticalAlign = 'middle'
    for (const p of TEXT_LAYOUT_PROPS) span.style[p] = cs[p]
    for (const p of BOX_PROPS)         span.style[p] = cs[p]
    cloneEl.replaceWith(span)
  }
  const sourceInputs = el.querySelectorAll('input, select, textarea')
  const cloneInputs  = innerClone.querySelectorAll('input, select, textarea')
  for (let i = 0; i < sourceInputs.length; i++) {
    if (cloneInputs[i]) replaceFormControl(sourceInputs[i], cloneInputs[i])
  }
  // Strip interactive-only buttons (remove-row, add-row, ×) — visual noise.
  innerClone.querySelectorAll('button').forEach((b) => b.remove())

  // --- 2. Build the branded wrapper -----------------------------------------
  const cs = getComputedStyle(document.body)
  const bgColor    = cs.backgroundColor || '#ffffff'
  const textColor  = cs.color           || '#0b0f1a'
  const borderColor = (getComputedStyle(el).borderColor) || 'rgba(0,0,0,0.1)'

  const wrapper = document.createElement('div')
  wrapper.className = 'cycles-export-wrapper'
  wrapper.style.cssText = `
    position: absolute; top: 0; left: -99999px;
    width: ${el.getBoundingClientRect().width}px;
    box-sizing: border-box;
    background: ${bgColor};
    color: ${textColor};
    padding: 24px 28px;
    font-family: ${cs.fontFamily};
    font-size: ${cs.fontSize};
    line-height: ${cs.lineHeight};
    border: 1px solid ${borderColor};
    border-radius: 12px;
  `

  // Scoped style reset applied to every descendant of the wrapper. These
  // properties do not inherit reliably and html2canvas-pro renders with
  // collapsed word-spacing if they are missing on the leaf elements.
  const exportStyle = document.createElement('style')
  exportStyle.textContent = `
    .cycles-export-wrapper, .cycles-export-wrapper * {
      letter-spacing: normal !important;
      word-spacing: normal !important;
      text-rendering: geometricPrecision !important;
      font-kerning: normal !important;
      -webkit-font-smoothing: antialiased !important;
      font-feature-settings: normal !important;
    }
  `
  document.head.appendChild(exportStyle)

  if (brand) {
    const header = document.createElement('div')
    header.style.cssText = `
      display: flex; align-items: flex-start; gap: 16px;
      padding-bottom: 18px; margin-bottom: 20px;
      border-bottom: 1px solid ${borderColor};
    `
    const safeCalc = escapeHtml(brand.calcName || 'Cycles Calculator')
    const safeSubjectLabel = escapeHtml(brand.subjectLabel || 'Subject')
    const safeSubjectName  = escapeHtml(brand.subjectName || 'Untitled')
    const safeSubjectDesc  = escapeHtml(brand.subjectDescription || '')
    header.innerHTML = `
      <div style="
        width: 44px; height: 44px;
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
      ">${RUNCYCLES_LOGO_SVG}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="
          display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; margin-bottom: 4px;
        ">
          <span style="color: ${BRAND_TEAL_DARK}; font-weight: 800; letter-spacing: 0.12em;">CYCLES</span>
          <span style="color: ${textColor}; opacity: 0.5; font-weight: 600;">${safeCalc}</span>
        </div>
        <div style="font-size: 19px; font-weight: 700; color: ${textColor}; letter-spacing: -0.01em; line-height: 1.3;">
          ${safeSubjectLabel}: ${safeSubjectName}
        </div>
        ${safeSubjectDesc ? `<div style="font-size: 13px; color: ${textColor}; opacity: 0.7; margin-top: 4px; line-height: 1.45;">${safeSubjectDesc}</div>` : ''}
      </div>
    `
    wrapper.appendChild(header)
  }

  // The actual content. Reset the inner clone's outer padding/border since the
  // wrapper now provides the frame.
  innerClone.style.margin = '0'
  innerClone.style.border = 'none'
  innerClone.style.background = 'transparent'
  innerClone.style.padding = '0'
  innerClone.style.borderRadius = '0'
  wrapper.appendChild(innerClone)

  // Footer with source URL + timestamp + attribution
  if (brand) {
    const footer = document.createElement('div')
    footer.style.cssText = `
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
      margin-top: 18px; padding-top: 14px;
      border-top: 1px solid ${borderColor};
      font-size: 11.5px;
      color: ${textColor}; opacity: 0.65;
    `
    const safeUrl = brand.sourceUrl
      ? `<a style="color: ${BRAND_TEAL_DARK}; text-decoration: none; font-weight: 700;">${escapeHtml(brand.sourceUrl.replace(/^https?:\/\//, ''))}</a>`
      : `<a style="color: ${BRAND_TEAL_DARK}; text-decoration: none; font-weight: 700;">${ATTRIBUTION_HOST}/calculators</a>`
    footer.innerHTML = `
      <div>Built with <strong style="color: ${textColor}; opacity: 0.85;">Cycles runtime authority</strong></div>
      <div>${safeUrl}</div>
      <div>${todayIso()}</div>
    `
    wrapper.appendChild(footer)
  }

  document.body.appendChild(wrapper)

  // --- 3. Capture ------------------------------------------------------------
  // Wait for web fonts to fully load. Without this, html2canvas-pro
  // measures text width using fallback-font metrics but the renderer
  // uses the actual web font, leading to visible word-spacing collapse
  // ("codingagent", "DROP / DELETEtable", etc.) in the captured output.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready } catch { /* ignore */ }
  }

  try {
    const { default: html2canvas } = await import('html2canvas-pro')
    const canvas = await html2canvas(wrapper, {
      scale,
      backgroundColor: bgColor,
      useCORS: true,
      logging: false,
      windowWidth:  wrapper.scrollWidth,
      windowHeight: wrapper.scrollHeight,
    })
    await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob returned null')); return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        resolve()
      }, 'image/png')
    })
  } finally {
    wrapper.remove()
    if (exportStyle.parentNode) exportStyle.parentNode.removeChild(exportStyle)
  }
}

/**
 * Copy a string to the clipboard with legacy fallback.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'absolute'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
