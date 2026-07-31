# Integração vira posto (por bipe) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Integração deixa de ser aba e vira posto do Lançamento; registro por bipe (o sistema encaixa cada SN de placa na PMO da receita, achando a OP pela faixa). Comportamento por perfil (recurso integracao), não pelo nome.

**Architecture:** RPC `sf_integrar` ganha `p_posto` (grava `sf_registros` com o posto real, não 'Integração' fixo). Novo domínio `integracao-matching` (resolver SN→OP/PMO). `integrar` action fica perfil-driven; nova action de resolver placa por bipe. UI: `<IntegracaoPanel>` renderizado no `lancamento-form` quando `recurso==='integracao'`; aba removida; rota antiga vira redirect; perfil Integração reabilitado.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase (security-definer RPC), Vitest 4.

## Global Constraints
- **Migração `0064` só no Dev** (Prod em 0060; Dev já tem 0061–0063). RPC redefinido (drop da assinatura antiga + recreate). Sem mudança de tabela.
- **Receita por OP** (não muda); **1 placa por PMO**; placa não-aprovada **passa** (N1 de faixa continua). Escopo: 1 posto Integração por OP.
- Guard: `podeNoModulo(...,'shopfloor','lancar')` (registrar/resolver); cancelar = `administrar` (inalterado).
- **Cada task deixa o build VERDE.**
- PT-BR. Build: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`. Controlador aplica `0064` no Dev após T1.

---

### Task 1: Migração 0064 — `sf_integrar` ganha `p_posto`

**Files:** Create `supabase/migrations/0064_sf_integrar_por_posto.sql`

- [ ] **Step 1:** Criar o arquivo. Dropar a assinatura atual (0035, 9 args) e recriar com `p_posto text` ao final, trocando `'Integração'` por `p_posto` nas 2 inserções em `sf_registros`. Copiar o corpo do `sf_integrar` atual de `supabase/migrations/0035_sf_integrar_gate_sequencia.sql` e alterar só o necessário:
```sql
-- sf_integrar ganha p_posto: grava sf_registros com o posto de Integração REAL (não 'Integração' fixo),
-- pré-requisito pra Integração ser um posto dirigido por perfil. Assinatura muda → drop antes do recreate.
drop function if exists public.sf_integrar(text,text,text,text,text,text,text,boolean,jsonb);

create or replace function public.sf_integrar(
  p_colaborador           text,
  p_cliente               text,
  p_pmo                   text,
  p_op                    text,
  p_produto_sn            text,
  p_produto_sn_norm       text,
  p_prev_posto            text,
  p_prev_precisa_aprovado boolean,
  p_placas                jsonb,
  p_posto                 text     -- posto de Integração do fluxo (grava em sf_registros)
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- ... CORPO IDÊNTICO ao 0035 (declare + guard + advisory lock + gate de sequência + produto já integrado +
--     placa já vinculada + receita/PLACA_FORA_DA_RECEITA + gera v_codigo + insert sf_integracoes + itens),
--     EXCETO as 2 inserções em sf_registros: trocar 'Integração' por p_posto:
--   insert into sf_registros (..., posto, ...) values (..., p_posto, ...);   -- produto
--   insert into sf_registros (..., posto, ...) select ..., p_posto, ... ;    -- placas
$$;
```
**Nota ao implementer:** reproduza o corpo COMPLETO do 0035 (linhas 27–121) — só as duas linhas `'Integração'` (113 e 116) viram `p_posto`. Nada mais muda.

- [ ] **Step 2:** Não aplicar (controlador aplica no Dev). `ls supabase/migrations/0064_sf_integrar_por_posto.sql`.
- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0064_sf_integrar_por_posto.sql
git commit -m "feat(shopfloor): migração 0064 — sf_integrar grava sf_registros com o posto real (p_posto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — matching SN→OP/PMO (TDD)

**Files:** Create `src/modules/shopfloor/domain/integracao-matching.ts`; Test `src/modules/shopfloor/domain/__tests__/integracao-matching.test.ts`

**Interfaces — Produces:** `interface FaixaOp`; `resolverPlaca(receita, faixas, sn)`.

- [ ] **Step 1: Teste (falha)**
```ts
import { describe, it, expect } from 'vitest'
import { resolverPlaca, type FaixaOp } from '../integracao-matching'

const F = (pmo: string, op: string, ini: string, fim: string): FaixaOp => ({ pmo, op, sn_ini: ini, sn_fim: fim })
const FAIXAS = [
  F('PMOB76', '8801', 'B7600', 'B7699'),
  F('PMO974', '8811', '97400', '97499'),
  F('PMOX99', '9000', 'X9900', 'X9999'), // fora da receita
]
const RECEITA = ['pmob76', 'pmo974'] // receita guarda lower/trim (como no domínio receita)

describe('resolverPlaca', () => {
  it('encaixa SN na OP/PMO certa (dentro da faixa + na receita)', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'B7601')).toEqual({ ok: true, pmo: 'PMOB76', op: '8801' })
    expect(resolverPlaca(RECEITA, FAIXAS, '97450')).toEqual({ ok: true, pmo: 'PMO974', op: '8811' })
  })
  it('SN de PMO fora da receita → FORA_RECEITA', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'X9950')).toEqual({ ok: false, erro: 'FORA_RECEITA' })
  })
  it('SN que não cai em nenhuma faixa → SEM_OP', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'Z0001')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('duas OPs da receita contendo o SN → AMBIGUO', () => {
    const dupl = [F('PMOB76', '8801', 'B7600', 'B7699'), F('PMOB76', '8802', 'B7600', 'B7699')]
    expect(resolverPlaca(['pmob76'], dupl, 'B7601')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })
})
```

- [ ] **Step 2:** Rodar → falha. `npx vitest run src/modules/shopfloor/domain/__tests__/integracao-matching.test.ts`

- [ ] **Step 3: Implementar**
```ts
import { serieDentroDaFaixa } from './serie'
import { receitaPermite } from './receita'

export interface FaixaOp {
  pmo: string
  op: string
  sn_ini: string
  sn_fim: string
}

/** Acha a OP/PMO de uma placa pelo SN bipado: dentro da faixa E com a PMO na receita do produto. */
export function resolverPlaca(
  receita: string[],
  faixas: FaixaOp[],
  sn: string,
): { ok: true; pmo: string; op: string } | { ok: false; erro: 'SEM_OP' | 'FORA_RECEITA' | 'AMBIGUO' } {
  const comFaixa = faixas.filter(
    (f) => f.sn_ini.trim() !== '' && f.sn_fim.trim() !== '' && serieDentroDaFaixa(f.sn_ini, f.sn_fim, sn),
  )
  if (comFaixa.length === 0) return { ok: false, erro: 'SEM_OP' }
  const naReceita = comFaixa.filter((f) => receitaPermite(receita, f.pmo))
  if (naReceita.length === 0) return { ok: false, erro: 'FORA_RECEITA' }
  if (naReceita.length > 1) return { ok: false, erro: 'AMBIGUO' }
  return { ok: true, pmo: naReceita[0]!.pmo, op: naReceita[0]!.op }
}
```
**Nota:** confira a assinatura de `receitaPermite` em `src/modules/shopfloor/domain/receita.ts` (recebe `(receita: string[], pmo: string)`); ajuste a chamada se necessário. Os testes usam a receita já em lower/trim — se `receitaPermite` normaliza internamente, mantenha coerência.

- [ ] **Step 4:** Rodar → passa. **Step 5: Commit**
```bash
git add src/modules/shopfloor/domain/integracao-matching.ts src/modules/shopfloor/domain/__tests__/integracao-matching.test.ts
git commit -m "feat(shopfloor): domínio de matching de placa por SN (resolverPlaca) + testes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Infra + Application — integrar por perfil + resolver por bipe

**Files:** Modify `src/modules/shopfloor/infra/integracao-repository.ts` (args do `chamarSfIntegrar`); Modify `src/modules/shopfloor/application/integracao-actions.ts`

- [ ] **Step 1: Infra** — no tipo dos args de `chamarSfIntegrar`, adicionar `p_posto: string` (o `rpc('sf_integrar', args)` passa o objeto direto).
- [ ] **Step 2: `integrar` action — perfil-driven** (em `integracao-actions.ts`):
  - Já importa `mapaPostoPerfil`. Após `const ordem = await carregarOrdem(...)`, trocar:
    - `if (!ordem.postos.includes('Integração'))` → resolver o posto:
      ```ts
      const mapa = await mapaPostoPerfil()
      const postoIntegr = ordem.postos.find((p) => mapa[p]?.recurso === 'integracao')
      if (!postoIntegr) return { ok: false, erro: 'Esta OP não tem um posto de Integração no fluxo.' }
      ```
    - `postoAnteriorNaSequencia('Integração', ordem.postos)` → `postoAnteriorNaSequencia(postoIntegr, ordem.postos)`.
    - remover a segunda chamada `const mapa = await mapaPostoPerfil()` (linha 77) se ficar duplicada — usar o `mapa` já carregado.
    - no `chamarSfIntegrar({...})`, adicionar `p_posto: postoIntegr`.
- [ ] **Step 3: Nova action `resolverPlacaIntegracaoAction`** (mesmo arquivo):
```ts
import { resolverPlaca } from '../domain/integracao-matching'
// listarFaixasOrdens já é importado.

export async function resolverPlacaIntegracaoAction(
  pmoProduto: string,
  opProduto: string,
  sn: string,
): Promise<{ ok: true; pmo: string; op: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const ordem = await carregarOrdem(pmoProduto.trim(), opProduto.trim())
  if (!ordem) return { ok: false, erro: 'OP do produto não encontrada.' }
  const receita = ordem.componentes ?? []
  const faixas = await listarFaixasOrdens()
  const r = resolverPlaca(receita, faixas, limparSerie(sn))
  if (!r.ok) {
    const msg = r.erro === 'FORA_RECEITA' ? 'Essa placa não faz parte da receita deste produto.'
      : r.erro === 'AMBIGUO' ? 'SN ambíguo (mais de uma OP da receita contém esse número).'
      : 'SN não encontrado em nenhuma OP.'
    return { ok: false, erro: msg }
  }
  return { ok: true, pmo: r.pmo, op: r.op }
}
```
  (Confirmar que `carregarOrdem` retorna `componentes` — é o mesmo objeto usado pela integracao-form via `ordemSel.componentes`.)
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.json` limpo + `npx vitest run` verde.
- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/infra/integracao-repository.ts src/modules/shopfloor/application/integracao-actions.ts
git commit -m "feat(shopfloor): integrar por perfil (posto integracao) + resolver placa por bipe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: UI — `<IntegracaoPanel>` (painel de bipe)

**Files:** Create `src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx`

**Referência:** o mockup aprovado (fluxo/visual) + a `operar/integracao/integracao-form.tsx` (lógica de registrar/erros) + as actions da Task 3.

- [ ] **Step 1:** Criar o componente client `IntegracaoPanel` com props:
```ts
{ colaborador: string; cliente: string; pmo: string; op: string; descricao: string; componentes: string[] }
```
  - Estado: `linhas: Record<pmo, { sn: string; op: string }>` (encaixadas); `produtoSN: string`.
  - **Receita listada** (1 linha por PMO de `componentes`): PMO · SN encaixado (ou "aguardando bipe") · status.
  - **Campo de bipe** (Enter): chama `resolverPlacaIntegracaoAction(pmo, op, sn)`; sucesso → preenche a linha da PMO retornada (rejeita se a PMO já preenchida → toast); erro → toast.
  - **Produto Final (Nº de Série):** input próprio (`produtoSN`).
  - **Registrar Integração**: habilita quando todas as PMOs de `componentes` estão preenchidas **e** `produtoSN` não-vazio; chama
    `integrar({ colaborador, pmo, op, produtoSN, placas })` onde `placas = componentes.map((pm) => ({ pmo: pm, op: linhas[pm].op, sn: linhas[pm].sn }))`; sucesso → toast "Integração registrada: {codigo}" + limpar.
  - Usa `toast` (sonner) como o resto do módulo.
- [ ] **Step 2:** Build limpo (`npm run build`). (Ainda não renderizado — componente isolado.)
- [ ] **Step 3: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/lancamento/integracao-panel.tsx"
git commit -m "feat(shopfloor): IntegracaoPanel — registrar integração por bipe (receita + matching)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wiring no Lançamento + remover aba + redirect + reabilitar perfil

**Files:** Modify `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`; Modify `src/app/(app)/shopfloor/operar/layout.tsx`; Modify `src/app/(app)/shopfloor/operar/integracao/page.tsx`; Modify `src/modules/shopfloor/domain/perfil-posto.ts`

- [ ] **Step 1: Lançamento renderiza o painel** — em `lancamento-form.tsx`:
  - **Deixar Integração selecionável:** hoje o `postosDaOp` filtra `recurso !== 'integracao'`; passar a INCLUIR integracao no dropdown de Posto.
  - Novo: `const ehIntegracao = posto !== '' && perfilDo(posto).recurso === 'integracao'`.
  - Quando `ehIntegracao`: **esconder** o card de "Peça" (Nº de Série/Status/defeitos/caixa/etc.) e o botão "Enviar"; renderizar `<IntegracaoPanel colaborador={colaborador} cliente={cliente} pmo={pmo} op={op} descricao={ordemSel?.descricao ?? ''} componentes={ordemSel?.componentes ?? []} />`. (Confirmar que `ordemSel` tem `componentes` — a lista do Lançamento carrega via `listarOrdensParaLancamento`; se não tiver `componentes`, adicionar ao select/tipo `OrdemLancamentoLista` e ao map, espelhando `sf_ordem_componentes`.)
  - O restante do fluxo normal (peça) segue igual pros outros postos.
- [ ] **Step 2: Remover a aba** — `operar/layout.tsx`: tirar `{ rotulo: 'Integração', href: '/shopfloor/operar/integracao' }` (fica Lançamento | Manutenção).
- [ ] **Step 3: Rota antiga** — `operar/integracao/page.tsx`: substituir o conteúdo por `import { redirect } from 'next/navigation'; export default function Page(){ redirect('/shopfloor/operar/lancamento') }`. (Pode remover `integracao-form.tsx` se não for mais usado — confere que nada mais o importa.)
- [ ] **Step 4: Reabilitar perfil** — `perfil-posto.ts`: `RECURSOS_NAO_ATRIBUIVEIS` passa a ser `['burnin', 'manutencao']` (integracao volta a ser atribuível). Atualizar o comentário.
- [ ] **Step 5:** Build limpo + `npx vitest run` verde.
- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/shopfloor/operar" src/modules/shopfloor/domain/perfil-posto.ts
git commit -m "feat(shopfloor): Integração vira posto no Lançamento (aba some, redirect, perfil reabilitado)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (feita)
- **Cobertura:** RPC p_posto (T1), matching domínio+testes (T2), infra+actions perfil-driven+resolver (T3), painel de bipe (T4), wiring+aba+redirect+perfil (T5). ✔
- **Build verde:** T1 SQL; T2 aditivo; T3 usa T2 + RPC no Dev; T4 componente isolado; T5 conecta tudo. ✔
- **Placeholders:** T1 pede reproduzir o corpo do 0035 (só 2 linhas mudam) — é conformidade, não lacuna. As "Notas" (receitaPermite, componentes em carregarOrdem/OrdemLancamentoLista) são checagens do código real.
- **Riscos:** `ordemSel.componentes` precisa existir no Lançamento (T5 Step 1 cobre adicionar se faltar). Matching AMBIGUO raro. RPC redefinido (drop). Smoke pesado: registrar integração + gate no Lançamento + cancelar + posto novo de perfil Integração.
