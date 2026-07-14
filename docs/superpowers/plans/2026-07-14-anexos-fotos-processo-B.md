# Anexos de foto — Subsistema B (export ZIP mensal + limpeza) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar as fotos de um mês num `.ZIP` renomeado (montado no cliente) e limpar as fotos do mês do Storage, numa tela gated por `administrar`.

**Architecture:** Uma migração adiciona 2 RPCs (meses com fotos; fotos de um mês). Um domínio puro gera o nome do arquivo renomeado. Um repository (client de serviço) lista meses/fotos e apaga por mês. Server Actions gated por `administrar` expõem export e limpeza. A tela lista os meses; o ZIP é montado no navegador com jszip (evita o teto de resposta serverless).

**Tech Stack:** Next.js 16 (App Router, Server Actions/Components), TypeScript strict, Supabase (Postgres + Storage), jszip (novo), vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **ZIP montado no CLIENTE** (jszip) — não no servidor (evita o teto ~4.5 MB de resposta serverless).
- **Server Actions e repository do B usam o CLIENT DE SERVIÇO** (`createServiceSupabase`, server-only, ignora RLS), com gate **`administrar`** no app como portão autoritativo. Motivo: o RLS de delete dos anexos (subsistema A) exige `editar`, que um admin pode não ter. Sem mudar o RLS do A.
- **Rename:** `{pedido}-{item}-p{numero}-{indice}.{ext}`; sanitiza acentos e caracteres inválidos; fallback `p{numero}` se pedido/item vazio; único por `numero`+`indice`.
- **Mês** = `data_chegada` (`coalesce(to_char(data_chegada,'YYYY-MM'),'sem_data')`), como nos accordions.
- **Limpeza** é sempre manual, separada do export, com confirmação; loga `acao: 'excluir'`.
- **Reusar** `extensaoDoMime` (de `domain/anexo.ts`) para derivar extensão — não duplicar.
- **A migração 0018 é aplicada em produção PELO CONTROLLER** após o review da Task 1 (o subagent NÃO roda `supabase db push`).
- **Verificação (TDD só no domínio):** Task 2 tem teste; demais por `npx tsc --noEmit` + `npm run build` (e smoke do que exige Storage/navegador). `npm run test` no final.

---

### Task 1: Migração 0018 (RPCs de mês e de fotos do mês)

**Files:**
- Create: `supabase/migrations/0018_anexos_meses.sql`

**Interfaces:**
- Produces: `public.anexos_meses() → (chave text, total bigint)`; `public.anexos_do_mes(p_mes text) → (id uuid, path text, mime text, numero bigint, numero_pedido text, codigo_material text)`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0018_anexos_meses.sql`:

```sql
-- Export mensal de fotos (subsistema B): RPCs de agrupamento por mês da data de
-- chegada e de listagem das fotos de um mês (para o ZIP e a limpeza).

-- Contagem de fotos por mês da data de chegada do processo. 'sem_data' agrupa
-- fotos de processos sem data de chegada. security invoker: chamado pelo
-- client de serviço (bypassa RLS) → conta todas as fotos.
create or replace function public.anexos_meses()
returns table (chave text, total bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(to_char(p.data_chegada, 'YYYY-MM'), 'sem_data') as chave,
         count(*) as total
  from public.anexos_processo a
  join public.processos_recebimento p on p.id = a.processo_id
  group by 1;
$$;
grant execute on function public.anexos_meses() to authenticated, service_role;

-- Fotos de um mês (para montar o ZIP e para a limpeza). Ordenadas por numero do
-- processo e created_at → o índice da foto dentro do processo é estável.
-- p_mes no formato 'YYYY-MM' ou 'sem_data'.
create or replace function public.anexos_do_mes(p_mes text)
returns table (
  id uuid,
  path text,
  mime text,
  numero bigint,
  numero_pedido text,
  codigo_material text
)
language sql stable security invoker set search_path = public as $$
  select a.id, a.path, a.mime, p.numero, p.numero_pedido, p.codigo_material
  from public.anexos_processo a
  join public.processos_recebimento p on p.id = a.processo_id
  where coalesce(to_char(p.data_chegada, 'YYYY-MM'), 'sem_data') = p_mes
  order by p.numero, a.created_at;
$$;
grant execute on function public.anexos_do_mes(text) to authenticated, service_role;
```

- [ ] **Step 2: Não aplicar — commitar apenas**

NÃO rode `supabase db push`. A aplicação em produção é feita pelo controller após o review desta task (com reload do schema cache). Apenas commite.

```bash
git add supabase/migrations/0018_anexos_meses.sql
git commit -m "feat(anexos): migração 0018 — RPCs anexos_meses e anexos_do_mes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — `nomeArquivoFoto` (TDD)

**Files:**
- Modify: `src/modules/recebimento/domain/anexo.ts`
- Modify: `src/modules/recebimento/domain/__tests__/anexo.test.ts`

**Interfaces:**
- Produces: `nomeArquivoFoto(pedido: string, item: string, numero: number, indice: number, ext: string): string`

- [ ] **Step 1: Adicionar os testes (que falham)**

Em `src/modules/recebimento/domain/__tests__/anexo.test.ts`, adicionar `nomeArquivoFoto` ao import existente e um novo bloco `describe`:

```ts
import { extensaoDoMime, validarArquivoImagem, TAMANHO_MAX_ANEXO, nomeArquivoFoto } from '../anexo'
```

```ts
describe('nomeArquivoFoto', () => {
  it('monta {pedido}-{item}-p{numero}-{indice}.{ext}', () => {
    expect(nomeArquivoFoto('1234', 'COD123', 57, 2, 'jpg')).toBe('1234-COD123-p57-2.jpg')
  })
  it('remove acentos e troca caracteres inválidos/espaços por hífen', () => {
    expect(nomeArquivoFoto('PED 12/34', 'AÇO N5', 7, 1, 'png')).toBe('PED-12-34-ACO-N5-p7-1.png')
  })
  it('usa p{numero} quando pedido ou item fica vazio após sanitizar', () => {
    expect(nomeArquivoFoto('', '///', 9, 1, 'webp')).toBe('p9-p9-p9-1.webp')
  })
  it('colapsa hífens repetidos e apara as pontas', () => {
    expect(nomeArquivoFoto('  a  b  ', 'c', 3, 1, 'jpg')).toBe('a-b-c-p3-1.jpg')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- anexo`
Expected: FAIL (`nomeArquivoFoto` não existe / não exportado).

- [ ] **Step 3: Implementar**

No fim de `src/modules/recebimento/domain/anexo.ts`, adicionar:

```ts
/** Sanitiza um trecho para uso em nome de arquivo: sem acentos, sem caracteres
 *  inválidos, espaços/símbolos viram '-', sem '-' repetido nem nas pontas. */
function sanitizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos (acentos)
    .replace(/[\/\\:*?"<>|\s]+/g, '-') // caracteres inválidos de arquivo + espaços → '-'
    .replace(/-+/g, '-') // colapsa '-' repetidos
    .replace(/^-+|-+$/g, '') // apara '-' das pontas
}

/**
 * Nome do arquivo de uma foto no ZIP de export:
 * `{pedido}-{item}-p{numero}-{indice}.{ext}`. Usa `p{numero}` como fallback
 * quando `pedido` ou `item` fica vazio após sanitizar. A unicidade é garantida
 * pelo `numero` do processo + `indice`.
 */
export function nomeArquivoFoto(
  pedido: string,
  item: string,
  numero: number,
  indice: number,
  ext: string,
): string {
  const pedidoSan = sanitizarNome(pedido) || `p${numero}`
  const itemSan = sanitizarNome(item) || `p${numero}`
  return `${pedidoSan}-${itemSan}-p${numero}-${indice}.${ext}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- anexo`
Expected: PASS (todos, incluindo os 4 novos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/recebimento/domain/anexo.ts src/modules/recebimento/domain/__tests__/anexo.test.ts
git commit -m "feat(anexos): domínio nomeArquivoFoto para o rename do export (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra — `anexo-export-repository.ts`

**Files:**
- Create: `src/modules/recebimento/infra/anexo-export-repository.ts`

**Interfaces:**
- Consumes: `createServiceSupabase` (`@/shared/lib/supabase/service`, SÍNCRONO); `extensaoDoMime` (`../domain/anexo`); RPCs `anexos_meses`/`anexos_do_mes` (Task 1).
- Produces:
  - `interface MesAnexos { chave: string; total: number }`
  - `interface FotoExport { signedUrl: string; pedido: string; item: string; numero: number; indice: number; ext: string }`
  - `listarMesesAnexos(): Promise<MesAnexos[]>`
  - `listarFotosDoMes(mes: string): Promise<FotoExport[]>`
  - `limparFotosDoMes(mes: string): Promise<number>`

- [ ] **Step 1: Criar o repository**

Criar `src/modules/recebimento/infra/anexo-export-repository.ts`:

```ts
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { extensaoDoMime } from '../domain/anexo'

const BUCKET = 'anexos-processos'

export interface MesAnexos {
  chave: string
  total: number
}

export interface FotoExport {
  signedUrl: string
  pedido: string
  item: string
  numero: number
  indice: number
  ext: string
}

interface MesRow {
  chave: string
  total: number
}

interface FotoRow {
  id: string
  path: string
  mime: string
  numero: number
  numero_pedido: string | null
  codigo_material: string | null
}

/** Meses (por data de chegada) que têm fotos, com a contagem. */
export async function listarMesesAnexos(): Promise<MesAnexos[]> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_meses')
  if (error) throw error
  return ((data ?? []) as MesRow[]).map((r) => ({ chave: r.chave, total: Number(r.total) }))
}

/** Deriva a extensão do arquivo a partir do mime (preferido) ou do path. */
function derivarExt(mime: string, path: string): string {
  return extensaoDoMime(mime) ?? path.split('.').pop() ?? 'jpg'
}

/**
 * Fotos de um mês, cada uma com signed URL (1 h) e os dados do rename. O
 * `indice` é a posição da foto dentro do processo (1..N), estável pela ordem
 * da RPC (numero, created_at). Fotos cuja signed URL falhar são omitidas.
 */
export async function listarFotosDoMes(mes: string): Promise<FotoExport[]> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_do_mes', { p_mes: mes })
  if (error) throw error
  const rows = (data ?? []) as FotoRow[]

  const indicePorProcesso = new Map<number, number>()
  const fotos: FotoExport[] = []
  for (const row of rows) {
    const indice = (indicePorProcesso.get(row.numero) ?? 0) + 1
    indicePorProcesso.set(row.numero, indice)

    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.path, 3600)
    if (urlError || !urlData) continue // resiliente: omite a foto sem URL

    fotos.push({
      signedUrl: urlData.signedUrl,
      pedido: row.numero_pedido ?? '',
      item: row.codigo_material ?? '',
      numero: row.numero,
      indice,
      ext: derivarExt(row.mime, row.path),
    })
  }
  return fotos
}

/** Apaga do Storage e da tabela todas as fotos de um mês. Retorna a quantidade removida. */
export async function limparFotosDoMes(mes: string): Promise<number> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_do_mes', { p_mes: mes })
  if (error) throw error
  const rows = (data ?? []) as FotoRow[]
  if (rows.length === 0) return 0

  const paths = rows.map((r) => r.path)
  const ids = rows.map((r) => r.id)

  const { error: remErr } = await supabase.storage.from(BUCKET).remove(paths)
  if (remErr) throw remErr
  const { error: delErr } = await supabase.from('anexos_processo').delete().in('id', ids)
  if (delErr) throw delErr
  return ids.length
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/recebimento/infra/anexo-export-repository.ts
git commit -m "feat(anexos): repository de export/limpeza mensal (client de serviço)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Application — `exportar-fotos-actions.ts`

**Files:**
- Create: `src/modules/recebimento/application/exportar-fotos-actions.ts`

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, `registrarLog`; `listarFotosDoMes`, `limparFotosDoMes` (repo), `FotoExport` (Task 3).
- Produces:
  - `obterFotosDoMes(mes: string): Promise<{ ok: true; fotos: FotoExport[] } | { ok: false; erro: string }>`
  - `limparFotosDoMes(mes: string): Promise<{ ok: true; removidos: number } | { ok: false; erro: string }>`

- [ ] **Step 1: Criar as Server Actions**

Criar `src/modules/recebimento/application/exportar-fotos-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  limparFotosDoMes as limparFotosDoMesRepo,
  listarFotosDoMes,
  type FotoExport,
} from '../infra/anexo-export-repository'

export type ResultadoExport = { ok: true; fotos: FotoExport[] } | { ok: false; erro: string }
export type ResultadoLimpeza = { ok: true; removidos: number } | { ok: false; erro: string }

/** Fotos de um mês para montar o ZIP no cliente. Gate `administrar`. */
export async function obterFotosDoMes(mes: string): Promise<ResultadoExport> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para exportar fotos.' }
  }
  try {
    const fotos = await listarFotosDoMes(mes)
    if (fotos.length === 0) return { ok: false, erro: 'Nenhuma foto neste mês.' }
    return { ok: true, fotos }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as fotos do mês.' }
  }
}

/** Apaga as fotos de um mês do Storage e da tabela. Gate `administrar`. */
export async function limparFotosDoMes(mes: string): Promise<ResultadoLimpeza> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para limpar fotos.' }
  }
  let removidos: number
  try {
    removidos = await limparFotosDoMesRepo(mes)
  } catch {
    return { ok: false, erro: 'Não foi possível limpar as fotos do mês.' }
  }
  await registrarLog({
    entidade: 'processo',
    acao: 'excluir',
    descricao: `Fotos do mês ${mes} removidas (${removidos})`,
    dados: { mes, removidos },
  })
  revalidatePath('/recebimento/exportar-fotos')
  return { ok: true, removidos }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/recebimento/application/exportar-fotos-actions.ts
git commit -m "feat(anexos): Server Actions de export/limpeza mensal (gate administrar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — menu, página e cliente + dep `jszip`

**Files:**
- Modify: `package.json` (+ `package-lock.json`) — dep `jszip`
- Modify: `src/shared/ui/recebimento-nav.ts`
- Create: `src/app/(app)/recebimento/exportar-fotos/page.tsx`
- Create: `src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx`

**Interfaces:**
- Consumes: `listarMesesAnexos` (Task 3), `obterFotosDoMes`/`limparFotosDoMes` (Task 4), `nomeArquivoFoto` (Task 2), `rotuloMes` (`@/modules/recebimento/domain/agrupamento-mes`), `getSessao`, `podeFazer`, `SemPermissao`, `JSZip`.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install jszip`
Expected: adiciona a dep ao `package.json`/`package-lock.json` sem erro. (jszip 3.x já traz os tipos TypeScript embutidos — não precisa de `@types/jszip`.)

- [ ] **Step 2: Registrar o item de menu**

Em `src/shared/ui/recebimento-nav.ts`, adicionar o item ao array `RECEBIMENTO_NAV` (após `etiquetas`):

```ts
  { chave: 'etiquetas', rotulo: 'Etiquetas', href: '/recebimento/etiquetas', permissao: 'gerar_etiqueta' },
  { chave: 'exportar-fotos', rotulo: 'Exportar Fotos', href: '/recebimento/exportar-fotos', permissao: 'administrar' },
]
```

(O `itensRecebimentoVisiveis` já filtra por permissão — o item só aparece para quem tem `administrar`.)

- [ ] **Step 3: Criar a página server (gate + lista de meses)**

Criar `src/app/(app)/recebimento/exportar-fotos/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarMesesAnexos } from '@/modules/recebimento/infra/anexo-export-repository'
import { rotuloMes } from '@/modules/recebimento/domain/agrupamento-mes'
import { ExportarFotosCliente } from './exportar-fotos-cliente'

export default async function ExportarFotosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para exportar fotos." />
  }

  const meses = await listarMesesAnexos()
  // 'sem_data' por último; meses reais em ordem decrescente (mais recente primeiro).
  const ordenados = [...meses].sort((a, b) => {
    if (a.chave === 'sem_data') return 1
    if (b.chave === 'sem_data') return -1
    return b.chave.localeCompare(a.chave)
  })

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Exportar Fotos</h1>
      {ordenados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto anexada ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ordenados.map((mes) => (
            <ExportarFotosCliente
              key={mes.chave}
              mes={mes.chave}
              rotulo={rotuloMes(mes.chave)}
              total={mes.total}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Criar o cliente (export ZIP + limpeza)**

Criar `src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'
import { DownloadIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  obterFotosDoMes,
  limparFotosDoMes,
} from '@/modules/recebimento/application/exportar-fotos-actions'
import { nomeArquivoFoto } from '@/modules/recebimento/domain/anexo'

/** Uma linha por mês: exportar o ZIP (montado aqui no navegador) e limpar. */
export function ExportarFotosCliente({
  mes,
  rotulo,
  total,
}: {
  mes: string
  rotulo: string
  total: number
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)

  async function exportar() {
    setOcupado(true)
    try {
      const r = await obterFotosDoMes(mes)
      if (!r.ok) {
        toast.error(r.erro)
        return
      }
      const zip = new JSZip()
      let ignoradas = 0
      for (const foto of r.fotos) {
        try {
          const resp = await fetch(foto.signedUrl)
          if (!resp.ok) throw new Error('fetch falhou')
          const blob = await resp.blob()
          zip.file(
            nomeArquivoFoto(foto.pedido, foto.item, foto.numero, foto.indice, foto.ext),
            blob,
          )
        } catch {
          ignoradas += 1
        }
      }
      const conteudo = await zip.generateAsync({ type: 'blob' })
      dispararDownload(conteudo, `Fotos_${mes}.zip`)
      toast.success(
        ignoradas > 0 ? `ZIP gerado (${ignoradas} foto(s) ignorada(s)).` : 'ZIP gerado.',
      )
    } catch {
      toast.error('Não foi possível gerar o ZIP.')
    } finally {
      setOcupado(false)
    }
  }

  function limpar() {
    if (
      !window.confirm(
        `Apagar TODAS as ${total} foto(s) de ${rotulo}? Faça o export antes — isto não tem desfazer.`,
      )
    ) {
      return
    }
    setOcupado(true)
    void (async () => {
      try {
        const r = await limparFotosDoMes(mes)
        if (r.ok) {
          toast.success(`${r.removidos} foto(s) removida(s).`)
          router.refresh()
        } else {
          toast.error(r.erro)
        }
      } finally {
        setOcupado(false)
      }
    })()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <span className="font-medium">
        {rotulo}{' '}
        <span className="text-muted-foreground">
          ({total} foto{total === 1 ? '' : 's'})
        </span>
      </span>
      <div className="flex gap-2">
        <Button onClick={exportar} disabled={ocupado} className="bg-enterplak hover:bg-enterplak-700">
          <DownloadIcon />
          {ocupado ? 'Processando…' : 'Exportar ZIP'}
        </Button>
        <Button onClick={limpar} disabled={ocupado} variant="outline">
          <Trash2Icon />
          Limpar fotos do mês
        </Button>
      </div>
    </div>
  )
}

function dispararDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; a rota `/recebimento/exportar-fotos` aparece no output.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared/ui/recebimento-nav.ts "src/app/(app)/recebimento/exportar-fotos/page.tsx" "src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx"
git commit -m "feat(anexos): tela Exportar Fotos — ZIP mensal no cliente + limpeza

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final da branch

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; `anexo.test.ts` inclui os novos testes de `nomeArquivoFoto`.

- [ ] **Step 2: Smoke fim-a-fim (anotar resultado)**

Pré-requisito: **migração 0018 já aplicada em produção pelo controller** (2 RPCs + reload do schema cache), e já existir alguma foto anexada (subsistema A).

Autenticado com `administrar`:
1. Menu Recebimento mostra "Exportar Fotos" → abre a tela com os meses e a contagem.
2. **Exportar ZIP** de um mês → baixa `Fotos_{mes}.zip`; abrir o zip → fotos renomeadas `{pedido}-{item}-p{numero}-{i}.ext` (com sanitização e fallback quando aplicável).
3. **Limpar fotos do mês** → confirmação → some do Storage; a tela atualiza (mês some ou zera); abrir um processo daquele mês → card "Fotos (0/3)".
4. Com um perfil sem `administrar`: o item de menu não aparece e `/recebimento/exportar-fotos` mostra `<SemPermissao>`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- RPC meses + RPC fotos do mês → Task 1. ✅
- Rename sanitizado com fallback e unicidade → Task 2 (`nomeArquivoFoto`, TDD). ✅
- Client de serviço + gate `administrar` → Task 3 (repo) + Task 4 (actions). ✅
- ZIP no cliente (jszip) evitando o teto serverless → Task 5 (cliente). ✅
- Limpeza separada com confirmação + log `excluir` → Task 4 (action) + Task 5 (confirm). ✅
- Tela no menu (gate administrar) + lista de meses por `data_chegada` com `rotuloMes` → Task 5. ✅
- Reuso de `extensaoDoMime` → Task 3 (`derivarExt`). ✅
- Dep `jszip` → Task 5. ✅

**Consistência de tipos:** `MesAnexos`/`FotoExport` (Task 3) consumidos em Task 4 e Task 5; `listarMesesAnexos`/`listarFotosDoMes`/`limparFotosDoMes` (Task 3) em Task 4/5; `obterFotosDoMes`/`limparFotosDoMes` (Task 4) em Task 5; `nomeArquivoFoto` (Task 2) em Task 5; RPCs `anexos_meses`/`anexos_do_mes` (Task 1) em Task 3. O nome `limparFotosDoMes` existe no repo (Task 3) e na action (Task 4) — a action importa o do repo com alias `limparFotosDoMesRepo` para não colidir. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
