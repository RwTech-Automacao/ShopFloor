# Cadastrar Posto + Perfis de Posto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Comportamento do posto passa a ser decidido por um **perfil** (não pelo nome), e postos novos podem ser cadastrados escolhendo 1 dos 9 perfis. Paridade total com o comportamento atual.

**Architecture:** Migração `0062` cria `sf_posto_perfis` (9 seeds) + `sf_postos.perfil`. Um novo domínio `perfil-posto.ts` decide por perfil. Os callers (lançamento core, análise/dashboard, form) resolvem o perfil do posto (via `mapaPostoPerfil`) e chamam as funções por perfil. As funções/listas por-nome são removidas ao final. RPCs intactos (já recebem flags). Nova tela admin de Postos.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase, Vitest 4.

## Global Constraints
- **Migração `0062` só no Dev** (Prod está em 0061). Aditiva (tabela + coluna + backfill). RLS `select` = `tem_permissao('shopfloor','visualizar')`.
- **PARIDADE:** os 9 postos atuais mantêm o comportamento EXATO. Perfis (seed) espelham as regras de hoje.
- **RPCs não mudam** — recebem os flags calculados pelo cliente.
- **Cada task deixa o build VERDE.** Sequência: migração → domínio novo (aditivo) → infra (aditivo) → migrar callers por área → remover nome-based → tela.
- `PerfilPosto` (camelCase no TS): `{ chave, nome, temStatus, reprova: 'defeitos'|'posicoes'|'nenhum', gate: 'aprovado'|'registrado', exigeManutencao, recurso: 'nenhum'|'caixa'|'nqa'|'integracao'|'burnin'|'manutencao' }`. Fallback `PERFIL_PADRAO` = passagem.
- Guard admin da tela/actions: `podeNoModulo(sessao.perfil,'shopfloor','administrar')`.
- PT-BR. Build: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`. Controlador aplica `0062` no Dev após T1.

---

### Task 1: Migração 0062 — perfis + coluna + backfill

**Files:** Create `supabase/migrations/0062_sf_posto_perfis.sql`

- [ ] **Step 1:** Criar o arquivo com o SQL da **seção 1 da spec** (`docs/superpowers/specs/2026-07-30-cadastrar-posto-perfis-design.md`) — `create table sf_posto_perfis` + RLS select + os 9 `insert` (com as flags exatas) + `alter table sf_postos add column perfil` + os `update` de backfill (por nome→perfil) + o fallback `perfil='passagem' where perfil is null`. Copiar verbatim da spec.
- [ ] **Step 2:** Não aplicar (sem Postgres local). `ls supabase/migrations/0062_sf_posto_perfis.sql`. Build do app não depende do banco.
- [ ] **Step 3:** Commit
```bash
git add supabase/migrations/0062_sf_posto_perfis.sql
git commit -m "feat(shopfloor): migração 0062 — sf_posto_perfis + sf_postos.perfil (backfill)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio `perfil-posto.ts` + testes (aditivo)

**Files:** Create `src/modules/shopfloor/domain/perfil-posto.ts`; Create `src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`

**Interfaces — Produces:** `PerfilPosto`, `PERFIL_PADRAO`, `perfilTemStatus`, `perfilPrecisaAprovado`, `perfilExigeManutencao`, `montarLinhasPerfil`, `obrigatoriosPorPerfil`.

**Nota:** este módulo é ADITIVO — NÃO remove nada de `regras-lancamento.ts`/`lancamento-linhas.ts` ainda (isso é a Task 7). Reusa os tipos `LinhaDefeito`/`DadosLinhas` de `lancamento-linhas` e `DadosLancamento`/`ResultadoRegra`/`caixaCheia` de `regras-lancamento` (importar de lá).

- [ ] **Step 1: Teste (TDD)** — `perfil-posto.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import {
  perfilTemStatus, perfilPrecisaAprovado, perfilExigeManutencao,
  montarLinhasPerfil, obrigatoriosPorPerfil, PERFIL_PADRAO, type PerfilPosto,
} from '../perfil-posto'

const P = (o: Partial<PerfilPosto>): PerfilPosto => ({
  chave: 'x', nome: 'X', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum', ...o,
})

describe('flags por perfil', () => {
  it('temStatus / precisaAprovado / exigeManutencao', () => {
    expect(perfilTemStatus(P({ temStatus: true }))).toBe(true)
    expect(perfilPrecisaAprovado(P({ gate: 'aprovado' }))).toBe(true)
    expect(perfilPrecisaAprovado(P({ gate: 'registrado' }))).toBe(false)
    expect(perfilExigeManutencao(P({ exigeManutencao: true }))).toBe(true)
  })
})

describe('montarLinhasPerfil', () => {
  it('não reprovado → []', () => {
    expect(montarLinhasPerfil(P({ temStatus: true, reprova: 'defeitos' }), { status: 'aprovado' })).toEqual([])
  })
  it('reprova=posicoes → 1 linha por posição', () => {
    const r = montarLinhasPerfil(P({ temStatus: true, reprova: 'posicoes' }), { status: 'reprovado', posicoes: ['A1', 'B2', ''] })
    expect(r).toEqual([{ codigo_defeito: '', posicao: 'A1', tipo_defeito: '' }, { codigo_defeito: '', posicao: 'B2', tipo_defeito: '' }])
  })
  it('reprova=defeitos → 1 linha por defeito', () => {
    const r = montarLinhasPerfil(P({ temStatus: true, reprova: 'defeitos' }), { status: 'reprovado', defeitos: [{ codigo: '10 X', posicao: 'C3', tipo: 'SMD' }] })
    expect(r).toEqual([{ codigo_defeito: '10 X', posicao: 'C3', tipo_defeito: 'SMD' }])
  })
})

describe('obrigatoriosPorPerfil', () => {
  const base = { colaborador: 'a', pmo: 'p', op: 'o', numeroSerie: 's' }
  it('passagem → só base', () => {
    expect(obrigatoriosPorPerfil(P({}), base).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({}), { ...base, colaborador: '' }).ok).toBe(false)
  })
  it('recurso=caixa exige nº caixa + qtd', () => {
    expect(obrigatoriosPorPerfil(P({ recurso: 'caixa' }), base).ok).toBe(false)
    expect(obrigatoriosPorPerfil(P({ recurso: 'caixa' }), { ...base, numeroCaixa: '1', limiteCaixa: '10' }).ok).toBe(true)
  })
  it('recurso=nqa exige visual+funcional', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, recurso: 'nqa' }), { ...base, nqaVisual: 'A', nqaFuncional: 'B' }).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, recurso: 'nqa' }), base).ok).toBe(false)
  })
  it('temStatus exige status; reprova=defeitos exige cod/pos/tipo', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), base).ok).toBe(false) // sem status
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'aprovado' }).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'reprovado' }).ok).toBe(false) // falta defeito
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'reprovado', cod: '1', pos: 'A', tipo: 'SMD' }).ok).toBe(true)
  })
  it('reprova=posicoes (SPI) exige posição na reprova', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'posicoes' }), { ...base, status: 'reprovado' }).ok).toBe(false)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'posicoes' }), { ...base, status: 'reprovado', pos: 'A1' }).ok).toBe(true)
  })
})
```

- [ ] **Step 2:** Rodar → falha. `npx vitest run src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`

- [ ] **Step 3: Implementar** `perfil-posto.ts`
```ts
import type { LinhaDefeito, DadosLinhas } from './lancamento-linhas'
import { type DadosLancamento, type ResultadoRegra } from './regras-lancamento'

export type ReprovaColeta = 'defeitos' | 'posicoes' | 'nenhum'
export type GateSeq = 'aprovado' | 'registrado'
export type RecursoPosto = 'nenhum' | 'caixa' | 'nqa' | 'integracao' | 'burnin' | 'manutencao'

export interface PerfilPosto {
  chave: string
  nome: string
  temStatus: boolean
  reprova: ReprovaColeta
  gate: GateSeq
  exigeManutencao: boolean
  recurso: RecursoPosto
}

export const PERFIL_PADRAO: PerfilPosto = {
  chave: 'passagem', nome: 'Passagem', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum',
}

export const perfilTemStatus = (p: PerfilPosto): boolean => p.temStatus
export const perfilPrecisaAprovado = (p: PerfilPosto): boolean => p.gate === 'aprovado'
export const perfilExigeManutencao = (p: PerfilPosto): boolean => p.exigeManutencao

/** Expande a reprova em linhas conforme o perfil. Não reprovado → []. */
export function montarLinhasPerfil(p: PerfilPosto, dados: DadosLinhas): LinhaDefeito[] {
  const reprovado = (dados.status ?? '').toLowerCase() === 'reprovado'
  if (!reprovado) return []
  if (p.reprova === 'posicoes') {
    return (dados.posicoes ?? []).filter((x) => x.trim() !== '').map((posicao) => ({ codigo_defeito: '', posicao, tipo_defeito: '' }))
  }
  return (dados.defeitos ?? [])
    .filter((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
    .map((d) => ({ codigo_defeito: d.codigo, posicao: d.posicao, tipo_defeito: d.tipo }))
}

const vazio = (v: string | undefined) => !v || String(v).trim() === ''

/** Obrigatórios por perfil (porta obrigatoriosPorPosto decidindo por recurso/temStatus/reprova). */
export function obrigatoriosPorPerfil(p: PerfilPosto, d: DadosLancamento): ResultadoRegra {
  const base = !vazio(d.colaborador) && !vazio(d.pmo) && !vazio(d.op) && !vazio(d.numeroSerie)
  if (!base) return { ok: false, erro: 'Preencha Colaborador, PMO, OP e Nº de Série.' }

  if (p.recurso === 'caixa') {
    return !vazio(d.numeroCaixa) && !vazio(d.limiteCaixa)
      ? { ok: true }
      : { ok: false, erro: 'Para Embalagem, preencha Colaborador, PMO, OP, Nº da Caixa, QTD por caixa e Nº de Série.' }
  }
  if (p.recurso === 'nqa') {
    return !vazio(d.nqaVisual) && !vazio(d.nqaFuncional)
      ? { ok: true }
      : { ok: false, erro: 'Para Inspeção NQA, preencha Nº de Série, Inspeção Visual e Funcional.' }
  }
  if (!p.temStatus) return { ok: true } // passagem/integração

  if (vazio(d.status)) return { ok: false, erro: 'Preencha Colaborador, PMO, OP, Nº de Série e Status.' }
  const reprovado = d.status!.toLowerCase() === 'reprovado'
  if (p.reprova === 'posicoes') {
    if (reprovado && vazio(d.pos)) return { ok: false, erro: 'Para Inspeção SPI reprovada, informe ao menos uma posição.' }
    return { ok: true }
  }
  if (p.reprova === 'defeitos' && reprovado && (vazio(d.cod) || vazio(d.pos) || vazio(d.tipo))) {
    return { ok: false, erro: 'Para reprovado, preencha código, posição e tipo do defeito.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4:** Rodar → passa. `npx vitest run src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`
- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/perfil-posto.ts src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts
git commit -m "feat(shopfloor): domínio perfil-posto (comportamento por perfil) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra — postos com perfil, mapa, perfis, CRUD (aditivo)

**Files:** Modify `src/modules/shopfloor/infra/ordem-repository.ts`; Create `src/modules/shopfloor/infra/postos-repository.ts`

**Interfaces — Produces:** `listarPostos` retorna `{chave,ordem,perfil}`; `mapaPostoPerfil()`, `listarPerfis()`, `criarPosto`, `atualizarPosto`, `excluirPosto`, `postoEmUsoEmOrdem`.

- [ ] **Step 1:** Em `ordem-repository.ts`: `interface PostoRow` += `perfil: string`; `listarPostos()` select `'chave,ordem,perfil'`.
- [ ] **Step 2:** Criar `postos-repository.ts`:
```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { PERFIL_PADRAO, type PerfilPosto } from '../domain/perfil-posto'

interface PerfilRow {
  chave: string; nome: string; tem_status: boolean; reprova: string; gate: string; exige_manutencao: boolean; recurso: string
}
function paraPerfil(r: PerfilRow): PerfilPosto {
  return {
    chave: r.chave, nome: r.nome, temStatus: r.tem_status,
    reprova: r.reprova as PerfilPosto['reprova'], gate: r.gate as PerfilPosto['gate'],
    exigeManutencao: r.exige_manutencao, recurso: r.recurso as PerfilPosto['recurso'],
  }
}

export async function listarPerfis(): Promise<PerfilPosto[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_posto_perfis').select('chave,nome,tem_status,reprova,gate,exige_manutencao,recurso').order('nome')
  if (error) throw error
  return (data as PerfilRow[]).map(paraPerfil)
}

/** Mapa nome-do-posto → PerfilPosto (fallback passagem). */
export async function mapaPostoPerfil(): Promise<Record<string, PerfilPosto>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_postos')
    .select('chave,perfil,sf_posto_perfis(chave,nome,tem_status,reprova,gate,exige_manutencao,recurso)')
  if (error) throw error
  const mapa: Record<string, PerfilPosto> = {}
  for (const row of (data ?? []) as { chave: string; perfil: string | null; sf_posto_perfis: PerfilRow | null }[]) {
    mapa[row.chave] = row.sf_posto_perfis ? paraPerfil(row.sf_posto_perfis) : PERFIL_PADRAO
  }
  return mapa
}

export async function postoEmUsoEmOrdem(chave: string): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase.from('sf_ordem_postos').select('*', { count: 'exact', head: true }).eq('posto', chave)
  if (error) throw error
  return (count ?? 0) > 0
}

export async function criarPosto(p: { chave: string; ordem: number; perfil: string }): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').insert({ chave: p.chave, ordem: p.ordem, perfil: p.perfil })
  if (error) throw error
}
export async function atualizarPosto(chave: string, p: { ordem: number; perfil: string }): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').update({ ordem: p.ordem, perfil: p.perfil }).eq('chave', chave)
  if (error) throw error
}
export async function excluirPosto(chave: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').delete().eq('chave', chave)
  if (error) throw error
}
```

- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` limpo.
- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/infra/postos-repository.ts
git commit -m "feat(shopfloor): infra de postos+perfil (mapa, perfis, CRUD, em-uso)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Migrar o núcleo do Lançamento (lancar-action + integracao-actions)

**Files:** Modify `src/modules/shopfloor/application/lancar-action.ts`, `src/modules/shopfloor/application/integracao-actions.ts`

**Interfaces — Consumes:** `mapaPostoPerfil` (T3); `perfil*`/`montarLinhasPerfil`/`obrigatoriosPorPerfil`/`PERFIL_PADRAO` (T2).

- [ ] **Step 1: `lancar-action.ts`** — trocar imports por-nome pelos de `perfil-posto`. Logo após o guard, carregar o mapa: `const mapa = await mapaPostoPerfil(); const perfil = mapa[entrada.posto] ?? PERFIL_PADRAO`. Substituir cada uso:
  - rota especial: `postoNorm === 'integração'…` → `perfil.recurso === 'integracao'`; `ehBurnin = postoNorm === 'burn-in'` → `perfil.recurso === 'burnin'`.
  - `obrigatoriosPorPosto(entrada.posto, {…})` → `obrigatoriosPorPerfil(perfil, {…})`.
  - `montarLinhas(entrada.posto, {…})` (2×) → `montarLinhasPerfil(perfil, {…})`.
  - `postoTemStatus(entrada.posto)` → `perfilTemStatus(perfil)`.
  - `exigeManutencao(entrada.posto)` (2×) → `perfilExigeManutencao(perfil)`.
  - `precisaAprovado(prevPosto)` (2×) → `perfilPrecisaAprovado(mapa[prevPosto] ?? PERFIL_PADRAO)` (guardar `const perfilPrev = prevPosto ? (mapa[prevPosto] ?? PERFIL_PADRAO) : null` e usar `perfilPrev ? perfilPrecisaAprovado(perfilPrev) : false`).
- [ ] **Step 2: `integracao-actions.ts`** — `precisaAprovado(prevPosto)` → carregar `mapaPostoPerfil()`, `perfilPrecisaAprovado(mapa[prevPosto] ?? PERFIL_PADRAO)`.
- [ ] **Step 3:** `npx tsc --noEmit` limpo + testes verdes (`npx vitest run`). (As funções antigas ainda existem — build verde.)
- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/application/lancar-action.ts src/modules/shopfloor/application/integracao-actions.ts
git commit -m "refactor(shopfloor): lançamento/integração decidem por perfil (não por nome)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Migrar Análise/Dashboard (grade.ts + dashboard.ts + callers)

**Files:** Modify `src/modules/shopfloor/domain/grade.ts`, `src/modules/shopfloor/domain/dashboard.ts`, e os callers dessas funções (rastrear).

- [ ] **Step 1:** Em `grade.ts` e `dashboard.ts`, trocar a dependência de `postoTemStatus(posto)` por um **predicado injetado**: adicionar um parâmetro `temStatus: (posto: string) => boolean` na(s) função(ões) que usam `postoTemStatus`, e usar `temStatus(posto)` no lugar. Remover o `import { postoTemStatus }`.
- [ ] **Step 2:** Rastrear os callers dessas funções (`grep -rn "from '.*domain/grade'" `, idem dashboard) — as telas/repos de Análise/Dashboard. Em cada caller, construir o predicado a partir do mapa: `const mapa = await mapaPostoPerfil(); const temStatus = (posto: string) => perfilTemStatus(mapa[posto] ?? PERFIL_PADRAO)` e passar às funções de grade/dashboard.
- [ ] **Step 3:** `npx tsc --noEmit` limpo + testes verdes (ajustar os testes de `grade.test.ts` que chamam essas funções pra passar um predicado — ex.: `(posto) => ['Teste','Inspeção SMD',...].includes(posto)` ou um stub coerente).
- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/domain/grade.ts src/modules/shopfloor/domain/dashboard.ts src/app/\(app\)/shopfloor/analisar
git commit -m "refactor(shopfloor): grade/dashboard recebem predicado de status por perfil

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Migrar o form de Lançamento (lancamento-form + page)

**Files:** Modify `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`, `src/app/(app)/shopfloor/operar/lancamento/page.tsx`

- [ ] **Step 1: `page.tsx`** — carregar `mapaPostoPerfil()` e passar `postosPerfil={mapa}` ao `<LancamentoForm>`.
- [ ] **Step 2: `lancamento-form.tsx`** — prop `postosPerfil: Record<string, PerfilPosto>`. Helper `const perfilDo = (p: string) => postosPerfil[p] ?? PERFIL_PADRAO`. Trocar:
  - `comStatus = posto !== '' && postoTemStatus(posto)` → `perfilTemStatus(perfilDo(posto))`.
  - `ehNqa = posto === 'Inspeção NQA'` → `perfilDo(posto).recurso === 'nqa'`.
  - `ehSpi` → `recurso === 'spi'`. **Atenção:** o perfil `spi` tem `recurso: 'nenhum'` (SPI é identificado por `reprova === 'posicoes'`, não por recurso). Então `ehSpi = perfilDo(posto).reprova === 'posicoes'`.
  - `ehEmbalagem` → `recurso === 'caixa'`.
  - `ehBurnin` → `recurso === 'burnin'`.
  - A rota "Integração tem tela própria" → `recurso === 'integracao'`.
  - Remover `import { postoTemStatus }`.
- [ ] **Step 3:** Build limpo (`npm run build`).
- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx" "src/app/(app)/shopfloor/operar/lancamento/page.tsx"
git commit -m "refactor(shopfloor): form de Lançamento detecta recurso pelo perfil do posto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Remover o nome-based (limpeza)

**Files:** Modify `src/modules/shopfloor/domain/lancamento-linhas.ts`, `src/modules/shopfloor/domain/regras-lancamento.ts`, e seus testes.

- [ ] **Step 1:** Confirmar que nada mais importa as funções/listas antigas: `grep -rn "postoTemStatus\|precisaAprovado\|exigeManutencao\|obrigatoriosPorPosto\|montarLinhas\b\|POSTOS_COM_STATUS\|POSTOS_SO_REGISTRADO\|POSTOS_REPARO" src --include=*.ts --include=*.tsx | grep -v perfil-posto` → só deve sobrar as definições e os testes delas.
- [ ] **Step 2:** Remover de `lancamento-linhas.ts`: `POSTOS_COM_STATUS`, `postoTemStatus`, `POSTOS_SO_REGISTRADO`, `precisaAprovado`, `POSTOS_REPARO_VIA_MANUTENCAO`, `exigeManutencao`, `montarLinhas`. **MANTER** os tipos `LinhaDefeito`/`DadosLinhas` (usados por `perfil-posto`). Remover de `regras-lancamento.ts`: `obrigatoriosPorPosto`. **MANTER** `DadosLancamento`, `ResultadoRegra`, `caixaCheia`.
- [ ] **Step 3:** Remover/portar os testes órfãos (`lancamento-linhas.test.ts`, `regras-lancamento.test.ts`): apagar os casos das funções removidas (a cobertura equivalente já está em `perfil-posto.test.ts`); manter os de `caixaCheia` e afins.
- [ ] **Step 4:** `npx vitest run` verde + `npm run build` limpo.
- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain
git commit -m "refactor(shopfloor): remove regras de posto por-nome (agora tudo por perfil)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Tela Cadastrar Posto (Ajustes ShopFloor › Postos)

**Files:** Create `src/app/(app)/configuracoes/sf-postos/{page.tsx,postos-lista.tsx,posto-form.tsx}`; Create `src/modules/shopfloor/application/sf-postos-actions.ts`; Modify `src/shared/ui/app-shell.tsx` (item no accordion).

**Referência:** a tela de Defeitos (`configuracoes/sf-defeitos/*`) — mesmo padrão (guard-por-página `shopfloor.administrar`, Dialog/useActionState, tabela desktop + cards, `useConfirmacao`). Menu: espelhar o item `sf-defeitos` no `CONFIG_SHOPFLOOR`.

- [ ] **Step 1: Actions** `sf-postos-actions.ts` (padrão `defeitos-actions.ts`): `type ResultadoAcaoPosto = { ok: true } | { erro: string }`; guard `podeNoModulo(...,'shopfloor','administrar')`.
  - `cadastrarPostoAction(_prev, formData)`: lê `chave` (nome), `ordem` (int), `perfil`; valida não-vazios + perfil ∈ `listarPerfis()` (ou aceitar e deixar a FK barrar) + ordem numérica; `criarPosto`; trata PK duplicada (`23505` → 'Já existe um posto com esse nome.'); `registrarLog`; `revalidatePath('/configuracoes/sf-postos')`.
  - `atualizarPostoAction(chave, { ordem, perfil })`: guard; **se `postoEmUsoEmOrdem(chave)` → `{ erro: 'Posto em uso em uma OP — não pode editar.' }`**; `atualizarPosto`; log; revalidate.
  - `excluirPostoAction(chave)`: guard; **se `postoEmUsoEmOrdem(chave)` → `{ erro: 'Posto em uso em uma OP — não pode excluir.' }`**; `excluirPosto`; log; revalidate.
- [ ] **Step 2: `page.tsx`** (server, guard `shopfloor.administrar` + `SemPermissao`): `const [postos, perfis] = await Promise.all([listarPostos(), listarPerfis()])`; passar ambos + um mapa `emUso` (opcional: computar por posto via `postoEmUsoEmOrdem` em paralelo, ou deixar a action barrar) → renderiza `<PostosLista postos={...} perfis={...} />`.
- [ ] **Step 3: `posto-form.tsx` + `postos-lista.tsx`** (client, padrão Defeitos):
  - Lista: tabela (Nome · Ordem · Perfil · ações) desktop + cards mobile; ações **Editar** (Dialog com ordem+perfil) e **Excluir** (`useConfirmacao`) — desabilitadas/avisando quando em uso.
  - Form "Novo posto": Dialog com **Nome** (`Input name="chave"`), **Ordem** (`Input type="number" name="ordem"`), **Perfil** (`Select name="perfil"` com `perfis.map`), via `useActionState(cadastrarPostoAction)`.
- [ ] **Step 4: Menu** — em `app-shell.tsx`, adicionar ao `CONFIG_SHOPFLOOR` (antes/depois de Defeitos):
  `{ chave: 'sf-postos', rotulo: 'Postos', href: '/configuracoes/sf-postos', icone: <ícone lucide já importado ou novo, ex. Waypoints/Route>, modulo: 'shopfloor', perm: 'administrar' }`.
- [ ] **Step 5:** Build limpo (rota `/configuracoes/sf-postos` aparece).
- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/configuracoes/sf-postos" src/modules/shopfloor/application/sf-postos-actions.ts src/shared/ui/app-shell.tsx
git commit -m "feat(shopfloor): tela Cadastrar Posto (nome+ordem+perfil; editar/excluir se livre)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (feita)
- **Cobertura:** migração+seed+backfill (T1), domínio por perfil+testes (T2), infra (T3), migração dos callers em 3 frentes (T4 núcleo, T5 análise, T6 form), remoção do nome-based (T7), tela (T8). ✔
- **Build verde por task:** T2/T3 aditivos; T4/T5/T6 migram usando o que T2/T3 criaram (antigo ainda existe); T7 só remove após todos migrados; T8 aditivo. ✔
- **Paridade:** as flags do seed (T1) + `obrigatoriosPorPerfil`/`montarLinhasPerfil` (T2) reproduzem exatamente `obrigatoriosPorPosto`/`montarLinhas` atuais; **SPI é identificado por `reprova==='posicoes'`** (não por recurso) — destacado na T6.
- **Riscos:** T5 exige rastrear callers de grade/dashboard (passo explícito). Guard de edição/exclusão por `postoEmUsoEmOrdem` (T8). Migração no Dev pelo controlador após T1. **Smoke pesado de TODOS os postos** antes de fechar (status, reprova defeitos/posições, gate, manutenção, caixa, NQA, burn-in, integração, passagem) + um **posto novo** de cada perfil genérico.
