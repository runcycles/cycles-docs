<script setup>
const links = [
  { text: 'About', href: '/about' },
  { text: 'Security', href: '/security' },
  { text: 'Tools', href: '/calculators/' },
  { text: 'Blog', href: '/blog/' },
  { text: 'Changelog', href: '/changelog' },
  { text: 'Contact', href: '/contact' },
  { text: 'GitHub', href: 'https://github.com/runcycles', external: true },
]
</script>

<template>
  <footer class="site-footer">
    <div class="inner">
      <nav class="footer-nav" aria-label="Footer">
        <template v-for="(link, i) in links" :key="link.text">
          <a
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener' : undefined"
          >{{ link.text }}</a>
          <span v-if="i < links.length - 1" class="sep" aria-hidden="true">·</span>
        </template>
      </nav>
      <p class="copyright">
        Copyright &copy; 2025&ndash;present RunCycles.io &middot; Released under the Apache 2.0 License.
      </p>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  border-top: 1px solid var(--vp-c-divider);
  padding: 24px 24px 28px;
  margin-top: 24px;
  background: var(--vp-c-bg);
}

@media (min-width: 640px) {
  .site-footer { padding: 28px 48px 32px; }
}

@media (min-width: 960px) {
  .site-footer { padding: 32px 64px 36px; }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.footer-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-bottom: 12px;
}

.footer-nav a {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  letter-spacing: -0.01em;
  transition: color 0.15s;
}

.footer-nav a:hover {
  color: var(--vp-c-brand-1);
}

.sep {
  color: var(--vp-c-text-3);
  font-size: 14px;
  user-select: none;
}

.copyright {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin: 0;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .site-footer { margin-top: 16px; }
  .footer-nav { gap: 4px 8px; }
  .footer-nav a, .sep { font-size: 13px; }
}
</style>

<style>
/* Unscoped so we can target VitePress's sibling .VPContent.has-sidebar.
   The fixed sidebar overlays the left gutter of the viewport above 960px,
   so shift the footer's inner padding right by the sidebar width. */
@media (min-width: 960px) {
  .VPContent.has-sidebar ~ .site-footer {
    padding-left: calc(var(--vp-sidebar-width) + 64px);
  }
}

@media (min-width: 1440px) {
  .VPContent.has-sidebar ~ .site-footer {
    padding-left: calc(256px + 64px);
  }
}
</style>
