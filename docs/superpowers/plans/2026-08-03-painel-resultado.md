# Painel de Resultado — Fase 1 (telas de bipe) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os toasts pequenos por um **painel grande fixo** (`PainelResultado`) nas 3 telas de bipe (Peça/Burn-in, Embalagem, Integração), com informação relevante por ação.

**Architecture:** Um componente reusável `PainelResultado` + tipo `ResultadoAcao`. Cada tela guarda um estado `resultado` e o seta (em vez de `toast`) após cada ação; o painel fica na tela até a próxima. Sem migração, sem backend.

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Tailwind v4.

## Global Constraints
- **Substitui** os toasts dessas ações (não soma). O bipe do **cabeçalho** (`lancamento-form` linha ~95) e o **seletor de SN ambíguo** (Integração) ficam como estão.
- **Nomes canônicos:** `ResultadoAcao`, `ChipResultado`, `PainelResultado` em `src/components/ui/painel-resultado.tsx`.
- **PT-BR**; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task.**

## File Structure
- **Create** `src/components/ui/painel-resultado.tsx` — componente + tipos.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` — Peça/Burn-in.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx`.
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx`.

---

## Task 1: Componente `PainelResultado`

**Files:** Create `src/components/ui/painel-resultado.tsx`.

**Interfaces:** Produces `ResultadoAcao`, `ChipResultado`, `PainelResultado`.

- [ ] **Step 1: Criar o componente**
```tsx
export interface ChipResultado { rotulo?: string; valor: string; mono?: boolean; destaque?: boolean }
export interface ResultadoAcao {
  tipo: 'ok' | 'erro'
  titulo: string
  detalhe?: string
  chips?: ChipResultado[]
  dica?: string
}

/** Painel grande de resultado da última ação (fica na tela até a próxima). */
export function PainelResultado({ resultado }: { resultado: ResultadoAcao | null }) {
  if (!resultado) return null
  const ok = resultado.tipo === 'ok'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex gap-3 rounded-lg border border-l-4 p-4 ${
        ok ? 'border-green-600 bg-green-50 dark:bg-green-950/30' : 'border-red-600 bg-red-50 dark:bg-red-950/30'
      }`}
    >
      <div className={`flex size-9 flex-none items-center justify-center rounded-lg text-lg font-bold text-white ${ok ? 'bg-green-600' : 'bg-red-600'}`}>
        {ok ? '✓' : '!'}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-base font-semibold ${ok ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
          {resultado.titulo}
        </p>
        {resultado.detalhe && <p className="mt-0.5 text-sm text-muted-foreground">{resultado.detalhe}</p>}
        {resultado.chips && resultado.chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {resultado.chips.map((c, i) => (
              <span
                key={i}
                className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  c.destaque
                    ? 'border-green-600 bg-green-100 font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300'
                    : 'border-border bg-card'
                }`}
              >
                {c.rotulo && <span className="text-[0.68rem] uppercase tracking-wide text-muted-foreground">{c.rotulo}</span>}
                <span className={`font-medium ${c.mono ? 'font-mono' : ''}`}>{c.valor}</span>
              </span>
            ))}
          </div>
        )}
        {resultado.dica && <p className="mt-2 text-sm text-muted-foreground">O que fazer: {resultado.dica}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build + lint + testes** — `npm run build && npm run lint && npm test` → verdes.

- [ ] **Step 3: Commit**
```bash
git add src/components/ui/painel-resultado.tsx
git commit -m "feat(shopfloor): componente PainelResultado (feedback rico de ação)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lancamento-form.tsx` — Peça / Burn-in

**Files:** Modify `lancamento-form.tsx`.

**Interfaces:** Consumes `PainelResultado`, `ResultadoAcao`.

- [ ] **Step 1: Import + estado**
```ts
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
// ...perto dos outros useState:
const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
```

- [ ] **Step 2: `resetCamposDinamicos` limpa o painel**

No corpo de `resetCamposDinamicos`, acrescentar `setResultado(null)` (contexto novo = limpa o resultado).

- [ ] **Step 3: `onEnviar` — trocar os toasts pelo painel**

Substituir:
```ts
      if (r.ok) {
        toast.success('Registrado.')
        limparPeca()
      } else {
        toast.error(r.erro)
      }
```
por:
```ts
      if (r.ok) {
        setResultado({
          tipo: 'ok',
          titulo: ehBurnin
            ? (burninEvento === 'saida' ? 'Saída de Burn-in registrada' : 'Entrada de Burn-in registrada')
            : 'Peça registrada',
          chips: [
            { rotulo: 'Nº Série', valor: numeroSerie.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
            ...(mostraStatus && status ? [{ valor: status, destaque: status === 'Aprovado' }] : []),
          ],
        })
        limparPeca()
      } else {
        setResultado({
          tipo: 'erro',
          titulo: r.erro,
          chips: [
            { rotulo: 'Nº Série', valor: numeroSerie.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        })
      }
```

- [ ] **Step 4: Renderizar o painel no topo do card "Peça"**

No card `{!ehIntegracao && !ehEmbalagem && (<Card>…<CardTitle>Peça</CardTitle>…<CardContent…>`, inserir logo no início do `<CardContent>`:
```tsx
<PainelResultado resultado={resultado} />
```
(fica acima do campo Nº de Série.)

- [ ] **Step 5: Build + lint + testes** — verdes. (O `toast` segue importado por causa do bipe do cabeçalho — não remover o import.)

- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): Peça/Burn-in usa PainelResultado no lugar do toast

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `embalagem-panel.tsx` + `integracao-panel.tsx`

**Files:** Modify both panels.

**Interfaces:** Consumes `PainelResultado`, `ResultadoAcao`.

### 3A — `embalagem-panel.tsx`
- [ ] **Step 1: Import + estado**
```ts
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
```

- [ ] **Step 2: Trocar os toasts**
- `recarregar` erro (`toast.error(r.erro)`) → `setResultado({ tipo: 'erro', titulo: r.erro })`.
- `definirLimite` inválido (`toast.error('Informe um limite válido (inteiro > 0).')`) → `setResultado({ tipo: 'erro', titulo: 'Informe um limite válido (inteiro > 0).' })`.
- `onBipar` erro (`toast.error(r.erro)`) → `setResultado({ tipo: 'erro', titulo: r.erro, chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }], dica: /cheia/i.test(r.erro) ? 'Feche a caixa e continue na próxima.' : undefined })`.
- `onBipar` sucesso (hoje sem toast, logo após `setSn('')`): acrescentar
  `setResultado({ tipo: 'ok', titulo: 'Peça embalada', chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }, { rotulo: 'Caixa', valor: `CX${seq} · ${qtdNaCaixa + 1}/${limite}` }] })`.
- `onFechar` erro (`toast.error(r.erro)`) → `setResultado({ tipo: 'erro', titulo: r.erro })`.
- `onFechar` sucesso (`toast.success(\`Caixa fechada: ${r.codigo}\`)`) → `setResultado({ tipo: 'ok', titulo: 'Caixa fechada', chips: [{ rotulo: 'Código', valor: r.codigo, mono: true }] })`.

- [ ] **Step 3: Renderizar** — no início do `<CardContent>` do painel principal (o estado com o contador), inserir `<PainelResultado resultado={resultado} />`. Remover o import de `toast` (não usado mais).

### 3B — `integracao-panel.tsx`
- [ ] **Step 4: Import + estado** (igual ao 3A).

- [ ] **Step 5: Trocar os toasts**
- `onBipar`: erro de resolução (`toast.error(r.erro)`) → `setResultado({ tipo: 'erro', titulo: r.erro })`; "PMO já tem placa" → `setResultado({ tipo: 'erro', titulo: 'PMO já tem placa' })`; "Esse Nº de Série já foi encaixado em X" → `setResultado({ tipo: 'erro', titulo: \`Esse Nº de Série já foi encaixado em ${pmoRepetido}.\` })`; sucesso (`Placa encaixada em ${r.pmo}`) → `setResultado({ tipo: 'ok', titulo: 'Placa encaixada', chips: [{ rotulo: 'PMO', valor: r.pmo }, { rotulo: 'Nº Série', valor: snBipado.trim(), mono: true }] })`.
- `escolherCandidato`: os dois erros e o sucesso, mesmos moldes (sucesso → `titulo: 'Placa encaixada', chips: [{ rotulo: 'PMO', valor: pmoEscolhido }, { rotulo: 'Nº Série', valor: ambiguo.sn, mono: true }]`).
- `onRegistrar`: sucesso (`Integração registrada: ${r.codigo}`) → `setResultado({ tipo: 'ok', titulo: 'Integração registrada', chips: [{ rotulo: 'Código', valor: r.codigo, mono: true }, { rotulo: 'Produto', valor: produtoSN.trim(), mono: true }] })`; erro (`toast.error(r.erro)`) → `setResultado({ tipo: 'erro', titulo: r.erro })`.
- **Não** mexer no bloco do `ambiguo` (o seletor de candidatos continua).

- [ ] **Step 6: Renderizar** — no início do `<CardContent>` do painel de Integração, `<PainelResultado resultado={resultado} />`. Remover o import de `toast` se não sobrar nenhum uso.

- [ ] **Step 7: Build + lint + testes** — verdes. Grep: nenhum `toast.` órfão que devesse ter virado painel nas duas telas.

- [ ] **Step 8: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx" "src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx"
git commit -m "feat(shopfloor): Embalagem e Integração usam PainelResultado no lugar do toast

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)
1. **Peça:** registra → painel verde "Peça registrada" (SN · posto · status), fica na tela; bipa duplicado → painel vermelho com SN+posto.
2. **Burn-in:** entrada/saída → painel "Entrada/Saída de Burn-in registrada".
3. **Embalagem:** bipa → "Peça embalada" (SN · caixa X/limite); caixa cheia → vermelho + dica; fecha → "Caixa fechada" (código).
4. **Integração:** encaixa placa → "Placa encaixada"; registra → "Integração registrada" (código · produto); erros → vermelho.
5. **Persistência + dark:** o painel fica até a próxima ação; conferir dark mode.

## Self-Review
- **Cobertura:** §1 componente → T1; §2 Peça/Burn-in → T2; §3 Embalagem/Integração → T3. ✔
- **Sem placeholders:** código completo. ✔
- **Tipos consistentes:** `ResultadoAcao`/`ChipResultado` (T1) usados idênticos nas 3 telas. ✔
- **Substitui, não soma:** toasts dessas ações viram painel; cabeçalho e ambíguo intocados. ✔
