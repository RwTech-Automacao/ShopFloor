-- Testes SQL da 0150 (tipo de regra 'emb': aviso de fim de EMB). Rodar com
-- supabase/tests/rodar-alertas-test.sh: DEPOIS de alertas_modulo_test.sql, na mesma base, com a
-- 0124 (as funções rec_*) e a 0150 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0150 recria o alerta_avaliar, que roda de 5 em 5 minutos em
-- produção, e os dois defeitos mais caros dela são SQL puro, invisíveis para o vitest:
--   (a) o aviso sair DUAS vezes para a mesma EMB (a marca de "já avisei"), e
--   (b) a primeira rodada em produção mandar um aviso de TODA EMB historicamente fechada
--       (o piso rg.criado_em).
--
-- O mapa dos testes — os números batem com os casos de aceitação da spec:
--   T0  esquema: tipo 'emb' aceito, postos vazio aceito SÓ nele, tabela da marca, grants;
--   T1  (caso 1) EMB com 3 itens, 2 ainda na Qualidade: NÃO manda nada, NÃO grava marca;
--   T2  (caso 2) o último item chega ao Almoxarifado: SAI a mensagem, com as divergências e as
--       justificativas, e a marca é gravada;
--   T3  (caso 3) ⚠️ a MESMA EMB na rodada seguinte: ZERO linhas novas na fila;
--   T4  (caso 4) EMB que fecha SEM divergência: MANDA a mensagem de EMB limpa (lista vazia no
--       `dados`) e a marca É gravada — decisão 5 corrigida em 14/10/2026;
--   T5  (caso 5) EMB cujo último item foi REPROVADO na Qualidade: MANDA (reprovado também é fim);
--   T6  ⚠️ o piso rg.criado_em: EMB fechada ANTES de a regra existir não manda nada;
--   T7  ⚠️ divergência com ninguém alcançável: nada na fila e a marca NÃO é gravada (volta depois);
--   T8  ⚠️ o fim de EMB não encosta no caminho da ocorrência: alerta_ocorrencias não ganha linha,
--       e `avaliadas` não sobe por causa dele;
--   T9  o filtro por EMB não vaza: a divergência da EMB vizinha não entra na mensagem;
--   T10 os tipos antigos continuam avaliando na MESMA rodada;
--   T11 ⚠️ o teto de idade (3 dias): EMB fechada ha mais tempo nao avisa nem e marcada, inclusive
--       quando uma regra travada/reativada volta a alcancar alguem.
-- (A idempotência da 0150 é do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
-- Beto administra o Recebimento e tem conta no Telegram (vem do teste da 0149).
-- ⚠️ `minimo_bipes` vai EXPLÍCITO e nulo: a coluna é nullable desde a 0115 mas manteve o
-- `default 20` da 0113, e o ramo 'emb' do check exige nulo. É o mesmo cuidado do
-- teste_regra_resumo (alertas_resumo_test.sql) e da regras-repository.ts, que mandam toda coluna.
create function public.teste_regra_emb(
  p_nome text,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-0000000000b1']::uuid[],
  p_criado_em timestamptz default now() - interval '1 hour'
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por, criado_em)
  values (p_nome, 'emb', 'recebimento', '{}'::text[], 'op', null, null, array['telegram'],
          p_destinatarios, true, false, true, '00000000-0000-0000-0000-000000000001', p_criado_em)
  returning id
$f$;

-- Um item de EMB. p_status: 'aberto' | 'em_conferencia' | 'Aprovado' | 'Reprovado'.
create function public.teste_item_emb(
  p_emb text, p_item text, p_status text,
  p_pedido numeric default 500, p_recebido numeric default 500,
  p_justificativa text default '', p_quem text default ''
) returns bigint language sql as $f$
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     divergencia, status, resultado, divergencia_justificativa, divergencia_justificada_por_nome,
     divergencia_justificada_em, created_at, finalizado_em)
  values (p_emb, p_item, 'CAPACITOR ' || p_item, p_pedido, p_recebido,
          -- O campo é CALCULADO pelo sistema e guardado como texto (0124/0147).
          (p_recebido - p_pedido)::text,
          p_status,
          case when p_status in ('Aprovado', 'Reprovado') then p_status end,
          p_justificativa, p_quem,
          case when p_justificativa <> '' then now() end,
          now() - interval '2 days',
          case when p_status in ('Aprovado', 'Reprovado') then now() - interval '1 minute' end)
  returning numero
$f$;

-- Quantas linhas de fila de tipo 'emb' esta regra já tem para esta EMB.
create function public.teste_envios_emb(p_regra text, p_emb text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'emb' and dados->>'regra_nome' = p_regra and dados->>'emb' = upper(btrim(p_emb))
$f$;

-- A marca existe?
create function public.teste_marca_emb(p_regra text, p_emb text) returns boolean language sql as $f$
  select exists (
    select 1 from public.alerta_emb_avisada a
      join public.alerta_regras rg on rg.id = a.regra_id
     where rg.nome = p_regra and a.emb = upper(btrim(p_emb)))
$f$;

-- Roda uma avaliação como o cron roda.
create function public.teste_avaliar() returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;

-- ---------- T0: esquema ----------
do $t$
begin
  if not exists (select 1 from pg_class where relname = 'alerta_emb_avisada'
                   and relnamespace = 'public'::regnamespace) then
    raise exception 'T0 FALHOU: alerta_emb_avisada nao existe';
  end if;
  if not (select relrowsecurity from pg_class where relname = 'alerta_emb_avisada'
            and relnamespace = 'public'::regnamespace) then
    raise exception 'T0 FALHOU: alerta_emb_avisada sem RLS';
  end if;
  -- Grants: a anon key está no JavaScript do navegador; a marca é escrita SÓ pelo banco.
  if has_table_privilege('anon', 'public.alerta_emb_avisada', 'select') then
    raise exception 'T0 FALHOU: anon le a marca';
  end if;
  if has_table_privilege('authenticated', 'public.alerta_emb_avisada', 'insert') then
    raise exception 'T0 FALHOU: authenticated escreve na marca';
  end if;
  if not has_table_privilege('service_role', 'public.alerta_emb_avisada', 'insert') then
    raise exception 'T0 FALHOU: service_role nao escreve na marca';
  end if;
  -- postos vazio: só no tipo 'emb'. Esta linha trip SÓ o alerta_regras_postos_por_tipo (o ramo
  -- 'aprovacao' do campos_por_tipo não olha postos), então ela mede o check novo sozinha.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('SF sem posto', 'aprovacao', 'shopfloor', '{}'::text[], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T0 FALHOU: regra de aprovacao sem posto foi aceita';
  exception when check_violation then null;
  end;
  -- E o 'emb' não aceita posto nenhum (campo que não é dele). Aqui as DUAS guardas recusam (o ramo
  -- 'emb' do campos_por_tipo também exige cardinality(postos) = 0): é cinto e suspensório de
  -- propósito, e o teste só exige que a linha não entre.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, canais, destinatarios, ativa,
       criado_por)
    values ('EMB com posto', 'emb', 'recebimento', array['Teste'], 'op', null, array['telegram'],
            array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T0 FALHOU: regra de fim de EMB com posto foi aceita';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T0 (esquema do fim de EMB): ok'

-- ---------- T1 (caso 1): EMB aberta não manda nada ----------
select public.teste_regra_emb('Fim de EMB');
select public.teste_item_emb('EMB100', 'CAP-1', 'Aprovado', 500, 490);
select public.teste_item_emb('EMB100', 'CAP-2', 'em_conferencia');
select public.teste_item_emb('EMB100', 'CAP-3', 'em_conferencia');
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> 0 then
    raise exception 'T1 FALHOU: EMB com itens na Qualidade mandou aviso';
  end if;
  if public.teste_marca_emb('Fim de EMB', 'EMB100') then
    raise exception 'T1 FALHOU: EMB aberta recebeu marca';
  end if;
end $t$;
\echo 'T1 (caso 1: EMB aberta nao manda): ok'

-- ---------- T2 (caso 2): o último item fecha a EMB e o aviso sai ----------
update public.processos_recebimento
   set status = 'Aprovado', resultado = 'Aprovado', finalizado_em = now() - interval '1 minute'
 where numero_emb = 'EMB100' and status = 'em_conferencia';
-- Uma das divergências tem justificativa, a outra não: é o par que a mensagem precisa mostrar.
update public.processos_recebimento
   set divergencia_justificativa = 'Fornecedor avisou falta; saldo entra na proxima NF.',
       divergencia_justificada_por_nome = 'Ana Gestora', divergencia_justificada_em = now()
 where numero_emb = 'EMB100' and codigo_material = 'CAP-1';
update public.processos_recebimento
   set quantidade_recebida = 505, divergencia = '5'
 where numero_emb = 'EMB100' and codigo_material = 'CAP-3';
do $t$
declare v_dados jsonb; v_divs jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> 1 then
    raise exception 'T2 FALHOU: esperava 1 linha de fila (Beto x telegram), achei %',
      public.teste_envios_emb('Fim de EMB', 'EMB100');
  end if;
  select dados into v_dados from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB100' limit 1;
  v_divs := v_dados->'divergencias';
  if jsonb_array_length(v_divs) <> 2 then
    raise exception 'T2 FALHOU: esperava 2 divergencias, achei %', jsonb_array_length(v_divs);
  end if;
  -- Só as DIVERGENTES entram: CAP-2 (500/500) ficou fora.
  if exists (select 1 from jsonb_array_elements(v_divs) d where d->>'item' = 'CAP-2') then
    raise exception 'T2 FALHOU: item sem divergencia entrou na mensagem';
  end if;
  -- A justificativa viaja junto; a que ninguem escreveu vem vazia (quem decide o texto e o TS).
  if (select d->>'justificativa' from jsonb_array_elements(v_divs) d where d->>'item' = 'CAP-1')
     not like 'Fornecedor avisou%' then
    raise exception 'T2 FALHOU: a justificativa do CAP-1 nao chegou no dados';
  end if;
  if coalesce((select d->>'justificativa' from jsonb_array_elements(v_divs) d
                where d->>'item' = 'CAP-3'), '') <> '' then
    raise exception 'T2 FALHOU: CAP-3 nao justificado chegou com texto';
  end if;
  if not public.teste_marca_emb('Fim de EMB', 'EMB100') then
    raise exception 'T2 FALHOU: a marca nao foi gravada depois de enfileirar';
  end if;
end $t$;
\echo 'T2 (caso 2: EMB fechada manda as divergencias e as justificativas): ok'

-- ---------- T3 (caso 3): a rodada seguinte não manda de novo ----------
do $t$
declare v_antes int;
begin
  v_antes := public.teste_envios_emb('Fim de EMB', 'EMB100');
  set local role service_role;
  perform public.teste_avaliar();
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> v_antes then
    raise exception 'T3 FALHOU: a marca nao impediu o reenvio (% -> %)',
      v_antes, public.teste_envios_emb('Fim de EMB', 'EMB100');
  end if;
end $t$;
\echo 'T3 (caso 3: a marca impede o reenvio): ok'

-- ---------- T4 (caso 4): EMB limpa MANDA a mensagem de EMB limpa, e recebe a marca ----------
-- ⚠️ DECISAO REVERTIDA EM 14/10/2026: ate 09/10 este teste exigia o CONTRARIO (EMB sem divergencia
-- nao mandava nada e so recebia a marca). Hoje toda EMB que fecha manda mensagem; sem divergencia,
-- a lista vai VAZIA e o texto diz que fechou limpa. Se este teste voltar a exigir silencio, e a
-- decisao antiga ressurgindo — confira a spec antes de "consertar" a migracao.
select public.teste_item_emb('EMB200', 'RES-1', 'Aprovado', 100, 100);
select public.teste_item_emb('EMB200', 'RES-2', 'Aprovado', 200, 200);
do $t$
declare v_dados jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB200') <> 1 then
    raise exception 'T4 FALHOU: EMB limpa nao mandou aviso (esperava 1 linha, achei %)',
      public.teste_envios_emb('Fim de EMB', 'EMB200');
  end if;
  select dados into v_dados from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB200' limit 1;
  -- A lista vem VAZIA, e nao ausente: quem escolhe a frase da EMB limpa e o TS (domain/emb.ts), e
  -- ele precisa distinguir "nenhuma divergencia" de "dado corrompido".
  if v_dados->'divergencias' is null then
    raise exception 'T4 FALHOU: o dados da EMB limpa saiu sem a chave divergencias';
  end if;
  if jsonb_array_length(v_dados->'divergencias') <> 0 then
    raise exception 'T4 FALHOU: EMB limpa mandou divergencia (%)', v_dados->'divergencias';
  end if;
  -- A marca segue a MESMA regra de todo mundo: gravada depois de enfileirar.
  if not public.teste_marca_emb('Fim de EMB', 'EMB200') then
    raise exception 'T4 FALHOU: EMB limpa ficou sem marca e vai ser reavaliada para sempre';
  end if;
  -- E o contador da auditoria anota ZERO divergencia, que e o que responde depois "por que esta
  -- EMB mandou uma mensagem sem lista?".
  if (select a.divergencias from public.alerta_emb_avisada a
        join public.alerta_regras r on r.id = a.regra_id
       where r.nome = 'Fim de EMB' and a.emb = 'EMB200') <> 0 then
    raise exception 'T4 FALHOU: a marca da EMB limpa anotou divergencia';
  end if;
end $t$;
\echo 'T4 (caso 4: EMB limpa manda a mensagem de EMB limpa e recebe marca): ok'

-- ---------- T5 (caso 5): reprovado também é fim ----------
select public.teste_item_emb('EMB300', 'IND-1', 'Reprovado', 50, 45);
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB300') <> 1 then
    raise exception 'T5 FALHOU: EMB fechada por reprova nao mandou aviso';
  end if;
end $t$;
\echo 'T5 (caso 5: reprovado tambem e fim): ok'

-- ---------- T6: o piso rg.criado_em ----------
-- Uma EMB fechada ANTES de a regra nascer não pode mandar nada: é isso que impede a avalanche na
-- primeira rodada em produção.
select public.teste_item_emb('EMB900', 'OLD-1', 'Aprovado', 10, 9);
update public.processos_recebimento
   set finalizado_em = now() - interval '90 days', created_at = now() - interval '91 days'
 where numero_emb = 'EMB900';
select public.teste_regra_emb('Fim de EMB nova', array['00000000-0000-0000-0000-0000000000b1']::uuid[], now());
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB nova', 'EMB900') <> 0 then
    raise exception 'T6 FALHOU: EMB fechada antes da regra mandou aviso (a avalanche volta)';
  end if;
  -- E a regra VELHA (criada 1 h atrás) também não a manda: a EMB900 fechou há 90 dias.
  if public.teste_envios_emb('Fim de EMB', 'EMB900') <> 0 then
    raise exception 'T6 FALHOU: a regra velha mandou a EMB historica';
  end if;
end $t$;
\echo 'T6 (piso criado_em: EMB historica nao manda): ok'

-- ---------- T7: há divergência mas ninguém alcançável ----------
-- Regra cujo responsável não tem conta vinculada: nada vai para a fila E a marca NÃO é gravada —
-- quando a pessoa vincular a conta ainda hoje, o aviso sai.
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b2', 'Dora Sem Conta', 'dora@x', true,
   '00000000-0000-0000-0000-0000000000b0')
on conflict (id) do nothing;
select public.teste_regra_emb('EMB sem alcance', array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
select public.teste_item_emb('EMB400', 'DIV-1', 'Aprovado', 80, 70);
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('EMB sem alcance', 'EMB400') <> 0 then
    raise exception 'T7 FALHOU: enfileirou para quem nao tem conta';
  end if;
  if public.teste_marca_emb('EMB sem alcance', 'EMB400') then
    raise exception 'T7 FALHOU: marcou sem enviar — o aviso nunca mais sairia';
  end if;
end $t$;
\echo 'T7 (divergencia sem ninguem alcancavel: nao marca): ok'

-- ---------- T8: o fim de EMB não encosta no caminho da ocorrência ----------
do $t$
declare v_oc_antes int; v_oc_depois int; v_res jsonb;
begin
  select count(*) into v_oc_antes from public.alerta_ocorrencias;
  perform public.teste_item_emb('EMB500', 'X-1', 'Aprovado', 10, 8);
  set local role service_role;
  v_res := public.teste_avaliar();
  reset role;
  select count(*) into v_oc_depois from public.alerta_ocorrencias;
  if v_oc_depois <> v_oc_antes then
    raise exception 'T8 FALHOU: o fim de EMB abriu ocorrencia (% -> %)', v_oc_antes, v_oc_depois;
  end if;
  -- `avaliadas` continua sendo "itens de posto avaliados": numa rodada só de EMB ele é 0 com
  -- `enfileirados > 0`, e isso NÃO é contradição (mesma nota da 0141).
  if (v_res->>'avaliadas')::int <> 0 then
    raise exception 'T8 FALHOU: avaliadas subiu por causa do fim de EMB (%)', v_res->>'avaliadas';
  end if;
  if (v_res->>'enfileirados')::int < 1 then
    raise exception 'T8 FALHOU: a rodada so de EMB nao enfileirou nada (%)', v_res->>'enfileirados';
  end if;
  if exists (select 1 from public.alerta_envios where tipo = 'emb' and com_botao) then
    raise exception 'T8 FALHOU: linha de fim de EMB nasceu com botao Resolvido';
  end if;
  if exists (select 1 from public.alerta_envios where tipo = 'emb' and ocorrencia_id is not null) then
    raise exception 'T8 FALHOU: linha de fim de EMB nasceu com ocorrencia';
  end if;
end $t$;
\echo 'T8 (o fim de EMB nao vira ocorrencia): ok'

-- ---------- T9: o filtro por EMB não vaza ----------
select public.teste_item_emb('EMB600', 'A-1', 'Aprovado', 10, 7);
select public.teste_item_emb('EMB601', 'B-1', 'Aprovado', 10, 3);
do $t$
declare v_divs jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  select dados->'divergencias' into v_divs from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB600' limit 1;
  if jsonb_array_length(coalesce(v_divs, '[]'::jsonb)) <> 1 then
    raise exception 'T9 FALHOU: a mensagem da EMB600 trouxe % divergencias',
      jsonb_array_length(coalesce(v_divs, '[]'::jsonb));
  end if;
  if exists (select 1 from jsonb_array_elements(v_divs) d where d->>'item' = 'B-1') then
    raise exception 'T9 FALHOU: a divergencia da EMB vizinha entrou';
  end if;
end $t$;
\echo 'T9 (o filtro por EMB nao vaza): ok'

-- ---------- T10: os tipos antigos continuam na mesma rodada ----------
do $t$
declare v_res jsonb;
begin
  update public.alerta_regras set ativa = true where nome = 'SF modulo';
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - interval '1 minute', 'Teste', 'PMOA', '1000', 'reprovado'
    from generate_series(1, 10);
  perform public.teste_item_emb('EMB700', 'C-1', 'Aprovado', 10, 6);
  set local role service_role;
  v_res := public.teste_avaliar();
  reset role;
  if (v_res->>'avaliadas')::int < 1 then
    raise exception 'T10 FALHOU: a regra de aprovacao deixou de ser avaliada';
  end if;
  if public.teste_envios_emb('Fim de EMB', 'EMB700') <> 1 then
    raise exception 'T10 FALHOU: o fim de EMB nao saiu na mesma rodada';
  end if;
end $t$;
\echo 'T10 (tipos antigos intactos): ok'

-- ---------- T11: o TETO DE IDADE (3 dias) ----------
-- O piso criado_em sozinho nao cobre regra reativada depois de semanas nem regra que passou dias
-- sem ninguem alcancavel: a marca so e gravada quando algo entra na fila, entao todas as EMBs
-- fechadas desde a criacao da regra viravam aviso "atrasado" de uma vez. O teto: EMB fechada ha
-- mais de 3 dias nao avisa e nao e marcada.
create function public.teste_fechar_ha(p_emb text, p_intervalo interval) returns void language sql as $f$
  update public.processos_recebimento
     set finalizado_em = now() - p_intervalo, created_at = now() - p_intervalo - interval '1 day'
   where numero_emb = p_emb
$f$;

-- (a) + (b): regra alcancavel criada ha 10 dias; EMB de 4 dias NAO avisa e NAO marca; EMB de 2 dias
-- avisa e marca (controle positivo no mesmo teste: nao passa por "nao fazer nada").
select public.teste_regra_emb('Teto 3 dias', array['00000000-0000-0000-0000-0000000000b1']::uuid[],
                              now() - interval '10 days');
select public.teste_item_emb('EMB810', 'T-1', 'Aprovado', 10, 9);
select public.teste_item_emb('EMB811', 'T-2', 'Aprovado', 10, 9);
select public.teste_fechar_ha('EMB810', interval '4 days');
select public.teste_fechar_ha('EMB811', interval '2 days');
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Teto 3 dias', 'EMB810') <> 0 then
    raise exception 'T11a FALHOU: EMB fechada ha 4 dias foi avisada (passou do teto)';
  end if;
  if public.teste_marca_emb('Teto 3 dias', 'EMB810') then
    raise exception 'T11a FALHOU: EMB fora do teto recebeu marca';
  end if;
  if public.teste_envios_emb('Teto 3 dias', 'EMB811') <> 1 then
    raise exception 'T11b FALHOU: EMB fechada ha 2 dias nao foi avisada (controle positivo)';
  end if;
  if not public.teste_marca_emb('Teto 3 dias', 'EMB811') then
    raise exception 'T11b FALHOU: EMB dentro do teto nao foi marcada';
  end if;
end $t$;
\echo 'T11a/b (teto de 3 dias: 4 dias nao avisa, 2 dias avisa): ok'

-- (c) a regra "travada": ninguem alcancavel enquanto uma EMB de 5 dias e uma de ontem fecham;
-- depois a regra passa a ter quem receba. A velha continua sem aviso; a de ontem avisa.
select public.teste_regra_emb('Teto travada', array['00000000-0000-0000-0000-0000000000b2']::uuid[],
                              now() - interval '10 days');
select public.teste_item_emb('EMB820', 'T-3', 'Aprovado', 10, 9);
select public.teste_item_emb('EMB821', 'T-4', 'Aprovado', 10, 9);
select public.teste_fechar_ha('EMB820', interval '5 days');
select public.teste_fechar_ha('EMB821', interval '1 day');
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Teto travada', 'EMB820') + public.teste_envios_emb('Teto travada', 'EMB821') <> 0 then
    raise exception 'T11c FALHOU: enfileirou enquanto ninguem era alcancavel';
  end if;
  -- Alguem passa a ser alcancavel (a conta foi vinculada / a permissao voltou).
  update public.alerta_regras set destinatarios = array['00000000-0000-0000-0000-0000000000b1']::uuid[]
   where nome = 'Teto travada';
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Teto travada', 'EMB820') <> 0 or public.teste_marca_emb('Teto travada', 'EMB820') then
    raise exception 'T11c FALHOU: a EMB de 5 dias foi avisada/marcada quando a regra voltou a alcancar';
  end if;
  if public.teste_envios_emb('Teto travada', 'EMB821') <> 1 then
    raise exception 'T11c FALHOU: a EMB de ontem nao foi avisada quando a regra voltou a alcancar';
  end if;
end $t$;
\echo 'T11c (regra travada que volta a alcancar: so a recente avisa): ok'

drop function public.teste_fechar_ha(text, interval);

drop function public.teste_regra_emb(text, uuid[], timestamptz);
drop function public.teste_item_emb(text, text, text, numeric, numeric, text, text);
drop function public.teste_envios_emb(text, text);
drop function public.teste_marca_emb(text, text);
drop function public.teste_avaliar();
\echo '0150 (fim de EMB): ok'
