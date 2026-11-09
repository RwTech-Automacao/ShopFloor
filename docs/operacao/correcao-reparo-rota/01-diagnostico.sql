-- SOMENTE LEITURA. Mostra (1) os postos com rota de retorno configurada e (2) as peças que estão PRESAS hoje:
-- o último registro delas manda passar por um posto que a rota da OP não tem (RETESTE_PENDENTE sem saída).
-- Depende da 0174 (sf_filtrar_rota_pela_op). Uso: psql ... -f docs/operacao/correcao-reparo-rota/01-diagnostico.sql
\echo '--- 1) postos com rota de retorno configurada'
select chave as posto, retorno_pos_manutencao as rota_configurada
  from sf_postos where coalesce(retorno_pos_manutencao, '') <> '' order by chave;

\echo '--- 2) pecas presas (o 1o posto da divida nao existe na rota da OP)'
select distinct r.pmo, r.op, r.numero_serie, r.posto_retorno as deve_passar_por,
       split_part(r.posto_retorno, ',', 1) as posto_que_a_op_nao_tem,
       coalesce(public.sf_filtrar_rota_pela_op(r.pmo, r.op, r.posto_retorno), '(volta direto)') as ficaria
  from sf_registros r
 where coalesce(r.posto_retorno, '') <> ''
   and not exists (select 1 from sf_registros n
                    where n.pmo = r.pmo and n.op = r.op and n.numero_serie_norm = r.numero_serie_norm
                      and (n.data_hora, n.created_at) > (r.data_hora, r.created_at))
   and public.sf_filtrar_rota_pela_op(r.pmo, r.op, split_part(r.posto_retorno, ',', 1)) is null
 order by r.pmo, r.op, r.numero_serie;
