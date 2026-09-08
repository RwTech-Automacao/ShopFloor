# Relayout do Lançamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reorganizar a tela de Lançamento: Contexto compacto, topo Peça|Contexto em todas as telas, dois históricos por Lançado/Não-lançado, e card do Lote compacto + persistente em localStorage.

**Architecture:** Imita a base de layout da branch `feat/shopfloor-ajustes` (renderContexto compacto + topo `grid-cols-[2fr_3fr]` + Peça compacta) e aplica os deltas novos (split lançado/não-lançado, colunas do histórico com data/hora, card do Lote inline com emoji + localStorage). Só UI + localStorage — **sem migração**.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 + Vitest.

## Global Constraints

- **Next.js modificado:** ler `node_modules/next/dist/docs/` antes de código Next. (AGENTS.md)
- **Sem migração** — UI + localStorage.
- **Não mudar** a lógica de bipe/aprovar/reprovar, os handlers (`onEnviar`/`onAcao`/`gravarAprovado`/`gravarReprovado`/`empilharNoLote`/`enviarLote`/`puxarPainel`), os modais, nem o comportamento do lote entre postos — só a **aparência/estrutura**.
- **Tela de load** (overlay z-40) e disabled durante `enviando/processando/enviandoLote` **continuam**.
- **Referência de layout:** `git show feat/shopfloor-ajustes:'src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx'` tem o `renderContexto()` compacto, a Peça compacta e o topo `grid-cols-[2fr_3fr]` — copiar/adaptar os classNames de lá (não reinventar).
- **Spec:** `docs/superpowers/specs/2026-08-28-relayout-lancamento-design.md`.
- Ao final: `npm run lint` + `tsc` + testes + `npm run build` verdes. Tablet retrato: sem scroll de página; regiões rolam por dentro.

---

### Task 1: Histórico (2 listas), localStorage do lote, helpers puros

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/historico-lancamentos.tsx`
- Create: `src/app/(app)/shopfloor/operar/lancamento/lote-local.ts`
- Modify: `src/modules/shopfloor/domain/lote.ts`
- Test: `src/modules/shopfloor/domain/__tests__/lote.test.ts` (acrescentar casos do emoji)

**Interfaces:**
- Produces: `LinhaHistorico` (com `dataHora`); `HistoricoLancamentos({ titulo, linhas, mostrarStatus })` (uma lista parametrizável); `lerLoteLocal/salvarLoteLocal/limparLoteLocal`; `emojiItemLote(item)`.
- Consumed por: Task 2 (form).

- [ ] **Step 1: `LinhaHistorico` ganha `dataHora` + componente parametrizável (2 listas)**

Reescrever `historico-lancamentos.tsx`:

```tsx
export interface LinhaHistorico {
  lancamento: boolean                          // true = Lançado; false = Não-lançado (recusado)
  status: 'aprovado' | 'reprovado' | null      // null = posto sem status
  sn: string
  dataHora: string                             // ISO, carimbado no cliente na hora do bipe
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
})
function fmtDataHora(iso: string): string { return formatadorData.format(new Date(iso)) }

/** ✓ verde (aprovado) / ✗ vermelho (reprovado) / — cinza (sem status). */
function SimboloStatus({ status }: { status: 'aprovado' | 'reprovado' | null }) {
  if (status === null) return <span className="text-muted-foreground">—</span>
  return <span className={`font-bold ${status === 'aprovado' ? 'text-green-600' : 'text-red-600'}`}>{status === 'aprovado' ? '✓' : '✗'}</span>
}

/** Uma lista do log da sessão (mais recente no topo). Colunas: Nº de Série · [Status] · Data/hora.
 *  `mostrarStatus` = o posto tem aprovado/reprovado (some a coluna Status nos demais). */
export function HistoricoLancamentos({
  titulo, linhas, mostrarStatus,
}: { titulo: string; linhas: LinhaHistorico[]; mostrarStatus: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">{titulo} ({linhas.length})</p>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-base">
          <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Nº de Série</th>
              {mostrarStatus && <th className="px-3 py-2 text-center font-medium">Status</th>}
              <th className="px-3 py-2 text-left font-medium">Data/hora</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={mostrarStatus ? 3 : 2} className="px-3 py-3 text-center text-sm text-muted-foreground">—</td></tr>
            )}
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1.5 font-mono">{l.sn}</td>
                {mostrarStatus && <td className="px-3 py-1.5 text-center"><SimboloStatus status={l.status} /></td>}
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{fmtDataHora(l.dataHora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

(Some a coluna "Lançamento"; fonte sobe pra `text-base`; sem `SimboloBool`.)

- [ ] **Step 2: `lote-local.ts` (localStorage do lote, por pmo/op/posto)**

Espelha `nqa-progresso-local.ts`. Criar `lote-local.ts`:

```ts
import type { ItemLote } from './tipos-lote' // ver nota abaixo

const PREFIXO = 'sf:lote:'
function chave(pmo: string, op: string, posto: string) { return `${PREFIXO}${pmo}|${op}|${posto}` }

export function lerLoteLocal(pmo: string, op: string, posto: string): ItemLote[] | null {
  try {
    const raw = localStorage.getItem(chave(pmo, op, posto))
    if (!raw) return null
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as ItemLote[]) : null
  } catch { return null }
}
export function salvarLoteLocal(pmo: string, op: string, posto: string, lote: ItemLote[]): void {
  try {
    if (lote.length === 0) { localStorage.removeItem(chave(pmo, op, posto)); return }
    localStorage.setItem(chave(pmo, op, posto), JSON.stringify(lote))
  } catch { /* ignore */ }
}
export function limparLoteLocal(pmo: string, op: string, posto: string): void {
  try { localStorage.removeItem(chave(pmo, op, posto)) } catch { /* ignore */ }
}
```

> **Nota do `ItemLote`:** hoje o tipo `ItemLote` está definido dentro de `lancamento-form.tsx`. Pra o
> `lote-local.ts` importar sem ciclo, **mover o `type ItemLote`** (a união pendente/resolvido) pra um
> arquivo próprio `src/app/(app)/shopfloor/operar/lancamento/tipos-lote.ts` e reexportar/importar nos
> dois lugares (form + lote-local). Fazer esse move nesta task (é só recortar o tipo).

- [ ] **Step 3: helper de emoji do item do lote (domínio) + testes**

Em `src/modules/shopfloor/domain/lote.ts`, acrescentar:

```ts
/** Emoji do item do lote na UI: ⏳ pendente · ✔️ aprovado · ❌ reprovado · ⚠️ falhou no envio. */
export function emojiItemLote(i: { estado: EstadoItemLote; outcome?: 'aprovado' | 'reprovado' | null; erro?: string }): string {
  if (i.estado === 'pendente') return '⏳'
  if (i.erro) return '⚠️'
  if (i.outcome === 'reprovado') return '❌'
  return '✔️'
}
```

Em `__tests__/lote.test.ts`, acrescentar:

```ts
import { emojiItemLote } from '../lote'
describe('emojiItemLote', () => {
  it('pendente ⏳, aprovado ✔️, reprovado ❌, erro ⚠️', () => {
    expect(emojiItemLote({ estado: 'pendente' })).toBe('⏳')
    expect(emojiItemLote({ estado: 'resolvido', outcome: 'aprovado' })).toBe('✔️')
    expect(emojiItemLote({ estado: 'resolvido', outcome: 'reprovado' })).toBe('❌')
    expect(emojiItemLote({ estado: 'resolvido', outcome: 'aprovado', erro: 'x' })).toBe('⚠️')
  })
})
```

- [ ] **Step 4: rodar testes + tsc do que dá**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/lote.test.ts`
Expected: PASS (helpers antigos + emoji). `tsc` do form vai quebrar até a Task 2 (esperado — as duas tasks são uma mudança coesa).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento/historico-lancamentos.tsx" \
        "src/app/(app)/shopfloor/operar/lancamento/lote-local.ts" \
        "src/app/(app)/shopfloor/operar/lancamento/tipos-lote.ts" \
        src/modules/shopfloor/domain/lote.ts src/modules/shopfloor/domain/__tests__/lote.test.ts
git commit -m "feat(shopfloor): relayout base — histórico 2-listas + dataHora, lote-local, emoji do lote"
```

---

### Task 2: Form — layout novo + card do Lote + wiring do histórico

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes: `HistoricoLancamentos({titulo,linhas,mostrarStatus})`, `LinhaHistorico.dataHora`, `emojiItemLote`, `lerLoteLocal/salvarLoteLocal/limparLoteLocal`, `ItemLote` (de `./tipos-lote`).

- [ ] **Step 1: `renderContexto()` compacto (imitar a `ajustes`)**

Copiar o `renderContexto` da `ajustes` (o JSX exato — `git show feat/shopfloor-ajustes:'src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx'`), com o `CardContent` compacto `grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 [&_label]:text-xs [&_input]:h-8 [&_input]:text-sm [&_button]:h-8 [&_button]:text-sm`. Adaptar: manter os handlers/refs desta branch (`atualizarCabecalho` com `disabled={enviandoLote}`, Posto `disabled={enviando||processando||enviandoLote}`).

- [ ] **Step 2: `dataHora` em toda `LinhaHistorico`**

Em toda chamada `mostrar(res, { lancamento, status, sn })`, acrescentar `dataHora: new Date().toISOString()`. (São os pontos em `onEnviar`/`gravarAprovado`/`gravarReprovado`/`gravarBurninEntrada`/`enviarLote`.)

- [ ] **Step 3: Layout — topo + faixas (ramo normal) e topo (telas especiais)**

Reestruturar o `return` (imitando a `ajustes`, adaptado pro lote):
- **Ramo normal** (`!ehIntegracao && !ehEmbalagem && !ehNqaCaixa`, com `op !== ''`):
  - Topo: `<div className="grid shrink-0 gap-3 lg:grid-cols-[2fr_3fr]">` → **Peça compacta** (esq, copiar da `ajustes`: `Card size="sm"`, campo `h-10`, botão `h-9 text-sm`) | **`renderContexto()`** (dir).
  - Meio: **com lote** `<div className="grid ... lg:grid-cols-2">` → **Card do Lote** (esq) | **Última bipada** (`PainelResultado` + contador, dir); **sem lote** → Última bipada largura cheia.
  - Base: `<div className="grid min-h-0 flex-1 ... lg:grid-cols-2 gap-3">` → `<HistoricoLancamentos titulo="Lançado" linhas={historico.filter(l=>l.lancamento)} mostrarStatus={mostraStatus}/>` | `<HistoricoLancamentos titulo="Não-lançado" linhas={historico.filter(l=>!l.lancamento)} mostrarStatus={mostraStatus}/>`.
  - Raiz `flex h-full min-h-0 flex-col gap-3`. As faixas do meio/base usam `min-h-0` e a base `flex-1` pra rolar por dentro (paridade com o "cabe sem scroll").
- **Telas especiais** (Integração/Embalagem/NQA-caixa): topo `grid lg:grid-cols-[2fr_3fr]` → **Painel especial** (esq) | **`renderContexto()`** (dir). ⚠️ Se a Integração ficar apertada, deixar o `IntegracaoPanel` em largura cheia (Contexto compacto acima) — decidir no smoke. Embalagem/NQA-caixa entram no side-by-side.
- **Sem OP** (`op === ''`): só o `renderContexto()` (campo de bipe).

- [ ] **Step 4: Card do Lote — pills inline + emoji + localStorage**

- Render do card do Lote: título "Lote — {contarResolvidos}/{lote.length}" + botão Enviar (como está). Trocar a **lista vertical** por **pills inline**:
  ```tsx
  <div className="flex flex-wrap gap-2">
    {lote.map((item, i) => (
      <span key={item.snNorm} title={item.estado === 'resolvido' ? (item.erro ?? '') : 'Pendente'}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm">
        <span>{emojiItemLote(item)}</span>
        <span className="font-mono">{item.sn}</span>
        <button type="button" aria-label={`Remover ${item.sn}`} disabled={enviandoLote}
                onClick={() => setLote((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-red-600 disabled:opacity-40">×</button>
      </span>
    ))}
  </div>
  ```
- **localStorage:** efeito que **salva** o lote a cada mudança (`salvarLoteLocal(pmo,op,posto,lote)` quando `pmo&&op&&posto`); efeito de **hidratação** ao casar `(pmo,op,posto)` (se `lote` vazio e há salvo, `setLote(lerLoteLocal(...))`); `limparLoteLocal` em `podeTrocarContexto`(ok)/`mudarPosto`/`atualizarCabecalho`. Cuidar pra hidratar **antes** de salvar-vazio sobrescrever (guardar com um ref `hidratou`).

- [ ] **Step 5: Contador perto da última bipada**

Manter o `<p>Lançados — sessão {lancadosSessao} · nesta OP/posto {totalPosto}</p>` logo abaixo do `PainelResultado` (na célula "Última bipada").

- [ ] **Step 6: tsc + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: limpos. (Sanity: `git show feat/shopfloor-ajustes:...` foi só referência de classNames; a lógica é desta branch.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): relayout do Lançamento — topo Peça|Contexto, faixas, card do lote inline + localStorage"
```

---

## Self-Review (preenchido)

**Spec coverage:** Contexto compacto (T2.1) · topo Peça|Contexto todas as telas (T2.3) · faixas com/sem lote (T2.3) · histórico 2-listas Lançado/Não-lançado + colunas + data/hora + sem col. Lançamento + fonte maior (T1.1, T2.3) · card do lote inline + emoji + localStorage (T1.2/T1.3, T2.4) · contador mantido (T2.5). ✅

**Placeholder scan:** sem TBD; código concreto nas partes novas; layout referencia a `ajustes` (fonte real, não placeholder).

**Type consistency:** `ItemLote` movido pra `tipos-lote.ts` e importado no form + lote-local; `LinhaHistorico.dataHora` usado no form (T2.2) e no componente (T1.1); `HistoricoLancamentos` novo assinatura usada 2× no form; `emojiItemLote` no domínio usado no card.

**Nota de ordenação:** T1 muda `LinhaHistorico`/`ItemLote` → o form só volta a compilar na T2. As duas são uma mudança coesa; executar em sequência (o gate verde é ao fim da T2).
