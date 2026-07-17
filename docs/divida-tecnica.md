# Dívida técnica e trabalho futuro

Registro vivo do que foi deixado para depois **de propósito**, com o gatilho de quando
retomar e por quê. Atualizado em 2026-07-17.

---

## Escalabilidade (retomar por VOLUME de processos)

Hoje: **289 processos**. Ritmo: ~centenas/mês. Nada abaixo aqui compensa antes do volume
chegar perto do gatilho — antes disso o ganho é imperceptível.

### 1. Índices no banco

**Gatilho:** quando a base passar de ~**5.000–10.000 processos** (estimativa: 1–2 anos).

**O que resolve.** Sem índice, o Postgres faz *varredura sequencial* — lê todas as linhas da
tabela pra resolver um filtro ou uma ordenação. O grid filtra/ordena **no servidor sobre a
base inteira** (requisito: filtrar na página 1 acha algo da "página 10"), então cada filtro,
cada ordenação e cada clique de seta paga esse custo. Com 289 linhas é instantâneo; a partir
de milhares vira dezenas/centenas de ms por ação, multiplicado por usuário.

**Escopo.**
- Índices B-tree nas colunas mais usadas em `ORDER BY` / `WHERE`: `numero`, `data_chegada`,
  `fornecedor`, e as demais do padrão de 11 colunas visíveis. (Hoje só existem em `status` e
  `importacao_id`.)
- **Busca textual (`ilike '%termo%'`)** não usa B-tree comum (o `%` inicial impede). Precisa da
  extensão `pg_trgm` + índice GIN por trigramas nas colunas de texto buscáveis.

**Esforço:** ~1h para os B-tree; +1–2h com `pg_trgm`. Baixo risco (índice é recriável a
qualquer momento; usar `CREATE INDEX CONCURRENTLY` pra não travar a tabela). **Sem** urgência
de fazer com dado de teste — índice não mexe em dado.

### 2. Paginação keyset/seek (substituir OFFSET)

**Gatilho:** junto dos índices (um reforça o outro), quando páginas profundas começarem a pesar.

**O que resolve.** A paginação atual usa OFFSET (`.range(inicio, fim)`). Pra montar a página 100
(linhas 5.000+), o Postgres **calcula e descarta** as 5.000 primeiras linhas antes de entregar
as 50 seguintes — o custo cresce com a profundidade da página. Keyset inverte: "me dê as linhas
**depois** deste valor" (`WHERE numero < ultimo_visto ORDER BY numero LIMIT N`), e com índice na
coluna de ordenação o banco **salta** direto. Toda página fica igualmente rápida.

**Liga-se às setas.** `listarIdsGrid` hoje busca ids em **blocos** até `TETO_VIZINHOS = 5000`
como contorno do `max_rows` (1000) do PostgREST; acima do teto as setas **desabilitam por
design**. Keyset removeria esse teto.

**Pré-requisito já garantido:** o desempate `.order('numero')` (Fase 3) — sem uma ordenação
total determinística, o keyset pula/repete linhas.

**Esforço:** ~algumas horas (reescrita da query de paginação + das setas). **Depende** de ter os
índices (senão o "salto" volta a ser varredura). Por isso é um projeto único com o item 1.

---

## Dívidas menores (retomar por INCÔMODO, não por volume)

Independentes do número de processos — seriam iguais com 10 ou 1 milhão de linhas.

### 3. CVE do `xlsx` / SheetJS — **segurança**
A lib que lê as planilhas de importação (SheetJS community) tem vulnerabilidades conhecidas sem
correção na versão gratuita (prototype pollution, ReDoS). **Mitigado hoje** pelo modelo de
confiança: só usuário interno autenticado importa arquivos que ele mesmo montou.
**Se retomar:** trocar de biblioteca ou migrar pra versão paga/mantida, ou validar/sandbox do
parse. Algumas horas.

### 4. `<button>` dentro de `<Link>` no card do Grid — **acessibilidade** ✅ RESOLVIDO 2026-07-17
~~Conteúdo interativo dentro de `<a>` é HTML inválido; funcionava via `preventDefault`.~~
Corrigido com o padrão *stretched-link* (card `<div>` + `<a absolute inset-0>` + botão irmão).

### 5. String do chip duplicada — **manutenção** ✅ RESOLVIDO 2026-07-17
~~A className da pílula do chip estava copiada verbatim em `MenuColuna` e `MenuColunaEtiqueta`.~~
Extraída para um helper compartilhado `classeChipTrigger(ativo, ordenando)`.

---

## Infra (retomar por MOMENTO, não por volume)

### 6. Ambiente Dev × Prod
**Gatilho:** às vésperas de entrar **dado real** (por decisão do usuário, é o último item).
Hoje migrações rodam direto na produção porque só há dado de teste — errar é grátis. Com dado
real isso passa a ser arriscado; a saída é montar o Dev a partir de um retrato limpo da prod
naquele momento. ~2–4h + ação do usuário (criar o projeto Supabase de staging, separar env).
