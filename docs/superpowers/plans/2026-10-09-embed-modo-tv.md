# Modo TV no embed (`?modo=tv`) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development.
> Os passos usam caixa (`- [ ]`). Rode sempre na worktree `/home/rwtech/Área de trabalho/ShopFloor-modotv`
> (branch `feat/embed-modo-tv`).

**Objetivo:** o Fluxo da OP embutido no Dashboard abre já em Modo TV com `?modo=tv`, **sem** chamar a
API de tela cheia do navegador (que hoje briga com a tela cheia do próprio Dashboard), e com três
controles de operação (Filtro, Zoom, Defeitos) escondidos até o hover — no embed **sempre** (com ou
sem `?modo=tv`) e no Modo TV da tela normal.

**Spec:** `docs/superpowers/specs/2026-10-09-embed-modo-tv-design.md` — leia inteira antes de começar.

**Arquitetura:** separar a *aparência* do Modo TV da *API*. Hoje `telaCheia` em `fluxo-form.tsx` é
derivado do evento `fullscreenchange` (a API é a fonte da verdade) e o canvas só ocupa a tela porque
o navegador o põe em tela cheia (`.fluxo-canvas:fullscreen`). `FluxoForm` ganha a prop `modoTv`:
quando ligada, `telaCheia = telaCheiaApi || modoTv`, o canvas vira `fixed inset-0` por CSS (ocupa o
iframe todo sem API nenhuma), e nenhum caminho chama `requestFullscreen`/`exitFullscreen`. A página
`/embed/fluxo/[pmo]/[op]` lê `?modo=tv` e passa a prop — o mesmo padrão de `opFixa`/`ocultarSeletor`:
**a mesma tela, por prop, sem cópia**. A regra de "quem liga" fica isolada (a página hoje; um
`postMessage` depois, Task 7) — o miolo é o mesmo.

**Stack:** Next.js 16 (App Router, `searchParams` é `Promise`), React 19, TypeScript, Vitest +
Testing Library (jsdom), Tailwind v4.

## Restrições globais

- **Tudo em PT-BR**: identificadores, comentários, textos de tela.
- ⚠️ **O alvo real é tablet, que NÃO tem hover.** Por isso esconder os controles vale **só no embed (com ou
  sem `?modo=tv`) e no Modo TV da tela normal** (`telaCheia`). A tela normal fora do Modo TV `/shopfloor/fluxo` fica intacta e **um teste
  tem de provar isso** (Task 3, caso 4 da spec). Quem sabe que está no embed é a prop `embed`
  (Task 3), passada sempre pela página do embed.
- ⚠️ **`--maxWorkers=2` é obrigatório** no vitest desta máquina (4 núcleos; sem isso exit 137):
  `npx vitest run --maxWorkers=2 <arquivo>`.
- ⚠️ **`next build` roda** nesta worktree: `NODE_OPTIONS="--max-old-space-size=4096" npx next build`.
- ⚠️ **Sem migração.** Nada toca banco.
- ⚠️ A página do embed busca tudo por Server Action (POST para a própria URL `/embed/...`).
  **Não introduzir `fetch('/api/...')`, `<Link>`, `href` nem `router.push`** no que roda no embed:
  sairiam do prefixo e levariam a sessão errada.
- **`git add` com caminhos explícitos** — nunca `git add -A` nem `git add .`. `.superpowers/` está no
  `.gitignore` de propósito.
- Commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Fora do escopo:** a tela `recebimento/fluxo/fluxo-form.tsx` (outro arquivo, mesma classe CSS
  `fluxo-canvas`) não muda. A regra `.fluxo-canvas:fullscreen` em `globals.css` não muda.

## Testes que provam a feature (cobrados por nome)

| caso da spec | teste | Task |
|---|---|---|
| **3** — com `?modo=tv` o navegador NÃO entra em tela cheia | `com modoTv o navegador NÃO entra em tela cheia` | 2 |
| **4** — tela normal: os três botões visíveis SEM hover (protege o tablet) | `tela normal (fora do Modo TV): Filtro, Zoom e Defeitos continuam visíveis sem hover` | 3 |
| 1 — embed SEM `?modo=tv`: layout normal, mas os três já escondidos (hover) | `embed sem modoTv: layout normal, mas Filtro, Zoom e Defeitos já só no hover` | 3 |
| 2 — com modoTv os três escondem e reaparecem no hover | `modoTv: Filtro, Zoom e Defeitos só aparecem no hover` | 3 |
| 2 — Modo TV da tela normal (tela cheia do navegador) também esconde | `tela normal em tela cheia do navegador: os três só no hover` | 3 |
| 1 / 2 / 5 — página lê `?modo=tv`, passa `embed` SEMPRE, `sf-embed:ready` sai nos dois | `lê ?modo=tv ...`, `passa embed mesmo sem o parâmetro` | 4 |

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `src/shared/lib/modo-tv.ts` (**criar**) | `lerModoTv`, `controlesSoNoHover`, `classeSoNoHover` — puro |
| `src/shared/lib/__tests__/modo-tv.test.ts` (**criar**) | testes do módulo acima |
| `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx` (**editar**) | props `modoTv` e `embed`; `telaCheia` derivado; canvas `fixed`; sem API; hover |
| `src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-modo-tv.test.tsx` (**criar**) | casos 3 e 4 |
| `src/app/embed/fluxo/[pmo]/[op]/page.tsx` (**editar**) | lê `searchParams.modo`, passa `modoTv` e `embed` (sempre) |
| `src/app/embed/__tests__/fluxo-embed.test.tsx` (**editar**) | `abrir` aceita `modo`; casos 1/2/5 |
| `src/modules/auth/domain/__tests__/sso-dashboard.test.ts` (**editar**) | `next` com `?modo=tv` atravessa |

`controles-canvas.tsx` e `defeitos-lista.tsx` **não mudam** (o esconder é por wrapper/classe no
`fluxo-form.tsx`; ver Task 3). `historico-sn-dialog.tsx` também não — só muda o `container` que recebe.

---

## Task 1 — Módulo puro `modo-tv.ts`

**Produz:** `lerModoTv`, `controlesSoNoHover`, `classeSoNoHover`. **Consome:** nada.

**Arquivos:** criar `src/shared/lib/modo-tv.ts` e `src/shared/lib/__tests__/modo-tv.test.ts`.

- [ ] **1.1 Teste (falha primeiro)** — `src/shared/lib/__tests__/modo-tv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lerModoTv, controlesSoNoHover, classeSoNoHover, CLASSE_SO_NO_HOVER } from '../modo-tv'

describe('lerModoTv', () => {
  it('só "tv" liga o modo', () => {
    expect(lerModoTv('tv')).toBe(true)
  })
  it('ausente, vazio ou outro valor: desligado', () => {
    expect(lerModoTv(undefined)).toBe(false)
    expect(lerModoTv('')).toBe(false)
    expect(lerModoTv('TV')).toBe(false)
    expect(lerModoTv('1')).toBe(false)
    expect(lerModoTv('true')).toBe(false)
  })
  it('parâmetro repetido (?modo=tv&modo=x) usa o primeiro, como o resto da app', () => {
    expect(lerModoTv(['tv', 'x'])).toBe(true)
    expect(lerModoTv(['x', 'tv'])).toBe(false)
    expect(lerModoTv([])).toBe(false)
  })
})

describe('controlesSoNoHover', () => {
  // Decisão de produto (spec, "Os três controles"): esconde no embed (com ou sem ?modo=tv) OU em
  // Modo TV. Só a tela normal fora do Modo TV fica de fora, porque o tablet não tem hover.
  it('esconde no embed ou em Modo TV; só a tela normal fora do Modo TV fica visível', () => {
    expect(controlesSoNoHover(true, false)).toBe(true) // embed sem ?modo=tv
    expect(controlesSoNoHover(true, true)).toBe(true) // embed com ?modo=tv
    expect(controlesSoNoHover(false, true)).toBe(true) // tela normal em tela cheia
    expect(controlesSoNoHover(false, false)).toBe(false) // tela normal (tablet)
  })
})

describe('classeSoNoHover', () => {
  it('desligado: string vazia (a tela normal não ganha classe nenhuma)', () => {
    expect(classeSoNoHover(false)).toBe('')
  })
  it('ligado: opacity-0 + volta no hover do canvas e no foco', () => {
    const c = classeSoNoHover(true)
    expect(c).toBe(CLASSE_SO_NO_HOVER)
    expect(c).toContain('opacity-0')
    expect(c).toContain('group-hover/canvas:opacity-100')
    expect(c).toContain('focus-within:opacity-100')
  })
})
```

- [ ] **1.2 Rodar e ver falhar:** `npx vitest run --maxWorkers=2 src/shared/lib/__tests__/modo-tv.test.ts`
  → falha (módulo não existe).

- [ ] **1.3 Implementar** — `src/shared/lib/modo-tv.ts`:

```ts
/**
 * Modo TV do Fluxo da OP: o que é puro (sem React, sem DOM) fica aqui pra ser testado.
 *
 * "Modo TV" tem DUAS formas de ligar, e o resto da tela não distingue:
 *   - pela API de tela cheia do navegador (botão "Modo TV" da tela normal) — `telaCheiaApi`;
 *   - pela prop `modoTv` (embed no Dashboard, `?modo=tv`), SEM API nenhuma: a tela cheia é do
 *     Dashboard, e o Fluxo disputar o recurso derrubava a do Dashboard junto.
 */

/** `?modo=tv` liga; qualquer outra coisa (ausente, vazio, "TV", "1") não. Repetido: vale o primeiro. */
export function lerModoTv(valor: string | string[] | undefined): boolean {
  const primeiro = Array.isArray(valor) ? valor[0] : valor
  return primeiro === 'tv'
}

/**
 * Os três controles de operação (Filtro, Zoom, Defeitos) só aparecem no hover quando a tela está
 * NO EMBED (com ou sem `?modo=tv`) OU em Modo TV (prop `modoTv` ou tela cheia do navegador).
 *
 * ⚠️ Só a tela normal fora do Modo TV mantém os três sempre visíveis: o Fluxo é usado em TABLET
 * pelos supervisores, e tablet não tem hover — esconder lá deixaria os três inalcançáveis. Este é
 * o ÚNICO ponto da decisão (usuário, 09/10: o embed esconde SEMPRE, não só em apresentação).
 */
export function controlesSoNoHover(emEmbed: boolean, emModoTv: boolean): boolean {
  return emEmbed || emModoTv
}

/**
 * Esconde sem tirar do layout. O hover é do CANVAS inteiro (`group/canvas`), não do botão —
 * senão ninguém acharia um botão invisível. `pointer-events-none` evita clique acidental no
 * invisível; `focus-within` mantém o teclado alcançando.
 */
export const CLASSE_SO_NO_HOVER =
  'opacity-0 pointer-events-none transition-opacity duration-200 ' +
  'group-hover/canvas:opacity-100 group-hover/canvas:pointer-events-auto ' +
  'focus-within:opacity-100 focus-within:pointer-events-auto'

export function classeSoNoHover(ativo: boolean): string {
  return ativo ? CLASSE_SO_NO_HOVER : ''
}
```

- [ ] **1.4 Rodar e ver passar** (mesmo comando). **1.5 Commit:**
  `git add src/shared/lib/modo-tv.ts src/shared/lib/__tests__/modo-tv.test.ts`
  `git commit -m "feat(fluxo): módulo puro do Modo TV (lerModoTv, esconder no hover)"` + trailer Co-Authored-By.

---

## Task 2 — `FluxoForm` liga o Modo TV por prop, sem a API de tela cheia (caso 3)

**Consome:** nada de novo (a prop ainda não é passada por ninguém). **Produz:** `FluxoForm` com
`modoTv?: boolean`: layout de apresentação ocupando o container, zero chamadas à API de tela cheia.

**Arquivos:** editar `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx`; criar
`src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-modo-tv.test.tsx`.

- [ ] **2.1 Teste (falha primeiro)** — `fluxo-form-modo-tv.test.tsx`. Copie o cabeçalho de mocks de
  `fluxo-form-op-fixa.test.tsx` (`vi.mock('server-only')`, stub de `ResizeObserver`, `vi.hoisted` com
  `carregarFluxo`/`opsComBipes`, `vi.mock` de `fluxo-actions` com as 10 funções, `OPS`) e acrescente:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
// ... mesmos mocks/OPS do fluxo-form-op-fixa.test.tsx ...
import { FluxoForm } from '../fluxo-form'

// O jsdom não implementa a API de tela cheia: instalar espiões é o que torna "NÃO chamou"
// observável. O par positivo (tela normal CHAMA) prova que o espião funciona.
const requestFullscreen = vi.fn(() => Promise.resolve())
const exitFullscreen = vi.fn(() => Promise.resolve())

beforeEach(() => {
  vi.clearAllMocks()
  opsComBipes.mockResolvedValue(null)
  carregarFluxo.mockResolvedValue({ ok: true, nodes: [], edges: [], qtd: null })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
})
afterEach(() => {
  delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
  delete (document as { exitFullscreen?: unknown }).exitFullscreen
})

const OP_FIXA = { pmo: 'PMOC13', op: '2340/26' }
/** Espera a OP carregar (o botão de Filtro só existe depois de `buscou`). */
const esperarCarregar = () => screen.findByRole('button', { name: 'Filtro e busca de SN' })

describe('FluxoForm com modoTv (embed em Modo TV)', () => {
  // O teste que prova a feature: é o único que denuncia o sintoma original (o Dashboard saindo
  // da tela cheia junto com o Fluxo).
  it('com modoTv o navegador NÃO entra em tela cheia', async () => {
    const { unmount } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()

    // O evento que o Dashboard dispara no pai também chega ao documento do iframe: não pode
    // desligar o modo nem pedir nada ao navegador.
    fireEvent(document, new Event('fullscreenchange'))
    await waitFor(() => expect(carregarFluxo).toHaveBeenCalled())
    unmount() // desmontar também não pode chamar exitFullscreen

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  // Par positivo: sem ele o "não chamou" acima passaria mesmo com o espião quebrado.
  it('sem modoTv o botão "Modo TV" continua pedindo a tela cheia ao navegador', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    fireEvent.click(screen.getByRole('button', { name: /Modo TV/ }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('o canvas ocupa o container todo (fixed) em vez de 70vh', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    expect(canvas).toHaveClass('fixed', 'inset-0')
    expect(canvas).not.toHaveClass('h-[70vh]')
  })

  it('fora do modoTv o canvas segue como hoje (relative, 70vh, sem fixed)', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    expect(canvas).toHaveClass('relative', 'h-[70vh]')
    expect(canvas).not.toHaveClass('fixed')
  })

  it('mostra a barra de apresentação (progresso) mas SEM o botão "Sair (Esc)"', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    expect(screen.getByText('progresso')).toBeInTheDocument() // a barra existe (par positivo)
    expect(screen.queryByText(/Sair \(Esc\)/)).not.toBeInTheDocument() // quem sai é o Dashboard
  })
})
```

- [ ] **2.2 Rodar e ver falhar:** `npx vitest run --maxWorkers=2 "src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-modo-tv.test.tsx"`
  (falha: `modoTv` ainda não existe; o canvas continua `relative h-[70vh]`).
  Se `findByRole(... 'Filtro e busca de SN')` não aparecer porque `carregarFluxo` mockado com
  `nodes: []` não marca `buscou`, ajuste o mock para devolver o que `fluxo-form-op-fixa.test.tsx`
  usa nos testes que dependem de `buscou` (não invente: leia o setup `buscou` perto da linha ~585).

- [ ] **2.3 Implementar em `fluxo-form.tsx`** (números de linha = antes da edição):

  a) **Props (~438-445):** acrescentar `modoTv = false` na desestruturação e
  `modoTv?: boolean` no tipo, com o comentário:
  ```ts
  /** Liga o layout do Modo TV POR FORA (embed `?modo=tv`) — sem a API de tela cheia do navegador:
   *  a tela cheia, aí, é do Dashboard, e disputá-la derrubava a dele. Atualiza a docstring acima. */
  ```

  b) **Estado (~910):** o estado derivado da API passa a se chamar `telaCheiaApi`; `telaCheia`
  vira o OR. Os 4 usos restantes de `telaCheia` (offsets `top-[4.75rem]`, barra, `aside`) **não mudam**.
  ```tsx
  const [telaCheiaApi, setTelaCheiaApi] = useState(false) // espelho do `fullscreenchange`
  const telaCheia = telaCheiaApi || modoTv // `modoTv` = ligado por fora, sem API
  ```

  c) **`alternarTv` (~912):** `if (modoTv) return` na primeira linha — não há o que alternar; nunca
  chama a API.

  d) **`iniciarApresentacao` / `sairApresentacao` (~644-646):** `void canvasRef.current?.requestFullscreen?.()`
  → `if (!modoTv) void canvasRef.current?.requestFullscreen?.()`; e em `sairApresentacao`
  `if (!modoTv && document.fullscreenElement) ...`. (Hoje inalcançáveis no embed porque
  `ocultarSeletor` esconde o botão Apresentação — a guarda impede que um futuro botão reabra a briga.)

  e) **`useEffect` do `fullscreenchange` (~930):** no corpo, **antes** de registrar:
  ```tsx
  if (modoTv) return // o modo é por prop; evento de tela cheia (do Dashboard) não decide nada aqui
  ```
  usar `setTelaCheiaApi` no lugar de `setTelaCheia`, e deps `[modoTv]`.

  f) **Alvo do portal do diálogo + re-encaixe**, novo `useEffect` logo abaixo do anterior:
  ```tsx
  // Com `modoTv` não há `fullscreenElement`: o diálogo do SN (HistoricoSnDialog) precisa renderizar
  // DENTRO do canvas (que aqui é `fixed inset-0`), senão cairia no `body` por trás dele. Também
  // re-encaixa o fluxo: o canvas acabou de mudar de tamanho.
  useEffect(() => {
    if (!modoTv) return
    setContainerTv(canvasRef.current)
    const t = setTimeout(() => rfRef.current?.fitView(), 120)
    return () => { clearTimeout(t); setContainerTv(null) }
  }, [modoTv])
  ```
  Se `react-hooks/set-state-in-effect` reclamar, é um `setState` de um valor vindo de ref **depois da
  montagem** (o ref não existe durante o render): use `// eslint-disable-next-line` com esse motivo.

  g) **Canvas (~1211):** trocar o `className` por
  ```tsx
  className={`fluxo-canvas group/canvas w-full overflow-hidden bg-neutral-100 ${
    modoTv ? 'fixed inset-0 z-50 h-dvh' : 'relative h-[70vh] rounded-lg border border-border'
  }`}
  ```
  (`group/canvas` já entra aqui e é usado na Task 3. Os filhos `absolute` continuam relativos ao
  canvas, que é `fixed`.)

  h) **Barra de apresentação, botão Sair (~1410-1419):** envolver o `<button onClick={alternarTv}>
  ... Sair (Esc)</button>` em `{!modoTv && (...)}`. O relógio e o progresso ficam.

  i) **`HistoricoSnDialog` (~1505):** **nenhuma mudança** — `container={containerTv ?? undefined}`
  já recebe o canvas pelo efeito do item (f). (Ver "Decisão: portal do diálogo" no fim.)

- [ ] **2.4 Rodar e ver passar** (comando do 2.2) **e** os existentes do arquivo irmão:
  `npx vitest run --maxWorkers=2 "src/app/(app)/shopfloor/fluxo/__tests__"`.
- [ ] **2.5 `npx tsc --noEmit`** sem erro novo.
- [ ] **2.6 Commit:**
  `git add "src/app/(app)/shopfloor/fluxo/fluxo-form.tsx" "src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-modo-tv.test.tsx"`
  `git commit -m "feat(fluxo): prop modoTv liga o Modo TV sem a API de tela cheia"`.

---

## Task 3 — Filtro, Zoom e Defeitos só no hover em Modo TV (casos 2 e 4)

**Consome:** `classeSoNoHover`, `controlesSoNoHover` (Task 1); `telaCheia`/`group/canvas` (Task 2).
**Produz:** a prop `embed?: boolean` em `FluxoForm` (passada pela página do embed, Task 4) e os três
controles escondidos no embed (com ou sem `modoTv`) e em Modo TV (por prop **ou** por tela cheia do
navegador); tela normal fora do Modo TV intacta.

**Arquivos:** editar `fluxo-form.tsx`; acrescentar casos em `fluxo-form-modo-tv.test.tsx`.

- [ ] **3.1 Testes (falham primeiro)** — acrescentar ao arquivo da Task 2:

```tsx
/** Os três controles, pelo que o usuário enxerga. */
function controles() {
  return {
    filtro: screen.getByRole('button', { name: 'Filtro e busca de SN' }),
    zoom: screen.getByTestId('controle-zoom'),
    defeitos: screen.getByRole('button', { name: /Defeitos/ }),
  }
}

describe('os três controles de operação (hover)', () => {
  // CASO 4 — o teste que protege o tablet. Tablet não tem hover: se algum dos três ganhar
  // `opacity-0` fora do Modo TV, o supervisor perde o filtro, o zoom e os defeitos.
  it('tela normal (fora do Modo TV): Filtro, Zoom e Defeitos continuam visíveis sem hover', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />) // seletor visível = tela normal
    await esperarCarregar()
    const { filtro, zoom, defeitos } = controles()
    for (const el of [filtro, zoom, defeitos]) {
      expect(el.className).not.toMatch(/opacity-0/)
      expect(el.className).not.toMatch(/group-hover/)
      expect(el.className).not.toMatch(/pointer-events-none/)
    }
  })

  // CASO 1 da spec: o embed SEM `?modo=tv` tem layout normal, mas os botões JÁ escondidos (hover).
  it('embed sem modoTv: layout normal, mas Filtro, Zoom e Defeitos já só no hover', async () => {
    const { container } = render(
      <FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />,
    )
    await esperarCarregar()
    const { filtro, zoom, defeitos } = controles()
    for (const el of [filtro, zoom, defeitos]) {
      expect(el).toHaveClass('opacity-0', 'group-hover/canvas:opacity-100')
    }
    // layout normal: sem modoTv o canvas NÃO vira apresentação (sem `fixed inset-0`).
    expect(container.querySelector('.fluxo-canvas')).not.toHaveClass('fixed')
  })

  // Modo TV da tela normal (tela cheia do navegador): também esconde. Disparar o evento com
  // `document.fullscreenElement` apontando para o canvas (mesmo padrão dos testes da Task 2).
  it('tela normal em tela cheia do navegador: os três só no hover', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas') as HTMLElement
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => canvas })
    fireEvent(document, new Event('fullscreenchange'))
    const { filtro, zoom, defeitos } = controles()
    for (const el of [filtro, zoom, defeitos]) expect(el).toHaveClass('opacity-0')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  })

  it('modoTv: Filtro, Zoom e Defeitos só aparecem no hover', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed modoTv />)
    await esperarCarregar()
    const { filtro, zoom, defeitos } = controles()
    for (const el of [filtro, zoom, defeitos]) {
      expect(el).toHaveClass('opacity-0', 'group-hover/canvas:opacity-100')
    }
  })

  it('o canvas é o `group/canvas` (o hover é dele, não do botão invisível)', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    expect(container.querySelector('.fluxo-canvas')).toHaveClass('group/canvas')
  })
})
```

- [ ] **3.2 Rodar e ver falhar** (comando da Task 2; `controle-zoom` não existe, classes ausentes).

- [ ] **3.3 Implementar em `fluxo-form.tsx`:**

  a) imports: `import { classeSoNoHover, controlesSoNoHover } from '@/shared/lib/modo-tv'`.
  a2) **Props:** acrescentar `embed = false` na desestruturação e `embed?: boolean` no tipo, com o
  comentário "marca que a tela roda dentro do iframe do Dashboard (passada SEMPRE pela página do
  embed, independente de `?modo=tv`); hoje só decide o esconder-no-hover dos três controles". Não
  reaproveitar `ocultarSeletor`/`opFixa` pra isso: são outra coisa e os testes da tela normal usam
  `opFixa` sem ser embed.
  b) logo após `const telaCheia = ...`:
  `const soNoHover = classeSoNoHover(controlesSoNoHover(embed, telaCheia))`.
  c) **Filtro (~1286):** acrescentar `${soNoHover}` ao `className` do botão vermelho.
  d) **Defeitos (~1260):** acrescentar `${soNoHover}` ao `className` do botão (virar template string).
  e) **Zoom (~1241):** dentro do `<Panel position="bottom-left">`, envolver
  ```tsx
  <div data-testid="controle-zoom" className={soNoHover}>
    <ControlesCanvas ... />
  </div>
  ```
  `ControlesCanvas` **não muda** (continua genérico; o wrapper é de quem o usa). O `Panel` do React
  Flow é descendente do canvas, então o `group-hover/canvas` o alcança.
  f) Quando o painel de Filtro está **aberto**, ele substitui o botão (não precisa de classe); o
  painel de Defeitos aberto cobre o canvas inteiro (idem).

- [ ] **3.4 Rodar e ver passar** (arquivo novo + a pasta `__tests__` do fluxo).
- [ ] **3.5 Commit:** `git add "src/app/(app)/shopfloor/fluxo/fluxo-form.tsx" "src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-modo-tv.test.tsx"`
  `git commit -m "feat(fluxo): Filtro, Zoom e Defeitos só no hover no embed e no Modo TV (tela normal intacta)"`.

---

## Task 4 — A página do embed lê `?modo=tv`

**Consome:** `lerModoTv` (Task 1), `FluxoForm modoTv` (Task 2). **Produz:** `/embed/fluxo/<pmo>/<op>?modo=tv`
abre em Modo TV; sem o parâmetro, layout normal mas com os três controles já só no hover (a página
passa `embed` **sempre**, independente do parâmetro).

**Arquivos:** editar `src/app/embed/fluxo/[pmo]/[op]/page.tsx` e `src/app/embed/__tests__/fluxo-embed.test.tsx`.

- [ ] **4.1 Testes (falham primeiro)** — em `fluxo-embed.test.tsx`:
  - interface `PropsFluxoForm`: acrescentar `modoTv?: boolean` e `embed?: boolean`.
  - helper `abrir` passa a aceitar `modo` (a página recebe `searchParams` como `Promise`, Next 16):
  ```tsx
  const abrir = (pmo = 'PMOC13', op = '2340%2F26', modo?: string | string[]) =>
    FluxoEmbedPage({
      params: Promise.resolve({ pmo, op }),
      searchParams: Promise.resolve(modo === undefined ? {} : { modo }),
    })
  ```
  - novo `describe('/embed/fluxo/[pmo]/[op] — ?modo=tv', ...)`:
  ```tsx
  const props = () => FluxoForm.mock.calls[0]![0]

  it('lê ?modo=tv e liga o Modo TV no fluxo', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(props().modoTv).toBe(true)
    expect(props().embed).toBe(true)
    expect(props().opFixa).toEqual({ pmo: 'PMOC13', op: '2340/26' })
    expect(props().ocultarSeletor).toBe(true) // o embed continua sem seletor
  })
  it('sem o parâmetro: Modo TV desligado (tela normal)', async () => {
    render(await abrir())
    expect(props().modoTv).toBe(false)
  })
  // Decisão do usuário (09/10): o embed esconde os três controles SEMPRE. A página tem de passar
  // `embed` mesmo sem o parâmetro (e com valor desconhecido).
  it('passa embed mesmo sem o parâmetro (esconder no hover não depende de ?modo=tv)', async () => {
    render(await abrir())
    expect(props().embed).toBe(true)
    expect(props().modoTv).toBe(false)
  })
  it('valor desconhecido não liga (?modo=foo)', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'foo'))
    expect(props().modoTv).toBe(false)
  })
  it('sf-embed:ready continua saindo nos dois casos', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
    avisarPai.mockClear()
    render(await abrir())
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
  })
  it('?modo=tv não afrouxa nada: sem sessão ainda não monta o fluxo', async () => {
    getSessao.mockResolvedValue(null)
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(FluxoForm).not.toHaveBeenCalled()
  })
  ```
  Os testes existentes que chamam `abrir(...)` seguem valendo (os parâmetros novos são opcionais).

- [ ] **4.2 Rodar e ver falhar:** `npx vitest run --maxWorkers=2 src/app/embed/__tests__/fluxo-embed.test.tsx`.

- [ ] **4.3 Implementar** em `page.tsx`:
  ```tsx
  import { lerModoTv } from '@/shared/lib/modo-tv'

  export default async function FluxoEmbedPage({
    params,
    searchParams,
  }: {
    params: Promise<{ pmo: string; op: string }>
    searchParams: Promise<{ modo?: string | string[] }>
  }) {
    const cru = await params
    // `?modo=tv`: o Dashboard manda quando ELE está em tela cheia. Só liga o layout — a tela cheia
    // do navegador continua do Dashboard (o Fluxo não a pede nem a larga). `embed` vai SEMPRE: é ele
    // (não o ?modo=tv) que esconde Filtro/Zoom/Defeitos até o hover.
    const modoTv = lerModoTv((await searchParams).modo)
    ...
    <FluxoForm ops={ops} ordensDashboard={ordensDashboard} opFixa={{ pmo, op }} ocultarSeletor embed modoTv={modoTv} />
  ```
  ⚠️ Só leitura de `searchParams` — **nenhum** `fetch('/api')`, `Link`, `href` ou `router` novo. O
  aviso do topo do arquivo continua valendo; acrescente "e `?modo=tv` é só layout" no docstring.

- [ ] **4.4 Rodar e ver passar** (arquivo inteiro). **4.5 Commit:**
  `git add "src/app/embed/fluxo/[pmo]/[op]/page.tsx" src/app/embed/__tests__/fluxo-embed.test.tsx`
  `git commit -m "feat(embed): /embed/fluxo lê ?modo=tv e liga o Modo TV"`.

---

## Task 5 — O `next` do SSO leva o `?modo=tv` até a página

**Consome:** nada novo. **Produz:** prova (teste) de que o contrato com o Dashboard já funciona; só
muda código se o teste falhar.

**Arquivos:** editar `src/modules/auth/domain/__tests__/sso-dashboard.test.ts`.

- [ ] **5.1 Teste** — dentro de `describe('validarNextEmbed', ...)`:
```ts
it('aceita query string: o ?modo=tv atravessa o SSO cru', () => {
  expect(validarNextEmbed('/embed/fluxo/PMOC13/2340%2F26?modo=tv')).toEqual({
    ok: true, next: '/embed/fluxo/PMOC13/2340%2F26?modo=tv',
  })
})
it('a query não destrava o /embed/sso nem a travessia', () => {
  expect(validarNextEmbed('/embed/sso?modo=tv').ok).toBe(false)
  expect(validarNextEmbed('/embed/../home?modo=tv').ok).toBe(false)
})
```
- [ ] **5.2 Rodar:** `npx vitest run --maxWorkers=2 src/modules/auth/domain/__tests__/sso-dashboard.test.ts`.
  Esperado: **passa de primeira** (o `validarNextEmbed` já devolve o valor cru e só tira a query para
  comparar a rota). Se o primeiro falhar, o ajuste é em `src/modules/auth/domain/sso-dashboard.ts` —
  pare e reporte antes de afrouxar qualquer validação.
- [ ] **5.3 Commit:** `git add src/modules/auth/domain/__tests__/sso-dashboard.test.ts`
  `git commit -m "test(sso): next com ?modo=tv atravessa o SSO do embed"`.

---

## Task 6 — Verificação completa e smoke manual

**Arquivos:** nenhum (só se achar defeito).

- [ ] **6.1** `npx tsc --noEmit` e `npx eslint "src/app/(app)/shopfloor/fluxo" src/app/embed src/shared/lib`.
- [ ] **6.2** `npx vitest run --maxWorkers=2` (suíte inteira).
- [ ] **6.3** `NODE_OPTIONS="--max-old-space-size=4096" npx next build` (roda nesta worktree).
- [ ] **6.4 Smoke manual** (jsdom não calcula CSS, então o que é **layout** só se vê no navegador):
  1. `/shopfloor/fluxo` (tela normal), OP escolhida: Filtro, Zoom e Defeitos visíveis **sem** mover o mouse
     (no tablet de verdade, se possível — é o que o teste do caso 4 protege).
     Clicar "Modo TV": entra em tela cheia, controles somem, aparecem no hover; Esc sai.
  2. `/embed/fluxo/<pmo>/<op>` num iframe **sem** o parâmetro: layout normal (não apresentação), mas
     os três botões **já escondidos**, aparecendo no hover.
  3. Mesmo iframe **com** `?modo=tv`, dentro de uma página em tela cheia: o canvas preenche o iframe,
     barra com OP/relógio/progresso, **sem** "Sair (Esc)", três controles só no hover, e **a página-pai
     continua em tela cheia** o tempo todo (o sintoma original).
  4. Com `?modo=tv`, clicar num SN (abre `HistoricoSnDialog`): o diálogo aparece **por cima do fluxo**,
     dentro do iframe, e fecha no X e no clique fora.
  5. ⚠️ Conferir que nenhum ancestral do canvas tem `transform`/`filter`/`contain` (o `Card` em
     `fluxo-form.tsx`): se tiver, o `fixed inset-0` fica preso ao ancestral em vez do iframe e o
     canvas não preenche. Se acontecer, subir a decisão (ex.: portal do canvas) — não improvisar.
- [ ] **6.5** Sem commit, a menos que o smoke ache defeito (aí: teste que reproduz → correção → commit).

---

## Task 7 (FUTURA, só se o Dashboard preferir não recarregar o iframe) — `postMessage` liga/desliga

Não entra nesta entrega. A estrutura acima foi feita para isto ser **uma task a mais**, não uma
reescrita: o miolo (`FluxoForm modoTv`) já responde só à prop.

**Consome:** `modoTv` (Task 2) como valor **inicial**; `src/shared/lib/mensagem-embed.ts` e
`origemDashboard()`. **Produz:** o Dashboard alterna o modo sem reload.

- Em `mensagem-embed.ts`, tipo de mensagem **de entrada** `{ type: 'sf-embed:modo-tv', ativo: boolean }`
  e um validador puro `lerMensagemModoTv(evento, origemEsperada)` (confere `event.origin === origem`
  do Dashboard, **nunca** `*`; descarta o resto) — com testes antes.
- Em `embed-ponte.tsx` (ou um irmão `embed-modo-tv.tsx`, client): estado `modoTv` iniciado pelo valor
  que a página passou; `window.addEventListener('message', ...)` troca o estado; renderiza o
  `FluxoForm` com o estado. A página continua passando o inicial (`?modo=tv`) — o carregamento a
  frio e o `postMessage` convivem.
- Teste de integração: montar, `window.postMessage`/`dispatchEvent(new MessageEvent('message', {origin}))`
  com origem certa liga; com origem errada **não**.
- Mesma restrição: nada de `fetch('/api')`, `Link`, `href`, `router`.

---

## Decisão: portal do diálogo do SN

`HistoricoSnDialog` recebe `container`: dentro do Modo TV o portal tem de ser o canvas (o `body` fica
por trás do elemento em tela cheia; o `Dialog` base-ui fica instável — por isso o overlay próprio).
Hoje o destino é `fullscreenElement` (o canvas). Com `modoTv` **não há** `fullscreenElement`, então:

- **O destino continua sendo o canvas.** O efeito da Task 2 (f) faz `setContainerTv(canvasRef.current)`
  quando `modoTv` liga. Como o canvas é `fixed inset-0 z-50`, o overlay `absolute` do diálogo cobre o
  iframe inteiro e fica acima do fluxo.
- Por que não o `body`: o canvas (`fixed z-50`) cria contexto de empilhamento e cobriria um diálogo
  `fixed` no `body`. Por que não deixar `undefined`: mesmo motivo.
- O `onFs` não pode zerar o `containerTv` quando chega um `fullscreenchange` do Dashboard: por isso a
  guarda `if (modoTv) return` no efeito (Task 2, e).
- `historico-sn-dialog.tsx` **não muda**. A verificação é o smoke 6.4 (4): o jsdom não prova
  empilhamento.

## Pontos da spec ambíguos (e a recomendação adotada)

1. ~~**"Esconder no embed e no Modo TV" × caso 1 ("embed sem o parâmetro: três botões visíveis").**~~
   **DECIDIDO (usuário, 09/10; spec corrigida em `8e7c9c5`):** o embed esconde os três controles
   **sempre**, com ou sem `?modo=tv`; a tela normal em Modo TV (tela cheia do navegador) também; só
   a tela normal fora do Modo TV mantém os três visíveis (tablet, sem hover). Implementação: prop
   `embed` em `FluxoForm`, passada sempre pela página do embed; `controlesSoNoHover(emEmbed, emModoTv)`
   é o ponto único. Testes: `embed sem modoTv: ...` e `passa embed mesmo sem o parâmetro`.
2. **Modo TV pela tela cheia do navegador num tablet** (botão "Modo TV" da tela normal): pela spec os
   três somem lá também, e o tablet não alcança sem hover (só "Sair" da barra e Esc). Recomendação:
   manter como a spec diz (é Modo TV, a pessoa está apresentando), mas avisar o produto.
3. **"Ocupando o iframe todo"**: a spec não diz como. Adotado `fixed inset-0 z-50 h-dvh` no canvas;
   risco de ancestral com `transform` coberto no smoke 6.4 (5).
4. **Quem liga quando o Dashboard sai da tela cheia** (spec: pergunta em aberto): o plano cobre o
   caminho de trocar o `src`; o `postMessage` é a Task 7, sem reescrita.
