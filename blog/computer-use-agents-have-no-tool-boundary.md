---
title: "Computer-Use Agents Have No Tool Boundary"
date: 2026-05-19
author: Albert Mavashev
tags:
  - action-authority
  - action-control
  - computer-use
  - browser-agents
  - agents
  - governance
  - runtime-authority
  - security
  - RISK_POINTS
description: "OpenAI's CUA, Anthropic Computer Use, Browser-Use collapse the tool surface to click and type. Risk has to move from tool name to target, intent, and context."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "computer-use agents, browser-use agent, Claude Computer Use, OpenAI CUA, ChatGPT agent mode, browser agent governance, screen-control agent risk, click as action, action authority, RISK_POINTS, runtime authority"
---

# Computer-Use Agents Have No Tool Boundary

A team is running a pixel-based computer-use agent against an internal admin console to migrate ten thousand legacy customer records. The agent navigates by screenshot, clicks the row, clicks the "Edit" button, types the new value, clicks "Save," moves on. By the eighth hundred record, the admin console rolls out an A/B test that swaps the position of the "Save" and "Delete Customer" buttons. The next click lands on the new button position. The button label has moved with it, but the agent's last screenshot was taken nine seconds earlier — the model saw "Save" at those coordinates. The next 200 records are deleted before anyone notices.

The agent did not violate its instructions. It did not exceed its budget. It clicked exactly where the workflow said to click. The instruction was *click "Save"*; the model resolved that to *click at (840, 612)*; the resolution was correct nine seconds ago and wrong now. There is no destructive API call to gate, no risky tool name to deny — the only tool the agent has is `click` and the only argument is a pair of coordinates.

The recent extensions of [action authority](/glossary#action-authority) to [memory writes](/blog/agent-memory-writes-are-actions-too) and [merge buttons](/blog/when-coding-agents-press-merge) each found that an existing model of "agent action" needed widening. Computer-use agents — OpenAI's CUA (the model behind Operator and a member of the OpenAI computer-use lineage that now ships under ChatGPT agent), Anthropic's Claude Computer Use, and the open-source Browser-Use library — push that widening further. When the agent's entire state-changing surface is "click" and "type", the unit of enforcement cannot be the tool name anymore. It has to be what the click is *for*, where it lands, and what it changes.

<!-- more -->

## The Tool Surface Collapsed to Two Primitives

A traditional agent has a tool list. Each entry is a structured function: `send_email(to, subject, body)`, `create_jira_ticket(project, title)`, `deploy(env, sha)`. The agent governance question — should this tool call be allowed? — has a tractable shape because the tool name carries semantic information.

Computer-use agents do not have that. The model picks up the screen state via screenshots and acts through the same primitives a human uses:

| Agent | Primitives exposed | Where it runs |
|---|---|---|
| OpenAI CUA (powers [ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)) | screenshot, mouse click/scroll, keyboard input, in a virtual browser | OpenAI-hosted sandbox |
| Anthropic [Claude Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) | screenshot, `left_click` at coordinates, `type` text, scroll, key, and related desktop primitives | Customer-controlled sandbox; reference implementation ships as a Linux Docker container |
| [Browser-Use](https://github.com/browser-use/browser-use) | DOM-aware click, type, navigate; exposes an indexed clickable-element vocabulary to the model | Customer-controlled browser, self-hosted or cloud |

Operator was sunset in 2025 in favor of the [ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/) mode that took over its capabilities; the CUA model continues. Anthropic's [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) launched as an API capability in October 2024 and has since been progressively integrated into Anthropic's own Claude products. Browser-Use is among the most widely adopted open-source frameworks in this space and reports strong scores on the WebVoyager benchmark.

The three differ in important ways — Browser-Use operates on a structured DOM, the CUA-driven and Computer Use agents operate primarily on pixels — but the governance shape converges. The agent reasons about a screen and emits screen-shaped actions. The function-call layer that traditional action authority frameworks assumed is collapsed to a near-uniform `click` / `type` / `scroll` surface, with little tool-name semantics to gate on.

The closest sibling pattern in the corpus is the merge button discussed in [When Coding Agents Press Merge](/blog/when-coding-agents-press-merge): a single tool call (`gh pr merge`) whose blast radius depends on what the agent's session has accumulated. Computer-use takes that one step further. Essentially every state-changing call is a `click` or a `type`; the blast radius depends entirely on what is on the screen and what the click does; and the agent's session accumulates work one click at a time.

## Why Tool-Name Risk Classification Breaks Down

The [tier model in AI Agent Action Control](/blog/ai-agent-action-control-hard-limits-side-effects) and the [RISK_POINTS schedule in AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) both rely on a load-bearing assumption: that a tool's *name* tells you most of what you need to know about its blast radius. `send_email` is Tier 3 because it sends email. `deploy` is Tier 4 because it deploys. Assigning [RISK_POINTS](/glossary#risk-points) to tool names is the canonical move described in [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools).

For computer-use, the state-changing tool name is `click` — and that is essentially the whole list. The schedule collapses:

| Tool name | Risk points | Useful? |
|---|---:|---|
| `click` | ? | Useless — every action is this |
| `type` | ? | Useless — every keystroke is this |
| `screenshot` | 1 | OK, but rarely the source of damage |
| `scroll` | 1 | OK, navigation |
| `navigate` | varies | The URL matters, not the tool |

A schedule that scores `click` at any fixed value either over-budgets harmless clicks (every "scroll to load more" is a destructive-budget event) or under-budgets destructive ones (a click that posts a refund draws from the same row as a click that closes a modal). The tool-name layer has lost the information that the schedule needs.

The same argument applies on the typing side. `type "hello world"` into a notes field is different from `type "rm -rf /"` into a terminal. The string content, not the tool, carries the risk.

What the schedule needs is not the tool name. It is some combination of:

- **The target** — what element is being clicked, what field is being typed into
- **The intent** — what the action is meant to accomplish, derived from context
- **The site / context** — what application, what environment, what authority the session holds against it

Risk classification has to move from tool to **(target, intent, context)**. That is a different feature vector, and the existing schedule rows do not encode it.

## The New Unit of Enforcement: (target, intent, context)

For an enforcement layer to do useful work on a click, it needs the same information a careful human reviewer would have. At minimum:

| Feature | What it carries | Example |
|---|---|---|
| URL pattern | Application, page, optional resource id | `admin.example.com/customers/42/edit` |
| Site authority | Production / staging / sandbox, [tenant](/glossary#tenant) context | Production tenant `acme` |
| DOM target | Element role, label, ARIA, nearby text (for DOM-aware agents) | `button[aria-label="Delete customer"]` |
| Coordinate region (for pixel agents) | The pixel area + a screenshot crop | Region (820–880, 600–620) with bytes |
| Action verb | The agent's stated intent at this step | "Save the updated address" |
| Modifier inputs | What was typed before the click, what flag is set | Just typed `1000` into "refund amount" |
| Session history | What the agent has already done in this session | 800 prior `Edit → Save` cycles |

A [runtime authority](/glossary#runtime-authority) decision for a single click can use any subset of these. The simpler the agent stack, the simpler the feature vector. Browser-Use, which produces DOM-aware actions, can hand the gate a labeled target. A pixel-only CUA agent has to fall back on URL pattern, intent text, and coordinate region.

The decision shape is unchanged from every other action class: `ALLOW`, `ALLOW_WITH_CAPS`, `DENY`, with a `reason_code` on deny. What changes is what the rule body inspects.

A rule that says *"never click an element whose ARIA label contains 'delete' on a URL matching `admin.*/customers/.*/edit`, in a production tenant, without an `ALLOW_WITH_CAPS` carrying `requires_human_approval: true`"* is exactly the kind of rule a screen-acting agent needs. It is also the kind of rule the existing tool-name schedule cannot express, because there is no `delete_customer` tool to scope.

## A Target-Intent Risk Schedule

A starting schedule for a browser-based agent looks closer to a CSS-selector matrix than a tool list. Illustrative values; relative weighting matters more than absolute numbers.

| Pattern | Site context | Risk points | Notes |
|---|---|---:|---|
| Read-only navigation (`navigate`, `scroll`, `screenshot`) | Any | 1 | Reversibility-free |
| Click on element labeled `Save` / `Submit` | Form on customer-facing form | 5 | Single record change, contained |
| Click on element labeled `Save` / `Submit` | Admin console, single-row update | 15 | Affects one tenant record |
| Click on `Confirm` in a modal that follows a destructive verb | Any | 25 | The modal text matters; mis-clicks here are the canonical browser-agent incident |
| Click on `Delete` / `Remove` (anywhere in the label) | Any | 30 | Reversibility uncertain at click time |
| Click on `Delete` / `Remove` | Admin console, with a row selected | 50 | Row identity is in the URL or recent state |
| Click on `Confirm` after a `Delete` modal | Admin console | 50 | Promotes the destructive verb |
| Type into a payment-amount field | Any payment surface | 30 | The string matters |
| Type a shell command into a terminal-shaped element | Any | 50 | `type "rm -rf"` is the classic incident |
| Submit a form whose origin URL is unfamiliar | Any | 40 | Phishing / clickjacking surface |
| Click on a URL that leaves the original tenant | Cross-domain navigation | 40 | Cross-tenant [exposure](/glossary#exposure) |

The values here are recognizably parallel to the [outbound action schedule](/blog/ai-agent-action-control-hard-limits-side-effects), but the rows are conditioned on (target, intent, context) rather than on a tool name. The agent's *intent* enters the rule both directly (the text of the next step) and indirectly (what was typed just before, what URL is in the address bar, what selector matched).

For pixel agents that cannot reliably extract the DOM target, the schedule degrades. The rules can still match on URL pattern, screenshot crop similarity, the agent's stated next-step text, and recent history — but the false-positive and false-negative rates rise compared to a DOM-aware setup. That is itself a useful input to the budget: a pixel-only agent should typically have a lower per-session promotion-authority cap than a DOM-aware one operating on the same site.

## Reserve-Commit at the Click Layer

The [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) applies to clicks the same way it applies to tool calls and merge buttons. The shape:

1. Before the agent issues the click (or `type`), it submits a proposal — the proposed target, the intent text, the URL pattern, the session identity, and any optional features the agent harness supports (DOM crop, screenshot crop).
2. The runtime evaluates the rule body and reserves RISK_POINTS sized by tier.
3. The runtime returns `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY`. Caps for click actions can include:
   - `requires_human_approval: true` for any click that matches a destructive label pattern on a production URL
   - `requires_fresh_screenshot: true` — the agent must take a new screenshot and re-classify before issuing the click, blocking the A/B-shift scenario in the opener
   - `max_clicks_remaining` per session for a given site context
   - `cross_tenant_navigation: deny` for any click that would change the tenant context of the session
4. The agent harness honors the decision before the keyboard or mouse event leaves the process.
5. The [reservation](/glossary#reservation) is committed after the click is observed to have taken effect, or released if the click did not register.

The `requires_fresh_screenshot` cap is the screen-specific equivalent of the per-session-cumulative-authority caps used in the [merge post](/blog/when-coding-agents-press-merge): for some action classes, the agent's most recent observation is *itself* the load-bearing input, and a runtime check can require that observation to be fresh. This closes the opener scenario directly. The agent saw "Save" at (840, 612) nine seconds ago; if the click is gated by `requires_fresh_screenshot: true`, the agent has to take a new screenshot, re-classify the target, and re-propose. The A/B button-swap is caught at the gate, not at the click.

## Why Existing Controls Don't Cover Computer-Use

Several layers in the typical computer-use agent stack touch the click surface. None of them, in their default configuration, acts as a runtime authority over (target, intent, context).

| Layer | What it does | What it does not do |
|---|---|---|
| CUA "User takeover" mode | Pauses for the user on login forms and CAPTCHAs | Anchored on a narrow catalogue; does not pause on arbitrary destructive admin actions |
| Claude Computer Use prompt-injection classifier | Steers the model to ask for confirmation on cookie banners, financial transactions, ToS, and similar | Triggered by an injection-detection heuristic; does not cover the long tail of domain-specific destructive labels |
| Browser-Use DOM filtering | Restructures messy DOM into LLM-friendly form | Improves the model's success rate; does not enforce policy on what the model can do |
| Sandbox isolation | The agent runs against a sandbox / VM | The sandbox can still contain real production credentials and authority |
| Per-call risk classifier (Claude Code Auto mode style) | Risk-scores each tool call | The "tool call" is `click` — at this layer, every call is the same |
| Read-only mode on the underlying app | The app rejects mutations | Many useful agent tasks need mutations; the cliff is between mutation kinds |
| Browser-level extensions (CSP, ad-blockers) | Block known categories | Generic, not agent-session-aware |

OpenAI's CUA-based agents pause for "User takeover" on login flows and CAPTCHAs because those are the categories where the user is supposed to handle credentials directly. That is a reasonable narrow safety boundary; it is not a substitute for a general runtime authority decision on every click that affects state.

Anthropic's Computer Use documentation has two adjacent layers worth distinguishing. First, developer guidance: Anthropic recommends asking for human confirmation on a specific catalogue of sensitive actions — cookie banners, financial transactions, agreeing to terms of service — implemented in the agent harness, not in the model. Second, a prompt-injection classifier that flags suspicious screenshots and steers the model toward confirmation when it triggers. Both are useful; neither binds the click to a per-session authority budget. And the underlying API tool runs against a customer-controlled sandbox, which bounds the *environment*, not the action. A click inside a customer-controlled sandbox can still reach a production admin console if the credentials in the sandbox allow it.

Browser-Use cleans up the DOM so the model can act more reliably. Reliability is not policy. A more reliable click can still be the wrong click.

This is the same structural pattern called out in [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision): every consequential agent action needs a policy decision *outside* the model. For traditional tool-calling agents, that decision attaches to a tool name. For computer-use agents, it has to attach to something the click carries — the target, the intent, the context.

## The PocketOS Pattern at the Browser Layer

The same two-layer fix that emerged from the [PocketOS post-mortem](/blog/pocketos-aftermath-delete-delay-vs-scoped-tokens) — scoped credentials on the provider side, runtime authority on the agent side — applies to computer-use, with a twist.

**Provider-layer fixes (the click-side equivalent of scoped [tokens](/glossary#tokens)):**

- The browser session the agent operates in should be scoped to a specific tenant context, with cross-tenant navigation blocked at the cookie layer. A click that lands on a different tenant's admin URL should fail at the session, not at the application.
- Single-row scopes inside the admin console — a session opened to edit customer 42 should not allow operations against customer 43 without re-authentication.
- Server-side rate limits on destructive endpoints, scoped to the agent's session, with stricter limits than the human-operator equivalent.

**Agent-layer fixes (the click-side equivalent of runtime authority):**

- A pre-action gate between the agent's intent to click and the click event leaving the harness, evaluating (target, intent, context) and returning a [three-way decision](/glossary#three-way-decision).
- Per-session promotion-authority budgets denominated in [RISK_POINTS](/glossary#risk-points), capped well below a single high-blast click without `requires_human_approval`.
- Fresh-screenshot requirements for any click whose target was classified more than N seconds ago, or after the agent has performed any intervening action.
- Audit records of every click attempt — the proposed target, the runtime decision, the actual event — separate from the application's own logs.

Treating these as alternatives is the same framing trap from PocketOS. Provider-side scoping without an agent-side gate leaves the agent with full authority inside the scope, and "inside the scope" includes the entire admin console for the tenant. An agent-side gate without provider-side scoping leans on the gate's classifier to recognize every destructive label across every site the agent visits. Both layers together close the chain.

## What This Looks Like Across the Three Stacks

A practical view of how the schedule fits each major computer-use stack today:

| Stack | DOM target available? | URL pattern available? | Screenshot region available? | Gate vantage point |
|---|---|---|---|---|
| OpenAI ChatGPT agent (CUA-backed) | No (pixel-based) | Yes | Yes | Hard to instrument externally — agent runs in OpenAI's sandbox |
| Anthropic Claude Computer Use | Limited (depends on the surface) | Yes if the agent is browser-driving; no for pure desktop | Yes | Customer-controlled sandbox: a Cycles-style gate can wrap the tool-call layer |
| Browser-Use | Yes (the framework's strength) | Yes | Yes | Customer-controlled; easiest to instrument |

The instrumentation story is uneven. Customer-controlled stacks (Browser-Use, Claude Computer Use in a customer sandbox) admit a runtime authority gate that sits between the model's intent and the actual click. Provider-hosted stacks (ChatGPT agent in OpenAI's sandbox) admit much less; the gate has to live one layer up — at the task boundary, or via human confirmation rules — because the customer does not own the action emitter.

That asymmetry is itself a deployment decision worth being explicit about. Teams that need real runtime authority on every click should treat the customer-controllable stacks as the default, and reserve the provider-hosted ones for tasks where the missing layer is acceptable.

## A Short Checklist for the Computer-Use Surface

For each computer-use agent the team runs against any production surface:

1. **Can the agent operate against a tenant other than its assigned one?** If yes, browser-session scoping is missing. Computer-use agents are one of the few classes where a single misclassified click can switch tenants without an explicit API call.
2. **Does every destructive label in the team's admin consoles map to a known rule in the click gate?** "Delete," "Remove," "Cancel" (when it means destructive), "Force," "Override," and the team's domain-specific verbs.
3. **Are clicks gated by freshness?** A click against a target classified more than N seconds ago, or after any intervening action, should re-classify.
4. **Are typed inputs evaluated against the field they target?** Typing `1000` into a notes field is different from typing it into an amount field.
5. **Is cross-domain navigation a distinct action class?** Following a link that leaves the original tenant should not be cheap.
6. **Does the audit trail record the click attempt, the runtime decision, and the actual event separately?** Application logs alone collapse these.
7. **Is the per-session click budget denominated in something other than count?** A session that can do 800 read-clicks should not get to do 800 destructive clicks for the same authority.

A team that can answer "yes" to all seven is running computer-use as an action surface, not as an unstructured pixel stream. As of mid-2026, many deployments are closer to "no" on most of these — the maturity gap between traditional tool-calling agents and computer-use agents is large enough that the same team often has thoughtful action authority on one and almost none on the other.

## What Changes When Clicks Are Treated as Actions

The shift is the same one the [memory-writes](/blog/agent-memory-writes-are-actions-too) and [merge](/blog/when-coding-agents-press-merge) extensions made: take the unit the agent actually emits, and apply the action authority lifecycle to it. The lifecycle does not change. What changes is the feature vector the rule body inspects.

The agent's session has a finite click-authority budget. The 800th `Edit → Save` cycle does not have the same authority as the first one. By the time the schedule's relative-weighting effects accumulate, the agent's authority for a high-blast click has narrowed without anyone hand-tuning a cap.

The audit trail names the click, not just the eventual database row. Every action the agent took to produce the change is recorded with its (target, intent, context) classification — so when the migration completes and a downstream customer asks "what exactly did the agent do to my record?", the answer is in the runtime decisions, not reconstructed from application logs.

A/B page changes stop being silent attack surface. A button label that shifts mid-session is exactly the case the freshness cap is for. The agent re-screenshots, the gate re-classifies, the click either re-validates or returns `DENY` with a `reason_code: target_mismatch`.

And the action authority lens stays unified across the corpus. Outbound side effects, memory writes, merge buttons, and clicks all run through the same reserve-commit lifecycle, with the same audit shape and the same three-way decision model. The substrate is uniform; the feature vector changes per surface.

## Next Steps

- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — the parent tier model this post extends to clicks and keystrokes
- **[Agent Memory Writes Are Actions, Too](/blog/agent-memory-writes-are-actions-too)** — the sibling extension to memory operations
- **[When Coding Agents Press Merge](/blog/when-coding-agents-press-merge)** — the sibling extension to the merge surface
- **[AI Agent Risk Assessment: Score, Classify, Enforce](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)** — the RISK_POINTS framework underlying the click schedule
- **[Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision)** — the policy-decision-per-action argument
- **[Why a Delete-Delay Isn't the PocketOS Fix](/blog/pocketos-aftermath-delete-delay-vs-scoped-tokens)** — the two-layer fix this post mirrors for browser sessions
- **[Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)** — extends naturally to (target, intent, context) rules
- **[How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)** — the lifecycle that applies, unchanged, to click actions
