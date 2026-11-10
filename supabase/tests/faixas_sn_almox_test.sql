-- 0181 na entrada do Almoxarifado: roda no fim da suíte do Almoxarifado (PLACAS=1), por cima da 0175
-- vigente, com os dados que a suíte deixou. PMOI01/9000 (individual) tem a faixa 1000–1100 (backfill).
select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);
insert into public.sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim)
select id, 2, '5000', '5010' from public.sf_ordens where pmo = 'PMOI01' and op = '9000'
on conflict do nothing;
do $t$
declare r jsonb;
begin
  if (select count(*) from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id where o.pmo = 'PMOI01') <> 2 then
    raise exception 'FALHOU: premissa, PMOI01 com duas faixas'; end if;
  -- série da SEGUNDA faixa passa da checagem de faixa (para na Embalagem, que ela não fez)
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '5005', 'serie', 1, '5005');
  if r->>'motivo' <> 'serie_sem_embalagem' then
    raise exception 'FALHOU: série da faixa 2 tinha que passar da faixa: %', r; end if;
  -- fora das duas: recusa, e a mensagem mostra as duas faixas
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '9999', 'serie', 1, '9999');
  if r->>'motivo' <> 'serie_fora_da_faixa'
     or r->>'detalhe' <> 'A série 9999 está fora da faixa da OP (1000 a 1100; 5000 a 5010).' then
    raise exception 'FALHOU: fora das duas faixas: %', r; end if;
  -- OP sem faixa continua sem julgar a série
  r := sf_almoxarifado_entrada('PMOI02', '9001', 'Almoxarifado', 'Ana', '7778', 'serie', 1, '7778');
  if r->>'motivo' = 'serie_fora_da_faixa' then
    raise exception 'FALHOU: OP sem faixa recusou por faixa: %', r; end if;
  raise notice '0181: entrada do Almoxarifado com duas faixas: ok';
end $t$;
