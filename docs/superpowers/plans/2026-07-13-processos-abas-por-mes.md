# Lista de Processos em accordions por mês (3b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a lista paginada única de Processos por accordions agrupados pelo mês da data de chegada, com carregamento sob demanda.

**Architecture:** Domain puro para chave/rótulo/ordenação de meses (TDD). Infra com duas funções no repository (grupos + linhas de um mês). Server Action carrega as linhas ao abrir cada accordion. UI: página server monta os grupos; client component gerencia abrir/fechar e busca sob demanda; componente presentacional reaproveita a tabela/cards atuais.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase JS, Tailwind, Vitest.

## Global Constraints
- Domínio em TS puro (sem imports de Supabase/Next). Datas manipuladas como **string** (`'YYYY-MM-DD'`), **nunca `new Date()`**, para evitar conversão de fuso.
- **Sem migração** — a contagem por mês é feita buscando só a coluna `data_chegada` e agrupando em TS.
- Seguir os padrões existentes (camadas `modules/recebimento/{domain,application,infra}`; Server Actions checam permissão; RLS é o portão real).
- Rótulo do grupo sem data = **"Aguardando chegada"**; rótulo de mês em pt-BR = `"Julho/2026"`.
- Colunas e layout das linhas = os atuais (Número · NF · Nº EMB · Nº DI/INPI · ACP/Cliente · Nº Pedido · Tipo · Fornecedor · Item Recebido · Status · abrir).

---

### Task 1: Domain — helpers de agrupamento por mês (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/agrupamento-mes.ts`
- Test: `src/modules/recebimento/domain/agrupamento-mes.test.ts`

**Interfaces:**
- Produces:
  - `interface GrupoMes { chave: string; rotulo: string; total: number }`
  - `chaveMes(data: string | null | undefined): string` → `'YYYY-MM'` ou `'sem_data'`
  - `rotuloMes(chave: string): string`
  - `inicioProximoMes(chave: string): string` → `'YYYY-MM-01'`
  - `agruparPorMes(datas: (string | null)[]): GrupoMes[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/recebimento/domain/agrupamento-mes.test.ts
import { describe, it, expect } from 'vitest'
import { chaveMes, rotuloMes, inicioProximoMes, agruparPorMes } from './agrupamento-mes'

describe('chaveMes', () => {
  it('extrai YYYY-MM de uma data', () => {
    expect(chaveMes('2026-05-12')).toBe('2026-05')
  })
  it('retorna sem_data para nulo/vazio', () => {
    expect(chaveMes(null)).toBe('sem_data')
    expect(chaveMes(undefined)).toBe('sem_data')
    expect(chaveMes('')).toBe('sem_data')
  })
})

describe('rotuloMes', () => {
  it('formata mês/ano em pt-BR', () => {
    expect(rotuloMes('2026-07')).toBe('Julho/2026')
  })
  it('rotula sem_data como Aguardando chegada', () => {
    expect(rotuloMes('sem_data')).toBe('Aguardando chegada')
  })
})

describe('inicioProximoMes', () => {
  it('avança o mês', () => {
    expect(inicioProximoMes('2026-05')).toBe('2026-06-01')
  })
  it('vira o ano em dezembro', () => {
    expect(inicioProximoMes('2026-12')).toBe('2027-01-01')
  })
})

describe('agruparPorMes', () => {
  it('agrupa, conta e ordena (sem_data primeiro, meses desc)', () => {
    const grupos = agruparPorMes(['2026-05-01', '2026-05-20', null, '2026-06-03'])
    expect(grupos).toEqual([
      { chave: 'sem_data', rotulo: 'Aguardando chegada', total: 1 },
      { chave: '2026-06', rotulo: 'Junho/2026', total: 1 },
      { chave: '2026-05', rotulo: 'Maio/2026', total: 2 },
    ])
  })
  it('lista vazia → []', () => {
    expect(agruparPorMes([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/recebimento/domain/agrupamento-mes.test.ts`
Expected: FAIL (módulo `./agrupamento-mes` não existe).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/recebimento/domain/agrupamento-mes.ts
export interface GrupoMes {
  chave: string // 'YYYY-MM' ou 'sem_data'
  rotulo: string
  total: number
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** Chave a partir de uma data 'YYYY-MM-DD' (ou nula). Usa os 7 primeiros
 *  caracteres — nada de `new Date()` — para não sofrer conversão de fuso. */
export function chaveMes(data: string | null | undefined): string {
  if (!data) return 'sem_data'
  const m = /^(\d{4})-(\d{2})/.exec(data)
  return m ? `${m[1]}-${m[2]}` : 'sem_data'
}

/** 'Julho/2026' ou 'Aguardando chegada'. */
export function rotuloMes(chave: string): string {
  if (chave === 'sem_data') return 'Aguardando chegada'
  const [ano, mes] = chave.split('-')
  const nome = MESES_PT[Number(mes) - 1] ?? mes
  return `${nome}/${ano}`
}

/** Primeiro dia do mês seguinte, 'YYYY-MM-01', para o recorte `< próximo`. */
export function inicioProximoMes(chave: string): string {
  const [ano, mes] = chave.split('-').map(Number)
  const proximoMes = mes === 12 ? 1 : mes + 1
  const proximoAno = mes === 12 ? ano + 1 : ano
  return `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01`
}

/** Agrupa datas de chegada em {chave, rotulo, total}; ordena sem_data primeiro,
 *  depois meses do mais recente ao mais antigo. */
export function agruparPorMes(datas: (string | null)[]): GrupoMes[] {
  const contagem = new Map<string, number>()
  for (const d of datas) {
    const chave = chaveMes(d)
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .map(([chave, total]) => ({ chave, rotulo: rotuloMes(chave), total }))
    .sort((a, b) => {
      if (a.chave === 'sem_data') return -1
      if (b.chave === 'sem_data') return 1
      return b.chave.localeCompare(a.chave)
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/recebimento/domain/agrupamento-mes.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add "src/modules/recebimento/domain/agrupamento-mes.ts" "src/modules/recebimento/domain/agrupamento-mes.test.ts"
git commit -m "feat(processos): domain de agrupamento por mês (chave/rótulo/ordenação)"
```

---

### Task 2: Domain — helper de condição de busca (TDD)

**Files:**
- Modify: `src/modules/recebimento/domain/busca-processo.ts` (adicionar função no fim)
- Test: `src/modules/recebimento/domain/busca-processo.test.ts` (criar, se não existir; senão adicionar bloco)

**Interfaces:**
- Consumes: `COLUNAS_BUSCA_PROCESSO`, `sanitizarTermoBusca` (já existem no arquivo).
- Produces: `condicaoBuscaProcesso(busca: string | undefined): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/recebimento/domain/busca-processo.test.ts (adicione este bloco; mantenha os demais se o arquivo já existir)
import { describe, it, expect } from 'vitest'
import { condicaoBuscaProcesso } from './busca-processo'

describe('condicaoBuscaProcesso', () => {
  it('monta o or ilike quando há termo', () => {
    expect(condicaoBuscaProcesso('abc')).toBe(
      'numero_nf.ilike.%abc%,numero_pedido.ilike.%abc%,fornecedor.ilike.%abc%,codigo_material.ilike.%abc%,descricao_material.ilike.%abc%',
    )
  })
  it('retorna null sem termo real', () => {
    expect(condicaoBuscaProcesso(undefined)).toBeNull()
    expect(condicaoBuscaProcesso('   ')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/recebimento/domain/busca-processo.test.ts`
Expected: FAIL (`condicaoBuscaProcesso` não exportada).

- [ ] **Step 3: Write minimal implementation** (adicione ao fim de `busca-processo.ts`)

```ts
/**
 * Monta a string do filtro `.or(...)` de busca livre (ilike em várias colunas)
 * a partir do termo sanitizado, ou `null` se não houver termo. Centraliza a
 * construção usada por `listarProcessosDoMes` e `listarMesesProcessos`.
 */
export function condicaoBuscaProcesso(busca: string | undefined): string | null {
  const termo = busca ? sanitizarTermoBusca(busca) : ''
  if (!termo) return null
  return COLUNAS_BUSCA_PROCESSO.map((coluna) => `${coluna}.ilike.%${termo}%`).join(',')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/recebimento/domain/busca-processo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/modules/recebimento/domain/busca-processo.ts" "src/modules/recebimento/domain/busca-processo.test.ts"
git commit -m "feat(processos): helper condicaoBuscaProcesso (DRY do filtro de busca)"
```

---

### Task 3: Infra — `listarMesesProcessos` e `listarProcessosDoMes`

**Files:**
- Modify: `src/modules/recebimento/infra/processo-repository.ts`

**Interfaces:**
- Consumes: `agruparPorMes`, `inicioProximoMes`, `GrupoMes` (Task 1); `condicaoBuscaProcesso` (Task 2); `ProcessoResumoRow` (já existe no arquivo).
- Produces:
  - `interface FiltrosProcessos { busca?: string; status?: string }`
  - `listarMesesProcessos(filtros: FiltrosProcessos): Promise<GrupoMes[]>`
  - `listarProcessosDoMes(filtros: FiltrosProcessos, chave: string): Promise<ProcessoResumoRow[]>`

> Sem teste automatizado (fala com o Supabase — coberto por build + smoke, padrão do projeto). NÃO altere a função `listarProcessos` existente.

- [ ] **Step 1: Adicionar imports no topo do arquivo** (junto aos imports existentes)

```ts
import { agruparPorMes, inicioProximoMes, type GrupoMes } from '../domain/agrupamento-mes'
import { condicaoBuscaProcesso } from '../domain/busca-processo'
```

- [ ] **Step 2: Adicionar o tipo e as duas funções** (ao fim do arquivo)

```ts
export interface FiltrosProcessos {
  busca?: string
  status?: string
}

/**
 * Grupos por mês da data de chegada (com contagem), respeitando busca/status.
 * Busca só a coluna `data_chegada` (query leve) e agrupa em TS — sem GROUP BY
 * no banco, sem migração.
 */
export async function listarMesesProcessos(filtros: FiltrosProcessos): Promise<GrupoMes[]> {
  const supabase = await createServerSupabase()
  let query = supabase.from('processos_recebimento').select('data_chegada')
  if (filtros.status) query = query.eq('status', filtros.status)
  const or = condicaoBuscaProcesso(filtros.busca)
  if (or) query = query.or(or)
  const { data, error } = await query
  if (error) throw error
  const datas = (data ?? []).map((r) => (r as { data_chegada: string | null }).data_chegada)
  return agruparPorMes(datas)
}

/**
 * Linhas de um grupo: um mês (`chave` 'YYYY-MM', recorte por range de data) ou
 * 'sem_data' (data_chegada nula). Mesmas colunas e ordem (número desc) da lista.
 */
export async function listarProcessosDoMes(
  filtros: FiltrosProcessos,
  chave: string,
): Promise<ProcessoResumoRow[]> {
  const supabase = await createServerSupabase()
  let query = supabase
    .from('processos_recebimento')
    .select(
      'id, numero, numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido, tipo, fornecedor, codigo_material, status',
    )
  if (filtros.status) query = query.eq('status', filtros.status)
  const or = condicaoBuscaProcesso(filtros.busca)
  if (or) query = query.or(or)
  if (chave === 'sem_data') {
    query = query.is('data_chegada', null)
  } else {
    query = query.gte('data_chegada', `${chave}-01`).lt('data_chegada', inicioProximoMes(chave))
  }
  const { data, error } = await query.order('numero', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProcessoResumoRow[]
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/modules/recebimento/infra/processo-repository.ts"
git commit -m "feat(processos): repository listarMesesProcessos e listarProcessosDoMes"
```

---

### Task 4: Application — Server Action `carregarProcessosDoMes`

**Files:**
- Create: `src/modules/recebimento/application/carregar-processos-mes.ts`

**Interfaces:**
- Consumes: `listarProcessosDoMes`, `FiltrosProcessos`, `ProcessoResumoRow` (Task 3); `getSessao`, `podeFazer` (existentes).
- Produces: `carregarProcessosDoMes(filtros, chave): Promise<ResultadoProcessosMes>` e `type ResultadoProcessosMes`.

- [ ] **Step 1: Criar a Server Action**

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import {
  listarProcessosDoMes,
  type FiltrosProcessos,
  type ProcessoResumoRow,
} from '../infra/processo-repository'

export type ResultadoProcessosMes =
  | { ok: true; linhas: ProcessoResumoRow[] }
  | { ok: false; erro: string }

/**
 * Carrega sob demanda as linhas de um grupo (mês 'YYYY-MM' ou 'sem_data')
 * quando o usuário abre o accordion. Exige `visualizar`; o RLS é o portão real.
 */
export async function carregarProcessosDoMes(
  filtros: FiltrosProcessos,
  chave: string,
): Promise<ResultadoProcessosMes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }
  try {
    const linhas = await listarProcessosDoMes(filtros, chave)
    return { ok: true, linhas }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os processos deste mês.' }
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/modules/recebimento/application/carregar-processos-mes.ts"
git commit -m "feat(processos): Server Action carregarProcessosDoMes (sob demanda)"
```

---

### Task 5: UI — componente presentacional `LinhasProcessos`

**Files:**
- Create: `src/app/(app)/recebimento/processos/linhas-processos.tsx`

**Interfaces:**
- Consumes: `ProcessoResumoRow` (Task 3); `rotuloStatusProcesso` (existente).
- Produces: `LinhasProcessos({ linhas }: { linhas: ProcessoResumoRow[] })` — renderiza tabela (desktop) + cards (mobile). Sem hooks (funciona dentro de client component).

> Extrai a marcação de linhas que hoje está inline em `processos/page.tsx`.

- [ ] **Step 1: Criar o componente**

```tsx
import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import type { ProcessoResumoRow } from '@/modules/recebimento/infra/processo-repository'

const CAMPOS: { rotulo: string; valor: (p: ProcessoResumoRow) => string }[] = [
  { rotulo: 'NF', valor: (p) => p.numero_nf || '—' },
  { rotulo: 'Nº EMB', valor: (p) => p.numero_emb || '—' },
  { rotulo: 'Nº DI/INPI', valor: (p) => p.di_inpi || '—' },
  { rotulo: 'ACP/Cliente', valor: (p) => p.acp_cliente || '—' },
  { rotulo: 'Nº Pedido', valor: (p) => p.numero_pedido || '—' },
  { rotulo: 'Tipo', valor: (p) => p.tipo || '—' },
  { rotulo: 'Fornecedor', valor: (p) => p.fornecedor || '—' },
  { rotulo: 'Item Recebido', valor: (p) => p.codigo_material || '—' },
]

export function LinhasProcessos({ linhas }: { linhas: ProcessoResumoRow[] }) {
  if (linhas.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">Nenhum processo neste grupo.</p>
    )
  }
  return (
    <>
      {/* Desktop: tabela compacta com rolagem lateral */}
      <div className="hidden md:block">
        <Table className="text-xs [&_:is(th,td)]:px-2.5 [&_:is(th,td)]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              {CAMPOS.map((c) => (
                <TableHead key={c.rotulo}>{c.rotulo}</TableHead>
              ))}
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((processo) => {
              const status = rotuloStatusProcesso(processo.status)
              return (
                <TableRow key={processo.id}>
                  <TableCell className="font-medium">{processo.numero}</TableCell>
                  {CAMPOS.map((c) => (
                    <TableCell key={c.rotulo}>{c.valor(processo)}</TableCell>
                  ))}
                  <TableCell>
                    <Badge className={status.className}>{status.rotulo}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Abrir processo #${processo.numero}`}
                      render={<Link href={`/recebimento/processos/${processo.id}`} />}
                    >
                      <ArrowRightIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {linhas.map((processo) => {
          const status = rotuloStatusProcesso(processo.status)
          return (
            <Link
              key={processo.id}
              href={`/recebimento/processos/${processo.id}`}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">#{processo.numero}</span>
                <Badge className={status.className}>{status.rotulo}</Badge>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {CAMPOS.map((c) => (
                  <div key={c.rotulo} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">{c.rotulo}</dt>
                    <dd className="min-w-0 flex-1">{c.valor(processo)}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          )
        })}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verificar tipos/lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/recebimento/processos/linhas-processos.tsx"
git commit -m "feat(processos): componente LinhasProcessos (tabela+cards reaproveitáveis)"
```

---

### Task 6: UI — client accordion `ProcessosPorMes`

**Files:**
- Create: `src/app/(app)/recebimento/processos/processos-por-mes.tsx`

**Interfaces:**
- Consumes: `GrupoMes` (Task 1); `carregarProcessosDoMes`, `ResultadoProcessosMes` (Task 4); `FiltrosProcessos`, `ProcessoResumoRow` (Task 3); `LinhasProcessos` (Task 5); `cn` (existente).
- Produces: `ProcessosPorMes({ grupos, filtros, abertosInicial })`.

- [ ] **Step 1: Criar o componente**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { carregarProcessosDoMes } from '@/modules/recebimento/application/carregar-processos-mes'
import type { GrupoMes } from '@/modules/recebimento/domain/agrupamento-mes'
import type { FiltrosProcessos, ProcessoResumoRow } from '@/modules/recebimento/infra/processo-repository'
import { LinhasProcessos } from './linhas-processos'

type Carga =
  | { fase: 'carregando' }
  | { fase: 'pronto'; linhas: ProcessoResumoRow[] }
  | { fase: 'erro'; erro: string }

interface Props {
  grupos: GrupoMes[]
  filtros: FiltrosProcessos
  abertosInicial: string[]
}

export function ProcessosPorMes({ grupos, filtros, abertosInicial }: Props) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(abertosInicial))
  const [cargas, setCargas] = useState<Record<string, Carga>>({})

  async function carregar(chave: string) {
    setCargas((c) => ({ ...c, [chave]: { fase: 'carregando' } }))
    const r = await carregarProcessosDoMes(filtros, chave)
    setCargas((c) => ({
      ...c,
      [chave]: r.ok ? { fase: 'pronto', linhas: r.linhas } : { fase: 'erro', erro: r.erro },
    }))
  }

  // Carrega os grupos abertos por padrão ao montar.
  useEffect(() => {
    for (const chave of abertosInicial) carregar(chave)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(chave: string) {
    const estaAberto = abertos.has(chave)
    setAbertos((prev) => {
      const next = new Set(prev)
      if (estaAberto) next.delete(chave)
      else next.add(chave)
      return next
    })
    if (!estaAberto && !cargas[chave]) carregar(chave)
  }

  if (grupos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
        Nenhum processo encontrado.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((g) => {
        const aberto = abertos.has(g.chave)
        const carga = cargas[g.chave]
        return (
          <div key={g.chave} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => toggle(g.chave)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50"
            >
              <span className="flex items-center gap-2 font-medium">
                {g.rotulo}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {g.total}
                </span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', aberto && 'rotate-180')} />
            </button>
            {aberto && (
              <div className="border-t border-border p-3">
                {(!carga || carga.fase === 'carregando') && (
                  <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
                )}
                {carga?.fase === 'erro' && (
                  <div className="py-4 text-center text-sm">
                    <p className="text-red-600">{carga.erro}</p>
                    <button
                      type="button"
                      onClick={() => carregar(g.chave)}
                      className="mt-2 text-primary underline"
                    >
                      Tentar de novo
                    </button>
                  </div>
                )}
                {carga?.fase === 'pronto' && <LinhasProcessos linhas={carga.linhas} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos/lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/recebimento/processos/processos-por-mes.tsx"
git commit -m "feat(processos): accordion por mês com carregamento sob demanda"
```

---

### Task 7: UI — ligar tudo em `page.tsx`

**Files:**
- Modify: `src/app/(app)/recebimento/processos/page.tsx` (reescrever)

**Interfaces:**
- Consumes: `listarMesesProcessos` (Task 3); `ProcessosPorMes` (Task 6); `ProcessosFiltros` (existente).

- [ ] **Step 1: Reescrever a página**

```tsx
import { listarMesesProcessos } from '@/modules/recebimento/infra/processo-repository'
import { ProcessosFiltros } from './processos-filtros'
import { ProcessosPorMes } from './processos-por-mes'

interface ProcessosPageProps {
  searchParams: Promise<{ busca?: string; status?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const filtros = { busca: sp.busca || undefined, status: sp.status || undefined }
  const grupos = await listarMesesProcessos(filtros)

  // Abrem por padrão: "Aguardando chegada" (se existir) + o mês mais recente.
  const abertosInicial: string[] = []
  if (grupos.some((g) => g.chave === 'sem_data')) abertosInicial.push('sem_data')
  const primeiroMes = grupos.find((g) => g.chave !== 'sem_data')
  if (primeiroMes) abertosInicial.push(primeiroMes.chave)

  return (
    <div className="flex flex-col gap-4">
      <ProcessosFiltros />
      <ProcessosPorMes grupos={grupos} filtros={filtros} abertosInicial={abertosInicial} />
    </div>
  )
}
```

- [ ] **Step 2: Conferir `ProcessosFiltros`**

Abra `src/app/(app)/recebimento/processos/processos-filtros.tsx` e confirme que ele só escreve `busca`/`status` na URL. Se ele referenciar `pagina` (paginação antiga), remova essa referência (não há mais paginação global). Rode `npx tsc --noEmit` para pegar qualquer quebra.

- [ ] **Step 3: Verificar tipos/lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/recebimento/processos/page.tsx" "src/app/(app)/recebimento/processos/processos-filtros.tsx"
git commit -m "feat(processos): lista agrupada por mês (accordions sob demanda)"
```

---

### Task 8: Verificação final (build + testes + smoke)

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: tudo verde.

- [ ] **Step 2: Smoke manual** (dev server, banco compartilhado)

Run: `npm run dev` e em `localhost:3000` → Recebimento → Processos:
- Aparecem os accordions: "Aguardando chegada" no topo + meses (mais recente primeiro), cada um com contagem.
- "Aguardando chegada" e o mês mais recente abrem sozinhos e carregam as linhas.
- Abrir um mês fechado carrega suas linhas (spinner "Carregando…" → tabela/cards).
- Filtrar por busca/status atualiza contagens e grupos; grupos sem resultado somem.
- Colunas e ação de abrir processo iguais às de antes; mobile vira cards.

- [ ] **Step 3: Nada a commitar** (verificação). Fim do plano.

---

## Self-Review

- **Cobertura da spec:** accordions por mês (Tasks 6–7), "Aguardando chegada" no topo (Task 1 ordenação + Task 7 default), ordem meses desc (Task 1), contagem no cabeçalho (Tasks 3/6), carregamento sob demanda (Tasks 4/6), abrir padrão sem_data+recente (Task 7), filtros busca/status (Tasks 2/3), layout/colunas atuais (Task 5), sem migração (Task 3, agrupa em TS), mês derivado (Task 1). ✔
- **Placeholders:** nenhum — todo passo tem código/comando concretos. ✔
- **Consistência de tipos:** `GrupoMes`, `FiltrosProcessos`, `ProcessoResumoRow`, `carregarProcessosDoMes`/`ResultadoProcessosMes`, `condicaoBuscaProcesso`, `agruparPorMes`/`inicioProximoMes` usados com as mesmas assinaturas entre tasks. ✔
