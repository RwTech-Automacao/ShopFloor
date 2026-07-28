# Obrigatoriedade da faixa de SN no Cadastro de OP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a faixa de SN (`sn_ini`..`sn_fim`) **obrigatória e coerente** ao criar/editar uma OP.

**Architecture:** Regra pura no domínio ShopFloor: nova função `faixaCoerente` em `serie.ts` (reusa `partesSerie`), consumida por `validarOrdem`. A UI só sinaliza obrigatoriedade; a validação real é server-side (o domínio é a fonte única). Nenhuma mudança de banco/RLS/action.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Vitest 4 (TDD).

## Global Constraints

- PT-BR em UI, mensagens e comentários.
- Domínio é **puro** (sem I/O, sem framework) e é a **fonte única** da regra — não duplicar a lógica de coerência no client.
- TDD: teste falhando antes da implementação. Commits frequentes.
- Escopo fechado: **não** tocar no N1 do Lançamento/Integração, no SN individual, nem nos filtros da tela.
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec de referência: `docs/superpowers/specs/2026-07-28-obrigatoriedade-faixa-sn-op-design.md`.

## File Structure

- `src/modules/shopfloor/domain/serie.ts` — **modificar**: adicionar `faixaCoerente`.
- `src/modules/shopfloor/domain/__tests__/serie.test.ts` — **modificar**: testes de `faixaCoerente`.
- `src/modules/shopfloor/domain/validar-ordem.ts` — **modificar**: faixa obrigatória + coerente.
- `src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts` — **modificar**: `base` com faixa válida + novos casos.
- `src/app/(app)/shopfloor/ordens/ordem-form.tsx` — **modificar**: labels obrigatórios + `required` + texto de ajuda.
- `docs/regras-de-negocio-shopfloor.md` — **modificar**: regra 2 do Cadastro de OP + item de backlog.

---

### Task 1: `faixaCoerente` no domínio (`serie.ts`)

**Files:**
- Modify: `src/modules/shopfloor/domain/serie.ts`
- Test: `src/modules/shopfloor/domain/__tests__/serie.test.ts`

**Interfaces:**
- Consumes: `partesSerie` (já em `serie.ts`).
- Produces: `export function faixaCoerente(snIni: string, snFim: string): boolean` — usada pela Task 2.

- [ ] **Step 1: Escrever os testes falhando** — adicionar em `src/modules/shopfloor/domain/__tests__/serie.test.ts`:

Trocar a linha de import:
```ts
import { normalizarSerie, limparSerie, partesSerie, serieDentroDaFaixa, faixaCoerente } from '../serie'
```
Adicionar ao fim do arquivo:
```ts
describe('faixaCoerente', () => {
  it('numérico válido (mesmo formato, início ≤ fim)', () => {
    expect(faixaCoerente('SN0001', 'SN0500')).toBe(true)
    expect(faixaCoerente('SN0001', 'SN0001')).toBe(true) // OP de 1 peça
  })
  it('início > fim → false', () => {
    expect(faixaCoerente('SN0500', 'SN0001')).toBe(false)
  })
  it('prefixos/sufixos divergentes → false', () => {
    expect(faixaCoerente('SN0001', 'XX0500')).toBe(false)
    expect(faixaCoerente('0001A', '0500B')).toBe(false)
  })
  it('lexical válido/invertido', () => {
    expect(faixaCoerente('ABC', 'ABD')).toBe(true)
    expect(faixaCoerente('ABD', 'ABC')).toBe(false)
  })
  it('misto (um numérico, outro não) → false', () => {
    expect(faixaCoerente('SN0001', 'ABC')).toBe(false)
  })
  it('algum vazio → false', () => {
    expect(faixaCoerente('', 'SN0500')).toBe(false)
    expect(faixaCoerente('SN0001', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/serie.test.ts`
Expected: FAIL — `faixaCoerente is not a function` (não exportada ainda).

- [ ] **Step 3: Implementar `faixaCoerente`** — adicionar ao fim de `src/modules/shopfloor/domain/serie.ts`:

```ts
/**
 * True se snIni..snFim formam uma faixa COERENTE: mesmo formato e início ≤ fim.
 * Espelha a lógica de `serieDentroDaFaixa` (numérico: prefixo/sufixo iguais e
 * comparação do bloco de dígitos; senão lexical). Um lado numérico e o outro
 * não → incoerente. Vazio em qualquer lado → incoerente.
 */
export function faixaCoerente(snIni: string, snFim: string): boolean {
  const ai = partesSerie(snIni)
  const af = partesSerie(snFim)
  if (ai.limpo === '' || af.limpo === '') return false
  const iniNum = !Number.isNaN(ai.num)
  const fimNum = !Number.isNaN(af.num)
  if (iniNum && fimNum) {
    const lc = (s: string) => s.toLowerCase()
    if (lc(ai.prefixo) !== lc(af.prefixo) || lc(ai.sufixo) !== lc(af.sufixo)) return false
    return ai.num <= af.num
  }
  if (iniNum !== fimNum) return false // misto
  return ai.limpo <= af.limpo // lexical
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/serie.test.ts`
Expected: PASS (todos os `faixaCoerente` verdes + os antigos intactos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/serie.ts src/modules/shopfloor/domain/__tests__/serie.test.ts
git commit -m "$(cat <<'EOF'
feat(shopfloor): faixaCoerente — valida faixa de SN (mesmo formato, início ≤ fim)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `validarOrdem` exige faixa obrigatória + coerente

**Files:**
- Modify: `src/modules/shopfloor/domain/validar-ordem.ts`
- Test: `src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts`
- Modify (doc): `docs/regras-de-negocio-shopfloor.md`

**Interfaces:**
- Consumes: `faixaCoerente` (Task 1).
- Produces: `validarOrdem` (mesma assinatura) agora exige faixa. Consumido por `ordens-actions.ts` (sem mudança nele).

- [ ] **Step 1: Atualizar os testes (falhando)** — substituir o conteúdo de `src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts` por:

```ts
import { describe, it, expect } from 'vitest'
import { validarOrdem } from '../validar-ordem'

const base = { pmo: 'PMOF1', op: '100', cliente: 'Empresa 1', snIni: 'SN0001', snFim: 'SN0500' }

describe('validarOrdem', () => {
  it('aceita OP válida (pmo, op, cliente, faixa)', () => {
    expect(validarOrdem(base).ok).toBe(true)
  })
  it('exige pmo, op e cliente', () => {
    expect(validarOrdem({ ...base, pmo: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, op: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, cliente: '  ' }).ok).toBe(false)
  })
  it('faixa de SN obrigatória: ambos vazios ou só um → erro', () => {
    expect(validarOrdem({ ...base, snIni: '', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '', snFim: 'SN0500' }).ok).toBe(false)
  })
  it('faixa incoerente → erro', () => {
    expect(validarOrdem({ ...base, snIni: 'SN0500', snFim: 'SN0001' }).ok).toBe(false) // início > fim
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: 'XX0500' }).ok).toBe(false) // prefixos diferentes
  })
  it('faixa de 1 peça (início == fim) → ok', () => {
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: 'SN0001' }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts`
Expected: FAIL — os casos de faixa vazia/incoerente ainda passam como `ok:true` (regra antiga é opcional).

- [ ] **Step 3: Implementar** — substituir o conteúdo de `src/modules/shopfloor/domain/validar-ordem.ts` por:

```ts
import { faixaCoerente } from './serie'

export interface DadosOrdemValidacao {
  pmo: string
  op: string
  cliente: string
  snIni: string
  snFim: string
}

/** Validação de cadastro de OP. A faixa de SN é obrigatória e deve ser coerente. */
export function validarOrdem(d: DadosOrdemValidacao): { ok: true } | { ok: false; erro: string } {
  if (d.pmo.trim() === '') return { ok: false, erro: 'Informe o PMO.' }
  if (d.op.trim() === '') return { ok: false, erro: 'Informe o número da OP.' }
  if (d.cliente.trim() === '') return { ok: false, erro: 'Informe o cliente.' }
  if (d.snIni.trim() === '' || d.snFim.trim() === '') {
    return { ok: false, erro: 'Preencha o início e o fim da faixa de SN.' }
  }
  if (!faixaCoerente(d.snIni, d.snFim)) {
    return {
      ok: false,
      erro: 'Faixa de SN inválida: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts`
Expected: PASS (todos os casos verdes).

- [ ] **Step 5: Atualizar a doc de regras** — em `docs/regras-de-negocio-shopfloor.md`:

Trocar a **regra 2 do Cadastro de OP** (hoje):
```
2. PMO, OP e cliente obrigatórios; faixa de SN opcional, mas **os dois limites juntos** ou nenhum.
```
por:
```
2. PMO, OP e cliente obrigatórios; **faixa de SN obrigatória**: os dois limites, **coerentes**
   (mesmo prefixo/sufixo, início ≤ fim; início==fim vale = OP de 1 peça).
```

No item de backlog **"Obrigatoriedade de faixa/Nº de Série"**, marcar que a parte "exigir faixa em
toda OP (no cadastro)" foi **feita** (2026-07-28); permanecem no backlog o N1 não-gradual no
Lançamento/Integração e a obrigatoriedade do SN individual no Lançamento.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shopfloor/domain/validar-ordem.ts src/modules/shopfloor/domain/__tests__/validar-ordem.test.ts docs/regras-de-negocio-shopfloor.md
git commit -m "$(cat <<'EOF'
feat(shopfloor): faixa de SN obrigatória e coerente no cadastro de OP

validarOrdem passa a exigir os dois limites da faixa + coerência (faixaCoerente).
Aplica a criar e editar. Doc de regras atualizada. N1 do Lançamento fica fora.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: UI — form marca a faixa como obrigatória

**Files:**
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`

**Interfaces:**
- Consumes: nada novo (a validação real é a Task 2, server-side). A UI só sinaliza.

- [ ] **Step 1: Marcar campos obrigatórios + ajuda** — em `src/app/(app)/shopfloor/ordens/ordem-form.tsx`, no bloco dos campos de SN, substituir:

```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_ini">SN inicial</Label>
              <Input id="sn_ini" name="sn_ini" defaultValue={ordem?.sn_ini ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_fim">SN final</Label>
              <Input id="sn_fim" name="sn_fim" defaultValue={ordem?.sn_fim ?? ''} />
            </div>
```
por:
```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_ini">SN inicial *</Label>
              <Input id="sn_ini" name="sn_ini" defaultValue={ordem?.sn_ini ?? ''} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sn_fim">SN final *</Label>
              <Input id="sn_fim" name="sn_fim" defaultValue={ordem?.sn_fim ?? ''} required />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Faixa de SN obrigatória — mesmo formato nos dois limites (ex.: <code>SN0001</code> a <code>SN0500</code>).
            </p>
```

- [ ] **Step 2: Verificar build/lint**

Run: `npm run lint && NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; rota `/shopfloor/ordens` builda normal.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/shopfloor/ordens/ordem-form.tsx"
git commit -m "$(cat <<'EOF'
feat(shopfloor): marca faixa de SN como obrigatória no form de OP (+ ajuda)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final (após as 3 tasks)

- [ ] `npm run test` — suíte inteira verde (inclui os testes novos).
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — build limpo.
- [ ] Smoke manual no preview (branch `feat/shopfloor-pos-prod`): criar OP **sem faixa** → barra com "Preencha o início e o fim…"; criar com **início>fim** → barra com "Faixa de SN inválida…"; criar com faixa válida → salva; editar OP existente segue a mesma regra.

## Self-review (feito ao escrever)

- **Cobertura do spec:** faixaCoerente (Task 1) · validarOrdem obrigatório+coerente (Task 2) · UI (Task 3) · doc (Task 2, Step 5) · testes (Tasks 1 e 2). ✓
- **Sem placeholders:** todo código está completo. ✓
- **Consistência de tipos:** `faixaCoerente(string, string): boolean` usada igual na Task 2; `validarOrdem` mantém assinatura. ✓
- **Nota:** o `base` do teste de `validarOrdem` **muda** (ganha faixa válida) — sem isso os testes existentes quebrariam; tratado explicitamente na Task 2, Step 1.
