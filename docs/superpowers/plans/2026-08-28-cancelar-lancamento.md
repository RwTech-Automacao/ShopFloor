# Cancelar lançamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o gestor cancele um bipe errado na tela de Registros — o bipe é movido pra uma tabela de auditoria e removido de `sf_registros`, fazendo a peça "voltar um posto" automático em todas as telas.

**Architecture:** Nova tabela `sf_registros_cancelados` + RPC `sf_cancelar_lancamento` (SECURITY DEFINER) que valida permissão/LIFO/escopo e move a linha. Uma action de checagem (`cancelavelInfo`) alimenta o botão (habilita/desabilita) e uma action `cancelarLancamento` executa. UI no painel de detalhe da tela de Registros, só pra quem tem `administrar`.

**Tech Stack:** Next.js 16 (App Router, Server Actions) + React 19 + Supabase (Postgres, RPC SECURITY DEFINER, RLS via `tem_permissao`) + Vitest.

## Global Constraints

- **Next.js modificado:** antes de escrever código Next, ler o guia relevante em `node_modules/next/dist/docs/`. (AGENTS.md)
- **Migração `0087`** (número escolhido acima de tudo em voo — maior em qualquer branch é 0086). Aplicar no Dev via `supabase db push`/SQL Editor é passo do **controller/usuário**; NÃO em Prod pelo subagente.
- **Permissão:** só `administrar`. Botão só aparece pra quem tem; a RPC **re-checa** no servidor (`tem_permissao('administrar')`).
- **LIFO:** só o **último bipe** (maior `(data_hora, id)`) de `(pmo, op, numero_serie_norm)` pode ser cancelado. Validação **autoritativa no servidor** (a checagem da UI é só conveniência).
- **Motivo OBRIGATÓRIO:** vazio → recusa (`MOTIVO_OBRIGATORIO`); o Confirmar da UI fica travado sem motivo.
- **Escopo de posto:** bloquear se `recurso in ('caixa','nqa','integracao')` (Embalagem/NQA-caixa/Integração). `recurso` nulo/desconhecido = permitido.
- **Não mexer** no fluxo de Lançamento, nos outros telas nem no cancelar de Integração existente.
- Ao final: `npm run lint` + `npx tsc --noEmit` + `npm run build` verdes; testes de unidade verdes.

---

### Task 1: Migração 0087 — `sf_registros_cancelados` + `sf_cancelar_lancamento` + RLS

**Files:**
- Create: `supabase/migrations/0087_sf_registros_cancelados.sql`

**Interfaces:**
- Produces (SQL): tabela `public.sf_registros_cancelados`; função `public.sf_cancelar_lancamento(p_id uuid, p_motivo text) returns void`.
- Consumed por: Task 3 (infra).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0087_sf_registros_cancelados.sql`:

```sql
-- 0087_sf_registros_cancelados.sql
-- Cancelar lançamento: move um bipe errado pra auditoria e remove de sf_registros.
-- LIFO (só o último bipe do SN), gestor-only, motivo obrigatório. Aditiva.

create table if not exists public.sf_registros_cancelados (
  id                uuid primary key default gen_random_uuid(),
  id_original       uuid not null,
  pmo               text not null,
  op                text not null,
  numero_serie_norm text not null,
  posto             text not null,
  dados             jsonb not null,   -- a linha original inteira (to_jsonb)
  motivo            text not null,
  cancelado_por     uuid,             -- auth.uid()
  cancelado_em      timestamptz not null default now()
);
create index if not exists sf_registros_cancelados_sn
  on public.sf_registros_cancelados (pmo, op, numero_serie_norm);

alter table public.sf_registros_cancelados enable row level security;
create policy sf_registros_cancelados_select
  on public.sf_registros_cancelados for select using (tem_permissao('visualizar'));
-- Escrita só via sf_cancelar_lancamento (security definer). Sem policy de insert/delete.

create or replace function public.sf_cancelar_lancamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pmo text; v_op text; v_snnorm text; v_posto text;
  v_recurso text; v_ultimo uuid;
begin
  if not tem_permissao('administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, numero_serie_norm, posto
    into v_pmo, v_op, v_snnorm, v_posto
  from public.sf_registros
  where id = p_id;
  if not found then
    raise exception 'NAO_ENCONTRADO';
  end if;

  -- Serializa com o lançamento da mesma OP (o "último bipe" não muda no meio da checagem).
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Escopo: bloqueia postos com efeito colateral em outra tabela (recurso nulo = permitido).
  select p.recurso into v_recurso
  from public.sf_postos po
  join public.sf_posto_perfis p on p.chave = po.perfil
  where po.chave = v_posto;
  if v_recurso in ('caixa', 'nqa', 'integracao') then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- LIFO: só o bipe mais recente do SN nesta OP.
  select id into v_ultimo
  from public.sf_registros
  where pmo = v_pmo and op = v_op and numero_serie_norm = v_snnorm
  order by data_hora desc, id desc
  limit 1;
  if v_ultimo is distinct from p_id then
    raise exception 'NAO_E_ULTIMO';
  end if;

  -- Move: guarda a linha inteira na auditoria e apaga da tabela viva.
  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select id, pmo, op, numero_serie_norm, posto, to_jsonb(r), p_motivo, auth.uid()
  from public.sf_registros r
  where id = p_id;

  delete from public.sf_registros where id = p_id;
end
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0087_sf_registros_cancelados.sql
git commit -m "feat(shopfloor): migração 0087 — sf_registros_cancelados + sf_cancelar_lancamento (LIFO, gestor)"
```

> **NÃO** rodar `supabase db push` nem aplicar em nenhum banco — o controller aplica no Dev separadamente.
> Antes do commit, reler o SQL e conferir: gate `administrar` → motivo → lê a linha → advisory lock →
> escopo (`recurso in caixa/nqa/integracao`) → LIFO (`is distinct from`) → insert `to_jsonb(r)` → delete.

---

### Task 2: Domínio — `postoCancelavel` (escopo puro)

**Files:**
- Create: `src/modules/shopfloor/domain/cancelamento.ts`
- Test: `src/modules/shopfloor/domain/__tests__/cancelamento.test.ts`

**Interfaces:**
- Produces: `postoCancelavel(recurso: string | null | undefined): boolean` — false para `'caixa'|'nqa'|'integracao'`, true pro resto (inclusive nulo/`'nenhum'`/`'burnin'`).
- Consumed por: Task 4 (`cancelavelInfo`).

- [ ] **Step 1: Escrever o teste (falhando)**

Criar `src/modules/shopfloor/domain/__tests__/cancelamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { postoCancelavel } from '../cancelamento'

describe('postoCancelavel', () => {
  it('bloqueia postos com efeito colateral', () => {
    expect(postoCancelavel('caixa')).toBe(false)
    expect(postoCancelavel('nqa')).toBe(false)
    expect(postoCancelavel('integracao')).toBe(false)
  })
  it('permite postos que só vivem em sf_registros', () => {
    expect(postoCancelavel('nenhum')).toBe(true)
    expect(postoCancelavel('burnin')).toBe(true)
  })
  it('permite quando o recurso é desconhecido/nulo', () => {
    expect(postoCancelavel(null)).toBe(true)
    expect(postoCancelavel(undefined)).toBe(true)
    expect(postoCancelavel('')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/cancelamento.test.ts`
Expected: FALHA (função não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/shopfloor/domain/cancelamento.ts`:

```ts
/** Postos com efeito colateral em OUTRA tabela — não são canceláveis na v1. */
const RECURSOS_BLOQUEADOS: readonly string[] = ['caixa', 'nqa', 'integracao']

/** O posto (pelo recurso do seu perfil) pode ter um bipe cancelado? Nulo/desconhecido = pode. */
export function postoCancelavel(recurso: string | null | undefined): boolean {
  return !RECURSOS_BLOQUEADOS.includes((recurso ?? '').trim())
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/cancelamento.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/cancelamento.ts src/modules/shopfloor/domain/__tests__/cancelamento.test.ts
git commit -m "feat(shopfloor): domínio postoCancelavel (escopo do cancelar lançamento)"
```

---

### Task 3: Infra — `cancelamento-repository.ts`

**Files:**
- Create: `src/modules/shopfloor/infra/cancelamento-repository.ts`

**Interfaces:**
- Consumes: `createServerSupabase`; a RPC `sf_cancelar_lancamento` (Task 1).
- Produces:
  - `lerRegistroParaCancelar(id: string): Promise<{ pmo: string; op: string; numeroSerieNorm: string; posto: string } | null>`
  - `ehUltimoBipe(pmo: string, op: string, numeroSerieNorm: string, id: string): Promise<boolean>`
  - `chamarSfCancelar(id: string, motivo: string): Promise<{ ok: true } | { ok: false; erro: string }>` (erro = a mensagem crua da exceção da RPC, ex.: `NAO_E_ULTIMO`).

- [ ] **Step 1: Escrever o repositório**

Criar `src/modules/shopfloor/infra/cancelamento-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export async function lerRegistroParaCancelar(
  id: string,
): Promise<{ pmo: string; op: string; numeroSerieNorm: string; posto: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('pmo,op,numero_serie_norm,posto')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as { pmo: string; op: string; numero_serie_norm: string; posto: string }
  return { pmo: r.pmo, op: r.op, numeroSerieNorm: r.numero_serie_norm, posto: r.posto }
}

/** É o bipe mais recente (maior data_hora, depois id) do SN nesta OP? */
export async function ehUltimoBipe(
  pmo: string, op: string, numeroSerieNorm: string, id: string,
): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('id')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', numeroSerieNorm)
    .order('data_hora', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw error
  const ultimo = (data ?? [])[0] as { id: string } | undefined
  return ultimo?.id === id
}

export async function chamarSfCancelar(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('sf_cancelar_lancamento', { p_id: id, p_motivo: motivo })
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/cancelamento-repository.ts
git commit -m "feat(shopfloor): infra do cancelamento (ler/último-bipe/chamar RPC)"
```

---

### Task 4: Application — `cancelavelInfo` + `cancelarLancamento`

**Files:**
- Create: `src/modules/shopfloor/application/cancelamento-actions.ts`

**Interfaces:**
- Consumes: `getSessao`; `podeNoModulo`; `postoCancelavel` (Task 2); `lerRegistroParaCancelar`, `ehUltimoBipe`, `chamarSfCancelar` (Task 3); `mapaPostoPerfil` (`../infra/postos-repository`).
- Produces:
  - `cancelavelInfo(id: string): Promise<{ podeCancelar: boolean; motivo?: string }>`
  - `cancelarLancamento(id: string, motivo: string): Promise<{ ok: true } | { ok: false; erro: string }>`
- Consumed por: Task 5 (UI).

- [ ] **Step 1: Escrever as actions**

Criar `src/modules/shopfloor/application/cancelamento-actions.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { postoCancelavel } from '../domain/cancelamento'
import { lerRegistroParaCancelar, ehUltimoBipe, chamarSfCancelar } from '../infra/cancelamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

const SEM_PERMISSAO = 'Você não tem permissão para cancelar.'

/** Checagem pro botão (UX): dá pra cancelar este bipe? Fail-closed. */
export async function cancelavelInfo(id: string): Promise<{ podeCancelar: boolean; motivo?: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { podeCancelar: false, motivo: 'Sem permissão para cancelar.' }
  }
  try {
    const reg = await lerRegistroParaCancelar(id)
    if (!reg) return { podeCancelar: false, motivo: 'Registro não encontrado.' }
    const perfil = (await mapaPostoPerfil())[reg.posto]
    if (!postoCancelavel(perfil?.recurso)) {
      return { podeCancelar: false, motivo: 'Este posto não pode ser cancelado por aqui.' }
    }
    if (!(await ehUltimoBipe(reg.pmo, reg.op, reg.numeroSerieNorm, id))) {
      return { podeCancelar: false, motivo: 'Só o bipe mais recente deste SN pode ser cancelado — cancele o mais recente primeiro.' }
    }
    return { podeCancelar: true }
  } catch {
    return { podeCancelar: false, motivo: 'Não foi possível verificar.' }
  }
}

/** Executa o cancelamento (gestor). Motivo obrigatório. */
export async function cancelarLancamento(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (motivo.trim() === '') return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  const r = await chamarSfCancelar(id, motivo.trim())
  if (r.ok) return { ok: true }
  const msg = r.erro
  if (msg.includes('NAO_E_ULTIMO')) return { ok: false, erro: 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.' }
  if (msg.includes('POSTO_NAO_CANCELAVEL')) return { ok: false, erro: 'Este posto não pode ser cancelado por aqui.' }
  if (msg.includes('MOTIVO_OBRIGATORIO')) return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  if (msg.includes('SEM_PERMISSAO')) return { ok: false, erro: SEM_PERMISSAO }
  if (msg.includes('NAO_ENCONTRADO')) return { ok: false, erro: 'Registro não encontrado (talvez já cancelado).' }
  return { ok: false, erro: 'Não foi possível cancelar o lançamento.' }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. (Confirma que `PerfilPosto` tem `recurso` — tem; usado em vários lugares.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/application/cancelamento-actions.ts
git commit -m "feat(shopfloor): actions cancelavelInfo + cancelarLancamento"
```

---

### Task 5: UI — botão Cancelar no detalhe da tela de Registros

**Files:**
- Modify: `src/app/(app)/shopfloor/registros/page.tsx`
- Modify: `src/app/(app)/shopfloor/registros/registros-tabela.tsx`

**Interfaces:**
- Consumes: `cancelavelInfo`, `cancelarLancamento` (Task 4); `podeNoModulo`; `useRouter` (`next/navigation`); `useConfirmacao` NÃO (usa um Dialog próprio com o campo motivo).

- [ ] **Step 1: Passar `podeAdministrar` da page**

Em `src/app/(app)/shopfloor/registros/page.tsx`, após o gate de sessão (já tem `sessao`), calcular e repassar:

```tsx
  const podeAdministrar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')
```

e trocar a renderização da tabela por:

```tsx
      <RegistrosTabela linhas={linhas} podeAdministrar={podeAdministrar} />
```

- [ ] **Step 2: Adicionar o cancelar à tabela**

Em `src/app/(app)/shopfloor/registros/registros-tabela.tsx`:

(a) Imports novos no topo:
```tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DialogFooter } from '@/components/ui/dialog'
import { cancelavelInfo, cancelarLancamento } from '@/modules/shopfloor/application/cancelamento-actions'
```
(mantém os imports de Dialog/Table/Badge já existentes; `useState` já é importado — ajuste a linha do `react` para incluir `useEffect`.)

(b) Trocar a assinatura + adicionar estado/efeito/handler dentro do componente:
```tsx
interface RegistrosTabelaProps {
  linhas: RegistroRow[]
  podeAdministrar: boolean
}

export function RegistrosTabela({ linhas, podeAdministrar }: RegistrosTabelaProps) {
  const [sel, setSel] = useState<RegistroRow | null>(null)
  const [checando, setChecando] = useState(false)
  const [cancelavel, setCancelavel] = useState<{ podeCancelar: boolean; motivo?: string } | null>(null)
  const [confirmAberto, setConfirmAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [erroCancel, setErroCancel] = useState('')
  const router = useRouter()

  // Ao abrir o detalhe de um registro (e sendo gestor), checa no servidor se dá pra cancelar.
  useEffect(() => {
    if (!sel || !podeAdministrar) { setCancelavel(null); return }
    let vivo = true
    setChecando(true)
    setCancelavel(null)
    cancelavelInfo(sel.id)
      .then((r) => { if (vivo) setCancelavel(r) })
      .catch(() => { if (vivo) setCancelavel({ podeCancelar: false, motivo: 'Não foi possível verificar.' }) })
      .finally(() => { if (vivo) setChecando(false) })
    return () => { vivo = false }
  }, [sel, podeAdministrar])

  function abrirConfirm() {
    setMotivo(''); setErroCancel(''); setConfirmAberto(true)
  }
  async function confirmarCancelamento() {
    if (!sel || motivo.trim() === '' || cancelando) return
    setCancelando(true); setErroCancel('')
    const r = await cancelarLancamento(sel.id, motivo)
    setCancelando(false)
    if (r.ok) {
      setConfirmAberto(false); setSel(null)
      router.refresh() // re-busca a lista (o bipe some)
    } else {
      setErroCancel(r.erro)
    }
  }
```

(c) Dentro do `<DialogContent>` do detalhe, DEPOIS do `</dl>` (ainda dentro do `{sel && ( … )}`), adicionar a seção do gestor:
```tsx
              {podeAdministrar && (
                <div className="mt-4 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    disabled={checando || !cancelavel?.podeCancelar}
                    onClick={abrirConfirm}
                  >
                    {checando ? 'Verificando…' : 'Cancelar lançamento'}
                  </Button>
                  {!checando && cancelavel && !cancelavel.podeCancelar && cancelavel.motivo && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{cancelavel.motivo}</p>
                  )}
                </div>
              )}
```

(d) Adicionar um segundo `<Dialog>` (irmão do de detalhe, ainda dentro do `<>...</>`) pra confirmação com motivo obrigatório:
```tsx
      <Dialog open={confirmAberto} onOpenChange={(o) => { if (!o && !cancelando) setConfirmAberto(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar lançamento</DialogTitle>
          </DialogHeader>
          {sel && (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                Vai cancelar o bipe <strong>{sel.numero_serie}</strong> em <strong>{sel.posto}</strong>{' '}
                (<strong>{rotuloStatus(sel.status)}</strong>) de {formatarDataHora(sel.data_hora)}. O bipe
                é removido e a peça volta ao posto anterior. Esta ação fica registrada na auditoria.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="motivo-cancel">Motivo (obrigatório)</Label>
                <Input id="motivo-cancel" value={motivo} autoFocus
                  onChange={(e) => { setMotivo(e.target.value); if (erroCancel) setErroCancel('') }}
                  placeholder="Ex.: aprovado por engano" />
              </div>
              {erroCancel && <p className="text-sm text-red-600">{erroCancel}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={cancelando} onClick={() => setConfirmAberto(false)}>Voltar</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700"
              disabled={cancelando || motivo.trim() === ''}
              onClick={confirmarCancelamento}>
              {cancelando ? 'Cancelando…' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros novos deste arquivo. (Se `DialogFooter` não existir no módulo de dialog, usar um `<div className="flex justify-end gap-2">` no lugar — conferir `src/components/ui/dialog.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/shopfloor/registros/page.tsx" "src/app/(app)/shopfloor/registros/registros-tabela.tsx"
git commit -m "feat(shopfloor): botão Cancelar lançamento no detalhe de Registros (gestor, checado, motivo)"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- `sf_registros_cancelados` + RPC + RLS → Task 1. ✅
- LIFO + escopo + gate + motivo no servidor → Task 1 (RPC). ✅
- `postoCancelavel` (escopo) → Task 2. ✅
- Infra (ler/último-bipe/RPC) → Task 3. ✅
- `cancelavelInfo` (checagem) + `cancelarLancamento` (executa) → Task 4. ✅
- Botão gestor-only + checagem ao abrir + diálogo com motivo obrigatório + refresh → Task 5. ✅
- Fora de escopo (Embalagem/NQA/Integração/desfazer/Pesquisa) → não implementados. ✅

**Placeholder scan:** sem TBD/TODO; todo passo tem código/comando concretos.

**Type consistency:** `postoCancelavel(recurso)` (Task 2) usado em `cancelavelInfo` (Task 4); `lerRegistroParaCancelar`/`ehUltimoBipe`/`chamarSfCancelar` (Task 3) casam com o uso na Task 4; `cancelavelInfo`/`cancelarLancamento` (Task 4) casam com a UI (Task 5); `podeAdministrar` fluindo page→tabela; `RegistroRow` já tem `id`/`pmo`/`op`/`posto`/`numero_serie`/`status`.

**Nota:** Task 5 depende de 4 (actions) que depende de 3 (infra) e 2 (domínio); Task 1 (RPC) é consumida por 3. Executar em ordem.
