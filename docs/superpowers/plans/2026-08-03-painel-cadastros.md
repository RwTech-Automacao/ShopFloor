# Painel de Resultado nos cadastros — Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nos 3 cadastros do ShopFloor (OP, Posto, Defeito): erro → `PainelResultado` no diálogo; sucesso/exclusão → `PainelResultado` na lista.

**Architecture:** Reusa `PainelResultado`/`ResultadoAcao` (Fase 1). A **Lista** de cada cadastro guarda `resultado` e mostra o painel no topo; os **forms** ganham `onSucesso`, o **excluir** ganha `onResultado`; as actions retornam o **identificador** no sucesso (pra mensagem). Sem migração.

**Tech Stack:** Next.js 16 (App Router, Server Actions, useActionState), React 19, TS strict.

## Global Constraints
- Reusar `import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'`.
- Callbacks **opcionais**: `onSucesso?: (r: ResultadoAcao) => void`, `onResultado?: (r: ResultadoAcao) => void` (sem eles, o comportamento antigo — só fecha).
- **Padrão de fluxo** (salvar/puxar) segue com toast — NÃO mexer.
- PT-BR; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task.**

## File Structure
- **OP:** `ordens-actions.ts`, `ordem-form.tsx`, `excluir-ordem-botao.tsx`, `ordens-lista.tsx`, `ordens/page.tsx`.
- **Posto:** `sf-postos-actions.ts`, `posto-form.tsx`, `postos-lista.tsx`.
- **Defeito:** `defeito-actions` (`sf-defeitos-actions.ts` ou onde estiver), `defeitos-form.tsx`, `defeitos-lista.tsx`.

---

## Task 1: Cadastro de OP

**Files:** `ordens-actions.ts`, `ordem-form.tsx`, `excluir-ordem-botao.tsx`, `ordens-lista.tsx`, `ordens/page.tsx`.

- [ ] **Step 1: `ordens-actions.ts` — retornar pmo/op no sucesso**

`ResultadoOrdem` (sucesso) passa a incluir `pmo`/`op`: `type ResultadoOrdem = { ok: true; id?: string; pmo?: string; op?: string } | { ok: false; erro: string }`. Em `criarOrdemAction`/`editarOrdemAction`, no `return { ok: true, id }` acrescentar `pmo: dados.pmo, op: dados.op`.

- [ ] **Step 2: `ordem-form.tsx` — `onSucesso` + erro no painel**

Assinatura ganha `onSucesso?: (r: ResultadoAcao) => void`. Import do `PainelResultado`/`ResultadoAcao`.
No bloco que detecta o resultado (`if (state !== processado) { … if (state?.ok) setOpen(false) }`), no sucesso chamar antes de fechar:
```ts
if (state?.ok) {
  onSucesso?.({ tipo: 'ok', titulo: ehEdicao ? `OP ${state.pmo}/${state.op} editada` : `OP ${state.pmo}/${state.op} criada` })
  setOpen(false)
}
```
Trocar o inline error (`{mostrarErro && state && !state.ok && <p className="text-sm text-red-600">{state.erro}</p>}`) por:
```tsx
{mostrarErro && state && !state.ok && <PainelResultado resultado={{ tipo: 'erro', titulo: state.erro }} />}
```

- [ ] **Step 3: `excluir-ordem-botao.tsx` — `onResultado`**

Assinatura ganha `onResultado?: (r: ResultadoAcao) => void`. Trocar `toast.success('OP excluída.')` por `onResultado?.({ tipo: 'ok', titulo: `OP ${rotulo} excluída` })` e `toast.error(r.erro)` por `onResultado?.({ tipo: 'erro', titulo: r.erro })`. (Remover import de `toast` se ficar órfão.)

- [ ] **Step 4: `ordens-lista.tsx` — resultado + painel + Nova OP**

Import `PainelResultado`/`ResultadoAcao`; `const [resultado, setResultado] = useState<ResultadoAcao | null>(null)`. Renderizar `<PainelResultado resultado={resultado} />` no topo (acima dos filtros/tabela). Renderizar a **Nova OP** aqui (movida da página) junto do botão/topo:
```tsx
<OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} onSucesso={setResultado} />
```
Nas linhas: passar `onSucesso={setResultado}` ao `<OrdemForm ordem={o} …>` e `onResultado={setResultado}` ao `<ExcluirOrdemBotao …>`.

- [ ] **Step 5: `ordens/page.tsx` — só a lista**

Remover o `<OrdemForm>` "Nova OP" standalone; passar suas props pra `<OrdensLista>` (ela já recebe a maioria — garantir `postos`/`chavesPostos`, `padroes`, `pmosExistentes`, `clientesExistentes`, `dadosPorPmo`). A página passa a renderizar só o cabeçalho + `<OrdensLista …/>`.

- [ ] **Step 6: Build + lint + testes** → verdes.

- [ ] **Step 7: Commit**
```bash
git add src/modules/shopfloor/application/ordens-actions.ts "src/app/(app)/shopfloor/ordens/ordem-form.tsx" "src/app/(app)/shopfloor/ordens/excluir-ordem-botao.tsx" "src/app/(app)/shopfloor/ordens/ordens-lista.tsx" "src/app/(app)/shopfloor/ordens/page.tsx"
git commit -m "feat(shopfloor): Cadastro de OP usa PainelResultado (erro no diálogo, sucesso na lista)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Cadastrar Posto

**Files:** `sf-postos-actions.ts`, `posto-form.tsx`, `postos-lista.tsx`.

- [ ] **Step 1: `sf-postos-actions.ts` — retornar o nome no sucesso**

`ResultadoAcaoPosto` sucesso passa a `{ ok: true; nome?: string }`. Em `cadastrarPostoAction`/`atualizarPostoAction`, `return { ok: true }` → `return { ok: true, nome: chave }` (o `chave`/nome do posto). `excluirPostoAction` idem se tiver o nome à mão; senão a lista já sabe o nome pra mensagem de exclusão.

- [ ] **Step 2: `posto-form.tsx`**

`PostoForm`/`EditarPostoButton` ganham `onSucesso?`. No `if (state && 'ok' in state && state.ok) setOpen(false)`, no sucesso chamar `onSucesso?.({ tipo: 'ok', titulo: `Posto ${state.nome ?? ''} criado` })` (editar → `editado`) antes de fechar. Trocar o inline error (`{state && 'erro' in state && <p className="text-sm text-red-600">{state.erro}</p>}`) por `<PainelResultado resultado={{ tipo: 'erro', titulo: state.erro }} />` (nas duas variantes). `ExcluirPostoButton` ganha `onResultado?` e troca os toasts por `onResultado?.(...)` (sucesso "Posto {chave} excluído"; erro r.erro — usar o `chave` que já recebe).

- [ ] **Step 3: `postos-lista.tsx`**

`resultado` state + `<PainelResultado>` no topo; passar `onSucesso={setResultado}` ao `<PostoForm>` (Novo) e aos `<EditarPostoButton>`, e `onResultado={setResultado}` aos `<ExcluirPostoButton>` (passar também o nome/`chave` se preciso pra mensagem).

- [ ] **Step 4: Build + lint + testes** → verdes.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/application/sf-postos-actions.ts "src/app/(app)/configuracoes/sf-postos/posto-form.tsx" "src/app/(app)/configuracoes/sf-postos/postos-lista.tsx"
git commit -m "feat(shopfloor): Cadastrar Posto usa PainelResultado (erro no diálogo, sucesso na lista)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cadastrar Defeito

**Files:** actions do defeito, `defeitos-form.tsx`, `defeitos-lista.tsx`.

- [ ] **Step 1: action do defeito — retornar o código no sucesso**

O resultado de criar defeito passa a incluir `codigo?` no sucesso (`return { ok: true, codigo }`).

- [ ] **Step 2: `defeitos-form.tsx`**

`DefeitoForm` ganha `onSucesso?`. No sucesso, `onSucesso?.({ tipo: 'ok', titulo: `Defeito ${codigo} criado` })` + fecha. Trocar o inline error (`{state && 'erro' in state && <p className="text-sm text-red-600">{state.erro}</p>}`) por `<PainelResultado resultado={{ tipo: 'erro', titulo: state.erro }} />`. `ExcluirDefeitoButton` ganha `onResultado?` e troca toasts por `onResultado?.(...)` ("Defeito {codigo} excluído" / erro).

- [ ] **Step 3: `defeitos-lista.tsx`**

`resultado` state + `<PainelResultado>` no topo; passar `onSucesso`/`onResultado` ao `<DefeitoForm>` e aos `<ExcluirDefeitoButton>`.

- [ ] **Step 4: Build + lint + testes** → verdes. Grep: sem toast órfão nos 3 cadastros (fora o padrão de fluxo).

- [ ] **Step 5: Commit**
```bash
git add <arquivos do defeito>
git commit -m "feat(shopfloor): Cadastrar Defeito usa PainelResultado (erro no diálogo, sucesso na lista)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)
1. **OP:** criar → diálogo fecha e painel verde "OP …/… criada" na lista; criar duplicada → painel vermelho **no diálogo**; editar → "editada"; excluir → "excluída" na lista.
2. **Posto:** criar/editar/excluir → painel na lista; posto em uso ao excluir → painel vermelho.
3. **Defeito:** criar/excluir → painel na lista; código duplicado → painel no diálogo.
4. **Dark mode** e persistência (painel fica até a próxima ação).

## Self-Review
- **Cobertura:** OP → T1; Posto → T2; Defeito → T3. ✔
- **Callbacks opcionais** (compat). ✔
- **Reuso** do `PainelResultado`/`ResultadoAcao`. ✔
- **Padrão de fluxo** intocado. ✔
