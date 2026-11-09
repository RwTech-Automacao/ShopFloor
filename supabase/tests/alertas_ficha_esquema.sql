-- Esquema mínimo do chão de fábrica para o teste da 0173 (alertas_ficha_test.sql). Esta base do runner de
-- alertas só tem o _stubs.sql + o esquema da 0172 (alertas_travados_esquema.sql): faltam as colunas que a
-- ficha lê (colaborador, caixa, lote do NQA, descrição e quantidade da OP), as caixas (sf_caixas) e a rota
-- por perfil (sf_postos / sf_posto_perfis). Mesmos nomes e tipos de produção, só as colunas usadas.
--
-- ⚠️ AS DUAS FUNÇÕES-BASE DO ALMOXARIFADO SÃO STUBS AQUI. As de verdade (0167) dependem do Almoxarifado inteiro
-- (posto anterior, caixas pendentes...) e são testadas no runner do Almoxarifado; o que a 0173 consome delas é só
-- o CONTRATO (colunas devolvidas), e é isso que o stub reproduz de forma simples:
--   caixas: a caixa fechada que ainda não tem registro no posto ALMOX; pecas = sf_caixas.qtd
--   lotes:  cada nqa_lote_id da OP; pecas = linhas do lote; aprovado_em = max(data_hora); some quando há registro
--           no ALMOX com o mesmo nqa_lote_id... (o stub de lote: some se o lote tem linha no posto ALMOX)
-- O teste com as funções REAIS e a massa de produção está em alertas_ficha_real_test.sql
-- (rodar-placas-almoxarifado-test.sh).
alter table public.sf_registros add column if not exists colaborador text not null default '';
alter table public.sf_registros add column if not exists numero_caixa text not null default '';
alter table public.sf_registros add column if not exists nqa_lote_id uuid;
alter table public.sf_ordens add column if not exists descricao text not null default '';
alter table public.sf_ordens add column if not exists qtd int;
alter table public.sf_ordens add column if not exists embalagem_individual boolean not null default false;

create table if not exists public.sf_posto_perfis (
  chave   text primary key,
  recurso text not null default ''
);
create table if not exists public.sf_postos (
  chave  text primary key,
  perfil text not null references public.sf_posto_perfis(chave)
);
create table if not exists public.sf_caixas (
  id         uuid primary key default gen_random_uuid(),
  pmo        text not null,
  op         text not null,
  posto      text not null,
  seq        int  not null,
  codigo     text not null default '',
  qtd        int  not null default 0,
  fechada    boolean not null default false,
  revisao    int  not null default 0,
  fechada_em timestamptz
);

-- O índice parcial do lote (0156) e o da caixa (0028): os que o plano de produção usa.
create index if not exists sf_registros_nqa_lote on public.sf_registros (pmo, op, posto, nqa_lote_id) where nqa_lote_id is not null;
create index if not exists sf_registros_caixa on public.sf_registros (pmo, op, posto, numero_caixa);

grant select on public.sf_posto_perfis, public.sf_postos, public.sf_caixas to anon, authenticated, service_role;

insert into public.sf_posto_perfis (chave, recurso) values ('perfil_almox', 'almoxarifado'), ('perfil_comum', '');
insert into public.sf_postos (chave, perfil) values ('ALMOX', 'perfil_almox'), ('EMB', 'perfil_comum'), ('NQA', 'perfil_comum');

create or replace function public.sf_almox_necessidades_base(p_pmo text, p_op text)
returns table (codigo text, seq int, pecas int, fechada_em timestamptz)
language sql stable as $f$
  select cx.codigo, cx.seq, cx.qtd, cx.fechada_em
    from public.sf_caixas cx
   where cx.pmo = p_pmo and cx.op = p_op and cx.fechada and cx.revisao = 0
     and not exists (select 1 from public.sf_registros a
                      where a.pmo = p_pmo and a.op = p_op and a.posto = 'ALMOX' and a.numero_caixa = cx.codigo)
   order by cx.seq, cx.codigo
$f$;

create or replace function public.sf_almox_lotes_base(p_pmo text, p_op text)
returns table (lote_id uuid, rotulo text, pecas int, amostra int, sns text[], ja_lancadas int, aprovado_em timestamptz)
language sql stable as $f$
  select r.nqa_lote_id, 'LOTE[' || left(replace(r.nqa_lote_id::text, '-', ''), 8) || '][' || count(*) || ']',
         count(*)::int, count(*)::int, '{}'::text[], 0, max(r.data_hora)
    from public.sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.nqa_lote_id is not null and r.posto = 'NQA'
     and not exists (select 1 from public.sf_registros a
                      where a.pmo = p_pmo and a.op = p_op and a.posto = 'ALMOX' and a.nqa_lote_id = r.nqa_lote_id)
   group by r.nqa_lote_id
$f$;
