# Anexos de foto por processo — Subsistema A (núcleo) — Design

**Feature #1 do roadmap** (`docs/roadmap-pos-apresentacao.md`). Este spec cobre
o **subsistema A**: anexar, visualizar e excluir fotos dentro de um processo
de recebimento. O **subsistema B** (export mensal em ZIP + limpeza do bucket)
tem spec próprio (`2026-07-14-anexos-fotos-processo-B-design.md`) e é
implementado em um segundo ciclo; os dois vão para produção juntos.

## Objetivo

Permitir anexar até **3 fotos** por processo (câmera no celular/tablet ou
arquivo no desktop), visualizá-las como miniaturas na tela de detalhe do
processo e excluí-las. O Supabase Storage é um **buffer temporário**: as fotos
ficam visíveis no processo até o subsistema B exportar+limpar o mês.

## Decisões (aprovadas)

1. **Limite:** máximo **3 fotos por processo** (bloqueia a 4ª ao anexar).
2. **Compressão:** no cliente, se a foto passar de **1 MB**, comprime até
   ~1 MB antes de subir; se já for menor, sobe como está.
3. **Permissões:** ver = `visualizar`; anexar/excluir = `editar`. Sem
   permissão nova.
4. **Processo terminal** (concluído — `somenteLeitura`): as fotos continuam
   **visíveis**, mas anexar/excluir fica **bloqueado** (coerente com a regra
   "terminal é somente-leitura; para editar, Reabrir").
5. **Rename só no export (B):** dentro do app o arquivo é guardado por id
   interno; o nome legível (`pedido-item-p{numero}`) é aplicado apenas ao
   montar o ZIP no subsistema B.
6. **Visibilidade pós-limpeza:** depois que o mês é limpo (B), as fotos saem
   do Storage e o processo passa a mostrar "0 fotos" (ficam só no ZIP no
   Drive). Comportamento esperado e aprovado.

## Arquitetura

Segue o monólito modular (`src/modules/recebimento/{domain,application,infra}`)
e o padrão de Server Action + repository do módulo.

### Migração (Storage + metadados + RLS)

Nova migração `0017_anexos_processo.sql` (próximo número livre; a última é
`0016_processos_vizinhos.sql`):

1. **Bucket privado** `anexos-processos`:
   ```sql
   insert into storage.buckets (id, name, public)
   values ('anexos-processos', 'anexos-processos', false)
   on conflict (id) do nothing;
   ```
2. **Tabela de metadados** `public.anexos_processo`:
   ```sql
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
   ```
   - `on delete cascade`: se o processo for excluído, os metadados somem
     (os objetos do Storage são removidos pela ação de exclusão/limpeza —
     ver B; cascade cobre só a tabela).
3. **RLS da tabela** (mesmo padrão de `processos_recebimento`, via
   `tem_permissao`):
   ```sql
   create policy anexos_meta_select on public.anexos_processo
     for select to authenticated using (public.tem_permissao('visualizar'));
   create policy anexos_meta_insert on public.anexos_processo
     for insert to authenticated with check (public.tem_permissao('editar'));
   create policy anexos_meta_delete on public.anexos_processo
     for delete to authenticated using (public.tem_permissao('editar'));
   ```
   (Sem policy de UPDATE — metadados de anexo são imutáveis; só criar/apagar.)
4. **RLS do Storage** (`storage.objects`, restrito ao bucket):
   ```sql
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

Aplicada em produção pelo controller após o review da task da migração, com
reload do schema cache do PostgREST.

### Caminho do objeto

`{processo_id}/{uuid}.{ext}` — ex.: `a1b2.../9f3c.....jpg`. O `uuid` do path
evita colisão; o prefixo por `processo_id` facilita a limpeza por processo e
mantém tudo agrupável. O nome legível vem só no export (B).

### Infra — `anexo-repository.ts` (novo)

`src/modules/recebimento/infra/anexo-repository.ts` (sem `'use server'`; cada
função cria `await createServerSupabase()`):

- `type AnexoProcesso = { id: string; processoId: string; path: string; nomeOriginal: string; mime: string; tamanho: number; criadoEm: string }`
- `type AnexoComUrl = AnexoProcesso & { url: string }`
- `listarAnexos(processoId: string): Promise<AnexoProcesso[]>` — SELECT em
  `anexos_processo` por `processo_id`, ordenado por `created_at`.
- `gerarUrlAnexo(path: string): Promise<string>` — `supabase.storage
  .from('anexos-processos').createSignedUrl(path, 3600)` (1 h). Usado pelo
  loader da página para montar `AnexoComUrl[]`.
- `contarAnexos(processoId: string): Promise<number>`.
- `subirObjeto(path: string, arquivo: ArrayBuffer|Uint8Array, mime: string): Promise<void>` —
  `storage.from(...).upload(path, dados, { contentType: mime, upsert: false })`.
- `removerObjeto(path: string): Promise<void>` — `storage.from(...).remove([path])`.
- `inserirAnexoMeta(dados): Promise<void>` / `removerAnexoMeta(id): Promise<{ path: string; processoId: string } | null>`
  (o delete retorna o `path` para remover o objeto correspondente, ou `null`
  se o id não existir/RLS filtrar).

### Application — `anexos-actions.ts` (novo, `'use server'`)

`src/modules/recebimento/application/anexos-actions.ts`:

- `anexarFoto(processoId: string, form: FormData): Promise<{ ok: true } | { ok: false; erro: string }>`
  1. `getSessao()` + `podeFazer(sessao.perfil, 'editar')` → senão erro.
  2. `buscarProcesso(processoId)`; se não existe → erro. Se `ehTerminal(status)`
     → erro "Processo concluído: reabra para anexar." (coerência com terminal
     read-only).
  3. `contarAnexos(processoId)`; se ≥ 3 → erro "Limite de 3 fotos por processo.".
  4. Lê o `File` do `form` (campo `arquivo`). Valida `mime` começa com
     `image/`; valida tamanho ≤ 5 MB (defensivo — o cliente já comprime para
     ~1 MB). Deriva extensão do mime (`image/jpeg`→`jpg`, `image/png`→`png`,
     `image/webp`→`webp`; outro → erro).
  5. Monta `path = {processoId}/{crypto.randomUUID()}.{ext}`. `subirObjeto`.
  6. `inserirAnexoMeta`; se falhar, `removerObjeto(path)` (sem órfão) e erro.
  7. `registrarLog({ entidade: 'processo', entidadeId: processoId, acao:
     'alterar_campo', descricao: 'Processo #<numero> — foto anexada', dados:
     { nome, tamanho } })`.
  8. `revalidatePath('/recebimento/processos/'+processoId)`; `{ ok: true }`.
- `removerFoto(anexoId: string): Promise<{ ok: true } | { ok: false; erro: string }>`
  1. Gate `editar`. Carrega o anexo (path + processo_id + status do processo).
     Se terminal → erro (mesma regra). 
  2. `removerObjeto(path)` e `removerAnexoMeta(anexoId)`.
  3. `registrarLog(... acao: 'excluir', descricao: 'Processo #<numero> — foto
     removida')`; `revalidatePath`; `{ ok: true }`.

Observação: `crypto.randomUUID()` roda no server (Node/edge) — não é o
`Math.random` proibido em scripts de workflow; é API padrão do runtime.

### UI

- **Loader** em `[id]/page.tsx`: chama `listarAnexos(id)` + `gerarUrlAnexo`
  para cada um (ou um helper `listarAnexosComUrl(id)`), e passa
  `anexos: AnexoComUrl[]` para `<ProcessoDetalhe>`.
- **`processo-detalhe.tsx`**: renderiza `<AnexosProcesso processoId={...}
  anexos={anexos} somenteLeitura={somenteLeitura} />` como card irmão, após
  `<ProcessoForm>` e antes do bloco de ações.
- **`[id]/anexos-processo.tsx`** (novo, `'use client'`): card
  **"Fotos ({n}/3)"**.
  - Grade de miniaturas (as `url` assinadas); clique abre a foto (nova aba
    ou dialog). Botão de excluir por foto (só se `!somenteLeitura`),
    chamando `removerFoto` com confirmação.
  - Botão **"Adicionar foto"** (só se `!somenteLeitura` e `n < 3`): dispara
    um `<input type="file" accept="image/*" capture="environment" hidden />`.
    No `onChange`: se `arquivo.size > 1_048_576`, comprime com
    `browser-image-compression` (`maxSizeMB: 1`, `maxWidthOrHeight: 2000`,
    `useWebWorker: true`); monta `FormData` com o arquivo (campo `arquivo`);
    chama `anexarFoto(processoId, fd)` dentro de `useTransition`;
    `toast.success`/`toast.error`; a revalidação atualiza a lista.
  - Estados: enquanto sobe, botão desabilitado ("Enviando…").

### Dependência nova

- `browser-image-compression` (client-side). Adicionar ao `package.json`.
  (O `jszip` do subsistema B é adicionado no ciclo de B.)

## Validação e erros

| Situação | Comportamento |
|---|---|
| Sem `editar` | Botão some; action retorna erro. |
| Processo concluído (terminal) | Vê fotos; anexar/excluir bloqueado (erro "reabra para anexar/excluir"). |
| Já há 3 fotos | Botão some ao chegar em 3; action rejeita a 4ª. |
| Arquivo não-imagem ou > 5 MB | `toast.error` (tipo/tamanho). |
| Falha ao gravar metadado após upload | Objeto é removido (sem órfão) + `toast.error`. |
| Falha de upload/rede | `toast.error('Não foi possível anexar a foto.')`. |

## Fora de escopo (deste subsistema A)

- Export mensal em ZIP e limpeza do bucket → subsistema **B**.
- Rename dos arquivos (só acontece no export, em B).
- Google Drive API (v2 futura, fora dos dois subsistemas).

## Testes

- **Domínio puro (TDD):** função de derivação de extensão a partir do mime e
  de validação de tipo/tamanho, se extraída para o domínio (ex.:
  `validarArquivoImagem(mime, tamanho)` → `{ ok } | { ok:false, erro }` e
  `extensaoDoMime(mime)`). Essas são regras puras testáveis.
- **Infra/application/UI:** build + smoke (upload real depende de Storage +
  navegador com câmera).
- **Smoke:** com `editar`, anexar 1 foto → aparece a miniatura; anexar até 3
  → 4ª bloqueada; excluir → some; abrir a foto → signed URL funciona; num
  processo concluído, o card mostra as fotos mas sem botões de anexar/excluir.
