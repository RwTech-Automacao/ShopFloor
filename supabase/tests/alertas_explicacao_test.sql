-- Testes SQL da 0137 (quem resolve o alerta diz o que fez). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_op_posicoes_test.sql, na mesma base,
-- com a 0137 aplicada por cima da 0113/0114/0115/0122/0123/0136 — igual à produção.
--
-- Reaproveita o helper public.teste_regra, criado por alertas_tipos_test.sql, e os perfis de lá
-- (Ana e Bruno = Gestor, com shopfloor.administrar; Carla = Operador).
--
-- ⚠️ COMPARAÇÃO DE jsonb É `is distinct from`, NUNCA `<>`. Chave ausente faz `dados->'x'` virar
-- NULL, `NULL <> y` é NULL, e o `if` NÃO dispara — a mutação que apaga a chave passaria batida.
-- Aconteceu de verdade na 0136; aqui a chave 'explicacao' é justamente o que está sendo testado.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Preparação: as regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Bruno é o OUTRO responsável: é ele quem recebe o "✅ resolvido por Ana" que carrega a explicação.
-- Ele já tem conta em dois canais (discord 'D2' do alertas_test, telegram 'T2-OP' do
-- alertas_op_posicoes_test), então cada resolução enfileira DUAS linhas — por isso nenhuma
-- afirmação aqui depende do número de linhas da fila, e sim de TODAS elas carregarem a explicação.
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000002', 'telegram', 'T2-OP')
on conflict (usuario_id, canal) do nothing;

-- Helper: abre uma ocorrência num posto só deste teste (2 reprovados numa regra de 90%) e devolve
-- o id. Dois bipes bastam: minimo_bipes = 2 e taxa 0% < 90%.
create function public.teste_ocorrencia_expl(p_posto text) returns uuid language plpgsql as $f$
declare
  oc uuid;
begin
  perform public.teste_regra('EX ' || p_posto, 'aprovacao', array[p_posto], 90, 'tempo', 60, 2,
                             null, null, null);
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '5 minutes', p_posto, 'PMOE', '1', 'Reprovado', '', ''),
    (now() - interval '4 minutes', p_posto, 'PMOE', '1', 'Reprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select id into oc from public.alerta_ocorrencias where posto = p_posto and estado = 'aberta';
  if oc is null then raise exception 'FALHOU: a ocorrência do posto % não abriu', p_posto; end if;
  return oc;
end
$f$;

-- T1. A coluna nova existe como text NOT NULL com default vazio. O default é o que faz as
--     ocorrências resolvidas ANTES da 0137 (que não têm explicação nenhuma) continuarem válidas.
do $t$
declare
  c record;
begin
  select data_type, is_nullable, column_default into c
    from information_schema.columns
   where table_name = 'alerta_ocorrencias' and column_name = 'explicacao';
  if c is null then
    raise exception 'FALHOU: alerta_ocorrencias.explicacao não existe';
  end if;
  if c.data_type <> 'text' then
    raise exception 'FALHOU: explicacao é % em vez de text', c.data_type;
  end if;
  if c.is_nullable <> 'NO' then
    raise exception 'FALHOU: explicacao aceita nulo';
  end if;
  if c.column_default is distinct from '''''::text' then
    raise exception 'FALHOU: default da explicacao = % (esperava vazio)', c.column_default;
  end if;
end $t$;

-- T2. A ASSINATURA ANTIGA NÃO SOBREVIVE. Sem o `drop function`, a velha e a nova coexistiriam e
--     uma chamada sem o parâmetro cairia na velha, que não grava nada: a explicação sumiria EM
--     SILÊNCIO. Uma função de cada nome, e cada uma com o parâmetro novo.
do $t$
declare
  r record;
begin
  for r in
    select p.proname, count(*) as n,
           max(pg_get_function_identity_arguments(p.oid)) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('alerta_resolver_interno', 'alerta_resolver', 'alerta_resolver_admin')
     group by p.proname
  loop
    if r.n <> 1 then
      raise exception 'FALHOU: % tem % assinaturas (a antiga não foi dropada)', r.proname, r.n;
    end if;
    if r.args not like '%p_explicacao text%' then
      raise exception 'FALHOU: % não tem p_explicacao (%)', r.proname, r.args;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('alerta_resolver_interno', 'alerta_resolver', 'alerta_resolver_admin')) <> 3 then
    raise exception 'FALHOU: as três funções de resolver não estão todas de pé';
  end if;
end $t$;

-- T3. CAMINHO DO GESTOR (tela -> alerta_resolver_admin): a explicação é gravada na ocorrência E vai
--     no `dados` do "resolvido" dos outros responsáveis. Sem a segunda metade ela ficaria guardada
--     e ninguém leria — que é exatamente o problema que a 0137 existe para resolver.
--     Os espaços das pontas são aparados: " x " e "x" são a mesma explicação.
do $t$
declare
  oc   uuid;
  d    jsonb;
  v    text;
  faltam int;
begin
  oc := public.teste_ocorrencia_expl('EX-Admin');
  perform public.alerta_resolver_admin(oc, '  Trocamos o feeder da máquina 3  ');

  select explicacao into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from 'Trocamos o feeder da máquina 3' then
    raise exception 'FALHOU: explicacao gravada = %', quote_literal(coalesce(v, '<null>'));
  end if;

  -- Duas guardas SEPARADAS (mesma lição da T6 da 0136): `dados->'explicacao'` nulo tanto quando a
  -- linha não existe quanto quando a chave não foi gravada. Juntas numa só, apagar a chave falharia
  -- com a mensagem da fila e mandaria quem depura para o lugar errado.
  if not exists (select 1 from public.alerta_envios
                  where tipo = 'resolvido' and dados->>'posto' = 'EX-Admin') then
    raise exception 'FALHOU: o "resolvido" do EX-Admin não foi enfileirado';
  end if;
  select dados into d from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'EX-Admin' limit 1;
  if d->'explicacao' is distinct from to_jsonb('Trocamos o feeder da máquina 3'::text) then
    raise exception 'FALHOU: dados.explicacao do resolvido = %', d;
  end if;
  -- TODAS as linhas da fila (Bruno em 2 canais) têm de levar a explicação, não só a primeira.
  select count(*) into faltam from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'EX-Admin'
     and dados->'explicacao' is distinct from to_jsonb('Trocamos o feeder da máquina 3'::text);
  if faltam <> 0 then
    raise exception 'FALHOU: % linha(s) do "resolvido" saíram sem a explicação', faltam;
  end if;
  -- O que a 0136 já levava continua indo (a 0137 ACRESCENTA uma chave, não troca o `dados`).
  if d->'ops' is distinct from '[{"pmo": "PMOE", "op": "1"}]'::jsonb then
    raise exception 'FALHOU: a 0137 mexeu no dados.ops do resolvido (%)', d;
  end if;
  if coalesce(d->>'resolvida_por_nome', '') = '' then
    raise exception 'FALHOU: a 0137 perdeu o resolvida_por_nome (%)', d;
  end if;
end $t$;

-- T4. CAMINHO DO DESTINATÁRIO (botão do Discord/Telegram -> alerta_resolver): a mesma explicação
--     pelo outro invólucro. As três portas do produto caem na `_interno`, e é por isso que o
--     parâmetro entra nela: nenhuma escapa.
do $t$
declare
  oc uuid;
  d  jsonb;
  v  text;
begin
  oc := public.teste_ocorrencia_expl('EX-Dest');
  set role service_role;
  perform public.alerta_resolver(oc, '00000000-0000-0000-0000-000000000001', 'Recalibramos a AOI');
  reset role;

  select explicacao into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from 'Recalibramos a AOI' then
    raise exception 'FALHOU: explicacao pelo caminho do destinatário = %',
                    quote_literal(coalesce(v, '<null>'));
  end if;
  if not exists (select 1 from public.alerta_envios
                  where tipo = 'resolvido' and dados->>'posto' = 'EX-Dest') then
    raise exception 'FALHOU: o "resolvido" do EX-Dest não foi enfileirado';
  end if;
  select dados into d from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'EX-Dest' limit 1;
  if d->'explicacao' is distinct from to_jsonb('Recalibramos a AOI'::text) then
    raise exception 'FALHOU: dados.explicacao pelo caminho do destinatário = %', d;
  end if;
end $t$;

-- T5. SEM EXPLICAÇÃO (vazia, nula, só espaços, ou nem passada): resolve IGUAL, e o `dados` NÃO
--     ganha a chave. Com a chave vazia pendurada, o texto sairia "resolvido por Ana:" com nada
--     depois — a decisão do produto é que a explicação é opcional e, sem ela, o aviso sai sem rabo.
--     O caso "nem passada" é o que prova que o default '' do parâmetro vale: é assim que o app de
--     hoje (anterior às Tasks 2 e 3) continua chamando.
do $t$
declare
  casos text[] := array['EX-Vazia', 'EX-Nula', 'EX-Espaco', 'EX-Default'];
  posto text;
  oc    uuid;
  d     jsonb;
  v     text;
  est   text;
begin
  foreach posto in array casos loop
    oc := public.teste_ocorrencia_expl(posto);
    if    posto = 'EX-Vazia'   then perform public.alerta_resolver_admin(oc, '');
    elsif posto = 'EX-Nula'    then perform public.alerta_resolver_admin(oc, null);
    elsif posto = 'EX-Espaco'  then perform public.alerta_resolver_admin(oc, '   ');
    else                            perform public.alerta_resolver_admin(oc);
    end if;

    select estado, explicacao into est, v from public.alerta_ocorrencias where id = oc;
    if est <> 'resolvida' then
      raise exception 'FALHOU: % não resolveu sem explicação (estado %)', posto, est;
    end if;
    if v is distinct from '' then
      raise exception 'FALHOU: % gravou explicacao = %', posto, quote_literal(coalesce(v, '<null>'));
    end if;

    if not exists (select 1 from public.alerta_envios
                    where tipo = 'resolvido' and dados->>'posto' = posto) then
      raise exception 'FALHOU: o "resolvido" do % não foi enfileirado', posto;
    end if;
    select dados into d from public.alerta_envios
     where tipo = 'resolvido' and dados->>'posto' = posto limit 1;
    if d ? 'explicacao' then
      raise exception 'FALHOU: % pendurou a chave explicacao no dados (%)', posto, d;
    end if;
  end loop;
end $t$;

-- T6. OCORRÊNCIA JÁ RESOLVIDA: apertar o botão de novo NÃO sobrescreve a explicação da primeira vez
--     (nem apaga, se a segunda chamada vier vazia) e não enfileira aviso nenhum. A regra já era
--     essa para resolvida_por/resolvida_em (`if o.estado = 'aberta'`); a explicação entra no MESMO
--     update, então herda a garantia — e este teste é o que não deixa alguém tirá-la de lá.
do $t$
declare
  oc    uuid;
  r     jsonb;
  v     text;
  antes int;
  depois int;
begin
  oc := public.teste_ocorrencia_expl('EX-Dupla');
  perform public.alerta_resolver_admin(oc, 'Primeira explicação');
  select count(*) into antes from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'EX-Dupla';
  if antes = 0 then raise exception 'FALHOU: o "resolvido" do EX-Dupla não foi enfileirado'; end if;

  -- Segunda tentativa COM texto diferente: não pode entrar.
  r := public.alerta_resolver_admin(oc, 'Segunda explicação');
  if (r->>'ja_resolvida')::boolean is not true then
    raise exception 'FALHOU: a segunda resolução não se declarou ja_resolvida (%)', r;
  end if;
  select explicacao into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from 'Primeira explicação' then
    raise exception 'FALHOU: a segunda resolução sobrescreveu a explicação (%)',
                    quote_literal(coalesce(v, '<null>'));
  end if;

  -- Terceira tentativa VAZIA: também não pode apagar.
  perform public.alerta_resolver_admin(oc, '');
  select explicacao into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from 'Primeira explicação' then
    raise exception 'FALHOU: uma resolução vazia apagou a explicação (%)',
                    quote_literal(coalesce(v, '<null>'));
  end if;

  select count(*) into depois from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'EX-Dupla';
  if depois <> antes then
    raise exception 'FALHOU: resolver de novo enfileirou aviso (% -> %)', antes, depois;
  end if;
end $t$;

-- T7. As exceções da `_interno` ficam de pé com o parâmetro novo (a 0137 não relaxou nada):
--     quem não é responsável é recusado mesmo mandando explicação, e ocorrência encerrada também.
do $t$
declare
  oc uuid;
begin
  oc := public.teste_ocorrencia_expl('EX-Guarda');

  -- Carla (Operador) não administra o ShopFloor. O webhook chama como service_role.
  set role service_role;
  begin
    perform public.alerta_resolver(oc, '00000000-0000-0000-0000-000000000003', 'Mexi em tudo');
    raise exception 'FALHOU: quem não é responsável resolveu mandando explicação';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;
  reset role;
  if (select explicacao from public.alerta_ocorrencias where id = oc) <> '' then
    raise exception 'FALHOU: a recusa gravou explicação';
  end if;

  -- Encerrada (normalizada) recusa igual, pelo caminho do gestor.
  update public.alerta_ocorrencias set estado = 'normalizada', normalizada_em = now() where id = oc;
  begin
    perform public.alerta_resolver_admin(oc, 'Tarde demais');
    raise exception 'FALHOU: ocorrência encerrada aceitou resolução com explicação';
  exception when others then
    if sqlerrm not like '%OCORRENCIA_ENCERRADA%' then raise; end if;
  end;
end $t$;

-- T8. Grants: as assinaturas NOVAS mantêm a mesma porta de antes — `alerta_resolver` é só do
--     service_role (o webhook) e a `_interno` não é de ninguém (só por invólucro). Sem este teste,
--     um `revoke` esquecido na assinatura nova abriria o resolver para qualquer `authenticated`.
set role authenticated;
do $t$
begin
  begin
    perform public.alerta_resolver('00000000-0000-0000-0000-000000000000'::uuid,
                                   '00000000-0000-0000-0000-000000000001'::uuid, 'x');
    raise exception 'FALHOU: authenticated executou alerta_resolver';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.alerta_resolver_interno('00000000-0000-0000-0000-000000000000'::uuid,
                                           '00000000-0000-0000-0000-000000000001'::uuid, false, 'x');
    raise exception 'FALHOU: authenticated executou alerta_resolver_interno';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
reset role;

drop function public.teste_ocorrencia_expl(text);

select 'alertas 0137 (explicação ao resolver): ok' as resultado;
