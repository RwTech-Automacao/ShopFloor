-- Prova da 0197 (apontamento automático das PRTs no Compels: só OPs novas, placa vira contagem, envio por GRUPO).
-- Roda depois de: esquema + 0132 (reserva) + 0153 + 0184 + 0194 + 0066 + 0195 + prt_agrupar_antes.sql + 0197 (2x).
\set ON_ERROR_STOP on

create or replace function pg_temp.op(p_pmo text, p_op text) returns uuid language sql as $f$
  select id from sf_ordens where pmo = p_pmo and op = p_op
$f$;
create or replace function pg_temp.bipa(p_posto text, p_pmo text, p_op text, p_sn text) returns void language sql as $f$
  insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm, data_hora)
  values (p_posto, p_pmo, p_op, 'Aprovado', p_sn, p_sn, clock_timestamp())
$f$;
create or replace function pg_temp.tira(p_posto text, p_pmo text, p_op text, p_sn text) returns void language sql as $f$
  delete from sf_registros where posto = p_posto and pmo = p_pmo and op = p_op and numero_serie_norm = p_sn
$f$;
-- os grupos de uma PRT da OP: G<n>:quantidade:op:estoque:estado:membros (estado ok/cancelado/fila)
create or replace function pg_temp.grupos(p_ordem uuid, p_codigo text) returns text language sql as $f$
  select coalesce(string_agg(
           substring(g.chave from '/(G[0-9]+)$') || ':' || g.quantidade || ':' || g.op || ':' || g.estoque || ':'
           || case when g.ok then 'ok' when g.cancelado_em is not null then 'cancelado' else 'fila' end || ':'
           || (select count(*) from sf_estoque_envios m where m.grupo_id = g.id),
           ',' order by g.criado_em, g.id), '')
    from sf_estoque_envios g
   where g.ordem_id = p_ordem and g.pmo = p_codigo and g.tipo = 'grupo_prt'
$f$;
-- o estado das placas de uma PRT: SN=estado (fila/grupo/ok/cancelada/estornada), em ordem de SN
create or replace function pg_temp.placas(p_ordem uuid, p_codigo text) returns text language sql as $f$
  select coalesce(string_agg(e.serie_norm || '=' ||
           case when e.cancelado_em is not null then 'cancelada'
                when e.estornado >= e.quantidade then 'estornada'
                when e.ok then 'ok'
                when e.grupo_id is not null then 'grupo'
                else 'fila' end, ',' order by e.serie_norm, e.criado_em), '')
    from sf_estoque_envios e
   where e.ordem_id = p_ordem and e.pmo = p_codigo and e.operacao = 'entrada' and e.tipo <> 'grupo_prt'
$f$;
-- o que uma rodada RESERVARIA agora (a reserva é desfeita: não conta tentativa nem esconde linha)
create or replace function pg_temp.reservaria() returns text[] language plpgsql as $f$
declare r text[];
begin
  begin
    r := array(select x.chave from sf_estoque_reservar(100) x order by x.chave);
    raise exception 'desfaz a reserva';
  exception when raise_exception then null;
  end;
  return r;
end $f$;
create or replace function pg_temp.confere(p_caso text, p_veio text, p_esperado text) returns void language plpgsql as $f$
begin
  if p_veio is distinct from p_esperado then raise exception '% — veio "%", esperava "%"', p_caso, p_veio, p_esperado; end if;
end $f$;
create or replace function pg_temp.cadastra(p_pmo text, p_op text, p_qtd text, p_trechos text) returns uuid language sql as $f$
  select sf_cadastrar_op(format('{"ordem":{"pmo":"%s","op":"%s","cliente":"C","qtd":%s,"placas_por_painel":1},"trechos":%s}',
                                p_pmo, p_op, p_qtd, p_trechos)::jsonb)
$f$;

-- ======================= 1. SÓ OPs NOVAS =======================
do $$
declare v uuid := pg_temp.op('PMOANTIGA', '9500');
begin
  perform pg_temp.confere('OP antiga desligada', (select apontar_prt::text from sf_ordens where id = v), 'false');
  perform pg_temp.confere('OP antiga sem trecho também desligada',
    (select apontar_prt::text from sf_ordens where id = '00000000-0000-0000-0000-000000007100'), 'false');
  -- as pendentes intocadas foram canceladas; a tocada ficou (não se cancela o que uma rodada pode ter mandado)
  perform pg_temp.confere('pendentes antigas', pg_temp.placas(v, 'PRTANT'), '1=cancelada,2=cancelada,3=fila');
  perform pg_temp.confere('linha da PMO intocada',
    (select (not ok and cancelado_em is null)::text from sf_estoque_envios where chave = 'ALMOX/PMOANTIGA/9500/Almoxarifado/CX1/E1'), 'true');
  -- bipe novo na OP antiga não enfileira a PRT
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMOANTIGA', '9500', '4');
  perform pg_temp.confere('OP antiga não enfileira', (select count(*)::text from sf_estoque_envios where pmo = 'PRTANT'), '3');
  -- nem agrupa, mesmo finalizada e com a PMO esperando
  update sf_ordens set status = 'FINALIZADA' where id = v;
  perform sf_prt_agrupar();
  perform pg_temp.confere('OP antiga não agrupa', pg_temp.grupos(v, 'PRTANT'), '');
  -- e a reserva não pega a placa tocada da OP antiga (placa de PRT não vai sozinha ao Compels)
  if exists (select 1 from unnest(pg_temp.reservaria()) c where c like 'PRT/%') then
    raise exception 'a reserva pegou placa de PRT';
  end if;
end $$;

-- OP nova nasce ligada (default)
select pg_temp.cadastra('PMON1', '9601', '3', $j$[
  {"seq":1,"codigo":"PRTN1S","tipo":"prt","compels_op":"9602","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
  {"seq":2,"codigo":"PMON1","tipo":"pmo","compels_op":"9601","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"9"}]}]$j$);

-- ======================= 2. GATILHO "TRECHO FECHOU" + RESERVA + CONCLUSÃO + SOMA =======================
do $$
declare v uuid := pg_temp.op('PMON1', '9601'); g uuid; r record; res text[];
begin
  perform pg_temp.confere('OP nova ligada', (select apontar_prt::text from sf_ordens where id = v), 'true');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON1', '9601', '1');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON1', '9601', '2');
  perform pg_temp.confere('placas na fila', pg_temp.placas(v, 'PRTN1S'), '1=fila,2=fila');
  -- sem gatilho: 2 de 3, OP ativa, PMO sem nada na fila
  perform sf_prt_agrupar();
  perform pg_temp.confere('sem gatilho não agrupa', pg_temp.grupos(v, 'PRTN1S'), '');
  -- a reserva pula as placas
  res := pg_temp.reservaria();
  if exists (select 1 from unnest(res) c where c like 'PRT/' || v::text || '/%') then raise exception 'a reserva pegou placa avulsa: %', res; end if;
  -- o resumo conta as placas esperando
  select * into r from sf_resumo_trechos_op('PMON1', '9601');
  perform pg_temp.confere('resumo antes do grupo', r.apontadas || '/' || r.na_fila, '0/2');

  -- a 3ª placa fecha o trecho (3 = qtd da OP)
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON1', '9601', '3');
  perform sf_prt_agrupar();
  perform pg_temp.confere('trecho fechou', pg_temp.grupos(v, 'PRTN1S'), 'G1:3:9602:EINTER:fila:3');
  perform pg_temp.confere('placas no grupo', pg_temp.placas(v, 'PRTN1S'), '1=grupo,2=grupo,3=grupo');
  select id into g from sf_estoque_envios where chave = 'PRT/' || v::text || '/PRTN1S/G1';
  perform pg_temp.confere('chave/posto/tipo do grupo',
    (select posto || '|' || tipo || '|' || operacao || '|' || ordem_id::text from sf_estoque_envios where id = g),
    'Inspeção AOI TOP|grupo_prt|entrada|' || v::text);
  -- resumo e soma não dobram (grupo + membros)
  select * into r from sf_resumo_trechos_op('PMON1', '9601');
  perform pg_temp.confere('resumo com grupo na fila', r.apontadas || '/' || r.na_fila, '0/3');
  -- rodar de novo não cria outro grupo
  perform sf_prt_agrupar();
  perform pg_temp.confere('agrupar de novo', pg_temp.grupos(v, 'PRTN1S'), 'G1:3:9602:EINTER:fila:3');
  -- a reserva pega o GRUPO e nenhuma placa
  res := pg_temp.reservaria();
  if not ('PRT/' || v::text || '/PRTN1S/G1') = any (res) then raise exception 'a reserva não pegou o grupo: %', res; end if;
  if exists (select 1 from unnest(res) c where c like 'PRT/' || v::text || '/PRTN1S/Insp%') then raise exception 'a reserva pegou placa: %', res; end if;

  -- o grupo chega ao Compels (o que o concluirEnvio grava): as placas ficam ok junto
  update sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null, erro = null where id = g;
  perform pg_temp.confere('grupo ok', pg_temp.grupos(v, 'PRTN1S'), 'G1:3:9602:EINTER:ok:3');
  perform pg_temp.confere('membros ok', pg_temp.placas(v, 'PRTN1S'), '1=ok,2=ok,3=ok');
  perform pg_temp.confere('membros com enviado_em do grupo',
    (select count(*)::text from sf_estoque_envios m where m.grupo_id = g and m.enviado_em = (select enviado_em from sf_estoque_envios where id = g)), '3');
  -- soma enviada (0153): 3, não 6
  perform pg_temp.confere('soma enviada', sf_estoque_enviado('PRTN1S', '9602')::text, '3');
  perform pg_temp.confere('soma enviada sem o grupo', sf_estoque_enviado('PRTN1S', '9602', g)::text, '0');
  select * into r from sf_resumo_trechos_op('PMON1', '9601');
  perform pg_temp.confere('resumo depois do envio', r.apontadas || '/' || r.na_fila, '3/0');

  -- ---------- placa removida DEPOIS de enviada: estorno (manual) ligado à placa ----------
  -- (a placa ficou com uma op velha: a do Compels é a do GRUPO, que foi quem levou a placa)
  update sf_estoque_envios set op = 'velha' where grupo_id = g and serie_norm = '2';
  perform pg_temp.tira('Inspeção AOI TOP', 'PMON1', '9601', '2');
  perform pg_temp.confere('estorno com a op do grupo',
    (select s.op || '|' || s.estoque from sf_estoque_envios s join sf_estoque_envios m on m.id = s.entrada_id
      where s.operacao = 'estorno' and m.ordem_id = v and m.serie_norm = '2'), '9602|EINTER');
  perform pg_temp.confere('placa estornada', pg_temp.placas(v, 'PRTN1S'), '1=ok,2=estornada,3=ok');
  perform pg_temp.confere('estorno',
    (select count(*)::text from sf_estoque_envios s join sf_estoque_envios m on m.id = s.entrada_id
      where s.operacao = 'estorno' and m.ordem_id = v and m.serie_norm = '2' and s.quantidade = 1 and not s.ok and s.cancelado_em is null), '1');
  perform pg_temp.confere('grupo intocado pelo estorno', pg_temp.grupos(v, 'PRTN1S'), 'G1:3:9602:EINTER:ok:3');
  -- o estorno sai na reserva (a entrada dele, a placa, está ok) — e o adaptador o deixa como manual
  res := pg_temp.reservaria();
  if not exists (select 1 from unnest(res) c where c like 'PRT/' || v::text || '/PRTN1S/Inspeção AOI TOP/2/S%') then
    raise exception 'a reserva não pegou o estorno: %', res;
  end if;
  -- a placa volta: linha nova, e o trecho fecha de novo (2 vivas + 1) -> G2 com 1
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON1', '9601', '2');
  perform sf_prt_agrupar();
  perform pg_temp.confere('grupo 2', pg_temp.grupos(v, 'PRTN1S'), 'G1:3:9602:EINTER:ok:3,G2:1:9602:EINTER:fila:1');
end $$;

-- ======================= 3. GATILHO "PMO ESPERANDO" + ORDEM SMT→PTH + PLACA DE GRUPO NÃO ENVIADO =======================
select pg_temp.cadastra('PMON2', '9611', '100', $j$[
  {"seq":1,"codigo":"PRTN2S","tipo":"prt","compels_op":"9612","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
  {"seq":2,"codigo":"PRTN2P","tipo":"prt","compels_op":"9613","postos":["Montagem PTH","Inspeção PTH"],"faixas":[]},
  {"seq":3,"codigo":"PMON2","tipo":"pmo","compels_op":"9611","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"99"}]}]$j$);
do $$
declare v uuid := pg_temp.op('PMON2', '9611'); res text[];
begin
  perform pg_temp.bipa('Inspeção PTH', 'PMON2', '9611', 'b1');   -- a PTH bipada ANTES da SMT: a ordem do grupo é a do trecho
  perform pg_temp.bipa('Inspeção PTH', 'PMON2', '9611', 'b2');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON2', '9611', 'a1');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON2', '9611', 'a2');
  perform sf_prt_agrupar();
  perform pg_temp.confere('N2 sem gatilho', pg_temp.grupos(v, 'PRTN2S') || '|' || pg_temp.grupos(v, 'PRTN2P'), '|');
  -- a caixa da PMO entra na fila (Almoxarifado): as PRTs apontam o que já tem
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values ('ALMOX/PMON2/9611/Almoxarifado/CX1/E1', 'PMON2', '9611', 'Almoxarifado', 'caixa', 'CX1', 2);
  perform sf_prt_agrupar();
  perform pg_temp.confere('N2 SMT', pg_temp.grupos(v, 'PRTN2S'), 'G1:2:9612:EINTER:fila:2');
  perform pg_temp.confere('N2 PTH', pg_temp.grupos(v, 'PRTN2P'), 'G1:2:9613:EINTER:fila:2');
  if (select criado_em from sf_estoque_envios where chave = 'PRT/' || v::text || '/PRTN2S/G1')
     >= (select criado_em from sf_estoque_envios where chave = 'PRT/' || v::text || '/PRTN2P/G1') then
    raise exception 'o grupo da SMT tem de nascer antes do da PTH';
  end if;
  -- a reserva entrega a SMT antes da PTH (criado_em)
  res := pg_temp.reservaria();
  if array_position(res, 'PRT/' || v::text || '/PRTN2S/G1') is null or array_position(res, 'PRT/' || v::text || '/PRTN2P/G1') is null then
    raise exception 'a reserva não pegou os dois grupos: %', res;
  end if;
  if (select x.chave from sf_estoque_reservar(100) x where x.chave like 'PRT/' || v::text || '/%' order by x.criado_em limit 1)
     <> 'PRT/' || v::text || '/PRTN2S/G1' then
    raise exception 'a SMT não veio primeiro';
  end if;
  -- (a reserva acima VALEU: os dois grupos agora estão tocados; o caso do grupo intocado usa a PTH soltando a reserva)
  update sf_estoque_envios set tentativas = 0, reservado_em = null where chave = 'PRT/' || v::text || '/PRTN2P/G1';

  -- ---------- placa de um grupo AINDA NÃO ENVIADO e intocado: o grupo é desfeito ----------
  perform pg_temp.tira('Inspeção PTH', 'PMON2', '9611', 'b1');
  perform pg_temp.confere('grupo intocado desfeito', pg_temp.grupos(v, 'PRTN2P'), 'G1:2:9613:EINTER:cancelado:0');
  perform pg_temp.confere('placas depois de desfazer', pg_temp.placas(v, 'PRTN2P'), 'b1=cancelada,b2=fila');
  perform sf_prt_agrupar();   -- a PMO segue esperando: regrupa o que sobrou
  perform pg_temp.confere('regrupa', pg_temp.grupos(v, 'PRTN2P'), 'G1:2:9613:EINTER:cancelado:0,G2:1:9613:EINTER:fila:1');

  -- ---------- placa de um grupo TOCADO (uma rodada o tentou, sem resposta): estorno ligado à placa, grupo fica ----------
  perform pg_temp.tira('Inspeção AOI TOP', 'PMON2', '9611', 'a1');
  perform pg_temp.confere('grupo tocado fica', pg_temp.grupos(v, 'PRTN2S'), 'G1:2:9612:EINTER:fila:2');
  perform pg_temp.confere('placa do grupo tocado', pg_temp.placas(v, 'PRTN2S'), 'a1=estornada,a2=grupo');
  -- o estorno espera a placa ficar ok (que só acontece quando o grupo chegar)
  res := pg_temp.reservaria();
  if exists (select 1 from unnest(res) c where c like 'PRT/' || v::text || '/PRTN2S/Inspeção AOI TOP/a1/S%') then
    raise exception 'o estorno saiu antes do grupo: %', res;
  end if;
  update sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null where chave = 'PRT/' || v::text || '/PRTN2S/G1';
  res := pg_temp.reservaria();
  if not exists (select 1 from unnest(res) c where c like 'PRT/' || v::text || '/PRTN2S/Inspeção AOI TOP/a1/S%') then
    raise exception 'o estorno não saiu depois do grupo: %', res;
  end if;
  perform pg_temp.confere('soma N2 SMT', sf_estoque_enviado('PRTN2S', '9612')::text, '2');
end $$;

-- ======================= 4. GATILHO "OP FINALIZADA" (qtd vazia) + PLACA REMOVIDA ANTES DE AGRUPAR =======================
select pg_temp.cadastra('PMON3', '9621', 'null', $j$[
  {"seq":1,"codigo":"PRTN3S","tipo":"prt","compels_op":"9622","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
  {"seq":2,"codigo":"PMON3","tipo":"pmo","compels_op":"9621","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"99"}]}]$j$);
do $$
declare v uuid := pg_temp.op('PMON3', '9621'); i int;
begin
  for i in 1..5 loop perform pg_temp.bipa('Inspeção AOI TOP', 'PMON3', '9621', i::text); end loop;
  perform sf_prt_agrupar();
  perform pg_temp.confere('qtd vazia não fecha trecho', pg_temp.grupos(v, 'PRTN3S'), '');
  -- removida antes de agrupar: cancela como sempre
  perform pg_temp.tira('Inspeção AOI TOP', 'PMON3', '9621', '5');
  perform pg_temp.confere('removida antes de agrupar', pg_temp.placas(v, 'PRTN3S'), '1=fila,2=fila,3=fila,4=fila,5=cancelada');
  update sf_ordens set status = 'FINALIZADA' where id = v;
  perform sf_prt_agrupar();
  perform pg_temp.confere('OP finalizada', pg_temp.grupos(v, 'PRTN3S'), 'G1:4:9622:EINTER:fila:4');
end $$;

-- ======================= 4b. PMO PRESA NÃO GERA GRUPO A CADA RODADA =======================
select pg_temp.cadastra('PMON6', '9651', '100', $j$[
  {"seq":1,"codigo":"PRTN6S","tipo":"prt","compels_op":"9652","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
  {"seq":2,"codigo":"PMON6","tipo":"pmo","compels_op":"9651","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"99"}]}]$j$);
do $$
declare v uuid := pg_temp.op('PMON6', '9651');
begin
  -- a caixa da PMO presa na fila (5 tentativas, erro permanente)
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, tentativas, erro, criado_em)
  values ('ALMOX/PMON6/9651/Almoxarifado/CX1/E1', 'PMON6', '9651', 'Almoxarifado', 'caixa', 'CX1', 1, 5, 'preso', clock_timestamp());
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON6', '9651', '1');
  perform sf_prt_agrupar();
  perform pg_temp.confere('PMO presa: 1º grupo', pg_temp.grupos(v, 'PRTN6S'), 'G1:1:9652:EINTER:fila:1');
  -- rodadas seguintes, com bipes novos: a mesma caixa presa não gera grupo de novo
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON6', '9651', '2');
  perform sf_prt_agrupar();
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON6', '9651', '3');
  perform sf_prt_agrupar();
  perform pg_temp.confere('PMO presa: nada de grupo minúsculo', pg_temp.grupos(v, 'PRTN6S'), 'G1:1:9652:EINTER:fila:1');
  perform pg_temp.confere('PMO presa: placas esperando', pg_temp.placas(v, 'PRTN6S'), '1=grupo,2=fila,3=fila');
  -- uma caixa NOVA da PMO (mais nova que o último grupo): agrupa o que tem
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, criado_em)
  values ('ALMOX/PMON6/9651/Almoxarifado/CX2/E1', 'PMON6', '9651', 'Almoxarifado', 'caixa', 'CX2', 1, clock_timestamp());
  perform sf_prt_agrupar();
  perform pg_temp.confere('caixa nova: grupo novo', pg_temp.grupos(v, 'PRTN6S'), 'G1:1:9652:EINTER:fila:1,G2:2:9652:EINTER:fila:2');
end $$;

-- ======================= 4c. DESMONTAR GRUPO COM PLACA JÁ ESTORNADA (nunca enviada): nada fica órfão =======================
select pg_temp.cadastra('PMON7', '9661', '100', $j$[
  {"seq":1,"codigo":"PRTN7S","tipo":"prt","compels_op":"9662","postos":["SPI","Inspeção AOI TOP"],"faixas":[]},
  {"seq":2,"codigo":"PMON7","tipo":"pmo","compels_op":"9661","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"99"}]}]$j$);
do $$
declare v uuid := pg_temp.op('PMON7', '9661'); r record;
begin
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, criado_em)
  values ('ALMOX/PMON7/9661/Almoxarifado/CX1/E1', 'PMON7', '9661', 'Almoxarifado', 'caixa', 'CX1', 1, clock_timestamp());
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON7', '9661', 'p1');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON7', '9661', 'p2');
  perform sf_prt_agrupar();
  perform pg_temp.confere('N7 grupo', pg_temp.grupos(v, 'PRTN7S'), 'G1:2:9662:EINTER:fila:2');
  -- uma rodada pega o grupo (tocado) e, enquanto isso, a p1 sai: estorno ligado a ela
  update sf_estoque_envios set tentativas = 1, reservado_em = now() where chave = 'PRT/' || v::text || '/PRTN7S/G1';
  perform pg_temp.tira('Inspeção AOI TOP', 'PMON7', '9661', 'p1');
  perform pg_temp.confere('p1 estornada no grupo tocado', pg_temp.placas(v, 'PRTN7S'), 'p1=estornada,p2=grupo');
  -- a rodada só ESPEROU (aguardar: nada foi ao ERP, a tentativa volta): o grupo fica intocado de novo
  update sf_estoque_envios set tentativas = 0, reservado_em = null where chave = 'PRT/' || v::text || '/PRTN7S/G1';
  -- a p2 sai: o grupo é desmontado; a p1 (estornada, nunca enviada) e o estorno dela são cancelados
  perform pg_temp.tira('Inspeção AOI TOP', 'PMON7', '9661', 'p2');
  perform pg_temp.confere('N7 desmontado', pg_temp.grupos(v, 'PRTN7S'), 'G1:2:9662:EINTER:cancelado:0');
  perform pg_temp.confere('N7 placas canceladas', pg_temp.placas(v, 'PRTN7S'), 'p1=cancelada,p2=cancelada');
  perform pg_temp.confere('N7 estorno da p1 cancelado',
    (select count(*)::text from sf_estoque_envios where ordem_id = v and operacao = 'estorno' and not ok and cancelado_em is null), '0');
  select * into r from sf_resumo_trechos_op('PMON7', '9661');
  perform pg_temp.confere('N7 resumo', r.apontadas || '/' || r.na_fila, '0/0');
end $$;

-- o na_fila desconta o estornado da placa ainda na fila (a tocada da OP antiga: 1 placa, estornada)
do $$
declare r record;
begin
  update sf_estoque_envios set estornado = quantidade where pmo = 'PRTANT' and serie_norm = '3';
  select * into r from sf_resumo_trechos_op('PMOANTIGA', '9500');
  perform pg_temp.confere('na_fila desconta o estornado', r.na_fila::text, '0');
  update sf_estoque_envios set estornado = 0 where pmo = 'PRTANT' and serie_norm = '3';
end $$;

-- ======================= 5. EDIÇÃO DA OP: o grupo não é "SN fora da faixa" =======================
select pg_temp.cadastra('PMON4', '9631', '2', $j$[
  {"seq":1,"codigo":"PRTN4S","tipo":"prt","compels_op":"9632","sn_modo":"proprio","postos":["SPI","Inspeção AOI TOP"],"faixas":[{"sn_ini":"A1","sn_fim":"A9"}]},
  {"seq":2,"codigo":"PMON4","tipo":"pmo","compels_op":"9631","postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"9"}]}]$j$);
do $$
declare v uuid := pg_temp.op('PMON4', '9631');
begin
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON4', '9631', 'A1');
  perform pg_temp.bipa('Inspeção AOI TOP', 'PMON4', '9631', 'A2');
  perform sf_prt_agrupar();
  perform pg_temp.confere('N4 grupo', pg_temp.grupos(v, 'PRTN4S'), 'G1:2:9632:EINTER:fila:2');
  perform sf_ordem_regravar_trechos(v, $j$[
    {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A1","sn_fim":"A20"}]},
    {"seq":2,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"9"}]}]$j$::jsonb,
    '{"cliente":"C","status":"ATIVA","placas_por_painel":1,"qtd":"2"}'::jsonb, '[]'::jsonb, '[]'::jsonb);
  -- e a recusa de verdade continua: faixa nova que não cobre A2
  begin
    perform sf_ordem_regravar_trechos(v, $j$[
      {"seq":1,"postos":["SPI","Inspeção AOI TOP"],"sn_modo":"proprio","faixas":[{"sn_ini":"A1","sn_fim":"A1"}]},
      {"seq":2,"postos":["Teste","Almoxarifado"],"faixas":[{"sn_ini":"1","sn_fim":"9"}]}]$j$::jsonb,
      '{"cliente":"C","status":"ATIVA","placas_por_painel":1,"qtd":"2"}'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'faixa que não cobre A2 passou';
  exception when raise_exception then
    if sqlerrm <> 'PRT_FAIXA_COM_HISTORICO:PRTN4S' then raise; end if;
  end;
end $$;

-- ======================= 6. ESQUEMA E PERMISSÕES =======================
do $$ begin
  if has_function_privilege('authenticated', 'public.sf_prt_agrupar()', 'execute')
     or has_function_privilege('anon', 'public.sf_prt_agrupar()', 'execute')
     or not has_function_privilege('service_role', 'public.sf_prt_agrupar()', 'execute') then
    raise exception 'grants da sf_prt_agrupar';
  end if;
  if has_function_privilege('authenticated', 'public.sf_estoque_reservar(int)', 'execute')
     or not has_function_privilege('service_role', 'public.sf_estoque_reservar(int)', 'execute') then
    raise exception 'grants da sf_estoque_reservar';
  end if;
  -- tipo desconhecido continua recusado
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade) values ('X/1', 'P', '1', 'p', 'palete', 'b', 1);
    raise exception 'tipo palete passou';
  exception when check_violation then null;
  end;
end $$;

select 'PRT AGRUPAR TESTE OK';
