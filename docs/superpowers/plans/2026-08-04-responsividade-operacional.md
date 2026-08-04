# Responsividade operacional + menu retrátil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) menu lateral retrátil no desktop (lembrado); (B) Lançamento cabendo sem rolar a página em retrato/paisagem/web; (C) responsividade de Manutenção e das Consultas.

**Architecture:** Só UI/layout (Tailwind). `app-shell` ganha estado de menu recolhido + localStorage. O Lançamento vira layout de altura cheia com regiões de scroll interno. Sem migração/backend.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, lucide-react.

## Global Constraints
- **Sem migração/backend.** PT-BR; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Não quebrar o **drawer mobile** atual nem o desktop atual (menu recolhido é opt-in, default mostrado).
- **Build/lint/test verdes ao fim de cada task.** "Sem scroll" é iterativo — validar no smoke; conteúdo grande rola na **região**, não na página.

## File Structure
- **Modify** `src/shared/ui/app-shell.tsx` — menu retrátil.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` (+ `embalagem-panel.tsx`, `integracao-panel.tsx`) — Lançamento sem scroll.
- **Modify** telas de Manutenção e Consultas (`operar/manutencao/*`, `operar/integracao/consulta-integracao-form.tsx`, `analisar/caixas/caixas-form.tsx`) — responsividade.

---

## Task 1: Menu lateral retrátil (`app-shell`)

**Files:** Modify `src/shared/ui/app-shell.tsx`.

- [ ] **Step 1: Imports** — acrescentar `useEffect` ao `import { useState } from 'react'` → `import { useEffect, useState } from 'react'`; acrescentar ao import do lucide: `PanelLeftClose, PanelLeftOpen`.

- [ ] **Step 2: Estado + persistência**

Perto dos outros `useState` (ex.: após `const [mobileAberto, setMobileAberto] = useState(false)`):
```ts
const [menuRecolhido, setMenuRecolhido] = useState(false)
useEffect(() => {
  if (localStorage.getItem('sf:menu-recolhido') === '1') setMenuRecolhido(true)
}, [])
useEffect(() => {
  localStorage.setItem('sf:menu-recolhido', menuRecolhido ? '1' : '0')
}, [menuRecolhido])
```

- [ ] **Step 3: Aside animado**

Trocar `<aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>` por:
```tsx
<aside className={cn('hidden shrink-0 overflow-hidden transition-[width] duration-200 lg:block', menuRecolhido ? 'lg:w-0' : 'lg:w-64')}>{sidebar}</aside>
```

- [ ] **Step 4: Botão de recolher (desktop) no header**

No `<header>`, **antes** do hambúrguer mobile (ou logo após), acrescentar:
```tsx
<button
  type="button"
  onClick={() => setMenuRecolhido((v) => !v)}
  className="-ml-1 hidden rounded-md p-2 text-muted-foreground hover:bg-accent lg:inline-flex"
  aria-label={menuRecolhido ? 'Mostrar menu' : 'Recolher menu'}
>
  {menuRecolhido ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
</button>
```
(O hambúrguer mobile `lg:hidden` fica.)

- [ ] **Step 5: Build + lint + testes** → verdes.

- [ ] **Step 6: Commit**
```bash
git add src/shared/ui/app-shell.tsx
git commit -m "feat(shopfloor): menu lateral retrátil no desktop (lembrado no localStorage)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Lançamento cabe sem scroll

**Files:** Modify `lancamento-form.tsx`, `embalagem-panel.tsx`, `integracao-panel.tsx`.

> Layout adaptativo — trabalho iterativo. Alvo: a **página não rola**; usa a altura do `<main>`; regiões que crescem rolam internamente. **Não mudar** o `<main>` global (outras páginas seguem rolando).

- [ ] **Step 1: Raiz do `lancamento-form` ocupa a altura**

Trocar o wrapper de retorno `return (<div className="flex flex-col gap-4">…` por `return (<div className="flex h-full min-h-0 flex-col gap-3">…`. (O `<main>` é `flex-1 overflow-y-auto` — `h-full` faz o form preencher; regiões internas contêm o overflow.)

- [ ] **Step 2: Contexto compacto (topo, altura natural)**

O card **Contexto** fica `shrink-0`; reduzir respiro: `CardContent` de `gap-4 … p-6`(default) pra algo mais compacto (ex.: `gap-3` e padding menor via `className`). Grid segue `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (empilha no estreito). Manter os campos read-only do cabeçalho por bipe.

- [ ] **Step 3: Área de ação adaptativa + scroll interno**

O bloco de ação (o card **Peça** OU o painel de Embalagem/Integração) vai num container `flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-2 lg:gap-4` — **empilha no estreito, 2 colunas no `lg`**. Onde hoje o `PainelResultado` fica **dentro** do card Peça, movê-lo pra ser a **2ª coluna** no `lg` (ao lado do bipe), e abaixo no estreito.
- Regiões que crescem ganham `min-h-0 overflow-y-auto`: a **lista de defeitos** (reprovado) no card Peça; a **tabela de receita** no `integracao-panel`; o **quadro de SNs** no `embalagem-panel`.
- Os painéis (`embalagem-panel`/`integracao-panel`) recebem o mesmo esqueleto: seu `Card` raiz `flex min-h-0 flex-col`, e as tabelas/quadros internos com `overflow-y-auto`.

- [ ] **Step 4: Build + lint + testes** → verdes. (Validação visual das 3 orientações é no smoke — Step 5 é o critério.)

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx" "src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx" "src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx"
git commit -m "feat(shopfloor): Lançamento cabe sem rolar (layout de altura cheia + scroll interno) em retrato/paisagem/web

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Responsividade — Manutenção + Consultas

**Files:** `operar/manutencao/*`, `operar/integracao/consulta-integracao-form.tsx`, `analisar/caixas/caixas-form.tsx`.

- [ ] **Step 1: Auditar e corrigir cada tela**

Para cada tela (Manutenção, Consultar Integração, Consultar Caixa):
- Toda `<Table>`/tabela dentro de um container com **`overflow-x-auto`** (a maioria já usa — garantir; o `Table` do projeto tem `containerClassName`). A **página** não rola de lado.
- Filtros/grids de topo: `grid-cols-1 sm:grid-cols-…` (empilham no estreito).
- Onde houver largura fixa que estoure, acrescentar `min-w-0`/`max-w-full`/truncate.
- Sem `overflow-x` no corpo da página.

- [ ] **Step 2: Build + lint + testes** → verdes.

- [ ] **Step 3: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/manutencao" "src/app/(app)/shopfloor/operar/integracao/consulta-integracao-form.tsx" "src/app/(app)/shopfloor/analisar/caixas/caixas-form.tsx"
git commit -m "feat(shopfloor): responsividade de Manutenção e Consultas (tabelas com scroll próprio, grids empilham)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)
1. **Menu:** no desktop, recolher/mostrar o menu; recarregar → continua como você deixou.
2. **Lançamento sem scroll:** em **retrato**, **paisagem** e **web** — Peça, Burn-in (evento), Embalagem (com quadro), Integração (com receita) e reprovar (lista de defeitos) — a **página não rola**; o que cresce rola na caixa.
3. **Manutenção/Consultas** em tablet: tabelas rolam no container, sem scroll horizontal da página, grids empilham.

## Self-Review
- **Cobertura:** A menu → T1; B Lançamento → T2; C demais → T3. ✔
- **T1 concreto** (código exato); **T2/T3 estruturais** (iterativo, validado no smoke). ✔
- **Não quebra** desktop/drawer atuais; `<main>` global intocado. ✔
