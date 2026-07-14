# Anexos de foto por processo — Subsistema A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anexar (até 3), visualizar e excluir fotos por processo de recebimento, com upload imediato pro Supabase Storage.

**Architecture:** Migração cria bucket privado + tabela de metadados + RLS. Domínio puro valida tipo/tamanho. Repository encapsula Storage + metadados. Server Actions (`anexarFoto`/`removerFoto`) fazem gate de permissão, checam limite/terminal, sobem/apagam objeto e metadado (com rollback), logam e revalidam. Um card client "Fotos (N/3)" na tela de detalhe comprime no cliente (se >1 MB) e chama as actions. Não altera `salvarSecaoProcesso` nem os botões de seção.

**Tech Stack:** Next.js 16 (App Router, Server Actions/Components), TypeScript strict, Supabase (Postgres + Storage + RLS), Tailwind/base-ui, vitest. Dep nova: `browser-image-compression`.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **Upload IMEDIATO** — não staged. Anexar/excluir persistem na hora, independentes dos botões Salvar.
- **Limite: 3 fotos por processo** (bloqueia a 4ª no cliente e no servidor).
- **Compressão no cliente:** só se `arquivo.size > 1_048_576` (1 MB) → `browser-image-compression` com `{ maxSizeMB: 1, maxWidthOrHeight: 2000, useWebWorker: true }`.
- **Permissões:** ver = `visualizar`; anexar/excluir = `editar`. Sem permissão nova.
- **Processo terminal** (`ehTerminal(status)` = somente-leitura): vê as fotos; anexar/excluir bloqueado (erro "reabra o processo").
- **Sem migração de logs:** reuso `acao: 'alterar_campo'` (anexar) e `acao: 'excluir'` (remover).
- **Bucket:** `anexos-processos` (privado). **Path do objeto:** `{processoId}/{uuid}.{ext}`.
- **A migração 0017 é aplicada em produção PELO CONTROLLER** após o review da Task 1 (o subagent NÃO roda `supabase db push`).
- **Verificação (TDD só no domínio):** Task 2 tem teste; demais por `npx tsc --noEmit` + `npm run build` (e smoke manual do que exige navegador/Storage). `npm run test` no final.

---

### Task 1: Migração 0017 (bucket + metadados + RLS)

**Files:**
- Create: `supabase/migrations/0017_anexos_processo.sql`

**Interfaces:**
- Produces: bucket `anexos-processos`; tabela `public.anexos_processo(id, processo_id, path, nome_original, mime, tamanho, criado_por, created_at)`; policies RLS via `public.tem_permissao(...)`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0017_anexos_processo.sql`:

```sql
-- Anexos de foto por processo (subsistema A): bucket privado + metadados + RLS.

-- Bucket privado (buffer temporário; export/limpeza ficam no subsistema B).
insert into storage.buckets (id, name, public)
values ('anexos-processos', 'anexos-processos', false)
on conflict (id) do nothing;

-- Metadados dos anexos (listar, contar o limite de 3, auditar).
create table public.anexos_processo (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos_recebimento(id) on delete cascade,
  path text not null unique,
  nome_original text not null default '',
  mime text not null default '',
  tamanho bigint not null default 0,
  criado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index anexos_processo_processo_idx on public.anexos_processo(processo_id);

alter table public.anexos_processo enable row level security;

-- RLS da tabela: ver = visualizar; anexar = editar; remover = editar. Sem UPDATE (metadado imutável).
create policy anexos_meta_select on public.anexos_processo
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy anexos_meta_insert on public.anexos_processo
  for insert to authenticated with check (public.tem_permissao('editar'));
create policy anexos_meta_delete on public.anexos_processo
  for delete to authenticated using (public.tem_permissao('editar'));

-- RLS dos objetos do Storage, restrita ao bucket de anexos.
create policy anexos_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos-processos' and public.tem_permissao('visualizar'));
create policy anexos_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos-processos' and public.tem_permissao('editar'));
create policy anexos_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos-processos' and public.tem_permissao('editar'));
```

- [ ] **Step 2: Não aplicar — commitar apenas**

NÃO rode `supabase db push`. A aplicação em produção é feita pelo controller após o review desta task (com reload do schema cache). Apenas commite o arquivo.

```bash
git add supabase/migrations/0017_anexos_processo.sql
git commit -m "feat(anexos): migração 0017 — bucket, tabela anexos_processo e RLS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — validação de arquivo (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/anexo.ts`
- Test: `src/modules/recebimento/domain/__tests__/anexo.test.ts`

**Interfaces:**
- Produces:
  - `extensaoDoMime(mime: string): 'jpg' | 'png' | 'webp' | null`
  - `validarArquivoImagem(mime: string, tamanho: number): { ok: true } | { ok: false; erro: string }`
  - `TAMANHO_MAX_ANEXO: number` (5 MB)

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/recebimento/domain/__tests__/anexo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extensaoDoMime, validarArquivoImagem, TAMANHO_MAX_ANEXO } from '../anexo'

describe('extensaoDoMime', () => {
  it('mapeia mimes de imagem suportados', () => {
    expect(extensaoDoMime('image/jpeg')).toBe('jpg')
    expect(extensaoDoMime('image/png')).toBe('png')
    expect(extensaoDoMime('image/webp')).toBe('webp')
  })
  it('retorna null para mime não suportado', () => {
    expect(extensaoDoMime('image/gif')).toBeNull()
    expect(extensaoDoMime('application/pdf')).toBeNull()
    expect(extensaoDoMime('')).toBeNull()
  })
})

describe('validarArquivoImagem', () => {
  it('aceita imagem suportada com tamanho válido', () => {
    expect(validarArquivoImagem('image/jpeg', 500_000)).toEqual({ ok: true })
  })
  it('rejeita formato não suportado', () => {
    expect(validarArquivoImagem('image/gif', 500_000)).toEqual({
      ok: false,
      erro: 'Formato não suportado (use JPEG, PNG ou WebP).',
    })
  })
  it('rejeita arquivo vazio', () => {
    expect(validarArquivoImagem('image/png', 0)).toEqual({ ok: false, erro: 'Arquivo vazio.' })
  })
  it('rejeita acima do limite', () => {
    expect(validarArquivoImagem('image/png', TAMANHO_MAX_ANEXO + 1)).toEqual({
      ok: false,
      erro: 'Arquivo muito grande (máx. 5 MB).',
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- anexo`
Expected: FAIL ("Cannot find module '../anexo'").

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/anexo.ts`:

```ts
// Validação pura de arquivos de imagem para anexo (sem I/O). Usada
// autoritativamente pela Server Action de upload.

const MIME_EXTENSAO: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Extensão de arquivo para um mime de imagem suportado, ou null se não suportado. */
export function extensaoDoMime(mime: string): 'jpg' | 'png' | 'webp' | null {
  return MIME_EXTENSAO[mime] ?? null
}

/** Teto defensivo de tamanho no servidor (o cliente já comprime para ~1 MB). */
export const TAMANHO_MAX_ANEXO = 5 * 1024 * 1024 // 5 MB

export type ResultadoValidacaoArquivo = { ok: true } | { ok: false; erro: string }

/** Valida tipo (imagem suportada) e tamanho de um arquivo de anexo. */
export function validarArquivoImagem(mime: string, tamanho: number): ResultadoValidacaoArquivo {
  if (extensaoDoMime(mime) === null) {
    return { ok: false, erro: 'Formato não suportado (use JPEG, PNG ou WebP).' }
  }
  if (tamanho <= 0) {
    return { ok: false, erro: 'Arquivo vazio.' }
  }
  if (tamanho > TAMANHO_MAX_ANEXO) {
    return { ok: false, erro: 'Arquivo muito grande (máx. 5 MB).' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- anexo`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/recebimento/domain/anexo.ts src/modules/recebimento/domain/__tests__/anexo.test.ts
git commit -m "feat(anexos): domínio de validação de arquivo de imagem (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra — `anexo-repository.ts`

**Files:**
- Create: `src/modules/recebimento/infra/anexo-repository.ts`

**Interfaces:**
- Consumes: `createServerSupabase` de `@/shared/lib/supabase/server`.
- Produces:
  - `interface AnexoProcesso { id; processoId; path; nomeOriginal; mime; tamanho; criadoEm }` e `interface AnexoComUrl extends AnexoProcesso { url: string }`
  - `listarAnexos(processoId): Promise<AnexoProcesso[]>`
  - `listarAnexosComUrl(processoId): Promise<AnexoComUrl[]>`
  - `contarAnexos(processoId): Promise<number>`
  - `buscarAnexo(id): Promise<AnexoProcesso | null>`
  - `gerarUrlAnexo(path): Promise<string>`
  - `subirObjeto(path, dados: ArrayBuffer, mime): Promise<void>`
  - `removerObjeto(path): Promise<void>`
  - `inserirAnexoMeta(dados): Promise<void>`
  - `removerAnexoMeta(id): Promise<void>`

- [ ] **Step 1: Criar o repository**

Criar `src/modules/recebimento/infra/anexo-repository.ts`:

```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'

const BUCKET = 'anexos-processos'

export interface AnexoProcesso {
  id: string
  processoId: string
  path: string
  nomeOriginal: string
  mime: string
  tamanho: number
  criadoEm: string
}

export interface AnexoComUrl extends AnexoProcesso {
  url: string
}

interface AnexoRow {
  id: string
  processo_id: string
  path: string
  nome_original: string
  mime: string
  tamanho: number
  created_at: string
}

const SELECT = 'id, processo_id, path, nome_original, mime, tamanho, created_at'

function mapRow(row: AnexoRow): AnexoProcesso {
  return {
    id: row.id,
    processoId: row.processo_id,
    path: row.path,
    nomeOriginal: row.nome_original,
    mime: row.mime,
    tamanho: row.tamanho,
    criadoEm: row.created_at,
  }
}

/** Lista os anexos (metadados) de um processo, mais antigo → mais novo. */
export async function listarAnexos(processoId: string): Promise<AnexoProcesso[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .select(SELECT)
    .eq('processo_id', processoId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as AnexoRow[]).map(mapRow)
}

/** Um anexo pelo id (para checar processo/terminal antes de remover). */
export async function buscarAnexo(id: string): Promise<AnexoProcesso | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? mapRow(data as AnexoRow) : null
}

/** Conta os anexos de um processo (para o limite de 3). */
export async function contarAnexos(processoId: string): Promise<number> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('anexos_processo')
    .select('id', { count: 'exact', head: true })
    .eq('processo_id', processoId)
  if (error) throw error
  return count ?? 0
}

/** Signed URL (1 h) para exibir/baixar um objeto do bucket privado. */
export async function gerarUrlAnexo(path: string): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) throw error ?? new Error('Falha ao gerar URL do anexo.')
  return data.signedUrl
}

/** Lista os anexos de um processo já com signed URL para exibição. */
export async function listarAnexosComUrl(processoId: string): Promise<AnexoComUrl[]> {
  const anexos = await listarAnexos(processoId)
  return Promise.all(anexos.map(async (a) => ({ ...a, url: await gerarUrlAnexo(a.path) })))
}

/** Sobe um objeto para o bucket de anexos (falha se o path já existir). */
export async function subirObjeto(path: string, dados: ArrayBuffer, mime: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, dados, { contentType: mime, upsert: false })
  if (error) throw error
}

/** Remove um objeto do bucket de anexos. */
export async function removerObjeto(path: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}

/** Insere a linha de metadados de um anexo (verifica que 1 linha foi criada). */
export async function inserirAnexoMeta(dados: {
  processoId: string
  path: string
  nomeOriginal: string
  mime: string
  tamanho: number
  criadoPor: string
}): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .insert({
      processo_id: dados.processoId,
      path: dados.path,
      nome_original: dados.nomeOriginal,
      mime: dados.mime,
      tamanho: dados.tamanho,
      criado_por: dados.criadoPor,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Não foi possível registrar o anexo (sem permissão).')
  }
}

/** Remove a linha de metadados de um anexo (verifica que 1 linha foi apagada). */
export async function removerAnexoMeta(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Não foi possível remover o anexo (sem permissão ou inexistente).')
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/recebimento/infra/anexo-repository.ts
git commit -m "feat(anexos): repository de Storage + metadados dos anexos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Application — `anexos-actions.ts`

**Files:**
- Create: `src/modules/recebimento/application/anexos-actions.ts`

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, `registrarLog`, `ehTerminal` (`../domain/ciclo-vida`), `extensaoDoMime`/`validarArquivoImagem` (`../domain/anexo`), `buscarProcesso` (`../infra/processo-detalhe-repository`), e do `anexo-repository`: `buscarAnexo`, `contarAnexos`, `inserirAnexoMeta`, `removerAnexoMeta`, `removerObjeto`, `subirObjeto`.
- Produces:
  - `anexarFoto(processoId: string, form: FormData): Promise<{ ok: true } | { ok: false; erro: string }>`
  - `removerFoto(anexoId: string): Promise<{ ok: true } | { ok: false; erro: string }>`

- [ ] **Step 1: Criar as Server Actions**

Criar `src/modules/recebimento/application/anexos-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ehTerminal } from '../domain/ciclo-vida'
import { extensaoDoMime, validarArquivoImagem } from '../domain/anexo'
import { buscarProcesso } from '../infra/processo-detalhe-repository'
import {
  buscarAnexo,
  contarAnexos,
  inserirAnexoMeta,
  removerAnexoMeta,
  removerObjeto,
  subirObjeto,
} from '../infra/anexo-repository'

export type ResultadoAnexo = { ok: true } | { ok: false; erro: string }

const LIMITE_ANEXOS = 3

/**
 * Anexa uma foto a um processo (upload imediato). Gate `editar`; bloqueado em
 * processo terminal; respeita o limite de 3. Sobe o objeto e grava o metadado;
 * se o metadado falhar, remove o objeto (sem órfão no bucket).
 */
export async function anexarFoto(processoId: string, form: FormData): Promise<ResultadoAnexo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para anexar fotos.' }
  }

  const processo = await buscarProcesso(processoId)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status)) {
    return { ok: false, erro: 'Processo concluído: reabra o processo para anexar fotos.' }
  }

  if ((await contarAnexos(processoId)) >= LIMITE_ANEXOS) {
    return { ok: false, erro: `Limite de ${LIMITE_ANEXOS} fotos por processo.` }
  }

  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File)) {
    return { ok: false, erro: 'Nenhum arquivo enviado.' }
  }
  const validacao = validarArquivoImagem(arquivo.type, arquivo.size)
  if (!validacao.ok) return { ok: false, erro: validacao.erro }
  const ext = extensaoDoMime(arquivo.type)! // garantido não-nulo pela validação acima

  const path = `${processoId}/${crypto.randomUUID()}.${ext}`
  try {
    const bytes = await arquivo.arrayBuffer()
    await subirObjeto(path, bytes, arquivo.type)
  } catch {
    return { ok: false, erro: 'Não foi possível enviar a foto.' }
  }

  try {
    await inserirAnexoMeta({
      processoId,
      path,
      nomeOriginal: arquivo.name,
      mime: arquivo.type,
      tamanho: arquivo.size,
      criadoPor: sessao.usuarioId,
    })
  } catch {
    await removerObjeto(path).catch(() => {}) // rollback do objeto órfão
    return { ok: false, erro: 'Não foi possível registrar a foto.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: processoId,
    acao: 'alterar_campo',
    descricao: `Processo #${processo.numero} — foto anexada`,
    dados: { nome: arquivo.name, tamanho: arquivo.size },
  })

  revalidatePath(`/recebimento/processos/${processoId}`)
  return { ok: true }
}

/**
 * Remove uma foto de um processo (imediato). Gate `editar`; bloqueado em
 * processo terminal. Apaga o objeto e o metadado.
 */
export async function removerFoto(anexoId: string): Promise<ResultadoAnexo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para remover fotos.' }
  }

  const anexo = await buscarAnexo(anexoId)
  if (!anexo) return { ok: false, erro: 'Anexo não encontrado.' }

  const processo = await buscarProcesso(anexo.processoId)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status)) {
    return { ok: false, erro: 'Processo concluído: reabra o processo para remover fotos.' }
  }

  try {
    await removerObjeto(anexo.path)
    await removerAnexoMeta(anexoId)
  } catch {
    return { ok: false, erro: 'Não foi possível remover a foto.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: anexo.processoId,
    acao: 'excluir',
    descricao: `Processo #${processo.numero} — foto removida`,
    dados: { anexoId },
  })

  revalidatePath(`/recebimento/processos/${anexo.processoId}`)
  return { ok: true }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Confirma que `buscarProcesso` devolve `{ status, numero }`, que `ehTerminal` aceita `status`, e que os nomes do `anexo-repository` batem.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/recebimento/application/anexos-actions.ts
git commit -m "feat(anexos): Server Actions anexarFoto/removerFoto (gate editar, limite 3, terminal bloqueado)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — card de anexos + fiação + dependência

**Files:**
- Modify: `package.json` (+ `package-lock.json`) — dep `browser-image-compression`
- Modify: `next.config.ts` — `bodySizeLimit` das Server Actions
- Create: `src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/page.tsx`

**Interfaces:**
- Consumes: `anexarFoto`/`removerFoto` (Task 4), `AnexoComUrl`/`listarAnexosComUrl` (Task 3).
- Produces: `<AnexosProcesso processoId anexos somenteLeitura />` renderizado no detalhe.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install browser-image-compression`
Expected: adiciona a dep ao `package.json`/`package-lock.json` sem erro.

- [ ] **Step 1b: Aumentar o limite de corpo das Server Actions**

O upload de foto vai numa Server Action (`anexarFoto`) via `FormData`. O Next
tem um **limite padrão de 1 MB** para o corpo de Server Actions — como a
compressão do cliente mira ~1 MB (sem margem) e a validação do servidor
(`TAMANHO_MAX_ANEXO`) aceita até 5 MB, sem aumentar esse limite uma foto um
pouco acima de 1 MB seria rejeitada pelo Next antes de chegar na action (erro
genérico, não a mensagem em PT-BR). Elevar para **5 MB** (mesmo teto da
validação do servidor).

**IMPORTANTE (AGENTS.md):** confirme o local/nome exato dessa opção na doc do
Next 16 em `node_modules/next/dist/docs/` (procure por `bodySizeLimit` /
`serverActions`) antes de escrever — a chave pode estar sob `experimental` ou
não, dependendo da versão. Ajuste o `next.config.ts` conforme a doc. Referência
do que se espera (validar contra a doc):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
```

Rode `npx tsc --noEmit` para confirmar que o `NextConfig` aceita o formato
usado (se o tipo reclamar, é sinal de que a opção mudou de lugar na sua versão
— siga a doc).

- [ ] **Step 2: Criar o card client**

Criar `src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx`:

```tsx
'use client'

import { useRef, useTransition } from 'react'
import imageCompression from 'browser-image-compression'
import { ImagePlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { anexarFoto, removerFoto } from '@/modules/recebimento/application/anexos-actions'
import type { AnexoComUrl } from '@/modules/recebimento/infra/anexo-repository'

const LIMITE = 3
const UM_MB = 1_048_576

/**
 * Card "Fotos (N/3)" na tela de detalhe. Upload imediato: ao escolher/tirar a
 * foto, comprime no cliente se passar de 1 MB e envia na hora via `anexarFoto`
 * (não depende de nenhum botão Salvar). Exclusão também é imediata.
 * `somenteLeitura` (processo terminal) esconde os controles de anexar/excluir.
 */
export function AnexosProcesso({
  processoId,
  anexos,
  somenteLeitura,
}: {
  processoId: string
  anexos: AnexoComUrl[]
  somenteLeitura: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [ocupado, startTransition] = useTransition()

  const podeAdicionar = !somenteLeitura && anexos.length < LIMITE

  async function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo depois
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      toast.error('Selecione uma imagem.')
      return
    }

    let paraEnviar: File = arquivo
    if (arquivo.size > UM_MB) {
      try {
        paraEnviar = await imageCompression(arquivo, {
          maxSizeMB: 1,
          maxWidthOrHeight: 2000,
          useWebWorker: true,
        })
      } catch {
        toast.error('Não foi possível processar a imagem.')
        return
      }
    }

    const fd = new FormData()
    fd.append('arquivo', paraEnviar, arquivo.name)
    startTransition(async () => {
      const r = await anexarFoto(processoId, fd)
      if (r.ok) toast.success('Foto anexada.')
      else toast.error(r.erro)
    })
  }

  function aoRemover(id: string) {
    if (!window.confirm('Remover esta foto?')) return
    startTransition(async () => {
      const r = await removerFoto(id)
      if (r.ok) toast.success('Foto removida.')
      else toast.error(r.erro)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Fotos ({anexos.length}/{LIMITE})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {anexos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma foto anexada.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {anexos.map((anexo) => (
              <div
                key={anexo.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <a href={anexo.url} target="_blank" rel="noopener noreferrer">
                  {/* Signed URL dinâmica do Supabase Storage — <img> direto (sem next/image). */}
                  <img
                    src={anexo.url}
                    alt={anexo.nomeOriginal}
                    className="h-full w-full object-cover"
                  />
                </a>
                {!somenteLeitura && (
                  <button
                    type="button"
                    onClick={() => aoRemover(anexo.id)}
                    disabled={ocupado}
                    aria-label="Remover foto"
                    className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {podeAdicionar && (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={aoSelecionar}
            />
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon />
              {ocupado ? 'Enviando…' : 'Adicionar foto'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

Nota: o `<img>` com signed URL é intencional (não usa `next/image`, que exigiria configurar o host remoto do Supabase). Se o ESLint reclamar de `@next/next/no-img-element`, é apenas warning — `npm run lint` (eslint puro, sem `--max-warnings`) continua verde.

- [ ] **Step 3: Renderizar o card no `processo-detalhe.tsx`**

Em `src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx`:

1. Adicionar os imports (junto aos demais imports do topo):

```tsx
import { AnexosProcesso } from './anexos-processo'
import type { AnexoComUrl } from '@/modules/recebimento/infra/anexo-repository'
```

2. Adicionar `anexos` à interface `ProcessoDetalheProps` (após `filtros`):

```tsx
  /** Filtros de busca/status ativos na lista — preservados nas setas de navegação. */
  filtros: FiltrosProcessos
  /** Fotos anexadas ao processo, com signed URL para exibição. */
  anexos: AnexoComUrl[]
```

3. Adicionar `anexos` à desestruturação dos props da função `ProcessoDetalhe` (após `filtros`):

```tsx
  filtros,
  anexos,
}: ProcessoDetalheProps) {
```

4. Renderizar o card entre `<ProcessoForm ... />` e a `<div className="flex flex-wrap ... border-t ...">`:

```tsx
      />

      <AnexosProcesso processoId={processoId} anexos={anexos} somenteLeitura={somenteLeitura} />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
```

- [ ] **Step 4: Carregar os anexos no `page.tsx` e passar a prop**

Em `src/app/(app)/recebimento/processos/[id]/page.tsx`:

1. Adicionar o import (junto aos imports de infra):

```tsx
import { listarAnexosComUrl } from '@/modules/recebimento/infra/anexo-repository'
```

2. Incluir `listarAnexosComUrl(id)` no `Promise.all` existente (que hoje resolve `[sessao, campos, fornecedoresCriticos, nqa]`):

```tsx
  const [sessao, campos, fornecedoresCriticos, nqa, anexos] = await Promise.all([
    getSessao(),
    carregarCamposFormulario(),
    carregarCriticidade(),
    carregarTabelaNqa(),
    listarAnexosComUrl(id),
  ])
```

3. Passar a prop `anexos` ao `<ProcessoDetalhe>` (após `filtros={filtros}`):

```tsx
        anterior={anterior}
        proximo={proximo}
        filtros={filtros}
        anexos={anexos}
      />
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; a rota `/recebimento/processos/[id]` compila.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts "src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx" "src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx" "src/app/(app)/recebimento/processos/[id]/page.tsx"
git commit -m "feat(anexos): card de fotos no detalhe do processo (upload imediato + compressão)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final da branch

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; `anexo.test.ts` entre os suites.

- [ ] **Step 2: Smoke fim-a-fim (anotar resultado)**

Pré-requisito: a **migração 0017 já aplicada em produção pelo controller** (bucket + tabela + RLS + reload do schema cache).

Autenticado com `editar`, num processo **não** concluído:
1. Card "Fotos (0/3)" aparece abaixo da Qualidade.
2. "Adicionar foto" → escolher/tirar uma foto → miniatura aparece; contador vira 1/3. (Se >1 MB, subiu comprimida.)
3. Anexar até 3 → botão "Adicionar foto" some (limite atingido).
4. Excluir uma foto (confirmar) → some; contador cai.
5. Abrir a foto (clique) → signed URL abre a imagem.
6. Num processo **concluído**: o card mostra as fotos mas sem "Adicionar foto" nem botão de excluir.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Bucket + tabela + RLS (tabela e Storage) → Task 1. ✅
- Limite 3 (cliente + servidor) → Task 4 (`contarAnexos>=3`) + Task 5 (`anexos.length < LIMITE`). ✅
- Compressão >1 MB → Task 5 (`arquivo.size > UM_MB`). ✅
- Permissões ver/anexar/excluir (`visualizar`/`editar`) → Task 1 (RLS) + Task 4 (gate). ✅
- Terminal bloqueia anexar/excluir, mas vê → Task 4 (`ehTerminal`) + Task 5 (`somenteLeitura`). ✅
- Upload imediato, sem tocar `salvarSecaoProcesso`/botões de seção → Task 4/5 (actions próprias). ✅
- Path `{processoId}/{uuid}.{ext}`, rollback de órfão, log `alterar_campo`/`excluir`, revalidate → Task 4. ✅
- Validação pura (mime/tamanho) TDD → Task 2. ✅
- Signed URL para miniatura → Task 3 (`gerarUrlAnexo`/`listarAnexosComUrl`) + Task 5. ✅
- Dep `browser-image-compression` → Task 5. ✅

**Consistência de tipos:** `AnexoComUrl` (Task 3) consumido em Task 5 (props) e Task 5 wiring; `anexarFoto(processoId, FormData)`/`removerFoto(anexoId)` (Task 4) consumidos em Task 5; `validarArquivoImagem`/`extensaoDoMime` (Task 2) consumidos em Task 4; `buscarAnexo`/`contarAnexos`/`inserir/removerAnexoMeta`/`subir/removerObjeto` (Task 3) consumidos em Task 4. Migração 0017 (Task 1) sustenta as queries de Task 3. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
