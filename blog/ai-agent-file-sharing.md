---
title: "Who Still Has Access After the AI Agent Stops?"
date: 2026-11-17
author: Albert Mavashev
tags: [security, agents, action-control, runtime-authority]
description: "Learn to scope AI agent file sharing in Google Drive, verify who can open a report after a run ends, and test what happens when a temporary permission expires."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent file sharing, AI agent security, Google Drive permissions, temporary file access, agent access revocation
---

# Who Still Has Access After the AI Agent Stops?

“Let Maya at the customer read the incident report until Friday at five.” Imagine a support agent that finds the right file, emails the right person, and closes the ticket. Maya opens the report. The task looks complete.

Now have Maya forward the link to a colleague who has never had access to the report. Can the colleague open it? Can Maya open it on Monday? The answers depend on the permission the agent created in the document store. Ending the run leaves that permission in place.

The email tells us where the link went. The permission on the file tells us who else can use it.

<!-- more -->

## Two Google Drive permissions behind the same email

Take a restricted file in a Google Workspace account that supports expiring access. Assume the customer's two test accounts have no existing access, and the organization's settings allow both named external readers and anyone-links. Both grants below let the agent send the same email with the same file URL.

| Permission on the report | Named reader | Anyone with the link |
|---|---|---|
| Audience | `type=user`, `emailAddress` set to Maya's verified address | `type=anyone`, `allowFileDiscovery=false` |
| Role | `reader` | `reader` |
| Cutoff | `expirationTime` set to the agreed instant | Drive accepts an expiration only for user and group permissions |
| Maya forwards the URL | Her colleague needs an independent grant to open it | Her colleague can read the report using the link |

The easy field to misread is `allowFileDiscovery`. Turning discovery off controls whether the file can turn up in search. Someone who already has the link is a different audience. For this ticket, only the named-reader column fits. [Drive permissions reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions)

## What to check before an AI agent shares a file

Resolve four facts from the authorized ticket and trusted application records before the connector sends a sharing request. Which file belongs to this case? Which customer identity is Maya's? What role did the lead approve? Which instant does “Friday at five” mean in the customer's time zone? If the ticket leaves the time zone ambiguous, resolve it before granting access. An agent's guesses about a recipient or deadline can change who gets to read a customer's data. [Agent identity and user identity](/blog/agent-identity-is-not-user-identity)

Give this workflow a narrow sharing operation. The connector takes the approved file and recipient, sets the reader role, and supplies the cutoff as a future RFC 3339 timestamp. Drive supports a deadline up to one year ahead. If workspace policy prevents that share, it can leave the report restricted and return the reason to the lead. A generic fallback that creates a broadly readable link would change the audience the lead approved. [How agents work around a denial](/blog/ai-agent-denial-workarounds)

There is a second check even when the proposed permission looks right. Suppose Maya already belongs to a group with ongoing access through the report's parent folder. Expiring her direct permission on Friday leaves the group route open. Drive identifies the group on the permission record. To check whether Maya belongs to it, use an authorized directory. If the connector cannot verify membership, tell the lead that Maya’s effective cutoff is unverified. The folder owner can decide whether to use a separately authorized, restricted copy. Changing access on the parent could affect every other report in it. [Google Drive sharing and permission inheritance](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

For a team using Cycles to govern external shares, the host checks the audience and deadline first. It can then reserve caller-assigned [RISK_POINTS](/glossary#risk-points) against a budget scoped to the run, honor any applicable caps before dispatch, and commit the modeled charge for each executed share. Those points bound the sharing activity covered by the connector. Drive enforces the resulting file permission. [Assigning risk points to agent tools](/how-to/assigning-risk-points-to-agent-tools)

## Keep the receipt that lets someone revoke the share

An on-call engineer opening the ticket on Thursday needs to find the exact grant. Record the Drive file ID and permission ID together, the approved recipient and role, the expiry, and whether the connector created a new grant or found existing access. Drive’s permission ID identifies the grantee. Tie the file and permission IDs to the ticket and run so the operator can find the authorization for this particular share. Keeping the report contents or its shareable URL in general-purpose logs adds another place to expose the document. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet)

If the customer asks for early removal, the owner can use those IDs to locate the direct grant, confirm it still belongs to this request, revoke it, and check the remaining access paths. Check for later approvals before deleting a permission someone else now relies on. Until the owner verifies Maya’s effective access, the ticket should say exactly what changed, such as “removed Tuesday’s direct reader grant.” Any copy Maya already downloaded has its own lifetime. [Drive permission removal](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/delete)

## Test file access after the agent stops

Use a synthetic report, two controlled reader accounts, and separate browser sessions. Set a short, supported expiry in the test workspace. Reopen the original file online using the full URL provided by Drive, including any resource key. Dropping that key can make a forwarded link appear safer than it is. [Drive resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys)

1. **Establish the baseline.** Confirm both accounts are denied before sharing. Keep the owner available to inspect permissions.
2. **Run the real sharing tool.** Approve a temporary reader grant for the first account and end the run. Have the owner inspect the direct permission for the correct grantee, reader role, and expiry. Have the first reader open the report from the delivered email, then forward that same URL to the second account. Before expiry, the first reader should get in and the second should be denied.
3. **Cross the deadline.** Reopen the file as the first reader after expiry. If a fresh online request still opens it, the cutoff test fails. Record the observation time and inspect other grants. Test early revocation separately, while a grant is still live. These are two distinct ways the customer may need access to end.
4. **Set up a second report.** Give the first account continuing reader access through a parent folder and repeat the request. The connector should surface the conflict. The baseline read now succeeds, which is exactly why this case belongs in the test.

On the restricted report, a passing test yields three observations worth recording alongside the sharing receipt. Maya could open the original before the cutoff. The second account could not open the forwarded link. After the cutoff, Maya’s fresh request was denied.

## Resources

- [AI agent kill switches and what stopping a run covers](/blog/ai-agent-kill-switch-stop-contract)
- [Runtime limits for AI agent data access](/blog/ai-agent-data-access-needs-runtime-limits)
