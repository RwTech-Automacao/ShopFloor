# Padrões de Fluxo (moldes nomeados por PMO) no Cadastro de OP — Design

> **Data:** 2026-07-28 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** feature (evolução do "puxar fluxo"). Segue o fluxo Dev × Prod.

## Contexto

No Cadastro de OP, hoje o "puxar fluxo" copia o **fluxo de postos + receita** de uma **OP existente do
mesmo PMO** (o "molde" é implícito — qualquer OP serve). Isso foi o MVP; o passo previsto era **padrões
nomeados** (como o "padrão de importação" do Recebimento).

Decisão (brainstorm 2026-07-28): criar **Padrões de Fluxo** — moldes **nomeados, por PMO**, contendo os
**postos (+ordem) + a receita**, geridos **inline** no próprio Cadastro de OP. O "puxar de OP qualquer"
é **substituído** pelo "puxar de padrão".

## Objetivo

Trocar o "puxar de OP crua" por **padrões curados e nomeados** (nome + descrição), criados/geridos inline
no Cadastro de OP, mantendo o comportamento de preencher fluxo+receita ao puxar.

## Escopo

**Dentro:**
- Tabela nova `sf_padroes_fluxo` (migração) + RLS `shopfloor.administrar`.
- Server Actions: `listarPadroesFluxo(pmo)`, `salvarPadraoFluxo(...)` (upsert), `excluirPadraoFluxo(id)`.
- UI no `ordem-form.tsx`: **remover** o "Puxar fluxo de OP…"; **adicionar** "Puxar de padrão…" +
  "Salvar fluxo atual como padrão" + apagar/editar inline.

**Fora (confirmado):**
- **Tela dedicada** de gestão (ficou o inline).
- **Pré-semear** padrões via migração (você cria conforme usa; migrar um fluxo existente = abrir a OP e
  "salvar como padrão").
- Campos extras no padrão (só nome + descrição).

## Design

### 1. Modelo (migração nova — próximo nº livre, ex.: `0059`)
```sql
create table public.sf_padroes_fluxo (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  nome text not null,
  descricao text not null default '',
  postos jsonb not null default '[]'::jsonb,        -- array ORDENADO de nomes de posto
  componentes jsonb not null default '[]'::jsonb,   -- array de PMOs de placa (receita)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pmo, nome)
);
alter table public.sf_padroes_fluxo enable row level security;
create policy sf_padroes_fluxo_admin on public.sf_padroes_fluxo
  for all
  using (tem_permissao('shopfloor', 'administrar'))
  with check (tem_permissao('shopfloor', 'administrar'));
```
- `postos`/`componentes` como **jsonb string[]** (snapshot pra copiar direto no `fluxo`/`receita` do form,
  que já são `string[]`). Sem tabelas-filho — é um molde, não uma OP.
- `unique (pmo, nome)` → salvar com nome existente **sobrescreve** (editar).

### 2. Server Actions (`application/`, todas guard `shopfloor.administrar`)
- `listarPadroesFluxo(pmo: string)` → `{ id, nome, descricao, postos: string[], componentes: string[] }[]`
  do PMO (ordenado por nome).
- `salvarPadraoFluxo({ pmo, nome, descricao, postos, componentes })` → **upsert** por (pmo, nome)
  (insert ou update; atualiza `updated_at`). Valida: `pmo` e `nome` não-vazios, `postos` não-vazio.
- `excluirPadraoFluxo(id: string)` → delete.

### 3. UI — `src/app/(app)/shopfloor/ordens/ordem-form.tsx`
Na seção "Fluxo de postos":
- **Remover** o `<Select>` "Puxar fluxo de OP…" (e o `fontes = fluxosExistentes.filter(...)`).
- **Adicionar** "Puxar de padrão…": `<Select>` com os padrões do **PMO atual** (rótulo: `nome — descricao`).
  Ao escolher → `setFluxo(padrao.postos)` + `setReceita(padrao.componentes)` (**substitui** o fluxo atual).
  Vazio quando o PMO não tem padrões (aí monta manual e salva).
- **"Salvar fluxo atual como padrão":** botão que pede **nome + descrição** (modal/inline) →
  `salvarPadraoFluxo({ pmo, nome, descricao, postos: fluxo, componentes: receita })`. Se já existe um padrão
  com esse nome no PMO → **confirmar "sobrescrever o padrão «X»?"** antes (é o "editar").
- **Apagar/editar inline:** ao lado do dropdown, uma listinha dos padrões do PMO com **× (apagar)** em cada
  → **confirmação** → `excluirPadraoFluxo`. Editar = puxar o padrão → ajustar → "salvar como padrão" com o
  mesmo nome (sobrescreve).
- Recarregar a lista de padrões após salvar/apagar (revalidate/estado).
- Só aparece com `administrar` (o form já é).

### 4. Reatividade ao PMO
O dropdown de padrões e a lista dependem do **PMO atual** do form (`pmo` state). Ao trocar o PMO, recarregar
os padrões daquele PMO (a página pode carregar todos os padrões e o form filtra por `pmo`, espelhando como o
`fontes` faz hoje com os fluxos — evita round-trip por digitação).

## Critérios de sucesso
- No Cadastro de OP, "Puxar de padrão…" mostra os padrões do PMO; escolher preenche fluxo+receita.
- "Salvar fluxo atual como padrão" cria um padrão (nome+descrição); salvar com nome existente sobrescreve
  (com confirmação).
- Apagar um padrão (com confirmação) remove-o da lista.
- Um usuário sem `administrar` não acessa (o form já é admin) e o RLS bloqueia.
- O "puxar de OP crua" não existe mais; nenhuma OP existente é afetada (mantêm seus fluxos).

## Riscos / considerações
- **Transição:** ao remover o "puxar de OP", PMOs sem padrão ainda não têm o que puxar até você criar o
  primeiro (montar manual + salvar, ou abrir uma OP e salvar o fluxo dela como padrão). Aceito (força a
  curadoria — decisão do usuário).
- **Postos "stale":** um padrão guarda os nomes de posto do momento; se um posto for renomeado depois, o
  padrão pode trazer um nome antigo. Baixo risco (nomes de posto mudam pouco); não tratado no MVP.
- Baixo risco geral: tabela nova + 3 actions + mudança localizada no form de OP; sem tocar em OPs/registros.
