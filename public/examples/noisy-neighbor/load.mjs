import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const runtime = 'http://runtime:7878'
const admin = 'http://admin:7979'
const run = randomUUID().slice(0, 8)
const token = { amount: 1, unit: 'TOKENS' }

async function post(base, path, headers, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (result.error ?? 'unknown'))
  return result
}

async function ready(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + '/actuator/health/readiness', { signal: AbortSignal.timeout(2000) })
      if ((await response.json()).status === 'UP') return
    } catch { /* A container can start before Spring accepts connections. */ }
    await sleep(1000)
  }
  throw new Error('Readiness timed out for ' + base)
}

async function tenant(index) {
  const id = 'neighbor-' + run + '-' + index
  const bootstrap = { 'X-Admin-API-Key': process.env.ADMIN_API_KEY }
  await post(admin, '/v1/admin/tenants', bootstrap, { tenant_id: id, name: id })
  const key = await post(admin, '/v1/admin/api-keys', bootstrap, {
    tenant_id: id, name: 'load', permissions: ['reservations:create', 'reservations:commit', 'budgets:write'],
  })
  const headers = { 'X-Cycles-API-Key': key.key_secret }
  await post(admin, '/v1/admin/budgets', headers, {
    scope: 'tenant:' + id, unit: 'TOKENS', allocated: { amount: 10000000, unit: 'TOKENS' },
  })
  return { id, headers }
}

async function lifecycle({ id, headers }) {
  const key = randomUUID()
  const reservation = await post(runtime, '/v1/reservations', headers, {
    idempotency_key: key, subject: { tenant: id }, action: { kind: 'llm.completion', name: 'load' },
    estimate: token, ttl_ms: 30000,
  })
  if (!reservation.reservation_id) throw new Error('Missing reservation ID')
  await post(runtime, '/v1/reservations/' + reservation.reservation_id + '/commit', headers, {
    idempotency_key: key + '-commit', actual: token,
  })
}

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.ceil(fraction * sorted.length) - 1].toFixed(2))
}

async function lane(tenants, rate, seconds, start) {
  const pending = new Set()
  const elapsed = []
  const launchLag = []
  const errors = {}
  let dropped = 0
  let timeouts = 0
  const planned = rate * seconds
  for (let i = 0; i < planned; i++) {
    const due = start + i * 1000 / rate
    while (performance.now() < due) await sleep(Math.max(1, due - performance.now()))
    const now = performance.now()
    if (now - due > 25 || pending.size >= 64) {
      dropped++
      continue
    }
    launchLag.push(now - due)
    const task = lifecycle(tenants[i % tenants.length])
      .then(() => elapsed.push(performance.now() - now))
      .catch(error => {
        if (error.name === 'TimeoutError') timeouts++
        else errors[error.message] = (errors[error.message] ?? 0) + 1
      })
      .finally(() => pending.delete(task))
    pending.add(task)
  }
  await Promise.all(pending)
  return { planned, completed: elapsed.length, dropped, timeouts, errors,
    p50_ms: percentile(elapsed, 0.50), p99_ms: percentile(elapsed, 0.99),
    launch_p99_ms: percentile(launchLag, 0.99) }
}

await Promise.all([ready(runtime), ready(admin)])
const quiet = await tenant(0)
const neighbors = []
for (let i = 1; i <= 16; i++) neighbors.push(await tenant(i))
for (const customer of [quiet, ...neighbors]) await lifecycle(customer)

async function measure(rate, count, seconds) {
  const start = performance.now() + 100
  const [probe, background] = await Promise.all([
    lane([quiet], 10, seconds, start), lane(neighbors.slice(0, count), rate, seconds, start),
  ])
  return { rate, count, seconds, probe, background }
}

const warmup = await measure(100, 16, 20)
if (warmup.probe.completed === 0 || warmup.background.completed === 0) {
  throw new Error('Warm-up failed: ' + JSON.stringify(warmup))
}
const scenarios = [[0, 0], [50, 1], [50, 16], [200, 1], [200, 16]]
for (const [round, order] of [scenarios, [...scenarios].reverse()].entries()) {
  for (const [rate, count] of order) {
    console.log(JSON.stringify({ round: round + 1, ...await measure(rate, count, 60) }))
  }
}
