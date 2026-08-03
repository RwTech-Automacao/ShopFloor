# Embalagem por caixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Lançamento de um posto de Embalagem (perfil `caixa`), auto-numerar a caixa, limite digitado uma vez, botão Fechar caixa (avança), ☐ Última caixa (fecha sem avançar), contagem (X/limite · total · X/total da OP) e quadro dos últimos SNs.

**Architecture:** Tabela `sf_caixas` guarda o estado (seq, limite, qtd, código, fechada, última). RPC `sf_fechar_caixa` finaliza a caixa (código com qtd real + atualiza os registros). O insert da peça reusa `sf_lancar`. Painel `EmbalagemPanel` (à la Integração) no Lançamento.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase (RLS + RPC), Vitest 4, sonner.

## Global Constraints

- **Migração só no Dev.** Detecção de Embalagem por perfil (`recurso === 'caixa'`), nunca por nome.
- **Código da caixa:** `CX[seq][qtd]OP-PMO` com colchetes literais (ex.: `CX[3][10]12345-PMO973`). Marcador da caixa aberta: `CX[seq]`.
- **Nomes canônicos:** `gerarCodigoCaixa(seq,qtd,op,pmo)`, `marcadorCaixaAberta(seq)` em `domain/caixa.ts`; actions `carregarEmbalagem(pmo,op,posto)`, `embalarPeca(...)`, `fecharCaixa(pmo,op,posto,seq,ultima)`; componente `EmbalagemPanel`; `OrdemLancamentoLista.qtd`.
- **PT-BR**; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task** (`npm run build` — se OOM, `NODE_OPTIONS=--max-old-space-size=6144 npm run build`; `npm run lint`; `npm test`).

---

## File Structure

- **Create** `supabase/migrations/0070_sf_caixas.sql` — tabela + RLS + RPC `sf_fechar_caixa`.
- **Create** `src/modules/shopfloor/domain/caixa.ts` (+ `__tests__/caixa.test.ts`) — geração de código.
- **Create** `src/modules/shopfloor/infra/caixa-repository.ts` — estado/persistência da caixa.
- **Create** `src/modules/shopfloor/application/embalagem-actions.ts` — carregar/embalar/fechar.
- **Modify** `src/modules/shopfloor/infra/lancamento-repository.ts` — `OrdemLancamentoLista.qtd`.
- **Create** `src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx` — o painel.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — renderiza o painel; remove campos de caixa do Contexto.

---

## Task 1: Migração 0070 (sf_caixas + RPC fechar)

**Files:** Create `supabase/migrations/0070_sf_caixas.sql`

- [ ] **Step 1: Escrever a migração**
```sql
-- =============================================================
-- Embalagem por caixa: estado da caixa (auto-numeração, limite,
-- fechada/última) + fechar (gera código com qtd real e carimba
-- os registros da caixa). Código: CX[seq][qtd]OP-PMO.
-- =============================================================
create table public.sf_caixas (
  id         uuid primary key default gen_random_uuid(),
  pmo        text not null,
  op         text not null,
  posto      text not null,
  seq        int  not null,
  limite     int  not null,
  qtd        int  not null default 0,
  codigo     text not null default '',
  fechada    boolean not null default false,
  ultima     boolean not null default false,
  created_at timestamptz not null default now(),
  fechada_em timestamptz,
  unique (pmo, op, posto, seq)
);
alter table public.sf_caixas enable row level security;
create policy sf_caixas_select on public.sf_caixas for select using (tem_permissao('visualizar'));
create policy sf_caixas_admin  on public.sf_caixas for all using (tem_permissao('lancar')) with check (tem_permissao('lancar'));

-- fechar a caixa: conta as peças (registros com numero_caixa = 'CX['||seq||']'),
-- grava qtd/codigo/fechada/ultima e carimba os registros com o código final.
create or replace function public.sf_fechar_caixa(
  p_pmo text, p_op text, p_posto text, p_seq int, p_ultima boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_marcador text := 'CX[' || p_seq || ']';
  v_qtd      int;
  v_codigo   text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo||'/'||p_op||'/'||p_posto)::bigint);

  select count(*) into v_qtd from sf_registros
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;
  if v_qtd = 0 then
    return jsonb_build_object('ok', false, 'erro', 'CAIXA_VAZIA');
  end if;

  v_codigo := 'CX[' || p_seq || '][' || v_qtd || ']' || p_op || '-' || p_pmo;

  update sf_caixas set qtd = v_qtd, codigo = v_codigo, fechada = true, ultima = p_ultima, fechada_em = now()
  where pmo = p_pmo and op = p_op and posto = p_posto and seq = p_seq;

  update sf_registros set numero_caixa = v_codigo
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
```

- [ ] **Step 2: Dry-run + aplicar no Dev**

Run: `export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push --dry-run` (mostra 0070) então `supabase db push`.
Expected: 0070 aplicada (Dev → 0070).

- [ ] **Step 3: Verificar** — a tabela `sf_caixas` existe (select vazio 200) e a função `sf_fechar_caixa` existe.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0070_sf_caixas.sql
git commit -m "feat(shopfloor): migração 0070 — sf_caixas + sf_fechar_caixa (Embalagem por caixa)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Domínio `caixa.ts` (+ testes)

**Files:** Create `src/modules/shopfloor/domain/caixa.ts` + `src/modules/shopfloor/domain/__tests__/caixa.test.ts`

**Interfaces:** Produces `gerarCodigoCaixa(seq, qtd, op, pmo): string`; `marcadorCaixaAberta(seq): string`.

- [ ] **Step 1: Testes (falhando)** — criar `__tests__/caixa.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { gerarCodigoCaixa, marcadorCaixaAberta } from '../caixa'

describe('caixa', () => {
  it('gerarCodigoCaixa monta CX[seq][qtd]OP-PMO com colchetes literais', () => {
    expect(gerarCodigoCaixa(3, 10, '12345', 'PMO973')).toBe('CX[3][10]12345-PMO973')
    expect(gerarCodigoCaixa(10, 7, '5938', 'PMO973')).toBe('CX[10][7]5938-PMO973')
  })
  it('marcadorCaixaAberta é CX[seq]', () => {
    expect(marcadorCaixaAberta(1)).toBe('CX[1]')
    expect(marcadorCaixaAberta(12)).toBe('CX[12]')
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npm test -- caixa` → FAIL.

- [ ] **Step 3: Implementar** — criar `src/modules/shopfloor/domain/caixa.ts`:
```ts
/** Código final da caixa: CX[seq][qtd]OP-PMO (colchetes literais). Ex.: CX[3][10]12345-PMO973. */
export function gerarCodigoCaixa(seq: number, qtd: number, op: string, pmo: string): string {
  return `CX[${seq}][${qtd}]${op}-${pmo}`
}

/** Marcador da caixa ABERTA (antes de fechar), gravado no numero_caixa dos registros: CX[seq]. */
export function marcadorCaixaAberta(seq: number): string {
  return `CX[${seq}]`
}
```

- [ ] **Step 4: Rodar (passa)** — `npm test -- caixa` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/caixa.ts src/modules/shopfloor/domain/__tests__/caixa.test.ts
git commit -m "feat(shopfloor): domínio caixa (código CX[seq][qtd]OP-PMO) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend — estado da caixa + actions

**Files:**
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (`OrdemLancamentoLista.qtd`)
- Create: `src/modules/shopfloor/infra/caixa-repository.ts`
- Create: `src/modules/shopfloor/application/embalagem-actions.ts`

**Interfaces:**
- Consumes (Task 2): `gerarCodigoCaixa`, `marcadorCaixaAberta`. Consumes: `lancar`/`EntradaLancamento` de `lancar-action`.
- Produces: `EstadoEmbalagem`; `carregarEmbalagem`, `embalarPeca`, `fecharCaixa`; `OrdemLancamentoLista.qtd`.

- [ ] **Step 1: `lancamento-repository.ts` — expor `qtd` da OP**

Em `OrdemLancamentoLista`, acrescentar `qtd: number | null`. No `select` de `listarOrdensParaLancamento`, acrescentar `qtd`; no tipo inline das rows, `qtd: number | null`; no map, `qtd: r.qtd`.

- [ ] **Step 2: `caixa-repository.ts` — estado + persistência**

Criar `src/modules/shopfloor/infra/caixa-repository.ts`:
```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'

export interface EstadoEmbalagem {
  seq: number            // caixa atual (aberta ou próxima a abrir)
  limite: number | null  // null = ainda não definido (operador digita)
  qtdNaCaixa: number     // peças na caixa atual
  totalEmbaladas: number // todas as peças embaladas nesta OP+posto
  ultimasSns: string[]   // últimos SNs da caixa atual (mais recentes primeiro)
  concluida: boolean     // última caixa já foi fechada
}

interface CaixaRow { seq: number; limite: number; fechada: boolean; ultima: boolean }

export async function carregarEstadoEmbalagem(pmo: string, op: string, posto: string): Promise<EstadoEmbalagem> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,limite,fechada,ultima')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).order('seq', { ascending: true })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as CaixaRow[]
  const ultima = caixas[caixas.length - 1]

  const { count: total } = await supabase
    .from('sf_registros').select('*', { count: 'exact', head: true })
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  const totalEmbaladas = total ?? 0

  // concluída: a última caixa está fechada e marcada como última
  if (ultima && ultima.fechada && ultima.ultima) {
    return { seq: ultima.seq, limite: ultima.limite, qtdNaCaixa: 0, totalEmbaladas, ultimasSns: [], concluida: true }
  }

  // caixa atual: última aberta, ou a próxima (seq+1) se a última está fechada
  const abertaExiste = ultima && !ultima.fechada
  const seq = !ultima ? 1 : (ultima.fechada ? ultima.seq + 1 : ultima.seq)
  const limite = ultima ? ultima.limite : null

  let qtdNaCaixa = 0
  let ultimasSns: string[] = []
  if (abertaExiste) {
    const marc = marcadorCaixaAberta(seq)
    const { data: regs } = await supabase
      .from('sf_registros').select('numero_serie,data_hora')
      .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_caixa', marc)
      .order('data_hora', { ascending: false })
    const rows = (regs ?? []) as { numero_serie: string; data_hora: string }[]
    qtdNaCaixa = rows.length
    ultimasSns = rows.slice(0, 8).map((r) => r.numero_serie)
  }

  return { seq, limite, qtdNaCaixa, totalEmbaladas, ultimasSns, concluida: false }
}

/** Cria a linha da caixa (seq, limite) se ainda não existir. Idempotente. */
export async function garantirCaixa(pmo: string, op: string, posto: string, seq: number, limite: number): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_caixas')
    .upsert({ pmo, op, posto, seq, limite }, { onConflict: 'pmo,op,posto,seq', ignoreDuplicates: true })
  if (error) throw error
}

export async function chamarFecharCaixa(pmo: string, op: string, posto: string, seq: number, ultima: boolean): Promise<{ ok: boolean; erro?: string; codigo?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_fechar_caixa', { p_pmo: pmo, p_op: op, p_posto: posto, p_seq: seq, p_ultima: ultima })
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; codigo?: string }
}
```

- [ ] **Step 3: `embalagem-actions.ts` — actions**

Criar `src/modules/shopfloor/application/embalagem-actions.ts`:
```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'
import { carregarEstadoEmbalagem, garantirCaixa, chamarFecharCaixa, type EstadoEmbalagem } from '@/modules/shopfloor/infra/caixa-repository'
import { lancar } from './lancar-action'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarEmbalagem(
  pmo: string, op: string, posto: string,
): Promise<{ ok: true; estado: EstadoEmbalagem } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, estado: await carregarEstadoEmbalagem(pmo.trim(), op.trim(), posto.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o estado da caixa.' }
  }
}

/** Garante a caixa (seq,limite) e lança a peça nela (reusa sf_lancar via lancar). */
export async function embalarPeca(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; seq: number; limite: number; numeroSerie: string
}): Promise<{ ok: true; caixaCount?: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    await garantirCaixa(entrada.pmo.trim(), entrada.op.trim(), entrada.posto.trim(), entrada.seq, entrada.limite)
  } catch {
    return { ok: false, erro: 'Não foi possível abrir a caixa.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto: entrada.posto,
    pmo: entrada.pmo,
    op: entrada.op,
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: marcadorCaixaAberta(entrada.seq),
    qtdPorCaixa: String(entrada.limite),
  })
  if (!r.ok) return r
  return { ok: true, caixaCount: r.caixaCount }
}

export async function fecharCaixa(
  pmo: string, op: string, posto: string, seq: number, ultima: boolean,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const r = await chamarFecharCaixa(pmo.trim(), op.trim(), posto.trim(), seq, ultima)
  if (!r.ok) return { ok: false, erro: r.erro === 'CAIXA_VAZIA' ? 'A caixa está vazia.' : 'Não foi possível fechar a caixa.' }
  return { ok: true, codigo: r.codigo! }
}
```

- [ ] **Step 4: Build + lint + testes** — `npm run build && npm run lint && npm test` → verdes.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts src/modules/shopfloor/infra/caixa-repository.ts src/modules/shopfloor/application/embalagem-actions.ts
git commit -m "feat(shopfloor): backend da Embalagem por caixa (estado, embalar, fechar) + qtd da OP no Lançamento

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — `EmbalagemPanel` + wiring

**Files:**
- Create: `src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx`
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:** Consumes `carregarEmbalagem`, `embalarPeca`, `fecharCaixa`, `useConfirmacao`.

- [ ] **Step 1: Criar `embalagem-panel.tsx`**
```tsx
'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { carregarEmbalagem, embalarPeca, fecharCaixa } from '@/modules/shopfloor/application/embalagem-actions'

export function EmbalagemPanel({
  colaborador, pmo, op, posto, qtdOP,
}: { colaborador: string; pmo: string; op: string; posto: string; qtdOP: number | null }) {
  const [seq, setSeq] = useState(1)
  const [limite, setLimite] = useState<number | null>(null)
  const [limiteInput, setLimiteInput] = useState('')
  const [qtdNaCaixa, setQtdNaCaixa] = useState(0)
  const [totalEmbaladas, setTotalEmbaladas] = useState(0)
  const [ultimasSns, setUltimasSns] = useState<string[]>([])
  const [concluida, setConcluida] = useState(false)
  const [sn, setSn] = useState('')
  const [ehUltima, setEhUltima] = useState(false)
  const [carregando, startCarregar] = useTransition()
  const [embalando, startEmbalar] = useTransition()
  const [fechando, startFechar] = useTransition()
  const snRef = useRef<HTMLInputElement>(null)
  const { confirmar, dialog } = useConfirmacao()

  function recarregar() {
    startCarregar(async () => {
      const r = await carregarEmbalagem(pmo, op, posto)
      if (!r.ok) { toast.error(r.erro); return }
      setSeq(r.estado.seq)
      setLimite(r.estado.limite)
      setQtdNaCaixa(r.estado.qtdNaCaixa)
      setTotalEmbaladas(r.estado.totalEmbaladas)
      setUltimasSns(r.estado.ultimasSns)
      setConcluida(r.estado.concluida)
    })
  }
  useEffect(() => { recarregar() }, [pmo, op, posto]) // recarrega ao entrar / trocar contexto

  function definirLimite() {
    const n = Number(limiteInput)
    if (!Number.isInteger(n) || n <= 0) { toast.error('Informe um limite válido (inteiro > 0).'); return }
    setLimite(n)
    setTimeout(() => snRef.current?.focus(), 0)
  }

  function onBipar() {
    if (sn.trim() === '' || embalando || limite === null) return
    const alvo = sn
    startEmbalar(async () => {
      const r = await embalarPeca({ colaborador, pmo, op, posto, seq, limite, numeroSerie: alvo })
      if (!r.ok) { toast.error(r.erro); snRef.current?.select(); return }
      setSn('')
      setQtdNaCaixa((q) => q + 1)
      setTotalEmbaladas((t) => t + 1)
      setUltimasSns((prev) => [alvo.trim(), ...prev].slice(0, 8))
      setTimeout(() => snRef.current?.focus(), 0)
    })
  }

  async function onFechar() {
    if (fechando || limite === null || qtdNaCaixa === 0) return
    if (qtdNaCaixa < limite) {
      const ok = await confirmar({
        titulo: `Fechar a caixa com ${qtdNaCaixa}/${limite}?`,
        descricao: 'A caixa vai ser fechada antes de atingir o limite.',
        rotuloConfirmar: 'Fechar caixa',
      })
      if (!ok) return
    }
    startFechar(async () => {
      const r = await fecharCaixa(pmo, op, posto, seq, ehUltima)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(`Caixa fechada: ${r.codigo}`)
      if (ehUltima) { setConcluida(true) }
      else { setSeq((s) => s + 1); setQtdNaCaixa(0); setUltimasSns([]); setEhUltima(false); setTimeout(() => snRef.current?.focus(), 0) }
    })
  }

  if (carregando && limite === null && !concluida) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
  }
  if (concluida) {
    return (
      <Card>
        <CardHeader><CardTitle>Embalagem concluída</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Total embaladas: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}.</p>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => { setConcluida(false); recarregar() }}>Continuar embalando</Button>
        </CardContent>
      </Card>
    )
  }
  if (limite === null) {
    return (
      <Card>
        <CardHeader><CardTitle>Embalagem</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="limite">Limite por caixa</Label>
          <div className="flex gap-2">
            <Input id="limite" type="number" min="1" step="1" value={limiteInput}
              onChange={(e) => setLimiteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); definirLimite() } }}
              className="h-11 w-32" autoFocus />
            <Button onClick={definirLimite} className="h-11">Começar</Button>
          </div>
          <p className="text-xs text-muted-foreground">Definido uma vez; vale pras próximas caixas.</p>
        </CardContent>
        {dialog}
      </Card>
    )
  }

  const pct = Math.min(100, Math.round((qtdNaCaixa / limite) * 100))
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Caixa CX{seq} <span className="text-sm font-normal text-muted-foreground">· limite {limite}</span></CardTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={ehUltima} onChange={(e) => setEhUltima(e.target.checked)} /> Última caixa
          </label>
          <Button variant="outline" size="sm" onClick={onFechar} disabled={fechando || qtdNaCaixa === 0}>
            {fechando ? 'Fechando…' : 'Fechar caixa'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{qtdNaCaixa} / {limite} nesta caixa</span>
            <span className="text-muted-foreground">Total: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-enterplak" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_16rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snCaixa">Nº de Série</Label>
            <Input id="snCaixa" ref={snRef} value={sn} onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
              placeholder="Bipe a peça" autoComplete="off" autoFocus className="h-12 text-lg" disabled={embalando} />
          </div>
          <div className="rounded-lg border border-border p-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Últimas nesta caixa</p>
            <ul className="flex flex-col gap-0.5 text-sm">
              {ultimasSns.length === 0 && <li className="text-muted-foreground">—</li>}
              {ultimasSns.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
            </ul>
          </div>
        </div>
      </CardContent>
      {dialog}
    </Card>
  )
}
```

- [ ] **Step 2: `lancamento-form.tsx` — renderizar o painel + limpar Contexto**

Import: `import { EmbalagemPanel } from './embalagem-panel'`.

Remover do Contexto os campos de Embalagem (o bloco `{ehEmbalagem && (<>… Nº da Caixa … Qtd por caixa …</>)}`).

Renderizar o painel ao lado do IntegracaoPanel (perfil caixa), e esconder o card "Peça" quando for Embalagem:
```tsx
{ehEmbalagem && (
  <EmbalagemPanel colaborador={colaborador} pmo={pmo} op={op} posto={posto} qtdOP={ordemSel?.qtd ?? null} />
)}
```
Trocar a condição do card "Peça" para `{!ehIntegracao && !ehEmbalagem && (<Card>…Peça…)}`.

Remover os estados/refs/validações agora órfãos de caixa: `numeroCaixa`/`qtdPorCaixa` (states, o ramo do `valido` que os checava, e o uso em `onEnviar`/mensagem). Conferir que nada mais os referencia (o `sf_lancar`/`lancar` continua recebendo `numeroCaixa` só via `embalarPeca` agora).

- [ ] **Step 3: Build + lint + testes** — `npm run build && npm run lint && npm test` → verdes. Grep: sem referência órfã a `numeroCaixa`/`qtdPorCaixa` no lancamento-form.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx" "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): painel de Embalagem por caixa (auto-numeração, fechar/última, contagem, quadro)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)
1. Selecionar posto de Embalagem → pede **limite**; define (ex.: 10).
2. Bipar peças → contador `X/10`, quadro atualiza, `Total` e `X/total da OP` sobem.
3. Encher a caixa (10/10) → **Fechar caixa** → código `CX[1][10]OP-PMO`, avança pra CX2.
4. Fechar antes do limite (ex.: 7/10) → **confirma**; gera `CX[n][7]…`.
5. Marcar **☐ Última caixa** e fechar → "Embalagem concluída", não avança.
6. **Recarregar a página** no meio → mantém caixa atual, contadores e quadro.
7. Conferir na **grade/registros** que a caixa aparece com o código final.

## Self-Review
- **Cobertura:** §1 migração → T1; §2 domínio → T2; §3 infra/actions → T3; §4 painel/wiring → T4. ✔
- **Sem placeholders:** código completo em cada passo. ✔
- **Tipos consistentes:** `EstadoEmbalagem`/actions (T3) usados idênticos no painel (T4); `gerarCodigoCaixa`/`marcadorCaixaAberta` (T2) usados no RPC (mesma string) e no backend. ✔
- **Perfil, não nome:** Embalagem por `recurso === 'caixa'`. ✔
