# Burn-in com entrada/saída + tempo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Burn-in registra entrada e saída (2 registros), calcula duração, e um painel mostra o que
está "em andamento" com tempo ao vivo.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase (plpgsql RPC + view), Vitest. Spec:
`docs/superpowers/specs/2026-07-24-burnin-entrada-saida-design.md`.

## Global Constraints
- Branch `feat/shopfloor-lancamento`. TS strict. Migração só no **Dev**.
- **Modelo:** entrada = registro `posto='Burn-in'` `status=''`; saída = `status ∈ {Aprovado,Reprovado}`
  (+1 registro por defeito se reprovado). Ciclo aberto = último registro de Burn-in da peça é `status=''`.
  **Sem migração na `sf_registros`.**
- **RPC dedicada `sf_burnin`** (não tocar `sf_lancar`). Lançamento roteia: Burn-in → `sf_burnin`; demais → `sf_lancar`.
- **Regras:** entrada exige posto anterior satisfeito + barra `JA_DENTRO`/`JA_APROVADO`/`SEM_MANUTENCAO`;
  saída exige entrada aberta (`SEM_ENTRADA`) + status (reprovado→defeito). Peça aprovada não re-entra.
- Painel perm `visualizar`. Só informativo (sem tempo-alvo).
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (heredoc).
- Verificação por task: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure
- Create: `src/modules/shopfloor/domain/burnin.ts` + `__tests__/burnin.test.ts`
- Create: `supabase/migrations/0037_sf_burnin.sql` (RPC `sf_burnin` + view `sf_burnin_aberto`)
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (`chamarSfBurnin` + `SfBurninArgs`)
- Modify: `src/modules/shopfloor/application/lancar-action.ts` (roteia Burn-in)
- Modify: `src/app/(app)/shopfloor/lancamento/lancamento-form.tsx` (seletor Entrada/Saída)
- Create: `src/modules/shopfloor/infra/burnin-repository.ts` (`listarBurninAberto`)
- Create: `src/modules/shopfloor/application/burnin-actions.ts` (`carregarBurninAberto`)
- Create: `src/app/(app)/shopfloor/burn-in/page.tsx` + `burnin-painel.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item de menu)
- Modify: `src/modules/shopfloor/domain/grade.ts` (Burn-in aberto → "Em andamento")
- Modify: `src/app/(app)/shopfloor/pesquisa/pesquisa-form.tsx` (duração do Burn-in) — via domínio
- Modify: `docs/regras-de-negocio-shopfloor.md`

---

### Task 1: Domínio `burnin` (TDD)

**Files:** Create `src/modules/shopfloor/domain/burnin.ts` + `__tests__/burnin.test.ts`.

**Interfaces:**
- Produces: `RegistroBurnin`, `CicloBurnin`, `pareaBurnin(registros)`, `estaAberto(ciclos)`, `formatarDuracao(min)`.

- [ ] **Step 1: Teste (falha)** — `__tests__/burnin.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pareaBurnin, estaAberto, formatarDuracao } from '../burnin'

const r = (dataHora: string, status: string) => ({ dataHora, status })

describe('pareaBurnin', () => {
  it('pareia entrada→saída num ciclo com duração em minutos', () => {
    const c = pareaBurnin([r('2026-07-24T08:00:00Z', ''), r('2026-07-24T14:30:00Z', 'Aprovado')])
    expect(c).toHaveLength(1)
    expect(c[0]!.saida).toBe('2026-07-24T14:30:00Z')
    expect(c[0]!.status).toBe('Aprovado')
    expect(c[0]!.duracaoMin).toBe(390)
    expect(estaAberto(c)).toBe(false)
  })
  it('entrada sem saída → ciclo aberto', () => {
    const c = pareaBurnin([r('2026-07-24T09:00:00Z', '')])
    expect(c).toHaveLength(1)
    expect(c[0]!.saida).toBeNull()
    expect(c[0]!.duracaoMin).toBeNull()
    expect(estaAberto(c)).toBe(true)
  })
  it('reprova→re-entrada = 2 ciclos (1 fechado, 1 aberto); saída órfã ignorada', () => {
    const c = pareaBurnin([
      r('2026-07-24T08:00:00Z', ''),
      r('2026-07-24T10:00:00Z', 'Reprovado'),
      r('2026-07-24T10:00:00Z', 'Reprovado'), // 2º defeito, mesmo instante → não abre ciclo
      r('2026-07-24T12:00:00Z', ''),
    ])
    expect(c).toHaveLength(2)
    expect(c[0]!.status).toBe('Reprovado')
    expect(c[1]!.saida).toBeNull()
    expect(estaAberto(c)).toBe(true)
  })
})

describe('formatarDuracao', () => {
  it('minutos → HhMM', () => {
    expect(formatarDuracao(390)).toBe('6h30')
    expect(formatarDuracao(42)).toBe('0h42')
  })
})
```

- [ ] **Step 2: Rodar e falhar** — `npx vitest run src/modules/shopfloor/domain/__tests__/burnin.test.ts`.

- [ ] **Step 3: Implementar** — `src/modules/shopfloor/domain/burnin.ts`:

```ts
export interface RegistroBurnin {
  dataHora: string
  status: string // '' = entrada; 'Aprovado'/'Reprovado' = saída
}

export interface CicloBurnin {
  entrada: string
  saida: string | null
  status: string
  duracaoMin: number | null
}

/** Pareia entrada↔saída em ordem cronológica. Entrada com ciclo aberto e saída órfã são ignoradas. */
export function pareaBurnin(registros: RegistroBurnin[]): CicloBurnin[] {
  const ordenados = [...registros].sort((a, b) => a.dataHora.localeCompare(b.dataHora))
  const ciclos: CicloBurnin[] = []
  let aberto: CicloBurnin | null = null
  for (const reg of ordenados) {
    const ehEntrada = reg.status.trim() === ''
    if (ehEntrada) {
      if (!aberto) {
        aberto = { entrada: reg.dataHora, saida: null, status: '', duracaoMin: null }
        ciclos.push(aberto)
      }
    } else if (aberto) {
      aberto.saida = reg.dataHora
      aberto.status = reg.status
      aberto.duracaoMin = Math.max(0, Math.round((Date.parse(reg.dataHora) - Date.parse(aberto.entrada)) / 60000))
      aberto = null
    }
  }
  return ciclos
}

export function estaAberto(ciclos: CicloBurnin[]): boolean {
  const ultimo = ciclos[ciclos.length - 1]
  return ultimo !== undefined && ultimo.saida === null
}

/** minutos → "6h30". Para tempo decorrido, passe (agora − entrada) em minutos. */
export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${String(m).padStart(2, '0')}`
}
```

- [ ] **Step 4: Passar** — mesmo comando → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(shopfloor): domínio burnin (pareia entrada/saída + duração) TDD`.

---

### Task 2: Migração `0037` — `sf_burnin` + view `sf_burnin_aberto`

**Files:** Create `supabase/migrations/0037_sf_burnin.sql`; Modify `lancamento-repository.ts`.

**Interfaces:**
- Produces: RPC `sf_burnin(...)`; view `sf_burnin_aberto`; `chamarSfBurnin(args)`, `SfBurninArgs`.

- [ ] **Step 1: Migração** — `supabase/migrations/0037_sf_burnin.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — Burn-in com entrada/saída.
-- Entrada = registro posto='Burn-in' status='' ; Saída = status set (+defeitos).
-- Ciclo aberto = último registro de Burn-in da peça é status=''.
-- RPC dedicada (não toca sf_lancar) + view das peças em andamento.
-- =============================================================

create or replace function public.sf_burnin(
  p_evento                text,     -- 'entrada' | 'saida'
  p_pmo                   text,
  p_op                    text,
  p_cliente               text,
  p_colaborador           text,
  p_sn                    text,
  p_sn_norm               text,
  p_status                text,     -- só na saída (Aprovado/Reprovado); '' na entrada
  p_prev_posto            text,
  p_prev_precisa_aprovado boolean,
  p_exige_manutencao      boolean,
  p_linhas                jsonb     -- defeitos na saída reprovado; [] senão
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_ultima_data   timestamptz;
  v_prev_ok       boolean;
  v_tem_reparo    boolean;
  v_linha         jsonb;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- último evento de Burn-in da peça: null=nunca; ''=entrada aberta; Aprovado/Reprovado=fechado
  select status, data_hora into v_ultimo_status, v_ultima_data
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm and posto = 'Burn-in'
  order by data_hora desc
  limit 1;

  if p_evento = 'entrada' then
    if v_ultimo_status is not null and v_ultimo_status = '' then
      return jsonb_build_object('ok', false, 'erro', 'JA_DENTRO');
    end if;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
      return jsonb_build_object('ok', false, 'erro', 'JA_APROVADO');
    end if;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'reprovado' and p_exige_manutencao then
      select exists(
        select 1 from sf_registros m
        where m.pmo = p_pmo and m.op = p_op and m.numero_serie_norm = p_sn_norm
          and m.posto = 'Manutenção' and m.posto_origem = 'Burn-in' and m.data_hora > v_ultima_data
      ) into v_tem_reparo;
      if not v_tem_reparo then
        return jsonb_build_object('ok', false, 'erro', 'SEM_MANUTENCAO');
      end if;
    end if;
    -- trava de sequência (posto anterior)
    if p_prev_posto <> '' then
      if p_prev_precisa_aprovado then
        select exists(select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
            and posto = p_prev_posto and lower(status) = 'aprovado') into v_prev_ok;
      else
        select exists(select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
            and posto = p_prev_posto) into v_prev_ok;
      end if;
      if not v_prev_ok then
        return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA');
      end if;
    end if;
    insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm)
    values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, '', p_sn, p_sn_norm);
    return jsonb_build_object('ok', true, 'evento', 'entrada');

  elsif p_evento = 'saida' then
    if v_ultimo_status is null or v_ultimo_status <> '' then
      return jsonb_build_object('ok', false, 'erro', 'SEM_ENTRADA');
    end if;
    if jsonb_array_length(p_linhas) = 0 then
      insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm)
      values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, p_status, p_sn, p_sn_norm);
    else
      for v_linha in select * from jsonb_array_elements(p_linhas)
      loop
        insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm,
          codigo_defeito, posicao, tipo_defeito)
        values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, p_status, p_sn, p_sn_norm,
          coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''), coalesce(v_linha->>'tipo_defeito', ''));
      end loop;
    end if;
    return jsonb_build_object('ok', true, 'evento', 'saida');

  else
    return jsonb_build_object('ok', false, 'erro', 'EVENTO_INVALIDO');
  end if;
end;
$$;

-- Peças AGORA no Burn-in (último evento é entrada). security_invoker respeita a RLS do caller.
create or replace view public.sf_burnin_aberto
with (security_invoker = true) as
select cliente, pmo, op, numero_serie, numero_serie_norm, data_hora as entrada
from (
  select distinct on (pmo, op, numero_serie_norm)
    cliente, pmo, op, numero_serie, numero_serie_norm, data_hora, status
  from public.sf_registros
  where posto = 'Burn-in'
  order by pmo, op, numero_serie_norm, data_hora desc
) ultimo
where ultimo.status = '';

grant select on public.sf_burnin_aberto to authenticated;
```

- [ ] **Step 2: Aplicar no Dev** — `SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" supabase db push` (só `0037`; warning de Docker é esperado).

- [ ] **Step 3: Repo** — em `lancamento-repository.ts`, adicionar:

```ts
export interface SfBurninArgs {
  p_evento: 'entrada' | 'saida'
  p_pmo: string
  p_op: string
  p_cliente: string
  p_colaborador: string
  p_sn: string
  p_sn_norm: string
  p_status: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_exige_manutencao: boolean
  p_linhas: { codigo_defeito: string; posicao: string; tipo_defeito: string }[]
}

export async function chamarSfBurnin(
  args: SfBurninArgs,
): Promise<{ ok: boolean; erro?: string; evento?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_burnin', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; evento?: string }
}
```

- [ ] **Step 4: Smoke no Dev** (script em arquivo, lê `.env.local`): confirmar que `sf_burnin` resolve
  (chamada com service-role deve devolver `SEM_PERMISSAO` — auth.uid nulo — provando que existe e não
  quebrou); e que a view `sf_burnin_aberto` existe e é consultável (0 linhas ok). Registrar no report.

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit`. Commit `feat(shopfloor): migração 0037 — sf_burnin (entrada/saída) + view sf_burnin_aberto`.

---

### Task 3: Lançamento — roteia Burn-in (action + form)

**Files:** Modify `lancar-action.ts`, `lancamento-form.tsx`.

**Interfaces:** Consumes `chamarSfBurnin` (Task 2). `EntradaLancamento` += `burninEvento?: 'entrada' | 'saida'`.

**Contexto:** o form tem `comStatus = postoTemStatus(posto)`, `ehNqa`, `ehSpi`, `ehEmbalagem`,
`reprovado`, `status`, `posicoesSPI`, `defeitosSel`; `OPCOES_STATUS=['Aprovado','Reprovado']`; o submit
chama `lancar({...})`. **Leia o arquivo atual antes de editar** — os números de linha abaixo são guia.

- [ ] **Step 1: Action** — em `lancar-action.ts`:
  - `EntradaLancamento` += `burninEvento?: 'entrada' | 'saida'`.
  - `MENSAGENS` += `JA_DENTRO: 'Esta peça já está no Burn-in (entrada aberta).'`,
    `JA_APROVADO: 'Esta peça já concluiu o Burn-in aprovada.'`,
    `SEM_ENTRADA: 'Não há entrada de Burn-in aberta para esta peça — registre a entrada primeiro.'`.
  - `import { chamarSfLancar, chamarSfBurnin, carregarOrdem } from '../infra/lancamento-repository'`.
  - Depois de calcular `ordem`, `aplicavel`, `prevPosto` (mantém a faixa de SN e o posto-aplicável), e
    ANTES do bloco NQA/`chamarSfLancar`, tratar Burn-in:

```ts
  const ehBurnin = entrada.posto.toLowerCase() === 'burn-in'
  if (ehBurnin) {
    const evento = entrada.burninEvento === 'saida' ? 'saida' : 'entrada'
    if (evento === 'saida') {
      const st = (entrada.status ?? '').trim()
      if (st !== 'Aprovado' && st !== 'Reprovado') {
        return { ok: false, erro: 'Informe Aprovado ou Reprovado na saída do Burn-in.' }
      }
    }
    const linhasBurn =
      entrada.burninEvento === 'saida'
        ? montarLinhas(entrada.posto, { status: entrada.status ?? '', defeitos: entrada.defeitos })
        : []
    const rb = await chamarSfBurnin({
      p_evento: evento,
      p_pmo: entrada.pmo,
      p_op: entrada.op,
      p_cliente: ordem.cliente,
      p_colaborador: entrada.colaborador.trim(),
      p_sn: limparSerie(entrada.numeroSerie),
      p_sn_norm: normalizarSerie(entrada.numeroSerie),
      p_status: evento === 'saida' ? (entrada.status ?? '') : '',
      p_prev_posto: prevPosto ?? '',
      p_prev_precisa_aprovado: prevPosto ? precisaAprovado(prevPosto) : false,
      p_exige_manutencao: exigeManutencao(entrada.posto),
      p_linhas: linhasBurn,
    })
    if (!rb.ok) return { ok: false, erro: MENSAGENS[rb.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }
    return { ok: true }
  }
```

  - **Obrigatórios**: hoje `obrigatoriosPorPosto` exige status pra Burn-in (é com-status). Antes dessa
    validação, para Burn-in tratar à parte: entrada exige só colaborador/pmo/op/SN; saída exige status
    (e defeito se reprovado). Concretamente, pular `obrigatoriosPorPosto` quando `ehBurnin` e validar:
    ```ts
    if (ehBurnin) {
      if (entrada.colaborador.trim()==='' || entrada.pmo.trim()==='' || entrada.op.trim()==='' || entrada.numeroSerie.trim()==='') {
        return { ok: false, erro: 'Preencha Colaborador, PMO, OP e o Nº de Série.' }
      }
      if (entrada.burninEvento === 'saida') {
        const reprov = (entrada.status ?? '').toLowerCase() === 'reprovado'
        if (reprov && !(entrada.defeitos?.[0]?.codigo && entrada.defeitos[0].posicao && entrada.defeitos[0].tipo)) {
          return { ok: false, erro: 'Reprovado exige código, posição e tipo do defeito.' }
        }
      }
    } else {
      const val = obrigatoriosPorPosto(...) // como hoje
      if (!val.ok) return { ok: false, erro: val.erro }
    }
    ```
    (Coloque o `ehBurnin` calculado antes desse ponto.)

- [ ] **Step 2: Form** — em `lancamento-form.tsx`:
  - Estado: `const [burninEvento, setBurninEvento] = useState<'entrada' | 'saida'>('entrada')`.
  - `const ehBurnin = posto === 'Burn-in'`. Em `resetCamposDinamicos`/`mudarPosto`, resetar `burninEvento='entrada'`.
  - Mostrar o seletor quando `ehBurnin` (antes do bloco de status): dois botões/`Select` Entrada/Saída
    (use um `Select` com value=burninEvento e itens `entrada`/`saida`, rótulos "Entrada"/"Saída").
  - O bloco de status (linha ~230 `comStatus && !ehNqa`) e os de defeitos (linha ~283) devem aparecer
    para Burn-in **só quando** `burninEvento === 'saida'`. Ajuste as condições: onde hoje é
    `comStatus && !ehNqa && ...`, para Burn-in acrescente `&& (!ehBurnin || burninEvento === 'saida')`.
  - `podeEnviar` (linha ~96): para Burn-in entrada, não exigir status; para saída, exigir status (+ defeito
    se reprovado) como um com-status normal. Ex.: a linha `if (comStatus && !ehNqa && status === '') return false`
    passa a `if (comStatus && !ehNqa && (!ehBurnin || burninEvento === 'saida') && status === '') return false`,
    e idem para o bloco de reprovado.
  - Submit (linha ~117): passar `burninEvento: ehBurnin ? burninEvento : undefined`, e `status` só quando
    `(!ehBurnin || burninEvento === 'saida')`.

- [ ] **Step 3: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`. Commit
  `feat(shopfloor): Lançamento roteia Burn-in (entrada/saída) para sf_burnin`.

---

### Task 4: Painel "Burn-in em andamento"

**Files:** Create `burnin-repository.ts`, `burnin-actions.ts`, `burn-in/page.tsx`, `burn-in/burnin-painel.tsx`; Modify `app-shell.tsx`.

- [ ] **Step 1: Repo** — `src/modules/shopfloor/infra/burnin-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface BurninAberto {
  cliente: string
  pmo: string
  op: string
  numeroSerie: string
  entrada: string // ISO
}

/** Peças agora no Burn-in (entrada aberta), mais antigas primeiro. */
export async function listarBurninAberto(): Promise<BurninAberto[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_burnin_aberto')
    .select('cliente,pmo,op,numero_serie,entrada')
    .order('entrada', { ascending: true })
  if (error) throw error
  return (data as { cliente: string; pmo: string; op: string; numero_serie: string; entrada: string }[]).map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    numeroSerie: r.numero_serie,
    entrada: r.entrada,
  }))
}
```

- [ ] **Step 2: Action** — `src/modules/shopfloor/application/burnin-actions.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { listarBurninAberto, type BurninAberto } from '../infra/burnin-repository'

export async function carregarBurninAberto(): Promise<{ ok: true; itens: BurninAberto[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o painel.' }
  }
  try {
    return { ok: true, itens: await listarBurninAberto() }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o painel.' }
  }
}
```

- [ ] **Step 3: Página** — `src/app/(app)/shopfloor/burn-in/page.tsx` (guard `visualizar`, mesmo esqueleto
  da page da Pesquisa; carrega `listarBurninAberto` e renderiza `<BurninPainel itens={itens} />`).

- [ ] **Step 4: Painel (client, relógio ao vivo)** — `src/app/(app)/shopfloor/burn-in/burnin-painel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import type { BurninAberto } from '@/modules/shopfloor/infra/burnin-repository'

export function BurninPainel({ itens }: { itens: BurninAberto[] }) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{itens.length} peça(s) em Burn-in agora</p>
      <Table containerClassName="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>PMO/OP</TableHead>
            <TableHead>Nº de Série</TableHead>
            <TableHead>Entrada</TableHead>
            <TableHead className="text-right">Há quanto tempo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((it) => {
            const min = Math.max(0, Math.round((agora - Date.parse(it.entrada)) / 60000))
            return (
              <TableRow key={`${it.pmo}/${it.op}/${it.numeroSerie}`}>
                <TableCell>{it.cliente}</TableCell>
                <TableCell>{it.pmo}/{it.op}</TableCell>
                <TableCell className="font-medium">{it.numeroSerie}</TableCell>
                <TableCell>{new Date(it.entrada).toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-right tabular-nums">há {formatarDuracao(min)}</TableCell>
              </TableRow>
            )
          })}
          {itens.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma peça em Burn-in no momento.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 5: Menu** — em `app-shell.tsx`, na seção SHOPFLOOR ("Fluxo de Processos"), adicionar item
  `burn-in` (rótulo "Burn-in", ícone lucide `Timer` ou `Clock`, href `/shopfloor/burn-in`, perm
  `visualizar`) — logo após `manutencao` ou perto do `dashboard`. Ler o arquivo p/ casar o formato dos itens.

- [ ] **Step 6: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`. Commit
  `feat(shopfloor): painel "Burn-in em andamento" (tempo ao vivo)`.

---

### Task 5: Pesquisa (duração) + Grade ("Em andamento") + regras

**Files:** Modify `grade.ts`, `pesquisa-form.tsx`, `docs/regras-de-negocio-shopfloor.md`.

- [ ] **Step 1: Grade** — em `domain/grade.ts` (`montarGrade`), para o posto **Burn-in**: se os registros
  da peça no Burn-in têm um **ciclo aberto** (via `pareaBurnin` + `estaAberto`), a célula vira
  **'Em andamento'**; senão segue a regra com-status (Aprovado vence Reprovado). Ler o `montarGrade`
  atual e inserir o ramo Burn-in antes do cálculo com-status. Adicionar 'Em andamento' às cores
  (`corCelula`) com um tom neutro/aviso.

- [ ] **Step 2: Pesquisa** — em `pesquisa-form.tsx`, ao montar a linha do tempo, para os registros de
  Burn-in agrupar por ciclo (via `pareaBurnin`) e exibir a **duração** (`formatarDuracao`) na linha da
  saída, ou "há X" se aberto. Mínimo aceitável: uma coluna/《badge》 "Duração" que aparece nos eventos de
  Burn-in. (Ler o render atual da tabela de histórico; manter simples.)

- [ ] **Step 3: Regras** — em `docs/regras-de-negocio-shopfloor.md`:
  - Nova subseção/《regra》**Burn-in (entrada/saída)**: modelo (2 registros, status distingue), regras
    (entrada exige anterior + `JA_DENTRO`/`JA_APROVADO`/`SEM_MANUTENCAO`; saída exige entrada aberta
    `SEM_ENTRADA` + status; posto seguinte exige saída Aprovado), painel em andamento, duração no
    histórico, RPC `sf_burnin`/view `sf_burnin_aberto` (migração `0037`), domínio `burnin.ts`. Só informativo.
  - Atualizar o **catálogo de postos** (Burn-in deixa de ser um "com status" simples — vira entrada/saída).
  - Remover do backlog o item "Burn-in com entrada/saída + duração" (entregue).

- [ ] **Step 4: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`. Commit
  `feat(shopfloor): Grade "Em andamento" + duração na Pesquisa + regras do Burn-in`.

---

### Task 6 (controller): suíte + review amplo + smoke no Dev + push
- `npx tsc --noEmit && npm run lint && npm run test`.
- Smoke Dev (script em arquivo): via REST inserir manualmente uma entrada de Burn-in (posto='Burn-in',
  status='') numa OP de teste e conferir que a view `sf_burnin_aberto` lista a peça; inserir a saída
  (status='Aprovado') e conferir que sai da view. Limpar os registros de teste ao fim. (A regra de gate
  ponta-a-ponta prova-se no teste visual — service-role dá SEM_PERMISSAO no RPC.)
- Review amplo (opus) desde a base da feature.
- Push da branch pro preview.

## Self-Review
- Spec coberta: domínio (T1), RPC+view (T2), Lançamento roteando (T3), painel ao vivo (T4), grade+pesquisa+regras (T5).
- Sem migração na `sf_registros`; `sf_lancar` intacto (RPC nova). Gate seguinte funciona pelo status 'Aprovado' da saída.
- Tipos: `SfBurninArgs`/`BurninAberto` fluindo; `burninEvento` em EntradaLancamento e no form.
