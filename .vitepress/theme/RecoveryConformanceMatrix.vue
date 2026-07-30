<script setup lang="ts">
import { data } from './recovery-conformance.data'
import type { RecoverySdk } from './recovery-conformance.data'

const levelLabels = {
  core: 'Core',
  durable: 'Durable',
  boundary: 'Boundary',
}

function resultFor(sdk: RecoverySdk, scenarioId: string) {
  return sdk.report.scenarios.find(scenario => scenario.id === scenarioId)
}

function reportPath(slug: string) {
  return `/conformance/recovery/${slug}.json`
}

function commitUrl(sdk: RecoverySdk) {
  return `https://github.com/${sdk.repository}/commit/${sdk.report.implementation.commit}`
}

function shortCommit(commit: string) {
  return commit.slice(0, 7)
}
</script>

<template>
  <div class="recovery-conformance">
    <div class="summary-grid">
      <article v-for="sdk in data.sdks" :key="sdk.slug" class="sdk-card">
        <div class="sdk-heading">
          <h2>{{ sdk.name }}</h2>
          <span
            class="claim"
            :class="{ failed: sdk.report.summary.failed > 0 }"
          >
            {{ sdk.report.claim }} ·
            {{ sdk.report.summary.passed }}/{{ sdk.report.summary.total }}
          </span>
        </div>
        <p>
          <template v-if="sdk.report.implementation.version">
            v{{ sdk.report.implementation.version }} ·
          </template>
          verified at
          <a :href="commitUrl(sdk)"><code>{{ shortCommit(sdk.report.implementation.commit) }}</code></a>
        </p>
        <p class="evidence-links">
          <a :href="sdk.report.evidence_url">CI run</a>
          <span aria-hidden="true">·</span>
          <a :href="reportPath(sdk.slug)">JSON evidence</a>
        </p>
        <details>
          <summary>Native-test mapping</summary>
          <ul>
            <li
              v-for="scenario in sdk.report.scenarios"
              :key="scenario.id"
            >
              <strong>{{ scenario.id }}</strong>
              <code v-for="test in scenario.native_tests" :key="test">{{ test }}</code>
            </li>
          </ul>
        </details>
      </article>
    </div>

    <div class="matrix-wrap" role="region" aria-label="SDK recovery conformance matrix" tabindex="0">
      <table>
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Scenario</th>
            <th v-for="sdk in data.sdks" :key="sdk.slug" scope="col">
              {{ sdk.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="scenario in data.scenarios" :key="scenario.id">
            <td>
              <span class="level" :class="scenario.level">
                {{ levelLabels[scenario.level] }}
              </span>
            </td>
            <th scope="row">
              <code>{{ scenario.id }}</code>
              <span>{{ scenario.name }}</span>
            </th>
            <td v-for="sdk in data.sdks" :key="sdk.slug" class="result">
              <a
                :href="reportPath(sdk.slug)"
                :class="{ pass: resultFor(sdk, scenario.id)?.passed, fail: !resultFor(sdk, scenario.id)?.passed }"
                :aria-label="`${sdk.name} ${scenario.id}: ${resultFor(sdk, scenario.id)?.passed ? 'pass' : 'fail'}`"
              >
                {{ resultFor(sdk, scenario.id)?.passed ? '✓' : '✕' }}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="snapshot-note">
      Profile {{ data.profileVersion }} · catalog
      <code>sha256:{{ data.catalogDigest.slice(0, 12) }}…</code>.
      Each result is pinned to the displayed SDK commit; the README workflow
      badge shows whether current <code>main</code> remains green.
    </p>
  </div>
</template>

<style scoped>
.recovery-conformance {
  margin: 28px 0 36px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

.sdk-card {
  padding: 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.sdk-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sdk-heading h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 18px;
}

.sdk-card p {
  margin: 8px 0 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.claim {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
}

.claim.failed {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.evidence-links {
  display: flex;
  gap: 7px;
}

details {
  margin-top: 12px;
  font-size: 13px;
}

summary {
  cursor: pointer;
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

details ul {
  margin: 10px 0 0;
  padding-left: 18px;
}

details li + li {
  margin-top: 8px;
}

details code {
  display: block;
  margin-top: 3px;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.matrix-wrap {
  overflow-x: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

table {
  width: 100%;
  min-width: 680px;
  margin: 0;
  border-collapse: collapse;
}

th,
td {
  border: 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

tbody tr:last-child th,
tbody tr:last-child td {
  border-bottom: 0;
}

thead th {
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  white-space: nowrap;
}

tbody th {
  min-width: 220px;
  text-align: left;
  font-weight: 500;
}

tbody th code {
  display: block;
  margin-bottom: 4px;
  color: var(--vp-c-brand-1);
  font-size: 12px;
}

tbody th span {
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.level {
  display: inline-block;
  min-width: 62px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
  text-align: center;
  font-size: 11px;
  font-weight: 700;
}

.level.durable {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.level.boundary {
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
}

.result {
  text-align: center;
}

.result a {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 50%;
  text-decoration: none;
  font-weight: 800;
}

.result .pass {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}

.result .fail {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}

.snapshot-note {
  margin-top: 14px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

@media (max-width: 700px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
