-- Foto das LEITURAS do Almoxarifado (necessidades, lotes, pendências, detalhe) de todas as OPs com
-- placas_por_painel = 1 da massa da suíte do almoxarifado. Usada pelo rodar-almoxarifado-test.sh com
-- PLACAS=1: tira a foto com a 0165 (tabela foto_depois), reaplica as definições ANTIGAS (0155, 0156,
-- 0131, 0158, 0159), tira a foto de novo (foto_antes) e compara linha a linha. N = 1 tem que ser IDÊNTICO.
-- Uso: psql -v tabela=foto_depois -f placas_almoxarifado_foto.sql
\set ON_ERROR_STOP on
select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);

create table :tabela as
with ops as (
  select o.pmo, o.op from public.sf_ordens o where o.placas_por_painel = 1
)
select 'necessidades' as fonte, ops.pmo, ops.op, n.codigo as chave, to_jsonb(n) as v
  from ops, lateral public.sf_almox_necessidades(ops.pmo, ops.op) n
union all
select 'lotes', ops.pmo, ops.op, l.lote_id::text, to_jsonb(l)
  from ops, lateral public.sf_almox_lotes(ops.pmo, ops.op) l
union all
select 'pendencias', p.pmo, p.op, p.codigo || '/' || coalesce(p.lote_id::text, ''), to_jsonb(p)
  from public.sf_almox_pendencias() p join ops on ops.pmo = p.pmo and ops.op = p.op
union all
select 'detalhe_pendencia', p.pmo, p.op, p.codigo || '/' || coalesce(p.lote_id::text, ''),
       public.sf_almox_detalhe(p.pmo, p.op, p.codigo, p.lote_id)
  from public.sf_almox_pendencias() p join ops on ops.pmo = p.pmo and ops.op = p.op
union all
-- Toda caixa fechada da massa (inclusive as já lançadas, com recebidas_op > 0).
select 'detalhe_caixa', c.pmo, c.op, c.codigo || '/' || c.posto || '/' || c.seq,
       public.sf_almox_detalhe(c.pmo, c.op, c.codigo, null)
  from public.sf_caixas c join ops on ops.pmo = c.pmo and ops.op = c.op
 where c.codigo <> ''
union all
select 'detalhe_avulsas', ops.pmo, ops.op, 'AVULSAS', public.sf_almox_detalhe(ops.pmo, ops.op, 'AVULSAS', null)
  from ops;

select :'tabela' as foto, count(*) as linhas from :tabela;
