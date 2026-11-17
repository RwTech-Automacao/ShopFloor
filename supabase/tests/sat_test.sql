-- Testes do SAT (migração 0186): planilha no banco, entrada, NF, motivos, consulta do NS e RLS.
-- Roda num Postgres descartável: supabase/tests/rodar-sat-test.sh
-- Tudo numa única conexão (as configurações de sessão `teste.perms`/`teste.uid` alimentam os stubs).
-- Dados SINTÉTICOS (nada da planilha real).

-- ---------- stubs mínimos do Supabase e das tabelas de que a 0186 lê ----------
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true
);
insert into public.usuarios (id, nome, email) values
  ('00000000-0000-0000-0000-000000000001', 'Sérgio SAT', 'sergio@exemplo.com'),
  ('00000000-0000-0000-0000-000000000002', '', 'gestora@exemplo.com');

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula (a de DOIS argumentos: a de um anula o RBAC).
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

create table public.repinmetro_revendas (
  numero_serie_completo text primary key, modelo text not null default '', numero_serie text not null default '',
  numero_serie_norm text not null default '', revenda text, gravada_em timestamptz, saida_em timestamptz
);
create table public.repinmetro_producao (
  origem_id bigint primary key, numero_serie text not null, numero_serie_norm text not null default '', modelo text,
  data_inicio timestamptz, data_fim timestamptz, status text, serial_impressora text, serial_mrp text,
  serial_modulo_bio text, serial_rfid text, serial_fonte text, serial_barras text
);
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(), data_hora timestamptz not null default now(), posto text not null,
  pmo text not null, op text not null, cliente text not null default '', numero_serie text not null default '',
  numero_serie_norm text not null default ''
);
create table public.sf_ordens (pmo text not null, op text not null, descricao text not null default '', unique (pmo, op));
alter table public.repinmetro_revendas enable row level security;
alter table public.repinmetro_producao enable row level security;
alter table public.sf_registros enable row level security;
alter table public.sf_ordens enable row level security;

insert into public.repinmetro_revendas values
  ('00043005620019177', '00562', '0019177', '19177', 'Revenda Fictícia', '2025-03-01', '2025-03-05'),
  ('00043005630019177', '00563', '0019177', '19177', 'Outro Modelo', '2025-03-01', null);
insert into public.repinmetro_producao (origem_id, numero_serie, numero_serie_norm, modelo, data_inicio, status, serial_fonte)
values (1, '0019177', '19177', '00562', '2025-02-20', 'APROVADO', 'F-1'),
       (2, '0019177', '19177', '00563', '2025-02-21', 'APROVADO', 'F-2');
insert into public.sf_registros (data_hora, posto, pmo, op, cliente, numero_serie, numero_serie_norm) values
  ('2025-02-10 10:00', 'Inicial', 'PMOD99', '9001', 'C1', '43005620019177', '43005620019177'),
  ('2025-02-11 10:00', 'Embalagem', 'PMOD99', '9001', 'C1', '43005620019177', '43005620019177'),
  ('2025-02-11 10:00', 'Inicial', 'PMOX', '1', 'C2', '777', '777');
insert into public.sf_ordens values ('PMOD99', '9001', 'REP FICTÍCIO');

\i /tmp/0186.sql

-- Imita os privilégios padrão de tabela do Supabase Dev (tudo liberado pro authenticated/anon), deixando SÓ o
-- RLS como barreira real.
grant all on all tables in schema public to anon, authenticated;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- 1. Sincronização (service_role): grava, conta, não duplica, não apaga com célula vazia, atualiza.
do $t$
declare r jsonb; v_lote jsonb := $j$[
  {"chave": "90001", "numero": "90001", "data": "2026-01-06", "cliente": "Cliente A — 12.345.678/0001-90",
   "equipamento": "REP X", "defeito": "não liga", "solucao": "", "aba": "Garantia 2026 - Automação", "linha": 2,
   "itens": [{"chave": "562/19177|PRT001|2026-01-06", "ns": "00043005620019177", "modelo": "562", "sequencia": "19177",
              "codigo_peca": "PRT001", "peca": "Fonte", "quantidade": 1, "data": "2026-01-06"},
             {"chave": "txt:-|PRT002|2026-01-06", "ns": "-", "modelo": null, "sequencia": null,
              "codigo_peca": "PRT002", "peca": "Cabo", "quantidade": null, "data": "2026-01-06"}]},
  {"chave": "sem-os|2025-01-06|C9|REP Z", "numero": "", "data": "2025-01-06", "cliente": "C9", "aba": "Garantia 2025",
   "linha": 3, "itens": []}
]$j$;
begin
  perform set_config('teste.perms', '', false);
  set local role service_role;
  r := sat_sincronizar_planilha(v_lote);
  if r <> '{"os_novas": 2, "os_atualizadas": 0, "itens_novos": 2, "itens_atualizados": 0}'::jsonb then
    raise exception 'FALHOU: 1ª rodada contou %', r;
  end if;
  r := sat_sincronizar_planilha(v_lote);
  if r <> '{"os_novas": 0, "os_atualizadas": 0, "itens_novos": 0, "itens_atualizados": 0}'::jsonb then
    raise exception 'FALHOU: rodada repetida tinha que não mexer em nada, contou %', r;
  end if;
  -- a planilha ganhou a solução; o defeito sumiu da célula (não apaga); a quantidade da 2ª peça foi preenchida
  r := sat_sincronizar_planilha($j$[{"chave": "90001", "numero": "90001", "data": "2026-01-06", "defeito": "",
        "solucao": "Envio ao SAT", "itens": [{"chave": "txt:-|PRT002|2026-01-06", "ns": "-", "codigo_peca": "PRT002",
        "peca": "Cabo", "quantidade": 2, "data": "2026-01-06"}]}]$j$);
  if r <> '{"os_novas": 0, "os_atualizadas": 1, "itens_novos": 0, "itens_atualizados": 1}'::jsonb then
    raise exception 'FALHOU: atualização contou %', r;
  end if;
  if not exists (select 1 from sat_os where chave = '90001' and solucao = 'Envio ao SAT' and defeito = 'não liga'
                   and cliente like 'Cliente A%') then
    raise exception 'FALHOU: célula vazia apagou o gravado, ou a solução não entrou';
  end if;
  if (select count(*) from sat_os_itens) <> 2 then raise exception 'FALHOU: itens duplicaram'; end if;
  begin
    perform sat_sincronizar_planilha('{"x": 1}'::jsonb);
    raise exception 'FALHOU: aceitou lote que não é lista';
  exception when raise_exception then
    if sqlerrm <> 'LOTE_INVALIDO' then raise; end if;
  end;
  reset role;
  -- o usuário (nem com sat.administrar) não executa a sincronização
  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  set local role authenticated;
  begin
    perform sat_sincronizar_planilha('[]'::jsonb);
    raise exception 'FALHOU: authenticated executou a sincronização';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'sincronização da planilha: ok';
end $t$;

-- 2. RLS: sem sat.visualizar não lê; com, lê. Escrita direta do authenticated não passa (nem com os grants largos).
do $t$
declare n int;
begin
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.administrar,faturamento.visualizar', false);
  set local role authenticated;
  select count(*) into n from sat_os;
  if n <> 0 then raise exception 'FALHOU: leu % OS sem sat.visualizar', n; end if;
  select count(*) into n from sat_os_itens;
  if n <> 0 then raise exception 'FALHOU: leu % itens sem sat.visualizar', n; end if;
  perform set_config('teste.perms', 'sat.visualizar', false);
  select count(*) into n from sat_os;
  if n <> 2 then raise exception 'FALHOU: com sat.visualizar tinha que ler 2 OS, leu %', n; end if;

  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada,sat.aprovar_nf,sat.administrar', false);
  begin
    insert into sat_motivos_nf (texto) values ('direto');
    raise exception 'FALHOU: insert direto do authenticated passou';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into sat_entradas (ns_escrito, nf, nf_situacao) values ('1', '1', 'aprovada');
    raise exception 'FALHOU: insert direto de entrada passou';
  exception when insufficient_privilege then null;
  end;
  update sat_os set solucao = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: update direto mexeu em % OS', n; end if;
  delete from sat_os_itens;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: delete direto apagou % itens', n; end if;
  reset role;
  raise notice 'RLS: ok';
end $t$;

-- 3. Motivos: só sat.administrar; texto repetido recusa; desativar.
do $t$
declare v_id uuid;
begin
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada,sat.aprovar_nf', false);
  set local role authenticated;
  begin
    perform sat_motivo_salvar(null, 'Sem CFOP de retorno', true);
    raise exception 'FALHOU: cadastrou motivo sem sat.administrar';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  perform sat_motivo_salvar(null, 'Sem CFOP de retorno', true);
  perform sat_motivo_salvar(null, 'Valor divergente', true);
  v_id := sat_motivo_salvar(null, 'Motivo antigo', true);
  perform sat_motivo_salvar(v_id, 'Motivo antigo', false);
  begin
    perform sat_motivo_salvar(null, '  sem cfop DE RETORNO ', true);
    raise exception 'FALHOU: aceitou motivo repetido';
  exception when unique_violation then null;
  end;
  begin
    perform sat_motivo_salvar(null, '   ', true);
    raise exception 'FALHOU: aceitou motivo vazio';
  exception when raise_exception then
    if sqlerrm <> 'TEXTO_INVALIDO' then raise; end if;
  end;
  reset role;
  if (select count(*) from sat_motivos_nf where ativo) <> 2 then raise exception 'FALHOU: desativar não pegou'; end if;
  raise notice 'motivos: ok';
end $t$;

-- 4. Entrada: permissão, motivo obrigatório na reprovada, proibido na aprovada, motivo inativo, "outros" com texto.
do $t$
declare
  r jsonb;
  v_os uuid := (select id from sat_os where chave = '90001');
  m1 uuid := (select id from sat_motivos_nf where texto = 'Sem CFOP de retorno');
  m2 uuid := (select id from sat_motivos_nf where texto = 'Valor divergente');
  m_inativo uuid := (select id from sat_motivos_nf where texto = 'Motivo antigo');
begin
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf,sat.administrar', false);
  set local role authenticated;
  begin
    perform sat_registrar_entrada('{"ns": "562-19177", "nf": "1", "nf_situacao": "aprovada"}'::jsonb);
    raise exception 'FALHOU: registrou entrada sem sat.registrar_entrada';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;

  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  begin
    perform sat_registrar_entrada('{"ns": "562-19177", "nf": "1", "nf_situacao": "reprovada"}'::jsonb);
    raise exception 'FALHOU: reprovada sem motivo passou';
  exception when raise_exception then
    if sqlerrm <> 'MOTIVO_OBRIGATORIO' then raise; end if;
  end;
  begin
    perform sat_registrar_entrada(jsonb_build_object('ns', '562-19177', 'nf', '1', 'nf_situacao', 'aprovada',
      'motivos', jsonb_build_array(m1)));
    raise exception 'FALHOU: aprovada com motivo passou';
  exception when raise_exception then
    if sqlerrm <> 'MOTIVO_EM_NF_APROVADA' then raise; end if;
  end;
  begin
    perform sat_registrar_entrada(jsonb_build_object('ns', '562-19177', 'nf', '1', 'nf_situacao', 'reprovada',
      'motivos', jsonb_build_array(m_inativo)));
    raise exception 'FALHOU: motivo inativo passou';
  exception when raise_exception then
    if sqlerrm <> 'MOTIVO_INVALIDO' then raise; end if;
  end;
  begin
    perform sat_registrar_entrada('{"ns": "562-19177", "nf": "  ", "nf_situacao": "aprovada"}'::jsonb);
    raise exception 'FALHOU: entrada sem NF passou';
  exception when raise_exception then
    if sqlerrm <> 'NF_OBRIGATORIA' then raise; end if;
  end;
  begin
    perform sat_registrar_entrada('{"ns": "562-19177", "nf": "1", "nf_situacao": "aprovada", "itens_junto": ["outros"]}'::jsonb);
    raise exception 'FALHOU: "outros" sem texto passou';
  exception when raise_exception then
    if sqlerrm <> 'OUTROS_SEM_TEXTO' then raise; end if;
  end;
  begin
    perform sat_registrar_entrada('{"ns": "562-19177", "nf": "1", "nf_situacao": "aprovada", "itens_junto": ["mesa"]}'::jsonb);
    raise exception 'FALHOU: item que veio junto fora da lista passou';
  exception when check_violation then null;
  end;

  r := sat_registrar_entrada(jsonb_build_object(
    'ns', ' 00043005620019177 ', 'modelo', '562', 'sequencia', '19177', 'os_id', v_os, 'empresa', 'Cliente A',
    'cnpj', '12.345.678/0001-90', 'produto', 'REP X', 'nf', '4521', 'valor', 1500.5, 'frete', 'a_cobrar',
    'itens_junto', jsonb_build_array('bobina', 'outros'), 'itens_junto_outros', 'suporte', 'defeito', 'não liga',
    'locacao', 'Prateleira 1', 'custo', 0, 'nf_situacao', 'reprovada', 'motivos', jsonb_build_array(m2, m1)));
  if r->'motivos' <> '["Sem CFOP de retorno", "Valor divergente"]'::jsonb then
    raise exception 'FALHOU: motivos devolvidos %', r->'motivos';
  end if;
  reset role;
  if not exists (select 1 from sat_entradas where id = (r->>'id')::uuid and ns_escrito = '00043005620019177'
                   and os_numero = '90001' and responsavel_nome = 'Sérgio SAT' and nf_situacao = 'reprovada'
                   and itens_junto_outros = 'suporte' and data = (now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'FALHOU: entrada gravada errada';
  end if;
  if not exists (select 1 from sat_entradas_historico where entrada_id = (r->>'id')::uuid and tipo = 'entrada'
                   and nf_para = '4521' and situacao_para = 'reprovada' and cardinality(motivos) = 2) then
    raise exception 'FALHOU: histórico da entrada';
  end if;
  perform set_config('teste.entrada', r->>'id', false);
  raise notice 'entrada: ok';
end $t$;

-- 5. Corrigir NF (mesma nota): só sat.aprovar_nf; reprovada → aprovada; nada a mudar recusa.
do $t$
declare r jsonb; v_e uuid := current_setting('teste.entrada')::uuid;
begin
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada,sat.administrar', false);
  set local role authenticated;
  begin
    perform sat_corrigir_nf(v_e, 'aprovada', null);
    raise exception 'FALHOU: corrigiu sem sat.aprovar_nf';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.uid', '00000000-0000-0000-0000-000000000002', false);
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  r := sat_corrigir_nf(v_e, 'aprovada', null);
  if r->>'situacao_de' <> 'reprovada' or r->>'situacao_para' <> 'aprovada' or r->>'nf_para' <> '4521' then
    raise exception 'FALHOU: correção devolveu %', r;
  end if;
  begin
    perform sat_corrigir_nf(v_e, 'aprovada', '{}');
    raise exception 'FALHOU: correção sem mudança passou';
  exception when raise_exception then
    if sqlerrm <> 'NADA_A_MUDAR' then raise; end if;
  end;
  begin
    perform sat_corrigir_nf(gen_random_uuid(), 'aprovada', null);
    raise exception 'FALHOU: corrigiu entrada que não existe';
  exception when raise_exception then
    if sqlerrm <> 'ENTRADA_NAO_ENCONTRADA' then raise; end if;
  end;
  reset role;
  if not exists (select 1 from sat_entradas where id = v_e and nf_situacao = 'aprovada' and nf_motivos = '{}') then
    raise exception 'FALHOU: a entrada não ficou aprovada';
  end if;
  if not exists (select 1 from sat_entradas_historico where entrada_id = v_e and tipo = 'correcao'
                   and nf_de = '4521' and situacao_de = 'reprovada' and situacao_para = 'aprovada'
                   and usuario_nome = 'gestora@exemplo.com') then
    raise exception 'FALHOU: histórico da correção';
  end if;
  raise notice 'corrigir NF: ok';
end $t$;

-- 6. Trocar NF (nota nova): mesma nota recusa; a antiga fica no histórico.
do $t$
declare r jsonb; v_e uuid := current_setting('teste.entrada')::uuid;
  m1 uuid := (select id from sat_motivos_nf where texto = 'Sem CFOP de retorno');
begin
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  set local role authenticated;
  begin
    perform sat_trocar_nf(v_e, ' 4521 ', 'aprovada', null);
    raise exception 'FALHOU: trocou pela mesma nota';
  exception when raise_exception then
    if sqlerrm <> 'MESMA_NF' then raise; end if;
  end;
  r := sat_trocar_nf(v_e, '4600', 'reprovada', array[m1]);
  if r->>'nf_de' <> '4521' or r->>'nf_para' <> '4600' or r->'motivos' <> '["Sem CFOP de retorno"]'::jsonb then
    raise exception 'FALHOU: troca devolveu %', r;
  end if;
  reset role;
  if not exists (select 1 from sat_entradas where id = v_e and nf = '4600' and nf_situacao = 'reprovada') then
    raise exception 'FALHOU: a nota nova não ficou na entrada';
  end if;
  if (select count(*) from sat_entradas_historico where entrada_id = v_e) <> 3 then
    raise exception 'FALHOU: histórico tinha que ter entrada + correção + troca';
  end if;
  raise notice 'trocar NF: ok';
end $t$;

-- 7. Consulta do NS: só com sat.visualizar; casa o repinmetro pelo par (modelo sem zeros) e o ShopFloor pelo bipe.
do $t$
declare r jsonb;
begin
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  set local role authenticated;
  begin
    perform sat_consultar_ns('562', '19177', array['43005620019177']);
    raise exception 'FALHOU: consultou sem sat.visualizar';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'sat.visualizar', false);
  r := sat_consultar_ns('562', '19177', array['43005620019177', '43005620019177', '']);
  if jsonb_array_length(r->'revendas') <> 1 or r->'revendas'->0->>'revenda' <> 'Revenda Fictícia' then
    raise exception 'FALHOU: revendas %', r->'revendas';
  end if;
  if jsonb_array_length(r->'producao') <> 1 or r->'producao'->0->>'serial_fonte' <> 'F-1' then
    raise exception 'FALHOU: produção %', r->'producao';
  end if;
  if jsonb_array_length(r->'shopfloor') <> 1 or r->'shopfloor'->0->>'ultimo_posto' <> 'Embalagem'
     or r->'shopfloor'->0->>'descricao' <> 'REP FICTÍCIO' then
    raise exception 'FALHOU: shopfloor %', r->'shopfloor';
  end if;
  r := sat_consultar_ns(null, '19177', null);
  if r <> '{"revendas": [], "producao": [], "shopfloor": []}'::jsonb then
    raise exception 'FALHOU: sem par e sem bipe tinha que vir vazio, veio %', r;
  end if;
  begin
    perform sat_consultar_ns('1', '2', array['1','2','3','4','5','6','7','8','9','10','11']);
    raise exception 'FALHOU: aceitou NS demais';
  exception when raise_exception then
    if sqlerrm <> 'NS_DEMAIS' then raise; end if;
  end;
  reset role;
  set local role anon;
  begin
    perform sat_consultar_ns('562', '19177', null);
    raise exception 'FALHOU: anon consultou';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sat_registrar_entrada('{}'::jsonb);
    raise exception 'FALHOU: anon executou sat_registrar_entrada';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role authenticated;
  begin
    perform sat__motivos('aprovada', null);
    raise exception 'FALHOU: authenticated executou a função interna';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'consulta do NS e funções fechadas: ok';
end $t$;
