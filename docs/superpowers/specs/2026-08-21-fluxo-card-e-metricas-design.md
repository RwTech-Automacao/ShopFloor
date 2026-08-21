# Fluxo da OP — card redesenhado + métricas (feature D da reunião)

> Design/spec. Feature **D** do bloco da reunião de 2026-08-20. Redesenha o card do canvas
> de Fluxo e ajusta duas métricas do Modo TV. Tela: ShopFloor → Análise → Fluxo
> (`src/app/(app)/shopfloor/analisar/fluxo/`).

## Contexto

O card atual (`fluxo-node.tsx`, 200px) mostra: ícone + nome do posto + subtítulo + um badge
com o **WIP** (fila) no canto direito. O Modo TV (`fluxo-form.tsx`, `telaCheia`) mostra no
cabeçalho: PMO/OP · **Cliente** + um **% de prontas** (peças que passaram pelo último posto ÷
qtd da OP).

A reunião pediu um card mais informativo e um % que reflita o processo inteiro.

## Escopo desta feature (D1 + D3 + D4)

Três mudanças, **todas client-side, sem migração e sem query nova** (os dados já existem):

- **D1 — Card redesenhado** (`fluxo-node.tsx`)
- **D3 — Modo TV: remover o nome do cliente** (`fluxo-form.tsx`)
- **D4 — % "macro" do processo** (`fluxo-form.tsx`)

> **D2 (tempo na linha entre postos) — ADIADO**, vira feature própria. Motivo: exige um
> modelo de **jornada de trabalho** (turno + almoço + dias úteis) pra não contar noite/almoço/
> fim de semana no tempo de trajeto. Fica no backlog com brainstorm próprio. **Não** entra aqui.

## Dados (já existem — sem migração)

- **"Já passaram"** por posto = `passou` = `temStatus ? aprovadas : registros`. É o mesmo
  valor que já deriva o `concluido` hoje (em `domain/fluxo-op.ts` `dados()`). `aprovadas`/
  `registros` já são campos de `FluxoNodeData`.
- **"Devem passar"** = `qtd` da OP. Já é parâmetro de `dados()` (só não é devolvido no node
  hoje) e já está no `fluxo-form` (`qtd` state).
- **Barra** = `passou / qtd` (clamp 0–100%).
- **% macro** = Σ `passou_posto` (postos normais) ÷ (`qtd` × nº de postos normais).

## D1 — Card redesenhado

**Só nos postos normais.** Manutenção e as caixas Entrada/Saída **não mudam** (não têm
"devem passar"). Aplica ao card do ramo padrão de `FluxoNodeBase` (não ao ramo
`ehEntrada || ehSaida`, nem quando `ehManutencao`).

Layout novo (o card branco continua igual; muda o entorno):

```
        10 / 100            ← "já passaram / devem passar", ACIMA e FORA do card
      ┌───────────────┐
 (3)──┤ [ícone] Teste  │    ← WIP na ENTRADA: círculo à esquerda, metade fora
      │        teste    │
      └───────────────┘
      ▓▓░░░░░░░░░░░░░░    ← barra de progressão, ABAIXO e FORA do card
```

1. **WIP → entrada (esquerda, metade fora).** O número que hoje é o badge do canto direito
   passa a um **círculo** ancorado na borda ESQUERDA do card, centralizado na vertical,
   metade fora/metade dentro ("a peça chegando"). Vinho com texto branco quando `wip > 0`;
   cinza (`muted`) quando `wip = 0`. Remove o badge do canto direito.
2. **"Já passaram / devem passar" ACIMA, fora do card.** Ex.: `10 / 100`. `passou` em
   destaque, `/ qtd` suave.
3. **Barra de progressão ABAIXO, fora do card.** Largura = `passou / qtd` (clamp 100%),
   preenchida em vinho sobre trilho `border`/`muted`.

**Regras de borda:**
- `qtd == null` (OP sem quantidade): **não** mostra o "/ devem passar" nem a barra (não há
  denominador). O card + WIP aparecem normalmente. (Mostrar só `passou` acima é aceitável.)
- O **subtítulo** atual ("passagem"/"teste/inspeção"/"concluído"/"em manutenção") **permanece**.
- O **ícone** e o tratamento de `concluido`/`selecionado` (borda vinho) **permanecem**.

**Cuidado técnico (o ponto de atenção):** o card é um **nó do React Flow**; os `Handle`
(target à esquerda, source à direita) conectam as arestas na borda do nó. Para as arestas
seguirem chegando no **meio do card** (e não deslocarem por causa do número acima / barra
abaixo), o número e a barra devem ser renderizados **absolutamente posicionados** (`top`
negativo / `bottom` negativo) — SEM aumentar a altura de layout do nó. Assim os `Handle`
continuam ancorados no card. O círculo do WIP fica sobre o ponto do `Handle` esquerdo
(z-index acima), reforçando o "peça chegando"; o `Handle` continua funcional por baixo. Pode
ser necessário um respiro vertical no espaçamento dos nós pra o número/barra não colidirem
com as arestas (ajuste fino de layout, sem mudar a lógica de posições).

Plumbing mínimo: adicionar `passou: number` e `devemPassar: number | null` a
`FluxoNodeData`, preenchidos em `dados()` (ambos já calculados/disponíveis ali). Os nós
sintéticos (`dadosCaixa`) recebem defaults que não disparam o novo visual.

## D3 — Modo TV: remover o cliente

No cabeçalho do Modo TV (`fluxo-form.tsx`, bloco `telaCheia`), **remover a linha que exibe
`opInfo.cliente`**. O restante do cabeçalho (PMO/OP + o %) permanece. O seletor de OP fora do
TV, que mostra `pmo/op · cliente` no dropdown, **não muda**.

## D4 — % "macro" do processo

Trocar o cálculo do % do Modo TV. Hoje:

```
prontas   = passou pelo ÚLTIMO posto (aprovadas|registros do último)
pctProntas = round(prontas / qtd * 100)
```

Novo — progresso do processo inteiro:

```
totalPassagens = Σ (temStatus ? aprovadas : registros)  para cada posto em postosOP
pctProcesso    = qtd > 0 && postosOP.length > 0
                 ? round( totalPassagens / (qtd * postosOP.length) * 100 )
                 : null
```

- `postosOP` já existe (postos normais em ordem, sem Manutenção/Entrada/Saída).
- Equivale à **média das % de cada posto** (mesma conta) e **exclui reprovados** (pois
  `passou` usa `aprovadas`).
- **Rótulo:** trocar "prontas" por algo que reflita progresso do processo (proposta:
  **"progresso"** ou **"% do processo"** — confirmar no review do spec). O número grande em
  vinho permanece.

## Fora de escopo

- **D2** (tempo na linha) — adiado, feature própria com jornada de trabalho.
- Qualquer mudança em RPC, migração, lógica de lançamento/fluxo dos dados.
- Comportamento dos nós especiais (Manutenção, Entrada, Saída) além do que está descrito.

## Arquivos

- **Modificar:** `src/app/(app)/shopfloor/analisar/fluxo/fluxo-node.tsx` (D1 — visual do card)
- **Modificar:** `src/modules/shopfloor/domain/fluxo-op.ts` (D1 — `passou`/`devemPassar` em
  `FluxoNodeData`/`dados()`; +testes)
- **Modificar:** `src/app/(app)/shopfloor/analisar/fluxo/fluxo-form.tsx` (D3 — remover cliente
  no TV; D4 — fórmula do %)

## Migração

Nenhuma.

## Como saber que deu certo

- Postos normais mostram: WIP na entrada (metade fora), "passou / qtd" acima, barra abaixo;
  as arestas continuam chegando no meio do card (não deslocaram).
- OP sem qtd: card sem "/ qtd" e sem barra, WIP normal.
- Manutenção e caixas Entrada/Saída: idênticas a hoje.
- Modo TV: sem o nome do cliente; o % reflete o progresso do processo inteiro
  (ex.: 4 postos, qtd 100, 250 passagens no total → 250/400 = 63%), não só o último posto.
- `npm run lint` + testes (incl. os novos de `passou`/`devemPassar` no domínio) verdes.
