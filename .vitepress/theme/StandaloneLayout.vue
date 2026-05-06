<script setup>
import { useData } from 'vitepress'
import { Content } from 'vitepress/dist/client/app/components/Content.js'
import CalculatorStandaloneHeader from './CalculatorStandaloneHeader.vue'
import CalculatorNextSteps from './CalculatorNextSteps.vue'
import SiteFooter from './SiteFooter.vue'

const { frontmatter } = useData()
</script>

<template>
  <div class="standalone-shell">
    <CalculatorStandaloneHeader
      :title="frontmatter.calcTitle || frontmatter.title || 'Calculator'"
      :subtitle="frontmatter.calcSubtitle || ''"
      :docs-url="frontmatter.docsUrl || '/calculators/'"
    />
    <main class="standalone-main">
      <Content />
      <CalculatorNextSteps
        v-if="frontmatter.showNextSteps !== false"
        :context="frontmatter.nextStepsContext || 'cost'"
      />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.standalone-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.standalone-main {
  flex: 1;
  padding: 20px 16px;
  max-width: 1480px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
@media (min-width: 1100px) {
  .standalone-main { padding: 28px 32px; }
}
@media (min-width: 1400px) {
  .standalone-main { padding: 32px 48px; }
}
</style>
