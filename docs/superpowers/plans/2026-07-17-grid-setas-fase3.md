# Grid Fase 3 — Setas seguindo o grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer as setas ‹ › do detalhe navegarem exatamente na ordem e nos filtros do grid.

**Architecture:** A montagem de filtro+ordem sai de `listarProcessosGrid` para uma função compartilhada (`montarQueryGrid`), usada pelo grid **e** por uma consulta nova que traz só os ids (`listarIdsGrid`) — divergir vira estruturalmente impossível. O link da linha carrega `?g=<estado>&i=<posição>`; o detalhe decodifica, busca os ids e uma função pura de domínio calcula os vizinhos. A RPC `processos_vizinhos` (obsoleta) é aposentada.

**Tech Stack:** Next.js 16 (Server Components, `params`/`searchParams` são Promise), TypeScript strict (`noUncheckedIndexedAccess`), Supabase/PostgREST, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **Subagentes NÃO aplicam migração nem dão `git push`.** O controller aplica a 0023 na prod após o review da Task 3.
- **Reaproveitar, não reescrever:** a regra de filtro/ordem vive num lugar só (`montarQueryGrid`). Grid e setas chamam a MESMA função.
- **Comportamento do grid é IDÊNTICO ao de hoje** após a extração — é refatoração, não mudança.
- **Whitelist:** o `?g=` é decodificado com `decodificarEstadoGrid(g, catalogo)` — a mesma defesa da Fase 1. Sem `g` → `ESTADO_GRID_PADRAO`.
- **Teto:** `TETO_VIZINHOS = 5000`. `listarIdsGrid` busca até **5001** (`.range(0, TETO_VIZINHOS)`) para **detectar** o estouro; acima disso as setas desabilitam em vez de mentir. (Hoje: 289 processos.)
- **URLs com `URLSearchParams`** — nunca concatenar/encodar à mão (o double-decode já deu crítico na Fase 1).
- **`noUncheckedIndexedAccess`:** `ids[k]` é `string | undefined` — sempre guardar.
- TS strict. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build` + `npm run test`.

## File Structure

- **Create** `src/modules/recebimento/domain/vizinhos.ts` — `Vizinho`, `Vizinhos`, `vizinhosDaLista` (puro).
- **Create** `src/modules/recebimento/domain/__tests__/vizinhos.test.ts` — TDD.
- **Modify** `src/modules/recebimento/infra/processo-repository.ts` — extrai `montarQueryGrid`; adiciona `TETO_VIZINHOS` e `listarIdsGrid`; remove `FiltrosProcessos`.
- **Create** `supabase/migrations/0023_drop_processos_vizinhos.sql` — `DROP` da RPC.
- **Modify** `src/app/(app)/recebimento/processos/processos-grid.tsx` — link com `?g=&i=`.
- **Modify** `src/app/(app)/recebimento/processos/[id]/page.tsx` — `searchParams {g,i}`, ids, vizinhos.
- **Modify** `src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx` — props.
- **Modify** `src/app/(app)/recebimento/processos/[id]/navegacao-processo.tsx` — hrefs com `?g=&i=`.
- **Modify** `src/modules/recebimento/infra/processo-detalhe-repository.ts` — remove `buscarVizinhos`.
- **Modify** `src/modules/recebimento/domain/busca-processo.ts` (+ teste) — remove `queryProcessos`.

---

### Task 1: Domínio — vizinhosDaLista (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/vizinhos.ts`
- Create: `src/modules/recebimento/domain/__tests__/vizinhos.test.ts`

**Interfaces:**
- Produces:
  - `interface Vizinho { id: string; posicao: number }`
  - `interface Vizinhos { anterior: Vizinho | null; proximo: Vizinho | null }`
  - `vizinhosDaLista(ids: string[], idAtual: string, posicao: number | null): Vizinhos`

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/recebimento/domain/__tests__/vizinhos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { vizinhosDaLista } from '../vizinhos'

const IDS = ['a', 'b', 'c', 'd']

describe('vizinhosDaLista', () => {
  it('id no meio → anterior e próximo com suas posições', () => {
    expect(vizinhosDaLista(IDS, 'b', null)).toEqual({
      anterior: { id: 'a', posicao: 0 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id no começo → anterior null', () => {
    expect(vizinhosDaLista(IDS, 'a', null)).toEqual({
      anterior: null,
      proximo: { id: 'b', posicao: 1 },
    })
  })

  it('id no fim → próximo null', () => {
    expect(vizinhosDaLista(IDS, 'd', null)).toEqual({
      anterior: { id: 'c', posicao: 2 },
      proximo: null,
    })
  })

  it('id presente IGNORA a posição informada (auto-corrige)', () => {
    // a lista mudou desde que o link foi gerado: a posição real manda
    expect(vizinhosDaLista(IDS, 'b', 99)).toEqual({
      anterior: { id: 'a', posicao: 0 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id AUSENTE com posição → usa a posição que ele ocupava', () => {
    // 'x' saiu do filtro; estava na posição 2. Quem estava em 3 agora está em 2.
    expect(vizinhosDaLista(IDS, 'x', 2)).toEqual({
      anterior: { id: 'b', posicao: 1 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id ausente com posição no fim da lista → próximo null', () => {
    expect(vizinhosDaLista(IDS, 'x', 4)).toEqual({
      anterior: { id: 'd', posicao: 3 },
      proximo: null,
    })
  })

  it('id ausente com posição 0 → anterior null', () => {
    expect(vizinhosDaLista(IDS, 'x', 0)).toEqual({
      anterior: null,
      proximo: { id: 'a', posicao: 0 },
    })
  })

  it('id ausente SEM posição → ambos null (não inventa)', () => {
    expect(vizinhosDaLista(IDS, 'x', null)).toEqual({ anterior: null, proximo: null })
  })

  it('id ausente com posição negativa → ambos null', () => {
    expect(vizinhosDaLista(IDS, 'x', -1)).toEqual({ anterior: null, proximo: null })
  })

  it('lista vazia → ambos null', () => {
    expect(vizinhosDaLista([], 'a', 0)).toEqual({ anterior: null, proximo: null })
  })

  it('lista de 1 item, ele mesmo → ambos null', () => {
    expect(vizinhosDaLista(['a'], 'a', 0)).toEqual({ anterior: null, proximo: null })
  })

  it('não muta a entrada', () => {
    const ids = [...IDS]
    vizinhosDaLista(ids, 'b', null)
    expect(ids).toEqual(IDS)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- vizinhos`
Expected: FAIL (módulo `../vizinhos` não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/vizinhos.ts`:

```ts
/** Um vizinho na lista: o id e a posição que ele ocupa (vai no link, como `?i=`). */
export interface Vizinho {
  id: string
  posicao: number
}

export interface Vizinhos {
  anterior: Vizinho | null
  proximo: Vizinho | null
}

/** Vizinho em `posicao`, ou null se a posição está fora da lista. */
function em(ids: string[], posicao: number): Vizinho | null {
  if (posicao < 0 || posicao >= ids.length) return null
  const id = ids[posicao]
  return id === undefined ? null : { id, posicao }
}

/**
 * Vizinhos de `idAtual` numa lista ordenada de ids.
 *
 * - `idAtual` PRESENTE → usa a posição real encontrada; a `posicao` informada é
 *   ignorada (auto-corrige links velhos).
 * - `idAtual` AUSENTE (ex.: saiu do filtro depois de você finalizá-lo) → usa `posicao`
 *   como o lugar que ele ocupava: a lista encolheu 1, então quem estava em `posicao + 1`
 *   agora está em `posicao` → esse é o próximo. É o fluxo de despachar uma fila.
 * - Ausente e sem `posicao` → não inventa: ambos `null`.
 *
 * Não muta as entradas.
 */
export function vizinhosDaLista(
  ids: string[],
  idAtual: string,
  posicao: number | null,
): Vizinhos {
  const atual = ids.indexOf(idAtual)
  if (atual >= 0) {
    return { anterior: em(ids, atual - 1), proximo: em(ids, atual + 1) }
  }
  if (posicao === null || posicao < 0) return { anterior: null, proximo: null }
  return { anterior: em(ids, posicao - 1), proximo: em(ids, posicao) }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- vizinhos`
Expected: PASS (12 casos).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/domain/vizinhos.ts src/modules/recebimento/domain/__tests__/vizinhos.test.ts
git commit -F - << 'EOF'
feat(grid): domínio vizinhosDaLista (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Infra — extrair montarQueryGrid + listarIdsGrid

**Files:**
- Modify: `src/modules/recebimento/infra/processo-repository.ts`

**Interfaces:**
- Produces:
  - `const TETO_VIZINHOS = 5000`
  - `listarIdsGrid(estado: EstadoGrid, tiposPorCampo: Record<string, ColunaGrid['tipo']>): Promise<string[]>`
  - (interno) `montarQueryGrid(supabase, select, estado, tiposPorCampo)`

**⚠️ Este código foi prototipado e verificado (`tsc` limpo, 180 testes verdes) antes de entrar no plano — use-o verbatim. A tentativa "óbvia" (um genérico `<Q extends QueryFiltravel<Q>>` recebendo a query) NÃO compila: dá `TS2589: Type instantiation is excessively deep` por causa dos tipos profundos do Supabase. Por isso a função monta a query inteira e deixa o TS inferir.**

- [ ] **Step 1: Extrair `montarQueryGrid`**

Em `src/modules/recebimento/infra/processo-repository.ts`, **acima** de `export async function listarProcessosGrid({`, inserir:

```ts
type ClienteSupabase = Awaited<ReturnType<typeof createServerSupabase>>

/**
 * Monta a query do grid: SELECT + filtros + ordenação. É o ÚNICO lugar onde a regra de
 * filtro/ordem vive — a lista e as setas (vizinhos) chamam esta mesma função, então é
 * estruturalmente impossível elas divergirem. Só a paginação (.range) fica no chamador.
 */
function montarQueryGrid(
  supabase: ClienteSupabase,
  select: string,
  estado: EstadoGrid,
  tiposPorCampo: Record<string, ColunaGrid['tipo']>,
) {
  let query = supabase.from('processos_recebimento').select(select, { count: 'exact' })

  for (const [campo, filtro] of Object.entries(estado.filtros)) {
    const tipo = tiposPorCampo[campo]
    // `.ilike` não existe para bigint/date no Postgres — um texto vindo do `?g=`
    // editado à mão viraria erro 400 e derrubaria a página. Só texto/lista buscam.
    if (filtro.texto && (tipo === 'texto' || tipo === 'lista')) {
      const termo = sanitizarTermoBusca(filtro.texto)
      if (termo) query = query.ilike(campo, `%${termo}%`)
    }
    if (filtro.valores && filtro.valores.length > 0) {
      if (tipo === 'data') {
        // Em coluna de data os valores são MESES: cada um vira uma faixa
        // [1º do mês, 1º do mês seguinte); 'sem_data' vira `is null`. As condições só
        // contêm datas e literais nossos — nada digitado pelo usuário entra na string.
        const condicoes = filtro.valores.map((mes) => {
          const faixa = faixaDoMes(mes)
          return faixa
            ? `and(${campo}.gte.${faixa.inicio},${campo}.lt.${faixa.fim})`
            : `${campo}.is.null`
        })
        query = query.or(condicoes.join(','))
      } else {
        query = query.in(campo, filtro.valores)
      }
    }
  }

  return query.order(estado.ordenar, { ascending: estado.direcao === 'asc' })
}
```

- [ ] **Step 2: `listarProcessosGrid` passa a usar a função**

No corpo de `listarProcessosGrid`, substituir **todo** o trecho que vai de `let query = supabase` até o `.range(inicio, inicio + estado.tamanho - 1)` por:

```ts
  const inicio = estado.pagina * estado.tamanho
  const { data, error, count } = await montarQueryGrid(
    supabase,
    ['id', ...colunas].join(', '),
    estado,
    tiposPorCampo,
  ).range(inicio, inicio + estado.tamanho - 1)
```

(O `if (error) throw error` e o `return { linhas..., total... }` seguintes **não mudam**.)

- [ ] **Step 3: Adicionar `TETO_VIZINHOS` e `listarIdsGrid`**

No fim do arquivo:

```ts
/** Teto de segurança das setas: acima disso elas desabilitam em vez de mentir.
 *  Hoje há ~289 processos — folga de 17x. */
export const TETO_VIZINHOS = 5000

/**
 * Ids do grid na MESMA ordem e com os MESMOS filtros da lista, sem paginação — é o que
 * permite as setas ‹ › andarem exatamente como o grid mostra (inclusive atravessando
 * página). Usa `montarQueryGrid`, então não há como divergir da lista.
 *
 * Busca até TETO+1 de propósito: se vier mais que o teto, o chamador SABE que a lista
 * está truncada e desabilita as setas em vez de calcular vizinho errado.
 */
export async function listarIdsGrid(
  estado: EstadoGrid,
  tiposPorCampo: Record<string, ColunaGrid['tipo']>,
): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await montarQueryGrid(supabase, 'id', estado, tiposPorCampo).range(
    0,
    TETO_VIZINHOS,
  )
  if (error) throw error
  return ((data ?? []) as unknown as { id: string }[]).map((r) => r.id)
}
```

- [ ] **Step 4: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: sem erros; 180 testes passando (a extração é refatoração — nada muda de comportamento).

```bash
git add src/modules/recebimento/infra/processo-repository.ts
git commit -F - << 'EOF'
refactor(grid): extrai montarQueryGrid e adiciona listarIdsGrid

A regra de filtro/ordem passa a viver num lugar só. As setas vão usar a mesma
função da lista, então não há como divergirem.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Migração 0023 — aposentar a RPC obsoleta

**Files:**
- Create: `supabase/migrations/0023_drop_processos_vizinhos.sql`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0023_drop_processos_vizinhos.sql`:

```sql
-- A RPC `processos_vizinhos` (0016) nasceu para a lista antiga e ficou duplamente
-- obsoleta: (1) ORDER BY fixo com a ordem do accordion por mês, que não existe mais
-- desde o grid (Fase 1); (2) parâmetros p_busca/p_status, o modelo de filtro da lista
-- antiga — o grid filtra por coluna arbitrária.
-- As setas passam a calcular os vizinhos com a MESMA consulta do grid (listarIdsGrid),
-- então esta função não tem mais chamador.
drop function if exists public.processos_vizinhos(uuid, text, text);
```

- [ ] **Step 2: Conferir (sem aplicar)**

Ler o arquivo criado. **NÃO** rodar `supabase db push` — o controller aplica na produção depois do review.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0023_drop_processos_vizinhos.sql
git commit -F - << 'EOF'
feat(grid): migração 0023 — aposenta a RPC processos_vizinhos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: UI — link com contexto, vizinhos no detalhe, e faxina

**Files:**
- Modify: `src/app/(app)/recebimento/processos/processos-grid.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/page.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/navegacao-processo.tsx`
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts`
- Modify: `src/modules/recebimento/infra/processo-repository.ts`
- Modify: `src/modules/recebimento/domain/busca-processo.ts`
- Modify: `src/modules/recebimento/domain/__tests__/busca-processo.test.ts`

**Interfaces:**
- Consumes: `vizinhosDaLista`, `Vizinho` (Task 1); `listarIdsGrid`, `TETO_VIZINHOS` (Task 2); `decodificarEstadoGrid`, `codificarEstadoGrid`, `ESTADO_GRID_PADRAO` (já existem); `carregarCatalogoColunas` (já existe).

**Estes arquivos mudam juntos: o tsc só fica verde com todos ajustados.**

- [ ] **Step 1: O link da linha do grid leva o contexto**

Em `src/app/(app)/recebimento/processos/processos-grid.tsx`, trocar o `.map` das linhas para receber o índice e montar a URL com `URLSearchParams`:

```tsx
            {linhas.map((linha, i) => {
              // O detalhe precisa saber de onde você veio: `g` = estado do grid
              // (ordem+filtros) e `i` = a posição global da linha na lista filtrada.
              const q = new URLSearchParams({
                g: codificarEstadoGrid(estado),
                i: String(estado.pagina * estado.tamanho + i),
              })
              return (
                <TableRow key={String(linha.id)}>
                  {colunas.map((coluna) => (
                    <TableCell key={coluna.campo}>{celula(coluna, linha[coluna.campo])}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Abrir processo #${String(linha.numero ?? '')}`}
                      render={
                        <Link href={`/recebimento/processos/${String(linha.id)}?${q.toString()}`} />
                      }
                    >
                      <ArrowRightIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
```

- [ ] **Step 2: `navegacao-processo.tsx` — hrefs com `?g=&i=`**

Substituir o arquivo inteiro por:

```tsx
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Vizinho } from '@/modules/recebimento/domain/vizinhos'

/** Setas ‹ › para o processo anterior/próximo na MESMA ordem e filtros do grid.
 *  `null` → seta desabilitada (ponta da lista, ou sem como saber). O estado do grid
 *  (`g`) e a posição do vizinho (`i`) seguem no href para a navegação continuar. */
export function NavegacaoProcesso({
  anterior,
  proximo,
  g,
}: {
  anterior: Vizinho | null
  proximo: Vizinho | null
  g: string
}) {
  const href = (v: Vizinho) => {
    const q = new URLSearchParams()
    if (g) q.set('g', g)
    q.set('i', String(v.posicao))
    return `/recebimento/processos/${v.id}?${q.toString()}`
  }

  return (
    <div className="ml-auto flex gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Processo anterior"
        disabled={!anterior}
        render={anterior ? <Link href={href(anterior)} /> : undefined}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="border-enterplak text-enterplak hover:bg-enterplak hover:text-white"
        aria-label="Próximo processo"
        disabled={!proximo}
        render={proximo ? <Link href={href(proximo)} /> : undefined}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: `processo-detalhe.tsx` — trocar a prop `filtros` por `g`**

Neste arquivo:
1. **Remover** o import `import type { FiltrosProcessos } from '@/modules/recebimento/infra/processo-repository'`.
2. **Adicionar** `import type { Vizinho } from '@/modules/recebimento/domain/vizinhos'`.
3. Na lista de props (interface/tipo do componente), trocar:
   - `anterior: string | null` → `anterior: Vizinho | null`
   - `proximo: string | null` → `proximo: Vizinho | null`
   - `filtros: FiltrosProcessos` → `g: string`
4. Onde o componente renderiza `<NavegacaoProcesso ... filtros={filtros} />`, trocar para `g={g}` (as props `anterior`/`proximo` seguem iguais no nome).

*(Leia o arquivo inteiro antes de editar para casar as strings exatas — os nomes das props aparecem na desestruturação e no tipo.)*

- [ ] **Step 4: `page.tsx` do detalhe — ler `?g=&i=`, buscar ids, calcular vizinhos**

Em `src/app/(app)/recebimento/processos/[id]/page.tsx`:

1. Trocar os imports de `buscarVizinhos` (que sai) pelos novos. O import de `processo-detalhe-repository` fica só com `buscarProcesso` e `carregarCamposFormulario`. Adicionar:

```tsx
import { ESTADO_GRID_PADRAO, decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import { vizinhosDaLista } from '@/modules/recebimento/domain/vizinhos'
import {
  TETO_VIZINHOS,
  carregarCatalogoColunas,
  listarIdsGrid,
} from '@/modules/recebimento/infra/processo-repository'
```

2. Trocar o tipo das props:

```tsx
interface ProcessoDetalhePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ g?: string; i?: string }>
}
```

3. Trocar o começo da função (as linhas que hoje leem `sp.busca/sp.status` e chamam `buscarVizinhos`) por:

```tsx
export default async function ProcessoDetalhePage({ params, searchParams }: ProcessoDetalhePageProps) {
  const { id } = await params
  const { g, i } = await searchParams

  const processo = await buscarProcesso(id)
  if (!processo) notFound()

  // Contexto do grid. Sem `?g=` (link direto/favorito), cai no padrão da lista — as
  // setas seguem vivas, navegando tudo em número desc.
  const catalogo = await carregarCatalogoColunas()
  const estado = g
    ? decodificarEstadoGrid(
        g,
        catalogo.map((c) => c.campo),
      )
    : ESTADO_GRID_PADRAO
  const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))

  // A posição que a linha ocupava quando o link foi gerado. Só é usada se o processo
  // tiver saído do filtro (ex.: você o finalizou) — aí ela diz de onde continuar.
  const posicao = i !== undefined && /^\d+$/.test(i) ? Number(i) : null

  // Fail-safe: erro na consulta não pode derrubar a página do processo — as setas só
  // desabilitam.
  let ids: string[] = []
  try {
    ids = await listarIdsGrid(estado, tiposPorCampo)
  } catch {
    ids = []
  }
  // Veio mais que o teto → a lista está truncada e não dá para saber os vizinhos.
  const { anterior, proximo } =
    ids.length > TETO_VIZINHOS
      ? { anterior: null, proximo: null }
      : vizinhosDaLista(ids, id, posicao)
```

4. Onde o `<ProcessoDetalhe ... />` é renderizado, trocar a prop `filtros={filtros}` por `g={g ?? ''}` (as props `anterior={anterior}` e `proximo={proximo}` seguem com o mesmo nome).

- [ ] **Step 5: Faxina — remover o que ficou sem consumidor**

1. Em `src/modules/recebimento/infra/processo-detalhe-repository.ts`: **remover** a função `buscarVizinhos` inteira (com o JSDoc dela).
2. Em `src/modules/recebimento/infra/processo-repository.ts`: **remover** a interface `FiltrosProcessos` (era usada só pelas setas).
3. Em `src/modules/recebimento/domain/busca-processo.ts`: **remover** a função `queryProcessos` (idem). **Manter** `sanitizarTermoBusca` — ela é usada pelo `montarQueryGrid`.
4. Em `src/modules/recebimento/domain/__tests__/busca-processo.test.ts`: remover o `describe('queryProcessos', ...)` e o import de `queryProcessos`.

**Antes de remover cada um, confirme com grep que não sobrou consumidor:**

Run: `grep -rn "buscarVizinhos\|FiltrosProcessos\|queryProcessos" src/ | grep -v "\.test\.ts"`
Expected: nenhuma saída (fora os próprios arquivos que você está editando).

- [ ] **Step 6: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: tudo verde (os testes caem de 180 para ~177 com a remoção dos de `queryProcessos`, e sobem com os 12 novos da Task 1 → confira que só os de `queryProcessos` sumiram). Se o build der `heap out of memory`, mate o `next dev` antes (ele segura ~3 GB) ou use `NODE_OPTIONS="--max-old-space-size=4096"`.

```bash
git add "src/app/(app)/recebimento/processos/processos-grid.tsx" "src/app/(app)/recebimento/processos/[id]/page.tsx" "src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx" "src/app/(app)/recebimento/processos/[id]/navegacao-processo.tsx" src/modules/recebimento/infra/processo-detalhe-repository.ts src/modules/recebimento/infra/processo-repository.ts src/modules/recebimento/domain/busca-processo.ts src/modules/recebimento/domain/__tests__/busca-processo.test.ts
git commit -F - << 'EOF'
feat(grid): setas seguem a ordem e os filtros do grid

O link da linha leva o estado do grid (?g=) e a posição (?i=); o detalhe calcula
os vizinhos com a MESMA consulta da lista. Sai a RPC obsoleta e o ?busca=&status=
da lista antiga.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final

**Files:** nenhum (só verificação; o controller aplica a migração 0023 antes do smoke).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os 12 testes de `vizinhos` entre eles. Único warning aceitável: o pré-existente de `<img>` em `anexos-processo.tsx`.

- [ ] **Step 2: Smoke (anotar; NÃO fazer push)**

Pré-condição: o controller já aplicou a migração 0023.

1. No grid, **filtrar** (ex.: Status = Aberto) **e ordenar** por uma coluna (ex.: Fornecedor A→Z). Abrir um processo **do meio** da lista.
2. As setas devem andar **dentro do filtro e na ordem escolhida** — confira 2–3 saltos contra a lista.
3. Ir até a **última linha de uma página** e abrir: a seta ▶ deve levar à **primeira linha da página seguinte** (atravessa página).
4. Com o filtro `Status = Aberto`, abrir um processo e **finalizá-lo**; a seta ▶ deve levar ao **próximo Aberto** (não morrer).
5. Abrir um processo por **link direto** (cole `/recebimento/processos/<id>` sem `?g=`): as setas funcionam na ordem padrão (número desc).
6. Conferir que nas **pontas** (primeiro/último da lista) a seta correspondente fica **desabilitada**.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- Reaproveitar o construtor (não reescrever em SQL) → Task 2 (`montarQueryGrid` usado por ambos). ✅
- Link com `?g=&i=` → Task 4 Step 1. ✅
- Sem contexto → `ESTADO_GRID_PADRAO` → Task 4 Step 4. ✅
- Saiu do filtro → usa a posição → Task 1 (`vizinhosDaLista`) + testes. ✅
- Atravessa página → consequência da lista de ids sem paginação (Task 2). ✅
- Teto 5000 com detecção de estouro → Task 2 (`.range(0, TETO)`) + Task 4 (`ids.length > TETO`). ✅
- Faxina (RPC + buscarVizinhos + busca/status) → Task 3 (migração) + Task 4 Step 5. ✅
- Whitelist do `?g=` → Task 4 Step 4 (`decodificarEstadoGrid(g, catalogo)`). ✅

**Consistência de tipos:** `Vizinho {id, posicao}`/`Vizinhos`/`vizinhosDaLista` (Task 1) consumidos em 4; `listarIdsGrid`/`TETO_VIZINHOS` (Task 2) em 4; `montarQueryGrid` interno, usado por `listarProcessosGrid` e `listarIdsGrid` (Task 2). `NavegacaoProcesso` recebe `Vizinho | null` + `g: string` — casa com o que a `page.tsx` passa. ✅

**Sem placeholders:** todo passo de código traz o código completo. O código da Task 2 foi **prototipado e verificado** (tsc limpo) antes de entrar no plano. ✅
