// Gera index.html a partir da API do GitHub. Fonte da verdade do dashboard.
// Uso: GITHUB_TOKEN=<token de leitura da org> node generate.mjs
import { readFile, writeFile } from 'node:fs/promises'

const ORG = 'TradeZara'
const API = 'https://api.github.com'
const STATS_RETRIES = 6
const STATS_WAIT_MS = 5000
const WEEKS = 12
const TOP = 5
const COLORS = ['#00ff41', '#ff0055', '#00d4ff', '#ffbb00', '#bf00ff']
const RANK_ICONS = ['👑', '⚡', '🔥', '💎', '🚀']
const SPARK_MIN = 3
const SPARK_MAX = 30
const RECENCY_ZERO_DAYS = 365 // atividade mais velha que isso zera o eixo de recência do radar
const DAY = 86400
export const UNLINKED = 'sem conta vinculada'

// ---------- transformação pura (a costura testada) ----------

/** Resposta de /stats/contributors: 202 = ainda calculando, 200 + [] = pode ser
 *  cache frio ou repo sem contribuidores. Confundir os dois publica painel zerado. */
export function isStillComputing(status, contributors) {
  return status === 202 || (status === 200 && contributors.length === 0)
}

const iso = epochSeconds => new Date(epochSeconds * 1000).toISOString().slice(0, 10)

/** repos: [{ name, contributors: [{ author, total, weeks }], pulls: [{ user, merged_at }] }] */
export function buildModel(repos, syncedAt) {
  const people = new Map()
  const person = login => {
    if (!people.has(login)) {
      people.set(login, { login, avatar: null, commits: 0, prs: 0, repos: [], weeks: new Map() })
    }
    return people.get(login)
  }

  for (const repo of repos) {
    for (const c of repo.contributors) {
      const p = person(c.author?.login ?? UNLINKED)
      p.avatar ??= c.author?.avatar_url ?? null
      p.commits += c.total
      if (!p.repos.includes(repo.name)) p.repos.push(repo.name)
      for (const { w, c: count } of c.weeks) {
        if (count > 0) p.weeks.set(w, (p.weeks.get(w) ?? 0) + count)
      }
    }
    // PRs fechados sem merge não contam
    for (const pr of repo.pulls ?? []) {
      if (pr.merged_at) person(pr.user?.login ?? UNLINKED).prs++
    }
  }

  const contributors = [...people.values()]
    .map(p => {
      const active = [...p.weeks.keys()].filter(w => p.weeks.get(w) > 0).sort((a, b) => a - b)
      return { ...p, first: active.length ? iso(active[0]) : null, last: active.length ? iso(active.at(-1)) : null }
    })
    .sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login))

  const repoTotals = repos
    .map(r => ({
      name: r.name,
      commits: r.contributors.reduce((t, c) => t + c.total, 0),
      contributors: r.contributors.length,
    }))
    .sort((a, b) => b.commits - a.commits)

  return {
    syncedAt,
    contributors,
    repos: repoTotals,
    weeks: recentWeeks(contributors, syncedAt),
    totals: {
      commits: contributors.reduce((t, c) => t + c.commits, 0),
      prs: contributors.reduce((t, c) => t + c.prs, 0),
      contributors: contributors.length,
      repos: repos.length,
    },
  }
}

/** As últimas WEEKS semanas de calendário, alinhadas ao domingo como a API entrega. */
function recentWeeks(contributors, syncedAt) {
  const all = new Set()
  for (const c of contributors) for (const w of c.weeks.keys()) all.add(w)
  if (all.size === 0) return []
  const latest = Math.max(...all, Math.floor(syncedAt.getTime() / 1000 / (7 * DAY)) * 7 * DAY)
  return Array.from({ length: WEEKS }, (_, i) => latest - (WEEKS - 1 - i) * 7 * DAY)
}

const series = (person, weeks) => weeks.map(w => person.weeks.get(w) ?? 0)

/** Radar: quatro eixos normalizados contra o topo da organização. */
export function radarAxes(contributor, model) {
  const max = key => Math.max(1, ...model.contributors.map(c => c[key]))
  const pct = (value, ceiling) => Math.round((value / ceiling) * 100)
  const days = contributor.last
    ? (model.syncedAt - new Date(contributor.last)) / (DAY * 1000)
    : RECENCY_ZERO_DAYS
  return [
    pct(contributor.commits, max('commits')),
    pct(contributor.prs, max('prs')),
    pct(contributor.repos.length, Math.max(1, ...model.contributors.map(c => c.repos.length))),
    Math.max(0, Math.round(100 - (days / RECENCY_ZERO_DAYS) * 100)),
  ]
}

// ---------- renderização ----------

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

const avatarUrl = (c, color, size) =>
  c.avatar ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(c.login)}&background=0d1117&color=${color.slice(1)}&size=${size}`

function leaderboardRows(model) {
  const top = model.contributors[0]?.commits ?? 1
  return model.contributors
    .map((c, i) => {
      const color = COLORS[i % COLORS.length]
      return `
      <tr class="lb-row" style="animation-delay:${((i + 1) * 0.05).toFixed(2)}s">
        <td class="lb-rank" style="color:${color}">${String(i + 1).padStart(2, '0')}</td>
        <td class="lb-name">
          <img src="${esc(avatarUrl(c, color, 32))}" class="lb-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(c.login)}&background=0d1117&color=${color.slice(1)}&size=32'">
          <span style="color:${color}">${esc(c.login)}</span>
        </td>
        <td class="lb-commits">
          <div class="lb-bar-wrap">
            <div class="lb-bar" style="width:${Math.max(1, Math.round((c.commits / top) * 100))}%;background:${color}"></div>
            <span>${c.commits}</span>
          </div>
        </td>
        <td class="lb-prs">${c.prs}</td>
        <td class="lb-repos">${c.repos.length}</td>
        <td class="lb-last">${c.last ?? '—'}</td>
      </tr>`
    })
    .join('')
}

function sparkline(values, color) {
  const max = Math.max(1, ...values)
  return values
    .map(v => {
      const height = v === 0 ? SPARK_MIN : Math.max(SPARK_MIN, Math.round((v / max) * SPARK_MAX))
      return `<div class="spark-bar" style="height:${height}px;background:${color}"></div>`
    })
    .join('')
}

function contributorCards(model) {
  return model.contributors
    .map((c, i) => {
      const color = COLORS[i % COLORS.length]
      const badges = c.repos.map(r => `<span class="repo-badge">${esc(r)}</span>`).join('')
      return `
    <div class="contributor-card" data-rank="${i + 1}">
      <div class="card-rank" style="color:${color}">${RANK_ICONS[i] ?? '#'} #${i + 1}</div>
      <div class="card-header">
        <img class="avatar" src="${esc(avatarUrl(c, color, 64))}" alt="${esc(c.login)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(c.login)}&background=0d1117&color=${color.slice(1)}&size=64'">
        <div class="card-info">
          <div class="card-name" style="color:${color}">${esc(c.login)}</div>
          <div class="card-stats">
            <span class="stat-pill">${c.commits} commits</span>
            <span class="stat-pill">${c.prs} PRs merged</span>
          </div>
        </div>
      </div>
      <div class="card-repos">${badges}</div>
      <div class="card-sparkline">${sparkline(series(c, model.weeks), color)}</div>
      <div class="card-meta">
        <span>⚡ First: ${c.first ?? '—'}</span>
        <span>🕐 Last: ${c.last ?? '—'}</span>
      </div>
    </div>`
    })
    .join('')
}

export function render(template, model) {
  const t = model.syncedAt
  const top = model.contributors.slice(0, TOP)
  const values = {
    SYNC_AT: t.toISOString().slice(0, 19).replace('T', ' ') + ' UTC',
    SYNC_DATE: t.toISOString().slice(0, 10),
    SYNC_AGO: 'JUST NOW',
    TOTAL_COMMITS: model.totals.commits,
    TOTAL_PRS: model.totals.prs,
    TOTAL_CONTRIBUTORS: model.totals.contributors,
    TOTAL_REPOS: model.totals.repos,
    LEADERBOARD_ROWS: leaderboardRows(model),
    CONTRIBUTOR_CARDS: contributorCards(model),
    ACTIVITY_LABELS: JSON.stringify(model.weeks.map(iso)),
    ACTIVITY_DATASETS: JSON.stringify(
      top.map((c, i) => ({
        label: c.login,
        data: series(c, model.weeks),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: COLORS[i % COLORS.length] + '22',
        tension: 0.4,
        fill: false,
        pointRadius: 3,
      })),
    ),
    REPO_LABELS: JSON.stringify(model.repos.map(r => r.name)),
    REPO_COMMITS: JSON.stringify(model.repos.map(r => r.commits)),
    RADAR_DATASETS: JSON.stringify(
      top.map((c, i) => ({
        label: c.login,
        data: radarAxes(c, model),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: COLORS[i % COLORS.length] + '33',
        pointBackgroundColor: COLORS[i % COLORS.length],
      })),
    ),
    REPO_DATA: JSON.stringify(
      Object.fromEntries(model.repos.map(r => [r.name, { commits: r.commits, contributors: r.contributors }])),
    ),
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

async function paginate(token, path) {
  const items = []
  for (let page = 1; ; page++) {
    const { json, link } = await api(token, `${path}&per_page=100&page=${page}`)
    items.push(...json)
    if (!link.includes('rel="next"')) return items
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

  const names = (await paginate(token, `/orgs/${ORG}/repos?type=all`)).filter(r => !r.archived).map(r => r.name)
  const repos = []
  for (const name of names) {
    repos.push({
      name,
      contributors: await fetchContributors(token, name),
      pulls: await paginate(token, `/repos/${ORG}/${name}/pulls?state=closed`),
    })
  }

  const model = buildModel(repos, new Date())
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8')
  await writeFile(new URL('./index.html', import.meta.url), render(template, model))

  console.log(`${repos.length} repos, ${model.totals.commits} commits, ${model.totals.prs} PRs, ${model.totals.contributors} contribuidores`)
  console.log(`rate limit: ${rateLimit.remaining}/${rateLimit.limit} restantes`)
}

if (process.argv[1]?.endsWith('generate.mjs')) {
  main().catch(err => {
    // falha atômica: nada foi escrito, o index.html publicado continua o de antes
    console.error(`ABORTADO sem escrever index.html — ${err.message}`)
    process.exit(1)
  })
}
