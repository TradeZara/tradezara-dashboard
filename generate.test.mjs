import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildModel, isStillComputing, radarAxes, render } from './generate.mjs'

const WEEK = 7 * 86400
const SYNCED = new Date('2026-08-05T12:00:00Z')
const weekAgo = n => Math.floor(SYNCED.getTime() / 1000 / WEEK) * WEEK - n * WEEK

const person = (login, total, weeks = [{ w: weekAgo(1), c: total }]) => ({
  author: login && { login, avatar_url: `https://avatars.githubusercontent.com/${login}` },
  total,
  weeks,
})
const merged = login => ({ user: { login }, merged_at: '2026-07-01T00:00:00Z' })
const abandoned = login => ({ user: { login }, merged_at: null })

/** By default everyone in the fixture is an org member; the filtering tests
 *  pass the member list explicitly. */
const build = (repos, syncedAt = SYNCED, members) =>
  buildModel(repos, syncedAt, new Set(members ?? everyone(repos)))

const everyone = repos =>
  repos
    .flatMap(r => [...r.contributors.map(c => c.author?.login), ...(r.pulls ?? []).map(p => p.user.login)])
    .filter(Boolean)

// ---------- commit aggregation ----------

test('sums commits for the same login across repositories', () => {
  const model = build([
    { name: 'pip-matrix', contributors: [person('ArtBreguez', 581), person('claude', 200)] },
    { name: 'databento-server', contributors: [person('ArtBreguez', 20)] },
  ], SYNCED)

  assert.equal(model.totals.commits, 801)
  assert.equal(model.totals.contributors, 2)
  assert.equal(model.contributors[0].login, 'ArtBreguez')
  assert.equal(model.contributors[0].commits, 601)
  assert.deepEqual(model.contributors[0].repos, ['pip-matrix', 'databento-server'])
})

test('only org members reach the dashboard', () => {
  const model = build(
    [{
      name: 'pip-matrix',
      contributors: [person('claude', 900), person('Antonio-Ramon', 581), person('outsider', 300)],
      pulls: [merged('claude'), merged('outsider'), merged('Antonio-Ramon')],
    }],
    SYNCED,
    ['Antonio-Ramon'],
  )

  assert.deepEqual(model.contributors.map(c => c.login), ['Antonio-Ramon'])
  assert.equal(model.totals.commits, 581, 'commits from outside the org stay out of the total')
  assert.equal(model.totals.prs, 1)
  assert.equal(model.repos[0].commits, 581, 'the per-repository total honours the filter too')
})

test('an unlinked commit author stays out — there is no way to tell if they are in the org', () => {
  const model = build(
    [{ name: 'pip-matrix', contributors: [person('Antonio-Ramon', 10), person(null, 7)] }],
    SYNCED,
    ['Antonio-Ramon'],
  )

  assert.equal(model.totals.commits, 10)
  assert.equal(model.totals.contributors, 1)
})

test('the headline number matches the sum of the leaderboard rows', () => {
  const model = build([
    { name: 'a', contributors: [person('x', 300), person('y', 45)], pulls: [merged('x'), merged('y')] },
    { name: 'b', contributors: [person('z', 1)], pulls: [merged('z')] },
  ], SYNCED)

  assert.equal(model.contributors.reduce((t, c) => t + c.commits, 0), model.totals.commits)
  assert.equal(model.contributors.reduce((t, c) => t + c.prs, 0), model.totals.prs)
  assert.equal(model.repos.reduce((t, r) => t + r.commits, 0), model.totals.commits)
})

test('no pagination ceiling: a contributor total is whatever the API reports', () => {
  const model = build([{ name: 'pip-matrix', contributors: [person('Antonio-Ramon', 581)] }], SYNCED)
  assert.equal(model.totals.commits, 581)
})

// ---------- PRs ----------

test('counts merged PRs per author and ignores those closed without a merge', () => {
  const model = build([{
    name: 'pip-matrix',
    contributors: [person('x', 5), person('y', 5)],
    pulls: [merged('x'), merged('x'), abandoned('x'), abandoned('y')],
  }], SYNCED)

  assert.equal(model.contributors.find(c => c.login === 'x').prs, 2)
  assert.equal(model.contributors.find(c => c.login === 'y').prs, 0)
  assert.equal(model.totals.prs, 2)
})

// ---------- dates and weekly series ----------

test('first and last activity come from the weeks with a non-zero count', () => {
  const model = build([{
    name: 'a',
    contributors: [person('x', 9, [
      { w: weekAgo(9), c: 0 },
      { w: weekAgo(5), c: 4 },
      { w: weekAgo(2), c: 5 },
      { w: weekAgo(1), c: 0 },
    ])],
  }], SYNCED)

  const x = model.contributors[0]
  assert.equal(x.first, new Date(weekAgo(5) * 1000).toISOString().slice(0, 10))
  assert.equal(x.last, new Date(weekAgo(2) * 1000).toISOString().slice(0, 10))
})

test('chart weeks are calendar dates, not W1..W12', () => {
  const model = build([{ name: 'a', contributors: [person('x', 3)] }], SYNCED)
  assert.equal(model.weeks.length, 12)
  assert.match(new Date(model.weeks[0] * 1000).toISOString().slice(0, 10), /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(model.weeks.every((w, i) => i === 0 || w - model.weeks[i - 1] === WEEK))
})

test('weeks anchor on what the API reported, not on the run clock', () => {
  // The API aligns weeks to Sunday; the Unix epoch falls on a Thursday.
  // Anchoring on the clock misaligns the keys and zeroes every series.
  const sunday = Math.floor(Date.parse('2026-08-02T00:00:00Z') / 1000)
  const model = build(
    [{ name: 'a', contributors: [person('x', 7, [{ w: sunday, c: 7 }])] }],
    new Date('2026-08-06T09:00:00Z'), // Thursday, the day the bug showed up
  )

  assert.ok(model.weeks.includes(sunday), 'the API week must be on the chart axis')
  const html = render('{{ACTIVITY_DATASETS}}', model)
  assert.equal(JSON.parse(html)[0].data.reduce((a, b) => a + b, 0), 7, 'the series must not come out zeroed')
})

// ---------- repositories ----------

test('repositories come out sorted by commits, with a contributor count', () => {
  const model = build([
    { name: 'small', contributors: [person('x', 1)] },
    { name: 'large', contributors: [person('y', 300), person('z', 20)] },
  ], SYNCED)

  assert.deepEqual(model.repos.map(r => r.name), ['large', 'small'])
  assert.equal(model.repos[0].contributors, 2)
  assert.equal(model.totals.repos, 2)
})

// ---------- radar ----------

test('the radar normalises against the org leader and decays over time', () => {
  const model = build([{
    name: 'a',
    contributors: [
      person('leader', 100, [{ w: weekAgo(1), c: 100 }]),
      person('stale', 50, [{ w: weekAgo(60), c: 50 }]),
    ],
    pulls: [merged('leader'), merged('leader'), merged('stale')],
  }], SYNCED)

  const [leader, stale] = model.contributors
  assert.deepEqual(radarAxes(leader, model), [100, 100, 100, radarAxes(leader, model)[3]])
  assert.equal(radarAxes(stale, model)[0], 50)
  assert.equal(radarAxes(stale, model)[1], 50)
  assert.ok(radarAxes(stale, model)[3] < radarAxes(leader, model)[3], 'whoever stopped longer ago scores lower on recency')
  assert.ok(radarAxes(stale, model)[3] >= 0)
})

// ---------- 202 ----------

test('202 means "still computing", not "repository with no contributors"', () => {
  assert.equal(isStillComputing(202, []), true)
  assert.equal(isStillComputing(200, []), true, 'a cold cache returns 200 + [] — it needs a retry')
  assert.equal(isStillComputing(200, [person('x', 1)]), false)
})

// ---------- render ----------

const fullModel = () => build([
  { name: 'pip-matrix', contributors: [person('ArtBreguez', 581), person('Antonio-Ramon', 4)], pulls: [merged('ArtBreguez')] },
  { name: 'databento-server', contributors: [person('claude', 42)], pulls: [abandoned('ArtBreguez')] },
], SYNCED, ['ArtBreguez', 'Antonio-Ramon'])

test('the real template comes out with no placeholder left behind', async () => {
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8')
  assert.doesNotMatch(render(template, fullModel()), /\{\{/)
})

test('the JSON handed to the charts is valid and carries the real series', () => {
  const model = fullModel()
  const datasets = JSON.parse(render('{{ACTIVITY_DATASETS}}', model))

  assert.equal(datasets[0].label, 'ArtBreguez')
  assert.equal(datasets[0].data.length, 12)
  assert.equal(datasets[0].data.reduce((a, b) => a + b, 0), 581)
})

test('repoData hands contributors over as a count, which is what the card shows', () => {
  const repoData = JSON.parse(render('{{REPO_DATA}}', fullModel()))
  assert.deepEqual(repoData['pip-matrix'], { commits: 585, contributors: 2 })
  assert.deepEqual(repoData['databento-server'], { commits: 0, contributors: 0 }, 'a repo with only bots comes out at zero')
  assert.equal(typeof repoData['pip-matrix'].contributors, 'number')
})

test('a login is escaped before it reaches the HTML', () => {
  const model = build([{ name: 'a', contributors: [person('<script>x</script>', 1)] }], SYNCED)
  const html = render('{{LEADERBOARD_ROWS}}', model)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('an unknown placeholder throws instead of leaking to the page', () => {
  assert.throws(() => render('{{TOTAL_STARS}}', build([], SYNCED)), /TOTAL_STARS/)
})

test('open PRs are listed newest first, and only from org members', () => {
  const open = (login, number, createdAt) => ({
    user: { login }, merged_at: null, state: 'open',
    number, title: 'fix', html_url: `https://x/${number}`, created_at: createdAt,
  })
  const model = buildModel(
    [{ name: 'a', contributors: [], pulls: [
      open('ArtBreguez', 1, '2026-07-01T00:00:00Z'),
      open('dependabot[bot]', 2, '2026-08-01T00:00:00Z'),
      open('ArtBreguez', 3, '2026-08-02T00:00:00Z'),
      { ...merged('ArtBreguez'), state: 'closed', number: 4 },
    ] }],
    SYNCED,
    new Set(['ArtBreguez']),
  )
  assert.deepEqual(model.openPulls.map(p => p.number), [3, 1])
  assert.equal(model.openPulls[0].repo, 'a')
  assert.equal(model.contributors[0].prs, 1, 'merged count is untouched by open PRs')
})
