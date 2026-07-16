# Padrões de mapeamento reutilizáveis (importação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Salvar o de-para de colunas da importação com um nome e reaplicá-lo (pré-preenchido) nas próximas planilhas, tudo dentro do wizard.

**Architecture:** Migração nova `padroes_importacao` (JSONB do mapeamento + RLS por `importar`/`administrar`). Uma função pura de domínio casa o padrão salvo contra as colunas da planilha atual. Server Actions fazem CRUD e devolvem a lista atualizada. A UI ganha um componente isolado `BarraPadrao` no Passo 2 do wizard, sem tocar no `PassoMapear` existente.

**Tech Stack:** Next.js 16 (Server Actions, Server Components), TypeScript strict (`noUncheckedIndexedAccess`), Supabase (Postgres/RLS via PostgREST), vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **Subagentes NÃO aplicam migração nem dão push.** O controller aplica a 0022 na produção **após** o review da Task 1 (seguro: sem dado real no banco). Nada de `supabase db push` nem `git push` pelos implementadores.
- **Padrão guarda só** o `Record<campo_do_banco, nome_da_coluna>` dos campos mapeáveis + um nome. Nunca `data_chegada`/`numero_emb` (digitados, por-importação) nem o arquivo.
- **Compartilhado:** RLS libera SELECT e escrita para `tem_permissao('importar') or tem_permissao('administrar')`. As Server Actions revalidam a sessão com `podeFazer(sessao.perfil, 'importar')`.
- **Casar por nome NORMALIZADO** (reusa `normalizarNome` de `mapeamento.ts`) — isolado no domínio, trocável depois. Ao aplicar, usar o **nome REAL da coluna atual**, não o salvo.
- **Aplicar SUBSTITUI** o mapeamento inteiro. **Salvar exige ≥1 coluna mapeada** e nome não vazio. **Nome único** case-insensitive (viol. `23505` → erro amigável).
- **Campo desativado** (fora de `camposMapeaveis`) é descartado ao aplicar, sem contar como "não encontrada".
- TS strict `noUncheckedIndexedAccess`. Server Actions começam com `'use server'`. Repositório usa `createServerSupabase`. Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test` (TDD no domínio). SEM push.

## File Structure

- **Create** `supabase/migrations/0022_padroes_importacao.sql` — tabela + índice único + RLS.
- **Create** `src/modules/recebimento/domain/padrao-importacao.ts` — `aplicarPadrao`, `nomePadraoValido` (puro).
- **Create** `src/modules/recebimento/domain/__tests__/padrao-importacao.test.ts` — TDD.
- **Create** `src/modules/recebimento/infra/padrao-importacao-repository.ts` — CRUD via PostgREST.
- **Create** `src/modules/recebimento/application/padroes-importacao.ts` — Server Actions.
- **Modify** `src/app/(app)/recebimento/importar/page.tsx` — carrega os padrões.
- **Modify** `src/app/(app)/recebimento/importar/wizard-importacao.tsx` — estado + `BarraPadrao` no Passo 2.

---

### Task 1: Migração `padroes_importacao`

**Files:**
- Create: `supabase/migrations/0022_padroes_importacao.sql`

**Interfaces:**
- Produces: tabela `public.padroes_importacao(id uuid, nome text, mapeamento jsonb, criado_por uuid, created_at, updated_at)`; índice único `lower(nome)`; políticas RLS de select/escrita por `importar`/`administrar`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0022_padroes_importacao.sql`:

```sql
-- Padrões de mapeamento reutilizáveis da importação: guardam o de-para
-- coluna-da-planilha → campo (JSONB) com um nome, para reaplicar em planilhas
-- futuras. Compartilhados: quem importa gerencia; admin também.
create table public.padroes_importacao (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  mapeamento  jsonb not null default '{}'::jsonb,   -- { campo_do_banco: nome_da_coluna }
  criado_por  uuid references public.usuarios(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Nome único, case-insensitive (evita "Fornecedor X" e "fornecedor x" duplicados).
create unique index padroes_importacao_nome_unq
  on public.padroes_importacao (lower(nome));

alter table public.padroes_importacao enable row level security;

-- Todos que importam gerenciam; admin também.
create policy padroes_importacao_select on public.padroes_importacao
  for select to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'));

create policy padroes_importacao_write on public.padroes_importacao
  for all to authenticated
  using (public.tem_permissao('importar') or public.tem_permissao('administrar'))
  with check (public.tem_permissao('importar') or public.tem_permissao('administrar'));
```

- [ ] **Step 2: Conferir a sintaxe (sem aplicar)**

Ler o arquivo criado e conferir: nomes de política únicos, `references public.usuarios(id)` (a tabela existe desde a 0001), `public.tem_permissao` (existe desde a 0001). **NÃO** rodar `supabase db push` — o controller aplica após o review.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0022_padroes_importacao.sql
git commit -m "feat(importacao): migração padroes_importacao (tabela + RLS importar/administrar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — aplicar padrão (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/padrao-importacao.ts`
- Create: `src/modules/recebimento/domain/__tests__/padrao-importacao.test.ts`

**Interfaces:**
- Consumes: `normalizarNome`, `type CampoImportavel` de `./mapeamento`.
- Produces:
  - `type MapeamentoSalvo = Record<string, string>`
  - `interface ResultadoAplicarPadrao { mapeamento: Record<string, string>; colunasNaoEncontradas: string[] }`
  - `aplicarPadrao(mapeamentoSalvo: MapeamentoSalvo, colunasAtuais: string[], camposMapeaveis: CampoImportavel[]): ResultadoAplicarPadrao`
  - `nomePadraoValido(nome: string): boolean`

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/recebimento/domain/__tests__/padrao-importacao.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aplicarPadrao, nomePadraoValido } from '../padrao-importacao'
import type { CampoImportavel } from '../mapeamento'

const campo = (campo: string, rotulo: string): CampoImportavel => ({
  campo,
  rotulo,
  tipo: 'texto',
  listaChave: null,
  obrigatorioImportacao: false,
})

const CAMPOS: CampoImportavel[] = [
  campo('codigo_material', 'Código'),
  campo('numero_nf', 'Nº NF'),
  campo('numero_pedido', 'Pedido'),
]

describe('aplicarPadrao', () => {
  it('casa por nome exato', () => {
    const r = aplicarPadrao({ codigo_material: 'Part Number' }, ['Part Number', 'Qtd'], CAMPOS)
    expect(r.mapeamento).toEqual({ codigo_material: 'Part Number' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('casa por nome normalizado e usa o nome REAL da coluna atual', () => {
    // padrão salvou 'Nº NF'; a planilha atual traz 'N NF' (sem acento/símbolo)
    const r = aplicarPadrao({ numero_nf: 'Nº NF' }, ['N NF'], CAMPOS)
    expect(r.mapeamento).toEqual({ numero_nf: 'N NF' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('coluna salva ausente na planilha atual entra em colunasNaoEncontradas', () => {
    const r = aplicarPadrao({ numero_pedido: 'Pedido Compra' }, ['Outra'], CAMPOS)
    expect(r.mapeamento).toEqual({})
    expect(r.colunasNaoEncontradas).toEqual(['Pedido Compra'])
  })

  it('descarta campo desativado sem marcá-lo como não encontrado', () => {
    // 'campo_zumbi' não está em CAMPOS (foi desativado no catálogo)
    const r = aplicarPadrao(
      { campo_zumbi: 'Alguma', codigo_material: 'Código' },
      ['Código', 'Alguma'],
      CAMPOS,
    )
    expect(r.mapeamento).toEqual({ codigo_material: 'Código' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('padrão vazio → mapeamento vazio', () => {
    expect(aplicarPadrao({}, ['Código'], CAMPOS)).toEqual({
      mapeamento: {},
      colunasNaoEncontradas: [],
    })
  })

  it('não muta as entradas', () => {
    const salvo = { codigo_material: 'Código' }
    const cols = ['Código']
    aplicarPadrao(salvo, cols, CAMPOS)
    expect(salvo).toEqual({ codigo_material: 'Código' })
    expect(cols).toEqual(['Código'])
  })
})

describe('nomePadraoValido', () => {
  it('vazio ou só espaços → false', () => {
    expect(nomePadraoValido('')).toBe(false)
    expect(nomePadraoValido('   ')).toBe(false)
  })
  it('com conteúdo → true', () => {
    expect(nomePadraoValido('Fornecedor X')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- padrao-importacao`
Expected: FAIL (módulo `../padrao-importacao` não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/padrao-importacao.ts`:

```ts
import { normalizarNome, type CampoImportavel } from './mapeamento'

/** Mapa campo_do_banco → nome_da_coluna_da_planilha (o que um padrão guarda). */
export type MapeamentoSalvo = Record<string, string>

export interface ResultadoAplicarPadrao {
  /** campo_do_banco → nome_da_coluna, já casado com as colunas ATUAIS. */
  mapeamento: Record<string, string>
  /** Nomes de coluna do padrão que não existem na planilha atual (para o aviso). */
  colunasNaoEncontradas: string[]
}

/**
 * Aplica um padrão salvo às colunas da planilha atual. Casa cada coluna salva por
 * nome NORMALIZADO contra `colunasAtuais` e mapeia para o nome REAL da coluna atual.
 * Descarta campos que não estão mais em `camposMapeaveis` (desativados) sem marcá-los
 * como não encontrados. Substitui o mapeamento por completo. Não muta as entradas.
 */
export function aplicarPadrao(
  mapeamentoSalvo: MapeamentoSalvo,
  colunasAtuais: string[],
  camposMapeaveis: CampoImportavel[],
): ResultadoAplicarPadrao {
  const camposValidos = new Set(camposMapeaveis.map((c) => c.campo))
  const colunaPorNorma = new Map(colunasAtuais.map((c) => [normalizarNome(c), c]))

  const mapeamento: Record<string, string> = {}
  const colunasNaoEncontradas: string[] = []

  for (const [campo, colunaSalva] of Object.entries(mapeamentoSalvo)) {
    if (!camposValidos.has(campo)) continue // campo desativado: descarta em silêncio
    const colunaAtual = colunaPorNorma.get(normalizarNome(colunaSalva))
    if (colunaAtual) mapeamento[campo] = colunaAtual
    else colunasNaoEncontradas.push(colunaSalva)
  }

  return { mapeamento, colunasNaoEncontradas }
}

/** Nome de padrão é válido quando não é vazio após aparar os espaços. */
export function nomePadraoValido(nome: string): boolean {
  return nome.trim().length > 0
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- padrao-importacao`
Expected: PASS (todos).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/domain/padrao-importacao.ts src/modules/recebimento/domain/__tests__/padrao-importacao.test.ts
git commit -m "feat(importacao): domínio aplicarPadrao + nomePadraoValido (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra — repositório de padrões

**Files:**
- Create: `src/modules/recebimento/infra/padrao-importacao-repository.ts`

**Interfaces:**
- Consumes: `createServerSupabase` de `@/shared/lib/supabase/server`.
- Produces:
  - `interface PadraoImportacao { id: string; nome: string; mapeamento: Record<string, string>; updatedAt: string }`
  - `listarPadroesImportacao(): Promise<PadraoImportacao[]>` (ordem `nome` asc)
  - `inserirPadraoImportacao(nome: string, mapeamento: Record<string, string>): Promise<PadraoImportacao>`
  - `atualizarPadraoImportacao(id: string, mapeamento: Record<string, string>): Promise<PadraoImportacao>`
  - `excluirPadraoImportacao(id: string): Promise<void>`

- [ ] **Step 1: Implementar o repositório**

Criar `src/modules/recebimento/infra/padrao-importacao-repository.ts`:

```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PadraoImportacao {
  id: string
  nome: string
  mapeamento: Record<string, string>
  updatedAt: string
}

interface PadraoRow {
  id: string
  nome: string
  mapeamento: Record<string, string> | null
  updated_at: string
}

const COLUNAS = 'id, nome, mapeamento, updated_at'

function mapRow(row: PadraoRow): PadraoImportacao {
  return {
    id: row.id,
    nome: row.nome,
    mapeamento: row.mapeamento ?? {},
    updatedAt: row.updated_at,
  }
}

/** Lista os padrões salvos, ordenados por nome. RLS libera para quem importa. */
export async function listarPadroesImportacao(): Promise<PadraoImportacao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .select(COLUNAS)
    .order('nome', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => mapRow(row as unknown as PadraoRow))
}

/** Cria um padrão. Lança em violação de nome único (código Postgres 23505). */
export async function inserirPadraoImportacao(
  nome: string,
  mapeamento: Record<string, string>,
): Promise<PadraoImportacao> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .insert({ nome, mapeamento })
    .select(COLUNAS)
    .single()
  if (error) throw error
  return mapRow(data as unknown as PadraoRow)
}

/** Substitui o mapeamento de um padrão e atualiza updated_at. */
export async function atualizarPadraoImportacao(
  id: string,
  mapeamento: Record<string, string>,
): Promise<PadraoImportacao> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .update({ mapeamento, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUNAS)
    .single()
  if (error) throw error
  return mapRow(data as unknown as PadraoRow)
}

/** Exclui um padrão pelo id. */
export async function excluirPadraoImportacao(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('padroes_importacao').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/infra/padrao-importacao-repository.ts
git commit -m "feat(importacao): repositório de padroes_importacao (CRUD via PostgREST)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Application — Server Actions

**Files:**
- Create: `src/modules/recebimento/application/padroes-importacao.ts`

**Interfaces:**
- Consumes: `getSessao` (`@/modules/auth/application/get-sessao`), `podeFazer` (`@/modules/auth/domain/perfil`), `nomePadraoValido` (`../domain/padrao-importacao`), o repositório da Task 3 e o tipo `PadraoImportacao`.
- Produces:
  - `type ResultadoPadroes = { ok: true; padroes: PadraoImportacao[] } | { ok: false; erro: string }`
  - `salvarPadrao(nome: string, mapeamento: Record<string, string>): Promise<ResultadoPadroes>`
  - `atualizarPadrao(id: string, mapeamento: Record<string, string>): Promise<ResultadoPadroes>`
  - `excluirPadrao(id: string): Promise<ResultadoPadroes>`

- [ ] **Step 1: Implementar as Server Actions**

Criar `src/modules/recebimento/application/padroes-importacao.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { nomePadraoValido } from '../domain/padrao-importacao'
import {
  atualizarPadraoImportacao,
  excluirPadraoImportacao,
  inserirPadraoImportacao,
  listarPadroesImportacao,
  type PadraoImportacao,
} from '../infra/padrao-importacao-repository'

export type ResultadoPadroes =
  | { ok: true; padroes: PadraoImportacao[] }
  | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar padrões.'

/** True quando o erro do Postgres é violação de índice único (nome duplicado). */
function ehViolacaoUnica(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code: unknown }).code === '23505'
  )
}

export async function salvarPadrao(
  nome: string,
  mapeamento: Record<string, string>,
): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  if (!nomePadraoValido(nome)) return { ok: false, erro: 'Dê um nome ao padrão.' }
  if (Object.keys(mapeamento).length < 1) {
    return { ok: false, erro: 'Mapeie ao menos uma coluna antes de salvar.' }
  }
  try {
    await inserirPadraoImportacao(nome.trim(), mapeamento)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) return { ok: false, erro: 'Já existe um padrão com esse nome.' }
    return { ok: false, erro: 'Não foi possível salvar o padrão.' }
  }
}

export async function atualizarPadrao(
  id: string,
  mapeamento: Record<string, string>,
): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  if (Object.keys(mapeamento).length < 1) {
    return { ok: false, erro: 'Mapeie ao menos uma coluna antes de atualizar.' }
  }
  try {
    await atualizarPadraoImportacao(id, mapeamento)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch {
    return { ok: false, erro: 'Não foi possível atualizar o padrão.' }
  }
}

export async function excluirPadrao(id: string): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    await excluirPadraoImportacao(id)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch {
    return { ok: false, erro: 'Não foi possível excluir o padrão.' }
  }
}
```

- [ ] **Step 2: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/application/padroes-importacao.ts
git commit -m "feat(importacao): server actions de padrões (salvar/atualizar/excluir)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — barra de padrão no Passo 2 do wizard

**Files:**
- Modify: `src/app/(app)/recebimento/importar/page.tsx`
- Modify: `src/app/(app)/recebimento/importar/wizard-importacao.tsx`

**Interfaces:**
- Consumes: `listarPadroesImportacao` + `type PadraoImportacao` (infra, Task 3); `aplicarPadrao`, `nomePadraoValido` — na verdade só `aplicarPadrao` (Task 2); `salvarPadrao`/`atualizarPadrao`/`excluirPadrao` (Task 4); `normalizarNome` (`mapeamento.ts`); primitivos `Select`/`Input`/`Button`/`Label` já importados no wizard.

- [ ] **Step 1: `page.tsx` carrega os padrões**

Em `src/app/(app)/recebimento/importar/page.tsx`, adicionar o import:

```tsx
import { listarPadroesImportacao } from '@/modules/recebimento/infra/padrao-importacao-repository'
```

Carregar após `itensPorLista` e passar ao wizard:

```tsx
  const itensPorLista = await carregarItensPorLista(chaves)
  const padroes = await listarPadroesImportacao()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Importar planilha</h1>
      <WizardImportacao campos={campos} itensPorLista={itensPorLista} padroes={padroes} />
    </div>
  )
```

- [ ] **Step 2: Imports novos no wizard**

Em `src/app/(app)/recebimento/importar/wizard-importacao.tsx`:

- No import de `mapeamento`, acrescentar `normalizarNome`:

```tsx
import {
  sugerirMapeamento,
  numeroEmbDoArquivo,
  normalizarNome,
  CAMPOS_DIGITADOS,
  type CampoImportavel,
} from '@/modules/recebimento/domain/mapeamento'
```

- Adicionar (novos imports):

```tsx
import { aplicarPadrao } from '@/modules/recebimento/domain/padrao-importacao'
import type { PadraoImportacao } from '@/modules/recebimento/infra/padrao-importacao-repository'
import {
  salvarPadrao,
  atualizarPadrao,
  excluirPadrao,
} from '@/modules/recebimento/application/padroes-importacao'
```

- Adicionar a constante (perto de `SEM_MAPEAMENTO`):

```tsx
const SEM_PADRAO = '__sem_padrao__'
```

- [ ] **Step 3: Prop + estado no wizard**

Na interface `WizardImportacaoProps`, adicionar:

```tsx
interface WizardImportacaoProps {
  campos: CampoImportavel[]
  itensPorLista: Record<string, string[]>
  padroes: PadraoImportacao[]
}
```

Na assinatura do componente:

```tsx
export function WizardImportacao({ campos, itensPorLista, padroes: padroesIniciais }: WizardImportacaoProps) {
```

Após a linha `const [importando, startImportacao] = useTransition()`, adicionar o estado dos padrões:

```tsx
  const [padroes, setPadroes] = useState<PadraoImportacao[]>(padroesIniciais)
  const [padraoSelecionadoId, setPadraoSelecionadoId] = useState<string | null>(null)
  const [colunasNaoEncontradas, setColunasNaoEncontradas] = useState<string[]>([])
  const [nomeNovoPadrao, setNomeNovoPadrao] = useState('')
  const [mostrandoCampoNome, setMostrandoCampoNome] = useState(false)
  const [erroPadrao, setErroPadrao] = useState<string | null>(null)
  const [salvandoPadrao, startPadrao] = useTransition()
```

- [ ] **Step 4: Handlers no wizard**

Adicionar dentro do componente (antes do `return`), após `onImportar`:

```tsx
  function onAplicarPadrao(id: string) {
    const padrao = padroes.find((p) => p.id === id)
    if (!padrao) return
    const r = aplicarPadrao(padrao.mapeamento, colunas, camposMapeaveis)
    setMapeamento(r.mapeamento)
    setColunasNaoEncontradas(r.colunasNaoEncontradas)
    setPadraoSelecionadoId(id)
    setErroPadrao(null)
  }

  function onSalvarPadrao() {
    setErroPadrao(null)
    startPadrao(async () => {
      const r = await salvarPadrao(nomeNovoPadrao, mapeamento)
      if (r.ok) {
        setPadroes(r.padroes)
        const novo = r.padroes.find((p) => normalizarNome(p.nome) === normalizarNome(nomeNovoPadrao))
        setPadraoSelecionadoId(novo?.id ?? null)
        setMostrandoCampoNome(false)
        setNomeNovoPadrao('')
      } else {
        setErroPadrao(r.erro)
      }
    })
  }

  function onAtualizarPadrao() {
    if (!padraoSelecionadoId) return
    setErroPadrao(null)
    startPadrao(async () => {
      const r = await atualizarPadrao(padraoSelecionadoId, mapeamento)
      if (r.ok) setPadroes(r.padroes)
      else setErroPadrao(r.erro)
    })
  }

  function onExcluirPadrao() {
    if (!padraoSelecionadoId) return
    if (!window.confirm('Excluir este padrão de mapeamento?')) return
    setErroPadrao(null)
    startPadrao(async () => {
      const r = await excluirPadrao(padraoSelecionadoId)
      if (r.ok) {
        setPadroes(r.padroes)
        setPadraoSelecionadoId(null)
      } else {
        setErroPadrao(r.erro)
      }
    })
  }
```

- [ ] **Step 5: Renderizar `BarraPadrao` antes do `PassoMapear`**

No bloco `{passo === 2 && ( ... )}`, envolver em fragmento e inserir a barra antes do `PassoMapear`:

```tsx
      {passo === 2 && (
        <>
          <BarraPadrao
            padroes={padroes}
            padraoSelecionadoId={padraoSelecionadoId}
            colunasNaoEncontradas={colunasNaoEncontradas}
            nomeNovoPadrao={nomeNovoPadrao}
            mostrandoCampoNome={mostrandoCampoNome}
            erro={erroPadrao}
            salvando={salvandoPadrao}
            onAplicar={onAplicarPadrao}
            onIniciarSalvar={() => {
              setMostrandoCampoNome(true)
              setErroPadrao(null)
            }}
            onCancelarSalvar={() => {
              setMostrandoCampoNome(false)
              setNomeNovoPadrao('')
              setErroPadrao(null)
            }}
            onMudarNome={setNomeNovoPadrao}
            onSalvar={onSalvarPadrao}
            onAtualizar={onAtualizarPadrao}
            onExcluir={onExcluirPadrao}
          />
          <PassoMapear
            campos={camposMapeaveis}
            camposDigitados={camposDigitados}
            valoresDigitados={valoresDigitados}
            onMudarValorFixo={onMudarValorFixo}
            colunas={colunas}
            mapeamento={mapeamento}
            camposFaltando={camposFaltando}
            onMudarMapeamento={(campo, coluna) =>
              setMapeamento((atual) => ({ ...atual, [campo]: coluna }))
            }
            onVoltar={() => setPasso(1)}
            onProximo={() => setPasso(3)}
          />
        </>
      )}
```

(O `PassoMapear` em si NÃO muda — só passa a ser irmão de `BarraPadrao`.)

- [ ] **Step 6: Componente `BarraPadrao`**

Adicionar no fim do arquivo (escopo do módulo):

```tsx
interface BarraPadraoProps {
  padroes: PadraoImportacao[]
  padraoSelecionadoId: string | null
  colunasNaoEncontradas: string[]
  nomeNovoPadrao: string
  mostrandoCampoNome: boolean
  erro: string | null
  salvando: boolean
  onAplicar: (id: string) => void
  onIniciarSalvar: () => void
  onCancelarSalvar: () => void
  onMudarNome: (nome: string) => void
  onSalvar: () => void
  onAtualizar: () => void
  onExcluir: () => void
}

/** Barra do Passo 2: aplicar/salvar/atualizar/excluir padrões de mapeamento. */
function BarraPadrao({
  padroes,
  padraoSelecionadoId,
  colunasNaoEncontradas,
  nomeNovoPadrao,
  mostrandoCampoNome,
  erro,
  salvando,
  onAplicar,
  onIniciarSalvar,
  onCancelarSalvar,
  onMudarNome,
  onSalvar,
  onAtualizar,
  onExcluir,
}: BarraPadraoProps) {
  const naoEncontradas = colunasNaoEncontradas.length

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-sm font-medium">Padrão de mapeamento</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label>Aplicar padrão salvo</Label>
          <Select
            value={padraoSelecionadoId ?? SEM_PADRAO}
            onValueChange={(valor) => {
              if (valor && valor !== SEM_PADRAO) onAplicar(valor)
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Escolher padrão..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_PADRAO}>Nenhum</SelectItem>
              {padroes.map((padrao) => (
                <SelectItem key={padrao.id} value={padrao.id}>
                  {padrao.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mostrandoCampoNome ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="nome-padrao">Nome do padrão</Label>
              <Input
                id="nome-padrao"
                value={nomeNovoPadrao}
                onChange={(e) => onMudarNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSalvar()
                }}
                className="w-56"
              />
            </div>
            <Button
              className="bg-enterplak hover:bg-enterplak-700"
              disabled={salvando}
              onClick={onSalvar}
            >
              Salvar
            </Button>
            <Button variant="ghost" disabled={salvando} onClick={onCancelarSalvar}>
              Cancelar
            </Button>
          </div>
        ) : (
          <>
            <Button variant="outline" disabled={salvando} onClick={onIniciarSalvar}>
              Salvar como padrão
            </Button>
            {padraoSelecionadoId && (
              <>
                <Button variant="outline" disabled={salvando} onClick={onAtualizar}>
                  Atualizar
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600"
                  disabled={salvando}
                  onClick={onExcluir}
                >
                  Excluir
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {naoEncontradas > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          {naoEncontradas} coluna{naoEncontradas === 1 ? '' : 's'} do padrão não{' '}
          {naoEncontradas === 1 ? 'foi encontrada' : 'foram encontradas'} nesta planilha e{' '}
          {naoEncontradas === 1 ? 'ficou' : 'ficaram'} sem mapear.
        </p>
      )}

      {erro && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertTriangleIcon className="size-3.5 shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Verificar tipos, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros (só o warning pré-existente de `<img>` em `anexos-processo.tsx`).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/recebimento/importar/page.tsx" "src/app/(app)/recebimento/importar/wizard-importacao.tsx"
git commit -m "feat(importacao): barra de padrões de mapeamento no Passo 2 do wizard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final

**Files:** nenhum (só verificação; o controller aplica a migração 0022 antes do smoke).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os testes de `padrao-importacao` entre eles.

- [ ] **Step 2: Smoke (anotar; NÃO fazer push)**

Pré-condição: o controller já aplicou a migração 0022 na produção.

Em `/recebimento/importar`:
1. Selecionar uma planilha, mapear algumas colunas no Passo 2.
2. **Salvar como padrão** com um nome (ex.: "Fornecedor X") → o padrão aparece selecionado no Select.
3. Voltar ao Passo 1, selecionar **outra** planilha do mesmo fornecedor.
4. No Passo 2, **Aplicar padrão** "Fornecedor X" → o mapeamento vem pronto (por nome normalizado); se faltar alguma coluna, o aviso âmbar aparece.
5. **Atualizar** grava o mapeamento atual no padrão; **Excluir** some da lista.
6. Tentar **salvar nome duplicado** → erro "Já existe um padrão com esse nome.".
7. Tentar **salvar sem mapear nada** → bloqueado com aviso.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide o push.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- Salvar/aplicar/atualizar/excluir padrão no wizard → Task 5. ✅
- Guarda só o de-para + nome → Task 1 (schema) + Task 5 (passa `mapeamento`). ✅
- Compartilhado, RLS `importar`/`administrar` → Task 1. ✅ Actions revalidam sessão → Task 4. ✅
- Casar por nome normalizado, usar nome real, descartar desativado, reportar não encontradas, substituir tudo, não mutar → Task 2 (`aplicarPadrao`) + testes. ✅
- Exigir ≥1 coluna e nome válido; nome único (23505) → Task 4. ✅
- Aviso de colunas não encontradas → Task 5 (`BarraPadrao`). ✅
- Migração vai à prod pelo controller; subagentes não aplicam/pusham → Global Constraints + Task 1/6. ✅

**Consistência de tipos:** `PadraoImportacao` (Task 3) consumido em Tasks 4 e 5; `ResultadoPadroes` (Task 4) consumido em 5; `aplicarPadrao`/`ResultadoAplicarPadrao` (Task 2) em 5; `mapeamento` é `Record<string,string>` em todas. ✅

**Sem placeholders:** todo passo de código traz o código completo. ✅
