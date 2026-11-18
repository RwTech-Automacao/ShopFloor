# Plano — Faturamento: tela de Baixa de NF com fila de prioridade

Spec: `docs/superpowers/specs/2026-11-17-faturamento-baixa-nf-design.md` · Branch: `feat/faturamento-baixa-nf`.
Cada tarefa: teste primeiro (vermelho), código, verde, `tsc` + `eslint` nos arquivos mexidos, commit.
Verificação: `npx vitest run --maxWorkers=2 <caminhos>`, `npx tsc --noEmit -p .`, `npx eslint <caminhos>`.

## Tarefa 1 — Permissão própria `faturamento` (visualizar, baixar)

Arquivos: `src/modules/auth/domain/perfil.ts`, `modulos.ts`, `mapear-perfil.ts`,
`src/modules/perfis/domain/regras-perfil.ts` (+ testes em `__tests__` de cada um).

- `Permissao` ganha `'baixar'`; as 9 de antes viram `PermissaoLegada` (são as que têm coluna `pode_*`).
  `Perfil.permissoes` e `podeFazer` ficam em `PermissaoLegada`; `flagsLegadas` devolve só `pode_<legada>`.
- `Modulo` ganha `'faturamento'`; `MODULOS` ganha `{ faturamento, 'Faturamento' }`;
  `PERMISSOES_POR_MODULO.faturamento = ['visualizar', 'baixar']`; `mapearPerfil` inicializa `faturamento: {}`.
- `PERMISSOES` (rótulos da tela de perfis) ganha `{ baixar, 'Baixar NF' }`.
- **Segurança:** `MODULOS_SEM_FLAG_LEGADA = ['vitrine', 'faturamento']`. Teste: `faturamento.visualizar` e
  `faturamento.baixar` não ligam nenhum `pode_*`.

## Tarefa 2 — Domínio da nota (`src/modules/compels/domain/baixa-nf.ts`)

Testes em `domain/__tests__/baixa-nf.test.ts`.

- `avaliarNota` perde `desde` e o `fora_da_janela` (sem data de corte).
- `lerNota` lê também os campos de exibição: `clienteCodigo`, `clienteNome`, `valor` (`totalNota`),
  `pedidoVenda` (de `observacoesFinanceiro`), `natureza` (`naturezaOperacao`, texto ou objeto com descrição).
- `pedidoDeVenda(texto)`: "…Pedido de Venda 2836/26" → `2836/26`; sem o padrão → `''`.
- `itensDaNota(proprias)`: um por item da nota (`itemNotaICMS.id`): código, descrição, quantidade da nota.
- `situacaoDaNota(decisao, itens, estoquePa)`: `pode_baixar` · `sem_saldo` (faltas por código) · `manual`.
- `previsaoDaSelecao(selecao em ordem, estoquePa, tamanhoDaFila)`: "baixa agora" (consome o estoque do PA na
  ordem) · "entra na fila na posição X" · "baixa manual" · "já está na fila".

## Tarefa 3 — Aplicação (`src/modules/compels/application/baixar-nfs.ts`)

Testes em `application/__tests__/baixar-nfs.test.ts` (Compels e fila de mentira).

- `configBaixaNf(env)`: só o modo (`simular` | `baixar`) e o usuário; sem `COMPELS_BAIXA_NF_DESDE`.
- Porta da fila: `FilaDaConfirmacao` (`aguardando`, `colocar`) e `FilaDoCron` (`aguardando`, `tentativa`,
  `finalizar`).
- `confirmarSelecao(compels, fila, notaIds em ordem, { modo, usuario })`: lista as pendentes uma vez; nota por
  nota relê os itens; não pendente → `nao_pendente`; já aguardando → `ja_na_fila`; manual → `manual` (recusa);
  sem saldo → fila; com saldo → simulação (`simulada`, nunca trava/baixa) ou trava → baixa → libera;
  trava recusada → fila; baixa recusada/erro → fila com a mensagem e `tentativas = 1`.
- `processarFila(compels, fila, { modo, usuario })`: fila em ordem; nota que não está mais pendente →
  `baixada_fora`; manual → `falhou` com o motivo; sem saldo / trava recusada → `tentativa` (zera as falhas
  seguidas); com saldo → `simulada` (simulação) ou baixa; recusa/erro → falha (`tentativas + 1`; na 5ª seguida
  → `falhou`). Trava sempre liberada. Nota sem saldo não trava as de trás.
- `mensagensDeAviso` passa a ler o resumo da fila (baixada / simulada / falhou / baixada fora; uma vez cada).

## Tarefa 4 — Migração `supabase/migrations/0185_fat_fila_baixa_nf.sql` + teste SQL

Arquivos: a migração, `supabase/tests/fat_fila_baixa_nf_test.sql`, `supabase/tests/rodar-fat-fila-baixa-nf-test.sh`.

- Tabela `fat_fila_baixa_nf` (colunas da spec + `colocado_por_nome`/`finalizado_por_nome`, porque a tabela
  `usuarios` não é legível por quem só tem Faturamento); `posicao` por sequência; checks de status.
- Índice único parcial `(nota_id) where status = 'aguardando'`.
- RLS: select com `(select tem_permissao('faturamento','visualizar'))`; sem policy de escrita; grants:
  select para `authenticated`, tudo para `service_role`.
- RPCs `security definer` com `tem_permissao('faturamento','baixar')`: `fat_fila_colocar` (aguardando ou
  registro de baixa direta/simulada; idempotente para a nota já aguardando; devolve a posição na fila) e
  `fat_fila_tirar` (aguardando → removida).
- Teste: leitura sem permissão = 0 linhas; insert/update direto recusado; RPC sem `baixar` recusada; índice
  único; posição crescente; tirar da fila; migração reaplicada 2× e do zero em transação única.

## Tarefa 5 — Infra: repositório da fila, estoque do PA, Fluxo sem corte

Arquivos: `src/modules/faturamento/infra/fila-repository.ts` (usuário: leitura + RPCs; serviço: tabela),
`src/modules/shopfloor/infra/estoque-compels.ts` (+ teste).

- `estoque-compels.ts`: cache por código das linhas de `consultarSaldoPorEstoque` compartilhado entre o card
  do Fluxo e a tela nova (`buscarSaldoPa`); `vendidoEmNf` sem `COMPELS_BAIXA_NF_DESDE` (soma todas as pendentes).

## Tarefa 6 — Rota do cron

`src/app/api/compels/baixa-nf/route.ts` chama `processarFila` com a fila do serviço (service role). Desligada
sem `COMPELS_BAIXA_NF`. Uma rodada por vez no processo.

## Tarefa 7 — Tela `/faturamento/baixa-nf` + server actions + menu

Arquivos: `src/modules/faturamento/application/carregar-tela.ts`, `.../application/actions.ts`,
`src/app/(app)/faturamento/baixa-nf/page.tsx`, `.../baixa-nf-tela.tsx`, `src/shared/ui/app-shell.tsx`.

- Página: `faturamento.visualizar`, senão `SemPermissao`. Compels fora → "Compels indisponível" (sem confirmar).
- Filtros no navegador (número, cliente, item, período de emissão, "só as que já podem baixar").
- Nota: número, emissão, cliente, valor, pedido, natureza, itens (código, descrição, qtd, estoque PA em
  vermelho se não cobre), situação.
- Seleção com caixinha + número de ordem; "Baixar selecionadas (N)" → confirmação com a previsão → resultado.
- Seção Fila (aguardando + as que falharam nos últimos 7 dias) com "Tirar da fila".
- Actions conferem `faturamento.baixar` e o interruptor; sem `COMPELS_BAIXA_NF` o botão explica que a baixa
  está desligada.
- Menu: grupo "Faturamento" com "Baixa de NF".

## Tarefa 8 — Verificação final e push

Testes dos módulos mexidos, `tsc`, `eslint`, `rm -rf .next && next build`, teste SQL no Docker;
`git push -u origin feat/faturamento-baixa-nf`.
