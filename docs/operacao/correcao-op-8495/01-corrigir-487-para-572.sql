-- =============================================================
-- Correção da OP PMOC13_ / 8495_ (21/10/2026): o produto integrado com a placa 2684950498 foi
-- lançado como 332007487, mas fisicamente é o 332007572 (placa conferida por dentro do produto).
--
-- O que este script faz (1 integração + 3 registros, numa transação só):
--   • sf_integracoes INT-20261001-192937-6B2E: produto 332007487 -> 332007572 (com observação "*");
--   • sf_registros do produto (Integração, Embalagem na caixa CX[21][120]8495_-PMOC13_, Inspeção NQA):
--     numero_serie / numero_serie_norm 332007487 -> 332007572 (com observação "*").
-- Depois dele o 332007487 fica SEM registro nenhum (é o que ele é na prática: ainda não foi integrado)
-- e pode ser integrado pela tela normal com a placa certa.
--
-- Segurança: copia as linhas para tabelas correcao_8495_bkp_* ANTES; o bloco de conferência ABORTA tudo
-- se o banco não estiver exatamente como foi visto em 21/10 (ids, quantidades, 572 sem nenhum registro).
-- Reversão: 02-reverter-487-para-572.sql.
-- Rode com: psql ... -v ON_ERROR_STOP=1 -f <este arquivo>
-- =============================================================
\set ON_ERROR_STOP on
begin;

-- ---------- conferência: aborta se o banco não bater ----------
do $chk$
declare
  v_int int; v_itens int; v_regs int; v_572 int; v_572i int; v_prod_ids int;
begin
  select count(*) into v_int from sf_integracoes
   where codigo = 'INT-20261001-192937-6B2E' and status = 'ATIVA'
     and produto_sn_norm = '332007487' and pmo = 'PMOC13_' and op = '8495_';
  select count(*) into v_itens from sf_integracao_itens it join sf_integracoes i on i.id = it.integracao_id
   where i.codigo = 'INT-20261001-192937-6B2E' and it.placa_sn_norm = '2684950498';
  select count(*) into v_regs from sf_registros
   where numero_serie_norm = '332007487'
     and id in ('b99bbe56-3fa9-4f41-8652-fc79f15b6988'::uuid,
                '7e7804aa-069b-40a7-92cc-bc475aaeb9ac'::uuid,
                '6b5cc607-d105-4a46-88a8-86d52e910692'::uuid);
  select count(*) into v_prod_ids from sf_registros where numero_serie_norm = '332007487';
  select count(*) into v_572 from sf_registros where numero_serie_norm = '332007572';
  select count(*) into v_572i from sf_integracoes where produto_sn_norm = '332007572';
  if v_int <> 1 then raise exception 'ABORTADO: integração INT-20261001-192937-6B2E não está como esperado (achou %).', v_int; end if;
  if v_itens <> 1 then raise exception 'ABORTADO: a integração não tem exatamente a placa 2684950498 (achou % itens).', v_itens; end if;
  if v_regs <> 3 or v_prod_ids <> 3 then raise exception 'ABORTADO: os registros do 332007487 não são os 3 esperados (ids certos: %, total: %).', v_regs, v_prod_ids; end if;
  if v_572 <> 0 or v_572i <> 0 then raise exception 'ABORTADO: o 332007572 já tem registro (%) ou integração (%): não pode trocar.', v_572, v_572i; end if;
end
$chk$;

-- ---------- cópia de segurança ----------
create table correcao_8495_bkp_integracoes as
  select * from sf_integracoes where codigo = 'INT-20261001-192937-6B2E';
create table correcao_8495_bkp_registros as
  select * from sf_registros where numero_serie_norm = '332007487';

-- ---------- a correção ----------
update sf_integracoes
   set produto_sn = '332007572',
       produto_sn_norm = '332007572',
       observacao = '* Corrigido em 21/10/2026: o produto foi lançado como 332007487 (número lido errado); fisicamente é o 332007572, com a placa 2684950498 conferida por dentro.'
 where codigo = 'INT-20261001-192937-6B2E';

update sf_registros
   set numero_serie = '332007572',
       numero_serie_norm = '332007572',
       observacao = btrim(coalesce(observacao, '') || ' * Corrigido em 21/10/2026: era 332007487.')
 where id in ('b99bbe56-3fa9-4f41-8652-fc79f15b6988'::uuid,
              '7e7804aa-069b-40a7-92cc-bc475aaeb9ac'::uuid,
              '6b5cc607-d105-4a46-88a8-86d52e910692'::uuid);

-- ---------- conferência do resultado: aborta se algo saiu diferente ----------
do $chk$
begin
  if (select count(*) from sf_registros where numero_serie_norm = '332007572') <> 3
     or (select count(*) from sf_registros where numero_serie_norm = '332007487') <> 0
     or (select count(*) from sf_integracoes where produto_sn_norm = '332007572' and status = 'ATIVA') <> 1
     or (select count(*) from sf_integracoes where produto_sn_norm = '332007487') <> 0 then
    raise exception 'ABORTADO: o resultado da correção não bateu; nada foi gravado.';
  end if;
end
$chk$;

commit;

-- Resultado (só lê): o 572 deve ter 3 registros; o 487 deve ter 0.
select r.numero_serie_norm as sn, r.posto, r.status, r.numero_caixa, to_char(r.data_hora,'DD/MM HH24:MI:SS') as hora
  from sf_registros r where r.numero_serie_norm in ('332007487','332007572') order by r.numero_serie_norm, r.data_hora;
select codigo, produto_sn, status, observacao from sf_integracoes where codigo = 'INT-20261001-192937-6B2E';
