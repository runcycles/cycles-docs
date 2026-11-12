import { describe, expect, it } from 'vitest'
import {
  defaultModels, hydrateCostState, calculateCosts, cheapestAnnualCost,
  validNumber, formatCost, costExportCells, PRICING_VERIFIED_ON,
} from '../lib/cost-calculator.js'

function workload(overrides = {}) {
  return { workloadName: '', workloadDescription: '', inputTokens: 2000,
    outputTokens: 800, callsPerDay: 10000, autoContextPricing: true,
    models: defaultModels(), ...overrides }
}

describe('cost calculator', () => {
  it('contains the verified current standard rates and returns independent presets', () => {
    expect(PRICING_VERIFIED_ON).toBe('2026-11-12')
    expect(defaultModels().map(m => [m.name, m.inputPerM, m.outputPerM])).toEqual([
      ['GPT-6 Astra', 10, 50], ['GPT-6.1 Sol', 2, 10], ['GPT-6.1 Terra', 1, 5],
      ['GPT-6 Luna', 0.1, 0.5], ['GPT-6 Sol', 2, 10], ['Claude Fable 5.2', 8, 40],
      ['Claude Opus 5.5', 4, 20], ['Claude Sonnet 5.5', 2, 10], ['Claude Haiku 5.5', 0.1, 0.5],
    ])
    const models = defaultModels()
    models[0].inputPerM = 999
    expect(defaultModels()[0].inputPerM).toBe(10)
  })

  it('calculates independently checked daily, monthly and annual totals', () => {
    const rows = calculateCosts(workload())
    expect(rows[1]).toMatchObject({ perCall: 0.012, perDay: 120, perMonth: 3600, perYear: 43800 })
    expect(rows[5]).toMatchObject({ perCall: 0.048, perDay: 480, perMonth: 14400, perYear: 175200 })
    expect(rows[3].perYear).toBeCloseTo(2190)
    expect(rows[8].perYear).toBeCloseTo(2190)
    expect(cheapestAnnualCost(rows)).toBeCloseTo(2190)
  })

  it.each([272000, 272001])('applies GPT tiers strictly above 272K, across the entire request: %s', inputTokens => {
    const rows = calculateCosts(workload({ inputTokens, outputTokens: 1000, callsPerDay: 1 }))
    for (const row of rows.slice(0, 5)) {
      const long = inputTokens > 272000
      expect(row.longContext).toBe(long)
      expect(row.effectiveInputPerM).toBe(row.inputPerM * (long ? 2 : 1))
      expect(row.effectiveOutputPerM).toBe(row.outputPerM * (long ? 1.5 : 1))
    }
    expect(rows[1].perCall).toBeCloseTo(inputTokens === 272000 ? 0.554 : 1.103004)
  })

  it.each([100000, 100001])('applies Haiku tiers strictly above 100K: %s', inputTokens => {
    const rows = calculateCosts(workload({ inputTokens, outputTokens: 1000 }))
    expect(rows[8].perCall).toBeCloseTo(inputTokens === 100000 ? 0.0105 : 0.0525005)
    for (const row of rows.slice(5, 8)) expect(row.longContext).toBe(false)
    expect(rows[1].longContext).toBe(false)
  })

  it('uses edited base rates for tiers, with manual override and unknown names left alone', () => {
    const state = workload({ inputTokens: 300000, outputTokens: 1000,
      models: [{ name: 'GPT-6.1 Sol', inputPerM: 1, outputPerM: 4 }] })
    expect(calculateCosts(state)[0].perCall).toBeCloseTo(0.606)
    state.autoContextPricing = false
    expect(calculateCosts(state)[0].perCall).toBeCloseTo(0.304)
    state.autoContextPricing = true
    state.models[0].name = 'Custom model'
    expect(calculateCosts(state)[0].perCall).toBeCloseTo(0.304)
  })

  it.each(['', ' ', -1, NaN, Infinity, -Infinity, 'abc', null, undefined, {}, true])('rejects invalid numeric value %s', value => {
    expect(validNumber(value)).toBe(false)
    for (const key of ['inputTokens', 'outputTokens', 'callsPerDay']) {
      expect(calculateCosts(workload({ [key]: value }))[0].perYear).toBeNaN()
    }
    const rows = calculateCosts(workload({ models: [{ name: 'Invalid', inputPerM: value, outputPerM: value }] }))
    expect(rows[0].perCall).toBeNaN()
    expect(cheapestAnnualCost(rows)).toBe(0)
    expect(costExportCells(rows)[0].slice(1)).toEqual(Array(6).fill('—'))
  })

  it('handles zero, numeric strings, empty lists and arithmetic overflow', () => {
    expect(validNumber(0)).toBe(true)
    expect(validNumber('0.125')).toBe(true)
    expect(calculateCosts(workload({ inputTokens: '2000' }))[1].perCall).toBe(0.012)
    expect(calculateCosts(workload({ callsPerDay: 0 }))[0].perYear).toBe(0)
    expect(cheapestAnnualCost(calculateCosts(workload({ inputTokens: 0, outputTokens: 0 })))).toBe(0)
    expect(calculateCosts(workload({ models: [] }))).toEqual([])
    const rows = calculateCosts(workload({ inputTokens: 1_000_000, callsPerDay: Number.MAX_VALUE }))
    expect(cheapestAnnualCost(rows)).toBe(0)
    expect(formatCost(rows[0].perYear)).toBe('—')
  })

  it('retains saved rates and disables automatic tiers for legacy links', () => {
    const state = workload()
    hydrateCostState(state, { workloadName: 'Saved', workloadDescription: 'Contract',
      inputTokens: 300000, outputTokens: 1000, callsPerDay: 1,
      models: [null, {}, { name: 'GPT-6.1 Sol', inputPerM: 4, outputPerM: 15 }] })
    expect(state.workloadName).toBe('Saved')
    expect(state.workloadDescription).toBe('Contract')
    expect(state.models).toHaveLength(1)
    expect(state.autoContextPricing).toBe(false)
    expect(calculateCosts(state)[0].perCall).toBe(1.215)
  })

  it('round-trips new configurations and preserves workload-only link defaults', () => {
    const state = workload({ inputTokens: 300000 })
    const restored = workload()
    hydrateCostState(restored, JSON.parse(JSON.stringify(state)))
    expect(calculateCosts(restored)).toEqual(calculateCosts(state))
    hydrateCostState(restored, { inputTokens: 1000 })
    expect(restored.autoContextPricing).toBe(true)
    hydrateCostState(restored, { autoContextPricing: false })
    expect(restored.autoContextPricing).toBe(false)
    hydrateCostState(restored, { inputTokens: 'bad', models: 'bad' })
    expect(restored.inputTokens).toBe(1000)
    hydrateCostState(restored, { models: [{ name: 'Missing rates' }] })
    expect(calculateCosts(restored)[0].perYear).toBeNaN()
  })

  it('displays small costs and cents, and exports effective rates without display rounding', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.0000001)).toBe('$0.0000001')
    expect(formatCost(123.45)).toBe('$123.45')
    const rows = calculateCosts(workload({ inputTokens: 300000, outputTokens: 1, callsPerDay: 1 }))
    expect(costExportCells(rows)[1]).toEqual([
      'GPT-6.1 Sol', '4', '15', String(rows[1].perCall), String(rows[1].perDay),
      String(rows[1].perMonth), String(rows[1].perYear),
    ])
    expect(costExportCells(rows)[1][3]).toBe('1.200015')
  })
})
