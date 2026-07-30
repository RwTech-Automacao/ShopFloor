# Tela de Registros (log de produção por cliente) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tela só-leitura `/shopfloor/registros` que mostra o feed de `sf_registros`, filtrável por cliente/OP/posto/SN/status/período, com colunas essenciais + detalhe ao clicar e paginação server-side.

**Architecture:** Padrão modular ShopFloor + reuso do padrão do log de auditoria (`/configuracoes/logs`): domínio puro pros filtros, repositório de infra com `.range()` de paginação, page server-component, barra de filtros client, tabela client com modal de detalhe. `sf_registros` já tem RLS `shopfloor.visualizar` (Fase 2a) — sem mudança de segurança.

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Tailwind v4, @base-ui (Dialog/Select), Vitest 4, Supabase Postgres.

## Global Constraints

- PT-BR em UI, mensagens e comentários.
- Domínio **puro** (sem I/O) e fonte única da lógica de filtro; a UI não reimplementa filtro.
- Só leitura — sem editar/excluir/exportar (export é backlog).
- Permissão `shopfloor.visualizar` (guard na page + RLS já existente).
- Paginação **server-side**, 25/página, ordem `data_hora` desc.
- Reusar componentes/padrões existentes (não recriar Select/Dialog/Table).
- Marcar a page com `export const dynamic = 'force-dynamic'` (busca por-requisição; decisão de build já adotada no projeto).
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-07-28-tela-registros-design.md`.

## File Structure

- `supabase/migrations/0058_sf_registros_indices.sql` — **criar**: índices de performance.
- `src/modules/shopfloor/domain/registros-filtros.ts` — **criar**: `FiltrosRegistros` + `parsearFiltrosRegistros`.
- `src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts` — **criar**: testes.
- `src/modules/shopfloor/infra/registros-repository.ts` — **criar**: `consultarRegistros`, `listarClientesRegistros`.
- `src/app/(app)/shopfloor/registros/page.tsx` — **criar**: server (guard, query, paginação).
- `src/app/(app)/shopfloor/registros/registros-filtros.tsx` — **criar**: client (barra de filtros).
- `src/app/(app)/shopfloor/registros/registros-tabela.tsx` — **criar**: client (tabela + modal de detalhe).
- `src/shared/ui/app-shell.tsx` — **modificar**: item "Registros" no menu Fluxo de Processos.

---

### Task 1: Migração 0058 — índices de performance

**Files:**
- Create: `supabase/migrations/0058_sf_registros_indices.sql`

- [ ] **Step 1: Criar a migração**

```sql
-- Índices de performance para a Tela de Registros (log de produção).
-- sf_registros cresce grande (dezenas de milhares de linhas); a tela ordena por
-- data_hora desc e filtra por cliente. Índices aditivos, sem alterar dados/RLS.
create index if not exists sf_registros_data_hora
  on public.sf_registros (data_hora desc);
create index if not exists sf_registros_cliente_data
  on public.sf_registros (cliente, data_hora desc);
```

- [ ] **Step 2: Commit** (a aplicação no Dev via `supabase db push` é coordenada pelo controller/humano — o índice não é pré-requisito de correção, só de performance)

```bash
git add supabase/migrations/0058_sf_registros_indices.sql
git commit -m "$(cat <<'EOF'
feat(shopfloor): índices de performance em sf_registros (Tela de Registros)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Domínio — `registros-filtros.ts` (TDD)

**Files:**
- Create: `src/modules/shopfloor/domain/registros-filtros.ts`
- Test: `src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts`

**Interfaces:**
- Consumes: `normalizarSerie` (de `./serie`).
- Produces: `FiltrosRegistros` (interface) + `parsearFiltrosRegistros(input: Record<string, string | undefined>): FiltrosRegistros` — usado pela page (Task 4) e repositório (Task 3).

- [ ] **Step 1: Escrever os testes falhando** — `src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsearFiltrosRegistros } from '../registros-filtros'

describe('parsearFiltrosRegistros', () => {
  it('passa cliente/posto/status/busca/de/ate (com trim)', () => {
    const f = parsearFiltrosRegistros({ cliente: ' Lince ', posto: 'Teste', status: 'aprovado', busca: ' 100 ', de: '2026-07-01', ate: '2026-07-28' })
    expect(f).toEqual({ cliente: 'Lince', posto: 'Teste', status: 'aprovado', busca: '100', de: '2026-07-01', ate: '2026-07-28' })
  })
  it('normaliza o SN pra numero_serie_norm', () => {
    const f = parsearFiltrosRegistros({ sn: '00-25.7891/001' })
    expect(f.snNorm).toBe('257891001'.replace(/^0+/, ''))
  })
  it('ignora vazios e brancos', () => {
    expect(parsearFiltrosRegistros({ cliente: '', posto: '   ', sn: '' })).toEqual({})
    expect(parsearFiltrosRegistros({})).toEqual({})
  })
  it('SN que normaliza pra vazio não entra', () => {
    expect(parsearFiltrosRegistros({ sn: '--' }).snNorm).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts`
Expected: FAIL — `parsearFiltrosRegistros is not a function`.

- [ ] **Step 3: Implementar** — `src/modules/shopfloor/domain/registros-filtros.ts`:

```ts
import { normalizarSerie } from './serie'

/** Filtros da Tela de Registros. Todos opcionais; `snNorm` casa `numero_serie_norm`. */
export interface FiltrosRegistros {
  cliente?: string
  busca?: string // casa pmo OU op
  posto?: string
  snNorm?: string
  status?: string // 'aprovado' | 'reprovado' | 'sem-status'
  de?: string // data início (aplicada em data_hora)
  ate?: string // data fim
}

/** Interpreta os filtros crus (searchParams) num objeto validado; ignora vazios. */
export function parsearFiltrosRegistros(
  input: Record<string, string | undefined>,
): FiltrosRegistros {
  const f: FiltrosRegistros = {}
  const cliente = input.cliente?.trim()
  if (cliente) f.cliente = cliente
  const busca = input.busca?.trim()
  if (busca) f.busca = busca
  const posto = input.posto?.trim()
  if (posto) f.posto = posto
  const sn = input.sn?.trim()
  if (sn) {
    const norm = normalizarSerie(sn)
    if (norm) f.snNorm = norm
  }
  const status = input.status?.trim()
  if (status) f.status = status
  const de = input.de?.trim()
  if (de) f.de = de
  const ate = input.ate?.trim()
  if (ate) f.ate = ate
  return f
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/registros-filtros.ts src/modules/shopfloor/domain/__tests__/registros-filtros.test.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): parsearFiltrosRegistros — filtros puros da Tela de Registros

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Infra — `registros-repository.ts`

**Files:**
- Create: `src/modules/shopfloor/infra/registros-repository.ts`

**Interfaces:**
- Consumes: `FiltrosRegistros` (Task 2), `createServerSupabase` (`@/shared/lib/supabase/server`).
- Produces: `RegistroRow`, `ResultadoRegistros`, `consultarRegistros(filtros, pagina, tamanho)`, `listarClientesRegistros()` — usados pela page (Task 4).

Modela em `src/modules/logs/infra/consulta-log-repository.ts` (mesmo padrão de `.range()` + `count`).

- [ ] **Step 1: Implementar** — `src/modules/shopfloor/infra/registros-repository.ts`:

```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { FiltrosRegistros } from '@/modules/shopfloor/domain/registros-filtros'

export interface RegistroRow {
  id: string
  data_hora: string
  colaborador: string
  posto: string
  pmo: string
  op: string
  cliente: string
  numero_caixa: string
  qtd_por_caixa: number | null
  status: string
  numero_serie: string
  codigo_defeito: string
  posicao: string
  tipo_defeito: string
  nqa_visual: string
  nqa_funcional: string
}

export interface ResultadoRegistros {
  linhas: RegistroRow[]
  total: number
}

const COLUNAS =
  'id,data_hora,colaborador,posto,pmo,op,cliente,numero_caixa,qtd_por_caixa,status,numero_serie,codigo_defeito,posicao,tipo_defeito,nqa_visual,nqa_funcional'

export async function consultarRegistros(
  filtros: FiltrosRegistros,
  pagina: number,
  tamanho: number,
): Promise<ResultadoRegistros> {
  const supabase = await createServerSupabase()
  let query = supabase.from('sf_registros').select(COLUNAS, { count: 'exact' })

  if (filtros.cliente) query = query.eq('cliente', filtros.cliente)
  if (filtros.posto) query = query.eq('posto', filtros.posto)
  if (filtros.snNorm) query = query.eq('numero_serie_norm', filtros.snNorm)
  if (filtros.status) {
    query = filtros.status === 'sem-status'
      ? query.eq('status', '')
      : query.eq('status', filtros.status)
  }
  if (filtros.busca) {
    const b = filtros.busca.replace(/[%,]/g, '') // evita quebrar o padrão do .or()
    query = query.or(`pmo.ilike.%${b}%,op.ilike.%${b}%`)
  }
  if (filtros.de) query = query.gte('data_hora', filtros.de)
  if (filtros.ate) query = query.lte('data_hora', filtros.ate)

  const inicio = pagina * tamanho
  const fim = inicio + tamanho - 1
  const { data, error, count } = await query
    .order('data_hora', { ascending: false })
    .range(inicio, fim)
  if (error) throw error
  return { linhas: (data ?? []) as RegistroRow[], total: count ?? 0 }
}

/** Clientes para o dropdown. Fonte = sf_ordens (tabela pequena) — clientes com
 *  registros são um subconjunto; filtrar por um sem registros só mostra vazio. */
export async function listarClientesRegistros(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('cliente')
  if (error) throw error
  const set = new Set(
    (data ?? []).map((r) => (r as { cliente: string }).cliente).filter(Boolean),
  )
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
```

- [ ] **Step 2: Verificar tipos** (sem teste unitário — precisa do Supabase; validado no build da Task 4)

Run: `npx tsc --noEmit` (ou confie no build da Task 5). Se rodar `tsc` puro sem heap: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`.
Expected: sem erros no arquivo novo.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/registros-repository.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): registros-repository — consulta paginada de sf_registros

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: UI — page + barra de filtros + tabela com modal

**Files:**
- Create: `src/app/(app)/shopfloor/registros/page.tsx`
- Create: `src/app/(app)/shopfloor/registros/registros-filtros.tsx`
- Create: `src/app/(app)/shopfloor/registros/registros-tabela.tsx`

**Interfaces:**
- Consumes: `consultarRegistros`, `listarClientesRegistros`, `RegistroRow` (Task 3); `parsearFiltrosRegistros` (Task 2); `listarPostos` (`@/modules/shopfloor/infra/ordem-repository`); `getSessao`, `podeNoModulo`, `SemPermissao`.

**Padrões a espelhar** (ler antes): `src/app/(app)/configuracoes/logs/page.tsx` (server + paginação + `hrefPagina`), `src/app/(app)/configuracoes/logs/logs-filtros.tsx` (barra client com `URLSearchParams` + `router.push` + sentinela `__todos__`), `src/components/ui/dialog.tsx` (Dialog/DialogContent/DialogHeader/DialogTitle/DialogTrigger), `src/app/(app)/shopfloor/ordens/page.tsx` (guard).

- [ ] **Step 1: `page.tsx` (server component)**

Requisitos:
- Guard: `const sessao = await getSessao(); if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return <SemPermissao descricao="Você não tem permissão para ver os registros." />`.
- `export const dynamic = 'force-dynamic'`.
- Ler `searchParams` (Next 16: `searchParams` é `Promise` — `const sp = await searchParams`). Campos: `cliente, busca, posto, sn, status, de, ate, pagina`.
- `const pagina = ...` (parse igual à logs/page.tsx: inteiro ≥ 0, default 0). `const TAMANHO_PAGINA = 25`.
- `const filtros = parsearFiltrosRegistros(sp)`.
- Carregar em paralelo: `const [{ linhas, total }, clientes, postos] = await Promise.all([consultarRegistros(filtros, pagina, TAMANHO_PAGINA), listarClientesRegistros(), listarPostos()])`.
- `totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))`, `temAnterior`, `temProxima`, `hrefPagina(n)` (preserva os filtros no query — igual à logs/page.tsx).
- Render: `<RegistrosFiltros clientes={clientes} postos={postos.map(p => p.chave)} />`, depois `<RegistrosTabela linhas={linhas} />`, depois a paginação (copiar o bloco de "Página X de Y" + ChevronLeft/Right com `hrefPagina`, como na logs/page.tsx). Mostrar `total` registros.

- [ ] **Step 2: `registros-filtros.tsx` (client)** — espelhar `logs-filtros.tsx`:
- `'use client'`; props `{ clientes: string[]; postos: string[] }`.
- Estados a partir de `searchParams`: `cliente, busca, posto, sn, status, de, ate`.
- Campos: Select **Cliente** (opções = `clientes`, + "Todos" via sentinela `__todos__`), Input **OP/PMO** (`busca`), Select **Posto** (opções = `postos`, + Todos), Input **SN** (`sn`), Select **Status** (opções fixas: `{valor:'aprovado',rotulo:'Aprovado'}`, `{valor:'reprovado',rotulo:'Reprovado'}`, `{valor:'sem-status',rotulo:'Sem status'}` + Todos), Inputs date **de**/**ate**.
- `aplicar()`: monta `URLSearchParams` só com os preenchidos e `router.push` (reinicia paginação — não inclui `pagina`). `limpar()`: `router.push(pathname)`.

- [ ] **Step 3: `registros-tabela.tsx` (client)** — tabela + modal:
- `'use client'`; prop `{ linhas: RegistroRow[] }` (importar o tipo de `@/modules/shopfloor/infra/registros-repository`).
- Estado `const [sel, setSel] = useState<RegistroRow | null>(null)`.
- `<Table>` com colunas: Data/Hora (formatar `data_hora` p/ `pt-BR`), Cliente, PMO·OP (`${pmo}·${op}`), Posto, SN (`numero_serie`), Status (Badge), Colaborador. Cada `<TableRow>` com `onClick={() => setSel(l)}` e `className="cursor-pointer"`. Vazio → linha "Nenhum registro encontrado.".
- `<Dialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>` com `<DialogContent>` mostrando os campos ricos do `sel`: Data/Hora, Cliente, PMO·OP, Posto, SN, Status, Colaborador, Nº caixa, Qtd/caixa, Código defeito, Posição, Tipo defeito, NQA visual, NQA funcional (usar um `<dl>` de rótulo/valor; omitir vazios ou mostrar "—").

- [ ] **Step 4: Verificar lint** (o build completo fica na Task 5)

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/shopfloor/registros/"
git commit -m "$(cat <<'EOF'
feat(shopfloor): Tela de Registros — page, filtros e tabela com detalhe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Menu + verificação final

**Files:**
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: o array `SHOPFLOOR` de itens de menu (formato `{ chave, rotulo, href, icone, modulo, perm }`).

- [ ] **Step 1: Adicionar o item de menu** — em `src/shared/ui/app-shell.tsx`:
- Importar um ícone do `lucide-react` ainda não usado no arquivo (ex.: `ScrollText`) — adicionar ao import existente de `lucide-react`.
- No array `SHOPFLOOR` (junto dos itens `pesquisa`/`dashboard`), adicionar:
```tsx
  { chave: 'registros', rotulo: 'Registros', href: '/shopfloor/registros', icone: ScrollText, modulo: 'shopfloor', perm: 'visualizar' },
```
(Posicionar logo após `dashboard`, antes de `op-ordens`.)

- [ ] **Step 2: Build completo**

Run: `npm run lint && NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; a rota `/shopfloor/registros` aparece na lista (ƒ, dinâmica).

- [ ] **Step 3: Commit**

```bash
git add src/shared/ui/app-shell.tsx
git commit -m "$(cat <<'EOF'
feat(shopfloor): item "Registros" no menu Fluxo de Processos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final (após as tasks)

- [ ] `npm run test` — suíte verde (inclui `parsearFiltrosRegistros`).
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — build limpo, rota `/shopfloor/registros` presente.
- [ ] Aplicar a **migração 0058 no Dev** (`supabase db push` linkado ao Dev) — controller/humano, pré-smoke.
- [ ] Smoke no preview: listar registros (mais recentes primeiro, paginado); filtrar por cliente/OP/posto/SN/status/período; clicar numa linha abre o detalhe; usuário sem `shopfloor.visualizar` não vê o item.

## Self-review (feito ao escrever)

- **Cobertura do spec:** rota+guard+menu (Tasks 4/5) · filtros incl. Status (Tasks 2/4) · colunas essenciais + modal (Task 4) · paginação server-side (Tasks 3/4) · índices (Task 1) · sem RLS/export/edição. ✓
- **Sem placeholders:** código completo nas partes determinísticas (migração, domínio, infra); UI com skeleton + padrões exatos a espelhar (arquivos citados) + os campos/props precisos.
- **Consistência de tipos:** `FiltrosRegistros` (Task 2) usado igual em `consultarRegistros` (Task 3) e na page (Task 4); `RegistroRow` (Task 3) consumido na tabela (Task 4).
- **Nota:** dropdown de cliente vem de `sf_ordens` (barato) — decisão registrada; clientes sem registros mostram tabela vazia (aceitável).
