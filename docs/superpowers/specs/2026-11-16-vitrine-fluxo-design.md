# Vitrine do Fluxo da OP (marketing) — desenho

Data: 16/11/2026 · Branch: `feat/vitrine-fluxo` · Pedido: tela para o marketing com um fluxo perfeito
(sem reprova, sem manutenção), sempre com os mesmos dados, permissão própria e **nenhuma** interferência
na produção real.

## Decisões (aprovadas pelo usuário em 16/11)

1. **Só o Fluxo da OP** por enquanto (o levantamento de outras telas ficou só como lista).
2. **Produto fictício:** PMO `DEMO`, "Placa controladora", OP `DEMO-01`, 1.000 peças, SN `DEMO000001…`.
   Rota de 12 postos: Printer → SPI → Pick & Place → Forno → AOI → Montagem PTH → Inspeção PTH →
   Teste funcional → Burn-in → Embalagem → NQA → Almoxarifado.
3. **Momento:** OP em torno de 93% concluída — peças no Almoxarifado, a "onda" final nos últimos postos.
4. **Peças andando (animação):** a vitrine tem um relógio simulado que avança enquanto a tela está aberta;
   a cada poucos segundos os números mudam e as linhas entre postos ficam "andando" (a mesma animação do
   Fluxo real). Bolinhas percorrem as linhas ativas. A janela é um laço: vai de ~90% a ~97% e recomeça.
5. **Isolamento:** a vitrine NÃO chama banco, Compels nem servidor de dados. O Fluxo passa a buscar tudo
   por um **fornecedor de dados** (contexto React `FonteFluxo`); o padrão continua sendo as Server Actions
   de hoje (o Fluxo real não muda de comportamento) e a vitrine fornece uma fonte que calcula tudo no
   navegador a partir de um modelo determinístico.
6. **Permissão própria:** módulo novo `vitrine` com só `visualizar`. A tabela `perfil_permissao` não tem
   check no módulo → **sem migração**. Rota `/vitrine/fluxo`; item "Vitrine" no menu só para quem tem a
   permissão. O marketing recebe um perfil só com Vitrine → visualizar.
7. **Horários fixos:** o modelo começa numa data fixa (seg 09/11/2026 07:00, expediente seg–sex
   07:00–17:00); a tela nunca "envelhece".

## Arquitetura

- `src/modules/shopfloor/application/fonte-fluxo.ts` (cliente): tipo `FonteFluxo` (as 16 funções que o
  Fluxo usa: carregarFluxo, fluxoPeriodo, rotaSn, detalhePosto, historicoPosto, producaoPeriodo,
  burninDetalhe, embalagemCaixas, snsManutencao, opsComBipes, buscarHistoricoSN, carregarDefeitosDaOp,
  carregarResumoDefeitos, carregarDashboard, lerEstoqueCompels, lerPendenteCompels), `fonteReal` (as
  Server Actions), `FonteFluxoProvider` e `useFonteFluxo()`.
- `fluxo-form.tsx`, `fluxo-node.tsx`, `defeitos-lista.tsx`, `historico-sn-dialog.tsx`, `dashboard-form.tsx`
  trocam a chamada direta por `useFonteFluxo()`. Sem provider = fonte real.
- `FluxoForm` ganha `intervaloAtualizacaoMs` (padrão 20 000, a vitrine usa 3 000) e `pecasAndando`
  (bolinhas nas linhas ativas; padrão desligado).
- `src/modules/vitrine/domain/op-demo.ts` (puro): modelo da OP perfeita — cada peça i passa no posto k no
  instante `inicio(i) + atraso(k)` em minutos úteis; daí saem agregados (reusa `construirFluxo`), detalhe e
  histórico do posto, produção por dia/hora, burn-in, caixas (50 por caixa), rota e histórico do SN,
  dashboard, estoque. Tudo em função do minuto simulado.
- `src/modules/vitrine/application/fonte-vitrine.ts` (cliente): implementa `FonteFluxo` sobre o modelo,
  com o relógio do laço.
- `src/app/(app)/vitrine/fluxo/page.tsx`: confere `vitrine.visualizar`, monta o provider e o `FluxoForm`
  com a OP fixa.

## Fora do escopo

Mais de uma OP; edição dos dados pela tela; outras telas da lista do marketing.

## Testes

- Modelo: contas fecham (soma por posto, 1.000 no total, 0 reprova, ~93% no instante inicial, laço volta).
- Fonte da vitrine: nenhuma Server Action é chamada (módulo das actions mockado e conferido).
- Fluxo real: os testes existentes continuam passando; sem provider usa a fonte real.
- Conferência visual local antes do merge.
