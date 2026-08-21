# Lançamento — novo layout 2×2 (feature A da reunião)

> Design/spec. Feature **A** do bloco da reunião de 2026-08-20. Reorganiza as regiões
> da tela de Lançamento (ShopFloor → Operar → Lançamento) num grid 2×2 em telas largas.

## Contexto

A tela de Lançamento (`src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`)
hoje tem 3 regiões:

1. **Contexto** (cabeçalho) — largura cheia, no topo. Dois estados: sem OP = campo de
   bipe "carregar OP"; com OP = grade Colaborador/Cliente/PMO/OP/Posto/Descrição.
2. **Peça** (bipe/ação) — em `lg`, coluna esquerda da área de ação.
3. **Resultado + contador + Histórico** — em `lg`, coluna direita (empilhados).

A reunião pediu para **reorganizar em 2×2**, aproximando o bipe (ação principal) e o
contexto no topo, e separando histórico do resultado embaixo.

## Layout alvo (somente `lg`+)

```
┌──────────────────────┬────────────────────┐
│  PEÇA (bipe/ação)     │  CONTEXTO (cabeç.)  │  ← topo
├──────────────────────┼────────────────────┤
│  HISTÓRICO            │  ÚLTIMO (resultado) │  ← base
└──────────────────────┴────────────────────┘
```

Mapeamento a partir de hoje:
- **Peça** → topo-esquerda (hoje: coluna esquerda da ação)
- **Contexto** → topo-direita (hoje: largura cheia no topo)
- **Histórico** → base-esquerda (hoje: parte de baixo da coluna direita)
- **Último** = `PainelResultado` + contador "Lançados" → base-direita (hoje: topo da coluna direita)

## Escopo

**Só o bipe normal de peça.** São os postos que renderizam o card **"Peça"**, ou seja o
ramo `!ehIntegracao && !ehEmbalagem && !ehNqaCaixa`:

| Terão o 2×2 | Detecção (perfil do posto) |
|---|---|
| Inspeção SMD/PTH/Final, Teste, Teste Final | `reprova = 'defeitos'` (scanner) |
| Inspeção SPI | `reprova = 'posicoes'` |
| Burn-in (entrada e saída) | `recurso = 'burnin'` |
| NQA individual (OP com embalagem individual) | `recurso = 'nqa'` e OP individual |
| Passagem (ex. Inicial) | sem status, só bipe |

**NÃO mudam** (mantêm largura cheia + painel próprio dentro):

| Inalterado | Painel |
|---|---|
| Integração | `IntegracaoPanel` (`recurso = 'integracao'`) |
| Embalagem por caixa | `EmbalagemPanel` (`recurso = 'caixa'`) |
| Embalagem individual | `EmbalagemIndividualPanel` |
| NQA por caixa (amostragem) | `NqaCaixaPanel` (`recurso = 'nqa'` e OP não-individual) |

> **Fase 2 do layout (backlog, NÃO neste spec):** aplicar o 2×2 também às 4 telas
> especiais. Decidido adiar — "primeiro as fáceis".

## Comportamento

### Estado inicial (sem OP)
Enquanto `op === ''`, mostra **apenas o Contexto no estado de bipe** ("Bipe o Nº de Série
para carregar a OP"), como hoje — sem quadrantes vazios. Assim que a OP carrega, a tela
abre no 2×2.

### Tela estreita (tablet retrato / < `lg`)
**Mantém exatamente o empilhamento de hoje**: Contexto → Peça → Último (resultado) →
Histórico. O 2×2 é um ganho **exclusivo de tela larga** (`lg:`). O comportamento
"cabe sem scroll na página, regiões internas rolam" (afinado no PR #9) **não muda** no
estreito.

### Seleção de posto especial (artefato aceitável)
Se o operador seleciona um posto **especial** (Integração/Embalagem/NQA-caixa), a tela sai
do 2×2 e volta ao layout de largura cheia (Contexto no topo + painel cheio embaixo).
Acontece **uma vez** na seleção do posto (o operador fica num posto por sessão), não
atrapalha o uso. Some quando a fase 2 do layout converter essas telas.

## Abordagem técnica

- No ramo do bipe normal, quando `op !== ''`, envolver as 4 regiões num container
  `lg:grid lg:grid-cols-2 lg:grid-rows-2` (empilhado abaixo de `lg`).
- **Ordem no DOM** = ordem do estreito: **Contexto, Peça, Último, Histórico** (preserva o
  empilhamento atual sem `order-*` no mobile).
- **Posicionamento nos quadrantes** só em `lg`, via `lg:col-start`/`lg:row-start`:
  - Contexto → `lg:col-start-2 lg:row-start-1` (topo-dir)
  - Peça → `lg:col-start-1 lg:row-start-1` (topo-esq)
  - Último → `lg:col-start-2 lg:row-start-2` (base-dir)
  - Histórico → `lg:col-start-1 lg:row-start-2` (base-esq)
- Separar, no ramo normal, o bloco de baixo da coluna direita de hoje: **Histórico** vira
  um quadrante próprio; **`PainelResultado` + contador "Lançados"** viram o quadrante
  "Último".
- **Altura/scroll:** o container raiz segue `h-full min-h-0`; as duas linhas do grid usam
  `lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]` (ou equivalente) para travar as linhas e
  deixar Peça/Histórico/Último rolarem **por dentro** em vez de empurrar a página. Este é
  o ponto de maior atenção da implementação (paridade com o comportamento sem-scroll do
  PR #9).
- Manter o Contexto como **um só componente** com seus dois estados (bipe / grade) — só
  muda **onde** ele é renderizado (topo-dir no 2×2 vs largura cheia nas telas especiais e
  no estado sem-OP).

## Fora de escopo

- Fase 2 do layout (telas especiais no 2×2).
- Qualquer mudança de comportamento do bipe, do cabeçalho ("Atualizar cabeçalho" é a
  **feature B**, separada) ou das RPCs.
- Mudança no empilhamento de tela estreita.

## Arquivos

- **Modificar:** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`
  (apenas o JSX de layout do return; nenhuma lógica de estado/handlers muda).

## Migração

Nenhuma. É só layout.

## Como saber que deu certo

- Em desktop/paisagem (`lg`+), com OP carregada e posto normal: as 4 regiões aparecem nos
  quadrantes corretos (Peça topo-esq, Contexto topo-dir, Histórico base-esq, Último
  base-dir); nada empurra a página; Histórico e Último rolam por dentro.
- Sem OP: só o campo de bipe do Contexto.
- Tablet retrato: empilhamento idêntico ao de hoje, sem scroll de página.
- Postos especiais (Integração/Embalagem/NQA-caixa): telas idênticas às de hoje.
- `npm run lint` + testes existentes verdes (é layout — sem novos testes de unidade;
  verificação é visual/smoke).
