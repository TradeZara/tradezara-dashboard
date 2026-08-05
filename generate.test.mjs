import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, isStillComputing, render, UNLINKED } from './generate.mjs'

const week = (w, c) => ({ w, c, a: c, d: 0 })
const person = (login, total, weeks = [week(1700000000, total)]) => ({
  author: login && { login },
  total,
  weeks,
})

const SYNCED = new Date('2026-08-05T12:00:00Z')

test('soma commits do mesmo login entre repositórios', () => {
  const model = buildModel([
    { name: 'pip-matrix', contributors: [person('ArtBreguez', 581), person('claude', 200)] },
    { name: 'databento-server', contributors: [person('ArtBreguez', 20)] },
  ], SYNCED)

  assert.equal(model.totals.commits, 801)
  assert.equal(model.totals.contributors, 2)
  assert.equal(model.totals.repos, 2)
  assert.deepEqual(model.contributors[0], { login: 'ArtBreguez', commits: 601 })
})

test('autores sem conta vinculada viram um balde explícito, não somem', () => {
  const model = buildModel([
    { name: 'pip-matrix', contributors: [person('ArtBreguez', 10), person(null, 7), person(null, 3)] },
  ], SYNCED)

  assert.equal(model.totals.commits, 20)
  assert.deepEqual(model.contributors.find(c => c.login === UNLINKED), { login: UNLINKED, commits: 10 })
})

test('o número do topo bate com a soma das linhas do leaderboard', () => {
  const model = buildModel([
    { name: 'a', contributors: [person('x', 300), person('y', 45)] },
    { name: 'b', contributors: [person('z', 1)] },
  ], SYNCED)

  const soma = model.contributors.reduce((t, c) => t + c.commits, 0)
  assert.equal(soma, model.totals.commits)
})

test('nenhum teto de paginação: o total do contribuidor é o que a API reporta', () => {
  const model = buildModel([{ name: 'pip-matrix', contributors: [person('Antonio-Ramon', 581)] }], SYNCED)
  assert.equal(model.totals.commits, 581)
})

test('202 é "ainda calculando", não "repositório sem contribuidores"', () => {
  assert.equal(isStillComputing(202, []), true)
  assert.equal(isStillComputing(200, []), true, 'cache frio devolve 200 + [] — precisa de retry')
  assert.equal(isStillComputing(200, [person('x', 1)]), false)
})

test('render preenche os quatro números e o timestamp real', () => {
  const model = buildModel([{ name: 'a', contributors: [person('x', 42)] }], SYNCED)
  const html = render(
    '<i>{{SYNC_AT}}</i><i>{{SYNC_DATE}}</i><i>{{SYNC_AGO}}</i>' +
    '<b>{{TOTAL_COMMITS}}</b><b>{{TOTAL_PRS}}</b><b>{{TOTAL_CONTRIBUTORS}}</b><b>{{TOTAL_REPOS}}</b>',
    model,
  )

  assert.match(html, /2026-08-05 12:00:00 UTC/)
  assert.match(html, /<b>42<\/b>/)
  assert.match(html, /<b>—<\/b>/, 'PRs ainda não coletados: mostra travessão, não um número inventado')
  assert.doesNotMatch(html, /\{\{/)
})

test('placeholder desconhecido explode em vez de vazar para a página', () => {
  const model = buildModel([], SYNCED)
  assert.throws(() => render('{{TOTAL_STARS}}', model), /TOTAL_STARS/)
})
