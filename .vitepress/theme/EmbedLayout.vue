<script setup>
import { Content } from 'vitepress/dist/client/app/components/Content.js'
import { onMounted, onBeforeUnmount } from 'vue'
import CalculatorEmbedFooter from './CalculatorEmbedFooter.vue'

// Add a body class so we can apply embed-only resets without changing the
// global theme. Removed when navigating away.
onMounted(() => { document.body.classList.add('cycles-embed-mode') })
onBeforeUnmount(() => { document.body.classList.remove('cycles-embed-mode') })
</script>

<template>
  <div class="embed-shell">
    <main class="embed-main">
      <Content />
    </main>
    <CalculatorEmbedFooter />
  </div>
</template>

<style scoped>
.embed-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.embed-main {
  flex: 1;
  padding: 16px 20px 0;
}
@media (min-width: 720px) {
  .embed-main { padding: 24px 28px 0; }
}
</style>
