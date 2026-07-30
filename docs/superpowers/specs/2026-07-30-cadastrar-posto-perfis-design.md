# Cadastrar Posto + Perfis de Posto (comportamento por perfil) — Design

> **Data:** 2026-07-30 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-ondas`
> **Tipo:** feature fundacional (refatora o coração do Lançamento). **Precisa de migração no Dev.** Dev × Prod.
> **Fase 1** (esta): perfis existentes + atribuir. **Fase 2** (depois): criar perfis novos por config.

## Contexto

Hoje o comportamento de cada posto é **fixado pelo NOME** — listas hardcoded no domínio
(`POSTOS_COM_STATUS`, `POSTOS_SO_REGISTRADO`, `POSTOS_REPARO_VIA_MANUTENCAO` em `lancamento-linhas.ts`) e
`if (p === 'embalagem'|'inspeção nqa'|'inspeção spi')` em `regras-lancamento.ts`/`montarLinhas`, além de
`ehBurnin/ehEmbalagem/ehNqa/ehSpi` (por nome) no form. Logo, **um posto novo com nome novo cai como
"passagem"** — não tem como criar posto com comportamento.

**Achado que reduz o risco:** os RPCs `sf_lancar`/`sf_burnin`/`sf_integrar` **já recebem os flags calculados**
(`p_posto_tem_status`, `p_prev_precisa_aprovado`, `p_exige_manutencao`) — o **cliente** os computa via as
funções de domínio. Então **os RPCs NÃO mudam**; a refatoração é no **domínio + callers**.

**Mapa aprovado** (posto → perfil): Passagem {Inicial, Montagem PTH, Extra máquina} · Inspeção (defeitos)
{Inspeção SMD, Inspeção PTH, Inspeção Final} · Teste c/ manutenção {Teste, Teste Final} · Inspeção SPI ·
NQA · Embalagem · Integração · Burn-in · Manutenção.

## Objetivo

Passar o comportamento do posto a ser decidido por um **perfil** (não pelo nome), e permitir **cadastrar
postos novos** escolhendo um dos **9 perfis** existentes.

## Escopo

**Dentro (Fase 1):**
- Tabela `sf_posto_perfis` (9 seeds) + `sf_postos.perfil` (FK, backfill).
- Refatorar domínio + callers de **nome → perfil** (RPCs intactos).
- Tela **Cadastrar Posto** (admin): listar, cadastrar (nome + ordem + perfil), editar (ordem/perfil), excluir —
  **editar/excluir só se o posto NÃO estiver em nenhuma OP** (`sf_ordem_postos`).

**Fora (Fase 2 / confirmado):**
- **Criar perfis novos** por config (compondo as 4 dimensões). Aqui só se **atribui** os 9 existentes.
- Recursos bespoke novos (caixa/NQA/burn-in/integração) — são código.
- "Outras opções" do Extra máquina (feature à parte; segue no perfil Passagem por ora).

## Design

### 1. Migração — `supabase/migrations/0062_sf_posto_perfis.sql`
```sql
create table public.sf_posto_perfis (
  chave           text primary key,        -- 'passagem','inspecao','teste','spi','nqa','embalagem','integracao','burnin','manutencao'
  nome            text not null,           -- rótulo p/ a tela
  tem_status      boolean not null,        -- grava aprovado/reprovado
  reprova         text not null,           -- 'defeitos' | 'posicoes' | 'nenhum'
  gate            text not null,           -- 'aprovado' | 'registrado' (gate de sequência do posto anterior)
  exige_manutencao boolean not null,       -- reprova exige passar pela Manutenção
  recurso         text not null            -- 'nenhum'|'caixa'|'nqa'|'integracao'|'burnin'|'manutencao'
);
alter table public.sf_posto_perfis enable row level security;
-- leitura p/ o módulo; escrita não é exposta na Fase 1 (perfis são seed fixo)
create policy sf_posto_perfis_select on public.sf_posto_perfis for select using (tem_permissao('shopfloor','visualizar'));

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso) values
  ('passagem',   'Passagem',            false, 'nenhum',   'registrado', false, 'nenhum'),
  ('inspecao',   'Inspeção (defeitos)', true,  'defeitos', 'aprovado',   false, 'nenhum'),
  ('teste',      'Teste (c/ manutenção)', true,'defeitos', 'aprovado',   true,  'nenhum'),
  ('spi',        'Inspeção SPI',        true,  'posicoes', 'aprovado',   false, 'nenhum'),
  ('nqa',        'Inspeção NQA',        true,  'nenhum',   'aprovado',   false, 'nqa'),
  ('embalagem',  'Embalagem',           false, 'nenhum',   'registrado', false, 'caixa'),
  ('integracao', 'Integração',          false, 'nenhum',   'registrado', false, 'integracao'),
  ('burnin',     'Burn-in',             true,  'defeitos', 'aprovado',   true,  'burnin'),  -- gate=aprovado: Burn-in NÃO está em POSTOS_SO_REGISTRADO
  ('manutencao', 'Manutenção',          false, 'nenhum',   'registrado', false, 'manutencao');

alter table public.sf_postos add column if not exists perfil text references public.sf_posto_perfis(chave);

-- Backfill dos postos atuais (nome → perfil):
update public.sf_postos set perfil = 'passagem'  where chave in ('Inicial','Montagem PTH','Extra máquina');
update public.sf_postos set perfil = 'inspecao'  where chave in ('Inspeção SMD','Inspeção PTH','Inspeção Final');
update public.sf_postos set perfil = 'teste'     where chave in ('Teste','Teste Final');
update public.sf_postos set perfil = 'spi'        where chave = 'Inspeção SPI';
update public.sf_postos set perfil = 'nqa'        where chave = 'Inspeção NQA';
update public.sf_postos set perfil = 'embalagem'  where chave = 'Embalagem';
update public.sf_postos set perfil = 'integracao' where chave = 'Integração';
update public.sf_postos set perfil = 'burnin'     where chave = 'Burn-in';
update public.sf_postos set perfil = 'manutencao' where chave = 'Manutenção';
-- fallback defensivo (qualquer posto sem perfil → passagem)
update public.sf_postos set perfil = 'passagem' where perfil is null;
```
Aditiva (nova tabela + coluna). RLS `select` por módulo. **Só no Dev** nesta etapa. **0062**.

### 2. Domínio — `src/modules/shopfloor/domain/perfil-posto.ts` (novo)
- Tipos: `type ReprovaColeta = 'defeitos'|'posicoes'|'nenhum'`; `type GateSeq = 'aprovado'|'registrado'`;
  `type RecursoPosto = 'nenhum'|'caixa'|'nqa'|'integracao'|'burnin'|'manutencao'`;
  `interface PerfilPosto { chave: string; nome: string; temStatus: boolean; reprova: ReprovaColeta; gate: GateSeq; exigeManutencao: boolean; recurso: RecursoPosto }`.
- `const PERFIL_PADRAO: PerfilPosto` = passagem (fallback).
- **As funções decidem por perfil** (recebem `PerfilPosto`):
  - `perfilTemStatus(p) = p.temStatus`
  - `perfilPrecisaAprovado(p) = p.gate === 'aprovado'`
  - `perfilExigeManutencao(p) = p.exigeManutencao`
  - `montarLinhasPerfil(p, dados)` = se `p.reprova === 'posicoes'` → 1 linha por posição; senão defeitos (mesma lógica do `montarLinhas` atual, mas dirigida por `p.reprova`).
  - `obrigatoriosPorPerfil(p, d)` = porta o `obrigatoriosPorPosto` decidindo por `p.recurso`/`p.temStatus`/`p.reprova` (recurso `caixa` → exige caixa/qtd; `nqa` → exige visual/funcional; `spi`+reprovado → exige posição; `temStatus` → exige status; reprovado c/ `reprova==='defeitos'` → exige cód/pos/tipo).
- **Substitui** as listas/checks por-nome de `regras-lancamento.ts`/`lancamento-linhas.ts` (mantendo `caixaCheia` e os tipos `LinhaDefeito`/`DadosLinhas`/`DadosLancamento`). Os arquivos antigos podem re-exportar dos novos p/ minimizar churn, mas o objetivo é remover as listas hardcoded.
- **Testes:** portar os testes de `regras-lancamento.test.ts`/`lancamento-linhas.test.ts` p/ passar perfis (ex.: perfil `teste` exige manutenção; `spi` reprova por posições; `passagem` só base). Cobrir os 9 perfis nas dimensões relevantes.

### 3. Infra — `src/modules/shopfloor/infra/`
- `ordem-repository.listarPostos()`: incluir `perfil` no select (retorna `{ chave, ordem, perfil }`).
- **Novo** `mapaPostoPerfil(): Promise<Record<string, PerfilPosto>>` — join `sf_postos` × `sf_posto_perfis`,
  chave = nome do posto → `PerfilPosto`. (Usado pelos callers server-side.)
- **Novo** `listarPerfis(): Promise<PerfilPosto[]>` (p/ o dropdown da tela).
- CRUD de posto: `criarPosto({chave, ordem, perfil})`, `atualizarPosto(...)`, `excluirPosto(chave)`, e
  `postoEmUsoEmOrdem(chave): Promise<boolean>` (existe em `sf_ordem_postos`?).

### 4. Refatorar os callers (nome → perfil)
- **`lancar-action.ts`:** carregar `mapaPostoPerfil()`; resolver `perfil = mapa[entrada.posto] ?? PERFIL_PADRAO`
  e `perfilPrev = mapa[prevPosto]`. Trocar `obrigatoriosPorPosto`→`obrigatoriosPorPerfil(perfil,…)`,
  `montarLinhas`→`montarLinhasPerfil(perfil,…)`, `postoTemStatus`→`perfilTemStatus(perfil)`,
  `precisaAprovado(prevPosto)`→`perfilPrecisaAprovado(perfilPrev)`, `exigeManutencao`→`perfilExigeManutencao(perfil)`.
  As rotas especiais (integração/burn-in) passam a checar `perfil.recurso === 'integracao'|'burnin'`.
- **`integracao-actions.ts`:** `precisaAprovado(prevPosto)`→ via `mapaPostoPerfil` + `perfilPrecisaAprovado`.
- **`grade.ts` / `dashboard.ts`** (domínio puro): recebem, além dos dados, o **mapa/predicado** de status
  (ex.: um `temStatusPorPosto: (posto:string)=>boolean` derivado do mapa) e trocam `postoTemStatus(posto)` por
  ele. (Callers dessas — as telas de Análise/Dashboard — passam o predicado resolvido do `mapaPostoPerfil`.)
- **`lancamento-form.tsx`:** recebe `postosPerfil: Record<string, PerfilPosto>` (via `page.tsx`, que já carrega
  postos). `comStatus`/`ehNqa`/`ehSpi`/`ehEmbalagem`/`ehBurnin` passam a olhar `postosPerfil[posto]?.recurso`
  / `.temStatus` (ex.: `ehBurnin = postosPerfil[posto]?.recurso === 'burnin'`).

### 5. Tela — Cadastrar Posto (`app/(app)/configuracoes/sf-postos/`)
- Novo item **Postos** no accordion **Ajustes ShopFloor** (`app-shell.tsx`), admin-only, rota `/configuracoes/sf-postos`.
- `page.tsx` (guard `shopfloor.administrar`): lista postos (nome · ordem · perfil) + form.
- Componentes (padrão da tela de Defeitos): **cadastrar** (nome + ordem + Select de perfil via `listarPerfis`),
  **editar** (ordem/perfil), **excluir** — botões de editar/excluir **desabilitados/bloqueados quando o posto
  está em uso** (`postoEmUsoEmOrdem`), com aviso claro.
- Actions `sf-postos-actions.ts`: guard `shopfloor.administrar`; validar nome não-vazio/único, ordem número,
  perfil ∈ perfis; excluir/editar só se `!postoEmUsoEmOrdem`; `revalidatePath`; log.

## Critérios de sucesso
- Comportamento dos **9 postos atuais inalterado** (perfil espelha o nome) — smoke do Lançamento
  (status, reprova defeitos/posições, gate de sequência, manutenção, caixa, NQA, burn-in, integração) idêntico.
- **Posto novo** com perfil escolhido se comporta conforme o perfil (ex.: novo posto perfil "Inspeção" pede
  status e defeitos na reprova; perfil "Passagem" só passa).
- Cadastrar/editar/excluir posto na tela; **editar/excluir bloqueado** se o posto está em alguma OP.
- Testes de domínio verdes (portados p/ perfil). Build limpo. Migração `0062` só no Dev.

## Riscos / considerações
- **Coração do Lançamento** — maior risco do projeto. Mitigação: refatoração com **paridade** (perfis =
  comportamento atual), testes de domínio portados cobrindo os 9 perfis, **review por task + review final
  opus + smoke pesado** de todos os postos antes de considerar pronto.
- **Builds intermediários:** o plano deve sequenciar pra cada task deixar o build verde (adicionar
  perfil-based, migrar callers, remover nome-based ao final).
- **`recurso` bespoke** continua código (caixa/NQA/burn-in/integração/manutenção) — o perfil só **roteia** pro
  recurso certo; não cria recurso novo.
- **Postos sem perfil:** fallback `passagem` (backfill + `PERFIL_PADRAO`) evita quebra.
- Migração aditiva; Prod intacta até o próximo batch.
