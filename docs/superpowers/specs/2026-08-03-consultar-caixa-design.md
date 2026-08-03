# Consultar Caixa — Design

> **Data:** 2026-08-03 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-embalagem-caixa`
> **Tipo:** consulta (lista caixas de uma OP + peças dentro). **Sem migração, sem backend novo** (reusa `sf_caixas`/`sf_registros`). Complemento da Embalagem por caixa.

## Contexto

A Embalagem por caixa (0070) passou a registrar cada caixa em `sf_caixas` (código, qtd, aberta/fechada) e liga as
peças por `numero_caixa` em `sf_registros`. Hoje dá pra ver o código por peça nos Registros/Grade, mas **não há
uma visão agrupada "caixa → peças dentro"**. Esta feature adiciona isso.

## Objetivo

Aba **"Caixas"** em Análise: escolhe a OP → lista as caixas dela (abertas e fechadas) → clica numa → vê os Nº de
Série dentro (accordion). Só visualização.

## Escopo

**Dentro:** aba em Análise; escolher OP (dropdown das OPs que têm caixas); lista de caixas (código, posto, qtd,
status) + expandir pra ver os SNs. Mostra **abertas e fechadas**.
**Fora:** ações (reabrir, reimprimir etiqueta); caixas manuais antigas (free-typed, pré-feature) não aparecem (a
tela lista as caixas gerenciadas em `sf_caixas`); migração.

## Design

### 1. Infra — `caixa-repository.ts` (acrescenta)
```ts
export interface OpComCaixa { pmo: string; op: string; cliente: string }
export interface CaixaConsulta {
  seq: number; posto: string; fechada: boolean; limite: number
  codigo: string   // fechada → código final; aberta → 'CX{seq} (aberta)'
  qtd: number      // nº de peças (pieces.length)
  sns: string[]    // SNs dentro da caixa
}

/** OPs que têm ao menos uma caixa (distinct pmo/op de sf_caixas), enriquecidas com cliente (sf_ordens). */
export async function listarOpsComCaixas(): Promise<OpComCaixa[]>

/** Caixas de uma OP (todos os postos), com as peças de cada uma. */
export async function carregarCaixasDaOp(pmo: string, op: string): Promise<CaixaConsulta[]>
```
- `listarOpsComCaixas`: `select pmo,op from sf_caixas` → distinct (pmo,op) → buscar `cliente` em `sf_ordens`
  (map por pmo||op). Ordenar por pmo/op.
- `carregarCaixasDaOp`: (1) `sf_caixas where pmo,op order by posto,seq`; (2) `sf_registros where pmo,op and
  numero_caixa like 'CX%' select numero_serie,numero_caixa` → agrupar por `numero_caixa`; (3) pra cada caixa,
  chave = `fechada ? codigo : marcadorCaixaAberta(seq)`; `sns = grupo[chave] ?? []`; `qtd = sns.length`;
  `codigo` de exibição = `fechada ? codigo : 'CX' + seq + ' (aberta)'`.

### 2. Application — `embalagem-actions.ts` (acrescenta)
```ts
export async function caixasDaOp(pmo: string, op: string):
  Promise<{ ok: true; caixas: CaixaConsulta[] } | { ok: false; erro: string }>
```
(permissão `visualizar`; chama `carregarCaixasDaOp`.)

### 3. Rota + aba
- **`analisar/layout.tsx`:** acrescentar `{ rotulo: 'Caixas', href: '/shopfloor/analisar/caixas' }` (ao lado de Pesquisa/Registros/Dashboard/Burn-in).
- **`analisar/caixas/page.tsx`** (server): guarda `visualizar` (`SemPermissao` senão); `const ops = await listarOpsComCaixas()`; renderiza `<CaixasForm ops={ops} />`.

### 4. Client — `analisar/caixas/caixas-form.tsx` (novo)
- Dropdown **OP** (`ops`, rótulo `PMO/OP · cliente`). Ao selecionar → `caixasDaOp(pmo,op)` → `setCaixas(r.caixas)`.
- Lista de caixas: cada uma um item clicável (accordion). Cabeçalho: **código** · posto · **qtd peças** · badge
  **aberta/fechada**. Ao expandir → `<ul>` com os **SNs** (`sns`); vazio → "sem peças".
- Estado de "nenhuma OP escolhida" e "OP sem caixas".

## Critérios de sucesso
- Escolher uma OP lista suas caixas (abertas e fechadas), com código, posto, qtd e status.
- Expandir uma caixa mostra os SNs dentro dela.
- Caixa aberta mostra `CX{seq} (aberta)` com a contagem atual; fechada mostra o código final e a qtd.
- Build/lint/test verdes. Sem migração.

## Riscos / considerações
- **N registros por caixa** é pequeno (≤ limite) e poucas caixas por OP → 2 queries no total (caixas + registros), agrupa em memória.
- **Caixas manuais antigas** (numero_caixa free-typed, pré-0070) não aparecem — a tela é das caixas gerenciadas (`sf_caixas`). Aceitável (é a visão nova).
- Sem realtime: a lista é do momento do clique; reabrir a OP recarrega.
