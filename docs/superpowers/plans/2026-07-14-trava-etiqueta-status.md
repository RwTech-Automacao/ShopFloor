# Trava de geração de etiqueta por elegibilidade (#5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Só gerar etiqueta para processos elegíveis = status terminal (`ehTerminal`) E campos completos (código, pedido, DI/INPI-ou-NF, volumes ≥ 1); a UI mostra todos com badge de status e desabilita os não elegíveis com o motivo; o servidor é autoritativo.

**Architecture:** Domínio puro decide elegibilidade (`elegivelParaEtiqueta`) reusando o `ehTerminal` do recebimento; o repositório traz `status`; a Server Action pula não elegíveis; a UI usa o mesmo domínio para desabilitar seleção + exibir motivo.

**Tech Stack:** Next.js 16, TS strict, Supabase, Tailwind, Vitest.

## Global Constraints
- **Elegível = `ehTerminal(status)` (status não é `aberto` nem `em_conferencia`) E campos completos** (Item Recebido/código, Nº Pedido, DI/INPI-ou-NF, **Volumes ≥ 1**). Não hardcodar Aprovado/Reprovado.
- `motivo` de inelegibilidade: `'aguardando'` (não terminal) | `'incompleto'` (terminal, falta campo). Rótulos UI: "Aguardando conferência" / "Campos incompletos para etiqueta".
- **Sem migração** — só adiciona `status` ao SELECT das etiquetas.
- TDD só no domínio; infra/app/UI por build + smoke.
- **Nota de sequência:** a Task 1 adiciona `status` a `ProcessoEtiqueta` → o `tsc` global fica vermelho no `etiqueta-repository.ts` (mapRow sem status) até a Task 2. Task 1 verifica só pelo teste de domínio focado.

---

### Task 1: Domínio — elegibilidade (TDD)

**Files:**
- Modify: `src/modules/etiquetas/domain/partnumber.ts`
- Test: `src/modules/etiquetas/domain/__tests__/partnumber.test.ts`

**Interfaces:**
- Produces: `ProcessoEtiqueta` (agora com `status: string`); `camposCompletosEtiqueta(p): boolean`; `type MotivoInelegivel = 'aguardando' | 'incompleto'`; `elegivelParaEtiqueta(p): { elegivel: boolean; motivo: MotivoInelegivel | null }`. `gerarEtiquetasDoProcesso` mantém a assinatura.

- [ ] **Step 1: Escrever/ajustar o teste** — adicionar `status` às fixtures existentes de `ProcessoEtiqueta` (ex.: `status: 'Aprovado'` no exemplo RWCN98 e no teste "falta pedido") e adicionar estes blocos:
```ts
import { camposCompletosEtiqueta, elegivelParaEtiqueta } from '../partnumber'

const base = {
  id: 'x',
  status: 'Aprovado',
  codigoMaterial: 'RWCN98',
  numeroPedido: '5292/26',
  diInpi: '260000902016',
  numeroNf: null,
  volumes: 13,
}

describe('camposCompletosEtiqueta', () => {
  it('completo quando tem código, pedido, doc e volumes >= 1', () => {
    expect(camposCompletosEtiqueta(base)).toBe(true)
  })
  it('incompleto sem código / sem pedido / sem doc', () => {
    expect(camposCompletosEtiqueta({ ...base, codigoMaterial: null })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, numeroPedido: '' })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, diInpi: null, numeroNf: null })).toBe(false)
  })
  it('incompleto quando volumes < 1 / nulo', () => {
    expect(camposCompletosEtiqueta({ ...base, volumes: 0 })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, volumes: null })).toBe(false)
  })
  it('doc aceita NF quando DI/INPI vazio', () => {
    expect(camposCompletosEtiqueta({ ...base, diInpi: null, numeroNf: '0665/26' })).toBe(true)
  })
})

describe('elegivelParaEtiqueta', () => {
  it('não terminal → aguardando', () => {
    expect(elegivelParaEtiqueta({ ...base, status: 'aberto' })).toEqual({ elegivel: false, motivo: 'aguardando' })
    expect(elegivelParaEtiqueta({ ...base, status: 'em_conferencia' })).toEqual({ elegivel: false, motivo: 'aguardando' })
  })
  it('terminal mas incompleto → incompleto', () => {
    expect(elegivelParaEtiqueta({ ...base, status: 'Reprovado', volumes: 0 })).toEqual({ elegivel: false, motivo: 'incompleto' })
  })
  it('terminal + completo → elegível (inclui status terminal custom)', () => {
    expect(elegivelParaEtiqueta(base)).toEqual({ elegivel: true, motivo: null })
    expect(elegivelParaEtiqueta({ ...base, status: 'Aprovado condicional' })).toEqual({ elegivel: true, motivo: null })
  })
})
```

- [ ] **Step 2: Rodar → falha** — `npx vitest run src/modules/etiquetas/domain/__tests__/partnumber.test.ts`

- [ ] **Step 3: Implementar em `partnumber.ts`**
  - Adicionar no topo: `import { ehTerminal } from '@/modules/recebimento/domain/ciclo-vida'`.
  - `ProcessoEtiqueta`: adicionar `status: string` (logo após `id`).
  - Adicionar `camposCompletosEtiqueta` e refatorar `gerarEtiquetasDoProcesso` para usá-la (troca a checagem inline; agora `volumes < 1` → incompleto, sem o default-para-1):
```ts
/** True sse o processo tem os campos da etiqueta: código, pedido, documento
 *  (DI/INPI ou NF) e volumes >= 1. */
export function camposCompletosEtiqueta(p: ProcessoEtiqueta): boolean {
  if (!normalizarCodigo(p.codigoMaterial)) return false
  if (!formatarPedido(p.numeroPedido)) return false
  if (!resolverDoc(p.diInpi, p.numeroNf)) return false
  const volumes = typeof p.volumes === 'number' ? p.volumes : Number(p.volumes)
  return Number.isFinite(volumes) && volumes >= 1
}

export function gerarEtiquetasDoProcesso(
  p: ProcessoEtiqueta,
): { incompleto: boolean; etiquetas: LinhaEtiqueta[] } {
  if (!camposCompletosEtiqueta(p)) return { incompleto: true, etiquetas: [] }
  const codigoBase = normalizarCodigo(p.codigoMaterial)
  const pedidoFmt = formatarPedido(p.numeroPedido)
  const doc = resolverDoc(p.diInpi, p.numeroNf)
  const volumes = Math.trunc(Number(p.volumes))
  const etiquetas: LinhaEtiqueta[] = []
  for (let i = 1; i <= volumes; i++) {
    const seq = padSeq(i, volumes)
    etiquetas.push({
      partNumber: montarPartNumber(codigoBase, pedidoFmt, doc, seq),
      codigo: codigoBase,
      volume: formatarVolume(i, volumes),
    })
  }
  return { incompleto: false, etiquetas }
}

export type MotivoInelegivel = 'aguardando' | 'incompleto'

/** Elegibilidade para gerar etiqueta: status terminal (concluído — não aberto/
 *  em_conferencia) E campos completos. */
export function elegivelParaEtiqueta(
  p: ProcessoEtiqueta,
): { elegivel: boolean; motivo: MotivoInelegivel | null } {
  if (!ehTerminal(p.status)) return { elegivel: false, motivo: 'aguardando' }
  if (!camposCompletosEtiqueta(p)) return { elegivel: false, motivo: 'incompleto' }
  return { elegivel: true, motivo: null }
}
```

- [ ] **Step 4: Rodar → passa** — `npx vitest run src/modules/etiquetas/domain/__tests__/partnumber.test.ts`. (NÃO rodar `tsc` global — vermelho esperado no repo até a Task 2.)
- [ ] **Step 5: Commit** — `git commit -m "feat(etiquetas): elegibilidade por status terminal + campos completos (TDD)"`

---

### Task 2: Infra — `status` no carregamento das etiquetas

**Files:** Modify `src/modules/etiquetas/infra/etiqueta-repository.ts`

- [ ] **Step 1:** `SELECT_CAMPOS` — adicionar `status`: de `'id, codigo_material, numero_pedido, di_inpi, numero_nf, volumes'` para `'id, status, codigo_material, numero_pedido, di_inpi, numero_nf, volumes'`.
- [ ] **Step 2:** `interface ProcessoEtiquetaRow` — adicionar `status: string`.
- [ ] **Step 3:** `mapRow` — adicionar `status: row.status,` no objeto retornado (o tipo `ProcessoEtiqueta` já exige `status` desde a Task 1).
- [ ] **Step 4:** `npx tsc --noEmit` → agora deve ficar **limpo** (Task 1 + Task 2 fecham o tipo). `npm run lint` limpo. Commit — `git commit -m "feat(etiquetas): carrega status do processo (busca + geração)"`

---

### Task 3: Application — pular não elegíveis na geração

**Files:** Modify `src/modules/etiquetas/application/gerar-etiquetas.ts`

- [ ] **Step 1:** Import — adicionar `elegivelParaEtiqueta` ao import de `../domain/partnumber` (junto de `gerarEtiquetasDoProcesso`).
- [ ] **Step 2:** No loop de geração, trocar a checagem de `incompleto` por elegibilidade:
```ts
  const linhas: LinhaEtiqueta[] = []
  let ignorados = 0
  for (const processo of processos) {
    if (!elegivelParaEtiqueta(processo).elegivel) {
      ignorados += 1
      continue
    }
    linhas.push(...gerarEtiquetasDoProcesso(processo).etiquetas)
  }
```
- [ ] **Step 3:** Mensagem de erro quando `linhas.length === 0`: trocar para `'Nenhuma etiqueta a gerar (processos não concluídos ou com campos incompletos).'`
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → limpo. Commit — `git commit -m "feat(etiquetas): geração pula processos não elegíveis (status/campos)"`

---

### Task 4: UI — badge de status + desabilitar não elegíveis com motivo

**Files:** Modify `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`

> Leia o arquivo atual antes de editar. Hoje ele já desabilita o checkbox por "incompleto" (via `previaPartNumber` → `gerarEtiquetasDoProcesso`). A troca é: usar `elegivelParaEtiqueta` (status + campos), adicionar coluna/badge de **Status**, e exibir o **motivo** nos não elegíveis.

- [ ] **Step 1: Imports** — no import de `@/modules/etiquetas/domain/partnumber`, adicionar `elegivelParaEtiqueta` e `type MotivoInelegivel`. Adicionar:
```ts
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { Badge } from '@/components/ui/badge'
```
- [ ] **Step 2: Rótulo do motivo** (perto do topo do arquivo, junto de `TIPOS`):
```ts
const ROTULO_MOTIVO: Record<MotivoInelegivel, string> = {
  aguardando: 'Aguardando conferência',
  incompleto: 'Campos incompletos para etiqueta',
}
```
- [ ] **Step 3: Mapa de elegibilidade** (junto do `previas` memo):
```ts
const elegibilidades = useMemo(() => {
  const mapa = new Map<string, { elegivel: boolean; motivo: MotivoInelegivel | null }>()
  for (const processo of resultados ?? []) mapa.set(processo.id, elegivelParaEtiqueta(processo))
  return mapa
}, [resultados])
```
- [ ] **Step 4: Selecionar todos elegíveis** — renomear `selecionarTodosCompletos` para `selecionarTodosElegiveis` e trocar o corpo por:
```ts
function selecionarTodosElegiveis() {
  const elegiveis = (resultados ?? []).filter((p) => elegibilidades.get(p.id)?.elegivel)
  setSelecionados(new Set(elegiveis.map((p) => p.id)))
}
```
Atualizar o `onClick` e o rótulo do botão para "Selecionar todos (elegíveis)".
- [ ] **Step 5: Tabela desktop** — adicionar `<TableHead>Status</TableHead>` (entre "Nº" e "Código"); aumentar o `colSpan` do "Nenhum processo encontrado" de `7` para `8`. Em cada `resultados.map(...)`, substituir o cálculo `previa`/`incompleto` por:
```tsx
const elegib = elegibilidades.get(processo.id) ?? { elegivel: false, motivo: 'incompleto' as MotivoInelegivel }
const status = rotuloStatusProcesso(processo.status)
const textoPrevia = elegib.elegivel ? (previas.get(processo.id) ?? '') : ROTULO_MOTIVO[elegib.motivo!]
```
- checkbox: `disabled={!elegib.elegivel}`.
- adicionar a célula de status logo após a de "Nº": `<TableCell><Badge className={status.className}>{status.rotulo}</Badge></TableCell>`.
- célula "Prévia": usar `textoPrevia`, com classe italic/muted quando `!elegib.elegivel`.
- [ ] **Step 6: Cards mobile** — mesma troca: computar `elegib`/`status`/`textoPrevia`; checkbox `disabled={!elegib.elegivel}`; adicionar uma linha `Status` (com `<Badge>`) no `<dl>`; a linha "Prévia" mostra `textoPrevia` (muted/italic quando não elegível).
- [ ] **Step 7:** `npx tsc --noEmit && npm run lint && npm run build` → verde. Commit — `git commit -m "feat(etiquetas): badge de status + trava de seleção por elegibilidade"`

---

### Task 5: Verificação final + smoke

- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` → tudo verde.
- [ ] **Step 2: Smoke** (`npm run dev`) → Recebimento → Etiquetas → Buscar: cada linha mostra o **badge de status**; processos **aberto/em conferência** e os **terminais incompletos** ficam com checkbox **desabilitado** + motivo ("Aguardando conferência" / "Campos incompletos para etiqueta"); só os **terminais completos** selecionam e geram CSV. "Selecionar todos (elegíveis)" marca só os elegíveis. Gerar com algum não elegível selecionado por bypass → servidor conta em `ignorados`.
- [ ] **Step 3:** Nada a commitar. Fim.

---

## Self-Review
- **Cobertura da spec:** elegibilidade terminal+completo (Task 1), volumes≥1 (Task 1), status no load (Task 2), servidor autoritativo pula não elegíveis (Task 3), UI mostra todos + badge + desabilita + motivo (Task 4), sem migração (Tasks 1-4 não tocam SQL). ✔
- **Placeholders:** nenhum; UI é modify com snippets exatos + o arquivo atual como referência. ✔
- **Consistência de tipos:** `ProcessoEtiqueta.status`, `camposCompletosEtiqueta(p):boolean`, `elegivelParaEtiqueta(p):{elegivel,motivo}`, `MotivoInelegivel`, `ROTULO_MOTIVO` — usados igual entre tasks. ✔
- **Sequência:** Task 1 deixa tsc global vermelho (status em ProcessoEtiqueta) até Task 2 (mapRow) — documentado.
