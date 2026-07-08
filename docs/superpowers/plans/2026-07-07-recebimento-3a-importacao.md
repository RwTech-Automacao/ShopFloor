# ShopFloor Enterplak — Plano 3A: Recebimento (Importação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o wizard de importação de planilhas (.xlsx/.csv → Processos de Recebimento), a importação transacional, o histórico de importações e uma lista básica de processos.

**Architecture:** Camadas dos planos anteriores (`app/` fino → `modules/recebimento/{domain,application,infra}`, domínio TS puro). Parsing no navegador (SheetJS); importação atômica via função Postgres (RPC) sob RLS.

**Tech Stack:** Next.js 16 App Router + TS strict, Tailwind v4 + shadcn/Base UI, Supabase (Postgres/RLS/RPC), SheetJS (`xlsx`), Vitest.

## Global Constraints

- Idioma pt-BR; TS strict (sem `any`); cor `enterplak`.
- Parsing **no cliente**; arquivo bruto não vai ao servidor.
- Importação **transacional** (RPC): ou cria a importação + todos os processos + 1 log, ou nada.
- **Um log `importar` por importação** (não um por processo).
- Toda gravação respeita RLS; a RPC é **SECURITY INVOKER** (o usuário precisa de `importar`).
- Processos criados nascem com status `aberto`.
- Padrões existentes: Server Actions checam permissão via `getSessao`/`podeFazer`; formulários usam `useActionState` (ver `src/app/(app)/configuracoes/usuarios/usuario-form.tsx`).
- Spec: `docs/superpowers/specs/2026-07-07-recebimento-3a-importacao-design.md`.

---

## Task 1: Domínio de importação (mapeamento, conversão, validação) + SheetJS

**Files:**
- Create: `src/modules/recebimento/domain/mapeamento.ts` (+ test)
- Create: `src/modules/recebimento/domain/conversao.ts` (+ test)
- Create: `src/modules/recebimento/domain/validacao-linha.ts` (+ test)
- Test dir: `src/modules/recebimento/domain/__tests__/`

**Interfaces:**
- Produces:
  - `type CampoImportavel = { campo: string; rotulo: string; tipo: 'texto'|'lista'|'numero'|'data'; listaChave: string|null; obrigatorioImportacao: boolean }`
  - `normalizarNome(s: string): string`
  - `sugerirMapeamento(colunas: string[], campos: CampoImportavel[]): Record<string, string>` — mapeia `campo → coluna` sugerida (só match por nome normalizado).
  - `type ResultadoConversao = { ok: true; valor: string|number|null } | { ok: false; erro: string }`
  - `converterValor(bruto: unknown, tipo: CampoImportavel['tipo'], itensLista?: string[]): ResultadoConversao`
  - `type LinhaValidada = { valores: Record<string, string|number|null>; erros: { campo: string; erro: string }[] }`
  - `validarLinha(linhaMapa: Record<string, unknown>, campos: CampoImportavel[], itensPorLista: Record<string, string[]>): LinhaValidada`

- [ ] **Step 1: Instalar SheetJS**

```bash
npm install xlsx
```

- [ ] **Step 2: Teste de `normalizarNome` + `sugerirMapeamento`**

Criar `src/modules/recebimento/domain/__tests__/mapeamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizarNome, sugerirMapeamento } from '../mapeamento'

const campos = [
  { campo: 'numero_pedido', rotulo: 'Nº Pedido', tipo: 'texto', listaChave: null, obrigatorioImportacao: true },
  { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'lista', listaChave: 'fornecedor', obrigatorioImportacao: false },
] as const

describe('normalizarNome', () => {
  it('remove acento, pontuação e caixa', () => {
    expect(normalizarNome('Nº Pedido')).toBe('n pedido'.replace(' ', ' '))
  })
})

describe('sugerirMapeamento', () => {
  it('casa coluna com campo por nome normalizado (rótulo)', () => {
    const m = sugerirMapeamento(['Fornecedor', 'Nº Pedido'], [...campos])
    expect(m['fornecedor']).toBe('Fornecedor')
    expect(m['numero_pedido']).toBe('Nº Pedido')
  })
  it('não sugere quando não há coluna correspondente', () => {
    const m = sugerirMapeamento(['Outra Coluna'], [...campos])
    expect(m['fornecedor']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Rodar (falha), implementar `mapeamento.ts`, rodar (passa)**

Run: `npm test -- mapeamento` (FAIL). Criar `src/modules/recebimento/domain/mapeamento.ts`:

```ts
export type CampoImportavel = {
  campo: string
  rotulo: string
  tipo: 'texto' | 'lista' | 'numero' | 'data'
  listaChave: string | null
  obrigatorioImportacao: boolean
}

export function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function sugerirMapeamento(
  colunas: string[],
  campos: CampoImportavel[],
): Record<string, string> {
  const porNorma = new Map(colunas.map((c) => [normalizarNome(c), c]))
  const sugestao: Record<string, string> = {}
  for (const campo of campos) {
    const alvo = porNorma.get(normalizarNome(campo.rotulo))
    if (alvo) sugestao[campo.campo] = alvo
  }
  return sugestao
}
```

Run: `npm test -- mapeamento` (PASS).

> Nota: ajuste a asserção do primeiro teste se preferir — o ponto é `normalizarNome('Nº Pedido') === 'n pedido'`.

- [ ] **Step 4: Teste + implementação de `converterValor`**

Criar `src/modules/recebimento/domain/__tests__/conversao.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { converterValor } from '../conversao'

describe('converterValor', () => {
  it('numero válido', () => {
    expect(converterValor('1481', 'numero')).toEqual({ ok: true, valor: 1481 })
  })
  it('numero inválido', () => {
    const r = converterValor('abc', 'numero')
    expect(r.ok).toBe(false)
  })
  it('data serial do Excel vira ISO', () => {
    const r = converterValor(46239, 'data')
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.valor)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('lista aceita valor existente e rejeita inexistente', () => {
    expect(converterValor('AVNET', 'lista', ['AVNET']).ok).toBe(true)
    expect(converterValor('X', 'lista', ['AVNET']).ok).toBe(false)
  })
  it('texto vazio vira null', () => {
    expect(converterValor('', 'texto')).toEqual({ ok: true, valor: null })
  })
})
```

Run (FAIL). Criar `src/modules/recebimento/domain/conversao.ts`:

```ts
export type ResultadoConversao =
  | { ok: true; valor: string | number | null }
  | { ok: false; erro: string }

// Excel serial date (base 1899-12-30) → 'YYYY-MM-DD'
function serialParaISO(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export function converterValor(
  bruto: unknown,
  tipo: 'texto' | 'lista' | 'numero' | 'data',
  itensLista?: string[],
): ResultadoConversao {
  const vazio = bruto === null || bruto === undefined || String(bruto).trim() === ''
  if (vazio) return { ok: true, valor: null }
  const texto = String(bruto).trim()

  if (tipo === 'numero') {
    const n = Number(texto.replace(',', '.'))
    return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: 'Número inválido' }
  }
  if (tipo === 'data') {
    if (typeof bruto === 'number') {
      const iso = serialParaISO(bruto)
      return iso ? { ok: true, valor: iso } : { ok: false, erro: 'Data inválida' }
    }
    const d = new Date(texto)
    return Number.isNaN(d.getTime())
      ? { ok: false, erro: 'Data inválida' }
      : { ok: true, valor: d.toISOString().slice(0, 10) }
  }
  if (tipo === 'lista') {
    if (itensLista && !itensLista.includes(texto)) {
      return { ok: false, erro: 'Valor fora da lista' }
    }
    return { ok: true, valor: texto }
  }
  return { ok: true, valor: texto }
}
```

Run (PASS).

- [ ] **Step 5: Teste + implementação de `validarLinha`**

Criar `src/modules/recebimento/domain/__tests__/validacao-linha.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarLinha } from '../validacao-linha'

const campos = [
  { campo: 'numero_pedido', rotulo: 'Nº Pedido', tipo: 'texto', listaChave: null, obrigatorioImportacao: true },
  { campo: 'quantidade_pedido', rotulo: 'Qtd', tipo: 'numero', listaChave: null, obrigatorioImportacao: true },
] as const

describe('validarLinha', () => {
  it('erro quando obrigatório está vazio', () => {
    const r = validarLinha({ numero_pedido: '', quantidade_pedido: '10' }, [...campos], {})
    expect(r.erros.some((e) => e.campo === 'numero_pedido')).toBe(true)
  })
  it('erro quando número é inválido', () => {
    const r = validarLinha({ numero_pedido: '0654/26', quantidade_pedido: 'x' }, [...campos], {})
    expect(r.erros.some((e) => e.campo === 'quantidade_pedido')).toBe(true)
  })
  it('linha válida não tem erros e converte valores', () => {
    const r = validarLinha({ numero_pedido: '0654/26', quantidade_pedido: '10' }, [...campos], {})
    expect(r.erros).toEqual([])
    expect(r.valores.quantidade_pedido).toBe(10)
  })
})
```

Run (FAIL). Criar `src/modules/recebimento/domain/validacao-linha.ts`:

```ts
import { converterValor } from './conversao'
import type { CampoImportavel } from './mapeamento'

export type LinhaValidada = {
  valores: Record<string, string | number | null>
  erros: { campo: string; erro: string }[]
}

export function validarLinha(
  linhaMapa: Record<string, unknown>,
  campos: CampoImportavel[],
  itensPorLista: Record<string, string[]>,
): LinhaValidada {
  const valores: Record<string, string | number | null> = {}
  const erros: { campo: string; erro: string }[] = []

  for (const campo of campos) {
    const bruto = linhaMapa[campo.campo]
    const itens = campo.listaChave ? itensPorLista[campo.listaChave] : undefined
    const r = converterValor(bruto, campo.tipo, itens)
    if (!r.ok) {
      erros.push({ campo: campo.campo, erro: r.erro })
      continue
    }
    if (campo.obrigatorioImportacao && (r.valor === null || r.valor === '')) {
      erros.push({ campo: campo.campo, erro: 'Campo obrigatório' })
    }
    valores[campo.campo] = r.valor
  }
  return { valores, erros }
}
```

Run (PASS).

- [ ] **Step 6: Suíte + build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/domain/ package.json package-lock.json
git commit -m "feat(recebimento): domínio de importação — mapeamento, conversão e validação (TDD) + SheetJS"
```

---

## Task 2: RPC transacional `importar_processos` (migration 0008)

**Files:**
- Create: `supabase/migrations/0008_rpc_importar_processos.sql`

**Interfaces:**
- Produces: função `public.importar_processos(p_arquivo_nome text, p_formato text, p_mapeamento jsonb, p_linhas jsonb) returns jsonb` — cria importacao + N processos + 1 log; retorna `{importacao_id, total}`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0008_rpc_importar_processos.sql`:

```sql
create or replace function public.importar_processos(
  p_arquivo_nome text,
  p_formato text,
  p_mapeamento jsonb,
  p_linhas jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_total int;
  v_nome text;
begin
  insert into public.importacoes (arquivo_nome, formato, total_linhas, mapeamento, usuario_id)
  values (p_arquivo_nome, p_formato, coalesce(jsonb_array_length(p_linhas), 0), p_mapeamento, auth.uid())
  returning id into v_id;

  insert into public.processos_recebimento (
    importacao_id, status, criado_por,
    numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido,
    data_chegada, data_compra, data_prevista,
    atraso, tipo, comprador, fornecedor, critico,
    codigo_material, descricao_material, quantidade_pedido
  )
  select
    v_id, 'aberto', auth.uid(),
    r.numero_nf, r.numero_emb, r.di_inpi, r.acp_cliente, r.numero_pedido,
    r.data_chegada, r.data_compra, r.data_prevista,
    r.atraso, r.tipo, r.comprador, r.fornecedor, r.critico,
    r.codigo_material, r.descricao_material, r.quantidade_pedido
  from jsonb_populate_recordset(null::public.processos_recebimento, p_linhas) r;

  get diagnostics v_total = row_count;

  update public.importacoes set total_processos_criados = v_total where id = v_id;

  select nome into v_nome from public.usuarios where id = auth.uid();

  insert into public.logs (entidade, entidade_id, acao, descricao, dados, usuario_id, usuario_nome)
  values (
    'importacao', v_id, 'importar',
    format('Importação de %s: %s processo(s) criado(s)', p_arquivo_nome, v_total),
    jsonb_build_object('arquivo', p_arquivo_nome, 'formato', p_formato, 'total', v_total, 'mapeamento', p_mapeamento),
    auth.uid(), coalesce(v_nome, '')
  );

  return jsonb_build_object('importacao_id', v_id, 'total', v_total);
end;
$$;
```

- [ ] **Step 2: Aplicar e verificar com uma importação real de teste**

```bash
supabase db push
```
Verificar via `supabase db query --linked` (se o shim exigir `SUPABASE_GO_BINARY`, reutilizar o workaround já usado nos planos anteriores). Como a função é `security invoker` e `auth.uid()` é nulo fora de uma sessão autenticada, o teste de fumaça é estrutural: confirmar que a função existe e compila:

```bash
supabase db query --linked "select proname, prosecdef from pg_proc where proname='importar_processos';"
# Espera: 1 linha, prosecdef=false (invoker)
```

O teste funcional ponta a ponta acontece no smoke da UI (Task 5), quando há um usuário autenticado com `importar`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_rpc_importar_processos.sql
git commit -m "feat(db): RPC transacional importar_processos (importacao + processos + log)"
```

---

## Task 3: Repositórios e casos de uso (importação, processos, importações)

**Files:**
- Create: `src/modules/recebimento/infra/importacao-repository.ts`
- Create: `src/modules/recebimento/infra/processo-repository.ts`
- Create: `src/modules/recebimento/infra/campo-comercial-repository.ts`
- Create: `src/modules/recebimento/application/importar-planilha.ts`

**Interfaces:**
- Consumes: `createServerSupabase`, `getSessao`, `podeFazer`, `CampoImportavel`.
- Produces:
  - `carregarCamposEImportacao(): Promise<{ campos: CampoImportavel[]; itensPorLista: Record<string,string[]> }>` — lê `configuracao_campos` (origem=comercial, ativo) + itens ativos das listas usadas. (Para o cliente montar mapeamento/validação.)
  - `importarPlanilha(payload: { arquivoNome: string; formato: 'xlsx'|'csv'; mapeamento: Record<string,string>; linhas: Record<string, string|number|null>[] }): Promise<{ ok: true; importacaoId: string; total: number } | { ok: false; erro: string }>` — Server Action: valida `importar`, chama a RPC, retorna resultado.
  - `listarImportacoes(): Promise<ImportacaoRow[]>`
  - `listarProcessos({ pagina, tamanho }): Promise<{ linhas: ProcessoResumoRow[]; total: number }>`

- [ ] **Step 1: Implementar `campo-comercial-repository.ts`**

`carregarCamposComerciais()`: `select` em `configuracao_campos` onde `origem='comercial' and ativo=true` order by `ordem`, mapeando para `CampoImportavel`. `carregarItensPorLista(chaves: string[])`: para cada `listaChave` distinta, buscar `lista_itens.valor` ativos (`join listas`). Retornar `Record<listaChave, string[]>`. Ambos via `createServerSupabase()`.

- [ ] **Step 2: Implementar `importacao-repository.ts`**

- `chamarImportarProcessos(payload)`: `createServerSupabase().rpc('importar_processos', { p_arquivo_nome, p_formato, p_mapeamento, p_linhas })`; retorna `{ importacaoId, total }` ou lança em erro.
- `listarImportacoes()`: `select id, arquivo_nome, formato, total_processos_criados, created_at, usuario_id, usuarios(nome)` order by `created_at desc`.

- [ ] **Step 3: Implementar `processo-repository.ts`**

`listarProcessos({pagina,tamanho})`: `select id, numero, numero_nf, fornecedor, codigo_material, descricao_material, status, { count:'exact' }` order by `numero desc`, `.range(...)`. Retorna `{linhas,total}`.

- [ ] **Step 4: Implementar a Server Action `importar-planilha.ts`**

`src/modules/recebimento/application/importar-planilha.ts` (`'use server'`):

```ts
'use server'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { chamarImportarProcessos } from '../infra/importacao-repository'

export async function importarPlanilha(payload: {
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<{ ok: true; importacaoId: string; total: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) {
    return { ok: false, erro: 'Você não tem permissão para importar.' }
  }
  if (payload.linhas.length === 0) return { ok: false, erro: 'Nenhuma linha para importar.' }
  try {
    const r = await chamarImportarProcessos(payload)
    return { ok: true, importacaoId: r.importacaoId, total: r.total }
  } catch {
    return { ok: false, erro: 'Falha ao importar. Nenhum dado foi gravado.' }
  }
}
```

- [ ] **Step 5: Build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/infra/ src/modules/recebimento/application/
git commit -m "feat(recebimento): repositórios e ação de importação (RPC), listas de processos/importações"
```

---

## Task 4: Layout do Recebimento + lista de Processos + histórico de Importações

**Files:**
- Create: `src/app/(app)/recebimento/layout.tsx`
- Create: `src/app/(app)/recebimento/processos/page.tsx`
- Create: `src/app/(app)/recebimento/importacoes/page.tsx`
- Modify: `src/shared/ui/nav-config.ts` (sub-itens do Recebimento, se aplicável)

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, `listarProcessos`, `listarImportacoes`.

- [ ] **Step 1: Layout com guard `visualizar`**

`(app)/recebimento/layout.tsx`: `getSessao()`; se `!sessao || !podeFazer(sessao.perfil,'visualizar')` → `redirect('/home')`. Sub-nav do Recebimento: **Importar Planilha** (`/recebimento/importar`), **Processos** (`/recebimento/processos`), **Importações** (`/recebimento/importacoes`). (Etiquetas fica para o Incremento 2.)

- [ ] **Step 2: Lista de Processos**

`recebimento/processos/page.tsx` (Server Component): lê `searchParams.pagina`, chama `listarProcessos`, tabela (Número, Nº NF, Fornecedor, Código — Descrição, Status como badge), paginação. Read-only no 3A (o detalhe/edição é 3B).

- [ ] **Step 3: Histórico de Importações**

`recebimento/importacoes/page.tsx` (Server Component): chama `listarImportacoes`, tabela (Arquivo, Formato, Nº de processos, Data/hora pt-BR, Usuário).

- [ ] **Step 4: Build + commit**

```bash
npm test && npm run build
git add "src/app/(app)/recebimento/" src/shared/ui/nav-config.ts
git commit -m "feat(recebimento): layout + lista de processos + histórico de importações"
```

---

## Task 5: Wizard de importação (4 passos)

**Files:**
- Create: `src/app/(app)/recebimento/importar/page.tsx`
- Create: `src/app/(app)/recebimento/importar/wizard-importacao.tsx`
- Create: `src/modules/recebimento/domain/ler-planilha.ts` (wrapper SheetJS — client)

**Interfaces:**
- Consumes: `carregarCamposComerciais`/`carregarItensPorLista` (via a Server Component que passa os dados ao wizard), `sugerirMapeamento`, `validarLinha`, `importarPlanilha` (Server Action), SheetJS.
- Produces: `lerPlanilha(file: File): Promise<{ colunas: string[]; linhas: Record<string, unknown>[] }>`.

- [ ] **Step 1: Wrapper de leitura SheetJS**

`src/modules/recebimento/domain/ler-planilha.ts` (executa no cliente):

```ts
import * as XLSX from 'xlsx'

export async function lerPlanilha(
  file: File,
): Promise<{ colunas: string[]; linhas: Record<string, unknown>[] }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { colunas: [], linhas: [] }
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const colunas = linhas.length > 0 ? Object.keys(linhas[0]!) : []
  return { colunas, linhas }
}
```

- [ ] **Step 2: Página (Server Component) que carrega campos/itens e monta o wizard**

`recebimento/importar/page.tsx`: valida `importar` (senão redireciona); chama `carregarCamposComerciais()` + `carregarItensPorLista(...)`; renderiza `<WizardImportacao campos={...} itensPorLista={...} />`.

- [ ] **Step 3: Wizard (client component) — 4 passos**

`recebimento/importar/wizard-importacao.tsx` (`'use client'`), estado do passo atual (1..4) e dos dados:
- **Passo 1 — Selecionar:** drag&drop/input de arquivo; ao escolher, `lerPlanilha(file)` → guarda `colunas`, `linhas`, `arquivoNome`, `formato` (por extensão). Erros de leitura viram mensagem.
- **Passo 2 — Mapear:** tabela onde, para cada `campo` comercial, um `select` das `colunas` (valor inicial vindo de `sugerirMapeamento`). Bloqueia avançar se algum campo `obrigatorioImportacao` não foi mapeado.
- **Passo 3 — Preview:** aplica o mapeamento nas primeiras ~20 linhas → `linhaMapa` (campo→valor bruto) → `validarLinha(...)`; renderiza tabela com destaque de erros; conta linhas com erro. Bloqueia importar se houver erros (ou permite importar só as válidas — para o 3A, **bloqueia** se houver qualquer erro, mensagem clara).
- **Passo 4 — Importar:** monta `linhas` = todas as linhas mapeadas e validadas (`valores`), chama a Server Action `importarPlanilha({arquivoNome, formato, mapeamento, linhas})`; em sucesso, mostra "X processos criados" e link para `/recebimento/processos`; em erro, toast.

Seguir o visual dos mockups (stepper com 4 etapas) e os componentes shadcn já instalados. Usar `useActionState`/`useTransition` para o envio.

- [ ] **Step 4: Verificação manual (smoke) — deixar para o controlador/usuário**

Não executar no subagente (precisa de navegador + planilha real). Anotar no relatório que o smoke com a planilha `EMB341EA - ESTADOS UNIDOS.xlsx` está pendente: importar → conferir que N processos aparecem em `/recebimento/processos` e 1 log `importar` em `/configuracoes/logs`.

- [ ] **Step 5: Build + commit**

```bash
npm test && npm run build
git add "src/app/(app)/recebimento/importar/" src/modules/recebimento/domain/ler-planilha.ts
git commit -m "feat(recebimento): wizard de importação de planilha (SheetJS, mapeamento, preview, importar)"
```

---

## Self-Review (autor do plano)

**1. Cobertura do spec 3A:**
- SheetJS parsing no cliente → Tasks 1, 5 ✅
- Domínio mapeamento/conversão/validação (TDD) → Task 1 ✅
- RPC transacional (importacao + processos + 1 log) → Task 2 ✅
- Repositórios + Server Action de importação → Task 3 ✅
- Wizard 4 passos → Task 5 ✅
- Histórico de importações (menu Recebimento) → Task 4 ✅
- Lista básica de processos → Task 4 ✅
- Guard do Recebimento (`visualizar`; `importar` na rota importar) → Tasks 4, 5 ✅

**2. Placeholders:** domínio, RPC, repositórios e a Server Action têm código verbatim; o wizard (UI) tem esqueleto de passos detalhado + segue padrões existentes (`usuario-form.tsx`, stepper dos mockups) — decisão deliberada para não inflar o plano; o subagente completa a UI seguindo esses padrões e o resultado é revisado.

**3. Consistência de tipos:** `CampoImportavel`, `converterValor`, `validarLinha`, `sugerirMapeamento`, `lerPlanilha`, `importarPlanilha`, `chamarImportarProcessos` usados de forma idêntica entre as tasks. A RPC recebe `p_linhas` como array de objetos com chaves = colunas de `processos_recebimento` (origem comercial), compatível com `jsonb_populate_recordset`. Colunas inseridas na RPC == campos `origem=comercial` do seed de `configuracao_campos` (Plano 1).
