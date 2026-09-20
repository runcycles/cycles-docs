<script setup>
import { ref, computed } from 'vue'
import { useData, useRoute } from 'vitepress'
import { Link as LinkIcon } from '@lucide/vue'
import { xTwitterPath, linkedInPath } from './SocialIcons'
import { data as posts } from '../../blog/posts.data'

const { frontmatter } = useData()
const route = useRoute()

const post = computed(() =>
  posts.find(p => p.url === route.path)
)

const pdfUrl = computed(() => {
  if (!frontmatter.value.pdf && !frontmatter.value.featured) return null
  const slug = route.path.replace(/^\/blog\//, '').replace(/\/$/, '').replace(/\.html$/, '')
  return `/pdfs/${slug}.pdf`
})

const copied = ref(false)

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  })
}

function copyLink() {
  if (typeof window === 'undefined') return
  navigator.clipboard.writeText(window.location.href)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function shareUrl(platform) {
  if (typeof window === 'undefined') return '#'
  const url = encodeURIComponent(window.location.href)
  const title = encodeURIComponent(frontmatter.value.title)
  if (platform === 'twitter') {
    return `https://x.com/intent/tweet?text=${title}&url=${url}`
  }
  if (platform === 'linkedin') {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
  }
  return '#'
}
</script>

<template>
  <div class="blog-post-header" v-if="frontmatter.blog">
    <a href="/blog/" class="blog-back-link">&larr; Blog</a>
    <p class="blog-post-meta">
      <time :datetime="frontmatter.date">{{ formatDate(frontmatter.date) }}</time>
      <span v-if="frontmatter.author"> &middot; {{ frontmatter.author }}</span>
      <span v-if="post?.readingTime"> &middot; {{ post.readingTime }} min read</span>
    </p>
    <div class="blog-post-tags" v-if="frontmatter.tags?.length">
      <span v-for="tag in frontmatter.tags" :key="tag" class="blog-tag">{{ tag }}</span>
    </div>
    <div class="blog-share">
      <button class="blog-share-btn" @click="copyLink" :aria-label="copied ? 'Link copied' : 'Copy link'">
        <LinkIcon :size="14" />
        {{ copied ? 'Copied!' : 'Copy link' }}
      </button>
      <a class="blog-share-btn" :href="shareUrl('twitter')" target="_blank" rel="noopener noreferrer" aria-label="Share on X (Twitter)">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path :d="xTwitterPath"/></svg>
        Share
      </a>
      <a class="blog-share-btn" :href="shareUrl('linkedin')" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path :d="linkedInPath"/></svg>
        Share
      </a>
      <a v-if="pdfUrl" class="blog-share-btn" :href="pdfUrl" target="_blank" rel="noopener noreferrer" aria-label="Download PDF">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        PDF
      </a>
    </div>
  </div>
</template>
