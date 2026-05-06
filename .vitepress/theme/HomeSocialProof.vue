<script setup>
import { ref, onMounted, computed } from 'vue'
import { data } from './installs.data'

const installs = ref(data.total)
const clones = ref(data.clones ?? 0)

onMounted(async () => {
  try {
    const res = await fetch('/installs.json')
    if (res.ok) {
      const json = await res.json()
      if ((json.total  ?? 0) > installs.value) installs.value = json.total
      if ((json.clones ?? 0) > clones.value)   clones.value   = json.clones
    }
  } catch {
    // non-critical — build-time values are already displayed
  }
})

const formatted = new Intl.NumberFormat('en-US')
const showInstalls = computed(() => installs.value > 0)
const showClones   = computed(() => clones.value > 0)
const showAny      = computed(() => showInstalls.value || showClones.value)
const showBoth     = computed(() => showInstalls.value && showClones.value)
</script>

<template>
  <p v-if="showAny" class="social-proof">
    <span v-if="showInstalls" class="stat">
      <svg
        class="stat-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="16" height="16"
        viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span class="stat-text">{{ formatted.format(installs) }}+ package installs</span>
    </span>

    <span v-if="showBoth" class="separator" aria-hidden="true">·</span>

    <span v-if="showClones" class="stat">
      <svg
        class="stat-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="16" height="16"
        viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="18" r="3" />
        <circle cx="6"  cy="6"  r="3" />
        <circle cx="18" cy="6"  r="3" />
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
        <path d="M12 12v3" />
      </svg>
      <span class="stat-text">{{ formatted.format(clones) }} repo clones</span>
    </span>
  </p>
</template>

<style scoped>
.social-proof {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 14px;
  text-align: center;
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
  padding: 0 24px 24px;
  margin: -20px 0 0;
  letter-spacing: 0.01em;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.stat-icon { flex-shrink: 0; }
.stat-text { font-variant-numeric: tabular-nums; }

.separator {
  color: var(--vp-c-text-3);
  user-select: none;
  font-weight: 400;
}

@media (max-width: 480px) {
  /* On narrow viewports the two stats stack — hide the inline separator,
     it would otherwise float between them on its own line. */
  .separator { display: none; }
  .social-proof { gap: 4px; flex-direction: column; }
}
</style>
