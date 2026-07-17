# Grid de Processos — Fase 2: Colunas da Lista (admin) — Design

**Continuação do item 2 do roadmap** (`memory/roadmap-pos-reuniao.md`). A **Fase 1** do grid já
está **em produção e aprovada**.

## Objetivo

Dar ao admin uma tela para escolher **quais colunas aparecem** no grid de Processos e **em que
ordem**, sem depender de desenvolvedor. Hoje a tabela `colunas_lista` já existe e a Fase 1 só
**lê** dela; falta a tela que **edita**.

## Contexto herdado (já existe — não refazer)

- **Migração 0021** criou `colunas_lista(campo text pk, visivel boolean, ordem int)` com RLS
  (select = todo autenticado; **escrita = `tem_permissao('administrar')`**) e semente: 11
  colunas visíveis na ordem acordada + as demais ocultas.
- **Catálogo** = `carregarCatalogoColunas()` → colunas de SISTEMA (`numero`, `status`) + os
  campos ativos de `configuracao_campos` (**39** no total). É a **whitelist** do grid.
- A `processos/page.tsx` monta as colunas visíveis cruzando catálogo × layout, na ordem do layout.
- `/configuracoes/*` já é guardado por `administrar` no `configuracoes/layout.tsx`.
- A linha do grid tem um **botão fixo "Abrir processo"** (coluna própria), independente das
  colunas configuradas.

## Decisões (aprovadas)

1. **Onde:** Configurações → accordion **Recebimento** → **"Colunas da Lista"**
   (`/configuracoes/colunas`). Herda o guard de admin do layout.
2. **Reordenar com setas ↑↓** — sem biblioteca nova (arrastar-e-soltar exigiria dep de ~30KB
   para uma tarefa rara de admin; a UI pode ser trocada depois sem mexer no resto).
3. **Duas listas:** **Visíveis** (na ordem do grid, com setas ↑↓ e botão "Ocultar") e
   **Disponíveis** (as ocultas, em ordem alfabética por rótulo, com botão "Mostrar" — que
   adiciona ao **fim** das visíveis).
4. **`numero` e `status` são SEMPRE visíveis** (o botão "Ocultar" fica travado, com cadeado e
   explicação), **mas podem ser reordenados** como qualquer outra. "Sempre visível" trava só a
   visibilidade, não a posição.
5. **Salvar em bloco:** o admin edita à vontade e clica em **"Salvar alterações"**; uma Server
   Action grava o layout **inteiro**. (Salvar a cada clique dispararia uma chamada por seta.)
   A tela avisa quando há **alterações não salvas**.
6. **Campos novos do catálogo** aparecem sozinhos em "Disponíveis" (ocultos), porque a tela
   lista o **catálogo** (fonte da verdade) cruzado com o layout salvo.
7. **Sem migração** — `colunas_lista` já existe; `campo` é PK → **upsert** cobre inclusive
   campos que ainda não têm linha.
8. **Auditoria:** a ação registra log (`entidade: 'colunas_lista'`, `acao: 'alterar_campo'`),
   seguindo o padrão das outras telas de configuração.

## Arquitetura

### Domínio (TDD) — `src/modules/recebimento/domain/layout-colunas.ts`

O cliente envia **apenas a lista ordenada dos campos visíveis**; o domínio deriva o resto.
Isso elimina ambiguidade (nada de "visivel" contraditório) e reduz a superfície de confiança.

```ts
export interface ColunaLayout {
  campo: string
  visivel: boolean
  ordem: number
}

/** Colunas que o admin NÃO pode ocultar (mas pode reordenar). */
export const COLUNAS_FIXAS: readonly string[] = ['numero', 'status']

/**
 * Normaliza o layout a partir da lista ordenada de campos visíveis vinda do cliente.
 * - Descarta campo fora do `catalogo` (whitelist) e duplicatas.
 * - Força `COLUNAS_FIXAS` visíveis (se vierem ausentes, entram no fim).
 * - Visíveis recebem ordem 1..N na ordem dada; as ocultas (catálogo − visíveis) vêm
 *   depois, na ordem do catálogo.
 */
export function normalizarLayout(visiveis: string[], catalogo: string[]): ColunaLayout[]
```

### Infra — `src/modules/recebimento/infra/processo-repository.ts`

```ts
/** Grava o layout inteiro (upsert por `campo`). RLS exige `administrar`. */
export async function salvarColunasLista(layout: ColunaLayout[]): Promise<void>
```

### Application (Server Action) — `src/modules/recebimento/application/colunas-lista-actions.ts`

```ts
'use server'
export type ResultadoLayout = { ok: true } | { ok: false; erro: string }

/** Salva o layout do grid. Gate `administrar`; valida contra o catálogo; audita. */
export async function salvarLayoutColunas(visiveis: string[]): Promise<ResultadoLayout>
```

- Valida sessão + `podeFazer(perfil, 'administrar')`.
- Carrega o catálogo no **servidor** e chama `normalizarLayout(visiveis, catalogo)` — o cliente
  nunca define o que é válido.
- `salvarColunasLista(layout)` → `registrarLog(...)` → `revalidatePath('/recebimento/processos')`
  (para o grid refletir na hora) e `revalidatePath('/configuracoes/colunas')`.

### UI

- **`src/app/(app)/configuracoes/colunas/page.tsx`** (server): carrega `carregarCatalogoColunas()`
  + `listarColunasLista()`, monta as duas listas (visíveis na ordem; disponíveis = catálogo −
  visíveis, ordenadas por rótulo) e renderiza o form.
- **`src/app/(app)/configuracoes/colunas/colunas-form.tsx`** (client): estado local das duas
  listas; setas ↑↓ (desabilitadas nas pontas); "Ocultar" (travado em `numero`/`status`);
  "Mostrar"; aviso de alterações não salvas; botão "Salvar alterações" chamando a action.
- **`src/shared/ui/app-shell.tsx`**: novo item em `CONFIG_RECEBIMENTO` →
  `{ chave: 'colunas', rotulo: 'Colunas da Lista', href: '/configuracoes/colunas', perm: 'administrar' }`.

## Fluxo de dados

```
page.tsx (server) → catálogo + layout → colunas-form (client)
admin move/oculta/mostra → estado local (nada gravado)
"Salvar alterações" → salvarLayoutColunas(visiveis[]) 
  → gate administrar → normalizarLayout(visiveis, catálogo no servidor)
  → upsert colunas_lista → log → revalidate /recebimento/processos
```

## Segurança (3 camadas)

1. **RLS** no banco: escrita em `colunas_lista` exige `tem_permissao('administrar')`.
2. **Server Action** revalida a sessão + permissão antes de tocar no banco.
3. **Whitelist**: campo vindo do cliente só é aceito se estiver no catálogo carregado **no
   servidor** — mesma defesa da Fase 1.

## Validação e erros

| Situação | Comportamento |
|---|---|
| Cliente envia campo fora do catálogo | Descartado por `normalizarLayout` (silencioso — é defesa, não erro de usuário) |
| Cliente envia sem `numero`/`status` | Forçados visíveis pelo domínio (a UI nem permite ocultar) |
| Cliente envia duplicatas | Dedupe pelo domínio |
| Sem permissão `administrar` | Action retorna erro; a rota já é bloqueada pelo layout |
| Falha no banco | Action retorna "Não foi possível salvar o layout." |
| Campo novo ativado em Configurações→Campos | Aparece em "Disponíveis" (oculto) na próxima abertura da tela |
| Campo desativado no catálogo | Some das duas listas; a linha órfã em `colunas_lista` é ignorada (a Fase 1 já cruza com o catálogo) |

## Fora de escopo

- Layout por usuário (é **config geral**, decisão travada).
- Arrastar e soltar (setas resolvem; trocável depois sem mexer no domínio/action).
- Largura de coluna, congelar coluna, agrupar.
- Fase 3 (setas ‹ › do detalhe seguindo a ordem/filtros) e grid responsivo em cards — features próprias.
- Migração (a tabela já existe).

## Testes

- **TDD (domínio `layout-colunas.ts`)** — `normalizarLayout`:
  - descarta campo fora do catálogo; dedupe;
  - força `numero`/`status` visíveis quando omitidos (entram no fim);
  - preserva a ordem dada e numera visíveis 1..N;
  - ocultas = catálogo − visíveis, com ordem continuando N+1.., na ordem do catálogo;
  - lista vazia → só as fixas visíveis, resto oculto;
  - não muta as entradas.
- **Infra/Action/UI:** build + smoke.
- **Smoke:** em Configurações → Colunas da Lista: ocultar uma coluna → salvar → ela some do grid;
  mostrar uma coluna nova → ela entra no fim → mover com as setas → salvar → o grid reflete a
  ordem; conferir que "Ocultar" está travado em Número/Status e que os dois podem ser movidos;
  conferir que um perfil não-admin não acessa a tela.
