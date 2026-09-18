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
  -- limite >= pausa: todo intervalo acima do limite também passa da pausa e sai da média — nunca dispara
  perform teste_regra_recusada('tempo com limite = pausa',      'tempo',     null, 'tempo', 60,   10,   1800, null, 30);
  perform teste_regra_recusada('tempo com limite > pausa',      'tempo',     null, 'tempo', 60,   10,   3600, null, 1);
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
  perform teste_regra('Válida tempo OP', 'tempo',   array['X'], null, 'op',    null,  10,   3600, null, 61,  array['PMOA'],  null, false);
  perform teste_regra('Válida tempo 29:59', 'tempo', array['X'], null, 'tempo', 60,    10,   1799, null, 30,  '{}',           null, false);
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

-- =====================================================================
-- Tipos de regra: cálculo, transições e filtro de PMO (0115 parte B)
-- =====================================================================

-- Helpers. teste_ritmo: N bipes aprovados a cada P segundos, começando S segundos atrás.
create function public.teste_ritmo(
  p_posto text, p_pmo text, p_op text, p_qtd int, p_passo_seg int, p_inicio_seg_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(secs => p_inicio_seg_atras) + make_interval(secs => p_passo_seg * (g - 1)),
         p_posto, p_pmo, p_op, 'Aprovado'
    from generate_series(1, p_qtd) g;
$f$;

-- teste_defeitos: N linhas com um código de defeito e um status, M minutos atrás.
create function public.teste_defeitos(
  p_posto text, p_pmo text, p_codigo text, p_qtd int, p_status text, p_minutos_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, '1', p_status, p_codigo
    from generate_series(1, p_qtd) g;
$f$;

-- teste_fila: o que a avaliação desta transação pôs na fila para regra x posto x defeito — os
-- `dados` da primeira linha + tipo, ocorrência e n = quantas linhas (destinatário x canal).
-- plpgsql (não sql) de propósito, como o teste_acao da 0113.
create function public.teste_fila(p_regra text, p_posto text, p_defeito text default null) returns jsonb
language plpgsql as $f$
declare v jsonb;
begin
  with x as (
    select e.*
      from public.alerta_envios e
      join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
      join public.alerta_regras rg on rg.id = oc.regra_id
     where e.criado_em = now()
       and rg.nome = p_regra and oc.posto = p_posto
       and coalesce(oc.defeito, '') = coalesce(p_defeito, '')
       and e.tipo in ('alerta', 'lembrete', 'normalizou')
  )
  select x.dados || jsonb_build_object('tipo', x.tipo, 'ocorrencia_id', x.ocorrencia_id,
                                       'n', (select count(*) from x))
    into v
    from x
   order by x.usuario_id, x.canal
   limit 1;
  return v;
end
$f$;

-- Quantas linhas (destinatário x canal) a fila deve ter para Ana + Bruno.
create function public.teste_contas_ana_bruno() returns int language sql as $f$
  select count(*)::int from public.alerta_contas
   where usuario_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
     and canal in ('telegram', 'discord')
$f$;

-- As assinaturas antigas sumiram (senão o PostgREST não sabe qual chamar).
do $t$
begin
  if (select count(*) from pg_proc where proname = 'alerta_previa' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'alerta_taxas' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'alerta_listar_ocorrencias' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALHOU: assinatura antiga convivendo com a nova';
  end if;
  if not exists (select 1 from pg_proc where proname = 'alerta_previa' and pronargs = 8) then
    raise exception 'FALHOU: alerta_previa nova (8 parâmetros) não existe';
  end if;
end $t$;

-- ---------- Tempo médio por peça ----------
-- T-Lento: 11 bipes a cada 180 s (40 a 10 min atrás) = 10 intervalos, média 3:00.
select public.teste_ritmo('T-Lento', 'PMOA', '1', 11, 180, 2400);
-- Um bipe com 3 linhas de defeito grava 3 linhas com o MESMO data_hora: é UMA peça só.
insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito)
select r.data_hora, r.posto, r.pmo, r.op, 'Reprovado', '2040 COMPONENTE FALTANDO'
  from public.sf_registros r where r.posto = 'T-Lento' order by r.data_hora limit 3;
-- T-Pausa: 6 bipes a cada 60 s (50 min atrás), PAUSA de 40 min, 6 bipes a cada 60 s (5 min atrás).
select public.teste_ritmo('T-Pausa', 'PMOA', '1', 6, 60, 3000);
select public.teste_ritmo('T-Pausa', 'PMOA', '1', 6, 60, 300);
-- T-Poucos: só 3 intervalos (mínimo da regra = 5).
select public.teste_ritmo('T-Poucos', 'PMOA', '1', 4, 300, 1800);

do $t$ begin
  perform teste_regra('Tempo 2:00', 'tempo', array['T-Lento', 'T-Pausa', 'T-Poucos'], null, 'tempo', 60, 5, 120, null, 30);
end $t$;

set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_fila('Tempo 2:00', 'T-Lento');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: tempo não alertou % %', r, a; end if;
  if a->>'regra_tipo' <> 'tempo' or (a->>'media_seg')::numeric <> 180 or (a->>'limite_tempo_seg')::numeric <> 120
     or (a->>'pecas')::int <> 11 or a->>'janela_tipo' <> 'tempo' or (a->>'janela_valor')::int <> 60
     or a->>'regra_nome' <> 'Tempo 2:00' then
    raise exception 'FALHOU: dados do alerta de tempo %', a;
  end if;
  if (a->>'n')::int <> teste_contas_ana_bruno() then raise exception 'FALHOU: linhas na fila %', a; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Lento' and oc.estado = 'aberta'
                    and oc.valor_abertura = 180 and oc.valor_ultimo = 180 and oc.amostras = 11
                    and oc.taxa_abertura is null and oc.defeito is null) then
    raise exception 'FALHOU: ocorrência de tempo';
  end if;
  -- a pausa de 40 min (> 30) sai da média: 60 s por peça, dentro do limite
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Pausa') then
    raise exception 'FALHOU: a pausa entrou na média';
  end if;
  -- 3 intervalos < mínimo 5: não decide
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Poucos') then
    raise exception 'FALHOU: avaliou sem o mínimo de intervalos';
  end if;
end $t$;
reset role;

-- Prévia do tempo: pausa descartada, mínimo, e o efeito de NÃO descartar a pausa.
set role authenticated;
do $t$
declare p record;
begin
  select * into p from alerta_previa('tempo', array['T-Pausa', 'T-Poucos'], 'tempo', 60, 5, 30, null, '{}')
   where posto = 'T-Pausa';
  if not found or p.intervalos <> 10 or p.media_seg <> 60 or p.pecas <> 12 or p.avaliavel is not true then
    raise exception 'FALHOU: prévia T-Pausa %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Pausa'], 'tempo', 60, 5, 240, null, '{}');
  if p.intervalos <> 11 or p.media_seg <= 120 then raise exception 'FALHOU: prévia sem descartar a pausa %', p; end if;
  select * into p from alerta_previa('tempo', array['T-Poucos'], 'tempo', 60, 5, 30, null, '{}');
  if p.intervalos <> 3 or p.avaliavel is not false then raise exception 'FALHOU: prévia T-Poucos %', p; end if;
end $t$;
reset role;

-- Normalizou: 20 bipes rápidos (10 s) logo depois do último lento (+60 s).
-- Média = (10 x 180 + 60 + 19 x 10) / 30 = 68,33 s.
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select (select max(r.data_hora) from public.sf_registros r where r.posto = 'T-Lento')
         + make_interval(secs => 60 + 10 * (g - 1)),
       'T-Lento', 'PMOA', '1', 'Aprovado'
  from generate_series(1, 20) g;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo 2:00', 'T-Lento');
  if a is null or a->>'tipo' <> 'normalizou' or (a->>'media_seg')::numeric <> 68.33 or (a->>'pecas')::int <> 31 then
    raise exception 'FALHOU: tempo não normalizou %', a;
  end if;
end $t$;
reset role;

-- Janela OP + PMO: o "último bipe do posto" considera só as PMOs da regra.
select public.teste_ritmo('T-OPF', 'PMOX', '7001', 11, 150, 1800);  -- 30 a 5 min atrás, 150 s/peça
select public.teste_ritmo('T-OPF', 'PMOY', '8001', 3, 10, 120);     -- o último bipe do posto é de OUTRA PMO
do $t$ begin
  perform teste_regra('Tempo OP PMOX', 'tempo', array['T-OPF'], null, 'op', null, 5, 120, null, 30, array['PMOX']);
  perform teste_regra('Tempo OP todas', 'tempo', array['T-OPF'], null, 'op', null, 5, 120, null, 30);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo OP PMOX', 'T-OPF');
  if a is null or a->>'tipo' <> 'alerta' or a->>'pmo' <> 'PMOX' or a->>'op' <> '7001'
     or (a->>'media_seg')::numeric <> 150 or a->>'janela_tipo' <> 'op' then
    raise exception 'FALHOU: janela OP com filtro de PMO %', a;
  end if;
  -- sem filtro, a OP em andamento é a PMOY/8001 (só 2 intervalos): não decide
  if teste_fila('Tempo OP todas', 'T-OPF') is not null then raise exception 'FALHOU: OP sem filtro decidiu'; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Tempo OP PMOX' and oc.pmo = 'PMOX' and oc.op = '7001' and oc.estado = 'aberta') then
    raise exception 'FALHOU: ocorrência da janela OP sem PMO/OP';
  end if;
end $t$;
reset role;

-- Janela de minutos + PMO num posto MISTO: PMOX a cada 200 s e PMOY intercalada (100 s depois de
-- cada PMOX). O intervalo é medido entre bipes seguidos do POSTO (de qualquer PMO) e só entram os
-- que TERMINAM num bipe das PMOs da regra: a PMOX sai a 100 s por peça, igual ao posto — o tempo
-- da PMOY feita no meio não conta como lentidão da PMOX.
do $t$ begin   -- mesma transação = mesmo now(): os 100 s saem exatos
  perform public.teste_ritmo('T-Mix', 'PMOX', '1', 11, 200, 2400);
  perform public.teste_ritmo('T-Mix', 'PMOY', '1', 10, 200, 2300);
end $t$;
do $t$ begin
  perform teste_regra('Tempo PMOX', 'tempo', array['T-Mix'], null, 'tempo', 60, 5, 120, null, 30, array['PMOX']);
  perform teste_regra('Tempo todas as PMOs', 'tempo', array['T-Mix'], null, 'tempo', 60, 5, 120, null, 30);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo PMOX', 'T-Mix');
  if a is not null then
    raise exception 'FALHOU: filtro de PMO no tempo mediu de PMOX a PMOX (a PMOY do meio virou lentidão) %', a;
  end if;
  if teste_fila('Tempo todas as PMOs', 'T-Mix') is not null then
    raise exception 'FALHOU: sem filtro devia dar 100 s por peça (normal)';
  end if;
end $t$;
reset role;

-- T-Mix2: PMOY a cada 300 s e cada PMOX 30 s depois de uma PMOY. Intervalos que terminam na PMOX:
-- 10 x 30 s (o primeiro começa numa PMOY e conta). Na PMOY: 9 x 270 s (a primeira não tem
-- anterior). Sem filtro: os 19 intervalos, (300 + 2430) / 19 = 143,68 s — igual ao de antes.
-- Numa transação só (mesmo now()): em comandos separados os 30 s viram 30,00x / 269,99x.
do $t$ begin
  perform public.teste_ritmo('T-Mix2', 'PMOY', '1', 10, 300, 3000);
  perform public.teste_ritmo('T-Mix2', 'PMOX', '1', 10, 300, 2970);
end $t$;
set role authenticated;
do $t$
declare p record;
begin
  select * into p from alerta_previa('tempo', array['T-Mix2'], 'tempo', 60, 5, 30, null, array['PMOX']);
  if not found or p.intervalos <> 10 or p.media_seg <> 30 or p.pecas <> 10 then
    raise exception 'FALHOU: tempo da PMOX no posto misto %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Mix2'], 'tempo', 60, 5, 30, null, array['PMOY']);
  if not found or p.intervalos <> 9 or p.media_seg <> 270 or p.pecas <> 10 then
    raise exception 'FALHOU: tempo da PMOY no posto misto %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Mix2'], 'tempo', 60, 5, 30, null, '{}');
  if not found or p.intervalos <> 19 or p.media_seg <> 143.68 or p.pecas <> 20 then
    raise exception 'FALHOU: tempo sem filtro no posto misto %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Mix'], 'tempo', 60, 5, 30, null, array['PMOX']);
  if not found or p.intervalos <> 10 or p.media_seg <> 100 or p.pecas <> 11 then
    raise exception 'FALHOU: prévia T-Mix PMOX %', p;
  end if;
end $t$;
reset role;

-- ---------- Defeito repetido ----------
select public.teste_defeitos('D-Posto', 'PMOA', '2040 COMPONENTE FALTANDO', 3, 'Reprovado', 5);
select public.teste_defeitos('D-Posto', 'PMOA', '1002 TRILHA ROMPIDA',      4, 'REPROVADO', 10);
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           2, 'Reprovado', 5);
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           2, 'Aprovado',  5);   -- aprovado não conta
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           5, 'Reprovado', 90);  -- fora da janela
select public.teste_defeitos('D-Posto', 'PMOA', '',                         6, 'Reprovado', 5);   -- reprova sem código
do $t$ begin
  perform teste_regra('Defeito 3x', 'defeito', array['D-Posto'], null, 'tempo', 60, null, null, 3, null, '{}', 10);
end $t$;

-- Prévia: uma linha por defeito que chega a N; posto sem nenhum = uma linha com defeito nulo.
set role authenticated;
do $t$
declare v text;
begin
  select string_agg(posto || ':' || coalesce(defeito, '-') || ':' || ocorrencias, ' | '
                    order by posto, ocorrencias desc)
    into v
    from alerta_previa('defeito', array['D-Posto', 'D-Vazio'], 'tempo', 60, null, null, 3, '{}');
  if v is distinct from 'D-Posto:1002 TRILHA ROMPIDA:4 | D-Posto:2040 COMPONENTE FALTANDO:3 | D-Vazio:-:0' then
    raise exception 'FALHOU: prévia de defeitos %', v;
  end if;
end $t$;
reset role;

-- Dois códigos acima de N -> duas ocorrências e dois avisos; o 777 (2 reprovas na janela) não.
set role service_role;
do $t$
declare a jsonb; b jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  b := teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA');
  if a is null or a->>'tipo' <> 'alerta' or a->>'regra_tipo' <> 'defeito' or (a->>'ocorrencias')::int <> 3
     or (a->>'limite_ocorrencias')::int <> 3 or a->>'defeito' <> '2040 COMPONENTE FALTANDO'
     or (a->>'n')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: alerta do defeito 2040 %', a;
  end if;
  if b is null or b->>'tipo' <> 'alerta' or (b->>'ocorrencias')::int <> 4 then
    raise exception 'FALHOU: alerta do defeito 1002 %', b;
  end if;
  if teste_fila('Defeito 3x', 'D-Posto', '777 SOLDA FRIA') is not null then
    raise exception 'FALHOU: 777 alertou (aprovado/fora da janela contaram)';
  end if;
  if (select count(*) from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Defeito 3x' and oc.estado = 'aberta') <> 2 then
    raise exception 'FALHOU: devia ter 2 ocorrências abertas (uma por defeito)';
  end if;
end $t$;
-- Reavaliar sem mudança: nada novo na fila.
do $t$
begin
  perform alerta_avaliar();
  if teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO') is not null
     or teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA') is not null then
    raise exception 'FALHOU: reavaliar sem mudança pôs algo na fila';
  end if;
end $t$;
reset role;

-- Lembrete por defeito: só o 1002 passou do intervalo.
update public.alerta_ocorrencias
   set ultimo_envio_em = now() - interval '11 minutes', aberta_em = now() - interval '11 minutes'
 where defeito = '1002 TRILHA ROMPIDA' and estado = 'aberta';
set role service_role;
do $t$
declare b jsonb;
begin
  perform alerta_avaliar();
  b := teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA');
  if b is null or b->>'tipo' <> 'lembrete' or b->>'defeito' <> '1002 TRILHA ROMPIDA' then
    raise exception 'FALHOU: lembrete do defeito %', b;
  end if;
  if teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO') is not null then
    raise exception 'FALHOU: lembrete do 2040 antes da hora';
  end if;
end $t$;
reset role;

-- Normalização POR CÓDIGO: as reprovas do 2040 saem da janela; o 1002 continua aberto.
update public.sf_registros set data_hora = data_hora - interval '2 hours'
 where posto = 'D-Posto' and codigo_defeito = '2040 COMPONENTE FALTANDO';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  if a is null or a->>'tipo' <> 'normalizou' or (a->>'ocorrencias')::int <> 0 then
    raise exception 'FALHOU: 2040 não normalizou %', a;
  end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Defeito 3x' and oc.defeito = '2040 COMPONENTE FALTANDO'
                    and oc.estado = 'normalizada' and oc.valor_ultimo = 0) then
    raise exception 'FALHOU: ocorrência do 2040 não ficou normalizada com valor 0';
  end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Defeito 3x' and oc.defeito = '1002 TRILHA ROMPIDA' and oc.estado = 'aberta') then
    raise exception 'FALHOU: o 1002 não devia normalizar junto';
  end if;
end $t$;
reset role;

-- Caiu de novo: ocorrência NOVA do 2040.
select public.teste_defeitos('D-Posto', 'PMOA', '2040 COMPONENTE FALTANDO', 3, 'Reprovado', 1);
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: 2040 não reabriu %', a; end if;
  if (select count(*) from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Defeito 3x' and oc.defeito = '2040 COMPONENTE FALTANDO') <> 2 then
    raise exception 'FALHOU: devia ter 2 ocorrências do 2040 (a normalizada e a nova)';
  end if;
end $t$;
reset role;

-- Defeito + PMO: 3 reprovas na PMOY e 2 na PMOX (limite 3).
select public.teste_defeitos('D-Mix', 'PMOY', '555 CURTO', 3, 'Reprovado', 5);
select public.teste_defeitos('D-Mix', 'PMOX', '555 CURTO', 2, 'Reprovado', 5);
do $t$ begin
  perform teste_regra('Defeito PMOX', 'defeito', array['D-Mix'], null, 'tempo', 60, null, null, 3, null, array['PMOX']);
  perform teste_regra('Defeito todas as PMOs', 'defeito', array['D-Mix'], null, 'tempo', 60, null, null, 3, null);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito todas as PMOs', 'D-Mix', '555 CURTO');
  if a is null or (a->>'ocorrencias')::int <> 5 then raise exception 'FALHOU: defeito sem filtro %', a; end if;
  if teste_fila('Defeito PMOX', 'D-Mix', '555 CURTO') is not null then
    raise exception 'FALHOU: filtro de PMO no defeito contou a PMOY';
  end if;
end $t$;
reset role;

-- ---------- Taxa de aprovação + PMO ----------
select public.teste_bipes('A-Mix', 'PMOX', '1', 20, 0, 5);
select public.teste_bipes('A-Mix', 'PMOY', '1', 0, 20, 5);
do $t$ begin
  perform teste_regra('Taxa PMOX', 'aprovacao', array['A-Mix'], 90, 'tempo', 60, 10, null, null, null, array['PMOX']);
  perform teste_regra('Taxa todas as PMOs', 'aprovacao', array['A-Mix'], 90, 'tempo', 60, 10, null, null, null);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Taxa todas as PMOs', 'A-Mix');
  if a is null or a->>'tipo' <> 'alerta' or a->>'regra_tipo' <> 'aprovacao' or (a->>'taxa')::numeric <> 50
     or (a->>'aprovados')::int <> 20 or (a->>'reprovados')::int <> 20 or (a->>'taxa_minima')::numeric <> 90 then
    raise exception 'FALHOU: aprovação sem filtro %', a;
  end if;
  if teste_fila('Taxa PMOX', 'A-Mix') is not null then raise exception 'FALHOU: filtro de PMO na taxa'; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Taxa todas as PMOs' and oc.estado = 'aberta'
                    and oc.taxa_abertura = 50 and oc.valor_abertura = 50 and oc.amostras = 40) then
    raise exception 'FALHOU: ocorrência de aprovação sem taxa/valor/amostras';
  end if;
end $t$;
reset role;

-- Prévia da aprovação com PMO e janela OP: a OP é a do último bipe DA PMOX.
set role authenticated;
do $t$
declare p record;
begin
  select * into p from alerta_previa('aprovacao', array['A-Mix'], 'op', null, 10, null, null, array['PMOX']);
  if not found or p.pmo <> 'PMOX' or p.aprovados <> 20 or p.reprovados <> 0 or p.taxa <> 100
     or p.avaliavel is not true then
    raise exception 'FALHOU: prévia da aprovação com PMO %', p;
  end if;
end $t$;

-- Prévia: validações e permissão.
do $t$
begin
  begin
    perform * from alerta_previa('xyz', array['X'], 'tempo', 60, 1, null, null, '{}');
    raise exception 'FALHOU: tipo inválido na prévia';
  exception when others then
    if sqlerrm not like '%TIPO_INVALIDO%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('tempo', array['X'], 'bipes', 50, 5, 30, null, '{}');
    raise exception 'FALHOU: tempo com janela por bipes na prévia';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('defeito', array['X'], 'op', null, null, null, 3, '{}');
    raise exception 'FALHOU: defeito com janela OP na prévia';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('defeito', array['X'], 'tempo', 60, null, null, 1, '{}');
    raise exception 'FALHOU: defeito com limite 1 na prévia';
  exception when others then
    if sqlerrm not like '%LIMITE_INVALIDO%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('tempo', array['X'], 'tempo', 60, 5, 0, null, '{}');
    raise exception 'FALHOU: tempo com pausa 0 na prévia';
  exception when others then
    if sqlerrm not like '%PAUSA_INVALIDA%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform * from alerta_previa('tempo', array['T-Pausa'], 'tempo', 60, 5, 30, null, '{}');
    raise exception 'FALHOU: prévia sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Listagem de ocorrências com tipo, defeito e valores.
do $t$
declare o record;
begin
  select * into o
    from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'aberta')
   where regra_nome = 'Defeito 3x' and defeito = '1002 TRILHA ROMPIDA';
  if not found or o.regra_tipo <> 'defeito' or o.valor_abertura <> 4 or o.valor_ultimo <> 4
     or o.amostras <> 4 or o.taxa_abertura is not null then
    raise exception 'FALHOU: listagem da ocorrência de defeito %', o;
  end if;
  select * into o
    from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', '')
   where regra_nome = 'Tempo OP PMOX';
  if not found or o.regra_tipo <> 'tempo' or o.valor_abertura <> 150 or o.amostras <> 11 or o.defeito is not null then
    raise exception 'FALHOU: listagem da ocorrência de tempo %', o;
  end if;
end $t$;
reset role;

-- ---------- PMO com espaço nas pontas: compara aparado dos DOIS lados ----------
-- O bipe gravou ' PMOT ' / 'PMOT ' / ' PMOT' (com espaço); a regra/prévia guarda 'PMOT' (ou ' PMOT').
select public.teste_bipes('A-Trim', ' PMOT ', '1', 0, 10, 5);
select public.teste_bipes('A-Trim', 'PMOU',   '1', 20, 0, 5);
select public.teste_defeitos('D-Trim', 'PMOT ', '888 PONTE', 3, 'Reprovado', 5);
select public.teste_defeitos('D-Trim', 'PMOU',  '888 PONTE', 3, 'Reprovado', 5);
select public.teste_ritmo('T-Trim', ' PMOT', '1', 6, 60, 600);
select public.teste_ritmo('T-Trim', 'PMOU',  '1', 6, 10, 290);  -- depois da PMOT: nenhum intervalo termina na PMOT
do $t$ begin
  perform teste_regra('Taxa PMOT', 'aprovacao', array['A-Trim'], 90, 'tempo', 60, 10, null, null, null, array['PMOT']);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Taxa PMOT', 'A-Trim');
  if a is null or a->>'tipo' <> 'alerta' or (a->>'reprovados')::int <> 10 or (a->>'aprovados')::int <> 0 then
    raise exception 'FALHOU: PMO com espaço no bipe não casou com a regra %', a;
  end if;
end $t$;
reset role;
set role authenticated;
do $t$
declare p record; v text;
begin
  -- lista com espaço também casa (normalizada)
  select * into p from alerta_previa('aprovacao', array['A-Trim'], 'tempo', 60, 1, null, null, array[' PMOT']);
  if not found or p.aprovados <> 0 or p.reprovados <> 10 then raise exception 'FALHOU: prévia taxa com trim %', p; end if;
  -- janela OP: o último bipe da PMOT (aparada) é achado
  select * into p from alerta_previa('aprovacao', array['A-Trim'], 'op', null, 1, null, null, array['PMOT']);
  if not found or btrim(p.pmo) <> 'PMOT' or p.reprovados <> 10 or p.aprovados <> 0 then
    raise exception 'FALHOU: prévia OP com trim %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Trim'], 'tempo', 60, 1, 30, null, array['PMOT']);
  if not found or p.intervalos <> 5 or p.media_seg <> 60 or p.pecas <> 6 then
    raise exception 'FALHOU: prévia tempo com trim %', p;
  end if;
  select string_agg(posto || ':' || coalesce(defeito, '-') || ':' || ocorrencias, ' | ') into v
    from alerta_previa('defeito', array['D-Trim'], 'tempo', 60, null, null, 3, array['PMOT']);
  if v is distinct from 'D-Trim:888 PONTE:3' then raise exception 'FALHOU: prévia defeito com trim %', v; end if;
end $t$;
reset role;

-- Janela OP com PMO gravada com espaço: a comparação da OP é aparada dos DOIS lados e a ocorrência
-- (e os dados da fila) guardam a PMO aparada.
select public.teste_bipes('O-Trim', 'PMOW',   '9', 10, 0, 10);
select public.teste_bipes('O-Trim', ' PMOW ', '9', 0, 10, 1);   -- o último bipe do posto tem espaço
do $t$ begin
  perform teste_regra('Taxa OP PMOW', 'aprovacao', array['O-Trim'], 90, 'op', null, 1, null, null, null, array['PMOW']);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Taxa OP PMOW', 'O-Trim');
  if a is null or a->>'tipo' <> 'alerta' or (a->>'aprovados')::int <> 10 or (a->>'reprovados')::int <> 10 then
    raise exception 'FALHOU: janela OP não juntou PMOW e '' PMOW '' %', a;
  end if;
  if a->>'pmo' <> 'PMOW' or a->>'op' <> '9' then raise exception 'FALHOU: PMO sem trim nos dados %', a; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Taxa OP PMOW' and oc.pmo = 'PMOW' and oc.op = '9' and oc.estado = 'aberta') then
    raise exception 'FALHOU: ocorrência gravou a PMO sem trim';
  end if;
end $t$;
reset role;

-- Código de defeito com espaço nas pontas é o MESMO defeito ('2041 X' = '2041 X ' = ' 2041 X').
select public.teste_defeitos('D-Trim2', 'PMOA', '2041 X',   2, 'Reprovado', 5);
select public.teste_defeitos('D-Trim2', 'PMOA', '2041 X ',  2, 'Reprovado', 6);
select public.teste_defeitos('D-Trim2', 'PMOA', ' 2041 X',  1, 'Reprovado', 7);
do $t$ begin
  perform teste_regra('Defeito trim', 'defeito', array['D-Trim2'], null, 'tempo', 60, null, null, 5, null);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito trim', 'D-Trim2', '2041 X');
  if a is null or a->>'tipo' <> 'alerta' or (a->>'ocorrencias')::int <> 5 or a->>'defeito' <> '2041 X' then
    raise exception 'FALHOU: código com espaço virou outro defeito %', a;
  end if;
  if (select count(*) from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Defeito trim') <> 1 then
    raise exception 'FALHOU: mais de uma ocorrência para o mesmo defeito com/sem espaço';
  end if;
end $t$;
reset role;

-- JIT desligado nas funções de cálculo (cron a cada 5 min: o JIT só somava tempo).
do $t$
declare v text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('alerta_taxas', 'alerta_tempos', 'alerta_defeitos', 'alerta_avaliar', 'alerta_previa')
     and not ('jit=off' = any (coalesce(p.proconfig, '{}'::text[])));
  if v is not null then raise exception 'FALHOU: funções sem jit=off: %', v; end if;
end $t$;

-- =====================================================================
-- Destinatários: só quem administra o ShopFloor (0115 parte C)
-- =====================================================================

-- D1. A lista da tela: Carla (Operador) e os inativos (Zeca, Dora — mesmo com perfil Gestor) ficam fora.
set role authenticated;
do $t$
declare v uuid[];
begin
  select array_agg(usuario_id order by usuario_id) into v from alerta_destinatarios();
  if v is distinct from array['00000000-0000-0000-0000-000000000001',
                              '00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: destinatários disponíveis %', v;
  end if;
end $t$;
reset role;

-- D2. Fila: Carla está no array da regra e TEM Telegram, mas não administra — não entra.
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;
select public.teste_bipes('P-Dest', 'PMOA', '1', 0, 20, 5);
do $t$ begin
  perform teste_regra('Destinos', 'aprovacao', array['P-Dest'], 90, 'tempo', 60, 10, null, null, null, '{}', null, true,
                      array['00000000-0000-0000-0000-000000000001',
                            '00000000-0000-0000-0000-000000000002',
                            '00000000-0000-0000-0000-000000000003']::uuid[]);
end $t$;
set role service_role;
do $t$
declare v uuid[];
begin
  perform alerta_avaliar();
  select array_agg(distinct e.usuario_id order by e.usuario_id) into v
    from alerta_envios e
    join alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Destinos' and e.tipo = 'alerta';
  if v is distinct from array['00000000-0000-0000-0000-000000000001',
                              '00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: fila com quem não administra o ShopFloor %', v;
  end if;
end $t$;
reset role;

-- D3. Perdeu a permissão DEPOIS de enfileirado e ANTES da entrega: a reserva não pega a linha dele.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-000000000002';
set role service_role;
do $t$
declare v uuid[];
begin
  select array_agg(distinct x.usuario_id order by x.usuario_id) into v
    from alerta_reservar_envios(array['telegram', 'discord'], 100) x;
  if v is distinct from array['00000000-0000-0000-0000-000000000001']::uuid[] then
    raise exception 'FALHOU: reserva com quem perdeu a permissão %', v;
  end if;
  if exists (select 1 from alerta_envios e
               join alerta_ocorrencias oc on oc.id = e.ocorrencia_id
               join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Destinos' and e.usuario_id = '00000000-0000-0000-0000-000000000002'
                and (e.tentativas <> 0 or e.reservado_em is not null)) then
    raise exception 'FALHOU: a linha de quem perdeu a permissão foi mexida pela reserva';
  end if;
end $t$;
reset role;
-- Devolveu a permissão (ainda dentro das 24 h): a linha dele volta a ser entregável.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a1'
 where id = '00000000-0000-0000-0000-000000000002';
set role service_role;
do $t$
declare v uuid[];
begin
  select array_agg(distinct x.usuario_id order by x.usuario_id) into v
    from alerta_reservar_envios(array['telegram', 'discord'], 100) x;
  if v is distinct from array['00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: a linha do Bruno não voltou para a fila %', v;
  end if;
end $t$;

-- D4. Botão Resolvido: quem não administra não resolve; o "resolvido por" só vai para quem administra.
do $t$
declare oc uuid; r jsonb;
begin
  select o.id into oc
    from alerta_ocorrencias o join alerta_regras rg on rg.id = o.regra_id
   where rg.nome = 'Destinos' and o.estado = 'aberta';
  begin
    perform alerta_resolver(oc, '00000000-0000-0000-0000-000000000003');
    raise exception 'FALHOU: Carla (sem administrar) resolveu pelo botão';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;
  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000001');
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: Ana não resolveu %', r; end if;
  if exists (select 1 from alerta_envios where ocorrencia_id = oc and tipo = 'resolvido'
               and usuario_id <> '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: "resolvido" foi para quem não devia (Carla ou quem resolveu)';
  end if;
  if not exists (select 1 from alerta_envios where ocorrencia_id = oc and tipo = 'resolvido'
                   and usuario_id = '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: Bruno devia receber o "resolvido"';
  end if;
end $t$;
reset role;
