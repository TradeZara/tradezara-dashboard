import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildModel, isStillComputing, radarAxes, render, UNLINKED } from './generate.mjs'

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

// ---------- agregação de commits ----------

test('soma commits do mesmo login entre repositórios', () => {
  const model = buildModel([
    { name: 'pip-matrix', contributors: [person('ArtBreguez', 581), person('claude', 200)] },
    { name: 'databento-server', contributors: [person('ArtBreguez', 20)] },
  ], SYNCED)

  assert.equal(model.totals.commits, 801)
  assert.equal(model.totals.contributors, 2)
  assert.equal(model.contributors[0].login, 'ArtBreguez')
  assert.equal(model.contributors[0].commits, 601)
  assert.deepEqual(model.contributors[0].repos, ['pip-matrix', 'databento-server'])
})

test('bots entram no ranking como qualquer contribuidor', () => {
  const model = buildModel([
    { name: 'pip-matrix', contributors: [person('claude', 900), person('Antonio-Ramon', 581)] },
  ], SYNCED)
  assert.equal(model.contributors[0].login, 'claude')
})

test('autores sem conta vinculada viram um balde explícito, não somem', () => {
  const model = buildModel([
    { name: 'pip-matrix', contributors: [person('ArtBreguez', 10), person(null, 7), person(null, 3)] },
  ], SYNCED)

  assert.equal(model.totals.commits, 20)
  assert.equal(model.contributors.find(c => c.login === UNLINKED).commits, 10)
})

test('o número do topo bate com a soma das linhas do leaderboard', () => {
  const model = buildModel([
    { name: 'a', contributors: [person('x', 300), person('y', 45)], pulls: [merged('x'), merged('y')] },
    { name: 'b', contributors: [person('z', 1)], pulls: [merged('z')] },
  ], SYNCED)

  assert.equal(model.contributors.reduce((t, c) => t + c.commits, 0), model.totals.commits)
  assert.equal(model.contributors.reduce((t, c) => t + c.prs, 0), model.totals.prs)
  assert.equal(model.repos.reduce((t, r) => t + r.commits, 0), model.totals.commits)
})

test('nenhum teto de paginação: o total do contribuidor é o que a API reporta', () => {
  const model = buildModel([{ name: 'pip-matrix', contributors: [person('Antonio-Ramon', 581)] }], SYNCED)
  assert.equal(model.totals.commits, 581)
})

// ---------- PRs ----------

test('conta PRs mergeados por autor e ignora os fechados sem merge', () => {
  const model = buildModel([{
    name: 'pip-matrix',
    contributors: [person('x', 5), person('y', 5)],
    pulls: [merged('x'), merged('x'), abandoned('x'), abandoned('y')],
  }], SYNCED)

  assert.equal(model.contributors.find(c => c.login === 'x').prs, 2)
  assert.equal(model.contributors.find(c => c.login === 'y').prs, 0)
  assert.equal(model.totals.prs, 2)
})

// ---------- datas e séries semanais ----------

test('primeira e última atividade vêm das semanas com contagem diferente de zero', () => {
  const model = buildModel([{
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

test('as semanas do gráfico são datas de calendário, não W1..W12', () => {
  const model = buildModel([{ name: 'a', contributors: [person('x', 3)] }], SYNCED)
  assert.equal(model.weeks.length, 12)
  assert.match(new Date(model.weeks[0] * 1000).toISOString().slice(0, 10), /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(model.weeks.every((w, i) => i === 0 || w - model.weeks[i - 1] === WEEK))
})

// ---------- repositórios ----------

test('repositórios saem ordenados por commits, com contagem de contribuidores', () => {
  const model = buildModel([
    { name: 'pequeno', contributors: [person('x', 1)] },
    { name: 'grande', contributors: [person('y', 300), person('z', 20)] },
  ], SYNCED)

  assert.deepEqual(model.repos.map(r => r.name), ['grande', 'pequeno'])
  assert.equal(model.repos[0].contributors, 2)
  assert.equal(model.totals.repos, 2)
})

// ---------- radar ----------

test('radar normaliza contra o topo da organização e decai com o tempo', () => {
  const model = buildModel([{
    name: 'a',
    contributors: [
      person('lider', 100, [{ w: weekAgo(1), c: 100 }]),
      person('antigo', 50, [{ w: weekAgo(60), c: 50 }]),
    ],
    pulls: [merged('lider'), merged('lider'), merged('antigo')],
  }], SYNCED)

  const [lider, antigo] = model.contributors
  assert.deepEqual(radarAxes(lider, model), [100, 100, 100, radarAxes(lider, model)[3]])
  assert.equal(radarAxes(antigo, model)[0], 50)
  assert.equal(radarAxes(antigo, model)[1], 50)
  assert.ok(radarAxes(antigo, model)[3] < radarAxes(lider, model)[3], 'quem parou há mais tempo tem recência menor')
  assert.ok(radarAxes(antigo, model)[3] >= 0)
})

// ---------- 202 ----------

test('202 é "ainda calculando", não "repositório sem contribuidores"', () => {
  assert.equal(isStillComputing(202, []), true)
  assert.equal(isStillComputing(200, []), true, 'cache frio devolve 200 + [] — precisa de retry')
  assert.equal(isStillComputing(200, [person('x', 1)]), false)
})

// ---------- render ----------

const fullModel = () => buildModel([
  { name: 'pip-matrix', contributors: [person('ArtBreguez', 581), person(null, 4)], pulls: [merged('ArtBreguez')] },
  { name: 'databento-server', contributors: [person('claude', 42)], pulls: [abandoned('claude')] },
], SYNCED)

test('render preenche todo placeholder e não deixa nenhum para trás', async () => {
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8')
  const html = render(template, fullModel())

  assert.doesNotMatch(html, /\{\{/)
  assert.match(html, /2026-08-05 12:00:00 UTC/)
  assert.match(html, /<div class="metric-value">627<\/div>/, 'commits do topo')
  assert.match(html, /<div class="metric-value">1<\/div>/, 'PRs mergeados do topo')
  assert.match(html, />ArtBreguez</)
  assert.match(html, /sem conta vinculada/)
})

test('o JSON dos gráficos é válido e usa as séries reais', async () => {
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8')
  const html = render(template, fullModel())

  const datasets = JSON.parse(html.match(/datasets: (\[.*\])/)[1])
  assert.equal(datasets[0].label, 'ArtBreguez')
  assert.equal(datasets[0].data.length, 12)
  assert.equal(datasets[0].data.reduce((a, b) => a + b, 0), 581)

  const repoData = JSON.parse(html.match(/const repoData = (\{.*?\});/)[1])
  assert.deepEqual(repoData['pip-matrix'], { commits: 585, contributors: 2 })
})

test('login é escapado antes de entrar no HTML', () => {
  const model = buildModel([{ name: 'a', contributors: [person('<script>x</script>', 1)] }], SYNCED)
  const html = render('{{LEADERBOARD_ROWS}}', model)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('placeholder desconhecido explode em vez de vazar para a página', () => {
  assert.throws(() => render('{{TOTAL_STARS}}', buildModel([], SYNCED)), /TOTAL_STARS/)
})
