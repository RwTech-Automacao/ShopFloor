# Grid de Processos (tipo Excel) — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela de Processos vira uma planilha: cada campo é uma coluna, com ordenação e filtro por coluna (estilo Excel) e paginação — tudo no servidor.

**Architecture:** Uma migração cria a tabela de layout (`colunas_lista`, separada de `configuracao_campos`) e uma RPC de valores distintos com whitelist. O estado do grid (ordenação/filtros/página/tamanho) vive na URL num param codificado, decodificado e **validado** por uma função de domínio. O repositório monta a consulta via PostgREST (sem SQL dinâmico), com a coluna sempre validada contra o catálogo. O accordion por mês é removido — o mês vira filtro da coluna Data Chegada.

**Tech Stack:** Next.js 16 (App Router, Server Components/Actions), TypeScript strict (`noUncheckedIndexedAccess`), Supabase (PostgREST + RPC), Tailwind/base-ui, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16 (`searchParams` é **Promise**).
- **🔴 Filtro/ordenação/paginação SEMPRE no servidor** — valem sobre a base inteira. Filtrar na página 1 algo que estaria na "página 10" **tem** que trazer o item.
- **Whitelist obrigatória:** todo nome de coluna vindo do cliente (ordenar/filtrar) é validado contra o **catálogo**. Nunca interpolar direto.
- **Catálogo** = `configuracao_campos` (`ativo=true`) + colunas de sistema `numero` e `status`.
- **Padrão de 11 colunas visíveis:** `numero`, `numero_nf`, `numero_emb`, `di_inpi`, `acp_cliente`, `numero_pedido`, `tipo`, `fornecedor`, `codigo_material`, `data_chegada`, `status`.
- **Coluna de data filtra por MÊS** (`'YYYY-MM'` / `'sem_data'`), traduzido para faixas de data.
- **Sem biblioteca de grid.** Só 2 primitives novos: Popover e Checkbox.
- **Setas ‹ ›** ficam na ordem antiga (dívida da Fase 3) — **não** mexer em `processos_vizinhos`.
- **`tsconfig` tem `noUncheckedIndexedAccess`** — acesso a `Record<string,X>` retorna `X | undefined`.
- **A migração 0021 é aplicada em produção PELO CONTROLLER** após o review da Task 1. O subagent **NÃO** roda `supabase db push` e **NÃO** faz `git push`.
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test` (TDD só no domínio).

---

### Task 1: Migração 0021 — layout das colunas + RPC de valores distintos

**Files:**
- Create: `supabase/migrations/0021_grid_processos.sql`

**Interfaces:**
- Produces: tabela `public.colunas_lista(campo text pk, visivel boolean, ordem int)` + RLS; RPC `public.valores_distintos_processos(p_coluna text, p_limite int) → table(valor text)`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0021_grid_processos.sql`:

```sql
-- Grid de Processos (Fase 1): layout das colunas da LISTA + valores distintos por coluna.

-- Layout da lista, SEPARADO de configuracao_campos (que dita o formulário do processo):
-- reordenar/ocultar coluna na lista não pode alterar a configuração dos campos.
-- `campo` é texto livre (NÃO é FK) de propósito: precisa acomodar as colunas de sistema
-- `numero` e `status`, que não existem em configuracao_campos.
create table public.colunas_lista (
  campo text primary key,
  visivel boolean not null default false,
  ordem int not null default 0
);

alter table public.colunas_lista enable row level security;

-- Todo autenticado LÊ (a lista precisa do layout para renderizar); só admin escreve
-- (a tela de editar chega na Fase 2).
create policy colunas_lista_select on public.colunas_lista
  for select to authenticated using (true);
create policy colunas_lista_write on public.colunas_lista
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));

-- Semente: as 11 colunas do padrão, visíveis, na ordem acordada.
insert into public.colunas_lista (campo, visivel, ordem) values
  ('numero', true, 1),
  ('numero_nf', true, 2),
  ('numero_emb', true, 3),
  ('di_inpi', true, 4),
  ('acp_cliente', true, 5),
  ('numero_pedido', true, 6),
  ('tipo', true, 7),
  ('fornecedor', true, 8),
  ('codigo_material', true, 9),
  ('data_chegada', true, 10),
  ('status', true, 11);

-- Os demais campos do catálogo nascem OCULTOS. Offset 100 para, quando forem ligados
-- na Fase 2, aparecerem depois dos visíveis por padrão.
insert into public.colunas_lista (campo, visivel, ordem)
select c.campo, false, 100 + c.ordem
from public.configuracao_campos c
where c.ativo = true
on conflict (campo) do nothing;

-- Valores distintos de uma coluna, para a lista de checkbox do filtro (estilo Excel).
-- É o ÚNICO ponto do projeto com SQL dinâmico — por isso a whitelist é obrigatória.
-- O tipo é resolvido ANTES de montar o SQL: um CASE com to_char() não compilaria para
-- coluna de texto (o Postgres resolve a assinatura da função no plan time).
create or replace function public.valores_distintos_processos(
  p_coluna text,
  p_limite int default 200
)
returns table (valor text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tipo text;
begin
  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'processos_recebimento'
    and column_name = p_coluna;

  if v_tipo is null then
    raise exception 'coluna inválida: %', p_coluna;
  end if;

  if v_tipo = 'date' then
    -- Coluna de data: o valor distinto é o MÊS ('YYYY-MM'), e nulo vira 'sem_data' —
    -- é assim que o usuário filtra o mês, substituindo o accordion.
    return query execute format(
      'select distinct coalesce(to_char(%I, ''YYYY-MM''), ''sem_data'') as valor
         from public.processos_recebimento
        order by 1
        limit %L',
      p_coluna, p_limite
    );
  else
    -- Demais colunas: valores reais, sem nulos (filtrar "vazio" fica fora da Fase 1).
    return query execute format(
      'select distinct %I::text as valor
         from public.processos_recebimento
        where %I is not null
        order by 1
        limit %L',
      p_coluna, p_coluna, p_limite
    );
  end if;
end $$;

grant execute on function public.valores_distintos_processos(text, int) to authenticated;
```

- [ ] **Step 2: NÃO aplicar — commitar apenas**

NÃO rode `supabase db push` nem `git push`. A aplicação em produção é do controller, após o review desta task.

```bash
git add supabase/migrations/0021_grid_processos.sql
git commit -m "feat(grid): migração 0021 — colunas_lista + RPC de valores distintos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — estado do grid (TDD)

**Files:**
- Create: `src/modules/recebimento/domain/estado-grid.ts`
- Create: `src/modules/recebimento/domain/__tests__/estado-grid.test.ts`

**Interfaces:**
- Consumes: `inicioProximoMes` (`./agrupamento-mes`).
- Produces: `FiltroColuna`, `EstadoGrid`, `TAMANHOS_PAGINA`, `ESTADO_GRID_PADRAO`, `codificarEstadoGrid`, `decodificarEstadoGrid`, `FaixaMes`, `faixaDoMes`.

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/recebimento/domain/__tests__/estado-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ESTADO_GRID_PADRAO,
  codificarEstadoGrid,
  decodificarEstadoGrid,
  faixaDoMes,
  type EstadoGrid,
} from '../estado-grid'

const COLUNAS = ['numero', 'fornecedor', 'data_chegada', 'status']

describe('codificar/decodificarEstadoGrid', () => {
  it('faz ida e volta preservando o estado', () => {
    const estado: EstadoGrid = {
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 3,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' }, status: { valores: ['Aprovado'] } },
    }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })

  it('param ausente → padrão', () => {
    expect(decodificarEstadoGrid(undefined, COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('param inválido (não é JSON) → padrão, sem quebrar', () => {
    expect(decodificarEstadoGrid('%%%nao-e-json%%%', COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('coluna de ordenação fora da whitelist → volta ao padrão', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, ordenar: 'coluna_maliciosa' })
    expect(decodificarEstadoGrid(param, COLUNAS).ordenar).toBe(ESTADO_GRID_PADRAO.ordenar)
  })

  it('filtro em coluna fora da whitelist é descartado', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: 'ok' }, coluna_maliciosa: { texto: 'x' } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({ fornecedor: { texto: 'ok' } })
  })

  it('página negativa → 0 e direção inválida → desc', () => {
    const param = encodeURIComponent(JSON.stringify({ ordenar: 'numero', direcao: 'xxx', pagina: -5, tamanho: 50, filtros: {} }))
    const e = decodificarEstadoGrid(param, COLUNAS)
    expect(e.pagina).toBe(0)
    expect(e.direcao).toBe('desc')
  })

  it('tamanho fora dos permitidos → padrão (50)', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, tamanho: 999 })
    expect(decodificarEstadoGrid(param, COLUNAS).tamanho).toBe(50)
  })

  it('filtro vazio é descartado (não vira filtro que não filtra nada)', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: '   ' }, status: { valores: [] } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({})
  })
})

describe('faixaDoMes', () => {
  it('mês vira a faixa [primeiro dia, primeiro dia do mês seguinte)', () => {
    expect(faixaDoMes('2026-07')).toEqual({ inicio: '2026-07-01', fim: '2026-08-01' })
  })
  it('dezembro vira janeiro do ano seguinte', () => {
    expect(faixaDoMes('2026-12')).toEqual({ inicio: '2026-12-01', fim: '2027-01-01' })
  })
  it('sem_data não tem faixa (é filtro de nulo)', () => {
    expect(faixaDoMes('sem_data')).toBeNull()
  })
  it('valor inválido não tem faixa', () => {
    expect(faixaDoMes('abacaxi')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- estado-grid`
Expected: FAIL (módulo `../estado-grid` não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/estado-grid.ts`:

```ts
import { inicioProximoMes } from './agrupamento-mes'

/** Filtro de uma coluna: busca por texto e/ou valores marcados no checkbox (estilo Excel). */
export type FiltroColuna = { texto?: string; valores?: string[] }

export interface EstadoGrid {
  ordenar: string
  direcao: 'asc' | 'desc'
  pagina: number // 0-based
  tamanho: number // linhas por página (seletor da UI)
  filtros: Record<string, FiltroColuna>
}

export const TAMANHOS_PAGINA = [25, 50, 100, 200] as const

export const ESTADO_GRID_PADRAO: EstadoGrid = {
  ordenar: 'numero',
  direcao: 'desc',
  pagina: 0,
  tamanho: 50,
  filtros: {},
}

/** Serializa o estado para caber num único parâmetro de URL (`?g=`). */
export function codificarEstadoGrid(estado: EstadoGrid): string {
  return encodeURIComponent(JSON.stringify(estado))
}

/**
 * Decodifica o estado do parâmetro da URL **validando tudo**: o param é digitável pelo
 * usuário, então nada dele é confiável. Coluna fora de `colunasValidas` (ordenação ou
 * filtro) é descartada — é a defesa que impede um nome de coluna arbitrário chegar à
 * consulta. Qualquer inconsistência degrada para o padrão em vez de quebrar a tela.
 */
export function decodificarEstadoGrid(
  param: string | undefined,
  colunasValidas: string[],
): EstadoGrid {
  if (!param) return { ...ESTADO_GRID_PADRAO, filtros: {} }

  let bruto: unknown
  try {
    bruto = JSON.parse(decodeURIComponent(param))
  } catch {
    return { ...ESTADO_GRID_PADRAO, filtros: {} }
  }
  if (!bruto || typeof bruto !== 'object') return { ...ESTADO_GRID_PADRAO, filtros: {} }

  const o = bruto as Record<string, unknown>
  const validas = new Set(colunasValidas)

  const ordenar =
    typeof o.ordenar === 'string' && validas.has(o.ordenar) ? o.ordenar : ESTADO_GRID_PADRAO.ordenar
  const direcao: 'asc' | 'desc' = o.direcao === 'asc' ? 'asc' : 'desc'
  const pagina =
    typeof o.pagina === 'number' && Number.isInteger(o.pagina) && o.pagina > 0 ? o.pagina : 0
  const tamanho =
    typeof o.tamanho === 'number' && (TAMANHOS_PAGINA as readonly number[]).includes(o.tamanho)
      ? o.tamanho
      : ESTADO_GRID_PADRAO.tamanho

  const filtros: Record<string, FiltroColuna> = {}
  if (o.filtros && typeof o.filtros === 'object') {
    for (const [campo, cru] of Object.entries(o.filtros as Record<string, unknown>)) {
      if (!validas.has(campo)) continue // coluna desconhecida/adulterada: descarta
      if (!cru || typeof cru !== 'object') continue
      const f = cru as Record<string, unknown>
      const filtro: FiltroColuna = {}
      if (typeof f.texto === 'string' && f.texto.trim() !== '') filtro.texto = f.texto
      if (Array.isArray(f.valores)) {
        const valores = f.valores.filter((v): v is string => typeof v === 'string')
        if (valores.length > 0) filtro.valores = valores
      }
      if (filtro.texto !== undefined || filtro.valores !== undefined) filtros[campo] = filtro
    }
  }

  return { ordenar, direcao, pagina, tamanho, filtros }
}

/** Faixa semiaberta de datas de um mês: `>= inicio` e `< fim`. */
export interface FaixaMes {
  inicio: string
  fim: string
}

/**
 * Faixa de datas de um mês `'YYYY-MM'`. `null` quando não há faixa: `'sem_data'` (que vira
 * filtro de nulo) ou valor inválido. Usada para traduzir o filtro de MÊS de uma coluna de
 * data em condições de data na consulta.
 */
export function faixaDoMes(chave: string): FaixaMes | null {
  if (!/^\d{4}-\d{2}$/.test(chave)) return null
  return { inicio: `${chave}-01`, fim: inicioProximoMes(chave) }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- estado-grid`
Expected: PASS (12 testes).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/domain/estado-grid.ts src/modules/recebimento/domain/__tests__/estado-grid.test.ts
git commit -m "feat(grid): domínio do estado do grid (codificação, validação, faixa de mês) — TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra — catálogo, layout e consulta do grid

**Files:**
- Modify: `src/modules/recebimento/infra/processo-repository.ts`

**Interfaces:**
- Consumes: `EstadoGrid`, `faixaDoMes` (`../domain/estado-grid`); `sanitizarTermoBusca` (`../domain/busca-processo`, já importado); `carregarCamposFormulario` (`./processo-detalhe-repository`).
- Produces:
  - `interface ColunaGrid { campo: string; rotulo: string; tipo: 'texto'|'lista'|'numero'|'data' }`
  - `interface ColunaLista { campo: string; visivel: boolean; ordem: number }`
  - `carregarCatalogoColunas(): Promise<ColunaGrid[]>`
  - `listarColunasLista(): Promise<ColunaLista[]>`
  - `listarProcessosGrid(params): Promise<{ linhas: Record<string, unknown>[]; total: number }>`
  - `valoresDistintosColuna(campo: string): Promise<string[]>`

- [ ] **Step 1: Adicionar os imports**

No topo de `src/modules/recebimento/infra/processo-repository.ts`, adicionar:

```ts
import { faixaDoMes, type EstadoGrid } from '../domain/estado-grid'
import { carregarCamposFormulario } from './processo-detalhe-repository'
```

- [ ] **Step 2: Catálogo e layout**

No fim do arquivo, adicionar:

```ts
export interface ColunaGrid {
  campo: string
  rotulo: string
  tipo: 'texto' | 'lista' | 'numero' | 'data'
}

/** Colunas que existem em `processos_recebimento` mas NÃO em `configuracao_campos`
 *  (não são campos editáveis do processo) e ainda assim são exibíveis no grid. */
const COLUNAS_SISTEMA: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'status', rotulo: 'Status', tipo: 'texto' },
]

/**
 * Catálogo de colunas do grid: as de sistema + os campos ativos de
 * `configuracao_campos`. É a **whitelist** — nome de coluna vindo do cliente só é aceito
 * se estiver aqui.
 */
export async function carregarCatalogoColunas(): Promise<ColunaGrid[]> {
  const campos = await carregarCamposFormulario()
  return [
    ...COLUNAS_SISTEMA,
    ...campos.map((c) => ({ campo: c.campo, rotulo: c.rotulo, tipo: c.tipo })),
  ]
}

export interface ColunaLista {
  campo: string
  visivel: boolean
  ordem: number
}

/** Layout da lista (config geral): quais colunas aparecem e em que ordem. */
export async function listarColunasLista(): Promise<ColunaLista[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('colunas_lista')
    .select('campo, visivel, ordem')
    .order('ordem', { ascending: true })
  if (error) throw error
  return (data ?? []) as ColunaLista[]
}

/** Valores distintos de uma coluna, para o checkbox do filtro. Em coluna de data, vêm
 *  os MESES ('YYYY-MM' / 'sem_data'). Teto de 200 na RPC — o resto se acha pela busca. */
export async function valoresDistintosColuna(campo: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('valores_distintos_processos', {
    p_coluna: campo,
    p_limite: 200,
  })
  if (error) throw error
  return ((data ?? []) as { valor: string }[]).map((r) => r.valor)
}
```

- [ ] **Step 3: A consulta do grid**

Ainda no fim do arquivo, adicionar:

```ts
/**
 * Uma página do grid, com filtro e ordenação aplicados **no banco** — o resultado vale
 * sobre a base inteira, não sobre o que já estava carregado (requisito: filtrar na página
 * 1 tem que achar o que estaria na "página 10").
 *
 * `colunas` já vem validado contra o catálogo pelo chamador; o SELECT traz só elas (+ id),
 * o que mantém o payload pequeno mesmo com 39 colunas possíveis.
 */
export async function listarProcessosGrid({
  estado,
  colunas,
  tiposPorCampo,
}: {
  estado: EstadoGrid
  colunas: string[]
  tiposPorCampo: Record<string, ColunaGrid['tipo']>
}): Promise<{ linhas: Record<string, unknown>[]; total: number }> {
  const supabase = await createServerSupabase()

  let query = supabase
    .from('processos_recebimento')
    .select(['id', ...colunas].join(', '), { count: 'exact' })

  for (const [campo, filtro] of Object.entries(estado.filtros)) {
    if (filtro.texto) {
      const termo = sanitizarTermoBusca(filtro.texto)
      if (termo) query = query.ilike(campo, `%${termo}%`)
    }
    if (filtro.valores && filtro.valores.length > 0) {
      if (tiposPorCampo[campo] === 'data') {
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

  const inicio = estado.pagina * estado.tamanho
  const { data, error, count } = await query
    .order(estado.ordenar, { ascending: estado.direcao === 'asc' })
    .range(inicio, inicio + estado.tamanho - 1)
  if (error) throw error

  return { linhas: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0 }
}
```

- [ ] **Step 4: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros. (As funções antigas — `listarProcessos`, `listarProcessosDoMes`, `listarMesesProcessos` — continuam existindo; são removidas na Task 6.)

```bash
git add src/modules/recebimento/infra/processo-repository.ts
git commit -m "feat(grid): infra do grid — catálogo, layout e consulta com filtro/ordenação no servidor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Application — Server Actions do grid

**Files:**
- Create: `src/modules/recebimento/application/carregar-processos-grid.ts`

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, `carregarCatalogoColunas`, `listarColunasLista`, `listarProcessosGrid`, `valoresDistintosColuna`, `EstadoGrid`, `decodificarEstadoGrid`, `codificarEstadoGrid`.
- Produces:
  - `carregarProcessosGrid(estado: EstadoGrid): Promise<{ ok: true; linhas: Record<string,unknown>[]; total: number } | { ok: false; erro: string }>`
  - `carregarValoresColuna(campo: string): Promise<{ ok: true; valores: string[] } | { ok: false; erro: string }>`

- [ ] **Step 1: Criar o arquivo**

Criar `src/modules/recebimento/application/carregar-processos-grid.ts`:

```ts
'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { codificarEstadoGrid, decodificarEstadoGrid, type EstadoGrid } from '../domain/estado-grid'
import {
  carregarCatalogoColunas,
  listarColunasLista,
  listarProcessosGrid,
  valoresDistintosColuna,
} from '../infra/processo-repository'

export type ResultadoGrid =
  | { ok: true; linhas: Record<string, unknown>[]; total: number }
  | { ok: false; erro: string }

export type ResultadoValores = { ok: true; valores: string[] } | { ok: false; erro: string }

/**
 * Uma página do grid. O `estado` vem do cliente e é **re-validado aqui** contra o catálogo
 * (passa por `decodificar(codificar(...))`): nome de coluna de ordenação/filtro só é aceito
 * se existir no catálogo — o cliente nunca escolhe uma coluna arbitrária.
 */
export async function carregarProcessosGrid(estado: EstadoGrid): Promise<ResultadoGrid> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    const validas = catalogo.map((c) => c.campo)
    const seguro = decodificarEstadoGrid(codificarEstadoGrid(estado), validas)

    const layout = await listarColunasLista()
    const visiveis = layout.filter((c) => c.visivel).map((c) => c.campo)
    const colunas = visiveis.filter((campo) => validas.includes(campo))

    const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))
    const { linhas, total } = await listarProcessosGrid({ estado: seguro, colunas, tiposPorCampo })
    return { ok: true, linhas, total }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os processos.' }
  }
}

/** Valores distintos de uma coluna, para a lista de checkbox do filtro. */
export async function carregarValoresColuna(campo: string): Promise<ResultadoValores> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    if (!catalogo.some((c) => c.campo === campo)) {
      return { ok: false, erro: 'Coluna inválida.' }
    }
    return { ok: true, valores: await valoresDistintosColuna(campo) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os valores desta coluna.' }
  }
}
```

- [ ] **Step 2: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/recebimento/application/carregar-processos-grid.ts
git commit -m "feat(grid): Server Actions do grid (gate visualizar + whitelist de colunas)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI — o grid

**Files:**
- Modify: `package.json` (+ lock) e `src/components/ui/` — primitives Popover e Checkbox
- Create: `src/app/(app)/recebimento/processos/processos-grid.tsx`
- Modify: `src/app/(app)/recebimento/processos/page.tsx`

**Interfaces:**
- Consumes: `carregarValoresColuna` (Task 4), `EstadoGrid`/`codificarEstadoGrid`/`decodificarEstadoGrid`/`TAMANHOS_PAGINA` (Task 2), `carregarCatalogoColunas`/`listarColunasLista`/`listarProcessosGrid` (Task 3), `rotuloMes` (`domain/agrupamento-mes`), `rotuloStatusProcesso` (`domain/status-processo`), `ScrollHorizontalTopo` (já existe).

- [ ] **Step 1: Adicionar os primitives**

Run: `npx shadcn@latest add popover checkbox`
Expected: cria `src/components/ui/popover.tsx` e `src/components/ui/checkbox.tsx` (aceite sobrescrever nada existente — nenhum dos dois existe hoje).

- [ ] **Step 2: Criar o grid (client)**

Criar `src/app/(app)/recebimento/processos/processos-grid.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownAZIcon, ArrowRightIcon, ArrowUpAZIcon, FilterIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { carregarValoresColuna } from '@/modules/recebimento/application/carregar-processos-grid'
import { rotuloMes } from '@/modules/recebimento/domain/agrupamento-mes'
import {
  TAMANHOS_PAGINA,
  codificarEstadoGrid,
  type EstadoGrid,
  type FiltroColuna,
} from '@/modules/recebimento/domain/estado-grid'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'
import { ScrollHorizontalTopo } from './scroll-horizontal-topo'

interface ProcessosGridProps {
  colunas: ColunaGrid[]
  linhas: Record<string, unknown>[]
  total: number
  estado: EstadoGrid
}

/** Texto de uma célula. Data e status ganham formatação; o resto é o valor cru. */
function celula(coluna: ColunaGrid, valor: unknown): React.ReactNode {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (coluna.campo === 'status') {
    const s = rotuloStatusProcesso(String(valor))
    return <Badge className={s.className}>{s.rotulo}</Badge>
  }
  return String(valor)
}

export function ProcessosGrid({ colunas, linhas, total, estado }: ProcessosGridProps) {
  const router = useRouter()
  const [navegando, startNavegacao] = useTransition()

  function aplicar(novo: EstadoGrid) {
    startNavegacao(() => {
      router.push(`/recebimento/processos?g=${codificarEstadoGrid(novo)}`)
    })
  }

  const primeira = total === 0 ? 0 : estado.pagina * estado.tamanho + 1
  const ultima = Math.min((estado.pagina + 1) * estado.tamanho, total)
  const temProxima = ultima < total

  return (
    <div className="flex flex-col gap-3">
      <ScrollHorizontalTopo>
        <Table className="text-xs [&_:is(th,td)]:px-2.5 [&_:is(th,td)]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              {colunas.map((coluna) => (
                <TableHead key={coluna.campo}>
                  <MenuColuna
                    coluna={coluna}
                    estado={estado}
                    onAplicar={aplicar}
                    ativo={Boolean(estado.filtros[coluna.campo])}
                    ordenando={estado.ordenar === coluna.campo}
                    direcao={estado.direcao}
                  />
                </TableHead>
              ))}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={colunas.length + 1} className="py-6 text-center text-muted-foreground">
                  Nenhum processo encontrado para os filtros aplicados.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((linha) => (
              <TableRow key={String(linha.id)}>
                {colunas.map((coluna) => (
                  <TableCell key={coluna.campo}>{celula(coluna, linha[coluna.campo])}</TableCell>
                ))}
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Abrir processo #${String(linha.numero ?? '')}`}
                    render={<Link href={`/recebimento/processos/${String(linha.id)}`} />}
                  >
                    <ArrowRightIcon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollHorizontalTopo>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? 'Nenhum processo' : `Mostrando ${primeira}–${ultima} de ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Linhas por página"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={estado.tamanho}
            onChange={(e) => aplicar({ ...estado, tamanho: Number(e.target.value), pagina: 0 })}
          >
            {TAMANHOS_PAGINA.map((t) => (
              <option key={t} value={t}>
                {t} por página
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={estado.pagina === 0 || navegando}
            onClick={() => aplicar({ ...estado, pagina: estado.pagina - 1 })}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!temProxima || navegando}
            onClick={() => aplicar({ ...estado, pagina: estado.pagina + 1 })}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MenuColunaProps {
  coluna: ColunaGrid
  estado: EstadoGrid
  ativo: boolean
  ordenando: boolean
  direcao: 'asc' | 'desc'
  onAplicar: (estado: EstadoGrid) => void
}

/**
 * Cabeçalho da coluna com o menu estilo Excel: ordenar A→Z / Z→A, busca por texto e lista
 * de valores com checkbox. Os valores distintos são buscados sob demanda (só ao abrir o
 * menu) — em coluna de data eles são MESES, exibidos com `rotuloMes`.
 */
function MenuColuna({ coluna, estado, ativo, ordenando, direcao, onAplicar }: MenuColunaProps) {
  const filtroAtual: FiltroColuna = estado.filtros[coluna.campo] ?? {}
  const [texto, setTexto] = useState(filtroAtual.texto ?? '')
  const [marcados, setMarcados] = useState<string[]>(filtroAtual.valores ?? [])
  const [valores, setValores] = useState<string[] | null>(null)
  const [busca, setBusca] = useState('')
  const [carregando, startCarga] = useTransition()

  function aoAbrir(aberto: boolean) {
    if (!aberto || valores !== null) return
    startCarga(async () => {
      const r = await carregarValoresColuna(coluna.campo)
      setValores(r.ok ? r.valores : [])
    })
  }

  function ordenar(dir: 'asc' | 'desc') {
    onAplicar({ ...estado, ordenar: coluna.campo, direcao: dir, pagina: 0 })
  }

  function aplicarFiltro() {
    const filtros = { ...estado.filtros }
    const filtro: FiltroColuna = {}
    if (texto.trim() !== '') filtro.texto = texto.trim()
    if (marcados.length > 0) filtro.valores = marcados
    if (filtro.texto === undefined && filtro.valores === undefined) delete filtros[coluna.campo]
    else filtros[coluna.campo] = filtro
    onAplicar({ ...estado, filtros, pagina: 0 })
  }

  function limpar() {
    const filtros = { ...estado.filtros }
    delete filtros[coluna.campo]
    setTexto('')
    setMarcados([])
    onAplicar({ ...estado, filtros, pagina: 0 })
  }

  const listados = (valores ?? []).filter((v) =>
    busca.trim() === '' ? true : rotulo(coluna, v).toLowerCase().includes(busca.trim().toLowerCase()),
  )

  return (
    <Popover onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={
          <button type="button" className="flex items-center gap-1 font-medium hover:text-enterplak">
            {coluna.rotulo}
            {ordenando && (direcao === 'asc' ? <ArrowUpAZIcon className="size-3.5" /> : <ArrowDownAZIcon className="size-3.5" />)}
            <FilterIcon className={ativo ? 'size-3 text-enterplak' : 'size-3 opacity-40'} />
          </button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex flex-col">
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('asc')}>
            ↑ Ordenar de A a Z
          </button>
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('desc')}>
            ↓ Ordenar de Z a A
          </button>
          <div className="border-t border-border" />
          <div className="p-2">
            <Input
              placeholder="Buscar nesta coluna..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarFiltro()
              }}
              className="h-8"
            />
          </div>
          <div className="border-t border-border" />
          <div className="max-h-56 overflow-y-auto p-2">
            <Input
              placeholder="Filtrar valores..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="mb-2 h-7 text-xs"
            />
            {carregando && <p className="px-1 py-2 text-xs text-muted-foreground">Carregando…</p>}
            {!carregando && listados.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum valor.</p>
            )}
            {listados.map((valor) => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-sm">
                <Checkbox
                  checked={marcados.includes(valor)}
                  onCheckedChange={(marcado) =>
                    setMarcados((atual) =>
                      marcado ? [...atual, valor] : atual.filter((v) => v !== valor),
                    )
                  }
                />
                <span className="truncate">{rotulo(coluna, valor)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <Button variant="outline" size="sm" onClick={limpar}>
              Limpar
            </Button>
            <Button size="sm" className="bg-enterplak hover:bg-enterplak-700" onClick={aplicarFiltro}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Em coluna de data o valor é um MÊS ('YYYY-MM'/'sem_data') → mostra 'Julho/2026'. */
function rotulo(coluna: ColunaGrid, valor: string): string {
  return coluna.tipo === 'data' ? rotuloMes(valor) : valor
}
```

- [ ] **Step 3: Reescrever a `page.tsx`**

Substituir todo o conteúdo de `src/app/(app)/recebimento/processos/page.tsx` por:

```tsx
import Link from 'next/link'
import { PlusIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { Button } from '@/components/ui/button'
import { decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import {
  carregarCatalogoColunas,
  listarColunasLista,
  listarProcessosGrid,
} from '@/modules/recebimento/infra/processo-repository'
import { ProcessosGrid } from './processos-grid'

interface ProcessosPageProps {
  searchParams: Promise<{ g?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const { g } = await searchParams

  const [sessao, catalogo, layout] = await Promise.all([
    getSessao(),
    carregarCatalogoColunas(),
    listarColunasLista(),
  ])
  const podeCriar = podeFazer(sessao?.perfil ?? null, 'editar')

  // Estado vem da URL e é validado contra o catálogo (nada dele é confiável).
  const estado = decodificarEstadoGrid(
    g,
    catalogo.map((c) => c.campo),
  )

  // Colunas visíveis, na ordem do layout, restritas ao catálogo.
  const porCampo = new Map(catalogo.map((c) => [c.campo, c]))
  const colunas = layout
    .filter((c) => c.visivel)
    .map((c) => porCampo.get(c.campo))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)

  const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))
  const { linhas, total } = await listarProcessosGrid({
    estado,
    colunas: colunas.map((c) => c.campo),
    tiposPorCampo,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Processos</h1>
        {podeCriar && (
          <Button
            className="bg-enterplak hover:bg-enterplak-700"
            render={<Link href="/recebimento/processos/novo" />}
          >
            <PlusIcon />
            Adicionar processo
          </Button>
        )}
      </div>

      <ProcessosGrid colunas={colunas} linhas={linhas} total={total} estado={estado} />
    </div>
  )
}
```

- [ ] **Step 4: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros; a rota `/recebimento/processos` compila.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ui/popover.tsx src/components/ui/checkbox.tsx "src/app/(app)/recebimento/processos/processos-grid.tsx" "src/app/(app)/recebimento/processos/page.tsx"
git commit -m "feat(grid): tela de Processos vira grid tipo Excel (ordenar/filtrar/paginar no servidor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Limpeza — remover o accordion e o código morto

**Files:**
- Delete: `src/app/(app)/recebimento/processos/processos-por-mes.tsx`
- Delete: `src/app/(app)/recebimento/processos/processos-filtros.tsx`
- Delete: `src/app/(app)/recebimento/processos/linhas-processos.tsx`
- Delete: `src/modules/recebimento/application/carregar-processos-mes.ts`
- Modify: `src/modules/recebimento/infra/processo-repository.ts`

- [ ] **Step 1: Confirmar que ninguém mais usa**

Run: `grep -rn "processos-por-mes\|processos-filtros\|linhas-processos\|carregar-processos-mes\|ProcessosPorMes\|ProcessosFiltros\|LinhasProcessos\|carregarProcessosDoMes\|listarProcessosDoMes\|listarMesesProcessos\|listarProcessos\b" src/ --include=*.ts --include=*.tsx`
Expected: as únicas ocorrências devem ser as **próprias definições** nos arquivos a remover e as funções mortas do repository. Se aparecer outro consumidor, **PARE** e relate.

- [ ] **Step 2: Remover os arquivos**

```bash
git rm "src/app/(app)/recebimento/processos/processos-por-mes.tsx" "src/app/(app)/recebimento/processos/processos-filtros.tsx" "src/app/(app)/recebimento/processos/linhas-processos.tsx" src/modules/recebimento/application/carregar-processos-mes.ts
```

- [ ] **Step 3: Remover as funções mortas do repository**

Em `src/modules/recebimento/infra/processo-repository.ts`, remover as funções **`listarProcessos`**, **`listarProcessosDoMes`** e **`listarMesesProcessos`** (com seus JSDoc) e a interface **`ResultadoProcessos`** — todas ficaram sem consumidor após a Task 5.

**MANTER:** `ProcessoResumoRow`, `FiltrosProcessos`, `buscarVizinhos` (se existir aqui), e tudo que a Task 3 adicionou (`carregarCatalogoColunas`, `listarColunasLista`, `listarProcessosGrid`, `valoresDistintosColuna`).

Ajustar os imports do topo: se `condicaoBuscaProcesso`, `COLUNAS_BUSCA_PROCESSO`, `inicioProximoMes`, `montarGrupos` ou `GrupoMes` ficarem sem uso, **remover do import** (o lint acusa). `sanitizarTermoBusca` **continua em uso** (pelo `listarProcessosGrid`).

> **NÃO remover** `src/modules/recebimento/domain/agrupamento-mes.ts` — `rotuloMes` é usado pela tela **Exportar Fotos** e pelo grid; `inicioProximoMes` é usado por `faixaDoMes`.
> **NÃO remover** `scroll-horizontal-topo.tsx` — o grid o reutiliza.
> **NÃO** mexer na RPC `processos_meses` (0014): fica órfã, mas remover objeto do banco agora é risco desnecessário.

- [ ] **Step 4: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros; nenhum import morto.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(grid): remove o accordion por mês e o código morto da lista antiga

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os 12 testes de `estado-grid` entre eles.

- [ ] **Step 2: Smoke (anotar resultado; NÃO fazer push)**

Pré-requisito: **migração 0021 já aplicada em produção pelo controller**.

Com `npm run dev`, em `/recebimento/processos`:
1. O grid abre com as **11 colunas** (Número … Data Chegada, Status) e paginação no rodapé.
2. Clicar no cabeçalho **Fornecedor** → **Ordenar de A a Z** → a lista reordena e a URL ganha `?g=…`.
3. **O teste que mais importa:** anote um processo que esteja numa página distante (ex.: página 5). Volte à página 1, filtre a coluna dele por aquele valor → **o item tem que aparecer** (o filtro vale sobre a base inteira).
4. Filtrar **Data Chegada** → o checkbox lista **meses** ("Julho/2026", "Aguardando data de chegada") → marcar um mês equivale ao accordion de hoje.
5. Trocar o **seletor de linhas por página** (25/50/100/200) → a paginação se refaz.
6. **Limpar** o filtro → volta ao total.
7. Abrir um processo e **voltar** (botão do navegador) → os filtros/ordenação **continuam** (estão na URL).

- [ ] **Step 3: NÃO fazer push**

Os commits ficam **locais**; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Catálogo (37 campos + numero/status) → Task 3 (`carregarCatalogoColunas`). ✅
- Accordion sai; mês vira filtro da coluna de data → Task 5 (grid) + Task 6 (remoção) + Task 2/3 (`faixaDoMes` + tradução na consulta). ✅
- Ordenar A→Z/Z→A + filtro (busca **e** checkbox) por coluna → Task 5 (`MenuColuna`). ✅
- Filtro/ordenação/paginação no servidor, sobre a base inteira → Task 3 (`listarProcessosGrid`) + smoke item 3. ✅
- 11 colunas padrão → Task 1 (seed). ✅
- Layout em tabela separada, lida na Fase 1 → Task 1 + Task 3 (`listarColunasLista`). ✅
- Estado na URL, validado → Task 2 (`decodificarEstadoGrid` + testes de whitelist). ✅
- Seletor de linhas por página → Task 2 (`TAMANHOS_PAGINA`) + Task 5 (rodapé). ✅
- Sem lib de grid; Popover/Checkbox → Task 5 Step 1. ✅
- Setas intocadas (dívida da Fase 3) → Global Constraints. ✅

**Consistência de tipos:** `EstadoGrid`/`FiltroColuna`/`faixaDoMes`/`TAMANHOS_PAGINA` (Task 2) são consumidos nas Tasks 3, 4 e 5; `ColunaGrid`/`ColunaLista`/`listarProcessosGrid`/`carregarCatalogoColunas`/`listarColunasLista`/`valoresDistintosColuna` (Task 3) nas Tasks 4 e 5; `carregarValoresColuna` (Task 4) na Task 5. A RPC `valores_distintos_processos(p_coluna, p_limite)` (Task 1) é chamada com esse shape na Task 3. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅

**Desvio consciente do spec:** a RPC do spec usava `pg_typeof` dentro de um `CASE`; isto **não compila** para coluna de texto (o Postgres resolve a assinatura de `to_char` no plan time). O plano resolve o tipo **antes** de montar o SQL dinâmico — mesmo resultado, correto.
