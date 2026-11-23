-- Massa de ANTES da 0197 (apontamento automático das PRTs): uma OP com trecho PRT que já existe e já tem placas na fila.
-- Roda depois do esquema + 0184/0194/0195 e ANTES da 0197. O prt_agrupar_test.sql confere o que a 0197 fez com ela.
\set ON_ERROR_STOP on

-- OP ANTIGA com trecho PRT (cadastrada antes da 0197): 3 placas aprovadas no fim da PRT -> 3 linhas na fila
select sf_cadastrar_op($j${
  "ordem": {"pmo":"PMOANTIGA","op":"9500","cliente":"C","qtd":3,"placas_por_painel":1},
  "trechos": [
    {"seq":1,"codigo":"PRTANT","tipo":"prt","compels_op":"9501","sn_modo":"mesmo","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
    {"seq":2,"codigo":"PMOANTIGA","tipo":"pmo","compels_op":"9500","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"9"}]}
  ]}$j$::jsonb);
insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values
  ('Inspeção AOI TOP', 'PMOANTIGA', '9500', 'Aprovado', '1', '1'),
  ('Inspeção AOI TOP', 'PMOANTIGA', '9500', 'Aprovado', '2', '2'),
  ('Inspeção AOI TOP', 'PMOANTIGA', '9500', 'Aprovado', '3', '3');
-- a placa 3 foi TOCADA (uma rodada já a tentou): a 0197 não pode cancelá-la
update sf_estoque_envios set tentativas = 1, erro = 'falha qualquer' where pmo = 'PRTANT' and serie_norm = '3';
-- uma linha de PMO (sem ordem_id) na fila: não é de PRT, a 0197 não toca
insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
values ('ALMOX/PMOANTIGA/9500/Almoxarifado/CX1/E1', 'PMOANTIGA', '9500', 'Almoxarifado', 'caixa', 'CX1', 10);
do $$ begin
  if (select count(*) from sf_estoque_envios where pmo = 'PRTANT' and ordem_id is not null and not ok and cancelado_em is null) <> 3 then
    raise exception 'massa de antes: esperava 3 linhas da PRTANT na fila';
  end if;
end $$;
