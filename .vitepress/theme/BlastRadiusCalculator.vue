<script setup>
import { reactive, computed, ref } from 'vue'
import CalculatorToolbar from './CalculatorToolbar.vue'
import { useCalcState } from './lib/calc-state.js'
import { toMarkdownTable, toCsv, downloadText, captureElementToPng, copyText } from './lib/calc-export.js'

/*
  Blast-radius calculator. Quantifies the *risk envelope* of agent action
  classes — the magnitude of damage that could occur if the action fires
  when it should not. This is exposure, not a prediction. "Blast radius"
  rather than "loss" because not every triggered action results in actual
  loss; the radius is always present until something bounds it.

  Severity = reversibility multiplier + visibility surcharge (additive).
  Per-incident blast = (cost_per_action + users × cost_per_user) × severity
  Monthly blast       = per_incident × calls_per_day × (error_rate / 100) × 30
  With Cycles         = monthly × (1 - containment_pct / 100)
*/

const props = defineProps({
  variant:        { type: String, default: 'docs' },
  standalonePath: { type: String, default: '/calculators/ai-agent-blast-radius-standalone' },
  embedPath:      { type: String, default: '/calculators/ai-agent-blast-radius-embed' },
  initialState:   { type: String, default: null },
})

const REVERSIBILITY = {
  reversible:        { label: 'Reversible',      short: 'Rev',  factor: 1  },
  'hard-to-reverse': { label: 'Hard to reverse', short: 'Hard', factor: 3  },
  irreversible:      { label: 'Irreversible',    short: 'Irr',  factor: 10 },
}
const VISIBILITY = {
  internal:          { label: 'Internal only',   short: 'Int',  surcharge: 0 },
  'customer-facing': { label: 'Customer-facing', short: 'Cust', surcharge: 1 },
  public:            { label: 'Public',          short: 'Pub',  surcharge: 4 },
}

const state = reactive({
  agentName: 'Customer Support Bot',
  agentDescription: 'Tier-2 support agent that issues refunds, replies to customer emails, and reads order history.',
  containmentPct: 0,
  rows: [
    { name: 'Issue customer refund',          reversibility: 'irreversible', visibility: 'customer-facing', costPerAction: 50, affectedUsers: 1,     costPerUser: 200, callsPerDay: 200,  errorRate: 0.5 },
    { name: 'Send customer email',            reversibility: 'irreversible', visibility: 'customer-facing', costPerAction: 0,  affectedUsers: 1,     costPerUser: 50,  callsPerDay: 1000, errorRate: 0.3 },
    { name: 'Post on social / brand account', reversibility: 'irreversible', visibility: 'public',          costPerAction: 0,  affectedUsers: 10000, costPerUser: 5,   callsPerDay: 5,    errorRate: 0.2 },
    { name: 'Read internal record',           reversibility: 'reversible',   visibility: 'internal',        costPerAction: 0,  affectedUsers: 1,     costPerUser: 0,   callsPerDay: 5000, errorRate: 1.0 },
  ],
})

function clampNumber(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function normalizeContainment() {
  state.containmentPct = clampNumber(state.containmentPct, 0, 100)
}

function normalizeRowNumber(i, key, min = 0, max = Number.POSITIVE_INFINITY) {
  if (!state.rows[i]) return
  state.rows[i][key] = clampNumber(state.rows[i][key], min, max)
}

const calcState = useCalcState(state, {
  initialStateB64: props.initialState,
  hydrate(incoming) {
    if (typeof incoming.agentName === 'string')        state.agentName = incoming.agentName
    if (typeof incoming.agentDescription === 'string') state.agentDescription = incoming.agentDescription
    if (typeof incoming.containmentPct === 'number') {
      state.containmentPct = clampNumber(incoming.containmentPct, 0, 100)
    }
    if (Array.isArray(incoming.rows)) {
      state.rows = incoming.rows
        .filter(r => r && typeof r.name === 'string')
        .map(r => ({
          name: String(r.name),
          reversibility: REVERSIBILITY[r.reversibility] ? r.reversibility : 'reversible',
          visibility:    VISIBILITY[r.visibility]      ? r.visibility    : 'internal',
          costPerAction: clampNumber(r.costPerAction),
          affectedUsers: clampNumber(r.affectedUsers),
          costPerUser:   clampNumber(r.costPerUser),
          callsPerDay:   clampNumber(r.callsPerDay),
          errorRate:     clampNumber(r.errorRate, 0, 100),
        }))
    }
  },
})

function addRow() {
  state.rows.push({
    name: 'New action',
    reversibility: 'reversible',
    visibility:    'internal',
    costPerAction: 0, affectedUsers: 0, costPerUser: 0,
    callsPerDay: 0, errorRate: 0,
  })
}
function removeRow(i) { state.rows.splice(i, 1) }

const computedRows = computed(() => state.rows.map(r => {
  const rev = REVERSIBILITY[r.reversibility] || REVERSIBILITY.reversible
  const vis = VISIBILITY[r.visibility]      || VISIBILITY.internal
  const containmentPct = clampNumber(state.containmentPct, 0, 100)
  const costPerAction  = clampNumber(r.costPerAction)
  const affectedUsers  = clampNumber(r.affectedUsers)
  const costPerUser    = clampNumber(r.costPerUser)
  const callsPerDay    = clampNumber(r.callsPerDay)
  const errorRate      = clampNumber(r.errorRate, 0, 100)
  const severity      = rev.factor + vis.surcharge
  const directRadius  = costPerAction + affectedUsers * costPerUser
  const perIncident   = directRadius * severity
  const incidentsDay  = callsPerDay * (errorRate / 100)
  const monthlyRadius = perIncident * incidentsDay * 30
  const contained     = monthlyRadius * (1 - containmentPct / 100)
  const delta         = monthlyRadius - contained
  const isCatastrophic = r.reversibility === 'irreversible' && r.visibility === 'public'
  return { ...r, costPerAction, affectedUsers, costPerUser, callsPerDay, errorRate, severity, perIncident, monthlyRadius, contained, delta, isCatastrophic }
}))

const totals = computed(() => ({
  monthly:   computedRows.value.reduce((s, r) => s + r.monthlyRadius, 0),
  contained: computedRows.value.reduce((s, r) => s + r.contained, 0),
  delta:     computedRows.value.reduce((s, r) => s + r.delta, 0),
}))
const biggestMonthly = computed(() =>
  computedRows.value.length ? Math.max(...computedRows.value.map(r => r.monthlyRadius)) : 0
)

function fmtMoney(v) {
  if (!isFinite(v)) return '—'
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 2) + 'M'
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(v >= 100_000 ? 0 : 1) + 'K'
  if (v >= 1)         return '$' + v.toFixed(0)
  return '$' + v.toFixed(2)
}
function fmtFactor(v) { return '×' + v }

// ---- Export -----------------------------------------------------------------

const tableRef = ref(null)

function exportRowsHeaders() {
  return ['Action', 'Reversibility', 'Visibility', '$/action', 'Users', '$/user', 'Calls/day', 'Error %', 'Severity', 'Blast/mo', 'With Cycles', 'Δ/mo']
}
function exportRowsCells() {
  return computedRows.value.map(r => [
    r.name,
    REVERSIBILITY[r.reversibility].label,
    VISIBILITY[r.visibility].label,
    String(r.costPerAction),
    String(r.affectedUsers),
    String(r.costPerUser),
    String(r.callsPerDay),
    String(r.errorRate),
    fmtFactor(r.severity),
    fmtMoney(r.monthlyRadius),
    fmtMoney(r.contained),
    fmtMoney(r.delta),
  ])
}

function exportSummary() {
  return `Total monthly blast radius: ${fmtMoney(totals.value.monthly)} · With Cycles (${clampNumber(state.containmentPct, 0, 100)}% containment): ${fmtMoney(totals.value.contained)} · Δ/mo: ${fmtMoney(totals.value.delta)}`
}

function brandMeta() {
  return {
    calcName: 'Blast Radius Risk Calculator',
    subjectLabel: 'Agent',
    subjectName: state.agentName?.trim() || 'Untitled agent',
    subjectDescription: state.agentDescription?.trim() || '',
    sourceUrl: typeof window !== 'undefined' ? calcState.standaloneUrl(props.standalonePath) : 'https://runcycles.io/calculators',
    summary: exportSummary(),
  }
}

function safeFilenamePart() {
  const base = (state.agentName || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'agent'
}

async function copyMarkdown() {
  const md = toMarkdownTable(exportRowsHeaders(), exportRowsCells(), {
    brand: brandMeta(),
    footer: 'Blast radius is the magnitude of damage that could occur if the action fires when it should not — a measure of risk exposure, not a prediction.',
  })
  const ok = await copyText(md)
  if (!ok) throw new Error('clipboard unavailable')
}

function downloadCsv() {
  const headers = exportRowsHeaders()
  const cells   = exportRowsCells().map(row => [...row])
  cells.push([
    'TOTAL', '', '', '', '', '', '', '', '',
    fmtMoney(totals.value.monthly),
    fmtMoney(totals.value.contained),
    fmtMoney(totals.value.delta),
  ])
  const csv = toCsv(headers, cells, { brand: brandMeta() })
  downloadText(`cycles-blast-radius-${safeFilenamePart()}.csv`, csv, 'text/csv;charset=utf-8')
}

async function downloadPng() {
  if (!tableRef.value) throw new Error('no element')
  await captureElementToPng(tableRef.value, {
    filename: `cycles-blast-radius-${safeFilenamePart()}.png`,
    brand: brandMeta(),
  })
}
</script>

<template>
  <section class="risk-calc" :class="`variant-${variant}`">
    <CalculatorToolbar
      v-if="variant !== 'embed'"
      calc-name="risk"
      :share-url="() => calcState.standaloneUrl(standalonePath)"
      :embed-url="() => calcState.embedUrl(embedPath)"
      :on-copy-markdown="copyMarkdown"
      :on-download-csv="downloadCsv"
      :on-download-png="downloadPng"
    />

    <div ref="tableRef" class="capture-region">
      <div class="agent-block">
        <label class="agent-field">
          <span class="agent-label">Agent / workflow name</span>
          <input v-model="state.agentName" type="text" maxlength="120" class="agent-name-input" placeholder="e.g., Customer Support Bot" />
        </label>
        <label class="agent-field">
          <span class="agent-label">Short description</span>
          <input v-model="state.agentDescription" type="text" maxlength="240" class="agent-desc-input" placeholder="What does this agent do? Who does it act on?" />
        </label>
      </div>

      <div class="global-controls">
        <label class="containment">
          <span class="containment-label">Cycles containment (% of incidents prevented)</span>
          <div class="containment-row">
            <input type="range" min="0" max="100" step="5" v-model.number="state.containmentPct" class="containment-slider" @change="normalizeContainment" />
            <input type="number" min="0" max="100" step="1" v-model.number="state.containmentPct" class="containment-num" @change="normalizeContainment" @blur="normalizeContainment" />
            <span class="containment-pct">%</span>
          </div>
          <span class="containment-hint">Default 0% shows the unbounded blast radius. Dial up to see the value of runtime action authority.</span>
        </label>
      </div>

      <div class="table-wrap">
        <table class="risk-table">
          <thead>
            <tr>
              <th class="col-name">Action</th>
              <th class="col-cls">Rev.</th>
              <th class="col-cls">Vis.</th>
              <th class="col-num">$/action</th>
              <th class="col-num col-users">Users</th>
              <th class="col-num">$/user</th>
              <th class="col-num col-calls">Calls/day</th>
              <th class="col-num">Err %</th>
              <th class="col-sev">Sev.</th>
              <th class="col-money">Blast / mo</th>
              <th class="col-money">w/ Cycles</th>
              <th class="col-money">Δ / mo</th>
              <th class="col-rm" aria-label="Remove"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in computedRows"
              :key="i"
              :class="{
                catastrophic: row.isCatastrophic,
                biggest: row.monthlyRadius > 0 && row.monthlyRadius === biggestMonthly,
              }"
            >
              <td class="col-name">
                <span v-if="row.isCatastrophic" class="warn-badge" title="Irreversible + Public — highest blast-radius class">!</span>
                <input v-model="state.rows[i].name" type="text" class="name-input" :title="state.rows[i].name" />
              </td>
              <td class="col-cls">
                <select v-model="state.rows[i].reversibility" class="cls-select">
                  <option v-for="(v, k) in REVERSIBILITY" :key="k" :value="k">{{ v.label }}</option>
                </select>
              </td>
              <td class="col-cls">
                <select v-model="state.rows[i].visibility" class="cls-select">
                  <option v-for="(v, k) in VISIBILITY" :key="k" :value="k">{{ v.label }}</option>
                </select>
              </td>
              <td class="col-num"><input v-model.number="state.rows[i].costPerAction" type="number" min="0" step="1"   class="num-input" @change="normalizeRowNumber(i, 'costPerAction')" @blur="normalizeRowNumber(i, 'costPerAction')" /></td>
              <td class="col-num col-users"><input v-model.number="state.rows[i].affectedUsers" type="number" min="0" step="1"   class="num-input" @change="normalizeRowNumber(i, 'affectedUsers')" @blur="normalizeRowNumber(i, 'affectedUsers')" /></td>
              <td class="col-num"><input v-model.number="state.rows[i].costPerUser"   type="number" min="0" step="1"   class="num-input" @change="normalizeRowNumber(i, 'costPerUser')" @blur="normalizeRowNumber(i, 'costPerUser')" /></td>
              <td class="col-num col-calls"><input v-model.number="state.rows[i].callsPerDay"   type="number" min="0" step="100" class="num-input" @change="normalizeRowNumber(i, 'callsPerDay')" @blur="normalizeRowNumber(i, 'callsPerDay')" /></td>
              <td class="col-num"><input v-model.number="state.rows[i].errorRate"     type="number" min="0" max="100" step="0.1" class="num-input" @change="normalizeRowNumber(i, 'errorRate', 0, 100)" @blur="normalizeRowNumber(i, 'errorRate', 0, 100)" /></td>
              <td class="col-sev"><span class="sev-chip">{{ fmtFactor(row.severity) }}</span></td>
              <td class="col-money radius">{{ fmtMoney(row.monthlyRadius) }}</td>
              <td class="col-money">{{ fmtMoney(row.contained) }}</td>
              <td class="col-money delta">{{ fmtMoney(row.delta) }}</td>
              <td class="col-rm"><button type="button" class="row-remove" @click="removeRow(i)" aria-label="Remove row">×</button></td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="totals">
              <td colspan="9" class="totals-label">Total monthly blast radius</td>
              <td class="col-money radius">{{ fmtMoney(totals.monthly) }}</td>
              <td class="col-money">{{ fmtMoney(totals.contained) }}</td>
              <td class="col-money delta">{{ fmtMoney(totals.delta) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <button type="button" class="add-row" @click="addRow">+ Add action</button>
      </div>
    </div>

    <p class="disclaimer">
      <strong>Blast radius</strong> is the magnitude of damage that could occur if the action fires when it should not — a measure of risk exposure, not a prediction. Most attempts will not fire wrong; the radius is always present until something bounds it.
      Severity = reversibility (×1 / ×3 / ×10) + visibility (+0 / +1 / +4), additive.
      Examples: irreversible + customer-facing = ×11; irreversible + public = ×14 (the catastrophic class — flagged with !).
      Multipliers are illustrative defaults, not measured industry data — replace with figures from your own incident history.
      Containment is the share of incidents Cycles' runtime <a href="/concepts/action-authority-controlling-what-agents-do">action authority</a> would prevent before they fire; effectiveness depends on policy.
      For the full model, see the <a href="/guides/risk-and-blast-radius">Risk &amp; Blast Radius Reference</a>.
    </p>
  </section>
</template>

<style scoped>
.risk-calc {
  container-type: inline-size;
  margin: 24px 0;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.risk-calc.variant-standalone,
.risk-calc.variant-embed {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.capture-region { border-radius: 12px; }

.agent-block {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--vp-c-divider);
}
@container (min-width: 720px) {
  .agent-block { grid-template-columns: minmax(280px, 1fr) minmax(360px, 2fr); gap: 20px; }
}
.agent-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.agent-label {
  font-size: 11px; font-weight: 700;
  color: var(--vp-c-text-2);
  text-transform: uppercase; letter-spacing: 0.07em;
}
.agent-name-input,
.agent-desc-input {
  width: 100%; box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider); border-radius: 8px;
  background: var(--vp-c-bg); color: var(--vp-c-text-1);
  font: inherit;
}
.agent-name-input { font-weight: 700; font-size: 15px; }
.agent-desc-input { font-size: 13.5px; }
.agent-name-input:focus,
.agent-desc-input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); }

.global-controls { margin-bottom: 18px; }
.containment-label {
  display: block;
  font-size: 12px; font-weight: 600;
  color: var(--vp-c-text-2);
  text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.containment-row { display: flex; align-items: center; gap: 12px; }
.containment-slider { flex: 1; max-width: 360px; accent-color: var(--vp-c-brand-1); }
.containment-num {
  width: 70px; padding: 6px 10px;
  border: 1px solid var(--vp-c-divider); border-radius: 6px;
  background: var(--vp-c-bg); color: var(--vp-c-text-1);
  font: inherit; font-variant-numeric: tabular-nums; text-align: right;
}
.containment-pct { color: var(--vp-c-text-2); font-weight: 600; }
.containment-hint { display: block; margin-top: 6px; font-size: 12.5px; color: var(--vp-c-text-3); }

.table-wrap { overflow-x: auto; margin: 0 -4px; }
.risk-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px; font-variant-numeric: tabular-nums;
  table-layout: auto;
}
.risk-table th, .risk-table td {
  padding: 6px 6px;
  text-align: right;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
  vertical-align: middle;
}
.risk-table th {
  font-weight: 600; color: var(--vp-c-text-2);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
  border-bottom: 2px solid var(--vp-c-divider);
  padding-top: 8px; padding-bottom: 8px;
}
.col-name { text-align: left; padding-left: 4px; min-width: 220px; }
.col-cls  { text-align: left; min-width: 130px; }
/* Wider num cells so 5-6 digit values (10000, 100000) stay legible. */
.col-num  { width: 92px; }
.col-num.col-calls { width: 96px; } /* "Calls/day" carries the largest values */
.col-num.col-users { width: 96px; }
.col-sev  { width: 54px; }
.col-money { width: 92px; }
.col-rm   { width: 28px; padding-left: 0; padding-right: 4px; }

.col-name input { font-weight: 600; }

.name-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--vp-c-text-1); font: inherit;
  box-sizing: border-box;
  /* Inline ellipsis for overflow; the full value stays in the input
     and is also exposed via title="" for a hover tooltip. */
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.name-input:hover { border-color: var(--vp-c-divider); }
.name-input:focus {
  outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px;
  border-color: var(--vp-c-brand-1); background: var(--vp-c-bg);
  /* When focused, drop the ellipsis so the user can edit the full value
     comfortably. The browser will still horizontal-scroll inside the
     input as they type. */
  text-overflow: clip;
}

.cls-select {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--vp-c-divider); border-radius: 4px;
  background: var(--vp-c-bg); color: var(--vp-c-text-1);
  font: inherit; font-size: 12.5px;
  box-sizing: border-box;
}

.num-input {
  width: 100%;
  padding: 5px 7px;
  text-align: right;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--vp-c-text-1);
  font: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums;
  box-sizing: border-box;
}
.num-input:hover { border-color: var(--vp-c-divider); }
.num-input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); background: var(--vp-c-bg); }

.sev-chip {
  display: inline-block; padding: 2px 7px;
  border-radius: 999px; background: var(--vp-c-bg-mute);
  font-weight: 700; font-size: 12px;
}
.col-money.radius { font-weight: 600; }
.col-money.delta  { font-weight: 700; color: var(--vp-c-brand-1); }

.risk-table tr.biggest:not(.catastrophic) { background: rgba(217, 119, 6, 0.07); }
.risk-table tr.biggest .radius { color: #d97706; }

.risk-table tr.catastrophic {
  background: rgba(225, 29, 72, 0.08);
  outline: 2px solid rgba(225, 29, 72, 0.5);
  outline-offset: -2px;
}
.risk-table tr.catastrophic .sev-chip { background: #e11d48; color: #fff; }
.risk-table tr.catastrophic .radius   { color: #e11d48; font-weight: 700; }

.warn-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; margin-right: 5px;
  border-radius: 50%; background: #e11d48; color: #fff;
  font-weight: 700; font-size: 11px;
  vertical-align: middle;
}

.row-remove {
  width: 22px; height: 22px; padding: 0;
  border: 1px solid transparent; border-radius: 50%;
  background: transparent; color: var(--vp-c-text-3);
  font-size: 14px; line-height: 1; cursor: pointer; transition: all 0.15s;
}
.row-remove:hover { color: #e11d48; border-color: var(--vp-c-divider); background: var(--vp-c-bg-mute); }

tfoot .totals td { border-top: 2px solid var(--vp-c-divider); border-bottom: none; padding-top: 12px; font-size: 13.5px; }
.totals-label { text-align: right; font-weight: 600; color: var(--vp-c-text-2); text-transform: uppercase; font-size: 11px; letter-spacing: 0.03em; }

.add-row {
  margin-top: 12px; padding: 8px 14px;
  border: 1px dashed var(--vp-c-divider); border-radius: 8px;
  background: transparent; color: var(--vp-c-text-2);
  font: inherit; font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.add-row:hover { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); border-style: solid; }

.disclaimer {
  margin: 16px 0 0; padding: 10px 12px;
  font-size: 12.5px; line-height: 1.55; color: var(--vp-c-text-2);
  background: var(--vp-c-bg-mute); border-radius: 8px;
}
.disclaimer strong { color: var(--vp-c-text-1); }
</style>
