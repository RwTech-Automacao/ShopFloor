# Lote entre postos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rastrear um painel físico lançado junto como um lote (`lote_id` interno) e, nos postos coletivos seguintes, pré-listar as peças irmãs ainda pendentes como checklist — sem mudar o gesto de bipe.

**Architecture:** Nova tabela `sf_lotes` (mapa SN→lote_id por OP) preenchida por uma RPC `security definer` no envio coletivo. No consumo, uma action lê o lote de um SN-âncora e cruza com a derivação de "pendente neste posto" que já existe na tela de Fluxo (`postoPendenteDePeca`). A tela ganha um estado "pendente" no lote (placeholder) que o bipe substitui ao resolver.

**Tech Stack:** Next.js 16 (App Router, Server Actions) + React 19 + Supabase (Postgres, RPC `security definer`, RLS via `tem_permissao`) + Tailwind v4 + Vitest.

## Global Constraints

- **Next.js modificado:** este projeto usa um Next.js com breaking changes. Antes de escrever código Next, ler o guia relevante em `node_modules/next/dist/docs/`. (AGENTS.md)
- **Migração:** a próxima livre NESTA branch é `0086` (última é `0085`; gaps 0079/0082/0083/0084 vivem em outras branches). Aplicar no Dev via `supabase db push` (precisa do binário supabase-go + `SUPABASE_GO_BINARY` — ver `docs`/memória do projeto). NÃO aplicar em Prod.
- **`lote_id` é INTERNO** — nunca renderizado na UI.
- **Gesto de bipe 100% inalterado** — os modais `AprovarModal`/`ReprovarModal` e os handlers `onAcao`/`gravarAprovado`/`gravarReprovado`/`onEnviar` NÃO mudam de comportamento. A única mudança de UI é a lista do lote (checklist).
- **Fallback:** sem `sf_lotes`/sem lote → comportamento do Lançamento Coletivo v1 idêntico. Nunca quebrar o v1.
- **Normalização de SN:** feita em TS via `normalizarSerie` (não há função SQL de normalização). A RPC recebe SNs já normalizados.
- **Gate de permissão:** escrita = `tem_permissao('lancar')`; leitura = `tem_permissao('visualizar')` (padrão dos outros `sf_*`).
- Ao final: `npm run lint` + `npx tsc --noEmit` + `npm run build` verdes; testes de unidade verdes.

---

### Task 1: Migração 0086 — `sf_lotes` + `sf_criar_lote` + RLS

**Files:**
- Create: `supabase/migrations/0086_sf_lotes.sql`

**Interfaces:**
- Produces (SQL): tabela `public.sf_lotes(pmo, op, numero_serie, numero_serie_norm, lote_id, criado_em)`; função `public.sf_criar_lote(p_pmo text, p_op text, p_sns text[], p_sns_norm text[]) returns uuid`.
- Consumed por: Task 3 (`lote-repository.ts`).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0086_sf_lotes.sql`:

```sql
-- 0086_sf_lotes.sql
-- Lote entre postos: identidade interna de um painel físico (grupo de SNs lançados juntos).
-- Mapa (pmo, op, SN) -> lote_id. Nunca exposto na UI. Aditiva.

create table if not exists public.sf_lotes (
  pmo               text not null,
  op                text not null,
  numero_serie      text not null,
  numero_serie_norm text not null,
  lote_id           uuid not null,
  criado_em         timestamptz not null default now(),
  primary key (pmo, op, numero_serie_norm)
);
create index if not exists sf_lotes_grupo on public.sf_lotes (pmo, op, lote_id);

alter table public.sf_lotes enable row level security;
-- Leitura: qualquer um que já vê o ShopFloor (operadores precisam ler o lote).
create policy sf_lotes_select on public.sf_lotes for select using (tem_permissao('visualizar'));
-- Escrita: só via sf_criar_lote (security definer). Sem policy de insert/update p/ authenticated.

-- Cria (ou reaproveita) o lote dos SNs enviados juntos. Idempotente e defensiva:
-- - reaproveita um lote_id já existente entre os SNs (nunca sobrescreve mapeamento gravado);
-- - senão gera um novo; insere só o que falta (on conflict do nothing).
-- Recebe SNs já normalizados (p_sns_norm) alinhados 1:1 com os de exibição (p_sns).
create or replace function public.sf_criar_lote(
  p_pmo      text,
  p_op       text,
  p_sns      text[],
  p_sns_norm text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid;
  i int;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_sns_norm is null or array_length(p_sns_norm, 1) is null then
    return null;
  end if;

  -- Reaproveita um lote já existente entre esses SNs (nesta OP), se houver.
  select lote_id into v_lote
    from public.sf_lotes
   where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm)
   limit 1;
  if v_lote is null then
    v_lote := gen_random_uuid();
  end if;

  for i in 1 .. array_length(p_sns_norm, 1) loop
    insert into public.sf_lotes (pmo, op, numero_serie, numero_serie_norm, lote_id)
      values (p_pmo, p_op, p_sns[i], p_sns_norm[i], v_lote)
      on conflict (pmo, op, numero_serie_norm) do nothing;
  end loop;

  return v_lote;
end
$$;
```

- [ ] **Step 2: Aplicar no Dev**

Run: `supabase db push` (com o binário supabase-go configurado, conforme a doc/memória do projeto).
Expected: aplica `0086` sem erro. NÃO aplicar em Prod.

- [ ] **Step 3: Verificar no Dev**

Rodar no SQL editor / psql do Dev:
```sql
select gen_random_uuid(); -- sanity
select sf_criar_lote('PMOTESTE','9999', array['26333001','26333002'], array['26333001','26333002']);
select numero_serie_norm, lote_id from sf_lotes where pmo='PMOTESTE' and op='9999' order by 1;
-- reexecutar sf_criar_lote com os mesmos SNs deve devolver o MESMO lote_id (idempotência)
select sf_criar_lote('PMOTESTE','9999', array['26333001'], array['26333001']);
-- limpar
delete from sf_lotes where pmo='PMOTESTE' and op='9999';
```
Expected: 2 linhas com o mesmo `lote_id`; a 2ª chamada devolve o mesmo id; nenhuma linha duplicada.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0086_sf_lotes.sql
git commit -m "feat(shopfloor): migração 0086 — sf_lotes + sf_criar_lote (lote entre postos)"
```

---

### Task 2: Domínio — estado e helpers puros do lote

**Files:**
- Modify: `src/modules/shopfloor/domain/lote.ts`
- Test: `src/modules/shopfloor/domain/__tests__/lote.test.ts`

**Interfaces:**
- Produces: `type EstadoItemLote = 'pendente' | 'resolvido'`; `acharPendente(itens, snNorm): number`; `jaResolvido(itens, snNorm): boolean`; `contarResolvidos(itens): number`; `temPendentes(itens): boolean`. Genéricos sobre `{ estado; snNorm }` — sem depender de tipos de application (mantém o domínio puro).
- Consumed por: Task 5/6 (form).

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/modules/shopfloor/domain/__tests__/lote.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { acharPendente, jaResolvido, contarResolvidos, temPendentes } from '../lote'

const P = (snNorm: string) => ({ estado: 'pendente' as const, snNorm })
const R = (snNorm: string) => ({ estado: 'resolvido' as const, snNorm })

describe('helpers do lote', () => {
  it('acharPendente retorna o índice do placeholder pendente com o SN', () => {
    expect(acharPendente([R('A'), P('B'), P('C')], 'B')).toBe(1)
  })
  it('acharPendente ignora itens resolvidos e retorna -1 se não achar', () => {
    expect(acharPendente([R('A'), P('B')], 'A')).toBe(-1)
    expect(acharPendente([R('A'), P('B')], 'Z')).toBe(-1)
  })
  it('jaResolvido só considera itens resolvidos', () => {
    expect(jaResolvido([R('A'), P('B')], 'A')).toBe(true)
    expect(jaResolvido([R('A'), P('B')], 'B')).toBe(false)
  })
  it('contarResolvidos conta só os resolvidos', () => {
    expect(contarResolvidos([R('A'), P('B'), R('C')])).toBe(2)
  })
  it('temPendentes é true se houver ao menos um pendente', () => {
    expect(temPendentes([R('A'), P('B')])).toBe(true)
    expect(temPendentes([R('A'), R('C')])).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/lote.test.ts`
Expected: FALHA (funções não existem / não exportadas).

- [ ] **Step 3: Implementar os helpers**

Acrescentar ao final de `src/modules/shopfloor/domain/lote.ts` (manter o `MAX_LOTE` que já existe):

```ts
/** Estado de um item na lista do lote coletivo. */
export type EstadoItemLote = 'pendente' | 'resolvido'

/** Índice do placeholder PENDENTE com este SN normalizado (ou -1 se não houver). */
export function acharPendente<T extends { estado: EstadoItemLote; snNorm: string }>(
  itens: readonly T[], snNorm: string,
): number {
  return itens.findIndex((i) => i.estado === 'pendente' && i.snNorm === snNorm)
}

/** Já existe um item RESOLVIDO com este SN normalizado? */
export function jaResolvido<T extends { estado: EstadoItemLote; snNorm: string }>(
  itens: readonly T[], snNorm: string,
): boolean {
  return itens.some((i) => i.estado === 'resolvido' && i.snNorm === snNorm)
}

/** Quantos itens já foram resolvidos (aprovados/reprovados). */
export function contarResolvidos<T extends { estado: EstadoItemLote }>(itens: readonly T[]): number {
  return itens.filter((i) => i.estado === 'resolvido').length
}

/** Há ao menos um placeholder pendente (não bipado ainda)? */
export function temPendentes<T extends { estado: EstadoItemLote }>(itens: readonly T[]): boolean {
  return itens.some((i) => i.estado === 'pendente')
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/lote.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/lote.ts src/modules/shopfloor/domain/__tests__/lote.test.ts
git commit -m "feat(shopfloor): domínio do lote — estado pendente/resolvido + helpers"
```

---

### Task 3: Infra — `lote-repository.ts` (criar lote + pendentes do lote)

**Files:**
- Create: `src/modules/shopfloor/infra/lote-repository.ts`

**Interfaces:**
- Consumes: `sf_criar_lote` (Task 1); `postoPendenteDePeca` de `../domain/fluxo-op`; `mapaPostoPerfil` de `./postos-repository`; `createServerSupabase`.
- Produces:
  - `criarLote(pmo: string, op: string, sns: string[], snsNorm: string[]): Promise<void>`
  - `snsPendentesDoLote(pmo: string, op: string, posto: string, snNorm: string): Promise<string[]>` — devolve os SNs (forma de exibição) do mesmo lote que estão pendentes NESTE posto.

- [ ] **Step 1: Escrever o repositório**

Criar `src/modules/shopfloor/infra/lote-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapaPostoPerfil } from './postos-repository'
import { postoPendenteDePeca, type BipePeca } from '../domain/fluxo-op'

/** Cria (ou reaproveita) o lote dos SNs enviados juntos. `sns` e `snsNorm` alinhados 1:1. */
export async function criarLote(pmo: string, op: string, sns: string[], snsNorm: string[]): Promise<void> {
  if (snsNorm.length === 0) return
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('sf_criar_lote', {
    p_pmo: pmo, p_op: op, p_sns: sns, p_sns_norm: snsNorm,
  })
  if (error) throw error
}

/**
 * SNs do MESMO lote de `snNorm` que estão AGUARDANDO neste `posto`.
 * Reusa a derivação de fila da tela de Fluxo (postoPendenteDePeca), escopada aos SNs do lote.
 */
export async function snsPendentesDoLote(
  pmo: string, op: string, posto: string, snNorm: string,
): Promise<string[]> {
  const supabase = await createServerSupabase()

  // 1) lote_id do SN-âncora
  const { data: ancora, error: ea } = await supabase
    .from('sf_lotes')
    .select('lote_id')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', snNorm)
    .maybeSingle()
  if (ea) throw ea
  if (!ancora?.lote_id) return [] // SN sem lote → nada a puxar (fallback v1)

  // 2) todos os SNs do lote
  const { data: irmaos, error: ei } = await supabase
    .from('sf_lotes')
    .select('numero_serie,numero_serie_norm')
    .eq('pmo', pmo).eq('op', op).eq('lote_id', ancora.lote_id)
  if (ei) throw ei
  const membros = (irmaos ?? []) as { numero_serie: string; numero_serie_norm: string }[]
  if (membros.length === 0) return []
  const normSet = membros.map((m) => m.numero_serie_norm)

  // 3) ordem dos postos da OP + flags do perfil (mesma base do Fluxo)
  const { data: ordemRow, error: eo } = await supabase
    .from('sf_ordens')
    .select('sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo).eq('op', op)
    .maybeSingle()
  if (eo) throw eo
  const postos = [...((ordemRow?.sf_ordem_postos ?? []) as { posto: string; ordem: number }[])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => p.posto)
  const perfis = await mapaPostoPerfil()
  const exige = (p: string) => perfis[p]?.exigeManutencao ?? false
  const recursoDe = (p: string) => perfis[p]?.recurso ?? 'nenhum'

  // 4) registros SÓ dos SNs do lote (query escopada → pequena)
  const { data: regs, error: er } = await supabase
    .from('sf_registros')
    .select('numero_serie,numero_serie_norm,status,posto,posto_retorno,data_hora,id')
    .eq('pmo', pmo).eq('op', op)
    .in('numero_serie_norm', normSet)
    .order('data_hora', { ascending: true })
    .order('id', { ascending: true })
  if (er) throw er
  const linhas = (regs ?? []) as { numero_serie: string; numero_serie_norm: string; status: string; posto: string; posto_retorno: string | null }[]

  // 5) agrupa por peça e roda a derivação; filtra pendentes NESTE posto
  const porPeca = new Map<string, { sn: string; regs: BipePeca[] }>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const reg: BipePeca = { posto: l.posto, status: l.status, postoRetorno: l.posto_retorno ?? undefined }
    const e = porPeca.get(chave)
    if (e) e.regs.push(reg)
    else porPeca.set(chave, { sn: l.numero_serie, regs: [reg] })
  }
  const alvo = posto.toLowerCase()
  const displayPorNorm = new Map(membros.map((m) => [m.numero_serie_norm, m.numero_serie]))
  const pendentes: string[] = []
  for (const norm of normSet) {
    const peca = porPeca.get(norm)
    const regs = peca?.regs ?? [] // sem registro ainda → derivação devolve o 1º posto
    const pend = postoPendenteDePeca(regs, postos, exige, recursoDe)
    if (pend && pend.toLowerCase() === alvo) {
      pendentes.push(peca?.sn ?? displayPorNorm.get(norm) ?? norm)
    }
  }
  return pendentes.sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. (Confere que `BipePeca` é exportado de `../domain/fluxo-op` — já é, é usado por `fluxo-repository.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/lote-repository.ts
git commit -m "feat(shopfloor): infra do lote — criarLote + snsPendentesDoLote (reusa Fluxo)"
```

---

### Task 4: Application — `carregarLotePendente` + criar o lote no envio

**Files:**
- Modify: `src/modules/shopfloor/application/lancar-action.ts`

**Interfaces:**
- Consumes: `criarLote`, `snsPendentesDoLote` (Task 3); `normalizarSerie` (`../domain/serie`).
- Produces:
  - `carregarLotePendente(pmo, op, posto, sn): Promise<{ snsPendentes: string[] }>` (fail-open: `{ snsPendentes: [] }` em erro/sem permissão).
  - `lancarLote` passa a criar o lote (best-effort) dos SNs que gravaram OK.
- Consumed por: Task 6 (form).

- [ ] **Step 1: Importar a infra do lote**

Em `src/modules/shopfloor/application/lancar-action.ts`, no bloco de imports da infra, acrescentar:

```ts
import { criarLote, snsPendentesDoLote } from '../infra/lote-repository'
```

- [ ] **Step 2: Criar o lote no fim do `lancarLote` (best-effort)**

Em `lancarLote`, ANTES de `return { resultados }`, inserir:

```ts
  // Lote entre postos: carimba o lote (interno) dos SNs que gravaram OK. Best-effort:
  // falha aqui NÃO afeta o lançamento já feito no chão de fábrica.
  const okSns = itens.filter((_, idx) => resultados[idx]?.ok).map((i) => i.numeroSerie)
  if (okSns.length > 0) {
    try {
      const base = itens[0]!
      await criarLote(
        base.pmo, base.op,
        okSns.map((s) => s.trim()),
        okSns.map((s) => normalizarSerie(s)),
      )
    } catch {
      // ignora: rastreio de lote é secundário
    }
  }
```

(`normalizarSerie` já está importado de `../domain/serie` neste arquivo.)

- [ ] **Step 3: Adicionar a action `carregarLotePendente` ao final do arquivo**

```ts
/**
 * Lote entre postos: dado um SN-âncora bipado, devolve os SNs do MESMO lote que ainda estão
 * pendentes neste posto (pra pré-listar como checklist). Fail-open ([] em erro/sem permissão/sem lote).
 */
export async function carregarLotePendente(
  pmo: string, op: string, posto: string, sn: string,
): Promise<{ snsPendentes: string[] }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { snsPendentes: [] }
  if (!pmo.trim() || !op.trim() || !posto.trim() || !sn.trim()) return { snsPendentes: [] }
  try {
    return { snsPendentes: await snsPendentesDoLote(pmo, op, posto, normalizarSerie(sn)) }
  } catch {
    return { snsPendentes: [] }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/application/lancar-action.ts
git commit -m "feat(shopfloor): action carregarLotePendente + cria lote no envio coletivo"
```

---

### Task 5: Form — `ItemLote` união (pendente/resolvido) + substituição por SN

> Refatora o estado do lote SEM adicionar a pré-listagem ainda. Ao fim desta task, o coletivo v1
> continua funcionando idêntico (só bipes resolvidos, nenhum placeholder aparece) — mas o modelo já
> suporta o estado "pendente".

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes: `EstadoItemLote`, `acharPendente`, `jaResolvido`, `contarResolvidos`, `temPendentes`, `MAX_LOTE` (`../../../.../domain/lote`); `normalizarSerie`.
- Produces: novo `type ItemLote` (união) usado nas Tasks 5 e 6.

- [ ] **Step 1: Atualizar imports do domínio de lote**

Trocar a linha `import { MAX_LOTE } from '@/modules/shopfloor/domain/lote'` por:

```ts
import { MAX_LOTE, acharPendente, jaResolvido, contarResolvidos, temPendentes, type EstadoItemLote } from '@/modules/shopfloor/domain/lote'
```

- [ ] **Step 2: Redefinir o tipo `ItemLote`**

Trocar a definição atual:

```ts
type ItemLote = { entrada: EntradaLancamento; outcome: 'aprovado' | 'reprovado' | null; erro?: string }
```

por a união (guardando `snNorm` e `sn` p/ os helpers e a exibição):

```ts
type ItemLote =
  | { estado: 'pendente'; sn: string; snNorm: string }
  | { estado: 'resolvido'; sn: string; snNorm: string; entrada: EntradaLancamento; outcome: 'aprovado' | 'reprovado' | null; erro?: string }
```

- [ ] **Step 3: Reescrever `empilharNoLote` (substitui placeholder pendente)**

Trocar a função `empilharNoLote` inteira por:

```ts
  /** Modo coletivo: empilha o bipe resolvido no lote. Se houver um placeholder PENDENTE com o
   * mesmo SN, SUBSTITUI (não duplica). Retorna true se empilhou/substituiu. */
  function empilharNoLote(entrada: EntradaLancamento, outcome: 'aprovado' | 'reprovado' | null): boolean {
    const sn = entrada.numeroSerie.trim()
    const snNorm = normalizarSerie(sn)
    if (jaResolvido(lote, snNorm)) {
      mostrar({ tipo: 'aviso', titulo: 'Este SN já está no lote.', chips: [{ rotulo: 'Nº Série', valor: sn, mono: true }] })
      limparPeca(); return false
    }
    const idxPend = acharPendente(lote, snNorm)
    // Só bloqueia por teto quando é item NOVO (não quando substitui um pendente que já ocupa lugar).
    if (idxPend < 0 && lote.length >= MAX_LOTE) {
      mostrar({ tipo: 'aviso', titulo: `Máximo de ${MAX_LOTE} SNs por lote — envie os atuais antes de continuar.` })
      return false
    }
    const resolvido: ItemLote = { estado: 'resolvido', sn, snNorm, entrada, outcome }
    setLote((prev) => {
      const i = acharPendente(prev, snNorm)
      if (i >= 0) { const c = [...prev]; c[i] = resolvido; return c }
      return [...prev, resolvido]
    })
    mostrar({
      tipo: outcome === 'reprovado' ? 'reprova' : 'ok',
      titulo: 'Adicionado ao lote',
      chips: [{ rotulo: 'Nº Série', valor: sn, mono: true }, { rotulo: 'Lote', valor: `${contarResolvidos(lote) + 1}/${MAX_LOTE}` }],
    })
    limparPeca(); return true
  }
```

> Nota: o chip "Lote" mostra resolvidas+1 (a que acabou de resolver). `contarResolvidos(lote)` usa o
> estado ANTES do setLote (fecho), então soma 1 (resolver sempre aumenta as resolvidas em 1, seja
> substituindo um pendente ou anexando um novo).

- [ ] **Step 4: Ajustar `enviarLote` (envia só resolvidos; preserva pendentes)**

Trocar o corpo de `enviarLote` por:

```ts
  function enviarLote() {
    const resolvidos = lote.filter((i) => i.estado === 'resolvido')
    if (resolvidos.length === 0 || enviandoLote) return
    startEnviarLote(async () => {
      const itens = resolvidos
      const { resultados } = await lancarLote(itens.map((i) => (i as Extract<ItemLote, { estado: 'resolvido' }>).entrada))
      const falhas: ItemLote[] = []
      const linhasOk: LinhaHistorico[] = []
      itens.forEach((item, idx) => {
        const it = item as Extract<ItemLote, { estado: 'resolvido' }>
        const r = resultados[idx]
        if (r?.ok) linhasOk.push({ lancamento: true, status: it.outcome, sn: it.sn })
        else falhas.push({ ...it, erro: r?.erro ?? 'Erro ao enviar.' })
      })
      // best-effort: quem falhou volta pro lote com o motivo; PENDENTES e itens bipados durante o
      // envio são preservados (update funcional filtra só os enviados que deram OK).
      const enviadosOk = new Set(itens.filter((_, idx) => resultados[idx]?.ok).map((i) => i.snNorm))
      setLote((prev) => {
        const restantes = prev.filter((p) => !enviadosOk.has(p.snNorm))
        // anexa as falhas atualizadas (com erro) que não estejam já em restantes
        const normRestantes = new Set(restantes.map((p) => p.snNorm))
        return [...falhas.filter((f) => !normRestantes.has(f.snNorm)), ...restantes]
      })
      if (linhasOk.length > 0) setHistorico((h) => [...[...linhasOk].reverse(), ...h].slice(0, 30))
      mostrar({
        tipo: falhas.length ? 'aviso' : 'ok',
        titulo: falhas.length ? `${linhasOk.length} enviado(s), ${falhas.length} com erro` : `${linhasOk.length} enviado(s)`,
      })
      refreshTotalPosto()
    })
  }
```

- [ ] **Step 5: Ajustar a renderização da lista do lote (guardar por estado)**

No JSX do card "Lote", trocar o título e o botão pra contar resolvidos, e cada linha pra tratar os dois estados. Trocar o `<CardTitle>` e o `<Button>` do header:

```tsx
                  <CardTitle>Lote — {contarResolvidos(lote)}/{lote.length}</CardTitle>
                  <Button
                    size="sm"
                    onClick={enviarLote}
                    disabled={contarResolvidos(lote) === 0 || enviandoLote}
                    className="bg-enterplak hover:bg-enterplak-700"
                  >
                    {enviandoLote ? 'Enviando…' : `Enviar (${contarResolvidos(lote)})`}
                  </Button>
```

E o `.map` das linhas:

```tsx
                  {lote.map((item, i) => (
                    <div key={item.snNorm} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm">{item.sn}</p>
                        {item.estado === 'pendente' ? (
                          <p className="text-xs text-muted-foreground">Pendente</p>
                        ) : (
                          <p className={`text-xs ${item.outcome === 'reprovado' ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {item.outcome === 'reprovado' ? 'Reprovado' : item.outcome === 'aprovado' ? 'Aprovado' : '—'}
                          </p>
                        )}
                        {item.estado === 'resolvido' && item.erro && <p className="text-xs font-medium text-red-600">{item.erro}</p>}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remover ${item.sn} do lote`}
                        onClick={() => setLote((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={enviandoLote}
                        className="shrink-0 text-muted-foreground hover:text-red-600 disabled:opacity-40"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros. (O `empilharNoLote` continua sendo chamado dos mesmos 3 pontos — `onEnviar`, `gravarAprovado`, `gravarReprovado` — sem mudança de assinatura.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): lote com estado pendente/resolvido + substituição por SN (form)"
```

---

### Task 6: Form — puxar o painel no bipe-âncora + aviso no Enviar com pendentes

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes: `carregarLotePendente` (Task 4); `temPendentes` (Task 2); `ItemLote` (Task 5).

- [ ] **Step 1: Importar a action**

Na linha de import de `lancar-action`, acrescentar `carregarLotePendente`:

```ts
import { lancar, lancarLote, buscarEntradaBurnin, verificarConserto, contarLancadosPosto, carregarLotePendente, type EntradaLancamento } from '@/modules/shopfloor/application/lancar-action'
```

- [ ] **Step 2: Estado "âncora" (evita re-puxar o mesmo painel)**

Perto dos outros `useState` do lote, adicionar:

```ts
  const [loteAncorado, setLoteAncorado] = useState(false) // já puxou o painel do lote nesta sessão/contexto?
```

- [ ] **Step 3: Resetar o âncora ao trocar de contexto**

Em `podeTrocarContexto`, dentro do `if (ok) { ... }`, além de `setLote([])`, adicionar `setLoteAncorado(false)`:

```ts
    if (ok) { setLote([]); setLoteAncorado(false) }
```

E em `mudarPosto` (após `setPosto(v)`), garantir o reset também (troca de posto = novo contexto de lote):

```ts
    setLoteAncorado(false)
```
(colocar logo após `setHistorico([]); setTotalPosto(null)` na `mudarPosto`.)

- [ ] **Step 4: Função `puxarPainel` (pré-lista os irmãos pendentes)**

Adicionar logo após `empilharNoLote`:

```ts
  /** Depois de resolver o 1º item de um lote, puxa os irmãos ainda pendentes neste posto e os
   * adiciona como placeholders "pendente" (checklist). Idempotente por SN; respeita o teto. */
  async function puxarPainel(snAncora: string) {
    if (loteAncorado) return
    const { snsPendentes } = await carregarLotePendente(pmo, op, posto, snAncora)
    if (snsPendentes.length === 0) return
    setLoteAncorado(true)
    setLote((prev) => {
      const existentes = new Set(prev.map((i) => i.snNorm))
      const espaco = Math.max(0, MAX_LOTE - prev.length)
      const novos: ItemLote[] = snsPendentes
        .map((s) => ({ estado: 'pendente' as const, sn: s, snNorm: normalizarSerie(s) }))
        .filter((p) => !existentes.has(p.snNorm))
        .slice(0, espaco)
      return novos.length ? [...prev, ...novos] : prev
    })
  }
```

- [ ] **Step 5: Disparar o pull ao resolver (dentro de `empilharNoLote`)**

No fim de `empilharNoLote`, ANTES do `limparPeca(); return true`, adicionar o disparo (não bloqueia o fluxo):

```ts
    void puxarPainel(sn)
```

Ou seja, a parte final fica:

```ts
    mostrar({ ...chips... })
    void puxarPainel(sn) // pré-lista os irmãos do lote (se houver) — não bloqueia
    limparPeca(); return true
```

- [ ] **Step 6: Aviso no Enviar com pendentes**

Trocar o início de `enviarLote` pra avisar quando houver placeholders pendentes. Como `confirmar` é
async e `startEnviarLote` é uma transição, fazer a confirmação ANTES da transição:

```ts
  async function enviarLote() {
    const resolvidos = lote.filter((i) => i.estado === 'resolvido')
    if (resolvidos.length === 0 || enviandoLote) return
    if (temPendentes(lote)) {
      const nPend = lote.length - resolvidos.length
      const ok = await confirmar({
        titulo: `${nPend} ainda pendente(s) — enviar assim mesmo?`,
        descricao: 'As pendentes (não bipadas) continuam na lista; só as resolvidas serão gravadas.',
        rotuloConfirmar: 'Enviar',
      })
      if (!ok) return
    }
    startEnviarLote(async () => {
      // ... resto igual ao da Task 5 ...
    })
  }
```

> Nota: `enviarLote` passa a ser `async`. O `onClick={enviarLote}` do botão continua válido
> (React aceita handler async). Ajustar a assinatura para `async function enviarLote()`.

- [ ] **Step 7: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): puxar painel do lote no bipe-âncora + aviso ao enviar com pendentes"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- `sf_lotes` + `sf_criar_lote` + RLS → Task 1. ✅
- Criação no envio (só SNs OK, idempotente, posto criador = v1) → Task 4 Step 2. ✅
- `carregarLotePendente` reusando Fluxo → Task 3 + Task 4. ✅
- Puxar painel no bipe-âncora → Task 6. ✅
- Estado "pendente" + substituição por SN → Task 5. ✅
- Enviar conta resolvidas + aviso com pendentes → Task 5 (contagem) + Task 6 (aviso). ✅
- `lote_id` interno (nunca na UI) → nenhuma task renderiza `lote_id`. ✅
- Fallback v1 (sem lote) → `snsPendentesDoLote` retorna [] sem lote; `carregarLotePendente` fail-open; Task 5 mantém o v1. ✅
- Gesto de bipe inalterado → `empilharNoLote` chamado dos mesmos pontos; modais intactos. ✅

**Placeholder scan:** sem TBD/TODO; todo passo tem código/comando concretos.

**Type consistency:** `ItemLote` (união) definido na Task 5 e usado na Task 6; helpers de `domain/lote.ts` (Task 2) usados nas Tasks 5/6; `carregarLotePendente`/`criarLote`/`snsPendentesDoLote` com assinaturas casando entre Tasks 3→4→6; `BipePeca` importado de `fluxo-op` (já exportado).

**Nota de ordenação:** Task 6 depende do estado/tipo introduzidos na Task 5 (mesma arquivo) e da action da Task 4 — executar em ordem.
