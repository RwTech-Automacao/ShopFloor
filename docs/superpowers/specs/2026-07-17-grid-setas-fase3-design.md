# Grid de Processos — Fase 3: Setas seguindo o grid — Design

**Fecha o item 2 do roadmap** (`memory/roadmap-pos-reuniao.md`). Fases 1 (grid) e 2 (Colunas
da Lista) já estão **em produção**.

## Problema (dívida declarada, e maior que o previsto)

As setas ‹ › do detalhe do processo **mentem**. Hoje elas chamam a RPC
`processos_vizinhos` (migração 0016), que está **duplamente obsoleta**:

1. **`ORDER BY` fixo no SQL** — a ordem do accordion por mês (`data_chegada is not null`,
   `date_trunc('month')` desc, `numero` desc), que **não existe mais** desde que o grid
   substituiu a lista antiga.
2. **Parâmetros da lista antiga** (`p_busca`, `p_status`) — o grid tem filtro por **coluna
   arbitrária**, não mais busca+status.

Pior: **o grid linka pro detalhe sem passar nada** (`/recebimento/processos/${id}`), e a
página do detalhe ainda lê `?busca=&status=` — que vêm sempre vazios. Resultado: as setas
navegam **todos** os processos, na ordem antiga, ignorando ordenação, filtros e busca do grid.

## Decisões (aprovadas)

1. **Reaproveitar o construtor de consulta do grid** (não reescrever em SQL). A montagem de
   filtro/ordem sai de `listarProcessosGrid` para uma função compartilhada, usada pelo grid
   **e** pela consulta de ids. Divergir entre grid e setas fica **estruturalmente impossível**.
   *(Uma RPC com SQL dinâmico duplicaria a regra de filtro em dois lugares — e é exatamente
   essa divergência que estamos consertando.)*
2. **O link da linha carrega `?g=<estado>&i=<posição global>`.** `g` já é o estado do grid
   (ordenação/filtros/página/tamanho); `i` = `pagina * tamanho + índice da linha`.
3. **Sem contexto** (link direto/favorito, sem `?g=`) → cai no **`ESTADO_GRID_PADRAO`**
   (número desc, sem filtro). Setas vivas, navegando a lista inteira na ordem padrão — que é
   o que a tela de Processos mostraria.
4. **Processo saiu do conjunto filtrado** (ex.: filtrou `Aberto`, abriu, finalizou) → as setas
   **continuam**, usando a **posição guardada** (`i`): a lista encolheu 1, então quem estava
   em `i+1` agora está em `i` → **próximo = `ids[i]`**. É o fluxo de despachar uma fila.
5. **Atravessa página** naturalmente (a lista de ids é contínua; página é recorte visual).
6. **Teto honesto:** acima de **5.000** ids no conjunto filtrado, as setas **desabilitam** em
   vez de mentir. (Hoje há **289** processos — folga de 17×.)
7. **Faxina:** aposentar a RPC `processos_vizinhos` (migração com `DROP`), o `buscarVizinhos`
   e o `?busca=&status=` que o detalhe ainda lê.

## Arquitetura

### Domínio (TDD) — `src/modules/recebimento/domain/vizinhos.ts`

```ts
export interface Vizinhos {
  anterior: string | null
  proximo: string | null
}

/**
 * Vizinhos de `idAtual` numa lista ordenada de ids.
 * - `idAtual` presente → vizinhos reais pela posição encontrada (a `posicao` é ignorada;
 *   auto-corrige).
 * - `idAtual` ausente (saiu do filtro) → usa `posicao` como o lugar que ele ocupava:
 *   `proximo = ids[posicao]`, `anterior = ids[posicao - 1]`.
 * - Pontas e lista vazia → `null`. Não muta as entradas.
 */
export function vizinhosDaLista(ids: string[], idAtual: string, posicao: number | null): Vizinhos
```

Pura → **TDD**. É o coração da regra 4.

### Infra — `src/modules/recebimento/infra/processo-repository.ts`

- **Extrair** a montagem de filtro/ordem hoje embutida em `listarProcessosGrid` para uma
  função interna compartilhada (ex.: `aplicarFiltrosGrid(query, estado, tiposPorCampo)`),
  incluindo o `.order(estado.ordenar, ...)`. `listarProcessosGrid` passa a usá-la e só
  acrescenta o `.range()` da paginação — **comportamento idêntico ao de hoje**.
- **Nova** `listarIdsGrid(estado, tiposPorCampo): Promise<string[]>` — usa a **mesma** função,
  faz `.select('id')` na mesma ordem/filtros, com `.range(0, TETO_VIZINHOS)` (5.000).

### UI

- **`processos-grid.tsx`**: o botão "Abrir processo" da linha passa a linkar para
  `/recebimento/processos/${id}?g=${codificarEstadoGrid(estado)}&i=${estado.pagina * estado.tamanho + indice}`.
- **`processos/[id]/page.tsx`**: `searchParams` passa a ser `{ g?: string; i?: string }`
  (adeus `busca`/`status`). Decodifica `g` com `decodificarEstadoGrid` (validado contra o
  catálogo — a mesma whitelist da Fase 1); sem `g`, usa `ESTADO_GRID_PADRAO`. Carrega
  `listarIdsGrid`, chama `vizinhosDaLista(ids, id, posicao)` e passa `anterior`/`proximo` +
  o próprio `g` adiante.
- **`navegacao-processo.tsx`**: os `href` das setas passam a levar `?g=<mesmo g>&i=<nova
  posição>` (a posição do vizinho), em vez do `queryProcessos(filtros)` antigo.

### Migração 0023

```sql
drop function if exists public.processos_vizinhos(uuid, text, text);
```

### Código aposentado

`buscarVizinhos` (`processo-detalhe-repository.ts`); `FiltrosProcessos`/`queryProcessos` no
que servia só às setas — remover o que ficar sem consumidor (conferir com grep antes).

## Fluxo de dados

```
grid → link /processos/{id}?g={estado}&i={posição}
detalhe → decodifica g (whitelist do catálogo) | sem g → ESTADO_GRID_PADRAO
        → listarIdsGrid(estado)  [mesmo construtor do grid, só ids, teto 5000]
        → vizinhosDaLista(ids, id, i)
setas   → /processos/{vizinho}?g={mesmo g}&i={posição do vizinho}
```

## Validação e erros

| Situação | Comportamento |
|---|---|
| Sem `?g=` (link direto) | `ESTADO_GRID_PADRAO` — setas navegam a lista inteira em número desc |
| `?g=` inválido/adulterado | `decodificarEstadoGrid` já degrada para o padrão (Fase 1) |
| `?i=` ausente ou não-numérico | `posicao = null` → se o id sumiu do filtro, setas desabilitam |
| Id fora do conjunto filtrado, com `i` | Usa `i`: próximo = `ids[i]`, anterior = `ids[i-1]` |
| Nas pontas da lista | Seta correspondente desabilitada (`null`) |
| Conjunto filtrado > 5.000 | Setas desabilitadas (não mente) |
| Falha na consulta de ids | Fail-safe: ambos `null` (setas desabilitadas), página não cai |

## Fora de escopo

- Corrigir `sanitizarTermoBusca` (remove `,.()` demais no `.ilike`). As setas passam a errar
  **igual ao grid** — consistente, que é o objetivo. Corrigir é outra conversa.
- Índices no banco (dívida já registrada; com 289 linhas não pesa).
- Manter compatibilidade com os links antigos `?busca=&status=` (a lista que os gerava não
  existe mais).
- Grid responsivo em cards.

## Testes

- **TDD (domínio `vizinhos.ts`)** — `vizinhosDaLista`:
  - id no meio → anterior/próximo corretos; nas pontas → `null` do lado da ponta;
  - id presente **ignora** a `posicao` divergente (auto-corrige);
  - id ausente **com** `posicao` → `proximo = ids[posicao]`, `anterior = ids[posicao-1]`;
  - id ausente com `posicao` no fim da lista → `proximo = null`;
  - id ausente **sem** `posicao` (`null`) → ambos `null`;
  - lista vazia → ambos `null`; não muta as entradas.
- **Infra/UI:** build + smoke.
- **Smoke:** no grid, **filtrar** (ex.: Status=Aberto) e **ordenar** por uma coluna → abrir um
  processo do meio → as setas devem andar **dentro do filtro e na ordem escolhida**; ir até o
  fim de uma página e conferir que a seta **atravessa** para a próxima; **finalizar** um
  processo filtrado por Aberto e conferir que a seta leva ao **próximo Aberto**; abrir um
  processo por **link direto** (sem `?g=`) e conferir que as setas funcionam na ordem padrão.
