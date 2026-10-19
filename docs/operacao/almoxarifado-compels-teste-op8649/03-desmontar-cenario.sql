-- =============================================================
-- TESTE DA INTEGRAÇÃO COM O COMPELS — OP 8649 — DESMONTAR O CENÁRIO DE TESTE
--
-- Apaga TUDO o que o 02-montar-cenario.sql criou e o que o teste gerou nessa OP: as linhas da fila de
-- estoque, os registros (as 5 peças de Embalagem e as entradas do Almoxarifado) e a OP de teste com a rota.
-- O posto "Almoxarifado", se foi criado pelo 02, FICA (é cadastro, não dado do teste).
--
-- SE RECUSA (nada é gravado) quando a OP 8649 NÃO é de teste (cliente diferente de 'TESTE INTEGRACAO COMPELS'):
-- é a trava que impede apagar uma OP real.
--
-- ⚠️ Isto NÃO estorna nada no Compels. Estorne lá, à mão, na ordem: apontamento, requisição, empenho.
-- A tabela da fila é apagada por linha (as linhas copiam para o resultado impresso, antes de sumir).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/op8649-03.sql
-- =============================================================

do $func$
declare
  v_marca constant text := 'TESTE INTEGRACAO COMPELS';
  v_cliente text;
  v_fila int;
  v_reg  int;
begin
  select cliente into v_cliente from public.sf_ordens where op = '8649';
  if not found then
    raise notice 'A OP 8649 não existe no ShopFloor: nada a desmontar na OP.';
  elsif v_cliente <> v_marca then
    raise exception 'A OP 8649 NÃO é de teste (cliente "%"): nada foi apagado.', v_cliente;
  end if;

  delete from public.sf_estoque_envios where op = '8649' and pmo = 'PRT446';
  get diagnostics v_fila = row_count;

  delete from public.sf_registros where op = '8649' and pmo = 'PRT446';
  get diagnostics v_reg = row_count;

  delete from public.sf_caixas where op = '8649' and pmo = 'PRT446';

  delete from public.sf_ordens where op = '8649' and pmo = 'PRT446' and cliente = v_marca;

  raise notice 'Desmontado: % linha(s) da fila, % registro(s) e a OP de teste.', v_fila, v_reg;
end
$func$;

\echo
\echo '== Conferir (esperado: tudo 0):'
select (select count(*) from public.sf_ordens where op = '8649') as ordens,
       (select count(*) from public.sf_registros where op = '8649') as registros,
       (select count(*) from public.sf_estoque_envios where op = '8649') as fila;
