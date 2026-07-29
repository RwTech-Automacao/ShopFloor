# Cadastro de Defeitos (catálogo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela admin em Configurações › ShopFloor › Defeitos para listar, cadastrar e excluir defeitos do catálogo (`sf_defeitos`), sem migração.

**Architecture:** Camadas do módulo ShopFloor (`domain` puro → `infra` (Supabase) → `application` (Server Actions com guard) → UI em `app/(app)/configuracoes/sf-defeitos`) + um accordion "Ajustes ShopFloor" no `app-shell.tsx`. Espelha as telas de Configurações do Recebimento (criticidade) na UI/actions e o `ordens/page.tsx` no guard-por-página.

**Tech Stack:** Next.js 16 (App Router, Server Actions, `useActionState`), React 19, TypeScript strict, Supabase (`sf_defeitos` já existe com RLS admin), Vitest 4, Tailwind v4, componentes em `@/components/ui/*`.

## Global Constraints

- **Zero migração.** A tabela `public.sf_defeitos` (`codigo text PK`, `tipo smallint` 1=peça/2=teste, `created_at`) e a RLS por módulo (`select`=`shopfloor.visualizar`, escrita=`shopfloor.administrar`) **já existem**. Não criar/alterar SQL.
- **Permissão:** tudo exige `shopfloor.administrar`. Guard na **página** (`getSessao` + `podeNoModulo` + `SemPermissao`, padrão `ordens/page.tsx`), na **action** (mesmo guard), e a **RLS** de backstop.
- **Código normalizado:** `trim` + colapso de espaços internos + **UPPERCASE**. É a PK; duplicado → erro amigável `'Esse defeito já existe.'`.
- **Tipo:** apenas `1` (peça) ou `2` (teste).
- **Estado das actions:** `type ResultadoAcaoDefeito = { ok: true } | { erro: string }` (mesma forma da criticidade; sem `ok:false`).
- **Copy em PT-BR.** Botão primário usa `className="bg-enterplak hover:bg-enterplak-700"`.
- **Rota:** `/configuracoes/sf-defeitos`. Label do accordion: **"Ajustes ShopFloor"** (espelha "Ajustes Recebimento").
- Rodar o build com `NODE_OPTIONS="--max-old-space-size=4096" npm run build` quando precisar validar build.

---

### Task 1: Domínio — normalização + validação

**Files:**
- Create: `src/modules/shopfloor/domain/defeito.ts`
- Test: `src/modules/shopfloor/domain/__tests__/defeito.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type TipoDefeito = 1 | 2`
  - `interface Defeito { codigo: string; tipo: TipoDefeito }`
  - `function normalizarCodigoDefeito(bruto: string): string`
  - `function validarDefeito(entrada: { codigo: string; tipo: number }): { ok: true; valor: Defeito } | { ok: false; erro: string }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/modules/shopfloor/domain/__tests__/defeito.test.ts
import { describe, it, expect } from 'vitest'
import { normalizarCodigoDefeito, validarDefeito } from '../defeito'

describe('normalizarCodigoDefeito', () => {
  it('faz trim, colapsa espaços internos e força maiúsculas', () => {
    expect(normalizarCodigoDefeito('  1002   trilha rompida  ')).toBe('1002 TRILHA ROMPIDA')
  })
  it('string vazia/só espaços vira vazio', () => {
    expect(normalizarCodigoDefeito('   ')).toBe('')
  })
})

describe('validarDefeito', () => {
  it('aceita código válido + tipo peça, devolvendo o código normalizado', () => {
    const r = validarDefeito({ codigo: ' 1010 solda fria ', tipo: 1 })
    expect(r).toEqual({ ok: true, valor: { codigo: '1010 SOLDA FRIA', tipo: 1 } })
  })
  it('aceita tipo teste (2)', () => {
    const r = validarDefeito({ codigo: '2001 falha', tipo: 2 })
    expect(r.ok && r.valor.tipo).toBe(2)
  })
  it('rejeita código vazio', () => {
    expect(validarDefeito({ codigo: '   ', tipo: 1 })).toEqual({
      ok: false,
      erro: 'Informe o código do defeito.',
    })
  })
  it('rejeita tipo fora de {1,2}', () => {
    expect(validarDefeito({ codigo: '1010 x', tipo: 0 })).toEqual({
      ok: false,
      erro: 'Selecione o tipo (peça ou teste).',
    })
    expect(validarDefeito({ codigo: '1010 x', tipo: 3 }).ok).toBe(false)
    expect(validarDefeito({ codigo: '1010 x', tipo: Number.NaN }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/defeito.test.ts`
Expected: FAIL (módulo `../defeito` não existe).

- [ ] **Step 3: Implementar o domínio**

```ts
// src/modules/shopfloor/domain/defeito.ts
export type TipoDefeito = 1 | 2

export interface Defeito {
  codigo: string
  tipo: TipoDefeito
}

/** trim + colapsa espaços internos + MAIÚSCULAS (fiel ao catálogo legado). */
export function normalizarCodigoDefeito(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function validarDefeito(
  entrada: { codigo: string; tipo: number },
): { ok: true; valor: Defeito } | { ok: false; erro: string } {
  const codigo = normalizarCodigoDefeito(entrada.codigo)
  if (codigo === '') return { ok: false, erro: 'Informe o código do defeito.' }
  if (entrada.tipo !== 1 && entrada.tipo !== 2) {
    return { ok: false, erro: 'Selecione o tipo (peça ou teste).' }
  }
  return { ok: true, valor: { codigo, tipo: entrada.tipo } }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/defeito.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/defeito.ts src/modules/shopfloor/domain/__tests__/defeito.test.ts
git commit -m "feat(shopfloor): domínio de Defeito (normalizar + validar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Infra — repositório do catálogo

**Files:**
- Create: `src/modules/shopfloor/infra/defeitos-repository.ts`

**Interfaces:**
- Consumes: `Defeito`, `TipoDefeito` de `../domain/defeito`; `createServerSupabase` de `@/shared/lib/supabase/server`.
- Produces:
  - `function listarDefeitos(): Promise<Defeito[]>`
  - `function inserirDefeito(d: Defeito): Promise<{ ok: true } | { ok: false; erro: string }>`
  - `function excluirDefeito(codigo: string): Promise<void>`

**Nota:** já existe um `listarDefeitos()` em `infra/lancamento-repository.ts` (retorna `{codigo, tipo:number}[]`, consumido pelo Lançamento). **Não mexer nele** — este novo repo é o do catálogo (retorna `Defeito[]` com `tipo` estreitado a `1|2`); a coexistência é intencional (call sites e tipos diferentes).

- [ ] **Step 1: Implementar o repositório**

```ts
// src/modules/shopfloor/infra/defeitos-repository.ts
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { Defeito, TipoDefeito } from '../domain/defeito'

export async function listarDefeitos(): Promise<Defeito[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_defeitos').select('codigo,tipo').order('codigo')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as { codigo: string; tipo: number }
    return { codigo: row.codigo, tipo: (row.tipo === 2 ? 2 : 1) as TipoDefeito }
  })
}

export async function inserirDefeito(
  d: Defeito,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_defeitos').insert({ codigo: d.codigo, tipo: d.tipo })
  if (error) {
    // 23505 = unique_violation (a PK codigo já existe).
    if (error.code === '23505') return { ok: false, erro: 'Esse defeito já existe.' }
    throw error
  }
  return { ok: true }
}

export async function excluirDefeito(codigo: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_defeitos').delete().eq('codigo', codigo)
  if (error) throw error
}
```

- [ ] **Step 2: Verificar tipos/build**

Run: `npx tsc --noEmit -p tsconfig.json` (ou `NODE_OPTIONS="--max-old-space-size=4096" npm run build` se preferir)
Expected: sem erros no arquivo novo.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/infra/defeitos-repository.ts
git commit -m "feat(shopfloor): repo do catálogo de defeitos (listar/inserir/excluir)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Application — Server Actions com guard + log

**Files:**
- Create: `src/modules/shopfloor/application/defeitos-actions.ts`

**Interfaces:**
- Consumes: `validarDefeito` de `../domain/defeito`; `inserirDefeito`, `excluirDefeito` de `../infra/defeitos-repository`; `getSessao`, `podeNoModulo`, `registrarLog` (mesmos imports da criticidade).
- Produces:
  - `type ResultadoAcaoDefeito = { ok: true } | { erro: string }`
  - `function cadastrarDefeitoAction(_prev, formData): Promise<ResultadoAcaoDefeito>`
  - `function excluirDefeitoAction(codigo: string): Promise<ResultadoAcaoDefeito>`

- [ ] **Step 1: Implementar as actions**

```ts
// src/modules/shopfloor/application/defeitos-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarDefeito } from '@/modules/shopfloor/domain/defeito'
import { inserirDefeito, excluirDefeito } from '@/modules/shopfloor/infra/defeitos-repository'

export type ResultadoAcaoDefeito = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar defeitos.'

export async function cadastrarDefeitoAction(
  _prev: ResultadoAcaoDefeito | undefined,
  formData: FormData,
): Promise<ResultadoAcaoDefeito> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const v = validarDefeito({
    codigo: String(formData.get('codigo') ?? ''),
    tipo: Number(formData.get('tipo')),
  })
  if (!v.ok) return { erro: v.erro }

  const r = await inserirDefeito(v.valor)
  if (!r.ok) return { erro: r.erro }

  await registrarLog({
    entidade: 'sf_defeito',
    entidadeId: v.valor.codigo,
    acao: 'criar',
    descricao: `Defeito "${v.valor.codigo}" (${v.valor.tipo === 1 ? 'peça' : 'teste'}) cadastrado`,
    dados: { codigo: v.valor.codigo, tipo: v.valor.tipo },
  })

  revalidatePath('/configuracoes/sf-defeitos')
  return { ok: true }
}

export async function excluirDefeitoAction(codigo: string): Promise<ResultadoAcaoDefeito> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  try {
    await excluirDefeito(codigo)
  } catch {
    return { erro: 'Erro ao excluir o defeito.' }
  }

  await registrarLog({
    entidade: 'sf_defeito',
    entidadeId: codigo,
    acao: 'excluir',
    descricao: `Defeito "${codigo}" excluído`,
    dados: { codigo },
  })

  revalidatePath('/configuracoes/sf-defeitos')
  return { ok: true }
}
```

**Nota ao implementer:** confira a assinatura real de `registrarLog` em `src/modules/logs/application/registrar-log.ts`; se algum campo (ex.: `entidade`/`acao`) tiver tipo restrito (union), use o valor aceito mais próximo e ajuste a chamada — sem inventar campos. O guard e o formato `{ok}|{erro}` são fixos.

- [ ] **Step 2: Verificar tipos/build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shopfloor/application/defeitos-actions.ts
git commit -m "feat(shopfloor): actions de defeitos (cadastrar/excluir, guard admin + log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: UI — página + formulário + lista com busca

**Files:**
- Create: `src/app/(app)/configuracoes/sf-defeitos/page.tsx`
- Create: `src/app/(app)/configuracoes/sf-defeitos/defeitos-lista.tsx`
- Create: `src/app/(app)/configuracoes/sf-defeitos/defeitos-form.tsx`

**Interfaces:**
- Consumes: `getSessao`, `podeNoModulo`, `SemPermissao`, `listarDefeitos` (novo repo), `cadastrarDefeitoAction`/`excluirDefeitoAction`, `Defeito` do domínio; componentes `@/components/ui/{dialog,button,input,label,table,confirm-dialog}`.
- Produces: a rota `/configuracoes/sf-defeitos`.

**Referência viva:** `configuracoes/criticidade/page.tsx` + `criticidade/criticidade-form.tsx` (mesmos componentes, mesma estrutura desktop-tabela / mobile-cards, mesmo truque de fechar dialog no sucesso). Guard-por-página como em `shopfloor/ordens/page.tsx`.

- [ ] **Step 1: Página (server, com guard)**

```tsx
// src/app/(app)/configuracoes/sf-defeitos/page.tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarDefeitos } from '@/modules/shopfloor/infra/defeitos-repository'
import { DefeitosLista } from './defeitos-lista'

export default async function DefeitosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar defeitos." />
  }

  const defeitos = await listarDefeitos()
  return <DefeitosLista defeitos={defeitos} />
}
```

- [ ] **Step 2: Formulário + botão de excluir (client)**

```tsx
// src/app/(app)/configuracoes/sf-defeitos/defeitos-form.tsx
'use client'

import { useState, useTransition, useActionState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cadastrarDefeitoAction, excluirDefeitoAction } from '@/modules/shopfloor/application/defeitos-actions'

export function DefeitoForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(cadastrarDefeitoAction, undefined)

  // Fecha o dialog quando a action retorna sucesso (ajuste de estado na
  // renderização, não em efeito — evita o cascading render do eslint).
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="bg-enterplak hover:bg-enterplak-700">
            <PlusIcon />
            Novo defeito
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo defeito</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              name="codigo"
              placeholder="1002 TRILHA ROMPIDA"
              className="uppercase"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">Número + descrição, num campo só. Salvo em MAIÚSCULAS.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="tipo" value="1" defaultChecked /> Peça
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="tipo" value="2" /> Teste
              </label>
            </div>
          </div>

          {state && 'erro' in state && <p className="text-sm text-red-600">{state.erro}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
              {pending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ExcluirDefeitoButton({ codigo }: { codigo: string }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    const ok = await confirmar({
      titulo: `Excluir "${codigo}"?`,
      descricao: 'Não afeta o histórico — os registros já lançados guardam o texto do defeito.',
    })
    if (!ok) return
    setErro(null)
    startTransition(async () => {
      const r = await excluirDefeitoAction(codigo)
      if ('erro' in r) setErro(r.erro)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir defeito"
        disabled={pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {dialog}
    </div>
  )
}
```

**Nota:** confira a assinatura de `useConfirmacao().confirmar` na criticidade — se ele só aceitar `{ titulo }`, remova o `descricao` (ou passe conforme o tipo real). Não inventar props.

- [ ] **Step 3: Lista com busca (client) — desktop tabela + mobile cards**

```tsx
// src/app/(app)/configuracoes/sf-defeitos/defeitos-lista.tsx
'use client'

import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Defeito } from '@/modules/shopfloor/domain/defeito'
import { DefeitoForm, ExcluirDefeitoButton } from './defeitos-form'

function Tipo({ tipo }: { tipo: 1 | 2 }) {
  return tipo === 1 ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Peça
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
      Teste
    </span>
  )
}

export function DefeitosLista({ defeitos }: { defeitos: Defeito[] }) {
  const [busca, setBusca] = useState('')
  const filtro = busca.trim().toLowerCase()
  const lista = filtro ? defeitos.filter((d) => d.codigo.toLowerCase().includes(filtro)) : defeitos
  const vazio = 'Nenhum defeito cadastrado.'
  const semBusca = 'Nenhum defeito encontrado para essa busca.'
  const mensagem = defeitos.length === 0 ? vazio : semBusca

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código…"
            className="pl-9"
            aria-label="Buscar defeito"
          />
        </div>
        <DefeitoForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {mensagem}
                </TableCell>
              </TableRow>
            )}
            {lista.map((d) => (
              <TableRow key={d.codigo}>
                <TableCell className="font-medium">{d.codigo}</TableCell>
                <TableCell><Tipo tipo={d.tipo} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <ExcluirDefeitoButton codigo={d.codigo} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {lista.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagem}
          </p>
        )}
        {lista.map((d) => (
          <div key={d.codigo} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{d.codigo}</span>
                <Tipo tipo={d.tipo} />
              </div>
              <ExcluirDefeitoButton codigo={d.codigo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: build limpo; a rota `/configuracoes/sf-defeitos` aparece na saída.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/configuracoes/sf-defeitos"
git commit -m "feat(shopfloor): tela de Cadastro de Defeitos (lista+busca, cadastrar, excluir)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Menu — accordion "Ajustes ShopFloor" em Configurações

**Files:**
- Modify: `src/shared/ui/app-shell.tsx`

**Interfaces:**
- Consumes: os arrays/pattern já existentes (`FolhaModular`, `CONFIG_RECEBIMENTO`, `configRecAberto`, `pode`, `linkClasse`, `ehAtivo`).
- Produces: item `sf-defeitos` visível em Configurações › Ajustes ShopFloor.

- [ ] **Step 1: Declarar o grupo `CONFIG_SHOPFLOOR`**

Perto de `CONFIG_RECEBIMENTO` (após ele), adicionar. Escolher um ícone já importado no arquivo (ex.: `Bug` do lucide se já importado; senão importar `Bug`/`Wrench`/`ClipboardList` — **verificar os imports existentes** e reusar um que faça sentido para "defeitos"):

```tsx
// Configurações específicas do módulo ShopFloor, agrupadas num accordion.
const CONFIG_SHOPFLOOR: FolhaModular[] = [
  { chave: 'sf-defeitos', rotulo: 'Defeitos', href: '/configuracoes/sf-defeitos', icone: Bug, modulo: 'shopfloor', perm: 'administrar' },
]
```

- [ ] **Step 2: Incluir no cálculo de itens ativos (`CONFIG_TODOS`)**

```tsx
const CONFIG_TODOS: FolhaModular[] = [...CONFIG_TOPO, ...CONFIG_RECEBIMENTO, ...CONFIG_SHOPFLOOR, ...CONFIG_BASE]
```

- [ ] **Step 3: Estado + filtro do accordion**

No corpo do componente, junto de `configRec`/`configRecAberto`:

```tsx
const configSf = podeConfig ? CONFIG_SHOPFLOOR.filter(pode) : []
const configSfAtivo = CONFIG_SHOPFLOOR.some((i) => ehAtivo(pathname, i.href))
const [configSfAberto, setConfigSfAberto] = useState(configSfAtivo)
```

E incluir `configSf.length` no cálculo de `temConfig`:

```tsx
const temConfig = configTopo.length + configRec.length + configSf.length + configBase.length > 0
```

- [ ] **Step 4: Renderizar o accordion**

Logo após o bloco `{configRec.length > 0 && ( … )}` (mesma estrutura), antes de `configBase.map`:

```tsx
{configSf.length > 0 && (
  <>
    <button
      type="button"
      onClick={() => setConfigSfAberto((v) => !v)}
      className={cn(linkClasse(false), 'w-full justify-between')}
    >
      <span className="flex items-center gap-3">
        <Settings2 className="size-[18px] shrink-0" />
        Ajustes ShopFloor
      </span>
      <ChevronDown className={cn('size-4 transition-transform', configSfAberto && 'rotate-180')} />
    </button>
    {configSfAberto && (
      <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
        {configSf.map((i) => (
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

- [ ] **Step 5: Build + verificação visual**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: build limpo. Como admin, Configurações mostra "Ajustes ShopFloor" › Defeitos; a rota abre a tela.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ui/app-shell.tsx
git commit -m "feat(shopfloor): accordion 'Ajustes ShopFloor' com item Defeitos no menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (feita)

- **Cobertura da spec:** domínio (T1), infra sem migração (T2), actions com guard+log (T3), UI página+form+lista+busca+excluir (T4), menu accordion (T5). ✔
- **Placeholders:** nenhum — código completo em cada step. As duas "Notas ao implementer" (assinatura de `registrarLog` e de `useConfirmacao().confirmar`) são checagens de conformidade com o código existente, não lacunas de design.
- **Consistência de tipos:** `Defeito`/`TipoDefeito` (T1) usados em T2/T4; `ResultadoAcaoDefeito` (T3) casado com o consumo `'ok' in state`/`'erro' in r` em T4; `cadastrarDefeitoAction`/`excluirDefeitoAction` com as mesmas assinaturas em T3 e T4. ✔
- **Riscos conhecidos:** ícone `Bug` pode não estar importado (T5 Step 1 manda verificar/importar); `registrarLog`/`useConfirmacao` podem ter tipos restritos (notas cobrem). Sem migração, RLS é o backstop.
