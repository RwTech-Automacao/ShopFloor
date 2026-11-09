-- Roda depois da 0176 (aplicada 2x) sobre compels_ops_novas_test.sql.
\set ON_ERROR_STOP on
do $t$
declare v boolean; n int;
begin
  select count(*) into n from public.sf_ordens where integrar_compels is not false;
  if n <> 0 then raise exception 'FALHOU T1: % OP(s) existente(s) não ficaram false', n; end if;
  raise notice 'T1 OPs existentes ficam false: ok';

  insert into public.sf_ordens (pmo, op) values ('PMOB', '2001');
  select integrar_compels into v from public.sf_ordens where pmo = 'PMOB' and op = '2001';
  if v is distinct from true then raise exception 'FALHOU T2: OP nova nasceu %', v; end if;
  raise notice 'T2 OP nova nasce true: ok';

  insert into public.sf_ordens (pmo, op, integrar_compels) values ('PMOB', '2002', false);
  select integrar_compels into v from public.sf_ordens where pmo = 'PMOB' and op = '2002';
  if v is distinct from false then raise exception 'FALHOU T3: false explícito não vale'; end if;
  raise notice 'T3 false explícito vale: ok';

  select count(*) into n from public.sf_ordens where pmo = 'PMOA' and integrar_compels;
  if n <> 0 then raise exception 'FALHOU T4: a reaplicação mexeu nas antigas'; end if;
  raise notice 'T4 antigas seguem false: ok';
end $t$;
