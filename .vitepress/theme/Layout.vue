<script setup>
import DefaultTheme from 'vitepress/theme-without-fonts'
import { useData } from 'vitepress'
import NotFound from './NotFound.vue'
import HomeCodeSnippet from './HomeCodeSnippet.vue'
import HomeDemo from './HomeDemo.vue'
import HomeSocialProof from './HomeSocialProof.vue'
import HomeProblems from './HomeProblems.vue'
import HomeIntegrations from './HomeIntegrations.vue'
import HomeContact from './HomeContact.vue'
import AdoptionLadder from './AdoptionLadder.vue'
import BlogPost from './BlogPost.vue'
import BlogPostNav from './BlogPostNav.vue'
import PageFeedback from './PageFeedback.vue'
import Breadcrumb from './Breadcrumb.vue'
import MobileThemeToggle from './MobileThemeToggle.vue'
import SiteFooter from './SiteFooter.vue'
import EmbedLayout from './EmbedLayout.vue'
import StandaloneLayout from './StandaloneLayout.vue'

const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <EmbedLayout v-if="frontmatter.layout === 'embed'" />
  <StandaloneLayout v-else-if="frontmatter.layout === 'standalone'" />
  <Layout v-else>
    <template #home-hero-actions-after>
      <p v-if="frontmatter.layout === 'home'" class="home-capability-note">
        Today, your application authorizes tools and requires reservations against spend or caller-assigned RISK_POINTS budgets before dispatch.
        Server-enforced action-kind quotas and action-kind allow/deny policies are
        <a href="/protocol/action-governance-preview-in-cycles">preview features</a>.
      </p>
    </template>
    <template #home-features-before>
      <HomeSocialProof v-if="frontmatter.layout === 'home'" />
      <HomeDemo v-if="frontmatter.layout === 'home'" />
      <HomeProblems v-if="frontmatter.layout === 'home'" />
      <HomeIntegrations v-if="frontmatter.layout === 'home'" />
      <HomeCodeSnippet v-if="frontmatter.layout === 'home'" />
    </template>
    <template #home-features-after>
      <AdoptionLadder v-if="frontmatter.layout === 'home'" />
      <HomeContact v-if="frontmatter.layout === 'home'" />
    </template>
    <template #not-found>
      <NotFound />
    </template>
    <template #doc-before>
      <Breadcrumb />
      <BlogPost />
    </template>
    <template #doc-after>
      <BlogPostNav />
      <PageFeedback />
    </template>
    <template #layout-bottom>
      <MobileThemeToggle />
      <SiteFooter />
    </template>
  </Layout>
</template>

<style scoped>
.home-capability-note {
  max-width: 576px;
  margin: 20px auto 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.home-capability-note a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}

@media (min-width: 960px) {
  .home-capability-note {
    margin-left: 0;
  }
}
</style>
