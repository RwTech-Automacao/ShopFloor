-- Burn-in: aprovados_primeira conta a SAÍDA, não a entrada (status vazio). Outros postos não mudam.
do $t$
declare r record;
begin
  select * into r from public.sf_fluxo_op('P1','1') where posto = 'Burn-in';
  if r.aprovados_primeira <> 2 then raise exception 'Burn-in: aprovados_primeira=% (esperado 2)', r.aprovados_primeira; end if;
  select * into r from public.sf_fluxo_op('P1','1') where posto = 'Teste';
  if r.aprovados_primeira <> 1 then raise exception 'Teste: aprovados_primeira=% (esperado 1)', r.aprovados_primeira; end if;
  select * into r from public.sf_fluxo_op('P1','1') where posto = 'Burn-in';
  if r.passou_distinto <> 2 or r.registros <> 4 then raise exception 'Burn-in: passou=% registros=%', r.passou_distinto, r.registros; end if;
  raise notice 'OK fluxo_burnin_primeira';
end $t$;
