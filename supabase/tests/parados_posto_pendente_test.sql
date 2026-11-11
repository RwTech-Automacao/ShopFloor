-- Testes SQL da 0183 (peças paradas: o posto PENDENTE). Rodar com supabase/tests/rodar-alertas-test.sh, por cima
-- de tudo (usa os helpers teste_trv_op / teste_trv_igual do alertas_travados_test.sql). Rota da OP de teste:
-- Inicial(1) > Teste(2) > Embalagem(3) > Almoxarifado(4).
--
--   Q1  passou num posto da rota: pendente no PRÓXIMO (Inicial→Teste, Teste aprovado→Embalagem, Embalagem→Almox.);
--   Q2  reprovada: fica no posto que reprovou, marcada reprovada;
--   Q3  Manutenção sem rota de reteste: volta ao posto de origem; com rota: o 1º da lista; reteste propagado
--       num posto da rota (posto_retorno no registro): o 1º da lista;
--   Q4  terminou (último posto, aprovado) não aparece; posto fora da rota e OP sem rota: o próprio posto;
--   Q5  o filtro de postos vale sobre o pendente; incluir_manutencao = false tira reprovada e Manutenção.

create function public.teste_pp_reg(p_op text, p_sn text, p_posto text, p_status text,
                                    p_retorno text default null, p_origem text default '') returns void
language sql as $f$
  insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas,
                                   posto_retorno, posto_origem)
  values ('PPEND', p_op, p_sn, upper(p_sn), p_posto, p_status, now() - interval '2 days', 1, p_retorno, p_origem)
$f$;

create function public.teste_pp_ler(p_postos text[], p_manut boolean default true) returns text
language sql as $f$
  select coalesce(string_agg(t.op || '/' || t.numero_serie_norm || ':' || t.posto || ':' ||
                             case when t.reprovada then 'R' else 'n' end, ' ' order by t.op, t.numero_serie), '')
    from public.alerta_travados_sns(p_postos, array['PPEND'], now() - interval '1 day', true, p_manut) t
$f$;

do $t$
declare v_todos text[] := array['Inicial', 'Teste', 'Embalagem', 'Almoxarifado', 'Manutenção', 'Fora'];
begin
  perform public.teste_trv_op('PPEND', 'P1');
  perform public.teste_trv_op('PPEND', 'P2', 'ATIVA', false);
  perform public.teste_pp_reg('P1', 'a', 'Inicial', '');
  perform public.teste_pp_reg('P1', 'b', 'Teste', 'Aprovado');
  perform public.teste_pp_reg('P1', 'c', 'Teste', 'Reprovado');
  perform public.teste_pp_reg('P1', 'd', 'Manutenção', '', null, 'Teste');
  perform public.teste_pp_reg('P1', 'e', 'Manutenção', '', 'Inicial,Teste', 'Teste');
  perform public.teste_pp_reg('P1', 'f', 'Inicial', 'Aprovado', 'Teste');
  perform public.teste_pp_reg('P1', 'g', 'Embalagem', '');
  perform public.teste_pp_reg('P1', 'h', 'Almoxarifado', '');
  perform public.teste_pp_reg('P1', 'i', 'Fora', '');
  perform public.teste_pp_reg('P2', 'j', 'Teste', 'Aprovado');

  -- Q1..Q4
  perform public.teste_trv_igual('Q1-Q4', public.teste_pp_ler(v_todos),
    'P1/A:Teste:n P1/B:Embalagem:n P1/C:Teste:R P1/D:Teste:n P1/E:Inicial:n P1/F:Teste:n P1/G:Almoxarifado:n ' ||
    'P1/I:Fora:n P2/J:Teste:n');
  -- Q5
  perform public.teste_trv_igual('Q5 posto pendente', public.teste_pp_ler(array['Embalagem']), 'P1/B:Embalagem:n');
  perform public.teste_trv_igual('Q5 sem Manutenção', public.teste_pp_ler(array['Teste', 'Inicial'], false),
    'P1/A:Teste:n P1/F:Teste:n P2/J:Teste:n');
  raise notice 'Q1-Q5 ok';
end $t$;

select 'parados_posto_pendente_test ok' as resultado;
