import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DOCS_ROOT = resolve(__dirname, '..')

export const COMPONENTS = [
  {
    docsLabel: 'Protocol spec (runtime)',
    repo: 'cycles-protocol',
    manifest: 'cycles-protocol-v0.yaml',
    format: 'yaml-info',
    versionSelection: 'last',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [
      { path: 'protocol/index.md', needle: 'cycles-protocol' },
      {
        path: 'protocol/reservation-ttl-grace-period-and-extend-in-cycles.md',
        needle: 'remaining_ttl_ms',
      },
    ],
  },
  {
    docsLabel: 'Governance spec (admin)',
    repo: 'cycles-protocol',
    manifest: 'cycles-governance-admin-v0.1.25.yaml',
    format: 'yaml-info',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [{ path: 'protocol/index.md', needle: 'cycles-governance-admin' }],
  },
  {
    docsLabel: 'cycles-server (runtime)',
    repo: 'cycles-server',
    manifest: 'cycles-protocol-service/pom.xml',
    format: 'maven-revision',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [{ path: 'quickstart/self-hosting-the-cycles-server.md', needle: 'cycles-server' }],
  },
  {
    docsLabel: 'cycles-server-admin',
    repo: 'cycles-server-admin',
    manifest: 'cycles-admin-service/pom.xml',
    format: 'maven-revision',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [{ path: 'admin-api/guide.md', needle: 'cycles-server-admin' }],
  },
  {
    docsLabel: 'cycles-server-events',
    repo: 'cycles-server-events',
    manifest: 'pom.xml',
    format: 'maven-revision',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [{ path: 'quickstart/deploying-the-events-service.md', needle: 'cycles-server-events' }],
  },
  {
    docsLabel: 'cycles-dashboard',
    repo: 'cycles-dashboard',
    manifest: 'package.json',
    format: 'json',
    versionDocs: ['how-to/upgrading-cycles.md'],
    docs: [{ path: 'quickstart/deploying-the-cycles-dashboard.md', needle: 'cycles-dashboard' }],
  },
  {
    docsLabel: 'cycles-client-typescript',
    repo: 'cycles-client-typescript',
    manifest: 'package.json',
    format: 'json',
    docs: [
      { path: 'quickstart/getting-started-with-the-typescript-client.md', needle: '`runcycles`' },
      {
        path: 'configuration/typescript-client-configuration-reference.md',
        needle: '`journalEnabled`',
      },
    ],
  },
  {
    docsLabel: 'cycles-client-rust',
    repo: 'cycles-client-rust',
    manifest: 'Cargo.toml',
    format: 'toml-package',
    docs: [
      { path: 'quickstart/getting-started-with-the-rust-client.md', needle: '`runcycles`' },
      {
        path: 'configuration/rust-client-configuration-reference.md',
        needle: '`journal_enabled`',
      },
    ],
  },
  {
    docsLabel: 'cycles-client-python',
    repo: 'cycles-client-python',
    manifest: 'pyproject.toml',
    format: 'toml-project',
    docs: [
      { path: 'quickstart/getting-started-with-the-python-client.md', needle: '`runcycles`' },
      {
        path: 'configuration/python-client-configuration-reference.md',
        needle: '`journal_enabled`',
      },
    ],
  },
  {
    docsLabel: 'cycles-spring-boot-starter',
    repo: 'cycles-spring-boot-starter',
    manifest: 'cycles-client-java-spring/pom.xml',
    format: 'maven-revision',
    docs: [
      {
        path: 'configuration/client-configuration-reference-for-cycles-spring-boot-starter.md',
        needle: 'cycles-spring-boot-starter',
      },
      {
        path: 'configuration/client-configuration-reference-for-cycles-spring-boot-starter.md',
        needle: '`cycles.journal.enabled`',
      },
    ],
  },
  {
    docsLabel: 'cycles-mcp-server',
    repo: 'cycles-mcp-server',
    manifest: 'package.json',
    format: 'json',
    docs: [{
      path: 'quickstart/getting-started-with-the-mcp-server.md',
      needle: '@runcycles/mcp-server',
    }],
  },
  {
    docsLabel: 'cycles-openai-agents',
    repo: 'cycles-openai-agents',
    manifest: 'pyproject.toml',
    format: 'toml-project',
    docs: [{
      path: 'how-to/integrating-cycles-with-openai-agents.md',
      needle: 'cycles-openai-agents',
    }],
  },
  {
    docsLabel: 'cycles-openclaw-budget-guard',
    repo: 'cycles-openclaw-budget-guard',
    manifest: 'package.json',
    format: 'json',
    docs: [{
      path: 'how-to/integrating-cycles-with-openclaw.md',
      needle: 'cycles-openclaw-budget-guard',
    }],
  },
  {
    docsLabel: 'cycles-claude-plugin',
    repo: 'cycles-claude-plugin',
    manifest: 'package.json',
    format: 'json',
    docs: [{
      path: 'how-to/enforcing-budgets-in-claude-code-with-budget-guard.md',
      needle: 'cycles-claude-plugin',
    }],
  },
  {
    docsLabel: 'langchain-runcycles',
    repo: 'langchain-runcycles',
    manifest: 'pyproject.toml',
    format: 'toml-project',
    docs: [{
      path: 'how-to/integrating-cycles-with-langchain.md',
      needle: 'langchain-runcycles',
    }],
  },
  {
    docsLabel: 'cycles-spring-ai-starter',
    repo: 'cycles-spring-ai-starter',
    manifest: 'cycles-spring-ai-starter/pom.xml',
    format: 'maven-revision',
    versionDocs: ['configuration/spring-ai-starter-configuration-reference.md'],
    docs: [{
      path: 'configuration/spring-ai-starter-configuration-reference.md',
      needle: 'cycles-spring-ai-starter',
    }],
    propertyCoverage: {
      source: 'cycles-spring-ai-starter/src/main/java/io/runcycles/client/java/springai/autoconfigure/CyclesSpringAiProperties.java',
      docs: 'configuration/spring-ai-starter-configuration-reference.md',
      prefix: 'cycles.spring-ai.',
    },
  },
  {
    docsLabel: 'cycles-ap2-python',
    repo: 'cycles-ap2-python',
    manifest: 'pyproject.toml',
    format: 'toml-project',
    docs: [{ path: 'how-to/ecosystem.md', needle: 'cycles-ap2-python' }],
  },
]

function normalizeLabel(value) {
  return value
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function semverValues(value) {
  return [...value.matchAll(/v?(\d+\.\d+\.\d+(?:\.\d+)?)/g)].map(match => match[1])
}

export function parseCurrentVersionTable(markdown) {
  const marker = '### Current versions'
  const start = markdown.indexOf(marker)
  if (start === -1) {
    throw new Error(`Could not find "${marker}" in changelog.md`)
  }

  const afterMarker = markdown.slice(start + marker.length)
  const nextSection = afterMarker.search(/^###\s+/m)
  const section = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection)
  const versions = new Map()

  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
    if (cells.length < 2 || /^[-:]+$/.test(cells[0])) continue
    const values = semverValues(cells[1])
    if (values.length > 0) {
      versions.set(normalizeLabel(cells[0]), {
        raw: cells[1],
        values,
      })
    }
  }

  return versions
}

function tomlSection(content, sectionName) {
  const lines = content.split(/\r?\n/)
  let active = false
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)
    if (section) {
      active = section[1] === sectionName
      continue
    }
    if (!active) continue
    const version = line.match(/^\s*version\s*=\s*["']([^"']+)["']/)
    if (version) return version[1]
  }
  throw new Error(`No version found in TOML section [${sectionName}]`)
}

export function extractManifestVersion(content, format) {
  switch (format) {
    case 'json':
      return JSON.parse(content).version
    case 'maven-revision': {
      const match = content.match(/<revision>\s*([^<\s]+)\s*<\/revision>/)
      if (!match) throw new Error('No <revision> found in Maven manifest')
      return match[1]
    }
    case 'toml-project':
      return tomlSection(content, 'project')
    case 'toml-package':
      return tomlSection(content, 'package')
    case 'yaml-info': {
      const lines = content.split(/\r?\n/)
      const infoIndex = lines.findIndex(line => /^info:\s*$/.test(line))
      if (infoIndex === -1) throw new Error('No top-level info block found in YAML')
      for (let i = infoIndex + 1; i < lines.length; i += 1) {
        if (/^\S/.test(lines[i])) break
        const match = lines[i].match(/^\s{2}version:\s*["']?([^"'\s]+)["']?\s*$/)
        if (match) return match[1]
      }
      throw new Error('No info.version found in YAML')
    }
    default:
      throw new Error(`Unsupported manifest format: ${format}`)
  }
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

export function extractSpringPropertyNames(content, prefix) {
  const fields = [...content.matchAll(
    /^\s*private\s+(?:boolean|long|String)\s+([a-z][A-Za-z0-9]*)\s*=/gm,
  )]
  return fields.map(match => `${prefix}${camelToKebab(match[1])}`)
}

function readImplementationFile(repoRoot, relativePath, gitRef) {
  if (!gitRef) {
    return readFileSync(resolve(repoRoot, relativePath), 'utf8')
  }
  return execFileSync(
    'git',
    ['-C', repoRoot, 'show', `${gitRef}:${relativePath.replaceAll('\\', '/')}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

export function checkImplementationDrift({
  docsRoot = DEFAULT_DOCS_ROOT,
  implementationsRoot = resolve(docsRoot, '..'),
  gitRef,
  components = COMPONENTS,
} = {}) {
  const errors = []
  const changelogPath = resolve(docsRoot, 'changelog.md')
  const documented = parseCurrentVersionTable(readFileSync(changelogPath, 'utf8'))

  for (const component of components) {
    const repoRoot = resolve(implementationsRoot, component.repo)
    if (!existsSync(repoRoot)) {
      errors.push(`${component.repo}: implementation checkout not found at ${repoRoot}`)
      continue
    }

    const docsVersion = documented.get(normalizeLabel(component.docsLabel))
    if (!docsVersion) {
      errors.push(`${component.docsLabel}: missing from changelog.md current versions`)
      continue
    }

    let implementationVersion
    try {
      const manifest = readImplementationFile(repoRoot, component.manifest, gitRef)
      implementationVersion = extractManifestVersion(manifest, component.format)
      const selection = component.versionSelection === 'last'
        ? docsVersion.values.at(-1)
        : docsVersion.values[0]
      if (selection !== implementationVersion) {
        errors.push(
          `${component.docsLabel}: docs=${selection} implementation=${implementationVersion} `
          + `(${component.repo}/${component.manifest})`,
        )
      }
    } catch (error) {
      errors.push(`${component.repo}: ${error.message}`)
    }

    if (implementationVersion) {
      for (const versionDoc of component.versionDocs ?? []) {
        const docPath = resolve(docsRoot, versionDoc)
        if (!existsSync(docPath)) {
          errors.push(`${component.repo}: version-bearing page missing: ${versionDoc}`)
          continue
        }
        const content = readFileSync(docPath, 'utf8')
        if (!content.includes(implementationVersion)) {
          errors.push(
            `${component.repo}: ${versionDoc} does not contain current version `
            + implementationVersion,
          )
        }
      }
    }

    for (const requiredDoc of component.docs) {
      const docPath = resolve(docsRoot, requiredDoc.path)
      if (!existsSync(docPath)) {
        errors.push(`${component.repo}: required documentation page missing: ${requiredDoc.path}`)
        continue
      }
      const content = readFileSync(docPath, 'utf8')
      if (!content.includes(requiredDoc.needle)) {
        errors.push(
          `${component.repo}: ${requiredDoc.path} does not mention ${requiredDoc.needle}`,
        )
      }
    }

    if (component.propertyCoverage) {
      try {
        const source = readImplementationFile(
          repoRoot,
          component.propertyCoverage.source,
          gitRef,
        )
        const docs = readFileSync(resolve(docsRoot, component.propertyCoverage.docs), 'utf8')
        const properties = extractSpringPropertyNames(
          source,
          component.propertyCoverage.prefix,
        )
        for (const property of properties) {
          if (!docs.includes(`\`${property}\``)) {
            errors.push(
              `${component.repo}: ${component.propertyCoverage.docs} is missing ${property}`,
            )
          }
        }
      } catch (error) {
        errors.push(`${component.repo} property coverage: ${error.message}`)
      }
    }
  }

  return errors
}

function parseArgs(argv) {
  const result = {
    docsRoot: DEFAULT_DOCS_ROOT,
    implementationsRoot: resolve(DEFAULT_DOCS_ROOT, '..'),
    gitRef: undefined,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      result.implementationsRoot = resolve(argv[++i])
    } else if (argv[i] === '--docs-root') {
      result.docsRoot = resolve(argv[++i])
    } else if (argv[i] === '--git-ref') {
      result.gitRef = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return result
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const errors = checkImplementationDrift(options)
    if (errors.length > 0) {
      console.error('Documentation implementation drift detected:')
      for (const error of errors) console.error(`- ${error}`)
      process.exitCode = 1
    } else {
      console.log(`Documentation matches ${COMPONENTS.length} implementation sources.`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
