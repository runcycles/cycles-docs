<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

// Both demos appear on the homepage and on /demos/.
// Action authority goes first because it is the product's clearest
// differentiator: staying under budget does not make an action safe.
// Cost runaway follows as the familiar spend-enforcement case.
// CTAs deep-link to the corresponding H2 anchors on /demos/ for run instructions.
//
// Video sources in order: MP4/H.264 first (universally supported, and our
// specific encodes are smaller than WebM here; also what social link-preview
// crawlers like Twitter/LinkedIn/Slack reliably handle), then WebM/VP9, then
// the GIF as a last-resort fallback. Poster image renders before the video
// loads and during prefers-reduced-motion (most browsers respect that for
// autoplay video).
const demos = [
  {
    key: 'action-authority',
    label: 'Blast radius',
    poster: '/demo-action-authority-poster.png',
    mp4: '/demo-action-authority.mp4',
    webm: '/demo-action-authority.webm',
    gifFallback: '/demo-action-authority.gif',
    alt: 'Cycles demo: a support agent runs a four-step workflow; without Cycles all four actions execute including the customer email; with Cycles the first three proceed and the email is blocked before it sends.',
    intro: 'Same workflow. Different boundary.',
    captionWithout: 'All four actions execute — including the customer email.',
    captionWith: 'Internal actions proceed; the email is blocked before it sends.',
    mechanism: 'decide → DENY → no email send',
    ctaText: 'Run the action-authority demo',
    ctaLink: '/demos/#action-authority-demo',
  },
  {
    key: 'runaway',
    label: 'Cost runaway',
    poster: '/demo-runaway-poster.png',
    mp4: '/demo-runaway.mp4',
    webm: '/demo-runaway.webm',
    gifFallback: '/demo-runaway.gif',
    alt: 'Cycles demo: an agent burns ~$10 in 12 seconds without enforcement; with Cycles, the same agent stops cleanly at $1.',
    intro: 'Same agent. Same bug.',
    captionWithout: '~$10 in 12s — the pace behind $4,200 incidents.',
    captionWith: '$1 cap, before the next action ran.',
    mechanism: 'reserve → deny → no downstream call',
    ctaText: 'Run the runaway demo',
    ctaLink: '/demos/#runaway-agent-demo',
  },
]

// Playback policy: only the first video autoplays (the second is below
// the fold and starts with preload="none" so it costs nothing until
// scrolled to). An IntersectionObserver plays whichever video is in
// view and pauses it when scrolled past. Under prefers-reduced-motion
// nothing plays automatically — Chrome does not block muted autoplay on
// its own — and controls are surfaced so the demos stay watchable.
const videoEls = ref([])
const showControls = ref(false)
let observer = null

onMounted(() => {
  const videos = videoEls.value.filter(Boolean)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showControls.value = true
    for (const video of videos) video.pause()
    return
  }
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.play().catch(() => {})
      else entry.target.pause()
    }
  }, { threshold: 0.25 })
  for (const video of videos) observer.observe(video)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="home-demo">
    <div class="inner">
      <h2 class="heading">See it in 60 seconds</h2>
      <div
        v-for="(demo, i) in demos"
        :key="demo.key"
        class="demo-block"
        :class="{ 'with-divider': i > 0 }"
      >
        <p class="demo-label">{{ demo.label }}</p>
        <p class="intro-line">{{ demo.intro }}</p>
        <div class="caption">
          <p class="caption-line">
            <span class="caption-label">Without Cycles:</span>
            {{ demo.captionWithout }}
          </p>
          <p class="caption-line">
            <span class="caption-label">With Cycles:</span>
            {{ demo.captionWith }}
          </p>
        </div>
        <p class="mechanism-line">{{ demo.mechanism }}</p>
        <div class="demo-frame">
          <video
            class="demo-video"
            :ref="el => (videoEls[i] = el)"
            :autoplay="i === 0"
            muted
            loop
            playsinline
            :controls="showControls"
            :poster="demo.poster"
            :preload="i === 0 ? 'metadata' : 'none'"
            :aria-label="demo.alt"
          >
            <source :src="demo.mp4" type="video/mp4" />
            <source :src="demo.webm" type="video/webm" />
            <img :src="demo.gifFallback" :alt="demo.alt" />
          </video>
        </div>
        <a :href="demo.ctaLink" class="demo-cta">{{ demo.ctaText }} &rarr;</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-demo {
  padding: 0 24px 48px;
}

@media (min-width: 640px) {
  .home-demo { padding: 0 48px 48px; }
}

@media (min-width: 960px) {
  .home-demo { padding: 0 64px 48px; }
}

.inner {
  max-width: 1024px;
  margin: 0 auto;
  text-align: center;
}

.heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 32px;
  letter-spacing: -0.02em;
  line-height: 1.3;
  border: none;
  padding: 0;
}

@media (min-width: 768px) {
  .heading { font-size: 28px; }
}

.demo-block {
  padding-top: 0;
}

.demo-block.with-divider {
  margin-top: 48px;
  padding-top: 48px;
  border-top: 1px solid var(--vp-c-divider);
}

.demo-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  margin: 0 0 12px;
}

.intro-line {
  font-size: 13px;
  font-style: italic;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  line-height: 1.5;
}

.caption {
  margin: 0 0 16px;
}

.mechanism-line {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.02em;
  margin: 0 0 20px;
  line-height: 1.5;
}

.caption-line {
  font-size: 15px;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin: 0;
}

.caption-line + .caption-line {
  margin-top: 4px;
}

.caption-label {
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.demo-frame {
  margin: 0 auto 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  max-width: 880px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

.demo-frame video,
.demo-frame img {
  display: block;
  width: 100%;
  height: auto;
}

.demo-cta {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 20px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: -0.01em;
  transition: background 0.2s, transform 0.1s;
}

.demo-cta:hover {
  background: var(--vp-c-brand-2);
}

.demo-cta:active {
  transform: translateY(1px);
}
</style>
