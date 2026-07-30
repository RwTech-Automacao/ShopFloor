# Reestruturação Operação/Análise (abas por rota) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Agrupar as 6 telas operacionais do Fluxo em 2 containers com **abas por rota** — `operar` (Lançamento/Integração/Manutenção, `lancar`) e `analisar` (Dashboard/Pesquisa/Burn-in, `visualizar`) — sem mudar o conteúdo das telas. Menu de ~8 → 4 itens.

**Architecture:** Next.js App Router. Cada container = um segmento com `layout.tsx` (guard + barra de abas client) e `page.tsx` (redirect pra aba default). As 6 páginas movem via `git mv`; o guard sai delas e sobe pro layout (só a Integração mantém `getSessao` porque usa a sessão pra `podeCancelar`). Menu e 1 link interno atualizados.

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Tailwind v4, lucide-react.

## Global Constraints

- PT-BR em UI e comentários.
- **Não mudar o conteúdo/comportamento das telas** — só localização + tirar o guard (que sobe pro layout).
- Guard do container no `layout.tsx` (server): `getSessao()` + `podeNoModulo(sessao.perfil, 'shopfloor', '<perm>')` → `<SemPermissao>`. `<perm>`: `operar`=`lancar`, `analisar`=`visualizar`.
- Abas por rota (URL-navegável); aba ativa via `usePathname` (client). Sem filtro por aba (mesma permissão no container).
- Registros e Ordens de Produção **não** se movem. Busca por SN **não** muda.
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-07-28-reestruturacao-operar-analisar-design.md`.

## File Structure

- Create: `src/app/(app)/shopfloor/abas-fluxo.tsx` (client, barra de abas reusável).
- Create: `src/app/(app)/shopfloor/operar/layout.tsx`, `.../operar/page.tsx` (redirect).
- Create: `src/app/(app)/shopfloor/analisar/layout.tsx`, `.../analisar/page.tsx` (redirect).
- Move (`git mv`): `lancamento`,`integracao`,`manutencao` → `operar/`; `dashboard`,`pesquisa`,`burn-in` → `analisar/`.
- Edit: as 6 `page.tsx` movidas (tirar o guard).
- Edit: `src/shared/ui/app-shell.tsx` (menu 6→2 itens + ícones), `src/app/(app)/home/page.tsx` (link).

---

### Task 1: Componente de abas `AbasFluxo`

**Files:**
- Create: `src/app/(app)/shopfloor/abas-fluxo.tsx`

**Interfaces:**
- Produces: `export function AbasFluxo({ tabs }: { tabs: { rotulo: string; href: string }[] })` — usado pelos 2 layouts (Tasks 2 e 3).

- [ ] **Step 1: Descobrir de onde vem `cn`**

Run: `grep -n "import.*\bcn\b" "src/shared/ui/app-shell.tsx"`
Anote o caminho (ex.: `@/lib/utils` ou `@/shared/lib/utils`) — use o mesmo no componente.

- [ ] **Step 2: Criar o componente** — `src/app/(app)/shopfloor/abas-fluxo.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '<MESMO-CAMINHO-DO-app-shell>'

/** Barra de abas por rota do Fluxo (Operação/Análise). Aba ativa por pathname. */
export function AbasFluxo({ tabs }: { tabs: { rotulo: string; href: string }[] }) {
  const pathname = usePathname()
  return (
    <nav className="mb-4 flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const ativa = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              ativa
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.rotulo}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros (o componente ainda não é usado — ok).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/shopfloor/abas-fluxo.tsx"
git commit -m "$(cat <<'EOF'
feat(shopfloor): componente AbasFluxo (barra de abas por rota)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Container **Operação** (mover + layout + de-guard)

**Files:**
- Move: `lancamento`,`integracao`,`manutencao` → `operar/`
- Create: `operar/layout.tsx`, `operar/page.tsx`
- Edit: as 3 páginas movidas (de-guard)

**Interfaces:**
- Consumes: `AbasFluxo` (Task 1), `getSessao`, `podeNoModulo`, `SemPermissao`, `redirect`.

- [ ] **Step 1: Mover as 3 pastas**

```bash
git mv "src/app/(app)/shopfloor/lancamento" "src/app/(app)/shopfloor/operar/lancamento"
git mv "src/app/(app)/shopfloor/integracao" "src/app/(app)/shopfloor/operar/integracao"
git mv "src/app/(app)/shopfloor/manutencao" "src/app/(app)/shopfloor/operar/manutencao"
```

- [ ] **Step 2: Criar `operar/layout.tsx`** (guard `lancar` + abas):

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Lançamento', href: '/shopfloor/operar/lancamento' },
  { rotulo: 'Integração', href: '/shopfloor/operar/integracao' },
  { rotulo: 'Manutenção', href: '/shopfloor/operar/manutencao' },
]

export default async function OperarLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para operar o Fluxo de Processos." />
  }
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Criar `operar/page.tsx`** (redirect pra aba default):

```tsx
import { redirect } from 'next/navigation'

export default function OperarPage() {
  redirect('/shopfloor/operar/lancamento')
}
```

- [ ] **Step 4: De-guard das páginas**

**`operar/lancamento/page.tsx`** e **`operar/manutencao/page.tsx`** (NÃO usam `sessao` além do guard):
remover as 3 linhas de import do guard (`getSessao`, `podeNoModulo`, `SemPermissao`), remover
`const sessao = await getSessao()` e o bloco `if (!sessao || !podeNoModulo(...)) { return <SemPermissao ... /> }`.
O corpo restante (carga de dados + JSX) fica igual.

**`operar/integracao/page.tsx`** (USA `sessao.perfil` p/ `podeCancelar`): remover **só** o import de
`SemPermissao` e o bloco `if (!sessao || !podeNoModulo(...)) { return <SemPermissao ... /> }`. **Manter**
`const sessao = await getSessao()` e os imports de `getSessao`/`podeNoModulo` (a linha
`const podeCancelar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')` continua).

- [ ] **Step 5: Build**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; rotas `/shopfloor/operar`, `/shopfloor/operar/{lancamento,integracao,manutencao}` na lista. (O menu ainda aponta pros paths antigos — será corrigido na Task 4; não quebra o build.)

- [ ] **Step 6: Commit**

```bash
git add -A "src/app/(app)/shopfloor/operar"
git commit -m "$(cat <<'EOF'
feat(shopfloor): container Operação (abas Lançamento/Integração/Manutenção)

Move as 3 telas pra /shopfloor/operar/* com layout de abas + guard `lancar` no
layout; page.tsx redireciona pra aba default (Lançamento). Guard sai das páginas
(Integração mantém getSessao p/ podeCancelar). Conteúdo inalterado.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Container **Análise** (mover + layout + de-guard)

**Files:**
- Move: `dashboard`,`pesquisa`,`burn-in` → `analisar/`
- Create: `analisar/layout.tsx`, `analisar/page.tsx`
- Edit: as 3 páginas movidas (de-guard)

- [ ] **Step 1: Mover as 3 pastas**

```bash
git mv "src/app/(app)/shopfloor/dashboard" "src/app/(app)/shopfloor/analisar/dashboard"
git mv "src/app/(app)/shopfloor/pesquisa" "src/app/(app)/shopfloor/analisar/pesquisa"
git mv "src/app/(app)/shopfloor/burn-in" "src/app/(app)/shopfloor/analisar/burn-in"
```

- [ ] **Step 2: Criar `analisar/layout.tsx`** (guard `visualizar` + abas):

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Dashboard', href: '/shopfloor/analisar/dashboard' },
  { rotulo: 'Pesquisa', href: '/shopfloor/analisar/pesquisa' },
  { rotulo: 'Burn-in', href: '/shopfloor/analisar/burn-in' },
]

export default async function AnalisarLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver a Análise do Fluxo de Processos." />
  }
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Criar `analisar/page.tsx`** (redirect):

```tsx
import { redirect } from 'next/navigation'

export default function AnalisarPage() {
  redirect('/shopfloor/analisar/dashboard')
}
```

- [ ] **Step 4: De-guard das 3 páginas** — `analisar/dashboard/page.tsx`, `analisar/pesquisa/page.tsx`,
`analisar/burn-in/page.tsx` NÃO usam `sessao` além do guard: em cada uma, remover os 3 imports do guard
(`getSessao`, `podeNoModulo`, `SemPermissao`), remover `const sessao = await getSessao()` e o bloco
`if (!sessao || !podeNoModulo(...)) { return <SemPermissao ... /> }`. O resto fica igual.

- [ ] **Step 5: Build**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; rotas `/shopfloor/analisar/{dashboard,pesquisa,burn-in}` na lista.

- [ ] **Step 6: Commit**

```bash
git add -A "src/app/(app)/shopfloor/analisar"
git commit -m "$(cat <<'EOF'
feat(shopfloor): container Análise (abas Dashboard/Pesquisa/Burn-in)

Move as 3 telas pra /shopfloor/analisar/* com layout de abas + guard `visualizar`
no layout; page.tsx redireciona pra aba default (Dashboard). Guard sai das páginas.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Menu + link da home + verificação final

**Files:**
- Edit: `src/shared/ui/app-shell.tsx`
- Edit: `src/app/(app)/home/page.tsx`

- [ ] **Step 1: Atualizar o menu** — em `src/shared/ui/app-shell.tsx`, no array `SHOPFLOOR`:
Substituir os **6** itens `lancamento`/`integracao`/`manutencao`/`burn-in`/`pesquisa`/`dashboard` por **2**,
mantendo `registros` e `op-ordens`. A ordem final do array:
```tsx
  { chave: 'operar',   rotulo: 'Operação', href: '/shopfloor/operar',   icone: Cog,       modulo: 'shopfloor', perm: 'lancar' },
  { chave: 'analisar', rotulo: 'Análise',  href: '/shopfloor/analisar', icone: LineChart, modulo: 'shopfloor', perm: 'visualizar' },
  { chave: 'registros', rotulo: 'Registros', href: '/shopfloor/registros', icone: History, modulo: 'shopfloor', perm: 'visualizar' },
  { chave: 'op-ordens', rotulo: 'Ordens de Produção', href: '/shopfloor/ordens', icone: FileStack, modulo: 'shopfloor', perm: 'administrar' },
```
- No import do `lucide-react`, **adicionar** `Cog` e `LineChart`; **remover** os ícones que ficaram sem uso
  (os que só os 6 itens antigos usavam — ex.: `ScanLine`,`Link2`,`Wrench`,`Timer`,`Search`,`ChartColumn` —
  **confirmar com o compilador/lint**: remover só os que o `npm run lint` acusar como não usados).

- [ ] **Step 2: Atualizar o link da home** — em `src/app/(app)/home/page.tsx`, trocar
`href: '/shopfloor/lancamento'` por `href: '/shopfloor/operar/lancamento'`.

- [ ] **Step 3: Build + lint**

Run: `npm run lint && NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; menu com 4 itens; rotas antigas (`/shopfloor/lancamento` etc.) **não** aparecem mais,
e as novas (`/shopfloor/operar/*`, `/shopfloor/analisar/*`) aparecem.

- [ ] **Step 4: Commit**

```bash
git add "src/shared/ui/app-shell.tsx" "src/app/(app)/home/page.tsx"
git commit -m "$(cat <<'EOF'
feat(shopfloor): menu do Fluxo em 4 itens (Operação/Análise/Registros/Ordens)

Substitui os 6 itens operacionais por Operação + Análise (containers com abas);
atualiza o link da home pra /shopfloor/operar/lancamento.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final (após as tasks)

- [ ] `npm run test` — suíte verde (nenhum teste deve referenciar as rotas antigas; se algum quebrar, avaliar).
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — build limpo; rotas novas presentes, antigas ausentes.
- [ ] Smoke no preview: menu do Fluxo com **4 itens**; abrir **Operação** → cai em Lançamento, abas trocam entre Lançamento/Integração/Manutenção (URL muda, voltar funciona), cada tela funciona igual; **Análise** → Dashboard, abas Dashboard/Pesquisa/Burn-in; usuário só-`visualizar` vê Análise mas não Operação; a **home** leva pra Lançamento.

## Self-review (feito ao escrever)

- **Cobertura do spec:** 2 containers com abas por rota (Tasks 2/3) · AbasFluxo (Task 1) · guard no layout (Tasks 2/3) · menu 4 itens + home link (Task 4) · conteúdo das telas inalterado (só de-guard) · Registros/Ordens/busca-SN intactos. ✓
- **De-guard preciso:** só Integração mantém `getSessao` (usa `podeCancelar`); as outras 5 removem o guard inteiro — verificado no código (só Integração referencia `sessao` além do guard).
- **Sem placeholders:** código completo (o único `<...>` é o caminho do `cn`, resolvido no Step 1 da Task 1, e a lista de ícones a remover, resolvida pelo lint).
- **Ordem:** Task 1 (AbasFluxo) antes de 2/3 (layouts a consomem); Task 4 (menu) por último (as rotas novas já existem).
