const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const sum = values => Object.values(values ?? {}).reduce((total, value) => total + count(value), 0)

// Reconcile the same manual sources used by installs.data.ts. A partial or
// unavailable GHCR response must not erase manually recorded package counts.
export function reconcileManualCounts(cache, manual = {}, fetchedPackages = {}) {
  const packages = { ...manual.ghPackages }
  for (const [name, value] of Object.entries(fetchedPackages)) {
    packages[name] = Math.max(count(packages[name]), count(value))
  }
  const ghPackages = Math.max(count(cache.ghPackages), sum(packages))
  const maven = Math.max(count(cache.maven), sum(manual.maven))
  const total = ['npm', 'pypi', 'crates', 'releases']
    .reduce((total, key) => total + count(cache[key]), ghPackages + maven)

  return {
    cache: { ...cache, ghPackages, maven, total: Math.max(total, count(cache.total)) },
    manual: { ...manual, ghPackages: packages },
  }
}
