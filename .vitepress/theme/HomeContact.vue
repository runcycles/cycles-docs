<script setup>
const reasons = [
  {
    label: 'Piloting Cycles on a real stack',
    detail: 'You\'re putting Cycles in front of a real workload — Python, TypeScript, Spring Boot, Rust, MCP — and want implementation help or a second pair of eyes on the integration.',
  },
  {
    label: 'Hit a failure mode we haven\'t documented',
    detail: 'Runaway agent, retry storm, unit mismatch, scope-derivation edge case. Tell us what broke; we\'ll add it to the runbook.',
  },
  {
    label: 'Feedback on the protocol or roadmap',
    detail: 'You\'ve read the spec and have opinions on the error contract, permission model, or something you need in v0.1.26.',
  },
  {
    label: 'Evaluating Cycles for production',
    detail: 'You\'re evaluating Cycles for production — comparing it to rate limiters, LLM gateways, or observability tools. We\'ll walk through the spec, demo the runtime, and answer integration questions.',
    link: '/how-to/evaluate-cycles-for-agent-saas',
    linkText: 'Start with the evaluation guide',
  },
]

const issuesUrl = 'https://github.com/runcycles/cycles-docs/issues'
</script>

<template>
  <section class="home-contact">
    <div class="inner">
      <h2 class="contact-heading">Talk to the team building Cycles</h2>
      <p class="contact-caption">
       Most teams reach out for one of four reasons — they all land in the same inbox, and a founder reads every one.
      </p>

      <ul class="reasons">
        <li v-for="item in reasons" :key="item.label" class="reason">
          <span class="reason-label">{{ item.label }}</span>
          <span class="reason-detail">{{ item.detail }}</span>
          <a v-if="item.link" :href="item.link" class="reason-link">
            {{ item.linkText }} &rarr;
          </a>
        </li>
      </ul>

      <div class="cta-row">
        <a class="cta-button" href="/contact">
          Talk to the team &rarr;
        </a>
      </div>

      <p class="contact-footnote">
        Running a real agent workload and evaluating Cycles?
        <a href="/design-partners">Apply to become a design partner &rarr;</a>
      </p>

      <p class="contact-footnote">
        Found a bug or have a concrete technical issue?
        <a :href="issuesUrl" target="_blank" rel="noopener">Open a GitHub issue</a>
        instead — it&rsquo;s faster for everyone.
      </p>
    </div>
  </section>
</template>

<style scoped>
.home-contact {
  padding: 24px 24px 32px;
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 24px;
}

@media (min-width: 640px) {
  .home-contact { padding: 28px 48px 36px; }
}

@media (min-width: 960px) {
  .home-contact { padding: 32px 64px 40px; }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.contact-heading {
  font-size: 28px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  letter-spacing: -0.02em;
  border-top: none;
  padding-top: 0;
  line-height: 1.25;
}

@media (min-width: 768px) {
  .contact-heading { font-size: 32px; }
}

.contact-caption {
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
  line-height: 1.6;
  max-width: 720px;
}

.reasons {
  list-style: none;
  padding: 0;
  margin: 0 0 32px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 768px) {
  .reasons {
    grid-template-columns: 1fr 1fr;
    gap: 16px 32px;
  }
}

.reason {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s, background 0.2s;
}

.reason:hover {
  border-color: var(--vp-c-brand-1);
}

.reason-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
  margin-bottom: 6px;
}

.reason-detail {
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.55;
}

.reason-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  letter-spacing: -0.01em;
}

.reason-link:hover {
  text-decoration: underline;
}

.cta-row {
  margin: 0 0 16px;
}

.cta-button {
  display: inline-block;
  padding: 12px 22px;
  border-radius: 20px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: -0.01em;
  transition: background 0.2s, transform 0.1s;
}

.cta-button:hover {
  background: var(--vp-c-brand-2);
}

.cta-button:active {
  transform: translateY(1px);
}

.contact-footnote {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin: 0;
  line-height: 1.6;
}

.contact-footnote a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  font-weight: 500;
}

.contact-footnote a:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .contact-heading { font-size: 24px; }
  .cta-button { display: block; text-align: center; }
}
</style>
