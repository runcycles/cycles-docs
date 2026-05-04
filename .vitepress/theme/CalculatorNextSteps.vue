<script setup>
defineProps({
  // Calculator-specific framing for the lead-in copy.
  context: { type: String, default: 'cost' }, // 'cost' | 'risk'
})
</script>

<template>
  <section class="next-steps">
    <div class="next-inner">
      <div class="next-headline">
        <h2>Now what?</h2>
        <p v-if="context === 'risk'">
          A blast-radius number on a screen does not bound anything by itself. The number becomes
          real when you put a runtime gate between the agent and the action — Cycles is that gate.
        </p>
        <p v-else>
          A cost projection on a screen does not enforce anything by itself. The projection becomes
          a hard ceiling when you put a runtime gate in front of every LLM call — Cycles is that gate.
        </p>
      </div>

      <div class="next-grid">
        <a class="next-card next-primary" href="/quickstart/end-to-end-tutorial">
          <span class="next-eyebrow">Try it locally</span>
          <span class="next-title">10-minute end-to-end tutorial</span>
          <span class="next-detail">Wrap one LLM call. Watch the budget enforce. Apache 2.0, self-hosted.</span>
          <span class="next-cta">Start tutorial &rarr;</span>
        </a>

        <a class="next-card" href="/demos/">
          <span class="next-eyebrow">See it run</span>
          <span class="next-title">Runaway-agent demo</span>
          <span class="next-detail"><code>docker compose up</code>. No API keys. $10 → $1 budget enforcement in 30 seconds.</span>
          <span class="next-cta">Run the demo &rarr;</span>
        </a>

        <a v-if="context === 'risk'" class="next-card" href="/guides/risk-and-blast-radius">
          <span class="next-eyebrow">Read the model</span>
          <span class="next-title">Risk &amp; Blast Radius Reference</span>
          <span class="next-detail">Risk scoring, blast-radius containment, degradation paths, and the runtime patterns that bound them.</span>
          <span class="next-cta">Open guide &rarr;</span>
        </a>
        <a v-else class="next-card" href="/guides/llm-cost-runtime-control">
          <span class="next-eyebrow">Read the model</span>
          <span class="next-title">LLM Cost Runtime Control Reference</span>
          <span class="next-detail">Cost-incident taxonomy, multi-tenant isolation, estimation accuracy, unit economics, and rollout.</span>
          <span class="next-cta">Open guide &rarr;</span>
        </a>

        <a class="next-card next-ghost" href="/contact">
          <span class="next-eyebrow">Talk to the team</span>
          <span class="next-title">Walk through your numbers with us</span>
          <span class="next-detail">Send the share link from this calculator and we'll respond with a sanity check on the assumptions and the rollout shape.</span>
          <span class="next-cta">Contact &rarr;</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.next-steps {
  margin-top: 36px;
  padding: 28px 0 8px;
  border-top: 1px solid var(--vp-c-divider);
}
.next-inner { max-width: 1280px; margin: 0 auto; }

.next-headline { max-width: 720px; margin-bottom: 20px; }
.next-headline h2 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  border: none;
  padding: 0;
}
.next-headline p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.next-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 720px) {
  .next-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
}
@media (min-width: 1100px) {
  .next-grid { grid-template-columns: repeat(4, 1fr); }
}

.next-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: var(--vp-c-text-1);
  transition: border-color 0.18s, transform 0.18s, background 0.18s;
}
.next-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.next-eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--vp-c-brand-1);
}
.next-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}
.next-detail {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}
.next-detail code {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}
.next-cta {
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

.next-card.next-primary {
  background: linear-gradient(135deg, color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--vp-c-bg-soft)), var(--vp-c-bg-soft));
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--vp-c-divider));
}
.next-card.next-ghost {
  background: transparent;
}
</style>
