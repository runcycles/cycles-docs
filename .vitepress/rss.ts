import { type SiteConfig } from 'vitepress'
import { Feed } from 'feed'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const SITE_URL = 'https://runcycles.io'

export async function generateFeed(config: SiteConfig) {
  const feed = new Feed({
    title: 'Cycles Blog',
    description: 'News, guides, and updates from the Cycles team.',
    id: SITE_URL,
    link: `${SITE_URL}/blog/`,
    language: 'en',
    favicon: `${SITE_URL}/runcycles-favicon.ico`,
    copyright: `Copyright 2025-present RunCycles.io`,
    updated: new Date(),
  })

  const pages = config.pages
    .filter(p => p.startsWith('blog/') && p !== 'blog/index.md')

  for (const page of pages) {
    const pageData = config.rewrites.map[page] ?? page
    const url = `${SITE_URL}/${pageData.replace(/\.md$/, '')}`
    const meta = config.site?.themeConfig ?? {}

    // Read frontmatter from the page module cache
    let frontmatter: Record<string, any> = {}
    try {
      const mod = await config.createMarkdownRenderer?.(
        config.srcDir,
        config.markdown,
        config.logger,
      )
      // Fallback: parse frontmatter from raw file
      const fs = await import('fs')
      const raw = fs.readFileSync(resolve(config.srcDir, page), 'utf-8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const lines = fmMatch[1].split('\n')
        for (const line of lines) {
          const m = line.match(/^(\w+):\s*(.+)/)
          if (m) {
            let val: any = m[2].trim()
            if (val.startsWith('[') && val.endsWith(']')) {
              val = val.slice(1, -1).split(',').map((s: string) => s.trim())
            }
            frontmatter[m[1]] = val
          }
        }
      }
    } catch {
      continue
    }

    if (!frontmatter.blog || frontmatter.blog === 'false') continue

    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : []

    feed.addItem({
      title: frontmatter.title ?? '',
      id: url,
      link: url,
      description: frontmatter.description ?? '',
      date: new Date(frontmatter.date ?? Date.now()),
      author: [{ name: frontmatter.author ?? 'Cycles Team' }],
      category: tags.map((t: string) => ({ name: t })),
    })
  }

  // Sort by date descending
  feed.items.sort((a, b) => b.date.getTime() - a.date.getTime())

  const outDir = config.outDir
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'feed.xml'), feed.rss2())
  writeFileSync(resolve(outDir, 'feed.atom'), feed.atom1())

  // Also publish at /blog/feed.xml — RSS readers commonly guess this path
  // since posts live under /blog/. Catches subscriber guesses without
  // moving the canonical URL.
  const blogOut = resolve(outDir, 'blog')
  mkdirSync(blogOut, { recursive: true })
  writeFileSync(resolve(blogOut, 'feed.xml'), feed.rss2())
  writeFileSync(resolve(blogOut, 'feed.atom'), feed.atom1())
}
