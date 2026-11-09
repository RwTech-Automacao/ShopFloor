-- OP com N=50, OP sem N (default), registro sem OP cadastrada
insert into sf_ordens (pmo, op, qtd) values ('PMOT01','1', 5000), ('PMOT02','2', 100);
update sf_ordens set placas_por_painel = 50 where pmo = 'PMOT01';
insert into sf_registros (pmo, op, numero_serie_norm) values
  ('PMOT01','1','A1'), ('PMOT02','2','B1'), ('PMOX99','9','C1');
do $$
begin
  assert (select pecas from sf_registros where numero_serie_norm='A1') = 50, 'N=50 deveria gravar 50';
  assert (select pecas from sf_registros where numero_serie_norm='B1') = 1,  'default 1';
  assert (select pecas from sf_registros where numero_serie_norm='C1') = 1,  'sem OP cadastrada = 1';
  -- editar N depois NÃO reescreve o histórico
  update sf_ordens set placas_por_painel = 10 where pmo='PMOT01';
  assert (select pecas from sf_registros where numero_serie_norm='A1') = 50, 'histórico intacto';
  insert into sf_registros (pmo, op, numero_serie_norm) values ('PMOT01','1','A2');
  assert (select pecas from sf_registros where numero_serie_norm='A2') = 10, 'novo bipe usa N atual';
  -- N inválido recusado
  begin
    update sf_ordens set placas_por_painel = 0 where pmo='PMOT02';
    assert false, 'deveria recusar 0';
  exception when check_violation then null; end;
end $$;
