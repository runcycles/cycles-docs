<script setup>
defineProps({
  title:    { type: String, required: true },
  subtitle: { type: String, default: '' },
  docsUrl:  { type: String, default: '/calculators/' },
})
</script>

<template>
  <header class="calc-header">
    <a href="/" class="brand" aria-label="Cycles home">
      <img src="/runcycles-logo.svg" alt="" class="brand-logo" />
      <span class="brand-name">Cycles</span>
    </a>
    <div class="title-block">
      <h1 class="calc-title">{{ title }}</h1>
      <p v-if="subtitle" class="calc-subtitle">{{ subtitle }}</p>
    </div>
    <a :href="docsUrl" class="back-link">Back to docs &rarr;</a>
  </header>
</template>

<style scoped>
.calc-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 24px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--vp-c-text-1);
  font-weight: 700;
  font-size: 16px;
}
.brand-logo {
  width: 28px;
  height: 28px;
}
.brand-name { letter-spacing: -0.01em; }

.title-block {
  text-align: center;
  min-width: 0;
}
.calc-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
  border: none;
  padding: 0;
}
.calc-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

.back-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-decoration: none;
  white-space: nowrap;
}
.back-link:hover {
  color: var(--vp-c-brand-1);
}

@media (max-width: 720px) {
  .calc-header {
    grid-template-columns: 1fr;
    text-align: center;
    gap: 8px;
  }
  .brand { justify-content: center; }
  .title-block { text-align: center; }
  .calc-title { font-size: 17px; }
  .calc-subtitle { font-size: 12.5px; }
}
</style>
