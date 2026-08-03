# Consultar Caixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Caixas" em Análise: escolhe a OP → lista as caixas (abertas e fechadas) → clica numa → vê os Nº de Série dentro.

**Architecture:** Sem migração, sem backend novo — reusa `sf_caixas`/`sf_registros`. Duas funções no `caixa-repository` (OPs com caixas; caixas+peças de uma OP), uma action, e uma tela client com dropdown de OP + accordion.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, sonner, base-ui.

## Global Constraints
- **Sem migração**; permissão `visualizar` (ver). PT-BR; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Nomes canônicos:** `OpComCaixa`, `CaixaConsulta`, `listarOpsComCaixas()`, `carregarCaixasDaOp(pmo,op)` em `caixa-repository.ts`; `caixasDaOp(pmo,op)` em `embalagem-actions.ts`; componente `CaixasForm({ ops })`.
- **Build/lint/test verdes ao fim de cada task.**

## File Structure
- **Modify** `src/modules/shopfloor/infra/caixa-repository.ts` — `OpComCaixa`/`CaixaConsulta` + `listarOpsComCaixas` + `carregarCaixasDaOp`.
- **Modify** `src/modules/shopfloor/application/embalagem-actions.ts` — `caixasDaOp`.
- **Modify** `src/app/(app)/shopfloor/analisar/layout.tsx` — aba "Caixas".
- **Create** `src/app/(app)/shopfloor/analisar/caixas/page.tsx` — server.
- **Create** `src/app/(app)/shopfloor/analisar/caixas/caixas-form.tsx` — client.

---

## Task 1: Backend — OPs com caixas + caixas de uma OP

**Files:** Modify `caixa-repository.ts`, `embalagem-actions.ts`.

**Interfaces:** Produces `OpComCaixa`, `CaixaConsulta`, `listarOpsComCaixas()`, `carregarCaixasDaOp(pmo,op)`, `caixasDaOp(pmo,op)`.

- [ ] **Step 1: `caixa-repository.ts` — acrescentar (no fim do arquivo)**
```ts
export interface OpComCaixa { pmo: string; op: string; cliente: string }
export interface CaixaConsulta {
  seq: number
  posto: string
  fechada: boolean
  limite: number
  codigo: string   // fechada → código final; aberta → 'CX{seq} (aberta)'
  qtd: number      // nº de peças (contagem real)
  sns: string[]    // SNs dentro da caixa
}

/** OPs que têm ao menos uma caixa (distinct pmo/op), com o cliente (de sf_ordens). */
export async function listarOpsComCaixas(): Promise<OpComCaixa[]> {
  const supabase = await createServerSupabase()
  const { data: cxs, error } = await supabase.from('sf_caixas').select('pmo,op')
  if (error) throw error
  const pares = new Map<string, { pmo: string; op: string }>()
  for (const c of (cxs ?? []) as { pmo: string; op: string }[]) pares.set(`${c.pmo}||${c.op}`, { pmo: c.pmo, op: c.op })
  if (pares.size === 0) return []
  const { data: ord, error: e2 } = await supabase.from('sf_ordens').select('pmo,op,cliente')
  if (e2) throw e2
  const cli = new Map<string, string>()
  for (const o of (ord ?? []) as { pmo: string; op: string; cliente: string }[]) cli.set(`${o.pmo}||${o.op}`, o.cliente)
  return [...pares.values()]
    .map((p) => ({ pmo: p.pmo, op: p.op, cliente: cli.get(`${p.pmo}||${p.op}`) ?? '' }))
    .sort((a, b) => (a.pmo === b.pmo ? a.op.localeCompare(b.op) : a.pmo.localeCompare(b.pmo)))
}

/** Caixas de uma OP (todos os postos), com as peças de cada uma. */
export async function carregarCaixasDaOp(pmo: string, op: string): Promise<CaixaConsulta[]> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,posto,limite,fechada,codigo')
    .eq('pmo', pmo).eq('op', op).order('posto', { ascending: true }).order('seq', { ascending: true })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as { seq: number; posto: string; limite: number; fechada: boolean; codigo: string }[]
  if (caixas.length === 0) return []

  const { data: regsData, error: e2 } = await supabase
    .from('sf_registros').select('numero_serie,numero_caixa,data_hora')
    .eq('pmo', pmo).eq('op', op).like('numero_caixa', 'CX%')
    .order('data_hora', { ascending: true })
  if (e2) throw e2
  const grupos = new Map<string, string[]>()
  for (const r of (regsData ?? []) as { numero_serie: string; numero_caixa: string }[]) {
    const arr = grupos.get(r.numero_caixa) ?? []
    arr.push(r.numero_serie)
    grupos.set(r.numero_caixa, arr)
  }

  return caixas.map((c) => {
    const chave = c.fechada ? c.codigo : marcadorCaixaAberta(c.seq)
    const sns = grupos.get(chave) ?? []
    return {
      seq: c.seq,
      posto: c.posto,
      fechada: c.fechada,
      limite: c.limite,
      codigo: c.fechada ? c.codigo : `CX${c.seq} (aberta)`,
      qtd: sns.length,
      sns,
    }
  })
}
```
(`marcadorCaixaAberta` já é importado no topo do arquivo.)

- [ ] **Step 2: `embalagem-actions.ts` — acrescentar a action**

No import de `caixa-repository`, acrescentar `carregarCaixasDaOp` e `type CaixaConsulta`. No fim do arquivo:
```ts
export async function caixasDaOp(
  pmo: string, op: string,
): Promise<{ ok: true; caixas: CaixaConsulta[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, caixas: await carregarCaixasDaOp(pmo.trim(), op.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as caixas.' }
  }
}
```

- [ ] **Step 3: Build + lint + testes** — `npm run build && npm run lint && npm test` → verdes.

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/caixa-repository.ts src/modules/shopfloor/application/embalagem-actions.ts
git commit -m "feat(shopfloor): backend Consultar Caixa (OPs com caixas + caixas/peças de uma OP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — aba, rota e tela

**Files:** Modify `analisar/layout.tsx`; Create `analisar/caixas/page.tsx`, `analisar/caixas/caixas-form.tsx`.

**Interfaces:** Consumes `listarOpsComCaixas` (page, server), `caixasDaOp` (form), `OpComCaixa`/`CaixaConsulta`.

- [ ] **Step 1: `analisar/layout.tsx` — aba "Caixas"**
```ts
const ABAS = [
  { rotulo: 'Dashboard', href: '/shopfloor/analisar/dashboard' },
  { rotulo: 'Pesquisa', href: '/shopfloor/analisar/pesquisa' },
  { rotulo: 'Burn-in', href: '/shopfloor/analisar/burn-in' },
  { rotulo: 'Caixas', href: '/shopfloor/analisar/caixas' },
]
```

- [ ] **Step 2: `analisar/caixas/page.tsx` (server)**
```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOpsComCaixas } from '@/modules/shopfloor/infra/caixa-repository'
import { CaixasForm } from './caixas-form'

export default async function CaixasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar caixas." />
  }
  const ops = await listarOpsComCaixas()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Consultar Caixa</h2>
        <p className="text-sm text-muted-foreground">Escolha a OP para ver as caixas e as peças dentro de cada uma.</p>
      </div>
      <CaixasForm ops={ops} />
    </div>
  )
}
```

- [ ] **Step 3: Criar `analisar/caixas/caixas-form.tsx` (client)**
```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { caixasDaOp } from '@/modules/shopfloor/application/embalagem-actions'
import type { OpComCaixa, CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'

export function CaixasForm({ ops }: { ops: OpComCaixa[] }) {
  const [sel, setSel] = useState('')
  const [caixas, setCaixas] = useState<CaixaConsulta[]>([])
  const [buscou, setBuscou] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [carregando, startCarregar] = useTransition()

  function escolher(v: string) {
    setSel(v)
    setAbertos(new Set())
    setBuscou(false)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    startCarregar(async () => {
      const r = await caixasDaOp(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setCaixas(r.caixas)
      setBuscou(true)
    })
  }
  function toggle(key: string) {
    setAbertos((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  return (
    <Card>
      <CardHeader><CardTitle>Consultar Caixa</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-md">
          <Label>OP</Label>
          <Select value={sel} onValueChange={(v) => escolher(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                  {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {buscou && !carregando && caixas.length === 0 && (
          <p className="text-sm text-muted-foreground">Esta OP não tem caixas.</p>
        )}

        <div className="flex flex-col gap-2">
          {caixas.map((c) => {
            const key = `${c.posto}-${c.seq}`
            return (
              <div key={key} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium">{c.codigo}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {c.posto} · {c.qtd} peça(s)
                    <Badge variant="outline" className={c.fechada ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-700'}>
                      {c.fechada ? 'fechada' : 'aberta'}
                    </Badge>
                  </span>
                </button>
                {abertos.has(key) && (
                  <ul className="flex flex-col gap-0.5 border-t border-border px-3 py-2 text-sm">
                    {c.sns.length === 0 && <li className="text-muted-foreground">sem peças</li>}
                    {c.sns.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Build + lint + testes** — `npm run build && npm run lint && npm test` → verdes.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/shopfloor/analisar/layout.tsx" "src/app/(app)/shopfloor/analisar/caixas/page.tsx" "src/app/(app)/shopfloor/analisar/caixas/caixas-form.tsx"
git commit -m "feat(shopfloor): aba Consultar Caixa em Análise (lista caixas + peças por OP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)
1. Análise → **Caixas**: o dropdown lista as OPs que têm caixas.
2. Escolher uma OP → lista as caixas (abertas e fechadas), com código, posto, qtd e status.
3. Clicar numa caixa → expande e mostra os SNs dentro.
4. Caixa **aberta** mostra `CX{seq} (aberta)` + contagem atual; **fechada** mostra o código final + qtd.
5. OP sem caixas → "Esta OP não tem caixas."

## Self-Review
- **Cobertura:** §1 infra → T1; §2 action → T1; §3 rota/aba → T2; §4 client → T2. ✔
- **Sem placeholders:** código completo. ✔
- **Tipos consistentes:** `OpComCaixa`/`CaixaConsulta` (T1) usados no page/form (T2); `caixasDaOp` devolve `{ caixas }`. ✔
- **Chave do accordion:** `${posto}-${seq}` (seq não é único entre postos). ✔
