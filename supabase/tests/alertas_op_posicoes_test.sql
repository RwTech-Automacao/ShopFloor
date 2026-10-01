-- Testes SQL da 0136 (PMO/OP em todo alerta + posições no alerta de defeito). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_canal_test.sql, na mesma base, com a
-- 0136 aplicada por cima da 0113/0114/0115/0122/0123 — igual à produção.
--
-- Reaproveita o helper public.teste_regra, criado por alertas_tipos_test.sql.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Preparação: as regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Bruno recebe o "resolvido" de uma ocorrência que a Ana encerra (T9).
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000002', 'telegram', 'T2-OP')
on conflict (usuario_id, canal) do nothing;

-- T1. A coluna nova existe e aceita jsonb.
do $t$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'alerta_ocorrencias' and column_name = 'ops'
                    and data_type = 'jsonb') then
    raise exception 'FALHOU: alerta_ocorrencias.ops não existe como jsonb';
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- Bipes de apoio. Posto OP-Taxa: 1 aprovado e 2 reprovados, em DUAS OPs da mesma PMO, mais uma
-- linha com OP em branco (que não pode virar item da lista).
insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
  (now() - interval '10 minutes', 'OP-Taxa', 'PMOA',   '2', 'Aprovado',  '', ''),
  (now() - interval '9 minutes',  'OP-Taxa', ' PMOA ', '1', 'Reprovado', '', ''),
  (now() - interval '8 minutes',  'OP-Taxa', 'PMOA',   '1', 'Reprovado', '', ''),
  (now() - interval '7 minutes',  'OP-Taxa', 'PMOA',   '',  'Reprovado', '', '');

-- Posto OP-Def: o mesmo defeito 4 vezes, em 2 OPs, com a posição R12 repetida e uma em branco.
insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
  (now() - interval '10 minutes', 'OP-Def', 'PMOA', '1', 'Reprovado', '2040 COMPONENTE FALTANDO', 'R12'),
  (now() - interval '9 minutes',  'OP-Def', 'PMOA', '1', 'Reprovado', '2040 COMPONENTE FALTANDO', 'R12'),
  (now() - interval '8 minutes',  'OP-Def', 'PMOA', '2', 'Reprovado', '2040 COMPONENTE FALTANDO', 'C47'),
  (now() - interval '7 minutes',  'OP-Def', 'PMOA', '2', 'Reprovado', '2040 COMPONENTE FALTANDO', '');

-- Posto OP-Tempo: 3 bipes de 5 em 5 minutos (média 300 s, acima do limite de 60 s).
insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
  (now() - interval '12 minutes', 'OP-Tempo', 'PMOB', '1', 'Aprovado', '', ''),
  (now() - interval '7 minutes',  'OP-Tempo', 'PMOB', '1', 'Aprovado', '', ''),
  (now() - interval '2 minutes',  'OP-Tempo', 'PMOB', '7', 'Aprovado', '', '');

-- T2. alerta_defeitos: posições COM repetição (sem as em branco) e as OPs distintas.
do $t$
declare
  r record;
begin
  select * into r from public.alerta_defeitos(array['OP-Def'], 60, '{}') limit 1;
  if r.ocorrencias <> 4 then
    raise exception 'FALHOU: alerta_defeitos contou % em vez de 4', r.ocorrencias;
  end if;
  -- 4 linhas, 1 com posição em branco: sobram 3 entradas, com R12 duas vezes.
  if coalesce(cardinality(r.posicoes), 0) <> 3 then
    raise exception 'FALHOU: posicoes = % (esperava 3 entradas)', r.posicoes;
  end if;
  if (select count(*) from unnest(r.posicoes) p where p = 'R12') <> 2 then
    raise exception 'FALHOU: a repetição de R12 não foi preservada (%)', r.posicoes;
  end if;
  if '' = any (r.posicoes) then
    raise exception 'FALHOU: posição em branco entrou na lista (%)', r.posicoes;
  end if;
  if r.ops is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: ops do defeito = %', r.ops;
  end if;
end $t$;

-- T3. alerta_ops, janela 'tempo': as duas OPs, ordenadas, sem a linha de OP em branco. PMO aparada
--     dos dois lados (' PMOA ' e 'PMOA' são a mesma ordem). Posto sem bipe = lista vazia.
do $t$
declare
  v jsonb;
begin
  select ops into v from public.alerta_ops(array['OP-Taxa'], 'tempo', 60, '{}');
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: alerta_ops janela tempo = %', v;
  end if;
  select ops into v from public.alerta_ops(array['OP-Nada'], 'tempo', 60, '{}');
  if v is distinct from '[]'::jsonb then
    raise exception 'FALHOU: posto sem bipe devia dar lista vazia, deu %', v;
  end if;
  -- Filtro de PMO da regra: PMOB não aparece no posto OP-Taxa.
  select ops into v from public.alerta_ops(array['OP-Taxa'], 'tempo', 60, array['PMOB']);
  if v is distinct from '[]'::jsonb then
    raise exception 'FALHOU: filtro de PMO ignorado, deu %', v;
  end if;
end $t$;

-- T4. alerta_ops, janela 'bipes': só os N últimos bipes COM status entram. Com 1, é o bipe de OP em
--     branco (o último), que sai pelo filtro de OP vazia e deixa a lista vazia.
do $t$
declare
  v jsonb;
begin
  select ops into v from public.alerta_ops(array['OP-Taxa'], 'bipes', 1, '{}');
  if v is distinct from '[]'::jsonb then
    raise exception 'FALHOU: janela de 1 bipe pegou mais que o último (%)', v;
  end if;
  select ops into v from public.alerta_ops(array['OP-Taxa'], 'bipes', 2, '{}');
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}]'::jsonb then
    raise exception 'FALHOU: janela de 2 bipes = %', v;
  end if;
  select ops into v from public.alerta_ops(array['OP-Taxa'], 'bipes', 10, '{}');
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: janela de 10 bipes = %', v;
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- As três regras e uma avaliação.
do $t$
begin
  perform public.teste_regra('OP taxa',    'aprovacao', array['OP-Taxa'],  90,   'tempo', 60, 2,    null, null, null);
  perform public.teste_regra('OP tempo',   'tempo',     array['OP-Tempo'], null, 'tempo', 60, 2,    60,   null, 30);
  perform public.teste_regra('OP defeito', 'defeito',   array['OP-Def'],   null, 'tempo', 60, null, null, 2,    null);
end $t$;

set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;

-- T5. Tipo aprovação: a ocorrência gravou as OPs e o `dados` da fila as leva.
do $t$
declare
  v jsonb;
begin
  select ops into v from public.alerta_ocorrencias
   where posto = 'OP-Taxa' and estado = 'aberta';
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: alerta_ocorrencias.ops (aprovacao) = %', v;
  end if;
  select dados->'ops' into v from public.alerta_envios
   where tipo = 'alerta' and dados->>'posto' = 'OP-Taxa' limit 1;
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: dados.ops (aprovacao) = %', v;
  end if;
end $t$;

-- T6. Tipo defeito: o `dados` leva as posições (com repetição, sem as em branco) e as OPs.
do $t$
declare
  v jsonb;
begin
  select dados->'posicoes' into v from public.alerta_envios
   where tipo = 'alerta' and dados->>'posto' = 'OP-Def' limit 1;
  if v is null then
    raise exception 'FALHOU: o alerta de defeito não foi enfileirado';
  end if;
  if jsonb_array_length(v) <> 3 then
    raise exception 'FALHOU: dados.posicoes = % (esperava 3 entradas)', v;
  end if;
  if (select count(*) from jsonb_array_elements_text(v) x where x = 'R12') <> 2 then
    raise exception 'FALHOU: a repetição de R12 não chegou ao dados (%)', v;
  end if;
  select dados->'ops' into v from public.alerta_envios
   where tipo = 'alerta' and dados->>'posto' = 'OP-Def' limit 1;
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: dados.ops (defeito) = %', v;
  end if;
end $t$;

-- T7. Tipo tempo: o `dados` leva as OPs da janela (duas, uma delas só no último bipe).
do $t$
declare
  v jsonb;
begin
  select dados->'ops' into v from public.alerta_envios
   where tipo = 'alerta' and dados->>'posto' = 'OP-Tempo' limit 1;
  if v is distinct from '[{"pmo": "PMOB", "op": "1"}, {"pmo": "PMOB", "op": "7"}]'::jsonb then
    raise exception 'FALHOU: dados.ops (tempo) = %', v;
  end if;
end $t$;

-- T8. "Normalizou": a taxa volta ao normal numa janela em que só a OP-1 aparece. A ocorrência
--     encerra com as OPs refrescadas, e a mensagem de normalização diz a ordem.
do $t$
declare
  v jsonb;
begin
  update public.sf_registros set data_hora = data_hora - interval '3 hours' where posto = 'OP-Taxa';
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '2 minutes', 'OP-Taxa', 'PMOA', '1', 'Aprovado', '', ''),
    (now() - interval '1 minutes', 'OP-Taxa', 'PMOA', '1', 'Aprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select ops into v from public.alerta_ocorrencias
   where posto = 'OP-Taxa' and estado = 'normalizada' order by normalizada_em desc limit 1;
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}]'::jsonb then
    raise exception 'FALHOU: ops da ocorrência normalizada = %', v;
  end if;
  select dados->'ops' into v from public.alerta_envios
   where tipo = 'normalizou' and dados->>'posto' = 'OP-Taxa' limit 1;
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}]'::jsonb then
    raise exception 'FALHOU: dados.ops do normalizou = %', v;
  end if;
end $t$;

-- T8b. Janela que esvazia de vez: as OPs já gravadas NÃO são apagadas pelo refresco (é o que faz a
--      mensagem de normalização do defeito continuar dizendo de qual ordem ela falava).
do $t$
declare
  oc uuid;
  v  jsonb;
begin
  select id into oc from public.alerta_ocorrencias where posto = 'OP-Def' and estado = 'aberta';
  if oc is null then raise exception 'FALHOU: a ocorrência do OP-Def não está aberta'; end if;
  update public.sf_registros set data_hora = data_hora - interval '3 hours' where posto = 'OP-Def';
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select ops into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from '[{"pmo": "PMOA", "op": "1"}, {"pmo": "PMOA", "op": "2"}]'::jsonb then
    raise exception 'FALHOU: o refresco apagou as OPs da ocorrência (%)', v;
  end if;
end $t$;

-- T8c. Janela com bipes mas TODOS sem OP: é o único caso em que a lista nova chega VAZIA num
--      update (janela sem bipe nenhum nem chega a avaliar). Sem o `nullif` do refresco, a
--      ocorrência perderia a ordem que já tinha gravada, e a mensagem seguinte sairia sem ela.
do $t$
declare
  oc uuid;
  v  jsonb;
begin
  perform public.teste_regra('OP vazia', 'aprovacao', array['OP-Vazia'], 90, 'tempo', 60, 2, null, null, null);
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '20 minutes', 'OP-Vazia', 'PMOA', '5', 'Reprovado', '', ''),
    (now() - interval '19 minutes', 'OP-Vazia', 'PMOA', '5', 'Reprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select id, ops into oc, v from public.alerta_ocorrencias where posto = 'OP-Vazia' and estado = 'aberta';
  if v is distinct from '[{"pmo": "PMOA", "op": "5"}]'::jsonb then
    raise exception 'FALHOU: a ocorrência do OP-Vazia nasceu com ops = %', v;
  end if;

  -- Os bipes com OP saem da janela; entram dois com OP em branco. Continua reprovando (segue
  -- "abaixo", então passa pelo update do "continua"), e a lista da janela agora é vazia.
  update public.sf_registros set data_hora = data_hora - interval '3 hours' where posto = 'OP-Vazia';
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '3 minutes', 'OP-Vazia', 'PMOA', '', 'Reprovado', '', ''),
    (now() - interval '2 minutes', 'OP-Vazia', 'PMOA', '', 'Reprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select ops into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from '[{"pmo": "PMOA", "op": "5"}]'::jsonb then
    raise exception 'FALHOU: o update do "continua" apagou as OPs da ocorrência (%)', v;
  end if;

  -- Agora a taxa volta ao normal com a janela ainda sem OP: o update do "normalizou" também não
  -- pode apagar, senão a mensagem de normalização sai sem a ordem. Os reprovados sem OP saem da
  -- janela primeiro — senão a taxa não chega aos 90% e a ocorrência não normaliza.
  update public.sf_registros set data_hora = data_hora - interval '3 hours' where posto = 'OP-Vazia';
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '1 minutes', 'OP-Vazia', 'PMOA', '', 'Aprovado', '', ''),
    (now(),                        'OP-Vazia', 'PMOA', '', 'Aprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select ops into v from public.alerta_ocorrencias where id = oc;
  if v is distinct from '[{"pmo": "PMOA", "op": "5"}]'::jsonb then
    raise exception 'FALHOU: o update do "normalizou" apagou as OPs da ocorrência (%)', v;
  end if;
  select dados->'ops' into v from public.alerta_envios
   where tipo = 'normalizou' and dados->>'posto' = 'OP-Vazia' limit 1;
  if v is distinct from '[{"pmo": "PMOA", "op": "5"}]'::jsonb then
    raise exception 'FALHOU: dados.ops do normalizou do OP-Vazia = %', v;
  end if;
end $t$;

-- T9. O envio "resolvido" também diz a ordem: pmo, op e ops.
do $t$
declare
  oc uuid;
  v  jsonb;
  d  jsonb;
begin
  perform public.teste_regra('OP resolver', 'aprovacao', array['OP-Res'], 90, 'tempo', 60, 2, null, null, null);
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito, posicao) values
    (now() - interval '5 minutes', 'OP-Res', 'PMOA', '9', 'Reprovado', '', ''),
    (now() - interval '4 minutes', 'OP-Res', 'PMOA', '9', 'Reprovado', '', '');
  set role service_role;
  perform alerta_avaliar();
  reset role;
  select id into oc from public.alerta_ocorrencias where posto = 'OP-Res' and estado = 'aberta';
  if oc is null then raise exception 'FALHOU: a ocorrência do OP-Res não abriu'; end if;
  perform public.alerta_resolver_interno(oc, '00000000-0000-0000-0000-000000000001', true);
  select dados into d from public.alerta_envios
   where tipo = 'resolvido' and dados->>'posto' = 'OP-Res' limit 1;
  if d is null then raise exception 'FALHOU: o "resolvido" do OP-Res não foi enfileirado'; end if;
  v := d->'ops';
  if v is distinct from '[{"pmo": "PMOA", "op": "9"}]'::jsonb then
    raise exception 'FALHOU: dados.ops do resolvido = %', v;
  end if;
  -- pmo/op escalares continuam só da janela 'op' (nulos aqui), mas a CHAVE passa a existir.
  if not (d ? 'pmo') or not (d ? 'op') then
    raise exception 'FALHOU: o resolvido não leva as chaves pmo/op (%)', d;
  end if;
end $t$;

select 'alertas 0136 (OP e posições): ok' as resultado;
