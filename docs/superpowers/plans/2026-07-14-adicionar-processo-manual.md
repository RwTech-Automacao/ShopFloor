# Adicionar processo manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir criar um processo de recebimento manualmente pela UI (hoje só via importação de planilha), seguindo as mesmas regras do import (campos Comercial+Material; obrigatórios = `obrigatorio_importacao`).

**Architecture:** Botão "Adicionar processo" na lista de Processos (gate `editar`) → página dedicada `/recebimento/processos/novo` com formulário dos grupos Comercial+Material. Nova função de INSERT `criarProcesso` no repository + Server Action `criarProcessoManual` que espelha `salvarSecaoProcesso` (valida, converte, computa calculados no servidor, insere). O componente de renderização de campo é extraído para reuso entre o form de detalhe e o de criação.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Server Components), TypeScript strict, Tailwind v4, base-ui, Supabase (Postgres + RLS). Testes: vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16, App Router, Server Actions/Components.
- **Sem migração de schema/permissão:** o RLS `processos_insert` (migrações 0004/0007) já aceita `tem_permissao('editar')`; `'criar'` já existe no check de `logs.acao` (0005) e no type `AcaoLog`.
- **`numero` e `status` nunca são enviados no INSERT** — `numero` vem da sequência `processos_numero_seq` (default) e `status` do default `'aberto'`.
- **Permissão da feature:** `editar` (reuso). Tabela real: `processos_recebimento`.
- **Padrão de gate de página:** `getSessao()` + `podeFazer(perfil, acao)`; sem permissão → `<SemPermissao descricao="…" />` de `@/shared/ui/sem-permissao` (padrão da página `importar`).
- **Cor do botão primário:** `className="bg-enterplak hover:bg-enterplak-700"`.
- **Verificação (sem TDD nesta feature):** cada task termina com `npx tsc --noEmit` + `npm run build` verdes (e `npm run test` no final para garantir que nada quebrou). Não há regra pura nova — a validação é inline na Server Action, como em `salvarSecaoProcesso`.

---

### Task 1: Infra — expor `obrigatorioImportacao` e adicionar `criarProcesso`

**Files:**
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts`

**Interfaces:**
- Consumes: `COLUNAS_GRAVAVEIS` (Set já existente), `ColunaGravavel`, `PatchProcesso`, `createServerSupabase`, `configuracao_campos` (coluna `obrigatorio_importacao boolean not null default false`, migração 0003).
- Produces:
  - `CampoFormulario.obrigatorioImportacao: boolean`
  - `export async function criarProcesso(patch: PatchProcesso & { criado_por: string }): Promise<{ id: string; numero: number }>`

- [ ] **Step 1: Adicionar `obrigatorio_importacao` ao mapeamento de campos**

Em `src/modules/recebimento/infra/processo-detalhe-repository.ts`:

1. Na interface `CampoFormulario`, adicionar o campo (após `obrigatorioFinalizacao`):

```ts
  obrigatorioFinalizacao: boolean
  obrigatorioImportacao: boolean
```

2. Na interface `ConfiguracaoCampoFormularioRow`, adicionar (após `obrigatorio_finalizacao`):

```ts
  obrigatorio_finalizacao: boolean
  obrigatorio_importacao: boolean
```

3. No `.select(...)` de `carregarCamposFormulario`, incluir `obrigatorio_importacao`:

```ts
    .select(
      'campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_finalizacao, obrigatorio_importacao, ordem, calculado, formula, formula_config',
    )
```

4. No `.map((row) => ({ ... }))`, adicionar (após `obrigatorioFinalizacao`):

```ts
    obrigatorioFinalizacao: row.obrigatorio_finalizacao,
    obrigatorioImportacao: row.obrigatorio_importacao,
```

- [ ] **Step 2: Adicionar a função `criarProcesso`**

No mesmo arquivo, logo após a função `atualizarProcesso` (que termina com o
bloco `if (!data || data.length === 0) { throw ... }`), adicionar:

```ts
/**
 * Insere um novo processo de recebimento. Espelha a whitelist de
 * `atualizarProcesso` (`COLUNAS_GRAVAVEIS`) e adiciona `criado_por`. NÃO
 * envia `numero` (sequência `processos_numero_seq`, default) nem `status`
 * (default 'aberto') — o banco atribui ambos. O RLS `processos_insert`
 * (0004/0007) já autoriza o INSERT para quem tem `editar`. Retorna o id e o
 * numero do processo recém-criado.
 */
export async function criarProcesso(
  patch: PatchProcesso & { criado_por: string },
): Promise<{ id: string; numero: number }> {
  const supabase = await createServerSupabase()

  const registro: Record<string, unknown> = { criado_por: patch.criado_por }
  for (const [chave, valor] of Object.entries(patch)) {
    if (chave === 'criado_por') continue
    if (COLUNAS_GRAVAVEIS.has(chave as ColunaGravavel)) {
      registro[chave] = valor
    }
  }

  const { data, error } = await supabase
    .from('processos_recebimento')
    .insert(registro)
    .select('id, numero')
    .single()
  if (error) throw error
  if (!data) throw new Error('Não foi possível criar o processo.')
  return { id: data.id as string, numero: data.numero as number }
}
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros. (Se `npm run build` reclamar de rota/página, ignore — nada de UI mudou aqui; só o `tsc` importa nesta task. Rode `npx tsc --noEmit` isolado se necessário: deve passar limpo.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/recebimento/infra/processo-detalhe-repository.ts
git commit -m "feat(processos): criarProcesso no repository + obrigatorioImportacao em CampoFormulario

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Application — Server Action `criarProcessoManual`

**Files:**
- Create: `src/modules/recebimento/application/criar-processo.ts`

**Interfaces:**
- Consumes: `getSessao` (`{ usuarioId, nome, email, perfil }`), `podeFazer(perfil, 'editar')`, `carregarCamposFormulario` (agora com `obrigatorioImportacao`), `criarProcesso` (Task 1), `converterValor(bruto, tipo)` → `{ ok: true; valor } | { ok: false; erro }`, `calcularCamposCalculados(valores, camposCalc, ctx)`, `carregarCriticidade`, `carregarTabelaNqa`, `registrarLog`, `PatchProcesso`.
- Produces: `criarProcessoManual(valores: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; erro: string }>`

- [ ] **Step 1: Criar o arquivo da Server Action**

Criar `src/modules/recebimento/application/criar-processo.ts` com:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { converterValor } from '../domain/conversao'
import { calcularCamposCalculados, type CampoCalc } from '../domain/calculos'
import {
  carregarCamposFormulario,
  criarProcesso,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'

export type ResultadoCriarProcesso = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Cria um processo manualmente a partir dos campos Comercial + Material,
 * seguindo as mesmas regras da importação: obrigatórios = `obrigatorioImportacao`,
 * calculados computados no servidor (nunca digitados). O processo nasce
 * 'aberto' com `numero` automático (ver `criarProcesso`). Gate: `editar`.
 */
export async function criarProcessoManual(
  valores: Record<string, unknown>,
): Promise<ResultadoCriarProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para criar processos.' }
  }

  const campos = await carregarCamposFormulario()
  const gruposBase = new Set(['comercial', 'material'])

  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []
  for (const campo of campos) {
    if (!gruposBase.has(campo.grupo)) continue // recebimento/qualidade: em branco
    if (campo.calculado) continue // calculado nunca vem do cliente
    const bruto = valores[campo.campo]
    const vazio = bruto === null || bruto === undefined || String(bruto).trim() === ''
    if (campo.obrigatorioImportacao && vazio) {
      return { ok: false, erro: `Campo obrigatório: ${campo.rotulo}.` }
    }
    const r = converterValor(bruto, campo.tipo)
    if (!r.ok) return { ok: false, erro: `${campo.rotulo}: ${r.erro}` }
    novosValores[campo.campo] = r.valor
    camposAlterados.push(campo.campo)
  }

  // Campos calculados (critico, atraso, divergencia, amostral) computados
  // autoritativamente no servidor a partir dos valores informados. Sem
  // valores anteriores (processo novo) → valoresAtuais: {}.
  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))
  const [fornecedoresCriticos, nqa] = await Promise.all([
    carregarCriticidade(),
    carregarTabelaNqa(),
  ])
  const calculados = calcularCamposCalculados(novosValores, camposCalculados, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
    valoresAtuais: {},
  })
  for (const [campo, valor] of Object.entries(calculados)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
  }

  let novo: { id: string; numero: number }
  try {
    novo = await criarProcesso({
      ...(novosValores as PatchProcesso),
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
    dados: { numero: novo.numero, campos: camposAlterados },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: novo.id }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Confirma que os nomes/tipos de `converterValor`, `calcularCamposCalculados`, `criarProcesso`, `registrarLog` e `PatchProcesso` batem.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/recebimento/application/criar-processo.ts
git commit -m "feat(processos): Server Action criarProcessoManual (gate editar, calculados no servidor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Extrair `CampoControle` para módulo compartilhado

Extrai o componente de renderização de campo do form de detalhe para reuso no
form de criação. Comportamento do detalhe permanece idêntico; a única mudança
de interface é o marcador de obrigatório virar prop (`obrigatorio`) em vez de
ficar preso a `obrigatorioFinalizacao` — o detalhe passa
`obrigatorioFinalizacao` e o resultado visual é o mesmo de hoje.

**Files:**
- Create: `src/app/(app)/recebimento/processos/campo-controle.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/processo-form.tsx`

**Interfaces:**
- Produces: `CampoControle` + `CampoControleProps` em `processos/campo-controle.tsx`. Props: `{ campo: CampoFormulario; valor: string; valorCalculado: string | number | null | undefined; itens: string[]; somenteLeitura: boolean; obrigatorio: boolean; onChange: (valor: string) => void }`.
- Consumes: `CampoFormulario` (Task 1).

- [ ] **Step 1: Criar o componente compartilhado**

Criar `src/app/(app)/recebimento/processos/campo-controle.tsx` com o conteúdo
extraído de `processo-form.tsx` (mesma lógica de hoje; `obrigatorioFinalizacao`
substituído pela prop `obrigatorio`):

```tsx
'use client'

import { LockIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { cn } from '@/lib/utils'

// Sentinela para "nenhum valor selecionado": o Select (base-ui) não aceita
// string vazia como value de item, então usamos um marcador único que nunca
// colide com um valor real de lista.
const SEM_VALOR = '__sem_valor__'

export interface CampoControleProps {
  campo: CampoFormulario
  valor: string
  /** Valor recalculado ao vivo (só usado quando `campo.calculado`); `undefined` se a fórmula não gerou saída. */
  valorCalculado: string | number | null | undefined
  itens: string[]
  somenteLeitura: boolean
  /** Exibe o marcador `*` ao lado do rótulo. O chamador decide o critério
   *  (detalhe: obrigatório para finalizar; criação: obrigatório na criação). */
  obrigatorio: boolean
  onChange: (valor: string) => void
}

export function CampoControle({
  campo,
  valor,
  valorCalculado,
  itens,
  somenteLeitura,
  obrigatorio,
  onChange,
}: CampoControleProps) {
  const inputId = `campo-${campo.campo}`

  if (campo.calculado) {
    return <CampoCalculadoControle campo={campo} valor={valorCalculado} />
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>
        {campo.rotulo}
        {obrigatorio && <span className="text-red-600"> *</span>}
      </Label>

      {campo.tipo === 'lista' ? (
        <Select
          value={valor === '' ? SEM_VALOR : valor}
          onValueChange={(novoValor) => onChange(novoValor === SEM_VALOR ? '' : (novoValor ?? ''))}
          disabled={somenteLeitura}
        >
          <SelectTrigger id={inputId} className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VALOR}>—</SelectItem>
            {/* Preserva o valor atual mesmo que não esteja mais entre os itens
                ativos da lista (ex.: item desativado depois de atribuído). */}
            {valor !== '' && !itens.includes(valor) && <SelectItem value={valor}>{valor}</SelectItem>}
            {itens.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={inputId}
          type={campo.tipo === 'numero' ? 'number' : campo.tipo === 'data' ? 'date' : 'text'}
          step={campo.tipo === 'numero' ? 'any' : undefined}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={somenteLeitura}
        />
      )}
    </div>
  )
}

interface CampoCalculadoControleProps {
  campo: CampoFormulario
  valor: string | number | null | undefined
}

/**
 * Renderização somente-leitura de um campo `calculado=true` (atraso,
 * divergencia, critico, amostral): nunca vira input/select editável. Fundo
 * mutado + cadeado sinalizam que o valor é automático.
 */
function CampoCalculadoControle({ campo, valor }: CampoCalculadoControleProps) {
  const inputId = `campo-${campo.campo}`
  const vazio = valor === null || valor === undefined || String(valor).trim() === ''
  const textoExibido = vazio ? '—' : String(valor)

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-center gap-1 text-muted-foreground">
        {campo.rotulo}
      </Label>
      <div
        id={inputId}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-input/30 px-2.5 py-1 text-base text-foreground md:text-sm',
          vazio && 'italic text-muted-foreground',
        )}
      >
        <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{textoExibido}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Atualizar `processo-form.tsx` para usar o componente extraído**

Em `src/app/(app)/recebimento/processos/[id]/processo-form.tsx`:

1. **Substituir o bloco de imports do topo** (linhas 1-20, do `'use client'` até o `import { cn } ...`) por:

```tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { salvarSecaoProcesso, type Secao } from '@/modules/recebimento/application/salvar-secao-processo'
import { calcularCamposCalculados, type CampoCalc, type FaixaNqa } from '@/modules/recebimento/domain/calculos'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { cn } from '@/lib/utils'
import { CampoControle } from '../campo-controle'
```

(Removidos: `LockIcon`, `Input`, `Select*` e a constante `SEM_VALOR` — agora vivem em `campo-controle.tsx`. Mantidos `Label` e `cn` porque `ResponsavelSecaoControle` ainda os usa.)

2. **Remover a constante `SEM_VALOR`** (a linha `const SEM_VALOR = '__sem_valor__'` e seu comentário) que ficava logo abaixo dos imports.

3. **Na chamada de `<CampoControle>`** (dentro do `.map` dos campos do grupo), adicionar a prop `obrigatorio`:

```tsx
                  <CampoControle
                    key={campo.campo}
                    campo={campo}
                    valor={valores[campo.campo] ?? ''}
                    valorCalculado={valoresCalculados[campo.campo]}
                    itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                    somenteLeitura={somenteLeitura}
                    obrigatorio={campo.obrigatorioFinalizacao}
                    onChange={(valor) => atualizarValor(campo.campo, valor)}
                  />
```

4. **Remover as definições locais** que foram movidas: a interface `CampoControleProps`, a função `CampoControle`, a interface `CampoCalculadoControleProps` e a função `CampoCalculadoControle` (todo o bloco a partir de `interface CampoControleProps {` até o fim do arquivo, EXCETO `ResponsavelSecaoControleProps` + `ResponsavelSecaoControle`, que PERMANECEM). Após a remoção, o arquivo deve terminar com a função `ResponsavelSecaoControle`.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros. A tela de detalhe deve compilar e continuar idêntica (o `*` aparece nos mesmos campos de antes, pois `obrigatorio={campo.obrigatorioFinalizacao}`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/recebimento/processos/campo-controle.tsx" "src/app/(app)/recebimento/processos/[id]/processo-form.tsx"
git commit -m "refactor(processos): extrai CampoControle para módulo compartilhado (reuso no cadastro)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: UI — página `/novo` + `NovoProcessoForm`

**Files:**
- Create: `src/app/(app)/recebimento/processos/novo/page.tsx`
- Create: `src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx`

**Interfaces:**
- Consumes: `criarProcessoManual` (Task 2), `CampoControle` (Task 3), `carregarCamposFormulario`, `carregarItensPorLista(chaves: string[])`, `getSessao`, `podeFazer`, `SemPermissao`, `CampoFormulario`.
- Produces: rota `/recebimento/processos/novo`.

- [ ] **Step 1: Criar o formulário cliente**

Criar `src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { criarProcessoManual } from '@/modules/recebimento/application/criar-processo'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { CampoControle } from '../campo-controle'

const GRUPOS: { chave: CampoFormulario['grupo']; rotulo: string }[] = [
  { chave: 'comercial', rotulo: 'Comercial' },
  { chave: 'material', rotulo: 'Material' },
]

/**
 * Formulário de criação manual de processo. Recebe apenas os campos editáveis
 * (não-calculados) de Comercial e Material. Os obrigatórios (`*`) seguem
 * `obrigatorioImportacao`. Ao criar, redireciona para o detalhe do novo
 * processo (que nasce 'aberto', pronto para conferência).
 */
export function NovoProcessoForm({
  campos,
  itensPorLista,
}: {
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
}) {
  const router = useRouter()
  const [valores, setValores] = useState<Record<string, string>>({})
  const [salvando, startTransition] = useTransition()

  function atualizarValor(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }

  // Números vão como number (input type="number", ponto decimal) para não
  // passar pelo parser BR de `converterValor` (vírgula decimal, pensado para
  // planilha). Demais tipos vão como string e o servidor converte/valida.
  function montarPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    for (const campo of campos) {
      const bruto = valores[campo.campo] ?? ''
      payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
    }
    return payload
  }

  function onCriar() {
    startTransition(async () => {
      const r = await criarProcessoManual(montarPayload())
      if (r.ok) {
        toast.success('Processo criado.')
        router.push(`/recebimento/processos/${r.id}`)
      } else {
        toast.error(r.erro)
      }
    })
  }

  const gruposComCampos = GRUPOS.map((grupo) => ({
    ...grupo,
    campos: campos.filter((campo) => campo.grupo === grupo.chave).sort((a, b) => a.ordem - b.ordem),
  })).filter((grupo) => grupo.campos.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {gruposComCampos.map((grupo) => (
        <Card key={grupo.chave}>
          <CardHeader>
            <CardTitle>{grupo.rotulo}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.campos.map((campo) => (
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
      ))}

      <div>
        <Button onClick={onCriar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
          {salvando ? 'Criando…' : 'Criar processo'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar a página server (gate + carregamento)**

Criar `src/app/(app)/recebimento/processos/novo/page.tsx`:

```tsx
import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { carregarCamposFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { carregarItensPorLista } from '@/modules/recebimento/infra/campo-comercial-repository'
import { NovoProcessoForm } from './novo-processo-form'

export default async function NovoProcessoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return <SemPermissao descricao="Você não tem permissão para criar processos." />
  }

  const todos = await carregarCamposFormulario()
  const campos = todos.filter(
    (campo) => (campo.grupo === 'comercial' || campo.grupo === 'material') && !campo.calculado,
  )
  const chaves = [
    ...new Set(
      campos
        .filter((campo) => campo.tipo === 'lista' && campo.listaChave)
        .map((campo) => campo.listaChave as string),
    ),
  ]
  const itensPorLista = await carregarItensPorLista(chaves)

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recebimento/processos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-enterplak hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar para Processos
      </Link>
      <h1 className="text-2xl font-semibold">Novo processo</h1>
      <NovoProcessoForm campos={campos} itensPorLista={itensPorLista} />
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; a rota `/recebimento/processos/novo` aparece no output do build.

- [ ] **Step 4: Smoke manual (anotar resultado)**

Run: `npm run dev` e, autenticado com um perfil que tem `editar`, acessar
`/recebimento/processos/novo`. Verificar:
- A página mostra os cards Comercial e Material com os campos (sem os calculados).
- Tentar criar sem um obrigatório → toast "Campo obrigatório: <rótulo>.".
- Preencher os obrigatórios e criar → redireciona para `/recebimento/processos/<id>`, processo em "Aberto", com `numero` novo e campos calculados preenchidos.

(Se não for possível rodar autenticado agora, registrar como pendente para o smoke final da branch — não bloqueia o commit.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/recebimento/processos/novo/page.tsx" "src/app/(app)/recebimento/processos/novo/novo-processo-form.tsx"
git commit -m "feat(processos): página /novo de cadastro manual de processo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Botão "Adicionar processo" na lista

**Files:**
- Modify: `src/app/(app)/recebimento/processos/page.tsx`

**Interfaces:**
- Consumes: `getSessao`, `podeFazer`, rota `/recebimento/processos/novo` (Task 4). `Button` aceita a prop `render` (base-ui) — mesmo padrão de `navegacao-processo.tsx`.

- [ ] **Step 1: Adicionar o cabeçalho com o botão (gate `editar`)**

Substituir todo o conteúdo de `src/app/(app)/recebimento/processos/page.tsx` por:

```tsx
import Link from 'next/link'
import { PlusIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { Button } from '@/components/ui/button'
import { listarValoresStatus } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { listarMesesProcessos } from '@/modules/recebimento/infra/processo-repository'
import { ProcessosFiltros } from './processos-filtros'
import { ProcessosPorMes } from './processos-por-mes'

interface ProcessosPageProps {
  searchParams: Promise<{ busca?: string; status?: string }>
}

export default async function ProcessosPage({ searchParams }: ProcessosPageProps) {
  const sp = await searchParams
  const filtros = { busca: sp.busca || undefined, status: sp.status || undefined }
  const [grupos, statusOpcoes, sessao] = await Promise.all([
    listarMesesProcessos(filtros),
    listarValoresStatus(),
    getSessao(),
  ])
  const podeCriar = podeFazer(sessao?.perfil ?? null, 'editar')

  // Abrem por padrão: "Aguardando chegada" (se existir) + o mês mais recente.
  const abertosInicial: string[] = []
  if (grupos.some((g) => g.chave === 'sem_data')) abertosInicial.push('sem_data')
  const primeiroMes = grupos.find((g) => g.chave !== 'sem_data')
  if (primeiroMes) abertosInicial.push(primeiroMes.chave)

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
      <ProcessosFiltros statusOpcoes={statusOpcoes} />
      <ProcessosPorMes
        key={`${filtros.busca ?? ''}|${filtros.status ?? ''}`}
        grupos={grupos}
        filtros={filtros}
        abertosInicial={abertosInicial}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros. (Confirma que `podeFazer` aceita `perfil | null` — já é o caso: a página de detalhe usa `podeFazer(sessao?.perfil ?? null, 'editar')`.)

- [ ] **Step 3: Smoke manual (anotar resultado)**

Autenticado com `editar`: a lista de Processos mostra o botão "Adicionar
processo" no topo, que leva a `/novo`. Com um perfil sem `editar` (ex.: só
`visualizar`), o botão não aparece.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/recebimento/processos/page.tsx"
git commit -m "feat(processos): botão Adicionar processo na lista (gate editar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final da branch

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde. `npm run test` (vitest) confirma que a extração do
`CampoControle` e as mudanças no repository não quebraram os testes de
domínio existentes (`agrupamento-mes.test.ts`, `ler-planilha.test.ts`, etc.).

- [ ] **Step 2: Smoke fim-a-fim (anotar resultado)**

Fluxo completo autenticado com `editar`:
1. Lista de Processos → "Adicionar processo".
2. `/novo`: preencher obrigatórios (Comercial+Material) e criar.
3. Cair no detalhe do novo processo em "Aberto", `numero` novo, calculados
   preenchidos, seções Recebimento/Qualidade em branco.
4. Confirmar no log (Ajuda/Logs, se acessível) uma entrada `acao: 'criar'`
   "Processo #<n> criado manualmente".

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Botão na lista (gate `editar`) → Task 5. ✅
- Página `/novo` dedicada → Task 4. ✅
- Campos Comercial+Material, obrigatórios = `obrigatorio_importacao` → Task 1 (expõe o campo) + Task 2 (valida) + Task 4 (marca `*`). ✅
- `criarProcesso` (INSERT sem numero/status, whitelist + criado_por) → Task 1. ✅
- Server Action espelhando `salvarSecaoProcesso` (gate, converter, calculados, log `'criar'`, revalidate) → Task 2. ✅
- Redireciona para o detalhe → Task 4 (form). ✅
- Reuso via extração de `CampoControle` → Task 3. ✅
- Sem migração → Global Constraints. ✅

**Consistência de tipos:** `criarProcesso(patch: PatchProcesso & { criado_por: string }): Promise<{ id: string; numero: number }>` (Task 1) é consumida em Task 2 com esse mesmo shape; `criarProcessoManual(valores): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` (Task 2) é consumida em Task 4 (`r.ok`, `r.id`, `r.erro`); `CampoControleProps` com `obrigatorio: boolean` (Task 3) é consumida em Task 3 (detalhe) e Task 4 (criação). `CampoFormulario.obrigatorioImportacao` (Task 1) usada em Task 2 e Task 4. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
