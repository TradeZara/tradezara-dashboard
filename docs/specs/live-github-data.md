# Spec — Dados reais do GitHub no Developer Dashboard

## Problem Statement

O dashboard mostra números errados e ninguém sabe disso ao olhar para ele.

Todo o conteúdo do `index.html` foi congelado num snapshot de 2026-05-11 e commitado à mão. Desde então o painel envelheceu em silêncio: ele afirma que `Antonio-Ramon` tem 185 commits em `pip-matrix` quando a API do GitHub responde **581**; afirma que `pip-matrix` e `backtesting-framework` têm exatamente 300 commits cada — um número redondo demais para ser real, resquício de um limite de paginação do gerador que produziu o arquivo. Contribuidores que entraram depois de maio simplesmente não existem no painel, incluindo o bot `claude`, que hoje seria top-3 em `pip-matrix`. Um repo listado, `pip-matrix-backend`, nem aparece mais na organização.

O agravante é a interface prometer o contrário: a navbar exibe `LIVE DASHBOARD` com um LED verde pulsando e o rodapé diz `powered by GitHub API`. Quem abre a página acredita estar vendo o estado atual da engenharia. Está vendo maio.

Pior ainda, não há como corrigir: o script que gerou aquele HTML nunca foi commitado. O repositório tem um único commit e um único arquivo. Atualizar o painel hoje significa editar centenas de linhas de HTML na mão, o que garante que ninguém vai fazer.

## Solution

O dashboard passa a se regenerar sozinho, de hora em hora, a partir da API do GitHub.

Um script gerador — este sim versionado no repositório — vira a fonte da verdade. Ele roda numa GitHub Action agendada, autentica-se com um token guardado nos secrets do repositório, consulta as estatísticas reais de todos os repositórios da organização e reescreve o `index.html` inteiro com os números do momento. Se algo mudou, a Action commita o arquivo novo. A página publicada continua sendo exatamente o que é hoje: um HTML estático, sem build, sem dependências além do Chart.js por CDN.

A separação é o ponto central. O token só existe dentro do CI, onde é secreto. O que chega ao browser é apenas o HTML já preenchido — nenhuma credencial, nenhuma chamada de API do lado do cliente. Isso é obrigatório e não negociável: `tradezara-dashboard` é um repositório **público**, enquanto quase todos os repositórios que ele mede são **privados**. Um token embutido na página daria a qualquer visitante acesso de leitura ao código privado da organização, e nenhuma ofuscação resolve isso — o browser precisa do valor final para fazer a requisição, logo o valor final está no arquivo.

Para o leitor do painel, a mudança é que os números passam a estar certos. O selo `LIVE DASHBOARD` deixa de ser uma promessa vazia e passa a exibir há quanto tempo foi a última sincronização.

## User Stories

1. Como líder de engenharia da TradeZara, quero abrir o dashboard e ver a contagem de commits que a API do GitHub reporta hoje, para que eu possa tomar decisões sobre alocação de time sem antes conferir os números à mão.
2. Como líder de engenharia, quero que o painel se atualize sozinho de hora em hora, para que eu nunca mais precise pedir a alguém que "rode o script de novo".
3. Como líder de engenharia, quero ver há quanto tempo foi a última sincronização, para que eu saiba se estou olhando um dado fresco ou um pipeline quebrado.
4. Como contribuidor da organização, quero que meus commits apareçam no painel na hora seguinte ao push, para que meu trabalho recente esteja representado.
5. Como contribuidor que entrou depois do último snapshot, quero aparecer no leaderboard automaticamente, para que eu não dependa de alguém me adicionar manualmente ao HTML.
6. Como contribuidor, quero que a soma de commits do meu perfil bata com a que o GitHub mostra na aba Insights do repositório, para que eu confie no painel.
7. Como contribuidor, quero ver minha atividade semanal real como sparkline, para que eu enxergue meu próprio ritmo ao longo do tempo.
8. Como contribuidor, quero que minha primeira e última contribuição sejam derivadas do histórico real, para que as datas do meu card estejam corretas.
9. Como contribuidor com commits em vários repositórios, quero que todos apareçam nos badges do meu card, para que meu alcance na organização fique visível.
10. Como mantenedor do dashboard, quero que a lista de repositórios seja descoberta pela API da organização, para que repositórios novos entrem sozinhos e repositórios extintos saiam sozinhos.
11. Como mantenedor, quero que repositórios arquivados sejam excluídos por padrão, para que o painel reflita o trabalho ativo.
12. Como mantenedor, quero que a contagem por repositório venha do total real de commits, para que nenhum repositório fique travado num teto artificial de paginação.
13. Como mantenedor, quero que os PRs mergeados sejam contados por autor a partir da API, para que a coluna de PRs deixe de ser um número escrito à mão.
14. Como mantenedor, quero que os quatro números do topo (commits, PRs, contribuidores, repositórios) sejam somados a partir dos dados coletados, para que nunca divirjam das tabelas abaixo deles.
15. Como mantenedor, quero que o gráfico de atividade semanal use as semanas reais retornadas pela API, para que a linha do tempo corresponda a datas de calendário de verdade.
16. Como mantenedor, quero que o gráfico de commits por repositório reflita os totais coletados, para que o desenho e a tabela contem a mesma história.
17. Como mantenedor, quero que o radar de contribuidores seja calculado a partir das métricas coletadas, para que ele deixe de ser um conjunto de valores inventados.
18. Como mantenedor, quero que os cards de repositório sejam gerados a partir da descoberta da organização, para que a seção acompanhe a realidade.
19. Como mantenedor do dashboard, quero que o gerador esteja versionado no repositório, para que qualquer pessoa consiga regenerar o painel e entender de onde vêm os números.
20. Como mantenedor, quero rodar o gerador localmente com meu próprio token, para que eu possa validar uma mudança antes de fazer merge.
21. Como mantenedor, quero disparar a regeneração manualmente pela aba Actions, para que eu possa forçar uma atualização sem esperar o cron.
22. Como mantenedor, quero que a Action só commite quando o HTML realmente mudar, para que o histórico do repositório não encha de commits vazios de hora em hora.
23. Como mantenedor, quero que a Action falhe visivelmente quando a API recusar as credenciais, para que um token expirado apareça como build vermelho e não como dado velho servido em silêncio.
24. Como mantenedor, quero que o gerador aborte sem escrever nada se qualquer repositório falhar na coleta, para que uma falha parcial nunca publique um painel com números artificialmente baixos.
25. Como mantenedor, quero que o gerador aguarde e repita quando o GitHub responder que as estatísticas ainda estão sendo calculadas, para que uma execução em cache frio não produza um painel vazio.
26. Como mantenedor, quero que o token seja lido de variável de ambiente e nunca escrito no arquivo de saída, para que o repositório público continue livre de credenciais.
27. Como responsável pela segurança, quero que o token do CI tenha apenas permissão de leitura nos repositórios, para que um vazamento no pipeline não permita escrita no código.
28. Como mantenedor, quero que o gerador respeite o rate limit da API e reporte quanto do orçamento consumiu, para que a execução horária não esbarre no limite.
29. Como visitante do painel, quero que a página continue carregando como HTML estático, para que ela abra instantaneamente e funcione sem login.
30. Como visitante, quero que a aparência do painel — tema terminal, cores neon, scanlines, gráficos — permaneça idêntica à atual, para que só os números mudem.
31. Como visitante, quero ver commits de bots como `claude` listados junto com os humanos, para que o volume real de código que entra no repositório fique visível.
32. Como visitante, quero que commits cujo autor não está vinculado a uma conta do GitHub sejam agrupados de forma explícita, para que os totais fechem sem inventar um contribuidor fantasma.
33. Como visitante em celular, quero que o painel regenerado continue responsivo, para que eu consiga consultá-lo fora do computador.
34. Como visitante, quero que os avatares carreguem do GitHub com fallback quando indisponíveis, para que o layout não quebre.
35. Como novo mantenedor, quero um README explicando como o pipeline funciona e qual secret ele exige, para que eu consiga operá-lo sem arqueologia.

## Implementation Decisions

**Arquitetura: geração em CI, publicação estática.** O `index.html` deixa de ser um arquivo editado à mão e passa a ser **saída de build** commitada. A fonte da verdade vira o script gerador. O template atual do HTML é transplantado para dentro do gerador como template de string — nenhuma mudança visual é introduzida nesta spec.

**Stack: Node puro, sem dependências.** Um único módulo `.mjs` usando `fetch` nativo e template strings. Sem `package.json`, sem lockfile, sem passo de instalação no CI — coerente com um repositório que hoje é um arquivo só. Octokit foi descartado: paginação e retry aqui cabem em poucas linhas e não justificam a árvore de dependências.

**Agendamento: cron horário, mais disparo manual.** A workflow roda de hora em hora e também aceita `workflow_dispatch`. O commit só acontece se o HTML gerado diferir do que está versionado, evitando 24 commits vazios por dia.

**Credenciais.** O `GITHUB_TOKEN` padrão da Action tem escopo apenas do próprio repositório e não enxerga os demais repositórios privados da organização; portanto o pipeline exige um token de organização com leitura de repositórios e metadados, guardado como secret. O gerador lê esse valor exclusivamente de variável de ambiente, falha imediatamente se estiver ausente, e jamais o interpola na saída.

**Descoberta de repositórios.** A lista fixa de sete repositórios é abandonada. O gerador enumera os repositórios da organização pela API, excluindo os arquivados. Isso resolve, sem manutenção, tanto o `pip-matrix-backend` que não existe mais quanto qualquer repositório futuro.

**Fonte dos commits.** As contagens vêm do endpoint de estatísticas de contribuidores do repositório, não da listagem de commits. Essa é a correção do teto de 300: o endpoint devolve, por contribuidor, o total de commits e a série semanal completa numa única resposta, sem paginação. A série semanal alimenta simultaneamente as sparklines dos cards, o gráfico de atividade semanal e as datas de primeira e última contribuição — derivadas da primeira e da última semana com contagem diferente de zero.

Esse endpoint responde `202` com corpo vazio enquanto o GitHub calcula as estatísticas sob demanda; o comportamento foi confirmado na exploração desta spec, em que a primeira chamada retornou lista vazia e a seguinte retornou os dados completos. O gerador trata isso como retry com espera, e não como "repositório sem contribuidores" — confundir os dois publicaria um painel zerado.

**Fonte dos PRs.** PRs mergeados são contados percorrendo os pull requests fechados de cada repositório e agrupando por autor os que possuem data de merge. A API de busca foi preterida por ter limite de requisições próprio e mais apertado, arriscado numa execução horária.

**Identidade de contribuidor.** A chave de agregação é a conta do GitHub, o que resolve automaticamente o mesmo humano aparecendo sob nomes de commit diferentes — hoje o painel lista `allanfigueira` e `Allan kristhian figueira santos` como duas pessoas. Commits cujo autor não está vinculado a nenhuma conta são agregados num balde único e explícito, nunca descartados em silêncio, para que os totais continuem fechando.

**Bots.** Contas de bot, incluindo `claude`, entram no ranking como qualquer outro contribuidor, conforme decisão do produto. Consequência esperada e aceita: `claude` deve aparecer no topo do leaderboard de `pip-matrix`.

**Agregação e derivação.** Os quatro números do topo, os três gráficos, o leaderboard, os cards de contribuidor e os cards de repositório passam todos a ser derivados de uma única estrutura de dados intermediária. Nenhum valor é escrito à mão em lugar nenhum, o que torna impossível a divergência atual entre seções.

**Honestidade da interface.** O selo `LIVE DASHBOARD` e o timestamp de sincronização passam a refletir o instante real da geração.

**Falha atômica.** Se a coleta de qualquer repositório falhar depois dos retries, o gerador encerra com erro **sem escrever o arquivo**. Um painel parcial é pior que um painel velho: ele parece atual enquanto reporta números baixos demais.

**Publicação.** GitHub Pages ainda não está habilitado neste repositório; habilitá-lo servindo a raiz da branch principal faz parte do escopo, para que o HTML regenerado fique de fato acessível.

## Testing Decisions

Um bom teste aqui fixa **comportamento observável**: dada uma resposta da API, quais números o dashboard mostra. Nenhum teste deve conhecer nomes de funções internas, ordem de chamadas ou formato intermediário — esses vão mudar, e testes acoplados a eles só encarecem o refactor.

**Uma única costura.** O gerador se divide em três etapas — buscar, transformar, renderizar. Os testes batem exclusivamente no meio: a transformação pura que recebe as respostas cruas da API e devolve o modelo do dashboard. Rede fica de fora (é I/O, testado pela própria execução do CI) e o HTML fica de fora (mudanças de markup não devem quebrar testes de dados). Essa é a costura mais alta disponível: uma função, sem estado, sem mocks.

**O que é coberto:** a agregação de commits por contribuidor a partir das séries semanais; a derivação das datas de primeira e última atividade; a contagem de PRs mergeados por autor ignorando os fechados sem merge; o agrupamento de autores não vinculados a conta; a soma dos quatro números do topo batendo com a soma das linhas do leaderboard; a ordenação do leaderboard; e a distinção entre "estatísticas ainda calculando" e "repositório sem contribuidores", que é a armadilha central deste pipeline.

**Prior art.** O repositório irmão `pip-matrix` roda testes com `node --test` sobre `node:test` e `assert/strict`, sem nenhuma dependência de teste. Esta spec segue a mesma convenção: um arquivo de teste ao lado do gerador, com respostas de API reduzidas escritas inline como fixtures. Sem framework, sem runner, sem mock library.

## Out of Scope

- Qualquer redesenho visual. Tema, cores, tipografia, gráficos e layout permanecem exatamente como estão; esta spec troca a origem dos números, não a aparência.
- Busca de dados ao vivo no browser e proxy serverless, ambos avaliados e descartados: o primeiro é impossível sem expor credenciais num repositório público, o segundo adiciona um projeto e um runtime para ganhar um frescor que ninguém percebe num painel de contribuidores.
- Métricas novas — linhas alteradas, tempo de review, cobertura, velocidade de merge. O escopo é tornar reais as métricas que já existem.
- Filtros, ordenação, busca ou qualquer interatividade na página.
- Histórico versionado dos snapshots ou comparação entre períodos.
- Autenticação de visitantes e controle de acesso ao painel.
- Deduplicação manual de identidades além do que a vinculação de conta do GitHub já resolve.
- Separar bots dos humanos numa seção própria, explicitamente decidido contra.

## Further Notes

O cron horário custa pouco em rate limit: a ordem de grandeza é de algumas dezenas de requisições por execução, contra um orçamento de milhares por hora para requisições autenticadas. Sobra folga confortável mesmo com a organização crescendo.

Vale antecipar que os números vão dar um salto grande na primeira execução — o snapshot atual subestima a realidade de forma severa, com pelo menos um contribuidor triplicando a contagem. Isso é correção, não regressão, e convém avisar o time antes de publicar para que ninguém interprete o salto como bug.

O repositório é público e passa a expor, de hora em hora, estatísticas de contribuição de repositórios privados: nomes, volumes e datas de atividade. Isso já é verdade hoje com o snapshot, mas a automação torna a exposição contínua. Nenhum conteúdo de código vaza — apenas metadados de contribuição — porém a decisão de manter o repositório público merece uma confirmação consciente antes do primeiro cron.
