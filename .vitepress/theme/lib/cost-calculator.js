// Standard, uncached USD per million tokens. Verified against:
// https://developers.openai.com/api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
export const PRICING_VERIFIED_ON = '2026-11-12'

export function defaultModels() {
  return [
    { name: 'GPT-6 Astra', inputPerM: 10, outputPerM: 50 },
    { name: 'GPT-6.1 Sol', inputPerM: 2, outputPerM: 10 },
    { name: 'GPT-6.1 Terra', inputPerM: 1, outputPerM: 5 },
    { name: 'GPT-6 Luna', inputPerM: 0.1, outputPerM: 0.5 },
    { name: 'GPT-6 Sol', inputPerM: 2, outputPerM: 10 },
    { name: 'Claude Fable 5.2', inputPerM: 8, outputPerM: 40 },
    { name: 'Claude Opus 5.5', inputPerM: 4, outputPerM: 20 },
    { name: 'Claude Sonnet 5.5', inputPerM: 2, outputPerM: 10 },
    { name: 'Claude Haiku 5.5', inputPerM: 0.1, outputPerM: 0.5 },
  ]
}

const tieredGptModels = new Set([
  'GPT-6 Astra', 'GPT-6.1 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna', 'GPT-6 Sol',
])

// Blank, negative, nonnumeric, and nonfinite values must not look like free usage.
export function validNumber(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) >= 0
}

export function hydrateCostState(state, incoming) {
  if (typeof incoming.workloadName === 'string') state.workloadName = incoming.workloadName
  if (typeof incoming.workloadDescription === 'string') state.workloadDescription = incoming.workloadDescription
  for (const key of ['inputTokens', 'outputTokens', 'callsPerDay']) {
    if (typeof incoming[key] === 'number') state[key] = incoming[key]
  }
  if (Array.isArray(incoming.models)) {
    state.models = incoming.models
      .filter(m => m && typeof m.name === 'string')
      .map(m => ({ name: m.name, inputPerM: m.inputPerM ?? '', outputPerM: m.outputPerM ?? '' }))
    // Old links contain literal rates, possibly already adjusted for long context.
    // Never silently reprice them. Workload-only links still use current defaults.
    state.autoContextPricing = incoming.autoContextPricing === true
  } else if (typeof incoming.autoContextPricing === 'boolean') {
    state.autoContextPricing = incoming.autoContextPricing
  }
}

export function calculateCosts(state) {
  return state.models.map(model => {
    let inputMultiplier = 1
    let outputMultiplier = 1
    if (state.autoContextPricing) {
      if (tieredGptModels.has(model.name) && Number(state.inputTokens) > 272_000) {
        inputMultiplier = 2
        outputMultiplier = 1.5
      } else if (model.name === 'Claude Haiku 5.5' && Number(state.inputTokens) > 100_000) {
        inputMultiplier = 5
        outputMultiplier = 5
      }
    }
    const effectiveInputPerM = validNumber(model.inputPerM) ? Number(model.inputPerM) * inputMultiplier : NaN
    const effectiveOutputPerM = validNumber(model.outputPerM) ? Number(model.outputPerM) * outputMultiplier : NaN
    const valid = [state.inputTokens, state.outputTokens, state.callsPerDay,
      effectiveInputPerM, effectiveOutputPerM].every(validNumber)
    const perCall = valid
      ? (Number(state.inputTokens) * effectiveInputPerM + Number(state.outputTokens) * effectiveOutputPerM) / 1_000_000
      : NaN
    const perDay = perCall * Number(state.callsPerDay)
    return { ...model, effectiveInputPerM, effectiveOutputPerM,
      longContext: inputMultiplier > 1, perCall, perDay, perMonth: perDay * 30, perYear: perDay * 365 }
  })
}

export function cheapestAnnualCost(rows) {
  const totals = rows.map(r => r.perYear).filter(v => Number.isFinite(v) && v > 0)
  return totals.length ? Math.min(...totals) : 0
}

export function formatCost(value) {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 8 : 2,
  })
}

// Keep full numeric precision in CSV/Markdown, independent of display rounding.
export function costExportCells(rows) {
  return rows.map(r => [r.name, r.effectiveInputPerM, r.effectiveOutputPerM,
    r.perCall, r.perDay, r.perMonth, r.perYear]
    .map(value => typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '—') : value))
}
