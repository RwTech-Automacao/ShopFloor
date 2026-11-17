# Faturamento — tela de Baixa de NF com fila de prioridade (desenho)

Data: 17/11/2026 · Branch: `feat/faturamento-baixa-nf` · Aprovado pelo usuário em 17/11.
Substitui a regra "da mais antiga para a mais nova" de `2026-11-16-baixa-nf-compels-design.md` (em produção em
modo simulação desde 16/11). O que continua valendo de lá: o domínio que decide se a nota pode ser baixada
(`compels/domain/baixa-nf.ts`: nota inteira, só PA, rastreável/terceiros = manual), o gesto no Compels
(trava → `baixaMercadoria/baixar` → libera) e o cron de 10 em 10 minutos.

## Decisões

1. **Só baixa o que alguém selecionou.** A ordem em que a pessoa marca as notas é a prioridade.
2. **Ao confirmar:** nota por nota, na ordem marcada, relê a nota no Compels; com saldo no PA para todos os
   itens → baixa na hora; sem saldo → entra no fim da fila; baixa manual → recusa com o motivo.
3. **Fila:** o cron percorre a fila em ordem e baixa cada nota que já tem saldo. Nota sem saldo não trava as de
   trás. Em disputa pelo mesmo saldo, a da frente baixa primeiro (as notas são processadas uma de cada vez e os
   itens são relidos antes de cada baixa).
4. **Sem data de corte:** a tela mostra todas as pendentes (inclusive a NF 74202); `COMPELS_BAIXA_NF_DESDE` deixa
   de existir. O "Vendido em NF" do Fluxo soma todas as pendentes.
5. **Permissão própria `faturamento`:** `visualizar` (vê a tela) e `baixar` (seleciona, confirma, tira da fila).
   Como `vitrine`, NÃO liga flag legada `pode_*` (`MODULOS_SEM_FLAG_LEGADA`).
6. **Interruptor:** `COMPELS_BAIXA_NF=simular` faz tela e fila fazerem tudo menos a baixa ("simulação: seria
   baixada"); `=1` baixa de verdade; ausente = tela só leitura (o botão diz que a baixa está desligada).
7. **Baixada fora do ShopFloor:** nota da fila que deixou de estar pendente no Compels sai da fila como
   `baixada_fora`.
8. Avisos no Discord: fora deste escopo (ficam para depois).

## A tela — `/faturamento/baixa-nf` (grupo "Faturamento" no menu)

- **Filtros** (no navegador, sobre a lista lida): número da nota, cliente, item, período de emissão, "só as que
  já podem baixar".
- **Cada nota:** número, emissão, cliente (código + razão social), valor (`totalNota`), pedido de venda (tirado de
  `observacoesFinanceiro` "…Pedido de Venda 2836/26"; vazio se não houver), natureza da operação, e os itens:
  código, descrição, quantidade na nota, estoque atual no PA (vermelho se não cobre).
- **Situação:** Pode baixar · Sem saldo (qual item e quanto falta) · Na fila nº N · Baixa manual (motivo).
- **Seleção** com caixinha; o número da ordem de marcação aparece ao lado. "Baixar selecionadas (N)" abre a
  confirmação com o que vai acontecer com cada uma ("baixa agora" / "entra na fila na posição X" / "baixa manual");
  depois mostra o resultado por nota.
- **Seção Fila:** posição, nota, cliente, quem colocou, quando, última tentativa e mensagem; botão "Tirar da fila".
  Reordenar = tirar e selecionar de novo (vai para o fim).

## Banco — migração `0185_fat_fila_baixa_nf.sql`

Tabela `fat_fila_baixa_nf`: `id`, `nota_id` (id da nota no Compels), `numero`, `cliente`, `posicao` (bigint,
crescente), `status` (`aguardando` · `baixada` · `simulada` · `baixada_fora` · `removida` · `falhou`),
`colocado_por` (usuário), `colocado_em`, `tentativas`, `ultima_tentativa_em`, `ultima_mensagem`, `finalizado_por`,
`finalizado_em`. Índice único parcial: uma linha `aguardando` por `nota_id`. RLS: leitura com
`tem_permissao('faturamento','visualizar')`; escrita só pelas funções (security definer) com
`tem_permissao('faturamento','baixar')`; o cron usa a service role.

## Partes do código

- `compels/domain/baixa-nf.ts`: + leitura dos campos de exibição (cliente, valor, pedido, natureza, itens com
  descrição) e `situacaoDaNota` (pode baixar / sem saldo + faltas / manual). `avaliarNota` perde o `desde`.
- `compels/application/baixar-nfs.ts`: `confirmarSelecao(ids em ordem)` e `processarFila()` no lugar de
  `baixarNfsPendentes`; mesma porta do Compels + porta da fila (repositório).
- `faturamento/infra/fila-repository.ts`: ler/inserir/atualizar a fila.
- Rota do cron `/api/compels/baixa-nf` passa a chamar `processarFila`.
- Tela + server actions com checagem de `faturamento.baixar`.
- Estoque por item: `consultarSaldoPorEstoque` (PA) por código distinto, com o cache já existente.
- Fluxo: `vendidoEmNf` sem data de corte.

## Erros

- Compels fora: a tela mostra "Compels indisponível" e não deixa confirmar; o cron registra e tenta na próxima.
- Nota aberta por alguém no Compels (trava recusada): na confirmação, vai para a fila; na fila, tenta de novo.
- Baixa recusada pelo Compels: a nota fica na fila como `aguardando` com a mensagem e `tentativas` + 1; depois de
  5 falhas seguidas vira `falhou` e sai da fila (aparece na seção com o motivo).

## Testes

Domínio: situação da nota, pedido de venda do texto, campos de exibição. Aplicação: ordem da seleção; com saldo
baixa, sem saldo enfileira, manual recusa; simulação nunca chama `baixarNf`; fila em ordem, sem saldo não trava as
de trás, baixada fora sai, 5 falhas viram `falhou`; trava sempre liberada. Permissão: `faturamento` não liga
`pode_*`. SQL no harness (`supabase/tests/`): RLS e índice único da fila.
