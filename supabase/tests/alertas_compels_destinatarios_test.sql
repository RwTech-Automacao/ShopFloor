-- Testes SQL da 0182 (responsáveis da regra 'compels': o Almoxarifado também pode ser responsável).
-- Rodar com supabase/tests/rodar-alertas-test.sh, na mesma base, DEPOIS de todas as migrações de alertas
-- até a 0180 e com a 0182 aplicada duas vezes.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0182 troca a régua do responsável em QUATRO lugares (a lista da tela,
-- os dois fan-outs da alerta_avaliar, o "Resolvido" e a reserva da fila). Se um deles ficar para trás, a
-- Gilania aparece na lista e nunca recebe (a linha fica pendente e expira em silêncio), ou recebe e não
-- consegue apertar "Resolvido". E nos outros tipos NADA pode mudar.
--
-- O mapa dos testes:
--   T1  esquema: UMA alerta_destinatarios (a de 2 parâmetros); alerta_pode_receber só para service_role;
--   T2  alerta_pode_receber: a tabela-verdade (admin sempre; Almoxarifado só no 'compels'; sem
--       shopfloor.visualizar, sem recebimento.lancar ou inativo, nunca);
--   T3  alerta_destinatarios: sem tipo = só quem administra (a lista de sempre); com 'compels' = + o
--       Almoxarifado, marcado administra = false;
--   T4  ⚠️ alerta do Compels (ocorrência): a Gilania entra no fan-out; quem não tem a régua, não;
--   T5  ⚠️ aviso de gravação do Compels (sem ocorrência): idem;
--   T6  ⚠️ a reserva da fila ENTREGA as linhas da Gilania do Compels, e NÃO as de outro tipo;
--   T7  ⚠️ a Gilania aperta "Resolvido" no alerta do Compels; quem está na regra sem a régua, não; o
--       "resolvido por" chega ao administrador.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- massa: perfis e pessoas ----------
-- d1 Admin   : administra o ShopFloor.
-- d2 Gilania : perfil Almoxarifado (recebimento.lancar + shopfloor.visualizar).
-- d3 Hugo    : só recebimento.lancar (não abre a tela do Almoxarifado).
-- d4 Iris    : só shopfloor.visualizar.
-- d5 Joana   : perfil Almoxarifado, mas INATIVA.
insert into public.perfis (id, nome) values
  ('00000000-0000-0000-0000-0000000182a1', 'Admin SF 0182'),
  ('00000000-0000-0000-0000-0000000182a2', 'Almoxarifado 0182'),
  ('00000000-0000-0000-0000-0000000182a3', 'So lancar 0182'),
  ('00000000-0000-0000-0000-0000000182a4', 'So visualizar 0182')
on conflict (id) do nothing;
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000182a1', 'shopfloor', 'administrar'),
  ('00000000-0000-0000-0000-0000000182a2', 'recebimento', 'lancar'),
  ('00000000-0000-0000-0000-0000000182a2', 'recebimento', 'visualizar'),
  ('00000000-0000-0000-0000-0000000182a2', 'shopfloor', 'visualizar'),
  ('00000000-0000-0000-0000-0000000182a3', 'recebimento', 'lancar'),
  ('00000000-0000-0000-0000-0000000182a4', 'shopfloor', 'visualizar')
on conflict do nothing;
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000182d1', 'Admin 0182',   'admin0182@x',   true,  '00000000-0000-0000-0000-0000000182a1'),
  ('00000000-0000-0000-0000-0000000182d2', 'Gilania 0182', 'gilania0182@x', true,  '00000000-0000-0000-0000-0000000182a2'),
  ('00000000-0000-0000-0000-0000000182d3', 'Hugo 0182',    'hugo0182@x',    true,  '00000000-0000-0000-0000-0000000182a3'),
  ('00000000-0000-0000-0000-0000000182d4', 'Iris 0182',    'iris0182@x',    true,  '00000000-0000-0000-0000-0000000182a4'),
  ('00000000-0000-0000-0000-0000000182d5', 'Joana 0182',   'joana0182@x',   false, '00000000-0000-0000-0000-0000000182a2')
on conflict (id) do nothing;
insert into public.alerta_contas (usuario_id, canal, externo_id) values
  ('00000000-0000-0000-0000-0000000182d1', 'telegram', 'TD1'),
  ('00000000-0000-0000-0000-0000000182d2', 'telegram', 'TD2'),
  ('00000000-0000-0000-0000-0000000182d3', 'telegram', 'TD3'),
  ('00000000-0000-0000-0000-0000000182d4', 'telegram', 'TD4'),
  ('00000000-0000-0000-0000-0000000182d5', 'telegram', 'TD5')
on conflict (usuario_id, canal) do nothing;

-- Regra 'compels' com TODOS como responsáveis: quem recebe é decidido pela régua, não pela lista.
create function public.teste_cd_regra(p_nome text) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, pmos, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais,
     destinatarios, avisar_pessoas, avisar_canal, ativa, criado_por)
  values (p_nome, 'compels', 'shopfloor', array['ALMOX182'], '{}'::text[], 'op', null, null, 60, array['telegram'],
          array['00000000-0000-0000-0000-0000000182d1', '00000000-0000-0000-0000-0000000182d2',
                '00000000-0000-0000-0000-0000000182d3', '00000000-0000-0000-0000-0000000182d4',
                '00000000-0000-0000-0000-0000000182d5']::uuid[],
          true, false, true, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

create function public.teste_cd_quem(p_regra text, p_tipo text) returns uuid[] language sql as $f$
  select coalesce(array_agg(usuario_id order by usuario_id), '{}'::uuid[])
    from public.alerta_envios
   where dados->>'regra_nome' = p_regra and tipo = p_tipo and destino_tipo = 'usuario'
$f$;

-- ---------- T1: esquema ----------
do $t$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'alerta_destinatarios';
  if v_n <> 1 then raise exception 'T1 FALHOU: % sobrecargas de alerta_destinatarios', v_n; end if;
  if (select pronargs from pg_proc where proname = 'alerta_destinatarios') <> 2 then
    raise exception 'T1 FALHOU: alerta_destinatarios não tem 2 parâmetros';
  end if;
  if has_function_privilege('authenticated', 'public.alerta_pode_receber(uuid, text, text)', 'execute') then
    raise exception 'T1 FALHOU: authenticated executa alerta_pode_receber';
  end if;
  if has_function_privilege('anon', 'public.alerta_pode_receber(uuid, text, text)', 'execute') then
    raise exception 'T1 FALHOU: anon executa alerta_pode_receber';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_pode_receber(uuid, text, text)', 'execute') then
    raise exception 'T1 FALHOU: service_role não executa alerta_pode_receber';
  end if;
  if not has_function_privilege('authenticated', 'public.alerta_destinatarios(text, text)', 'execute') then
    raise exception 'T1 FALHOU: authenticated não executa alerta_destinatarios';
  end if;
  if has_function_privilege('anon', 'public.alerta_destinatarios(text, text)', 'execute') then
    raise exception 'T1 FALHOU: anon executa alerta_destinatarios';
  end if;
end $t$;
select 'T1 (esquema e grants): ok';

-- ---------- T2: a tabela-verdade ----------
do $t$
declare
  c record;
begin
  for c in
    select * from (values
      -- usuário,                                  módulo,      tipo,        esperado
      ('00000000-0000-0000-0000-0000000182d1'::uuid, 'shopfloor', 'compels',   true),
      ('00000000-0000-0000-0000-0000000182d1'::uuid, 'shopfloor', 'aprovacao', true),
      ('00000000-0000-0000-0000-0000000182d1'::uuid, 'shopfloor', null,        true),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'shopfloor', 'compels',   true),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'shopfloor', 'aprovacao', false),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'shopfloor', 'parado',    false),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'shopfloor', 'ficha',     false),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'shopfloor', null,        false),
      ('00000000-0000-0000-0000-0000000182d2'::uuid, 'recebimento', 'emb',     false),
      ('00000000-0000-0000-0000-0000000182d3'::uuid, 'shopfloor', 'compels',   false),
      ('00000000-0000-0000-0000-0000000182d4'::uuid, 'shopfloor', 'compels',   false),
      ('00000000-0000-0000-0000-0000000182d5'::uuid, 'shopfloor', 'compels',   false),
      (null::uuid,                                   'shopfloor', 'compels',   false)
    ) v(usuario, modulo, tipo, esperado)
  loop
    if coalesce(public.alerta_pode_receber(c.usuario, c.modulo, c.tipo), false) <> c.esperado then
      raise exception 'T2 FALHOU: alerta_pode_receber(%, %, %) <> %', c.usuario, c.modulo, c.tipo, c.esperado;
    end if;
  end loop;
end $t$;
select 'T2 (alerta_pode_receber): ok';

-- ---------- T3: a lista da tela ----------
do $t$
declare v_ids uuid[]; v_adm boolean;
begin
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  -- Sem tipo: a lista de sempre (só quem administra), como o app antigo pede.
  select array_agg(usuario_id) into v_ids from public.alerta_destinatarios('shopfloor');
  if not ('00000000-0000-0000-0000-0000000182d1' = any (v_ids)) then raise exception 'T3 FALHOU: admin fora da lista'; end if;
  if '00000000-0000-0000-0000-0000000182d2' = any (v_ids) then raise exception 'T3 FALHOU: Gilania na lista sem tipo'; end if;
  select array_agg(usuario_id) into v_ids from public.alerta_destinatarios(p_modulo => 'shopfloor');
  if '00000000-0000-0000-0000-0000000182d2' = any (v_ids) then raise exception 'T3 FALHOU: Gilania na lista (nomeado)'; end if;
  select array_agg(usuario_id) into v_ids from public.alerta_destinatarios('shopfloor', 'aprovacao');
  if '00000000-0000-0000-0000-0000000182d2' = any (v_ids) then raise exception 'T3 FALHOU: Gilania na lista da aprovação'; end if;

  -- Com 'compels': + a Gilania, marcada como quem NÃO administra. Hugo, Iris e Joana (inativa) fora.
  select array_agg(usuario_id) into v_ids from public.alerta_destinatarios('shopfloor', 'compels');
  if not ('00000000-0000-0000-0000-0000000182d1' = any (v_ids)) then raise exception 'T3 FALHOU: admin fora da lista do compels'; end if;
  if not ('00000000-0000-0000-0000-0000000182d2' = any (v_ids)) then raise exception 'T3 FALHOU: Gilania fora da lista do compels'; end if;
  if v_ids && array['00000000-0000-0000-0000-0000000182d3', '00000000-0000-0000-0000-0000000182d4',
                    '00000000-0000-0000-0000-0000000182d5']::uuid[] then
    raise exception 'T3 FALHOU: lista do compels com quem não tem a régua: %', v_ids;
  end if;
  select administra into v_adm from public.alerta_destinatarios('shopfloor', 'compels')
   where usuario_id = '00000000-0000-0000-0000-0000000182d2';
  if v_adm then raise exception 'T3 FALHOU: Gilania marcada como administradora'; end if;
  select administra into v_adm from public.alerta_destinatarios('shopfloor', 'compels')
   where usuario_id = '00000000-0000-0000-0000-0000000182d1';
  if not v_adm then raise exception 'T3 FALHOU: admin marcado como não administrador'; end if;

  -- Quem chama continua precisando administrar o módulo.
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform * from public.alerta_destinatarios('shopfloor', 'compels');
    raise exception 'T3 FALHOU: lista devolvida a quem não administra';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
end $t$;
select 'T3 (alerta_destinatarios por tipo): ok';

-- ---------- T4: o alerta do Compels (ocorrência) chega à Gilania ----------
select public.teste_cd_regra('Compels 0182');
insert into public.sf_estoque_envios (pmo, op, posto, operacao, quantidade, ok, erro, tentativas)
values ('PMOC182', '9182', 'ALMOX182', 'entrada', 3, false, 'Compels 0182: sem saldo', 1);
do $t$
declare v jsonb; v_quem uuid[];
begin
  set local role service_role;
  v := public.alerta_avaliar();
  reset role;
  if (v->>'ocupado')::boolean then raise exception 'T4: avaliação ocupada'; end if;
  v_quem := public.teste_cd_quem('Compels 0182', 'alerta');
  if v_quem <> array['00000000-0000-0000-0000-0000000182d1', '00000000-0000-0000-0000-0000000182d2']::uuid[] then
    raise exception 'T4 FALHOU: o alerta foi para %, esperava admin e Gilania', v_quem;
  end if;
end $t$;
select 'T4 (alerta do Compels chega ao Almoxarifado): ok';

-- ---------- T5: o aviso de gravação do Compels (sem ocorrência) também ----------
insert into public.sf_estoque_envios (pmo, op, posto, operacao, quantidade, ok, aviso, tentativas, enviado_em)
values ('PMOC182', '9183', 'ALMOX182', 'entrada', 2, true, 'Compels 0182: gravado com ressalva', 1, now());
do $t$
declare v_quem uuid[];
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  v_quem := public.teste_cd_quem('Compels 0182', 'compels_aviso');
  if v_quem <> array['00000000-0000-0000-0000-0000000182d1', '00000000-0000-0000-0000-0000000182d2']::uuid[] then
    raise exception 'T5 FALHOU: o aviso foi para %, esperava admin e Gilania', v_quem;
  end if;
end $t$;
select 'T5 (aviso de gravação chega ao Almoxarifado): ok';

-- ---------- T6: a reserva da fila entrega as linhas dela (e só as do Compels) ----------
-- Uma linha "de outro tipo" para a Gilania (resumo: sem ocorrência e sem a régua do Compels) tem de
-- ficar PENDENTE: a régua da reserva é a mesma de antes fora do 'compels'.
insert into public.alerta_envios (usuario_id, canal, tipo, modulo, dados, destino_tipo)
values ('00000000-0000-0000-0000-0000000182d2', 'telegram', 'resumo', 'shopfloor',
        jsonb_build_object('regra_nome', 'Resumo 0182'), 'usuario');
do $t$
declare v_tipos text[]; v_ext text;
begin
  set local role service_role;
  select array_agg(r.tipo order by r.tipo), max(r.externo_id)
    into v_tipos, v_ext
    from public.alerta_reservar_envios(array['telegram'], 100) r
   where r.usuario_id = '00000000-0000-0000-0000-0000000182d2';
  reset role;
  if v_tipos is distinct from array['alerta', 'compels_aviso']::text[] then
    raise exception 'T6 FALHOU: a reserva entregou % para a Gilania, esperava alerta e compels_aviso', v_tipos;
  end if;
  if v_ext <> 'TD2' then raise exception 'T6 FALHOU: endereço %', v_ext; end if;
  if (select tentativas from public.alerta_envios where dados->>'regra_nome' = 'Resumo 0182') <> 0 then
    raise exception 'T6 FALHOU: a linha de resumo da Gilania foi reservada';
  end if;
end $t$;
select 'T6 (reserva entrega só as linhas do Compels): ok';

-- ---------- T7: "Resolvido" pelo botão ----------
do $t$
declare v_oc uuid; v jsonb; v_quem uuid[];
begin
  select oc.id into v_oc
    from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Compels 0182' and oc.estado = 'aberta';
  if v_oc is null then raise exception 'T7: ocorrência não encontrada'; end if;

  set local role service_role;
  -- Hugo está na regra, mas não tem a régua: não resolve.
  begin
    perform public.alerta_resolver(v_oc, '00000000-0000-0000-0000-0000000182d3');
    raise exception 'T7 FALHOU: Hugo resolveu';
  exception when others then
    if sqlerrm <> 'NAO_DESTINATARIO' then raise; end if;
  end;
  -- A Gilania resolve.
  v := public.alerta_resolver(v_oc, '00000000-0000-0000-0000-0000000182d2', 'Liberei o saldo');
  reset role;
  if (v->>'ja_resolvida')::boolean then raise exception 'T7 FALHOU: já estava resolvida'; end if;
  if (select estado from public.alerta_ocorrencias where id = v_oc) <> 'resolvida' then
    raise exception 'T7 FALHOU: não resolveu';
  end if;
  -- O "resolvido por Gilania" vai ao admin (e não a ela mesma, nem a quem não tem a régua).
  select coalesce(array_agg(usuario_id order by usuario_id), '{}'::uuid[]) into v_quem
    from public.alerta_envios where ocorrencia_id = v_oc and tipo = 'resolvido' and destino_tipo = 'usuario';
  if v_quem <> array['00000000-0000-0000-0000-0000000182d1']::uuid[] then
    raise exception 'T7 FALHOU: o resolvido foi para %, esperava só o admin', v_quem;
  end if;
end $t$;
select 'T7 (Almoxarifado resolve o alerta do Compels): ok';

-- Limpa a massa que poderia confundir quem vier depois.
update public.alerta_regras set ativa = false where nome = 'Compels 0182';
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;
