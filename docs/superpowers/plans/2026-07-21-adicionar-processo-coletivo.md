# Adicionar Processo em lote (Individual + Coletivo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela `/recebimento/processos/novo`, permitir criar vários processos de uma vez (modo Coletivo): Comercial preenchido uma vez + Material como tabela de N linhas, cada linha vira um processo.

**Architecture:** Reusa 100% o design atual (mesmos `Card`/grid/`CampoControle`). Extrai a preparação de valores do `criarProcessoManual` num helper puro reusado por linha; nova action de lote insere N processos atomicamente. Sem migração.

**Tech Stack:** Next.js 16 (App Router, Server Actions/Components), TypeScript strict (`noUncheckedIndexedAccess`), Tailwind, Vitest, Supabase.

## Global Constraints

- **AGENTS.md:** Next 16 — ler `node_modules/next/dist/docs` antes de escrever.
- **Branch:** trabalhar em `feat/adicionar-processo-coletivo`. **Sem migração** (usa tabelas existentes).
- **Fluxo Dev × Prod:** o smoke é no **Dev** (o `npm run dev` local aponta pro Dev). **Sem `git push`/merge** — o controller promove após o review e a aprovação do usuário. Subagentes NÃO dão push.
- **Reuso obrigatório:** `CampoControle`, `Card/CardHeader/CardTitle/CardContent`, o grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. O modo **Individual não muda de comportamento**.
- **Regra do Coletivo:** cada linha exige `codigo_material` (Item Recebido); calculados computados **por linha**; criação **atômica** (1 INSERT); após criar → detalhe do 1º processo (menor `numero`).
- TS strict `noUncheckedIndexedAccess`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc.
- Verificação: `npx tsc --noEmit && npm run lint && npm run build && npm run test`.

## File Structure

- Modify: `src/app/(app)/recebimento/processos/campo-controle.tsx` — prop `mostrarRotulo`.
- Create: `src/modules/recebimento/application/preparar-valores-processo.ts` — helper puro.
- Create: `src/modules/recebimento/application/__tests__/preparar-valores-processo.test.ts`.
- Modify: `src/modules/recebimento/application/criar-processo.ts` — usa o helper.
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts` — `criarProcessosLote`.
- Create: `src/modules/recebimento/application/criar-processos-coletivo.ts` — action de lote.
- Modify: `src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx` — toggle + tabela.

---

### Task 1: Prop `mostrarRotulo` no `CampoControle`

**Files:**
- Modify: `src/app/(app)/recebimento/processos/campo-controle.tsx`

**Interfaces:**
- Produces: `CampoControle` aceita `mostrarRotulo?: boolean` (default `true`). Quando `false`, não renderiza o `<Label>` (usado nas células da tabela do Coletivo, onde o cabeçalho da coluna é o rótulo).

- [ ] **Step 1: Adicionar a prop à interface**

Em `CampoControleProps`, após `onChange`:

```tsx
  onChange: (valor: string) => void
  /** Oculta o rótulo (o chamador já mostra o label — ex.: cabeçalho de coluna numa tabela). Default: true. */
  mostrarRotulo?: boolean
```

- [ ] **Step 2: Consumir a prop e condicionar o `<Label>`**

Na desestruturação do componente, adicionar `mostrarRotulo = true`:

```tsx
export function CampoControle({
  campo,
  valor,
  valorCalculado,
  itens,
  somenteLeitura,
  obrigatorio,
  onChange,
  mostrarRotulo = true,
}: CampoControleProps) {
```

E trocar o `<Label>` do ramo editável por uma versão condicional:

```tsx
      {mostrarRotulo && (
        <Label htmlFor={inputId}>
          {campo.rotulo}
          {obrigatorio && <span className="text-red-600"> *</span>}
        </Label>
      )}
```

(O ramo `CampoCalculadoControle` não muda — campos calculados não entram no Material.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros (o warning `<img>` pré-existente é aceitável).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/recebimento/processos/campo-controle.tsx"
git commit -F - << 'EOF'
feat(recebimento): CampoControle aceita mostrarRotulo (para células de tabela)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Helper puro `prepararValoresProcesso` (TDD) + refatorar `criarProcessoManual`

**Files:**
- Create: `src/modules/recebimento/application/preparar-valores-processo.ts`
- Create: `src/modules/recebimento/application/__tests__/preparar-valores-processo.test.ts`
- Modify: `src/modules/recebimento/application/criar-processo.ts`

**Interfaces:**
- Consumes: `converterValor` (`../domain/conversao`), `calcularCamposCalculados`/`CampoCalc`/`FaixaNqa` (`../domain/calculos`), `CampoFormulario` (`../infra/processo-detalhe-repository`).
- Produces:
  ```ts
  interface DepsCalculoProcesso { fornecedoresCriticos: string[]; nqa: FaixaNqa[]; usuarioAtual: string }
  type ResultadoPreparar =
    | { ok: true; valores: Record<string, string | number | null>; camposAlterados: string[] }
    | { ok: false; erro: string }
  function prepararValoresProcesso(
    campos: CampoFormulario[],
    itensPorLista: Record<string, string[]>,
    deps: DepsCalculoProcesso,
    valores: Record<string, unknown>,
  ): ResultadoPreparar
  ```

- [ ] **Step 1: Escrever o teste (falha)**

`src/modules/recebimento/application/__tests__/preparar-valores-processo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prepararValoresProcesso } from '../preparar-valores-processo'
import type { CampoFormulario } from '../../infra/processo-detalhe-repository'

function campo(
  over: Partial<CampoFormulario> & {
    campo: string
    grupo: CampoFormulario['grupo']
    tipo: CampoFormulario['tipo']
  },
): CampoFormulario {
  return {
    rotulo: over.campo,
    listaChave: null,
    origem: 'comercial',
    obrigatorioFinalizacao: false,
    obrigatorioImportacao: false,
    ordem: 0,
    calculado: false,
    formula: null,
    formulaConfig: {},
    ...over,
  }
}

const deps = { fornecedoresCriticos: [], nqa: [], usuarioAtual: 'teste' }

describe('prepararValoresProcesso', () => {
  it('rejeita campo obrigatório vazio', () => {
    const campos = [
      campo({ campo: 'codigo_material', grupo: 'material', tipo: 'texto', obrigatorioImportacao: true, rotulo: 'Item Recebido' }),
    ]
    const r = prepararValoresProcesso(campos, {}, deps, {})
    expect(r).toEqual({ ok: false, erro: 'Campo obrigatório: Item Recebido.' })
  })

  it('monta só os grupos base (ignora recebimento/qualidade)', () => {
    const campos = [
      campo({ campo: 'fornecedor', grupo: 'comercial', tipo: 'texto' }),
      campo({ campo: 'codigo_material', grupo: 'material', tipo: 'texto' }),
      campo({ campo: 'responsavel', grupo: 'recebimento', tipo: 'texto' }),
    ]
    const r = prepararValoresProcesso(campos, {}, deps, {
      fornecedor: 'ACME',
      codigo_material: 'X1',
      responsavel: 'ignorar',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.valores).sort()).toEqual(['codigo_material', 'fornecedor'])
  })
})
```

- [ ] **Step 2: Rodar o teste (deve FALHAR)**

Run: `npm run test -- preparar-valores-processo`
Expected: FAIL (`Cannot find module '../preparar-valores-processo'`).

- [ ] **Step 3: Implementar o helper**

`src/modules/recebimento/application/preparar-valores-processo.ts`:

```ts
import { converterValor } from '../domain/conversao'
import { calcularCamposCalculados, type CampoCalc, type FaixaNqa } from '../domain/calculos'
import type { CampoFormulario } from '../infra/processo-detalhe-repository'

export interface DepsCalculoProcesso {
  fornecedoresCriticos: string[]
  nqa: FaixaNqa[]
  usuarioAtual: string
}

export type ResultadoPreparar =
  | { ok: true; valores: Record<string, string | number | null>; camposAlterados: string[] }
  | { ok: false; erro: string }

const GRUPOS_BASE = new Set<CampoFormulario['grupo']>(['comercial', 'material'])

/**
 * Valida (obrigatórios + listas), converte e computa os campos calculados de um
 * processo a partir dos valores de Comercial + Material. Puro (sem I/O): recebe
 * os campos e as dependências já carregadas. Usado na criação individual e em
 * cada linha do lote coletivo — é a única fonte dessa regra (não duplicar).
 */
export function prepararValoresProcesso(
  campos: CampoFormulario[],
  itensPorLista: Record<string, string[]>,
  deps: DepsCalculoProcesso,
  valores: Record<string, unknown>,
): ResultadoPreparar {
  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []

  for (const campo of campos) {
    if (!GRUPOS_BASE.has(campo.grupo)) continue // recebimento/qualidade: em branco
    if (campo.calculado) continue // calculado nunca vem do cliente
    const bruto = valores[campo.campo]
    const vazio = bruto === null || bruto === undefined || String(bruto).trim() === ''
    if (campo.obrigatorioImportacao && vazio) {
      return { ok: false, erro: `Campo obrigatório: ${campo.rotulo}.` }
    }
    const itens = campo.listaChave ? itensPorLista[campo.listaChave] : undefined
    const r = converterValor(bruto, campo.tipo, itens)
    if (!r.ok) return { ok: false, erro: `${campo.rotulo}: ${r.erro}` }
    novosValores[campo.campo] = r.valor
    camposAlterados.push(campo.campo)
  }

  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))
  const calculados = calcularCamposCalculados(novosValores, camposCalculados, {
    fornecedoresCriticos: deps.fornecedoresCriticos,
    nqa: deps.nqa,
    usuarioAtual: deps.usuarioAtual,
    valoresAtuais: {}, // processo novo: sem valores anteriores
  })
  for (const [campo, valor] of Object.entries(calculados)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
  }

  return { ok: true, valores: novosValores, camposAlterados }
}
```

- [ ] **Step 4: Rodar o teste (deve PASSAR)**

Run: `npm run test -- preparar-valores-processo`
Expected: PASS (2 testes).

- [ ] **Step 5: Refatorar `criarProcessoManual` para usar o helper**

Em `src/modules/recebimento/application/criar-processo.ts`, trocar os imports:

```ts
import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  carregarCamposFormulario,
  criarProcesso,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'
import { carregarItensPorLista } from '../infra/campo-comercial-repository'
import { prepararValoresProcesso } from './preparar-valores-processo'
```

E substituir o corpo a partir de `const campos = await carregarCamposFormulario()` até o `criarProcesso(...)` por:

```ts
  const campos = await carregarCamposFormulario()

  const chavesLista = [
    ...new Set(
      campos
        .filter((c) => (c.grupo === 'comercial' || c.grupo === 'material') && !c.calculado && c.tipo === 'lista' && c.listaChave)
        .map((c) => c.listaChave as string),
    ),
  ]
  const [itensPorLista, fornecedoresCriticos, nqa] = await Promise.all([
    carregarItensPorLista(chavesLista),
    carregarCriticidade(),
    carregarTabelaNqa(),
  ])

  const prep = prepararValoresProcesso(campos, itensPorLista, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
  }, valores)
  if (!prep.ok) return { ok: false, erro: prep.erro }

  let novo: { id: string; numero: number }
  try {
    novo = await criarProcesso({
      ...(prep.valores as PatchProcesso),
      criado_por: sessao.usuarioId,
    })
  } catch {
    return { ok: false, erro: 'Não foi possível criar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: novo.id,
    acao: 'criar',
    descricao: `Processo #${novo.numero} criado manualmente`,
    dados: { numero: novo.numero, campos: prep.camposAlterados },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: novo.id }
```

(Removem-se do arquivo os imports agora não usados: `converterValor`, `calcularCamposCalculados`/`CampoCalc`. Comportamento do Individual: idêntico.)

- [ ] **Step 6: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run test -- preparar-valores-processo`
Expected: sem erros; 2 testes passam.

```bash
git add src/modules/recebimento/application/preparar-valores-processo.ts src/modules/recebimento/application/__tests__/preparar-valores-processo.test.ts src/modules/recebimento/application/criar-processo.ts
git commit -F - << 'EOF'
refactor(recebimento): extrai prepararValoresProcesso (puro, testado) do criar manual

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Repositório `criarProcessosLote` + action `criarProcessosColetivo`

**Files:**
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts`
- Create: `src/modules/recebimento/application/criar-processos-coletivo.ts`

**Interfaces:**
- Consumes: `prepararValoresProcesso`/`DepsCalculoProcesso` (Task 2); `carregarCamposFormulario`, `PatchProcesso`, `COLUNAS_GRAVAVEIS`, `ColunaGravavel` (repo); `carregarItensPorLista`, `carregarCriticidade`, `carregarTabelaNqa`.
- Produces:
  - `criarProcessosLote(patches: Array<PatchProcesso & { criado_por: string }>): Promise<Array<{ id: string; numero: number }>>`
  - `criarProcessosColetivo(comercial: Record<string, unknown>, materiais: Array<Record<string, unknown>>): Promise<{ ok: true; id: string; total: number } | { ok: false; erro: string }>`

- [ ] **Step 1: `criarProcessosLote` no repositório**

Em `src/modules/recebimento/infra/processo-detalhe-repository.ts`, logo após a função `criarProcesso` (que termina por volta da linha 322), adicionar:

```ts
/**
 * Cria N processos num ÚNICO insert (atômico: ou entram todos, ou nenhum). Mesma
 * regra de colunas graváveis do `criarProcesso` (status vem do default 'aberto').
 * Devolve id+numero de cada linha criada (ordem não garantida — o chamador ordena).
 */
export async function criarProcessosLote(
  patches: Array<PatchProcesso & { criado_por: string }>,
): Promise<Array<{ id: string; numero: number }>> {
  const supabase = await createServerSupabase()

  const registros = patches.map((patch) => {
    const registro: Record<string, unknown> = { criado_por: patch.criado_por }
    for (const [chave, valor] of Object.entries(patch)) {
      if (chave === 'criado_por' || chave === 'status') continue
      if (COLUNAS_GRAVAVEIS.has(chave as ColunaGravavel)) registro[chave] = valor
    }
    return registro
  })

  const { data, error } = await supabase
    .from('processos_recebimento')
    .insert(registros)
    .select('id, numero')
  if (error) throw error
  return ((data ?? []) as { id: string; numero: number }[]).map((r) => ({ id: r.id, numero: r.numero }))
}
```

- [ ] **Step 2: Action `criarProcessosColetivo`**

`src/modules/recebimento/application/criar-processos-coletivo.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  carregarCamposFormulario,
  criarProcessosLote,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'
import { carregarItensPorLista } from '../infra/campo-comercial-repository'
import { prepararValoresProcesso } from './preparar-valores-processo'

export type ResultadoColetivo =
  | { ok: true; id: string; total: number }
  | { ok: false; erro: string }

/**
 * Cria vários processos de uma vez: o Comercial (compartilhado) + cada linha de
 * Material vira um processo. Cada linha exige "Item Recebido" (codigo_material).
 * Calculados computados por linha. Criação atômica. Retorna o id do processo de
 * menor numero (o 1º), para onde a tela redireciona. Gate: `editar`.
 */
export async function criarProcessosColetivo(
  comercial: Record<string, unknown>,
  materiais: Array<Record<string, unknown>>,
): Promise<ResultadoColetivo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para criar processos.' }
  }
  if (materiais.length === 0) {
    return { ok: false, erro: 'Adicione ao menos uma linha de material.' }
  }

  const campos = await carregarCamposFormulario()
  const chavesLista = [
    ...new Set(
      campos
        .filter((c) => (c.grupo === 'comercial' || c.grupo === 'material') && !c.calculado && c.tipo === 'lista' && c.listaChave)
        .map((c) => c.listaChave as string),
    ),
  ]
  const [itensPorLista, fornecedoresCriticos, nqa] = await Promise.all([
    carregarItensPorLista(chavesLista),
    carregarCriticidade(),
    carregarTabelaNqa(),
  ])
  const deps = { fornecedoresCriticos, nqa, usuarioAtual: sessao.nome || sessao.email }

  const rows: Array<PatchProcesso & { criado_por: string }> = []
  for (let i = 0; i < materiais.length; i++) {
    const linha = materiais[i]!
    const itemRecebido = linha['codigo_material']
    if (itemRecebido === null || itemRecebido === undefined || String(itemRecebido).trim() === '') {
      return { ok: false, erro: `Linha ${i + 1}: Item Recebido é obrigatório.` }
    }
    const prep = prepararValoresProcesso(campos, itensPorLista, deps, { ...comercial, ...linha })
    if (!prep.ok) return { ok: false, erro: `Linha ${i + 1}: ${prep.erro}` }
    rows.push({ ...(prep.valores as PatchProcesso), criado_por: sessao.usuarioId })
  }

  let criados: Array<{ id: string; numero: number }>
  try {
    criados = await criarProcessosLote(rows)
  } catch {
    return { ok: false, erro: 'Não foi possível criar os processos.' }
  }
  if (criados.length === 0) return { ok: false, erro: 'Não foi possível criar os processos.' }

  const ordenados = [...criados].sort((a, b) => a.numero - b.numero)
  const primeiro = ordenados[0]!
  await registrarLog({
    entidade: 'processo',
    entidadeId: primeiro.id,
    acao: 'criar',
    descricao: `${criados.length} processos criados em lote (${ordenados.map((p) => `#${p.numero}`).join(', ')})`,
    dados: { total: criados.length, numeros: ordenados.map((p) => p.numero) },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: primeiro.id, total: criados.length }
}
```

- [ ] **Step 3: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

```bash
git add src/modules/recebimento/infra/processo-detalhe-repository.ts src/modules/recebimento/application/criar-processos-coletivo.ts
git commit -F - << 'EOF'
feat(recebimento): criação de processos em lote (Coletivo) atômica

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: UI — `NovoProcessoForm` com toggle + tabela Coletivo

**Files:**
- Modify: `src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx`

**Interfaces:**
- Consumes: `criarProcessoManual` (Task 2), `criarProcessosColetivo` (Task 3), `CampoControle` com `mostrarRotulo` (Task 1).

- [ ] **Step 1: Reescrever o formulário**

Substituir todo o conteúdo de `src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx` por:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { criarProcessoManual } from '@/modules/recebimento/application/criar-processo'
import { criarProcessosColetivo } from '@/modules/recebimento/application/criar-processos-coletivo'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { CampoControle } from '../campo-controle'

type Modo = 'individual' | 'coletivo'

/** Converte os valores de um conjunto de campos em payload (número → Number). */
function montarValores(
  campos: CampoFormulario[],
  valores: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const campo of campos) {
    const bruto = valores[campo.campo] ?? ''
    payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
  }
  return payload
}

/**
 * Criação manual de processo. Individual = 1 Comercial + 1 Material (como antes).
 * Coletivo = 1 Comercial (compartilhado) + N linhas de Material (tabela); cada
 * linha vira um processo. Reusa `CampoControle` em ambos os modos.
 */
export function NovoProcessoForm({
  campos,
  itensPorLista,
}: {
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
}) {
  const router = useRouter()
  const [modo, setModo] = useState<Modo>('individual')
  // `valores` guarda o Comercial (e o Material no modo Individual).
  const [valores, setValores] = useState<Record<string, string>>({})
  // `linhas` guarda as linhas de Material do modo Coletivo.
  const [linhas, setLinhas] = useState<Record<string, string>[]>([{}])
  const [salvando, startTransition] = useTransition()

  const comercialCampos = campos.filter((c) => c.grupo === 'comercial').sort((a, b) => a.ordem - b.ordem)
  const materialCampos = campos.filter((c) => c.grupo === 'material').sort((a, b) => a.ordem - b.ordem)

  function atualizarValor(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }
  function atualizarLinha(i: number, campo: string, valor: string) {
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)))
  }
  function ajustarQuantidade(n: number) {
    const alvo = Math.max(1, Math.floor(n) || 1)
    setLinhas((atual) => {
      if (alvo === atual.length) return atual
      if (alvo < atual.length) return atual.slice(0, alvo)
      return [...atual, ...Array.from({ length: alvo - atual.length }, () => ({}) as Record<string, string>)]
    })
  }
  function adicionarLinha() {
    setLinhas((atual) => [...atual, {}])
  }
  function removerLinha(i: number) {
    setLinhas((atual) => (atual.length <= 1 ? atual : atual.filter((_, idx) => idx !== i)))
  }

  function onCriar() {
    startTransition(async () => {
      if (modo === 'individual') {
        const r = await criarProcessoManual(montarValores(campos, valores))
        if (r.ok) {
          toast.success('Processo criado.')
          router.push(`/recebimento/processos/${r.id}`)
        } else {
          toast.error(r.erro)
        }
      } else {
        const comercial = montarValores(comercialCampos, valores)
        const materiais = linhas.map((l) => montarValores(materialCampos, l))
        const r = await criarProcessosColetivo(comercial, materiais)
        if (r.ok) {
          toast.success(`${r.total} processo(s) criado(s).`)
          router.push(`/recebimento/processos/${r.id}`)
        } else {
          toast.error(r.erro)
        }
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toggle Individual | Coletivo */}
      <div className="inline-flex self-start rounded-lg border border-border bg-muted p-1">
        {(['individual', 'coletivo'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={
              modo === m
                ? 'rounded-md bg-enterplak px-5 py-1.5 text-sm font-medium text-white'
                : 'rounded-md px-5 py-1.5 text-sm font-medium text-muted-foreground hover:text-tinta'
            }
          >
            {m === 'individual' ? 'Individual' : 'Coletivo'}
          </button>
        ))}
      </div>

      {/* Comercial (sempre) */}
      <Card>
        <CardHeader>
          <CardTitle>Comercial</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {comercialCampos.map((campo) => (
              <CampoControle
                key={campo.campo}
                campo={campo}
                valor={valores[campo.campo] ?? ''}
                valorCalculado={undefined}
                itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                somenteLeitura={false}
                obrigatorio={campo.obrigatorioImportacao}
                onChange={(valor) => atualizarValor(campo.campo, valor)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Material — Individual: card de campos; Coletivo: tabela de N linhas */}
      {modo === 'individual' ? (
        <Card>
          <CardHeader>
            <CardTitle>Material</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {materialCampos.map((campo) => (
                <CampoControle
                  key={campo.campo}
                  campo={campo}
                  valor={valores[campo.campo] ?? ''}
                  valorCalculado={undefined}
                  itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                  somenteLeitura={false}
                  obrigatorio={campo.obrigatorioImportacao}
                  onChange={(valor) => atualizarValor(campo.campo, valor)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              Material <span className="text-sm font-normal text-muted-foreground">· cada linha vira um processo</span>
            </CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Quantidade de processos
              <input
                type="number"
                min={1}
                value={linhas.length}
                onChange={(e) => ajustarQuantidade(Number(e.target.value))}
                className="h-9 w-16 rounded-lg border border-input bg-background text-center text-sm"
              />
            </label>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 pb-2"></th>
                  {materialCampos.map((c) => (
                    <th key={c.campo} className="px-2 pb-2 font-medium">
                      {c.rotulo}
                    </th>
                  ))}
                  <th className="w-8 pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha, i) => (
                  <tr key={i}>
                    <td className="pr-2 align-middle text-sm font-medium text-enterplak">{i + 1}</td>
                    {materialCampos.map((campo) => (
                      <td key={campo.campo} className="px-2 py-1 align-top">
                        <CampoControle
                          campo={campo}
                          valor={linha[campo.campo] ?? ''}
                          valorCalculado={undefined}
                          itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                          somenteLeitura={false}
                          obrigatorio={false}
                          mostrarRotulo={false}
                          onChange={(valor) => atualizarLinha(i, campo.campo, valor)}
                        />
                      </td>
                    ))}
                    <td className="py-1 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => removerLinha(i)}
                        disabled={linhas.length <= 1}
                        aria-label={`Remover linha ${i + 1}`}
                        className="text-lg leading-none text-muted-foreground hover:text-red-600 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={adicionarLinha}
              className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-sm font-medium text-enterplak hover:bg-muted"
            >
              + Adicionar linha
            </button>
          </CardContent>
        </Card>
      )}

      <div>
        <Button onClick={onCriar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
          {salvando
            ? 'Criando…'
            : modo === 'individual'
              ? 'Criar processo'
              : `Criar ${linhas.length} processo(s)`}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros (só o warning `<img>` pré-existente). Se o build faltar memória: `pkill -f "next dev" || true` antes e/ou `NODE_OPTIONS="--max-old-space-size=4096" npm run build`.

```bash
git add "src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx"
git commit -F - << 'EOF'
feat(recebimento): tela Adicionar Processo com modo Individual/Coletivo

Toggle no topo; Comercial compartilhado; no Coletivo o Material vira tabela de N
linhas (quantidade sincronizada + adicionar/remover), cada linha vira um processo.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final

**Files:** nenhum (só verificação). Smoke no **Dev** (o `npm run dev` local já aponta pro Dev). **Sem push.**

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; único warning aceitável: `<img>` pré-existente.

- [ ] **Step 2: Smoke no Dev (o controller sobe `npm run dev`)**

1. **Individual (sem regressão):** `/recebimento/processos/novo` → preenche Comercial + Material → "Criar processo" → cai no detalhe do processo criado; os campos são idênticos aos de hoje.
2. **Coletivo:** liga o toggle **Coletivo** → o Comercial continua igual; o Material vira **tabela**. Preenche o Comercial 1x + **3 linhas** de Material → "Criar 3 processo(s)" → cria **3 processos** (mesmo Comercial, materiais distintos, `numero` sequencial) → cai no **detalhe do 1º**.
3. **Sincronização:** mudar a caixa "Quantidade de processos" adiciona/remove linhas; "+ Adicionar linha" incrementa a caixa; remover (×) decrementa (mínimo 1 linha).
4. **Validação:** deixar uma linha **sem Item Recebido** e clicar Criar → toast "Linha N: Item Recebido é obrigatório." e **nada é criado**.
5. **Calculados por linha:** conferir num processo criado em lote que os campos calculados (ex.: amostral/NQA, que usa a quantidade) refletem a **linha daquele processo**.

- [ ] **Step 3: NÃO fazer push/merge** — o controller apresenta ao usuário; após aprovação, promove (merge → deploy; sem migração).

---

## Notas de verificação (self-review)

- **Cobertura da spec:** toggle + Individual inalterado (T4) ✅; Comercial compartilhado + Material tabela dinâmica (T4) ✅; quantidade ↔ linhas (T4) ✅; exige Item Recebido por linha (T3) ✅; calculados por linha (T2 helper usado por linha em T3) ✅; criação atômica (T3 `criarProcessosLote`) ✅; após criar → 1º processo (T3 ordena por numero; T4 redireciona) ✅; reuso do `CampoControle` com `mostrarRotulo` (T1) ✅; sem migração ✅.
- **Consistência de tipos:** `prepararValoresProcesso(campos, itensPorLista, deps, valores)` e `DepsCalculoProcesso` (T2) usados verbatim em T3; `criarProcessosLote(patches)` (T3 repo) consumido pela action (T3); `criarProcessosColetivo(comercial, materiais)` retorna `{ ok, id, total }` consumido pela UI (T4); `mostrarRotulo?: boolean` (T1) usado em T4.
- **Sem placeholders:** todo passo traz o código completo; "antes" lido dos arquivos reais.
- **`noUncheckedIndexedAccess`:** `materiais[i]!`, `ordenados[0]!`/`primeiro` seguros (índice do loop; array não-vazio checado). `linha[campo.campo] ?? ''` e `valores[...] ?? ''` já cobrem undefined.
