# Integração — verificação do SN da placa (N1) + info da OP no dropdown — Design

> Duas melhorias na tela de Integração, decididas com o usuário em 2026-07-24.

## Contexto

Na Integração, ao montar as placas de um produto: (a) o **SN da placa é livre** hoje — dá pra
bipar SN inexistente/com typo; (b) o **dropdown da OP da placa** mostra só o número da OP, e só
lista OPs ativas (incidental — reusa o carregador do Lançamento; o legado `obterPMO_OPS` não
filtrava status).

## Decisões (usuário, 2026-07-24)

- **N1 — verificação do SN da placa = dentro da faixa da OP da placa.** (N2/N3 ficam pra depois; N1
  é o mais reversível e sempre computável quando há faixa.)
- **"real" no dropdown = concluídas** = SNs distintos que **passaram/aprovaram no posto final** do
  fluxo da OP (aprovado se o posto final tem status; registrado se é sem-status).
- **Status no dropdown = bolinha colorida** (verde = Ativa, cinza = Finalizada).
- **Dropdown da placa passa a incluir OPs finalizadas** (restaura o legado; sem isso a bolinha não
  faz sentido). O **produto** continua só OPs **ativas** com Integração no fluxo.

## Arquitetura

### N1 — SN da placa na faixa (na `application`, não no SQL)
- Validado na action `integrar` (TS) reusando o domínio **`serieDentroDaFaixa`** (já testado — trata
  prefixo/sufixo/zeros). A faixa é propriedade estática (não é corrida) → não precisa ser atômica no
  SQL; validar na action evita duplicar a lógica complexa em plpgsql.
- Carrega um **mapa de faixas** de todas as OPs (`pmo||op → {sn_ini, sn_fim}`; ~130 linhas, barato).
  Para cada placa: se a OP tem faixa (os dois limites preenchidos) e o SN **não** está na faixa →
  erro `Nº de Série da placa N fora da faixa da OP <op>`. **Gradual:** OP sem faixa → não bloqueia.
- **Cliente** também valida (aviso inline por linha + botão travado), espelhando o servidor.

### Info da OP no dropdown — via view no banco
- **View `sf_ordem_resumo`** (migração `0036`): por OP → `pmo, op, qtd, status, concluidas`.
  `concluidas` = `count(distinct numero_serie_norm)` em `sf_registros` no **posto final** do fluxo da
  OP (última linha de `sf_ordem_postos` por `ordem`), contando *aprovado* se o posto final tem
  status, ou *qualquer registro* se é sem-status. `security_invoker = true` (respeita RLS do caller).
- **Carregador novo `listarOrdensParaIntegracao()`**: TODAS as OPs (ativas + finalizadas) com
  `cliente, pmo, op, descricao, sn_ini, sn_fim, qtd, status, postos, componentes, concluidas`
  (join com a view). Substitui o `listarOrdensParaLancamento` **só na página de Integração**.
- **Tela**: o item do dropdown da OP da placa vira `{op} ({qtd ?? '—'}/{concluidas}) ●`, bolinha
  verde (Ativa) / cinza (Finalizada). O produto filtra `status ≠ FINALIZADA && Integração no fluxo`.

## O que NÃO muda
Lançamento (segue usando `listarOrdensParaLancamento`, só-ativas), receita, gate de sequência,
duplicidades, cancelamento. OP sem faixa segue integrável (N1 gradual).

## Casos de borda
- OP da placa sem faixa → N1 não bloqueia. OP sem `qtd` → dropdown mostra `(—/N)`. OP sem postos →
  `concluidas = 0`. Produto nunca é finalizada (filtro mantém).

## Testes
- **Domínio:** `serieDentroDaFaixa` já coberto; N1 é aplicação. Teste de integração da action opcional.
- **Smoke no Dev:** (a) view retorna `concluidas` coerente pra uma OP conhecida; (b) placa com SN
  fora da faixa → barra; dentro → ok; OP sem faixa → passa; (c) dropdown lista finalizada + ativa.

## Migração
`0036` (view). Sem mudança de assinatura em funções. Só no Dev.
