<script setup>
import { reactive, computed, ref, onMounted } from 'vue'
import CalculatorToolbar from './CalculatorToolbar.vue'
import { useCalcState } from './lib/calc-state.js'
import { PRICING_VERIFIED_ON, defaultModels, hydrateCostState, calculateCosts, cheapestAnnualCost, formatCost as fmt, costExportCells } from './lib/cost-calculator.js'
import { toMarkdownTable, toCsv, downloadText, captureElementToPng, copyText } from './lib/calc-export.js'

/*
  Defaults reflect each provider's published per-million-token pricing as of
  2026-11-12. Verify against the source before relying on these for budgeting:
   - OpenAI:    https://developers.openai.com/api/docs/pricing
   - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
  Standard API base rates in USD, without caching.
  Excludes batch/flex discounts, fine-tuning, fast/ultrafast modes, tools,
  and data-residency premiums. Published context tiers apply to known presets.
  Shared URLs deliberately preserve their saved models and editable rates.
*/

const props = defineProps({
  /** 'docs' | 'standalone' | 'embed' */
  variant:        { type: String, default: 'docs' },
  /** Standalone URL used by the Share button. Hash is appended automatically. */
  standalonePath: { type: String, default: '/calculators/claude-vs-gpt-cost-standalone' },
  /** Embed URL used by the Embed snippet. Hash is appended automatically. */
  embedPath:      { type: String, default: '/calculators/claude-vs-gpt-cost-embed' },
  /** Optional base64url-encoded state to seed initial values. Overridden by
   *  any state encoded in the page's URL hash, so shared links still win. */
  initialState:   { type: String, default: null },
})

const state = reactive({
  workloadName: '',
  workloadDescription: '',
  inputTokens:  2000,
  outputTokens: 800,
  callsPerDay:  10000,
  autoContextPricing: true,
  models: defaultModels(),
})

const calcState = useCalcState(state, {
  initialStateB64: props.initialState,
  hydrate(incoming) {
    hydrateCostState(state, incoming)
  },
})

function addModel() {
  state.models.push({ name: 'New model', inputPerM: 0, outputPerM: 0 })
}
function removeModel(i) {
  state.models.splice(i, 1)
}
function resetModels() {
  state.models = defaultModels()
  state.autoContextPricing = true
}

const rows = computed(() => calculateCosts(state))
const cheapestPerYear = computed(() => cheapestAnnualCost(rows.value))
const hasInvalidCosts = computed(() => rows.value.some(row => !Number.isFinite(row.perYear)))
// URL state can differ from the server-rendered defaults. Vue does not repair
// class mismatches during production hydration, so apply highlights after mount.
const mounted = ref(false)
onMounted(() => { mounted.value = true })

// ---- Export -----------------------------------------------------------------

const tableRef = ref(null)

function exportRowsHeaders() {
  return ['Model', 'Effective input USD/M', 'Effective output USD/M', 'Per call USD', 'Per day USD', 'Per 30-day month USD', 'Per 365-day year USD']
}
function exportRowsCells() {
  return costExportCells(rows.value)
}

function exportSummary() {
  return `${state.inputTokens} input + ${state.outputTokens} output tokens · ${state.callsPerDay.toLocaleString()} calls/day · ${state.autoContextPricing ? 'Published context tiers for preset names' : 'Manual rates'} · USD, uncached standard API · 30-day month / 365-day year`
}

function brandMeta() {
  return {
    calcName: 'Cost Calculator',
    subjectLabel: 'Workload',
    subjectName: state.workloadName?.trim() || 'Untitled workload',
    subjectDescription: state.workloadDescription?.trim() || '',
    sourceUrl: typeof window !== 'undefined' ? calcState.standaloneUrl(props.standalonePath) : 'https://runcycles.io/calculators',
    summary: exportSummary(),
  }
}

function safeFilenamePart() {
  const base = (state.workloadName || 'cost').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'cost'
}

async function copyMarkdown() {
  const md = toMarkdownTable(exportRowsHeaders(), exportRowsCells(), {
    brand: brandMeta(),
  })
  const ok = await copyText(md)
  if (!ok) throw new Error('clipboard unavailable')
}

function downloadCsv() {
  const csv = toCsv(exportRowsHeaders(), exportRowsCells(), { brand: brandMeta() })
  downloadText(`cycles-cost-${safeFilenamePart()}.csv`, csv, 'text/csv;charset=utf-8')
}

async function downloadPng() {
  if (!tableRef.value) throw new Error('no element')
  await captureElementToPng(tableRef.value, {
    filename: `cycles-cost-${safeFilenamePart()}.png`,
    brand: brandMeta(),
  })
}
</script>

<template>
  <section class="cost-calc" :class="`variant-${variant}`">
    <CalculatorToolbar
      v-if="variant !== 'embed'"
      calc-name="cost"
      :share-url="() => calcState.standaloneUrl(standalonePath)"
      :embed-url="() => calcState.embedUrl(embedPath)"
      :on-copy-markdown="copyMarkdown"
      :on-download-csv="downloadCsv"
      :on-download-png="downloadPng"
    />

    <label class="context-option">
      <input v-model="state.autoContextPricing" type="checkbox" />
      Apply published long-context multipliers to preset model names
    </label>

    <div ref="tableRef" class="capture-region">
      <div class="workload-block">
        <label class="workload-field">
          <span class="workload-label">Workload name (optional)</span>
          <input v-model="state.workloadName" type="text" maxlength="120" class="workload-name-input" placeholder="e.g., Tier-1 support chatbot" />
        </label>
        <label class="workload-field">
          <span class="workload-label">Short description (optional)</span>
          <input v-model="state.workloadDescription" type="text" maxlength="240" class="workload-desc-input" placeholder="What does this workload do?" />
        </label>
      </div>

      <div class="inputs">
        <label class="field">
          <span class="field-label">Input tokens / call</span>
          <input v-model.number="state.inputTokens" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span class="field-label">Billed output tokens / call</span>
          <input v-model.number="state.outputTokens" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span class="field-label">Calls / day</span>
          <input v-model.number="state.callsPerDay" type="number" min="0" step="any" />
        </label>
      </div>

      <div class="table-wrap">
        <p class="pricing-scope">
          USD · Standard uncached API · Month = 30 days · Year = 365 days.
          Check model context and output limits before budgeting a request.
        </p>
        <p class="pricing-scope" v-if="state.autoContextPricing">
          Enter base rates. Above 272K input tokens: GPT presets use 2× input / 1.5× output.
          Above 100K: Haiku 5.5 uses 5× both rates. Multipliers apply to the whole call,
          including edited base rates. Other names use the entered rates unchanged.
        </p>
        <p class="pricing-scope" v-else>
          Manual pricing: entered rates are used unchanged. Older shared links keep this behavior;
          enable context pricing only if the entered rates are base rates.
        </p>
        <p v-if="hasInvalidCosts" class="input-error" role="status">
          Enter finite, nonnegative token counts, call counts, and rates. Invalid or overflowing totals show —.
        </p>
        <table class="cost-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>{{ state.autoContextPricing ? 'Base input' : 'Input' }} $ / M</th>
              <th>{{ state.autoContextPricing ? 'Base output' : 'Output' }} $ / M</th>
              <th>Per call</th>
              <th>Per day</th>
              <th>Per month</th>
              <th>Per year</th>
              <th aria-label="Remove"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i" :class="{ best: mounted && row.perYear > 0 && row.perYear === cheapestPerYear }">
              <td>
                <input v-model="state.models[i].name" type="text" class="name-input" aria-label="Model name" />
                <small v-if="row.longContext" class="tier-note">Long context: {{ fmt(row.effectiveInputPerM) }} in / {{ fmt(row.effectiveOutputPerM) }} out per M</small>
              </td>
              <td><input v-model.number="state.models[i].inputPerM" type="number" min="0" step="any" class="rate-input" :aria-label="`${row.name} input rate per million tokens`" /></td>
              <td><input v-model.number="state.models[i].outputPerM" type="number" min="0" step="any" class="rate-input" :aria-label="`${row.name} output rate per million tokens`" /></td>
              <td>{{ fmt(row.perCall) }}</td>
              <td>{{ fmt(row.perDay) }}</td>
              <td>{{ fmt(row.perMonth) }}</td>
              <td class="year-cell">{{ fmt(row.perYear) }}</td>
              <td><button type="button" class="row-remove" @click="removeModel(i)" aria-label="Remove model">×</button></td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="add-row" @click="addModel">+ Add model</button>
        <button type="button" class="add-row reset-models" @click="resetModels">Replace rows with latest presets</button>
      </div>
    </div>

    <p class="disclaimer">
      Default rates last verified on {{ PRICING_VERIFIED_ON }} against
      <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener">OpenAI</a>
      and
      <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener">Anthropic</a>;
      edit any cell to match your contracted rate. Shared links keep their saved rates, which may be older.
      Daily cost: <code>(input_tokens × effective_input_$/M + output_tokens × effective_output_$/M) ÷ 1,000,000 × calls/day</code>.
      Excludes cache reads/writes, batch/flex discounts, fine-tuning, fast/ultrafast modes, tool fees,
      and data-residency premiums. Custom or renamed models need their own applicable rates.
      Include billed reasoning/thinking tokens in output totals. Token counts vary by tokenizer;
      the same text can use different token counts across models.
    </p>
  </section>
</template>

<style scoped>
.cost-calc {
  container-type: inline-size;
  margin: 24px 0;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.cost-calc.variant-standalone,
.cost-calc.variant-embed {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.capture-region {
  border-radius: 12px;
}

.workload-block {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}
@container (min-width: 720px) {
  .workload-block { grid-template-columns: minmax(220px, 1fr) minmax(280px, 2fr); gap: 18px; }
}
.workload-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.workload-label {
  font-size: 11px; font-weight: 700;
  color: var(--vp-c-text-2);
  text-transform: uppercase; letter-spacing: 0.07em;
}
.workload-name-input,
.workload-desc-input {
  width: 100%; box-sizing: border-box;
  padding: 7px 11px;
  border: 1px solid var(--vp-c-divider); border-radius: 8px;
  background: var(--vp-c-bg); color: var(--vp-c-text-1);
  font: inherit;
  font-size: 13.5px;
}
.workload-name-input { font-weight: 700; font-size: 14.5px; }
.workload-name-input:focus,
.workload-desc-input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); }

.inputs {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 20px;
}
@container (min-width: 600px) { .inputs { grid-template-columns: repeat(3, 1fr); } }

.field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.field input {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.field input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); }

.table-wrap { overflow-x: auto; margin: 0 -4px; }
.pricing-scope { margin: 0 4px 12px; font-size: 12.5px; color: var(--vp-c-text-2); }
.context-option { display: flex; align-items: center; gap: 8px; margin: 0 4px 8px; font-size: 13px; }
.context-option input { appearance: auto; }
.tier-note { display: block; font-size: 11px; color: var(--vp-c-text-2); }
.input-error { color: var(--vp-c-danger-1); font-size: 13px; }
.reset-models { margin-left: 12px; }
.cost-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.cost-table th, .cost-table td {
  padding: 10px 12px;
  text-align: right;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}
.cost-table th {
  text-align: right;
  font-weight: 600;
  color: var(--vp-c-text-2);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 2px solid var(--vp-c-divider);
}
.cost-table th:first-child, .cost-table td:first-child { text-align: left; }
.year-cell  { font-weight: 600; }

.name-input {
  width: 160px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  font-weight: 600;
}
.name-input:hover { border-color: var(--vp-c-divider); }
.name-input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); background: var(--vp-c-bg); }

.rate-input {
  width: 80px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.rate-input:hover  { border-color: var(--vp-c-divider); }
.rate-input:focus  { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--vp-c-brand-1); background: var(--vp-c-bg); }

.cost-table tr.best { background: rgba(var(--vp-c-brand-1-rgb, 100 108 255), 0.06); }
.cost-table tr.best .year-cell { color: var(--vp-c-brand-1); }

.row-remove {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}
.row-remove:hover { color: var(--vp-c-danger-1, #e11d48); border-color: var(--vp-c-divider); background: var(--vp-c-bg-mute); }

.add-row {
  margin-top: 12px;
  padding: 8px 14px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.add-row:hover { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); border-style: solid; }

.disclaimer {
  margin: 16px 0 0;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-mute);
  border-radius: 8px;
}
.disclaimer code {
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--vp-c-bg);
}
</style>
