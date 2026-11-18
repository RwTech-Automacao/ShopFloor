-- Testes SQL da 0188 (peças paradas: caixa aberta e posto fora da rota). Rodar com supabase/tests/rodar-alertas-test.sh,
-- DEPOIS do parados_posto_pendente_test.sql (usa os helpers dele e do alertas_travados_test.sql e a OP P1 de lá).
-- Rota da OP de teste: Inicial(1) > Teste(2) > Embalagem(3) > Almoxarifado(4).
--
--   R1  os casos da 0183 (OP P1) continuam iguais;
--   R2  embalada em caixa ABERTA (código provisório, sem caixa fechada com esse código): pendente na Embalagem;
--   R3  embalada em caixa FECHADA: pendente no Almoxarifado (como antes);
--   R4  último bipe num posto fora da rota (Integração) depois da Embalagem em caixa fechada: pendente no Almoxarifado;
--   R5  último bipe fora da rota depois de caixa aberta: pendente na Embalagem;
--   R6  só tem bipe fora da rota: o próprio posto (como antes).

create function public.teste_pc_reg(p_sn text, p_posto text, p_caixa text, p_horas int) returns void
language sql as $f$
  insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas, numero_caixa)
  values ('PPEND', 'P3', p_sn, upper(p_sn), p_posto, '', now() - interval '3 days' + make_interval(hours => p_horas), 1,
          coalesce(p_caixa, ''))
$f$;

do $t$
declare v_todos text[] := array['Inicial', 'Teste', 'Embalagem', 'Almoxarifado', 'Manutenção', 'Fora', 'Integração'];
begin
  perform public.teste_trv_op('PPEND', 'P3');
  insert into public.sf_caixas (pmo, op, posto, seq, codigo, qtd, fechada, fechada_em)
  values ('PPEND', 'P3', 'Embalagem', 2, 'CX[2][3]P3-PPEND', 3, true, now() - interval '3 days');
  -- caixa 1 aberta: no banco o código fica vazio até fechar; os registros levam o provisório
  insert into public.sf_caixas (pmo, op, posto, seq, codigo, qtd, fechada)
  values ('PPEND', 'P3', 'Embalagem', 1, '', 0, false);

  perform public.teste_pc_reg('k', 'Embalagem', 'CX[1]', 0);
  perform public.teste_pc_reg('l', 'Embalagem', 'CX[2][3]P3-PPEND', 0);
  perform public.teste_pc_reg('m', 'Embalagem', 'CX[2][3]P3-PPEND', 0);
  perform public.teste_pc_reg('m', 'Integração', null, 5);
  perform public.teste_pc_reg('n', 'Embalagem', 'CX[1]', 0);
  perform public.teste_pc_reg('n', 'Integração', null, 5);
  perform public.teste_pc_reg('o', 'Integração', null, 0);

  perform public.teste_trv_igual('R1 casos da 0183', public.teste_pp_ler(v_todos),
    'P1/A:Teste:n P1/B:Embalagem:n P1/C:Teste:R P1/D:Teste:n P1/E:Inicial:n P1/F:Teste:n P1/G:Almoxarifado:n ' ||
    'P1/I:Fora:n P2/J:Teste:n P3/K:Embalagem:n P3/L:Almoxarifado:n P3/M:Almoxarifado:n P3/N:Embalagem:n ' ||
    'P3/O:Integração:n');
  perform public.teste_trv_igual('R2-R5 filtro Almoxarifado', public.teste_pp_ler(array['Almoxarifado']),
    'P1/G:Almoxarifado:n P3/L:Almoxarifado:n P3/M:Almoxarifado:n');
  raise notice 'R1-R6 ok';
end $t$;

select 'parados_caixa_aberta_test ok' as resultado;
