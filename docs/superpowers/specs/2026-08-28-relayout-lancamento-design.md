# Relayout do Lançamento — design

> Design/spec. Branch `feat/shopfloor-lancamento-coletivo` (empilhado no Lote entre postos, pro
> smoke único). Reorganiza a tela de Lançamento pra aproveitar melhor o espaço: Contexto compacto,
> Peça|Contexto no topo, dois históricos por **Lançado/Não-lançado**, e o card do Lote compacto +
> persistente. Tela: ShopFloor → Operar → Lançamento.

## Contexto

A tela de Lançamento hoje (nesta branch) tem: Contexto full-width no topo → grade `lg:grid-cols-2`
(3 quando `ehColetivo`) com Peça | [Lote] | [resultado + contador + Histórico]. Sobra espaço mal
aproveitado, o Contexto ocupa altura demais, o card do Lote gera um scroll grande, e o histórico tem
uma coluna "Lançamento" que dá pra eliminar.

A branch **`feat/shopfloor-ajustes`** já implementou boa parte da base a imitar (commits no
`lancamento-form.tsx`): **Contexto compacto** (`renderContexto()` com `[&_label]:text-xs
[&_input]:h-8 [&_input]:text-sm [&_button]:h-8`), **topo Peça(esq) | Contexto(dir) na mesma altura**
(`grid lg:grid-cols-[2fr_3fr]`), **Peça compacta**, **última bipada em faixa horizontal** e **dois
históricos com scroll**. Vamos **imitar essa base** e aplicar por cima as mudanças novas (split por
Lançado/Não-lançado, colunas do histórico, card do Lote).

**Sem migração** — é UI + localStorage (client-side).

## Decisões travadas (do brainstorm)

- **Layout (lg):**
  - Topo: **Peça (esq) | Contexto compacto (dir)**, mesma altura, `grid-cols-[2fr_3fr]`. Contexto com
    fonte menor (imitar `renderContexto` da `ajustes`), **sem aumentar a altura**.
  - **Com lote:** linha 2 = **Lote | Última peça bipada**; linha 3 = **Hist. Lançado | Hist. Não-lançado**.
  - **Sem lote:** linha 2 = **Última peça bipada** (largura cheia); linha 3 = **Hist. Lançado | Hist. Não-lançado**.
  - Estreito (mobile/tablet retrato): empilha na ordem — Peça, Contexto, Lote (se houver), Última
    bipada, Hist. Lançado, Hist. Não-lançado. Mantém "cabe sem scroll de página; regiões rolam por dentro".
- **Histórico — 2 listas lado a lado:**
  - Divide por **Lançado / Não-lançado** (não mais aprovado/reprovado). **Lançado** = qualquer bip que
    gravou (aprovado *e* reprovado — o resultado fica na coluna Status). **Não-lançado** = os recusados
    (repetido/duplicado, fora da faixa, sequência, sem-manutenção, etc.).
  - **Tira a coluna "Lançamento"** (a divisão já é o lançamento).
  - Coluna **Status** só em postos com aprovado/reprovado (`mostraStatus`); nos demais (passagem,
    burn-in entrada) some.
  - Ordem das colunas: **Nº de Série · Status (se aplicável) · Data/hora (`dd/MM HH:mm:ss`)**. Menos
    colunas → **fonte maior** (subir de `text-sm`).
  - Continua **por sessão** (client-side, não persiste). Mais recente no topo. Scroll a partir de ~5 linhas.
- **Card do Lote:**
  - **Persiste em localStorage** por `(pmo, op, posto)` — sobrevive refresh (padrão do
    `nqa-progresso-local.ts`). Hidrata ao entrar/casar o contexto; salva a cada mudança; limpa no envio
    completo e na troca/descarte de contexto.
  - **Itens lado a lado em sequência** (flex-wrap, pills menores) → menos scroll.
  - **Emoji** no lugar de texto: **⏳ pendente · ✔️ aprovado · ❌ reprovado · ⚠️ falhou no envio**
    (motivo no `title`/hover). Mantém o "×" pra remover.
- **Contador** "Lançados — sessão N · nesta OP/posto M": **mantém**, perto da "última peça bipada".
- **Data/hora:** carimbada **client-side no momento do bipe** (novo campo em `LinhaHistorico`),
  formatada `dd/MM HH:mm:ss` no fuso America/Sao_Paulo (mesmo formatador da tela de Registros).

## Modelo (histórico)

`LinhaHistorico` ganha `dataHora`:

```ts
export interface LinhaHistorico {
  lancamento: boolean                          // gravou (true=Lançado) ou recusou (false=Não-lançado)
  status: 'aprovado' | 'reprovado' | null      // null = posto sem status
  sn: string
  dataHora: string                             // ISO, carimbado no cliente na hora do bipe
}
```

- `HistoricoLancamentos` vira uma lista **parametrizável** (título + colunas SN · [status] · data/hora),
  renderizada **duas vezes** no form: `linhas.filter(l => l.lancamento)` (Lançado) e
  `.filter(l => !l.lancamento)` (Não-lançado). A coluna Status só aparece quando o posto tem status
  (`mostraStatus`, prop). Helper puro pra separar as duas listas (cobrível por teste).
- Toda chamada `mostrar(res, linha)` no form passa a incluir `dataHora: new Date().toISOString()`.

## Card do Lote (localStorage)

- Novo helper `lote-local.ts` (espelha `nqa-progresso-local.ts`): `lerLoteLocal(pmo,op,posto)`,
  `salvarLoteLocal(pmo,op,posto,lote)`, `limparLoteLocal(pmo,op,posto)`. Chave inclui `(pmo,op,posto)`.
- No form: efeito de hidratação (ao casar `pmo/op/posto`, se houver lote salvo pra essa chave, carrega
  em `setLote`); efeito que **salva** o `lote` a cada mudança; `limparLoteLocal` no envio completo (lote
  esvaziou) e nos handlers de troca/descarte de contexto (`podeTrocarContexto`/`mudarPosto`/`atualizarCabecalho`).
- Render: cada item é uma **pill compacta** em `flex flex-wrap gap-2` — `[emoji] SN [×]`. Emoji por
  estado/outcome (⏳/✔️/❌/⚠️). O título do card e o botão "Enviar (R)" ficam como estão (contagem de
  resolvidos). Some o scroll grande atual.

## Layout — estrutura (lg)

No ramo do bipe normal (`!ehIntegracao && !ehEmbalagem && !ehNqaCaixa`), com `op !== ''`:

```
raiz: flex h-full min-h-0 flex-col gap-3
├─ Topo:        grid lg:grid-cols-[2fr_3fr] gap-3  → [Peça compacta] [Contexto compacto]
├─ Meio:        COM lote  → grid lg:grid-cols-2    → [Lote] [Última bipada + contador]
│               SEM lote  → [Última bipada + contador] (largura cheia)
└─ Históricos:  grid lg:grid-cols-2 min-h-0 flex-1 → [Hist. Lançado] [Hist. Não-lançado]  (rolam por dentro)
```

- **Contexto compacto** = `renderContexto()` imitando a `ajustes` (fonte/altura menores; sem OP =
  campo de bipe; com OP = grade Colaborador/Cliente/PMO/OP/Posto/Descrição em `text-xs`/`h-8`).
- **Peça compacta** = mesma altura do Contexto (campo/labels/botão menores, como na `ajustes`).
- **Estado sem OP:** só o Contexto (campo de bipe), como hoje.
- **Postos especiais** (Integração/Embalagem/NQA-caixa): **também** têm o topo **[Painel especial
  (esq) | Contexto compacto (dir)]** na mesma linha (o painel da vez ocupa o slot da "Peça"). Ou seja,
  o topo `[conteúdo | Contexto compacto]` vale pra TODAS as telas de Lançamento — não só o ramo normal.
  O restante do painel especial (o conteúdo próprio dele: lista de componentes da Integração, estado
  da caixa da Embalagem, amostragem do NQA) segue abaixo/dentro do slot esquerdo.
  - **Ressalva (Integração):** a lista de componentes é larga; se não couber bem ao lado do Contexto,
    mantém-se o Contexto compacto mas o painel de Integração em **largura cheia** (decidir no
    smoke/impl por painel). Embalagem e NQA-caixa entram no side-by-side normalmente.
  - As faixas 2 (Lote|Última) e 3 (Hist|Hist) continuam **só no ramo normal** — os painéis especiais
    têm o fluxo próprio deles abaixo do topo.
- Disabled durante `enviando/processando/enviandoLote` e a **tela de load** (overlay z-40) continuam
  como estão.

## Escopo

**Entra:**
- `renderContexto()` compacto (todas as telas de Lançamento).
- Grid de 3 faixas no ramo normal (Peça|Contexto · Lote|Última / Última · Hist|Hist).
- `LinhaHistorico.dataHora` + carimbo no cliente; `HistoricoLancamentos` parametrizável (título +
  status condicional + data/hora), renderizado 2× (Lançado/Não-lançado); tira coluna "Lançamento";
  fonte maior.
- Card do Lote: localStorage por `(pmo,op,posto)` + pills inline + emoji ⏳/✔️/❌/⚠️.
- Contador mantido perto da última bipada.

**Fora de escopo:**
- Layout configurável por admin (aquele spec está morto).
- Mudar lógica de bipe/aprovar/reprovar, RPCs, ou o comportamento do lote entre postos (só muda a
  APARÊNCIA do card + persistência).
- Persistir o histórico (continua por sessão).
- 2×2 antigo (descartado).

## Arquivos (previsão)

- **Modificar** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — `renderContexto`,
  grid de 3 faixas, 2 históricos, carimbo `dataHora`, card do Lote (pills + emoji), hidratação/salvar
  localStorage do lote, posição do contador.
- **Modificar** `src/app/(app)/shopfloor/operar/lancamento/historico-lancamentos.tsx` — `LinhaHistorico`
  + `dataHora`; lista parametrizável (título + `mostrarStatus` + coluna data/hora; sem coluna
  Lançamento); fonte maior.
- **Criar** `src/app/(app)/shopfloor/operar/lancamento/lote-local.ts` — helpers localStorage do lote.
- **Criar/estender** `src/modules/shopfloor/domain/lote.ts` — helper puro `separarHistorico`/emoji do
  estado (ou um `emojiDoItem`), cobrível por teste. (data/hora format reusa o padrão da tela de Registros.)

## Como saber que deu certo

- **Desktop, posto com lote:** topo Peça|Contexto (Contexto com fonte menor, mesma altura); meio
  Lote|Última bipada; base Hist. Lançado | Hist. Não-lançado. Card do Lote com pills inline + emoji
  (⏳/✔️/❌), sem scroll grande.
- **Desktop, posto sem lote:** topo Peça|Contexto; Última bipada cheia; base Hist Lançado|Não-lançado.
- **Histórico:** um SN aprovado aparece em **Lançado** com ✓ no Status e data/hora `dd/MM HH:mm:ss`;
  um SN **repetido** ou **fora da faixa** aparece em **Não-lançado**; postos sem status não mostram a
  coluna Status; sem coluna "Lançamento".
- **Lote persistente:** monta um lote, **F5** → o lote volta (mesmo contexto); trocar de posto/OP
  limpa; enviar tudo limpa.
- **Tablet retrato:** empilha na ordem, sem scroll de página; regiões rolam por dentro.
- `npm run lint` + `tsc` + testes verdes (helpers puros cobertos por unidade; layout por smoke).
