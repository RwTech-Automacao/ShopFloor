# Modais de confirmação — Design

**Melhoria levantada pelo usuário** (`memory/roadmap-pos-reuniao.md`, item 6).

## Objetivo

Trocar os **7 `window.confirm`** nativos do navegador (o pop-up feio, sem a cara do sistema)
por um **modal de confirmação** com a identidade Enterplak, reutilizado nas 7 telas.

## Contexto atual

7 usos, todos na mesma forma — uma exclusão precedida de confirmação síncrona:

```ts
if (!window.confirm(`Excluir X "${nome}"?`)) return
startTransition(async () => { /* ...action de exclusão... */ })
```

Telas: `configuracoes/criticidade/criticidade-form.tsx:74`, `configuracoes/listas/item-form.tsx:143`,
`configuracoes/perfis/perfil-form.tsx:126`, `configuracoes/listas/lista-form.tsx:86`,
`recebimento/exportar-fotos/exportar-fotos-cliente.tsx:65`,
`recebimento/processos/[id]/anexos-processo.tsx:68`,
`recebimento/importar/wizard-importacao.tsx:266`.

Primitivos já existem: `src/components/ui/dialog.tsx` (base-ui: Title/Description/Footer/Close,
com foco/esc/overlay/acessibilidade prontos) e `sonner` (toasts).

## O desafio (por que não é find-and-replace)

`window.confirm` é **síncrono**: o código para, o usuário responde, e a execução segue em linha
reta. Um modal é **assíncrono** (o usuário clica depois), então a lógica de cada tela teria que
ser quebrada em duas metades. Montar um `<Dialog>` na mão em cada uma das 7 telas espalharia
essa quebra + repetiria estado/foco/botões, com 7 chances de errar.

## Decisões (aprovadas)

1. **Um hook `useConfirmacao` que devolve uma `Promise<boolean>`.** A quebra assíncrona fica
   escondida no hook; a tela volta a escrever quase como hoje:
   ```ts
   if (!(await confirmar({ titulo: '…', descricao: '…' }))) return
   ```
2. **Aparência sóbria** (não destrutiva): botão de confirmar em **vinho Enterplak**, botão
   **Cancelar** outline. Sem vermelho, sem ícone de alerta.
3. **Escopo travado: só os 7 `window.confirm`.** Não adicionar confirmação onde hoje não há
   (Cancelar/Reabrir/Finalizar processo seguem como estão).
4. **As mensagens ficam com cada tela** (elas já têm o bom texto — "Excluir o perfil «Fulano»?").
5. **Sem TDD** — é estado de UI/apresentação, sem lógica pura de peso. Garantia por build + smoke.
6. **100% frontend** — sem migração, sem servidor; as Server Actions de exclusão não mudam.

Nota registrada: o `window.confirm` bloqueia a aba inteira; o modal não (dá pra clicar fora
para cancelar). Para ações destrutivas explícitas, isso é aceitável/melhor.

## Arquitetura

### `src/components/ui/confirm-dialog.tsx` (novo)

Um hook + o componente que ele controla.

```tsx
'use client'

interface OpcoesConfirmacao {
  titulo: string
  descricao?: string
  rotuloConfirmar?: string // default 'Excluir'
  rotuloCancelar?: string  // default 'Cancelar'
}

interface UseConfirmacao {
  /** Abre o modal e resolve true (confirmou) ou false (cancelou/fechou). */
  confirmar: (opcoes: OpcoesConfirmacao) => Promise<boolean>
  /** Renderizar UMA vez no componente — é o modal controlado pelo hook. */
  dialog: React.ReactNode
}

export function useConfirmacao(): UseConfirmacao
```

- Estado interno: `aberto`, `opcoes | null`, e uma ref para a função `resolve` da Promise em
  aberto.
- `confirmar(opcoes)` guarda as opções, abre o modal e retorna `new Promise<boolean>` cujo
  `resolve` é guardado na ref.
- Confirmar → `resolve(true)` + fecha. Cancelar / fechar (Esc, clicar fora, X) → `resolve(false)`
  + fecha. `onOpenChange(false)` também resolve `false` (cobre o Esc/overlay).
- `dialog` é `<Dialog open={aberto} onOpenChange={...}>` com `DialogContent` → Title (`titulo`),
  Description (`descricao`), Footer com Cancelar (outline) e Confirmar (vinho). O botão confirmar
  chama o `resolve(true)`.
- Sem lógica assíncrona pesada aqui: o hook só resolve a Promise; quem faz a exclusão (o
  `startTransition` + a action) continua na tela, exatamente como hoje.

### As 7 telas (mudança mínima)

Em cada uma:
1. `const { confirmar, dialog } = useConfirmacao()`.
2. Trocar `if (!window.confirm('…')) return` por `if (!(await confirmar({ titulo: '…', descricao?: '…' }))) return` — e tornar a função `async` (as 7 já chamam `startTransition` logo depois; o `await` vem antes dele).
3. Renderizar `{dialog}` no JSX do componente (uma vez).

Nenhuma outra mudança de lógica. As mensagens atuais viram `titulo` (algumas ganham `descricao`
opcional, ex.: nome do item em destaque).

## Fora de escopo

- Adicionar confirmação a ações que hoje não pedem (Cancelar/Finalizar/Reabrir processo).
- Substituir toasts (o `sonner` já cobre o feedback de sucesso/erro).
- Um sistema global de diálogos (context provider) — YAGNI: cada tela instancia o hook local.
- Modais de outros tipos (formulário, aviso) — só confirmação de exclusão.

## Testes

- **Sem TDD** (não há domínio puro).
- **Build + lint + tsc.**
- **Smoke:** em cada uma das 7 telas, disparar a exclusão → o **modal** aparece (com a cara do
  sistema, não o pop-up do navegador); **Cancelar** e **Esc/clicar fora** abortam sem excluir;
  **Confirmar** executa a exclusão e mostra o toast de sucesso como antes. Conferir foco inicial
  no modal e que o `Tab` fica preso dentro dele.
