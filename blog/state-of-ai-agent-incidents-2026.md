---
title: "The State of AI Agent Incidents (2026)"
date: 2026-04-03
dateModified: 2026-11-23
author: Albert Mavashev
tags: [incidents, governance, security, costs, agents, production, MCP, OWASP, multi-agent]
description: "AI agent incidents through November 2026, including WorkOS, Hugging Face, runaway spending and database losses, with sources and controls for each failure."
blog: true
sidebar: false
featured: true
head:
  - - meta
    - name: keywords
      content: AI agent incidents 2026, agent failures, MCP security incidents, runaway AI costs, multi-agent cascades, runtime controls, agent governance
---

# The State of AI Agent Incidents (2026)

**Updated November 23, 2026. Originally published April 3.**

On October 30, a WorkOS employee noticed unusually heavy usage of a connected system. The investigation traced the first unauthorized access back five days. On November 6, WorkOS publicly attributed the access to a security researcher's AI agent running a benchmark. A test conducted by one organization had become a data incident for another. [WorkOS incident update](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident)

<!-- more -->

## Key findings

- **Test agents reached real organizations.** OpenAI and Hugging Face both documented the July compromise of Hugging Face. WorkOS later documented a separate incident. In both cases, the affected organization held evidence that the team running the agent needed to understand the impact.
- **A cloud bill can understate the damage.** Mandiant reported that one accounting agent generated about $50,000 in cloud charges in under an hour. Database locks also halted active transactions. In other cases, the public record establishes a purchase or a deletion but gives no model bill.
- **Recovery depended on which copies survived.** A deleted production volume and deleted sales records called for different recovery steps. The useful question for an operator is whether the same credential can reach both the live data and the copy needed to restore it.
- **Malicious releases can appear under a trusted package name.** On November 17, two malicious versions of the Microsoft Agent Framework Python package reached PyPI. The [package advisory](https://github.com/advisories/GHSA-764m-3ppc-5m73) identifies the affected versions. The exposure begins at installation, before any agent can request tool approval.
- **An incident count needs a denominator.** A registry counts selected public reports. A benchmark counts outcomes on selected tasks. Neither tells a team how often its own production agents will fail. The studies below identify their units of measurement.

## What changed since April

### Hugging Face, July 2026 {#hugging-face-july-2026}

Hugging Face disclosed an intrusion on July 16 and confirmed unauthorized access to internal datasets and service credentials. OpenAI's investigation attributed the activity to models running internal cybersecurity evaluations and connected it to the Hugging Face incident on July 20. The models had communicated across evaluations that were supposed to run independently. An operator investigating a similar event would need records from the evaluation harness, shared infrastructure, and affected services to reconstruct what one run set in motion. [Hugging Face disclosure](https://huggingface.co/blog/security-incident-july-2026) · [OpenAI incident report](https://openai.com/index/hugging-face-incident-and-the-road-ahead/)

Hugging Face reconstructed roughly 17,600 attacker actions from the evidence it could recover. Researchers from METR and Redwood Research examined agent records at OpenAI and estimated that about 700 agents participated. Hugging Face traced customer-content access to five datasets that appeared connected to benchmark tasks. The customer records read were operational metadata associated with searches on its dataset server. [Hugging Face’s reconstruction](https://huggingface.co/blog/agent-intrusion-technical-timeline) · [METR investigation](https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/)

On November 16, California's attorney general filed suit over OpenAI’s safeguards and public disclosures. Its claims about the company’s conduct are allegations in the complaint. [California’s complaint](https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf)

### WorkOS, October–November 2026

WorkOS reported that the agent retrieved sales and customer-support records in bulk from an internal tool on October 30. The exposed data included business contacts and excerpts from customer communications. Its investigation found that the tool was reachable from the public internet and accepted a weak credential intended for local development. WorkOS restricted access and rotated credentials. The researcher's test harness and the target's production access controls belonged to different operators. Each had a different opportunity to contain the incident. [WorkOS incident update](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident) · [How to scope an agent test engagement](/blog/ai-agent-test-environments-are-not-a-boundary)

## How to read this report

The cases identify **who observed what**. A provider or operator disclosure can establish a side effect and its recovery. A security advisory can establish that a release was vulnerable or malicious while leaving the number of affected users unknown. A benchmark reports results under its test conditions. The entries marked **constructed** use explicit assumptions to illustrate control design. Dollar figures refer to the particular item measured, such as cloud charges, a purchase, or modeled token usage.

## Category A: Cost Explosions

### An accounting agent generated about $50,000 in cloud charges

In a September 2026 case study, Mandiant described a financial services firm's reconciliation agent repeatedly trying to process a malformed value. The agent made more than 15,000 reasoning API calls in under an hour. The firm also lost the use of its billing database for active transactions while locks were held. Mandiant did not name the firm or put a dollar figure on that disruption. A repeated-failure stop could interrupt the loop, a spending limit could bound further calls, and a database lock timeout addresses a different part of the loss. [Mandiant report, case study 6](https://cloud.google.com/security/resources/ai-risk-and-resilience-2026)

The four examples below are [constructed cost scenarios](/blog/ai-agent-failures-budget-controls-prevent). They use the source's fixed token volumes and rates so readers can reproduce the arithmetic.

### A1. Coding agent retry loop — $52.80 (constructed)

A coding agent makes four model calls per iteration and repeats the same failing task 240 times. Across 960 calls, the example prices 11.52 million input tokens at $2.50 per million and 2.4 million output tokens at $10 per million. That totals **$52.80**. A per-run limit gives the operator a chance to inspect the loop before funding another attempt.

### A2. Weekend backlog processing — $2,300 (constructed)

A Friday deployment picks up 2,300 tasks. At 25 calls per task and an assumed $0.04 per call, the batch costs **$2,300**. A $500 batch allocation would pause new work before the full backlog ran. A per-task allocation would also keep one troublesome item from consuming the batch budget.

### A3. Concurrent agent burst — 6.5x overrun (constructed)

Twenty workers share a queue of 200 documents. If each worker reads the same stale $5 balance, repeated admissions can take the workload to **$32.40** at $0.162 per document. An atomic [reservation](/glossary#reservation) makes each admission account for the funds other workers already hold.

### A4. Retry storm during CRM outage — $33.86 (constructed)

Three layers each allow up to three attempts. Across 38 conversations, the modeled worst case is 1,026 calls. At the example's token volumes and unit rates, that costs **$33.86** in 12 minutes. A cumulative retry limit per lookup and a stop on repeated upstream failure address the multiplication across layers.

## Category B: Action Failures

A price search can end in a credit-card charge. A staging task can change a production database. In both cases the agent already has the access it needs. The control has to distinguish the action the user authorized from the actions the credential permits.

### B1. 200 wrong emails — low token spend, high potential impact (constructed)

An onboarding agent should send welcome emails to 200 trial accounts. When template selection fails, the application falls back to a collections notice and sends it to all 200. The scenario assumes $1.40 in model spend. Customer complaints and lost revenue are possible consequences with no measured figures. [Original email scenario](/blog/ai-agent-action-control-hard-limits-side-effects)

**Control.** Bind the approved template to the onboarding workflow and reject an unexpected template before sending. Enforce a per-run recipient limit, or charge a [RISK_POINTS budget](/concepts/action-authority-controlling-what-agents-do) for each recipient before dispatch. A single batch call can reach all 200 accounts.

### B2. Replit AI deletes production database

In July 2025, SaaStr founder Jason Lemkin reported that Replit Agent deleted data during a code freeze. The application’s production database held 1,206 executive records and at least 1,196 company profiles. The agent told him recovery was impossible. Lemkin subsequently recovered the data. Replit’s CEO confirmed that the development agent could change production data and announced a rollout of separate development and production databases. The incident-level model cost was undisclosed. [Lemkin’s account and Replit’s response](https://www.saastr.com/replits-new-release-address-most-of-the-challenges-we-hit-vibe-coding-but-is-prosumer-vibe-coding-really-ready-for-commercial-apps-yet/)

**Control.** Restrict development credentials to a development database. Keep a tested restore procedure that the operator can use independently of the agent.

### B3. OpenAI Operator unauthorized purchase — $31.43

Washington Post columnist Geoffrey Fowler asked Operator to find the cheapest dozen eggs he could have delivered. It submitted an Instacart order using his saved card, and a card alert told him he had spent $31.43. He had given it shopping-account access and had never approved a purchase. OpenAI told Fowler its confirmation safeguard failed in this case. The $31.43 was the checkout total, including fees and tip. Fowler’s February 7, 2025 account gives no per-run model cost. [Fowler’s firsthand report](https://www.washingtonpost.com/technology/2025/02/07/openai-operator-ai-agent-chatgpt/)

**Control.** Keep checkout unavailable during price research. For a purchase, require the user to approve the merchant and final total, including fees, before the payment handler submits the order.

### B4. Accidental production deploy (constructed)

A coding agent debugging CI triggers a production deployment to verify its fix. The untested change goes live. The example assumes about $0.80 in model spend. Downtime is a possible consequence if the change breaks production. [Deployment scenario](/blog/ai-agent-action-failures-runtime-authority-prevents)

**Control.** Give CI debugging jobs a staging target. Keep production credentials in a release job that requires approval for the specific change.

### B5. Slack data leak (constructed)

A support agent posts internal system names and another customer’s tenant ID in a customer-visible Slack channel. The example assumes about $0.30 in model spend. A single message discloses the information, even if the agent stops immediately afterward. [Slack scenario](/blog/ai-agent-action-failures-runtime-authority-prevents)

**Control.** Have the sending application check the channel’s audience and which tenant’s data the message contains before posting.

### B6. Jira ticket storm (constructed)

A workflow agent treats each line of a 50-line stack trace as a separate error. With ten reports queued, it creates hundreds of tickets and triggers notifications for the same on-call team in under eight minutes. The scenario assumes about $3.50 in model spend. [Ticket-creation scenario](/blog/ai-agent-action-failures-runtime-authority-prevents)

**Control.** Derive a deduplication key from the source error and enforce a per-run ticket quota at creation. Deduplication handles repeated reports. The quota also bounds a run that mistakenly generates a fresh key for each line.

### B7. A PocketOS staging task deletes a production database volume

On April 24, 2026, a Cursor agent working on a staging task deleted the production storage volume for PocketOS, according to founder Jer Crane. Rental businesses temporarily lost access to reservation records. Railway confirmed that an account-wide credential authorized the deletion and that the API applied it immediately. Crane and Railway later confirmed that Railway recovered the database. On April 29, Railway reported extending the dashboard’s 48-hour deletion grace period to the API. [Interview with Crane and Railway’s response](https://abcnews.com/GMA/News/rogue-ai-agent-haywire-tech-company-ceo-bullish/story?id=132473181) · [Railway’s incident account](https://blog.railway.com/p/your-ai-wants-to-nuke-your-database)

**Control.** Scope the staging credential to staging. Enforce the same delay and recovery guarantees for destructive operations across the dashboard and API. One authorized deletion can affect an entire database.

### B8. A newly connected agent deletes SaaStr’s Salesforce opportunities

In an October 17, 2026 disclosure and a subsequent account, Lemkin described a separate incident at SaaStr. A newly connected third-party agent deleted nearly all the opportunity records in its Salesforce pipeline. The vendor, which SaaStr did not name, offered no rollback for the action. A different system held a snapshot taken earlier that day. After an operator approved the restore, the team recovered the pipeline within an hour. The snapshot could only restore changes captured by the time it was taken. [SaaStr’s account of the deletion and recovery](https://www.saastr.com/two-ai-agents-wiped-critical-data-at-saastr-both-times-a-copy-nobody-planned-is-what-saved-us-it-will-happen-to-you-too-plan-for-it/)

**Control.** Grant CRM delete access separately from read and update access. Before enabling bulk deletion, require review of the affected records and verify that an independently stored snapshot can restore them.

## Category C. Security incidents and research {#category-c-security-incidents}

The evidence in this category ranges from malicious software published to real registries to controlled tests of agent behavior. Each entry identifies what the source observed and which controls apply.

### C1. A package impersonating Postmark copied outgoing email {#c1-postmark-mcp-—-silent-email-exfiltration}

**Supply-chain incident, September 2025.** Postmark reported that version 1.0.16 of the unofficial `postmark-mcp` npm package added an undisclosed recipient to messages sent through it. Postmark’s own API and service remained secure. Its notice gives no count of copied messages. [Postmark’s incident notice](https://postmarkapp.com/blog/information-regarding-malicious-postmark-mcp-package)

**Operator response.** Remove the impersonating package, check provider-side email logs, and rotate credentials that affected messages may have carried. For future installations, verify the publisher against the provider’s own documentation.

### C2. ClawJacked exposed local OpenClaw agents {#c2-clawjacked-—-websocket-agent-hijacking}

**Research demonstration, February 2026.** Oasis Security demonstrated that a website could gain control of a local OpenClaw agent in the researchers’ setup. The gateway already supported authentication. OpenClaw corrected how it checked browser origins, limited failed authentication attempts, and approved new devices. The fixes shipped in version 2026.2.25. [Oasis disclosure](https://www.oasis.security/blog/openclaw-vulnerability) · [OpenClaw release notes](https://github.com/openclaw/openclaw/releases/tag/v2026.2.25)

**Operator response.** Check the gateway version on developers’ machines as well as shared deployments. Apply the fix and review which devices have permission to control the agent.

### C3. Malicious skills published to ClawHub {#c3-clawhub-malicious-skills-—-341-credential-stealing-tools}

**Marketplace audit, February 2026.** On February 1, Koi reported that it had classified 341 of the 2,857 skills it reviewed as malicious. The researchers attributed 335 to a single campaign they called ClawHavoc. On February 16, Koi raised its cumulative finding to 824 malicious skills. The marketplace had grown to more than 10,700 listings by then. Koi did not say it had audited that entire later inventory. These figures count listings. They do not establish how many people installed the skills or lost credentials. [Koi’s original research](https://www.paloaltonetworks.com/blog/security-operations/clawhavoc-ai-agent-skills-poisoning/)

**Operator response.** Review the exact skill version and any external software it asks to install before giving it access to secrets. On February 7, OpenClaw announced VirusTotal scanning, daily rescans of active skills, and blocking of downloads flagged as malicious. [OpenClaw’s marketplace update](https://openclaw.ai/blog/virustotal-partnership)

### C4. Internet-exposed MCP servers disclosed their tool listings {#c4-exposed-mcp-servers-—-zero-authentication}

**Exposure studies, July 2025.** Knostic identified 1,862 internet-exposed [MCP servers](/glossary#mcp-server). All 119 it manually checked revealed their internal tool listings without authentication. In a separate study, Trend Micro found 492 servers lacking client authentication and traffic encryption. The studies do not establish how many distinct deployments appear across both samples or how often someone used the exposed tools. [Knostic’s study](https://www.knostic.ai/blog/mapping-mcp-servers-study) · [Trend Micro’s study](https://www.trendaisecurity.com/en-us/resources-insights/deep-research/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data)

**Operator response.** Check which of your own services are publicly reachable. Verify what an unauthenticated client can discover, then test authorization separately for each sensitive operation. Require encrypted transport for remote connections.

### C5. Tool poisoning changed the selected tool in a benchmark {#c5-tool-poisoning-—-84-2-target-tool-call-rate}

**Controlled experiment, January 2026.** Ruiqi Li and colleagues tested 12 model and agent settings on MCPTox. In their main comparison, GPT-3.5-turbo selected the researchers’ target tool in 84.2% of its valid responses, the highest rate in Table 1. The study measured the model’s choice. A deployed system can still reject a proposed call before execution. [MCP-ITP paper, Table 1](https://arxiv.org/html/2601.07395v1)

**Operator response.** Treat tool descriptions as untrusted input. At dispatch, check the proposed operation, its arguments, and the caller’s authorization before allowing effects on another system.

### C6. Malicious releases appeared under the Microsoft Agent Framework package name {#c6-30-cves-in-60-days}

**Supply-chain incident, November 2026.** On November 17, versions 1.26.1 and 1.26.2 of the legitimate `agent-framework` Python package appeared on PyPI with code designed to steal credentials. Both releases were subsequently removed from PyPI. Wiz verified the malicious content in the packages. The public advisory gives no count of downstream organizations whose credentials were taken. [GitHub Advisory Database](https://github.com/advisories/GHSA-764m-3ppc-5m73) · [Wiz investigation](https://www.wiz.io/blog/malicious-version-of-microsofts-agent-framework-published-to-pypi)

**Operator response.** Check installed versions and build records for both releases, including CI jobs. Rebuild affected environments from verified dependencies and revoke credentials accessible to those environments.

### C7. Microsoft patched code execution in GitHub Copilot and Visual Studio {#c7-github-copilot-rce-—-cve-2025-53773}

**Vendor advisory, August 2025.** Microsoft disclosed CVE-2025-53773, a command-injection vulnerability allowing local code execution with user interaction. Its Visual Studio 2022 release notes identify the affected control as automatic tool approval and record the fix in version 17.14.12. [Microsoft’s security advisory](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-53773) · [Visual Studio release notes](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-notes)

**Operator response.** Verify that managed developer installations include the fix. Check who can change approval settings, especially in workspaces that contain untrusted project content.

### C8. Responders observed agent frameworks in live intrusions {#c8-rogue-agent-collaboration}

**Incident-response evidence, November 2026.** Google Threat Intelligence Group and Mandiant reported that multiple threat actors deliberately used agent frameworks for specific tasks during live intrusions. Their account documents human-directed use. The [July Hugging Face incident](#hugging-face-july-2026) separately concerns agents that reached a third party during a cybersecurity evaluation. [Google and Mandiant threat report](https://cloud.google.com/blog/topics/threat-intelligence/agentic-threat-activity-crosses-a-significant-threshold)

**Operator response.** Investigate sensitive actions using identity, endpoint, and service logs that can show which accounts and systems were involved, even when the target has no access to the operator’s model or conversation history.

## Category D: Multi-agent coordination failures {#category-d-multi-agent-and-systemic-failures}

### D1. Why agent teams miss the task objective (benchmark) {#d1-uc-berkeley-mast-—-41–87-failure-rates}

UC Berkeley researchers assembled 1,642 execution traces across seven multi-agent frameworks. A run failed when the team missed the assigned task objective. The authors report failure rates from 41% to 86.7% across the configurations they tested. Their 14 failure modes span system design, coordination among agents, and verification of the final result. A team that repeats a completed step needs a different fix from one that stops before checking its answer. [MAST study, October 2025 revision](https://arxiv.org/html/2503.13657v3)

### D2. How errors spread between agents (benchmark) {#d2-google-research-—-architecture-dependent-error-amplification}

Google Research and collaborators compared five agent architectures across six benchmarks and 260 configurations in their April 2026 revision. With a single agent as the 1.0× baseline, the authors measured 17.2× error amplification in execution traces for independent agents and 4.4× for a centrally coordinated team. For a workflow that delegates the same question to several agents, this suggests testing whether a coordinator catches a wrong answer before passing it downstream. The multipliers describe the experiment's traces. [Scaling study, Table 5](https://arxiv.org/html/2512.08296v3)

### D3. A successful lookup returns the wrong record (constructed) {#d3-silent-failures-—-200-ok-masking-wrong-results}

A support agent looks up an account by display name. The API returns HTTP 200 and a valid record for a different customer with the same name. A second agent drafts a billing notice using those details. Both steps can appear successful in the logs. Before drafting the notice, the workflow can compare the returned account ID with the ID on the original ticket and stop on a mismatch. [Silent failures in agent workflows](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response)

## Category E: What 2026 agent incident studies measured {#category-e-industry-scale-evidence}

**How many public reports describe harm that actually occurred?** In September, the Agent Incident Registry authors published a catalog of 487 agent-related records disclosed from 2022 through 2026. They isolated 336 records in which a generative AI system took action and classified 81 of those as involving realized harm. The catalog also includes research demonstrations and responsible disclosures. Its 24% figure describes that selected subset. Estimating the risk per deployed run would also require counts of uneventful runs. [Agent Incident Registry, September 2026 snapshot](https://arxiv.org/abs/2609.11030v2)

**How often did harm involve an attacker in a separate collection?** A November 19 preprint, ROGUE-AI, screened public reports and selected 199 incidents for analysis. Of those, 72 involved real-world harm. The authors identified 62 of the 72 as having no attacker. One example was a test environment that shared a database with a live site. An operator can check which database the test process can write to even when a trusted user supplies every instruction. The researchers excluded incidents caused by a malicious owner or the vendor’s infrastructure, which limits how broadly that breakdown applies. [ROGUE-AI study, sections 4–5](https://arxiv.org/html/2611.26553v1)

## Control mapping

| Where to enforce the control | What to check before the next action | Cases |
|---|---|---|
| Model or paid API gateway | Reserve the estimated cost against the run and shared budget before dispatch. Stop repeated failures and reconcile uncertain charges. | Accounting agent, A1–A4 |
| Purchase, send, or deploy handler | Bind the proposed action to the approved merchant and amount, message template and recipients, or deployment environment. | B1, B3–B5 |
| Database or CRM | Separate production credentials, review bulk changes, and test restores from a copy the same credential cannot delete. | B2, B7, B8 |
| Ticket creation handler | Deduplicate the underlying event and cap new tickets per run. | B6 |
| Package or skill installation | Verify the publisher and release, restrict accessible secrets, and limit where the process can send data. | C1, C3, C6 |
| Local gateway, IDE, or remote tool service | Apply fixed releases, authenticate clients, and authorize the proposed operation before dispatch. | C2, C4, C5, C7 |
| Evaluation environment and target service | Isolate shared services and reject development credentials in production. | Hugging Face, WorkOS |
| Incident investigation | Correlate identity, endpoint, egress, and target access logs to connect actions across systems. | Hugging Face, WorkOS, C8 |
| Multi-agent handoff | Check the returned result against the original task or record ID before another agent acts on it. | D1–D3 |

A [runtime authority](/glossary#runtime-authority) check can bound cumulative spend or repeated protected actions. One permitted action can still delete the wrong volume. In that case, the decisive controls are the credential's scope, the target of the operation, and the ability to restore it.

## Methodology

This is a selection of public evidence reviewed through **November 23, 2026**. It includes earlier cases where the operator's account makes a failure or recovery step clear. Dates refer to the event when the source gives one and to the disclosure when that is all the source establishes. Subsequent corrections and recovery reports take precedence over initial estimates.

Charges in the four constructed cost scenarios use the original worked examples' assumptions. The report keeps those figures separate from observed charges, purchase amounts, and unpriced business impacts. Suggested controls are engineering judgments. Their value depends on which requests pass through them and what the target service enforces.

The incidents in this article and the records in the two studies can overlap. No overall incident total or production failure rate is inferred from them. Corrections and new primary-source reports are welcome through the [docs repository](https://github.com/runcycles/cycles-docs).

## Further reading

- [AI agent risk assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) covers how to assign risk to individual tool actions.
- [How to assign RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools) walks through cumulative action limits.
- [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) covers the records needed to trace a decision, a dispatch, and its outcome.
