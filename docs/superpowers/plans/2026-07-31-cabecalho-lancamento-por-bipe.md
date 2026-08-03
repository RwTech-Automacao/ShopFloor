# Cabeçalho do Lançamento por bipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Lançamento, trocar a cascata de dropdowns Cliente→PMO→OP por um **bipe** de nº de série que carrega a OP (Cliente/PMO/OP/Descrição); Colaborador e Posto continuam manuais e persistentes; botão "Atualizar cabeçalho".

**Architecture:** Resolução SN→OP **100% no cliente** (`serieDentroDaFaixa` sobre as OPs já carregadas no form). Sem backend, sem migração. Dois estados do cabeçalho (bipe / OP carregada).

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Vitest 4, sonner.

## Global Constraints

- **Sem migração, sem backend** — resolução no cliente com a prop `ordens` (OPs ativas, já têm sn_ini/sn_fim/cliente/pmo/op/descricao).
- **1º bipe só carrega a OP** (não lança). **SN sem match → só avisa** (não preenche). **Colaborador e Posto persistem** entre lançamentos.
- **Não mexer** na lógica de lançar peça, gate, Integração, Burn-in — só no cabeçalho.
- **Nomes canônicos:** `resolverOpPorSn(ordens, sn): { ok: true; ordem: T } | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' }` em `src/modules/shopfloor/domain/cabecalho-lancamento.ts`.
- **PT-BR**; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task:** `npm run build` (se OOM, `NODE_OPTIONS=--max-old-space-size=6144 npm run build`), `npm run lint`, `npm test`.

---

## File Structure

- **Create** `src/modules/shopfloor/domain/cabecalho-lancamento.ts` — `resolverOpPorSn` (puro).
- **Create** `src/modules/shopfloor/domain/__tests__/cabecalho-lancamento.test.ts` — testes.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — cabeçalho por bipe (dois estados).

---

## Task 1: Domínio `resolverOpPorSn` (+ testes)

**Files:**
- Create: `src/modules/shopfloor/domain/cabecalho-lancamento.ts`
- Test: `src/modules/shopfloor/domain/__tests__/cabecalho-lancamento.test.ts`

**Interfaces:**
- Consumes: `serieDentroDaFaixa`, `limparSerie` de `../serie`.
- Produces: `resolverOpPorSn<T extends { sn_ini: string; sn_fim: string }>(ordens: T[], sn: string): { ok: true; ordem: T } | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' }`.

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/modules/shopfloor/domain/__tests__/cabecalho-lancamento.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolverOpPorSn } from '../cabecalho-lancamento'

const O = (cliente: string, pmo: string, op: string, sn_ini: string, sn_fim: string) => ({ cliente, pmo, op, sn_ini, sn_fim })
const ORDS = [
  O('C1', 'PMOA', '8801', 'A100', 'A199'),
  O('C1', 'PMOB', '8802', 'B100', 'B199'),
  O('C1', 'PMOC', '8803', '', ''), // sem faixa → ignorada
]

describe('resolverOpPorSn', () => {
  it('SN dentro da faixa de UMA OP → ok com a OP', () => {
    expect(resolverOpPorSn(ORDS, 'A150')).toEqual({ ok: true, ordem: ORDS[0] })
    expect(resolverOpPorSn(ORDS, 'B100')).toEqual({ ok: true, ordem: ORDS[1] })
  })
  it('SN fora de todas as faixas → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, 'Z999')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN vazio → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, '')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('OP sem faixa (sn_ini/fim vazios) é ignorada', () => {
    // nada casa a PMOC (sem faixa); um SN qualquer fora de A/B → SEM_OP
    expect(resolverOpPorSn([O('C1', 'PMOC', '8803', '', '')], 'A150')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN em duas faixas sobrepostas → AMBIGUO', () => {
    const dup = [O('C1', 'PMOA', '8801', 'A100', 'A199'), O('C1', 'PMOA', '8809', 'A100', 'A199')]
    expect(resolverOpPorSn(dup, 'A150')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })
})
```

- [ ] **Step 2: Rodar (devem falhar)**

Run: `npm test -- cabecalho-lancamento`
Expected: FAIL — módulo `../cabecalho-lancamento` não existe.

- [ ] **Step 3: Implementar o módulo**

Criar `src/modules/shopfloor/domain/cabecalho-lancamento.ts`:
```ts
import { serieDentroDaFaixa, limparSerie } from './serie'

/**
 * Resolve a OP de um SN bipado pela faixa de nº de série. Só considera OPs com faixa
 * cadastrada (sn_ini/sn_fim não-vazios). 0 matches → SEM_OP; >1 → AMBIGUO (não deveria
 * ocorrer com SN único); exatamente 1 → ok.
 */
export function resolverOpPorSn<T extends { sn_ini: string; sn_fim: string }>(
  ordens: T[],
  sn: string,
): { ok: true; ordem: T } | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' } {
  const alvo = limparSerie(sn)
  if (alvo === '') return { ok: false, erro: 'SEM_OP' }
  const casam = ordens.filter(
    (o) => o.sn_ini.trim() !== '' && o.sn_fim.trim() !== '' && serieDentroDaFaixa(o.sn_ini, o.sn_fim, alvo),
  )
  if (casam.length === 0) return { ok: false, erro: 'SEM_OP' }
  if (casam.length > 1) return { ok: false, erro: 'AMBIGUO' }
  return { ok: true, ordem: casam[0]! }
}
```

- [ ] **Step 4: Rodar (devem passar)**

Run: `npm test -- cabecalho-lancamento`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/cabecalho-lancamento.ts src/modules/shopfloor/domain/__tests__/cabecalho-lancamento.test.ts
git commit -m "feat(shopfloor): domínio resolverOpPorSn (resolve a OP pela faixa do SN) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lancamento-form.tsx` — cabeçalho por bipe

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes (Task 1): `resolverOpPorSn`.
- Consumes (existente): `toast` (sonner), `serieDentroDaFaixa` já usado; estados `colaborador/cliente/pmo/op/posto`, `resetCamposDinamicos`, `snRef`, `ordemSel`, `postosDaOp`.

- [ ] **Step 1: Imports + estado + handlers**

No topo, garantir o import (adicionar se faltar):
```ts
import { toast } from 'sonner'
import { resolverOpPorSn } from '@/modules/shopfloor/domain/cabecalho-lancamento'
```

Adicionar estado (perto dos outros `useState`) e um ref pro campo de bipe:
```ts
const [bipeCab, setBipeCab] = useState('')
const bipeCabRef = useRef<HTMLInputElement>(null)
```

**Remover** os `useMemo` `clientes`, `pmos`, `ops` (só serviam à cascata) e os handlers `mudarCliente`,
`mudarPmo`, `mudarOp` (não usados mais). **Manter** `ordemSel`, `postosDaOp`, `mudarPosto`, `resetCamposDinamicos`.

Adicionar os handlers do cabeçalho:
```ts
function onBiparCabecalho() {
  if (bipeCab.trim() === '') return
  const r = resolverOpPorSn(ordens, bipeCab)
  if (!r.ok) {
    toast.error(r.erro === 'SEM_OP' ? 'SN não encontrado em nenhuma OP.' : 'SN cai em mais de uma OP.')
    bipeCabRef.current?.select()
    return
  }
  setCliente(r.ordem.cliente)
  setPmo(r.ordem.pmo)
  setOp(r.ordem.op)
  if (!r.ordem.postos.includes(posto)) setPosto('') // posto persiste se valer na nova OP; senão, re-escolher
  resetCamposDinamicos()
  setBipeCab('')
  setTimeout(() => snRef.current?.focus(), 0)
}
function atualizarCabecalho() {
  setCliente(''); setPmo(''); setOp('')
  setNumeroSerie(''); resetCamposDinamicos()
  setBipeCab('')
  setTimeout(() => bipeCabRef.current?.focus(), 0)
}
```
(`r.ordem` é a `OrdemLancamentoLista` — tem `postos`; o `resolverOpPorSn` genérico preserva o tipo. Colaborador
**não** é tocado — persiste.)

- [ ] **Step 2: Render — dois estados do cabeçalho**

Substituir o card "Contexto" atual (o `<Card>` que hoje tem os `<Select>` de Cliente/PMO/OP) por:
```tsx
<Card>
  <CardHeader className="flex flex-row items-center justify-between gap-2">
    <CardTitle>Contexto</CardTitle>
    {op !== '' && (
      <Button variant="outline" size="sm" onClick={atualizarCabecalho}>Atualizar cabeçalho</Button>
    )}
  </CardHeader>
  {op === '' ? (
    <CardContent className="flex flex-col gap-2">
      <Label htmlFor="bipeCab">Bipe o Nº de Série para carregar a OP</Label>
      <Input
        id="bipeCab"
        ref={bipeCabRef}
        value={bipeCab}
        onChange={(e) => setBipeCab(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBiparCabecalho() } }}
        placeholder="Bipe ou digite o SN e Enter"
        autoComplete="off"
        autoFocus
        className="h-12 text-lg"
      />
      <p className="text-xs text-muted-foreground">Digitar + Enter também funciona (sem scanner).</p>
    </CardContent>
  ) : (
    <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="colaborador">Colaborador</Label>
        <Input id="colaborador" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Cliente</Label>
        <Input value={cliente} readOnly disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>PMO</Label>
        <Input value={pmo} readOnly disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>OP</Label>
        <Input value={op} readOnly disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Posto</Label>
        <Select value={posto} onValueChange={(v) => mudarPosto(v ?? '')}>
          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>{postosDaOp.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Descrição</Label>
        <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
      </div>
      {ehEmbalagem && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="caixa">Nº da Caixa</Label>
            <Input id="caixa" value={numeroCaixa} onChange={(e) => setNumeroCaixa(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qtdcaixa">Qtd por caixa</Label>
            <Input id="qtdcaixa" type="number" min="1" step="1" value={qtdPorCaixa} onChange={(e) => setQtdPorCaixa(e.target.value)} />
          </div>
        </>
      )}
      {semFaixa && (
        <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">Esta OP não tem faixa de Nº de Série cadastrada — não é possível lançar.</p>
      )}
    </CardContent>
  )}
</Card>
```
(O `Button` já é importado no arquivo; se não, `import { Button } from '@/components/ui/button'`.)

- [ ] **Step 3: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes (incl. cabecalho-lancamento da Task 1). Conferir que não sobrou referência a `clientes`/`pmos`/`ops`/`mudarCliente`/`mudarPmo`/`mudarOp` (senão o lint/tsc acusa).

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): cabeçalho do Lançamento por bipe (carrega a OP pelo SN) + Atualizar cabeçalho

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)

1. **Bipe válido:** sem OP, bipa o SN de uma peça → carrega Cliente/PMO/OP/Descrição; foca o SN da peça.
2. **Digitar + Enter:** digita o SN (sem scanner) + Enter → mesma coisa.
3. **Bipe inválido:** SN fora de qualquer faixa → "SN não encontrado em nenhuma OP", não carrega.
4. **Persistência:** preenche Colaborador + Posto, lança várias peças seguidas **sem re-bipar o cabeçalho**.
5. **Atualizar cabeçalho:** clica → volta ao bipe; Colaborador continua; bipa outro SN → nova OP (Posto mantém se valer na nova OP, senão pede re-escolha).
6. **Integração/Burn-in:** carrega uma OP com posto de Integração/Burn-in e confirma que o painel/gate seguem funcionando (o cabeçalho alimenta `ordemSel` como antes).

---

## Self-Review (checagem do autor)

- **Cobertura da spec:** §1 domínio → T1; §2 form (dois estados + atualizar + remoção da cascata) → T2. ✔
- **Sem placeholders:** todo passo com código real. ✔
- **Consistência de tipos:** `resolverOpPorSn` genérico devolve a própria `OrdemLancamentoLista` (com `.postos`), usada no handler; `ordemSel` segue de cliente+pmo+op. ✔
- **Escopo:** só o cabeçalho muda; peça/gate/Integração/Burn-in intocados; resolução client-side (sem backend). ✔
