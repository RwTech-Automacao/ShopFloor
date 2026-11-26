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
     or sat__tipo_da_garantia('SEM  GARANTIA') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('  fora   da  garantia ') is distinct from 'fora_garantia'
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

-- 5. NF corrigida/trocada move a OS: reprovada → aprovada leva nota_pendente → disponivel; aprovada → reprovada
--    devolve só quem ainda está disponível (a OS em manutenção não se mexe). Cliente/CNPJ seguem a nota trocada.
do $t$
declare
  v_nf   uuid;
  v_os   uuid;
  v_cfop uuid := (select id from sat_motivos_nf where texto = 'CFOP errado');
begin
  select e.nf_id, o.id into v_nf, v_os from sat_ordens o join sat_entradas e on e.id = o.entrada_id
   where o.modelo = '611' and o.sequencia = '1';

  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  perform sat_corrigir_nf(v_nf, 'aprovada', '{}'::uuid[], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'disponivel' then raise exception 'FALHOU: corrigir não liberou a OS'; end if;
  if not exists (select 1 from sat_ordem_historico h where h.ordem_id = v_os and h.evento = 'etapa'
                    and h.etapa_de = 'nota_pendente' and h.etapa_para = 'disponivel'
                    and h.dados->>'nf_situacao' = 'aprovada' and h.usuario_nome = 'Sérgio SAT') then
    raise exception 'FALHOU: histórico da liberação pela NF';
  end if;

  set local role authenticated;
  perform sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'nota_pendente' then raise exception 'FALHOU: reprovar não voltou a OS'; end if;

  set local role authenticated;
  perform sat_trocar_nf(v_nf, jsonb_build_object('numero', 'NF-OS-2B', 'cnpj', '98765432000110', 'empresa', 'Cliente Novo',
                                                 'situacao', 'aprovada'));
  reset role;
  if (select etapa || '|' || cliente || '|' || cnpj from sat_ordens where id = v_os) <> 'disponivel|Cliente Novo|98.765.432/0001-10' then
    raise exception 'FALHOU: trocar NF (etapa/cliente/cnpj) %', (select row_to_json(o) from sat_ordens o where id = v_os);
  end if;

  -- em manutenção não volta
  update sat_ordens set etapa = 'em_manutencao' where id = v_os;
  set local role authenticated;
  perform sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'em_manutencao' then raise exception 'FALHOU: OS em manutenção voltou'; end if;
  update sat_ordens set etapa = 'nota_pendente' where id = v_os;
  raise notice 'etapa pela NF: ok';
end $t$;

-- 6. Garantia: a planilha muda a garantia do ticket → o tipo acompanha (com histórico 'garantia');
--    o técnico troca o ticket → idem; OS na qualidade não muda mais.
do $t$
declare v_os uuid; v_os2 uuid; v_ent uuid;
begin
  select o.id, o.entrada_id into v_os, v_ent from sat_ordens o where o.modelo = '610' and o.sequencia = '3';
  select o.id into v_os2 from sat_ordens o where o.modelo = '610' and o.sequencia = '1';

  -- o cron da planilha não tem usuário: sem auth.uid() o histórico diz 'planilha'
  perform set_config('teste.uid', '', false);
  set role service_role;
  perform sat_sincronizar_planilha($j$[
    {"chave": "T-OS-1", "numero": "900", "garantia": "SEM GARANTIA"},
    {"chave": "T-OS-3", "numero": "902", "data": "2026-11-03", "solucao": "Envio ao SAT", "garantia": "GARANTIA",
     "itens": [{"chave": "o3", "ns": "610-3", "modelo": "610", "sequencia": "3"}]}
  ]$j$);
  reset role;
  if (select tipo from sat_ordens where id = v_os2) is distinct from 'fora_garantia' then
    raise exception 'FALHOU: garantia da planilha não mudou o tipo';
  end if;
  if not exists (select 1 from sat_ordem_historico h where h.ordem_id = v_os2 and h.evento = 'garantia'
                    and h.dados->>'tipo_de' = 'em_garantia' and h.dados->>'tipo_para' = 'fora_garantia'
                    and h.usuario_nome = 'planilha') then
    raise exception 'FALHOU: histórico da garantia pela planilha';
  end if;
  perform set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.associar_os', false);
  perform sat_associar_os(v_ent, (select id from sat_os where chave = 'T-OS-3'));
  reset role;
  if (select tipo || '|' || ticket_numero || '|' || garantia from sat_ordens where id = v_os) <> 'em_garantia|902|GARANTIA' then
    raise exception 'FALHOU: trocar o ticket não trouxe a garantia';
  end if;

  update sat_ordens set etapa = 'qualidade' where id = v_os;
  set role service_role;
  perform sat_sincronizar_planilha($j$[{"chave": "T-OS-3", "numero": "902", "garantia": "SEM GARANTIA"}]$j$);
  reset role;
  if (select tipo from sat_ordens where id = v_os) <> 'em_garantia' then raise exception 'FALHOU: OS na qualidade mudou de tipo'; end if;
  update sat_ordens set etapa = 'disponivel' where id = v_os;
  set role service_role;
  perform sat_sincronizar_planilha($j$[{"chave": "T-OS-3", "numero": "902", "garantia": "GARANTIA"}]$j$);
  reset role;
  raise notice 'garantia pelo ticket: ok';
end $t$;

-- 7. Manutenção: permissão, etapa, defeitos, peças, laudo, troca de NS e envio para a qualidade.
insert into sat_defeitos (codigo_compels, descricao) values ('T1', 'Não liga'), ('T2', 'Display apagado');
insert into sat_defeitos (codigo_compels, descricao, ativo) values ('T3', 'Defeito antigo', false);

do $t$
declare
  v_os    uuid := (select id from sat_ordens where modelo = '610' and sequencia = '3');   -- em garantia, disponível
  v_fora  uuid := (select id from sat_ordens where modelo = '610' and sequencia = '1');   -- fora da garantia
  v_pend  uuid := (select id from sat_ordens where modelo = '611' and sequencia = '1');   -- nota pendente
  v_d1    uuid := (select id from sat_defeitos where codigo_compels = 'T1');
  v_d3    uuid := (select id from sat_defeitos where codigo_compels = 'T3');
  v_item  uuid;
  v_peca  uuid;
  r       jsonb;
begin
  set local role authenticated;

  -- sem sat.manutencao
  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  begin perform sat_ordem_iniciar_manutencao(v_os); raise exception 'FALHOU: iniciar sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, 'x'); raise exception 'FALHOU: defeito_adicionar sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_defeito_remover(gen_random_uuid()); raise exception 'FALHOU: defeito_remover sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_peca_adicionar(v_os, 'ABC', 'x', 1); raise exception 'FALHOU: peca_adicionar sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_peca_remover(gen_random_uuid()); raise exception 'FALHOU: peca_remover sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_laudo_salvar(v_os, 'x'); raise exception 'FALHOU: laudo sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_trocar_ns(v_os, '{"ns":"X"}'::jsonb); raise exception 'FALHOU: trocar_ns sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  begin perform sat_ordem_enviar_qualidade(v_os); raise exception 'FALHOU: enviar sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  -- nota pendente não abre manutenção; OS inexistente
  begin perform sat_ordem_iniciar_manutencao(v_pend); raise exception 'FALHOU: iniciou com nota pendente';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;
  begin perform sat_ordem_iniciar_manutencao(gen_random_uuid()); raise exception 'FALHOU: iniciou OS inexistente';
  exception when raise_exception then if sqlerrm <> 'ORDEM_NAO_ENCONTRADA' then raise; end if; end;
  -- disponível ainda não aceita defeito
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, 'troca'); raise exception 'FALHOU: defeito antes de iniciar';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;

  r := sat_ordem_iniciar_manutencao(v_os);
  if (select etapa || '|' || tecnico_nome from sat_ordens where id = v_os) <> 'em_manutencao|Sérgio SAT' then
    raise exception 'FALHOU: iniciar manutenção %', r;
  end if;

  -- defeitos
  begin perform sat_ordem_defeito_adicionar(v_os, v_d3, 'x'); raise exception 'FALHOU: defeito inativo';
  exception when raise_exception then if sqlerrm <> 'DEFEITO_INVALIDO' then raise; end if; end;
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, '   '); raise exception 'FALHOU: solução vazia';
  exception when raise_exception then if sqlerrm <> 'SOLUCAO_OBRIGATORIA' then raise; end if; end;
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, repeat('x', 2001)); raise exception 'FALHOU: solução longa';
  exception when raise_exception then if sqlerrm <> 'TEXTO_LONGO' then raise; end if; end;
  v_item := sat_ordem_defeito_adicionar(v_os, v_d1, '  Trocada a fonte  ');
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, 'de novo'); raise exception 'FALHOU: defeito repetido';
  exception when raise_exception then if sqlerrm <> 'DEFEITO_REPETIDO' then raise; end if; end;
  if (select defeito_descricao || '|' || solucao || '|' || origem from sat_ordem_defeitos where id = v_item)
     <> 'Não liga|Trocada a fonte|manutencao' then
    raise exception 'FALHOU: defeito gravado errado';
  end if;
  perform sat_ordem_defeito_remover(v_item);
  if exists (select 1 from sat_ordem_defeitos where id = v_item) then raise exception 'FALHOU: remover defeito'; end if;
  v_item := sat_ordem_defeito_adicionar(v_os, v_d1, 'Trocada a fonte');

  -- peças
  begin perform sat_ordem_peca_adicionar(v_os, 'prt 1', 'x', 1); raise exception 'FALHOU: código com espaço';
  exception when raise_exception then if sqlerrm <> 'CODIGO_INVALIDO' then raise; end if; end;
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE74', 'x', 0); raise exception 'FALHOU: quantidade zero';
  exception when raise_exception then if sqlerrm <> 'QUANTIDADE_INVALIDA' then raise; end if; end;
  v_peca := sat_ordem_peca_adicionar(v_os, ' pmoe74 ', ' Módulo Camabio com cabo ', 1);
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE74', '', 2); raise exception 'FALHOU: peça repetida';
  exception when raise_exception then if sqlerrm <> 'PECA_REPETIDA' then raise; end if; end;
  if (select codigo || '|' || descricao || '|' || quantidade::text || '|' || situacao from sat_ordem_pecas where id = v_peca)
     <> 'PMOE74|Módulo Camabio com cabo|1.000|trocada' then
    raise exception 'FALHOU: peça gravada errada';
  end if;
  perform sat_ordem_peca_adicionar(v_os, 'PRT706', 'Placa', 1);
  perform sat_ordem_peca_remover((select id from sat_ordem_pecas where ordem_id = v_os and codigo = 'PRT706'));
  if exists (select 1 from sat_ordem_pecas where ordem_id = v_os and codigo = 'PRT706') then raise exception 'FALHOU: remover peça'; end if;
  begin perform sat_ordem_peca_remover(gen_random_uuid()); raise exception 'FALHOU: remover peça inexistente';
  exception when raise_exception then if sqlerrm <> 'ITEM_NAO_ENCONTRADO' then raise; end if; end;

  -- sem laudo não vai para a qualidade
  begin perform sat_ordem_enviar_qualidade(v_os); raise exception 'FALHOU: enviou sem laudo';
  exception when raise_exception then if sqlerrm <> 'SEM_LAUDO' then raise; end if; end;
  begin perform sat_ordem_laudo_salvar(v_os, repeat('x', 4001)); raise exception 'FALHOU: laudo longo';
  exception when raise_exception then if sqlerrm <> 'TEXTO_LONGO' then raise; end if; end;
  perform sat_ordem_laudo_salvar(v_os, '  Fonte queimada; trocado o módulo.  ');
  perform sat_ordem_laudo_salvar(v_os, 'Fonte queimada; trocado o módulo.');   -- igual: não grava histórico de novo
  if (select laudo from sat_ordens where id = v_os) <> 'Fonte queimada; trocado o módulo.' then raise exception 'FALHOU: laudo'; end if;
  if (select count(*) from sat_ordem_historico where ordem_id = v_os and evento = 'laudo') <> 1 then
    raise exception 'FALHOU: laudo igual gravou histórico';
  end if;

  -- troca de NS
  begin perform sat_ordem_trocar_ns(v_os, '{"ns": "  "}'::jsonb); raise exception 'FALHOU: NS vazio';
  exception when raise_exception then if sqlerrm <> 'NS_OBRIGATORIO' then raise; end if; end;
  begin perform sat_ordem_trocar_ns(v_os, '{"ns": "610-3", "modelo": "610", "sequencia": "3"}'::jsonb);
    raise exception 'FALHOU: troca para o mesmo NS';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  r := sat_ordem_trocar_ns(v_os, '{"ns": "610-99", "modelo": "610", "sequencia": "99"}'::jsonb);
  if (select ns_atual || '|' || modelo || '|' || sequencia from sat_ordens where id = v_os) <> '610-99|610|99'
     or not exists (select 1 from sat_ordem_ns where ordem_id = v_os and ns_antigo = '610-3' and sequencia_antigo = '3'
                      and ns_novo = '610-99' and sequencia_novo = '99') then
    raise exception 'FALHOU: troca de NS %', r;
  end if;

  -- fora da garantia não vai para a qualidade nesta entrega
  reset role;
  update sat_ordens set etapa = 'em_manutencao' where id = v_fora;
  insert into sat_ordem_defeitos (ordem_id, defeito_id, defeito_descricao, origem, solucao)
  values (v_fora, v_d1, 'Não liga', 'manutencao', 'x');
  update sat_ordens set laudo = 'ok' where id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: fora da garantia foi para a qualidade';
  exception when raise_exception then if sqlerrm <> 'FORA_DA_GARANTIA' then raise; end if; end;
  reset role;
  update sat_ordens set tipo = null where id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: garantia indefinida foi para a qualidade';
  exception when raise_exception then if sqlerrm <> 'GARANTIA_INDEFINIDA' then raise; end if; end;
  reset role;
  update sat_ordens set tipo = 'em_garantia' where id = v_fora;
  delete from sat_ordem_defeitos where ordem_id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: enviou sem defeito';
  exception when raise_exception then if sqlerrm <> 'SEM_DEFEITO' then raise; end if; end;

  -- em garantia, com defeito e laudo: vai
  r := sat_ordem_enviar_qualidade(v_os);
  if (select etapa from sat_ordens where id = v_os) <> 'qualidade' then raise exception 'FALHOU: não foi para a qualidade %', r; end if;
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE12', 'Kit sensor', 1); raise exception 'FALHOU: peça depois da qualidade';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;
  reset role;

  -- histórico: iniciar, defeitos (+/-), peças (+/-), laudo, NS e o envio
  if (select string_agg(evento || coalesce(':' || etapa_para, ''), ',' order by seq)
        from sat_ordem_historico where ordem_id = v_os and seq >= (select min(seq) from sat_ordem_historico h2
                                                                     where h2.ordem_id = v_os and h2.etapa_para = 'em_manutencao'))
     <> 'etapa:em_manutencao,defeito,defeito,defeito,peca,peca,peca,laudo,ns,etapa:qualidade' then
    raise exception 'FALHOU: eventos da manutenção %', (select string_agg(evento, ',' order by seq) from sat_ordem_historico where ordem_id = v_os);
  end if;
  update sat_ordens set etapa = 'disponivel', tipo = 'fora_garantia', laudo = '' where id = v_fora;
  raise notice 'manutenção: ok';
end $t$;

-- 8. Correção de etapa (sat.administrar), busca por NS (antigo e novo), peças mais usadas, kits e cache.
do $t$
declare
  v_os  uuid := (select id from sat_ordens where ns_atual = '610-99');   -- na qualidade, trocou 610-3 → 610-99
  v_ids uuid[];
  r     jsonb;
begin
  set local role authenticated;

  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  begin perform sat_ordem_corrigir_etapa(v_os, 'em_manutencao', 'voltou da qualidade'); raise exception 'FALHOU: corrigir sem administrar';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  begin perform sat_ordem_corrigir_etapa(v_os, 'expedida', 'x x x'); raise exception 'FALHOU: etapa inválida';
  exception when raise_exception then if sqlerrm <> 'ETAPA_INVALIDA' then raise; end if; end;
  begin perform sat_ordem_corrigir_etapa(v_os, 'em_manutencao', ' a '); raise exception 'FALHOU: motivo curto';
  exception when raise_exception then if sqlerrm <> 'MOTIVO_CORRECAO_OBRIGATORIO' then raise; end if; end;
  begin perform sat_ordem_corrigir_etapa(v_os, 'qualidade', 'mesma etapa'); raise exception 'FALHOU: mesma etapa';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  r := sat_ordem_corrigir_etapa(v_os, 'em_manutencao', '  qualidade achou outro defeito  ');
  if (select etapa from sat_ordens where id = v_os) <> 'em_manutencao' then raise exception 'FALHOU: correção não mudou a etapa'; end if;
  if not exists (select 1 from sat_ordem_historico where ordem_id = v_os and evento = 'correcao_etapa'
                    and etapa_de = 'qualidade' and etapa_para = 'em_manutencao'
                    and dados->>'motivo' = 'qualidade achou outro defeito') then
    raise exception 'FALHOU: histórico da correção';
  end if;

  -- busca: pelo NS novo, pelo antigo e só pela sequência
  select array_agg(x) into v_ids from sat_ordens_do_ns('610', '99') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca pelo NS novo %', v_ids; end if;
  select array_agg(x) into v_ids from sat_ordens_do_ns('610', '3') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca pelo NS antigo %', v_ids; end if;
  select array_agg(x) into v_ids from sat_ordens_do_ns(null, '99') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca só pela sequência %', v_ids; end if;
  if exists (select 1 from sat_ordens_do_ns('610', '') x) then raise exception 'FALHOU: busca vazia devolveu OS'; end if;

  -- mais usadas no produto (PMOC31) e kits conhecidos
  if (select array_agg(codigo || ':' || usos) from sat_pecas_mais_usadas('pmoc31', 10)) is distinct from array['PMOE74:1'] then
    raise exception 'FALHOU: mais usadas %', (select array_agg(codigo || ':' || usos) from sat_pecas_mais_usadas('pmoc31', 10));
  end if;
  if exists (select 1 from sat_pecas_mais_usadas('', 10)) then raise exception 'FALHOU: mais usadas sem produto'; end if;
  if (select array_agg(codigo || '|' || descricao) from sat_kits_conhecidos()) is distinct from array['PMOE74|Módulo Camabio com cabo'] then
    raise exception 'FALHOU: kits conhecidos';
  end if;

  -- cache: só com manutenção, chave no formato, grava e regrava
  begin perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": []}'::jsonb); raise exception 'FALHOU: cache sem manutenção';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  begin perform sat_compels_cache_gravar('qualquer coisa', '{}'::jsonb); raise exception 'FALHOU: chave inválida';
  exception when raise_exception then if sqlerrm <> 'CHAVE_INVALIDA' then raise; end if; end;
  perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": []}'::jsonb);
  perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": null}'::jsonb);
  perform sat_compels_cache_gravar('pais:12345', '[]'::jsonb);
  if (select dados from sat_compels_cache where chave = 'estrutura:PMOC31') <> '{"arvore": null}'::jsonb then
    raise exception 'FALHOU: cache não regravou';
  end if;
  begin insert into sat_compels_cache (chave, dados) values ('pais:1', '[]'); raise exception 'FALHOU: insert direto no cache';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'correção, busca, mais usadas e cache: ok';
end $t$;
