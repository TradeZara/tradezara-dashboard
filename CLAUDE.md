# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Um único `index.html` (~1k linhas) servido como página estática: o developer dashboard da org TradeZara, tema terminal (neon + scanlines), Chart.js 4.4 por CDN. Sem build, sem `package.json`, sem dependências instaladas — abrir o arquivo no browser é o único "run".

## Estado atual vs. destino

Hoje **todos os números são hardcoded**, congelados num snapshot de 2026-05-11 e commitados à mão, enquanto a UI anuncia `LIVE DASHBOARD` / `powered by GitHub API`. Os dados vivem em quatro lugares dentro do próprio HTML e divergem entre si:

- métricas do topo — literais em `index.html:366-387`
- leaderboard — `<tbody>` escrito à mão a partir de `index.html:429`
- três `new Chart(...)` com datasets inline — `index.html:956`, `:975`, `:1000`
- `repoData` + render dos cards de repositório — `index.html:1023-1034`

`docs/specs/live-github-data.md` é a spec aprovada que substitui isso: um gerador `.mjs` (Node puro, `fetch` nativo, zero dependências) vira a fonte da verdade, roda numa GitHub Action horária, e reescreve `index.html` inteiro. O HTML atual passa a ser **saída de build** — template de string dentro do gerador. Leia a spec antes de mexer em qualquer número.

Pontos da spec que não são negociáveis ao implementar:

- O repo é **público** e mede repos **privados**: o token só existe no CI, lido de env var, nunca interpolado na saída. Nada de fetch no browser.
- Commits vêm do endpoint de *contributor statistics* (não da listagem de commits) — é o que corrige o teto artificial de 300. Esse endpoint responde `202` com corpo vazio enquanto o GitHub calcula: tratar como retry, nunca como "repo sem contribuidores".
- Falha atômica: se a coleta de qualquer repo falhar após os retries, aborta sem escrever o arquivo.
- Nenhuma mudança visual. Tema, layout e gráficos ficam idênticos; só a origem dos números muda.

## Testes

Convenção herdada do repo irmão `pip-matrix`: `node --test`, `node:test` + `assert/strict`, sem framework nem mock library. Um arquivo de teste ao lado do gerador, fixtures inline.

A única costura testada é a **transformação pura** (respostas cruas da API → modelo do dashboard). Rede e renderização de HTML ficam de fora de propósito — testes não devem conhecer nomes de funções internas nem markup.

## Agent skills

### Issue tracker

Issues live as GitHub Issues em `TradeZara/tradezara-dashboard`, via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` na raiz + `docs/adr/` (criados sob demanda). See `docs/agents/domain.md`.
