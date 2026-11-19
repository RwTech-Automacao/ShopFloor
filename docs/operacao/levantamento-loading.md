# Levantamento: estado de carregamento das telas (19/11/2026)

Feito durante o trabalho de desempenho da tela **Peças paradas** (branch `perf/pecas-paradas`). Aqui só tem o
levantamento e a proposta. Nenhuma outra tela foi mudada.

## O que foi encontrado

- **Não há `loading.tsx` em nenhuma rota.** Também não há `template.tsx` nem `<Suspense>` em `src/`. A exceção é
  `shopfloor/analisar/parados/loading.tsx`, criado nesta branch.
- O `(app)/layout.tsx` aguarda `getSessao()`. Os layouts de `configuracoes/`, `recebimento/` e `setup/` também.
- **61 das 67 páginas** são componentes de servidor assíncronos que buscam dados antes de desenhar a tela. Ao
  clicar no menu, o layout continua visível, mas a tela antiga fica parada até a nova estar pronta. Durante essa
  espera não aparece nenhum aviso.
- Os avisos que existem aparecem no navegador **depois** que a página monta: o texto do botão muda ("Salvando…",
  "Buscando…"), um spinner aparece dentro do formulário ou a lista fica com `aria-busy`/`opacity-60`. Nenhum deles
  cobre a primeira abertura da tela.
- **Não há componente reutilizável de carregamento.** O spinner
  `size-5 animate-spin rounded-full border-2 border-enterplak border-t-transparent` está copiado à mão em
  `recebimento/fluxo/fluxo-form.tsx`, `shopfloor/fluxo/fluxo-form.tsx` e `shopfloor/operar/lancamento/lancamento-form.tsx`.
  O `wizard-importacao.tsx` usa o `Loader2Icon`. O texto mais comum é
  `<p className="text-sm text-muted-foreground">Carregando…</p>`.

Legenda das colunas: **Servidor aguarda dados?** diz se a página espera os dados no servidor antes de aparecer.
**Indicador** é o aviso de carregamento que já existe hoje. "nenhum" quer dizer que não há aviso visível.

| Rota | Servidor aguarda dados? | Indicador existente |
|---|---|---|
| /configuracoes | não (redirect) | — |
| /configuracoes/campos | sim (campos + listas) | "Salvando..." no botão |
| /configuracoes/colunas | sim (catálogo + layout) | "Salvando…" no botão |
| /configuracoes/criticidade | sim | "Salvando..." |
| /configuracoes/listas | sim | "Salvando..." |
| /configuracoes/listas/[chave] | sim (lista e itens, em sequência) | "Salvando..." |
| /configuracoes/logs | sim (logs filtrados pela URL) | nenhum |
| /configuracoes/nqa | sim | "Salvando..." |
| /configuracoes/perfis | sim | "Salvando..." |
| /configuracoes/rec-alertas | sim (regras, destinatários, ocorrências) | botões desabilitados; "Salvando…" |
| /configuracoes/setup-equipamentos | sim | "Salvando..." |
| /configuracoes/setup-estrutura | sim (ordens + PMOs) | "Adicionando..." |
| /configuracoes/sf-alertas | sim (6 consultas) | botões desabilitados; "Salvando…" |
| /configuracoes/sf-consertos | sim | "Salvando..." |
| /configuracoes/sf-defeitos | sim | "Salvando..." |
| /configuracoes/sf-postos | sim (postos + perfis + 1 consulta por posto) | "Salvando..." |
| /configuracoes/usuarios | sim (usuários + perfis) | "Salvando..." / "Gerando..." |
| /faturamento/baixa-nf | sim (fila + saldo no Compels) | "Baixando…" |
| /home | só a sessão | — |
| /perfil | sim (contas vinculadas) | botões desabilitados |
| /recebimento/almoxarifado | sim (inclui `EnvioCompels` assíncrono **sem Suspense**) | "Carregando…" nas listas buscadas no navegador |
| /recebimento/dashboard | sim (dashboard + opções + métricas) | `opacity-60` ao trocar filtro |
| /recebimento/emb | sim (lista de EMBs) | nenhum |
| /recebimento/emb/[emb] | sim (relatório da EMB + lista) | "Exportando…" |
| /recebimento/etiquetar-rolo | só a sessão; formulário | "Enviando…" |
| /recebimento/etiquetas | só a sessão; formulário | "Buscando..." |
| /recebimento/etiquetas/historico | sim | nenhum |
| /recebimento/etiquetas-legado | sim | "Gerando..." |
| /recebimento/exportar-fotos | sim | "Processando…" |
| /recebimento/fluxo | sim (lista de EMBs); o fluxo é buscado quando o usuário pede | spinner + "Carregando o fluxo da EMB…" |
| /recebimento/importacoes | sim | nenhum |
| /recebimento/importar | sim (vários awaits em sequência) | `Loader2Icon` girando |
| /recebimento/processos | sim (catálogo, layout e grade) | "Carregando…" no filtro de coluna |
| /recebimento/processos/[id] | sim (cadeia longa, quase toda em sequência) | "Salvando…", "Finalizando…" |
| /recebimento/processos/novo | sim (campos e itens) | nenhum texto (só desabilita) |
| /recebimento/registros | sim (registros paginados + filtros) | nenhum |
| /sat/alertas | sim | botões desabilitados |
| /sat/entrada | sim (motivos, leve) | "Buscando…", "Salvando…" |
| /sat/equipamentos | sim (lista filtrada pela URL) | nenhum |
| /sat/equipamentos/[id] | sim | "Salvando…" |
| /setup, /setup/consultas, /setup/operar | não (redirect) | — |
| /setup/consultas/setups | sim (equipamentos); a consulta roda quando o usuário pede | "Consultando…" |
| /setup/consultas/trocas | sim (equipamentos); a consulta roda quando o usuário pede | "Consultando…" |
| /setup/operar/abastecimento | sim (ordens + equipamentos) | "Procurando o setup…" |
| /setup/operar/montar | sim (ordens + equipamentos) | "Procurando o setup…" |
| /shopfloor/analisar | não (redirect) | — |
| /shopfloor/analisar/burn-in | sim | nenhum |
| /shopfloor/analisar/caixas | sim (OPs com caixas) | "Carregando…" |
| /shopfloor/analisar/cancelamentos | sim | nenhum |
| /shopfloor/analisar/dashboard | sim (todas as ordens + postos + colaboradores, pesado) | "Carregando…" e `opacity-60` |
| /shopfloor/analisar/estoque-pendente | sim | "Reenviando…" |
| /shopfloor/analisar/parados | sim (regra + peças paradas) | **`loading.tsx` (esta branch)** + "Carregando…" ao trocar filtro |
| /shopfloor/analisar/pesquisa | sim (todas as ordens, pesado) | "Buscando…", "Carregando grade…" |
| /shopfloor/analisar/repinmetro | sim (modelos) | "Buscando…" |
| /shopfloor/fluxo | sim (ordens) | spinner + "Carregando fluxo…" |
| /shopfloor/operar | não (redirect) | — |
| /shopfloor/operar/integracao | só a sessão; formulário | "Buscando…" |
| /shopfloor/operar/lancamento | sim (5 consultas) | sobreposição "Gravando… aguarde" com spinner |
| /shopfloor/operar/manutencao | sim (reprovas, reparos, defeitos, consertos) | "Salvando…" |
| /shopfloor/ordens | sim (`OrdensConteudo` assíncrono **sem Suspense**) | "Salvando…", "Excluindo…" |
| /shopfloor/ordens/nova | sim (espelho, postos, ordens) | "Carregando…" (role=status) |
| /shopfloor/ordens-nova | sim (reaproveita `OrdensConteudo`) | igual a /shopfloor/ordens |
| /shopfloor/registros | sim (registros paginados + filtros) | nenhum |
| /sobre | não (estática) | — |
| /vitrine/fluxo | só a sessão | nenhum |

## Padrão proposto (aplicar depois, tela a tela)

**Componente:** `src/shared/ui/carregando.tsx` (criado nesta branch):

- `Bloco` é o esqueleto: um retângulo `animate-pulse rounded-lg bg-muted` no tamanho do que vai aparecer. A
  animação respeita `motion-reduce`.
- `Carregando` é o aviso acessível: `role="status"`, o spinner enterplak (o mesmo já copiado nas telas) e o texto
  "Carregando…". O texto pode ser trocado, por exemplo para "Carregando o fluxo…".

**Padrão, em ordem de preferência:**

1. **Toda rota que aguarda dados no servidor ganha um `loading.tsx`** na própria pasta. Ele mostra o título da
   tela (o mesmo `h2`), o `Carregando` e alguns `Bloco` no formato da tela: filtros, chips, linhas da lista. O
   Next mostra esse arquivo na hora do clique, porque ele é pré-carregado com o link, e troca pela tela quando ela
   fica pronta. O modelo é `shopfloor/analisar/parados/loading.tsx`. Não colocar um `loading.tsx` único no
   `(app)/`: um esqueleto genérico "pularia" em todas as telas.
2. **Quando parte da tela não depende do dado lento**, separar essa parte. O componente assíncrono fica dentro de
   `<Suspense fallback={...}>`, com fallback feito de `Bloco` + `Carregando`. Assim o cabeçalho e os filtros
   aparecem antes. Os primeiros candidatos são `recebimento/almoxarifado` (`EnvioCompels`) e `shopfloor/ordens`
   (`OrdensConteudo`), que já são componentes assíncronos separados.
3. **Na troca de filtro dentro da tela**, que navega para a mesma rota com outra URL, continua valendo o padrão
   que já existe: `useTransition` + `aria-busy` + "Carregando…" no título da lista. Para padronizar, trocar o
   texto solto por `<Carregando />`.
4. Os spinners copiados à mão (`fluxo-form.tsx` ×2, `lancamento-form.tsx`) passam a usar o `Carregando`.

**Ordem sugerida:** primeiro as telas pesadas, onde a espera é mais longa: `analisar/dashboard`,
`analisar/pesquisa`, `shopfloor/fluxo`, `recebimento/processos` e `recebimento/processos/[id]`. Depois as listas
paginadas (`registros` ×2, `configuracoes/logs`). Por último os cadastros simples, que são rápidos.
