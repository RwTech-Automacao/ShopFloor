# Anexos de foto por processo — Subsistema B (export mensal + limpeza) — Design

**Feature #1 do roadmap.** Segundo subsistema, implementado **após** o A
(`2026-07-14-anexos-fotos-processo-A-design.md`). Os dois vão para produção
**juntos** para o pessoal usar. Este documento registra as decisões já
tomadas no brainstorm; será a base do ciclo spec→plano→execução do B.

## Objetivo

Exportar todas as fotos de um mês num arquivo `.ZIP` com os arquivos
**renomeados** (para arquivar num Google Drive manualmente) e, em passo
separado, **limpar** essas fotos do Storage (que é buffer temporário).

## Decisões (aprovadas)

1. **Agrupamento por mês:** pela **data de chegada** do processo
   (`data_chegada`), mesma lógica dos accordions da lista. Processos sem data
   entram num grupo "sem-data".
2. **Export:** botão **"Exportar ZIP"** por mês → baixa um `.zip` com todas as
   fotos daquele mês, já renomeadas. ZIP montado no **servidor** (lib `jszip`,
   dependência nova).
3. **Rename dos arquivos no ZIP:** `{pedido}-{item}-p{numero}-{i}.{ext}`, onde
   `pedido` = `numero_pedido`, `item` = `codigo_material`, `numero` = número do
   processo, `i` = índice da foto no processo (1..3). Robustez obrigatória:
   - **Sanitizar** `pedido`/`item`: remover acentos e trocar caracteres
     inválidos de nome de arquivo (`/ \ : * ? " < > |`, espaços) por `-`.
   - **Fallback** quando `pedido` ou `item` estiver vazio: usar `p{numero}`
     naquela posição (nunca gerar nome quebrado como `-COD.jpg`).
   - **Unicidade** garantida pelo `p{numero}` (número do processo é único) +
     índice — dois processos com mesmo pedido+item nunca colidem no ZIP.
   - Exemplo: pedido `1234`, item `COD123`, processo #57, 2ª foto →
     `1234-COD123-p57-2.jpg`.
4. **Limpeza:** botão **separado** **"Limpar fotos do mês"**, com
   **confirmação**, gate `administrar`. Remove os objetos do Storage **e** as
   linhas de `anexos_processo` daquele mês. Nunca acoplado ao download (evita
   perda se o download falhar). Após limpar, os processos daquele mês passam a
   mostrar "0 fotos" (as fotos ficam só no ZIP arquivado no Drive).
5. **Tela:** nova página **"Exportar Fotos"** no menu Recebimento, gate
   `administrar`. Lista os meses que têm fotos (contagem por mês) e, por mês,
   os botões Exportar / Limpar.
6. **Sem automação:** nada de job agendado apagando fotos — a limpeza é sempre
   um ato manual e explícito do administrador, após arquivar.

## Arquitetura (aprovada)

Segue o monólito modular e os padrões do módulo recebimento. Reusa a infra do
subsistema A (bucket `anexos-processos`, tabela `anexos_processo`).

### Migração `0018_anexos_meses.sql`

RPC `public.anexos_meses()` espelhando `processos_meses` (0014): join
`anexos_processo` × `processos_recebimento`, agrupa por mês de `data_chegada`,
conta as fotos. `'sem_data'` para processos sem data.

```sql
create or replace function public.anexos_meses()
returns table (chave text, total bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(to_char(p.data_chegada, 'YYYY-MM'), 'sem_data') as chave,
         count(*) as total
  from public.anexos_processo a
  join public.processos_recebimento p on p.id = a.processo_id
  group by 1;
$$;
grant execute on function public.anexos_meses() to authenticated;
```

`security invoker` respeita o RLS (conta só o que o usuário vê). Aplicada em
produção pelo controller após o review da task.

### Entrega do ZIP — no CLIENTE (jszip)

Evita o teto de resposta serverless da Vercel (~4.5 MB) e escala para meses
grandes. Fluxo:

1. **Server Action `listarFotosDoMes(mes: string)`** (gate `administrar`,
   **client de serviço**): consulta as fotos do mês (join `anexos_processo` ×
   `processos_recebimento` onde `to_char(data_chegada,'YYYY-MM') = mes`, ou
   `data_chegada is null` quando `mes = 'sem_data'`), ordenadas por
   `processo_id, created_at`. Para cada foto devolve `{ signedUrl, pedido,
   item, numero, indice, ext }` — `indice` = posição da foto dentro do
   processo (1..N, calculado na ordenação), `ext` derivada do `mime` ou do
   `path`. As signed URLs são geradas via client de serviço (não depende de
   `visualizar`).
2. **Cliente** (`'use client'`): para cada foto, `fetch(signedUrl)` → `blob`;
   `zip.file(nomeArquivoFoto(...), blob)`; ao terminar, `zip.generateAsync` +
   dispara download `Fotos_{mes}.zip`. Erros por foto viram aviso (não abortam
   o ZIP inteiro).

### Limpeza — Server Action `limparFotosDoMes(mes)`

Gate `administrar`, **client de serviço**, chamada só após confirmação na UI.
Busca os `path`s + `id`s das fotos do mês (mesma consulta do export), remove os
objetos do Storage (`storage.remove([...paths])`, em lotes se necessário) e
apaga as linhas de `anexos_processo` por id. Loga `acao: 'excluir'`
(`entidade: 'processo'` ou um marcador do mês) e `revalidatePath` da tela.

### Permissão / client de serviço

As duas Server Actions do B são operações administrativas em lote: o gate
`administrar` no app é o portão autoritativo e elas usam o **client de
serviço** (`createServiceSupabase`, server-only). Motivo: o RLS de delete de
`anexos_processo`/`storage.objects` exige `editar` (regra do subsistema A) e um
admin pode não ter `editar`; o service client evita essa dependência. Nenhuma
mudança no RLS do A.

### Domínio — rename (TDD)

Função pura `nomeArquivoFoto(pedido, item, numero, indice, ext)`:
- Sanitiza `pedido`/`item`: remove acentos e troca `/ \ : * ? " < > |` e espaços
  por `-`; colapsa `-` repetidos.
- Fallback `p{numero}` quando `pedido` ou `item` fica vazio após sanitizar.
- Formato: `{pedido}-{item}-p{numero}-{indice}.{ext}` — único (garantido pelo
  `numero` do processo + `indice`).

### UI

- Item de menu **"Exportar Fotos"** em `RECEBIMENTO_NAV` (`permissao:
  'administrar'`, `href: '/recebimento/exportar-fotos'`).
- Página `/recebimento/exportar-fotos` (server, gate `administrar` →
  `<SemPermissao>`): carrega os meses via RPC `anexos_meses` e renderiza a lista
  com contagem + um componente client por mês (Exportar / Limpar).
- Cliente: **[Exportar ZIP]** chama `listarFotosDoMes` → monta o ZIP (jszip) →
  download; **[Limpar fotos do mês]** pede confirmação (`window.confirm`) →
  `limparFotosDoMes` → toast + refresh.

### Dependência nova

- `jszip` (montagem do ZIP no cliente).

## Fora de escopo

- Google Drive API (v2 futura — o arquivamento no Drive é manual: baixa o ZIP
  e sobe no Drive).
