# Modais de confirmação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os 7 `window.confirm` nativos por um modal de confirmação com a identidade Enterplak.

**Architecture:** Um hook `useConfirmacao` embrulha o `Dialog` já existente e devolve `confirmar()` que retorna uma `Promise<boolean>` — assim cada tela troca ~1 linha (o `window.confirm` vira `await confirmar`) e renderiza o `{dialog}` que o hook fornece. Sem TDD (é estado de UI), sem servidor, sem migração.

**Tech Stack:** Next.js 16 (client components), TypeScript strict (`noUncheckedIndexedAccess`), base-ui Dialog, sonner.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs`." Next 16.
- **Escopo travado: só os 7 `window.confirm`.** Não adicionar confirmação onde hoje não há.
- **Aparência sóbria:** botão confirmar em **vinho Enterplak** (`bg-enterplak hover:bg-enterplak-700`), Cancelar `variant="outline"`. **Sem vermelho, sem ícone de alerta.**
- **As mensagens ficam com cada tela** (o texto atual é bom). O hook só recebe `titulo`/`descricao`.
- **Sem TDD** — não há domínio puro. Garantia por `tsc` + `lint` + `build` + smoke.
- **Reusar** `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter` de `@/components/ui/dialog` (o `DialogContent` já traz o X de fechar; base-ui exige `Title`+`Description` para acessibilidade → sempre renderizar os dois).
- **`Dialog` (base-ui Root) aceita `open`/`onOpenChange`.**
- TS strict `noUncheckedIndexedAccess`. Componentes client começam com `'use client'`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **Subagentes NÃO dão `git push`.**
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`. (Se o build der `heap out of memory`, mate o `next dev` ou use `NODE_OPTIONS="--max-old-space-size=4096"`.)

## File Structure

- **Create** `src/components/ui/confirm-dialog.tsx` — `useConfirmacao` + `ConfirmDialog` interno.
- **Modify** (as 7 telas, todas client, todas já importam `Button`):
  - `src/app/(app)/configuracoes/criticidade/criticidade-form.tsx` (`ExcluirCriticidadeButton`)
  - `src/app/(app)/configuracoes/listas/lista-form.tsx` (`ExcluirListaButton`)
  - `src/app/(app)/configuracoes/listas/item-form.tsx` (`ExcluirItemButton`)
  - `src/app/(app)/configuracoes/perfis/perfil-form.tsx` (`ExcluirPerfilButton`)
  - `src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx` (`aoRemover`)
  - `src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx` (`limpar`)
  - `src/app/(app)/recebimento/importar/wizard-importacao.tsx` (`onExcluirPadrao`)

---

### Task 1: O hook `useConfirmacao`

**Files:**
- Create: `src/components/ui/confirm-dialog.tsx`

**Interfaces:**
- Produces:
  - `interface OpcoesConfirmacao { titulo: string; descricao?: string; rotuloConfirmar?: string; rotuloCancelar?: string }`
  - `useConfirmacao(): { confirmar: (opcoes: OpcoesConfirmacao) => Promise<boolean>; dialog: React.ReactNode }`

- [ ] **Step 1: Criar o componente**

Criar `src/components/ui/confirm-dialog.tsx`:

```tsx
'use client'

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface OpcoesConfirmacao {
  titulo: string
  descricao?: string
  /** Texto do botão que confirma a ação. Padrão: 'Excluir'. */
  rotuloConfirmar?: string
  /** Texto do botão que cancela. Padrão: 'Cancelar'. */
  rotuloCancelar?: string
}

interface UseConfirmacao {
  /** Abre o modal e resolve `true` (confirmou) ou `false` (cancelou/fechou). */
  confirmar: (opcoes: OpcoesConfirmacao) => Promise<boolean>
  /** Renderize UMA vez no JSX do componente — é o modal controlado pelo hook. */
  dialog: React.ReactNode
}

/**
 * Substitui o `window.confirm` nativo por um modal com a cara do sistema, mantendo a
 * ergonomia síncrona: `if (!(await confirmar({ ... }))) return`. A quebra assíncrona
 * (o usuário responde depois) fica escondida aqui, resolvendo a Promise no clique.
 */
export function useConfirmacao(): UseConfirmacao {
  const [aberto, setAberto] = useState(false)
  const [opcoes, setOpcoes] = useState<OpcoesConfirmacao | null>(null)
  // Guarda o `resolve` da Promise em aberto para responder no clique/fechamento.
  const resolveRef = useRef<((valor: boolean) => void) | null>(null)

  const responder = useCallback((valor: boolean) => {
    setAberto(false)
    resolveRef.current?.(valor)
    resolveRef.current = null
  }, [])

  const confirmar = useCallback((novas: OpcoesConfirmacao) => {
    setOpcoes(novas)
    setAberto(true)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const dialog = (
    <Dialog
      open={aberto}
      // Cobre Esc, clique fora e o X: qualquer fechamento que não seja o Confirmar
      // resolve `false`.
      onOpenChange={(estaAberto) => {
        if (!estaAberto) responder(false)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{opcoes?.titulo}</DialogTitle>
          {/* base-ui exige Description para acessibilidade; fica vazia se não houver. */}
          <DialogDescription>{opcoes?.descricao ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => responder(false)}>
            {opcoes?.rotuloCancelar ?? 'Cancelar'}
          </Button>
          <Button
            className="bg-enterplak hover:bg-enterplak-700"
            onClick={() => responder(true)}
          >
            {opcoes?.rotuloConfirmar ?? 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirmar, dialog }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/confirm-dialog.tsx
git commit -F - << 'EOF'
feat(ui): hook useConfirmacao (modal de confirmação Enterplak)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Trocar os 4 forms de Configurações

**Files:**
- Modify: `src/app/(app)/configuracoes/criticidade/criticidade-form.tsx`
- Modify: `src/app/(app)/configuracoes/listas/lista-form.tsx`
- Modify: `src/app/(app)/configuracoes/listas/item-form.tsx`
- Modify: `src/app/(app)/configuracoes/perfis/perfil-form.tsx`

**Interfaces:**
- Consumes: `useConfirmacao` (Task 1).

Os 4 têm a **mesma forma**: um sub-componente `ExcluirXButton` com `onClick` síncrono →
`window.confirm` → `startTransition`. Em cada um, o padrão da troca é idêntico.

- [ ] **Step 1: `criticidade-form.tsx`**

1. Adicionar o import (junto dos outros de `@/components/ui/*`):

```tsx
import { useConfirmacao } from '@/components/ui/confirm-dialog'
```

2. Em `ExcluirCriticidadeButton`, adicionar o hook e tornar `onClick` async:

```tsx
export function ExcluirCriticidadeButton({ id, fornecedor }: ExcluirCriticidadeButtonProps) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    if (!(await confirmar({ titulo: `Excluir a criticidade de "${fornecedor}"?` }))) return
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirCriticidade(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }
```

3. Renderizar `{dialog}` dentro do `return` do componente — acrescentar como último filho do `<div>` externo:

```tsx
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Excluir fornecedor"
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

- [ ] **Step 2: `lista-form.tsx`**

Import igual ao Step 1. Em `ExcluirListaButton`:

```tsx
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    if (!(await confirmar({ titulo: `Excluir a lista "${nome}"?` }))) return
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirListaAction(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }
```

E `{dialog}` como último filho do `<div className="flex flex-col items-end gap-1">` do return (depois do `{erro && ...}`).

- [ ] **Step 3: `item-form.tsx`**

Import igual. Em `ExcluirItemButton`:

```tsx
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    if (!(await confirmar({ titulo: `Excluir o item "${valor}"?` }))) return
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirItemAction(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }
```

E `{dialog}` como último filho do `<div className="flex flex-col items-end gap-1">` do return.

- [ ] **Step 4: `perfil-form.tsx`**

Import igual. Em `ExcluirPerfilButton`:

```tsx
  const { confirmar, dialog } = useConfirmacao()

  async function onClick() {
    if (!(await confirmar({ titulo: `Excluir o perfil "${nome}"?` }))) return
    setErro(null)
    startTransition(async () => {
      const resultado = await excluirPerfil(id)
      if ('erro' in resultado) setErro(resultado.erro)
    })
  }
```

E `{dialog}` como último filho do `<div className="flex flex-col items-end gap-1">` do return. (O `disabled={sistema || pending}` do botão **não muda**.)

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros (o único warning aceitável é o pré-existente de `<img>` em `anexos-processo.tsx`).

```bash
git add "src/app/(app)/configuracoes/criticidade/criticidade-form.tsx" "src/app/(app)/configuracoes/listas/lista-form.tsx" "src/app/(app)/configuracoes/listas/item-form.tsx" "src/app/(app)/configuracoes/perfis/perfil-form.tsx"
git commit -F - << 'EOF'
feat(config): modal de confirmação na exclusão (criticidade/lista/item/perfil)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Trocar as 3 telas de Recebimento

**Files:**
- Modify: `src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx`
- Modify: `src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx`
- Modify: `src/app/(app)/recebimento/importar/wizard-importacao.tsx`

**Interfaces:**
- Consumes: `useConfirmacao` (Task 1).

Estas 3 têm nuances: uma é "Remover foto" (`rotuloConfirmar` muda), uma usa `void (async ...)()`
em vez de `startTransition`, e a do wizard é um método interno de um componente grande.

- [ ] **Step 1: `anexos-processo.tsx` — remover foto**

1. Import `import { useConfirmacao } from '@/components/ui/confirm-dialog'`.
2. No componente `AnexosProcesso`, adicionar `const { confirmar, dialog } = useConfirmacao()` (junto dos outros hooks no topo).
3. Trocar `aoRemover` (a função hoje é síncrona, vira async):

```tsx
  async function aoRemover(id: string) {
    if (!(await confirmar({ titulo: 'Remover esta foto?', rotuloConfirmar: 'Remover' }))) return
    startTransition(async () => {
      const r = await removerFoto(id)
      if (r.ok) toast.success('Foto removida.')
      else toast.error(r.erro)
    })
  }
```

4. Renderizar `{dialog}` no JSX do `AnexosProcesso` — acrescentar como último filho do container externo do `return` (o elemento raiz do componente).

- [ ] **Step 2: `exportar-fotos-cliente.tsx` — apagar todas (mensagem multi-linha)**

1. Import do hook.
2. `const { confirmar, dialog } = useConfirmacao()` no componente.
3. Trocar `limpar` (a função vira async; a mensagem multi-linha vira `titulo` + `descricao`, e o rótulo vira "Apagar"):

```tsx
  async function limpar() {
    if (
      !(await confirmar({
        titulo: `Apagar TODAS as ${total} foto(s) de ${rotulo}?`,
        descricao: 'Faça o export antes — isto não tem desfazer.',
        rotuloConfirmar: 'Apagar',
      }))
    ) {
      return
    }
    setOcupado(true)
    void (async () => {
      try {
        const r = await limparFotosDoMes(mes)
        if (r.ok) {
          toast.success(`${r.removidos} foto(s) removida(s).`)
          router.refresh()
        } else {
          toast.error(r.erro)
        }
      } finally {
        setOcupado(false)
      }
    })()
  }
```

4. Renderizar `{dialog}` como último filho do `<div>` externo do `return`.

- [ ] **Step 3: `wizard-importacao.tsx` — excluir mapeamento**

Este é um componente grande; o `window.confirm` está no método `onExcluirPadrao`.

1. Import do hook.
2. Adicionar `const { confirmar, dialog } = useConfirmacao()` junto dos outros hooks/estados do componente `WizardImportacao`.
3. Trocar `onExcluirPadrao` (vira async):

```tsx
  async function onExcluirPadrao() {
    if (!padraoSelecionadoId) return
    if (!(await confirmar({ titulo: 'Excluir este mapeamento?' }))) return
    setErroPadrao(null)
    startPadrao(async () => {
      const r = await excluirPadrao(padraoSelecionadoId)
      if (r.ok) {
        setPadroes(r.padroes)
        setPadraoSelecionadoId(null)
      } else {
        setErroPadrao(r.erro)
      }
    })
  }
```

4. Renderizar `{dialog}` no JSX do `WizardImportacao` — acrescentar como último filho do container raiz do `return` do componente (não dentro de um passo condicional do wizard, para o modal existir em qualquer passo).

- [ ] **Step 4: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

```bash
git add "src/app/(app)/recebimento/processos/[id]/anexos-processo.tsx" "src/app/(app)/recebimento/exportar-fotos/exportar-fotos-cliente.tsx" "src/app/(app)/recebimento/importar/wizard-importacao.tsx"
git commit -F - << 'EOF'
feat(recebimento): modal de confirmação (remover foto/apagar mês/excluir mapeamento)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde. `grep -rn "window.confirm" src/` deve dar **vazio** (os 7 sumiram). Único warning aceitável: o `<img>` pré-existente em `anexos-processo.tsx`.

- [ ] **Step 2: Smoke (anotar; NÃO fazer push)**

Com `npm run dev`, em cada tela disparar a exclusão e conferir:
1. **Criticidade** (Configurações → Criticidade): clicar na lixeira → **modal** (não o pop-up do navegador); Cancelar aborta; Confirmar exclui + estava tudo como antes.
2. **Lista** e **Item** (Configurações → Listas): idem.
3. **Perfil** (Configurações → Perfis): idem (perfil de sistema segue com a lixeira desabilitada).
4. **Remover foto** (abrir um processo → card Fotos → lixeira na foto): modal com botão **"Remover"**.
5. **Apagar mês** (Recebimento → Exportar Fotos, quando `FOTOS_STORAGE=supabase`): modal com título + descrição + botão **"Apagar"**.
6. **Excluir mapeamento** (Importar → Passo 2 → selecionar um mapeamento salvo → Excluir): modal.
7. Em todos: **Esc** e **clicar fora** cancelam sem excluir; o foco entra no modal e o `Tab` fica preso dentro.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- Hook `useConfirmacao` com `Promise<boolean>` → Task 1. ✅
- Aparência sóbria (vinho, sem vermelho/alerta) → Task 1 (botões). ✅
- Só os 7 `window.confirm` → Tasks 2 (4) + 3 (3) = 7. ✅
- Mensagens ficam com a tela → Tasks 2/3 (títulos preservados; multi-linha → título+descrição). ✅
- Sem TDD / sem servidor → Global Constraints. ✅
- `{dialog}` renderizado no MESMO componente do `confirmar` (os 4 forms de config têm sub-componente `ExcluirXButton`; anexos/wizard renderizam no container raiz) → Tasks 2/3. ✅

**Consistência de tipos:** `useConfirmacao` e `OpcoesConfirmacao` (Task 1) consumidos em 2 e 3; `confirmar({ titulo, descricao?, rotuloConfirmar? })` — todas as chamadas usam só esses campos. ✅

**Sem placeholders:** todo passo traz o código exato (o "antes" foi lido do repo; o "depois" é completo). ✅
