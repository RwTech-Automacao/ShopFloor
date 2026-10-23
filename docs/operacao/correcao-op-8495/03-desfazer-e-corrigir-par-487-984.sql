-- =============================================================
-- OP PMOC13_ / 8495_ (22/10/2026), SEGUNDA correção. Substitui o 01 (que partiu de uma inferência errada:
-- o produto embalado na caixa 21 era o 332007487 de verdade; o 332007572 AINDA NÃO foi embalado e será
-- colocado na caixa 22). O erro estava só na INTEGRAÇÃO: a placa 2684950498 foi bipada no 487, mas
-- fisicamente está no 572; a placa que fisicamente está no 487 é a 2684950984 (por eliminação: sobravam
-- só as placas 984 e 2342, e a 2342 está no 578).
--
-- Numa transação só, este script:
--   1) DESFAZ o 01: a integração INT-20261001-192937-6B2E e os 3 registros (Integração, Embalagem na
--      caixa CX[21][120]8495_-PMOC13_, Inspeção NQA) voltam a ser do produto 332007487 (a partir de
--      correcao_8495_bkp_*);
--   2) CORRIGE a placa dessa integração: 2684950498 -> 2684950984 (no item da integração e no registro
--      de Integração da placa). O 487 fica integrado com a 984; a 498 fica LIVRE.
-- Depois dele: integrar o 332007572 com a 2684950498 pela tela de Integração, embalar o 572 na caixa 22 e
-- seguir o NQA normal.
--
-- Segurança: copia as linhas alteradas para correcao_8495_bkp2_*; o bloco de conferência ABORTA tudo se o
-- banco não estiver exatamente como após o 01. Reversão: 04-reverter-par-487-984.sql (devolve a placa 498
-- ao 487; para voltar ao estado de ANTES do 01 não precisa de mais nada; para refazer o 01, rode o 01).
-- Rode com: psql ... -v ON_ERROR_STOP=1 -f <este arquivo>
-- =============================================================
\set ON_ERROR_STOP on
begin;

do $chk$
declare v int;
begin
  if to_regclass('public.correcao_8495_bkp_integracoes') is null or to_regclass('public.correcao_8495_bkp_registros') is null then
    raise exception 'ABORTADO: faltam as cópias correcao_8495_bkp_* do 01; este script parte do estado depois do 01.';
  end if;
  select count(*) into v from sf_integracoes
   where codigo = 'INT-20261001-192937-6B2E' and status = 'ATIVA' and produto_sn_norm = '332007572' and pmo = 'PMOC13_' and op = '8495_';
  if v <> 1 then raise exception 'ABORTADO: a integração não está com o 332007572 como após o 01 (achou %).', v; end if;
  select count(*) into v from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id
   where i.codigo = 'INT-20261001-192937-6B2E' and it.placa_sn_norm = '2684950498';
  if v <> 1 then raise exception 'ABORTADO: a integração não tem exatamente a placa 2684950498 (achou %).', v; end if;
  select count(*) into v from sf_registros where numero_serie_norm = '332007572';
  if v <> 3 then raise exception 'ABORTADO: o 332007572 não tem exatamente os 3 registros do 01 (achou %).', v; end if;
  select count(*) into v from sf_registros where numero_serie_norm = '332007487';
  if v <> 0 then raise exception 'ABORTADO: o 332007487 já tem registro (%); não pode desfazer o 01.', v; end if;
  select count(*) into v from sf_integracoes where produto_sn_norm = '332007487';
  if v <> 0 then raise exception 'ABORTADO: o 332007487 já tem integração (%); não pode desfazer o 01.', v; end if;
  -- o registro de Integração da PLACA 498 (um só)
  select count(*) into v from sf_registros
   where id_integracao = 'INT-20261001-192937-6B2E' and numero_serie_norm = '2684950498' and posto = 'Integração';
  if v <> 1 then raise exception 'ABORTADO: o registro de Integração da placa 2684950498 não é único (achou %).', v; end if;
  -- a placa 984 tem que estar livre e ter passado no Teste
  select count(*) into v from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id
   where it.placa_sn_norm = '2684950984' and i.status = 'ATIVA';
  if v <> 0 then raise exception 'ABORTADO: a placa 2684950984 já está numa integração ativa (%).', v; end if;
  select count(*) into v from sf_registros where numero_serie_norm = '2684950984' and posto = 'Integração';
  if v <> 0 then raise exception 'ABORTADO: a placa 2684950984 já tem registro de Integração (%).', v; end if;
  select count(*) into v from sf_registros where numero_serie_norm = '2684950984' and posto = 'Teste' and lower(status) = 'aprovado';
  if v < 1 then raise exception 'ABORTADO: a placa 2684950984 não tem Teste aprovado.'; end if;
end
$chk$;

-- cópia de segurança do que este script vai mexer
create table correcao_8495_bkp2_itens as
  select it.* from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id where i.codigo = 'INT-20261001-192937-6B2E';
create table correcao_8495_bkp2_registro_placa as
  select * from sf_registros where id_integracao = 'INT-20261001-192937-6B2E' and numero_serie_norm = '2684950498' and posto = 'Integração';
create table correcao_8495_bkp2_integracao as
  select * from sf_integracoes where codigo = 'INT-20261001-192937-6B2E';

-- 1) desfaz o 01
update sf_integracoes i
   set produto_sn = b.produto_sn, produto_sn_norm = b.produto_sn_norm, observacao = b.observacao
  from correcao_8495_bkp_integracoes b where i.id = b.id;
update sf_registros r
   set numero_serie = b.numero_serie, numero_serie_norm = b.numero_serie_norm, observacao = b.observacao
  from correcao_8495_bkp_registros b where r.id = b.id;

-- 2) corrige a placa: 498 -> 984
update sf_integracao_itens it
   set placa_sn = '2684950984', placa_sn_norm = '2684950984'
 where it.integracao_id = (select id from sf_integracoes where codigo = 'INT-20261001-192937-6B2E')
   and it.placa_sn_norm = '2684950498';
update sf_registros
   set numero_serie = '2684950984', numero_serie_norm = '2684950984',
       observacao = btrim(coalesce(observacao, '') || ' * Corrigido em 22/10/2026: era a placa 2684950498.')
 where id_integracao = 'INT-20261001-192937-6B2E' and numero_serie_norm = '2684950498' and posto = 'Integração';
update sf_integracoes
   set observacao = '* Corrigido em 22/10/2026: a placa lançada era a 2684950498 (que fisicamente está no 332007572); a placa do 332007487 é a 2684950984.'
 where codigo = 'INT-20261001-192937-6B2E';

do $chk$
begin
  if (select count(*) from sf_integracoes where codigo = 'INT-20261001-192937-6B2E' and produto_sn_norm = '332007487' and status = 'ATIVA') <> 1
     or (select count(*) from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id where i.codigo = 'INT-20261001-192937-6B2E' and it.placa_sn_norm = '2684950984') <> 1
     or (select count(*) from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id where i.status = 'ATIVA' and it.placa_sn_norm = '2684950498') <> 0
     or (select count(*) from sf_registros where numero_serie_norm = '332007487') <> 3
     or (select count(*) from sf_registros where numero_serie_norm = '332007572') <> 0
     or (select count(*) from sf_registros where numero_serie_norm = '2684950498' and posto = 'Integração') <> 0 then
    raise exception 'ABORTADO: o resultado não bateu; nada foi gravado.';
  end if;
end
$chk$;

commit;

-- Resultado (só lê): 487 com 3 registros e a placa 984; 572 sem registro; placa 498 livre.
select i.codigo, i.produto_sn, i.status, (select string_agg(it.placa_sn, ',') from sf_integracao_itens it where it.integracao_id = i.id) as placa from sf_integracoes i where i.codigo = 'INT-20261001-192937-6B2E';
select r.numero_serie_norm as sn, r.posto, r.status, r.numero_caixa, to_char(r.data_hora,'DD/MM HH24:MI:SS') as hora from sf_registros r where r.numero_serie_norm in ('332007487','332007572','2684950498','2684950984') and r.posto in ('Integração','Embalagem','Inspeção NQA') order by r.numero_serie_norm, r.data_hora;
