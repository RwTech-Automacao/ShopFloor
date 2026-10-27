# Placas por painel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma OP pode declarar `placas_por_painel` (N, default 1); cada bipe (um painel) passa a contar como N placas em progresso/finalização, caixa, NQA, Almoxarifado/Compels, Dashboard, Fluxo e Pesquisa.

**Architecture:** `sf_ordens.placas_por_painel` + `sf_registros.pecas` preenchida por trigger `BEFORE INSERT` (resolve pela OP da linha). As contagens atuais de "peças distintas" (`count(distinct sn)`) passam a somar `pecas` **uma vez por SN**. Eventos e razões (% de aprovação, ocorrências de defeito, existência) não mudam. Uma migração aditiva por tarefa SQL.

**Tech Stack:** Postgres 15 (migrações em `supabase/migrations/`, testes em Docker em `supabase/tests/`), Next.js 16 App Router (server actions), TypeScript, Vitest (`--maxWorkers=2`).

**Spec:** `docs/superpowers/specs/2026-10-27-placas-por-painel-design.md` (leia primeiro).

## Global Constraints

- **Linha de `sf_registros` ≠ bipe.** Defeitos, reparo, rebipe e reteste repetem o SN. NUNCA `sum(pecas)` direto sobre as linhas. Regra única de conversão (`count(distinct sn)` → peças):
  ```sql
  -- antes:  count(distinct r.numero_serie_norm)
  -- depois: coalesce(sum(u.pecas), 0)
  --         from (select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.pecas
  --               from <MESMO from/where de antes> order by r.numero_serie_norm, r.data_hora desc) u
  ```
  Em agregações com `group by`, aplique a dedup por SN dentro do mesmo grupo (subquery por grupo ou CTE `distinct on (grupo, sn)`).
- Com N = 1 (toda OP existente) o resultado tem de ser **idêntico** ao atual. Todo teste SQL cobre N=1 e N=50.
- Eventos/razões ficam por bipe (não mudam): % de aprovação, passou/reprovou, ocorrências de defeito (`sf_defeitos_resumo`, `alerta_defeitos`), `alerta_taxas`, `alerta_tempos`, existência, `sf_almox_caixa_pendentes` (só `= 0`).
- `sf_ordens.qtd` fica **em placas**. `sn_ini`/`sn_fim` ficam **em painéis** (1 SN = 1 painel = 1 etiqueta).
- Limite da caixa digitado **em placas**. Painel que estoura o limite é recusado: "Este painel (N placas) ultrapassa o limite da caixa (X/Y)."
- Painel é sempre completo (N placas); sem painel parcial.
- Migrações: aditivas e idempotentes, `$func$`, numeradas a partir de `0161` (a branch estacionada `feat/ajustar-limite-caixa` também usa 0161; renumerar a que mergear depois). Cada função reescrita copia a **definição vigente** (migração de maior número, listada por tarefa) e só troca a contagem.
- `tem_permissao` sempre com 2 argumentos. Decisão por perfil, nunca por nome de posto. Não normalizar sufixo `_` de OP.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Vitest sempre com `--maxWorkers=2`. Nada vai a Prod nem Dev sem aval do usuário.
- Mensagens de UI em PT-BR.

---

### Task 1: Fundação — colunas, trigger, cadastro da OP

**Files:**
- Create: `supabase/migrations/0161_placas_por_painel.sql`
- Create: `supabase/tests/placas_painel_esquema.sql`, `supabase/tests/placas_painel_test.sql`, `supabase/tests/rodar-placas-painel-test.sh`
- Create: `src/modules/shopfloor/domain/placas-por-painel.ts`, `src/modules/shopfloor/domain/__tests__/placas-por-painel.test.ts`
- Modify: `src/modules/shopfloor/domain/validar-ordem.ts` (+ teste existente em `domain/__tests__/`)
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (`OrdemRow`, `DadosOrdem`, select de `listarOrdens`)
- Modify: `src/modules/shopfloor/application/ordens-actions.ts` (`lerDados`, chamadas a `validarOrdem`)
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx` e `page.tsx` se repassar campos
- Test: `src/app/(app)/shopfloor/ordens/__tests__/placas-por-painel-form.test.tsx`

**Interfaces:**
- Produces (SQL): `sf_ordens.placas_por_painel int`, `sf_registros.pecas int`, trigger `sf_registros_pecas`.
- Produces (TS): `placasDosPaineis(paineis: number, placasPorPainel: number): number`, `paineisDasPlacas(placas: number, placasPorPainel: number): number | null` (null se `placas % placasPorPainel !== 0`); `OrdemRow.placas_por_painel: number`, `DadosOrdem.placas_por_painel: number`.

- [ ] **Step 1: Teste SQL (falha)** — `placas_painel_esquema.sql` cria tabelas mínimas `sf_ordens(id, pmo, op, qtd)` e `sf_registros(id, pmo, op, numero_serie_norm, data_hora default now())`. `placas_painel_test.sql`:

```sql
-- OP com N=50, OP sem N (default), registro sem OP cadastrada
insert into sf_ordens (pmo, op, qtd) values ('PMOT01','1', 5000), ('PMOT02','2', 100);
update sf_ordens set placas_por_painel = 50 where pmo = 'PMOT01';
insert into sf_registros (pmo, op, numero_serie_norm) values
  ('PMOT01','1','A1'), ('PMOT02','2','B1'), ('PMOX99','9','C1');
do $$
begin
  assert (select pecas from sf_registros where numero_serie_norm='A1') = 50, 'N=50 deveria gravar 50';
  assert (select pecas from sf_registros where numero_serie_norm='B1') = 1,  'default 1';
  assert (select pecas from sf_registros where numero_serie_norm='C1') = 1,  'sem OP cadastrada = 1';
  -- editar N depois NÃO reescreve o histórico
  update sf_ordens set placas_por_painel = 10 where pmo='PMOT01';
  assert (select pecas from sf_registros where numero_serie_norm='A1') = 50, 'histórico intacto';
  insert into sf_registros (pmo, op, numero_serie_norm) values ('PMOT01','1','A2');
  assert (select pecas from sf_registros where numero_serie_norm='A2') = 10, 'novo bipe usa N atual';
  -- N inválido recusado
  begin
    update sf_ordens set placas_por_painel = 0 where pmo='PMOT02';
    assert false, 'deveria recusar 0';
  exception when check_violation then null; end;
end $$;
```
`rodar-placas-painel-test.sh`: copie `supabase/tests/rodar-finalizacao-test.sh` trocando nome do container, os `docker cp` (esquema, `0161_placas_por_painel.sql`, teste) e aplicando a 0161 **duas vezes** (idempotência); termina com `echo "PLACAS PAINEL SQL OK"`.

- [ ] **Step 2:** `bash supabase/tests/rodar-placas-painel-test.sh` → FAIL (migração inexistente).

- [ ] **Step 3: Migração**

```sql
-- 0161: placas por painel. Peso do bipe gravado em sf_registros.pecas pelo trigger.
alter table public.sf_ordens
  add column if not exists placas_por_painel int not null default 1;
alter table public.sf_ordens drop constraint if exists sf_ordens_placas_por_painel_ck;
alter table public.sf_ordens
  add constraint sf_ordens_placas_por_painel_ck check (placas_por_painel >= 1);

alter table public.sf_registros
  add column if not exists pecas int not null default 1;
alter table public.sf_registros drop constraint if exists sf_registros_pecas_ck;
alter table public.sf_registros
  add constraint sf_registros_pecas_ck check (pecas >= 1);

create or replace function public.sf_registros_definir_pecas()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  new.pecas := coalesce(
    (select o.placas_por_painel from public.sf_ordens o where o.pmo = new.pmo and o.op = new.op),
    1);
  return new;
end
$func$;

drop trigger if exists sf_registros_pecas on public.sf_registros;
create trigger sf_registros_pecas before insert on public.sf_registros
  for each row execute function public.sf_registros_definir_pecas();

notify pgrst, 'reload schema';
```
No teste, adicione as constraints ao esquema ou aplique-as pela própria migração (a migração as cria; o esquema só tem as colunas base).

- [ ] **Step 4:** rodar o script → `PLACAS PAINEL SQL OK`.

- [ ] **Step 5: Teste do domínio (falha)** `placas-por-painel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { placasDosPaineis, paineisDasPlacas } from '../placas-por-painel'

describe('placas por painel', () => {
  it('multiplica painéis por placas', () => expect(placasDosPaineis(100, 50)).toBe(5000))
  it('divide placas em painéis exatos', () => expect(paineisDasPlacas(5000, 50)).toBe(100))
  it('null quando não divide exato', () => expect(paineisDasPlacas(5001, 50)).toBeNull())
  it('N=1 é identidade', () => {
    expect(placasDosPaineis(7, 1)).toBe(7)
    expect(paineisDasPlacas(7, 1)).toBe(7)
  })
})
```
Implementação em `domain/placas-por-painel.ts` (funções puras, retornos conforme Interfaces). Rode `npx vitest run src/modules/shopfloor/domain/__tests__/placas-por-painel.test.ts --maxWorkers=2` (falha → implemente → passa).

- [ ] **Step 6: Cadastro da OP.** Leia `ordem-form.tsx`, `ordens-actions.ts`, `validar-ordem.ts` e o teste vizinho `ordens-actions-finalizacao.test.ts`. Faça:
  - `validarOrdem` aceita `placasPorPainel?: number` e recusa não inteiro ou `< 1` com "Placas por painel deve ser um número inteiro maior ou igual a 1."; teste novo no arquivo de teste de `validar-ordem`.
  - `lerDados` lê `placas_por_painel` (`Number(fd.get('placas_por_painel') ?? 1) || 1`); `DadosOrdem`/`OrdemRow`/select de `listarOrdens` incluem `placas_por_painel`.
  - `ordem-form.tsx`: campo numérico "Placas por painel" (`name="placas_por_painel"`, `min=1`, padrão `ordem?.placas_por_painel ?? 1`, dica "Use quando a etiqueta é por painel: cada bipe conta como N placas."). Quando o valor for > 1, aparece o campo auxiliar "Painéis" (sem `name`, não é enviado): digitar painéis preenche o campo `qtd` com `placasDosPaineis(painéis, N)`; digitar `qtd` preenche painéis com `paineisDasPlacas` (vazio se não divide exato). `qtd` continua sendo o campo gravado, em placas.
  - Teste `placas-por-painel-form.test.tsx` (Testing Library, mesmo estilo de `aviso-reativacao.test.tsx` na mesma pasta): com N=50, digitar 100 em "Painéis" faz o campo Quantidade valer 5000; com N=1 o campo "Painéis" não aparece.

- [ ] **Step 7:** `npx vitest run src/modules/shopfloor src/app/\(app\)/shopfloor/ordens --maxWorkers=2` e `npx tsc --noEmit` → verdes.

- [ ] **Step 8: Commit**
```bash
git add supabase/migrations/0161_placas_por_painel.sql supabase/tests src/modules/shopfloor "src/app/(app)/shopfloor/ordens"
git commit -m "feat(shopfloor): placas por painel — colunas, trigger e cadastro da OP

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Progresso e finalização da OP

**Files:**
- Create: `supabase/migrations/0162_placas_progresso_op.sql`, `supabase/tests/placas_progresso_test.sql` (+ `rodar-placas-progresso-test.sh`, modelo: `rodar-finalizacao-test.sh`, aplicando 0121 real, 0161, 0162, 0145, 0148)
- Modify (TS): `src/modules/shopfloor/infra/lancamento-repository.ts:47-75` (`contarLancadosNoPosto`, que precisa selecionar `pecas` e somar por SN) e `:252-269` (`sf_ordem_resumo.concluidas`)

**Interfaces:**
- Consumes: Task 1 (`sf_registros.pecas`).
- Produces: `sf_ordem_resumo.concluidas` e `sf_ops_com_bipes.pct_conclusao` em **placas**.

**Funções vigentes a reescrever (copie a definição e só troque a contagem):**
| Objeto | Definição vigente | Troca |
|---|---|---|
| view `sf_ordem_resumo` | `0036:15-24` | `concluidas`: `count(distinct sn)` no posto final → peças (regra única) |
| `sf_ops_com_bipes` | `0121:17,30` | `pct_conclusao` (`feitas`/`o.qtd`): `feitas` em peças. `bipes` (`0121:17`) **fica `count(*)`**, é o rótulo "bipes" do Fluxo |
| `sf_sincronizar_finalizacao` | `0148:49-85` | não muda: usa `pct_conclusao >= 100` |

- [ ] **Step 1: Teste SQL (falha)**: OP N=50, `qtd=5000`, 100 SNs no posto final → `pct_conclusao = 100` e `concluidas = 5000`; OP N=50 com 50 SNs → 50%; mesma OP com o SN reprovado + rebipado (duas linhas do mesmo SN) conta 50 uma vez; OP N=1 (qtd=100, 100 SNs) segue 100%. Chame também `sf_sincronizar_finalizacao` e confirme finaliza em 100% e reabre abaixo.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migração 0162 com `create or replace` das duas definições (a view é recriada com `create or replace view` mantendo colunas e ordem).
- [ ] **Step 4:** rodar → OK. Em seguida, no TS, `contarLancadosNoPosto` passa a somar `pecas` por SN; teste Vitest com mock do supabase (padrão de `lancamento-repository` existente) cobrindo SN repetido e `pecas = 50`.
- [ ] **Step 5:** `npx vitest run src/modules/shopfloor --maxWorkers=2`, `npx tsc --noEmit`; commit `feat(shopfloor): progresso e finalização da OP em placas`.

---

### Task 3: Caixa e Embalagem

**Files:**
- Create: `supabase/migrations/0163_placas_caixa.sql`, `supabase/tests/placas_caixa_test.sql` (+ runner; modelo `rodar-almoxarifado-test.sh`; aplique a cadeia real que define `sf_lancar`/`sf_fechar_caixa`: 0100, 0103, e as dependências que o runner de caixa existente já aplique)
- Modify: `src/modules/shopfloor/infra/caixa-repository.ts` (`:96-105`, `:130-133`, `:173`, `:333-367`, `:420-494`), `src/modules/shopfloor/domain/caixa.ts` (`pecasAntesDaCaixa`, usa `qtd` em placas: já soma `qtd` das caixas; só confira que `qtd` das caixas passa a vir em placas), `src/modules/shopfloor/domain/regras-lancamento.ts:20-23` (`caixaCheia`)
- Modify: `src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx` (linhas ~201-222, 269, 304, 331, 367, 415-416: o `+1` otimista vira `+pecasDoBipe`), `embalagem-individual-panel.tsx:19,33,72`, `src/app/(app)/shopfloor/_components/folha-caixa.tsx:87-91`
- Test: `src/modules/shopfloor/domain/__tests__/regras-lancamento.test.ts`, `src/app/(app)/shopfloor/operar/lancamento/__tests__/embalagem-placas.test.tsx`

**Funções vigentes:**
| Objeto | Definição | Troca |
|---|---|---|
| `sf_fechar_caixa` | `0100:100` | `v_qtd` = peças da caixa (regra única) → `sf_caixas.qtd` e código `CX[seq][qtd]OP-PMO` em placas |
| `sf_lancar` limite | `0103:147-155` | recusa quando `outras + N > limite` (N = `pecas` da OP, vindo de `sf_ordens`); código `CAIXA_CHEIA`, mensagem "Este painel (N placas) ultrapassa o limite da caixa (X/Y)." |
| `sf_lancar` `caixa_count` | `0103:176-181` | peças da caixa (regra única) |

**Interfaces:**
- Produces: `caixaCheia(count: number, limite: number, pecasDoBipe = 1): boolean` — true quando `count + pecasDoBipe > limite`. Retorno de `sf_lancar` ganha `pecas` (N do bipe) para o painel mostrar "+N".

- [ ] **Step 1: testes SQL (falham):** OP N=50: limite 500; 10 painéis cabem, o 11º é recusado com `CAIXA_CHEIA`; `sf_fechar_caixa` grava `qtd=500` e código `CX[1][500]OP-PMO`; limite 520 (não múltiplo): o 11º painel (550) é recusado; OP N=1 idêntica ao atual.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migração 0163 (copiar definições vigentes; trocar o descrito).
- [ ] **Step 4:** rodar → OK.
- [ ] **Step 5: TS.** `caixa-repository.ts`: todas as contagens por SN (`Set<sn>.size`, `sns.length`, `exibicao.length`, `totalEmbaladas`) passam a selecionar `pecas` e somar **uma vez por SN**. Extraia **uma** função pura `somarPecasPorSn(linhas: {numero_serie_norm: string; pecas: number}[]): number` em `domain/caixa.ts` e use-a em todos esses pontos (DRY), com teste (SN repetido conta uma vez; `pecas=50` soma 50 por SN). `embalagem-panel.tsx`: contador otimista soma o `pecas` devolvido por `sf_lancar`; chip "+N" no painel de resultado quando N > 1.
- [ ] **Step 6:** testes do painel: com N=50, após um bipe o contador mostra 50/500; o 11º bipe mostra a mensagem de limite.
- [ ] **Step 7:** `npx vitest run src/modules/shopfloor "src/app/(app)/shopfloor" --maxWorkers=2`, `npx tsc --noEmit`; commit `feat(shopfloor): caixa e embalagem contam placas por painel`.

---

### Task 4: NQA e Almoxarifado / fila do Compels

**Files:**
- Create: `supabase/migrations/0164_placas_nqa_almoxarifado.sql`, `supabase/tests/placas_nqa_almox_test.sql` (+ runner; modelo `rodar-almoxarifado-test.sh`, cadeia real das migrações envolvidas)
- Modify: `src/modules/shopfloor/application/nqa-individual-actions.ts` (~linha 285, `{ qtd: snsNorm.length, amostra }`), `src/modules/shopfloor/application/nqa-gravou.ts:26-45`, `src/modules/shopfloor/infra/cancelamento-repository.ts:72-77,111-116`, `src/modules/shopfloor/domain/almoxarifado.ts:50-53`, painéis `nqa-individual-panel.tsx`, `nqa-caixa-panel.tsx`, `almoxarifado-panel.tsx` (exibem `quantidade`/`pecas`/`lote.qtd` vindos das RPCs; ajustar `snsLote.length` do NQA individual para soma de `pecas`)

**Funções vigentes (copie e troque só a contagem):**
| Objeto | Definição | Troca |
|---|---|---|
| `sf_nqa_caixa` | `0160:78-80,113-118,208` | `v_total` em peças → amostra e `total` |
| `sf_nqa_individual` | `0097:47-59` | `v_total` em peças; duplicidade e "SN da OP" seguem por SN |
| `sf_almox_necessidades.pecas` | `0155:602-603` | peças (regra única) |
| `sf_almoxarifado_entrada` | `0156:370-375, 451-461, 565-575` | texto "N de M peças" em peças; `v_quantidade` da caixa = soma de `pecas` das linhas inseridas (não `row_count`); peça avulsa: `v_quantidade := pecas` do bipe (não `1`) |
| `sf_almox_lotes` | `0156:813,831` | `n`/`pecas`/`lanc` em peças |
| `sf_almoxarifado_lote` | `0156:920-947, 1005-1020` | contagens e `quantidade` de `sf_estoque_envios` em peças |
| `sf_cancelar_lancamento` | `0156:698-715,756` | `sf_estoque_reverter(..., 1)` → `(..., <pecas da linha cancelada>)` |
| `sf_cancelar_lote_almoxarifado` | `0156:1052-1105` | retorno `canceladas` = soma de `pecas` das linhas removidas |
| `sf_cancelar_caixa_almoxarifado` | `0131:160-182` | idem |
| `sf_almox_pendencias` / `sf_almox_detalhe` | `0158` / `0159:58-61,81,113-118` | `pecas`, `recebidas_op`, cardinalidades em peças |
| `sf_almox_caixa_pendentes` | `0155:108-114` | **não muda** (só `= 0`) |

Obs.: o comentário `0156:~498` ("sf_registros não tem coluna de quantidade e não deve ganhar uma") fica desatualizado: reescreva-o na nova definição.

- [ ] **Step 1: testes SQL (falham):** OP N=50 com caixa de 10 painéis → entrada no Almoxarifado grava `sf_estoque_envios.quantidade = 500`; peça avulsa grava 50; cancelar entrada de caixa devolve 500 e reverte 500; lote NQA de 4 painéis tem `total = 200` e amostra calculada sobre 200; N=1 idêntico ao atual.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** migração 0164. **Step 4:** rodar → OK.
- [ ] **Step 5: TS** conforme a lista de arquivos; testes Vitest que mockam as RPCs e conferem que `almoxarifado.ts` envia `quantidade` vinda do RPC (não `1` fixo) e que o NQA individual usa a soma de `pecas`.
- [ ] **Step 6:** `npx vitest run src/modules/shopfloor "src/app/(app)" --maxWorkers=2`, `npx tsc --noEmit`; commit `feat(shopfloor): NQA e Almoxarifado em placas por painel`.

---

### Task 5: Dashboard, Fluxo, Produção por período

**Files:**
- Create: `supabase/migrations/0165_placas_dashboard_fluxo.sql`, `supabase/tests/placas_dashboard_fluxo_test.sql` (+ runner)
- Modify: `src/modules/shopfloor/infra/dashboard-repository.ts:23-36` + `domain/dashboard.ts:14-28` (`listarContagemDaOp`/`contarPorPosto`: selecionar `pecas`, somar por SN), `src/modules/shopfloor/infra/fluxo-repository.ts:99,154-215,302-308`, componentes `dashboard-painel.tsx` (cartões de peças), `fluxo-form.tsx:348-355,766,775,948-958`

**Funções vigentes:**
| Objeto | Definição | Troca |
|---|---|---|
| `sf_dashboard_totais` | `0105` | `total`/`aprovado`/`reprovado` em peças (dedup por SN; fiel ao filtro de status atual). `bipes` e `ops` **não mudam** |
| `sf_dashboard_grade` | `0105` | `pecas`, `aprovados`, `reprovados`, `sem_status` por OP em peças |
| `sf_dashboard_graficos` | `0105` | `st`, `op_tot`, `op_st` **ficam por bipe** (o front rotula "bipes"); `tp`, `df`, `ps` ficam (ocorrências) |
| `sf_fluxo_op` | `0157:49,60-62,92-100` | `wip`, `passou_distinto`, `aprovados_primeira`, `reprovados_sem_reteste` em peças; `registros`/`aprovadas`/`reprovadas` em peças (são divisor de tempo-ciclo e "passagens"); `retestes` fica |
| `sf_fluxo_periodo` | `0090:23-25` | `registros`/`aprovadas`/`reprovadas` por posto em peças (uma vez por SN e posto no período — atenção: hoje é `count(*)` de linhas; preserve a semântica de linha por bipe aprovado/reprovado ao somar `pecas` apenas das linhas **não-defeito duplicadas**, isto é, deduplique pelo par (SN, `data_hora`) antes de somar) |
| `sf_producao_periodo` | `0093:35` | `qtd` por bucket em peças com a mesma dedup (SN, `data_hora`) |
| `sf_ops_com_bipes.bipes` | `0121:17` | não muda |
| `sf_defeitos_resumo`, `alerta_*` | — | não mudam |

- [ ] **Step 1: testes SQL (falham):** OP N=50 com 3 painéis aprovados (um com 2 linhas de defeito antes do reteste): `sf_dashboard_totais.total = 150` (3×50), `bipes` inalterado (conta linhas); `sf_producao_periodo.qtd = 150` no bucket; um painel reprovado com 3 linhas de defeito conta 50, não 150; `sf_fluxo_op.passou_distinto` em peças; N=1 idêntico.
- [ ] **Step 2–4:** rodar FAIL → migração 0165 → OK.
- [ ] **Step 5: TS:** `contarPorPosto` e `contarPendentesPorPosto` (`fluxo-repository.ts:154-215`) selecionam `pecas` e somam por SN; o gráfico de produção (`fluxo-form.tsx:348-355`) soma o `qtd` do RPC (já em peças). Testes Vitest de domínio (`dashboard.ts`, `fluxo-op.ts`) com SN repetido e `pecas=50`.
- [ ] **Step 6:** `npx vitest run src/modules/shopfloor "src/app/(app)/shopfloor" --maxWorkers=2`, `npx tsc --noEmit`; commit `feat(shopfloor): Dashboard e Fluxo em placas por painel`.

---

### Task 6: Telas que assumem "1 SN = 1 placa" (faixa de SN)

**Files:**
- Modify: `src/modules/shopfloor/infra/fluxo-repository.ts:99,245-258` (`naoIniciadas = qtd - iniciadas`, `snsNaoIniciados` por faixa), `src/modules/shopfloor/infra/pesquisa-repository.ts:60-86`, `src/modules/shopfloor/application/pesquisa-actions.ts:90-124`, `src/modules/shopfloor/domain/grade.ts:220-257` (`montarResumoPorPosto`: `pendentes = total_faixa − produzido`), `src/app/(app)/shopfloor/analisar/pesquisa/pesquisa-form.tsx:457`
- Test: `src/modules/shopfloor/domain/__tests__/grade.test.ts` (ou o teste existente de `montarResumoPorPosto`), teste do `fluxo-repository` existente

**Regra:** `qtd` e `produzido` estão em placas; a faixa de SN tem 1 SN por painel. Converta a faixa para placas multiplicando `totalFaixaSNs` por `placas_por_painel` da OP antes de subtrair (`pendentes = totalFaixaSNs * N − produzido`). Listas de SNs (pendentes/não iniciados) continuam listando **painéis** (1 SN = 1 etiqueta); apenas os totais exibidos em "peças" usam placas. Rótulo "N de M peça(s)" em `pesquisa-form.tsx:457` continua contando SNs e passa a dizer "painel(éis)" quando a OP tem N > 1.

- [ ] **Step 1: testes (falham):** `montarResumoPorPosto` com N=50, faixa de 100 SNs, 40 painéis produzidos: `produzido=2000`, `pendentes=3000`; N=1 igual ao atual.
- [ ] **Step 2–4:** FAIL → implementar (o repositório passa `placas_por_painel` da OP; leia-o junto de `qtd`) → PASS.
- [ ] **Step 5:** `npx vitest run src/modules/shopfloor "src/app/(app)/shopfloor" --maxWorkers=2`, `npx tsc --noEmit`; commit `feat(shopfloor): telas de faixa de SN consideram placas por painel`.

---

### Task 7: Verificação final e passagem para o usuário

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-placas-por-painel-design.md` (registrar o que mudou durante a implementação, se algo mudou)
- Create: `docs/operacao/placas-por-painel/00-ROTEIRO.md` (aplicar 0161–0165 uma a uma no RDS com `-1 -v ON_ERROR_STOP=1`, `lock_timeout=3s`, `docker compose restart rest`, `deploy.sh`; smoke: criar OP de teste com N=50 e conferir os números abaixo; rollback das colunas = ignorar, são aditivas)

- [ ] **Step 1:** rodar todos os runners SQL novos e os existentes de caixa/almoxarifado/finalização/fluxo (`supabase/tests/rodar-*.sh`) → todos "OK".
- [ ] **Step 2:** `npx vitest run --maxWorkers=2` e `npx tsc --noEmit` e `npm run lint` → verdes.
- [ ] **Step 3:** smoke guiado em Dev (com aval do usuário): OP N=50, `qtd=5000`: bipar 3 painéis → progresso 150/5000, caixa limite 500 mostra 150/500, 11º painel recusado, fechar a caixa gera `CX[1][500]…`, Almoxarifado mostra 500, Dashboard total 150.
- [ ] **Step 4:** commit `docs(operacao): roteiro de deploy de placas por painel`; apresentar ao usuário com `superpowers:finishing-a-development-branch`.
