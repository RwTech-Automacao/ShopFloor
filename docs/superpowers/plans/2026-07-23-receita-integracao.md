# Receita de Integração (BOM por PMO) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** restringir, na Integração, quais **PMOs de placa** podem compor um produto — via uma
"receita" opcional por OP, cadastrada no fluxo e reaproveitada pelo "Puxar fluxo".

**Architecture:** tabela `sf_ordem_componentes` (receita efetiva por OP; vazia = sem restrição).
Cadastro de OP edita a receita (só quando Integração está no fluxo); a Integração esconde PMOs fora
da receita no dropdown da placa; `sf_integrar` barra como rede de segurança. Função pura
`receitaPermite` para o cliente, espelhada no SQL.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase (plpgsql
security definer), Vitest. Spec: `docs/superpowers/specs/2026-07-23-receita-integracao-design.md`.

## Global Constraints
- Branch `feat/shopfloor-lancamento`. TS strict (`noUncheckedIndexedAccess`). Tailwind v4 + @base-ui.
- **Adoção gradual:** OP sem receita = comportamento atual (qualquer PMO). Nunca quebrar OPs/histórico.
- **Whitelist só de PMO** — sem quantidade, sem exigir lista completa. Comparação **case-insensitive**.
- **Sem overload de função:** `sf_integrar` mantém a MESMA assinatura → `create or replace` puro (sem `drop`).
- Migrações só no **Dev** (`supabase db push`); nada vai pra Prod aqui.
- Leituras potencialmente grandes paginam com `.range()` (não se aplica às leituras deste plano — todas pequenas).
- Toda regra nova atualiza `docs/regras-de-negocio-shopfloor.md` na mesma entrega.
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (heredoc).
- Verificação por task: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure
- Create: `src/modules/shopfloor/domain/receita.ts` + `__tests__/receita.test.ts`
- Create: `supabase/migrations/0034_sf_ordem_componentes.sql`
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (CRUD da receita + joins)
- Modify: `src/modules/shopfloor/application/ordens-actions.ts` (ler/persistir componentes)
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx` (UI da receita + puxar carrega)
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx` (passa `pmosExistentes` + componentes)
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts` (`OrdemLancamentoLista.componentes`)
- Modify: `src/modules/shopfloor/infra/integracao-repository.ts` (tipo de retorno += `pmo`)
- Modify: `src/app/(app)/shopfloor/integracao/integracao-form.tsx` (restringe dropdown + aviso)
- Modify: `src/modules/shopfloor/application/integracao-actions.ts` (mensagem PLACA_FORA_DA_RECEITA)
- Modify: `docs/regras-de-negocio-shopfloor.md` (seção Integração + remove item do backlog)

---

### Task 1: Domínio `receitaPermite` (TDD)

**Files:** Create `src/modules/shopfloor/domain/receita.ts` + `src/modules/shopfloor/domain/__tests__/receita.test.ts`

**Interfaces:**
- Produces: `receitaPermite(receita: string[], placaPmo: string): boolean`

- [ ] **Step 1: Teste (falha)** — `src/modules/shopfloor/domain/__tests__/receita.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { receitaPermite } from '../receita'

describe('receitaPermite', () => {
  it('receita vazia libera qualquer PMO', () => {
    expect(receitaPermite([], 'PMO21')).toBe(true)
  })
  it('permite PMO na receita e barra fora dela', () => {
    expect(receitaPermite(['PMO21', 'PMO22'], 'PMO21')).toBe(true)
    expect(receitaPermite(['PMO21', 'PMO22'], 'PMO99')).toBe(false)
  })
  it('compara sem diferenciar maiúsculas/minúsculas e espaços', () => {
    expect(receitaPermite([' pmo21 '], 'PMO21')).toBe(true)
    expect(receitaPermite(['PMO21'], 'pmo21')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/modules/shopfloor/domain/__tests__/receita.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** — `src/modules/shopfloor/domain/receita.ts`:

```ts
/** Receita vazia libera qualquer PMO; senão a PMO da placa precisa estar na receita
 * (comparação case-insensitive, ignorando espaços nas pontas). */
export function receitaPermite(receita: string[], placaPmo: string): boolean {
  if (receita.length === 0) return true
  const alvo = placaPmo.trim().toLowerCase()
  return receita.some((r) => r.trim().toLowerCase() === alvo)
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS. Depois `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/receita.ts src/modules/shopfloor/domain/__tests__/receita.test.ts
git commit -F - <<'EOF'
feat(shopfloor): domínio receitaPermite (whitelist de PMO na Integração) TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Migração `0034` — tabela + guarda no `sf_integrar`

**Files:** Create `supabase/migrations/0034_sf_ordem_componentes.sql`

**Interfaces:**
- Consumes: `sf_ordens`, `sf_integrar` (assinatura de `0032`), `tem_permissao`.
- Produces: tabela `sf_ordem_componentes`; `sf_integrar` que retorna `{ok:false, erro:'PLACA_FORA_DA_RECEITA', pmo:<pmo>}` quando uma placa está fora de uma receita não-vazia.

- [ ] **Step 1: Escrever a migração** — conteúdo integral de `supabase/migrations/0034_sf_ordem_componentes.sql`:

```sql
-- =============================================================
-- ShopFloor Processo — Receita de Integração (BOM por PMO).
-- Tabela sf_ordem_componentes (receita efetiva por OP) + guarda
-- opcional no sf_integrar. Receita vazia = sem restrição.
-- =============================================================

create table public.sf_ordem_componentes (
  ordem_id       uuid not null references public.sf_ordens(id) on delete cascade,
  pmo_componente text not null,
  primary key (ordem_id, pmo_componente)
);
alter table public.sf_ordem_componentes enable row level security;
create policy sf_ordem_componentes_select on public.sf_ordem_componentes
  for select using (tem_permissao('visualizar'));
create policy sf_ordem_componentes_admin on public.sf_ordem_componentes
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- sf_integrar: + guarda de receita (mesma assinatura → replace puro) ----------
create or replace function public.sf_integrar(
  p_colaborador     text,
  p_cliente         text,
  p_pmo             text,
  p_op              text,
  p_produto_sn      text,
  p_produto_sn_norm text,
  p_placas          jsonb   -- [{pmo,op,sn,sn_norm}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_id     uuid;
  v_placa_dup text;
  v_cod_dup   text;
  v_ordem_id  uuid;
  v_receita   text[];
  v_placa_fora text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  -- produto já integrado (ATIVA)?
  select codigo into v_codigo
  from sf_integracoes
  where produto_sn_norm = p_produto_sn_norm and status = 'ATIVA'
  limit 1;
  if v_codigo is not null then
    return jsonb_build_object('ok', false, 'erro', 'PRODUTO_JA_INTEGRADO', 'codigo', v_codigo);
  end if;

  -- alguma placa já vinculada a integração ATIVA?
  select i.placa_sn, g.codigo into v_placa_dup, v_cod_dup
  from sf_integracao_itens i
  join sf_integracoes g on g.id = i.integracao_id and g.status = 'ATIVA'
  where i.placa_sn_norm in (select x->>'sn_norm' from jsonb_array_elements(p_placas) x)
  limit 1;
  if v_placa_dup is not null then
    return jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', v_placa_dup, 'codigo', v_cod_dup);
  end if;

  -- receita (BOM por PMO): se a OP tem receita, placa de PMO fora dela barra
  select id into v_ordem_id from sf_ordens where pmo = p_pmo and op = p_op limit 1;
  if v_ordem_id is not null then
    select array_agg(lower(trim(pmo_componente))) into v_receita
    from sf_ordem_componentes where ordem_id = v_ordem_id;
    if v_receita is not null and array_length(v_receita, 1) > 0 then
      select x->>'pmo' into v_placa_fora
      from jsonb_array_elements(p_placas) x
      where lower(trim(coalesce(x->>'pmo',''))) <> all (v_receita)
      limit 1;
      if v_placa_fora is not null then
        return jsonb_build_object('ok', false, 'erro', 'PLACA_FORA_DA_RECEITA', 'pmo', v_placa_fora);
      end if;
    end if;
  end if;

  v_codigo := 'INT-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
              upper(substr(md5(random()::text), 1, 4));

  insert into sf_integracoes (codigo, colaborador, cliente, pmo, op, produto_sn, produto_sn_norm, qtd_placas)
  values (v_codigo, p_colaborador, p_cliente, p_pmo, p_op, p_produto_sn, p_produto_sn_norm,
          coalesce(jsonb_array_length(p_placas), 0))
  returning id into v_id;

  insert into sf_integracao_itens (integracao_id, placa_pmo, placa_op, placa_sn, placa_sn_norm)
  select v_id, coalesce(x->>'pmo',''), coalesce(x->>'op',''), x->>'sn', x->>'sn_norm'
  from jsonb_array_elements(p_placas) x;

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, 'Integração', p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, 'Integração', coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
```

- [ ] **Step 2: Aplicar no Dev** — `SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" supabase db push` (confirmar que aplica só `0034`).

- [ ] **Step 3: Smoke SQL no Dev** — via REST/service (script em arquivo no scratchpad, lê `.env.local`): (a) tabela existe e aceita insert (ordem_id de uma OP com Integração, `pmo_componente='PMO_TESTE'`); (b) chamar `sf_integrar` com placa de PMO fora → `PLACA_FORA_DA_RECEITA`; (c) limpar o insert de teste. Registrar o resultado no report.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0034_sf_ordem_componentes.sql
git commit -F - <<'EOF'
feat(shopfloor): migração 0034 — sf_ordem_componentes + guarda de receita no sf_integrar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Cadastro de OP — persistir e editar a receita

**Files:**
- Modify `src/modules/shopfloor/infra/ordem-repository.ts`
- Modify `src/modules/shopfloor/application/ordens-actions.ts`
- Modify `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
- Modify `src/app/(app)/shopfloor/ordens/page.tsx`

**Interfaces:**
- Consumes: `sf_ordem_componentes` (Task 2).
- Produces: `criarOrdem(dados, postos, componentes)`, `atualizarOrdem(id, dados, postos, componentes)`;
  `OrdemRow.sf_ordem_componentes`, `listarFluxos()` retornando `componentes`; `OrdemView.componentes`,
  `FluxoExistente.componentes`; prop `pmosExistentes` no `OrdemForm`.

- [ ] **Step 1: Repositório** — em `ordem-repository.ts`:

`OrdemRow` (após `sf_ordem_postos`):
```ts
  sf_ordem_postos: { posto: string; ordem: number }[]
  sf_ordem_componentes: { pmo_componente: string }[]
```

`listarOrdens` — trocar o `.select(...)`:
```ts
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)')
```

`criarOrdem` — nova assinatura e escrita da receita:
```ts
export async function criarOrdem(dados: DadosOrdem, postos: string[], componentes: string[]): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').insert(dados).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (postos.length > 0) {
    const { error: e2 } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (e2) throw e2
  }
  if (componentes.length > 0) {
    const { error: e3 } = await supabase
      .from('sf_ordem_componentes')
      .insert(componentes.map((pmo_componente) => ({ ordem_id: id, pmo_componente })))
    if (e3) throw e3
  }
  return id
}
```

`atualizarOrdem` — nova assinatura e ressincronização da receita (após a reinserção dos postos):
```ts
export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[], componentes: string[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_ordens')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  const { error: eDel } = await supabase.from('sf_ordem_postos').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (postos.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (eIns) throw eIns
  }
  const { error: eDelC } = await supabase.from('sf_ordem_componentes').delete().eq('ordem_id', id)
  if (eDelC) throw eDelC
  if (componentes.length > 0) {
    const { error: eInsC } = await supabase
      .from('sf_ordem_componentes')
      .insert(componentes.map((pmo_componente) => ({ ordem_id: id, pmo_componente })))
    if (eInsC) throw eInsC
  }
}
```

`listarFluxos` — incluir componentes:
```ts
export async function listarFluxos(): Promise<{ pmo: string; op: string; postos: string[]; componentes: string[] }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)')
    .order('pmo')
    .order('op')
  if (error) throw error
  const linhas = data as unknown as {
    pmo: string
    op: string
    sf_ordem_postos: { posto: string; ordem: number }[]
    sf_ordem_componentes: { pmo_componente: string }[]
  }[]
  return linhas.map((l) => ({
    pmo: l.pmo,
    op: l.op,
    postos: [...l.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
    componentes: l.sf_ordem_componentes.map((c) => c.pmo_componente),
  }))
}
```

- [ ] **Step 2: Actions** — em `ordens-actions.ts`, adicionar o parser e passar adiante.

Novo helper (após `lerPostos`):
```ts
/** Componentes (receita) enviados pelo form (campo `componentes` = JSON de strings). */
function lerComponentes(fd: FormData): string[] {
  let bruto: unknown
  try {
    bruto = JSON.parse(String(fd.get('componentes') ?? '[]'))
  } catch {
    return []
  }
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const item of bruto) {
    const v = String(item).trim()
    if (v !== '' && !vistos.has(v.toLowerCase())) {
      vistos.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}
```

Em `criarOrdemAction`, após `const postos = await lerPostos(formData)`:
```ts
  const componentes = postos.includes('Integração') ? lerComponentes(formData) : []
```
e trocar a chamada: `id = await criarOrdem(dados, postos, componentes)`.

Em `editarOrdemAction`, idem após `const postos = await lerPostos(formData)`:
```ts
  const componentes = postos.includes('Integração') ? lerComponentes(formData) : []
```
e `await atualizarOrdem(id, dados, postos, componentes)`.

- [ ] **Step 3: Form** — em `ordem-form.tsx`:

`OrdemView` e `FluxoExistente` ganham `componentes: string[]`:
```ts
export interface OrdemView {
  // …campos existentes…
  postos: string[]
  componentes: string[]
}

export interface FluxoExistente {
  pmo: string
  op: string
  postos: string[]
  componentes: string[]
}
```

Assinatura do componente ganha `pmosExistentes`:
```ts
export function OrdemForm({
  postos,
  ordem,
  fluxosExistentes,
  pmosExistentes,
}: {
  postos: string[]
  ordem?: OrdemView
  fluxosExistentes: FluxoExistente[]
  pmosExistentes: string[]
}) {
```

Novo estado (após `const [fluxo, setFluxo] = ...`):
```ts
  const [receita, setReceita] = useState<string[]>(ordem?.componentes ?? [])
```

Importar `useMemo` no topo: `import { useActionState, useMemo, useState } from 'react'`.

O "Puxar fluxo" passa a carregar a receita — trocar o `onValueChange` (linha ~159):
```tsx
                <Select value="" onValueChange={(op) => {
                  const fonte = fontes.find((f) => f.op === op)
                  if (fonte) { setFluxo(fonte.postos); setReceita(fonte.componentes) }
                }}>
```

Hidden input da receita — logo após o hidden `fluxo` (linha ~105):
```tsx
          <input type="hidden" name="componentes" value={JSON.stringify(fluxo.includes('Integração') ? receita : [])} />
```

Seção da receita — inserir **depois** do bloco `{/* Fluxo de postos */}` inteiro (após a `</div>` que fecha ele, ~linha 212) e **antes** de `{state && !state.ok && ...}`:
```tsx
          {/* Receita da Integração (só quando Integração está no fluxo) */}
          {fluxo.includes('Integração') && (
            <ReceitaIntegracao
              receita={receita}
              setReceita={setReceita}
              pmosDisponiveis={pmosExistentes.filter((p) => p !== pmo && !receita.includes(p))}
            />
          )}
```

Novo subcomponente no fim do arquivo (fora de `OrdemForm`):
```tsx
function ReceitaIntegracao({
  receita,
  setReceita,
  pmosDisponiveis,
}: {
  receita: string[]
  setReceita: (r: string[]) => void
  pmosDisponiveis: string[]
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        Receita da Integração{' '}
        <span className="font-normal text-muted-foreground">· PMOs de placa que compõem este produto</span>
      </p>
      {receita.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {receita.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-xs">
              {c}
              <button type="button" aria-label={`Remover ${c}`} onClick={() => setReceita(receita.filter((x) => x !== c))} className="text-muted-foreground hover:text-red-600">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">Sem receita: a Integração aceita placas de qualquer PMO.</p>
      )}
      {pmosDisponiveis.length > 0 && (
        <Select value="" onValueChange={(p) => p && setReceita([...receita, p])}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="+ Adicionar PMO à receita" />
          </SelectTrigger>
          <SelectContent>
            {pmosDisponiveis.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Página** — em `ordens/page.tsx`:

No `views` (map), adicionar `componentes`:
```ts
    postos: [...o.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((x) => x.posto),
    componentes: o.sf_ordem_componentes.map((c) => c.pmo_componente),
```

Calcular `pmosExistentes` (após montar `views`):
```ts
  const pmosExistentes = [...new Set(ordens.map((o) => o.pmo))].sort()
```

Passar a prop nas DUAS usagens de `<OrdemForm ...>`:
```tsx
        <OrdemForm postos={chavesPostos} fluxosExistentes={fluxos} pmosExistentes={pmosExistentes} />
```
```tsx
                    <OrdemForm postos={chavesPostos} ordem={o} fluxosExistentes={fluxos} pmosExistentes={pmosExistentes} />
```

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`.

```bash
git add src/modules/shopfloor/infra/ordem-repository.ts src/modules/shopfloor/application/ordens-actions.ts "src/app/(app)/shopfloor/ordens/ordem-form.tsx" "src/app/(app)/shopfloor/ordens/page.tsx"
git commit -F - <<'EOF'
feat(shopfloor): receita da Integração no Cadastro de OP (+ Puxar fluxo carrega a receita)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Integração — esconder PMO fora da receita + mensagem + regras

**Files:**
- Modify `src/modules/shopfloor/infra/lancamento-repository.ts`
- Modify `src/modules/shopfloor/infra/integracao-repository.ts`
- Modify `src/app/(app)/shopfloor/integracao/integracao-form.tsx`
- Modify `src/modules/shopfloor/application/integracao-actions.ts`
- Modify `docs/regras-de-negocio-shopfloor.md`

**Interfaces:**
- Consumes: `OrdemLancamentoLista` + Task 2 (`PLACA_FORA_DA_RECEITA`).
- Produces: `OrdemLancamentoLista.componentes`; dropdown de PMO da placa restrito; mensagem PT-BR.

- [ ] **Step 1: Repositório de lançamento** — em `lancamento-repository.ts`:

`OrdemLancamentoLista` (após `postos`):
```ts
export interface OrdemLancamentoLista {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
  componentes: string[]
}
```

`listarOrdensParaLancamento` — join + map:
```ts
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)')
```
No cast do `rows`, adicionar `sf_ordem_componentes: { pmo_componente: string }[]`; no `.map`, adicionar:
```ts
    componentes: r.sf_ordem_componentes.map((c) => c.pmo_componente),
```

- [ ] **Step 2: Tipo de retorno do RPC** — em `integracao-repository.ts`, achar o tipo de retorno de `chamarSfIntegrar` (algo como `{ ok: boolean; erro?: string; codigo?: string; placa?: string }`) e adicionar `pmo?: string`.

- [ ] **Step 3: Form da Integração** — em `integracao-form.tsx`, substituir o cálculo de `pmosPlaca` (linha ~67) por uma versão que respeita a receita da OP selecionada:

```tsx
  // Placas: por padrão qualquer PMO; se o produto tem receita, só as PMOs dela.
  const todasPmos = useMemo(() => [...new Set(ordens.map((o) => o.pmo))], [ordens])
  const pmosPlaca = useMemo(() => {
    const receita = ordemSel?.componentes ?? []
    if (receita.length === 0) return todasPmos
    const permitidas = new Set(receita.map((r) => r.toLowerCase()))
    return todasPmos.filter((p) => permitidas.has(p.toLowerCase()))
  }, [ordemSel, todasPmos])
```

Ao trocar o produto, limpar placas com PMO agora não-permitida — no `mudarPmo`/`mudarCliente`/quando muda `op`, o mais simples é resetar as placas ao mudar a OP do produto. Trocar `function mudarPmo` e `mudarCliente` para também `setPlacas([{ ...LINHA_VAZIA }])`, e no `Select` da OP do produto (o que faz `setOp`) resetar placas. Concretamente, criar:
```tsx
  function mudarOpProduto(v: string) {
    setOp(v ?? '')
    setPlacas([{ ...LINHA_VAZIA }])
  }
```
e usar `onValueChange={(v) => mudarOpProduto(v)}` no Select da OP do produto (hoje ele faz `setOp`). Em `mudarCliente` e `mudarPmo`, acrescentar `setPlacas([{ ...LINHA_VAZIA }])`.

Aviso da receita — logo abaixo do cabeçalho "Placas" (perto da linha ~190), condicional:
```tsx
            {(ordemSel?.componentes?.length ?? 0) > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                Este produto aceita apenas placas das PMOs: {ordemSel!.componentes.join(', ')}.
              </p>
            )}
```

- [ ] **Step 4: Mensagem na action** — em `integracao-actions.ts`, dentro do `if (!r.ok) { ... }` do `integrar`, adicionar antes do `return` genérico:
```ts
    if (r.erro === 'PLACA_FORA_DA_RECEITA') {
      return { ok: false, erro: `A placa de PMO ${r.pmo ?? ''} não faz parte da receita deste produto.` }
    }
```

- [ ] **Step 5: Regras** — em `docs/regras-de-negocio-shopfloor.md`:
  - Na seção **Regras da Integração**, adicionar item: *"Receita (BOM por PMO): a OP do produto pode
    ter uma lista de PMOs de placa permitidas (cadastrada no fluxo, só quando Integração está no
    fluxo; reaproveitada pelo Puxar fluxo). **Vazia = qualquer PMO.** Definida = a Integração só
    oferece/aceita placas dessas PMOs (dropdown esconde; `sf_integrar` barra `PLACA_FORA_DA_RECEITA`
    como rede de segurança). Só restringe QUAIS PMOs — sem quantidade nem exigir a lista completa."*
  - Na seção **Regras do Cadastro de OP**, citar a receita como parte do fluxo.
  - No mapa de "Onde as regras vivem", citar `domain/receita.ts` e `sf_ordem_componentes`
    (migração `0034`).
  - **Remover** do backlog o item "Integração — placas restritas à PMO 'mãe' (BOM)" (entregue).

- [ ] **Step 6: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`.

```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts src/modules/shopfloor/infra/integracao-repository.ts "src/app/(app)/shopfloor/integracao/integracao-form.tsx" src/modules/shopfloor/application/integracao-actions.ts docs/regras-de-negocio-shopfloor.md
git commit -F - <<'EOF'
feat(shopfloor): Integração respeita a receita (esconde PMO fora + rede de segurança)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5 (controller): suíte + review amplo + smoke no Dev + push

- Rodar `npx tsc --noEmit && npm run lint && npm run test` no conjunto final.
- Smoke no Dev (script em arquivo, lê `.env.local`): criar OP temporária com Integração + receita
  `{PMOx}`; `sf_integrar` com placa de PMO fora → `PLACA_FORA_DA_RECEITA`; com PMO da receita →
  ok; OP sem receita → aceita qualquer. Limpar os dados de teste ao fim.
- Review amplo (opus) da branch desde a base da feature.
- Push da branch para o preview.

## Self-Review (checagem do autor)
- **Cobertura da spec:** tabela (T2) ✅, domínio (T1) ✅, cadastro+puxar (T3) ✅, esconder+servidor+msg
  (T4) ✅, adoção gradual (receita vazia) ✅ em T2/T4, whitelist case-insensitive ✅ T1+T2.
- **Sem overload:** `sf_integrar` mantém os 7 params → `create or replace` (T2). ✅
- **Consistência de tipos:** `componentes: string[]` propagado em OrdemRow→OrdemView/FluxoExistente
  (T3) e OrdemLancamentoLista (T4); `criarOrdem/atualizarOrdem` com o 3º parâmetro em repo+actions.
- **Sem placeholders:** todos os steps têm código real.
