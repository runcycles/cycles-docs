<script setup>
import { ref, onMounted } from 'vue'
import { createHighlighter } from 'shiki'
import { pythonPath, typescriptPath, springAiPath, mcpPath, langchainPath, openaiAgentsPath, vercelPath, openclawPath, anthropicPath } from './FrameworkIcons'

const activeTab = ref('python')
const highlighted = ref({})
const copied = ref(false)

function copyCode() {
  const code = snippets[activeTab.value]?.code
  if (!code || typeof navigator === 'undefined') return
  navigator.clipboard.writeText(code)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const tabs = [
  { key: 'python', label: 'Python', icon: pythonPath },
  { key: 'typescript', label: 'TypeScript', icon: typescriptPath },
  { key: 'java', label: 'Java / Spring', icon: springAiPath },
  { key: 'mcp', label: 'MCP', icon: mcpPath },
  { key: 'langchain', label: 'LangChain', icon: langchainPath },
  { key: 'openai-agents', label: 'OpenAI Agents', icon: openaiAgentsPath },
  { key: 'anthropic', label: 'Anthropic', icon: anthropicPath },
  { key: 'vercel', label: 'Vercel AI', icon: vercelPath },
  { key: 'openclaw', label: 'OpenClaw', icon: openclawPath },
]

const snippets = {
  python: {
    lang: 'python',
    code: `from runcycles import cycles

@cycles(estimate=5000, action_kind="llm.completion", action_name="openai:gpt-5")
def ask(prompt: str) -> str:
    return openai.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": prompt}]
    ).choices[0].message.content`,
  },

  typescript: {
    lang: 'typescript',
    code: `import { withCycles } from "runcycles";

const ask = withCycles(
  { estimate: 5000, actionKind: "llm.completion", actionName: "openai:gpt-5" },
  async (prompt: string) => {
    const res = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0].message.content;
  }
);`,
  },

  java: {
    lang: 'java',
    code: `import io.runcycles.client.java.spring.annotation.Cycles;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;

// GPT-5: 125 microcents/token in, 1000 out ($1.25 / $10 per 1M)
@Cycles(value = "#prompt.length() / 4 * 125 + #maxTokens * 1000",
        actionKind = "llm.completion",
        actionName = "gpt-5")
public String chat(String prompt, int maxTokens) {
    return chatClient.prompt(prompt)
        .options(OpenAiChatOptions.builder().maxCompletionTokens(maxTokens).build())
        .call()
        .content();
}`,
  },

  langchain: {
    lang: 'python',
    code: `from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from runcycles import CyclesClient, CyclesConfig, Subject
from budget_handler import CyclesBudgetHandler  # see docs

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", agent="my-agent"),
)

llm = ChatOpenAI(model="gpt-5", callbacks=[handler])
result = llm.invoke([HumanMessage(content="Hello!")])`,
  },

  'openai-agents': {
    lang: 'python',
    code: `from agents import Agent, Runner
from runcycles_openai_agents import CyclesRunHooks, cycles_budget_guardrail

guardrail = cycles_budget_guardrail(tenant="acme", estimate=5_000_000)
hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates={"send_email": 50, "search": 0},
)

agent = Agent(
    name="support-bot",
    instructions="You resolve support cases.",
    input_guardrails=[guardrail],
)
result = await Runner.run(agent, input="Help me!", hooks=hooks)`,
  },

  anthropic: {
    lang: 'python',
    code: `from anthropic import Anthropic
from runcycles import cycles

client = Anthropic()

@cycles(estimate=50000, action_kind="llm.completion", action_name="anthropic:claude-sonnet-5")
def ask_claude(prompt: str) -> str:
    return client.messages.create(
        model="claude-sonnet-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    ).content[0].text`,
  },

  vercel: {
    lang: 'typescript',
    code: `import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { reserveForStream } from "runcycles";

const handle = await reserveForStream({
  client, estimate: 2_000_000, unit: "USD_MICROCENTS",
  actionKind: "llm.completion", actionName: "gpt-5",
});

const result = streamText({
  model: openai("gpt-5"), messages,
  onFinish: async ({ usage }) =>
    handle.commit((usage.promptTokens ?? 0) * 125 + (usage.completionTokens ?? 0) * 1000),
});`,
  },

  mcp: {
    lang: 'jsonc',
    code: `// claude_desktop_config.json — zero code changes
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_BASE_URL": "http://localhost:7878",
        "CYCLES_API_KEY": "cyc_live_...",
        "CYCLES_TENANT": "acme-corp"
      }
    }
  }
}`,
  },

  openclaw: {
    lang: 'jsonc',
    code: `// openclaw.json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "modelBaseCosts": {
            "openai/gpt-5": 1000000,
            "anthropic/claude-sonnet-5": 300000
          }
        }
      }
    }
  }
}`,
  },
}

onMounted(async () => {
  const highlighter = await createHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: ['python', 'typescript', 'java', 'jsonc'],
  })

  const result = {}
  for (const [key, { code, lang }] of Object.entries(snippets)) {
    result[key] = highlighter.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
    })
  }
  highlighted.value = result
})
</script>

<template>
  <section class="home-code-snippet">
    <div class="inner">
    <h2 class="code-heading">Add runtime authority in a few lines</h2>
    <p class="code-caption"><code>@cycles</code> reserves budget before the action runs. No remaining cycles — no action.</p>
    <div class="code-container">
      <div class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <svg class="tab-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path :d="tab.icon" />
          </svg>
          {{ tab.label }}
        </button>
      </div>
      <div class="code-block">
        <button class="copy-btn" @click="copyCode" :aria-label="copied ? 'Copied' : 'Copy code'">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <div v-if="highlighted[activeTab]" v-html="highlighted[activeTab]" />
        <pre v-else><code>{{ snippets[activeTab].code }}</code></pre>
      </div>
    </div>
    </div>
  </section>
</template>

<style scoped>
.home-code-snippet {
  position: relative;
  padding: 0 24px 48px;
  text-align: center;
}

@media (min-width: 640px) {
  .home-code-snippet {
    padding: 0 48px 48px;
  }
}

@media (min-width: 960px) {
  .home-code-snippet {
    padding: 0 64px 48px;
  }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.code-heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
  letter-spacing: -0.02em;
  border-top: none;
  padding-top: 0;
}

.code-caption {
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin-bottom: 20px;
  line-height: 1.5;
}
  
.code-caption code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875em;
  color: var(--vp-code-color);
  background-color: var(--vp-code-bg);
  border-radius: 4px;
  padding: 2px 6px;
}
  
.code-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
}

.tab-bar {
  display: flex;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 0;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  font-family: var(--vp-font-family-base);
}

.tab-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.tab:hover {
  color: var(--vp-c-text-1);
}

.tab:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.tab.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.code-block {
  position: relative;
  background: var(--vp-code-block-bg);
  padding: 20px 24px;
  overflow-x: auto;
  min-height: 200px;
  overflow-y: auto;
}

.copy-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  z-index: 1;
  transition: color 0.2s, border-color 0.2s;
}

.copy-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.copy-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.code-block :deep(pre) {
  margin: 0;
  background: transparent !important;
}

.code-block :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre;
}

.code-block :deep(.shiki) {
  background: transparent !important;
}

.dark .code-block :deep(.shiki span) {
  color: var(--shiki-dark) !important;
}

@media (max-width: 640px) {
  .code-heading {
    font-size: 20px;
  }

  .tab {
    padding: 8px 12px;
    font-size: 12px;
  }

  .tab-icon {
    display: none;
  }

  .code-block {
    padding: 16px;
    min-height: auto;
    -webkit-overflow-scrolling: touch;
  }

  .code-block :deep(code) {
    font-size: 12px;
  }
}

@media (max-width: 400px) {
  .tab {
    padding: 6px 10px;
    font-size: 11px;
  }
}
</style>
