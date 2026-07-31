# Burn-in por posto — Design

> **Data:** 2026-07-31 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-ondas`
> **Tipo:** generalização (tempo mínimo de Burn-in por posto, não por OP). **Migração no Dev.** Dev × Prod.
> Depende de: Onda 2 perfis (`sf_posto_perfis`/`sf_postos.perfil`) e do tempo mínimo por OP (0060).
> É a **última peça da generalização por perfil** antes do batch merge pro Prod.

## Contexto

O tempo mínimo de Burn-in hoje é **único por OP** (`sf_ordens.tempo_min_burnin`, int em minutos, 0060). No
Cadastro de OP o campo **já aparece inline por posto** na lista do fluxo ([ordem-form.tsx:358-372]), mas todos
os postos de Burn-in ficam ligados ao **mesmo** valor (`name="tempo_min_burnin"`, `value={tempoBurnin}`) — se
houvesse dois postos de Burn-in, mostrariam e salvariam o mesmo número. É exatamente a situação que a receita
tinha antes da generalização.

Uso atual do valor: **gate no Lançamento** — na **saída** do Burn-in, se o tempo decorrido desde a entrada for
menor que o mínimo, o sistema **avisa** ("retirou antes do tempo") mas **permite** ([lancamento-form.tsx:132-136]).

## Objetivo

O tempo mínimo de Burn-in passa a ser **por (OP, posto)**: cada posto de perfil `burnin` no fluxo tem seu próprio
tempo mínimo; o gate de saída usa o tempo **do posto**. Detecção sempre por **perfil** (`recurso === 'burnin'`),
nunca por nome.

## Escopo

**Dentro:**
- Migração: nova tabela `sf_ordem_burnin (ordem_id, posto, tempo_min)`; backfill do `tempo_min_burnin` da OP
  para cada posto de Burn-in do fluxo dela.
- App: tempo vira `tempoBurninPorPosto: Record<posto, number>` (minutos) em `OrdemView`/`OrdemLancamentoLista`.
- Cadastro de OP: o campo inline de tempo passa a ter **valor próprio por posto** (estado `Record<posto,string>`).
- Gate no Lançamento: usa o tempo mínimo **do posto selecionado**.

**Fora (confirmado):**
- Qualquer outra config de Burn-in por posto (só o **tempo mínimo** muda por posto).
- Comportamento do aviso (retirar antes → só avisa, permite) — **inalterado**, só muda a fonte do tempo.
- Padrões de fluxo — hoje **não** guardam tempo de Burn-in; seguem sem guardar (fora do escopo).

## Design

### 1. Migração — `supabase/migrations/0068_sf_ordem_burnin.sql`
```sql
create table public.sf_ordem_burnin (
  ordem_id  uuid not null references public.sf_ordens(id) on delete cascade,
  posto     text not null,
  tempo_min int  not null default 0,
  primary key (ordem_id, posto)
);
alter table public.sf_ordem_burnin enable row level security;
create policy sf_ordem_burnin_select on public.sf_ordem_burnin
  for select using (tem_permissao('visualizar'));
create policy sf_ordem_burnin_admin on public.sf_ordem_burnin
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- backfill: tempo único da OP → cada posto de perfil burnin no fluxo dela
insert into public.sf_ordem_burnin (ordem_id, posto, tempo_min)
select o.id, op.posto, o.tempo_min_burnin
from public.sf_ordens o
join public.sf_ordem_postos op on op.ordem_id = o.id
join public.sf_postos p        on p.chave = op.posto
join public.sf_posto_perfis pf on pf.chave = p.perfil
where pf.recurso = 'burnin' and o.tempo_min_burnin > 0
on conflict (ordem_id, posto) do nothing;
```
A coluna `sf_ordens.tempo_min_burnin` **fica parada** (o código novo não lê nem escreve; não dropo — evita
destrutivo). **0068**, só no Dev. (Espelha `sf_ordem_componentes` do 0034 + a RLS de admin.)

### 2. Domínio — `src/modules/shopfloor/domain/burnin-posto.ts` (+ testes)
Reusa `tempoParaMinutos`/`minutosParaTempo` de `domain/tempo-burnin`.
```ts
export type TempoBurninPorPosto = Record<string, number> // posto → minutos

// DB rows → mapa
export function agruparTempoBurninPorPosto(linhas: { posto: string; tempo_min: number }[]): TempoBurninPorPosto

// mapa → linhas p/ inserir
export function temposParaLinhas(tempos: TempoBurninPorPosto): { posto: string; tempo_min: number }[]

// form (JSON Record<posto,"hhh:mm">) → mapa validado; mantém só postos de burnin do fluxo;
// campo vazio → ignora (sem mínimo); tempo inválido → { ok:false, posto } (nomeia o posto ruim)
export function parseTempoBurninPorPosto(
  json: string,
  postosBurnin: string[],
): { ok: true; tempos: TempoBurninPorPosto } | { ok: false; posto: string }
```
Regras: `parseTempoBurninPorPosto` só considera chaves em `postosBurnin`; string vazia/`'0:00'` → não entra no
mapa (sem mínimo); valor não-parseável → `{ ok:false, posto }`. Testes cobrem: agrupar, achatar, parse ok
(dois postos com tempos diferentes), campo vazio ignorado, tempo inválido nomeia o posto, JSON inválido → mapa vazio.

### 3. Infra
- **`ordem-repository.ts`:** `OrdemRow.sf_ordem_burnin: { posto: string; tempo_min: number }[]`; `select` de
  `listarOrdens` += `sf_ordem_burnin(posto,tempo_min)`; `criarOrdem`/`atualizarOrdem` ganham 4º parâmetro
  `burnin: { posto: string; tempo_min: number }[]` e inserem em `sf_ordem_burnin` (mesmo padrão do componentes:
  insert no criar; delete+reinsert no atualizar). **Remover** `tempo_min_burnin` de `DadosOrdem`/`OrdemRow` e do
  update de `sf_ordens` (código novo não escreve mais nele).
- **`lancamento-repository.ts`:** `OrdemLancamentoLista.tempoBurninPorPosto: TempoBurninPorPosto` (troca o
  `tempo_min_burnin`); `select` += `sf_ordem_burnin(posto,tempo_min)`; map via `agruparTempoBurninPorPosto`.

### 4. Cadastro de OP — `ordem-form.tsx`
- `OrdemView`: troca `tempo_min_burnin: number` por `tempoBurninPorPosto: TempoBurninPorPosto`.
- Estado: `const [tempoBurnin, setTempoBurnin] = useState<Record<string, string>>(...)` — no open, semear de
  `ordem?.tempoBurninPorPosto` (minutos→`minutosParaTempo`) ou `{}` (nova OP).
- O `<Input>` inline de cada posto burnin (linhas ~358-372): `value={tempoBurnin[posto] ?? ''}`,
  `onChange` grava `setTempoBurnin(prev => ({...prev, [posto]: mascararTempoFiltro(v)}))`. Default `'6:00'`
  para nova OP: semear no handler que adiciona um posto burnin ao fluxo (se sem entrada).
- Hidden input `tempo_burnin` = `JSON.stringify(tempoFiltrado)` onde `tempoFiltrado` mantém só os postos de
  perfil burnin **atualmente no fluxo** (mesma ideia do `receitaFiltrada`).
- Remover o `id/name="tempo_min_burnin"` antigo (vira o campo por posto).

### 5. Application — `ordens-actions.ts`
- `lerBurnin(fd, postos)`: carrega `mapaPostoPerfil()`, filtra `postosBurnin = postos.filter(recurso==='burnin')`,
  chama `parseTempoBurninPorPosto(fd.get('tempo_burnin'), postosBurnin)`; se `{ok:false}` → erro
  `Tempo mínimo de Burn-in inválido no posto {posto} (use hhh:mm).`; senão devolve `temposParaLinhas(tempos)`.
- `criar/editarOrdemAction`: trocar o bloco atual (`tempoParaMinutos` + `dados.tempo_min_burnin`) por
  `const burnin = await lerBurnin(...)`; passar `burnin` para `criarOrdem`/`atualizarOrdem`. Remover
  `tempo_min_burnin` de `lerDados`/`DadosOrdem`.

### 6. Gate — `lancamento-form.tsx`
- Trocar `(ordemSel?.tempo_min_burnin ?? 0)` e `ordemSel!.tempo_min_burnin` (linhas 132/136) por
  `(ordemSel?.tempoBurninPorPosto?.[posto] ?? 0)`. O resto do aviso é idêntico.

## Critérios de sucesso
- OP com 2 postos de Burn-in mostra **2 tempos independentes**, salvos/carregados certo.
- No Lançamento, a saída de **cada** posto de Burn-in compara com **o tempo daquele posto** (aviso correto).
- OPs existentes seguem funcionando (backfill do tempo único p/ cada posto burnin do fluxo).
- Build/lint/test verdes; migração `0068` só no Dev.

## Riscos / considerações
- **Muda a forma do tempo** (`number` único → `Record<posto, number>`) em repo/form/actions/lançamento —
  sequenciar pra build verde (mesma fatia da receita).
- **Backfill** depende do join perfil (`recurso='burnin'`); OPs cujo posto burnin não esteja mapeado a um perfil
  burnin não recebem linha (mas o fallback do 0062 garante todo posto ter perfil; o 'Burn-in' original → 'burnin').
- **Coluna morta** `sf_ordens.tempo_min_burnin` fica no schema; anotar como não-usada (limpeza futura, backlog).
- Smoke: OP 1 burnin (paridade) + OP 2 burnin (tempos diferentes) + saída antes/depois do tempo em cada posto.
