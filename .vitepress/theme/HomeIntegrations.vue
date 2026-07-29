<script setup>
import {
  pythonPath, typescriptPath, springAiPath, mcpPath, langchainPath,
  openaiAgentsPath, vercelPath, openclawPath, anthropicPath, mozillaPath,
  genericIntegrationPath,
} from './FrameworkIcons'

const integrations = [
  { name: 'OpenAI', icon: openaiAgentsPath, link: '/how-to/integrating-cycles-with-openai' },
  { name: 'Anthropic', icon: anthropicPath, link: '/how-to/integrating-cycles-with-anthropic' },
  { name: 'Spring AI', icon: springAiPath, link: '/how-to/integrating-cycles-with-spring-ai' },
  { name: 'LangChain', icon: langchainPath, link: '/how-to/integrating-cycles-with-langchain' },
  { name: 'LangGraph', icon: langchainPath, link: '/how-to/integrating-cycles-with-langgraph' },
  { name: 'Vercel AI', icon: vercelPath, link: '/how-to/integrating-cycles-with-vercel-ai-sdk' },
  { name: 'MCP', icon: mcpPath, link: '/how-to/integrating-cycles-with-mcp' },
  { name: 'OpenAI Agents', icon: openaiAgentsPath, link: '/how-to/integrating-cycles-with-openai-agents' },
  { name: 'OpenClaw', icon: openclawPath, link: '/how-to/integrating-cycles-with-openclaw' },
  { name: 'AWS Bedrock', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-aws-bedrock' },
  { name: 'Google Gemini', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-google-gemini' },
  { name: 'LlamaIndex', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-llamaindex' },
  { name: 'CrewAI', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-crewai' },
  { name: 'Pydantic AI', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-pydantic-ai' },
  { name: 'AutoGen', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-autogen' },
  { name: 'AnyAgent', icon: mozillaPath, link: '/how-to/integrating-cycles-with-anyagent' },
  { name: 'Groq', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-groq' },
  { name: 'Ollama', icon: genericIntegrationPath, link: '/how-to/integrating-cycles-with-ollama' },
  { name: 'Next.js', icon: typescriptPath, link: '/how-to/integrating-cycles-with-nextjs' },
  { name: 'Express', icon: typescriptPath, link: '/how-to/integrating-cycles-with-express' },
  { name: 'Django', icon: pythonPath, link: '/how-to/integrating-cycles-with-django' },
  { name: 'Flask', icon: pythonPath, link: '/how-to/integrating-cycles-with-flask' },
  { name: 'FastAPI', icon: pythonPath, link: '/how-to/integrating-cycles-with-fastapi' },
  { name: 'LangChain.js', icon: typescriptPath, link: '/how-to/integrating-cycles-with-langchain-js' },
]
</script>

<template>
  <section class="home-integrations">
    <div class="inner">
      <h2 class="integrations-heading">Works with your stack</h2>
      <p class="integrations-caption">Budget, risk, and action authority across your AI stack.</p>
      <div class="grid">
        <a
          v-for="item in integrations"
          :key="item.name"
          :href="item.link"
          class="grid-item"
        >
          <svg class="grid-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path :d="item.icon" />
          </svg>
          <span class="grid-label">{{ item.name }}</span>
        </a>
      </div>
      <p class="integrations-cta">
        <a href="/how-to/integrations-overview">View all integrations &rarr;</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.home-integrations {
  padding: 0 24px 48px;
  text-align: center;
}

@media (min-width: 640px) {
  .home-integrations { padding: 0 48px 48px; }
}

@media (min-width: 960px) {
  .home-integrations { padding: 0 64px 48px; }
}

.inner {
  max-width: 1152px;
  margin: 0 auto;
}

.integrations-heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
  letter-spacing: -0.02em;
  border-top: none;
  padding-top: 0;
}

.integrations-caption {
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin-bottom: 24px;
  line-height: 1.5;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-bottom: 20px;
}

.grid-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}

.grid-item:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}

.grid-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.integrations-cta {
  font-size: 14px;
}

.integrations-cta a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  font-weight: 500;
}

.integrations-cta a:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .integrations-heading { font-size: 20px; }
  .grid { gap: 8px; }
  .grid-item { padding: 6px 10px; font-size: 12px; }
  .grid-icon { width: 14px; height: 14px; }
}
</style>
