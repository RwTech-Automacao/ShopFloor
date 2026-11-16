# Baixa automática de NF de saída no Compels — desenho

Data: 16/11/2026 · Branch: `feat/baixa-nf-compels` · Aprovado pelo usuário em 16/11.

## Problema

No fim do mês o Compels é "aberto" para emitir NF de venda sem saldo. Essas notas NÃO baixam o estoque;
alguém precisa entrar nota por nota na tela **Baixa de Mercadoria** e baixar quando houver saldo. Quando o
ShopFloor aponta a produção no Compels, o saldo aparece, mas a nota continua pendente.

## Decisões

1. **Janela:** só notas de saída emitidas a partir do dia em que a automação for ligada
   (`COMPELS_BAIXA_NF_DESDE`, data `aaaa-mm-dd`, posta no `.env` no dia de ligar). Sem a variável, nada roda.
   A NF 74202 (25/07/2025, JIG100) — a única pendente antiga — nunca entra.
2. **Ordem:** da mais antiga para a mais nova (`dataHoraEmissao`, depois `numero`).
3. **Nota inteira ou nada:** baixa só quando TODAS as linhas de estoque próprio têm lote com saldo no
   estoque **PA**, a soma por item bate com a quantidade da nota, e nenhum item é rastreável. Senão a nota
   espera a próxima rodada. Sem baixa parcial.
4. **Item rastreável** (controle por número de série no Compels): a automação não inventa números de
   série — a nota fica para baixa manual e entra no aviso. Número de série escrito na observação da nota
   (informações complementares) é só texto e não muda nada.
5. **Notas com linhas em terceiros** (EmTerceiros/DeTerceiros): ficam para baixa manual.
6. **Gesto:** igual à tela — trava `lock/lfi.notaicms/{id}` → `POST baixaMercadoria/baixar` (JSON) →
   libera a trava. Corpo montado como o `baixar` do JS da tela.
7. **Simulação primeiro:** `COMPELS_BAIXA_NF=simular` só registra no log o que faria; `=1` baixa de verdade.
   Antes do `=1`: uma baixa real acompanhada (HAR) para confirmar o corpo.
8. **Avisos:** nota que falhou ao baixar ou que precisa de baixa manual vai para os Alertas (Telegram).
9. **Fluxo:** o "Total disponível" do card Finalizadas desconta a quantidade das NFs pendentes do produto.

## Partes

- `compels/domain/baixa-nf.ts` (puro): lê as linhas, decide `baixar` / `esperar` / `manual` por nota e
  monta o corpo.
- `compels/infra/cliente.ts`: `listarNfsPendentes`, `itensDaNf`, `travarNf`/`liberarNf`, `baixarNf`.
- `compels/application/baixar-nfs.ts`: a rodada (ordem, simulação, trava sempre liberada).
- `api/compels/baixa-nf/route.ts`: cron com segredo próprio, mesmo padrão do `/api/shopfloor/estoque`.
- Fluxo: soma das pendentes por produto no `lerPendenteCompels`.

## Testes

Domínio: nota sem lote / lote fora do PA / soma diferente / rastreável / terceiros / emitida antes do corte
→ não baixa; nota completa → corpo igual ao da tela. Rodada: simulação nunca chama o `baixar`; trava
liberada mesmo com erro; ordem por emissão.
