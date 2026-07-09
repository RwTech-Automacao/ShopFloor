# ShopFloor Enterplak — Plano: Etiquetas (Part Number) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o Apps Script de etiquetas: buscar processos, gerar o CSV de Part Number (uma etiqueta por volume) com as regras validadas, baixar no navegador e registrar cada geração.

**Architecture:** Domínio puro/testado (regras do Part Number, travadas no exemplo validado); Server Action autoritativa que gera + registra + loga; UI de busca/seleção/geração + histórico.

**Tech Stack:** Next.js 16 App Router + TS strict, Tailwind v4 + shadcn/Base UI, Supabase (Postgres/RLS), Vitest.

## Global Constraints

- pt-BR; TS strict (sem `any`); cor `enterplak`.
- **Part Number** = `CÓDIGO-` + `PEDIDO_FMT` + `DOC` + `SEQ` (regras na Task 2, validadas contra o Apps Script).
- CSV `[PARTNUMBER, CODIGO, VOLUME]`, **sem cabeçalho**, campos entre aspas, CRLF. Arquivo `Etiquetas_partnumber_YYYYMMDD_HHMMSS.csv`. **Não** armazenado.
- Linhas incompletas (sem código, pedido ou documento) são puladas.
- Permissão para gerar: `gerar_etiqueta`; ver histórico: `visualizar`.
- Cada geração registra em `geracoes_etiquetas` + `registrarLog('etiqueta', …, 'gerar_etiqueta', …)`.
- Padrões existentes: Server Actions checam permissão (`getSessao`/`podeFazer`); `registrarLog`; busca com `.or(...ilike...)` (ver `processo-repository.ts`); download client via Blob.
- Spec: `docs/superpowers/specs/2026-07-09-etiquetas-design.md`.

---

## Task 1: Migration 0012 — `geracoes_etiquetas`

**Files:** Create `supabase/migrations/0012_geracoes_etiquetas.sql`

- [ ] **Step 1: Escrever a migration**

```sql
create table public.geracoes_etiquetas (
  id uuid primary key default gen_random_uuid(),
  filtro_tipo text not null check (filtro_tipo in ('nf','emb','fornecedor')),
  filtro_valor text not null default '',
  total_processos int not null default 0,
  total_etiquetas int not null default 0,
  processo_ids jsonb not null default '[]'::jsonb,
  usuario_id uuid references public.usuarios(id),
  usuario_nome text not null default '',
  created_at timestamptz not null default now()
);
create index geracoes_etiquetas_created_idx on public.geracoes_etiquetas(created_at desc);

alter table public.geracoes_etiquetas enable row level security;
create policy geracoes_select on public.geracoes_etiquetas
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy geracoes_insert on public.geracoes_etiquetas
  for insert to authenticated with check (public.tem_permissao('gerar_etiqueta') and usuario_id = auth.uid());
```

- [ ] **Step 2: Aplicar e verificar**

`supabase db push` (com `SUPABASE_GO_BINARY=$HOME/.local/share/supabase/supabase-go` se necessário). Verificar: `supabase db query --linked "select count(*) from geracoes_etiquetas;"` (0) e a policy de insert exige `gerar_etiqueta`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_geracoes_etiquetas.sql
git commit -m "feat(db): tabela geracoes_etiquetas (histórico de etiquetas) com RLS"
```

---

## Task 2: Domínio do Part Number (TS puro, TDD) — PRODUÇÃO-CRÍTICO

**Files:** Create `src/modules/etiquetas/domain/partnumber.ts` + `__tests__/partnumber.test.ts`

**Interfaces:**
- Produces:
  - `type ProcessoEtiqueta = { id: string; codigoMaterial: string|null; numeroPedido: string|null; diInpi: string|null; numeroNf: string|null; volumes: number|null }`
  - `type LinhaEtiqueta = { partNumber: string; codigo: string; volume: string }`
  - `normalizarCodigo`, `formatarPedido`, `resolverDoc`, `padSeq`, `formatarVolume`, `montarPartNumber`
  - `gerarEtiquetasDoProcesso(p: ProcessoEtiqueta): { incompleto: boolean; etiquetas: LinhaEtiqueta[] }`
  - `gerarCsv(linhas: LinhaEtiqueta[]): string`

- [ ] **Step 1: Escrever os testes (travados no exemplo validado)**

Criar `src/modules/etiquetas/domain/__tests__/partnumber.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizarCodigo, formatarPedido, resolverDoc, padSeq, formatarVolume,
  gerarEtiquetasDoProcesso, gerarCsv,
} from '../partnumber'

describe('formatarPedido', () => {
  it('0529/26 -> 052926', () => { expect(formatarPedido('0529/26')).toBe('052926') })
  it('1234/25 -> 123425', () => { expect(formatarPedido('1234/25')).toBe('123425') })
  it('vazio -> vazio', () => { expect(formatarPedido('')).toBe('') })
})
describe('resolverDoc', () => {
  it('usa DI/INPI (só dígitos) quando presente', () => {
    expect(resolverDoc('26BR0000902016-1', '999')).toBe('2600009020161')
  })
  it('cai para a NF quando DI/INPI vazio', () => {
    expect(resolverDoc('', '12345')).toBe('12345')
  })
})
describe('padSeq / formatarVolume', () => {
  it('2 dígitos por padrão, 3 se total >= 100', () => {
    expect(padSeq(1, 13)).toBe('01')
    expect(padSeq(1, 120)).toBe('001')
  })
  it('formatarVolume 1 de 13 -> 01-13', () => { expect(formatarVolume(1, 13)).toBe('01-13') })
})
describe('normalizarCodigo', () => {
  it('remove hífens finais', () => { expect(normalizarCodigo('RWCN98-')).toBe('RWCN98') })
})

describe('gerarEtiquetasDoProcesso (exemplo validado RWCN98)', () => {
  const p = {
    id: 'x', codigoMaterial: 'RWCN98', numeroPedido: '0529/26',
    diInpi: '26BR0000902016-1', numeroNf: null, volumes: 13,
  }
  const r = gerarEtiquetasDoProcesso(p)
  it('não é incompleto e gera 13 etiquetas', () => {
    expect(r.incompleto).toBe(false)
    expect(r.etiquetas).toHaveLength(13)
  })
  it('primeiro e último Part Number exatos', () => {
    expect(r.etiquetas[0]).toEqual({ partNumber: 'RWCN98-052926260000902016101', codigo: 'RWCN98', volume: '01-13' })
    expect(r.etiquetas[12]).toEqual({ partNumber: 'RWCN98-052926260000902016113', codigo: 'RWCN98', volume: '13-13' })
  })
  it('marca incompleto quando falta pedido', () => {
    expect(gerarEtiquetasDoProcesso({ ...p, numeroPedido: null }).incompleto).toBe(true)
  })
})

describe('gerarCsv', () => {
  it('aspas, CRLF, sem cabeçalho', () => {
    const csv = gerarCsv([{ partNumber: 'A', codigo: 'B', volume: '01-01' }])
    expect(csv).toBe('"A","B","01-01"')
  })
})
```

- [ ] **Step 2: Rodar (falha), implementar, rodar (passa)**

Criar `src/modules/etiquetas/domain/partnumber.ts`:

```ts
export type ProcessoEtiqueta = {
  id: string
  codigoMaterial: string | null
  numeroPedido: string | null
  diInpi: string | null
  numeroNf: string | null
  volumes: number | null
}
export type LinhaEtiqueta = { partNumber: string; codigo: string; volume: string }

function safe(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}
function onlyDigits(v: unknown): string {
  return safe(v).replace(/\D/g, '')
}
function padLeft(s: string, width: number): string {
  return s.length >= width ? s : '0'.repeat(width - s.length) + s
}

export function normalizarCodigo(codigo: unknown): string {
  return safe(codigo).replace(/-+$/, '')
}
export function formatarPedido(pedido: unknown): string {
  const p = safe(pedido)
  if (!p) return ''
  const m = p.match(/^\s*(\d+)\s*\/\s*(\d{2,4})\s*$/)
  if (m) {
    const num = padLeft(m[1]!, 4)
    let yy = m[2]!
    if (yy.length === 4) yy = yy.slice(-2)
    return `${num}${yy}`
  }
  const digits = onlyDigits(p)
  if (digits.length >= 6) return digits.slice(0, 4) + digits.slice(-2)
  return padLeft(digits, 4)
}
export function resolverDoc(diInpi: unknown, nf: unknown): string {
  const d = onlyDigits(diInpi)
  return d || onlyDigits(nf)
}
export function padSeq(i: number, total: number): string {
  const width = total >= 100 ? 3 : 2
  return padLeft(String(i), width)
}
export function formatarVolume(i: number, total: number): string {
  return `${padSeq(i, total)}-${padSeq(total, total)}`
}
export function montarPartNumber(codigoBase: string, pedidoFmt: string, doc: string, seq: string): string {
  return `${codigoBase}-${pedidoFmt}${doc}${seq}`
}

export function gerarEtiquetasDoProcesso(
  p: ProcessoEtiqueta,
): { incompleto: boolean; etiquetas: LinhaEtiqueta[] } {
  const codigoBase = normalizarCodigo(p.codigoMaterial)
  const pedidoFmt = formatarPedido(p.numeroPedido)
  const doc = resolverDoc(p.diInpi, p.numeroNf)
  if (!codigoBase || !pedidoFmt || !doc) return { incompleto: true, etiquetas: [] }

  let volumes = typeof p.volumes === 'number' ? p.volumes : parseInt(String(p.volumes), 10)
  if (!Number.isFinite(volumes) || volumes <= 0) volumes = 1

  const etiquetas: LinhaEtiqueta[] = []
  for (let i = 1; i <= volumes; i++) {
    const seq = padSeq(i, volumes)
    etiquetas.push({
      partNumber: montarPartNumber(codigoBase, pedidoFmt, doc, seq),
      codigo: codigoBase,
      volume: formatarVolume(i, volumes),
    })
  }
  return { incompleto: false, etiquetas }
}

export function gerarCsv(linhas: LinhaEtiqueta[]): string {
  const aspas = (c: string) => `"${String(c).replace(/"/g, '""')}"`
  return linhas.map((l) => [l.partNumber, l.codigo, l.volume].map(aspas).join(',')).join('\r\n')
}
```

- [ ] **Step 3: Build + commit**

```bash
npm test -- partnumber
npm test && npm run build
git add src/modules/etiquetas/domain/
git commit -m "feat(etiquetas): domínio do Part Number (regras validadas contra o Apps Script) — TDD"
```

---

## Task 3: Infra + Server Action (buscar, gerar, registrar)

**Files:**
- Create: `src/modules/etiquetas/infra/etiqueta-repository.ts`
- Create: `src/modules/etiquetas/application/gerar-etiquetas.ts`

**Interfaces:**
- Produces:
  - `buscarProcessosParaEtiqueta({ tipo: 'nf'|'emb'|'fornecedor'; termo: string }): Promise<ProcessoEtiqueta[]>` — busca em `processos_recebimento` por `numero_nf`/`numero_emb`/`fornecedor` (ilike), retornando os campos de `ProcessoEtiqueta` (id, codigo_material, numero_pedido, di_inpi, numero_nf, volumes).
  - `registrarGeracao(dados): Promise<void>`; `listarGeracoes(): Promise<GeracaoRow[]>`.
  - Server Action `gerarEtiquetas({ processoIds, filtroTipo, filtroValor }): Promise<{ ok:true; csv:string; fileName:string; totalEtiquetas:number; totalProcessos:number; ignorados:number } | { ok:false; erro:string }>`.

- [ ] **Step 1: Repositório**

`etiqueta-repository.ts`: `buscarProcessosParaEtiqueta` (sanitizar o termo p/ `.or(...ilike...)` como em `processo-repository.ts`; mapear snake→camel para `ProcessoEtiqueta`); `carregarProcessosPorId(ids: string[])` (`in('id', ids)`); `registrarGeracao` (insert em `geracoes_etiquetas`); `listarGeracoes` (order created_at desc, join usuarios(nome) ou usar usuario_nome snapshot).

- [ ] **Step 2: Server Action**

`gerar-etiquetas.ts` (`'use server'`): 
1. `getSessao`; se `!podeFazer('gerar_etiqueta')` → `{ok:false, erro}`.
2. `carregarProcessosPorId(processoIds)`.
3. Para cada processo, `gerarEtiquetasDoProcesso`; acumular as linhas das completas; contar `ignorados` (incompletas).
4. Se nenhuma etiqueta → `{ok:false, erro:'Nenhuma etiqueta a gerar (itens incompletos).'}`.
5. `csv = gerarCsv(linhas)`; `fileName = 'Etiquetas_partnumber_' + <timestamp> + '.csv'` (o timestamp vem de `new Date()` — código de app, OK).
6. `registrarGeracao({ filtroTipo, filtroValor, totalProcessos, totalEtiquetas, processoIds, usuarioId, usuarioNome })` + `registrarLog('etiqueta', geracaoId?, 'gerar_etiqueta', descricao, { totalEtiquetas, totalProcessos })`.
7. Retorna `{ ok:true, csv, fileName, totalEtiquetas, totalProcessos, ignorados }`.

- [ ] **Step 3: Build + commit**

```bash
npm test && npm run build
git add src/modules/etiquetas/
git commit -m "feat(etiquetas): busca de processos + Server Action de geração (registra + loga)"
```

---

## Task 4: UI — tela de Etiquetas (busca/seleção/geração/download) + Histórico

**Files:**
- Create: `src/app/(app)/recebimento/etiquetas/page.tsx` + `etiquetas-cliente.tsx`
- Create: `src/app/(app)/recebimento/etiquetas/historico/page.tsx`
- Modify: `src/shared/ui/recebimento-nav.ts` (+ item Etiquetas) e o teste `recebimento-nav.test.ts`

- [ ] **Step 1: Tela de Etiquetas**

`etiquetas/page.tsx` (Server Component): valida `gerar_etiqueta` (senão redireciona/mostra sem acesso). Renderiza `<EtiquetasCliente>`.
`etiquetas-cliente.tsx` (`'use client'`): radio NF/EMB/Fornecedor + input de busca → chama uma Server Action de busca (ou route) `buscarProcessosParaEtiqueta`; lista com checkbox por processo (código, pedido, doc, volumes, prévia do 1º Part Number via `gerarEtiquetasDoProcesso` no cliente); marca incompletos (desabilita seleção). Botão **Gerar etiquetas (CSV)** → chama `gerarEtiquetas({processoIds, filtroTipo, filtroValor})`; ao receber `{csv, fileName}`, dispara o **download** via Blob (`new Blob([csv], {type:'text/csv'})` + link temporário). Mostra "X etiquetas de Y processos (Z ignorados)".

- [ ] **Step 2: Histórico**

`etiquetas/historico/page.tsx` (Server Component): `listarGeracoes()` → tabela (Data/hora pt-BR, Usuário, Filtro, Nº processos, Nº etiquetas). Read-only.

- [ ] **Step 3: Navegação**

`recebimento-nav.ts`: adicionar `{chave:'etiquetas', rotulo:'Etiquetas', href:'/recebimento/etiquetas'}` (e opcionalmente Histórico). Atualizar `recebimento-nav.test.ts`.

- [ ] **Step 4: Build + commit**

```bash
npm test && npm run build
git add "src/app/(app)/recebimento/etiquetas/" src/shared/ui/recebimento-nav.ts src/shared/ui/__tests__/recebimento-nav.test.ts
git commit -m "feat(etiquetas): tela de geração (busca/seleção/download CSV) + histórico + nav"
```

---

## Self-Review (autor do plano)

**1. Cobertura do spec:** regras do Part Number (Task 2, travadas no exemplo validado) ✅; busca por NF/EMB/Fornecedor (Task 3) ✅; geração + download CSV sem armazenar (Tasks 3, 4) ✅; histórico + tabela `geracoes_etiquetas` (Tasks 1, 4) ✅; permissão `gerar_etiqueta` + log (Tasks 1, 3) ✅.

**2. Placeholders:** domínio, migration e o contrato da Server Action têm código verbatim (o domínio é produção-crítico e vem 1:1 do Apps Script validado); a UI segue padrões existentes (`configuracoes/logs`, `processos-filtros`, download via Blob). Revisão pesada nas Tasks 2 e 3; leve na 4.

**3. Consistência de tipos:** `ProcessoEtiqueta`, `LinhaEtiqueta`, `gerarEtiquetasDoProcesso`, `gerarCsv`, `buscarProcessosParaEtiqueta`, `gerarEtiquetas` usados de forma idêntica. `geracoes_etiquetas` referenciada por infra/Server Action. Colunas lidas (`codigo_material`, `numero_pedido`, `di_inpi`, `numero_nf`, `numero_emb`, `fornecedor`, `volumes`) existem em `processos_recebimento`.
