# Tempo mínimo de Burn-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Definir tempo mínimo de Burn-in por OP (Cadastro de OP) e, na saída do Burn-in, avisar (confirmação) quando a peça sai antes do tempo — sem travar.

**Architecture:** Migração adiciona `sf_ordens.tempo_min_burnin` (minutos). Domínio puro converte hh:mm↔minutos. Cadastro de OP grava/edita o campo. Na tela de Lançamento, uma action de lookup busca o horário de entrada da peça e o `onEnviar` mostra uma confirmação (`useConfirmacao`) se `decorrido < mínimo`. O RPC `sf_burnin` NÃO muda (aviso é pré-gravação, no cliente).

**Tech Stack:** Next.js 16 (Server Actions, useActionState/useTransition), React 19, TS strict, Supabase, Vitest 4.

## Global Constraints

- **Migração `0060` só no Dev** nesta etapa (Prod intacta; entra no batch depois). É `add column ... default 0` — não reescreve linhas.
- **Tempo em minutos** no banco (`int`, default 0 = sem mínimo). UI usa `hh:mm` com **horas ilimitadas** (ex.: `48:00`) — NÃO usar `<input type="time">`.
- **Só aviso, nunca trava.** RPC `sf_burnin` permanece inalterado. Confirmação via `useConfirmacao` (`@/components/ui/confirm-dialog`).
- Guards de escrita já existem no padrão do módulo (`getSessao` + `podeNoModulo(sessao.perfil,'shopfloor',<perm>)`). Cadastro de OP = `administrar`; lookup do Burn-in = `lancar`.
- SN normalizada com `normalizarSerie` (`@/modules/shopfloor/domain/serie`) — a mesma do `lancar-action`.
- PT-BR. Build: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`.

---

### Task 1: Domínio — conversões hh:mm ↔ minutos (TDD)

**Files:**
- Create: `src/modules/shopfloor/domain/tempo-burnin.ts`
- Test: `src/modules/shopfloor/domain/__tests__/tempo-burnin.test.ts`

**Interfaces — Produces:**
- `tempoParaMinutos(texto: string): number | null`
- `minutosParaTempo(min: number): string`
- `formatarDuracao(min: number): string`

- [ ] **Step 1: Teste que falha**
```ts
// src/modules/shopfloor/domain/__tests__/tempo-burnin.test.ts
import { describe, it, expect } from 'vitest'
import { tempoParaMinutos, minutosParaTempo, formatarDuracao } from '../tempo-burnin'

describe('tempoParaMinutos', () => {
  it('vazio → 0 (sem mínimo)', () => { expect(tempoParaMinutos('')).toBe(0); expect(tempoParaMinutos('   ')).toBe(0) })
  it('hh:mm válido', () => {
    expect(tempoParaMinutos('2:00')).toBe(120)
    expect(tempoParaMinutos('02:00')).toBe(120)
    expect(tempoParaMinutos('1:05')).toBe(65)
    expect(tempoParaMinutos('48:00')).toBe(2880) // > 24h permitido
    expect(tempoParaMinutos('0:30')).toBe(30)
  })
  it('formato inválido → null', () => {
    expect(tempoParaMinutos('abc')).toBeNull()
    expect(tempoParaMinutos('1:60')).toBeNull() // minutos > 59
    expect(tempoParaMinutos('1:5')).toBe(65)    // 1 dígito de minuto é aceito (5 = 05)
    expect(tempoParaMinutos('2')).toBeNull()    // sem ':'
    expect(tempoParaMinutos('-1:00')).toBeNull()
  })
})

describe('minutosParaTempo', () => {
  it('minutos → hh:mm', () => {
    expect(minutosParaTempo(120)).toBe('2:00')
    expect(minutosParaTempo(65)).toBe('1:05')
    expect(minutosParaTempo(0)).toBe('0:00')
    expect(minutosParaTempo(2880)).toBe('48:00')
  })
})

describe('formatarDuracao', () => {
  it('legível pro aviso', () => {
    expect(formatarDuracao(95)).toBe('1h 35min')
    expect(formatarDuracao(40)).toBe('40min')
    expect(formatarDuracao(120)).toBe('2h')
    expect(formatarDuracao(0)).toBe('0min')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `npx vitest run src/modules/shopfloor/domain/__tests__/tempo-burnin.test.ts` — FAIL (módulo não existe).

- [ ] **Step 3: Implementar**
```ts
// src/modules/shopfloor/domain/tempo-burnin.ts
/** 'hh:mm' (horas ilimitadas, minutos 00-59) → minutos. '' → 0. Inválido → null. */
export function tempoParaMinutos(texto: string): number | null {
  const t = texto.trim()
  if (t === '') return 0
  const m = t.match(/^(\d+):([0-5]?\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** minutos → 'h:mm' (minutos com zero à esquerda). */
export function minutosParaTempo(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  return `${h}:${String(mm).padStart(2, '0')}`
}

/** minutos → texto legível: '1h 35min', '40min', '2h', '0min'. */
export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  if (h === 0) return `${mm}min`
  if (mm === 0) return `${h}h`
  return `${h}h ${mm}min`
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/modules/shopfloor/domain/__tests__/tempo-burnin.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/tempo-burnin.ts src/modules/shopfloor/domain/__tests__/tempo-burnin.test.ts
git commit -m "feat(shopfloor): conversões hh:mm↔minutos p/ tempo de Burn-in

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migração + persistência da OP (banco → repo → action)

**Files:**
- Create: `supabase/migrations/0060_sf_ordens_tempo_min_burnin.sql`
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify: `src/modules/shopfloor/application/ordens-actions.ts`

**Interfaces:**
- Consumes: `tempoParaMinutos` (Task 1).
- Produces: `DadosOrdem`/`OrdemRow` com `tempo_min_burnin: number`; as actions passam a gravar o campo.

- [ ] **Step 1: Migração**
```sql
-- supabase/migrations/0060_sf_ordens_tempo_min_burnin.sql
-- Tempo mínimo de Burn-in por OP (minutos; 0 = sem mínimo). Só add column (não reescreve linhas).
alter table public.sf_ordens
  add column if not exists tempo_min_burnin int not null default 0;
comment on column public.sf_ordens.tempo_min_burnin is 'Tempo mínimo de Burn-in em minutos (0 = sem mínimo).';
```

- [ ] **Step 2: Repo — tipos + select**
Em `ordem-repository.ts`: adicionar `tempo_min_burnin: number` em **`interface OrdemRow`** e em **`interface DadosOrdem`**. Em `listarOrdens()`, incluir `tempo_min_burnin` no `.select('...')` e garantir que o valor flua para cada `OrdemRow` retornada (seguir o cast/map já existente na função — se hoje faz `data as ... OrdemRow[]`, o campo entra sozinho ao estar no select; se mapeia campo-a-campo, adicionar `tempo_min_burnin: r.tempo_min_burnin`). `criarOrdem`/`atualizarOrdem` **não mudam** (gravam `dados` inteiro).

- [ ] **Step 3: Action — parsear e gravar**
Em `ordens-actions.ts`, adicionar `import { tempoParaMinutos } from '../domain/tempo-burnin'`. Em `lerDados(fd)`, incluir no objeto retornado:
```ts
// dentro de lerDados, calcular e incluir:
tempo_min_burnin: 0, // placeholder; será sobrescrito na action após validar (ver abaixo)
```
E em **`criarOrdemAction`** e **`editarOrdemAction`**, logo após `const dados = lerDados(formData)` e antes de `validarOrdem`:
```ts
const tempoMin = tempoParaMinutos(String(formData.get('tempo_min_burnin') ?? ''))
if (tempoMin === null) return { ok: false, erro: 'Tempo mínimo de Burn-in inválido (use hh:mm).' }
dados.tempo_min_burnin = tempoMin
```
(`validarOrdem` não muda.) Alternativa equivalente: fazer o parse dentro de `lerDados` e retornar o erro de fora — escolha a que ficar mais limpa, mas o campo `tempo_min_burnin` DEVE ser número e o formato inválido DEVE virar erro amigável.

- [ ] **Step 4: Verificar tipos** — `npx tsc --noEmit -p tsconfig.json` limpo.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0060_sf_ordens_tempo_min_burnin.sql src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/application/ordens-actions.ts
git commit -m "feat(shopfloor): sf_ordens.tempo_min_burnin (migração 0060) + grava no cadastro de OP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI do Cadastro de OP — campo "Tempo mín. Burn-in"

**Files:**
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx`

**Interfaces:**
- Consumes: `minutosParaTempo` (Task 1); `OrdemRow.tempo_min_burnin` (Task 2).
- Produces: o form envia `tempo_min_burnin` (hh:mm) no `FormData`; `OrdemView` carrega `tempo_min_burnin`.

- [ ] **Step 1: `page.tsx` — OrdemView**
Incluir `tempo_min_burnin: o.tempo_min_burnin` no objeto `OrdemView` mapeado a partir de `listarOrdens()`, e adicionar `tempo_min_burnin: number` ao tipo `OrdemView` (exportado em `ordem-form.tsx`).

- [ ] **Step 2: `ordem-form.tsx` — estado + input + reset**
- Adicionar `tempo_min_burnin: number` em `type OrdemView`.
- Import: `import { minutosParaTempo } from '@/modules/shopfloor/domain/tempo-burnin'`.
- Estado controlado (seguindo o padrão dos outros controlados, ex.: `cliente`/`descricao`):
  ```ts
  const [tempoBurnin, setTempoBurnin] = useState(ordem?.tempo_min_burnin ? minutosParaTempo(ordem.tempo_min_burnin) : '')
  ```
- No **reset-on-open** do Dialog (onde já reseta `pmo`/`cliente`/`descricao`), adicionar:
  ```ts
  setTempoBurnin(ordem?.tempo_min_burnin ? minutosParaTempo(ordem.tempo_min_burnin) : '')
  ```
- Novo campo no form (perto da faixa de SN / config da OP), controlado e com `name` p/ ir no FormData:
  ```tsx
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="tempo_min_burnin">Tempo mín. Burn-in</Label>
    <Input id="tempo_min_burnin" name="tempo_min_burnin" value={tempoBurnin}
      onChange={(e) => setTempoBurnin(e.target.value)} placeholder="ex.: 2:00" autoComplete="off" />
    <p className="text-xs text-muted-foreground">Formato hh:mm. Vazio = sem mínimo.</p>
  </div>
  ```
  (Input controlado com `name` envia o valor no `action={formAction}`.)

- [ ] **Step 3: Build** — `NODE_OPTIONS="--max-old-space-size=4096" npm run build` limpo.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/ordens/ordem-form.tsx" "src/app/(app)/shopfloor/ordens/page.tsx"
git commit -m "feat(shopfloor): campo Tempo mín. Burn-in no Cadastro de OP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Infra do Lançamento — expor tempo + lookup da entrada

**Files:**
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts`

**Interfaces:**
- Produces:
  - `OrdemLancamentoLista.tempo_min_burnin: number`
  - `buscarEntradaBurninAberta(pmo: string, op: string, snNorm: string): Promise<string | null>`

- [ ] **Step 1: `OrdemLancamentoLista` + select**
Adicionar `tempo_min_burnin: number` na interface `OrdemLancamentoLista`; incluir `tempo_min_burnin` no `.select(...)` de `listarOrdensParaLancamento()`, no cast de `rows` e no objeto do `.map(...)` (`tempo_min_burnin: r.tempo_min_burnin`).

- [ ] **Step 2: Lookup da entrada aberta**
```ts
/** data_hora (ISO) da ENTRADA de Burn-in aberta da peça; null se não houver entrada aberta. */
export async function buscarEntradaBurninAberta(pmo: string, op: string, snNorm: string): Promise<string | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('status,data_hora')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', snNorm).eq('posto', 'Burn-in')
    .order('data_hora', { ascending: false })
    .limit(1)
  if (error) throw error
  const linha = (data ?? [])[0] as { status: string; data_hora: string } | undefined
  if (!linha || linha.status !== '') return null // sem entrada aberta (último evento não é entrada)
  return linha.data_hora
}
```

- [ ] **Step 3: Verificar tipos** — `npx tsc --noEmit -p tsconfig.json` limpo.

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts
git commit -m "feat(shopfloor): expõe tempo_min_burnin + lookup da entrada aberta de Burn-in

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Action de lookup do aviso

**Files:**
- Modify: `src/modules/shopfloor/application/lancar-action.ts`

**Interfaces:**
- Consumes: `buscarEntradaBurninAberta` (Task 4); `normalizarSerie` (`../domain/serie`).
- Produces: `buscarEntradaBurnin(pmo: string, op: string, numeroSerie: string): Promise<string | null>`

- [ ] **Step 1: Action**
```ts
// adicionar a lancar-action.ts (que já é 'use server' e importa getSessao/podeNoModulo/normalizarSerie)
export async function buscarEntradaBurnin(pmo: string, op: string, numeroSerie: string): Promise<string | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return null
  const snNorm = normalizarSerie(numeroSerie)
  return buscarEntradaBurninAberta(pmo, op, snNorm)
}
```
(Confirmar que `getSessao`/`podeNoModulo`/`normalizarSerie` já estão importados no arquivo; adicionar o import de `buscarEntradaBurninAberta` do lancamento-repository. Se `lancar-action.ts` não importa `getSessao`/`podeNoModulo`, adicionar. Falha do guard → `null` (fail-safe: sem aviso, não bloqueia o operador).)

- [ ] **Step 2: Verificar tipos** — `npx tsc --noEmit -p tsconfig.json` limpo.

- [ ] **Step 3: Commit**
```bash
git add src/modules/shopfloor/application/lancar-action.ts
git commit -m "feat(shopfloor): action buscarEntradaBurnin (para o aviso de tempo mínimo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: UI do Lançamento — aviso na saída antes do tempo

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Interfaces:**
- Consumes: `buscarEntradaBurnin` (Task 5); `formatarDuracao` (Task 1); `OrdemLancamentoLista.tempo_min_burnin` (Task 4); `useConfirmacao` (`@/components/ui/confirm-dialog`).

- [ ] **Step 1: Imports + hook**
Adicionar imports: `buscarEntradaBurnin` (de `@/modules/shopfloor/application/lancar-action`), `formatarDuracao` (de `@/modules/shopfloor/domain/tempo-burnin`), `useConfirmacao` (de `@/components/ui/confirm-dialog`). No componente: `const { confirmar, dialog } = useConfirmacao()`. Renderizar `{dialog}` no JSX (perto do fim do componente).

- [ ] **Step 2: Aviso no `onEnviar`**
Refatorar `onEnviar` para fazer o await do lookup ANTES do `startTransition`. Logo no início (após `if (!valido || enviando) return`):
```ts
// Aviso de tempo mínimo de Burn-in (só na saída; não trava).
if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempo_min_burnin ?? 0) > 0) {
  const entradaIso = await buscarEntradaBurnin(pmo, op, numeroSerie)
  if (entradaIso) {
    const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
    const min = ordemSel!.tempo_min_burnin
    if (decorridoMin < min) {
      const faltam = formatarDuracao(Math.max(1, Math.ceil(min - decorridoMin)))
      const ok = await confirmar({
        titulo: 'Sair antes do tempo mínimo de Burn-in?',
        descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
      })
      if (!ok) return
    }
  }
}
```
Como agora há `await` antes do `startTransition`, tornar `onEnviar` `async` (o handler do botão e o `onKeyDown` do Enter já podem chamar uma função async; garantir que nada quebre o `enviando`/`disabled`). Manter o restante do fluxo (`startTransition(async () => { const r = await lancar({...}) ... })`) igual.

- [ ] **Step 3: Build** — `NODE_OPTIONS="--max-old-space-size=4096" npm run build` limpo.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx"
git commit -m "feat(shopfloor): aviso na saída do Burn-in antes do tempo mínimo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (feita)
- **Cobertura da spec:** domínio (T1), migração+persistência OP (T2), UI cadastro (T3), infra lançamento+lookup (T4), action lookup (T5), UI aviso (T6). ✔
- **Placeholders:** o `tempo_min_burnin: 0` em `lerDados` é explicitamente um valor sobrescrito na action (documentado), não um TODO. Demais steps têm código/edições concretas.
- **Consistência de tipos:** `tempo_min_burnin: number` em OrdemRow/DadosOrdem/OrdemView/OrdemLancamentoLista; `buscarEntradaBurninAberta`(infra)→`buscarEntradaBurnin`(action)→UI; `tempoParaMinutos`/`minutosParaTempo`/`formatarDuracao` usados em T2/T3/T6. ✔
- **Riscos:** ordem-form.tsx é grande e controlado — T3 segue o padrão dos controlados existentes + reset-on-open (senão volta o bug de "cache"). `onEnviar` vira async (T6). Migração aplicada no Dev pelo controlador após T2 (fora das tarefas de código).
