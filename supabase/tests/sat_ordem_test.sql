-- Testes da 0198 (SAT: ordem de serviço, entrega 1). Roda DEPOIS do sat_motivos_test.sql, na mesma base: as entradas
-- que os testes anteriores deixaram são as "entradas antigas" do backfill. Dados SINTÉTICOS.
-- Runner: supabase/tests/rodar-sat-test.sh

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
create temp table antes_os as select count(*) as entradas from sat_entradas;

\i /tmp/0198.sql
grant all on all tables in schema public to anon, authenticated;

-- 1. Backfill: uma OS por entrada antiga, numeradas na ordem de chegada a partir de 0397/AA (2026) ou 0001/AA
--    (outro ano: sem semente); etapa pela NF; duas linhas de histórico por OS.
do $t$
declare
  v_n        int := (select entradas from antes_os);
  v_ano      int := extract(year from now() at time zone 'America/Sao_Paulo')::int;
  v_primeiro int;
  v_nums     text[];
  i          int;
begin
  v_primeiro := case when v_ano = 2026 then 397 else 1 end;
  if v_n = 0 then raise exception 'FALHOU: os testes anteriores não deixaram entradas'; end if;
  if (select count(*) from sat_ordens) <> v_n then
    raise exception 'FALHOU: backfill criou % OS para % entradas', (select count(*) from sat_ordens), v_n;
  end if;
  select array_agg(o.numero order by e.criado_em, e.id) into v_nums
    from sat_ordens o join sat_entradas e on e.id = o.entrada_id;
  for i in 1 .. v_n loop
    if v_nums[i] <> lpad((v_primeiro + i - 1)::text, 4, '0') || '/' || lpad((v_ano % 100)::text, 2, '0') then
      raise exception 'FALHOU: numeração do backfill %', v_nums;
    end if;
  end loop;
  if (select ultimo from sat_numeracao where ano = v_ano) <> v_primeiro + v_n - 1 then
    raise exception 'FALHOU: sat_numeracao não andou';
  end if;
  if exists (select 1 from sat_ordens o join sat_entradas e on e.id = o.entrada_id join sat_nfs n on n.id = e.nf_id
              where o.etapa <> case when n.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end) then
    raise exception 'FALHOU: etapa do backfill não segue a NF';
  end if;
  if exists (select 1 from sat_ordens o where o.origem <> 'shopfloor' or o.ns_atual = '') then
    raise exception 'FALHOU: origem/NS do backfill';
  end if;
  if (select count(*) from sat_ordem_historico) <> 2 * v_n then raise exception 'FALHOU: histórico do backfill'; end if;
  if exists (select 1 from sat_ordem_historico h where h.evento <> 'etapa'
                or not ((h.etapa_de is null and h.etapa_para = 'recebido')
                        or (h.etapa_de = 'recebido' and h.etapa_para in ('disponivel', 'nota_pendente')))) then
    raise exception 'FALHOU: linhas do histórico do backfill';
  end if;
  raise notice 'backfill: ok';
end $t$;

-- 2. Garantia da planilha → tipo.
do $t$
begin
  if sat__tipo_da_garantia('GARANTIA') is distinct from 'em_garantia'
     or sat__tipo_da_garantia('Em garantia') is distinct from 'em_garantia'
     or sat__tipo_da_garantia('SEM GARANTIA') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('sem garantia') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('Fora da garantia') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('NÃO') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('') is not null
     or sat__tipo_da_garantia(null) is not null
     or sat__tipo_da_garantia('verificar') is not null then
    raise exception 'FALHOU: sat__tipo_da_garantia';
  end if;
  raise notice 'tipo pela garantia: ok';
end $t$;

-- 3. Entrada nova cria a OS pelo gatilho: ticket com garantia → tipo; NF reprovada → nota pendente.
set role service_role;
select sat_sincronizar_planilha($j$[
  {"chave": "T-OS-1", "numero": "900", "data": "2026-11-01", "solucao": "Envio ao SAT", "garantia": "GARANTIA",
   "itens": [{"chave": "o1", "ns": "610-1", "modelo": "610", "sequencia": "1"}]},
  {"chave": "T-OS-2", "numero": "901", "data": "2026-11-02", "solucao": "Envio ao SAT", "garantia": "SEM GARANTIA",
   "itens": [{"chave": "o2", "ns": "610-2", "modelo": "610", "sequencia": "2"}]}
]$j$);
reset role;

do $t$
declare r jsonb; v_antes int := (select count(*) from sat_ordens); v_o sat_ordens;
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  r := sat_registrar_nf(jsonb_build_object('numero', 'NF-OS-1', 'cnpj', '12345678000190', 'empresa', 'Cliente OS',
         'situacao', 'aprovada', 'relogios', jsonb_build_array(
           jsonb_build_object('ns', '610-1', 'modelo', '610', 'sequencia', '1', 'produto', 'PMOC31'),
           jsonb_build_object('ns', '610-2', 'modelo', '610', 'sequencia', '2', 'produto', 'PMOC31'),
           jsonb_build_object('ns', '610-3', 'modelo', '610', 'sequencia', '3', 'produto', 'PMOC31'))));
  reset role;
  if (select count(*) from sat_ordens) <> v_antes + 3 then raise exception 'FALHOU: gatilho não criou 3 OS'; end if;

  select * into v_o from sat_ordens where sequencia = '1' and modelo = '610';
  if v_o.etapa <> 'disponivel' or v_o.tipo is distinct from 'em_garantia' or v_o.garantia <> 'GARANTIA'
     or v_o.ticket_numero <> '900' or v_o.cliente <> 'Cliente OS' or v_o.cnpj <> '12.345.678/0001-90'
     or v_o.produto <> 'PMOC31' or v_o.ns_atual <> '610-1' then
    raise exception 'FALHOU: OS do 610-1 %', row_to_json(v_o);
  end if;
  if (select tipo from sat_ordens where sequencia = '2' and modelo = '610') is distinct from 'fora_garantia' then
    raise exception 'FALHOU: OS do 610-2 devia ser fora da garantia';
  end if;
  if (select tipo from sat_ordens where sequencia = '3' and modelo = '610') is not null then
    raise exception 'FALHOU: OS sem ticket devia ter garantia a definir';
  end if;
  -- números seguidos, na ordem dos relógios
  if (select array_agg(split_part(numero, '/', 1)::int order by split_part(numero, '/', 1)::int)
        from sat_ordens where modelo = '610') <>
     (select array_agg(x) from generate_series(
        (select min(split_part(numero, '/', 1)::int) from sat_ordens where modelo = '610'),
        (select min(split_part(numero, '/', 1)::int) from sat_ordens where modelo = '610') + 2) x) then
    raise exception 'FALHOU: números das 3 OS não são seguidos';
  end if;

  set local role authenticated;
  r := sat_registrar_nf(jsonb_build_object('numero', 'NF-OS-2', 'cnpj', '12345678000190', 'empresa', 'Cliente OS',
         'situacao', 'reprovada', 'motivos', jsonb_build_array((select id from sat_motivos_nf where texto = 'CFOP errado')),
         'relogios', jsonb_build_array(jsonb_build_object('ns', '611-1', 'modelo', '611', 'sequencia', '1'))));
  reset role;
  if (select etapa from sat_ordens where modelo = '611' and sequencia = '1') <> 'nota_pendente' then
    raise exception 'FALHOU: NF reprovada devia deixar a OS em nota pendente';
  end if;
  raise notice 'OS criada na entrada: ok';
end $t$;

-- 4. RLS: sem sat.visualizar não vê nada; ninguém grava direto nas tabelas.
do $t$
declare v int;
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.registrar_entrada,sat.manutencao,sat.administrar', false);
  select count(*) into v from sat_ordens;
  if v <> 0 then raise exception 'FALHOU: sem visualizar viu % OS', v; end if;
  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao,sat.administrar', false);
  select count(*) into v from sat_ordens;
  if v = 0 then raise exception 'FALHOU: com visualizar não viu as OS'; end if;
  begin
    update sat_ordens set etapa = 'qualidade';
    if exists (select 1 from sat_ordens where etapa = 'qualidade') then raise exception 'FALHOU: update direto passou'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into sat_defeitos (descricao) values ('Direto');
    raise exception 'FALHOU: insert direto em sat_defeitos passou';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sat__criar_ordem((select id from sat_entradas limit 1));
    raise exception 'FALHOU: authenticated chamou sat__criar_ordem';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'RLS: ok';
end $t$;
