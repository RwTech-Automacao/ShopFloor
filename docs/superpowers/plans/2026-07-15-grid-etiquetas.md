# Sub-filtro estilo planilha na tela de Etiquetas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sobre o resultado da busca de etiquetas, um sub-filtro estilo Excel (ordenar + busca + checkbox) nas colunas Nº, Status, Código, Pedido, Doc — aplicado no cliente, em memória.

**Architecture:** Uma função pura de domínio filtra/ordena as ≤500 linhas já carregadas. A tela ganha um menu por coluna (Popover) que edita um estado efêmero de sub-filtro; a tabela passa a exibir as linhas resultantes. Sem servidor, sem migração, sem URL.

**Tech Stack:** Next.js 16 (client component), TypeScript strict (`noUncheckedIndexedAccess`), Tailwind/base-ui, vitest.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know — read `node_modules/next/dist/docs` before writing Next code." Next 16.
- **Client-side.** O sub-filtro opera sobre `resultados` (≤500 linhas já no navegador). **Não** há Server Action nova, migração nem persistência na URL.
- **Colunas com menu:** `Nº`, `Status`, `Código`, `Pedido`, `Doc`. Volumes e Prévia **sem** menu.
- **Doc** é derivado: `diInpi || numeroNf`. **Status** filtra pelo valor cru, mas o checkbox exibe `rotuloStatusProcesso(v).rotulo` (pt-BR).
- **Seleção persiste por id** — o sub-filtro só esconde linhas. `selecionarTodosElegiveis` opera sobre as linhas **visíveis**. O contador mostra o total visível.
- **Reusar** os primitivos `Popover` e `Checkbox` (criados no grid de Processos — commits locais). **Não** reusar o `MenuColuna` do grid (aquele é server-side).
- **`tsconfig` tem `noUncheckedIndexedAccess`.**
- **Verificação:** `npx tsc --noEmit` + `npm run lint` + `npm run build`; `npm run test` (TDD no domínio). **SEM push** no fim (usuário valida o smoke).

---

### Task 1: Domínio — sub-filtro (TDD)

**Files:**
- Create: `src/modules/etiquetas/domain/sub-filtro.ts`
- Create: `src/modules/etiquetas/domain/__tests__/sub-filtro.test.ts`

**Interfaces:**
- Produces: `DirecaoSub`, `FiltroColunaSub`, `SubFiltroEtiquetas`, `SUB_FILTRO_PADRAO`, `Acessor<T>`, `valoresDistintosSub`, `aplicarSubFiltro`.

- [ ] **Step 1: Escrever os testes (que falham)**

Criar `src/modules/etiquetas/domain/__tests__/sub-filtro.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SUB_FILTRO_PADRAO,
  aplicarSubFiltro,
  valoresDistintosSub,
  type Acessor,
  type SubFiltroEtiquetas,
} from '../sub-filtro'

type Linha = { numero: number; status: string; codigo: string | null; doc: string }

const ACESSORES: Record<string, Acessor<Linha>> = {
  numero: (l) => l.numero,
  status: (l) => l.status,
  codigo: (l) => l.codigo ?? '',
  doc: (l) => l.doc,
}

const LINHAS: Linha[] = [
  { numero: 57, status: 'Aprovado', codigo: 'BETA', doc: 'DI1' },
  { numero: 12, status: 'aberto', codigo: 'ALFA', doc: 'DI2' },
  { numero: 34, status: 'Aprovado', codigo: null, doc: 'DI3' },
]

describe('valoresDistintosSub', () => {
  it('distintos, ordenados, sem vazios', () => {
    expect(valoresDistintosSub(LINHAS, ACESSORES.status!)).toEqual(['Aprovado', 'aberto'])
    expect(valoresDistintosSub(LINHAS, ACESSORES.codigo!)).toEqual(['ALFA', 'BETA']) // null omitido
  })
})

describe('aplicarSubFiltro', () => {
  it('sem filtro nem ordenação mantém a ordem original', () => {
    expect(aplicarSubFiltro(LINHAS, SUB_FILTRO_PADRAO, ACESSORES)).toEqual(LINHAS)
  })

  it('filtra por texto (case-insensitive)', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, filtros: { codigo: { texto: 'alf' } } }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([12])
  })

  it('filtra por valores (checkbox)', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, filtros: { status: { valores: ['Aprovado'] } } }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([57, 34])
  })

  it('ordena Nº numericamente (não alfabético)', () => {
    const asc: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'asc' }
    expect(aplicarSubFiltro(LINHAS, asc, ACESSORES).map((l) => l.numero)).toEqual([12, 34, 57])
    const desc: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'desc' }
    expect(aplicarSubFiltro(LINHAS, desc, ACESSORES).map((l) => l.numero)).toEqual([57, 34, 12])
  })

  it('ordena texto por localeCompare', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'codigo', direcao: 'asc' }
    // codigo null vira '' → vai para o fim
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.codigo)).toEqual(['ALFA', 'BETA', null])
  })

  it('vazios sempre por último, mesmo em desc', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'codigo', direcao: 'desc' }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.codigo)).toEqual(['BETA', 'ALFA', null])
  })

  it('combina texto + valores', () => {
    const sf: SubFiltroEtiquetas = {
      ...SUB_FILTRO_PADRAO,
      filtros: { status: { valores: ['Aprovado'] }, doc: { texto: 'di1' } },
    }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([57])
  })

  it('não muta a entrada', () => {
    const copia = LINHAS.map((l) => ({ ...l }))
    aplicarSubFiltro(LINHAS, { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'asc' }, ACESSORES)
    expect(LINHAS).toEqual(copia)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- sub-filtro`
Expected: FAIL (módulo `../sub-filtro` não existe).

- [ ] **Step 3: Implementar**

Criar `src/modules/etiquetas/domain/sub-filtro.ts`:

```ts
export type DirecaoSub = 'asc' | 'desc'

/** Filtro de uma coluna: busca por texto e/ou valores marcados no checkbox. */
export type FiltroColunaSub = { texto?: string; valores?: string[] }

export interface SubFiltroEtiquetas {
  ordenar: string | null // coluna, ou null = ordem original (numero desc do servidor)
  direcao: DirecaoSub
  filtros: Record<string, FiltroColunaSub>
}

export const SUB_FILTRO_PADRAO: SubFiltroEtiquetas = { ordenar: null, direcao: 'asc', filtros: {} }

/** Valor comparável de uma coluna, para uma linha. `numero` devolve number
 *  (ordena numericamente); o resto devolve string. */
export type Acessor<T> = (linha: T) => string | number | null

function ehVazio(v: string | number | null): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** Valores distintos de uma coluna, a partir das linhas — para o checkbox.
 *  Ordenados (pt-BR, numérico-aware); vazios/nulos omitidos. */
export function valoresDistintosSub<T>(linhas: T[], acessor: Acessor<T>): string[] {
  const set = new Set<string>()
  for (const linha of linhas) {
    const v = acessor(linha)
    if (ehVazio(v)) continue
    set.add(String(v))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
}

/** Aplica busca por texto + checkbox de valores e a ordenação, em memória.
 *  Não muta a entrada. Vazios vão sempre para o fim na ordenação. */
export function aplicarSubFiltro<T>(
  linhas: T[],
  subFiltro: SubFiltroEtiquetas,
  acessores: Record<string, Acessor<T>>,
): T[] {
  const filtradas = linhas.filter((linha) => {
    for (const [campo, filtro] of Object.entries(subFiltro.filtros)) {
      const acessor = acessores[campo]
      if (!acessor) continue // coluna desconhecida: ignora
      const bruto = acessor(linha)
      const valor = bruto === null || bruto === undefined ? '' : String(bruto)
      if (filtro.texto && !valor.toLowerCase().includes(filtro.texto.toLowerCase())) return false
      if (filtro.valores && filtro.valores.length > 0 && !filtro.valores.includes(valor)) return false
    }
    return true
  })

  const acessorOrdem = subFiltro.ordenar ? acessores[subFiltro.ordenar] : undefined
  if (!acessorOrdem) return filtradas

  const dir = subFiltro.direcao === 'asc' ? 1 : -1
  return [...filtradas].sort((a, b) => {
    const va = acessorOrdem(a)
    const vb = acessorOrdem(b)
    const ea = ehVazio(va)
    const eb = ehVazio(vb)
    if (ea && eb) return 0
    if (ea) return 1 // vazio sempre por último
    if (eb) return -1
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })
    return dir * cmp
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- sub-filtro`
Expected: PASS (todos).

- [ ] **Step 5: Verificar tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/modules/etiquetas/domain/sub-filtro.ts src/modules/etiquetas/domain/__tests__/sub-filtro.test.ts
git commit -m "feat(etiquetas): domínio do sub-filtro client-side (ordenar/texto/checkbox) — TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: UI — menus de coluna + sub-filtro na tela de Etiquetas

**Files:**
- Modify: `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`

**Interfaces:**
- Consumes: `SubFiltroEtiquetas`, `SUB_FILTRO_PADRAO`, `aplicarSubFiltro`, `valoresDistintosSub`, `Acessor` (Task 1); `Popover`/`Checkbox` (`@/components/ui/*`); `ProcessoEtiquetaLista`, `rotuloStatusProcesso` (já importados).

- [ ] **Step 1: Imports novos**

Em `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`, adicionar aos imports de UI:

```tsx
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowDownAZIcon, ArrowUpAZIcon, FilterIcon } from 'lucide-react'
```

E o domínio (junto dos imports de `@/modules/etiquetas/...`):

```tsx
import {
  SUB_FILTRO_PADRAO,
  aplicarSubFiltro,
  valoresDistintosSub,
  type Acessor,
  type SubFiltroEtiquetas,
} from '@/modules/etiquetas/domain/sub-filtro'
```

- [ ] **Step 2: Acessores das colunas (escopo do módulo)**

Logo após os imports e antes do componente `EtiquetasCliente`, adicionar:

```tsx
/** Colunas do sub-filtro e como ler o valor de cada uma numa linha. `numero`
 *  devolve number (ordena numericamente); `doc` é derivado (DI/INPI ou NF). */
const ACESSORES = {
  numero: (p: ProcessoEtiquetaLista) => p.numero,
  status: (p: ProcessoEtiquetaLista) => p.status,
  codigoMaterial: (p: ProcessoEtiquetaLista) => p.codigoMaterial ?? '',
  numeroPedido: (p: ProcessoEtiquetaLista) => p.numeroPedido ?? '',
  doc: (p: ProcessoEtiquetaLista) => p.diInpi || p.numeroNf || '',
} satisfies Record<string, Acessor<ProcessoEtiquetaLista>>
```

- [ ] **Step 3: Estado, memos e ajustes no componente**

Dentro de `EtiquetasCliente`, logo após `const [gerando, startGeracao] = useTransition()`:

```tsx
  const [subFiltro, setSubFiltro] = useState<SubFiltroEtiquetas>(SUB_FILTRO_PADRAO)

  /** Linhas exibidas = resultado da busca principal com o sub-filtro aplicado. */
  const linhasVisiveis = useMemo(
    () => aplicarSubFiltro(resultados ?? [], subFiltro, ACESSORES),
    [resultados, subFiltro],
  )

  /** Valores distintos por coluna (dos resultados carregados), para o checkbox. */
  const valoresPorColuna = useMemo(
    () => ({
      numero: valoresDistintosSub(resultados ?? [], ACESSORES.numero),
      status: valoresDistintosSub(resultados ?? [], ACESSORES.status),
      codigoMaterial: valoresDistintosSub(resultados ?? [], ACESSORES.codigoMaterial),
      numeroPedido: valoresDistintosSub(resultados ?? [], ACESSORES.numeroPedido),
      doc: valoresDistintosSub(resultados ?? [], ACESSORES.doc),
    }),
    [resultados],
  )
```

No `buscar()`, resetar o sub-filtro junto com a seleção — dentro do `if (res.ok)`:

```tsx
      if (res.ok) {
        setResultados(res.processos)
        setSelecionados(new Set())
        setSubFiltro(SUB_FILTRO_PADRAO)
      } else {
```

Trocar `selecionarTodosElegiveis` para operar sobre as linhas visíveis:

```tsx
  function selecionarTodosElegiveis() {
    const elegiveis = linhasVisiveis.filter((p) => elegibilidades.get(p.id)?.elegivel)
    setSelecionados(new Set(elegiveis.map((p) => p.id)))
  }
```

- [ ] **Step 4: Contador e iteração da tabela/cards por `linhasVisiveis`**

No cabeçalho de ações, trocar o contador:

```tsx
            <span className="text-sm text-muted-foreground">
              {selecionados.size} selecionado(s) de {linhasVisiveis.length} visível(is)
            </span>
```

Na **tabela desktop**, trocar o cabeçalho das colunas Nº/Status/Código/Pedido/Doc por menus (e manter Volumes/Prévia como estão):

```tsx
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>
                    <MenuColunaEtiqueta campo="numero" rotulo="Nº" valores={valoresPorColuna.numero} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="status" rotulo="Status" valores={valoresPorColuna.status} rotuloValor={(v) => rotuloStatusProcesso(v).rotulo} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="codigoMaterial" rotulo="Código" valores={valoresPorColuna.codigoMaterial} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="numeroPedido" rotulo="Pedido" valores={valoresPorColuna.numeroPedido} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>
                    <MenuColunaEtiqueta campo="doc" rotulo="Doc" valores={valoresPorColuna.doc} subFiltro={subFiltro} onAplicar={setSubFiltro} />
                  </TableHead>
                  <TableHead>Volumes</TableHead>
                  <TableHead>Prévia (1º Part Number)</TableHead>
                </TableRow>
```

Ainda na tabela, trocar `{resultados.length === 0 && (` por `{linhasVisiveis.length === 0 && (` e `{resultados.map((processo) => {` por `{linhasVisiveis.map((processo) => {`.

Nos **cards mobile**, trocar `{resultados.length === 0 && (` por `{linhasVisiveis.length === 0 && (` e `{resultados.map((processo) => {` por `{linhasVisiveis.map((processo) => {`. (Os cards não ganham menu — o sub-filtro no mobile fica para o pacote de responsividade; mas eles exibem as linhas visíveis.)

- [ ] **Step 5: Componente `MenuColunaEtiqueta`**

No fim do arquivo (escopo do módulo), adicionar:

```tsx
interface MenuColunaEtiquetaProps {
  campo: string
  rotulo: string
  valores: string[]
  /** Como exibir um valor no checkbox (ex.: status em pt-BR). Padrão: o próprio valor. */
  rotuloValor?: (valor: string) => string
  subFiltro: SubFiltroEtiquetas
  onAplicar: (novo: SubFiltroEtiquetas) => void
}

/** Cabeçalho de coluna com menu estilo Excel (ordenar A→Z/Z→A, busca por texto,
 *  checkbox de valores). Client-side: os `valores` vêm das linhas já carregadas. */
function MenuColunaEtiqueta({ campo, rotulo, valores, rotuloValor, subFiltro, onAplicar }: MenuColunaEtiquetaProps) {
  const filtroAtual = subFiltro.filtros[campo] ?? {}
  const [texto, setTexto] = useState(filtroAtual.texto ?? '')
  const [marcados, setMarcados] = useState<string[]>(filtroAtual.valores ?? [])
  const [busca, setBusca] = useState('')

  const exibir = (v: string) => (rotuloValor ? rotuloValor(v) : v)
  const ativo = Boolean(subFiltro.filtros[campo])
  const ordenando = subFiltro.ordenar === campo

  function ordenar(direcao: 'asc' | 'desc') {
    onAplicar({ ...subFiltro, ordenar: campo, direcao })
  }

  function aplicarFiltro() {
    const filtros = { ...subFiltro.filtros }
    const filtro: { texto?: string; valores?: string[] } = {}
    if (texto.trim() !== '') filtro.texto = texto.trim()
    if (marcados.length > 0) filtro.valores = marcados
    if (filtro.texto === undefined && filtro.valores === undefined) delete filtros[campo]
    else filtros[campo] = filtro
    onAplicar({ ...subFiltro, filtros })
  }

  function limpar() {
    const filtros = { ...subFiltro.filtros }
    delete filtros[campo]
    setTexto('')
    setMarcados([])
    onAplicar({ ...subFiltro, filtros })
  }

  const listados = valores.filter((v) =>
    busca.trim() === '' ? true : exibir(v).toLowerCase().includes(busca.trim().toLowerCase()),
  )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button type="button" className="flex items-center gap-1 font-medium hover:text-enterplak">
            {rotulo}
            {ordenando && (subFiltro.direcao === 'asc' ? <ArrowUpAZIcon className="size-3.5" /> : <ArrowDownAZIcon className="size-3.5" />)}
            <FilterIcon className={ativo ? 'size-3 text-enterplak' : 'size-3 opacity-40'} />
          </button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex flex-col">
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('asc')}>
            ↑ Ordenar de A a Z
          </button>
          <button type="button" className="px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => ordenar('desc')}>
            ↓ Ordenar de Z a A
          </button>
          <div className="border-t border-border" />
          <div className="p-2">
            <Input
              placeholder="Buscar nesta coluna..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarFiltro()
              }}
              className="h-8"
            />
          </div>
          <div className="border-t border-border" />
          <div className="max-h-56 overflow-y-auto p-2">
            <Input
              placeholder="Filtrar valores..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="mb-2 h-7 text-xs"
            />
            {listados.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum valor.</p>}
            {listados.map((valor) => (
              <label key={valor} className="flex items-center gap-2 px-1 py-1 text-sm">
                <Checkbox
                  checked={marcados.includes(valor)}
                  onCheckedChange={(marcado) =>
                    setMarcados((atual) => (marcado ? [...atual, valor] : atual.filter((v) => v !== valor)))
                  }
                />
                <span className="truncate">{exibir(valor)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <Button variant="outline" size="sm" onClick={limpar}>
              Limpar
            </Button>
            <Button size="sm" className="bg-enterplak hover:bg-enterplak-700" onClick={aplicarFiltro}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 6: Verificar tipos, lint e build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros. (Se o lint acusar algum import antes usado só por `resultados.map` que virou `linhasVisiveis`, ajuste — nada deve sobrar morto.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx"
git commit -m "feat(etiquetas): sub-filtro estilo planilha nas colunas do resultado (client-side)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verificação final

**Files:** nenhum (só verificação).

- [ ] **Step 1: tsc + lint + build + testes**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm run test`
Expected: tudo verde; os testes de `sub-filtro` entre eles.

- [ ] **Step 2: Smoke (anotar resultado; NÃO fazer push)**

Com `npm run dev`, em `/recebimento/etiquetas`:
1. Buscar por **Fornecedor** (ou deixar vazio pra trazer os recentes).
2. No resultado, **ordenar Código A→Z** pelo menu do cabeçalho → a lista reordena.
3. **Filtrar Status** por "Aprovado" pelo checkbox (rótulos em **pt-BR**) → some o resto; o contador mostra o total **visível**.
4. **Selecionar todos (elegíveis)** → seleciona só os visíveis.
5. Mudar o filtro (ex.: tirar o Status) → a **seleção persiste**.
6. **Gerar** → o CSV sai com as selecionadas.
7. Refazer a busca principal → o **sub-filtro zera**.

- [ ] **Step 3: NÃO fazer push**

Commits ficam **locais**; o usuário valida o smoke e decide.

---

## Notas de verificação (self-review do plano)

**Cobertura do spec:**
- Sub-filtro nas colunas Nº/Status/Código/Pedido/Doc (ordenar+texto+checkbox) → Task 1 (`aplicarSubFiltro`) + Task 2 (`MenuColunaEtiqueta`). ✅
- Client-side, em memória, sobre `resultados` → Task 2 (`linhasVisiveis`). ✅
- Doc derivado; Status pt-BR no checkbox → Task 2 (`ACESSORES.doc`, `rotuloValor`). ✅
- Seleção persiste; "Selecionar todos" sobre visíveis; contador visível → Task 2. ✅
- Efêmero, sem URL, reseta na busca → Task 2 (Step 3). ✅
- Volumes/Prévia sem menu; cards sem menu (só exibem visíveis) → Task 2 (Step 4). ✅
- Sem migração/servidor → Global Constraints. ✅

**Consistência de tipos:** `SubFiltroEtiquetas`/`Acessor`/`aplicarSubFiltro`/`valoresDistintosSub`/`SUB_FILTRO_PADRAO` (Task 1) consumidos na Task 2; `ACESSORES` satisfaz `Record<string, Acessor<ProcessoEtiquetaLista>>`. ✅

**Sem placeholders:** todos os steps de código trazem o código completo. ✅
