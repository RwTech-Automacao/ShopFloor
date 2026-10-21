-- Testes de rec_dashboard_metricas (migração 0154). Roda no banco `dashmet` de rodar-recebimento-test.sh, DEPOIS de:
--   recebimento_dashboard_metricas_esquema.sql → 0142 → 0143 → 0147 → 0152 → massa → 0154 → 0154
-- As contas esperadas estão no cabeçalho de recebimento_dashboard_metricas_massa.sql.
-- Janela W = 2020-08-01 a 2020-09-30.

create function pg_temp.confere(p_rotulo text, p_obtido numeric, p_esperado numeric) returns void
language plpgsql as $f$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % devia ser % e veio %', p_rotulo, p_esperado, coalesce(p_obtido::text, 'nulo');
  end if;
end $f$;
create function pg_temp.confere_txt(p_rotulo text, p_obtido text, p_esperado text) returns void
language plpgsql as $f$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % devia ser % e veio %', p_rotulo, coalesce(p_esperado, 'nulo'), coalesce(p_obtido, 'nulo');
  end if;
end $f$;
-- Atalho: a função na janela W com filtros opcionais.
create function pg_temp.w(p_forn text default null, p_comp text default null, p_emb text default null,
                          p_cod text default null, p_x int default 7) returns jsonb
language sql as $f$
  select public.rec_dashboard_metricas(p_forn, p_comp, p_emb, p_cod, '2020-08-01', '2020-09-30', p_x)
$f$;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- ---------- 0. a porta ----------
do $t$
begin
  perform set_config('teste.perms', '', false);
  begin
    perform rec_dashboard_metricas();
    raise exception 'FALHOU: sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.editar', false);
  begin
    perform rec_dashboard_metricas();
    raise exception 'FALHOU: permissão de outro módulo abriu';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.rec_dashboard_metricas(text, text, text, text, date, date, integer)', 'execute') then
    raise exception 'FALHOU: anon executa (faltou o revoke)'; end if;
  if not has_function_privilege('authenticated', 'public.rec_dashboard_metricas(text, text, text, text, date, date, integer)', 'execute') then
    raise exception 'FALHOU: authenticated não executa'; end if;
  if not (select prosecdef from pg_proc where proname = 'rec_dashboard_metricas' and pronamespace = 'public'::regnamespace) then
    raise exception 'FALHOU: tem que ser security definer'; end if;
  raise notice 'porta, grants e security definer: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 0b. o atalho rec_norm_texto_rapido dá SEMPRE o mesmo que rec_norm_texto ----------
do $t$
declare
  v text;
begin
  foreach v in array array['', ' ', 'ACME', ' ACME', 'ACME ', E'\tACME\t', E'ACME\n', E'\u00a0ACME\u00a0', 'Fusível', 'á', ' á ', 'a b', ' a  b ', '!', '~', E'\x7f', '  ', 'é ']
  loop
    if public.rec_norm_texto_rapido(v) is distinct from public.rec_norm_texto(v) then
      raise exception 'FALHOU: rec_norm_texto_rapido(%) diverge de rec_norm_texto', quote_literal(v); end if;
  end loop;
  if public.rec_norm_texto_rapido(null) is not null then raise exception 'FALHOU: rapido(null) tem que ser null'; end if;
  raise notice 'atalho do aparo: ok';
end $t$;

-- ---------- 1. X inválido ----------
do $t$
begin
  begin
    perform rec_dashboard_metricas(p_parado_dias => 5);
    raise exception 'FALHOU: parado 5 passou';
  exception when others then
    if sqlerrm <> 'PARADO_INVALIDO' then raise; end if;
  end;
  perform rec_dashboard_metricas(p_parado_dias => 3);
  perform rec_dashboard_metricas(p_parado_dias => 30);
  raise notice 'PARADO_INVALIDO: ok';
end $t$;

-- ---------- 2. Volume ----------
do $t$
declare
  v jsonb := pg_temp.w();
  s jsonb := v->'volume'->'semanas';
  m jsonb := v->'volume'->'meses';
  esperado_itens int[] := array[0,0,0,0,0,1,4,1,4,0];
  esperado_embs  int[] := array[0,0,0,0,0,1,3,0,2,0];
  i int;
begin
  perform pg_temp.confere('semanas (contínuas)', jsonb_array_length(s), 10);
  perform pg_temp.confere_txt('primeira semana', s->0->>'inicio', '2020-07-27');
  perform pg_temp.confere_txt('última semana',   s->9->>'inicio', '2020-09-28');
  for i in 1..10 loop
    perform pg_temp.confere('itens da semana ' || i, (s->(i-1)->>'itens')::numeric, esperado_itens[i]);
    perform pg_temp.confere('EMBs da semana ' || i,  (s->(i-1)->>'embs')::numeric,  esperado_embs[i]);
  end loop;
  perform pg_temp.confere('meses', jsonb_array_length(m), 2);
  perform pg_temp.confere_txt('mês 1', m->0->>'inicio', '2020-08-01');
  perform pg_temp.confere('itens ago', (m->0->>'itens')::numeric, 1);
  perform pg_temp.confere('EMBs ago',  (m->0->>'embs')::numeric, 1);
  perform pg_temp.confere_txt('mês 2', m->1->>'inicio', '2020-09-01');
  perform pg_temp.confere('itens set', (m->1->>'itens')::numeric, 9);
  perform pg_temp.confere('EMBs set (count distinct, sem vazias, sem cancelado)', (m->1->>'embs')::numeric, 5);
  raise notice 'volume: ok';
end $t$;

-- ---------- 3. Qualidade ----------
do $t$
declare
  q jsonb := pg_temp.w()->'qualidade';
begin
  perform pg_temp.confere('com_resultado',    (q->'totais'->>'com_resultado')::numeric, 9);
  perform pg_temp.confere('reprovados',       (q->'totais'->>'reprovados')::numeric, 4);
  perform pg_temp.confere('peças recebidas',  (q->'totais'->>'pecas_recebidas')::numeric, 2990);
  perform pg_temp.confere('peças reprovadas', (q->'totais'->>'pecas_reprovadas')::numeric, 390);

  perform pg_temp.confere('fornecedores', jsonb_array_length(q->'fornecedores'), 3);
  perform pg_temp.confere_txt('forn 1', q->'fornecedores'->0->>'fornecedor', 'GAMA');
  perform pg_temp.confere('GAMA com_resultado', (q->'fornecedores'->0->>'com_resultado')::numeric, 3);
  perform pg_temp.confere('GAMA reprovados',    (q->'fornecedores'->0->>'reprovados')::numeric, 2);
  perform pg_temp.confere_txt('forn 2 (empate pelo nome)', q->'fornecedores'->1->>'fornecedor', 'ACME');
  perform pg_temp.confere('ACME com_resultado', (q->'fornecedores'->1->>'com_resultado')::numeric, 3);
  perform pg_temp.confere('ACME reprovados',    (q->'fornecedores'->1->>'reprovados')::numeric, 1);
  perform pg_temp.confere_txt('forn 3', q->'fornecedores'->2->>'fornecedor', 'BETA');
  perform pg_temp.confere('BETA com_resultado', (q->'fornecedores'->2->>'com_resultado')::numeric, 2);

  perform pg_temp.confere('materiais', jsonb_array_length(q->'materiais'), 3);
  perform pg_temp.confere_txt('mat 1', q->'materiais'->0->>'codigo', 'C1');
  perform pg_temp.confere_txt('mat 1 descrição (max)', q->'materiais'->0->>'descricao', 'Capacitor SMD');
  perform pg_temp.confere('C1 com_resultado', (q->'materiais'->0->>'com_resultado')::numeric, 3);
  perform pg_temp.confere('C1 reprovados',    (q->'materiais'->0->>'reprovados')::numeric, 2);
  perform pg_temp.confere_txt('mat 2', q->'materiais'->1->>'codigo', 'C4');
  perform pg_temp.confere_txt('mat 2 descrição', q->'materiais'->1->>'descricao', 'Diodo X');
  perform pg_temp.confere('C4 com_resultado', (q->'materiais'->1->>'com_resultado')::numeric, 2);
  perform pg_temp.confere_txt('mat 3 (código aparado e maiúsculo)', q->'materiais'->2->>'codigo', 'C5');
  perform pg_temp.confere_txt('mat 3 descrição', q->'materiais'->2->>'descricao', 'Fusível');

  perform pg_temp.confere('motivos', jsonb_array_length(q->'motivos'), 2);
  perform pg_temp.confere_txt('motivo 1', q->'motivos'->0->>'motivo', 'Fora de especificação');
  perform pg_temp.confere('motivo 1 itens', (q->'motivos'->0->>'itens')::numeric, 3);
  perform pg_temp.confere_txt('motivo 2', q->'motivos'->1->>'motivo', 'Dano no transporte');
  perform pg_temp.confere('motivo 2 itens', (q->'motivos'->1->>'itens')::numeric, 1);
  raise notice 'qualidade: ok';
end $t$;

-- ---------- 4. Atraso ----------
do $t$
declare
  a jsonb := pg_temp.w()->'atraso';
begin
  perform pg_temp.confere('com_prazo',  (a->'totais'->>'com_prazo')::numeric, 9);
  perform pg_temp.confere('atrasados',  (a->'totais'->>'atrasados')::numeric, 4);
  perform pg_temp.confere('média de atraso', (a->'totais'->>'media_dias_atraso')::numeric, 3.5);
  perform pg_temp.confere('fornecedores (só com atrasados)', jsonb_array_length(a->'fornecedores'), 2);
  perform pg_temp.confere_txt('forn 1', a->'fornecedores'->0->>'fornecedor', 'ACME');
  perform pg_temp.confere('ACME com_prazo', (a->'fornecedores'->0->>'com_prazo')::numeric, 4);
  perform pg_temp.confere('ACME atrasados', (a->'fornecedores'->0->>'atrasados')::numeric, 3);
  perform pg_temp.confere('ACME média',     (a->'fornecedores'->0->>'media_dias')::numeric, 3.7);
  perform pg_temp.confere_txt('forn 2', a->'fornecedores'->1->>'fornecedor', 'BETA');
  perform pg_temp.confere('BETA com_prazo', (a->'fornecedores'->1->>'com_prazo')::numeric, 2);
  perform pg_temp.confere('BETA atrasados', (a->'fornecedores'->1->>'atrasados')::numeric, 1);
  perform pg_temp.confere('BETA média',     (a->'fornecedores'->1->>'media_dias')::numeric, 3.0);
  raise notice 'atraso: ok';
end $t$;

-- ---------- 5. Tempo ----------
do $t$
declare
  t jsonb := pg_temp.w()->'tempo';
begin
  perform pg_temp.confere('recebimento n',       (t->'recebimento'->>'n')::numeric, 7);
  perform pg_temp.confere('recebimento média (206 vale 0, não -1)', (t->'recebimento'->>'media_dias')::numeric, 1.1);
  perform pg_temp.confere('recebimento mediana', (t->'recebimento'->>'mediana_dias')::numeric, 1.0);
  perform pg_temp.confere('qualidade n',         (t->'qualidade'->>'n')::numeric, 7);
  perform pg_temp.confere('qualidade média (1ª entrada, não a última)', (t->'qualidade'->>'media_dias')::numeric, 2.1);
  perform pg_temp.confere('qualidade mediana',   (t->'qualidade'->>'mediana_dias')::numeric, 3.0);
  perform pg_temp.confere('sem_tempo', (t->>'sem_tempo')::numeric, 1);
  perform pg_temp.confere('parados.dias', (t->'parados'->>'dias')::numeric, 7);
  raise notice 'tempo (durações): ok';
end $t$;

-- ---------- 6. Parados: o X muda; De/Até não ----------
do $t$
declare
  x int; i int := 0;
  esp_rec int[] := array[6,5,4,3];
  esp_qua int[] := array[4,3,2,1];
  v jsonb;
begin
  foreach x in array array[3,7,15,30] loop
    i := i + 1;
    v := rec_dashboard_metricas(p_parado_dias => x)->'tempo'->'parados';
    perform pg_temp.confere('parados.dias X=' || x, (v->>'dias')::numeric, x);
    perform pg_temp.confere('parados recebimento X=' || x, (v->>'recebimento')::numeric, esp_rec[i]);
    perform pg_temp.confere('parados qualidade X=' || x,   (v->>'qualidade')::numeric,   esp_qua[i]);
    -- Com uma janela que não pega nenhum desses itens, os parados não mudam (são estado atual).
    if pg_temp.w(p_x => x)->'tempo'->'parados' is distinct from v then
      raise exception 'FALHOU: De/Até mexeu nos parados (X=%)', x; end if;
    if rec_dashboard_metricas(null, null, null, null, '2020-01-01', '2020-01-31', x)->'tempo'->'parados' is distinct from v then
      raise exception 'FALHOU: janela vazia mexeu nos parados (X=%)', x; end if;
  end loop;
  -- Padrão = 7
  if rec_dashboard_metricas()->'tempo'->'parados' is distinct from
     rec_dashboard_metricas(p_parado_dias => 7)->'tempo'->'parados' then
    raise exception 'FALHOU: o padrão de X não é 7'; end if;
  raise notice 'parados: ok';
end $t$;

-- ---------- 7. Pendências ----------
do $t$
declare
  p jsonb := pg_temp.w()->'pendencias';
  p_sem jsonb := rec_dashboard_metricas()->'pendencias';
  p_jan jsonb := rec_dashboard_metricas(null, null, null, null, '2020-01-01', '2020-01-31')->'pendencias';
begin
  perform pg_temp.confere('total', (p->>'total')::numeric, 9);
  perform pg_temp.confere('no_prazo',     (p->'faixas'->>'no_prazo')::numeric, 2);
  perform pg_temp.confere('d1_7',         (p->'faixas'->>'d1_7')::numeric, 2);
  perform pg_temp.confere('d8_30',        (p->'faixas'->>'d8_30')::numeric, 2);
  perform pg_temp.confere('d30_mais',     (p->'faixas'->>'d30_mais')::numeric, 2);
  perform pg_temp.confere('sem_prevista', (p->'faixas'->>'sem_prevista')::numeric, 1);
  perform pg_temp.confere('fornecedores', jsonb_array_length(p->'fornecedores'), 4);
  perform pg_temp.confere_txt('forn 1', p->'fornecedores'->0->>'fornecedor', 'BETA');
  perform pg_temp.confere('BETA pendentes', (p->'fornecedores'->0->>'pendentes')::numeric, 3);
  perform pg_temp.confere('BETA atrasados', (p->'fornecedores'->0->>'atrasados')::numeric, 3);
  perform pg_temp.confere_txt('forn 2', p->'fornecedores'->1->>'fornecedor', 'ACME');
  perform pg_temp.confere('ACME pendentes', (p->'fornecedores'->1->>'pendentes')::numeric, 4);
  perform pg_temp.confere('ACME atrasados', (p->'fornecedores'->1->>'atrasados')::numeric, 2);
  perform pg_temp.confere_txt('forn 3 (em branco vem como vazio)', p->'fornecedores'->2->>'fornecedor', '');
  perform pg_temp.confere_txt('forn 4', p->'fornecedores'->3->>'fornecedor', 'GAMA');
  perform pg_temp.confere('GAMA atrasados', (p->'fornecedores'->3->>'atrasados')::numeric, 0);
  -- De/Até não valem para as pendências.
  if p is distinct from p_sem or p is distinct from p_jan then
    raise exception 'FALHOU: De/Até mexeram nas pendências'; end if;
  raise notice 'pendências: ok';
end $t$;

-- ---------- 8. De/Até valem para Volume, Qualidade, Atraso e Tempo (inclusivos) ----------
do $t$
declare
  -- 08/09 a 22/09: pega 202 (dia 08), 203, 209, 213, 212 e 204 (dia 22); deixa 201, 205, 206, 207 de fora.
  v jsonb := rec_dashboard_metricas(null, null, null, null, '2020-09-08', '2020-09-22');
  -- só setembro: deixa a 201 (31/08) de fora.
  s jsonb := rec_dashboard_metricas(null, null, null, null, '2020-09-01', '2020-09-30');
begin
  perform pg_temp.confere('janela: itens por semana somados',
    (select sum((e->>'itens')::int) from jsonb_array_elements(v->'volume'->'semanas') e), 6);
  perform pg_temp.confere_txt('janela: 1ª semana começa na segunda de 08/09', v->'volume'->'semanas'->0->>'inicio', '2020-09-07');
  perform pg_temp.confere('janela: com_resultado (202,203,204,212,213)', (v->'qualidade'->'totais'->>'com_resultado')::numeric, 5);
  perform pg_temp.confere('janela: com_prazo', (v->'atraso'->'totais'->>'com_prazo')::numeric, 6);
  perform pg_temp.confere('janela: tempo recebimento n (202,203,204,212)', (v->'tempo'->'recebimento'->>'n')::numeric, 4);
  perform pg_temp.confere('setembro: com_resultado', (s->'qualidade'->'totais'->>'com_resultado')::numeric, 8);
  perform pg_temp.confere('setembro: meses', jsonb_array_length(s->'volume'->'meses'), 1);
  perform pg_temp.confere('setembro: itens', (s->'volume'->'meses'->0->>'itens')::numeric, 9);
  -- Só De / só Até
  perform pg_temp.confere('só Até 31/08: itens (201 e a 211 de junho)',
    (select sum((e->>'itens')::int) from jsonb_array_elements(rec_dashboard_metricas(p_ate => '2020-08-31')->'volume'->'meses') e), 2);
  raise notice 'De/Até: ok';
end $t$;

-- ---------- 9. filtros de texto (valem para tudo) ----------
do $t$
begin
  perform pg_temp.confere('fornecedor ACME (com aparo e tab)',
    (select sum((e->>'itens')::int) from jsonb_array_elements(pg_temp.w(E' ACME\t')->'volume'->'meses') e), 4);
  perform pg_temp.confere('fornecedor ACME: com_resultado', (pg_temp.w('ACME')->'qualidade'->'totais'->>'com_resultado')::numeric, 3);
  perform pg_temp.confere('fornecedor BETA: pendências', (pg_temp.w('BETA')->'pendencias'->>'total')::numeric, 3);
  perform pg_temp.confere('fornecedor ZETA: parados recebimento (X=7)', (pg_temp.w('ZETA')->'tempo'->'parados'->>'recebimento')::numeric, 3);
  perform pg_temp.confere('comprador Pedro',
    (select sum((e->>'itens')::int) from jsonb_array_elements(pg_temp.w(null, 'Pedro')->'volume'->'meses') e), 3);
  perform pg_temp.confere('EMB emb-a1 (maiúsculas e aparo)',
    (select sum((e->>'itens')::int) from jsonb_array_elements(pg_temp.w(null, null, ' emb-a1')->'volume'->'meses') e), 3);
  perform pg_temp.confere('código c1',
    (select sum((e->>'itens')::int) from jsonb_array_elements(pg_temp.w(null, null, null, 'c1')->'volume'->'meses') e), 3);
  perform pg_temp.confere('código com filtro de material: pendências (nenhuma tem C1)', (pg_temp.w(null, null, null, 'c1')->'pendencias'->>'total')::numeric, 0);
  -- Texto vazio = sem filtro.
  if rec_dashboard_metricas('', '', '', '', null, null, 7) is distinct from rec_dashboard_metricas() then
    raise exception 'FALHOU: texto vazio tinha que valer como sem filtro'; end if;
  raise notice 'filtros de texto: ok';
end $t$;

-- ---------- 10. null onde não há base; séries contínuas ----------
do $t$
declare
  z jsonb := pg_temp.w('NAO EXISTE');
  n jsonb := rec_dashboard_metricas('NAO EXISTE');
begin
  if z->'atraso'->'totais'->'media_dias_atraso' <> 'null'::jsonb then raise exception 'FALHOU: média de atraso sem base tem que ser null'; end if;
  if z->'tempo'->'recebimento'->'media_dias' <> 'null'::jsonb then raise exception 'FALHOU: média de recebimento sem base tem que ser null'; end if;
  if z->'tempo'->'recebimento'->'mediana_dias' <> 'null'::jsonb then raise exception 'FALHOU: mediana de recebimento sem base tem que ser null'; end if;
  if z->'tempo'->'qualidade'->'media_dias' <> 'null'::jsonb then raise exception 'FALHOU: média de qualidade sem base tem que ser null'; end if;
  if z->'tempo'->'qualidade'->'mediana_dias' <> 'null'::jsonb then raise exception 'FALHOU: mediana de qualidade sem base tem que ser null'; end if;
  perform pg_temp.confere('sem base: com_resultado', (z->'qualidade'->'totais'->>'com_resultado')::numeric, 0);
  perform pg_temp.confere('sem base: peças', (z->'qualidade'->'totais'->>'pecas_recebidas')::numeric, 0);
  perform pg_temp.confere('sem base: pendências', (z->'pendencias'->>'total')::numeric, 0);
  perform pg_temp.confere('sem base: parados', (z->'tempo'->'parados'->>'recebimento')::numeric, 0);
  perform pg_temp.confere('sem base: janela mantém as semanas zeradas', jsonb_array_length(z->'volume'->'semanas'), 10);
  perform pg_temp.confere('sem base: janela mantém os meses zerados', jsonb_array_length(z->'volume'->'meses'), 2);
  perform pg_temp.confere('sem base: itens zero', (select sum((e->>'itens')::int) from jsonb_array_elements(z->'volume'->'semanas') e), 0);
  perform pg_temp.confere('sem base nem janela: semanas vazias', jsonb_array_length(n->'volume'->'semanas'), 0);
  perform pg_temp.confere('sem base nem janela: meses vazios', jsonb_array_length(n->'volume'->'meses'), 0);
  raise notice 'nulos e séries: ok';
end $t$;

-- ---------- 11. teto das séries ----------
do $t$
declare
  v jsonb := rec_dashboard_metricas(p_de => '1990-01-01', p_ate => '2020-09-30');
begin
  perform pg_temp.confere('teto de semanas', jsonb_array_length(v->'volume'->'semanas'), 520);
  perform pg_temp.confere_txt('teto: termina na última semana', v->'volume'->'semanas'->519->>'inicio', '2020-09-28');
  perform pg_temp.confere_txt('teto: começa 519 semanas antes', v->'volume'->'semanas'->0->>'inicio', to_char(date '2020-09-28' - 519 * 7, 'YYYY-MM-DD'));
  perform pg_temp.confere('teto de meses', jsonb_array_length(v->'volume'->'meses'), 120);
  perform pg_temp.confere_txt('teto: último mês', v->'volume'->'meses'->119->>'inicio', '2020-09-01');
  perform pg_temp.confere_txt('teto: primeiro mês (119 antes)', v->'volume'->'meses'->0->>'inicio', '2010-10-01');
  raise notice 'teto das séries: ok';
end $t$;

-- ---------- 12. rankings: top 10 (motivos top 5) e ordem determinística ----------
begin;
insert into public.processos_recebimento (id, status, fornecedor, codigo_material, data_chegada, quantidade_recebida, quantidade_reprovada, motivo_reprovacao, data_prevista)
select gen_random_uuid(), 'reprovado', 'F' || lpad(g::text, 2, '0'), 'K' || lpad(g::text, 2, '0'), date '2020-01-15', 1, 1, 'Motivo ' || g, date '2020-01-01'
  from generate_series(1, 12) g;
do $t$
declare
  v jsonb := rec_dashboard_metricas(null, null, null, null, '2020-01-01', '2020-01-31');
  a jsonb;
  b jsonb;
begin
  perform pg_temp.confere('top 10 fornecedores (qualidade)', jsonb_array_length(v->'qualidade'->'fornecedores'), 10);
  perform pg_temp.confere('top 10 materiais', jsonb_array_length(v->'qualidade'->'materiais'), 10);
  perform pg_temp.confere('top 5 motivos', jsonb_array_length(v->'qualidade'->'motivos'), 5);
  perform pg_temp.confere('top 10 fornecedores (atraso)', jsonb_array_length(v->'atraso'->'fornecedores'), 10);
  -- Empate total: o nome decide, e duas cargas iguais dão o mesmo texto.
  perform pg_temp.confere_txt('1º por nome', v->'qualidade'->'fornecedores'->0->>'fornecedor', 'F01');
  perform pg_temp.confere_txt('10º por nome', v->'qualidade'->'fornecedores'->9->>'fornecedor', 'F10');
  perform pg_temp.confere_txt('1º motivo por nome', v->'qualidade'->'motivos'->0->>'motivo', 'Motivo 1');
  a := rec_dashboard_metricas(null, null, null, null, '2020-01-01', '2020-01-31');
  if a::text is distinct from v::text then raise exception 'FALHOU: duas cargas iguais deram resultados diferentes'; end if;
  raise notice 'rankings: ok';
end $t$;
rollback;

-- Cancelado fica fora de tudo: a 210 (ACME, 10/09, cancelada) não pode aparecer em lugar nenhum.
do $t$
begin
  perform pg_temp.confere('cancelado fora do volume',
    (select sum((e->>'itens')::int) from jsonb_array_elements(pg_temp.w()->'volume'->'meses') e), 10);
  raise notice 'cancelado fora de tudo: ok';
end $t$;

select 'RECEBIMENTO METRICAS OK' as resultado;
