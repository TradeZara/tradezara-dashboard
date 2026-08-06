# TradeZara // Developer Dashboard

Painel de contribuição da organização, publicado como HTML estático.

**`index.html` é saída de build — não edite à mão.** Qualquer edição manual é
descartada na próxima execução do gerador. Para mudar aparência, edite
`template.html`; para mudar números, edite `generate.mjs`.

## Como funciona

`generate.mjs` (Node puro, sem dependências) descobre os repositórios ativos da
organização pela API do GitHub, coleta as estatísticas de contribuidores e os
PRs mergeados, e reescreve `index.html` a partir de `template.html`.

Só entra no painel quem consta em **membros da organização**. Bots, mantenedores
externos e autores cujo commit não está vinculado a uma conta ficam de fora — daí
o token precisar enxergar a lista de membros, ou o filtro esvazia o painel (o
gerador aborta nesse caso). Entrou alguém novo no time? Basta adicionar à org.

Uma GitHub Action roda isso de hora em hora e commita o arquivo **apenas quando
o HTML muda** — o histórico não enche de commits vazios.

Se a coleta de qualquer repositório falhar depois dos retries, o gerador aborta
sem escrever nada: um painel parcial parece atual enquanto reporta números
baixos demais, o que é pior que um painel velho.

## Secret exigido

`DASHBOARD_READ_TOKEN` — token de organização com leitura de **repositórios** e
**metadados**, nada além disso. O `GITHUB_TOKEN` padrão da Action não serve: ele
só enxerga este repositório, e quase todos os repositórios medidos são privados.

O token existe apenas dentro do CI. Ele é lido de variável de ambiente e nunca
chega ao `index.html` — este repositório é público, e um token na página daria a
qualquer visitante acesso de leitura ao código privado da organização.

## Rodar localmente

```sh
GITHUB_TOKEN=$(gh auth token) node generate.mjs   # reescreve index.html
node --test                                       # testes da transformação
```

Confira o resultado com `git diff index.html` antes de abrir o PR.

## Disparo manual

Aba **Actions** → **Refresh dashboard** → **Run workflow**. Útil para forçar uma
atualização sem esperar o cron.

Credencial recusada pela API derruba o build — um token expirado aparece como
build vermelho, não como dado velho servido em silêncio.
