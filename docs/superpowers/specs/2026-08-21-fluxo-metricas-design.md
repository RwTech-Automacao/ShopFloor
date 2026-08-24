# Fluxo — métricas por posto + tempo entre postos (branch da D)

> Design/spec. Duas features do Fluxo, na branch `feat/shopfloor-fluxo-metricas` (a partir da
> D). #2 = 2 números novos nos postos com status; #1 = tempo entre postos (D2 pragmático).
> Ambas com **migração** (dados novos vindos do banco). Tela: ShopFloor → Análise → Fluxo.

## #2 — "Aprovados de primeira" + "Reprovados sem reteste" (nos postos com status)

### Significado (confirmado)
Por posto **com status** (`temStatus`: Teste/Inspeções/SPI/NQA/Burn-in):
- **Aprovados de primeira** = peças cuja **1ª passagem** no posto foi **Aprovado** (passou de
  cara, nunca reprovou lá primeiro). "First-pass yield".
- **Reprovados sem reteste** = peças cujo **último** registro no posto é **Reprovado** (reprovou
  e ainda não foi re-aprovada — reteste não aprovou ou nem foi retestada). Saldo pendente.

### Dados (migração — estender `sf_fluxo_op`)
A RPC `sf_fluxo_op` (última def. em 0080) já agrupa por posto (`aprovadas`/`reprovadas`/
`retestes`). Recriar (`create or replace`) adicionando 2 colunas ao `returns table`:
`aprovados_primeira int`, `reprovados_sem_reteste int`. Cálculo por peça (SN normalizado) dentro
de cada posto, via window/`distinct on`:
- `aprovados_primeira`: pra cada (posto, peça), o status da **1ª** passagem (menor `data_hora`,
  desempate `id`); conta onde = 'aprovado'.
- `reprovados_sem_reteste`: pra cada (posto, peça), o status da **última** passagem (maior
  `data_hora`); conta onde = 'reprovado'.
- Ambos só fazem sentido em posto com status; pra posto de passagem virão 0 (não exibidos).

### Domínio
`FluxoAgregado`/`FluxoNodeData` ganham `aprovadosPrimeira: number` e
`reprovadosSemReteste: number` (repo mapeia da RPC; `dados()`/`dadosCaixa()` default 0).

### Card (`fluxo-node.tsx`) — só postos com status
**Abaixo da barra de progressão**, com um respiro, uma linha compacta centrada com 2 itens
(absolutamente posicionada, tipo `-bottom-9`, não altera a altura do nó → não desloca as
arestas):
- 🟢 **sinal verde** (ícone lucide `CircleCheck`/círculo verde cheio) + `aprovadosPrimeira`.
- ⚠️ **triângulo com "!"** (lucide `AlertTriangle`, âmbar/vermelho) + `reprovadosSemReteste`.
- Só renderiza em posto `temStatus` (e não Manutenção/Entrada/Saída). Se ambos 0, pode mostrar
  `0`/`0` (é informativo) — confirmar no smoke se prefere esconder quando 0.

## #1 — Tempo entre postos (D2 pragmático)

### Objetivo
Na **aresta** entre dois postos consecutivos, mostrar o **tempo típico** que a peça leva no
trajeto (posto A → posto B). **Pragmático** (sem jornada configurável ainda):
- Por peça, transit = `t(registro em B) − t(registro em A)` pra postos consecutivos do fluxo.
- **Descartar** transits que **cruzam a noite / são longos demais** (proxy da jornada): regra =
  descartar se `> LIMITE` (proposta **4h**) OU se A e B são de **dias diferentes**. (LIMITE
  tunável; documentar.)
- **Mediana** dos transits restantes por aresta (robusta a outliers). Rótulo ex.: "~12 min".
- Sem transits válidos → sem rótulo (ou "—").

> Jornada configurável (turno+almoço+dias úteis, desconto exato) = **fase 2**, feature própria.

### Dados (migração)
Nova RPC (ex.: `sf_fluxo_tempos(p_pmo, p_op)`) que devolve, por **par de postos consecutivos**
(origem, destino), a **mediana** (em segundos/min) dos transits válidos. Consecutivos = ordem de
`sf_ordem_postos`. Cálculo: self-join dos registros por peça (SN norm) casando o registro de A
com o próximo registro de B; aplicar o descarte (LIMITE/cross-day); `percentile_cont(0.5)`.
(Só cadeia normal — reprova/Manutenção fora do escopo do tempo.)

### Domínio / render
- `FluxoEdge` (ou um mapa à parte por par origem→destino) ganha o tempo (segundos) da aresta.
- A `FloatingEdge` (ou um `EdgeLabelRenderer`) mostra o rótulo do tempo no meio da aresta,
  formatado (`formatarDuracao` já existe pro Burn-in). Só nas arestas da cadeia (não reprova).

## Migração
- **1 migração** cobrindo: recriar `sf_fluxo_op` (+2 colunas do #2) e criar `sf_fluxo_tempos`
  (#1). ⚠️ numeração a reconciliar com os gaps (0079/0081/0082) — SQL idempotente
  (`create or replace`). Usuário aplica no Dev.

## Fora de escopo
- Jornada de trabalho configurável (fase 2 do #1).
- Tempo nas arestas de reprova (Manutenção).
- Métricas em postos de passagem.

## Como saber que deu certo
- Postos com status mostram, abaixo da barra, 🟢 aprovados-de-primeira e ⚠️ reprovados-pendentes,
  batendo com os registros de uma OP de teste.
- Arestas da cadeia mostram um tempo típico (mediana), sem distorcer com noite/almoço (descarte).
- Postos de passagem / Manutenção / Entrada/Saída: sem os números novos e sem tempo de reprova.
- `tsc` + testes (cobrir 1ª-passagem/último-status e o descarte de transit no domínio, se a
  lógica couber no cliente; senão validar no smoke) verdes.
