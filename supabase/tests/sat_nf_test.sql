-- Testes da 0187 (SAT: entrada por NF). Roda DEPOIS do sat_test.sql, na mesma base (as entradas que ele deixou
-- são os "dados antigos" que a 0187 migra). Dados SINTÉTICOS. Runner: supabase/tests/rodar-sat-test.sh

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

create temp table antes as
select (select count(*) from sat_entradas) as entradas,
       (select count(*) from sat_entradas_historico) as historico,
       (select count(*) from sat_entradas where nf_situacao = 'reprovada') as reprovadas;

\i /tmp/0187.sql
grant all on all tables in schema public to anon, authenticated;

-- 1. Migração dos dados antigos: uma nota por entrada (mesmo id), histórico copiado, colunas da nota saíram.
do $t$
declare a record;
begin
  select * into a from antes;
  if a.entradas = 0 then raise exception 'FALHOU: o sat_test.sql não deixou entradas para migrar'; end if;
  if (select count(*) from sat_nfs) <> a.entradas then raise exception 'FALHOU: notas % <> entradas %', (select count(*) from sat_nfs), a.entradas; end if;
  if exists (select 1 from sat_entradas where nf_id is distinct from id) then raise exception 'FALHOU: entrada antiga não aponta para a própria nota'; end if;
  if (select count(*) from sat_historico) <> a.historico then raise exception 'FALHOU: histórico copiado errado'; end if;
  if (select count(*) from sat_nfs where situacao = 'reprovada' and cardinality(motivos) > 0) <> a.reprovadas then
    raise exception 'FALHOU: situação/motivos não vieram para a nota';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'sat_entradas'
              and column_name in ('nf', 'valor', 'empresa', 'cnpj', 'frete', 'custo', 'defeito', 'nf_situacao', 'nf_motivos')) then
    raise exception 'FALHOU: sobrou coluna da nota em sat_entradas';
  end if;
  if to_regclass('public.sat_entradas_historico') is not null then raise exception 'FALHOU: histórico antigo não saiu'; end if;
  if to_regprocedure('public.sat_registrar_entrada(jsonb)') is not null
     or to_regprocedure('public.sat_motivo_salvar(uuid,text,boolean)') is not null then
    raise exception 'FALHOU: função antiga não saiu';
  end if;
  raise notice 'migração dos dados antigos: ok';
end $t$;

-- Cenário: NS 600/1 tem 3 OS — antiga que volta (A), recente de envio de peça (B), recente que volta (C);
-- NS 600/2 só tem envio de peça; NS 600/3 tem uma OS que volta (D).
set role service_role;
select sat_sincronizar_planilha($j$[
  {"chave": "T-A", "numero": "700", "data": "2026-01-01", "solucao": "Envio ao SAT", "defeito": "tela", "garantia": "GARANTIA",
   "itens": [{"chave": "a", "ns": "600-1", "modelo": "600", "sequencia": "1"}]},
  {"chave": "T-B", "numero": "702", "data": "2026-03-01", "solucao": "Envio de Peça para o Cliente",
   "itens": [{"chave": "b", "ns": "600-1", "modelo": "600", "sequencia": "1"}, {"chave": "b2", "ns": "600-2", "modelo": "600", "sequencia": "2"}]},
  {"chave": "T-C", "numero": "701", "data": "2026-02-01", "solucao": "Troca do Relógio", "defeito": "não liga",
   "itens": [{"chave": "c", "ns": "600-1", "modelo": "600", "sequencia": "1"}]},
  {"chave": "T-D", "numero": "703", "data": "2026-02-10", "solucao": "ENVIO AO SAT",
   "itens": [{"chave": "d", "ns": "600-3", "modelo": "600", "sequencia": "3"}]}
]$j$);
reset role;
insert into sat_motivos_nf (texto) values ('Sem CFOP de remessa') on conflict do nothing;

-- 2. Registrar: permissão, validações, OS automática (só as que voltam, a mais recente, livre), um relógio por OS.
do $t$
declare r jsonb; v_motivo uuid := (select id from sat_motivos_nf where texto = 'Sem CFOP de remessa');
  v_ok jsonb := jsonb_build_object('numero', 'NF-1', 'cnpj', '12345678000190', 'empresa', 'Empresa Teste', 'valor', '150.5',
    'situacao', 'aprovada', 'motivos', '[]'::jsonb, 'relogios', jsonb_build_array(
      jsonb_build_object('ns', '600-1', 'modelo', '600', 'sequencia', '1', 'produto', 'PMOC31', 'itens_junto', '["bobina"]'::jsonb, 'locacao', 'P1'),
      jsonb_build_object('ns', '600-2', 'modelo', '600', 'sequencia', '2', 'itens_junto', '[]'::jsonb)));
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar', false);
  begin perform sat_registrar_nf(v_ok); raise exception 'FALHOU: registrou sem registrar_entrada';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  begin perform sat_registrar_nf(v_ok || '{"cnpj": "123"}'); raise exception 'FALHOU: aceitou CNPJ inválido';
  exception when raise_exception then if sqlerrm <> 'CNPJ_INVALIDO' then raise; end if; end;
  begin perform sat_registrar_nf(v_ok || '{"relogios": []}'); raise exception 'FALHOU: aceitou nota sem relógio';
  exception when raise_exception then if sqlerrm <> 'SEM_RELOGIOS' then raise; end if; end;
  begin perform sat_registrar_nf(v_ok || '{"numero": " "}'); raise exception 'FALHOU: aceitou NF vazia';
  exception when raise_exception then if sqlerrm <> 'NF_OBRIGATORIA' then raise; end if; end;
  begin
    perform sat_registrar_nf(v_ok || jsonb_build_object('relogios', jsonb_build_array(
      jsonb_build_object('ns', '600-1', 'modelo', '600', 'sequencia', '1'),
      jsonb_build_object('ns', '00043006000000001', 'modelo', '600', 'sequencia', '1'))));
    raise exception 'FALHOU: aceitou o mesmo NS duas vezes na nota';
  exception when raise_exception then if sqlerrm <> 'NS_REPETIDO' then raise; end if; end;
  begin perform sat_registrar_nf(v_ok || '{"situacao": "reprovada"}'); raise exception 'FALHOU: reprovada sem motivo';
  exception when raise_exception then if sqlerrm <> 'MOTIVO_OBRIGATORIO' then raise; end if; end;
  if exists (select 1 from sat_nfs where numero = 'NF-1') then raise exception 'FALHOU: erro deixou nota gravada'; end if;

  r := sat_registrar_nf(v_ok);
  if r->'relogios'->0->>'os_numero' <> '701' then raise exception 'FALHOU: 600/1 tinha que pegar a OS 701 (mais recente que volta), pegou %', r; end if;
  if r->'relogios'->1->>'os_numero' <> '' then raise exception 'FALHOU: 600/2 só tem envio de peça, ficou com %', r; end if;
  if not exists (select 1 from sat_nfs where numero = 'NF-1' and cnpj = '12.345.678/0001-90' and valor = 150.50
                   and responsavel_nome = 'Sérgio SAT') then
    raise exception 'FALHOU: nota gravada errada';
  end if;
  if (select count(*) from sat_entradas where nf_id = (r->>'nf_id')::uuid) <> 2 then raise exception 'FALHOU: relógios não gravaram'; end if;
  if not exists (select 1 from sat_entradas where ns_escrito = '600-1' and produto = 'PMOC31' and locacao = 'P1'
                   and itens_junto = '{bobina}') then
    raise exception 'FALHOU: dados do relógio';
  end if;

  -- 2ª visita do 600/1: a 701 está em uso → pega a 700 (a próxima que volta); a 3ª fica sem OS
  r := sat_registrar_nf(v_ok || jsonb_build_object('numero', 'NF-2', 'relogios', jsonb_build_array(
         jsonb_build_object('ns', '600-1', 'modelo', '600', 'sequencia', '1'))));
  if r->'relogios'->0->>'os_numero' <> '700' then raise exception 'FALHOU: 2ª visita tinha que pegar a 700, pegou %', r; end if;
  r := sat_registrar_nf(v_ok || jsonb_build_object('numero', 'NF-3', 'relogios', jsonb_build_array(
         jsonb_build_object('ns', '600-1', 'modelo', '600', 'sequencia', '1'))));
  if r->'relogios'->0->>'os_numero' <> '' then raise exception 'FALHOU: 3ª visita reaproveitou OS %', r; end if;

  -- CPF também vale
  r := sat_registrar_nf(v_ok || jsonb_build_object('numero', 'NF-4', 'cnpj', '123.456.789-09', 'situacao', 'reprovada',
         'motivos', jsonb_build_array(v_motivo), 'relogios', jsonb_build_array(jsonb_build_object('ns', 'XYZ'))));
  if not exists (select 1 from sat_nfs where numero = 'NF-4' and cnpj = '123.456.789-09' and motivos = '{Sem CFOP de remessa}') then
    raise exception 'FALHOU: nota com CPF / reprovada';
  end if;
  reset role;
  raise notice 'registrar nota com relógios e OS automática: ok';
end $t$;

-- 3. Corrigir e trocar valem para a nota inteira; histórico.
do $t$
declare r jsonb; v_nf uuid := (select id from sat_nfs where numero = 'NF-1');
  v_motivo uuid := (select id from sat_motivos_nf where texto = 'Sem CFOP de remessa');
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  begin perform sat_corrigir_nf(v_nf, 'reprovada', array[v_motivo]); raise exception 'FALHOU: corrigiu sem aprovar_nf';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  r := sat_corrigir_nf(v_nf, 'reprovada', array[v_motivo]);
  if r->>'situacao_de' <> 'aprovada' or r->>'situacao_para' <> 'reprovada' or jsonb_array_length(r->'ns') <> 2 then
    raise exception 'FALHOU: retorno da correção %', r;
  end if;
  begin perform sat_corrigir_nf(v_nf, 'reprovada', array[v_motivo]); raise exception 'FALHOU: correção igual passou';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  begin perform sat_trocar_nf(v_nf, '{"numero": "nf-1", "cnpj": "12345678000190", "situacao": "aprovada"}');
    raise exception 'FALHOU: trocou pela mesma nota';
  exception when raise_exception then if sqlerrm <> 'MESMA_NF' then raise; end if; end;

  r := sat_trocar_nf(v_nf, '{"numero": "NF-1B", "cnpj": "98765432000110", "empresa": "Outra", "valor": "10", "situacao": "aprovada"}');
  if r->>'numero_de' <> 'NF-1' or r->>'numero_para' <> 'NF-1B' or r->>'empresa' <> 'Outra' then raise exception 'FALHOU: retorno da troca %', r; end if;
  if not exists (select 1 from sat_nfs where id = v_nf and numero = 'NF-1B' and cnpj = '98.765.432/0001-10'
                   and situacao = 'aprovada' and motivos = '{}') then
    raise exception 'FALHOU: troca não gravou';
  end if;
  -- (no teste tudo cai na mesma transação = mesmo `em`: compara o conjunto, não a ordem)
  if (select array_agg(tipo order by tipo) from sat_historico where nf_id = v_nf) is distinct from
     array['correcao', 'entrada', 'troca'] then
    raise exception 'FALHOU: histórico da nota %', (select array_agg(tipo) from sat_historico where nf_id = v_nf);
  end if;
  reset role;
  raise notice 'corrigir/trocar a nota inteira: ok';
end $t$;

-- 4. Associar OS (técnico): permissão, OS de outro NS, OS em uso, sem OS, histórico.
do $t$
declare r jsonb;
  v_ent uuid := (select e.id from sat_entradas e join sat_nfs n on n.id = e.nf_id where n.numero = 'NF-3');
  v_os_d uuid := (select id from sat_os where chave = 'T-D');
  v_os_a uuid := (select id from sat_os where chave = 'T-A');
  v_os_b uuid := (select id from sat_os where chave = 'T-B');
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  begin perform sat_associar_os(v_ent, v_os_b); raise exception 'FALHOU: associou sem associar_os';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.associar_os', false);
  begin perform sat_associar_os(v_ent, v_os_d); raise exception 'FALHOU: associou OS de outro NS';
  exception when raise_exception then if sqlerrm <> 'OS_DE_OUTRO_NS' then raise; end if; end;
  begin perform sat_associar_os(v_ent, v_os_a); raise exception 'FALHOU: associou OS em uso';
  exception when raise_exception then if sqlerrm <> 'OS_EM_USO' then raise; end if; end;
  begin perform sat_associar_os(v_ent, null); raise exception 'FALHOU: "sem OS" para quem já está sem OS passou';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;

  -- o técnico pode ligar uma OS de envio de peça (a regra automática não liga, ele decide)
  r := sat_associar_os(v_ent, v_os_b);
  if r->>'os_para' <> '702' then raise exception 'FALHOU: retorno %', r; end if;
  if not exists (select 1 from sat_entradas where id = v_ent and os_id = v_os_b and os_numero = '702') then
    raise exception 'FALHOU: OS não foi ligada';
  end if;
  r := sat_associar_os(v_ent, null);
  if exists (select 1 from sat_entradas where id = v_ent and os_id is not null) then raise exception 'FALHOU: sem OS'; end if;
  if (select count(*) from sat_historico where entrada_id = v_ent and tipo = 'os') <> 2 then
    raise exception 'FALHOU: histórico da OS';
  end if;
  reset role;
  raise notice 'associar OS: ok';
end $t$;

-- 5. RLS das tabelas novas; escrita direta do authenticated não passa.
do $t$
declare n int;
begin
  set local role authenticated;
  perform set_config('teste.perms', 'faturamento.visualizar', false);
  select count(*) into n from sat_nfs;
  if n <> 0 then raise exception 'FALHOU: leu notas sem sat.visualizar'; end if;
  select count(*) into n from sat_historico;
  if n <> 0 then raise exception 'FALHOU: leu histórico sem sat.visualizar'; end if;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada,sat.aprovar_nf,sat.associar_os', false);
  select count(*) into n from sat_nfs;
  if n = 0 then raise exception 'FALHOU: com sat.visualizar não leu as notas'; end if;
  begin
    update sat_nfs set situacao = 'aprovada', motivos = '{}';
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FALHOU: authenticated escreveu direto em sat_nfs'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform sat__os_automatica('600', '1');
    raise exception 'FALHOU: authenticated chamou função interna';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'RLS das tabelas novas: ok';
end $t$;
