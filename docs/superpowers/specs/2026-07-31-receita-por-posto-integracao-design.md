# Receita por posto de Integração — Design

> **Data:** 2026-07-31 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-ondas`
> **Tipo:** generalização (receita da Integração por posto, não por OP). **Precisa de migração no Dev.** Dev × Prod.
> Depende da feature "Integração vira posto" (já feita). Fecha a Integração pra **2+ postos de Integração por OP**.

## Contexto

A "Integração vira posto" foi feita com **receita por OP** (`sf_ordem_componentes(ordem_id, pmo_componente)` —
PK sem posto). No smoke, o usuário montou uma OP com **2 postos de recurso integracao** (ex.: "Teste Integração"
+ "Integração") e o Cadastro de OP mostra **uma** seção de receita — mas cada posto de Integração precisa da
**sua própria** receita (BOMs diferentes). Também: o `integrar` hoje resolve "o 1º posto integracao do fluxo"
(Minor do review) — com 2, precisa registrar contra **o posto selecionado**.

Hoje (por nome, name-tied): o form mostra a receita quando `fluxo.includes('Integração')`; `ordens-actions`
salva `componentes` quando `postos.includes('Integração')`; o RPC `sf_integrar` lê a receita `where ordem_id =
v_ordem_id`. Padrões de fluxo guardam `componentes: string[]` (jsonb).

## Objetivo

A receita passa a ser **por (OP, posto)**: cada posto de recurso integracao no fluxo tem sua receita própria;
o Cadastro de OP mostra uma seção por posto; a Integração (registro/checagem) usa a receita **do posto**.

## Escopo

**Dentro:**
- Migração: `sf_ordem_componentes` += `posto` (PK vira `(ordem_id, posto, pmo_componente)`); backfill p/ `Integração`.
- RPC `sf_integrar`: checagem de receita passa a filtrar por `p_posto`.
- App: receita vira `Record<posto, string[]>` (receitaPorPosto) em OrdemView/OrdemLancamentoLista + repo + form.
- Cadastro de OP: **uma seção de receita por posto de recurso integracao** (perfil-driven, não por nome).
- Lançamento/Painel: passa **o posto selecionado** + a receita **dele** ao painel; `resolverPlacaIntegracaoAction`
  e `integrar` recebem o **posto** (não "acha o 1º").
- Padrões de fluxo: `componentes` vira `Record<posto, string[]>` (jsonb objeto).

**Fora (confirmado):**
- Quantidade > 1 placa por PMO (segue Fase 2).
- Mudar o gate de sequência (continua por posto, já funciona).

## Design

### 1. Migração — `supabase/migrations/0065_receita_por_posto.sql`
```sql
-- Receita da Integração passa a ser por (OP, posto). Backfill: receitas existentes → posto 'Integração'.
alter table public.sf_ordem_componentes add column if not exists posto text not null default '';
update public.sf_ordem_componentes set posto = 'Integração' where posto = '';
-- troca a PK p/ incluir o posto (drop + add):
alter table public.sf_ordem_componentes drop constraint sf_ordem_componentes_pkey;
alter table public.sf_ordem_componentes add primary key (ordem_id, posto, pmo_componente);
```
E **redefinir `sf_integrar`** (drop da assinatura de 0064 + recreate) pra filtrar a receita por `p_posto`:
na query de `v_receita` (0064 linha ~86), trocar `where ordem_id = v_ordem_id` por
`where ordem_id = v_ordem_id and posto = p_posto`. Resto do corpo idêntico ao 0064. (Assinatura NÃO muda —
`p_posto` já existe desde 0064 —, então é `create or replace` puro, **sem** drop.) **0065**, só no Dev.

### 2. Infra — `sf_ordem_componentes` por posto
- **`ordem-repository.ts`:**
  - `listarOrdens`/`OrdemRow`: `sf_ordem_componentes(pmo_componente)` → `sf_ordem_componentes(posto,pmo_componente)`;
    agrupar em `receitaPorPosto: Record<string, string[]>`.
  - `criarOrdem`/`atualizarOrdem`: recebem `componentes: { posto: string; pmo: string }[]` (ou
    `Record<posto,string[]>`) e inserem com `posto`.
- **`lancamento-repository.ts`:** `listarOrdensParaLancamento` + `OrdemLancamentoLista`: idem, expor
  `receitaPorPosto: Record<string,string[]>` (mantém o `componentes` flat? não — substitui pelo mapa).
- **`OrdemView`/`OrdemLancamentoLista`** trocam `componentes: string[]` por `receitaPorPosto: Record<string,string[]>`.

### 3. Cadastro de OP — `ordem-form.tsx`
- Estado: `const [receita, setReceita] = useState<Record<string, string[]>>(ordem?.receitaPorPosto ?? {})`.
- **Uma seção por posto integracao do fluxo:** `fluxo.filter((p) => perfilDo(p).recurso === 'integracao')
  .map((posto) => <ReceitaIntegracao key={posto} posto={posto} pmos={receita[posto] ?? []} onChange={(pmos)=>
  setReceita({...receita, [posto]: pmos})} pmosDisponiveis={...} />)`. Cada seção titula "Receita · {posto}".
- Hidden input `componentes` = `JSON.stringify(receita)` (objeto posto→pmos), filtrado aos postos integracao do fluxo.
- Reset-on-open + `ReceitaIntegracao` ganha prop `posto` (título) — hoje é name-based (`fluxo.includes('Integração')`).

### 4. Application — `ordens-actions.ts`
- `lerComponentes(fd)`: parseia o objeto `Record<posto,string[]>`; validar postos ∈ fluxo com recurso integracao,
  PMOs não-vazias. Salvar como linhas `{posto, pmo}`.
- Trocar `postos.includes('Integração') ? lerComponentes : []` por perfil-driven (há posto integracao? via mapa).

### 5. Integração — painel/resolver/integrar recebem o posto
- **`lancamento-form.tsx`:** ao renderizar `<IntegracaoPanel>`, passar `posto={posto}` (o selecionado) e
  `componentes={ordemSel?.receitaPorPosto?.[posto] ?? []}` (a receita **daquele** posto).
- **`IntegracaoPanel`:** ganha prop `posto: string`; repassa em `resolverPlacaIntegracaoAction(pmo, op, posto, sn)`
  e em `integrar({ ..., posto })`.
- **`resolverPlacaIntegracaoAction(pmoProduto, opProduto, posto, sn)`:** receita = `ordem.receitaPorPosto[posto]`.
- **`integrar`:** `EntradaIntegracao` += `posto`; usa `posto` como `postoIntegr` (não "acha o 1º"); valida que o
  posto está no fluxo e tem recurso integracao; passa `p_posto: posto`. (O RPC 0065 já filtra a receita por posto.)

### 6. Padrões de fluxo — receita por posto
- `sf_padroes_fluxo.componentes` (jsonb) passa a guardar `Record<posto, string[]>` (objeto). `padroes-fluxo-repository`
  + `padroes-fluxo-actions` + o "Salvar como padrão"/"Puxar de padrão" no `ordem-form` passam a lidar com o mapa.
- Backfill dos padrões existentes: o array vira `{ "Integração": [...] }` (via migração ou no load defensivo).

## Critérios de sucesso
- OP com 2 postos integracao mostra **2 seções de receita** (uma por posto), salvas/carregadas certo.
- No Lançamento, ao selecionar cada posto de Integração, o painel usa **a receita daquele posto**; registrar
  grava contra o posto certo (`p_posto`), e a checagem de receita do RPC é a do posto.
- OPs/receitas/padrões **existentes** seguem funcionando (backfill p/ 'Integração').
- Build/testes verdes; migração `0065` só no Dev.

## Riscos / considerações
- **Muda a forma de `componentes`** (string[] → Record<posto,string[]>) em vários pontos (form, repo, actions,
  lançamento, padrões) — sequenciar pra build verde; testes de domínio onde houver.
- **RPC:** `create or replace` puro (assinatura já tem p_posto do 0064) — só a query de receita muda.
- **Backfill:** receitas e padrões existentes → posto 'Integração' (nome histórico do posto integracao).
- **Padrões:** DECIDIDO (2026-07-31) — **opção (A): padrões por posto**. `componentes` do padrão vira
  `Record<posto, string[]>`; salvar/puxar padrão restaura cada receita no seu posto. Backfill dos padrões
  existentes → `{ "Integração": [...] }`.
- Smoke pesado: OP 1 integracao (paridade) + OP 2 integracao (novo) + registrar cada + padrão com receita.
