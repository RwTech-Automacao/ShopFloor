# Lançamento scanner+teclado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** No Lançamento, para postos de teste/inspeção com defeito, operar sem mouse: status implícito pelo que se bipa no campo de ação (SN→aprova, defeito→reprova) + modal de confirmação por 2º bipe; foco encadeado (SN-OP → colaborador → posto → ação).

**Architecture:** Uma função de domínio pura classifica o valor do campo de ação. Dois modais (aprovar/reprovar) encapsulam a confirmação. O `lancamento-form` ganha o encadeamento de foco e, para os postos-alvo, troca o Status-select+defeitos-inline pelo campo de ação + modais. Demais postos (SPI, NQA, Burn-in, Integração, Embalagem) ficam intactos. Sem migração; reusa `lancar`.

**Tech Stack:** Next.js 16, React 19, TS strict, Tailwind v4, base-ui Dialog/Select, Vitest.

## Global Constraints
- PT-BR; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Não quebrar** os postos fora do escopo (SPI/NQA/Burn-in/Integração/Embalagem) — o fluxo deles continua igual.
- Escopo-alvo = `comStatus && perfil.reprova === 'defeitos' && !ehBurnin && !ehNqa && !ehSpi`.
- Reusa `lancar` (sem mudar backend). Sem migração. Build/lint/test verdes ao fim de cada task.

## File Structure
- **Create** `src/modules/shopfloor/domain/acao-lancamento.ts` (+ `__tests__/acao-lancamento.test.ts`) — classificação pura.
- **Create** `src/app/(app)/shopfloor/operar/lancamento/aprovar-modal.tsx` — modal de confirmação de aprovado.
- **Create** `src/app/(app)/shopfloor/operar/lancamento/reprovar-modal.tsx` — modal de reprova (defeitos + SN).
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — foco encadeado + campo de ação + modais para os postos-alvo.

---

## Task 1: Domínio — classificar o valor do campo de ação

**Files:** Create `src/modules/shopfloor/domain/acao-lancamento.ts` + `__tests__/acao-lancamento.test.ts`.

**Interfaces:**
- Produces:
  - `interface DefeitoCatalogo { codigo: string; tipo: number }`
  - `type AcaoLancamento = { tipo: 'aprovado' } | { tipo: 'reprovado'; defeito: { codigo: string; tipo: string } } | { tipo: 'invalido' }`
  - `function classificarAcao(valor: string, defeitos: DefeitoCatalogo[], snIni: string, snFim: string): AcaoLancamento`

Regras: normaliza `valor` (trim + colapsa espaço + MAIÚSCULAS, igual `normalizarCodigoDefeito`). Se casar `codigo` de um defeito do catálogo (comparação normalizada) → `reprovado` com `{ codigo: <codigo original do catálogo>, tipo: String(tipoNum===2?'Teste':'SMD')?? }` — **usar o `tipo` textual**: o backend guarda `tipo_defeito` como texto; mapear o tipo numérico do catálogo (1/2) para um rótulo. **Decisão:** guardar o tipo como o número do catálogo em texto não serve; então o modal preenche o `tipo` a partir do catálogo via um mapa. Para simplificar e não inventar: `tipo` = `''` aqui e o modal resolve o rótulo. → Ver Step 3. (Mantemos `classificarAcao` devolvendo só `codigo`.)

Simplificação final de `classificarAcao`: devolve `{ tipo:'reprovado'; defeito:{ codigo } }` (sem tipo). Assinatura:
`type AcaoLancamento = { tipo:'aprovado' } | { tipo:'reprovado'; codigo: string } | { tipo:'invalido' }`.

- [ ] **Step 1: Teste (falha)**
```ts
import { describe, it, expect } from 'vitest'
import { classificarAcao } from '../acao-lancamento'

const cat = [{ codigo: '101 NÃO LIGA', tipo: 2 }, { codigo: '2002 TOMBSTONE', tipo: 1 }]

describe('classificarAcao', () => {
  it('SN na faixa → aprovado', () => {
    expect(classificarAcao('2659381010', cat, '2659381000', '2659381999')).toEqual({ tipo: 'aprovado' })
  })
  it('código do catálogo (normalizado) → reprovado', () => {
    expect(classificarAcao(' 101  não liga ', cat, '2659381000', '2659381999')).toEqual({ tipo: 'reprovado', codigo: '101 NÃO LIGA' })
  })
  it('fora da faixa e fora do catálogo → invalido', () => {
    expect(classificarAcao('XYZ', cat, '2659381000', '2659381999')).toEqual({ tipo: 'invalido' })
  })
  it('defeito tem prioridade sobre faixa (não colidem na prática)', () => {
    expect(classificarAcao('2002 TOMBSTONE', cat, '0000000000', '9999999999')).toEqual({ tipo: 'reprovado', codigo: '2002 TOMBSTONE' })
  })
})
```
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/modules/shopfloor/domain/__tests__/acao-lancamento.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `acao-lancamento.ts`:
```ts
import { serieDentroDaFaixa } from './serie'

export interface DefeitoCatalogo { codigo: string; tipo: number }
export type AcaoLancamento =
  | { tipo: 'aprovado' }
  | { tipo: 'reprovado'; codigo: string }
  | { tipo: 'invalido' }

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Decide o status pelo que foi bipado: defeito do catálogo → reprovado; SN na faixa → aprovado; senão inválido. */
export function classificarAcao(
  valor: string, defeitos: DefeitoCatalogo[], snIni: string, snFim: string,
): AcaoLancamento {
  const alvo = norm(valor)
  if (alvo === '') return { tipo: 'invalido' }
  const def = defeitos.find((d) => norm(d.codigo) === alvo)
  if (def) return { tipo: 'reprovado', codigo: def.codigo }
  if (snIni.trim() !== '' && snFim.trim() !== '' && serieDentroDaFaixa(snIni, snFim, valor)) {
    return { tipo: 'aprovado' }
  }
  return { tipo: 'invalido' }
}
```
- [ ] **Step 4: Rodar e ver passar** (4 testes).
- [ ] **Step 5: Commit** (`git add` os 2 arquivos; msg `feat(shopfloor): classificarAcao — status do Lançamento pelo que é bipado (SN→aprova, defeito→reprova)`).

---

## Task 2: Modais de aprovar e reprovar

**Files:** Create `aprovar-modal.tsx` e `reprovar-modal.tsx`.

**Interfaces:**
- Consumes: `Dialog*` de `@/components/ui/dialog`, `Input`, `Label`, `Button`, `Plus/X` (lucide).
- Produces:
  - `AprovarModal({ aberto, sn, onConfirmar, onCancelar })`: `aberto: boolean; sn: string; onConfirmar: () => void; onCancelar: () => void`.
    - Campo "Bipe o SN de novo para confirmar" (autoFocus quando abre). Enter: se `norm(valor)===norm(sn)` → `onConfirmar()`; senão erro inline "SN diferente — bipe a mesma peça" e seleciona o campo. Esc/onOpenChange(false) → `onCancelar()`.
  - `ReprovarModal({ aberto, codigoInicial, defeitosCatalogo, snEsperado, onConfirmar, onCancelar })`:
    - `codigoInicial: string` (o defeito que abriu a reprova) · `defeitosCatalogo: string[]` · `snEsperado: string` · `onConfirmar: (dados: { defeitos: { codigo: string; posicao: string }[]; sn: string }) => void` · `onCancelar: () => void`.
    - Estado interno: lista de defeitos (1ª linha = `{ codigo: codigoInicial, posicao: '' }`), cada linha = **código** (Input com `list` do datalist do catálogo — aceita digitar OU bipar) + **posição** (Input). Botão/Enter "adicionar defeito". Campo final "Bipe o SN da peça" (autoFocus após abrir? ou após ter ao menos 1 defeito). Confirmar (Enter no SN) exige: ao menos 1 defeito com código≠'' E posição≠'' E o SN bipado igual ao `snEsperado` (se `snEsperado` vazio, aceita o que bipar). Chama `onConfirmar({ defeitos, sn })`.
    - Reset ao abrir (via `key` ou efeito no `aberto`).

- [ ] **Step 1: Escrever `aprovar-modal.tsx`** (componente client controlado; sem estado global; erro inline por `useState`). O `tipo` não é usado aqui.
- [ ] **Step 2: Escrever `reprovar-modal.tsx`** (lista de defeitos + datalist `id="reprova-defeitos-list"`; posição digitada; SN final).
- [ ] **Step 3: Build + lint** → verdes (os modais ainda não são usados; garantir que compilam).
- [ ] **Step 4: Commit** (`feat(shopfloor): modais de aprovar (2º bipe) e reprovar (defeitos+posição+SN) do Lançamento`).

---

## Task 3: Fiação no `lancamento-form` (foco encadeado + campo de ação + modais)

**Files:** Modify `lancamento-form.tsx`.

**Interfaces:** Consumes `classificarAcao` (T1), `AprovarModal`/`ReprovarModal` (T2), `lancar` (existente).

- [ ] **Step 1: Refs de foco + encadeamento**
  - Acrescentar `colaboradorRef` e (se preciso) um ref/id pro Select de posto. Em `onBiparCabecalho`, trocar o foco final de `snRef` → **`colaboradorRef`**.
  - No Input Colaborador: `onKeyDown` Enter/Tab (Enter → foca o Posto). No Select de Posto: ao escolher (`onValueChange`), focar o campo de ação (`snRef`) via `setTimeout`. (base-ui Select já navega por teclado; garantir que Enter no colaborador leva o foco pro trigger do select.)

- [ ] **Step 2: Detectar o fluxo-scanner e trocar a UI de status**
  - `const ehScanner = comStatus && !ehBurnin && !ehNqa && !ehSpi && perfilDo(posto).reprova === 'defeitos'`.
  - Quando `ehScanner`: o Input de Nº de Série vira o **campo de ação** ("Bipe a peça ou o código do defeito"); **esconder** o Status-select e a lista de defeitos inline (esses só aparecem para os postos fora do escopo). No Enter do campo de ação, chamar `onAcao()` (em vez de `onEnviar`).
  - Postos fora do escopo: manter o Input SN + Status + defeitos/SPI/NQA/Burn-in **exatamente como hoje** (o `onEnviar` atual continua para eles).

- [ ] **Step 3: `onAcao()` + estados dos modais**
  - Estados: `aprovarSn: string | null`, `reprovarCodigo: string | null`.
  - `onAcao()`: valida contexto (colaborador/posto/ordem/faixa); `const r = classificarAcao(numeroSerie, defeitos, ordemSel.sn_ini, ordemSel.sn_fim)`.
    - `aprovado` → `setAprovarSn(numeroSerie.trim())` (abre AprovarModal).
    - `reprovado` → `setReprovarCodigo(r.codigo)` (abre ReprovarModal).
    - `invalido` → `setResultado({ tipo:'erro', titulo:'Não reconhecido: nem SN da faixa, nem defeito do catálogo.' })` + seleciona o campo.
  - Renderizar `<AprovarModal aberto={aprovarSn!==null} sn={aprovarSn ?? ''} onCancelar={()=>{setAprovarSn(null); foca ação}} onConfirmar={()=> gravarAprovado()} />` e `<ReprovarModal aberto={reprovarCodigo!==null} codigoInicial={reprovarCodigo ?? ''} defeitosCatalogo={defeitos.map(d=>d.codigo)} snEsperado={''} onCancelar={...} onConfirmar={(d)=>gravarReprovado(d)} />`.

- [ ] **Step 4: `gravarAprovado()` / `gravarReprovado()`** — reusam `lancar`
  - `gravarAprovado()`: `startTransition` → `lancar({ colaborador, posto, pmo, op, numeroSerie: aprovarSn!, status: 'Aprovado' })` → sucesso: `PainelResultado` ok + fecha modal + `limparPeca()` + foca ação. Erro: PainelResultado erro.
  - `gravarReprovado({ defeitos, sn })`: mapear cada defeito p/ `{ codigo, posicao, tipo }` — o **tipo** vem do catálogo: `tipoTextoDoCodigo(codigo)` = procura no `defeitos` catálogo e devolve `d.tipo===2?'Teste':'SMD'`? **Decisão de rótulo:** o backend aceita qualquer texto em `tipo_defeito`; usar o rótulo do catálogo. Como o catálogo só tem 1/2, mapear `1→'Peça'`, `2→'Teste'` (texto informativo). → `lancar({ colaborador, posto, pmo, op, numeroSerie: sn, status: 'Reprovado', defeitos: defeitos.map(x=>({ codigo:x.codigo, posicao:x.posicao, tipo: tipoTextoDoCodigo(x.codigo) })) })`. Sucesso: ok + fecha + limpa + foca ação.
  - **Obs:** o `lancar`/`obrigatoriosPorPerfil` exige `cod && pos && tipo` no reprovado — garantir que `tipo` nunca vai vazio (fallback `'Peça'`).

- [ ] **Step 5: Build + lint + testes** → verdes. (Foco/scanner valida no smoke.)
- [ ] **Step 6: Commit** (`feat(shopfloor): Lançamento scanner — foco encadeado + campo de ação (SN/defeito) + modais aprovar/reprovar`).

---

## Smoke (manual, com scanner)
1. Entrar em Operação → Lançamento: foco já no "Bipe o SN para carregar a OP".
2. Bipar SN → carrega OP → foco no Colaborador → digita → Enter → Posto (escolhe por teclado) → foco no campo de ação.
3. **Aprovar:** bipar um SN da faixa → modal → bipar o mesmo SN → grava Aprovado; bipar SN diferente → barra.
4. **Reprovar:** bipar/digitar um código de defeito → modal → (adicionar defeitos + posição) → bipar o SN → grava Reprovado.
5. **Inválido:** bipar algo fora da faixa e fora do catálogo → erro "não reconhecido".
6. Postos fora do escopo (SPI, NQA, Burn-in, Integração, Embalagem) seguem **iguais**.

## Self-Review
- Escopo isola `ehScanner`; demais postos usam o `onEnviar` atual (não quebra). ✔
- `classificarAcao` puro + testado (T1); modais isolados (T2); fiação/foco (T3). ✔
- Sem migração; reusa `lancar`; `tipo_defeito` sempre preenchido (fallback). ✔
- Foco encadeado e Select-por-teclado são o risco → validar no smoke; fallback autocomplete de posto se o Select não navegar. ✔
