# Fotos no Cloudflare R2 (armazenamento trocável) — Design

**Item 5 do roadmap pós-reunião** (`memory/roadmap-pos-reuniao.md`).

## Objetivo

Tirar as fotos de recebimento do Supabase Storage (Free = 1 GB, enche rápido) e
passá-las para o **Cloudflare R2** (10 GB grátis, sem taxa de download), atrás de uma
**abstração de armazenamento** que permita trocar de backend depois (S3 da AWS, e no
futuro Drive/Dropbox) sem mexer no resto do app. O Supabase Storage fica como **plano
B** — todo o fluxo atual (storage + export/limpeza) preservado no código, mas **escondido
do usuário**, reativável por uma variável de ambiente se o R2 der problema ou não for
aceito pela equipe.

## Contexto atual (o que já existe)

- Upload: `anexos-actions.ts::anexarFoto` comprime a 1 MB no cliente, valida (tipo/tamanho),
  gera a chave `${processoId}/${uuid}.${ext}` e chama `subirObjeto` (Supabase Storage,
  bucket privado `anexos-processos`). Máx **3** fotos por processo. Metadados em
  `anexos_processo` (só `path` + dados; **nenhuma foto no banco**).
- Exibição: `anexo-repository.ts::listarAnexosComUrl` gera **URL assinada** (1 h) por foto.
- Export/limpeza: tela `/recebimento/exportar-fotos` (menu `app-shell.tsx:49`, gate
  `administrar`) agrupa por mês, monta ZIP com nome `pedido-item-p{numero}-{indice}` e
  **limpa** (apaga do Storage) pra liberar a cota. Existe **por causa** do limite de 1 GB.

## Decisões (aprovadas)

1. **R2 ativo (primário).** Via SDK S3 (`@aws-sdk/client-s3`), bucket **privado**.
2. **Abstração `ArmazenamentoFotos`** (porta) — o app fala só com ela. Adapters: **R2**
   (ativo) e **Supabase** (dormente = o código de Storage atual, empacotado). Trocar pro
   **S3 da AWS** depois é o mesmo adapter do R2 com outro endpoint/credencial. Drive/Dropbox
   seriam adapters novos, sem tocar em upload/UI.
3. **Uma chave (env `FOTOS_STORAGE` = `r2` | `supabase`, padrão `r2`)** controla os dois:
   qual adapter está ativo **e** se a tela de export/limpeza aparece.
   - `r2`: upload/exibição no R2; export/limpeza **escondidos** (menu + rota).
   - `supabase` (plano B): tudo volta ao Supabase, e o export/limpeza **reaparece** — o
     fluxo de hoje, completo.
4. **Sem duplicar foto** (nada de gravar nos dois). Cada foto vive no storage ativo no
   momento do upload. Ao virar o plano B, as fotos novas funcionam 100% no Supabase; as
   que estavam no R2 voltam a aparecer quando o R2 for religado. Isso preserva a economia
   (duplicar refaria o problema do 1 GB).
5. **Sem migração** das fotos de teste atuais (são teste, no Free). As novas nascem no R2.
6. **Chave continua UUID** (`${processoId}/${uuid}.${ext}`). NÃO renomear no upload: a foto
   é vista só dentro do processo (ninguém folheia pasta), e pedido/item podem mudar depois.
   O nome amigável (`pedido-item-…`) segue só no ZIP do export (plano B).
7. **Exibição por URL assinada de curta duração** (mantém 1 h), gerada no servidor só pra
   quem tem `visualizar`. Sem link público permanente.
8. **Mantém:** comprimir 1 MB no cliente, máx 3 fotos, exclusão remove do storage + metadado.
9. **Sem migração de banco.** `anexos_processo` continua guardando `path` (a chave), agora
   interpretada pelo adapter ativo. Nenhuma coluna de "qual storage" (decisão 4).

## Arquitetura

### Porta (domínio) — `src/modules/recebimento/domain/armazenamento-fotos.ts`

```ts
export type ModoStorage = 'r2' | 'supabase'

/** Contrato de armazenamento de fotos. O app depende só disto; o backend concreto
 *  (R2, Supabase, futuramente S3/Drive) é escolhido por env. */
export interface ArmazenamentoFotos {
  subir(chave: string, dados: ArrayBuffer, mime: string): Promise<void>
  urlAssinada(chave: string, segundos?: number): Promise<string>
  remover(chave: string): Promise<void>
}

/** Resolve o modo a partir do valor de env (default 'r2'; valor inválido → 'r2'). */
export function resolverModoStorage(valor: string | undefined): ModoStorage
```

`resolverModoStorage` é pura → **TDD** (default r2, aceita 'supabase', qualquer outra coisa
cai em r2). O resto da porta é I/O, coberto por build + smoke.

### Adapters (infra)

- `infra/armazenamento/r2.ts` — `criarArmazenamentoR2(): ArmazenamentoFotos`. Cliente S3
  apontado pro R2 (`region: 'auto'`, `endpoint: https://<account>.r2.cloudflarestorage.com`,
  credenciais). `subir` = `PutObjectCommand`; `remover` = `DeleteObjectCommand`;
  `urlAssinada` = `getSignedUrl(GetObjectCommand, { expiresIn })` (`@aws-sdk/s3-request-presigner`).
- `infra/armazenamento/supabase.ts` — `criarArmazenamentoSupabase(): ArmazenamentoFotos`.
  Embrulha as chamadas de Storage que já existem (`storage.from('anexos-processos').upload/
  createSignedUrl/remove`).
- `infra/armazenamento/index.ts` — `armazenamentoAtual(): ArmazenamentoFotos` lê
  `resolverModoStorage(process.env.FOTOS_STORAGE)` e devolve o adapter. `modoStorageFotos():
  ModoStorage` exposto para os gates de UI.

### Ligações (o que muda no código atual)

- `anexo-repository.ts`: `subirObjeto`/`gerarUrlAnexo`/`removerObjeto` passam a **delegar**
  para `armazenamentoAtual()` (em vez de chamar o Supabase direto). As funções de metadado
  (`inserirAnexoMeta`, `listarAnexos`, etc.) **não mudam**. `anexos-actions.ts` e
  `listarAnexosComUrl` seguem iguais (já usam essas funções).
- **Export/limpeza NÃO é portado.** `anexo-export-repository.ts` continua falando com o
  Supabase direto — ele é a ferramenta do **plano B**. Só a **visibilidade** muda:
  - `app-shell.tsx:49` — o item "Exportar Fotos" só aparece quando `modoStorageFotos() ===
    'supabase'` (além do gate `administrar` que já existe).
  - `exportar-fotos/page.tsx` — guarda: se o modo não for `supabase`, mostra "indisponível"
    (a rota não fica acessível por link direto em modo R2).

### Env / configuração

- `FOTOS_STORAGE` = `r2` (padrão) | `supabase`.
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — **só no
  servidor** (env da Vercel), nunca expostas ao cliente.
- Nova dependência: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- **Pré-requisito (ação do usuário):** criar conta Cloudflare + bucket R2 privado + token de
  API com escopo só desse bucket, e passar os 4 valores. (O controller guia, como no domínio.)

## Segurança

- Bucket **privado** (padrão do R2); nada público.
- Credenciais **só no servidor** (env), token com **escopo** do bucket.
- Acesso sempre por **URL assinada curta** gerada no servidor pra quem tem `visualizar`.
- Criptografia em repouso (R2) e em trânsito (TLS). Mesmo modelo do Supabase Storage/S3.

## Fluxo de dados

```
Upload:   cliente comprime → anexarFoto → armazenamentoAtual().subir(chave, bytes, mime) → grava metadado
Exibir:   listarAnexosComUrl → armazenamentoAtual().urlAssinada(chave, 3600) → <img src>
Remover:  removerFoto → armazenamentoAtual().remover(chave) + remove metadado
Modo R2:      export/limpeza escondidos (menu + rota)
Plano B (env=supabase): storage volta ao Supabase E export/limpeza reaparecem — fluxo de hoje
```

## Validação e erros

| Situação | Comportamento |
|---|---|
| Upload falha no R2 | `anexarFoto` já faz rollback do objeto órfão e retorna erro amigável (mantém) |
| `FOTOS_STORAGE` ausente/ inválido | Cai em `r2` (default) |
| Credenciais R2 erradas | Upload/exibição falham com erro; rollback pra plano B é trocar a env |
| Modo R2, alguém acessa `/recebimento/exportar-fotos` por link | Página mostra "indisponível" |
| Foto do R2 vista em modo Supabase (plano B) | Imagem quebra até religar o R2 (aceito — decisão 4) |

## Fora de escopo

- Migrar as fotos de teste do Supabase pro R2.
- Duplicar/espelhar foto nos dois storages.
- Link público permanente (a exibição é só no app, logado).
- Renomear a chave no upload (nome amigável fica só no ZIP do export).
- Adapters de Drive/Dropbox (a porta permite adicionar depois; não agora).
- Galeria "todas as fotos" no app (o processo já mostra as fotos; YAGNI).

## Testes

- **TDD (domínio):** `resolverModoStorage` — default `r2`; `'supabase'` → supabase;
  `'r2'` → r2; valor desconhecido/`undefined`/vazio → `r2`.
- **Infra/UI:** build + smoke.
- **Smoke (modo R2):** anexar foto num processo → ela sobe no R2 e **aparece no processo**;
  excluir → some; o menu **não** mostra "Exportar Fotos"; acessar `/recebimento/exportar-fotos`
  por link → "indisponível". **Plano B (env=supabase):** anexar → vai pro Supabase; "Exportar
  Fotos" reaparece; export/limpeza funcionam como hoje.
- **Pré-requisito do smoke:** bucket R2 + credenciais na env local.
