/**
 * Build-time data loader that pre-highlights the homepage code snippets.
 *
 * Highlighting at build time keeps shiki (engine + four grammars + two
 * themes) out of the client bundle — HomeCodeSnippet.vue previously
 * created a highlighter in the browser on every homepage visit just to
 * render these nine static snippets, and showed an unhighlighted <pre>
 * until it loaded.
 *
 * The dual-theme options must stay in sync with the dark-mode CSS in
 * HomeCodeSnippet.vue (`.dark ... span { color: var(--shiki-dark) }`).
 */
import { createHighlighter } from 'shiki'

export interface HomeSnippet {
  lang: string
  code: string
  html: string
}

export declare const data: Record<string, HomeSnippet>

const snippets: Record<string, { lang: string; code: string }> = {
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

export default {
  async load(): Promise<Record<string, HomeSnippet>> {
    const highlighter = await createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['python', 'typescript', 'java', 'jsonc'],
    })

    const out: Record<string, HomeSnippet> = {}
    for (const [key, { code, lang }] of Object.entries(snippets)) {
      out[key] = {
        lang,
        code,
        html: highlighter.codeToHtml(code, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: 'light',
        }),
      }
    }

    highlighter.dispose()
    return out
  },
}
