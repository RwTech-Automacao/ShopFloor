# Nova OP — ignorar uma PRT (subparte) (desenho)

Data: 26/11/2026 · Branch: `feat/nova-op-ignorar-prt` · Desenho combinado com o usuário em 26/11.

## Contexto

Na Nova OP integrada ao Compels (0184), a OP chega como uma cadeia: as PRTs (placas/subpartes, as "filhas") e a
PMO mãe, cada uma um **trecho** com os seus postos (`cadastro-op.ts`: `trechosDoEspelho`, `distribuirPostos`). Hoje
toda PRT da cadeia vira trecho: tem faixa/série própria (se `sn_modo = 'proprio'`) e, com a 0197, é apontada
automaticamente no Compels (agrupada nos marcos de 25%).

Há PRTs que não devem ser acompanhadas assim. O usuário confirmou que os três casos acontecem:

- **A.** A placa não passa pela produção acompanhada (comprada pronta, terceiro, estoque): os postos dela saem da rota.
- **B.** A placa passa pela produção, mas não se quer acompanhá-la separada: os postos continuam na rota da OP.
- **C.** Outros motivos — cobertos pela mesma escolha (tirar ou manter os postos).

## Decisões

1. **Só PRT pode ser ignorada.** A PMO mãe nunca (o botão não aparece para ela, e o banco recusa).
2. **Onde:** no passo "Rota e faixas" da Nova OP, cada PRT tem **"Ignorar esta PRT"**. Ao ignorar, a pessoa escolhe:
   - **"Tirar os postos da rota"** (caso A) — os postos da PRT somem da OP;
   - **"Manter os postos na rota da OP"** (caso B) — os postos da PRT passam para o **trecho seguinte** da cadeia
     (no começo dele, preservando a ordem da rota); se a PRT era a última antes da PMO, vão para a PMO.
3. **PRT ignorada = não é trecho.** Não é gravada em `sf_ordem_trechos`: sem faixa, sem série própria, **sem
   apontamento automático no Compels** (o apontamento dela, quando houver, **continua manual**, como hoje). Nenhuma
   coluna nova: ignorar é simplesmente não enviar o trecho no cadastro.
4. **Antes de salvar:** a PRT ignorada aparece riscada no resumo, com o selo "Ignorada" e a escolha feita, e tem
   **"Desfazer"** (volta a ser trecho com os postos que tinha).
5. **Depois de salva:** a edição da OP (`/shopfloor/ordens-nova/[id]`, 0194) permite **incluir de novo** uma PRT da
   cadeia do Compels que ficou de fora, **enquanto não houver bipe** nos postos que passariam a ser dela. Se
   `sf_ordem_regravar_trechos` (0194) não aceitar trecho novo, a migração desta feature estende a função para aceitar
   (mesma regra de faixas/sobreposição e de histórico de bipes).
6. **Registro:** a decisão fica no log da OP (quem, quando, qual PRT, tirar/manter), pelo mesmo log já usado no
   cadastro/edição.

## O que muda

- **Domínio** (`src/modules/shopfloor/domain/cadastro-op.ts`): funções puras `ignorarPrt(trechos, seq, modo)` e
  `desfazerIgnorar(...)`, com testes: PMO recusada; "tirar" remove os postos; "manter" move os postos para o começo do
  trecho seguinte; desfazer devolve o estado anterior; seq renumerada sem buraco ao enviar.
- **Tela** (Nova OP, passo de rota e faixas; componentes de `src/app/(app)/shopfloor/ordens/`): botão por PRT, a
  escolha (dois botões), o selo "Ignorada" e "Desfazer". Nada além disso.
- **Banco:** `sf_cadastrar_op` já aceita a cadeia sem uma PRT? Conferir; se exigir a cadeia completa do espelho, a
  migração relaxa a regra **só para PRT** (PMO continua obrigatória). Edição: ver decisão 5.
- **Compels:** nada novo. O apontamento automático (0197) só olha trechos gravados, então a PRT ignorada nunca entra
  na fila.

## Testes

- Domínio: os casos da decisão 2/4 acima.
- Banco (harness `supabase/tests/`): cadastrar OP sem uma PRT da cadeia funciona; sem a PMO é recusado; o bipe no posto
  da PRT ignorada (modo "manter") não enfileira PRT; incluir de novo na edição sem bipe funciona e com bipe é recusado.
- Tela: ignorar/desfazer; a PMO não tem o botão.

## Fora do escopo

- Motivo cadastrado para ignorar (o caso C fica coberto pela escolha tirar/manter).
- Apontar no Compels a PRT ignorada.
