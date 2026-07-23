# ShopFloor — Plano Pesquisa + Grade Geral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tela `/shopfloor/pesquisa` com **busca por SN** (histórico completo) e **Grade Geral** (matriz SN × postos da OP com filtro por caixa). **SEM migração** (só leitura).

**Architecture:** Domínio puro TDD (`gerarFaixaSNs` com guarda de 2.000 + `montarGrade` com a lógica de célula) + repo de leitura + 2 server actions (`buscarHistoricoSN`, `carregarGrade`) + tela client (2 cards). Perm **`visualizar`**. Colunas da grade = fluxo da OP (ordem) + Manutenção.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento`. Sem migração. Perm `visualizar` (page + actions).
- **Células:** sem registro → Pendente; sem status → Registrado; Embalagem → nome da caixa (ou Registrado); com status → Aprovado se houver aprovado, senão Reprovado se houver reprovado, senão Registrado; Manutenção → Concluído/—.
- **Faixa:** prefixo/sufixo iguais; zero-padding pela maior largura; **> 2.000 SNs → erro**.
- Cascata da grade inclui OPs **finalizadas** (consulta histórica).
- Padrões do módulo. TS strict. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit heredoc. **Sem push até o fim.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `src/modules/shopfloor/domain/grade.ts` + `__tests__/grade.test.ts`
- Create: `src/modules/shopfloor/infra/pesquisa-repository.ts`
- Create: `src/modules/shopfloor/application/pesquisa-actions.ts`
- Create: `src/app/(app)/shopfloor/pesquisa/page.tsx` + `pesquisa-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item "Pesquisa", ícone `Search`, perm `visualizar`, após `manutencao`)

---

### Task 1: Domínio `grade` (TDD)

**Files:** `src/modules/shopfloor/domain/grade.ts` + `__tests__/grade.test.ts`

**Interfaces:**
- `gerarFaixaSNs(snIni, snFim): { ok: true; sns: string[] } | { ok: false; erro: string }`
- `interface RegistroGrade { snNorm: string; posto: string; status: string; numeroCaixa: string }`
- `interface LinhaGrade { sn: string; celulas: Record<string, string> }`
- `montarGrade(sns: string[], postosDaOp: string[], registros: RegistroGrade[]): LinhaGrade[]` (colunas = postosDaOp + 'Manutenção')

- [ ] **Step 1: Testes (falham)**

`src/modules/shopfloor/domain/__tests__/grade.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gerarFaixaSNs, montarGrade } from '../grade'

describe('gerarFaixaSNs', () => {
  it('gera a faixa com zero-padding e prefixo/sufixo', () => {
    const r = gerarFaixaSNs('AB008C', 'AB011C')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sns).toEqual(['AB008C', 'AB009C', 'AB010C', 'AB011C'])
  })
  it('barra prefixo/sufixo diferentes e faixa sem número', () => {
    expect(gerarFaixaSNs('A100', 'B200').ok).toBe(false)
    expect(gerarFaixaSNs('ABC', 'ABD').ok).toBe(false)
  })
  it('barra faixa maior que 2000', () => {
    const r = gerarFaixaSNs('1', '3000')
    expect(r.ok).toBe(false)
  })
})

describe('montarGrade', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  const reg = (over: Partial<{ snNorm: string; posto: string; status: string; numeroCaixa: string }>) => ({
    snNorm: '100', posto: 'Inicial', status: '', numeroCaixa: '', ...over,
  })
  it('sem registro → Pendente em tudo; Manutenção → —', () => {
    const [l] = montarGrade(['100'], postos, [])
    expect(l!.celulas).toEqual({ Inicial: 'Pendente', Teste: 'Pendente', Embalagem: 'Pendente', 'Manutenção': '—' })
  })
  it('sem status → Registrado; Embalagem mostra a caixa', () => {
    const [l] = montarGrade(['100'], postos, [reg({}), reg({ posto: 'Embalagem', numeroCaixa: 'CX-01' })])
    expect(l!.celulas['Inicial']).toBe('Registrado')
    expect(l!.celulas['Embalagem']).toBe('CX-01')
  })
  it('com status: Aprovado vence Reprovado (re-lançamento)', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Teste', status: 'Aprovado' }),
    ])
    expect(l!.celulas['Teste']).toBe('Aprovado')
  })
  it('com status só reprovado → Reprovado; Manutenção com reparo → Concluído', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Manutenção' }),
    ])
    expect(l!.celulas['Teste']).toBe('Reprovado')
    expect(l!.celulas['Manutenção']).toBe('Concluído')
  })
  it('casa SN da linha com registros pelo normalizado', () => {
    const [l] = montarGrade(['0100'], postos, [reg({ snNorm: '100' })])
    expect(l!.celulas['Inicial']).toBe('Registrado')
  })
})
```

- [ ] **Step 2: FALHA** — `npm run test -- shopfloor/domain/__tests__/grade`.

- [ ] **Step 3: Implementar**

`src/modules/shopfloor/domain/grade.ts`:

```ts
import { partesSerie, normalizarSerie } from './serie'
import { postoTemStatus } from './lancamento-linhas'

const MAX_SNS = 2000

export function gerarFaixaSNs(
  snIni: string,
  snFim: string,
): { ok: true; sns: string[] } | { ok: false; erro: string } {
  const a = partesSerie(snIni)
  const b = partesSerie(snFim)
  if (Number.isNaN(a.num) || Number.isNaN(b.num)) {
    return { ok: false, erro: 'Faixa de SN sem bloco numérico.' }
  }
  if (
    a.prefixo.toLowerCase() !== b.prefixo.toLowerCase() ||
    a.sufixo.toLowerCase() !== b.sufixo.toLowerCase()
  ) {
    return { ok: false, erro: 'Prefixo/sufixo diferentes entre o início e o fim da faixa.' }
  }
  const ini = Math.min(a.num, b.num)
  const fim = Math.max(a.num, b.num)
  const total = fim - ini + 1
  if (total > MAX_SNS) {
    return { ok: false, erro: `Faixa muito grande (${total} SNs; máximo ${MAX_SNS}).` }
  }
  const largura = Math.max(a.largura, b.largura)
  const sns: string[] = []
  for (let n = ini; n <= fim; n++) sns.push(a.prefixo + String(n).padStart(largura, '0') + a.sufixo)
  return { ok: true, sns }
}

export interface RegistroGrade {
  snNorm: string
  posto: string
  status: string
  numeroCaixa: string
}

export interface LinhaGrade {
  sn: string
  celulas: Record<string, string>
}

/** Monta a matriz SN × postos. Colunas = postos do fluxo da OP + 'Manutenção'. */
export function montarGrade(
  sns: string[],
  postosDaOp: string[],
  registros: RegistroGrade[],
): LinhaGrade[] {
  const porSn = new Map<string, RegistroGrade[]>()
  for (const r of registros) {
    const arr = porSn.get(r.snNorm)
    if (arr) arr.push(r)
    else porSn.set(r.snNorm, [r])
  }
  const colunas = [...postosDaOp, 'Manutenção']
  return sns.map((sn) => {
    const regs = porSn.get(normalizarSerie(sn)) ?? []
    const celulas: Record<string, string> = {}
    for (const posto of colunas) {
      const doPosto = regs.filter((r) => r.posto.toLowerCase() === posto.toLowerCase())
      if (posto === 'Manutenção') {
        celulas[posto] = doPosto.length > 0 ? 'Concluído' : '—'
        continue
      }
      if (doPosto.length === 0) {
        celulas[posto] = 'Pendente'
        continue
      }
      if (posto.toLowerCase() === 'embalagem') {
        const caixa = doPosto.find((r) => r.numeroCaixa.trim() !== '')?.numeroCaixa ?? ''
        celulas[posto] = caixa !== '' ? caixa : 'Registrado'
        continue
      }
      if (postoTemStatus(posto)) {
        if (doPosto.some((r) => r.status.toLowerCase() === 'aprovado')) celulas[posto] = 'Aprovado'
        else if (doPosto.some((r) => r.status.toLowerCase() === 'reprovado')) celulas[posto] = 'Reprovado'
        else celulas[posto] = 'Registrado'
        continue
      }
      celulas[posto] = 'Registrado'
    }
    return { sn, celulas }
  })
}
```

- [ ] **Step 4: PASSA.** **Step 5: Commit** (`feat(shopfloor): domínio da grade geral (faixa de SNs + células) TDD`).

---

### Task 2: Repositório + Actions da Pesquisa

**Files:**
- Create: `src/modules/shopfloor/infra/pesquisa-repository.ts`
- Create: `src/modules/shopfloor/application/pesquisa-actions.ts`

**Interfaces:**
- Repo: `interface RegistroHistorico { dataHora; colaborador; posto; pmo; op; status; numeroCaixa; numeroSerie; cod; pos; tipo; nqaVisual; nqaFuncional; idIntegracao; reparoConserto; reparoPosicao }`; `buscarRegistrosPorSn(snNorm): Promise<RegistroHistorico[]>`; `listarRegistrosDaOp(pmo, op): Promise<RegistroGrade[]>`; `interface OrdemPesquisa { cliente; pmo; op; descricao; sn_ini; sn_fim; postos: string[] }`; `listarTodasOrdens(): Promise<OrdemPesquisa[]>` (SEM filtro de status; postos ordenados).
- Actions (perm `visualizar`): `buscarHistoricoSN(sn)` → `{ok:true, registros} | {ok:false, erro}`; `carregarGrade(pmo, op)` → `{ok:true, colunas: string[], linhas: LinhaGrade[]} | {ok:false, erro}`.

- [ ] **Step 1: Repositório**

`src/modules/shopfloor/infra/pesquisa-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { RegistroGrade } from '../domain/grade'

export interface RegistroHistorico {
  dataHora: string
  colaborador: string
  posto: string
  pmo: string
  op: string
  status: string
  numeroCaixa: string
  numeroSerie: string
  cod: string
  pos: string
  tipo: string
  nqaVisual: string
  nqaFuncional: string
  idIntegracao: string
  reparoConserto: string
  reparoPosicao: string
}

export async function buscarRegistrosPorSn(snNorm: string): Promise<RegistroHistorico[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('data_hora,colaborador,posto,pmo,op,status,numero_caixa,numero_serie,codigo_defeito,posicao,tipo_defeito,nqa_visual,nqa_funcional,id_integracao,reparo_conserto,reparo_posicao')
    .eq('numero_serie_norm', snNorm)
    .order('data_hora', { ascending: true })
  if (error) throw error
  return (data as Record<string, string>[]).map((r) => ({
    dataHora: r.data_hora ?? '',
    colaborador: r.colaborador ?? '',
    posto: r.posto ?? '',
    pmo: r.pmo ?? '',
    op: r.op ?? '',
    status: r.status ?? '',
    numeroCaixa: r.numero_caixa ?? '',
    numeroSerie: r.numero_serie ?? '',
    cod: r.codigo_defeito ?? '',
    pos: r.posicao ?? '',
    tipo: r.tipo_defeito ?? '',
    nqaVisual: r.nqa_visual ?? '',
    nqaFuncional: r.nqa_funcional ?? '',
    idIntegracao: r.id_integracao ?? '',
    reparoConserto: r.reparo_conserto ?? '',
    reparoPosicao: r.reparo_posicao ?? '',
  }))
}

export async function listarRegistrosDaOp(pmo: string, op: string): Promise<RegistroGrade[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('numero_serie_norm,posto,status,numero_caixa')
    .eq('pmo', pmo)
    .eq('op', op)
  if (error) throw error
  return (data as { numero_serie_norm: string; posto: string; status: string; numero_caixa: string }[]).map((r) => ({
    snNorm: r.numero_serie_norm,
    posto: r.posto,
    status: r.status,
    numeroCaixa: r.numero_caixa,
  }))
}

export interface OrdemPesquisa {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

/** Todas as OPs (ativas E finalizadas) com fluxo ordenado — consulta é histórica. */
export async function listarTodasOrdens(): Promise<OrdemPesquisa[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }[]
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }))
}
```

- [ ] **Step 2: Actions**

`src/modules/shopfloor/application/pesquisa-actions.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { normalizarSerie } from '../domain/serie'
import { gerarFaixaSNs, montarGrade, type LinhaGrade } from '../domain/grade'
import { carregarOrdem } from '../infra/lancamento-repository'
import {
  buscarRegistrosPorSn,
  listarRegistrosDaOp,
  type RegistroHistorico,
} from '../infra/pesquisa-repository'

const SEM_PERMISSAO = 'Você não tem permissão para pesquisar.'
const ERRO_INTERNO = 'Não foi possível concluir a consulta.'

export async function buscarHistoricoSN(
  sn: string,
): Promise<{ ok: true; registros: RegistroHistorico[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, registros: [] }
  try {
    return { ok: true, registros: await buscarRegistrosPorSn(alvo) }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}

export async function carregarGrade(
  pmo: string,
  op: string,
): Promise<{ ok: true; colunas: string[]; linhas: LinhaGrade[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }

  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  const faixa = gerarFaixaSNs(ordem.sn_ini, ordem.sn_fim)
  if (!faixa.ok) return faixa

  try {
    const registros = await listarRegistrosDaOp(pmo.trim(), op.trim())
    return {
      ok: true,
      colunas: [...ordem.postos, 'Manutenção'],
      linhas: montarGrade(faixa.sns, ordem.postos, registros),
    }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}
```

- [ ] **Step 3: Compila.** **Step 4: Commit** (`feat(shopfloor): repositório + actions da pesquisa (histórico por SN + grade)`).

---

### Task 3: Tela de Pesquisa + item de menu

**Files:**
- Create: `src/app/(app)/shopfloor/pesquisa/page.tsx` + `pesquisa-form.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

- [ ] **Step 1: `page.tsx`** — guard `visualizar`; carrega `listarTodasOrdens()`; título "Pesquisa"; renderiza `<PesquisaForm ordens={ordens} />`.

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { PesquisaForm } from './pesquisa-form'

export default async function PesquisaPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para acessar a Pesquisa." />
  }
  const ordens = await listarTodasOrdens()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Pesquisa</h2>
        <p className="text-sm text-muted-foreground">Histórico por Nº de Série e Grade Geral da OP.</p>
      </div>
      <PesquisaForm ordens={ordens} />
    </div>
  )
}
```

- [ ] **Step 2: `pesquisa-form.tsx`** — client, 2 cards:

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarHistoricoSN, carregarGrade } from '@/modules/shopfloor/application/pesquisa-actions'
import type { RegistroHistorico, OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'
import type { LinhaGrade } from '@/modules/shopfloor/domain/grade'

const TODAS = '__todas__'

function corCelula(v: string): string {
  if (v === 'Aprovado' || v === 'Concluído') return 'text-green-700 font-medium'
  if (v === 'Reprovado') return 'text-red-600 font-medium'
  if (v === 'Pendente' || v === '—') return 'text-muted-foreground'
  return 'text-tinta'
}

export function PesquisaForm({ ordens }: { ordens: OrdemPesquisa[] }) {
  // --- busca por SN ---
  const [sn, setSn] = useState('')
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [buscando, startBusca] = useTransition()

  // --- grade ---
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [colunas, setColunas] = useState<string[]>([])
  const [linhas, setLinhas] = useState<LinhaGrade[] | null>(null)
  const [caixa, setCaixa] = useState('')
  const [carregando, startGrade] = useTransition()

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(
    () => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordens, cliente],
  )
  const ops = useMemo(
    () => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordens, cliente, pmo],
  )

  const caixas = useMemo(() => {
    if (!linhas) return []
    const set = new Set<string>()
    for (const l of linhas) {
      const v = l.celulas['Embalagem']
      if (v && v !== 'Pendente' && v !== 'Registrado') set.add(v)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }, [linhas])

  const linhasFiltradas = useMemo(() => {
    if (!linhas) return null
    if (caixa === '') return linhas
    return linhas.filter((l) => l.celulas['Embalagem'] === caixa)
  }, [linhas, caixa])

  function onBuscar() {
    if (sn.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarHistoricoSN(sn)
      if (r.ok) setRegistros(r.registros)
      else toast.error(r.erro)
    })
  }

  function abrirGrade(opSel: string) {
    setOp(opSel)
    setCaixa('')
    startGrade(async () => {
      const r = await carregarGrade(pmo, opSel)
      if (r.ok) {
        setColunas(r.colunas)
        setLinhas(r.linhas)
      } else {
        setLinhas(null)
        toast.error(r.erro)
      }
    })
  }

  function fmtData(iso: string) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Busca por SN */}
      <Card>
        <CardHeader><CardTitle>Buscar por Nº de Série</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snBusca">Nº de Série</Label>
              <Input id="snBusca" value={sn} onChange={(e) => setSn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBuscar() } }} autoComplete="off" placeholder="Bipe ou digite o SN" />
            </div>
            <Button variant="outline" onClick={onBuscar} disabled={buscando}>
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>
          {registros !== null && registros.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum registro para esse SN.</p>
          )}
          {registros !== null && registros.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Posto</TableHead>
                    <TableHead>PMO/OP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Caixa</TableHead>
                    <TableHead>Defeito</TableHead>
                    <TableHead>NQA</TableHead>
                    <TableHead>Integração</TableHead>
                    <TableHead>Reparo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{fmtData(r.dataHora)}</TableCell>
                      <TableCell>{r.colaborador}</TableCell>
                      <TableCell>{r.posto}</TableCell>
                      <TableCell>{r.pmo}/{r.op}</TableCell>
                      <TableCell className={corCelula(r.status)}>{r.status || '—'}</TableCell>
                      <TableCell>{r.numeroCaixa || '—'}</TableCell>
                      <TableCell>{[r.cod, r.pos, r.tipo].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{[r.nqaVisual, r.nqaFuncional].filter(Boolean).join(' / ') || '—'}</TableCell>
                      <TableCell>{r.idIntegracao || '—'}</TableCell>
                      <TableCell>{[r.reparoConserto, r.reparoPosicao].filter(Boolean).join(' · ') || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grade Geral */}
      <Card>
        <CardHeader><CardTitle>Grade Geral</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={(v) => { setCliente(v ?? ''); setPmo(''); setOp(''); setLinhas(null) }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO</Label>
              <Select value={pmo} onValueChange={(v) => { setPmo(v ?? ''); setOp(''); setLinhas(null) }} disabled={cliente === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Select value={op} onValueChange={(v) => { if (v) abrirGrade(v) }} disabled={pmo === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Caixa</Label>
              <Select value={caixa === '' ? TODAS : caixa} onValueChange={(v) => setCaixa(v === TODAS ? '' : (v ?? ''))} disabled={caixas.length === 0}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas</SelectItem>
                  {caixas.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {carregando && <p className="text-sm text-muted-foreground">Carregando grade…</p>}

          {linhasFiltradas && (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Nº de Série</TableHead>
                    {colunas.map((p) => <TableHead key={p}>{p}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhasFiltradas.map((l) => (
                    <TableRow key={l.sn}>
                      <TableCell className="font-medium">{l.sn}</TableCell>
                      {colunas.map((p) => (
                        <TableCell key={p} className={corCelula(l.celulas[p] ?? '')}>{l.celulas[p] ?? '—'}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Menu** — em `app-shell.tsx`, adicionar `Search` aos imports de lucide (se ainda não importado; se `Search` conflitar, use `SearchCheck` ou `FileSearch`) e, no array `SHOPFLOOR`, após `manutencao`:

```ts
  { chave: 'pesquisa', rotulo: 'Pesquisa', href: '/shopfloor/pesquisa', icone: Search, perm: 'visualizar' },
```

- [ ] **Step 4: Compila + lint.** **Step 5: Commit** (`feat(shopfloor): tela de Pesquisa (histórico por SN + Grade Geral) + item de menu`).

---

### Task 4: Verificação + review amplo + push (controller)

- [ ] Suíte verde; review amplo (foco: lógica de célula vs legado, faixa, perf da grade, permissão `visualizar`); push → preview (teste visual do usuário). SEM migração.

---

## Notas de verificação (self-review)

- Cobertura da spec: busca por SN completa (com integração/reparo) ✅; grade = faixa + fluxo da OP + Manutenção ✅; guarda 2.000 ✅; caixa filter ✅; OPs finalizadas na cascata ✅; perm `visualizar` ✅; sem migração ✅.
- `carregarOrdem` (reusado) não filtra status → funciona p/ OP finalizada ✅.
- Tipos compartilhados domínio↔repo↔tela; sentinel `__todas__` (padrão do módulo).
