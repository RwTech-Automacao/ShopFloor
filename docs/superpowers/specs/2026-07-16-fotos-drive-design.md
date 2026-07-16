# Fotos no Google Drive (adapter novo) — Design

**Continuação do item 5 do roadmap** (`memory/roadmap-pos-reuniao.md`). Estende a
arquitetura de `docs/superpowers/specs/2026-07-16-fotos-r2-design.md`.

## Objetivo

Adicionar um adapter **Google Drive** à porta `ArmazenamentoFotos` (já existente) e
torná-lo o storage **ativo** (`FOTOS_STORAGE=drive`). As fotos de recebimento passam a
subir para uma pasta no Drive da conta `matheusrwtech@gmail.com`, com o banco guardando só
o **ID do arquivo**, e a exibição continua **dentro do processo**, privada, via uma rota
de proxy autenticada. O adapter **S3/R2** e o **Supabase (+ export/limpeza)** continuam no
código como plugins dormentes/plano B.

## Contexto herdado (já construído)

- Porta `ArmazenamentoFotos` + adapters R2 e Supabase + factory por env `FOTOS_STORAGE`
  (`docs/.../2026-07-16-fotos-r2*`). Upload comprime 1 MB no cliente, máx 3 fotos, exclusão
  remove storage + metadado, rollback de órfão. Metadados em `anexos_processo` (guarda `path`).

## Decisões (aprovadas)

1. **Conta = `matheusrwtech@gmail.com` (Gmail comum, NÃO Workspace).** Logo: **OAuth + refresh
   token** (não há conta de serviço/Shared Drive sem Workspace). Fragilidade aceita: em modo
   "teste" o refresh token expira ~7 dias; estabiliza com verificação única do Google depois.
2. **Drive é o adapter ATIVO** (`FOTOS_STORAGE=drive`). S3/R2 e Supabase ficam dormentes.
   Plano B (Supabase + export/limpeza) segue escondido, reativável por env.
3. **Exibição por rota proxy autenticada.** O Drive não tem URL assinada como o S3. Uma rota
   nova `GET /api/anexos/[chave]` (server) valida sessão + `visualizar` + modo `drive`, baixa o
   arquivo do Drive e o devolve ao navegador. A foto **não** fica pública no Drive.
4. **Banco guarda o file ID do Drive.** O Drive gera o ID no upload → **muda a porta:** `subir`
   passa a **devolver** a chave a persistir. S3/Supabase devolvem a própria chave recebida;
   Drive devolve o `id`. `anexos-actions` passa a gravar o valor devolvido.
5. **Uma pasta** no Drive (`GOOGLE_DRIVE_FOLDER_ID`); nome do arquivo = o UUID sugerido (sem
   renomear, como decidido). Organização por mês/pedido fica fora de escopo.
6. **Mantém:** comprime 1 MB (cliente), máx 3, exclusão apaga do Drive, rollback de órfão.
7. **Env server-only:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `GOOGLE_DRIVE_FOLDER_ID`. Dependência nova: `googleapis`.

## Arquitetura

### Mudança na porta — `domain/armazenamento-fotos.ts`

```ts
export type ModoStorage = 'r2' | 'supabase' | 'drive'

export interface ArmazenamentoFotos {
  /** Sobe a foto e devolve a CHAVE a persistir no banco.
   *  S3/Supabase: a própria `chave` sugerida. Drive: o file ID gerado. */
  subir(chave: string, dados: ArrayBuffer, mime: string): Promise<string>
  urlAssinada(chave: string, segundos?: number): Promise<string>
  remover(chave: string): Promise<void>
}

export function resolverModoStorage(valor: string | undefined): ModoStorage
```

`resolverModoStorage`: `'supabase'` → supabase; `'drive'` → drive; qualquer outra coisa
(incl. `'r2'`, vazio, inválido) → `'r2'` (default). TDD.

### Adapters existentes (ajuste mínimo)

- `infra/armazenamento/r2.ts` e `supabase.ts`: `subir` agora **retorna a `chave`** recebida
  (uma linha `return chave` ao fim). Nada mais muda.

### Adapter Drive — `infra/armazenamento/drive.ts`

Usa `googleapis` (`google.auth.OAuth2` + `google.drive('v3')`). Cliente OAuth2 construído com
`GOOGLE_CLIENT_ID`/`SECRET` e `setCredentials({ refresh_token })`. Memoizado.

```ts
export function criarArmazenamentoDrive(): ArmazenamentoFotos
// subir:   drive.files.create({ requestBody: { name: basename(chave), parents: [FOLDER] },
//            media: { mimeType: mime, body: Readable.from(Buffer.from(dados)) },
//            fields: 'id' }) → retorna data.id
// urlAssinada: retorna `/api/anexos/${encodeURIComponent(chave)}` (chave = file ID; sem chamar o Drive)
// remover: drive.files.delete({ fileId: chave })

/** Baixa o binário do Drive para a rota de proxy. */
export function baixarFotoDrive(fileId: string): Promise<{ dados: ArrayBuffer; mime: string }>
// drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' }) para os bytes;
// drive.files.get({ fileId, fields: 'mimeType' }) para o mime (fallback 'application/octet-stream').
```

### Factory — `infra/armazenamento/index.ts`

`armazenamentoAtual()` ganha o ramo `drive` → `criarArmazenamentoDrive()`. `modoStorageFotos()`
inalterado (já lê `resolverModoStorage`).

### Rota de proxy — `src/app/api/anexos/[chave]/route.ts`

```
GET:
  - getSessao(); se !sessao || !podeFazer(perfil,'visualizar') → 403
  - se modoStorageFotos() !== 'drive' → 404 (a rota só serve no modo Drive; S3/Supabase usam URL assinada)
  - const { dados, mime } = await baixarFotoDrive(params.chave)
  - return new Response(dados, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' } })
  - erro → 404 (foto some da tela, não derruba a página)
```

Runtime Node (googleapis exige Node; não Edge).

### Consumidores (ajuste do retorno de `subir`)

- `infra/anexo-repository.ts`: `subirObjeto(path, dados, mime): Promise<string>` (delega e
  **retorna** a chave da porta).
- `application/anexos-actions.ts`: grava a chave devolvida:
  `const chave = await subirObjeto(chaveSugerida, bytes, mime); inserirAnexoMeta({ path: chave, ... })`;
  no rollback, `removerObjeto(chave)`.

### Env / dependência

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`
  (server-only, `.env.example` documentado).
- `npm install googleapis`.
- **Pré-requisito (usuário, guiado depois):** projeto no Google Cloud → ativar Drive API →
  tela de consentimento OAuth (escopo `drive.file`) → credenciais OAuth (client id/secret) →
  autorização única para gerar o `refresh_token` → criar a pasta no Drive e pegar o folder ID.

## O que NÃO muda

- Componente de upload (`anexos-processo.tsx`), compressão, limite de 3, `anexo-export-repository.ts`
  (plano B), migrações/banco (`anexos_processo` segue guardando `path` — agora o file ID no modo Drive).
- Adapters R2/Supabase (só o `return chave`). Gates de export/limpeza (Task da fase R2).

## Segurança

- Escopo `drive.file` → o app só enxerga **arquivos que ele mesmo criou** (não o Drive inteiro).
- Credenciais Google **server-only** (env). A foto é servida só pela rota autenticada (sessão +
  `visualizar`); nunca fica pública no Drive.
- `googleapis` só em código server (adapter + rota); nunca no bundle do cliente.

## Validação e erros

| Situação | Comportamento |
|---|---|
| `FOTOS_STORAGE=drive` sem env do Google | `subir`/`baixar` lançam erro claro (env ausente) |
| Rota de proxy acessada sem login/sem `visualizar` | 403 |
| Rota de proxy em modo != drive | 404 |
| Falha ao baixar do Drive | 404 (a foto some da lista; página do processo não cai — `listarAnexosComUrl` já tolera) |
| Refresh token expirado (modo teste, ~7 dias) | Upload/exibição falham; reconectar (gerar novo refresh token) |

## Fora de escopo

- Conta de serviço / Shared Drive (exigiria Workspace).
- Verificação do app no Google (passo posterior para estabilizar o token — guiado à parte).
- Organização por pasta de mês/pedido; renomear arquivos.
- Migrar fotos existentes; galeria no app.
- Tornar a rota de proxy genérica para S3/Supabase (eles usam URL assinada; a rota é só do Drive).

## Testes

- **TDD (domínio):** `resolverModoStorage` — agora inclui `'drive'` → drive; `'r2'`/vazio/desconhecido → r2; `'supabase'` → supabase.
- **Infra/rota:** build + smoke (o smoke real depende das credenciais Google do usuário).
- **Smoke (modo drive):** anexar foto num processo → sobe pro Drive (aparece na pasta) e **aparece no card do processo** (via `/api/anexos/[id]`); excluir → some do Drive; menu sem "Exportar Fotos". **Plano B:** `FOTOS_STORAGE=supabase` → volta ao Supabase + export/limpeza.
- **Pré-requisito do smoke:** o usuário conclui o setup OAuth e põe as 4 env do Google no `.env.local`.
