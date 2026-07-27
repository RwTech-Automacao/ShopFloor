# ShopFloor — Plano Dashboard — Implementation Plan (spec embutida)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal/Spec:** Tela `/shopfloor/dashboard` (perm `visualizar`, SEM migração): escolhe Cliente→PMO→OP (todas, incl. finalizadas) + período opcional → mostra, por posto do fluxo da OP (+ Manutenção), a **contagem de peças concluídas** vs o **total da OP** (qtd), com barra de progresso. Regras de contagem (fiéis ao `getDashboardData` do legado, adaptadas): postos **sem status** (Inicial, Montagem PTH, Integração, Embalagem, Extra máquina, Manutenção) contam **cada registro**; postos **com status** contam só **Aprovado** (NQA usa o status derivado que gravamos). Período filtra por `data_hora` (dia inteiro, fuso -03:00).

## Global Constraints
Branch `feat/shopfloor-lancamento`. TS strict. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit heredoc. Sem push até o fim. Leituras paginadas (PostgREST trunca em 1.000). Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure
- Create: `src/modules/shopfloor/domain/dashboard.ts` + `__tests__/dashboard.test.ts`
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (`OrdemLancamento` += `qtd: number | null`; select += `qtd`)
- Create: `src/modules/shopfloor/infra/dashboard-repository.ts`
- Create: `src/modules/shopfloor/application/dashboard-actions.ts`
- Create: `src/app/(app)/shopfloor/dashboard/page.tsx` + `dashboard-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item `dashboard`, ícone `ChartColumn` — se não existir no lucide, `BarChart3` —, perm `visualizar`, após `pesquisa`)

---

### Task 1: Domínio `dashboard` (TDD)

**Interfaces:** `interface RegistroContagem { posto: string; status: string }`; `contarPorPosto(postosDaOp: string[], registros: RegistroContagem[]): Record<string, number>` — colunas = postosDaOp + 'Manutenção'; sem-status conta cada registro; com-status conta só `status` = 'aprovado' (case-insensitive); postos fora das colunas são ignorados.

- [ ] Teste (FALHA) em `__tests__/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contarPorPosto } from '../dashboard'

describe('contarPorPosto', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  it('sem-status conta cada registro; com-status só aprovado; Manutenção incluída', () => {
    const r = contarPorPosto(postos, [
      { posto: 'Inicial', status: '' },
      { posto: 'Inicial', status: '' },
      { posto: 'Teste', status: 'Reprovado' },
      { posto: 'Teste', status: 'Aprovado' },
      { posto: 'Embalagem', status: '' },
      { posto: 'Manutenção', status: '' },
      { posto: 'Inspeção SMD', status: 'Aprovado' }, // fora do fluxo → ignora
    ])
    expect(r).toEqual({ Inicial: 2, Teste: 1, Embalagem: 1, 'Manutenção': 1 })
  })
  it('zera postos sem registro', () => {
    expect(contarPorPosto(['Inicial'], [])).toEqual({ Inicial: 0, 'Manutenção': 0 })
  })
})
```

- [ ] Implementar `dashboard.ts`:

```ts
import { postoTemStatus } from './lancamento-linhas'

export interface RegistroContagem {
  posto: string
  status: string
}

/** Contagem por posto (fluxo da OP + Manutenção): sem-status conta registros; com-status conta aprovados. */
export function contarPorPosto(
  postosDaOp: string[],
  registros: RegistroContagem[],
): Record<string, number> {
  const colunas = [...postosDaOp, 'Manutenção']
  const contagens: Record<string, number> = {}
  for (const p of colunas) contagens[p] = 0
  for (const r of registros) {
    const coluna = colunas.find((c) => c.toLowerCase() === r.posto.toLowerCase())
    if (!coluna) continue
    if (postoTemStatus(coluna)) {
      if (r.status.toLowerCase() === 'aprovado') contagens[coluna] = (contagens[coluna] ?? 0) + 1
    } else {
      contagens[coluna] = (contagens[coluna] ?? 0) + 1
    }
  }
  return contagens
}
```

- [ ] PASSA → commit `feat(shopfloor): domínio do dashboard (contagem por posto) TDD`.

---

### Task 2: `qtd` no carregarOrdem + repo + action + tela + menu

**(a) `lancamento-repository.ts`:** em `OrdemLancamento` adicionar `qtd: number | null`; no select de `carregarOrdem` incluir `qtd` (vira `'cliente,descricao,qtd,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)'`) e mapear `qtd: row.qtd` (tipar no cast).

**(b) `dashboard-repository.ts`:**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { RegistroContagem } from '../domain/dashboard'

const PAGINA = 1000

/** Registros (posto,status) da OP, com período opcional (datas YYYY-MM-DD, fuso -03:00). Paginado. */
export async function listarContagemDaOp(
  pmo: string,
  op: string,
  de?: string,
  ate?: string,
): Promise<RegistroContagem[]> {
  const supabase = await createServerSupabase()
  const out: RegistroContagem[] = []
  for (let ini = 0; ; ini += PAGINA) {
    let q = supabase
      .from('sf_registros')
      .select('posto,status')
      .eq('pmo', pmo)
      .eq('op', op)
      .order('id', { ascending: true })
      .range(ini, ini + PAGINA - 1)
    if (de) q = q.gte('data_hora', `${de}T00:00:00-03:00`)
    if (ate) q = q.lte('data_hora', `${ate}T23:59:59-03:00`)
    const { data, error } = await q
    if (error) throw error
    const rows = data as { posto: string; status: string }[]
    out.push(...rows.map((r) => ({ posto: r.posto, status: r.status })))
    if (rows.length < PAGINA) break
  }
  return out
}
```

**(c) `dashboard-actions.ts`:**

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { contarPorPosto } from '../domain/dashboard'
import { carregarOrdem } from '../infra/lancamento-repository'
import { listarContagemDaOp } from '../infra/dashboard-repository'

export interface ItemDashboard {
  posto: string
  contagem: number
}

export async function carregarDashboard(
  pmo: string,
  op: string,
  de?: string,
  ate?: string,
): Promise<{ ok: true; itens: ItemDashboard[]; total: number | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o dashboard.' }
  }
  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  try {
    const registros = await listarContagemDaOp(pmo.trim(), op.trim(), de || undefined, ate || undefined)
    const contagens = contarPorPosto(ordem.postos, registros)
    const itens = [...ordem.postos, 'Manutenção'].map((posto) => ({ posto, contagem: contagens[posto] ?? 0 }))
    return { ok: true, itens, total: ordem.qtd }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o dashboard.' }
  }
}
```

**(d) `page.tsx`** (guard `visualizar`, carrega `listarTodasOrdens` de `pesquisa-repository`, título "Dashboard", renderiza `<DashboardForm ordens={ordens} />`) — mesmo esqueleto da page da Pesquisa.

**(e) `dashboard-form.tsx`:**

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarDashboard, type ItemDashboard } from '@/modules/shopfloor/application/dashboard-actions'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'

export function DashboardForm({ ordens }: { ordens: OrdemPesquisa[] }) {
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [itens, setItens] = useState<ItemDashboard[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [carregando, startTransition] = useTransition()

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(() => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))], [ordens, cliente])
  const ops = useMemo(() => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op), [ordens, cliente, pmo])

  function atualizar(opSel?: string) {
    const alvo = opSel ?? op
    if (!alvo || carregando) return
    startTransition(async () => {
      const r = await carregarDashboard(pmo, alvo, de, ate)
      if (r.ok) {
        setItens(r.itens)
        setTotal(r.total)
      } else {
        setItens(null)
        toast.error(r.erro)
      }
    })
  }

  return (
    <Card>
      <CardHeader><CardTitle>Progresso por posto</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label>Cliente</Label>
            <Select value={cliente} onValueChange={(v) => { setCliente(v ?? ''); setPmo(''); setOp(''); setItens(null) }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PMO</Label>
            <Select value={pmo} onValueChange={(v) => { setPmo(v ?? ''); setOp(''); setItens(null) }} disabled={cliente === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>OP</Label>
            <Select value={op} onValueChange={(v) => { const novo = v ?? ''; setOp(novo); if (novo) atualizar(novo) }} disabled={pmo === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashDe">De</Label>
            <Input id="dashDe" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashAte">Até</Label>
            <Input id="dashAte" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>
        <div>
          <Button variant="outline" onClick={() => atualizar()} disabled={op === '' || carregando}>
            {carregando ? 'Carregando…' : 'Atualizar'}
          </Button>
        </div>

        {itens && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itens.map(({ posto, contagem }) => {
              const pct = total && total > 0 ? Math.min(100, Math.round((contagem / total) * 100)) : null
              return (
                <div key={posto} className="rounded-lg border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-tinta">{posto}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-lg font-semibold text-tinta">{contagem}</span>
                      {total ? ` / ${total}` : ''}
                    </p>
                  </div>
                  {pct !== null && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-enterplak" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**(f) Menu:** item `{ chave: 'dashboard', rotulo: 'Dashboard', href: '/shopfloor/dashboard', icone: ChartColumn, perm: 'visualizar' }` após `pesquisa` (import `ChartColumn`; fallback `BarChart3`).

- [ ] tsc + lint limpos → commit `feat(shopfloor): tela de Dashboard (progresso por posto) + item de menu`.

---

### Task 3 (controller): suíte + review amplo + push (preview).
