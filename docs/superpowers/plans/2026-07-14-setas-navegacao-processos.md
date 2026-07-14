# Setas de navegação entre processos (#2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Setas ‹ › no rodapé do detalhe do processo (canto direito, na reta do Finalizar) para navegar ao anterior/próximo na ordem da lista filtrada, atravessando meses.

**Architecture:** RPC `processos_vizinhos` (LAG/LEAD sobre a mesma ordenação da lista) devolve os 2 vizinhos; a lista passa os filtros por query param; o detalhe lê os params, busca os vizinhos e renderiza as setas como links (desabilitadas nas pontas).

**Tech Stack:** Next.js 16 (App Router, Server Components), TS strict, Supabase (RPC/RLS), Tailwind, Vitest.

## Global Constraints
- Ordem de navegação = a da lista (3b): `order by (data_chegada is not null) asc, date_trunc('month', data_chegada) desc, numero desc`, respeitando busca/status. Atravessa meses.
- Setas no **rodapé, canto direito**, na mesma linha do Finalizar; **aparecem sempre**; desabilitadas nas pontas (anterior/proximo = null).
- RPC **SECURITY INVOKER** (respeita RLS). Busca = ilike em `numero_nf, numero_pedido, fornecedor, codigo_material, descricao_material` (termo sanitizado no app).
- Migração roda em **produção sem dados reais**. TDD só no helper de domínio; RPC+UI por build+smoke.

---

### Task 1: Migração 0016 (RPC `processos_vizinhos`)

**Files:** Create `supabase/migrations/0016_processos_vizinhos.sql`
> Sem teste automatizado (SQL). O **controller aplica** em produção após o review.

- [ ] **Step 1: Escrever a migração**
```sql
-- Vizinhos (anterior/próximo) de um processo na ORDEM da lista (feature 3b):
-- 'Aguardando data de chegada' (data_chegada nula) no topo → meses do mais
-- recente ao mais antigo → número desc dentro do grupo; respeitando busca/status.
-- SECURITY INVOKER: respeita o RLS (só considera processos que o usuário vê).
create or replace function public.processos_vizinhos(
  p_id uuid, p_busca text default null, p_status text default null
)
returns table (anterior uuid, proximo uuid)
language sql stable security invoker set search_path = public
as $$
  with ordenados as (
    select id,
      lag(id)  over w as ant,
      lead(id) over w as prox
    from public.processos_recebimento
    where (p_status is null or status = p_status)
      and (p_busca is null
           or numero_nf ilike '%' || p_busca || '%'
           or numero_pedido ilike '%' || p_busca || '%'
           or fornecedor ilike '%' || p_busca || '%'
           or codigo_material ilike '%' || p_busca || '%'
           or descricao_material ilike '%' || p_busca || '%')
    window w as (
      order by (data_chegada is not null) asc,
               date_trunc('month', data_chegada) desc,
               numero desc
    )
  )
  select ant, prox from ordenados where id = p_id;
$$;
grant execute on function public.processos_vizinhos(uuid, text, text) to authenticated;
```
- [ ] **Step 2: Commit** — `git add supabase/migrations/0016_processos_vizinhos.sql && git commit -m "feat(processos): migração 0016 — RPC processos_vizinhos (navegação)"`

---

### Task 2: Domínio — `queryProcessos(filtros)` (TDD)

**Files:** Modify `src/modules/recebimento/domain/busca-processo.ts`; Test `src/modules/recebimento/domain/__tests__/busca-processo.test.ts` (adicionar bloco)

**Interfaces:** Produces `interface FiltrosLista { busca?: string; status?: string }` e `queryProcessos(filtros: FiltrosLista): string`.

- [ ] **Step 1: Adicionar o teste** (ao fim do `__tests__/busca-processo.test.ts` — mantém os existentes)
```ts
import { queryProcessos } from '../busca-processo'

describe('queryProcessos', () => {
  it('monta o sufixo com busca e status', () => {
    expect(queryProcessos({ busca: 'abc', status: 'Aprovado' })).toBe('?busca=abc&status=Aprovado')
  })
  it('omite vazios / retorna "" sem filtro', () => {
    expect(queryProcessos({ busca: 'abc' })).toBe('?busca=abc')
    expect(queryProcessos({})).toBe('')
  })
})
```
- [ ] **Step 2: Rodar → falha** — `npx vitest run src/modules/recebimento/domain/__tests__/busca-processo.test.ts`
- [ ] **Step 3: Implementar** (ao fim de `busca-processo.ts`)
```ts
export interface FiltrosLista {
  busca?: string
  status?: string
}

/**
 * Sufixo de query string ('?busca=…&status=…') a partir dos filtros da lista de
 * Processos; '' quando não há filtro. Usado nos links da lista e nas setas de
 * navegação para preservar o contexto/ordem.
 */
export function queryProcessos(filtros: FiltrosLista): string {
  const params = new URLSearchParams()
  if (filtros.busca) params.set('busca', filtros.busca)
  if (filtros.status) params.set('status', filtros.status)
  const s = params.toString()
  return s ? `?${s}` : ''
}
```
- [ ] **Step 4: Rodar → passa.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(processos): helper queryProcessos (contexto de filtros nos links)"`

---

### Task 3: Infra — `buscarVizinhos`

**Files:** Modify `src/modules/recebimento/infra/processo-detalhe-repository.ts`

**Interfaces:** Produces `buscarVizinhos(id: string, filtros: { busca?: string; status?: string }): Promise<{ anterior: string | null; proximo: string | null }>`.

- [ ] **Step 1: Import** (junto aos imports do arquivo) — `import { sanitizarTermoBusca } from '../domain/busca-processo'`
- [ ] **Step 2: Adicionar a função** (ao fim do arquivo)
```ts
/**
 * Anterior/próximo do processo na ordem da lista filtrada, via RPC
 * `processos_vizinhos`. Fail-safe: qualquer erro devolve ambos `null` (setas
 * desabilitadas), sem quebrar a página.
 */
export async function buscarVizinhos(
  id: string,
  filtros: { busca?: string; status?: string },
): Promise<{ anterior: string | null; proximo: string | null }> {
  try {
    const supabase = await createServerSupabase()
    const buscaSanitizada = filtros.busca ? sanitizarTermoBusca(filtros.busca) : ''
    const { data, error } = await supabase.rpc('processos_vizinhos', {
      p_id: id,
      p_busca: buscaSanitizada || null,
      p_status: filtros.status ?? null,
    })
    if (error) throw error
    const row = (data ?? [])[0] as { anterior: string | null; proximo: string | null } | undefined
    return { anterior: row?.anterior ?? null, proximo: row?.proximo ?? null }
  } catch {
    return { anterior: null, proximo: null }
  }
}
```
- [ ] **Step 3: `npx tsc --noEmit`** → limpo. Commit — `git commit -m "feat(processos): buscarVizinhos (RPC de navegação, fail-safe)"`

---

### Task 4: UI — links da lista carregam os filtros

**Files:** Modify `src/app/(app)/recebimento/processos/linhas-processos.tsx` e `processos-por-mes.tsx`

- [ ] **Step 1: `linhas-processos.tsx`** — receber `filtros` e incluir o sufixo nos hrefs de abrir.
  - Adicionar import: `import { queryProcessos } from '@/modules/recebimento/domain/busca-processo'` e `import type { FiltrosProcessos } from '@/modules/recebimento/infra/processo-repository'`.
  - Mudar a assinatura para `export function LinhasProcessos({ linhas, filtros }: { linhas: ProcessoResumoRow[]; filtros: FiltrosProcessos })`.
  - No corpo, antes do return: `const q = queryProcessos(filtros)`.
  - Nos **dois** hrefs (o `render={<Link href={...} />}` da tabela desktop e o `<Link href={...}>` do card mobile), trocar `` `/recebimento/processos/${processo.id}` `` por `` `/recebimento/processos/${processo.id}${q}` ``.
- [ ] **Step 2: `processos-por-mes.tsx`** — passar `filtros` para `LinhasProcessos`. Localizar `<LinhasProcessos linhas={carga.linhas} />` e trocar por `<LinhasProcessos linhas={carga.linhas} filtros={filtros} />` (o componente já recebe `filtros` como prop).
- [ ] **Step 3: `npx tsc --noEmit && npm run lint`** → limpo. Commit — `git commit -m "feat(processos): links da lista preservam filtros (contexto p/ navegação)"`

---

### Task 5: UI — setas no rodapé + fiação do detalhe

**Files:**
- Create `src/app/(app)/recebimento/processos/[id]/navegacao-processo.tsx`
- Modify `[id]/acoes-processo.tsx`, `[id]/processo-detalhe.tsx`, `[id]/page.tsx`

**Interfaces:** Consumes `buscarVizinhos` (Task 3), `queryProcessos` (Task 2), `FiltrosProcessos`.

- [ ] **Step 1: Criar `navegacao-processo.tsx`**
```tsx
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { queryProcessos } from '@/modules/recebimento/domain/busca-processo'
import type { FiltrosProcessos } from '@/modules/recebimento/infra/processo-repository'

/** Setas ‹ › para o processo anterior/próximo na ordem da lista filtrada. `null`
 *  → seta desabilitada (ponta da lista). Os filtros vão no href para manter a
 *  navegação dentro da mesma ordem. */
export function NavegacaoProcesso({
  anterior,
  proximo,
  filtros,
}: {
  anterior: string | null
  proximo: string | null
  filtros: FiltrosProcessos
}) {
  const q = queryProcessos(filtros)
  return (
    <div className="ml-auto flex gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Processo anterior"
        disabled={!anterior}
        render={anterior ? <Link href={`/recebimento/processos/${anterior}${q}`} /> : undefined}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Próximo processo"
        disabled={!proximo}
        render={proximo ? <Link href={`/recebimento/processos/${proximo}${q}`} /> : undefined}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: `acoes-processo.tsx`** — remover o wrapper externo com borda (o rodapé passa a ser do `processo-detalhe`). Ler o arquivo; localizar o `return` externo que envolve os botões num `<div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">` e trocar por `<div className="flex flex-wrap items-start gap-3">` (SEM `border-t border-border pt-4`). Manter o `if (!mostrarFinalizar && !mostrarReabrir) return null`. (Só a borda/rodapé sai; os botões e a lógica ficam.)

- [ ] **Step 3: `processo-detalhe.tsx`** — adicionar props e o rodapé único.
  - Nos props (interface `ProcessoDetalheProps` + destructuring): adicionar `anterior: string | null`, `proximo: string | null`, `filtros: FiltrosProcessos`.
  - Import: `import { NavegacaoProcesso } from './navegacao-processo'` e `import type { FiltrosProcessos } from '@/modules/recebimento/infra/processo-repository'`.
  - Trocar o bloco que hoje renderiza `<AcoesProcesso .../>` por um **rodapé único**:
```tsx
<div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
  <AcoesProcesso
    processoId={processoId}
    status={status}
    podeFinalizar={podeFinalizar}
    podeEditarFinalizado={podeEditarFinalizado}
    finalizarBloqueado={dirty}
  />
  <NavegacaoProcesso anterior={anterior} proximo={proximo} filtros={filtros} />
</div>
```
  (O `ml-auto` da `NavegacaoProcesso` empurra as setas pro canto direito mesmo quando o `AcoesProcesso` renderiza `null`.)

- [ ] **Step 4: `[id]/page.tsx`** — ler os filtros e buscar os vizinhos.
  - Import: `import { buscarVizinhos } from '@/modules/recebimento/infra/processo-detalhe-repository'` (mesmo módulo já importado — adicionar ao import existente).
  - Mudar a assinatura para receber também `searchParams`:
```tsx
interface ProcessoDetalhePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ busca?: string; status?: string }>
}
```
  - No corpo, após obter `id`: 
```tsx
const sp = await searchParams
const filtros = { busca: sp.busca || undefined, status: sp.status || undefined }
const { anterior, proximo } = await buscarVizinhos(id, filtros)
```
  - Passar `anterior={anterior} proximo={proximo} filtros={filtros}` no `<ProcessoDetalhe .../>` (junto dos props atuais).

- [ ] **Step 5:** `npx tsc --noEmit && npm run lint && npm run build` → verde. Commit — `git commit -m "feat(processos): setas de navegação no rodapé do detalhe"`

---

### Task 6: Verificação final + smoke

- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` → tudo verde.
- [ ] **Step 2 (controller):** aplicar a migração 0016 em produção (`supabase db push`) + `notify pgrst, 'reload schema'`.
- [ ] **Step 3: Smoke** (`npm run dev`): abrir um processo a partir da lista → no rodapé, canto direito, aparecem ‹ ›. Navegar: percorre a ordem da lista **cruzando meses**; com busca/status ativos, navega só dentro do filtrado; nas pontas as setas desabilitam. Finalizar/Reabrir seguem na mesma linha à esquerda.
- [ ] **Step 4:** Nada a commitar. Fim.

---

## Self-Review
- **Cobertura da spec:** setas rodapé/canto direito (Task 5), ordem da lista atravessando meses (Task 1 RPC), filtros preservados (Tasks 2/4), vizinhos via RPC SECURITY INVOKER fail-safe (Tasks 1/3), desabilitar nas pontas (Task 5 componente), migração em prod (Tasks 1/6). ✔
- **Placeholders:** nenhum; UI é modify com código/instruções exatas + componente completo. ✔
- **Consistência de tipos:** `queryProcessos(FiltrosLista)`, `buscarVizinhos(id, {busca,status}) → {anterior,proximo}`, `NavegacaoProcesso({anterior,proximo,filtros})`, `FiltrosProcessos` — usados igual entre tasks. ✔
