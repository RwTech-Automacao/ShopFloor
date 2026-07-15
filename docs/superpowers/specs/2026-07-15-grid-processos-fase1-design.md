# Grid de Processos (tipo Excel) — Fase 1: O Grid — Design

**Item 2 do roadmap pós-reunião** (`memory/roadmap-pos-reuniao.md`), quebrado em 3 features.
Esta é a **Fase 1**. As outras: **Fase 2** = tela admin de layout (reordenar/ocultar);
**Fase 3** = setas ‹ › seguindo a ordem/filtros do grid.

## Objetivo

A tela de Processos deixa de ser accordion por mês e vira uma **planilha**: cada campo
do processo é uma **coluna**, com **ordenação** e **filtro por coluna** imitando o Excel,
**paginação** — tudo **no servidor**.

## Decisões (aprovadas)

1. **Cada campo = uma coluna.** Catálogo = `configuracao_campos` (`ativo=true`, 37 campos)
   + duas colunas de sistema: **`numero`** e **`status`** (= 39 no total).
2. **O accordion por mês SAI.** O mês vira **filtro da coluna Data Chegada**.
3. **Por coluna:** ordenar **A→Z / Z→A** e filtrar **imitando o Excel = os dois juntos**
   (caixa de **busca por texto** + **lista de valores com checkbox**, no mesmo menu).
4. **🔴 Filtro/ordenação valem sobre a BASE INTEIRA, não sobre a página carregada.**
   Filtrou na página 1 algo que estaria na "página 10" → o item aparece, e a paginação se
   refaz sobre o resultado filtrado. Logo: **filtro, ordenação e paginação no servidor.**
5. **Padrão de colunas visíveis (11):** `numero`, `numero_nf`, `numero_emb`, `di_inpi`,
   `acp_cliente`, `numero_pedido`, `tipo`, `fornecedor`, `codigo_material`,
   **`data_chegada`**, `status`. As demais nascem ocultas.
   > `data_chegada` entra **obrigatoriamente** porque o accordion por mês está saindo e é
   > por essa coluna que se filtra o mês. Sem ela, a navegação por mês se perderia até a Fase 2.
6. **Layout é config GERAL**, em tabela **separada** da config dos campos (para não mexer
   em `ordem`/`grupo`, que o formulário do processo usa). A Fase 1 **lê**; a **Fase 2**
   cria a tela de editar (só `administrar`).
7. **Sem biblioteca de grid.** Como o layout é config do banco (não estado interativo por
   usuário) e ordenação/filtro são no servidor, TanStack Table não agregaria.
8. **Setas ‹ › ficam na ordem antiga** nesta fase — **dívida conhecida e declarada**,
   resolvida na Fase 3.
9. **Linhas por página = seletor na própria tela** (25/50/100/200, **padrão 50**), no rodapé
   junto da paginação, e faz parte do estado da URL. Assim o usuário calibra usando, sem
   depender de ninguém definir o número antes — e sem precisar de deploy para mudar.

## Arquitetura

### Migração `0021_grid_processos.sql`

**a) Tabela de layout da lista** (separada de `configuracao_campos`):

```sql
create table public.colunas_lista (
  campo text primary key,
  visivel boolean not null default false,
  ordem int not null default 0
);
alter table public.colunas_lista enable row level security;
-- Todo autenticado LÊ o layout (a lista precisa dele); só admin escreve (Fase 2).
create policy colunas_lista_select on public.colunas_lista
  for select to authenticated using (true);
create policy colunas_lista_write on public.colunas_lista
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));
```

Seed: **as 11 colunas do padrão** com `visivel=true` e `ordem` na sequência acima; as
demais (`configuracao_campos.campo` restantes) com `visivel=false`. `campo` é **texto
livre** (não é FK) justamente para acomodar `numero` e `status`, que não existem em
`configuracao_campos`.

**b) RPC de valores distintos** (para a lista de checkbox), com **whitelist**:

```sql
create or replace function public.valores_distintos_processos(p_coluna text, p_limite int default 200)
returns table (valor text)
language plpgsql stable security invoker set search_path = public as $$
begin
  -- Whitelist: só colunas que existem em processos_recebimento. Sem isto, p_coluna
  -- entraria em SQL dinâmico — o único ponto do projeto com esse risco.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'processos_recebimento'
      and column_name = p_coluna
  ) then
    raise exception 'coluna inválida';
  end if;

  return query execute format(
    -- Datas viram o MÊS ('YYYY-MM' / 'sem_data'): é assim que o usuário filtra por mês.
    $q$ select distinct case
          when pg_typeof(%1$I)::text = 'date'
            then coalesce(to_char(%1$I, 'YYYY-MM'), 'sem_data')
          else coalesce(%1$I::text, '') end as valor
        from public.processos_recebimento
        order by 1 limit %2$L $q$,
    p_coluna, p_limite
  );
end $$;
grant execute on function public.valores_distintos_processos(text, int) to authenticated;
```

`security invoker` → respeita o RLS (só vê o que pode ver).

### Estado do grid — na URL

O estado (ordenação + filtros + página) vive **na URL**, num **único parâmetro
codificado** (`?g=<json>`). Motivo: preservar o comportamento de hoje — filtrar, abrir um
processo e **voltar** mantendo o contexto — e permitir que a **Fase 3** leia esse estado
para as setas. Estado em memória perderia os filtros ao navegar.

**Domínio (TDD)** — `src/modules/recebimento/domain/estado-grid.ts`:

```ts
export type FiltroColuna = { texto?: string; valores?: string[] }
export interface EstadoGrid {
  ordenar: string          // nome da coluna
  direcao: 'asc' | 'desc'
  pagina: number           // 0-based
  tamanho: number          // linhas por página (seletor da UI)
  filtros: Record<string, FiltroColuna>
}
export const TAMANHOS_PAGINA = [25, 50, 100, 200] as const
export const ESTADO_GRID_PADRAO: EstadoGrid
// { ordenar:'numero', direcao:'desc', pagina:0, tamanho:50, filtros:{} }

export function codificarEstadoGrid(estado: EstadoGrid): string
/** Decodifica E VALIDA contra a whitelist de colunas. Entrada inválida/adulterada
 *  degrada para o padrão em vez de quebrar (o param vem da URL — não é confiável). */
export function decodificarEstadoGrid(param: string | undefined, colunasValidas: string[]): EstadoGrid
```

### Infra — `processo-repository.ts`

`listarProcessos` (hoje **código morto**, já com paginação + `count: 'exact'`) é
**substituída** por:

```ts
export interface ColunaLista { campo: string; visivel: boolean; ordem: number }
export async function listarColunasLista(): Promise<ColunaLista[]>

export async function listarProcessosGrid(params: {
  estado: EstadoGrid       // inclui ordenar/direcao/pagina/tamanho/filtros
  colunas: string[]        // colunas visíveis (o SELECT traz só elas + id)
  tiposPorCampo: Record<string, 'texto' | 'lista' | 'numero' | 'data'>
}): Promise<{ linhas: Record<string, unknown>[]; total: number }>

export async function valoresDistintosColuna(campo: string): Promise<string[]>
```

Construção da consulta (PostgREST via supabase-js — **sem SQL dinâmico**):
- `SELECT` = `id` + as colunas visíveis (payload menor).
- **Filtro texto** → `.ilike(coluna, '%' + sanitizarTermoBusca(texto) + '%')`.
- **Filtro por valores** (checkbox):
  - coluna comum → `.in(coluna, valores)`;
  - **coluna de data** → os valores são **meses** (`'YYYY-MM'` / `'sem_data'`), traduzidos
    para faixas: `sem_data` → `coluna.is.null`; mês → `and(coluna.gte.YYYY-MM-01,coluna.lt.<inicioProximoMes>)`.
    Vários meses = `.or(...)` das faixas. Reusa `inicioProximoMes` de `agrupamento-mes.ts`.
- **Ordenação** → `.order(estado.ordenar, { ascending: estado.direcao === 'asc' })` — a
  coluna **é validada contra a whitelist** antes.
- **Paginação** → `.range(pagina*tamanho, pagina*tamanho + tamanho - 1)` + `count: 'exact'` (o `tamanho` vem do seletor, validado contra `TAMANHOS_PAGINA`).

### Application

```ts
// carregar-processos-grid.ts ('use server')
carregarProcessosGrid(estado: EstadoGrid): Promise<{ ok: true; linhas; total; colunas } | { ok: false; erro }>
carregarValoresColuna(campo: string): Promise<{ ok: true; valores: string[] } | { ok: false; erro }>
```
Padrão do projeto: `getSessao()` + `podeFazer('visualizar')`, **validação dos parâmetros
vindos do cliente** (nome de coluna **sempre** contra a whitelist do catálogo), união
discriminada, erro genérico em PT-BR.

### UI

- **`page.tsx`** (server): carrega o **catálogo** (`carregarCamposFormulario` +
  `numero`/`status`) e o **layout** (`listarColunasLista`), decodifica o estado do
  `searchParams.g`, busca a **1ª página** e renderiza o grid.
- **`processos-grid.tsx`** (client): tabela com as colunas visíveis; cada cabeçalho tem um
  **menu** (Popover) com:
  ```
  ↑ Ordenar de A a Z
  ↓ Ordenar de Z a A
  ──────────────────
  🔍 [ buscar...        ]
  ☑ (Selecionar tudo)
  ☑ valor 1
  ☐ valor 2
  ──────────────────
  [Limpar filtro]  [Aplicar]
  ```
  Ao aplicar, atualiza o estado → `router.push('?g=' + codificarEstadoGrid(estado))` →
  o server recarrega a página do grid. Rodapé com **paginação** (total, página atual,
  anterior/próxima) e o **seletor de linhas por página** (25/50/100/200).
- Reusa `ScrollHorizontalTopo` (a barra de rolagem espelho já existe).
- **Novos primitives** (não existem em `components/ui/`): **Popover** e **Checkbox**
  (base-ui/shadcn).

### O que sai / o que fica

**Sai** (vira código morto e é removido): `processos-por-mes.tsx`, `processos-filtros.tsx`,
`linhas-processos.tsx`, `application/carregar-processos-mes.ts`, e em
`processo-repository.ts`: `listarProcessos`, `listarProcessosDoMes`, `listarMesesProcessos`.

**Fica:** `agrupamento-mes.ts` — `rotuloMes` é usado pela tela **Exportar Fotos**, e
`inicioProximoMes`/`chaveMes` passam a servir o filtro de mês do grid. A RPC
`processos_meses` (0014) fica **órfã** (sem consumidor) — **não** é removida nesta fase
(remoção de objeto do banco é risco desnecessário agora); fica anotada como dívida.

## Riscos e dívidas declaradas

1. **🔴 Setas ‹ › dessincronizadas.** `processos_vizinhos` (0016) tem `ORDER BY` **fixo** no
   SQL (reproduz a ordem do accordion). Com ordenação por coluna, as setas seguem uma ordem
   **diferente** da tela. **Aceito nesta fase**; resolvido na **Fase 3**.
2. **⚠️ Índices.** A tabela só tem índice em `status` e `importacao_id` — **não há** em
   `numero` nem `data_chegada`, e `ilike '%x%'` faz varredura completa. Com volume baixo não
   dói; **com milhares de linhas, dói**. Fica pendente da contagem que o usuário está
   levantando; se necessário, entra migração de índices (inclusive `pg_trgm` para os `ilike`).
3. **Responsáveis fora do grid.** `responsavel_recebimento`/`responsavel_qualidade` são
   `uuid` e **não estão** em `configuracao_campos` → não entram no catálogo. Exibi-los
   exigiria join com `usuarios`. Fora de escopo.
4. **Valores distintos com teto de 200.** Coluna com milhares de valores únicos mostra os
   200 primeiros no checkbox; a **busca por texto** cobre o resto. A lista **não** reflete os
   outros filtros ativos (o Excel reflete) — simplificação assumida da Fase 1.

## Validação e erros

| Situação | Comportamento |
|---|---|
| `?g=` inválido/adulterado | Degrada para o estado padrão (não quebra a tela) |
| Coluna fora da whitelist (ordenar/filtrar) | Server Action rejeita; a UI só oferece colunas do catálogo |
| Sem permissão `visualizar` | Server Action retorna erro; a tela já é gated |
| Filtro sem resultado | Grid vazio com mensagem, paginação zerada |
| Erro no banco | Mensagem genérica em PT-BR |

## Fora de escopo (outras fases)

- **Fase 2:** tela admin de reordenar/ocultar colunas.
- **Fase 3:** setas seguindo a ordem/filtros do grid.
- Edição inline nas células; exportar o grid; filtro por faixa numérica/de datas.

## Testes

- **TDD (domínio):** `codificarEstadoGrid`/`decodificarEstadoGrid` — ida e volta; param
  inválido → padrão; **coluna fora da whitelist é descartada** (segurança); página negativa
  → 0; **tamanho fora de `TAMANHOS_PAGINA` → o padrão (50)**. E a tradução **mês → faixa de datas** (função pura, reusando `inicioProximoMes`).
- **Infra/app/UI:** build + smoke (a consulta real depende do banco).
- **Smoke:** ordenar por Fornecedor A→Z e conferir a 1ª página; **filtrar uma coluna por um
  valor que está numa página distante e confirmar que aparece** (o requisito nº 4); filtrar
  Data Chegada por um mês e conferir que equivale ao accordion de hoje; paginar; limpar
  filtro; confirmar que quem não é admin vê o mesmo layout.
