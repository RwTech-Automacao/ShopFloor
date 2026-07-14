# Adicionar processo manual — Design

**Feature #4 do roadmap** (`docs/roadmap-pos-apresentacao.md`).

## Objetivo

Permitir criar um processo de recebimento **manualmente pela UI**. Hoje
processos só entram via importação de planilha (RPC `importar_processos`).
O cadastro manual segue **as mesmas regras da importação**: coleta os campos
dos grupos **Comercial + Material**, deixando Recebimento/Qualidade em branco
para a conferência; o processo nasce com `status = 'aberto'` e `numero`
automático.

## Decisões (aprovadas)

1. **Campos coletados:** grupos **comercial + material** (mesma regra do
   import). Recebimento/Qualidade ficam em branco.
2. **Obrigatórios na criação:** os campos com `obrigatorio_importacao = true`
   (mesma regra do import). Campos `calculado` nunca são digitados.
3. **Localização:** botão **"Adicionar processo"** no topo da lista de
   Processos (visível só com permissão `editar`). Leva a uma **página
   dedicada** `/recebimento/processos/novo`.
4. **Permissão:** reutiliza **`editar`**. O RLS de INSERT
   (`processos_insert`, migrações 0004/0007) já aceita
   `tem_permissao('editar')`. **Sem migração.**
5. **Após criar:** redireciona para `/recebimento/processos/{novoId}` (o
   detalhe do processo recém-criado, já em `aberto`, pronto para conferência).

## Arquitetura (camadas)

Segue o monólito modular existente. Nada de schema novo.

### Domínio / regras reaproveitadas

- `carregarCamposFormulario()` — fonte dos campos (grupo, tipo, `calculado`,
  `obrigatorioFinalizacao`, `ordem`). **Precisa expor também
  `obrigatorioImportacao`** (coluna `obrigatorio_importacao` de
  `configuracao_campos`), hoje não mapeada em `CampoFormulario`. Adicionar o
  campo ao `SELECT` e à interface.
- `converterValor(bruto, tipo)` — conversão/validação por tipo (reuso do
  `salvarSecaoProcesso`).
- `calcularCamposCalculados(...)` — computa `atraso`, `divergencia`,
  `critico`, `amostral` no servidor (reuso). O import **não** computa
  calculados (ficam nulos até o 1º save); o cadastro manual **computa e
  persiste** na criação — comportamento estritamente melhor e coerente com
  como o app trata um processo salvo.

### Infra — `processo-detalhe-repository.ts`

Nova função de INSERT (hoje só existe `atualizarProcesso`, que é UPDATE):

```ts
/** Insere um novo processo. Não envia `numero` (sequência) nem `status`
 *  (default 'aberto') — o banco atribui ambos. Retorna id + numero do novo
 *  processo. `patch` restrito às COLUNAS_GRAVAVEIS (mesma whitelist do update). */
export async function criarProcesso(
  patch: PatchProcesso & { criado_por: string },
): Promise<{ id: string; numero: number }>
```

- `supabase.from('processos_recebimento').insert(patchFiltrado).select('id, numero').single()`.
- Filtra `patch` pela whitelist `COLUNAS_GRAVAVEIS` já existente (+ `criado_por`).
- Erro do insert → lança (a Server Action traduz para mensagem amigável).

### Application — `criar-processo.ts` (novo)

```ts
'use server'
export async function criarProcessoManual(
  valores: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }>
```

Fluxo (espelha `salvarSecaoProcesso`):

1. `getSessao()` + `podeFazer(sessao.perfil, 'editar')` → senão erro de permissão.
2. `carregarCamposFormulario()`; considera só grupos **comercial + material**,
   ignora `calculado`.
3. **Valida obrigatórios:** todo campo com `obrigatorioImportacao = true`
   (nesses grupos) precisa ter valor não-vazio → senão
   `{ ok: false, erro: 'Campo obrigatório: <rótulo>.' }`.
4. `converterValor` por campo → erro por campo em conversão inválida (igual
   ao save).
5. `calcularCamposCalculados(...)` com os valores convertidos + tabelas
   (`carregarCriticidade`, `carregarTabelaNqa`) → mescla os calculados no patch.
6. `criarProcesso({ ...patch, criado_por: sessao.usuarioId })`.
7. `registrarLog({ entidade: 'processo', entidadeId: id, acao: 'criar',
   descricao: 'Processo #<numero> criado manualmente', dados: {...} })`
   (`'criar'` já existe no check de `logs.acao` e em `AcaoLog` — sem migração).
8. `revalidatePath('/recebimento/processos')`; retorna `{ ok: true, id }`.

### UI

- **Botão** em `processos/page.tsx`: cabeçalho acima de `<ProcessosFiltros>`
  com título "Processos" + botão/`Link` `+ Adicionar processo`
  (`bg-enterplak`) para `/recebimento/processos/novo`. A página vira
  server component que também busca `getSessao()` e só renderiza o botão se
  `podeFazer(perfil, 'editar')`.
- **Página** `processos/novo/page.tsx` (server): gate `editar` (senão
  `notFound()` ou redirect), carrega `carregarCamposFormulario` (filtra
  comercial+material) + `carregarItensPorLista` para os campos de lista, e
  renderiza `<NovoProcessoForm>`.
- **`novo/novo-processo-form.tsx`** (client): renderiza os campos editáveis
  (não-calculados) de Comercial e Material em cards por grupo (mesmo visual
  do detalhe), obrigatórios marcados com `*`, e um único botão
  **"Criar processo"**. No submit chama `criarProcessoManual(valores)`;
  sucesso → `toast.success` + `router.push('/recebimento/processos/'+id)`;
  erro → `toast.error(erro)`.
- **Reuso de renderização:** extrair o componente `CampoControle` (+
  `CampoCalculadoControle`) de `[id]/processo-form.tsx` para um módulo
  compartilhado `processos/campo-controle.tsx` e importar nos dois forms
  (DRY; refatoração pontual, sem mudança de comportamento no detalhe). O
  form de criação usa apenas o ramo editável (não passa campos calculados).

## Validação e erros

| Situação | Comportamento |
|---|---|
| Sem permissão `editar` | Botão não aparece; página `/novo` bloqueia; action retorna erro. |
| Falta campo `obrigatorio_importacao` | `toast.error('Campo obrigatório: <rótulo>.')` — não cria. |
| Conversão de tipo inválida | `toast.error('<rótulo>: <erro>')` — não cria. |
| Falha no INSERT (RLS/banco) | `toast.error('Não foi possível criar o processo.')` |
| Sucesso | Redireciona para o detalhe do novo processo. |

## Fora de escopo

- Nenhuma migração de schema ou permissão.
- Não altera o fluxo de importação.
- Não cria processo já finalizado (nasce `aberto`; conferência/finalização
  seguem o fluxo normal já existente).

## Testes

- **Domínio:** a validação de obrigatórios e a filtragem por grupo são
  testáveis puras — porém a lógica já é essencialmente a de
  `salvarSecaoProcesso`. TDD só onde houver regra pura nova (ex.: função que
  seleciona campos obrigatórios de criação, se extraída). Infra/app/UI por
  build + smoke.
- **Smoke:** com `editar`, criar um processo preenchendo só os obrigatórios
  → cai no detalhe em `aberto` com `numero` novo; campos calculados
  preenchidos. Sem `editar`, o botão/página não aparecem.
