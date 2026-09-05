<script setup>
const steps = [
  {
    icon: '/icons/rocket.svg',
    iconAlt: 'Rocket',
    heading: 'Run the local demo',
    time: '~5 min',
    detail: 'One script, no API keys. Watch a runaway agent stopped at the $1 cap in ~30 seconds.',
    link: '/demos/',
  },
  {
    icon: '/icons/wrench.svg',
    iconAlt: 'Wrench',
    heading: 'Wrap one LLM call',
    time: '~10 min',
    detail: 'One @cycles decorator (Python) or withCycles wrapper (TS) on a single function.',
    link: '/quickstart/end-to-end-tutorial',
  },
  {
    icon: '/icons/shield-check.svg',
    iconAlt: 'Shield',
    heading: 'Wrap one tool call',
    time: '~30 min',
    detail: 'Assign a tool-exposure estimate and require a reservation before dispatch. Your application authorizes the tool.',
    link: '/how-to/assigning-risk-points-to-agent-tools',
  },
  {
    icon: '/icons/gauge.svg',
    iconAlt: 'Gauge',
    heading: 'Shadow mode',
    time: '1+ day',
    detail: 'Enforce in dry-run against real traffic. Calibrate budgets without blocking.',
    link: '/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production',
  },
  {
    icon: '/icons/users-lock.svg',
    iconAlt: 'Lock',
    heading: 'Hard enforcement',
    time: 'Production',
    detail: 'Flip one workflow to live enforcement. Expand from there.',
    link: '/how-to/adding-cycles-to-an-existing-application',
  },
]
</script>

<template>
  <section class="adoption-ladder">
    <div class="inner">
      <h2 class="heading">From demo to enforcement, in 5 steps</h2>
      <div class="grid">
        <a
          v-for="step in steps"
          :key="step.link"
          :href="step.link"
          class="card"
        >
          <div class="card-icon">
            <img :src="step.icon" :alt="step.iconAlt" width="22" height="22" />
          </div>
          <p class="card-heading">{{ step.heading }}</p>
          <p class="card-time">{{ step.time }}</p>
          <p class="card-detail">{{ step.detail }}</p>
          <span class="card-cta">Start &rarr;</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.adoption-ladder {
  /* Container query context: lets the grid below adapt to the section's
     actual rendered width (homepage = full-width; doc pages with sidebars
     = much narrower) instead of the viewport width. Padding lives on
     .inner so it can scale with container width without affecting the
     query dimension. */
  container-type: inline-size;
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 24px;
}

@container (min-width: 640px) {
  .inner { padding: 32px 24px; }
}

@container (min-width: 1024px) {
  .inner { padding: 56px 0; }
}

.heading {
  font-size: 22px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 20px;
  letter-spacing: -0.02em;
  line-height: 1.3;
  text-align: center;
  border: none;
  padding: 0;
}

@container (min-width: 1024px) {
  .heading {
    font-size: 28px;
    margin: 0 0 32px;
  }
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@container (min-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
}

@container (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(5, 1fr);
    gap: 24px;
  }
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 20px;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--vp-c-bg-mute);
  margin-bottom: 14px;
}

.card-icon img {
  display: block;
}

.card-heading {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  line-height: 1.35;
  margin: 0 0 4px;
  letter-spacing: -0.01em;
}

.card-time {
  font-size: 11px;
  font-weight: 700;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 10px;
}

.card-detail {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin: 0 0 14px;
  flex: 1;
}

.card-cta {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-top: auto;
}

/* Connector arrows between cards — only when the container is wide enough
   for the 5-col layout. The arrow sits in the gap between adjacent cards;
   hidden when cards stack vertically or fall back to 2-col. */
@container (min-width: 1024px) {
  .card:not(:last-child)::after {
    content: '→';
    position: absolute;
    top: 50%;
    right: -16px;
    transform: translate(50%, -50%);
    color: var(--vp-c-text-3);
    font-size: 20px;
    font-weight: 300;
    line-height: 1;
    pointer-events: none;
  }
}
</style>
