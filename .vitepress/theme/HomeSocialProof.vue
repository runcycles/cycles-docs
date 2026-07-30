<script setup>
import { ref, onMounted, computed } from 'vue'
import { data } from './installs.data'

const installs = ref(data.total)

onMounted(async () => {
  try {
    const res = await fetch('/installs.json')
    if (res.ok) {
      const json = await res.json()
      if ((json.total ?? 0) > installs.value) installs.value = json.total
    }
  } catch {
    // non-critical — build-time values are already displayed
  }
})

const formatted = new Intl.NumberFormat('en-US')
const showInstalls = computed(() => installs.value > 0)
</script>

<template>
  <p class="social-proof">
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
    <a class="stat proof-link" href="/protocol/sdk-recovery-conformance">
      <span class="stat-text">4 SDKs &#183; durable recovery &#183; 12/12 scenarios</span>
    </a>
    <a
      class="stat proof-link"
      href="/protocol/sdk-settlement-recovery-and-durability#availability-behavior"
    >
      <span class="stat-text">Reserve-time outage: fail closed</span>
    </a>
    <a class="stat proof-link" href="/blog/cycles-server-performance-benchmarks">
      <span class="stat-text">200-client shared reserve p99: 532ms</span>
    </a>
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

.stat + .stat::before {
  content: '\00b7';
  margin-right: 14px;
  color: var(--vp-c-text-3);
}

.stat-icon { flex-shrink: 0; }
.stat-text { font-variant-numeric: tabular-nums; }

.proof-link {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.proof-link:hover {
  color: var(--vp-c-brand-1);
}

@media (max-width: 640px) {
  .social-proof {
    gap: 7px;
  }

  .stat {
    flex-basis: 100%;
    justify-content: center;
  }

  .stat + .stat::before {
    display: none;
  }
}
</style>
