# ShopFloor Lançamento — Plano B: Cadastro de OP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tela de CRUD de Ordens de Produção (PCP/admin) — listar, criar, editar e excluir OPs, incluindo os toggles de "quais postos aplicam" — no design do app, sobre as tabelas `sf_*` do Plano A, dentro de uma **seção de menu própria "Processo"** (módulo principal, como o Recebimento).

**Architecture:** Novo módulo top-level em `src/app/(app)/shopfloor/` (rota `/shopfloor/ordens`), com seção própria no menu lateral (accordion, espelhando o de Recebimento). Page Server Component (com guard próprio de `administrar`) + form client via Dialog + `useActionState`; repositório em `infra/`; Server Actions em `application/`. A aplicabilidade (`sf_ordem_postos`) é ressincronizada a cada save.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19 (`useActionState`), Supabase/RLS, TypeScript strict, Vitest, componentes `@/components/ui/*`.

## Global Constraints

- **Branch:** `feat/shopfloor-lancamento` (a mesma dos Planos A; continua nela).
- **Módulo principal, NÃO Configurações:** o ShopFloor Processo é uma seção própria no menu (accordion "Processo"), igual ao Recebimento. A tela de Lançamento (operador) entra nessa mesma seção no Plano C.
- Permissão: **`administrar`** para o Cadastro de OP. Como a rota NÃO está sob `/configuracoes` (que tem guard de layout), **a própria page se guarda**: `getSessao()` → se `!podeFazer(perfil,'administrar')` → `return <SemPermissao descricao="..." />` (padrão de `recebimento/importar/page.tsx`).
- Aplicabilidade: toggles para **todos os postos exceto `Manutenção`** (Manutenção é caminho de reparo, não aplicabilidade de OP — coerente com o script de migração do Plano A).
- Status da OP: `Select` com **Ativa** (armazena `'ATIVA'`) e **Finalizada** (`'FINALIZADA'`). Filtro de "ativa" é `status ≠ 'FINALIZADA'` — OPs migradas com status vazio continuam ativas.
- Padrões fixos das Server Actions: `getSessao()` → `podeFazer(perfil,'administrar')` → validação de domínio → repositório em `try/catch` (nunca vazar erro cru) → `registrarLog(...)` → `revalidatePath('/shopfloor/ordens')` → retorno `{ ok: true, id? } | { ok: false, erro }`.
- Repositórios: `import 'server-only'` no topo; `createServerSupabase()` (RLS do usuário); `throw error` (quem trata é a action).
- TS strict `noUncheckedIndexedAccess`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure

- Create: `src/modules/shopfloor/domain/validar-ordem.ts` + `__tests__/validar-ordem.test.ts`
- Create: `src/modules/shopfloor/infra/ordem-repository.ts`
- Create: `src/modules/shopfloor/application/ordens-actions.ts`
- Create: `src/app/(app)/shopfloor/ordens/page.tsx`
- Create: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Create: `src/app/(app)/shopfloor/ordens/excluir-ordem-botao.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (nova seção "Processo" no menu)

---

### Task 1: Domínio `validar-ordem` (TDD)

**Files:**
- Create: `src/modules/shopfloor/domain/validar-ordem.ts`
- Create: `src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts`

**Interfaces:**
- Produces: `validarOrdem(d: { pmo: string; op: string; cliente: string; snIni: string; snFim: string }): { ok: true } | { ok: false; erro: string }`.

- [ ] **Step 1: Teste (falha)**

`src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarOrdem } from '../validar-ordem'

const base = { pmo: 'PMOF1', op: '100', cliente: 'Empresa 1', snIni: '', snFim: '' }

describe('validarOrdem', () => {
  it('aceita OP mínima (pmo, op, cliente)', () => {
    expect(validarOrdem(base).ok).toBe(true)
  })
  it('exige pmo, op e cliente', () => {
    expect(validarOrdem({ ...base, pmo: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, op: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, cliente: '  ' }).ok).toBe(false)
  })
  it('faixa de SN: início e fim juntos ou ambos vazios', () => {
    expect(validarOrdem({ ...base, snIni: '100', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '', snFim: '200' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '100', snFim: '200' }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar (FALHA)** — `npm run test -- shopfloor/domain/__tests__/validar-ordem` → FAIL.

- [ ] **Step 3: Implementar**

`src/modules/shopfloor/domain/validar-ordem.ts`:

```ts
export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
}

/** Validação de cadastro de OP. A faixa de SN é opcional, mas se preenchida exige os dois limites. */
export function validarOrdem(d: DadosOrdemValidacao): { ok: true } | { ok: false; erro: string } {
  if (d.pmo.trim() === '') return { ok: false, erro: 'Informe o PMO.' }
  if (d.op.trim() === '') return { ok: false, erro: 'Informe o número da OP.' }
  if (d.cliente.trim() === '') return { ok: false, erro: 'Informe o cliente.' }
  const temIni = d.snIni.trim() !== ''
  const temFim = d.snFim.trim() !== ''
  if (temIni !== temFim) {
    return { ok: false, erro: 'Preencha o início e o fim da faixa de SN, ou deixe ambos vazios.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar (PASSA)** — `npm run test -- shopfloor/domain/__tests__/validar-ordem` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/validar-ordem.ts src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts
git commit -F - << 'EOF'
feat(shopfloor): validação de cadastro de OP (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Repositório `ordem-repository`

**Files:**
- Create: `src/modules/shopfloor/infra/ordem-repository.ts`

**Interfaces:**
- Consumes: `createServerSupabase` de `@/shared/lib/supabase/server`.
- Produces:
  - `interface PostoRow { chave: string; ordem: number }`
  - `interface OrdemRow { id; pmo; op; cliente; qtd: number|null; descricao; acp; status; sn_ini; sn_fim; sf_ordem_postos: { posto: string }[] }`
  - `interface DadosOrdem { pmo; op; cliente; qtd: number|null; descricao; acp; status; sn_ini; sn_fim }` (todos string exceto qtd)
  - `listarPostos()`, `listarOrdens()`, `criarOrdem(dados, postos: string[]): Promise<string>`, `atualizarOrdem(id, dados, postos: string[]): Promise<void>`, `excluirOrdem(id): Promise<void>`, `contarRegistros(pmo, op): Promise<number>`, `buscarOrdemBase(id): Promise<{ pmo: string; op: string } | null>`.

- [ ] **Step 1: Implementar o repositório**

`src/modules/shopfloor/infra/ordem-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PostoRow {
  chave: string
  ordem: number
}

export interface OrdemRow {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
  sf_ordem_postos: { posto: string }[]
}

export interface DadosOrdem {
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
}

export async function listarPostos(): Promise<PostoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_postos').select('chave,ordem').order('ordem')
  if (error) throw error
  return data as PostoRow[]
}

export async function listarOrdens(): Promise<OrdemRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,sf_ordem_postos(posto)')
    .order('pmo')
    .order('op')
  if (error) throw error
  return data as unknown as OrdemRow[]
}

/** Insere a OP e a aplicabilidade; devolve o id. */
export async function criarOrdem(dados: DadosOrdem, postos: string[]): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').insert(dados).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (postos.length > 0) {
    const { error: e2 } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto) => ({ ordem_id: id, posto })))
    if (e2) throw e2
  }
  return id
}

/** Atualiza a OP e RESSINCRONIZA a aplicabilidade (apaga e reinsere). */
export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_ordens')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  const { error: eDel } = await supabase.from('sf_ordem_postos').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (postos.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto) => ({ ordem_id: id, posto })))
    if (eIns) throw eIns
  }
}

export async function excluirOrdem(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_ordens').delete().eq('id', id)
  if (error) throw error
}

/** Quantos registros de lançamento existem para a OP (guarda de exclusão). */
export async function contarRegistros(pmo: string, op: string): Promise<number> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('sf_registros')
    .select('*', { count: 'exact', head: true })
    .eq('pmo', pmo)
    .eq('op', op)
  if (error) throw error
  return count ?? 0
}

export async function buscarOrdemBase(id: string): Promise<{ pmo: string; op: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('pmo,op').eq('id', id).single()
  if (error) return null
  return data as { pmo: string; op: string }
}
```

- [ ] **Step 2: Compila** — `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/ordem-repository.ts
git commit -F - << 'EOF'
feat(shopfloor): repositório de ordens de produção (CRUD + aplicabilidade)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Server Actions `ordens-actions`

**Files:**
- Create: `src/modules/shopfloor/application/ordens-actions.ts`

**Interfaces:**
- Consumes: `validarOrdem` (Task 1); `criarOrdem`, `atualizarOrdem`, `excluirOrdem`, `contarRegistros`, `buscarOrdemBase`, `listarPostos`, `DadosOrdem` (Task 2); `getSessao`, `podeFazer`, `registrarLog`.
- Produces:
  - `type ResultadoOrdem = { ok: true; id?: string } | { ok: false; erro: string }`
  - `criarOrdemAction(prev, formData)`, `editarOrdemAction(prev, formData)`, `excluirOrdemAction(id: string)`.

- [ ] **Step 1: Implementar as actions**

`src/modules/shopfloor/application/ordens-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarOrdem } from '../domain/validar-ordem'
import {
  criarOrdem,
  atualizarOrdem,
  excluirOrdem,
  contarRegistros,
  buscarOrdemBase,
  listarPostos,
  type DadosOrdem,
} from '../infra/ordem-repository'

export type ResultadoOrdem = { ok: true; id?: string } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar ordens de produção.'

function lerDados(fd: FormData): DadosOrdem {
  const qtdBruto = String(fd.get('qtd') ?? '').trim()
  return {
    pmo: String(fd.get('pmo') ?? '').trim(),
    op: String(fd.get('op') ?? '').trim(),
    cliente: String(fd.get('cliente') ?? '').trim(),
    qtd: qtdBruto === '' ? null : Number(qtdBruto),
    descricao: String(fd.get('descricao') ?? '').trim(),
    acp: String(fd.get('acp') ?? '').trim(),
    status: String(fd.get('status') ?? '').trim() || 'ATIVA',
    sn_ini: String(fd.get('sn_ini') ?? '').trim(),
    sn_fim: String(fd.get('sn_fim') ?? '').trim(),
  }
}

/** Postos marcados no form (`posto_<chave>` = 'on'), restritos ao catálogo real. */
async function lerPostos(fd: FormData): Promise<string[]> {
  const postos = await listarPostos()
  return postos.map((p) => p.chave).filter((chave) => fd.get(`posto_${chave}`) === 'on')
}

function ehDuplicidade(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

export async function criarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const dados = lerDados(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim })
  if (!v.ok) return v
  const postos = await lerPostos(formData)

  let id: string
  try {
    id = await criarOrdem(dados, postos)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível criar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${dados.pmo}/${dados.op} criada`, dados })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id }
}

export async function editarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const id = String(formData.get('id') ?? '').trim()
  if (id === '') return { ok: false, erro: 'OP inválida.' }
  const dados = lerDados(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim })
  if (!v.ok) return v
  const postos = await lerPostos(formData)

  try {
    await atualizarOrdem(id, dados, postos)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível salvar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada`, dados })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id }
}

export async function excluirOrdemAction(id: string): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const base = await buscarOrdemBase(id)
  if (!base) return { ok: false, erro: 'OP não encontrada.' }
  const registros = await contarRegistros(base.pmo, base.op)
  if (registros > 0) {
    return { ok: false, erro: `Não é possível excluir: a OP já tem ${registros} lançamento(s).` }
  }

  try {
    await excluirOrdem(id)
  } catch {
    return { ok: false, erro: 'Não foi possível excluir a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'excluir', descricao: `OP ${base.pmo}/${base.op} excluída` })
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}
```

- [ ] **Step 2: Compila** — `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/application/ordens-actions.ts
git commit -F - << 'EOF'
feat(shopfloor): server actions de ordens (criar/editar/excluir com guarda)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Tela de Cadastro (page + form + excluir) + seção "Processo" no menu

**Files:**
- Create: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Create: `src/app/(app)/shopfloor/ordens/excluir-ordem-botao.tsx`
- Create: `src/app/(app)/shopfloor/ordens/page.tsx`
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: `criarOrdemAction`, `editarOrdemAction`, `excluirOrdemAction`, `ResultadoOrdem` (Task 3); `listarOrdens`, `listarPostos` (Task 2); `getSessao`, `podeFazer`, `SemPermissao`.
- Produces: `OrdemView` (tipo exportado do form, usado pela page).

- [ ] **Step 1: `ordem-form.tsx` (client — Dialog criar/editar)**

`src/app/(app)/shopfloor/ordens/ordem-form.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  criarOrdemAction,
  editarOrdemAction,
  type ResultadoOrdem,
} from '@/modules/shopfloor/application/ordens-actions'

export interface OrdemView {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

export function OrdemForm({ postos, ordem }: { postos: string[]; ordem?: OrdemView }) {
  const ehEdicao = ordem !== undefined
  const action = ehEdicao ? editarOrdemAction : criarOrdemAction
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ResultadoOrdem | undefined, FormData>(action, undefined)

  // Fecha o dialog quando a action retorna ok (ajuste durante a render, sem useEffect).
  const [processado, setProcessado] = useState(state)
  if (state !== processado) {
    setProcessado(state)
    if (state?.ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          ehEdicao ? (
            <Button variant="ghost" size="icon-sm" aria-label="Editar OP">
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button className="bg-enterplak hover:bg-enterplak-700">
              <Plus className="size-4" /> Nova OP
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ehEdicao ? 'Editar OP' : 'Nova OP'}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {ehEdicao && <input type="hidden" name="id" value={ordem.id} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pmo">PMO *</Label>
              <Input id="pmo" name="pmo" defaultValue={ordem?.pmo ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op">Nº OP *</Label>
              <Input id="op" name="op" defaultValue={ordem?.op ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliente">Cliente *</Label>
              <Input id="cliente" name="cliente" defaultValue={ordem?.cliente ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" name="qtd" type="number" defaultValue={ordem?.qtd ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" name="descricao" defaultValue={ordem?.descricao ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acp">ACP</Label>
              <Input id="acp" name="acp" defaultValue={ordem?.acp ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={ordem?.status?.toUpperCase() === 'FINALIZADA' ? 'FINALIZADA' : 'ATIVA'}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ATIVA">Ativa</SelectItem>
                  <SelectItem value="FINALIZADA">Finalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_ini">SN inicial</Label>
              <Input id="sn_ini" name="sn_ini" defaultValue={ordem?.sn_ini ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_fim">SN final</Label>
              <Input id="sn_fim" name="sn_fim" defaultValue={ordem?.sn_fim ?? ''} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Postos aplicáveis</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {postos.map((posto) => (
                <label
                  key={posto}
                  htmlFor={`posto_${posto}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                >
                  {posto}
                  <Switch id={`posto_${posto}`} name={`posto_${posto}`} defaultChecked={ordem?.postos.includes(posto) ?? false} />
                </label>
              ))}
            </div>
          </div>

          {state && !state.ok && <p className="text-sm text-red-600">{state.erro}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `excluir-ordem-botao.tsx` (client)**

`src/app/(app)/shopfloor/ordens/excluir-ordem-botao.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { excluirOrdemAction } from '@/modules/shopfloor/application/ordens-actions'

export function ExcluirOrdemBotao({ id, rotulo }: { id: string; rotulo: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onExcluir() {
    startTransition(async () => {
      const r = await excluirOrdemAction(id)
      if (r.ok) {
        toast.success('OP excluída.')
        setOpen(false)
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Excluir OP ${rotulo}`}>
            <Trash2 className="size-4 text-red-600" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir OP {rotulo}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancelar</Button>} />
          <Button variant="destructive" disabled={pending} onClick={onExcluir}>
            {pending ? 'Excluindo…' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: `page.tsx` (Server Component, com guard próprio de `administrar`)**

`src/app/(app)/shopfloor/ordens/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listarOrdens, listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { OrdemForm, type OrdemView } from './ordem-form'
import { ExcluirOrdemBotao } from './excluir-ordem-botao'

export default async function OrdensPage() {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar ordens de produção." />
  }

  const [ordens, postos] = await Promise.all([listarOrdens(), listarPostos()])
  const chavesPostos = postos.map((p) => p.chave).filter((c) => c !== 'Manutenção')
  const views: OrdemView[] = ordens.map((o) => ({
    id: o.id,
    pmo: o.pmo,
    op: o.op,
    cliente: o.cliente,
    qtd: o.qtd,
    descricao: o.descricao,
    acp: o.acp,
    status: o.status,
    sn_ini: o.sn_ini,
    sn_fim: o.sn_fim,
    postos: o.sf_ordem_postos.map((x) => x.posto),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-tinta">Ordens de Produção</h2>
          <p className="text-sm text-muted-foreground">{views.length} OP(s) cadastrada(s)</p>
        </div>
        <OrdemForm postos={chavesPostos} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PMO</TableHead>
              <TableHead>OP</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Faixa SN</TableHead>
              <TableHead className="text-center">Postos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {views.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.pmo}</TableCell>
                <TableCell>{o.op}</TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell className="max-w-[240px] truncate">{o.descricao || '—'}</TableCell>
                <TableCell>{o.status.toUpperCase() === 'FINALIZADA' ? 'Finalizada' : 'Ativa'}</TableCell>
                <TableCell>{o.sn_ini && o.sn_fim ? `${o.sn_ini}–${o.sn_fim}` : '—'}</TableCell>
                <TableCell className="text-center">{o.postos.length}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <OrdemForm postos={chavesPostos} ordem={o} />
                    <ExcluirOrdemBotao id={o.id} rotulo={`${o.pmo}/${o.op}`} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {views.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma OP cadastrada ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Nova seção "Processo" no menu (`app-shell.tsx`)**

Em `src/shared/ui/app-shell.tsx`, fazer QUATRO edições (espelhando a seção `RECEBIMENTO`):

(a) **Imports** — adicionar dois ícones à lista de `lucide-react` (ex.: após `Inbox,`):

```ts
  Inbox,
  Factory,
  FileStack,
```

(b) **Declaração do grupo** — logo após o array `RECEBIMENTO` (antes de `const CONFIG_PERM`):

```ts
const SHOPFLOOR: Folha[] = [
  { chave: 'op-ordens', rotulo: 'Ordens de Produção', href: '/shopfloor/ordens', icone: FileStack, perm: 'administrar' },
]
```

(c) **Estado/derivados** — dentro do componente `AppShell`, logo após a linha `const recebimentoVisivel = ...` (e o `useState` de `recAberto`), adicionar:

```ts
  const shopfloorVisivel = SHOPFLOOR.filter((i) => pode(i.perm))
  const shopfloorAtivo = pathname.startsWith('/shopfloor')
  const [shopfloorAberto, setShopfloorAberto] = useState(shopfloorAtivo)
```

E incluir `...SHOPFLOOR` na lista do `tituloPagina`:

```ts
  const tituloPagina =
    [HOME, ...RECEBIMENTO, ...SHOPFLOOR, ...CONFIG_TODOS, AJUDA]
      .filter((i) => ehAtivo(pathname, i.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.rotulo ?? 'ShopFloor'
```

(d) **Render** — no `<nav>`, logo APÓS o bloco `{recebimentoVisivel.length > 0 && (...)}` e ANTES do bloco `{temConfig && (...)}`, inserir:

```tsx
        {shopfloorVisivel.length > 0 && (
          <>
            {rotuloGrupo('Processo')}
            <button
              type="button"
              onClick={() => setShopfloorAberto((v) => !v)}
              className={cn(linkClasse(false), 'w-full justify-between')}
            >
              <span className="flex items-center gap-3">
                <Factory className="size-[18px] shrink-0" />
                Processo
              </span>
              <ChevronDown className={cn('size-4 transition-transform', shopfloorAberto && 'rotate-180')} />
            </button>
            {shopfloorAberto && (
              <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
                {shopfloorVisivel.map((i) => (
                  <Link key={i.chave} href={i.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, i.href))}>
                    <i.icone className="size-[18px] shrink-0" />
                    {i.rotulo}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
```

- [ ] **Step 5: Compila** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/shopfloor/ src/shared/ui/app-shell.tsx
git commit -F - << 'EOF'
feat(shopfloor): módulo Processo — tela de Cadastro de OP + seção no menu

Nova seção "Processo" no menu (módulo principal, como Recebimento) com o Cadastro
de OP (lista/criar/editar/excluir + toggles de postos aplicáveis). Page com guard
próprio de administrar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final + review amplo + smoke (controller)

**Files:** nenhum.

- [ ] **Step 1: Suíte** — `npx tsc --noEmit && npm run lint && npm run test` → tudo verde (só o warning `<img>` pré-existente).

- [ ] **Step 2 (CONTROLLER): review amplo do branch** (subagent-driven-development → final code review, opus).

- [ ] **Step 3 (CONTROLLER): smoke no Dev** — `npm run dev`, logar como admin, ver a seção **Processo → Ordens de Produção** no menu:
  - listar (deve mostrar as 115 OPs migradas);
  - criar uma OP nova (PMO/OP/cliente + faixa de SN + alguns postos) → aparece na lista;
  - editar a OP (mudar postos aplicáveis) → persiste;
  - tentar criar OP com PMO/OP duplicado → erro claro;
  - excluir a OP nova (sem registros) → some; (deixar as migradas intactas).

- [ ] **Step 4: NÃO push** — commits ficam locais; o usuário valida o smoke.

---

## Notas de verificação (self-review)

- **Cobertura da spec (Cadastro de OP):** listar/criar/editar/excluir (T2/T3/T4) ✅; toggles de postos aplicáveis (T4, ressincronizados em T2) ✅; restrito a admin (guard próprio da page + gate `administrar` nas actions) ✅; **módulo principal no menu** (seção "Processo", T4) ✅; validação (T1, TDD) ✅.
- **Desvio consciente da spec:** a spec dizia `/configuracoes/ordens`; a pedido do usuário virou **módulo principal** `/shopfloor/ordens` (seção própria no menu, como Recebimento). O Lançamento (Plano C) entra na mesma seção "Processo".
- **Tipos:** `DadosOrdem` (repo) e `OrdemView` (form) consistentes entre page/form/action; `ResultadoOrdem` idêntico em action e form.
- **Sem placeholders:** todo passo traz o código completo; as 4 edições do `app-shell` têm âncora e código exatos.
- **`noUncheckedIndexedAccess`:** acessos por `.map`/propriedade, sem índice numérico cru.
- **Duplicidade:** tratada via código `23505` (constraint `unique(pmo,op)` do Plano A).
- **Exclusão segura:** bloqueada se houver registros (guarda para o Plano C).
- **Fora deste plano (Plano C):** a tela de Lançamento (operador) na seção "Processo", a action de submit transacional e a permissão `lancar` na UI de Perfis.
