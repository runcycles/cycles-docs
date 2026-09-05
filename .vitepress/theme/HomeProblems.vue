<script setup>
const problems = [
  {
    icon: '/icons/gauge.svg',
    hook: '240 iterations. $52.80 in modeled spend.',
    detail: 'In an illustrative coding-agent loop, an ambiguous error triggers 240 iterations over three hours. At the stated average token usage and prices, a mandatory $15 run budget rejects a protected call around iteration 68.',
    solution: 'See the $15 run-budget example.',
    link: '/why-cycles/cost-control',
  },
  {
    icon: '/icons/shield-check.svg',
    hook: '200 mistaken emails. $1.40 in modeled token cost.',
    detail: 'In an illustrative support-agent scenario, a template regression sends payment reminders instead of welcome messages. Business impact is unquantified. A token-spend budget can leave this activity within its limit.',
    solution: 'Budget caller-assigned tool exposure.',
    link: '/why-cycles/action-authority',
  },
  {
    icon: '/icons/users-lock.svg',
    hook: "One customer's loop can exhaust a shared budget.",
    detail: 'In an illustrative SaaS scenario, one research loop consumes a shared provider allocation and interrupts other tenants. Separate application ledgers can bound each tenant\'s submitted usage on protected paths.',
    solution: 'Configure tenant budget isolation.',
    link: '/why-cycles/multi-tenant',
  },
  {
    icon: '/icons/book-text.svg',
    hook: 'Can you explain the budget decision before a call?',
    detail: 'Reservation lifecycle records show submitted scopes, budget decisions, and settlement. Correlate them with application logs for tool authorization and outcomes.',
    solution: 'Inspect budget enforcement evidence.',
    link: '/why-cycles/governance',
  },
]
</script>

<template>
  <section class="home-problems">
    <div class="inner">
      <h2 class="heading">Budget and exposure scenarios</h2>
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
