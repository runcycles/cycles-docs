<script setup>
const problems = [
  {
    icon: '/icons/gauge.svg',
    hook: 'Your agent spent $4,200 while you slept.',
    detail: 'It hit an ambiguous error, retried with expanding context, and looped 240 times. Provider caps fired the next morning — blocking every agent on the account.',
    solution: 'Cap it at $15 per run.',
    link: '/why-cycles/cost-control',
  },
  {
    icon: '/icons/shield-check.svg',
    hook: '200 emails. $1.40 in tokens. $50K in damage.',
    detail: 'A prompt regression turned welcome emails into collections notices. The agent stayed within its token budget the entire time. No spending limit would have caught it.',
    solution: 'Gate actions, not just spend.',
    link: '/why-cycles/action-authority',
  },
  {
    icon: '/icons/users-lock.svg',
    hook: "One customer's runaway just blocked your other 500.",
    detail: "Customer #47 triggered a research loop. Their session burned through the shared API budget. The provider cap fired and blocked every tenant on the platform.",
    solution: 'Isolate every customer.',
    link: '/why-cycles/multi-tenant',
  },
  {
    icon: '/icons/book-text.svg',
    hook: 'Auditor asks: prove the agent was under control.',
    detail: "Dashboards show what happened after the fact. They don't show the pre-execution decision, scope, denial, commit, and authority trail.",
    solution: 'Show enforcement evidence.',
    link: '/why-cycles/governance',
  },
]
</script>

<template>
  <section class="home-problems">
    <div class="inner">
      <h2 class="heading">Four incidents Cycles prevents</h2>
      <div class="grid">
        <a
          v-for="item in problems"
          :key="item.link"
          :href="item.link"
          class="card"
        >
          <div class="card-icon">
            <img :src="item.icon" :alt="item.solution" width="28" height="28" />
          </div>
          <p class="card-hook">{{ item.hook }}</p>
          <p class="card-detail">{{ item.detail }}</p>
          <span class="card-cta">{{ item.solution }} &rarr;</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-problems {
  padding: 0 24px 48px;
}

@media (min-width: 640px) {
  .home-problems { padding: 0 48px 48px; }
}

@media (min-width: 960px) {
  .home-problems { padding: 0 64px 48px; }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 32px;
  letter-spacing: -0.02em;
  line-height: 1.3;
  text-align: center;
  border: none;
  padding: 0;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
}

.card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}

.card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}

.card-icon {
  margin-bottom: 16px;
}

.card-icon img {
  display: block;
}

.card-hook {
  font-size: 18px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  line-height: 1.4;
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.card-detail {
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0 0 16px;
  flex: 1;
}

.card-cta {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-top: auto;
}

@media (max-width: 640px) {
  .card-hook { font-size: 16px; }
  .card { padding: 20px; }
}
</style>
