# Tela de Registros (log de produção por cliente) — Design

> **Data:** 2026-07-28 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** feature nova (tela). Segue o fluxo Dev × Prod.

## Contexto

No sistema legado (Google Sheets + Apps Script), cada **cliente** tinha uma **aba de planilha** com o
**log cru de produção**: cada peça (Nº de Série) passando em cada posto, por OP. Essas abas eram o
"log por cliente". No ShopFloor esse dado vive na tabela **`sf_registros`** (data, colaborador, posto,
pmo, op, cliente, SN, status, defeito, NQA, caixa…), alimentada pelo Lançamento/Integração/Manutenção.

Hoje **não há tela dedicada** pra esse log cru — Pesquisa (por SN) e Grade (matriz SN×posto) mostram
recortes, mas não o feed cronológico filtrável por cliente. Esta tela recria a "aba por cliente".

**Distinção importante:** isto é o **log de produção** (`sf_registros`, público `shopfloor.visualizar`),
**diferente** do **log de auditoria de usuários** (`logs`, público `sistema.administrar`, em
`/configuracoes/logs`). São telas, tabelas e públicos diferentes — não se misturam.

## Objetivo

Uma tela **só leitura** que mostra o feed de `sf_registros`, **filtrável por cliente** (+ OP, posto, SN,
status, período), com colunas essenciais e detalhes ao clicar — substituindo as abas por cliente do legado.

## Escopo

**Dentro:**
- Nova tela `/shopfloor/registros` no menu **Fluxo de Processos**, guard `shopfloor.visualizar`.
- Barra de filtros: **Cliente** (dropdown), **OP/PMO**, **Posto** (dropdown), **SN** (busca), **Status**
  (dropdown), **Período** (data de–até). Todos opcionais e combináveis.
- Tabela com colunas essenciais + **paginação server-side** (25/página), ordem `data_hora` desc.
- **Modal de detalhes** ao clicar na linha (campos ricos: defeito, posição, tipo, NQA, caixa).
- **Índice** de performance em `sf_registros` (nova migração) pra a ordenação/paginação.

**Fora (confirmado):**
- **Export pra Excel** — backlog (a lib `xlsx` já existe; adicionar depois se o pessoal sentir falta).
- Edição/exclusão de registros — é log, só leitura.
- Filtro do **log de auditoria** por módulo — feature separado e menor.

## Design

### 1. Rota, menu e permissão
- Rota `/shopfloor/registros`. Item **"Registros"** na seção **Fluxo de Processos** do `app-shell.tsx`,
  visível com `shopfloor.visualizar`. Guard próprio na page (padrão das outras telas do módulo).
- `sf_registros` **já tem** RLS `sf_registros_select` = `tem_permissao('shopfloor','visualizar')` (Fase 2a)
  → **nenhuma migração de segurança**; as leituras (inclusive dos dropdowns) já são gated.

### 2. Filtros (barra no topo, padrão do Recebimento)
Lidos de `searchParams` (server component, como `/configuracoes/logs`). Todos opcionais:
- **Cliente:** dropdown com os clientes distintos de `sf_registros` (+ "Todos").
- **OP/PMO:** texto (casa `pmo` OU `op`).
- **Posto:** dropdown a partir de `sf_postos` (catálogo).
- **SN:** texto; normalizado via `normalizarSerie` e comparado com `numero_serie_norm`.
- **Status:** dropdown (Aprovado / Reprovado / Sem status), a partir dos valores de `status`.
- **Período:** `data_de` / `data_ate` (aplicados em `data_hora`).

### 3. Tabela + detalhe
- Colunas essenciais: **Data/Hora · Cliente · PMO·OP · Posto · SN · Status · Colaborador**.
- Ordem: `data_hora` **desc** (mais recentes primeiro).
- **Paginação server-side**, 25/página (reusa o padrão de `consultarLogs`/`/configuracoes/logs`): a query
  devolve `{ linhas, total }` e a UI mostra "página X de Y" com anterior/próxima.
- **Clique na linha → modal de detalhes** com os campos ricos: colaborador, nº caixa, qtd/caixa, código
  defeito, posição, tipo defeito, NQA visual, NQA funcional (+ os essenciais repetidos pro contexto).

### 4. Arquitetura (padrão modular)
- **Domínio** — `src/modules/shopfloor/domain/registros-filtros.ts` (puro, com testes):
  `parsearFiltrosRegistros(input)` → objeto validado `FiltrosRegistros` (normaliza SN, trim de textos,
  parse do período; ignora vazios). Sem I/O.
- **Infra** — `src/modules/shopfloor/infra/registros-repository.ts`:
  - `consultarRegistros(filtros: FiltrosRegistros, pagina: number)` → `{ linhas: RegistroRow[]; total: number }`
    (filtro + ordenação + `range()` de paginação no Supabase; respeita RLS via client de servidor).
  - `listarClientesComRegistros()` → `string[]` e reuso do repo de postos pro dropdown.
- **App** — `src/app/(app)/shopfloor/registros/`:
  - `page.tsx` (server): lê `searchParams` → `parsearFiltrosRegistros` → `consultarRegistros` → renderiza
    tabela + paginação; carrega as opções dos dropdowns. **Marcar `export const dynamic = 'force-dynamic'`**
    (busca por-requisição; consistente com a decisão de build já tomada no projeto).
  - `registros-filtros.tsx` (client): a barra de filtros (modelada em `logs-filtros.tsx`), que atualiza a URL.
  - `registro-detalhe.tsx` (client): o modal de detalhes (base-ui/componente de dialog do projeto).
- **Menu** — `src/shared/ui/app-shell.tsx`: novo item "Registros" na seção Fluxo de Processos.

### 5. Índice de performance (migração nova)
`sf_registros` já cresce grande (68,5k no Dev). A ordenação por `data_hora` desc e o filtro por cliente
pedem índice:
```sql
create index if not exists sf_registros_data_hora on public.sf_registros (data_hora desc);
create index if not exists sf_registros_cliente_data on public.sf_registros (cliente, data_hora desc);
```
Migração nova (próximo número livre — **0058**). Aplica no **Dev** durante o desenvolvimento (`supabase db
push`) e vai pro **Prod** junto do batch (banco antes do código), como o resto.

## Critérios de sucesso
- Abrir `/shopfloor/registros` (com `shopfloor.visualizar`) lista os registros, mais recentes primeiro,
  paginado.
- Filtrar por **Cliente** mostra só os daquele cliente; combinar com OP/posto/SN/status/período refina.
- Clicar numa linha abre o detalhe com defeito/NQA/caixa.
- Usuário **sem** `shopfloor.visualizar` não vê o item no menu nem acessa a rota.
- Paginação continua fluida com dezenas de milhares de linhas (índice em uso).
- Só leitura (sem editar/excluir); sem export (backlog).

## Riscos / considerações
- **Volume:** paginação e filtros são server-side; o índice cobre o caso comum (ordenar por data, filtrar
  por cliente). Se surgirem filtros lentos (ex.: SN sem índice), avaliar índice adicional depois.
- **Fonte dos dropdowns:** "clientes com registros" vem de `sf_registros` (distinct) — reflete quem tem
  histórico de verdade (não a lista de OPs).
- Baixo risco: sem mudança de RLS, sem escrita; feature aditiva e isolada no módulo ShopFloor.
