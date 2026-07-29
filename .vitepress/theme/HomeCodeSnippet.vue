<script setup>
// Snippets are authored and highlighted at build time in snippets.data.ts
// (shiki never ships to the client — see that file's header comment).
import { ref } from 'vue'
import { data as snippets } from './snippets.data'
import { pythonPath, typescriptPath, springAiPath, mcpPath, langchainPath, openaiAgentsPath, vercelPath, openclawPath, anthropicPath } from './FrameworkIcons'

const activeTab = ref('python')
const copied = ref(false)

function copyCode() {
  const code = snippets[activeTab.value]?.code
  if (!code || typeof navigator === 'undefined') return
  navigator.clipboard.writeText(code)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const tabs = [
  { key: 'python', label: 'Python', icon: pythonPath },
  { key: 'typescript', label: 'TypeScript', icon: typescriptPath },
  { key: 'java', label: 'Java / Spring', icon: springAiPath },
  { key: 'mcp', label: 'MCP', icon: mcpPath },
  { key: 'langchain', label: 'LangChain', icon: langchainPath },
  { key: 'openai-agents', label: 'OpenAI Agents', icon: openaiAgentsPath },
  { key: 'anthropic', label: 'Anthropic', icon: anthropicPath },
  { key: 'vercel', label: 'Vercel AI', icon: vercelPath },
  { key: 'openclaw', label: 'OpenClaw', icon: openclawPath },
]

// WAI-ARIA tabs pattern: arrow keys move between tabs (roving tabindex),
// Home/End jump to the ends.
function onTablistKeydown(e) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const current = tabs.findIndex(t => t.key === activeTab.value)
  let next
  if (e.key === 'ArrowRight') next = (current + 1) % tabs.length
  else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
  else if (e.key === 'Home') next = 0
  else next = tabs.length - 1
  activeTab.value = tabs[next].key
  document.getElementById(`snippet-tab-${tabs[next].key}`)?.focus()
}
</script>

<template>
  <section class="home-code-snippet">
    <div class="inner">
    <h2 class="code-heading">Add runtime authority in a few lines</h2>
    <p class="code-caption"><code>@cycles</code> reserves budget before the action runs. No remaining cycles — no action.</p>
    <div class="code-container">
      <div class="tab-bar" role="tablist" aria-label="Integration code examples" @keydown="onTablistKeydown">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :id="`snippet-tab-${tab.key}`"
          role="tab"
          :aria-selected="activeTab === tab.key"
          aria-controls="snippet-panel"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :class="['tab', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path :d="tab.icon" />
          </svg>
          {{ tab.label }}
        </button>
      </div>
      <div class="code-block" role="tabpanel" id="snippet-panel" :aria-labelledby="`snippet-tab-${activeTab}`">
        <button class="copy-btn" @click="copyCode" :aria-label="copied ? 'Copied' : 'Copy code'">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <div v-if="snippets[activeTab]" v-html="snippets[activeTab].html" />
      </div>
    </div>
    </div>
  </section>
</template>

<style scoped>
.home-code-snippet {
  position: relative;
  padding: 0 24px 48px;
  text-align: center;
}

@media (min-width: 640px) {
  .home-code-snippet {
    padding: 0 48px 48px;
  }
}

@media (min-width: 960px) {
  .home-code-snippet {
    padding: 0 64px 48px;
  }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.code-heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
  letter-spacing: -0.02em;
  border-top: none;
  padding-top: 0;
}

.code-caption {
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin-bottom: 20px;
  line-height: 1.5;
}

.code-caption code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875em;
  color: var(--vp-code-color);
  background-color: var(--vp-code-bg);
  border-radius: 4px;
  padding: 2px 6px;
}

.code-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
}

.tab-bar {
  display: flex;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 0;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  font-family: var(--vp-font-family-base);
}

.tab-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.tab:hover {
  color: var(--vp-c-text-1);
}

.tab:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.tab.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.code-block {
  position: relative;
  background: var(--vp-code-block-bg);
  padding: 20px 24px;
  overflow-x: auto;
  min-height: 200px;
  overflow-y: auto;
}

.copy-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  z-index: 1;
  transition: color 0.2s, border-color 0.2s;
}

.copy-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.copy-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.code-block :deep(pre) {
  margin: 0;
  background: transparent !important;
}

.code-block :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre;
}

.code-block :deep(.shiki) {
  background: transparent !important;
}

.dark .code-block :deep(.shiki span) {
  color: var(--shiki-dark) !important;
}

@media (max-width: 640px) {
  .code-heading {
    font-size: 20px;
  }

  .tab {
    padding: 8px 12px;
    font-size: 12px;
  }

  .tab-icon {
    display: none;
  }

  .code-block {
    padding: 16px;
    min-height: auto;
    -webkit-overflow-scrolling: touch;
  }

  .code-block :deep(code) {
    font-size: 12px;
  }
}

@media (max-width: 400px) {
  .tab {
    padding: 6px 10px;
    font-size: 11px;
  }
}
</style>
