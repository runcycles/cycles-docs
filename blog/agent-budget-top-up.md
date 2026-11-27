---
title: "Did That Agent Budget Top-Up Go Through?"
date: 2026-11-27
author: Albert Mavashev
tags: [engineering, operations, production]
description: "When a budget credit succeeds but its confirmation disappears, should you click again? A browser test shows how to retry an agent budget top-up safely."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent budget top-up, budget funding, idempotency key, lost response, Playwright, retry testing"
---

# Did That Agent Budget Top-Up Go Through?

You open **Fund Budget**, enter 100, and click **Execute**. The dialog shows an error. You meant to grant 100 units exactly once. Do you click again?

Here’s what the browser missed. The server had already raised the allocation from 1,000 to 1,100. The connection dropped on the way back. If the second click raises the allocation to 1,200, the agent can stay within its limit and still spend more than you authorized. The extra room came from the admin console.

A browser test in the Cycles [dashboard](/glossary#dashboard) reproduces that sequence by dropping the first successful response. Now suppose you come back tomorrow and deliberately grant the same agent another 100 units. Both requests would contain the same amount, and you would expect both top-ups to count. How can the dashboard tell the two cases apart?

<!-- more -->

## Which clicks belong to one budget top-up?

Disabling **Execute** while a request is in flight stops an impatient double-click. By the time the dialog shows a connection error, that protection has done its job. The operator can submit again, and the server needs a way to recognize an instruction it has already carried out.

In Cycles dashboard v0.1.25.87, the first submission creates an [idempotency key](/glossary#idempotency-key) and sends it in the funding request. An unchanged submission from the same open dialog reuses that key. If the first credit went through, a matching retry on the same ledger within 24 hours of the mutation returns the original response. If the first request never reached the server, the retry can apply the credit. API clients can omit the key, in which case each request applies independently. [Funding contract](https://github.com/runcycles/cycles-protocol/blob/27d27394a602e2d8c61b997e81e40dae5e2f1418/cycles-governance-admin-v0.1.25.yaml#L4870-L4874)

The amount alone cannot identify an instruction. Suppose you change 100 to 150 after the error and submit. That creates a new key, so the ledger could receive both credits. If you edit the amount and change it back to 100 **before submitting**, with every other field unchanged, the open dialog recovers the original key. Opening a fresh dialog starts a new instruction, even if you fill in the exact same values. [Dashboard funding implementation](https://github.com/runcycles/cycles-dashboard/blob/v0.1.25.87/src/composables/useBudgetFunding.ts)

## Drop the response after the credit succeeds

It’s easy to write a test that aborts the first request before it reaches the server. Even an implementation that generates a fresh key on every click could pass that test. Only one of its two requests would have reached the ledger.

The released Playwright test starts with an isolated ledger holding 1,000 `USD_MICROCENTS` and enters a credit of 100. It intercepts the funding request and runs this handler. [Full test and setup](https://github.com/runcycles/cycles-dashboard/blob/v0.1.25.87/tests/e2e/budget-funding-retry.spec.ts)

```ts
const keys: string[] = []
await page.route('**/v1/admin/budgets/fund?**', async route => {
  keys.push(route.request().postDataJSON().idempotency_key)
  const response = await route.fetch()
  expect(response.ok()).toBe(true)
  if (keys.length === 1) {
    await route.abort('connectionreset')
  } else {
    await route.fulfill({ response })
  }
})
```

The crucial line is `await route.fetch()`. Playwright forwards the request and gets the server’s answer while the page is still waiting. On the first attempt, the test checks that the server returned success, then gives the browser a connection reset. On the second, it delivers the server’s answer to the page. [Playwright’s route API](https://playwright.dev/docs/api/class-route#route-fetch)

The test clicks **Execute**, waits for the alert, then clicks **Execute** again in the same dialog. It checks that exactly two requests carried the same nonempty key. Finally, it reads the ledger through the admin API and checks that `allocated.amount` is **1,100**. The key check catches a browser that forgets the first attempt. The allocation check catches a server that accepts the key and still applies the credit twice.

## When to retry and when to check the ledger

With dashboard v0.1.25.87 and its bundled admin server, leave the fields unchanged and retry in the same open dialog within the 24-hour window. Dashboard v0.1.25.86 generated a fresh key on each submission. If you’re on that version, check the ledger before clicking again. [Dashboard release notes](https://github.com/runcycles/cycles-dashboard/blob/v0.1.25.87/CHANGELOG.md#L18-L24)

Refreshing the page or reopening the form loses the original key. The dashboard also refuses an expired retry in an open dialog. In those cases, check the ledger and funding history before deciding whether to issue a fresh credit. On a busy ledger, the current total alone may reflect someone else’s adjustment. [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production)

If you maintain a console that grants credits or raises quotas, try the same test on one additive operation. Start from a known allocation, let the write succeed, drop the confirmation, and retry through the UI. Read the allocation independently. That last number tells you how much authority the operator actually granted.

## Related reading

- [Retry Storms & Idempotency in Agent Budget Systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems) follows a retry from the agent through the layers that can repeat a charge.
- [Bulk Operations for Incident Response](/blog/bulk-operations-ai-agent-incident-response) covers the related case where an operator must reconcile outcomes across many targets.
