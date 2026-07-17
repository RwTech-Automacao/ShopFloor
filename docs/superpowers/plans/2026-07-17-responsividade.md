# Responsividade — pacote final — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar card ao Grid de Processos, dar chips ao card das Etiquetas, e mover o corte tabela↔card de 768 para 1024 em todo o sistema.

**Architecture:** O corte é uma troca mecânica de `md:`→`lg:` só nas classes do switch tabela↔card. O Grid ganha um bloco de card (`lg:hidden`) que reusa o `MenuColuna` existente numa barra de "chips" + um subcomponente `CardProcesso`. As Etiquetas (que já têm card) ganham a mesma barra de chips e o estilo de tracejado. Nenhuma lógica de dados muda.

**Tech Stack:** Next.js 16 (client components), TypeScript strict (`noUncheckedIndexedAccess`), Tailwind, base-ui.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs`." Next 16.
- **Corte só nas classes do switch:** `md:hidden`→`lg:hidden` (bloco de cards) e `md:block`→`lg:block` (bloco de tabela). **NÃO** tocar em outras utilidades `md:` (ex.: `sm:grid-cols-3 md:grid-cols-4` da grade de fotos em `anexos-processo.tsx`).
- **Estilo novo (tracejado + "ver mais" + chips) só nas 2 grades** (Grid e Etiquetas). As telas de Configurações/Importações mantêm o card simples.
- **Sem TDD** (apresentação). Sem migração, sem servidor. As Server Actions e a lógica de seleção/gerar **não mudam**.
- **URLs com `URLSearchParams`** (nunca concatenar à mão).
- TS strict `noUncheckedIndexedAccess`. Componentes client começam com `'use client'`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **Subagentes NÃO dão `git push`.**
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`. (Se o build der `heap out of memory`, mate o `next dev` ou use `NODE_OPTIONS="--max-old-space-size=4096"`.)

## File Structure

- **Modify** (Task 1 — só o corte): `configuracoes/{criticidade,perfis,campos,usuarios,nqa,logs}/page.tsx`, `configuracoes/listas/page.tsx`, `configuracoes/listas/[chave]/page.tsx`, `recebimento/importacoes/page.tsx`, `recebimento/etiquetas/historico/page.tsx`.
- **Modify** (Task 2): `recebimento/processos/processos-grid.tsx` — `MenuColuna` ganha `comoChip`; tabela em `hidden lg:block`; novo bloco de card + `CardProcesso`.
- **Modify** (Task 3): `recebimento/etiquetas/etiquetas-cliente.tsx` — `MenuColunaEtiqueta` ganha `comoChip`; corte `md`→`lg`; barra de chips + tracejado no card existente.

---

### Task 1: Mover o corte 768→1024 nas telas já responsivas

**Files:**
- Modify: `src/app/(app)/configuracoes/criticidade/page.tsx`
- Modify: `src/app/(app)/configuracoes/perfis/page.tsx`
- Modify: `src/app/(app)/configuracoes/campos/page.tsx`
- Modify: `src/app/(app)/configuracoes/usuarios/page.tsx`
- Modify: `src/app/(app)/configuracoes/nqa/page.tsx`
- Modify: `src/app/(app)/configuracoes/logs/page.tsx`
- Modify: `src/app/(app)/configuracoes/listas/page.tsx`
- Modify: `src/app/(app)/configuracoes/listas/[chave]/page.tsx`
- Modify: `src/app/(app)/recebimento/importacoes/page.tsx`
- Modify: `src/app/(app)/recebimento/etiquetas/historico/page.tsx`

Cada arquivo tem **exatamente um** bloco de card e **um** de tabela com o mesmo shape. (O Grid e as Etiquetas ficam para as Tasks 2 e 3.)

- [ ] **Step 1: Trocar o par em cada arquivo**

Em cada um dos 10 arquivos acima, fazer as duas trocas:
1. `space-y-3 md:hidden` → `space-y-3 lg:hidden` (o bloco de cards).
2. `bg-card md:block` → `bg-card lg:block` (o final da className do bloco de tabela — a classe é `hidden overflow-hidden rounded-lg border border-border bg-card md:block`).

Use edições exatas por string; **não** faça um replace global de `md:` (há outros `md:` legítimos no projeto).

- [ ] **Step 2: Conferir que só o switch mudou**

Run: `grep -rn "md:hidden\|md:block" "src/app/(app)/configuracoes" "src/app/(app)/recebimento/importacoes" "src/app/(app)/recebimento/etiquetas/historico"`
Expected: **nenhuma** ocorrência (todas viraram `lg:`). Os arquivos do Grid e das Etiquetas ainda podem ter `md:` (ficam para as próximas tasks).

- [ ] **Step 3: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

```bash
git add "src/app/(app)/configuracoes" "src/app/(app)/recebimento/importacoes/page.tsx" "src/app/(app)/recebimento/etiquetas/historico/page.tsx"
git commit -F - << 'EOF'
feat(ui): corte tabela↔card em 1024 nas telas de config/importações

Tablet em pé passa a mostrar card (antes só abaixo de 768).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Card do Grid de Processos

**Files:**
- Modify: `src/app/(app)/recebimento/processos/processos-grid.tsx`

**Interfaces:**
- Consumes: `MenuColuna`, `celula`, `codificarEstadoGrid`, `rotuloStatusProcesso`, `Badge`, `Link`, `ColunaGrid`, `EstadoGrid` (todos já no arquivo).

- [ ] **Step 1: `MenuColuna` ganha o modo chip**

Em `MenuColunaProps` (a interface do `MenuColuna`), acrescentar:

```tsx
  comoChip?: boolean
```

Na assinatura do componente, adicionar `comoChip` ao destructuring: `function MenuColuna({ coluna, estado, ativo, ordenando, direcao, onAplicar, comoChip }: MenuColunaProps) {`.

Trocar o `<button>` do `PopoverTrigger` (o que tem `className="flex items-center gap-1 font-medium hover:text-enterplak"`) para ter a className condicional:

```tsx
          <button
            type="button"
            className={
              comoChip
                ? `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${
                    ativo || ordenando
                      ? 'border-enterplak bg-enterplak-50 text-enterplak'
                      : 'border-border hover:bg-muted'
                  }`
                : 'flex items-center gap-1 font-medium hover:text-enterplak'
            }
          >
```

(O conteúdo do botão — `{coluna.rotulo}`, o indicador de ordenação e o `FilterIcon` — **não muda**.)

- [ ] **Step 2: Envolver a tabela em `hidden lg:block`**

No `return` do `ProcessosGrid`, trocar a abertura do `<ScrollHorizontalTopo>` para ficar dentro de um `<div className="hidden lg:block">`, e fechar o `</div>` depois do `</ScrollHorizontalTopo>`:

```tsx
      <div className="hidden lg:block">
        <ScrollHorizontalTopo>
          <Table className="text-xs [&_:is(th,td)]:px-2.5 [&_:is(th,td)]:whitespace-nowrap">
            {/* ...conteúdo da tabela inalterado... */}
          </Table>
        </ScrollHorizontalTopo>
      </div>
```

- [ ] **Step 3: Adicionar o bloco de card (`lg:hidden`)**

Logo **depois** do `</div>` que fecha o bloco da tabela (Step 2) e **antes** do `<div>` do rodapé de paginação, inserir:

```tsx
      <div className="flex flex-col gap-3 lg:hidden">
        {/* Barra de chips: os mesmos menus de coluna do desktop, em pílula */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {colunas.map((coluna) => (
            <MenuColuna
              key={coluna.campo}
              coluna={coluna}
              estado={estado}
              onAplicar={aplicar}
              ativo={Boolean(estado.filtros[coluna.campo])}
              ordenando={estado.ordenar === coluna.campo}
              direcao={estado.direcao}
              comoChip
            />
          ))}
        </div>

        {linhas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhum processo encontrado para os filtros aplicados.
          </p>
        )}
        {linhas.map((linha, i) => (
          <CardProcesso key={String(linha.id)} linha={linha} colunas={colunas} estado={estado} indice={i} />
        ))}
      </div>
```

- [ ] **Step 4: O subcomponente `CardProcesso`**

Adicionar no fim do arquivo (escopo do módulo). Reusa `celula`, `codificarEstadoGrid`, `rotuloStatusProcesso`, `Badge` (já importados):

```tsx
const CAP_COLUNAS_CARD = 6

/**
 * Um processo como card (celular/tablet em pé). Nº como título + Status como badge; as
 * demais colunas visíveis viram uma lista `rótulo···valor` com tracejado, com teto de 6 +
 * "ver mais". O card inteiro é o mesmo link da seta da tabela (leva `?g=&i=`).
 */
function CardProcesso({
  linha,
  colunas,
  estado,
  indice,
}: {
  linha: Record<string, unknown>
  colunas: ColunaGrid[]
  estado: EstadoGrid
  indice: number
}) {
  const [expandido, setExpandido] = useState(false)
  const status = rotuloStatusProcesso(String(linha.status ?? ''))
  const demais = colunas.filter((c) => c.campo !== 'numero' && c.campo !== 'status')
  const visiveis = expandido ? demais : demais.slice(0, CAP_COLUNAS_CARD)
  const ocultas = demais.length - CAP_COLUNAS_CARD

  const q = new URLSearchParams({
    g: codificarEstadoGrid(estado),
    i: String(estado.pagina * estado.tamanho + indice),
  })

  return (
    <Link
      href={`/recebimento/processos/${String(linha.id)}?${q.toString()}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-enterplak"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Nº {String(linha.numero ?? '—')}</span>
        <Badge className={status.className}>{status.rotulo}</Badge>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5">
        {visiveis.map((coluna) => (
          <div key={coluna.campo} className="flex items-baseline gap-1.5">
            <dt className="whitespace-nowrap text-sm text-muted-foreground">{coluna.rotulo}</dt>
            <span
              aria-hidden
              className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-border"
            />
            <dd className="max-w-[55%] truncate text-sm font-medium">
              {celula(coluna, linha[coluna.campo])}
            </dd>
          </div>
        ))}
      </dl>
      {ocultas > 0 && (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-enterplak hover:underline"
          onClick={(e) => {
            // Não navegar: o card é um link, mas este botão só expande.
            e.preventDefault()
            setExpandido((v) => !v)
          }}
        >
          {expandido ? '− ver menos' : `+ ver mais ${ocultas} colunas`}
        </button>
      )}
    </Link>
  )
}
```

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros. (No smoke: abaixo de 1024 vira card; a tabela some; acima de 1024 tudo como antes.)

```bash
git add "src/app/(app)/recebimento/processos/processos-grid.tsx"
git commit -F - << 'EOF'
feat(grid): card do Grid de Processos no mobile/tablet-em-pé

Barra de chips (reusa MenuColuna) + cards Nº+Status+colunas com tracejado e "ver
mais". A tabela vira card abaixo de 1024. O card leva o mesmo ?g=&i= das setas.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Card das Etiquetas — chips + tracejado

**Files:**
- Modify: `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`

**Interfaces:**
- Consumes: `MenuColunaEtiqueta` (mesmo arquivo), `valoresPorColuna`, `subFiltro`/`setSubFiltro`, `rotuloStatusProcesso`, `Badge` (já no arquivo).

- [ ] **Step 1: `MenuColunaEtiqueta` ganha o modo chip**

Em `MenuColunaEtiquetaProps`, acrescentar `comoChip?: boolean`. Na assinatura do componente, adicionar `comoChip` ao destructuring.

Trocar o `<button>` do `PopoverTrigger` (o que tem `className="flex items-center gap-1 font-medium hover:text-enterplak"`) para a className condicional (idêntica à do Grid):

```tsx
          <button
            type="button"
            className={
              comoChip
                ? `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${
                    ativo || ordenando
                      ? 'border-enterplak bg-enterplak-50 text-enterplak'
                      : 'border-border hover:bg-muted'
                  }`
                : 'flex items-center gap-1 font-medium hover:text-enterplak'
            }
          >
```

(O conteúdo — `{rotulo}`, indicador de ordenação, `FilterIcon` — não muda.)

- [ ] **Step 2: Corte `md`→`lg` nos dois blocos de resultado**

No `etiquetas-cliente.tsx`:
1. O bloco da tabela de resultados: `bg-card md:block` → `bg-card lg:block` (linha ~242, `hidden overflow-hidden rounded-lg border border-border bg-card md:block`).
2. O bloco de cards: `space-y-3 md:hidden` → `space-y-3 lg:hidden` (linha ~316).

- [ ] **Step 3: Barra de chips no topo do bloco de card**

No começo do bloco de card (`<div className="space-y-3 lg:hidden">`, agora `lg:hidden`), **antes** do `{linhasVisiveis.length === 0 && ...}`, inserir a barra com os 5 menus do sub-filtro em modo chip:

```tsx
            <div className="flex gap-2 overflow-x-auto pb-1">
              <MenuColunaEtiqueta campo="numero" rotulo="Nº" valores={valoresPorColuna.numero} subFiltro={subFiltro} onAplicar={setSubFiltro} comoChip />
              <MenuColunaEtiqueta campo="status" rotulo="Status" valores={valoresPorColuna.status} rotuloValor={(v) => rotuloStatusProcesso(v).rotulo} subFiltro={subFiltro} onAplicar={setSubFiltro} comoChip />
              <MenuColunaEtiqueta campo="codigoMaterial" rotulo="Código" valores={valoresPorColuna.codigoMaterial} subFiltro={subFiltro} onAplicar={setSubFiltro} comoChip />
              <MenuColunaEtiqueta campo="numeroPedido" rotulo="Pedido" valores={valoresPorColuna.numeroPedido} subFiltro={subFiltro} onAplicar={setSubFiltro} comoChip />
              <MenuColunaEtiqueta campo="doc" rotulo="Doc" valores={valoresPorColuna.doc} subFiltro={subFiltro} onAplicar={setSubFiltro} comoChip />
            </div>
```

- [ ] **Step 4: Card com Status no topo + tracejado no corpo**

Dentro do `.map` dos cards, trocar o corpo do card. Hoje é: um `<div className="flex items-start gap-3">` com o checkbox + um `<div className="min-w-0 flex-1">` que tem `#{numero}` e um `<dl className="mt-2 space-y-1.5 text-sm">` com 6 linhas (Status/Código/Pedido/Doc/Volumes/Prévia). Trocar por: Status vira badge no topo (junto do Nº) e o corpo usa o tracejado.

Substituir o conteúdo do `<div className="min-w-0 flex-1">` por:

```tsx
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">#{processo.numero}</span>
                        <Badge className={status.className}>{status.rotulo}</Badge>
                      </div>
                      <dl className="mt-2 flex flex-col gap-1.5">
                        {[
                          { rot: 'Código', val: processo.codigoMaterial || '—' },
                          { rot: 'Pedido', val: processo.numeroPedido || '—' },
                          { rot: 'Doc', val: processo.diInpi || processo.numeroNf || '—' },
                          { rot: 'Volumes', val: processo.volumes ?? '—' },
                        ].map((r) => (
                          <div key={r.rot} className="flex items-baseline gap-1.5">
                            <dt className="whitespace-nowrap text-sm text-muted-foreground">{r.rot}</dt>
                            <span aria-hidden className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-border" />
                            <dd className="max-w-[55%] truncate text-sm font-medium">{r.val}</dd>
                          </div>
                        ))}
                        <div className="flex items-baseline gap-1.5">
                          <dt className="whitespace-nowrap text-sm text-muted-foreground">Prévia</dt>
                          <span aria-hidden className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-border" />
                          <dd
                            className={
                              elegib.elegivel
                                ? 'max-w-[55%] truncate font-mono text-xs'
                                : 'max-w-[55%] truncate text-sm text-muted-foreground italic'
                            }
                          >
                            {textoPrevia}
                          </dd>
                        </div>
                      </dl>
                    </div>
```

(O `<input type="checkbox">` que fica **antes** desse `<div>`, o `elegib`, o `status` e o `textoPrevia` — tudo **não muda**; só o conteúdo interno do `<div className="min-w-0 flex-1">`.)

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros.

```bash
git add "src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx"
git commit -F - << 'EOF'
feat(etiquetas): card mobile ganha chips de sub-filtro + tracejado (copia o Grid)

Corte md→lg; barra de chips (MenuColunaEtiqueta) torna o sub-filtro usável no
celular; Status vira badge no topo e o corpo usa tracejado rótulo···valor. O
checkbox de seleção e a lógica de gerar não mudam.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suite completo**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde. Único warning aceitável: o `<img>` pré-existente em `anexos-processo.tsx`. Conferir que a grade de fotos (`anexos-processo.tsx`) **ainda** tem `md:grid-cols-4` (não foi tocada).

- [ ] **Step 2: Smoke (redimensionar a janela; NÃO fazer push)**

Abaixo de 1024px (DevTools → tablet/celular):
1. **Grid de Processos:** vira cards (Nº + Status + colunas com tracejado, teto 6 + "ver mais" abre/fecha); a barra de chips ordena/filtra igual ao desktop (chip ativo em vinho); tocar num card abre o processo e as **setas** funcionam (veio o `?g=&i=`); paginação funciona. Acima de 1024, volta à tabela.
2. **Etiquetas:** buscar → os resultados viram cards; a barra de chips filtra/ordena (o sub-filtro agora funciona no celular); o **checkbox** seleciona e o **Gerar** usa a seleção; Status como badge no topo, corpo com tracejado.
3. **Uma tela de config** (ex.: Campos): agora vira card em tablet em pé (≤1024), estilo simples de sempre.
4. Nenhuma regressão no desktop (≥1024): Grid, Etiquetas e config idênticos ao de antes.

- [ ] **Step 3: NÃO fazer push**

Commits ficam locais; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura da spec:**
- Corte 768→1024 em todas → Task 1 (config/importações/histórico) + Task 2 (Grid) + Task 3 (Etiquetas). ✅
- Card do Grid: Nº+Status+colunas visíveis com tracejado, teto 6 + ver mais, link com ?g=&i= → Task 2 (`CardProcesso`). ✅
- Chips reusando o menu existente → Task 2 (`MenuColuna comoChip`) + Task 3 (`MenuColunaEtiqueta comoChip`). ✅
- Estilo novo só nas 2 grades; config mantém simples → Task 1 não muda conteúdo, só o corte. ✅
- Etiquetas copia o Grid (chips + tracejado), checkbox/gerar intactos → Task 3. ✅
- Não tocar `md:grid-cols-4` das fotos → Global Constraints + Task 4 Step 1. ✅

**Consistência de tipos:** `comoChip?: boolean` adicionado a `MenuColunaProps` (Task 2) e `MenuColunaEtiquetaProps` (Task 3); `CardProcesso` recebe `{ linha, colunas, estado, indice }` com os tipos do arquivo; reusa `celula`/`codificarEstadoGrid` já existentes. ✅

**Sem placeholders:** todo passo traz o código completo; o "antes" foi lido do repo. ✅
