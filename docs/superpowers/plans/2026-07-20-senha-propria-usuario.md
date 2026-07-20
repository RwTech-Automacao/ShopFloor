# Cada usuário define a própria senha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o fluxo "gestor cria conta com senha" por senha temporária gerada + troca obrigatória no 1º acesso, com reset pelo gestor.

**Architecture:** Coluna `usuarios.senha_provisoria` marca contas que precisam trocar; o middleware barra o acesso e manda pra `/definir-senha` até a troca. Cadastro/reset geram uma temporária mostrada uma vez; a pessoa troca com o próprio cliente logado. Funções puras (geração + validação) com TDD.

**Tech Stack:** Next.js 16 (App Router, Server Actions, middleware), TypeScript strict `noUncheckedIndexedAccess`, Supabase (Auth admin + RLS), Vitest, Tailwind.

## Global Constraints

- **AGENTS.md:** Next 16 — ler `node_modules/next/dist/docs` antes de escrever. `params`/`searchParams` são Promises.
- **Migração aplicada pelo controller DEPOIS do review** (subagentes NÃO aplicam migração nem dão push). Prod só tem dado de teste → aplicar direto é seguro.
- **Nunca logar o valor de senha** em auditoria (o padrão já seguido em `redefinirSenha`).
- A temporária trafega **uma vez** na resposta da action (pro gestor, autorizado); nunca é relistada nem persistida em claro.
- `senha_provisoria=false` só via a action da própria pessoa (service-role escopado a `auth.uid()`) ou reset do gestor (`=true`). Não entra em `atualizarUsuario`.
- Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem push.**
- Verificação: `npx tsc --noEmit && npm run lint && npm run build && npm run test`. Único warning aceitável: `<img>` pré-existente.

## File Structure

- Create: `supabase/migrations/0024_senha_provisoria.sql`
- Create: `src/modules/usuarios/domain/senha.ts` + `src/modules/usuarios/domain/__tests__/senha.test.ts`
- Create: `src/app/definir-senha/page.tsx` + `src/app/definir-senha/definir-senha-form.tsx`
- Modify: `src/modules/usuarios/infra/usuario-admin-repository.ts` (nova fn `definirSenhaProvisoria`)
- Modify: `src/modules/usuarios/application/actions.ts` (criar gera temp; `resetarSenha` no lugar de `redefinirSenha`; nova `definirNovaSenha`)
- Modify: `src/shared/lib/supabase/middleware.ts` (carrega `senha_provisoria` + redirect)
- Modify: `src/app/(app)/configuracoes/usuarios/usuario-form.tsx` (tira campo senha; mostra a temp uma vez no criar e no reset)

---

### Task 1: Migração + funções puras (TDD)

**Files:**
- Create: `supabase/migrations/0024_senha_provisoria.sql`
- Create: `src/modules/usuarios/domain/senha.ts`
- Create: `src/modules/usuarios/domain/__tests__/senha.test.ts`

**Interfaces:**
- Produces: `gerarSenhaTemporaria(tamanho?: number): string`; `validarForcaSenha(senha: string): { ok: boolean; erro?: string }`; coluna `usuarios.senha_provisoria boolean not null default true`.

- [ ] **Step 1: Migração**

`supabase/migrations/0024_senha_provisoria.sql`:

```sql
-- Marca contas que ainda usam senha temporária e precisam trocar no 1º acesso.
-- default true → toda conta nova (criada pelo trigger handle_new_user) nasce
-- provisória sem código extra. As contas já existentes recebem false (já têm
-- senha real definida por elas ou pelo gestor).
alter table public.usuarios
  add column senha_provisoria boolean not null default true;

update public.usuarios set senha_provisoria = false;
```

- [ ] **Step 2: Testes das funções puras**

`src/modules/usuarios/domain/__tests__/senha.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gerarSenhaTemporaria, validarForcaSenha } from '../senha'

describe('gerarSenhaTemporaria', () => {
  it('tem o tamanho pedido (padrão 10)', () => {
    expect(gerarSenhaTemporaria()).toHaveLength(10)
    expect(gerarSenhaTemporaria(14)).toHaveLength(14)
  })

  it('usa só o alfabeto seguro (sem 0 O 1 l I)', () => {
    const s = gerarSenhaTemporaria(200)
    expect(s).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/)
  })

  it('duas chamadas diferem (aleatória)', () => {
    expect(gerarSenhaTemporaria()).not.toBe(gerarSenhaTemporaria())
  })
})

describe('validarForcaSenha', () => {
  it('rejeita menos de 8 caracteres', () => {
    expect(validarForcaSenha('1234567').ok).toBe(false)
  })

  it('aceita 8 ou mais', () => {
    expect(validarForcaSenha('12345678')).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Rodar os testes (devem FALHAR — módulo não existe)**

Run: `npm run test -- senha`
Expected: FAIL (`Cannot find module '../senha'`).

- [ ] **Step 4: Implementar `senha.ts`**

`src/modules/usuarios/domain/senha.ts`:

```ts
/** Alfabeto sem caracteres ambíguos (0/O, 1/l/I) — a temporária é lida e digitada à mão. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** Senha temporária aleatória (crypto), tamanho fixo, alfabeto legível. */
export function gerarSenhaTemporaria(tamanho = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho))
  let saida = ''
  for (let i = 0; i < tamanho; i++) {
    saida += ALFABETO[bytes[i]! % ALFABETO.length]
  }
  return saida
}

/** Regra da senha escolhida pela pessoa: mínimo 8, sem outras exigências. */
export function validarForcaSenha(senha: string): { ok: boolean; erro?: string } {
  if (senha.length < 8) return { ok: false, erro: 'A senha deve ter ao menos 8 caracteres.' }
  return { ok: true }
}
```

- [ ] **Step 5: Rodar os testes (devem PASSAR)**

Run: `npm run test -- senha`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0024_senha_provisoria.sql src/modules/usuarios/domain/senha.ts src/modules/usuarios/domain/__tests__/senha.test.ts
git commit -F - << 'EOF'
feat(usuarios): coluna senha_provisoria + geração/validação de senha (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Backend — repositório + actions

**Files:**
- Modify: `src/modules/usuarios/infra/usuario-admin-repository.ts`
- Modify: `src/modules/usuarios/application/actions.ts`

**Interfaces:**
- Consumes: `gerarSenhaTemporaria`, `validarForcaSenha` (Task 1); `atualizarSenha`, `criarUsuarioAuth`, `atualizarUsuario` (já existem); `createServerSupabase`, `getSessao`, `registrarLog`.
- Produces:
  - `definirSenhaProvisoria(id: string, valor: boolean): Promise<void>` (repo, service-role).
  - `criarUsuario(_prev, formData): Promise<ResultadoAcaoUsuario>` — agora **gera** a temp e devolve `{ ok: true; senhaTemporaria: string }`.
  - `resetarSenha(id: string): Promise<ResultadoAcaoUsuario>` — substitui `redefinirSenha`; gera temp, marca provisória, devolve `{ ok: true; senhaTemporaria }`.
  - `definirNovaSenha(nova: string): Promise<ResultadoAcaoUsuario>` — troca a senha do próprio logado e limpa a marca.
  - Tipo `ResultadoAcaoUsuario = { ok: true; senhaTemporaria?: string } | { erro: string }`.

- [ ] **Step 1: `definirSenhaProvisoria` no repositório**

No fim de `usuario-admin-repository.ts` (usa service-role, escopo por id):

```ts
/**
 * Liga/desliga a marca de "senha provisória". `false` = a pessoa já definiu a
 * própria senha; `true` = o gestor resetou e ela terá de trocar no próximo
 * acesso. Via service-role porque o operador comum não tem `administrar` e
 * ainda assim precisa limpar a própria marca ao trocar a senha.
 */
export async function definirSenhaProvisoria(id: string, valor: boolean): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase.from('usuarios').update({ senha_provisoria: valor }).eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Ajustar o tipo e `criarUsuario`**

Em `actions.ts`, trocar o tipo:

```ts
export type ResultadoAcaoUsuario = { ok: true; senhaTemporaria?: string } | { erro: string }
```

Atualizar os imports do repo (adicionar `definirSenhaProvisoria`) e do domínio:

```ts
import {
  atualizarSenha,
  atualizarUsuario,
  buscarUsuario,
  criarUsuarioAuth,
  definirSenhaProvisoria,
  excluirUsuarioAuth,
} from '../infra/usuario-admin-repository'
import { gerarSenhaTemporaria, validarForcaSenha } from '../domain/senha'
import { createServerSupabase } from '@/shared/lib/supabase/server'
```

Em `criarUsuario`: remover a leitura e a validação de `senha` do form, gerar a temporária, e devolvê-la. Trocar o bloco:

```ts
  const nome = String(formData.get('nome') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const senha = String(formData.get('senha') ?? '')
  const perfilId = String(formData.get('perfilId') ?? '').trim()

  if (!nome) return { erro: 'Informe um nome.' }
  if (!email || !email.includes('@')) return { erro: 'Informe um e-mail válido.' }
  if (senha.length < 6) return { erro: 'A senha deve ter ao menos 6 caracteres.' }
  if (!perfilId) return { erro: 'Selecione um perfil.' }
```

por:

```ts
  const nome = String(formData.get('nome') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const perfilId = String(formData.get('perfilId') ?? '').trim()

  if (!nome) return { erro: 'Informe um nome.' }
  if (!email || !email.includes('@')) return { erro: 'Informe um e-mail válido.' }
  if (!perfilId) return { erro: 'Selecione um perfil.' }

  // Senha temporária gerada pelo sistema (a conta nasce provisória por default
  // da coluna). Devolvida uma vez pro gestor entregar; a pessoa troca no 1º acesso.
  const senha = gerarSenhaTemporaria()
```

E trocar o `return { ok: true }` final de `criarUsuario` por:

```ts
  return { ok: true, senhaTemporaria: senha }
```

- [ ] **Step 3: `resetarSenha` no lugar de `redefinirSenha`**

Substituir a função `redefinirSenha` inteira por:

```ts
export async function resetarSenha(id: string): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const temporaria = gerarSenhaTemporaria()
  try {
    await atualizarSenha(id, temporaria)
    await definirSenhaProvisoria(id, true)
  } catch (e) {
    return { erro: traduzirErroAdminApi(e) }
  }

  // Nunca registrar o valor da senha no log de auditoria.
  await registrarLog({
    entidade: 'usuario',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: 'Senha resetada (temporária) — troca obrigatória no próximo acesso',
  })

  revalidatePath('/configuracoes/usuarios')
  return { ok: true, senhaTemporaria: temporaria }
}
```

- [ ] **Step 4: `definirNovaSenha` (troca pela própria pessoa)**

Adicionar ao fim de `actions.ts`:

```ts
export async function definirNovaSenha(nova: string): Promise<ResultadoAcaoUsuario> {
  const sessao = await getSessao()
  if (!sessao) return { erro: 'Sessão expirada. Entre novamente.' }

  const forca = validarForcaSenha(nova)
  if (!forca.ok) return { erro: forca.erro! }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.updateUser({ password: nova })
  if (error) return { erro: traduzirErroAdminApi(error) }

  try {
    await definirSenhaProvisoria(sessao.usuarioId, false)
  } catch {
    return { erro: 'Senha alterada, mas houve um problema. Fale com o gestor.' }
  }

  await registrarLog({
    entidade: 'usuario',
    entidadeId: sessao.usuarioId,
    acao: 'alterar_campo',
    descricao: 'Senha definida pelo próprio usuário',
  })

  return { ok: true }
}
```

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros. (Vai quebrar o import de `redefinirSenha` no form — isso é corrigido na Task 4; se o tsc reclamar SÓ disso, tudo bem seguir; o commit desta task pode ser feito e o build completo fica pra Task 4. Para não deixar o tsc vermelho entre tasks, faça o commit e siga direto pra Task 4.)

```bash
git add src/modules/usuarios/infra/usuario-admin-repository.ts src/modules/usuarios/application/actions.ts
git commit -F - << 'EOF'
feat(usuarios): actions de senha temporária (criar/resetar) + troca própria

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

> **Nota ao controller:** Tasks 2, 3 e 4 juntas formam um estado compilável. O `tsc` só fica 100% verde ao fim da Task 4 (quando o form para de importar `redefinirSenha`). Revise as três antes do build final.

---

### Task 3: Enforcement — middleware + tela `/definir-senha`

**Files:**
- Modify: `src/shared/lib/supabase/middleware.ts`
- Create: `src/app/definir-senha/page.tsx`
- Create: `src/app/definir-senha/definir-senha-form.tsx`

**Interfaces:**
- Consumes: `definirNovaSenha` (Task 2); `getSessao`.

- [ ] **Step 1: Middleware carrega `senha_provisoria` e redireciona**

Em `src/shared/lib/supabase/middleware.ts`, trocar o SELECT:

```ts
    const { data: appUser } = await supabase
      .from('usuarios')
      .select('ativo, perfil_id')
      .eq('id', user.id)
      .maybeSingle()
    appUserValido = appUser?.ativo === true && !!appUser?.perfil_id
```

por (adiciona `senha_provisoria` e uma flag):

```ts
    const { data: appUser } = await supabase
      .from('usuarios')
      .select('ativo, perfil_id, senha_provisoria')
      .eq('id', user.id)
      .maybeSingle()
    appUserValido = appUser?.ativo === true && !!appUser?.perfil_id
    senhaProvisoria = appUser?.senha_provisoria === true
```

Declarar a flag junto de `appUserValido`:

```ts
  let appUserValido = false
  let senhaProvisoria = false
```

E, na parte final, trocar:

```ts
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  // ... redirectTo ...
  if (!appUserValido && !isAuthRoute) return redirectTo('/login')
  if (appUserValido && isAuthRoute) return redirectTo('/home')

  return response
```

por:

```ts
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  const isDefinirSenha = request.nextUrl.pathname.startsWith('/definir-senha')
  // ... redirectTo (inalterado) ...
  if (!appUserValido && !isAuthRoute) return redirectTo('/login')
  if (appUserValido && isAuthRoute) return redirectTo('/home')
  // Conta com senha provisória fica presa em /definir-senha até trocar.
  if (appUserValido && senhaProvisoria && !isDefinirSenha) return redirectTo('/definir-senha')
  // Quem já trocou não deve mais ver a tela de definição.
  if (appUserValido && !senhaProvisoria && isDefinirSenha) return redirectTo('/home')

  return response
```

(O `redirectTo` e o bloco de leitura de `appUser` continuam iguais; só o SELECT, as duas flags e os dois novos `if` mudam.)

- [ ] **Step 2: Página `/definir-senha` (server)**

`src/app/definir-senha/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { DefinirSenhaForm } from './definir-senha-form'

export default async function DefinirSenhaPage() {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Defina sua senha</h1>
        <p className="text-sm text-muted-foreground">
          Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.
        </p>
      </div>
      <DefinirSenhaForm />
    </main>
  )
}
```

- [ ] **Step 3: Form `/definir-senha` (client)**

`src/app/definir-senha/definir-senha-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { definirNovaSenha } from '@/modules/usuarios/application/actions'

export function DefinirSenhaForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (nova !== confirma) {
      setErro('As senhas não coincidem.')
      return
    }
    startTransition(async () => {
      const resultado = await definirNovaSenha(nova)
      if ('erro' in resultado) {
        setErro(resultado.erro)
      } else {
        router.push('/home')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nova">Nova senha</Label>
        <Input
          id="nova"
          type="password"
          placeholder="Mínimo 8 caracteres"
          minLength={8}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirma">Confirmar senha</Label>
        <Input
          id="confirma"
          type="password"
          minLength={8}
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
          required
        />
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Salvando...' : 'Definir senha e entrar'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/lib/supabase/middleware.ts src/app/definir-senha
git commit -F - << 'EOF'
feat(usuarios): barra conta provisória e leva pra tela de definir senha

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Tela de Usuários — mostrar a temporária uma vez

**Files:**
- Modify: `src/app/(app)/configuracoes/usuarios/usuario-form.tsx`

**Interfaces:**
- Consumes: `criarUsuario` (devolve `senhaTemporaria`), `resetarSenha(id)` (Task 2).

- [ ] **Step 1: Trocar imports (some `redefinirSenha`, entra `resetarSenha`)**

```tsx
import {
  criarUsuario,
  editarUsuario,
  resetarSenha,
  alternarAtivo,
} from '@/modules/usuarios/application/actions'
```

- [ ] **Step 2: No `UsuarioForm`, tirar o campo de senha e mostrar a temporária no sucesso do cadastro**

Remover o bloco do campo senha (dentro do `{!ehEdicao && (<> ... </>)}`):

```tsx
              <div className="flex flex-col gap-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  name="senha"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
```

(fica só o campo de e-mail dentro do fragmento.)

Trocar a lógica de fechar no sucesso — em vez de fechar o dialog no cadastro, mostrar a temporária. Substituir:

```tsx
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) setOpen(false)
  }
```

por:

```tsx
  // No cadastro, o sucesso traz a senha temporária — mantemos o dialog aberto
  // para mostrá-la uma vez. Na edição (sem temporária), fecha como antes.
  const [senhaTemp, setSenhaTemp] = useState<string | null>(null)
  const [estadoProcessado, setEstadoProcessado] = useState(state)
  if (state !== estadoProcessado) {
    setEstadoProcessado(state)
    if (state && 'ok' in state && state.ok) {
      if (state.senhaTemporaria) setSenhaTemp(state.senhaTemporaria)
      else setOpen(false)
    }
  }
```

Ao fechar o dialog, limpar a temporária — trocar o `<Dialog open={open} onOpenChange={setOpen}>` por:

```tsx
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
        if (!novoAberto) setSenhaTemp(null)
      }}
    >
```

Dentro do `<DialogContent>`, renderizar o painel da temporária quando existir, no lugar do form. Trocar o `<form ...> ... </form>` para ficar condicionado (`{!senhaTemp ? (<form>...</form>) : (<painel>)}`). O painel:

```tsx
          {senhaTemp ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Usuário criado. Entregue a senha temporária abaixo — ela{' '}
                <strong>não será exibida de novo</strong>. No primeiro acesso, a pessoa vai
                definir a própria senha.
              </p>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
                <code className="font-mono text-base">{senhaTemp}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard?.writeText(senhaTemp)}
                >
                  Copiar
                </Button>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  className="bg-enterplak hover:bg-enterplak-700"
                  onClick={() => setOpen(false)}
                >
                  Concluir
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              {/* ...todo o conteúdo do form que já existe... */}
            </form>
          )}
```

- [ ] **Step 3: `RedefinirSenhaButton` → reset gera a temporária e a mostra**

Substituir o corpo do componente `RedefinirSenhaButton` para não pedir senha digitada; ao confirmar, chama `resetarSenha(id)` e exibe a temporária devolvida:

```tsx
export function RedefinirSenhaButton({ id, nome }: RedefinirSenhaButtonProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [senhaTemp, setSenhaTemp] = useState<string | null>(null)

  function resetar() {
    setErro(null)
    startTransition(async () => {
      const resultado = await resetarSenha(id)
      if ('erro' in resultado) setErro(resultado.erro)
      else setSenhaTemp(resultado.senhaTemporaria ?? null)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(novoAberto) => {
        setOpen(novoAberto)
        if (!novoAberto) {
          setErro(null)
          setSenhaTemp(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Resetar senha de ${nome}`}>
            <KeyRoundIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resetar senha de {nome}</DialogTitle>
        </DialogHeader>
        {senhaTemp ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Senha temporária gerada. Entregue-a — ela{' '}
              <strong>não será exibida de novo</strong>. {nome} vai definir a própria senha no
              próximo acesso.
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <code className="font-mono text-base">{senhaTemp}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(senhaTemp)}
              >
                Copiar
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="bg-enterplak hover:bg-enterplak-700"
                onClick={() => setOpen(false)}
              >
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Isto gera uma nova senha temporária para {nome}. A senha atual deixa de valer e a
              pessoa terá de definir uma nova no próximo acesso.
            </p>
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <DialogFooter>
              <Button
                type="button"
                disabled={pending}
                className="bg-enterplak hover:bg-enterplak-700"
                onClick={resetar}
              >
                {pending ? 'Gerando...' : 'Gerar senha temporária'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

(Remover o `Input`/`Label` de senha e o `senha`/`setSenha` que sobraram; o import de `Input`/`Label` continua sendo usado pelo `UsuarioForm`, então não os apague dos imports.)

- [ ] **Step 4: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros (só o warning `<img>`).

```bash
git add "src/app/(app)/configuracoes/usuarios/usuario-form.tsx"
git commit -F - << 'EOF'
feat(usuarios): cadastro/reset mostram a senha temporária uma vez

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verificação final

**Files:** nenhum (só verificação; a migração é aplicada pelo CONTROLLER, não pelo subagente).

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde (só warning `<img>`).

- [ ] **Step 2: Aplicação da migração 0024 (CONTROLLER) — antes do smoke**

O controller aplica `0024_senha_provisoria.sql` na prod (dado só de teste) e recarrega o schema. Confirmar depois: `select senha_provisoria, count(*) from usuarios group by 1;` → as contas existentes devem estar `false`.

- [ ] **Step 3: Smoke (usuário) — NÃO fazer push**

1. **Criar usuário:** o form não pede mais senha; ao salvar, aparece a **senha temporária** com botão Copiar e o aviso "não será exibida de novo".
2. **1º acesso:** logar (em aba anônima) com email + a temporária → cai em **/definir-senha** e não consegue navegar pra mais nada (tentar `/home` volta pra lá).
3. **Definir a senha** (≥8, confirmar) → entra normal; recarregar/navegar não volta mais pra /definir-senha.
4. **Reset (gestor):** botão da chave → "Gerar senha temporária" → mostra a nova temporária uma vez; a conta volta a ser barrada no próximo acesso daquela pessoa.
5. **Conta existente (admin):** continua entrando direto, **sem** ser mandada pra /definir-senha.

- [ ] **Step 4: NÃO fazer push** — commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review)

- **Cobertura da spec:** temp por pessoa gerada + mostrada uma vez (T2/T4) ✅; marca provisória default true + backfill false (T1) ✅; troca obrigatória via middleware→/definir-senha (T3) ✅; reset pelo gestor gera temp e remarca (T2/T4) ✅; mínimo 8 (T1 `validarForcaSenha`, usado em `definirNovaSenha`) ✅; contas atuais não afetadas (backfill) ✅.
- **Tipos:** `ResultadoAcaoUsuario` ganha `senhaTemporaria?` (retrocompatível com `editar`/`alternarAtivo`, que seguem devolvendo `{ ok: true }`). `resetarSenha(id)` e `definirNovaSenha(nova)` com assinaturas usadas na T3/T4.
- **Segurança:** `senha_provisoria=false` só pela própria pessoa (service-role escopado a `sessao.usuarioId`) ou reset (`=true`); nunca em `atualizarUsuario`. Senha nunca logada.
- **Ordem de compilação:** T2 quebra o import de `redefinirSenha` no form; T4 conserta. O build só é exigido verde na T4/T5 (nota ao controller na T2).
- **Sem placeholders:** todo passo traz o código completo; "antes" lido do arquivo real.
