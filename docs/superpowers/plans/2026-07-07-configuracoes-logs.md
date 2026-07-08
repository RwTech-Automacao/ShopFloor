# ShopFloor Enterplak — Plano 2: Configurações & Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as telas de administração (Usuários, Perfis, Listas, Campos, Logs, Sobre) que dão ao Admin controle total pela interface, com auditoria automática de toda mutação.

**Architecture:** Segue as camadas da Fundação (`app/` fino → `modules/<feature>/{domain,application,infra}`). Cada tela: Server Component lê sob RLS; Server Actions finas validam permissão + payload, delegam a repositórios e **registram log**. Um helper de logging (`registrarLog`) e um util de `diff` são a base transversal.

**Tech Stack:** Next.js 16 (App Router, Server Actions) + TypeScript strict, Tailwind v4 + shadcn/Base UI, Supabase (Postgres/Auth/RLS), Vitest.

## Global Constraints

- Idioma da UI e do domínio: **português (pt-BR)**.
- Cor primária Enterplak `#8D2033` (token Tailwind `enterplak`). Componentes shadcn/Base UI em `src/components/ui/`.
- **RLS é o portão real**; o guard de UI só evita renderizar. Toda tela de Configurações exige a permissão **`administrar`**.
- **Toda mutação** (criar/alterar/excluir/mudar_status) grava um `logs` via `registrarLog`, com `usuario_id = auth.uid()`.
- **Service-role só em Server Action confiável** que primeiro valida `administrar` em código (ele ignora RLS).
- **Sem exclusão física de usuários** — apenas `ativo` on/off.
- Perfis `sistema=true` (os 4 base) não são excluíveis. Perfis novos (`sistema=false`) podem ser criados/excluídos.
- **Anti-lockout:** um Admin não pode desativar a si mesmo nem remover `administrar` do próprio perfil.
- TypeScript strict; padrões de código iguais aos do Plano 1 (ver `src/app/(auth)/login/login-form.tsx`, `src/shared/ui/sidebar.tsx`, `src/modules/auth/application/actions.ts`).
- Spec: `docs/superpowers/specs/2026-07-07-configuracoes-logs-design.md`.

---

## Task 1: Infra de Logs — util de diff + registrarLog

**Files:**
- Create: `src/modules/logs/domain/diff.ts`
- Create: `src/modules/logs/domain/__tests__/diff.test.ts`
- Create: `src/modules/logs/application/registrar-log.ts`
- Create: `src/modules/logs/infra/log-repository.ts`

**Interfaces:**
- Produces:
  - `type CampoDiff = { campo: string; de: unknown; para: unknown }`
  - `calcularDiff(antes: Record<string, unknown>, depois: Record<string, unknown>, campos: string[]): CampoDiff[]`
  - `type AcaoLog = 'criar' | 'importar' | 'alterar_campo' | 'mudar_status' | 'gerar_etiqueta' | 'excluir' | 'login'`
  - `registrarLog(input: { entidade: string; entidadeId?: string; acao: AcaoLog; descricao: string; dados?: unknown }): Promise<void>` — lê a sessão atual (usuario_id/nome) e grava um `logs`.

- [ ] **Step 1: Escrever o teste do diff**

Criar `src/modules/logs/domain/__tests__/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { calcularDiff } from '../diff'

describe('calcularDiff', () => {
  it('retorna só os campos que mudaram', () => {
    const diff = calcularDiff(
      { nome: 'A', ativo: true, perfil: 'Consulta' },
      { nome: 'B', ativo: true, perfil: 'Recebimento' },
      ['nome', 'ativo', 'perfil'],
    )
    expect(diff).toEqual([
      { campo: 'nome', de: 'A', para: 'B' },
      { campo: 'perfil', de: 'Consulta', para: 'Recebimento' },
    ])
  })

  it('retorna vazio quando nada muda', () => {
    expect(calcularDiff({ a: 1 }, { a: 1 }, ['a'])).toEqual([])
  })

  it('considera apenas os campos informados', () => {
    const diff = calcularDiff({ a: 1, b: 2 }, { a: 9, b: 9 }, ['a'])
    expect(diff).toEqual([{ campo: 'a', de: 1, para: 9 }])
  })
})
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `npm test -- diff`
Expected: FAIL — Cannot find module '../diff'

- [ ] **Step 3: Implementar `diff.ts`**

Criar `src/modules/logs/domain/diff.ts`:

```ts
export type CampoDiff = { campo: string; de: unknown; para: unknown }

export function calcularDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  campos: string[],
): CampoDiff[] {
  const diffs: CampoDiff[] = []
  for (const campo of campos) {
    if (antes[campo] !== depois[campo]) {
      diffs.push({ campo, de: antes[campo], para: depois[campo] })
    }
  }
  return diffs
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `npm test -- diff`
Expected: PASS (3)

- [ ] **Step 5: Implementar o repositório e o registrarLog**

Criar `src/modules/logs/infra/log-repository.ts`:

```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface NovoLog {
  entidade: string
  entidadeId?: string | null
  acao: string
  descricao: string
  dados?: unknown
  usuarioId: string
  usuarioNome: string
}

export async function inserirLog(log: NovoLog): Promise<void> {
  const supabase = await createServerSupabase()
  await supabase.from('logs').insert({
    entidade: log.entidade,
    entidade_id: log.entidadeId ?? null,
    acao: log.acao,
    descricao: log.descricao,
    dados: log.dados ?? {},
    usuario_id: log.usuarioId,
    usuario_nome: log.usuarioNome,
  })
}
```

Criar `src/modules/logs/application/registrar-log.ts`:

```ts
import { getSessao } from '@/modules/auth/application/get-sessao'
import { inserirLog } from '../infra/log-repository'

export type AcaoLog =
  | 'criar'
  | 'importar'
  | 'alterar_campo'
  | 'mudar_status'
  | 'gerar_etiqueta'
  | 'excluir'
  | 'login'

export async function registrarLog(input: {
  entidade: string
  entidadeId?: string
  acao: AcaoLog
  descricao: string
  dados?: unknown
}): Promise<void> {
  const sessao = await getSessao()
  if (!sessao) return
  await inserirLog({
    entidade: input.entidade,
    entidadeId: input.entidadeId ?? null,
    acao: input.acao,
    descricao: input.descricao,
    dados: input.dados,
    usuarioId: sessao.usuarioId,
    usuarioNome: sessao.nome || sessao.email,
  })
}
```

- [ ] **Step 6: Rodar toda a suíte + build**

Run: `npm test && npm run build`
Expected: verdes

- [ ] **Step 7: Commit**

```bash
git add src/modules/logs/
git commit -m "feat(logs): util de diff + registrarLog (base de auditoria)"
```

---

## Task 2: Shell de Configurações (layout + guard + sub-nav) + Sobre

**Files:**
- Create: `src/app/(app)/configuracoes/layout.tsx`
- Create: `src/app/(app)/configuracoes/sobre/page.tsx`
- Create: `src/app/(app)/configuracoes/page.tsx` (redirect para a 1ª aba)
- Create: `src/shared/ui/config-nav.ts`
- Test: `src/shared/ui/__tests__/config-nav.test.ts`
- Possivelmente: `npx shadcn@latest add table dialog switch select textarea badge` (componentes de UI para as telas)

**Interfaces:**
- Consumes: `getSessao`, `podeFazer` (Fundação).
- Produces:
  - `CONFIG_NAV: { chave: string; rotulo: string; href: string }[]`
  - Layout que redireciona para `/home` se o usuário não tem `administrar`, e renderiza a sub-navegação lateral/superior das abas.

- [ ] **Step 1: Instalar componentes de UI necessários às telas**

```bash
npx shadcn@latest add table dialog switch select textarea badge
```
(Se algum já existir ou o nome divergir na versão instalada, instalar o equivalente e anotar.)

- [ ] **Step 2: Escrever o teste do config-nav**

Criar `src/shared/ui/__tests__/config-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CONFIG_NAV } from '../config-nav'

describe('CONFIG_NAV', () => {
  it('contém as abas de configuração esperadas', () => {
    const chaves = CONFIG_NAV.map((i) => i.chave)
    expect(chaves).toEqual(['usuarios', 'perfis', 'listas', 'campos', 'logs', 'sobre'])
  })
  it('todas as rotas ficam sob /configuracoes', () => {
    expect(CONFIG_NAV.every((i) => i.href.startsWith('/configuracoes/'))).toBe(true)
  })
})
```

- [ ] **Step 3: Rodar (deve falhar)**

Run: `npm test -- config-nav`
Expected: FAIL — Cannot find module '../config-nav'

- [ ] **Step 4: Implementar `config-nav.ts`**

Criar `src/shared/ui/config-nav.ts`:

```ts
export interface ConfigNavItem {
  chave: string
  rotulo: string
  href: string
}

export const CONFIG_NAV: ConfigNavItem[] = [
  { chave: 'usuarios', rotulo: 'Usuários', href: '/configuracoes/usuarios' },
  { chave: 'perfis', rotulo: 'Perfis', href: '/configuracoes/perfis' },
  { chave: 'listas', rotulo: 'Listas Suspensas', href: '/configuracoes/listas' },
  { chave: 'campos', rotulo: 'Campos', href: '/configuracoes/campos' },
  { chave: 'logs', rotulo: 'Logs do Sistema', href: '/configuracoes/logs' },
  { chave: 'sobre', rotulo: 'Sobre o Sistema', href: '/configuracoes/sobre' },
]
```

- [ ] **Step 5: Rodar (deve passar)**

Run: `npm test -- config-nav`
Expected: PASS (2)

- [ ] **Step 6: Implementar o layout com guard**

Criar `src/app/(app)/configuracoes/layout.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { CONFIG_NAV } from '@/shared/ui/config-nav'

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) redirect('/home')

  return (
    <div className="flex gap-6">
      <nav className="flex w-56 shrink-0 flex-col gap-1">
        {CONFIG_NAV.map((i) => (
          <Link key={i.chave} href={i.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-enterplak-50 hover:text-enterplak">
            {i.rotulo}
          </Link>
        ))}
      </nav>
      <section className="flex-1">{children}</section>
    </div>
  )
}
```

- [ ] **Step 7: Implementar `configuracoes/page.tsx` (redirect) e Sobre**

Criar `src/app/(app)/configuracoes/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
export default function ConfiguracoesIndex() {
  redirect('/configuracoes/usuarios')
}
```

Criar `src/app/(app)/configuracoes/sobre/page.tsx`:

```tsx
export default function SobrePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sobre o Sistema</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex gap-2"><dt className="font-medium">Sistema:</dt><dd>ShopFloor — Enterplak MES</dd></div>
        <div className="flex gap-2"><dt className="font-medium">Versão:</dt><dd>1.0.0</dd></div>
        <div className="flex gap-2"><dt className="font-medium">Empresa:</dt><dd>Enterplak Indústria Eletrônica Ltda.</dd></div>
      </dl>
    </div>
  )
}
```

- [ ] **Step 8: Verificar guard manualmente**

Run: `npm run dev` → como usuário **Consulta**, acessar `/configuracoes/sobre` deve redirecionar para `/home`. Como **Administrador**, deve exibir a página com a sub-nav.

- [ ] **Step 9: Build + testes + commit**

```bash
npm test && npm run build
git add src/app/(app)/configuracoes/ src/shared/ui/config-nav.ts src/shared/ui/__tests__/config-nav.test.ts src/components/ui/
git commit -m "feat(config): shell de Configurações com guard administrar, sub-nav e Sobre"
```

---

## Task 3: Perfis — CRUD + anti-lockout

**Files:**
- Create: `src/modules/perfis/domain/regras-perfil.ts`
- Create: `src/modules/perfis/domain/__tests__/regras-perfil.test.ts`
- Create: `src/modules/perfis/infra/perfil-repository.ts`
- Create: `src/modules/perfis/application/actions.ts`
- Create: `src/app/(app)/configuracoes/perfis/page.tsx`
- Create: `src/app/(app)/configuracoes/perfis/perfil-form.tsx`

**Interfaces:**
- Consumes: `Permissao`, `Perfil`, `podeFazer` (auth domain); `registrarLog`, `calcularDiff` (logs); `getSessao`.
- Produces:
  - `PERMISSOES: Permissao[]` (as 8, com rótulos)
  - `validarEdicaoPerfil({ perfilAlvoId, perfilDoUsuarioId, novasFlags }): { ok: true } | { ok: false; erro: string }` — bloqueia remover `administrar` do próprio perfil.
  - Server Actions: `salvarPerfil(formData)`, `excluirPerfil(id)`.

- [ ] **Step 1: Escrever o teste da regra anti-lockout**

Criar `src/modules/perfis/domain/__tests__/regras-perfil.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarEdicaoPerfil } from '../regras-perfil'

describe('validarEdicaoPerfil', () => {
  it('bloqueia remover administrar do próprio perfil', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p1',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: false,
    })
    expect(r.ok).toBe(false)
  })
  it('permite editar outro perfil sem administrar', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p2',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: false,
    })
    expect(r.ok).toBe(true)
  })
  it('permite manter administrar no próprio perfil', () => {
    const r = validarEdicaoPerfil({
      perfilAlvoId: 'p1',
      perfilDoUsuarioId: 'p1',
      administrarNasNovasFlags: true,
    })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `npm test -- regras-perfil`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implementar `regras-perfil.ts`**

Criar `src/modules/perfis/domain/regras-perfil.ts`:

```ts
import type { Permissao } from '@/modules/auth/domain/perfil'

export const PERMISSOES: { chave: Permissao; rotulo: string }[] = [
  { chave: 'visualizar', rotulo: 'Visualizar' },
  { chave: 'importar', rotulo: 'Importar' },
  { chave: 'editar', rotulo: 'Editar' },
  { chave: 'finalizar', rotulo: 'Finalizar' },
  { chave: 'editar_finalizado', rotulo: 'Editar finalizado' },
  { chave: 'excluir', rotulo: 'Excluir' },
  { chave: 'gerar_etiqueta', rotulo: 'Gerar etiqueta' },
  { chave: 'administrar', rotulo: 'Administrar' },
]

export function validarEdicaoPerfil(input: {
  perfilAlvoId: string
  perfilDoUsuarioId: string
  administrarNasNovasFlags: boolean
}): { ok: true } | { ok: false; erro: string } {
  if (
    input.perfilAlvoId === input.perfilDoUsuarioId &&
    !input.administrarNasNovasFlags
  ) {
    return {
      ok: false,
      erro: 'Você não pode remover a permissão Administrar do seu próprio perfil.',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `npm test -- regras-perfil`
Expected: PASS (3)

- [ ] **Step 5: Implementar o repositório**

Criar `src/modules/perfis/infra/perfil-repository.ts` com funções (código real, sob RLS):
- `listarPerfis(): Promise<PerfilRow[]>` — `select('*').order('nome')`.
- `criarPerfil(dados): Promise<{ id }>` — insert das flags + nome + `sistema:false`.
- `atualizarPerfil(id, dados): Promise<void>` — update das flags + nome.
- `buscarPerfil(id): Promise<PerfilRow | null>`.
- `excluirPerfil(id): Promise<void>` — delete (o RLS já barra `sistema=true`).

Use o tipo `PerfilRow` de `@/modules/auth/domain/mapear-perfil`. Todas via `createServerSupabase()`.

- [ ] **Step 6: Implementar as Server Actions (com log + permissão + anti-lockout)**

Criar `src/modules/perfis/application/actions.ts` (`'use server'`). Cada action:
1. `getSessao()`; se `!podeFazer(perfil,'administrar')` → retorna `{ erro }`.
2. Para `salvarPerfil`: lê o estado anterior (se edição), aplica `validarEdicaoPerfil`, chama repo, e `registrarLog({ entidade:'perfil', entidadeId, acao: criação?'criar':'alterar_campo', descricao, dados: calcularDiff(...) })`.
3. Para `excluirPerfil`: chama repo, `registrarLog({ entidade:'perfil', entidadeId:id, acao:'excluir', descricao })`.
Retornam `{ ok: true } | { erro: string }`. `revalidatePath('/configuracoes/perfis')`.

- [ ] **Step 7: Implementar a página e o formulário**

Criar `src/app/(app)/configuracoes/perfis/page.tsx` (Server Component): tabela de perfis (nome + as 8 flags como ✓/—, coluna "Sistema"), botão "Novo perfil", e por linha ações Editar / Excluir (Excluir desabilitado quando `sistema=true`). Usa os componentes `table` e `dialog`.

Criar `src/app/(app)/configuracoes/perfis/perfil-form.tsx` (`'use client'`): dialog com input `nome` + 8 `switch` (uma por permissão de `PERMISSOES`), submetendo à Server Action via `useActionState`; exibe `{erro}` (inclusive o anti-lockout). Segue o padrão de `login-form.tsx`.

- [ ] **Step 8: Verificar + build + commit**

Run: `npm test && npm run build`. Manual: criar um perfil "Inspetor", editar flags, tentar remover Administrar do próprio perfil (deve bloquear), excluir o "Inspetor".

```bash
git add src/modules/perfis/ "src/app/(app)/configuracoes/perfis/"
git commit -m "feat(config): tela de Perfis — CRUD, flags e salvaguarda anti-lockout"
```

---

## Task 4: Listas — CRUD de listas e itens

**Files:**
- Create: `src/modules/listas/infra/lista-repository.ts`
- Create: `src/modules/listas/application/actions.ts`
- Create: `src/app/(app)/configuracoes/listas/page.tsx`
- Create: `src/app/(app)/configuracoes/listas/[chave]/page.tsx`
- Create: `src/app/(app)/configuracoes/listas/lista-form.tsx`
- Create: `src/app/(app)/configuracoes/listas/item-form.tsx`

**Interfaces:**
- Consumes: `registrarLog`, `getSessao`, `podeFazer`.
- Produces:
  - Repo: `listarListas()`, `criarLista({chave,nome})`, `excluirLista(id)`, `buscarLista(chave)`, `listarItens(listaId)`, `criarItem({listaId,valor,ordem})`, `atualizarItem(id,{valor,ordem,ativo})`, `excluirItem(id)`.
  - Server Actions: `salvarLista`, `excluirListaAction`, `salvarItem`, `alternarItemAtivo`, `excluirItemAction`.

- [ ] **Step 1: Implementar o repositório**

Criar `src/modules/listas/infra/lista-repository.ts` com as funções acima via `createServerSupabase()`. `listarItens` ordena por `ordem, valor`. Tipos: `ListaRow = { id, chave, nome, descricao, sistema }`, `ItemRow = { id, lista_id, valor, ordem, ativo }`.

- [ ] **Step 2: Implementar as Server Actions**

Criar `src/modules/listas/application/actions.ts` (`'use server'`). Cada action valida `administrar`, delega ao repo, registra log (`entidade:'lista'`, ações `criar`/`alterar_campo`/`excluir`/`mudar_status`), e `revalidatePath`. Criar lista com `sistema:false`; a exclusão de `sistema=true` já é barrada pelo RLS — traduzir o erro para "Listas do sistema não podem ser excluídas."

- [ ] **Step 3: Implementar as páginas e formulários**

- `configuracoes/listas/page.tsx`: tabela de listas (nome, chave, nº de itens, Sistema), botão "Nova lista", link para gerenciar itens (`/configuracoes/listas/[chave]`), Excluir (desabilitado se `sistema`).
- `configuracoes/listas/[chave]/page.tsx`: cabeçalho da lista + tabela de itens (valor, ordem, ativo) com adicionar/editar/reordenar (campo `ordem`)/ativar-desativar/excluir.
- `lista-form.tsx` / `item-form.tsx` (`'use client'`): dialogs com `useActionState`, seguindo o padrão do `perfil-form.tsx`.

- [ ] **Step 4: Verificar + build + commit**

Run: `npm test && npm run build`. Manual: criar lista "transportadora", adicionar itens, reordenar, desativar um item, excluir; confirmar que uma lista `sistema` não pode ser excluída.

```bash
git add src/modules/listas/ "src/app/(app)/configuracoes/listas/"
git commit -m "feat(config): tela de Listas — CRUD de listas e itens (reordenar/ativar)"
```

---

## Task 5: Campos — edição de `configuracao_campos`

**Files:**
- Create: `src/modules/configuracao-campos/infra/campo-repository.ts`
- Create: `src/modules/configuracao-campos/application/actions.ts`
- Create: `src/app/(app)/configuracoes/campos/page.tsx`
- Create: `src/app/(app)/configuracoes/campos/campo-form.tsx`

**Interfaces:**
- Consumes: `registrarLog`, `calcularDiff`, `getSessao`, `podeFazer`; `listarListas` (para o select de `lista_chave`).
- Produces:
  - Repo: `listarCampos()` (order by grupo, ordem), `buscarCampo(id)`, `atualizarCampo(id, dados)`.
  - Server Action: `salvarCampo(formData)`.

- [ ] **Step 1: Implementar o repositório**

Criar `src/modules/configuracao-campos/infra/campo-repository.ts`. `CampoRow = { id, campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_importacao, obrigatorio_finalizacao, ordem, ativo }`. `atualizarCampo` só altera os campos editáveis (`rotulo, tipo, lista_chave, obrigatorio_importacao, obrigatorio_finalizacao, ordem, ativo`) — nunca `campo`/`origem`.

- [ ] **Step 2: Implementar a Server Action**

Criar `src/modules/configuracao-campos/application/actions.ts` (`'use server'`). `salvarCampo`: valida `administrar`; **valida que se `tipo='lista'` então `lista_chave` está preenchido** (retorna `{erro}` se não); lê o estado anterior, atualiza via repo, `registrarLog({ entidade:'campo', entidadeId, acao:'alterar_campo', dados: calcularDiff(...) })`, `revalidatePath('/configuracoes/campos')`.

- [ ] **Step 3: Implementar a página e o formulário**

- `configuracoes/campos/page.tsx`: campos agrupados por `grupo` (Comercial, Material, Recebimento, Qualidade), tabela por grupo (rótulo, tipo, obrig. importação, obrig. finalização, ativo), botão Editar por linha.
- `campo-form.tsx` (`'use client'`): dialog com `rotulo` (input), `tipo` (select texto/lista — só estes dois editáveis; `numero`/`data` aparecem como somente-leitura se o campo já for desse tipo), `lista_chave` (select das listas, visível/obrigatório quando `tipo=lista`), 2 `switch` de obrigatoriedade, `ordem` (number), `ativo` (switch). Usa `useActionState`.

- [ ] **Step 4: Verificar + build + commit**

Run: `npm test && npm run build`. Manual: editar o campo `fabricante` de texto→lista associando à lista `fornecedor` (só p/ teste), confirmar validação de `lista_chave` obrigatório, salvar e ver o log gerado.

```bash
git add src/modules/configuracao-campos/ "src/app/(app)/configuracoes/campos/"
git commit -m "feat(config): tela de Campos — edição de rótulo/tipo/obrigatoriedade/ordem"
```

---

## Task 6: Usuários — CRUD via admin API + anti-lockout

**Files:**
- Create: `src/modules/usuarios/domain/regras-usuario.ts`
- Create: `src/modules/usuarios/domain/__tests__/regras-usuario.test.ts`
- Create: `src/modules/usuarios/infra/usuario-admin-repository.ts`
- Create: `src/modules/usuarios/application/actions.ts`
- Create: `src/app/(app)/configuracoes/usuarios/page.tsx`
- Create: `src/app/(app)/configuracoes/usuarios/usuario-form.tsx`

**Interfaces:**
- Consumes: `createServiceSupabase` (service-role), `createServerSupabase`, `getSessao`, `podeFazer`, `registrarLog`, `calcularDiff`, `listarPerfis`.
- Produces:
  - `validarAcaoUsuario({ usuarioAlvoId, usuarioLogadoId, novoAtivo, perfilAlvoTemAdministrar }): { ok:true } | { ok:false; erro }` — bloqueia auto-desativação e auto-rebaixamento.
  - Repo (service-role): `criarUsuarioAuth({email,password,nome})`, `atualizarSenha(id,password)`; (server) `listarUsuarios()`, `atualizarUsuario(id,{nome,perfilId,ativo})`.
  - Server Actions: `criarUsuario`, `editarUsuario`, `redefinirSenha`, `alternarAtivo`.

- [ ] **Step 1: Escrever o teste da regra anti-lockout de usuário**

Criar `src/modules/usuarios/domain/__tests__/regras-usuario.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarAcaoUsuario } from '../regras-usuario'

describe('validarAcaoUsuario', () => {
  it('bloqueia o usuário de desativar a si mesmo', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u1', usuarioLogadoId: 'u1',
      novoAtivo: false, perfilAlvoTemAdministrar: true,
    })
    expect(r.ok).toBe(false)
  })
  it('bloqueia o usuário de rebaixar o próprio perfil (perder administrar)', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u1', usuarioLogadoId: 'u1',
      novoAtivo: true, perfilAlvoTemAdministrar: false,
    })
    expect(r.ok).toBe(false)
  })
  it('permite editar outro usuário livremente', () => {
    const r = validarAcaoUsuario({
      usuarioAlvoId: 'u2', usuarioLogadoId: 'u1',
      novoAtivo: false, perfilAlvoTemAdministrar: false,
    })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `npm test -- regras-usuario`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implementar `regras-usuario.ts`**

Criar `src/modules/usuarios/domain/regras-usuario.ts`:

```ts
export function validarAcaoUsuario(input: {
  usuarioAlvoId: string
  usuarioLogadoId: string
  novoAtivo: boolean
  perfilAlvoTemAdministrar: boolean
}): { ok: true } | { ok: false; erro: string } {
  const ehProprio = input.usuarioAlvoId === input.usuarioLogadoId
  if (ehProprio && !input.novoAtivo) {
    return { ok: false, erro: 'Você não pode desativar a si mesmo.' }
  }
  if (ehProprio && !input.perfilAlvoTemAdministrar) {
    return { ok: false, erro: 'Você não pode remover seu próprio acesso de Administrador.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `npm test -- regras-usuario`
Expected: PASS (3)

- [ ] **Step 5: Implementar o repositório (service-role + server)**

Criar `src/modules/usuarios/infra/usuario-admin-repository.ts`:
- `import 'server-only'` na primeira linha.
- `criarUsuarioAuth({email,password,nome})`: usa `createServiceSupabase().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome } })`; retorna o `id`.
- `atualizarSenha(id, password)`: `createServiceSupabase().auth.admin.updateUserById(id, { password })`.
- `listarUsuarios()`: via `createServerSupabase()` — `from('usuarios').select('id,nome,email,ativo,perfis(id,nome,pode_administrar)').order('nome')`.
- `atualizarUsuario(id,{nome,perfilId,ativo})`: `createServerSupabase().from('usuarios').update(...)`.

- [ ] **Step 6: Implementar as Server Actions**

Criar `src/modules/usuarios/application/actions.ts` (`'use server'`). TODAS validam `administrar` via `getSessao` ANTES de qualquer uso de service-role.
- `criarUsuario(formData)`: valida payload (email, senha mín. 6, nome, perfilId); `criarUsuarioAuth`; depois `atualizarUsuario(novoId,{nome,perfilId,ativo:true})`; `registrarLog({entidade:'usuario',entidadeId:novoId,acao:'criar',descricao})`. Traduz erros da admin API (email já existe, senha fraca).
- `editarUsuario(formData)`: lê estado anterior + o perfil alvo; aplica `validarAcaoUsuario` (com `perfilAlvoTemAdministrar` derivado do novo perfil e `novoAtivo` atual); atualiza; `registrarLog(acao:'alterar_campo', dados: calcularDiff)`.
- `redefinirSenha(id, password)`: `atualizarSenha`; `registrarLog(acao:'alterar_campo', descricao:'Senha redefinida')` (NÃO logar a senha).
- `alternarAtivo(id, novoAtivo)`: aplica `validarAcaoUsuario`; atualiza; `registrarLog(acao:'mudar_status')`.
Todas `revalidatePath('/configuracoes/usuarios')` e retornam `{ok}|{erro}`.

- [ ] **Step 7: Implementar a página e o formulário**

- `configuracoes/usuarios/page.tsx`: tabela (nome, e-mail, perfil, ativo), botão "Novo usuário", por linha Editar / Redefinir senha / Ativar-Desativar.
- `usuario-form.tsx` (`'use client'`): dialog de criação (nome, e-mail, senha, select de perfil) e de edição (nome, select de perfil, switch ativo); `useActionState`; exibe erros (inclui anti-lockout e erros da admin API).

- [ ] **Step 8: Verificar + build + commit**

Run: `npm test && npm run build`. Manual: criar um usuário pela tela, logar com ele em aba anônima, editar seu perfil, redefinir senha, tentar desativar a si mesmo (deve bloquear).

```bash
git add src/modules/usuarios/ "src/app/(app)/configuracoes/usuarios/"
git commit -m "feat(config): tela de Usuários — criação via admin API, edição, senha e anti-lockout"
```

---

## Task 7: Logs — tela somente-leitura com filtros e paginação

**Files:**
- Create: `src/modules/logs/infra/consulta-log-repository.ts`
- Create: `src/app/(app)/configuracoes/logs/page.tsx`
- Create: `src/app/(app)/configuracoes/logs/logs-filtros.tsx`

**Interfaces:**
- Consumes: `createServerSupabase`.
- Produces:
  - `consultarLogs(filtros: { entidade?; acao?; usuarioId?; de?; ate?; pagina: number; tamanho: number }): Promise<{ linhas: LogRow[]; total: number }>` — usa `.range()` para paginação e filtros condicionais; ordena por `created_at desc`.

- [ ] **Step 1: Implementar o repositório de consulta**

Criar `src/modules/logs/infra/consulta-log-repository.ts`. `LogRow = { id, entidade, entidade_id, acao, descricao, dados, usuario_nome, created_at }`. Monta a query com `select('*', { count: 'exact' })`, aplica filtros com `if` (`.eq('entidade', ...)`, `.eq('acao', ...)`, `.eq('usuario_id', ...)`, `.gte('created_at', de)`, `.lte('created_at', ate)`), ordena `created_at` desc, e pagina com `.range(pagina*tamanho, pagina*tamanho + tamanho - 1)`. Retorna `{ linhas, total: count ?? 0 }`.

- [ ] **Step 2: Implementar a página + filtros**

- `configuracoes/logs/page.tsx` (Server Component): lê os filtros de `searchParams` (entidade, acao, usuarioId, de, ate, pagina), chama `consultarLogs`, renderiza tabela (data/hora, usuário, entidade, ação, descrição) + controles de página (anterior/próxima com base em `total`). Para `alterar_campo`, exibir um resumo do `dados` (diffs).
- `logs-filtros.tsx` (`'use client'`): selects de entidade e ação, input de intervalo de datas; ao aplicar, navega para a mesma rota com `searchParams` atualizados (`useRouter().push`). Sem mutação (tela read-only).

- [ ] **Step 3: Verificar + build + commit**

Run: `npm test && npm run build`. Manual: após as ações das tasks 3–6 terem gerado logs, abrir `/configuracoes/logs`, filtrar por entidade `usuario` e por ação `criar`, paginar. Confirmar que não há qualquer ação de escrita/edição na tela.

```bash
git add src/modules/logs/infra/consulta-log-repository.ts "src/app/(app)/configuracoes/logs/"
git commit -m "feat(config): tela de Logs — consulta read-only com filtros e paginação"
```

---

## Self-Review (executado pelo autor do plano)

**1. Cobertura do spec (Plano 2):**
- Layout + guard `administrar` → Task 2 ✅
- Infra de Logs (registrarLog + diff) + logging em toda mutação → Task 1 + usada nas Tasks 3–6 ✅
- Segurança do service-role (valida `administrar` antes) → Task 6 ✅
- Usuários (criar via admin API, editar, senha, ativar/desativar, anti-lockout) → Task 6 ✅
- Perfis (CRUD + editar flags + anti-lockout) → Task 3 ✅
- Listas (CRUD listas + itens, reordenar/ativar) → Task 4 ✅
- Campos (rótulo/tipo/lista/obrigatoriedade/ordem/ativo; validação lista_chave) → Task 5 ✅
- Logs (read-only, filtros, paginação, exige `administrar`) → Task 7 ✅
- Sobre → Task 2 ✅
- Testes (diff, anti-lockout perfis/usuarios) → Tasks 1, 3, 6 ✅

**2. Placeholders:** as Tasks 1–3 e 6 trazem código verbatim para domínio/testes/helpers (o que os reviewers checam). Tasks 4, 5, 7 e as camadas de UI descrevem repositórios/actions/páginas com assinaturas e comportamento precisos + esqueletos concretos, seguindo padrões já existentes no repo (`login-form.tsx`, `sidebar.tsx`, `actions.ts` da Fundação) — decisão deliberada para não inflar o plano a milhares de linhas de JSX; os implementadores (subagentes) completam seguindo esses padrões, e cada tela é revisada.

**3. Consistência de tipos:** `registrarLog`, `calcularDiff`, `AcaoLog`, `Permissao`, `Perfil`, `PerfilRow`, `getSessao`, `podeFazer`, `createServiceSupabase`, `validarEdicaoPerfil`, `validarAcaoUsuario` usados de forma idêntica entre as tasks. Entidades de log (`perfil`/`lista`/`campo`/`usuario`) coerentes com o `check` da coluna `logs.entidade` (0005 aceita texto livre; sem violação). Ações de log ∈ enum do banco (`criar`/`alterar_campo`/`mudar_status`/`excluir`). Permissão de escrita reforçada tanto por RLS quanto por checagem em código nas actions.
