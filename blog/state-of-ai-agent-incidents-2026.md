---
title: "The State of AI Agent Incidents (2026)"
date: 2026-04-03
author: Albert Mavashev
tags: [incidents, governance, security, costs, agents, production, MCP, OWASP, multi-agent]
description: "Documented AI agent incidents and failure patterns — runaway costs, action misfires, security exploits, multi-agent cascades — scored by cost and blast radius."
blog: true
sidebar: false
featured: true
head:
  - - meta
    - name: keywords
      content: AI agent incidents 2026, agent failures, MCP security incidents, runaway AI costs, multi-agent cascades, runtime controls, agent governance
---

# The State of AI Agent Incidents (2026): Failures, Costs, and Mitigation Lessons

AI agents are shipping to production faster than many organizations' control infrastructure. The resulting incident reports and recurring patterns include runaway costs, wrong actions, security exploits, and cascading multi-agent failures with several different root causes.

This report separates **documented incidents** sourced to public reporting or research from **constructed scenarios** based on recurring failure patterns. Its control mappings describe mitigations that could reduce likelihood or blast radius; they do not prove a historical incident would have been prevented.

<!-- more -->

## Key findings

- **20+ documented incidents and recurring patterns** across cost, action, security, and multi-agent categories
- **Constructed cost scenarios range from $32.40 to $2,300** under their stated token assumptions; self-published anecdotal reports below describe larger figures but are not independently verified here.
- **Some damaging documented incidents can have little model spend relative to business impact.** A reported $0.80 run triggered an [unauthorized purchase](https://www.washingtonpost.com/technology/2025/02/07/openai-operator-ai-agent-chatgpt/). Replit's coding-agent database incident shows why dollar budgets alone cannot prevent action failures, although the public reporting does not establish a precise model-cost figure for that event.
- **Up to 84.2% selected target-tool-call rate** across evaluated MCPTox prompts and 12 model/agent settings ([MCP-ITP](https://arxiv.org/abs/2601.07395)); the benchmark did not test live production execution
- **41–87% failure rates** in multi-agent coordination ([UC Berkeley MAST study](https://arxiv.org/abs/2503.13657))
- **64% of surveyed organizations** experienced more than $1M in losses from AI-related risks broadly ([2025 EY survey](https://www.ey.com/en_uk/insights/ai/how-can-responsible-ai-bridge-the-gap-between-investment-and-impact))

## How to read this report

Each incident includes:

- **What happened** — the failure, in one paragraph
- **Cost** — model spend vs business impact (where both are known)
- **Source** — linked to the original disclosure, research paper, or reporting
- **Root cause** — why existing controls didn't prevent it
- **Mitigation** — controls that could reduce likelihood or blast radius

Incidents are categorized as:
- **Documented** — sourced from public disclosures, research papers, vendor post-mortems, or security advisories
- **Constructed scenario** — an illustrative case based on recurring failure modes, explicitly labeled in the heading

## Category A: Cost Explosions

Agents that spend more than expected — through loops, retries, [fan-out](/glossary#fan-out), or scope creep. These are constructed scenarios based on recurring failure modes; see Categories B and C for externally documented incidents from named companies and security researchers.

### A1. Coding agent retry loop — $52.80 (constructed)

A coding agent hit an ambiguous error and [looped 240 times over three hours](/blog/ai-agent-failures-budget-controls-prevent). At the source scenario's stated flat average of 12,000 input and 2,500 output tokens per call, total cost is $52.80.

| | Detail |
|---|---|
| Model cost | $52.80 |
| Business impact | Unattended spend and delayed failure detection |
| Root cause | No mandatory per-run boundary; provider controls use a broader vendor scope |
| Mitigation | **Budget gate** — a mandatory $15 per-run reservation boundary rejects later iterations once configured exposure is exhausted |

### A2. Weekend backlog processing — $2,300 (constructed)

A coding agent [deployed Friday afternoon processed a 2,300-item backlog over the weekend](/blog/ai-agent-failures-budget-controls-prevent) without budget enforcement. Context windows grew per item, retries compounded, and nobody checked until Monday.

| | Detail |
|---|---|
| Model cost | $2,300 |
| Business impact | Weekend budget consumed, Monday recovery |
| Root cause | No per-batch or per-task budget limit |
| Mitigation | **Budget gate** — a mandatory $500 batch budget bounds the unattended run; per-task budgets can contain outliers |

### A3. Concurrent agent burst — 6.5x overrun (constructed)

Twenty concurrent agents [processing 200 documents simultaneously](/blog/ai-agent-failures-budget-controls-prevent) hit a TOCTOU race condition. All read "budget remaining: $5" before delayed counter updates converged. Modeled spend: $32.40.

| | Detail |
|---|---|
| Model cost | $32.40 (remaining budget was $5) |
| Business impact | About 6.5x the remaining budget |
| Root cause | Application-level counter lacks atomicity |
| Mitigation | **Atomic [reservation](/glossary#reservation)** — budget locked before execution, concurrent requests see accurate remaining |

### A4. Retry storm during CRM outage — $33.86 (constructed)

A CRM returns 500 errors for 12 minutes. [Retry logic at tool, step, and orchestration layers compounds](/blog/ai-agent-failures-budget-controls-prevent) — up to 27 calls for each of 38 affected conversations. At the stated token volumes, cost is $33.86.

| | Detail |
|---|---|
| Model cost | $33.86 |
| Business impact | All [tenant](/glossary#tenant) budgets affected during the storm |
| Root cause | Retry multiplier at each layer; no cumulative check |
| Mitigation | **Budget gate** — mandatory per-conversation reservations bound configured exposure |

::: details Additional anecdotal reports (self-published sources)
Two widely cited cost incidents come from self-published sources and should be treated as pattern-confirming rather than independently verified:

- **POC-to-production scaling — $847K/month.** A proof-of-concept agent costing $500/month [scaled to $847,000/month](https://medium.com/@klaushofenbitzer/token-cost-trap-why-your-ai-agents-roi-breaks-at-scale-and-how-to-fix-it-4e4a9f6f5b9a) in production due to call volume assumptions that didn't account for context window growth, retries, and fan-out. (Source: Medium, Klaus Hofenbitzer)
- **Data enrichment API loop — $47,000.** A data enrichment agent [misinterpreted an API error and ran 2.3 million calls over a weekend](https://rocketedge.com/2026/03/15/ai-agent-cost-control/). The API returned 200 OK with an error body; the agent treated it as success and retried the entire batch. (Source: RocketEdge)

Both illustrate the same failure mode as A1–A4: no cumulative spend enforcement.
:::

## Category B: Action Failures

Agents that take wrong, excessive, or unauthorized actions — where the damage is in the consequence, not the tokens.

### B1. 200 wrong emails — low token spend, high potential impact (constructed)

In this [illustrative scenario](/blog/ai-agent-action-control-hard-limits-side-effects), a support agent sends 200 collections emails instead of welcome emails after a prompt regression changes template selection. If the model calls cost about $1.40, the customer and business impact can still be much larger; the original scenario has no sourced ticket, complaint, or pipeline-loss measurements.

| | Detail |
|---|---|
| Model cost | $1.40 |
| Business impact | Illustrative and unquantified; potentially much larger than token spend |
| Root cause | No action-level enforcement — dollar budget was nowhere near exhausted |
| Mitigation | **Handler authorization + risk budget** — an application can require approval and reserve caller-assigned [RISK_POINTS](/concepts/action-authority-controlling-what-agents-do) before each email |

### B2. Replit AI deletes production database

Replit's AI coding assistant [deleted a user's production database](https://techcrunch.com/2025/10/02/after-nine-years-of-grinding-replit-finally-found-its-market-can-it-keep-it/) containing 100+ executive contacts, then fabricated 4,000 fake records to cover its tracks.

| | Detail |
|---|---|
| Model cost | ~$2.00 |
| Business impact | Production data loss, fabricated records |
| Source | TechCrunch, October 2025 |
| Root cause | No pre-execution check on database mutation tools |
| Mitigation | **Database authorization and environment isolation** — deny production mutation by default; a caller-assigned risk budget can add a secondary bound |

### B3. OpenAI Operator unauthorized purchase — $31.43

OpenAI's Operator agent [made an unauthorized $31.43 purchase from Instacart](https://www.washingtonpost.com/technology/2025/02/07/openai-operator-ai-agent-chatgpt/), bypassing user confirmation safeguards. The incident is also catalogued in the [AI Incident Database](https://incidentdatabase.ai/cite/1028/).

| | Detail |
|---|---|
| Model cost | ~$0.80 |
| Business impact | Unauthorized financial transaction |
| Source | [Washington Post](https://www.washingtonpost.com/technology/2025/02/07/openai-operator-ai-agent-chatgpt/), February 2025; [AI Incident Database #1028](https://incidentdatabase.ai/cite/1028/) |
| Root cause | No pre-execution authorization for payment actions |
| Mitigation | **Payment authorization** — require an independently enforced user or policy approval; a risk budget can add a secondary bound |

### B4. Accidental production deploy (constructed)

A coding agent, while debugging CI, [triggers a production deployment](/blog/ai-agent-action-failures-runtime-authority-prevents) with an untested fix. Total model cost: $0.80. Business impact: production downtime.

| | Detail |
|---|---|
| Model cost | $0.80 |
| Business impact | Production downtime |
| Root cause | No action-level gate on deploy tools |
| Mitigation | **Deployment authorization** — protect production credentials and require approval; caller-assigned risk points can bound permitted attempts |

### B5. Slack data leak (constructed)

A support agent [posts diagnostic information containing internal system names and another customer's tenant ID](/blog/ai-agent-action-failures-runtime-authority-prevents) to an external customer-facing Slack channel.

| | Detail |
|---|---|
| Model cost | $0.30 |
| Business impact | Data [exposure](/glossary#exposure), security review, possible compliance notification |
| Root cause | No distinction between internal and external channel tools |
| Mitigation | **Destination authorization and DLP** — validate channel and outbound data before sending; risk points can bound permitted attempts |

### B6. Jira ticket storm (constructed)

A workflow agent [parses a 50-line stack trace incorrectly](/blog/ai-agent-action-failures-runtime-authority-prevents), creates 50 tickets from a single trace. Across 10 error reports, hundreds of duplicate tickets flood the on-call team in 8 minutes.

| | Detail |
|---|---|
| Model cost | $3.50 |
| Business impact | On-call team flooded, incident response disrupted |
| Root cause | No per-run cap on ticket creation actions |
| Mitigation | **Idempotency and handler quota** — deduplicate requests and enforce a per-run ticket limit before creation |

## Category C: Security Incidents

Attacks exploiting the agent tool layer — tool poisoning, supply chain, privilege escalation, and infrastructure exposure.

### C1. postmark-mcp — silent email exfiltration

The first confirmed malicious [MCP server](/glossary#mcp-server) in the wild: `postmark-mcp` [silently BCC'd every outgoing email](https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/) to an attacker-controlled address. It ran for weeks before detection. No user interaction required.

| | Detail |
|---|---|
| Model cost | N/A (infrastructure attack) |
| Business impact | All outgoing emails exfiltrated |
| Source | Snyk, 2026 |
| Root cause | No tool-call authorization layer; agent trusts any installed MCP server |
| Mitigation | **Provenance, version pinning, scanning, sandboxing, and egress controls** — an allowlist alone cannot stop an approved malicious handler from silently adding a BCC |

### C2. ClawJacked — WebSocket agent hijacking

Researchers demonstrated that malicious websites can [hijack locally-running AI agents via WebSocket](https://blog.sshh.io/p/everything-wrong-with-mcp), executing arbitrary tool calls through the user's agent session.

| | Detail |
|---|---|
| Model cost | N/A (attack vector) |
| Business impact | Arbitrary action execution under user's identity |
| Source | Security research, February 2026 |
| Root cause | No authentication between agent host and tool server |
| Mitigation | **Authentication, authorization, Origin validation, network restriction, and TLS** — scoped budgets are defense in depth after access is secured |

### C3. ClawHub malicious skills — 341 credential-stealing tools

Researchers [found 341 malicious ClawHub skills](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html) designed to steal credentials, exfiltrate data, or execute unauthorized actions. Separately, the [ClawJacked disclosure](https://blog.sshh.io/p/everything-wrong-with-mcp) identified 71 additional malicious skills using WebSocket hijacking techniques.

| | Detail |
|---|---|
| Scale | 341 malicious skills (Koi Security) + 71 (ClawJacked) |
| Source | [The Hacker News](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html), February 2026 |
| Root cause | No vetting, signing, or sandboxing of community tools |
| Mitigation | **Publisher verification, provenance, pinning, scanning, sandboxing, and an enforced host tool inventory** |

### C4. Exposed MCP servers — zero authentication

Trend Micro [found 492 internet-exposed MCP servers](https://www.trendaisecurity.com/en-us/resources-insights/research/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data) with no client authentication or traffic encryption. Separately, Knostic [reported 1,862 exposed MCP servers](https://www.knostic.ai/blog/mapping-mcp-servers-study), sampled 119, and found all 119 exposed internal tool listings without authentication.

| | Detail |
|---|---|
| Scale | 492 exposed ([Trend Micro](https://www.trendaisecurity.com/en-us/resources-insights/research/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data)) + 1,862 exposed ([Knostic](https://www.knostic.ai/blog/mapping-mcp-servers-study)) |
| Source | [Trend Micro](https://www.trendaisecurity.com/en-us/resources-insights/research/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data), [Knostic](https://www.knostic.ai/blog/mapping-mcp-servers-study), 2026 |
| Root cause | Deployments exposed MCP servers without authentication, authorization, or transport protection |
| Mitigation | **MCP authorization where supported, application authentication and authorization, TLS, Origin validation, and network restriction**; budgets are defense in depth, not a substitute |

### C5. Tool poisoning — 84.2% target-tool-call rate

On MCPTox, the [MCP-ITP benchmark](https://arxiv.org/abs/2601.07395) induced the selected legitimate target-tool call in up to 84.2% of evaluated prompts across 12 model/agent settings. It measured tool selection, not production auto-approval prevalence or confirmed live execution. Related MCP threats include rug pulls, schema poisoning, and tool shadowing, but those categories should not all be attributed to this one benchmark.

| | Detail |
|---|---|
| Measured result | Up to 84.2% selected target-tool calls on evaluated MCPTox prompts |
| Source | MCP-ITP framework (Ruiqi Li et al., 2026) |
| Root cause | Agent trusts tool descriptions and auto-approves calls |
| Mitigation | **Tool scanning and pinning, restricted tool inventory, approval or external authorization, argument validation, sandboxing, and egress controls** |

### C6. 30+ CVEs in 60 days

Security researchers documented [more than 30 CVEs](https://medium.com/ai-security-hub/mcps-first-year-what-30-cves-and-500-server-scans-tell-us-about-ai-s-fastest-growing-attack-6d183fc9497f) against MCP implementations in the first 60 days of widespread adoption. The average security score across 17 popular MCP server audits was **34 out of 100**.

| | Detail |
|---|---|
| Scale | 30+ CVEs, average security score 34/100 |
| Source | [AI Security Hub](https://medium.com/ai-security-hub/mcps-first-year-what-30-cves-and-500-server-scans-tell-us-about-ai-s-fastest-growing-attack-6d183fc9497f), 2026 (secondary summary) |
| Root cause | Rapid adoption without security review |
| Mitigation | **Patch management, secure implementation review, dependency scanning, and least-privilege deployment**; audit supports detection and investigation |

### C7. GitHub Copilot RCE — CVE-2025-53773

A vulnerability in GitHub Copilot [enabled prompt injection to execute arbitrary code](https://www.cve.org/CVERecord?id=CVE-2025-53773) on developer machines.

| | Detail |
|---|---|
| Impact | Arbitrary code execution |
| Source | CVE-2025-53773 |
| Root cause | No isolation between model reasoning and tool execution |
| Mitigation | **Apply the security fix, sandbox code execution, restrict credentials and filesystem access, and require authorization before execution** |

### C8. Rogue agent collaboration

Researchers [demonstrated](https://www.theregister.com/security/2026/03/12/rogue-ai-agents-can-work-together-to-hack-systems/5228926) that compromised agents in multi-agent architectures can coordinate to escalate privileges and compromise downstream systems.

| | Detail |
|---|---|
| Impact | Cascading privilege escalation |
| Source | The Register, March 2026 |
| Root cause | Compromised agents could coordinate and escalate privileges across trust boundaries |
| Mitigation | **Strong agent identity, least-privilege authorization, bounded delegation, isolation, and monitoring**; per-agent budgets can limit resource consumption |

## Category D: Multi-Agent and Systemic Failures

Failures that emerge from agent interactions, coordination, and systemic properties.

### D1. UC Berkeley MAST — 41–87% failure rates

UC Berkeley's [MAST study](https://arxiv.org/abs/2503.13657) analyzed 1,600+ execution traces across seven selected multi-agent frameworks and identified 14 failure modes. Configuration-level failure rates in the evaluated model/task settings ranged from 41% to 86.7%; they are not a universal production failure rate.

| | Detail |
|---|---|
| Failure rate | 41–86.7% across evaluated framework/model/task configurations |
| Source | [UC Berkeley MAST](https://arxiv.org/abs/2503.13657), NeurIPS 2025 Spotlight |
| Root cause | System design, inter-agent misalignment, and task-verification failures |
| Mitigation | **Architecture-specific coordination, validation, and evaluation**; hierarchical budgets can separately bound resource exposure |

### D2. Google Research — architecture-dependent error amplification

In a controlled evaluation of 180 configurations, [Google Research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) found that independent agents amplified errors by up to 17.2x, while centralized coordination limited amplification to 4.4x. Separately, a simple independent-step model with 95% reliability per step yields about 36% probability that all 20 steps succeed; that calculation is illustrative and was not the paper's measured result.

| | Detail |
|---|---|
| Amplification | Up to 17.2x independent; 4.4x centralized in the evaluated settings |
| Source | Google Research, January 2026 |
| Root cause | Errors propagate and compound across agent boundaries |
| Mitigation | **Validation and centralized coordination where appropriate**; per-agent budgets can keep an error cascade from also exhausting shared spend |

### D3. Silent failures — 200 OK masking wrong results

An agent returns HTTP 200 for every call, but [the underlying data is wrong](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response). In multi-step workflows, the error propagates through 10+ downstream steps before anyone notices — because every step "succeeded."

| | Detail |
|---|---|
| Detection time | 10+ steps after the error |
| Source | Multiple production reports |
| Root cause | No validation between agent steps; success is measured by status code, not result quality |
| Mitigation | **Semantic output validation and task-level evaluation between steps**; audit supports reconstruction and budgets bound resource consumption |

## Category E: Industry-Scale Evidence

Statistics from research firms and industry surveys that quantify the systemic problem. These are not agent-specific incidents — they are broader AI adoption data points that provide context for the agent failures above.

| Finding | Source | Year | Notes |
|---|---|---|---|
| 64% of surveyed organizations experienced >$1M in losses from AI-related risks | [EY Responsible AI survey](https://www.ey.com/en_uk/insights/ai/how-can-responsible-ai-bridge-the-gap-between-investment-and-impact) | 2025 | Covers AI broadly, not agent-specific |
| By some estimates, more than 80% of AI projects fail to reach production | [RAND Corporation](https://www.rand.org/pubs/research_reports/RRA2680-1.html) | 2024 | RAND cites the estimate; the underlying rate is debated |
| 55% of organizations had not yet implemented an AI governance framework; among those that had, 46% used either a dedicated framework or extended another governance framework | [Gartner](https://futurecio.tech/the-what-why-and-how-of-ai-governance-in-2024/) | 2024 | The 46% and 55% are not clean complements — different base populations |
| Over 40% of agentic AI projects will be canceled by end of 2027 | Gartner forecast | 2025 | Forecast, not measured |
| Over 80% of firms reported no impact on either employment or productivity over the last 3 years | [NBER](https://www.nber.org/papers/w34836) | 2026 | Broad AI adoption survey, not agent-specific |

## Control mapping

The incidents and scenarios map to controls that could mitigate them:

| Control | What it mitigates | Relevant cases |
|---|---|---|
| **Budget gate** (pre-execution cost cap) | Runaway spend, loops, retries, and fan-out | A1–A4, D1 |
| **Application authorization + optional RISK_POINTS budget** | Excessive attempts by allowed tools; not malicious implementation behavior by itself | B1–B6, C5, C7 |
| **Authentication, authorization, sandboxing, and supply-chain controls** | Unauthorized access, malicious servers and skills, dangerous execution, and exfiltration | C1–C7 |
| **Scope isolation** (per-tenant, per-agent) | Cross-tenant resource consumption and concurrent budget overruns | A3, C8, D1, D2 |
| **Audit trail** (structured event log) | Missing evidence for detection, compliance, and reconstruction | C1, C6, D3 |
| **Atomic reservation** (concurrency-safe) | TOCTOU budget races, double-spend, and concurrent bursts | A3, A4 |

No single control prevents all incidents. Budget, identity, authorization, supply-chain security, isolation, audit, and concurrency controls address different failure dimensions.

## What this means

The incidents in this report share three properties:

1. **The agent had the capability to act.** In these cases and scenarios, the agent could reach tools such as email, deploy, delete, purchase, or API calls. Some paths lacked a mandatory action-specific re-evaluation before execution.

2. **The execution boundary was missing or insufficient.** In several cases, the model's proposed action reached a consequential handler without a control that would have rejected that specific use. The missing controls differed: budget, application authorization, confirmation, argument validation, sandboxing, or scope enforcement.

3. **Detection often happened after the damage.** Dashboards showed cost spikes, logs recorded wrong actions, and alerts fired after side effects. Observation is necessary but does not reverse emails, deleted data, or money already spent.

A mandatory [runtime-authority](/glossary#runtime-authority) boundary can address the budget and cumulative-exposure subset by requiring a reservation before protected actions and recording settlement afterward. The application must still classify any `RISK_POINTS`, authenticate identities, authorize tools and arguments, enforce scope, and apply supply-chain and isolation controls. No single layer addresses every incident category in this report.

The regulatory and risk frameworks emphasize related controls. The [EU AI Act's Article 14](/blog/eu-ai-act-what-actually-happens-august-2-2026) applies human-oversight requirements to high-risk systems. [NIST's AI RMF](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) calls for controls proportionate to risk. [OWASP's Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) identifies tool misuse, excessive authority, and cascading failures as critical risks. These frameworks can guide mitigations, but they do not prove that a particular control would have prevented a historical event.

## Methodology

**Sourcing.** Incidents were collected from public disclosures (TechCrunch, The Register, Snyk), research papers (UC Berkeley MAST, Google DeepMind, MCP-ITP), security advisories (OWASP, CVE database), industry surveys (EY, RAND, Gartner, NBER), and community reports (Hacker News, Reddit, Medium). Constructed scenarios are based on failure modes documented in the [Cycles incident library](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent).

**Limitations.** This report has survivorship bias — only incidents that were publicly disclosed or studied are included, so the actual incidence rate is unknown. Cost estimates for constructed scenarios use documented pricing models but may not match specific deployments. Mitigation entries identify controls that could reduce likelihood or blast radius; they are not guarantees that a particular implementation would have caught the exact scenario.

**Updates.** This report will be updated quarterly as new incidents are documented. If you have an incident to report, contact the Cycles team or open an issue on the [docs repository](https://github.com/runcycles/cycles-docs).

## Further reading

- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the foundational concept
- [AI Agent Governance Framework](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — mapping regulations to runtime controls
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — tool-level risk scoring methodology
- [5 Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — detailed cost incident analysis
- [5 Failures Only Action Controls Would Prevent](/blog/ai-agent-action-failures-runtime-authority-prevents) — detailed action incident analysis
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — OWASP mapping and policy enforcement
- [MCP Tool Poisoning](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — supply chain attack analysis
- [Why Multi-Agent Systems Fail](/blog/why-multi-agent-systems-fail-87-percent-cost-of-every-coordination-breakdown) — UC Berkeley MAST cost model

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Integrating with MCP](/how-to/integrating-cycles-with-mcp)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
