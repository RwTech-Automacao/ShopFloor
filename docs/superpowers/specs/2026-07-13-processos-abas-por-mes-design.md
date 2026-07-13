# Spec — Lista de Processos em accordions por mês (feature 3b)

## Contexto
Parte da **feature #3** do roadmap (`docs/roadmap-pos-apresentacao.md`). A #3 foi **dividida**:
- **3b (esta spec):** agrupar a lista de Processos em accordions por mês da data de chegada.
- **3a (fora desta spec):** novo modelo de status (Aprovado/Reprovado, remover Cancelado) — será
  desenhado **junto com a #7** (seções Recebimento/Qualidade), pois o status passa a ser definido
  ao salvar a seção Qualidade.

## Objetivo
Substituir a lista paginada única de Processos por **accordions agrupados pelo mês da data de
chegada**, com **carregamento sob demanda**, para escalar por anos sem puxar tudo de uma vez.

## Requisitos (aprovados pelo usuário)
1. Accordions por mês da `data_chegada`; um accordion **"Aguardando chegada"** no topo para
   processos com `data_chegada` nula (comum: a data só é preenchida na conferência).
2. Ordem: **"Aguardando chegada" primeiro**; depois os meses do **mais recente → mais antigo**.
3. Cada cabeçalho mostra o **rótulo do mês** (pt-BR, ex.: "Julho/2026") **+ a contagem** de
   processos do grupo (respeitando os filtros ativos).
4. **Carregamento sob demanda:** no load da página, carregam **apenas os cabeçalhos + contagens**.
   As **linhas** de um mês são buscadas só quando aquele accordion é **aberto**.
5. **Abrem por padrão:** "Aguardando chegada" **+ o mês mais recente**.
6. Filtros de **busca/status** continuam funcionando; sob filtro, grupos sem resultado **somem**.
7. Dentro do mês: **layout atual** (tabela compacta no desktop / cards no mobile), **mesmas
   colunas**, ordem por **número (desc)**.
8. O mês é **derivado na hora** a partir da `data_chegada` (se a data muda de mês, o processo
   aparece no accordion do novo mês). **Sem coluna nova / sem migração.**

## Design

### Fluxo
1. `page.tsx` (server) lê os filtros (busca/status) e chama `listarMesesProcessos(filtros)` →
   recebe a lista de grupos `{ chave, rotulo, total }` já ordenada.
2. Renderiza um **client component** `ProcessosPorMes` com os grupos. Cada grupo é um accordion
   fechado, exceto "Aguardando chegada" e o mês mais recente (abertos por padrão).
3. Ao **abrir** um accordion, o cliente chama a **Server Action** `carregarProcessosDoMes(filtros,
   chave)` → recebe as linhas daquele grupo e renderiza a tabela/cards.
4. Trocar filtro (busca/status) recarrega a página (server) → novos grupos/contagens; os
   accordions abertos por padrão voltam ao estado inicial.

### Arquitetura (camadas do projeto)
- **domain** (`src/modules/recebimento/domain/agrupamento-mes.ts`, novo — TS puro, testável):
  - `chaveMes(data: string | null): string` → `'YYYY-MM'` ou `'sem_data'`.
  - `rotuloMes(chave: string): string` → `'Julho/2026'` ou `'Aguardando chegada'`.
  - `agruparPorMes(datas: (string | null)[]): { chave, rotulo, total }[]` → agrupa e **ordena**
    (sem_data primeiro; meses desc). Núcleo testável da feature.
- **infra** (`processo-repository.ts`, estende):
  - `listarMesesProcessos(filtros)` → seleciona **apenas a coluna `data_chegada`** de todos os
    processos que batem nos filtros (query leve — 1 coluna), e usa `agruparPorMes` para montar os
    grupos com contagem. *(Evita RPC/migração; buscar só datas é barato mesmo com milhares de
    linhas.)*
  - `listarProcessosDoMes(filtros, chave)` → reaproveita a query de `listarProcessos`, adicionando
    o recorte de data: `data_chegada >= inícioDoMês AND < inícioDoPróximoMês`, ou `data_chegada is
    null` para `sem_data`. Retorna as mesmas colunas de hoje, ordem número desc.
- **application** (`src/modules/recebimento/application/carregar-processos-mes.ts`, nova Server
  Action): valida sessão/permissão `visualizar`, chama `listarProcessosDoMes`, retorna as linhas.
- **UI**:
  - `processos/page.tsx` (server): carrega os grupos e monta o `ProcessosPorMes`.
  - `processos/processos-por-mes.tsx` (client, novo): gerencia aberto/fechado, chama a action ao
    expandir, renderiza a tabela desktop / cards mobile (reaproveitando a marcação atual, extraída
    para um subcomponente `LinhasProcessos`).
  - `ProcessosFiltros` permanece.

### Decisões de implementação
- **Contagem por mês** feita em TS a partir da coluna `data_chegada` (sem `GROUP BY` no banco /
  sem RPC) — mantém a feature **sem migração**, conforme decidido.
- **Mês atual** para "abrir por padrão" é o mês mais recente **presente nos grupos** (não o mês do
  calendário), evitando abrir um mês vazio.
- **Sem paginação dentro do mês** no v1 (cada mês é um recorte já limitado). Se algum mês crescer
  muito, adicionar "carregar mais" dentro do accordion depois.

### Tratamento de erros
- Falha ao carregar linhas de um mês (Server Action) → o accordion mostra uma mensagem de erro
  com opção de tentar de novo; não derruba a página.
- Sem permissão `visualizar` → já barrado pelo RLS/guard existente (sem mudança).

### Testes
- **Unitários (domain `agrupamento-mes`):** `chaveMes` (data válida, nula), `rotuloMes` (mês,
  sem_data), `agruparPorMes` (ordenação sem_data→meses desc, contagem, meses repetidos, lista
  vazia). É o núcleo lógico e fica coberto.
- **Queries (infra):** verificação manual + `npm run build`/smoke (padrão do projeto para código
  que fala com o Supabase).

## Fora de escopo (desta spec)
- **3a**: modelo de status Aprovado/Reprovado e remoção de Cancelado (irá com a **#7**).
- Paginação "carregar mais" dentro de um mês (adicionar se o volume exigir).
- **#2 (setas de navegação)** — consumirá esta estrutura depois (ordem = dentro do mês/grupo).

## Relação com outras features
- **#2 (setas):** depende desta estrutura para definir "a ordem da lista".
- **3a/status + #7:** virão em seguida, sobre a lista já agrupada.
