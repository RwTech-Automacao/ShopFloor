# Excluir listas suspensas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir excluir qualquer lista suspensa (remover a trava de "sistema"), bloqueando apenas a exclusão de lista em uso por um campo, com aviso claro.

**Architecture:** Uma migração afrouxa o RLS `listas_delete` (tira `sistema=false`). O repository ganha uma checagem de uso (`camposQueUsamLista`), a Server Action bloqueia a exclusão de lista em uso com mensagem nomeando o campo, e a UI para de desabilitar o botão nas listas de sistema. Sem novas dependências.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase (Postgres + RLS), Tailwind/base-ui, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **Permissão:** exclusão de lista continua gated por `administrar` (RLS + action). Sem permissão nova.
- **Proteção que fica:** lista **em uso** por um campo (`configuracao_campos.lista_chave`) NÃO pode ser excluída (a FK garante; o app dá a mensagem amigável). "Forçar exclusão" foi rejeitado.
- **ENTREGA SEGURADA (pedido do usuário):** **NÃO fazer push** e **NÃO aplicar a migração 0019** em produção nesta sessão. Tudo é **commitado localmente**; a aplicação da migração + o push acontecem juntos quando o usuário liberar. Os implementadores só commitam local, nunca aplicam migração nem dão push.
- **Verificação (sem TDD):** cada task termina com `npx tsc --noEmit` + `npm run build` verdes; `npm run test` no final. O smoke real fica pendente (depende da migração aplicada, que está segurada).

---

### Task 1: Migração 0019 (RLS `listas_delete` sem `sistema=false`)

**Files:**
- Create: `supabase/migrations/0019_listas_delete_sem_sistema.sql`

**Interfaces:**
- Produces: policy `listas_delete` recriada exigindo só `tem_permissao('administrar')`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/0019_listas_delete_sem_sistema.sql`:

```sql
-- Permite excluir qualquer lista suspensa (remove a trava de "sistema" no RLS).
-- A proteção contra apagar lista EM USO continua garantida pela FK
-- configuracao_campos.lista_chave -> listas(chave) (sem cascade) + a checagem
-- amigável na Server Action excluirListaAction.
drop policy listas_delete on public.listas;
create policy listas_delete on public.listas
  for delete to authenticated
  using (public.tem_permissao('administrar'));
```

- [ ] **Step 2: NÃO aplicar — commitar apenas (entrega segurada)**

NÃO rode `supabase db push` nem qualquer comando que toque o banco. A migração fica **apenas commitada localmente**; a aplicação em produção é feita pelo controller **quando o usuário liberar** (junto com o push). NÃO faça `git push`.

```bash
git add supabase/migrations/0019_listas_delete_sem_sistema.sql
git commit -m "feat(listas): migração 0019 — RLS de exclusão sem trava de sistema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Infra `camposQueUsamLista` + bloqueio na Server Action

**Files:**
- Modify: `src/modules/listas/infra/lista-repository.ts`
- Modify: `src/modules/listas/application/actions.ts`

**Interfaces:**
- Consumes: `buscarListaPorId(id): Promise<ListaRow | null>` (já existe; `ListaRow` tem `chave`), `excluirLista(id)`, `ERRO_LISTA_BLOQUEADA_EXCLUSAO` (já existem).
- Produces: `camposQueUsamLista(chave: string): Promise<string[]>` — rótulos dos campos que usam a lista.

- [ ] **Step 1: Adicionar `camposQueUsamLista` ao repository**

Em `src/modules/listas/infra/lista-repository.ts`, adicionar a função (ex.: logo após `excluirLista`):

```ts
/**
 * Rótulos dos campos (`configuracao_campos`) que usam esta lista, pela `chave`.
 * Vazio = a lista não está em uso e pode ser excluída. Usado para bloquear a
 * exclusão de uma lista amarrada a um campo (que esvaziaria o dropdown / — no
 * caso da lista `resultado` — quebraria os status).
 */
export async function camposQueUsamLista(chave: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select('rotulo')
    .eq('lista_chave', chave)
    .order('rotulo', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { rotulo: string }[]).map((r) => r.rotulo)
}
```

- [ ] **Step 2: Bloquear exclusão de lista em uso na Server Action**

Em `src/modules/listas/application/actions.ts`:

1. Adicionar `camposQueUsamLista` ao import do repository (junto de `buscarListaPorId`, `excluirLista as excluirListaRepo`, `ERRO_LISTA_BLOQUEADA_EXCLUSAO`):

```ts
import {
  atualizarItem,
  buscarItem,
  buscarListaPorId,
  camposQueUsamLista,
  criarItem,
  criarLista,
  excluirItem as excluirItemRepo,
  excluirLista as excluirListaRepo,
  ERRO_LISTA_BLOQUEADA_EXCLUSAO,
} from '../infra/lista-repository'
```

2. Substituir o corpo de `excluirListaAction` por (adiciona a checagem de uso após o `alvo` e simplifica o catch):

```ts
export async function excluirListaAction(id: string): Promise<ResultadoAcaoLista> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const alvo = await buscarListaPorId(id)
  if (!alvo) return { erro: 'Lista não encontrada.' }

  // Lista em uso por um campo não pode ser excluída (esvaziaria o dropdown; se
  // for a lista `resultado`, quebraria os status). Bloqueia com aviso nomeando
  // o(s) campo(s) — em vez do erro cru de FK do banco.
  const usos = await camposQueUsamLista(alvo.chave)
  if (usos.length > 0) {
    return {
      erro: `Esta lista é usada pelo(s) campo(s): ${usos.join(', ')}. Remova a associação antes de excluir.`,
    }
  }

  try {
    await excluirListaRepo(id)
  } catch (e) {
    // ERRO_LISTA_BLOQUEADA_EXCLUSAO (0 linhas) agora só ocorre por RLS/permissão
    // ou lista já removida; e um erro de FK (corrida) também cai aqui. Mensagem
    // genérica em qualquer caso — a lista não foi apagada.
    void e
    return { erro: 'Não foi possível excluir a lista.' }
  }

  await registrarLog({
    entidade: 'lista',
    entidadeId: id,
    acao: 'excluir',
    descricao: `Lista "${alvo.nome}" excluída`,
  })

  revalidatePath('/configuracoes/listas')
  return { ok: true }
}
```

Nota: `ERRO_LISTA_BLOQUEADA_EXCLUSAO` continua importado e usado pelo `excluirLista` do repository (não removê-lo do import se outra parte do arquivo o usar; se o `catch` deixar de referenciá-lo e o lint acusar import não usado, remover **apenas** de `actions.ts`, mantendo a constante no repository). Verifique com o lint.

- [ ] **Step 3: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros. (Se o lint acusar `ERRO_LISTA_BLOQUEADA_EXCLUSAO` importado e não usado em `actions.ts`, remover esse nome do import de `actions.ts` — a constante permanece no repository, usada por `excluirLista`.)

- [ ] **Step 4: Commit (local, sem push)**

```bash
git add src/modules/listas/infra/lista-repository.ts src/modules/listas/application/actions.ts
git commit -m "feat(listas): bloqueia exclusão de lista em uso por campo (aviso amigável)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI — habilitar o botão de excluir em listas de sistema

**Files:**
- Modify: `src/app/(app)/configuracoes/listas/lista-form.tsx`
- Modify: `src/app/(app)/configuracoes/listas/page.tsx`

**Interfaces:**
- Consumes: `excluirListaAction` (comportamento inalterado — agora bloqueia lista em uso via mensagem).

- [ ] **Step 1: Remover a trava `sistema` do botão**

Em `src/app/(app)/configuracoes/listas/lista-form.tsx`:

1. Na interface `ExcluirListaButtonProps`, remover a linha `sistema: boolean` (fica só `id: string` e `nome: string`):

```ts
interface ExcluirListaButtonProps {
  id: string
  nome: string
}
```

2. Na assinatura do componente, tirar `sistema` da desestruturação:

```ts
export function ExcluirListaButton({ id, nome }: ExcluirListaButtonProps) {
```

3. No `<Button>`, trocar `disabled={sistema || pending}` por `disabled={pending}`:

```tsx
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir lista"
        disabled={pending}
        onClick={onClick}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
```

(O `onClick`, o `window.confirm`, o estado `pending`/`erro` e o parágrafo de erro inline ficam iguais.)

- [ ] **Step 2: Parar de passar `sistema` ao botão no `page.tsx`**

Em `src/app/(app)/configuracoes/listas/page.tsx`, nas **duas** ocorrências de `<ExcluirListaButton ... />` (tabela desktop e cards mobile), remover a prop `sistema={lista.sistema}`:

```tsx
<ExcluirListaButton id={lista.id} nome={lista.nome} />
```

**MANTER** o `<Badge>Sistema</Badge>` (que lê `lista.sistema` diretamente, separado do botão) — ele continua marcando as listas do seed como informação.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; nenhuma referência dangling a `sistema` no `ExcluirListaButton`.

- [ ] **Step 4: Commit (local, sem push)**

```bash
git add "src/app/(app)/configuracoes/listas/lista-form.tsx" "src/app/(app)/configuracoes/listas/page.tsx"
git commit -m "feat(listas): botão de excluir habilitado também em listas de sistema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verificação final (SEM push, SEM aplicar migração)

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde (os testes existentes seguem passando — nada de teste novo nesta feature).

- [ ] **Step 2: Confirmar que NADA foi para produção**

- NÃO rodar `supabase db push` (a migração 0019 fica só local).
- NÃO rodar `git push`.
- O smoke real fica **pendente** até o usuário liberar (a exclusão depende da migração aplicada). Registrar como pendente.

Smoke a fazer **quando liberado** (migração aplicada), com `administrar`:
1. Criar uma lista nova (não usada por campo) e excluí-la → funciona (os itens caem por cascade).
2. Tentar excluir a lista `resultado` (ou `tipo`) → aviso "Esta lista é usada pelo(s) campo(s): …", sem apagar.
3. Confirmar que os status e os dropdowns continuam intactos.

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Remover trava `sistema` do RLS → Task 1. ✅
- Checagem de uso + bloqueio com aviso nomeando campo → Task 2 (`camposQueUsamLista` + action). ✅
- Mensagem obsoleta "Listas do sistema…" removida → Task 2 (catch simplificado). ✅
- UI: botão habilitado em listas de sistema; badge mantido → Task 3. ✅
- Permissão `administrar` inalterada → Task 1 (RLS) + action (gate existente). ✅
- Entrega segurada (sem push, sem aplicar migração) → Global Constraints + Task 1/4. ✅

**Consistência de tipos:** `camposQueUsamLista(chave: string): Promise<string[]>` (Task 2 infra) é consumida na mesma Task 2 (action); `ListaRow.chave` (existente) alimenta a chamada; `ExcluirListaButtonProps` sem `sistema` (Task 3) casa com as chamadas de `page.tsx` sem a prop. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
