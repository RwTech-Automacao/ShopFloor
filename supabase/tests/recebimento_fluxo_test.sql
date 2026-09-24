-- Testes das funções de leitura do Fluxo e dos Registros do Recebimento (migração 0124).
-- Roda num Postgres descartável: supabase/tests/rodar-recebimento-test.sh
-- Tudo numa única conexão (as configurações de sessão `teste.*` alimentam os stubs de auth/RBAC).

-- ---------- stubs mínimos do Supabase ----------
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;
-- `teste.perms` = lista 'modulo.permissao' separada por vírgula.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

-- Grupos dos campos (0003/0015): é o que decide qual seção um diff tocou.
create table public.configuracao_campos (
  campo text primary key,
  grupo text not null check (grupo in ('comercial', 'material', 'recebimento', 'qualidade'))
);
insert into public.configuracao_campos (campo, grupo) values
  ('numero_nf', 'comercial'), ('fornecedor', 'comercial'),
  ('codigo_material', 'material'), ('quantidade_pedido', 'material'),
  ('quantidade_recebida', 'recebimento'), ('volumes', 'recebimento'), ('divergencia', 'recebimento'),
  ('fabricante', 'qualidade'), ('resultado', 'qualidade'), ('observacao', 'qualidade');

create sequence public.processos_numero_seq;
create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.processos_numero_seq') unique,
  status text not null default 'aberto',
  numero_emb text, fornecedor text,
  codigo_material text, descricao_material text, quantidade_pedido numeric,
  quantidade_recebida numeric, divergencia text, part_number_recebido text,
  fabricante text, resultado text,
  finalizado_em timestamptz,
  created_at timestamptz not null default now()
);

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  entidade text not null,
  entidade_id uuid,
  acao text not null,
  descricao text not null default '',
  dados jsonb not null default '{}'::jsonb,
  usuario_nome text not null default '',
  created_at timestamptz not null default now()
);

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

\i /tmp/0124.sql

-- ---------- massa de teste ----------
-- EMB390: um item em cada caixa (um deles divergente), mais um sem histórico nenhum.
-- EMB999: uma EMB vizinha, pra provar que o filtro por EMB não vaza.
create function public.proc(
  p_emb text, p_item text, p_status text, p_div text default null,
  p_forn text default 'Panasonic', p_criado interval default '10 days',
  p_finalizado interval default null, p_resultado text default null
) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     status, divergencia, fornecedor, fabricante, part_number_recebido, resultado,
     created_at, finalizado_em)
  values
    (p_emb, p_item, 'CAPACITOR ' || p_item, 500, 490,
     p_status, p_div, p_forn, 'PANA', 'ECA1HM101', p_resultado,
     now() - p_criado, case when p_finalizado is null then null else now() - p_finalizado end)
  returning id into v_id;
  return v_id;
end $f$;

create function public.log(
  p_id uuid, p_acao text, p_desc text, p_dados jsonb, p_quando interval, p_quem text default 'João'
) returns void language sql as $f$
  insert into public.logs (entidade, entidade_id, acao, descricao, dados, usuario_nome, created_at)
  values ('processo', p_id, p_acao, p_desc, p_dados, p_quem, now() - p_quando)
$f$;

do $t$
declare
  v_aberto uuid; v_conf uuid; v_apro uuid; v_repro uuid; v_orfao uuid; v_reaberto uuid; v_outra uuid;
begin
  -- 1) parado no Recebimento (nunca salvou nada)
  v_aberto := proc('EMB390', 'CAPJ91', 'aberto', '', 'Panasonic', '10 days');

  -- 2) na Qualidade, divergente: salvou a seção Recebimento há 3 dias (a passagem) e mexeu na
  --    Qualidade há 12 horas — o relógio da caixa conta dos 3 dias, não das 12 horas.
  v_conf := proc('EMB390', 'CAPJ92', 'em_conferencia', '-10', 'Panasonic', '9 days');
  perform log(v_conf, 'alterar_campo', 'Processo #2 — seção recebimento salva',
    '[{"campo":"quantidade_recebida","de":null,"para":490},{"campo":"divergencia","de":null,"para":"-10"}]'::jsonb,
    '3 days');
  perform log(v_conf, 'mudar_status', 'Processo #2: aberto → em_conferencia',
    '{"de":"aberto","para":"em_conferencia"}'::jsonb, '3 days');
  perform log(v_conf, 'alterar_campo', 'Processo #2 — seção qualidade salva',
    '[{"campo":"fabricante","de":null,"para":"PANA"}]'::jsonb, '12 hours', 'Ana');

  -- 3) aprovado → Almoxarifado
  v_apro := proc('EMB390', 'CAPJ93', 'Aprovado', '0', 'Vishay', '8 days', '2 days', 'Aprovado');
  perform log(v_apro, 'alterar_campo', 'Processo #3 — seção recebimento salva',
    '[{"campo":"volumes","de":null,"para":2}]'::jsonb, '5 days');
  perform log(v_apro, 'mudar_status', 'Processo #3: em_conferencia → Aprovado',
    '{"de":"em_conferencia","para":"Aprovado"}'::jsonb, '2 days', 'Ana');

  -- 4) reprovado → saída lateral (e divergente: a marca acompanha o item onde ele estiver)
  v_repro := proc('EMB390', 'CAPJ94', 'Reprovado', '12', 'Vishay', '8 days', '1 day', 'Reprovado');
  perform log(v_repro, 'mudar_status', 'Processo #4: em_conferencia → Reprovado',
    '{"de":"em_conferencia","para":"Reprovado"}'::jsonb, '1 day', 'Ana');

  -- 5) "Aprovado sob concessão": resultado novo que não é Reprovado → Almoxarifado, sem mexer em código
  perform proc('EMB390', 'CAPJ95', 'Aprovado sob concessão', null, 'Vishay', '7 days', '3 days',
    'Aprovado sob concessão');

  -- 6) sem histórico: em conferência e nenhum log → cai na caixa do status, SEM tempo
  v_orfao := proc('EMB390', 'CAPJ96', 'em_conferencia', null, 'Panasonic', '30 days');

  -- 7) reaberto: finalizou há 6 dias e foi reaberto há 4 → está na Qualidade desde a reabertura
  v_reaberto := proc('EMB390', 'CAPJ97', 'em_conferencia', null, 'Panasonic', '20 days');
  perform log(v_reaberto, 'alterar_campo', 'Processo #7 — seção recebimento salva',
    '[{"campo":"quantidade_recebida","de":null,"para":100}]'::jsonb, '15 days');
  perform log(v_reaberto, 'mudar_status', 'Processo #7: em_conferencia → Aprovado',
    '{"de":"em_conferencia","para":"Aprovado"}'::jsonb, '6 days');
  perform log(v_reaberto, 'mudar_status', 'Processo #7: Aprovado → em_conferencia',
    '{"de":"Aprovado","para":"em_conferencia"}'::jsonb, '4 days', 'Ana');

  -- 8) EMB vizinha, pra provar que nada vaza entre EMBs
  v_outra := proc('EMB999', 'RESR85', 'aberto', '5', 'Yageo', '2 days');
  perform log(v_outra, 'criar', 'Processo #8 criado manualmente', '{"numero":8}'::jsonb, '2 days');
end $t$;

-- ---------- 0. gate de permissão ----------
do $t$ begin
  perform set_config('teste.perms', '', false);
  begin
    perform * from rec_fluxo_emb('EMB390');
    raise exception 'FALHOU: rec_fluxo_emb sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform * from rec_fluxo_emb_itens('EMB390', 'qualidade');
    raise exception 'FALHOU: rec_fluxo_emb_itens sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform * from rec_registros();
    raise exception 'FALHOU: rec_registros sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  -- Permissão de OUTRO módulo não serve.
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.editar', false);
  begin
    perform * from rec_fluxo_emb('EMB390');
    raise exception 'FALHOU: permissão de outro módulo passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  raise notice 'gate de permissão: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 1. helpers puros (espelham o domínio em TS) ----------
do $t$ begin
  if rec_divergente(null) or rec_divergente('') or rec_divergente('   ') then
    raise exception 'FALHOU: vazio não é divergência'; end if;
  if rec_divergente('0') or rec_divergente('0,00') then raise exception 'FALHOU: zero não é divergência'; end if;
  if not rec_divergente('-10') or not rec_divergente('10') or not rec_divergente('-0,5') then
    raise exception 'FALHOU: número diferente de zero é divergência'; end if;
  if rec_divergente('sem divergência') or rec_divergente('N/A') then
    raise exception 'FALHOU: texto que não é número não é divergência'; end if;

  if rec_etapa_por_resultado('Reprovado') <> 'reprovado'
     or rec_etapa_por_resultado('  reprovado ') <> 'reprovado' then
    raise exception 'FALHOU: Reprovado é a saída lateral'; end if;
  if rec_etapa_por_resultado('Aprovado') <> 'almoxarifado'
     or rec_etapa_por_resultado('Aprovado sob concessão') <> 'almoxarifado'
     or rec_etapa_por_resultado('Aprovado com ressalva') <> 'almoxarifado' then
    raise exception 'FALHOU: qualquer outro resultado vai pro Almoxarifado'; end if;

  if rec_etapa_por_status('aberto') <> 'recebimento' then raise exception 'FALHOU: aberto'; end if;
  if rec_etapa_por_status('em_conferencia') <> 'qualidade' then raise exception 'FALHOU: em_conferencia'; end if;
  if rec_etapa_por_status('Reprovado') <> 'reprovado' then raise exception 'FALHOU: status Reprovado'; end if;

  -- Seção pelo grupo dos campos do diff; diff que toca dois grupos → Qualidade vence.
  if rec_secao_do_diff('[{"campo":"volumes"}]'::jsonb) <> 'recebimento' then
    raise exception 'FALHOU: diff de recebimento'; end if;
  if rec_secao_do_diff('[{"campo":"fabricante"}]'::jsonb) <> 'qualidade' then
    raise exception 'FALHOU: diff de qualidade'; end if;
  if rec_secao_do_diff('[{"campo":"volumes"},{"campo":"fabricante"}]'::jsonb) <> 'qualidade' then
    raise exception 'FALHOU: diff nos dois grupos → qualidade'; end if;
  if rec_secao_do_diff('[]'::jsonb) is not null then raise exception 'FALHOU: diff vazio não decide'; end if;
  if rec_secao_do_diff('[{"campo":"numero_nf"}]'::jsonb) is not null then
    raise exception 'FALHOU: diff só de campo base não decide'; end if;
  if rec_secao_do_diff('{"de":"a","para":"b"}'::jsonb) is not null then
    raise exception 'FALHOU: dados que não são array não decidem'; end if;

  -- Diff vazio (salvar sem alterar nada) cai na seção nomeada na descrição.
  if rec_secao_do_log('Processo #1 — seção recebimento salva', '[]'::jsonb) <> 'recebimento' then
    raise exception 'FALHOU: desempate pela descrição'; end if;
  if rec_etapa_do_log('alterar_campo', 'Processo #1 — seção recebimento salva', '[]'::jsonb) <> 'qualidade' then
    raise exception 'FALHOU: salvar Recebimento passa pra Qualidade mesmo sem diff'; end if;
  -- Promoção automática do 1º salvamento não é passagem (o log da seção já contou o movimento).
  if rec_etapa_do_log('mudar_status', '', '{"de":"aberto","para":"em_conferencia"}'::jsonb) is not null then
    raise exception 'FALHOU: promoção automática não é passagem'; end if;
  -- Foto anexada é alterar_campo, mas não diz nada sobre o fluxo.
  if rec_etapa_do_log('alterar_campo', 'Processo #1 — foto anexada', '{"nome":"a.jpg"}'::jsonb) is not null then
    raise exception 'FALHOU: foto anexada não é passagem'; end if;
  raise notice 'helpers puros: ok';
end $t$;

-- ---------- 2. Fluxo: contagem por caixa, divergência e tempo ----------
do $t$
declare r record;
begin
  -- Sempre as quatro caixas, na ordem do fluxo (a tela desenha as quatro).
  if (select array_agg(etapa) from rec_fluxo_emb('EMB390'))
     <> array['recebimento', 'qualidade', 'almoxarifado', 'reprovado'] then
    raise exception 'FALHOU: o resumo tem que trazer as quatro caixas, na ordem do fluxo'; end if;

  select * into r from rec_fluxo_emb('EMB390') where etapa = 'recebimento';
  if r.itens <> 1 then raise exception 'FALHOU: Recebimento tinha que ter 1 item, tem %', r.itens; end if;
  -- Nasceu há 10 dias e nunca saiu do Recebimento.
  if round(r.maior_segundos / 86400) <> 10 then
    raise exception 'FALHOU: tempo no Recebimento = created_at (deu % dias)', r.maior_segundos / 86400; end if;

  select * into r from rec_fluxo_emb('EMB390') where etapa = 'qualidade';
  -- em_conferencia: o divergente, o sem histórico e o reaberto.
  if r.itens <> 3 then raise exception 'FALHOU: Qualidade tinha que ter 3 itens, tem %', r.itens; end if;
  if r.divergentes <> 1 then raise exception 'FALHOU: 1 divergente na Qualidade, tem %', r.divergentes; end if;
  if r.sem_tempo <> 1 then raise exception 'FALHOU: 1 item sem tempo na Qualidade, tem %', r.sem_tempo; end if;
  -- Os dois com tempo: 3 dias (salvou o Recebimento; o salvamento seguinte na Qualidade NÃO
  -- reinicia o relógio) e 4 dias (reabertura, que SIM reinicia).
  if round(r.maior_segundos / 86400) <> 4 then
    raise exception 'FALHOU: mais antigo da Qualidade = 4 dias (reabertura), deu %', r.maior_segundos / 86400; end if;
  if round(r.media_segundos / 86400) <> 4 then  -- média de 3 e 4 dias, arredondada
    raise exception 'FALHOU: média da Qualidade fora do esperado (% dias)', r.media_segundos / 86400; end if;

  select * into r from rec_fluxo_emb('EMB390') where etapa = 'almoxarifado';
  -- Aprovado + "Aprovado sob concessão": resultado novo entra no fluxo sozinho.
  if r.itens <> 2 then raise exception 'FALHOU: Almoxarifado tinha que ter 2 itens, tem %', r.itens; end if;
  if r.sem_tempo <> 0 then raise exception 'FALHOU: o Almoxarifado tem item sem tempo'; end if;

  select * into r from rec_fluxo_emb('EMB390') where etapa = 'reprovado';
  if r.itens <> 1 then raise exception 'FALHOU: Reprovado tinha que ter 1 item, tem %', r.itens; end if;
  if r.divergentes <> 1 then raise exception 'FALHOU: o reprovado é divergente e a marca acompanha'; end if;

  -- Divergência é marca, não caixa: os divergentes estão espalhados (1 na Qualidade + 1 no Reprovado).
  if (select sum(divergentes) from rec_fluxo_emb('EMB390')) <> 2 then
    raise exception 'FALHOU: a EMB tem 2 itens divergentes no total'; end if;

  -- Nada vaza entre EMBs.
  if (select sum(itens) from rec_fluxo_emb('EMB999')) <> 1 then
    raise exception 'FALHOU: a EMB999 tem 1 item só'; end if;
  if (select sum(itens) from rec_fluxo_emb('EMB000')) <> 0 then
    raise exception 'FALHOU: EMB inexistente tem que vir zerada, com as quatro caixas'; end if;
  raise notice 'fluxo (contagem, divergência e tempo): ok';
end $t$;

-- ---------- 3. Fluxo: os itens de uma caixa ----------
do $t$
declare r record;
begin
  if (select count(*) from rec_fluxo_emb_itens('EMB390', 'qualidade')) <> 3 then
    raise exception 'FALHOU: 3 itens na caixa Qualidade'; end if;

  -- Mais antigo primeiro; o sem tempo vai pro fim.
  select * into r from rec_fluxo_emb_itens('EMB390', 'qualidade') limit 1;
  if r.item <> 'CAPJ97' then raise exception 'FALHOU: o mais antigo da Qualidade é o reaberto, veio %', r.item; end if;
  select * into r from rec_fluxo_emb_itens('EMB390', 'qualidade') offset 2 limit 1;
  if r.item <> 'CAPJ96' or r.desde is not null then
    raise exception 'FALHOU: o item sem histórico vai pro fim e sem tempo (veio %)', r.item; end if;

  select * into r from rec_fluxo_emb_itens('EMB390', 'reprovado') limit 1;
  if r.item <> 'CAPJ94' or not rec_divergente(r.divergencia) or r.resultado <> 'Reprovado' then
    raise exception 'FALHOU: o reprovado divergente'; end if;

  if (select count(*) from rec_fluxo_emb_itens('EMB390', 'qualidade', 1)) <> 1 then
    raise exception 'FALHOU: p_limite não cortou'; end if;
  raise notice 'fluxo (itens da caixa): ok';
end $t$;

-- ---------- 4. Registros: linhas, etapa derivada e o diff ----------
do $t$
declare r record;
begin
  -- Todos os eventos de processo da base (8 logs criados acima).
  if (select count(*) from rec_registros()) <> 10 then
    raise exception 'FALHOU: 10 registros no total, veio %', (select count(*) from rec_registros()); end if;

  -- Mais recente primeiro.
  select * into r from rec_registros() limit 1;
  if r.item <> 'CAPJ92' or r.secao <> 'qualidade' then
    raise exception 'FALHOU: o registro mais recente é o salvamento da Qualidade do CAPJ92 (veio %)', r.item; end if;
  -- As colunas de identidade vêm do PROCESSO, não do log.
  if r.fornecedor <> 'Panasonic' or r.fabricante <> 'PANA' or r.part_number <> 'ECA1HM101'
     or r.emb <> 'EMB390' or r.descricao <> 'CAPACITOR CAPJ92' then
    raise exception 'FALHOU: identidade do item vem do processo'; end if;
  if r.colaborador <> 'Ana' then raise exception 'FALHOU: colaborador vem do log'; end if;

  -- O diff sai como array, campo a campo (é o detalhe que a tela abre ao clicar).
  select * into r from rec_registros(p_item => 'CAPJ92', p_etapa => 'qualidade')
    where secao = 'recebimento';
  if jsonb_array_length(r.alteracoes) <> 2
     or r.alteracoes->0->>'campo' <> 'quantidade_recebida'
     or (r.alteracoes->0->>'para') <> '490' then
    raise exception 'FALHOU: o diff do salvamento do Recebimento'; end if;

  -- Finalização traz o resultado (é o "(Aprovado)" da coluna Etapa).
  select * into r from rec_registros(p_item => 'CAPJ93', p_etapa => 'almoxarifado');
  if r.status_de <> 'em_conferencia' or r.status_para <> 'Aprovado' or r.acao <> 'mudar_status' then
    raise exception 'FALHOU: a finalização do CAPJ93'; end if;

  -- O `total` (window count) é o mesmo em toda linha e ignora a paginação.
  if (select distinct total from rec_registros(p_tamanho => 2)) <> 10 then
    raise exception 'FALHOU: total tem que contar o resultado inteiro, não a página'; end if;
  if (select count(*) from rec_registros(p_tamanho => 2)) <> 2 then
    raise exception 'FALHOU: p_tamanho não paginou'; end if;
  if (select count(*) from rec_registros(p_tamanho => 4, p_pagina => 2)) <> 2 then
    raise exception 'FALHOU: p_pagina não paginou (10 linhas, 3ª página de 4)'; end if;
  raise notice 'registros (linhas, etapa e diff): ok';
end $t$;

-- ---------- 5. Registros: os filtros, sozinhos e combinados ----------
do $t$ begin
  if (select count(*) from rec_registros(p_emb => 'EMB999')) <> 1 then
    raise exception 'FALHOU: filtro de EMB'; end if;
  if (select count(*) from rec_registros(p_emb => 'emb999')) <> 1 then
    raise exception 'FALHOU: filtro de EMB ignora a caixa'; end if;
  if (select count(*) from rec_registros(p_item => 'CAPJ9')) <> 9 then
    raise exception 'FALHOU: filtro de item casa por "contém"'; end if;
  if (select count(*) from rec_registros(p_item => 'CAPJ93')) <> 2 then
    raise exception 'FALHOU: filtro de item exato'; end if;
  if (select count(*) from rec_registros(p_fornecedor => 'Vishay')) <> 3 then
    raise exception 'FALHOU: filtro de fornecedor'; end if;
  if (select count(*) from rec_registros(p_colaborador => 'ana')) <> 4 then
    raise exception 'FALHOU: filtro de colaborador ignora a caixa e casa por "contém"'; end if;
  if (select count(*) from rec_registros(p_etapa => 'reprovado')) <> 1 then
    raise exception 'FALHOU: filtro de etapa (saída lateral)'; end if;
  if (select count(*) from rec_registros(p_etapa => 'recebimento')) <> 1 then
    raise exception 'FALHOU: filtro de etapa (a criação é o único evento que deixa o item no Recebimento)'; end if;
  if (select count(*) from rec_registros(p_de => now() - interval '2 days 12 hours')) <> 4 then
    raise exception 'FALHOU: filtro de período (de)'; end if;
  if (select count(*) from rec_registros(p_ate => now() - interval '5 days 12 hours')) <> 2 then
    raise exception 'FALHOU: filtro de período (até)'; end if;
  if (select count(*) from rec_registros(
        p_de => now() - interval '4 days 12 hours', p_ate => now() - interval '1 day 12 hours')) <> 5 then
    raise exception 'FALHOU: filtro de período (janela)'; end if;

  -- Combinados: EMB + fornecedor + etapa + período + colaborador ao mesmo tempo.
  if (select count(*) from rec_registros(
        p_emb => 'EMB390', p_fornecedor => 'Vishay', p_etapa => 'almoxarifado',
        p_de => now() - interval '2 days 12 hours', p_colaborador => 'Ana')) <> 1 then
    raise exception 'FALHOU: filtros combinados'; end if;
  -- Combinação que não casa com nada não pode devolver linha.
  if (select count(*) from rec_registros(p_emb => 'EMB999', p_fornecedor => 'Vishay')) <> 0 then
    raise exception 'FALHOU: combinação impossível devolveu linha'; end if;

  -- Curinga do LIKE digitado no filtro é literal, não casa "qualquer caractere".
  if (select count(*) from rec_registros(p_item => 'CAPJ_9')) <> 0 then
    raise exception 'FALHOU: "_" no filtro tem que ser literal'; end if;
  if (select count(*) from rec_registros(p_item => '%')) <> 0 then
    raise exception 'FALHOU: "%%" no filtro tem que ser literal'; end if;
  raise notice 'registros (filtros): ok';
end $t$;

-- ---------- 6. Reabertura: volta pra Qualidade e o evento anterior continua na lista ----------
do $t$
declare v_id uuid; r record;
begin
  select id into v_id from processos_recebimento where codigo_material = 'CAPJ97';

  -- O item está na Qualidade (status em_conferencia depois de reaberto), não no Almoxarifado.
  if (select count(*) from rec_fluxo_emb_itens('EMB390', 'qualidade') where item = 'CAPJ97') <> 1 then
    raise exception 'FALHOU: o reaberto tem que estar na Qualidade'; end if;
  if (select count(*) from rec_fluxo_emb_itens('EMB390', 'almoxarifado') where item = 'CAPJ97') <> 0 then
    raise exception 'FALHOU: o reaberto não pode ficar no Almoxarifado'; end if;

  -- O relógio da caixa conta da REABERTURA (4 dias), não do salvamento antigo (15 dias).
  select * into r from rec_fluxo_emb_itens('EMB390', 'qualidade') where item = 'CAPJ97';
  if round(r.segundos / 86400) <> 4 then
    raise exception 'FALHOU: o reaberto está na Qualidade desde a reabertura (deu % dias)', r.segundos / 86400; end if;

  -- Os três eventos continuam na lista: a finalização anterior NÃO é apagada.
  if (select count(*) from rec_registros(p_item => 'CAPJ97')) <> 3 then
    raise exception 'FALHOU: o histórico do reaberto tem 3 eventos'; end if;
  if (select count(*) from rec_registros(p_item => 'CAPJ97', p_etapa => 'almoxarifado')) <> 1 then
    raise exception 'FALHOU: a finalização anterior continua na lista'; end if;
  -- A reabertura aparece como evento próprio (mudar_status de um terminal de volta pra conferência).
  select * into r from rec_registros(p_item => 'CAPJ97') limit 1;
  if r.status_de <> 'Aprovado' or r.status_para <> 'em_conferencia' or r.etapa <> 'qualidade' then
    raise exception 'FALHOU: a reabertura como evento'; end if;
  raise notice 'reabertura: ok';
end $t$;

select 'RECEBIMENTO FLUXO/REGISTROS OK' as resultado;
