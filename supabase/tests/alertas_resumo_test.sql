-- Testes SQL da 0141 (resumo diário por posto: alerta_regras.tipo = 'resumo'). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_intervalos_test.sql, na mesma base,
-- com a 0141 aplicada por cima de tudo (a 0113/0114/0115/0122/0123/0136/0137/0139) — igual à
-- produção, onde já existem regras, ocorrências e fila.
--
-- Reaproveita só o helper teste_regra (alertas_tipos_test.sql): os do arquivo da 0139 são
-- apagados no fim dele.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0141 recria o alerta_avaliar, que roda de 5 em 5 minutos em
-- produção, e o defeito mais caro dela (o relatório sair duas vezes no mesmo dia, I-1) é SQL puro:
-- nenhum teste de vitest o enxerga. As afirmações abaixo foram conferidas por sabotagem — tirar a
-- guarda contra reenvio, gravar a data sem enviar e tirar o `continue` do resumo derrubam este
-- arquivo (ver o relatório da Task 5).
--
-- ⚠️ O CONTRATO DO p_resumos é {"<regra_id>": {"dia": "AAAA-MM-DD", "faixas": [{"inicio", "fim"}]}}.
-- O dia e as faixas chegam prontos do app; o banco não faz conta de fuso. Por isso os instantes
-- aqui são FIXOS (2026-03-11 e 2026-03-12, em UTC) e não dependem do now().
--
-- ⚠️ `avaliadas` TEM de ser 0 num dia só de resumo. É isso que prova que o `continue` do topo do
-- laço funciona: sem ele a linha do resumo escorregaria para o caminho da ocorrência, seria pulada
-- pela guarda `avaliavel = false` (cinto e suspensório) — sem erro, sem ocorrência fantasma — e a
-- ÚNICA marca visível da saída errada seria o contador `avaliadas` subir.
--
-- O mapa dos testes:
--   T0  esquema: a assinatura é UMA só, de 3 parâmetros, fechada para anon/authenticated;
--   T1  regra de resumo AUSENTE do mapa (ou mapa nulo / vazio / de outra regra) é pulada;
--   T2  ⚠️ dia sem nenhum posto com dado: não enfileira E NÃO grava resumo_enviado_em;
--   T3  o envio: uma mensagem por responsável x canal + uma no canal, com os números certos, a
--       ordem dos postos da regra, sem ocorrência, sem botão; posto sem bipe / só com status vazio /
--       com bipe só fora das faixas FICA FORA; fronteira >= no início e < no fim; e a data é gravada;
--   T4  ⚠️ REENVIO: a mesma rodada de novo enfileira ZERO (a guarda do I-1);
--   T5  o dia seguinte envia de novo (a guarda compara com o dia do mapa, não com um dia fixo);
--   T6  ⚠️ há dado mas ninguém alcançável: nada enfileirado e a data também NÃO é gravada;
--   T7  ⚠️ o resumo não encosta no caminho da ocorrência: alerta_ocorrencias não ganha linha;
--   T8  os tipos antigos continuam: aprovação por blocos e por bipes abrem ocorrência normalmente
--       na MESMA rodada em que o resumo está no mapa, e o resumo não atrapalha nem é contado.
-- (A idempotência da 0141 — aplicada três vezes no mesmo banco — é do runner, por construção.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Preparação: as regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Helper: cria uma regra de resumo. Ana é a destinatária (ela é Gestora, com conta no Telegram e
-- no Discord, desde o teste da 0115); p_destinatarios muda isso. avisar_canal liga a linha do canal.
create function public.teste_regra_resumo(
  p_nome text, p_postos text[], p_avisar_canal boolean default true,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-000000000001']::uuid[]
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, postos, janela_tipo, minimo_bipes, hora_resumo, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por)
  values (p_nome, 'resumo', p_postos, 'intervalos', null, '18:00', array['telegram', 'discord'],
          p_destinatarios, true, p_avisar_canal, true, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Helper: o p_resumos para UMA regra, pelo nome, com as duas faixas do turno do dia dado
-- (07:00–11:00 e 12:00–16:00 UTC, o almoço fica de fora). Formato do app (resumo.ts).
create function public.teste_resumos(p_regra text, p_dia date) returns jsonb
language sql as $f$
  select jsonb_build_object(rg.id::text, jsonb_build_object(
           'dia', to_char(p_dia, 'YYYY-MM-DD'),
           'faixas', jsonb_build_array(
             jsonb_build_object('inicio', ((p_dia + time '07:00') at time zone 'UTC'),
                                'fim',    ((p_dia + time '11:00') at time zone 'UTC')),
             jsonb_build_object('inicio', ((p_dia + time '12:00') at time zone 'UTC'),
                                'fim',    ((p_dia + time '16:00') at time zone 'UTC')))))
    from public.alerta_regras rg where rg.nome = p_regra
$f$;

-- Helper: quantas linhas de fila do tipo 'resumo' a regra já tem.
create function public.teste_envios_resumo(p_regra text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'resumo' and dados->>'regra_nome' = p_regra
$f$;

-- Helper: a data do último envio gravada na regra.
create function public.teste_resumo_enviado(p_regra text) returns date language sql as $f$
  select resumo_enviado_em from public.alerta_regras where nome = p_regra
$f$;

-- Quantas linhas a fila TEM de ter para um resumo de Ana: uma por conta dela (Telegram e Discord)
-- + a linha do canal. Calculado do banco para não depender de quantas contas os testes anteriores
-- deixaram; o `>= 1` é a trava que impede o teste de passar "no vazio".
create function public.teste_esperado_resumo(p_com_canal boolean) returns int language sql as $f$
  select (select count(*) from public.alerta_contas
           where usuario_id = '00000000-0000-0000-0000-000000000001'
             and canal in ('telegram', 'discord'))::int
         + case when p_com_canal then 1 else 0 end
$f$;

-- ---------------------------------------------------------------------------------------------
-- Os bipes do dia 2026-03-11 (UTC). As faixas são 07:00–11:00 e 12:00–16:00.
--   RES-A: DENTRO  07:00:00 aprovado (início >= entra), 09:00 APROVADO (caixa alta), 12:00 aprovado,
--                  10:59:59 reprovado                                           => 3 aprov. e 1 reprov.
--          FORA    11:00:00 aprovado (fim < não entra), 11:30 reprovado (almoço), 16:00:00 reprovado,
--                  17:00 reprovado (hora extra)
--   RES-E: um aprovado às 08:00                                                 => 1 aprov. e 0 reprov.
--   RES-B: só bipe FORA das faixas (11:30)                                      => fora da lista
--   RES-C: nenhum bipe                                                          => fora da lista
--   RES-P: bipe DENTRO mas com status vazio (posto de passagem)                 => fora da lista
-- O posto RES-Z (usado no T2) não tem bipe nenhum em dia nenhum.
insert into public.sf_registros (data_hora, posto, pmo, op, status) values
  ('2026-03-11 07:00:00+00', 'RES-A', 'PMOR', '1', 'Aprovado'),
  ('2026-03-11 09:00:00+00', 'RES-A', 'PMOR', '1', 'APROVADO'),
  ('2026-03-11 12:00:00+00', 'RES-A', 'PMOR', '1', 'Aprovado'),
  ('2026-03-11 10:59:59+00', 'RES-A', 'PMOR', '1', 'REPROVADO'),
  ('2026-03-11 11:00:00+00', 'RES-A', 'PMOR', '1', 'Aprovado'),
  ('2026-03-11 11:30:00+00', 'RES-A', 'PMOR', '1', 'REPROVADO'),
  ('2026-03-11 16:00:00+00', 'RES-A', 'PMOR', '1', 'REPROVADO'),
  ('2026-03-11 17:00:00+00', 'RES-A', 'PMOR', '1', 'REPROVADO'),
  ('2026-03-11 08:00:00+00', 'RES-E', 'PMOR', '1', 'Aprovado'),
  ('2026-03-11 11:30:00+00', 'RES-B', 'PMOR', '1', 'REPROVADO'),
  ('2026-03-11 08:00:00+00', 'RES-P', 'PMOR', '1', '');

-- ---------------------------------------------------------------------------------------------
-- T0. ESQUEMA: uma só assinatura do alerta_avaliar, com 3 parâmetros, fechada para o público.
do $t$
declare
  v_oid oid;
begin
  if (select count(*) from pg_proc
       where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALHOU: a 0141 deixou mais de uma assinatura do alerta_avaliar (a chamada curta ficaria ambígua)';
  end if;
  select oid into v_oid from pg_proc
   where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace and pronargs = 3;
  if v_oid is null then
    raise exception 'FALHOU: alerta_avaliar de 3 parâmetros (canal, blocos, resumos) não existe';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'FALHOU: alerta_avaliar está aberta para anon/authenticated';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'FALHOU: o service_role (o cron) perdeu o alerta_avaliar';
  end if;
  if teste_esperado_resumo(false) < 1 then
    raise exception 'FALHOU: a Ana não tem conta vinculada — o teste passaria no vazio';
  end if;
  -- Ana precisa poder receber (o fan-out confere a permissão de quem recebe).
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: a Ana não administra o ShopFloor — o teste passaria no vazio';
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T1. REGRA AUSENTE DO MAPA É PULADA (mapa nulo, vazio, ou só com OUTRA regra).
select teste_regra_resumo('RES ausente', array['RES-A']);
select teste_regra_resumo('RES outra', array['RES-A']);
do $t$
declare
  r jsonb;
begin
  perform alerta_avaliar();
  perform alerta_avaliar(null, null, null);
  perform alerta_avaliar(null, null, '{}'::jsonb);
  -- Mapa só com a "RES outra" (dia SEM o que enviar não seria honesto: aqui ela tem dado, mas é
  -- a outra regra que está no mapa — a "RES ausente" não pode ir junto).
  r := alerta_avaliar('CANAL-T', null, teste_resumos('RES outra', date '2026-03-11'));
  if teste_envios_resumo('RES ausente') <> 0 then
    raise exception 'FALHOU: a regra ausente do mapa enfileirou % linhas', teste_envios_resumo('RES ausente');
  end if;
  if teste_resumo_enviado('RES ausente') is not null then
    raise exception 'FALHOU: a regra ausente do mapa teve a data gravada (%)', teste_resumo_enviado('RES ausente');
  end if;
  -- A que está no mapa, sim, sai (prova que o teste de cima não passou por o mapa estar quebrado).
  if teste_envios_resumo('RES outra') <> teste_esperado_resumo(true) then
    raise exception 'FALHOU: a regra presente no mapa enfileirou % (esperava %) — o mapa de controle quebrou',
      teste_envios_resumo('RES outra'), teste_esperado_resumo(true);
  end if;
end $t$;
-- Saem do caminho para não poluir os testes seguintes (os dois resumos são de RES-A).
update public.alerta_regras set ativa = false where nome in ('RES ausente', 'RES outra');

-- ---------------------------------------------------------------------------------------------
-- T2. DIA SEM DADO: não enfileira E NÃO grava a data (gravar sem enviar sumiria com o relatório).
select teste_regra_resumo('RES vazio', array['RES-Z', 'RES-C']);
do $t$
declare
  r jsonb;
begin
  r := alerta_avaliar('CANAL-T', null, teste_resumos('RES vazio', date '2026-03-11'));
  if teste_envios_resumo('RES vazio') <> 0 then
    raise exception 'FALHOU: dia sem posto com dado enfileirou % linhas', teste_envios_resumo('RES vazio');
  end if;
  if teste_resumo_enviado('RES vazio') is not null then
    raise exception 'FALHOU: dia sem posto com dado GRAVOU resumo_enviado_em (%) — o relatório sumiria o dia inteiro em silêncio',
      teste_resumo_enviado('RES vazio');
  end if;
  if (r->>'enfileirados')::int <> 0 then
    raise exception 'FALHOU: dia sem dado devolveu enfileirados = %', r->>'enfileirados';
  end if;
  -- E as faixas ausentes / que não são lista valem lista vazia: nada entra, nada é gravado.
  r := alerta_avaliar('CANAL-T', null, jsonb_build_object(
         (select id::text from public.alerta_regras where nome = 'RES vazio'),
         jsonb_build_object('dia', '2026-03-11')));
  if teste_envios_resumo('RES vazio') <> 0 or teste_resumo_enviado('RES vazio') is not null then
    raise exception 'FALHOU: mapa sem faixas enfileirou ou gravou a data';
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome = 'RES vazio';

-- ---------------------------------------------------------------------------------------------
-- T3 + T4 + T7. O ENVIO, O REENVIO E A OCORRÊNCIA. A regra lista os postos fora da ordem de
-- propósito (RES-E antes de RES-A): a lista do relatório segue a ORDEM DOS POSTOS DA REGRA.
select teste_regra_resumo('RES envio', array['RES-E', 'RES-B', 'RES-A', 'RES-C', 'RES-P']);
do $t$
declare
  r1     jsonb;
  r2     jsonb;
  n_oc   int;
  n_env  int;
  e      public.alerta_envios;
  linhas jsonb;
begin
  select count(*) into n_oc from public.alerta_ocorrencias;

  -- T3: primeira rodada.
  r1 := alerta_avaliar('CANAL-T', null, teste_resumos('RES envio', date '2026-03-11'));
  n_env := teste_envios_resumo('RES envio');
  if n_env <> teste_esperado_resumo(true) then
    raise exception 'FALHOU: o resumo enfileirou % linhas (esperava % = contas da Ana + o canal)',
      n_env, teste_esperado_resumo(true);
  end if;
  if (r1->>'enfileirados')::int <> n_env then
    raise exception 'FALHOU: o retorno diz enfileirados = % mas a fila ganhou %', r1->>'enfileirados', n_env;
  end if;
  -- ⚠️ avaliadas = 0: é o que denuncia a falta do `continue` do topo do laço (ver o cabeçalho).
  if (r1->>'avaliadas')::int <> 0 then
    raise exception 'FALHOU: o dia só de resumo devolveu avaliadas = % (o resumo vazou para o caminho da ocorrência)',
      r1->>'avaliadas';
  end if;
  if teste_resumo_enviado('RES envio') is distinct from date '2026-03-11' then
    raise exception 'FALHOU: a data do envio gravada = % (esperava 2026-03-11, a do mapa)',
      teste_resumo_enviado('RES envio');
  end if;

  select e2.* into e from public.alerta_envios e2
   where e2.tipo = 'resumo' and e2.dados->>'regra_nome' = 'RES envio' and e2.destino_tipo = 'usuario'
   order by e2.canal limit 1;
  if e.id is null then
    raise exception 'FALHOU: nenhuma linha de resumo para a pessoa';
  end if;
  if e.ocorrencia_id is not null then
    raise exception 'FALHOU: o resumo nasceu com ocorrencia_id (%)', e.ocorrencia_id;
  end if;
  if e.com_botao then
    raise exception 'FALHOU: o resumo nasceu com o botão Resolvido';
  end if;
  if not exists (select 1 from public.alerta_envios
                  where tipo = 'resumo' and dados->>'regra_nome' = 'RES envio'
                    and destino_tipo = 'canal' and destino_externo_id = 'CANAL-T' and canal = 'discord'
                    and usuario_id is null and ocorrencia_id is null and not com_botao) then
    raise exception 'FALHOU: a linha do canal do Discord (CANAL-T) do resumo não existe como esperado';
  end if;

  if e.dados->>'regra_tipo' <> 'resumo' or e.dados->>'dia' <> '2026-03-11' then
    raise exception 'FALHOU: o dados do resumo = %', e.dados;
  end if;
  linhas := e.dados->'linhas';
  -- Posto sem bipe (RES-C), só com bipe fora das faixas (RES-B) e com status vazio (RES-P) ficam
  -- FORA; os outros entram NA ORDEM DA REGRA, com os números certos (fronteira >= início, < fim).
  if linhas is distinct from '[{"posto":"RES-E","aprovados":1,"reprovados":0},
                               {"posto":"RES-A","aprovados":3,"reprovados":1}]'::jsonb then
    raise exception 'FALHOU: a lista de postos do resumo = % (esperava RES-E 1/0 e RES-A 3/1, nessa ordem)', linhas;
  end if;

  -- T4: ⚠️ A MESMA RODADA DE NOVO NÃO ENFILEIRA NADA. É a guarda contra reenvio (I-1): sem ela o
  -- cron de 5 em 5 minutos mandaria o relatório do dia 100 vezes.
  r2 := alerta_avaliar('CANAL-T', null, teste_resumos('RES envio', date '2026-03-11'));
  if (r2->>'enfileirados')::int <> 0 then
    raise exception 'FALHOU: a segunda chamada com o mesmo p_resumos enfileirou % (o relatório saiu duas vezes no dia)',
      r2->>'enfileirados';
  end if;
  if teste_envios_resumo('RES envio') <> n_env then
    raise exception 'FALHOU: a fila foi de % para % linhas na segunda chamada', n_env, teste_envios_resumo('RES envio');
  end if;
  if teste_resumo_enviado('RES envio') is distinct from date '2026-03-11' then
    raise exception 'FALHOU: a segunda chamada mexeu na data gravada (%)', teste_resumo_enviado('RES envio');
  end if;
  -- Uma terceira, por paranoia (a guarda não pode ser "só a primeira repetição").
  perform alerta_avaliar('CANAL-T', null, teste_resumos('RES envio', date '2026-03-11'));
  if teste_envios_resumo('RES envio') <> n_env then
    raise exception 'FALHOU: a terceira chamada enfileirou de novo';
  end if;

  -- T7: o resumo não criou ocorrência nenhuma.
  if (select count(*) from public.alerta_ocorrencias) <> n_oc then
    raise exception 'FALHOU: o resumo criou % ocorrência(s)', (select count(*) from public.alerta_ocorrencias) - n_oc;
  end if;
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'RES envio') then
    raise exception 'FALHOU: existe ocorrência de uma regra de resumo';
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T5. O DIA SEGUINTE ENVIA DE NOVO: a guarda é por DIA (o do mapa), não "uma vez na vida".
insert into public.sf_registros (data_hora, posto, pmo, op, status) values
  ('2026-03-12 08:00:00+00', 'RES-A', 'PMOR', '1', 'Aprovado'),
  ('2026-03-12 09:00:00+00', 'RES-A', 'PMOR', '1', 'Aprovado'),
  ('2026-03-12 10:00:00+00', 'RES-A', 'PMOR', '1', 'Reprovado');
do $t$
declare
  r      jsonb;
  antes  int := teste_envios_resumo('RES envio');
  e      public.alerta_envios;
begin
  r := alerta_avaliar('CANAL-T', null, teste_resumos('RES envio', date '2026-03-12'));
  if teste_envios_resumo('RES envio') - antes <> teste_esperado_resumo(true) then
    raise exception 'FALHOU: o dia seguinte enfileirou % linhas (esperava %)',
      teste_envios_resumo('RES envio') - antes, teste_esperado_resumo(true);
  end if;
  if teste_resumo_enviado('RES envio') is distinct from date '2026-03-12' then
    raise exception 'FALHOU: a data gravada no dia seguinte = %', teste_resumo_enviado('RES envio');
  end if;
  select e2.* into e from public.alerta_envios e2
   where e2.tipo = 'resumo' and e2.dados->>'regra_nome' = 'RES envio' and e2.dados->>'dia' = '2026-03-12'
   limit 1;
  -- Só o dia 12 entra na conta do dia 12 (os bipes do dia 11 não vazam).
  if e.dados->'linhas' is distinct from '[{"posto":"RES-A","aprovados":2,"reprovados":1}]'::jsonb then
    raise exception 'FALHOU: as linhas do dia seguinte = % (os bipes do dia anterior vazaram?)', e.dados->'linhas';
  end if;
  -- E repetir o dia 12 não manda de novo.
  antes := teste_envios_resumo('RES envio');
  perform alerta_avaliar('CANAL-T', null, teste_resumos('RES envio', date '2026-03-12'));
  if teste_envios_resumo('RES envio') <> antes then
    raise exception 'FALHOU: o dia seguinte saiu duas vezes';
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome = 'RES envio';

-- ---------------------------------------------------------------------------------------------
-- T6. HÁ DADO, MAS NINGUÉM ALCANÇÁVEL: nada enfileirado => a data também NÃO é gravada. A
-- destinatária é a Carla (Operadora, sem a permissão de administrar) e não há canal do Discord.
select teste_regra_resumo('RES sem alcance', array['RES-A'], false,
                          array['00000000-0000-0000-0000-000000000003']::uuid[]);
do $t$
declare
  r jsonb;
begin
  r := alerta_avaliar(null, null, teste_resumos('RES sem alcance', date '2026-03-11'));
  if teste_envios_resumo('RES sem alcance') <> 0 then
    raise exception 'FALHOU: enfileirou % linhas para quem não pode receber', teste_envios_resumo('RES sem alcance');
  end if;
  if teste_resumo_enviado('RES sem alcance') is not null then
    raise exception 'FALHOU: gravou resumo_enviado_em (%) sem ter enfileirado nada — quando alguém vincular a conta no mesmo dia o relatório não sairia',
      teste_resumo_enviado('RES sem alcance');
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome = 'RES sem alcance';

-- ---------------------------------------------------------------------------------------------
-- T8. OS TIPOS ANTIGOS CONTINUAM. Uma aprovação por BLOCOS e uma por BIPES abrem ocorrência
-- normalmente na MESMA rodada em que uma regra de resumo (ainda não enviada) está no mapa.
select teste_regra('RES blocos', 'aprovacao', array['RES-OLD-B'], 90, 'intervalos', 60,
                   3, null, null, null);
select teste_regra('RES bipes', 'aprovacao', array['RES-OLD-P'], 90, 'bipes', 20,
                   3, null, null, null);
select teste_regra_resumo('RES na mistura', array['RES-A']);
-- Os bipes do bloco são instantes fixos (o bloco chega pronto do app); os da janela por bipes são
-- recentes, porque aquela janela só olha os últimos 30 dias.
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select timestamptz '2026-03-11 07:10:00+00' + make_interval(secs => g), 'RES-OLD-B', 'PMOR', '1', 'REPROVADO'
  from generate_series(1, 4) g;
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now() - make_interval(mins => 10) - make_interval(secs => g), 'RES-OLD-P', 'PMOR', '1', 'REPROVADO'
  from generate_series(1, 4) g;
do $t$
declare
  r      jsonb;
  mapa   jsonb;
  antes  int := teste_envios_resumo('RES na mistura');
begin
  -- O p_blocos é o da regra "RES blocos"; o p_resumos é o da "RES na mistura".
  mapa := teste_resumos('RES na mistura', date '2026-03-11');
  r := alerta_avaliar('CANAL-T',
                      (select jsonb_build_object(rg.id::text, jsonb_build_object(
                                'inicio', timestamptz '2026-03-11 07:00:00+00',
                                'fim',    timestamptz '2026-03-11 08:00:00+00'))
                         from public.alerta_regras rg where rg.nome = 'RES blocos'),
                      mapa);

  if not exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'RES blocos' and oc.posto = 'RES-OLD-B' and oc.estado = 'aberta') then
    raise exception 'FALHOU: a aprovação por BLOCOS não abriu ocorrência depois da 0141';
  end if;
  if not exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'RES bipes' and oc.posto = 'RES-OLD-P' and oc.estado = 'aberta') then
    raise exception 'FALHOU: a aprovação por BIPES não abriu ocorrência depois da 0141';
  end if;
  -- Os alertas saíram para a fila como sempre (tipo 'alerta', com o botão e a ocorrência).
  if not exists (select 1 from public.alerta_envios e join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
                   join public.alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'RES blocos' and e.tipo = 'alerta' and e.com_botao) then
    raise exception 'FALHOU: o alerta da aprovação por blocos não foi para a fila';
  end if;
  -- O resumo da mesma rodada saiu, e nenhuma ocorrência é dele.
  if teste_envios_resumo('RES na mistura') - antes <> teste_esperado_resumo(true) then
    raise exception 'FALHOU: o resumo da rodada mista enfileirou % linhas', teste_envios_resumo('RES na mistura') - antes;
  end if;
  if exists (select 1 from public.alerta_ocorrencias oc join public.alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'RES na mistura') then
    raise exception 'FALHOU: a regra de resumo da rodada mista ganhou ocorrência';
  end if;
  -- `avaliadas` conta só os itens de posto das duas aprovações (1 + 1), nunca o resumo.
  if (r->>'avaliadas')::int <> 2 then
    raise exception 'FALHOU: avaliadas = % (esperava 2: os dois postos das aprovações, sem o resumo)', r->>'avaliadas';
  end if;
end $t$;
update public.alerta_regras set ativa = false where nome in ('RES blocos', 'RES bipes', 'RES na mistura');
