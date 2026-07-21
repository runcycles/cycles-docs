---
title: "Privacy Policy"
description: "How Cycles (runcycles.io) handles data: a self-hosted product that keeps your data in your infrastructure, a documentation site with no third-party trackers, and what little we actually receive."
---

# Privacy Policy

**Last updated: 2026-07-21**

The short version: Cycles is self-hosted software — your budget data lives in your infrastructure and never reaches us. This website sets no trackers. The only personal data we routinely receive is what you send us by email.

This policy covers the runcycles.io website and documentation, the open-source Cycles software we distribute (server, clients, MCP server, desktop extension), and the limited ways you can send us data directly.

## Who we are

Cycles ([runcycles.io](https://runcycles.io)) builds runtime budget authority for AI agents. For anything in this policy, contact us at [hello@runcycles.io](mailto:hello@runcycles.io).

## This website

- **Hosting.** runcycles.io is a static site served by GitHub Pages. GitHub processes standard web server logs (including IP addresses) to deliver the site; see the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). We do not receive or store those logs.
- **No analytics, no trackers, no ads.** We run no third-party analytics, tracking pixels, or advertising scripts.
- **No cookies from us.** The site sets no cookies. Interactive features keep their state in your browser only: the page-feedback widget and the calculators store values in `localStorage` on your device, and nothing is transmitted to us or anyone else.

## The Cycles software

- **Self-hosted means your data stays yours.** The Cycles server runs in your infrastructure with state in your Redis. Budget state — reservation amounts, balances, event records, subject identifiers (tenant, workspace, app, workflow, agent, toolset), usage metrics, and tenant configuration — is stored where you deploy it, under your control and retention policy. We have no access to it and receive none of it.
- **No agent content.** Cycles stores budget state, not content: no LLM prompts, no responses, no tool arguments or outputs from your agents.
- **Metadata fields are yours to fill.** The protocol's free-form `metadata` fields store whatever your integration puts in them, in your infrastructure. Avoid putting personal data in them unless your own policies allow it.
- **Clients, MCP server, and the desktop extension** connect only to the Cycles server URL you configure. Your API key is stored in your local configuration and sent only to that server. Mock mode contacts no server at all and returns synthetic responses. The software includes no telemetry, phone-home, or update checks.

## What we do receive

- **Email.** If you write to [hello@runcycles.io](mailto:hello@runcycles.io) or [founder@runcycles.io](mailto:founder@runcycles.io), we receive your address and message and use them to respond. We keep correspondence as long as needed for that purpose and don't add you to marketing lists.
- **GitHub and npm.** If you open issues, discussions, or pull requests, that activity is on GitHub under the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Installing our packages goes through npm under the [npm privacy notice](https://docs.npmjs.com/policies/privacy). We see only the public activity and aggregate download counts these platforms expose to every maintainer.

## Your rights

For any data we actually hold about you — in practice, email correspondence — you can ask us to show it, correct it, or delete it by writing to [hello@runcycles.io](mailto:hello@runcycles.io). For data held in a Cycles deployment run by your employer or vendor, contact that operator: they control it, we don't have it.

## Changes

We'll update this page when our practices change and revise the date above. Material changes to what we collect will be noted in the [changelog](/changelog).
