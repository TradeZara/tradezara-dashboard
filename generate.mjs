// Gera index.html a partir da API do GitHub. Fonte da verdade do dashboard.
// Uso: GITHUB_TOKEN=<token de leitura da org> node generate.mjs
import { readFile, writeFile } from 'node:fs/promises'

const ORG = 'TradeZara'
const API = 'https://api.github.com'
const STATS_RETRIES = 6
const STATS_WAIT_MS = 5000
export const UNLINKED = 'sem conta vinculada'

// ---------- transformação pura (a costura testada) ----------

/** Resposta de /stats/contributors: 202 = ainda calculando, 200 + [] = pode ser
 *  cache frio ou repo sem contribuidores. Confundir os dois publica painel zerado. */
export function isStillComputing(status, contributors) {
  return status === 202 || (status === 200 && contributors.length === 0)
}

/** repos: [{ name, contributors: [{ author: {login} | null, total, weeks }] }] */
export function buildModel(repos, syncedAt) {
  const commits = new Map()
  for (const repo of repos) {
    for (const c of repo.contributors) {
      const login = c.author?.login ?? UNLINKED
      commits.set(login, (commits.get(login) ?? 0) + c.total)
    }
  }
  return {
    syncedAt,
    contributors: [...commits].sort((a, b) => b[1] - a[1]).map(([login, commits]) => ({ login, commits })),
    totals: {
      commits: [...commits.values()].reduce((a, b) => a + b, 0),
      prs: null, // ponytail: contagem real de PRs é a issue #3
      contributors: commits.size,
      repos: repos.length,
    },
  }
}

export function render(template, model) {
  const t = model.syncedAt
  const values = {
    SYNC_AT: t.toISOString().slice(0, 19).replace('T', ' ') + ' UTC',
    SYNC_DATE: t.toISOString().slice(0, 10),
    SYNC_AGO: 'JUST NOW',
    TOTAL_COMMITS: model.totals.commits,
    TOTAL_PRS: model.totals.prs ?? '—',
    TOTAL_CONTRIBUTORS: model.totals.contributors,
    TOTAL_REPOS: model.totals.repos,
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`placeholder desconhecido no template: ${match}`)
    return String(values[key])
  })
}

// ---------- I/O ----------

let rateLimit = {}

async function api(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  })
  rateLimit = {
    remaining: res.headers.get('x-ratelimit-remaining'),
    limit: res.headers.get('x-ratelimit-limit'),
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`credencial recusada pela API (${res.status}) em ${path}`)
  }
  if (!res.ok && res.status !== 202) throw new Error(`GET ${path} → ${res.status}`)
  const body = await res.text()
  return { status: res.status, json: body ? JSON.parse(body) : null, link: res.headers.get('link') ?? '' }
}

async function listRepos(token) {
  const repos = []
  for (let page = 1; ; page++) {
    const { json, link } = await api(token, `/orgs/${ORG}/repos?per_page=100&type=all&page=${page}`)
    repos.push(...json.filter(r => !r.archived))
    if (!link.includes('rel="next"')) return repos.map(r => r.name)
  }
}

async function fetchContributors(token, repo) {
  for (let attempt = 1; ; attempt++) {
    const { status, json } = await api(token, `/repos/${ORG}/${repo}/stats/contributors`)
    const contributors = Array.isArray(json) ? json : []
    if (!isStillComputing(status, contributors)) return contributors
    if (attempt > STATS_RETRIES) {
      if (status === 202) throw new Error(`${repo}: estatísticas ainda calculando após ${STATS_RETRIES} tentativas`)
      return [] // 200 + [] estável: repo realmente sem contribuidores
    }
    await new Promise(r => setTimeout(r, STATS_WAIT_MS))
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN ausente — o gerador não roda sem token de leitura da org')

  const names = await listRepos(token)
  const repos = []
  for (const name of names) {
    repos.push({ name, contributors: await fetchContributors(token, name) })
  }

  const model = buildModel(repos, new Date())
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8')
  await writeFile(new URL('./index.html', import.meta.url), render(template, model))

  console.log(`${repos.length} repos, ${model.totals.commits} commits, ${model.totals.contributors} contribuidores`)
  console.log(`rate limit: ${rateLimit.remaining}/${rateLimit.limit} restantes`)
}

if (process.argv[1]?.endsWith('generate.mjs')) {
  main().catch(err => {
    // falha atômica: nada foi escrito, o index.html publicado continua o de antes
    console.error(`ABORTADO sem escrever index.html — ${err.message}`)
    process.exit(1)
  })
}
