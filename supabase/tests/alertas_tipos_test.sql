-- Testes SQL da 0115 (tipos de regra, destinatários do ShopFloor, filtro de PMO). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_test.sql, na mesma base, com a 0115
-- aplicada por cima da 0113/0114 (igual à produção, onde a 0113 já tem regras e ocorrências).
--
-- Duas réguas de permissão, de propósito:
--   tem_permissao(...)         -> stub de SESSÃO (teste.perms): é QUEM CHAMA (a tela);
--   usuario_tem_permissao(...) -> real, lê perfil_permissao pelo usuarios.perfil_id: é o
--                                 DESTINATÁRIO listado na regra.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- T1. Migração: tudo o que já existia virou 'aprovacao', sem PMO, e as ocorrências antigas ganharam
--     valor_abertura/valor_ultimo iguais à taxa e amostras = aprovados + reprovados.
do $t$
begin
  if not exists (select 1 from alerta_regras) then
    raise exception 'FALHOU: sem regras antigas para conferir a migração';
  end if;
  if exists (select 1 from alerta_regras where tipo <> 'aprovacao' or pmos <> '{}'::text[]) then
    raise exception 'FALHOU: regra antiga não virou aprovacao sem PMO';
  end if;
  if not exists (select 1 from alerta_ocorrencias) then
    raise exception 'FALHOU: sem ocorrências antigas para conferir a migração';
  end if;
  if exists (select 1 from alerta_ocorrencias
              where valor_abertura is distinct from taxa_abertura
                 or valor_ultimo is distinct from taxa_ultima
                 or amostras is distinct from aprovados + reprovados
                 or defeito is not null) then
    raise exception 'FALHOU: backfill das ocorrências antigas';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'alerta_ocorrencias_viva') then
    raise exception 'FALHOU: índice único antigo (sem defeito) continua lá';
  end if;
end $t$;

-- Preparação: desliga as regras dos testes da 0113 e encerra as ocorrências vivas delas; a fila
-- antiga sai do caminho (tentativas = 3 = desistiu).
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Perfis: Gestor administra o ShopFloor; Operador não (administrar de OUTRO módulo não vale).
insert into public.perfis (id, nome) values
  ('00000000-0000-0000-0000-0000000000a1', 'Gestor'),
  ('00000000-0000-0000-0000-0000000000a2', 'Operador');
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000000a1', 'shopfloor', 'visualizar'),
  ('00000000-0000-0000-0000-0000000000a1', 'shopfloor', 'administrar'),
  ('00000000-0000-0000-0000-0000000000a2', 'shopfloor', 'visualizar'),
  ('00000000-0000-0000-0000-0000000000a2', 'shopfloor', 'lancar'),
  ('00000000-0000-0000-0000-0000000000a2', 'recebimento', 'administrar');
-- Ana, Bruno e os inativos (Zeca, Dora) = Gestor; Carla = Operador.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a1'
 where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010');
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-000000000003';
-- Carla ganha Telegram: assim, quando ela ficar fora da fila, é pela PERMISSÃO, não por falta de conta.
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000003', 'telegram', 'T3')
on conflict (usuario_id, canal) do nothing;

insert into public.sf_ordens (pmo, op) values ('PMOB', '1'), ('PMOA', '1'), ('PMOA', '2'), ('', '3');

-- Helper: cria uma regra (Ana e Bruno como destinatários por padrão, Telegram + Discord).
create function public.teste_regra(
  p_nome text, p_tipo text, p_postos text[], p_taxa numeric, p_janela_tipo text, p_janela_valor int,
  p_minimo int, p_limite_tempo int, p_limite_oc int, p_pausa int,
  p_pmos text[] default '{}', p_lembrete int default null, p_ativa boolean default true,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-000000000001',
                                       '00000000-0000-0000-0000-000000000002']::uuid[]
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, limite_tempo_seg,
     limite_ocorrencias, pausa_max_min, pmos, lembrete_min, canais, destinatarios, ativa, criado_por)
  values (p_nome, p_tipo, p_postos, p_taxa, p_janela_tipo, p_janela_valor, p_minimo, p_limite_tempo,
          p_limite_oc, p_pausa, p_pmos, p_lembrete, array['telegram', 'discord'], p_destinatarios,
          p_ativa, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Helper: a regra TEM que ser recusada pelo check (check_violation); se passar, o teste falha.
create function public.teste_regra_recusada(
  p_rotulo text, p_tipo text, p_taxa numeric, p_janela_tipo text, p_janela_valor int,
  p_minimo int, p_limite_tempo int, p_limite_oc int, p_pausa int
) returns void language plpgsql as $f$
begin
  begin
    perform public.teste_regra('Recusada', p_tipo, array['X'], p_taxa, p_janela_tipo, p_janela_valor,
                               p_minimo, p_limite_tempo, p_limite_oc, p_pausa, '{}', null, false);
  exception when check_violation then
    return;
  end;
  raise exception 'FALHOU: regra aceita (%)', p_rotulo;
end
$f$;

-- T2. Checks por tipo: cada tipo exige os seus campos e recusa os dos outros.
do $t$
begin
  perform teste_regra_recusada('aprovação sem taxa',            'aprovacao', null, 'tempo', 60,   20,   null, null, null);
  perform teste_regra_recusada('aprovação com limite de tempo', 'aprovacao', 90,   'tempo', 60,   20,   120,  null, null);
  perform teste_regra_recusada('aprovação sem mínimo',          'aprovacao', 90,   'tempo', 60,   null, null, null, null);
  perform teste_regra_recusada('tempo com janela por bipes',    'tempo',     null, 'bipes', 50,   10,   120,  null, 30);
  perform teste_regra_recusada('tempo sem pausa',               'tempo',     null, 'tempo', 60,   10,   120,  null, null);
  perform teste_regra_recusada('tempo com pausa 241',           'tempo',     null, 'tempo', 60,   10,   120,  null, 241);
  perform teste_regra_recusada('tempo com limite 3601 s',       'tempo',     null, 'tempo', 60,   10,   3601, null, 30);
  perform teste_regra_recusada('tempo sem limite',              'tempo',     null, 'tempo', 60,   10,   null, null, 30);
  perform teste_regra_recusada('tempo com taxa',                'tempo',     90,   'tempo', 60,   10,   120,  null, 30);
  perform teste_regra_recusada('tempo sem mínimo',              'tempo',     null, 'tempo', 60,   null, 120,  null, 30);
  perform teste_regra_recusada('defeito com janela op',         'defeito',   null, 'op',    null, null, null, 3,    null);
  perform teste_regra_recusada('defeito com limite 1',          'defeito',   null, 'tempo', 60,   null, null, 1,    null);
  perform teste_regra_recusada('defeito com mínimo de bipes',   'defeito',   null, 'tempo', 60,   20,   null, 3,    null);
  perform teste_regra_recusada('defeito com pausa',             'defeito',   null, 'tempo', 60,   null, null, 3,    30);
  perform teste_regra_recusada('tipo desconhecido',             'xyz',       90,   'tempo', 60,   20,   null, null, null);
end $t$;

-- T2b. O default de minimo_bipes (20, da 0113) NÃO serve pra defeito: quem grava manda null.
do $t$
begin
  begin
    insert into alerta_regras (nome, tipo, postos, janela_tipo, janela_valor, limite_ocorrencias, canais,
                               destinatarios, ativa)
    values ('Default', 'defeito', array['X'], 'tempo', 60, 3, array['telegram'],
            array['00000000-0000-0000-0000-000000000001']::uuid[], false);
    raise exception 'FALHOU: defeito aceitou o mínimo de bipes padrão (20)';
  exception when check_violation then
    null;
  end;
  -- PMO nula dentro da lista
  begin
    perform teste_regra('PMO nula', 'aprovacao', array['X'], 90, 'tempo', 60, 20, null, null, null,
                        array['PMOA', null], null, false);
    raise exception 'FALHOU: aceitou PMO nula';
  exception when check_violation then
    null;
  end;
end $t$;

-- T3. Regras válidas de cada tipo; o tipo não muda depois de criado (TIPO_FIXO), os outros campos sim.
do $t$
declare v uuid;
begin
  perform teste_regra('Válida tempo',    'tempo',   array['X'], null, 'tempo', 60,    10,   120,  null, 30,  '{}',           null, false);
  perform teste_regra('Válida tempo OP', 'tempo',   array['X'], null, 'op',    null,  10,   3600, null, 1,   array['PMOA'],  null, false);
  v := teste_regra('Válida defeito',     'defeito', array['X'], null, 'tempo', 10080, null, null, 2,    null, '{}',          null, false);
  begin
    update alerta_regras set tipo = 'aprovacao', taxa_minima = 90, minimo_bipes = 20, limite_ocorrencias = null
     where id = v;
    raise exception 'FALHOU: o tipo da regra mudou';
  exception when others then
    if sqlerrm not like '%TIPO_FIXO%' then raise; end if;
  end;
  update alerta_regras set limite_ocorrencias = 4 where id = v;
  if (select limite_ocorrencias from alerta_regras where id = v) <> 4 then
    raise exception 'FALHOU: não editou o limite da regra de defeito';
  end if;
end $t$;

-- T4. Índice único: uma ocorrência viva por regra x posto x DEFEITO (sem defeito = '').
do $t$
declare g uuid;
begin
  select id into g from alerta_regras where nome = 'Válida defeito';
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 3, 3);
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '1002 B', 3, 3);
  begin
    insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 5, 5);
    raise exception 'FALHOU: duas ocorrências vivas do mesmo defeito';
  exception when unique_violation then
    null;
  end;
  insert into alerta_ocorrencias (regra_id, posto, valor_abertura, valor_ultimo) values (g, 'Y', 1, 1);
  begin
    insert into alerta_ocorrencias (regra_id, posto, valor_abertura, valor_ultimo) values (g, 'Y', 2, 2);
    raise exception 'FALHOU: duas ocorrências vivas sem defeito na mesma regra x posto';
  exception when unique_violation then
    null;
  end;
  -- encerrada não conta: o mesmo defeito pode abrir de novo
  update alerta_ocorrencias set estado = 'normalizada', normalizada_em = now() where regra_id = g;
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 3, 3);
  update alerta_ocorrencias set estado = 'normalizada', normalizada_em = now()
   where regra_id = g and estado = 'aberta';
end $t$;

-- T5. usuario_tem_permissao: olha o perfil do USUÁRIO LISTADO (não quem chama), só ativo, só o módulo pedido.
do $t$
begin
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Ana (Gestor) sem administrar';
  end if;
  if usuario_tem_permissao('00000000-0000-0000-0000-000000000003', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Carla (Operador) com administrar do ShopFloor';
  end if;
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000003', 'recebimento', 'administrar') then
    raise exception 'FALHOU: a checagem não respeita o módulo';
  end if;
  if usuario_tem_permissao('00000000-0000-0000-0000-000000000010', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Dora (inativa) com permissão';
  end if;
  if usuario_tem_permissao(null, 'shopfloor', 'administrar')
     or usuario_tem_permissao('00000000-0000-0000-0000-000000000099', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: usuário nulo/inexistente com permissão';
  end if;
end $t$;
-- quem chama sem permissão nenhuma (teste.perms vazio) não muda a resposta sobre a Ana
select set_config('teste.perms', '', false);
do $t$
begin
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: usuario_tem_permissao dependeu de quem chama';
  end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
-- e a tela (authenticated) não chama direto: é função de servidor
set role authenticated;
do $t$
begin
  begin
    perform usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar');
    raise exception 'FALHOU: authenticated executou usuario_tem_permissao';
  exception when insufficient_privilege then
    null;
  end;
end $t$;

-- T6. alerta_pmos: distintas, ordenadas, sem vazio; só com administrar.
do $t$
begin
  if alerta_pmos() is distinct from array['PMOA', 'PMOB'] then
    raise exception 'FALHOU: alerta_pmos %', alerta_pmos();
  end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform alerta_pmos();
    raise exception 'FALHOU: alerta_pmos sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
reset role;
