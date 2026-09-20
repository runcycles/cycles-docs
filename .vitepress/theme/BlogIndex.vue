<script setup>
import { ref, computed, onMounted } from 'vue'
import { Rss } from '@lucide/vue'
import { data as posts } from '../../blog/posts.data'

const selectedTag = ref(null)
const featuredOnly = ref(false)
const tagsOpen = ref(false)
const startHereOpen = ref(false)
const page = ref(1)
const perPage = 10
const stripLimit = 5

const tagCounts = computed(() => {
  const counts = {}
  posts.forEach(p => p.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1 }))
  return counts
})

const allTags = computed(() =>
  Object.keys(tagCounts.value).sort()
)

const featuredPosts = computed(() => posts.filter(p => p.featured))

const filteredPosts = computed(() => {
  if (featuredOnly.value) return featuredPosts.value
  if (selectedTag.value) return posts.filter(p => p.tags.includes(selectedTag.value))
  return posts
})

// Top N most-recent featured posts. Hidden under any filter — the filtered
// view is deliberately chronological for scanning a topic or the full
// featured set, and editorial picks from other topics would be noise there.
const featuredStrip = computed(() =>
  selectedTag.value || featuredOnly.value
    ? []
    : featuredPosts.value.slice(0, stripLimit)
)

const hasMoreFeatured = computed(() =>
  featuredPosts.value.length > stripLimit
)

const totalPages = computed(() =>
  Math.ceil(filteredPosts.value.length / perPage)
)

const paginatedPosts = computed(() =>
  filteredPosts.value.slice((page.value - 1) * perPage, page.value * perPage)
)

function isNew(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  return diff < 7 * 24 * 60 * 60 * 1000
}

function goToPage(next) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
  // Scroll back to the top of the listing. Without this, paginating from
  // page 1 (which has Start Here + Featured + 10 cards = long) would leave
  // the reader near the bottom, as if page 2's first post were the 11th
  // card in a continuous scroll.
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

// Numbered-page window: always show first, last, and up to 2 on each side
// of the current page. Insert ellipsis markers for any gaps. Keeps the
// control under ~9 items even on a 50-page listing.
const pageWindow = computed(() => {
  const total = totalPages.value
  const cur = page.value
  if (total <= 1) return []
  const pages = new Set([1, total, cur - 2, cur - 1, cur, cur + 1, cur + 2])
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
  const items = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] > sorted[i - 1] + 1) items.push({ type: 'gap' })
    items.push({ type: 'page', page: sorted[i] })
  }
  return items
})

function selectTag(tag) {
  selectedTag.value = tag
  if (tag) featuredOnly.value = false
  page.value = 1
  const url = new URL(window.location.href)
  if (tag) {
    url.searchParams.set('tag', tag)
    url.searchParams.delete('featured')
  } else {
    url.searchParams.delete('tag')
  }
  history.replaceState(null, '', url.toString())
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function toggleFeaturedOnly(on) {
  featuredOnly.value = on
  if (on) selectedTag.value = null
  page.value = 1
  const url = new URL(window.location.href)
  if (on) {
    url.searchParams.set('featured', '1')
    url.searchParams.delete('tag')
  } else {
    url.searchParams.delete('featured')
  }
  history.replaceState(null, '', url.toString())
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  })
}

// URL param precedence on load: ?featured=1 wins over ?tag=X. The two
// filters are mutually exclusive in the UI, so when both are present we
// pick featured and silently drop the tag rather than rendering an
// impossible state. selectTag/toggleFeaturedOnly keep the URL in sync
// going forward — this only matters for a hand-crafted link.
onMounted(() => {
  const url = new URL(window.location.href)
  const tagParam = url.searchParams.get('tag')
  if (tagParam && allTags.value.includes(tagParam)) {
    selectedTag.value = tagParam
  }
  if (url.searchParams.get('featured') === '1') {
    featuredOnly.value = true
    selectedTag.value = null
  }
})
</script>

<template>
  <div class="blog-index">
    <div class="blog-tags-row">
      <div class="blog-tags-collapsible">
        <button class="blog-tags-toggle" @click="tagsOpen = !tagsOpen" :aria-expanded="tagsOpen">
          Filter by tag<span v-if="selectedTag" class="blog-tags-active-indicator">: {{ selectedTag }}</span>
          <span class="blog-tags-arrow" :class="{ open: tagsOpen }">▸</span>
        </button>
        <button v-if="selectedTag" class="blog-tags-clear" @click="selectTag(null)" aria-label="Clear tag filter">✕</button>
        <div class="blog-tags" v-show="tagsOpen" v-if="allTags.length" role="group" aria-label="Filter by tag">
          <button
            :class="{ active: !selectedTag }"
            :aria-pressed="!selectedTag"
            @click="selectTag(null)"
          >All ({{ posts.length }})</button>
          <button
            v-for="tag in allTags" :key="tag"
            :class="{ active: selectedTag === tag }"
            :aria-pressed="selectedTag === tag"
            @click="selectTag(tag)"
          >{{ tag }} ({{ tagCounts[tag] }})</button>
        </div>
      </div>
      <a href="/feed.xml" class="blog-rss-link" aria-label="Subscribe via RSS">
        <Rss :size="14" style="margin-right:4px" />
        RSS
      </a>
    </div>

    <section v-if="!selectedTag && !featuredOnly && page === 1" class="blog-start-here">
      <button class="blog-start-here-toggle" @click="startHereOpen = !startHereOpen" :aria-expanded="startHereOpen">
        Start Here <span class="blog-tags-arrow" :class="{ open: startHereOpen }">▸</span>
      </button>
      <div v-show="startHereOpen">
        <p class="blog-start-here-desc">New to Cycles? Read these posts in order to understand runtime authority from the ground up.</p>
        <ol class="blog-start-here-list">
          <li><a href="/blog/what-is-runtime-authority-for-ai-agents">What Is Runtime Authority for AI Agents?</a></li>
          <li><a href="/blog/true-cost-of-uncontrolled-agents">The True Cost of Uncontrolled AI Agents</a></li>
          <li><a href="/blog/how-much-do-ai-agents-cost">How Much Do AI Agents Actually Cost?</a></li>
          <li><a href="/blog/ai-agent-cost-management-guide">AI Agent Cost Management: The Complete Guide</a></li>
          <li><a href="/blog/ai-agent-budget-control-enforce-hard-spend-limits">AI Agent Budget Control: Enforce Hard Spend Limits</a></li>
        </ol>
        <p class="blog-start-here-cta">Ready to try Cycles? Jump to the <a href="/quickstart/end-to-end-tutorial">End-to-End Tutorial</a>.</p>
      </div>
    </section>

    <section
      v-if="featuredStrip.length && page === 1"
      class="blog-featured-strip"
      aria-label="Featured posts"
    >
      <article v-for="post in featuredStrip" :key="post.url" class="blog-card">
        <div class="blog-card-content">
          <h2>
            <a :href="post.url">{{ post.title }}</a>
            <span class="blog-featured-badge">FEATURED</span>
            <span v-if="isNew(post.date)" class="blog-new-badge">NEW</span>
          </h2>
          <div class="blog-meta">
            <time class="blog-date" :datetime="post.date">{{ formatDate(post.date) }}</time>
            <span class="blog-author"> &middot; {{ post.author }}</span>
            <span class="blog-reading-time"> &middot; {{ post.readingTime }} min read</span>
          </div>
          <p class="blog-description">{{ post.description }}</p>
          <div class="blog-card-tags" v-if="post.tags.length">
            <button v-for="tag in post.tags" :key="tag" class="blog-tag blog-tag-clickable" @click="selectTag(tag)">{{ tag }}</button>
          </div>
        </div>
        <img v-if="post.image" :src="post.image" :alt="post.title" class="blog-card-thumb" loading="lazy" />
      </article>
      <div v-if="hasMoreFeatured" class="blog-featured-strip-footer">
        <button
          type="button"
          class="blog-featured-strip-more"
          @click="toggleFeaturedOnly(true)"
        >See all {{ featuredPosts.length }} featured posts &rarr;</button>
      </div>
    </section>

    <div v-if="featuredOnly" class="blog-featured-filter-banner">
      <span>Showing all {{ featuredPosts.length }} featured posts, newest first.</span>
      <button type="button" class="blog-tags-clear" @click="toggleFeaturedOnly(false)" aria-label="Clear featured filter">&larr; Back to all posts</button>
    </div>

    <article v-for="(post, i) in paginatedPosts" :key="post.url" class="blog-card">
      <div class="blog-card-content">
        <h2>
          <a :href="post.url">{{ post.title }}</a>
          <span v-if="post.featured" class="blog-featured-badge">FEATURED</span>
          <span v-if="isNew(post.date)" class="blog-new-badge">NEW</span>
        </h2>
        <div class="blog-meta">
          <time class="blog-date" :datetime="post.date">{{ formatDate(post.date) }}</time>
          <span class="blog-author"> &middot; {{ post.author }}</span>
          <span class="blog-reading-time"> &middot; {{ post.readingTime }} min read</span>
        </div>
        <p class="blog-description">{{ post.description }}</p>
        <div class="blog-card-tags" v-if="post.tags.length">
          <button v-for="tag in post.tags" :key="tag" class="blog-tag blog-tag-clickable" @click="selectTag(tag)">{{ tag }}</button>
        </div>
      </div>
      <img v-if="post.image" :src="post.image" :alt="post.title" class="blog-card-thumb" loading="lazy" />
    </article>

    <p v-if="paginatedPosts.length === 0" class="blog-empty">
      No posts found.
    </p>

    <nav class="blog-pagination" v-if="totalPages > 1" aria-label="Blog pagination">
      <button class="blog-page-step" :disabled="page <= 1" @click="goToPage(1)" aria-label="First page">&laquo; First</button>
      <button class="blog-page-step" :disabled="page <= 1" @click="goToPage(page - 1)" aria-label="Newer posts">&larr; Newer</button>
      <div class="blog-page-numbers">
        <template v-for="(item, idx) in pageWindow" :key="idx">
          <span v-if="item.type === 'gap'" class="blog-page-gap" aria-hidden="true">&hellip;</span>
          <button
            v-else
            class="blog-page-num"
            :class="{ active: item.page === page }"
            :aria-current="item.page === page ? 'page' : undefined"
            @click="goToPage(item.page)"
          >{{ item.page }}</button>
        </template>
      </div>
      <button class="blog-page-step" :disabled="page >= totalPages" @click="goToPage(page + 1)" aria-label="Older posts">Older &rarr;</button>
      <button class="blog-page-step" :disabled="page >= totalPages" @click="goToPage(totalPages)" aria-label="Last page">Last &raquo;</button>
    </nav>
  </div>
</template>
