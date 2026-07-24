# Integração — verificação N1 do SN da placa + info da OP no dropdown — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** (A) validar o SN da placa contra a faixa da OP dela (N1, gradual); (B) enriquecer o dropdown
da OP da placa com `(qtd/concluídas)` + bolinha de status, incluindo OPs finalizadas.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase (view SQL), Vitest. Spec:
`docs/superpowers/specs/2026-07-24-integracao-verificacao-sn-e-op-info-design.md`.

## Global Constraints
- Branch `feat/shopfloor-lancamento`. TS strict. Migração só no **Dev**.
- **N1 gradual:** OP da placa sem faixa (`sn_ini`/`sn_fim` vazios) → **não bloqueia**.
- **"concluídas"** = SNs distintos no **posto final** do fluxo (aprovado se tem status; registrado se
  sem-status). Sem-status = inicial, montagem pth, integração, embalagem, extra máquina.
- Dropdown da placa inclui **ativas + finalizadas**; **produto** segue só ativas + Integração no fluxo.
- N1 vive na `application` (reusa `serieDentroDaFaixa`), **não** no SQL. Sem mudança de assinatura de função.
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (heredoc).
- Verificação por task: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure
- Create: `supabase/migrations/0036_sf_ordem_resumo.sql`
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (+`OrdemIntegracao`, `listarOrdensParaIntegracao`, `listarFaixasOrdens`)
- Modify: `src/modules/shopfloor/application/integracao-actions.ts` (N1 no servidor)
- Modify: `src/app/(app)/shopfloor/integracao/page.tsx` (usa o carregador novo)
- Modify: `src/app/(app)/shopfloor/integracao/integracao-form.tsx` (dropdown enriquecido + produto só-ativas + N1 no cliente)
- Modify: `docs/regras-de-negocio-shopfloor.md`

---

### Task 1: View `sf_ordem_resumo` + carregador enriquecido

**Files:** Create `supabase/migrations/0036_sf_ordem_resumo.sql`; Modify `lancamento-repository.ts`.

**Interfaces:**
- Produces: view `sf_ordem_resumo(pmo,op,qtd,status,concluidas)`; `OrdemIntegracao`;
  `listarOrdensParaIntegracao(): Promise<OrdemIntegracao[]>`.

- [ ] **Step 1: Migração** — `supabase/migrations/0036_sf_ordem_resumo.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — resumo por OP p/ o dropdown da Integração.
-- concluidas = SNs distintos que passaram/aprovaram no POSTO FINAL do
-- fluxo da OP (aprovado se o posto final tem status; registrado se sem-status).
-- security_invoker = true → respeita a RLS de quem consulta.
-- =============================================================

create or replace view public.sf_ordem_resumo
with (security_invoker = true) as
select
  o.pmo,
  o.op,
  o.qtd,
  o.status,
  coalesce((
    select count(distinct r.numero_serie_norm)
    from public.sf_registros r
    where r.pmo = o.pmo and r.op = o.op and r.posto = fp.posto
      and (
        lower(fp.posto) in ('inicial','montagem pth','integração','integracao','embalagem','extra máquina')
        or lower(r.status) = 'aprovado'
      )
  ), 0) as concluidas
from public.sf_ordens o
left join lateral (
  select p.posto
  from public.sf_ordem_postos p
  where p.ordem_id = o.id
  order by p.ordem desc
  limit 1
) fp on true;

grant select on public.sf_ordem_resumo to authenticated;
```

- [ ] **Step 2: Aplicar no Dev** — `SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" supabase db push` (só `0036`).

- [ ] **Step 3: Tipo + carregador** — em `lancamento-repository.ts`, adicionar (perto de `OrdemLancamentoLista`):

```ts
export interface OrdemIntegracao {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  qtd: number | null
  status: string
  postos: string[]
  componentes: string[]
  concluidas: number
}

/** TODAS as OPs (ativas + finalizadas) enriquecidas p/ a tela de Integração. */
export async function listarOrdensParaIntegracao(): Promise<OrdemIntegracao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,qtd,status,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    sn_ini: string
    sn_fim: string
    qtd: number | null
    status: string
    sf_ordem_postos: { posto: string; ordem: number }[]
    sf_ordem_componentes: { pmo_componente: string }[]
  }[]
  const resumo = await supabase.from('sf_ordem_resumo').select('pmo,op,concluidas')
  if (resumo.error) throw resumo.error
  const mapa = new Map<string, number>()
  for (const r of resumo.data as { pmo: string; op: string; concluidas: number }[]) {
    mapa.set(`${r.pmo}||${r.op}`, r.concluidas)
  }
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    qtd: r.qtd,
    status: r.status,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
    componentes: r.sf_ordem_componentes.map((c) => c.pmo_componente),
    concluidas: mapa.get(`${r.pmo}||${r.op}`) ?? 0,
  }))
}

/** Faixas de SN de todas as OPs (p/ a verificação N1 do SN da placa). */
export async function listarFaixasOrdens(): Promise<{ pmo: string; op: string; sn_ini: string; sn_fim: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('pmo,op,sn_ini,sn_fim')
  if (error) throw error
  return data as { pmo: string; op: string; sn_ini: string; sn_fim: string }[]
}
```

- [ ] **Step 4: Smoke no Dev** (script em arquivo, lê `.env.local`): a view retorna `concluidas`
  coerente pra uma OP conhecida com registros (ex.: uma OP de placa com histórico). Registrar no report.

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit` (nada consome ainda; deve passar).

```bash
git add supabase/migrations/0036_sf_ordem_resumo.sql src/modules/shopfloor/infra/lancamento-repository.ts
git commit -F - <<'EOF'
feat(shopfloor): view sf_ordem_resumo (concluídas por OP) + carregador da Integração

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: N1 no servidor — SN da placa dentro da faixa

**Files:** Modify `src/modules/shopfloor/application/integracao-actions.ts`.

**Interfaces:** Consumes `listarFaixasOrdens` (Task 1), `serieDentroDaFaixa` (já importado).

- [ ] **Step 1:** em `integracao-actions.ts`, importar o carregador (junto dos outros imports de infra):

```ts
import { carregarOrdem, listarFaixasOrdens } from '../infra/lancamento-repository'
```

- [ ] **Step 2:** na action `integrar`, **depois** de `const v = validarItensIntegracao(...)` (que já
  devolve `v.placas`) e **antes** de `const prevPosto = ...`/`chamarSfIntegrar`, inserir a verificação N1:

```ts
  // N1: cada placa com faixa cadastrada na sua OP precisa ter o SN dentro dela (gradual: sem faixa → passa).
  const faixas = await listarFaixasOrdens()
  const mapaFaixa = new Map(faixas.map((f) => [`${f.pmo.trim()}||${f.op.trim()}`, f]))
  for (let i = 0; i < v.placas.length; i++) {
    const placa = v.placas[i]!
    const f = mapaFaixa.get(`${placa.pmo.trim()}||${placa.op.trim()}`)
    if (f && f.sn_ini.trim() !== '' && f.sn_fim.trim() !== '' && !serieDentroDaFaixa(f.sn_ini, f.sn_fim, placa.sn)) {
      return { ok: false, erro: `Nº de Série da placa ${i + 1} fora da faixa da OP ${placa.op}.` }
    }
  }
```

- [ ] **Step 3: Verificar e commitar** — `npx tsc --noEmit && npm run test`.

```bash
git add src/modules/shopfloor/application/integracao-actions.ts
git commit -F - <<'EOF'
feat(shopfloor): N1 — SN da placa validado contra a faixa da OP (gradual)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Tela — dropdown enriquecido + produto só-ativas + N1 no cliente + regras

**Files:** Modify `integracao/page.tsx`, `integracao/integracao-form.tsx`, `docs/regras-de-negocio-shopfloor.md`.

**Interfaces:** Consumes `OrdemIntegracao`/`listarOrdensParaIntegracao` (Task 1), `serieDentroDaFaixa`.

- [ ] **Step 1: Página** — em `integracao/page.tsx`, trocar a fonte de dados:

```ts
import { listarOrdensParaIntegracao } from '@/modules/shopfloor/infra/lancamento-repository'
// …
  const ordens = await listarOrdensParaIntegracao()
```

- [ ] **Step 2: Form — tipo + imports** — em `integracao-form.tsx`:
  - Import do tipo: trocar `import type { OrdemLancamentoLista } from ...` por
    `import type { OrdemIntegracao } from '@/modules/shopfloor/infra/lancamento-repository'`.
  - Assinatura: `ordens: OrdemIntegracao[]`.
  - Importar o domínio: `import { serieDentroDaFaixa } from '@/modules/shopfloor/domain/serie'`.

- [ ] **Step 3: Produto só-ativas** — trocar o cálculo de `ordensIntegraveis` (linha ~51):

```ts
  const ordensIntegraveis = useMemo(
    () => ordens.filter((o) => o.status.toUpperCase() !== 'FINALIZADA' && o.postos.includes('Integração')),
    [ordens],
  )
```

- [ ] **Step 4: Helper das OPs de placa + N1 no cliente** — perto de `opsDoPmo`/`descricaoDe` (linha ~68):

```ts
  // OPs (objetos) de um PMO de placa — todas (ativas + finalizadas), p/ o dropdown enriquecido.
  function ordensDoPmo(p: string) {
    return ordens.filter((o) => o.pmo === p)
  }
  // N1 (cliente): SN da placa fora da faixa da OP dela? (sem faixa → não acusa)
  function snForaDaFaixa(l: LinhaPlaca): boolean {
    if (l.sn.trim() === '' || l.pmo === '' || l.op === '') return false
    const o = ordens.find((x) => x.pmo === l.pmo && x.op === l.op)
    if (!o || o.sn_ini.trim() === '' || o.sn_fim.trim() === '') return false
    return !serieDentroDaFaixa(o.sn_ini, o.sn_fim, l.sn)
  }
```

- [ ] **Step 5: `valido` inclui N1** — na definição de `valido` (linha ~100), acrescentar o termo:

```ts
  const valido =
    colaborador.trim() !== '' && ordemSel !== null && produtoSN.trim() !== '' &&
    placas.length > 0 && placas.every((l) => l.sn.trim() !== '') &&
    !placas.some(snForaDaFaixa)
```

- [ ] **Step 6: Dropdown da OP da placa enriquecido** — trocar o `SelectContent` do OP (linha ~238):

```tsx
                          <SelectContent>{ordensDoPmo(l.pmo).map((o) => (
                            <SelectItem key={o.op} value={o.op}>
                              <span className="flex items-center gap-1.5">
                                <span className={`inline-block size-2 shrink-0 rounded-full ${o.status.toUpperCase() === 'FINALIZADA' ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />
                                {o.op}
                                <span className="text-muted-foreground">({o.qtd ?? '—'}/{o.concluidas})</span>
                              </span>
                            </SelectItem>
                          ))}</SelectContent>
```

- [ ] **Step 7: Aviso N1 no SN da placa** — trocar o `<Input>` do SN (linha ~245) por versão com borda/aviso:

```tsx
                      <TableCell className="min-w-[160px]">
                        <Input
                          value={l.sn}
                          onChange={(e) => atualizarPlaca(i, { sn: e.target.value })}
                          placeholder="Bipe o SN da placa"
                          autoComplete="off"
                          aria-invalid={snForaDaFaixa(l)}
                          className={snForaDaFaixa(l) ? 'border-red-500 focus-visible:ring-red-500' : ''}
                        />
                        {snForaDaFaixa(l) && (
                          <p className="mt-1 text-xs text-red-600">SN fora da faixa da OP.</p>
                        )}
                      </TableCell>
```

- [ ] **Step 8: Regras** — em `docs/regras-de-negocio-shopfloor.md`, seção Integração:
  - Adicionar item **N1**: *"SN da placa deve estar na faixa (`sn_ini..sn_fim`) da OP da placa —
    validado no cliente (aviso) e na action (`serieDentroDaFaixa`). **Gradual:** OP sem faixa não
    bloqueia. (N2/N3 — placa produzida/aprovada — ficam no backlog.)"*
  - Anotar que o **dropdown da OP da placa** mostra `(qtd/concluídas)` + bolinha (verde Ativa/cinza
    Finalizada) e **lista ativas + finalizadas** (restaura o legado `obterPMO_OPS`, que não filtrava
    status; o produto segue só-ativas). Concluídas via view `sf_ordem_resumo` (migração `0036`).
  - (O backlog já foi atualizado — N1 marcado como entregue, N2/N3 e obrigatoriedade de faixa/SN
    seguem lá; **não** mexer no backlog nesta task.)

- [ ] **Step 9: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`.

```bash
git add "src/app/(app)/shopfloor/integracao/page.tsx" "src/app/(app)/shopfloor/integracao/integracao-form.tsx" docs/regras-de-negocio-shopfloor.md
git commit -F - <<'EOF'
feat(shopfloor): dropdown da OP da placa com (qtd/concluídas) + status; inclui finalizadas; N1 no cliente

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4 (controller): suíte + review amplo + smoke no Dev + push
- `npx tsc --noEmit && npm run lint && npm run test`.
- Smoke Dev (script em arquivo): (a) a view dá `concluidas` coerente; (b) integrar placa com SN fora
  da faixa → barra (`fora da faixa`); dentro → ok; OP sem faixa → passa. Limpar dados de teste.
- Review amplo (opus) desde a base da feature.
- Push da branch pro preview.

## Self-Review
- Spec coberta: N1 (T2 servidor + T3 cliente) ✅; view+carregador (T1) ✅; dropdown+finalizadas+produto-ativas (T3) ✅; gradual (sem faixa) em T2/T3 ✅.
- Tipos: `OrdemIntegracao` fluindo page→form; `concluidas`/`qtd`/`status` renderizados.
- Sem placeholders; todo passo tem código real.
