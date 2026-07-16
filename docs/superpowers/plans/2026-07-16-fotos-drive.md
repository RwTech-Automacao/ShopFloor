# Fotos no Google Drive (adapter novo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um adapter Google Drive à porta `ArmazenamentoFotos` e torná-lo o storage ativo (`FOTOS_STORAGE=drive`), com exibição por rota proxy autenticada; R2/S3 e Supabase ficam dormentes.

**Architecture:** Generaliza a porta (`subir` passa a devolver a chave a persistir — o Drive só sabe o file ID após o upload). Novo adapter `drive.ts` (googleapis, OAuth+refresh token) + uma rota `GET /api/anexos/[chave]` que baixa do Drive e serve a foto só para quem está logado. Banco intocado (guarda `path`, agora o file ID no modo Drive).

**Tech Stack:** Next.js 16 (Route Handler runtime Node, Server Actions), TypeScript strict (`noUncheckedIndexedAccess`), Google Drive API via `googleapis`, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16 (params de rota dinâmica é **Promise**).
- **Subagentes NÃO instalam credenciais reais nem dão `git push`.** O smoke real com Drive depende do usuário concluir o OAuth e pôr as env do Google; `tsc`/`lint`/`build` **não** precisam das credenciais.
- **Conta = Gmail comum** → OAuth + refresh token (sem conta de serviço). Escopo `drive.file`.
- **Porta muda:** `subir(chave, dados, mime): Promise<string>` — devolve a chave a persistir. R2/Supabase devolvem a `chave` recebida; Drive devolve o `id`.
- **Exibição por rota proxy** `GET /api/anexos/[chave]` (sessão + `visualizar` + modo `drive`); a foto **não** fica pública no Drive.
- **`FOTOS_STORAGE=drive`** ativo; `r2`/`supabase` dormentes. Default do resolver continua `r2`.
- **Mantém:** comprime 1 MB (cliente), máx 3, exclusão apaga do Drive, rollback de órfão. Banco/migrações intocados. Export/limpeza (`anexo-export-repository.ts`) NÃO tocado.
- **Env server-only:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`. Dep nova: `googleapis`. `googleapis` só em código server.
- TS strict `noUncheckedIndexedAccess`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test`. SEM push.

## File Structure

- **Modify** `src/modules/recebimento/domain/armazenamento-fotos.ts` — `ModoStorage` +`'drive'`; `resolverModoStorage` mapeia 'drive'.
- **Modify** `src/modules/recebimento/domain/__tests__/armazenamento-fotos.test.ts` — casos 'drive'.
- **Modify** `src/modules/recebimento/domain/armazenamento-fotos.ts` — `subir` retorna `Promise<string>` (Task 2).
- **Modify** `src/modules/recebimento/infra/armazenamento/{r2,supabase}.ts` — `subir` retorna a chave.
- **Modify** `src/modules/recebimento/infra/anexo-repository.ts` — `subirObjeto` retorna string.
- **Modify** `src/modules/recebimento/application/anexos-actions.ts` — grava a chave devolvida.
- **Create** `src/modules/recebimento/infra/armazenamento/drive.ts` — adapter + `baixarFotoDrive`.
- **Modify** `src/modules/recebimento/infra/armazenamento/index.ts` — ramo `drive`.
- **Create** `src/app/api/anexos/[chave]/route.ts` — rota proxy.
- **Modify** `.env.example` — env do Google.

---

### Task 1: Domínio — modo `drive` no resolver (TDD)

**Files:**
- Modify: `src/modules/recebimento/domain/armazenamento-fotos.ts`
- Modify: `src/modules/recebimento/domain/__tests__/armazenamento-fotos.test.ts`

**Interfaces:**
- Produces: `type ModoStorage = 'r2' | 'supabase' | 'drive'`; `resolverModoStorage` mapeando os três.

- [ ] **Step 1: Atualizar os testes (que falham)**

Em `src/modules/recebimento/domain/__tests__/armazenamento-fotos.test.ts`, acrescentar dentro do `describe('resolverModoStorage', ...)`:

```ts
  it("'drive' → drive", () => expect(resolverModoStorage('drive')).toBe('drive'))
  it('trim + case-insensitive drive', () => expect(resolverModoStorage('  DRIVE ')).toBe('drive'))
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- armazenamento-fotos`
Expected: FAIL (resolver ainda não conhece 'drive').

- [ ] **Step 3: Implementar**

Em `src/modules/recebimento/domain/armazenamento-fotos.ts`, trocar o tipo e o resolver:

```ts
export type ModoStorage = 'r2' | 'supabase' | 'drive'
```

```ts
/** Resolve o modo a partir do valor de env. Default 'r2'; 'supabase' e 'drive'
 *  (após trim/lowercase) escolhem os outros; qualquer outra coisa cai em 'r2'. */
export function resolverModoStorage(valor: string | undefined): ModoStorage {
  const v = valor?.trim().toLowerCase()
  if (v === 'supabase') return 'supabase'
  if (v === 'drive') return 'drive'
  return 'r2'
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- armazenamento-fotos`
Expected: PASS (8 casos).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros. (Nota: o factory `index.ts` ainda mapeia 'drive' para o ramo `else` = r2 até a Task 3; compila e ninguém roda modo drive no meio do plano.)

```bash
git add src/modules/recebimento/domain/armazenamento-fotos.ts src/modules/recebimento/domain/__tests__/armazenamento-fotos.test.ts
git commit -m "feat(fotos): resolverModoStorage reconhece o modo drive (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Generalizar a porta — `subir` devolve a chave

**Files:**
- Modify: `src/modules/recebimento/domain/armazenamento-fotos.ts`
- Modify: `src/modules/recebimento/infra/armazenamento/r2.ts`
- Modify: `src/modules/recebimento/infra/armazenamento/supabase.ts`
- Modify: `src/modules/recebimento/infra/anexo-repository.ts`
- Modify: `src/modules/recebimento/application/anexos-actions.ts`

**Interfaces:**
- Produces: `subir(chave, dados, mime): Promise<string>` na porta; `subirObjeto(...): Promise<string>` no repo.

- [ ] **Step 1: Porta — `subir` retorna `Promise<string>`**

Em `src/modules/recebimento/domain/armazenamento-fotos.ts`, trocar a assinatura de `subir` na interface:

```ts
export interface ArmazenamentoFotos {
  /** Sobe a foto e devolve a CHAVE a persistir no banco.
   *  R2/Supabase: a própria `chave` recebida. Drive: o file ID gerado. */
  subir(chave: string, dados: ArrayBuffer, mime: string): Promise<string>
  /** URL assinada de curta duração para exibir/baixar (padrão 1 h). */
  urlAssinada(chave: string, segundos?: number): Promise<string>
  remover(chave: string): Promise<void>
}
```

- [ ] **Step 2: R2 e Supabase devolvem a chave**

Em `src/modules/recebimento/infra/armazenamento/r2.ts`, no `subir`, acrescentar `return chave` ao fim:

```ts
    async subir(chave, dados, mime) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: chave,
          Body: new Uint8Array(dados),
          ContentType: mime,
        }),
      )
      return chave
    },
```

Em `src/modules/recebimento/infra/armazenamento/supabase.ts`, no `subir`:

```ts
    async subir(chave, dados, mime) {
      const supabase = await createServerSupabase()
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(chave, dados, { contentType: mime, upsert: false })
      if (error) throw error
      return chave
    },
```

- [ ] **Step 3: `subirObjeto` retorna a chave**

Em `src/modules/recebimento/infra/anexo-repository.ts`:

```ts
/** Sobe um objeto para o storage ativo e devolve a chave a persistir
 *  (R2/Supabase: a mesma; Drive: o file ID). */
export async function subirObjeto(path: string, dados: ArrayBuffer, mime: string): Promise<string> {
  return armazenamentoAtual().subir(path, dados, mime)
}
```

- [ ] **Step 4: `anexarFoto` grava a chave devolvida**

Em `src/modules/recebimento/application/anexos-actions.ts`, trocar o bloco de upload (linhas ~52-58):

```ts
  const chaveSugerida = `${processoId}/${crypto.randomUUID()}.${ext}`
  let path: string
  try {
    const bytes = await arquivo.arrayBuffer()
    path = await subirObjeto(chaveSugerida, bytes, arquivo.type)
  } catch {
    return { ok: false, erro: 'Não foi possível enviar a foto.' }
  }
```

O resto (o `inserirAnexoMeta({ ... path ... })` e o rollback `removerObjeto(path)`) **não muda** —
`path` agora é a chave real devolvida pelo storage. (Se o tsc reclamar de "usado antes de
atribuir" no `path`, é seguro porque o `catch` retorna; caso reclame mesmo assim, inicialize
`let path = ''` e mantenha o resto.)

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros (comportamento de R2/Supabase idêntico; só o tipo de retorno mudou).

```bash
git add src/modules/recebimento/domain/armazenamento-fotos.ts src/modules/recebimento/infra/armazenamento/r2.ts src/modules/recebimento/infra/armazenamento/supabase.ts src/modules/recebimento/infra/anexo-repository.ts src/modules/recebimento/application/anexos-actions.ts
git commit -m "feat(fotos): porta subir() devolve a chave a persistir (prep p/ Drive)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Adapter Google Drive + registro no factory

**Files:**
- Modify: `package.json` (via `npm install googleapis`)
- Create: `src/modules/recebimento/infra/armazenamento/drive.ts`
- Modify: `src/modules/recebimento/infra/armazenamento/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ArmazenamentoFotos` (porta), `criarArmazenamentoDrive`.
- Produces: `criarArmazenamentoDrive(): ArmazenamentoFotos`; `baixarFotoDrive(fileId): Promise<{ dados: ArrayBuffer; mime: string }>`.

- [ ] **Step 1: Instalar googleapis**

Run: `npm install googleapis`
Expected: adiciona `googleapis` ao `package.json`/lockfile.

- [ ] **Step 2: Adapter Drive**

Criar `src/modules/recebimento/infra/armazenamento/drive.ts`:

```ts
import 'server-only'
import { Readable } from 'node:stream'
import { google, type drive_v3 } from 'googleapis'
import type { ArmazenamentoFotos } from '../../domain/armazenamento-fotos'

/** Lê uma env obrigatória do Google ou lança um erro claro. */
function env(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Configuração do Google Drive ausente: ${nome}.`)
  return valor
}

let clienteCache: drive_v3.Drive | null = null

function driveClient(): drive_v3.Drive {
  if (clienteCache) return clienteCache
  const oauth = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'))
  oauth.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') })
  clienteCache = google.drive({ version: 'v3', auth: oauth })
  return clienteCache
}

/** Último segmento da chave (a chave sugerida vem como `processoId/uuid.ext`). */
function nomeArquivo(chave: string): string {
  const partes = chave.split('/')
  return partes[partes.length - 1] || chave
}

/** Adapter Google Drive (OAuth + refresh token). Pasta única; escopo drive.file. */
export function criarArmazenamentoDrive(): ArmazenamentoFotos {
  const folder = env('GOOGLE_DRIVE_FOLDER_ID')
  return {
    async subir(chave, dados, mime) {
      const drive = driveClient()
      const res = await drive.files.create({
        requestBody: { name: nomeArquivo(chave), parents: [folder] },
        media: { mimeType: mime, body: Readable.from(Buffer.from(dados)) },
        fields: 'id',
      })
      const id = res.data.id
      if (!id) throw new Error('O Google Drive não retornou o id do arquivo.')
      return id
    },
    async urlAssinada(chave) {
      // Drive não tem URL assinada: a foto é servida pela rota proxy autenticada.
      return `/api/anexos/${encodeURIComponent(chave)}`
    },
    async remover(chave) {
      const drive = driveClient()
      await drive.files.delete({ fileId: chave })
    },
  }
}

/** Baixa o binário de um arquivo do Drive (usado pela rota de proxy). */
export async function baixarFotoDrive(
  fileId: string,
): Promise<{ dados: ArrayBuffer; mime: string }> {
  const drive = driveClient()
  const meta = await drive.files.get({ fileId, fields: 'mimeType' })
  const mime = meta.data.mimeType ?? 'application/octet-stream'
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return { dados: res.data as ArrayBuffer, mime }
}
```

- [ ] **Step 3: Registrar o ramo `drive` no factory**

Em `src/modules/recebimento/infra/armazenamento/index.ts`, importar e adicionar o ramo:

```ts
import { criarArmazenamentoDrive } from './drive'
```

Trocar a escolha do adapter em `armazenamentoAtual()`:

```ts
  const impl =
    modo === 'supabase'
      ? criarArmazenamentoSupabase()
      : modo === 'drive'
        ? criarArmazenamentoDrive()
        : criarArmazenamentoR2()
```

- [ ] **Step 4: Documentar env no `.env.example`**

Acrescentar ao `.env.example` (abaixo do bloco R2):

```
# Google Drive (quando FOTOS_STORAGE=drive) — server-only
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
```

- [ ] **Step 5: Verificar tipos/build e commit**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros (não precisa das credenciais reais para compilar).

```bash
git add package.json package-lock.json src/modules/recebimento/infra/armazenamento/drive.ts src/modules/recebimento/infra/armazenamento/index.ts .env.example
git commit -m "feat(fotos): adapter Google Drive (googleapis, OAuth) + registro no factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rota proxy de exibição

**Files:**
- Create: `src/app/api/anexos/[chave]/route.ts`

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, `modoStorageFotos`, `baixarFotoDrive`.

- [ ] **Step 1: Criar a rota**

Criar `src/app/api/anexos/[chave]/route.ts`:

```ts
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { modoStorageFotos } from '@/modules/recebimento/infra/armazenamento'
import { baixarFotoDrive } from '@/modules/recebimento/infra/armazenamento/drive'

/** Serve a foto do Drive só para quem está logado e tem `visualizar`. O Drive não
 *  tem URL assinada — esta rota é o proxy autenticado (só no modo drive). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ chave: string }> },
): Promise<Response> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return new Response('Não autorizado', { status: 403 })
  }
  if (modoStorageFotos() !== 'drive') {
    return new Response('Indisponível', { status: 404 })
  }
  const { chave } = await ctx.params
  try {
    const { dados, mime } = await baixarFotoDrive(decodeURIComponent(chave))
    return new Response(dados, {
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' },
    })
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
}
```

- [ ] **Step 2: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros; a rota `/api/anexos/[chave]` aparece no output do build (runtime Node).

```bash
git add "src/app/api/anexos/[chave]/route.ts"
git commit -m "feat(fotos): rota proxy autenticada que serve a foto do Drive

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os testes de `armazenamento-fotos` (8 casos) entre eles. O único warning aceitável é o pré-existente de `<img>` em `anexos-processo.tsx`.

- [ ] **Step 2: Smoke (anotar; NÃO fazer push)**

Pré-requisito do smoke: o usuário conclui o setup OAuth (Google Cloud → Drive API → consentimento `drive.file` → client id/secret → refresh token → pasta no Drive) e põe no `.env.local`: `FOTOS_STORAGE=drive` + `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN/GOOGLE_DRIVE_FOLDER_ID`.

- **Modo drive:** abrir um processo → **Adicionar foto** → ela sobe pra pasta no Drive e **aparece no card "Fotos (N/3)"** do processo (via `/api/anexos/[id]`); excluir → some do Drive; o menu **não** mostra "Exportar Fotos".
- **Plano B** (`FOTOS_STORAGE=supabase`, reiniciar): anexar → Supabase; "Exportar Fotos" reaparece.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- `ModoStorage` +'drive', resolver → Task 1. ✅
- Porta `subir` devolve a chave; R2/Supabase/repo/actions ajustados → Task 2. ✅
- Adapter Drive (subir/urlAssinada/remover + baixarFotoDrive) + factory → Task 3. ✅
- Rota proxy autenticada (sessão + visualizar + modo drive) → Task 4. ✅
- Env do Google + googleapis → Task 3. ✅
- Mantém 1MB/3/rollback; banco/export intocados → Global Constraints (só o retorno de `subir` muda). ✅

**Consistência de tipos:** `subir(): Promise<string>` (Task 2) implementado em r2/supabase (Task 2) e drive (Task 3); `subirObjeto(): Promise<string>` consumido em `anexos-actions` (Task 2). `modoStorageFotos`/`baixarFotoDrive` (Task 3) usados na rota (Task 4). `ModoStorage` (Task 1) usado no factory (Task 3). ✅

**Sem placeholders:** todo passo de código traz o código completo; o único condicional (fallback do `let path`) tem ação definida. ✅
