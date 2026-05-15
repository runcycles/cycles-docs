<script setup>
import { ref, computed, onMounted } from 'vue'
import { useData, useRoute } from 'vitepress'
import { ThumbsUp, ThumbsDown } from 'lucide-vue-next'

const { frontmatter } = useData()
const route = useRoute()
const feedback = ref(null) // null | 'yes' | 'no'

const storageKey = computed(() => `page-feedback:${route.path}`)

onMounted(() => {
  try {
    const saved = localStorage.getItem(storageKey.value)
    if (saved) feedback.value = saved
  } catch {}
})

function vote(value) {
  feedback.value = value
  try {
    localStorage.setItem(storageKey.value, value)
  } catch {}
  // Send feedback beacon — works with any analytics endpoint.
  // Set window.__FEEDBACK_URL to enable (e.g. in a VitePress head script).
  try {
    const url = typeof window !== 'undefined' && window.__FEEDBACK_URL
    if (url) {
      navigator.sendBeacon(url, JSON.stringify({
        page: route.path,
        helpful: value === 'yes',
        ts: Date.now(),
      }))
    }
  } catch {}
}
</script>

<template>
  <div class="page-feedback" v-if="!frontmatter.blog && frontmatter.layout !== 'home'">
    <div v-if="!feedback" class="feedback-prompt">
      <span class="feedback-label">Was this page helpful?</span>
      <div class="feedback-buttons">
        <button class="feedback-btn" @click="vote('yes')" aria-label="Yes, this page was helpful">
          <ThumbsUp :size="18" />
        </button>
        <button class="feedback-btn" @click="vote('no')" aria-label="No, this page was not helpful">
          <ThumbsDown :size="18" />
        </button>
      </div>
    </div>
    <div v-else class="feedback-thanks">
      <span>Thanks for the feedback!</span>
      <a v-if="feedback === 'no'" href="https://github.com/runcycles/cycles-docs/issues/new" target="_blank" rel="noopener" class="feedback-issue-link">Open an issue</a>
    </div>
  </div>
</template>

<style scoped>
.page-feedback {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
  display: flex;
  justify-content: center;
}

.feedback-prompt {
  display: flex;
  align-items: center;
  gap: 12px;
}

.feedback-label {
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.feedback-buttons {
  display: flex;
  gap: 8px;
}

.feedback-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.feedback-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.feedback-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.feedback-thanks {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.feedback-issue-link {
  font-size: 13px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.feedback-issue-link:hover {
  text-decoration: underline;
}

.feedback-issue-link:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
  border-radius: 4px;
}
</style>
