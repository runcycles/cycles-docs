---
title: "How We Stopped Shipping Performance Regressions"
date: 2026-04-18
author: Albert Mavashev
tags: [engineering, operations, performance, ci, benchmarking, regression-testing]
description: "How Cycles gates releases with rolling benchmark medians, separates blocking and warning thresholds, and reduces noise from variable GitHub Actions runners."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "performance regression gate, benchmark ci pipeline, release blocking benchmarks, rolling median baseline, github actions benchmark noise, regression threshold tuning, performance ci gate, automated perf testing"
---

# How We Stopped Shipping Performance Regressions

A benchmark suite that nobody looks at is theatre — six months later, nobody trusts it enough to gate anything on. The actual engineering question isn't "can we benchmark our system" — it's "can we wire the benchmark into the release process in a way that blocks real performance regressions without crying wolf on runner noise."

Cycles has a two-tier gate for this. **Release-time blocking at 25% against the rolling seven-record history median (with `baseline.json` as a bootstrap fallback); nightly trend-warning at 30% against the same rolling-window model.** Both use a three-trial median per run to damp GitHub-runner variance. This post is about what each piece does, why we picked those numbers, and the one escape hatch that keeps the gate from training the team to ignore it.

<!-- more -->

## The problem, stated narrowly

The Cycles server now publishes nine headline numbers: Reserve and Commit p50 + p99, Release and Event p50, sorted-list p50 at 1,000 and 10,000 rows, plus 32-thread concurrent throughput. The two p99 values remain visible but are non-gating because shared-runner tail variance is too high; the other seven signals are compared with the rolling benchmark history before a hot-path release ships. The gate detects relative regressions on comparable hardware—it is not a fixed latency or throughput SLA. The [benchmark post](/blog/cycles-server-performance-benchmarks) explains the original test series, while the server's `BENCHMARKS.md` is the current release-by-release record.

"Delivers on" is doing the real work in that sentence. Three failure modes the gate has to cover:

1. **A change regresses a hot path by 2×.** Someone adds an HGETALL where an HMGET used to work; someone switches a `redis.call('TIME')` for a client timestamp that's slower round-trip. The gate should fail the release before the image gets published.

2. **A change drifts throughput down 15% over six commits.** No single PR is bad enough to fail a gate, but the cumulative curve points the wrong way. The gate should surface this *before* someone tags a release.

3. **A GitHub-hosted runner has a noisy 10 minutes and the benchmark run is slow.** The gate should *not* fail. A false positive here burns the on-call's morning and trains everyone to hit "re-run" instead of reading the diff.

Any gate that handles (1) but not (2) is reactive. Any gate that handles (1) and (2) but not (3) is a nuisance that gets disabled within a month. The two-tier design is the minimum that handles all three.

## Tier 1: the release gate

At release time—when the workflow fires on `release: [published]`—the job runs the `-Pbenchmark` Maven profile three times, medians the numbers, and compares against the rolling median of the last seven records on the dedicated `benchmark-data` branch. If fewer than two history records exist, it falls back to `baseline.json`; an empty baseline bootstraps without failing. A regression greater than 25% on any gating metric blocks the release before the image is published.

The shape of the comparison is in [`scripts/check-regression.py`](https://github.com/runcycles/cycles-server/blob/main/scripts/check-regression.py):

```python
def pct_change(current: float, baseline: float, lower_is_better: bool) -> float:
    """Positive = worse; negative = better. Sign flips by direction."""
    if baseline == 0:
        return 0.0
    if lower_is_better:
        return (current - baseline) / baseline
    return (baseline - current) / baseline
```

Eight metrics are latency (lower is better); `concurrent_throughput_32t` is the one higher-is-better number. Reserve and Commit p99 are reported but non-gating. The sign flip lives in one function so the threshold is a single scalar—`change > 0.25` means "25% worse in the direction that matters" for every metric, while only a gating metric can fail the build.

Why 25%? Three reasons, stacked:

- **GH-hosted runner variance is real.** Benchmark-grade hardware it is not — in the original test series, single-digit-millisecond latencies bounced roughly ±10-20% run-to-run on the same commit. A 10% threshold would fail more often from noise than from real regressions.
- **The 3-trial median already cuts the tail.** One pathological trial doesn't move the reported number; you'd need two of three trials to be bad for the record to drift. That changes the shape of the noise distribution we're thresholding against.
- **25% catches the regressions that actually matter.** A 2× slowdown is a 100% move; a 30% slowdown on the reserve hot path is a feature-level issue. 25% is our current operating threshold: above normal runner wobble, but low enough to catch regressions that matter.

On a successful gate, the new median atomically overwrites `baseline.json` and appends to `history.jsonl` on the `benchmark-data` branch. Future releases normally compare with the rolling history median, which is less sensitive to one unusually fast or slow run than a single-point baseline.

## Tier 2: the nightly trend

The release gate only fires when someone tags a release. A regression introduced on Monday that won't trigger the gate until Friday's release is four days of false comfort. The nightly job ([`.github/workflows/nightly-benchmark.yml`](https://github.com/runcycles/cycles-server/blob/main/.github/workflows/nightly-benchmark.yml)) closes that window.

Same three-trial median, same nine metrics, and the **rolling seven-run median** of recent history, with a **30% threshold**. It does not block anything—the check writes a Markdown summary to the GitHub Actions job summary and annotates the commit if a gating metric crossed the threshold. Observation, not enforcement.

Two design choices worth naming:

**Rolling median, not rolling mean.** The median is robust to one bad night. If Tuesday was a noisy runner, the Wednesday check doesn't get that noise baked into its baseline. With a mean, one outlier drags the reference for the next seven comparisons; with a median, one outlier is ignored.

**Compare *before* appending.** The trend check runs against `history.jsonl` *before* the current run is added. If you append first, the current run becomes part of its own baseline window — every run would be compared against a set that includes itself, which damps the signal exactly when you want it loud. The workflow orders those steps deliberately:

```yaml
- name: Trend check
  # Compare this run against the rolling median from the data
  # branch. Do this BEFORE appending so the current run doesn't
  # become part of its own baseline window.
  run: |
    python3 scripts/check-regression.py trend \
      --current /tmp/nightly.json \
      --history bench-data/benchmarks/history.jsonl \
      --window 7 --threshold 0.30 | tee /tmp/trend-summary.md

# ... later ...

- name: Commit history to benchmark-data branch
  # (append happens here, after the comparison)
```

Why 30% instead of 25%? The nightly tier runs on every scheduled pass and is intended to flag only a clearer sustained move; a nightly trend result is a prompt to investigate. The release tier uses the stricter 25% threshold because it is the last hot-path check before image publication, with the three-trial median, rolling baseline, and explicit audited skip available to control noise.

## Noise handling: what stacks

Runner noise is the failure mode that kills these systems. Three techniques stack:

**3-trial median per run.** One trial gets you one number and one set of problems. Three trials and a median gets you a number that mostly ignores a single runner hiccup. [`median-benchmarks.py`](https://github.com/runcycles/cycles-server/blob/main/scripts/median-benchmarks.py) drops non-numeric or missing values per-metric, so a partial trial doesn't poison the whole record.

**Rolling 7-run median on the trend tier.** Smooths over the day-to-day wobble that 3-trial-per-run can't fully damp. A real regression shows as a sustained step — five or six nights in a row on the wrong side of the median. One-night noise is absorbed.

**Tolerant thresholds.** 25% for release, 30% for trend. Tight enough to catch a 2× regression; loose enough to absorb much of the shared-runner variance. The thresholds remain operational settings, not statistical guarantees.

The one thing that would *not* help is tightening the threshold. Runner noise doesn't shrink because you set a stricter gate; you just get more false positives and everyone trains themselves to re-run rather than investigate.

## The escape hatch: `[benchmark-skip]`

Every gate needs an override for the cases where running it is noise rather than signal. For Cycles it's `[benchmark-skip]` in the release notes body.

The condition that warrants it: **the release doesn't touch the hot path, so running the benchmark would only measure environmental variance.** Precedent from the release workflow comment: `v0.1.25.9`, `v0.1.25.10`, and `v0.1.25.11` were all legitimately benchmark-skipped — infra/test-only releases where re-running the gate would have added 15-20 minutes of CI time to measure nothing.

The skip check is the first step of the gate job, before JDK or Python get set up:

```bash
if echo "$RELEASE_BODY" | grep -qF "[benchmark-skip]"; then
  echo "Release notes contain [benchmark-skip] — skipping benchmark gate."
  echo "skipped=true" >> "$GITHUB_OUTPUT"
  exit 0
fi
```

Two features of this design worth naming:

- **The override lives in the release notes, not a separate input.** The reason is auditable: anyone looking at the release can see *why* the gate was bypassed, because the bypass and the justification are the same artifact.
- **The override skips the gate, not the baseline update.** A benchmark-skipped release doesn't overwrite `baseline.json`. The next release is still measured against the last non-skipped release's numbers. That matters — if three patch releases in a row skipped the gate, the fourth release still has to beat the pre-skip baseline. Skipping doesn't reset the bar.

## Where the data lives, and why that's not on main

Both `baseline.json` and `history.jsonl` live on a dedicated `benchmark-data` branch, not `main`. The [benchmarks README](https://github.com/runcycles/cycles-server/blob/main/benchmarks/README.md) has the full rationale; the short version is:

- `main` is protected; `github-actions[bot]` can't push to it without bypass config or a PAT secret.
- A separate non-protected branch needs none of that. The workflow `git fetch origin benchmark-data:benchmark-data`, does its writes in a worktree, and pushes.
- The separation also cleanly distinguishes "service code" (on `main`) from "CI telemetry data" (on `benchmark-data`). A reviewer reading `git log main` doesn't see nightly-bench commits cluttering the history.

This pattern has worked cleanly for us. The alternative — reconfiguring branch protection to allow bot pushes — is more fragile (one misconfiguration and the bot can push arbitrary code to main) and harder to reason about. The data-branch pattern keeps the blast radius of the CI identity bounded to a branch nobody deploys from.

## The parse layer, and why it fails loudly

One failure mode that bites benchmark pipelines: the tests run, the workflow is green, but parsing silently missed a metric and the "regression" never fires because the number was null on both sides. [`parse-benchmarks.py`](https://github.com/runcycles/cycles-server/blob/main/scripts/parse-benchmarks.py) is explicit about this:

```python
if missing:
    print("ERROR: could not parse metrics: " + ", ".join(missing), file=sys.stderr)
    # Emit what we have, but exit non-zero so the pipeline fails loudly.
    # Partial data is still useful for debugging why parsing broke.
    print(json.dumps(record))
    return 3
```

Exit 3, not exit 0. The workflow step fails, the release stops. A benchmark run that silently skipped a test shouldn't land in history — and shouldn't pretend the gate passed.

There's a small piece of history in the script's comments that's worth quoting because it's the kind of bug this design is explicitly guarding against:

> The benchmark tests print BOTH a pipe-delimited summary table AND a per-operation line like: `[Benchmark] Reserve p50=3.0ms ...`. We match on the `[Benchmark]` line because it's unambiguous — the pipe table has whitespace quirks in surefire's CDATA output that proved brittle in the first nightly run (all table metrics missed, throughput extracted fine because it uses a `[Concurrent]` prefix line too).

The first nightly run silently missed every latency metric. The throughput number was fine, so a less-paranoid parser would have reported "everything green, ship it." The fail-loudly exit is what caught it.

## Bottom line

The gate isn't magic. It's four small pieces fitted together: three-trial medians to damp runner noise, a release-blocking tier at 25% against rolling history, a trend-warning tier at 30% against the same seven-record window, and an auditable escape hatch for releases where the benchmark would only measure variance. The data branch keeps CI telemetry out of `main`'s history; the parse layer fails loudly rather than reporting null metrics as "passing."

The historical numbers in the [benchmark post](/blog/cycles-server-performance-benchmarks) are a dated test series, not a universal bound. The release and nightly workflows provide the current relative-regression signal, and the server's `BENCHMARKS.md` records the hardware, version, and interpretation for benchmarked releases.

---

*More on the tests the gate is checking: [the Lua-on-Redis substrate post](/blog/why-cycles-runs-budget-authority-on-redis-lua) for why those numbers look the way they do, and [property-based tests](/blog/why-we-added-property-tests-to-cycles-budget-authority) for the correctness story.*
