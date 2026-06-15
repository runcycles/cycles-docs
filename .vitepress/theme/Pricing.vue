<script setup>
// Support subscriptions (annual, recurring). Middle tier is highlighted.
const tiers = [
  {
    name: 'Community',
    price: 'Free',
    cadence: 'Self-hosted, Apache 2.0',
    forWho: 'Evaluating or running non-critical workloads',
    featured: false,
    features: [
      'GitHub issues, docs, and community',
      'Best-effort response',
      'Public security advisories',
      'Public roadmap',
    ],
    ctaText: 'Start self-hosting',
    ctaLink: '/quickstart/what-is-cycles',
  },
  {
    name: 'Production',
    price: '$1,500',
    cadence: '/mo, billed annually ($18,000/yr)',
    badge: 'Introductory pricing',
    forWho: 'One production workload',
    featured: true,
    features: [
      'One private Slack channel + email',
      'Next-business-day response; SEV-1 target 4 business hours',
      'Early security advisories + upgrade guidance',
      'One annual scope/deployment review',
      'Roadmap input',
    ],
    ctaText: 'Talk to the team',
    ctaLink: '/contact',
  },
  {
    name: 'Enterprise',
    price: 'From $6,000',
    cadence: '/mo, billed annually (from $72,000/yr)',
    forWho: 'Mission-critical, regulated, or multiple workloads',
    featured: false,
    features: [
      'Private Slack + email + scheduled calls',
      'Custom incident-response terms, including optional 24×7 SEV-1 coverage',
      'Pre-release access + version-pinning guidance',
      'Quarterly architecture reviews + named engineer',
      'Evidence/retention config + auditor Q&A support',
      'Prioritized protocol requests',
    ],
    ctaText: 'Contact sales',
    ctaLink: '/contact',
  },
]

// Fixed-scope professional services (one-time engagements).
const services = [
  {
    name: 'Production Readiness Review',
    price: '$7,500',
    cadence: '~1 week',
    detail:
      'Architecture, security, and scope-model review plus a Redis HA/capacity plan. Deliverable: written findings, deployment risk register, runtime/admin hardening checklist, recommended policy/scope model, and a 30-day implementation plan.',
  },
  {
    name: 'Integration Sprint',
    price: '$15,000',
    cadence: '2 weeks',
    detail:
      'Wire Cycles into one agreed workload path with reserve / commit / release, shadow mode where applicable, and a working PR or patch set (Python, TypeScript, Spring, or MCP). You provide access to the target codebase, the deployment environment, and a technical owner.',
  },
  {
    name: 'Compliance Evidence Package',
    price: '$12,000',
    cadence: 'fixed scope',
    detail:
      'Map Cycles-generated evidence and runtime controls to selected control narratives for EU AI Act readiness, NIST AI RMF, and ISO/IEC 42001. Configure CyclesEvidence signing and retention/cold export, and deliver an auditor-ready evidence pack. This is not legal advice.',
  },
  {
    name: 'Custom Integration & Policy Design',
    price: 'From $250',
    cadence: '/hr or fixed bid',
    detail:
      'Custom SDK or agent-host integration, policy and scope design, and migrations — scoped to your stack and delivered as a working patch set.',
  },
  {
    name: 'Team Enablement Workshop',
    price: '$3,500',
    cadence: 'half-day · $6,000 full-day',
    detail:
      'Remote workshop for up to 12 engineers on runtime authority, budget and scope design, and the incident patterns Cycles is built to prevent.',
  },
]
</script>

<template>
  <section class="pricing">
    <!-- Support subscriptions -->
    <div class="grid tiers">
      <div
        v-for="tier in tiers"
        :key="tier.name"
        class="card tier"
        :class="{ featured: tier.featured }"
      >
        <span v-if="tier.featured" class="ribbon">Most popular</span>
        <div class="tier-head">
          <h3 class="tier-name">{{ tier.name }}</h3>
        </div>
        <div class="badge-slot">
          <span v-if="tier.badge" class="badge">{{ tier.badge }}</span>
        </div>
        <div class="price-row">
          <span class="price">{{ tier.price }}</span>
          <span class="cadence">{{ tier.cadence }}</span>
        </div>
        <p class="for-who">{{ tier.forWho }}</p>
        <ul class="features">
          <li v-for="f in tier.features" :key="f">{{ f }}</li>
        </ul>
        <a
          class="cta-button"
          :class="{ alt: !tier.featured }"
          :href="tier.ctaLink"
        >{{ tier.ctaText }} &rarr;</a>
      </div>
    </div>

    <p class="boundary">
      Production support covers Cycles deployment, configuration, upgrades, protocol
      behavior, and integration guidance. It does not include building or operating
      your agent application.
    </p>

    <!-- Professional services -->
    <h2 class="services-heading">Fixed-scope services</h2>
    <p class="services-caption">
      One-time engagements with a fixed price and a concrete deliverable. Subscriptions
      are billed annually; services are 50% on start / 50% on delivery, or net-30.
    </p>
    <div class="grid services">
      <div v-for="svc in services" :key="svc.name" class="card service">
        <h3 class="service-name">{{ svc.name }}</h3>
        <div class="price-row">
          <span class="price small">{{ svc.price }}</span>
          <span class="cadence">{{ svc.cadence }}</span>
        </div>
        <p class="service-detail">{{ svc.detail }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pricing {
  margin: 32px 0;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .tiers { grid-template-columns: repeat(3, 1fr); }
  .services { grid-template-columns: repeat(2, 1fr); }
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 22px 20px;
  border: 2px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s, transform 0.1s;
}

.card:hover {
  border-color: var(--vp-c-brand-1);
}

.tier.featured {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 4px 24px -12px var(--vp-c-brand-1);
}

.ribbon {
  position: absolute;
  top: -11px;
  left: 20px;
  padding: 3px 10px;
  border-radius: 11px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tier-head {
  margin-bottom: 4px;
}

.badge-slot {
  display: flex;
  align-items: center;
  min-height: 22px;
  margin-bottom: 8px;
}

.tier-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0;
  border-top: none;
  padding-top: 0;
  letter-spacing: -0.01em;
}

.badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 10px;
  padding: 2px 8px;
}

.price-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}

/* Fixed-height price slot so the description and CTA rows share a baseline
   across all three tiers regardless of how the cadence text wraps. */
.tier .price-row {
  min-height: 72px;
  justify-content: flex-start;
}

.price {
  font-size: 30px;
  font-weight: 800;
  color: var(--vp-c-text-1);
  letter-spacing: -0.03em;
  line-height: 1;
}

.price.small {
  font-size: 24px;
}

.cadence {
  font-size: 13px;
  color: var(--vp-c-text-3);
  line-height: 1.4;
}

.for-who {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin: 0 0 14px;
  line-height: 1.5;
  min-height: 42px;
}

.features {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-grow: 1;
}

.features li {
  position: relative;
  padding-left: 22px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.features li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.cta-button {
  display: inline-block;
  text-align: center;
  padding: 11px 20px;
  border-radius: 20px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: -0.01em;
  transition: background 0.2s, transform 0.1s;
}

.cta-button:hover { background: var(--vp-c-brand-2); }
.cta-button:active { transform: translateY(1px); }

.cta-button.alt {
  background: transparent;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-divider);
}

.cta-button.alt:hover {
  background: var(--vp-c-bg);
  border-color: var(--vp-c-brand-1);
}

.boundary {
  margin: 18px 0 0;
  padding: 12px 16px;
  border-left: 3px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
  border-radius: 0 8px 8px 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.services-heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 44px 0 8px;
  letter-spacing: -0.02em;
  border-top: none;
  padding-top: 0;
}

.services-caption {
  font-size: 15px;
  color: var(--vp-c-text-2);
  margin: 0 0 20px;
  line-height: 1.6;
  max-width: 760px;
}

.service-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
  border-top: none;
  padding-top: 0;
  letter-spacing: -0.01em;
  min-height: 44px;
}

@media (max-width: 767px) {
  /* Single-column: no neighbor to align with, so drop the reserved slots. */
  .service-name { min-height: 0; }
  .tier .price-row { min-height: 0; }
  .for-who { min-height: 0; }
}

.service-detail {
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 640px) {
  .cta-button { display: block; }
}
</style>
