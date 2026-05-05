import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { useSidebar } from 'vitepress-openapi'
import spec from '../public/openapi.json' with { type: 'json' }
import adminSpec from '../public/admin-openapi.json' with { type: 'json' }
import { generateFeed } from './rss'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(__dirname, '..')

const openApiSidebar = useSidebar({
  spec,
  linkPrefix: '/api/operations/',
})

const adminApiSidebar = useSidebar({
  spec: adminSpec,
  linkPrefix: '/admin-api/operations/',
})

// Extract H2 headings from a markdown file on disk. We read directly because
// pageData.headers is not reliably populated when transformPageData runs.
// Returns [{ title, slug }, ...] using GitHub-style slugs to match
// markdown-it-anchor's default output. Non-step section headings (TL;DR,
// Related, Next steps, etc.) are filtered out so HowTo schema only describes
// genuinely sequential / actionable sections.
const NON_STEP_HEADINGS = new Set([
  'tldr', 'tl;dr',
  'related', 'related how-to guides', 'related guides', 'related resources',
  'next steps', 'further reading',
  'key points', 'summary', 'conclusion',
  'see also', 'references',
  'glossary',
])

function isStepHeading(title) {
  return !NON_STEP_HEADINGS.has(title.toLowerCase().trim())
}

function extractH2Headings(relativePath) {
  try {
    const filePath = path.join(srcRoot, relativePath)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const body = raw.replace(/^---[\s\S]*?\n---\n/, '')
    const lines = body.split('\n')
    const out = []
    let inFence = false
    for (const line of lines) {
      if (/^\s*```/.test(line)) inFence = !inFence
      if (inFence) continue
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m) {
        const title = m[1].replace(/`/g, '').trim()
        if (!isStepHeading(title)) continue
        out.push({ title, slug: slugifyHeading(title) })
      }
    }
    return out
  } catch {
    return []
  }
}

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// Resolve the OG/Twitter image URL for any page. Order:
//   1. frontmatter.image (explicit per-page override)
//   2. /og/<relativePath-without-.md>.png if generated on disk
//      (e.g. blog/foo.md -> /og/blog/foo.png, how-to/bar.md -> /og/how-to/bar.png)
//   3. site-wide fallback
function resolveOgImage(pageData) {
  const fmImage = pageData.frontmatter.image
  if (typeof fmImage === 'string' && fmImage.length > 0) {
    // Absolute URLs (CDN, third-party host) pass through; root-relative paths
    // get the site origin prepended.
    if (/^https?:\/\//i.test(fmImage)) return fmImage
    return `https://runcycles.io${fmImage}`
  }
  const rel = pageData.relativePath.replace(/\\/g, '/')
  const m = /^(.+)\.md$/.exec(rel)
  if (m) {
    const stem = m[1]
    const generatedPath = path.join(srcRoot, 'public', 'og', `${stem}.png`)
    if (fs.existsSync(generatedPath)) {
      return `https://runcycles.io/og/${stem}.png`
    }
  }
  return 'https://runcycles.io/runcycles-og.png'
}

export default defineConfig({
  base: '/',
  appearance: 'dark',
  title: 'Cycles',
  async buildEnd(config) {
    await generateFeed(config)
  },
  description: 'Stop runaway agent spend and risky actions before they execute. Open protocol, multi-language SDKs, Apache 2.0.',
  cleanUrls: true,
  lang: 'en',
  titleTemplate: ':title — Cycles',
  srcExclude: ['**/README.md', '**/CLAUDE.md', 'AGENTS.md', '**/AGENTS.md', 'cycles-protocol/**', '.outreach/**', '.agents/**'],
  head: [
    ['link', { rel: 'preload', href: '/fonts/inter-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossorigin: '' }],
    ['link', { rel: 'preload', href: '/fonts/jetbrains-mono-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossorigin: '' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/runcycles-favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/x-icon', href: '/runcycles-favicon.ico' }],
    ['link', { rel: 'apple-touch-icon', sizes: '192x192', href: '/runcycles-logo-192.png' }],
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    /* Per-page description, og:*, and twitter:* tags are injected dynamically
       in transformPageData below — using frontmatter values per page.
       Only truly global/static meta tags belong here. */
    ['meta', { property: 'og:site_name', content: 'Cycles' }],
    ['meta', { property: 'og:image', content: 'https://runcycles.io/runcycles-og.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Cycles logo' }],
    ['meta', { name: 'theme-color', content: '#0B0F1A' }],
    ['meta', { name: 'twitter:site', content: '@runcycles' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: 'https://runcycles.io/runcycles-og.png' }],
    ['meta', { name: 'twitter:image:alt', content: 'Cycles logo' }],
    ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Cycles Blog RSS', href: 'https://runcycles.io/feed.xml' }],
    ['link', { rel: 'alternate', type: 'application/atom+xml', title: 'Cycles Blog Atom', href: 'https://runcycles.io/feed.atom' }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Cycles",
      "applicationCategory": "DeveloperApplication",
      "description": "Runtime authority for autonomous agents. Stop runaway agent spend and risky actions before they execute.",
      "url": "https://runcycles.io",
      "license": "https://www.apache.org/licenses/LICENSE-2.0",
      "offers": { "@type": "Offer", "price": "0" }
    })],
  ],
  sitemap: {
    hostname: 'https://runcycles.io',
    transformItems: (items) => {
      const fallback = new Date().toISOString()
      return items
        .filter((item) => item.url !== '404')
        .filter((item) => !item.url.includes('/operations/'))
        // Calculator embed pages are noindex iframe targets — exclude from
        // sitemap so search engines do not pick them up as standalone results.
        .filter((item) => !/calculators\/[^/]*-embed$/.test(item.url))
        .map((item) => item.lastmod ? item : { ...item, lastmod: fallback })
    },
  },
  markdown: {
    image: {
      lazyLoading: true
    },
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },
  lastUpdated: true,
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        translations: {
          button: {
            buttonText: 'Search docs',
            buttonAriaLabel: 'Search documentation',
          },
          modal: {
            displayDetails: 'Show detailed view',
            noResultsText: 'No results for',
            resetButtonTitle: 'Clear search',
            footer: {
              selectText: 'to select',
              navigateText: 'to navigate',
              closeText: 'to close',
            },
          },
        },
        miniSearch: {
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: {
              title: 4,
              text: 2,
            },
          }
        }
      }
    },
    logo: { src: '/runcycles-logo.svg', alt: 'Cycles' },
    externalLinkIcon: true,
    editLink: {
      pattern: 'https://github.com/runcycles/docs/edit/main/:path',
      text: 'Edit this page on GitHub'
    },
    lastUpdated: {
      text: 'Last updated'
    },
    docFooter: {
      prev: 'Previous',
      next: 'Next'
    },
    outline: {
      level: [2, 3],
      label: 'On this page'
    },
    nav: [
      { text: 'Why Cycles', link: '/why-cycles' },
      { text: 'Quickstart', link: '/quickstart/what-is-cycles' },
      { text: 'Protocol', link: '/protocol/' },
      {
        text: 'Tools',
        items: [
          { text: 'All tools', link: '/calculators/' },
          { text: 'Blast Radius Risk Calculator', link: '/calculators/ai-agent-blast-radius-standalone' },
          { text: 'Cost Calculator (Claude vs GPT)', link: '/calculators/claude-vs-gpt-cost-standalone' },
        ],
      },
      {
        text: 'Docs',
        items: [
          {
            text: 'Getting Started',
            items: [
              { text: 'What is Cycles?', link: '/quickstart/what-is-cycles' },
              { text: 'Docs Home', link: '/docs/' },
              { text: 'Concepts', link: '/concepts/comparisons' },
              { text: 'How-To Guides', link: '/how-to/adding-cycles-to-an-existing-application' },
              { text: 'Integrations', link: '/how-to/integrations-overview' },
            ],
          },
          {
            text: 'Reference',
            items: [
              { text: 'API Reference (Interactive)', link: '/api/' },
              { text: 'Admin API (Interactive)', link: '/admin-api/' },
              { text: 'Protocol Spec', link: 'https://github.com/runcycles/cycles-protocol' },
              { text: 'Configuration', link: '/configuration/python-client-configuration-reference' },
            ],
          },
          {
            text: 'Operations',
            items: [
              { text: 'Security', link: '/security' },
              { text: 'Incident Patterns', link: '/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent' },
              { text: 'Demos', link: '/demos/' },
            ],
          },
        ],
      },
      { text: 'Blog', link: '/blog/' },
      { text: 'Partners', link: '/design-partners' },
      { text: 'Contact', link: '/contact' },
      { text: 'GitHub', link: 'https://github.com/runcycles' }
    ],
    sidebar: {
      '/api/': [
        {
          text: 'Cycles Protocol API',
          items: [
            { text: 'Overview', link: '/api/' },
            ...openApiSidebar.generateSidebarGroups(),
          ],
        },
      ],
      '/admin-api/': [
        {
          text: 'RunCycles Admin API',
          items: [
            { text: 'Overview', link: '/admin-api/' },
            ...adminApiSidebar.generateSidebarGroups(),
          ],
        },
      ],
      '/demos/': [],
      '/blog/': [],
      '/': [
        {
          text: 'Why Cycles',
          link: '/why-cycles',
          items: [
            { text: 'Cost Control', link: '/why-cycles/cost-control' },
            { text: 'Action Authority', link: '/why-cycles/action-authority' },
            { text: 'Multi-Tenant Isolation', link: '/why-cycles/multi-tenant' },
            { text: 'Governance & Compliance', link: '/why-cycles/governance' },
          ],
        },
        {
          text: 'Quickstart',
          items: [
            { text: 'What is Cycles?', link: '/quickstart/what-is-cycles' },
            { text: 'End-to-End Tutorial', link: '/quickstart/end-to-end-tutorial' },
            { text: 'Add to a Python App', link: '/quickstart/getting-started-with-the-python-client' },
            { text: 'Add to a TypeScript App', link: '/quickstart/getting-started-with-the-typescript-client' },
            { text: 'Add to a Spring Boot App', link: '/quickstart/getting-started-with-the-cycles-spring-boot-starter' },
            { text: 'Add to a Rust App', link: '/quickstart/getting-started-with-the-rust-client' },
            {
              text: 'MCP server',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/quickstart/getting-started-with-the-mcp-server' },
                { text: 'Add to Claude Desktop', link: '/quickstart/mcp-claude-desktop' },
                { text: 'Add to Claude Code', link: '/quickstart/mcp-claude-code' },
                { text: 'Add to Cursor', link: '/quickstart/mcp-cursor' },
                { text: 'Add to Windsurf', link: '/quickstart/mcp-windsurf' },
              ]
            },
            { text: 'Budget Limits with Spring AI', link: '/quickstart/how-to-add-hard-budget-limits-to-spring-ai-with-cycles' },
            { text: 'Choose a First Rollout', link: '/quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails' },
            { text: 'Architecture Overview', link: '/quickstart/architecture-overview-how-cycles-fits-together' },
            { text: 'Deploy the Full Stack', link: '/quickstart/deploying-the-full-cycles-stack' },
            { text: 'Self-Hosting the Server', link: '/quickstart/self-hosting-the-cycles-server' },
            { text: 'Deploy the Events Service', link: '/quickstart/deploying-the-events-service' },
            { text: 'Deploy the Admin Dashboard', link: '/quickstart/deploying-the-cycles-dashboard' },
            { text: 'Migrate from Custom Rate Limiter', link: '/how-to/migrating-from-custom-rate-limiter-to-cycles' },
          ]
        },
        {
          text: 'Topic Guides',
          collapsed: false,
          items: [
            { text: 'LLM Cost Control', link: '/guides/llm-cost-runtime-control' },
            { text: 'Risk & Blast Radius', link: '/guides/risk-and-blast-radius' },
            { text: 'Multi-Tenant Operations', link: '/guides/multi-tenant-operations' },
          ]
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Why Rate Limits Are Not Enough', link: '/concepts/why-rate-limits-are-not-enough-for-autonomous-systems' },
            { text: 'What Cycles Is Not', link: '/concepts/what-cycles-is-not-billing-rate-limiting-orchestration-and-other-category-confusion' },
            { text: 'Idempotency, Retries and Concurrency', link: '/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes' },
            { text: 'From Observability to Enforcement', link: '/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority' },
            { text: 'Coding Agents Need Runtime Authority', link: '/concepts/coding-agents-need-runtime-budget-authority' },
            { text: 'Exposure', link: '/concepts/exposure-why-rate-limits-leave-agents-unbounded' },
            { text: 'Action Authority', link: '/concepts/action-authority-controlling-what-agents-do' },
            { text: 'Authority vs Authorization', link: '/concepts/runtime-authority-vs-runtime-authorization' },
            { text: 'Why Agents Do Not Replace Cycles', link: '/concepts/why-coding-agents-do-not-replace-cycles' },
            {
              text: 'Comparisons',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/concepts/comparisons' },
                { text: 'How Cycles Compares', link: '/concepts/how-cycles-compares-to-rate-limiters-observability-provider-caps-in-app-counters-and-job-schedulers' },
                { text: 'vs Rate Limiting', link: '/concepts/cycles-vs-rate-limiting' },
                { text: 'vs LangSmith', link: '/concepts/cycles-vs-langsmith' },
                { text: 'vs Guardrails AI', link: '/concepts/cycles-vs-guardrails-ai' },
                { text: 'vs LiteLLM', link: '/concepts/cycles-vs-litellm' },
                { text: 'vs Helicone', link: '/concepts/cycles-vs-helicone' },
                { text: 'vs OpenRouter', link: '/concepts/cycles-vs-openrouter' },
                { text: 'vs Provider Caps', link: '/concepts/cycles-vs-provider-spending-caps' },
                { text: 'vs Token Counters', link: '/concepts/cycles-vs-custom-token-counters' },
              ]
            },
            { text: 'Webhooks and Events', link: '/concepts/webhooks-and-events' },
            { text: 'Glossary', link: '/glossary' },
          ]
        },
        {
          text: 'How-To Guides',
          collapsed: true,
          items: [
            { text: 'Adding Cycles to an Existing App', link: '/how-to/adding-cycles-to-an-existing-application' },
            { text: 'Choosing the Right Pattern', link: '/how-to/choosing-the-right-integration-pattern' },
            {
              text: 'Budget Patterns',
              collapsed: true,
              items: [
                { text: 'Choosing the Right Overage Policy', link: '/how-to/choosing-the-right-overage-policy' },
                { text: 'Multi-Tenant SaaS Guide', link: '/how-to/multi-tenant-saas-with-cycles' },
                { text: 'Budget Templates', link: '/how-to/budget-templates' },
                { text: 'Common Budget Patterns', link: '/how-to/common-budget-patterns' },
                { text: 'Multi-Agent Shared Budgets', link: '/how-to/multi-agent-shared-workspace-budget-patterns' },
                { text: 'Cost Estimation Cheat Sheet', link: '/how-to/cost-estimation-cheat-sheet' },
                { text: 'Budget Allocation and Management', link: '/how-to/budget-allocation-and-management-in-cycles' },
                { text: 'Tenant, Workflow, and Run Budgets', link: '/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles' },
                { text: 'Estimate Exposure Before Execution', link: '/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles' },
                { text: 'Assigning RISK_POINTS to Tools', link: '/how-to/assigning-risk-points-to-agent-tools' },
                { text: 'Degradation Paths', link: '/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer' },
                { text: 'Budget Control for LangChain Agents', link: '/how-to/how-to-add-budget-control-to-a-langchain-agent' },
                { text: 'Shadow Mode Rollout', link: '/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production' },
              ]
            },
            {
              text: 'Tenants and Configuration',
              collapsed: true,
              items: [
                { text: 'Tenants, Scopes, and Budgets', link: '/how-to/understanding-tenants-scopes-and-budgets-in-cycles' },
                { text: 'Tenant Management', link: '/how-to/tenant-creation-and-management-in-cycles' },
                { text: 'API Key Management', link: '/how-to/api-key-management-in-cycles' },
                { text: 'Custom Field Resolvers', link: '/how-to/custom-field-resolvers-in-cycles' },
                { text: 'Programmatic Client Usage', link: '/how-to/using-the-cycles-client-programmatically' },
              ]
            },
            {
              text: 'Error Handling',
              collapsed: true,
              items: [
                { text: 'Error Handling Patterns', link: '/how-to/error-handling-patterns-in-cycles-client-code' },
                { text: 'Error Handling in Python', link: '/how-to/error-handling-patterns-in-python' },
                { text: 'Error Handling in TypeScript', link: '/how-to/error-handling-patterns-in-typescript' },
                { text: 'Error Handling in Rust', link: '/how-to/error-handling-patterns-in-rust' },
                { text: 'Handling Streaming Responses', link: '/how-to/handling-streaming-responses-with-cycles' },
              ]
            },
            { text: 'Testing with Cycles', link: '/how-to/testing-with-cycles' },
          ]
        },
        {
          text: 'Integrations',
          collapsed: true,
          items: [
            { text: 'Ecosystem', link: '/how-to/ecosystem' },
            { text: 'Overview', link: '/how-to/integrations-overview' },
            {
              text: 'LLM Providers',
              collapsed: true,
              items: [
                { text: 'OpenAI (Python)', link: '/how-to/integrating-cycles-with-openai' },
                { text: 'OpenAI (TypeScript)', link: '/how-to/integrating-cycles-with-openai-typescript' },
                { text: 'Anthropic (Python)', link: '/how-to/integrating-cycles-with-anthropic' },
                { text: 'Anthropic (TypeScript)', link: '/how-to/integrating-cycles-with-anthropic-typescript' },
                { text: 'AWS Bedrock', link: '/how-to/integrating-cycles-with-aws-bedrock' },
                { text: 'Google Gemini', link: '/how-to/integrating-cycles-with-google-gemini' },
                { text: 'Groq', link: '/how-to/integrating-cycles-with-groq' },
                { text: 'Ollama / Local LLMs', link: '/how-to/integrating-cycles-with-ollama' },
              ]
            },
            {
              text: 'AI Frameworks',
              collapsed: true,
              items: [
                { text: 'LangChain.py', link: '/how-to/integrating-cycles-with-langchain' },
                { text: 'LangChain.js', link: '/how-to/integrating-cycles-with-langchain-js' },
                { text: 'LangGraph', link: '/how-to/integrating-cycles-with-langgraph' },
                { text: 'Vercel AI SDK', link: '/how-to/integrating-cycles-with-vercel-ai-sdk' },
                { text: 'Spring AI', link: '/how-to/integrating-cycles-with-spring-ai' },
                { text: 'LlamaIndex', link: '/how-to/integrating-cycles-with-llamaindex' },
                { text: 'CrewAI', link: '/how-to/integrating-cycles-with-crewai' },
                { text: 'Pydantic AI', link: '/how-to/integrating-cycles-with-pydantic-ai' },
                { text: 'AnyAgent', link: '/how-to/integrating-cycles-with-anyagent' },
                { text: 'AutoGen', link: '/how-to/integrating-cycles-with-autogen' },
              ]
            },
            {
              text: 'Agent Platforms',
              collapsed: true,
              items: [
                { text: 'MCP (Claude, Cursor, Windsurf)', link: '/how-to/integrating-cycles-with-mcp' },
                { text: 'MCP server over HTTP / SSE', link: '/how-to/running-the-mcp-server-over-http' },
                { text: 'OpenAI Agents', link: '/how-to/integrating-cycles-with-openai-agents' },
                { text: 'OpenClaw', link: '/how-to/integrating-cycles-with-openclaw' },
              ]
            },
            {
              text: 'Web Frameworks',
              collapsed: true,
              items: [
                { text: 'Next.js', link: '/how-to/integrating-cycles-with-nextjs' },
                { text: 'Express', link: '/how-to/integrating-cycles-with-express' },
                { text: 'Django', link: '/how-to/integrating-cycles-with-django' },
                { text: 'Flask', link: '/how-to/integrating-cycles-with-flask' },
                { text: 'FastAPI', link: '/how-to/integrating-cycles-with-fastapi' },
              ]
            },
            {
              text: 'Rust',
              collapsed: true,
              items: [
                { text: 'Rust Integration Guide', link: '/how-to/integrating-cycles-with-rust' },
                { text: 'Error Handling in Rust', link: '/how-to/error-handling-patterns-in-rust' },
              ]
            },
          ]
        },
        {
          text: 'Protocol Reference',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/protocol/' },
            { text: 'Implement the Cycles Protocol', link: '/protocol/implement' },
            { text: 'API Reference (Manual)', link: '/protocol/api-reference-for-the-cycles-protocol' },
            { text: 'API Reference (Interactive)', link: '/api/' },
            { text: 'Reserve / Commit Lifecycle', link: '/protocol/how-reserve-commit-works-in-cycles' },
            { text: 'Authentication and Tenancy', link: '/protocol/authentication-tenancy-and-api-keys-in-cycles' },
            { text: 'Scope Derivation', link: '/protocol/how-scope-derivation-works-in-cycles' },
            { text: 'Understanding Units', link: '/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points' },
            { text: 'Caps and Three-Way Decisions', link: '/protocol/caps-and-the-three-way-decision-model-in-cycles' },
            { text: 'Commit Overage Policies', link: '/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft' },
            { text: 'TTL, Grace Period, and Extend', link: '/protocol/reservation-ttl-grace-period-and-extend-in-cycles' },
            { text: 'Decide: Preflight Checks', link: '/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation' },
            { text: 'Dry Run and Shadow Mode', link: '/protocol/dry-run-shadow-mode-evaluation-in-cycles' },
            { text: 'Events and Direct Debit', link: '/protocol/how-events-work-in-cycles-direct-debit-without-reservation' },
            { text: 'Debt and Overdraft', link: '/protocol/debt-overdraft-and-the-over-limit-model-in-cycles' },
            { text: 'Querying Balances', link: '/protocol/querying-balances-in-cycles-understanding-budget-state' },
            { text: 'Reservation Recovery and Listing', link: '/protocol/reservation-recovery-and-listing-in-cycles' },
            { text: 'Metrics and Metadata', link: '/protocol/standard-metrics-and-metadata-in-cycles' },
            { text: 'Error Codes and Error Handling', link: '/protocol/error-codes-and-error-handling-in-cycles' },
            { text: 'Webhook Event Delivery Protocol', link: '/protocol/webhook-event-delivery-protocol' },
            { text: 'Event Payloads Reference', link: '/protocol/event-payloads-reference' },
            { text: 'Webhook Scope Filter Syntax', link: '/protocol/webhook-scope-filter-syntax' },
            { text: 'Correlation and Tracing', link: '/protocol/correlation-and-tracing-in-cycles' },
            { text: 'Tenant-Close Cascade Semantics', link: '/protocol/tenant-close-cascade-semantics' },
          ]
        },
        {
          text: 'Configuration Reference',
          collapsed: true,
          items: [
            { text: 'Python Client Configuration', link: '/configuration/python-client-configuration-reference' },
            { text: 'TypeScript Client Configuration', link: '/configuration/typescript-client-configuration-reference' },
            { text: 'Spring Client Configuration', link: '/configuration/client-configuration-reference-for-cycles-spring-boot-starter' },
            { text: 'Server Configuration', link: '/configuration/server-configuration-reference-for-cycles' },
            { text: 'SpEL Expression Reference', link: '/configuration/spel-expression-reference-for-cycles' },
          ]
        },
        {
          text: 'Incident Patterns',
          collapsed: true,
          items: [
            { text: 'Runaway Agents and Tool Loops', link: '/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent' },
            { text: 'Retry Storms', link: '/incidents/retry-storms-and-idempotency-failures' },
            { text: 'Concurrent Agent Overspend', link: '/incidents/concurrent-agent-overspend' },
            { text: 'Scope Misconfiguration', link: '/incidents/scope-misconfiguration-and-budget-leaks' },
          ]
        },
        {
          text: 'Operations',
          collapsed: true,
          items: [
            { text: 'Security', link: '/security' },
            { text: 'Production Operations', link: '/how-to/production-operations-guide' },
            { text: 'Admin API Guide', link: '/admin-api/guide' },
            { text: 'Client Performance Tuning', link: '/how-to/client-performance-tuning' },
            { text: 'Observability Setup', link: '/how-to/observability-setup' },
            { text: 'Monitoring and Alerting', link: '/how-to/monitoring-and-alerting' },
            { text: 'Prometheus Metrics Reference', link: '/how-to/prometheus-metrics-reference' },
            { text: 'Security Hardening', link: '/how-to/security-hardening' },
            { text: 'Managing Webhooks', link: '/how-to/managing-webhooks' },
            { text: 'Webhook Integrations', link: '/how-to/webhook-integrations' },
            { text: 'Using the Dashboard', link: '/how-to/using-the-cycles-dashboard' },
            { text: 'Bulk Actions for Tenants and Webhooks', link: '/how-to/using-bulk-actions-for-tenants-and-webhooks' },
            { text: 'Searching and Sorting Admin Lists', link: '/how-to/searching-and-sorting-admin-list-endpoints' },
            { text: 'Rolling Over Billing Periods (RESET_SPENT)', link: '/how-to/rolling-over-billing-periods-with-reset-spent' },
            { text: 'Force-Releasing Stuck Reservations', link: '/how-to/force-releasing-stuck-reservations-as-an-operator' },
          ]
        },
        {
          text: 'Tools',
          collapsed: true,
          items: [
            { text: 'All tools', link: '/calculators/' },
            { text: 'Cost Calculator', link: '/calculators/claude-vs-gpt-cost-comparison' },
            { text: 'Blast Radius Risk Calculator', link: '/calculators/ai-agent-blast-radius-risk' },
          ]
        },
        {
          text: 'Help',
          collapsed: false,
          items: [
            { text: 'Cycles Troubleshooting', link: '/how-to/troubleshooting-and-faq' },
            {
              text: 'LLM Provider Troubleshooting',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/troubleshoot/' },
                { text: 'OpenAI 429 Too Many Requests', link: '/troubleshoot/openai-rate-limit-429' },
                { text: 'Anthropic Rate Limit Errors', link: '/troubleshoot/anthropic-rate-limit-error' },
                { text: 'Debugging LLM Cost Spikes', link: '/troubleshoot/llm-cost-spike-debugging' },
              ]
            },
            { text: 'Changelog', link: '/changelog' },
            { text: 'Built with Cycles Badges', link: '/community/badges' },
          ]
        }
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/runcycles/docs' }
    ]
  },
  transformPageData(pageData) {
    if (pageData.params?.pageTitle) {
      pageData.title = pageData.params.pageTitle
    }

    // Prevent redundant "Cycles ... — Cycles" titles
    const rawTitle = pageData.frontmatter.title || pageData.title || ''
    if (rawTitle.includes('Cycles')) {
      pageData.titleTemplate = rawTitle
    }

    // noindex for auto-generated OpenAPI operation pages (thin content, dilutes crawl budget)
    if (pageData.relativePath.startsWith('admin-api/operations/') || pageData.relativePath.startsWith('api/operations/')) {
      pageData.frontmatter.head ??= []
      pageData.frontmatter.head.push(
        ['meta', { name: 'robots', content: 'noindex, nofollow' }],
      )
    }

    let canonicalUrl = `https://runcycles.io/${pageData.relativePath.replace(/\\/g, '/')}`
      .replace(/\/index\.md$/, '/')
      .replace(/\.md$/, '')

    // Calculator embed pages canonicalize to their standalone counterpart so
    // that any accidental indexing consolidates link equity at the shareable
    // URL rather than the iframe target.
    const embedMatch = canonicalUrl.match(/^(.*\/calculators\/[^/]+)-embed$/)
    if (embedMatch) {
      canonicalUrl = embedMatch[1] + '-standalone'
    }

    const defaultDescription = 'Stop runaway agent spend and risky actions before they execute. Open protocol, multi-language SDKs, Apache 2.0.'
    const pageTitle = pageData.frontmatter.title || pageData.title || 'Cycles'
    const pageDescription = pageData.frontmatter.description || defaultDescription

    const ogImage = resolveOgImage(pageData)
    const ogImageAlt = pageData.frontmatter.title || pageTitle

    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:title', content: pageTitle }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', content: ogImage }],
      ['meta', { property: 'og:image:alt', content: ogImageAlt }],
      ['meta', { name: 'twitter:title', content: pageTitle }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
      ['meta', { name: 'twitter:image', content: ogImage }],
      ['meta', { name: 'twitter:image:alt', content: ogImageAlt }],
    )

    if (pageData.frontmatter.blog) {
      /* Blog-specific: override og:type and add article metadata. og:image / twitter:image
         were already pushed above by the universal resolver. */
      pageData.frontmatter.head.push(
        ['meta', { property: 'og:type', content: 'article' }],
        ['meta', { property: 'article:published_time', content: pageData.frontmatter.date }],
        ['script', { type: 'application/ld+json' }, JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          "headline": pageData.frontmatter.title,
          "description": pageData.frontmatter.description,
          "datePublished": pageData.frontmatter.date,
          "image": ogImage,
          "author": {
            "@type": "Organization",
            "name": pageData.frontmatter.author || "Cycles Team"
          },
          "publisher": {
            "@type": "Organization",
            "name": "Cycles",
            "url": "https://runcycles.io"
          },
          "url": canonicalUrl
        })],
      )

      // Hide editLink and lastUpdated on blog posts
      pageData.frontmatter.editLink = false
      pageData.frontmatter.lastUpdated = false
    }

    // HowTo schema for how-to/* and troubleshoot/* pages
    const normalizedRelPath = pageData.relativePath.replace(/\\/g, '/')
    const isHowToPath =
      normalizedRelPath.startsWith('how-to/') ||
      normalizedRelPath.startsWith('troubleshoot/')
    if (isHowToPath && !normalizedRelPath.endsWith('/index.md')) {
      const h2s = extractH2Headings(pageData.relativePath)
      if (h2s.length >= 2) {
        pageData.frontmatter.head.push(
          ['script', { type: 'application/ld+json' }, JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            "name": pageTitle,
            "description": pageDescription,
            "url": canonicalUrl,
            "step": h2s.map((h, i) => ({
              "@type": "HowToStep",
              "position": i + 1,
              "name": h.title,
              "url": `${canonicalUrl}#${h.slug}`
            }))
          })],
        )
      }
    }

    // Article schema for /concepts/cycles-vs-* comparison pages
    if (normalizedRelPath.startsWith('concepts/cycles-vs-')) {
      pageData.frontmatter.head.push(
        ['script', { type: 'application/ld+json' }, JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": pageTitle,
          "description": pageDescription,
          "url": canonicalUrl,
          "articleSection": "Comparison",
          "author": {
            "@type": "Organization",
            "name": "Cycles"
          },
          "publisher": {
            "@type": "Organization",
            "name": "Cycles",
            "url": "https://runcycles.io",
            "logo": {
              "@type": "ImageObject",
              "url": "https://runcycles.io/runcycles-og.png"
            }
          }
        })],
      )
    }
  },
})
