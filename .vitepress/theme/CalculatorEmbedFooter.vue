<script setup>
defineProps({
  // Optional override of the link target. The brand link points here.
  href: { type: String, default: 'https://runcycles.io' },
})
</script>

<template>
  <footer class="embed-footer">
    <a :href="href" target="_blank" rel="noopener" class="embed-credit">
      Built with <strong>Cycles runtime authority</strong>
      <span class="embed-credit-host">runcycles.io</span>
    </a>
  </footer>
</template>

<style scoped>
.embed-footer {
  margin-top: 16px;
  padding: 14px 18px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  text-align: center;
}
.embed-credit {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  letter-spacing: 0.01em;
}
.embed-credit:hover { color: var(--vp-c-brand-1); }
.embed-credit strong {
  color: var(--vp-c-text-1);
  font-weight: 700;
}
.embed-credit-host {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.embed-credit:hover .embed-credit-host { text-decoration: underline; }
</style>
