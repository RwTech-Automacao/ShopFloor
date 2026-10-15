-- Testes do dashboard do Recebimento e da justificativa aparada (migração 0152).
-- Roda no banco `dashboard` de supabase/tests/rodar-recebimento-test.sh, DEPOIS de:
--   recebimento_dashboard_esquema.sql → 0142 → 0143 → 0147 → recebimento_dashboard_massa.sql → 0152 → 0152
-- Tudo numa conexão só (as configurações `teste.*` alimentam os stubs de auth/RBAC).
--
-- Contas esperadas (ver a tabela da massa):
--   SEM filtro nenhum:  itens 11 (108 cancelado fora) · com divergência 8 (101,102,104,105,109,110,111,112)
--                       sem justificativa 6 (101,104,109,110,111,112) · positivas 5 · negativas 3 · EMBs 5
--   07/09 a 27/09:      itens 9 · com divergência 6 · sem justificativa 4 · positivas 3 · negativas 3
--                       EMBs 4 · fora do recorte por data 1 (a 110, sem data_chegada)
--                       semanas: 07/09 (1 just., 1 sem) · 14/09 (0, 0) · 21/09 (1 just., 3 sem)
--                       fornecedores: Panasonic 2/3 · Vishay 2/4 · '' 1/1 · ACME 1/1

-- Confere um número; a mensagem diz o que era esperado e o que veio.
create function pg_temp.confere(p_rotulo text, p_obtido bigint, p_esperado bigint) returns void
language plpgsql as $f$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % devia ser % e veio %', p_rotulo, p_esperado, coalesce(p_obtido::text, 'nulo');
  end if;
end $f$;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- ---------- 0. a porta: recebimento.visualizar, e só ela ----------
do $t$
begin
  perform set_config('teste.perms', '', false);
  begin
    perform rec_dashboard();
    raise exception 'FALHOU: rec_dashboard sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform rec_dashboard_opcoes();
    raise exception 'FALHOU: rec_dashboard_opcoes sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  -- Quem só tem ShopFloor (e quem só edita o Recebimento) não vê.
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.editar', false);
  begin
    perform rec_dashboard();
    raise exception 'FALHOU: permissão de outro módulo abriu rec_dashboard';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform rec_dashboard_opcoes();
    raise exception 'FALHOU: permissão de outro módulo abriu rec_dashboard_opcoes';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  raise notice 'porta do dashboard: ok';
end $t$;

do $t$
begin
  if has_function_privilege('anon', 'public.rec_dashboard(text, text, text, text, date, date, text)', 'execute') then
    raise exception 'FALHOU: anon executa rec_dashboard (faltou o revoke)'; end if;
  if has_function_privilege('anon', 'public.rec_dashboard_opcoes()', 'execute') then
    raise exception 'FALHOU: anon executa rec_dashboard_opcoes (faltou o revoke)'; end if;
  if not has_function_privilege('authenticated', 'public.rec_dashboard(text, text, text, text, date, date, text)', 'execute') then
    raise exception 'FALHOU: authenticated não executa rec_dashboard'; end if;
  if not has_function_privilege('authenticated', 'public.rec_dashboard_opcoes()', 'execute') then
    raise exception 'FALHOU: authenticated não executa rec_dashboard_opcoes'; end if;
  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('rec_dashboard', 'rec_dashboard_opcoes', 'rec_justificar_divergencia')
         and prosecdef) <> 3 then
    raise exception 'FALHOU: as três funções têm que ser security definer'; end if;
  raise notice 'grants e security definer: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 1. totais sem filtro nenhum ----------
do $t$
declare v jsonb := rec_dashboard();
begin
  perform pg_temp.confere('itens (sem filtro)',             (v->'totais'->>'itens')::bigint, 11);
  perform pg_temp.confere('com divergência (sem filtro)',   (v->'totais'->>'com_divergencia')::bigint, 8);
  perform pg_temp.confere('sem justificativa (sem filtro)', (v->'totais'->>'sem_justificativa')::bigint, 6);
  perform pg_temp.confere('positivas (sem filtro)',         (v->'totais'->>'positivas')::bigint, 5);
  perform pg_temp.confere('negativas (sem filtro)',         (v->'totais'->>'negativas')::bigint, 3);
  perform pg_temp.confere('EMBs (sem filtro)',              (v->'totais'->>'embs')::bigint, 5);
  -- Sem recorte de data ninguém "fica de fora do período".
  perform pg_temp.confere('fora do recorte (sem data)',     (v->'totais'->>'fora_do_recorte_por_data')::bigint, 0);
  -- Texto vazio = sem filtro: tem que dar exatamente o mesmo resultado.
  if rec_dashboard('', '', '', '', null, null, '') is distinct from v then
    raise exception 'FALHOU: texto vazio tinha que valer como sem filtro'; end if;
  raise notice 'totais sem filtro: ok';
end $t$;

-- ---------- 2. totais no recorte 07/09 a 27/09 ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('itens (recorte)',             (v->'totais'->>'itens')::bigint, 9);
  perform pg_temp.confere('com divergência (recorte)',   (v->'totais'->>'com_divergencia')::bigint, 6);
  perform pg_temp.confere('sem justificativa (recorte)', (v->'totais'->>'sem_justificativa')::bigint, 4);
  perform pg_temp.confere('positivas (recorte)',         (v->'totais'->>'positivas')::bigint, 3);
  perform pg_temp.confere('negativas (recorte)',         (v->'totais'->>'negativas')::bigint, 3);
  perform pg_temp.confere('EMBs (recorte)',              (v->'totais'->>'embs')::bigint, 4);
  -- A 110 (Acme) não tem data_chegada: fica fora do recorte e o rodapé conta. A 108 (cancelada)
  -- não conta nem aqui.
  perform pg_temp.confere('fora do recorte por data',    (v->'totais'->>'fora_do_recorte_por_data')::bigint, 1);
  raise notice 'totais no recorte: ok';
end $t$;

-- ---------- 3. os números batem com a CONDIÇÃO da grade de Processos ----------
-- Até a branch feat/recebimento-filtros-divergencia chegar à main, a comparação é contra a
-- condição (divergencia_num <> 0 / > 0 / < 0, e status <> 'cancelado'), não contra a tela.
do $t$
declare
  v_tudo jsonb := rec_dashboard();
  v_rec  jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('com divergência × grade (sem filtro)', (v_tudo->'totais'->>'com_divergencia')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num <> 0 and status <> 'cancelado'));
  perform pg_temp.confere('positivas × grade (sem filtro)', (v_tudo->'totais'->>'positivas')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num > 0 and status <> 'cancelado'));
  perform pg_temp.confere('negativas × grade (sem filtro)', (v_tudo->'totais'->>'negativas')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num < 0 and status <> 'cancelado'));
  perform pg_temp.confere('com divergência × grade (recorte)', (v_rec->'totais'->>'com_divergencia')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num <> 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  perform pg_temp.confere('positivas × grade (recorte)', (v_rec->'totais'->>'positivas')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num > 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  perform pg_temp.confere('negativas × grade (recorte)', (v_rec->'totais'->>'negativas')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num < 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  -- positivas + negativas fecha com "com divergência": nenhuma divergente sem sinal.
  perform pg_temp.confere('positivas + negativas = com divergência',
    (v_rec->'totais'->>'positivas')::bigint + (v_rec->'totais'->>'negativas')::bigint,
    (v_rec->'totais'->>'com_divergencia')::bigint);
  raise notice 'números batem com a condição da grade: ok';
end $t$;

-- ---------- 4. a série semanal ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('quantidade de semanas', jsonb_array_length(v->'semanas'), 3);
  if v->'semanas'->0->>'inicio' <> '2026-09-07' or v->'semanas'->1->>'inicio' <> '2026-09-14'
     or v->'semanas'->2->>'inicio' <> '2026-09-21' then
    raise exception 'FALHOU: as semanas começam na segunda e seguem em ordem (veio %)', v->'semanas'; end if;
  -- A semana 14/09 não tem nada: tem que ESTAR na série, com zero (o eixo não pula semana).
  perform pg_temp.confere('semana vazia, justificadas', (v->'semanas'->1->>'justificadas')::bigint, 0);
  perform pg_temp.confere('semana vazia, sem justificativa', (v->'semanas'->1->>'sem_justificativa')::bigint, 0);
  perform pg_temp.confere('semana 07/09, justificadas', (v->'semanas'->0->>'justificadas')::bigint, 1);
  perform pg_temp.confere('semana 07/09, sem justificativa', (v->'semanas'->0->>'sem_justificativa')::bigint, 1);
  perform pg_temp.confere('semana 21/09, justificadas', (v->'semanas'->2->>'justificadas')::bigint, 1);
  -- 104 (só espaços, normalizada pela 0152), 109 e 111.
  perform pg_temp.confere('semana 21/09, sem justificativa', (v->'semanas'->2->>'sem_justificativa')::bigint, 3);

  -- Só "De": a série vai até a última chegada do recorte — uma semana só.
  v := rec_dashboard(p_de => '2026-09-21');
  perform pg_temp.confere('semanas a partir de 21/09', jsonb_array_length(v->'semanas'), 1);
  perform pg_temp.confere('itens a partir de 21/09', (v->'totais'->>'itens')::bigint, 6);
  perform pg_temp.confere('fora do recorte, só De', (v->'totais'->>'fora_do_recorte_por_data')::bigint, 1);

  -- De > Até: recorte vazio, série vazia, sem erro.
  v := rec_dashboard(p_de => '2026-09-27', p_ate => '2026-09-07');
  perform pg_temp.confere('itens com De > Até', (v->'totais'->>'itens')::bigint, 0);
  if v->'semanas' <> '[]'::jsonb then raise exception 'FALHOU: De > Até tinha que dar série vazia'; end if;

  -- De = Até: inclusivo nas duas pontas.
  v := rec_dashboard(p_de => '2026-09-08', p_ate => '2026-09-08');
  perform pg_temp.confere('itens no dia 08/09', (v->'totais'->>'itens')::bigint, 1);
  raise notice 'série semanal: ok';
end $t$;

-- ---------- 5. ranking de fornecedores ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('fornecedores no ranking', jsonb_array_length(v->'fornecedores'), 4);
  if v->'fornecedores' <> '[
      {"fornecedor": "Panasonic", "divergentes": 2, "itens": 3},
      {"fornecedor": "Vishay",    "divergentes": 2, "itens": 4},
      {"fornecedor": "",          "divergentes": 1, "itens": 1},
      {"fornecedor": "ACME",      "divergentes": 1, "itens": 1}
    ]'::jsonb then
    raise exception 'FALHOU: ranking de fornecedores (veio %)', v->'fornecedores'; end if;
  raise notice 'ranking de fornecedores: ok';
end $t$;

-- ---------- 6. os filtros ----------
do $t$
declare
  v_rec date := '2026-09-07';
  v_ate date := '2026-09-27';
begin
  perform pg_temp.confere('fornecedor Vishay', (rec_dashboard('Vishay', '', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  perform pg_temp.confere('fornecedor Vishay aparado', (rec_dashboard('  Vishay ', '', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  -- "ACME" e "Acme" são dois fornecedores: comparação exata.
  perform pg_temp.confere('fornecedor ACME', (rec_dashboard(p_fornecedor => 'ACME')->'totais'->>'itens')::bigint, 1);
  perform pg_temp.confere('fornecedor Acme', (rec_dashboard(p_fornecedor => 'Acme')->'totais'->>'itens')::bigint, 1);
  perform pg_temp.confere('fornecedor acme', (rec_dashboard(p_fornecedor => 'acme')->'totais'->>'itens')::bigint, 0);
  perform pg_temp.confere('comprador Pedro', (rec_dashboard('', 'Pedro', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 5);
  -- EMB e código: exatos, sem diferenciar maiúsculas.
  perform pg_temp.confere('EMB emb2', (rec_dashboard('', '', ' emb2 ', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  perform pg_temp.confere('EMB emb', (rec_dashboard('', '', 'emb', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 0);
  perform pg_temp.confere('código cap1', (rec_dashboard(p_codigo => 'cap1')->'totais'->>'itens')::bigint, 1);
  -- Filtros combinados.
  perform pg_temp.confere('Panasonic + EMB1 + recorte',
    (rec_dashboard('Panasonic', 'Joana', 'EMB1', '', v_rec, v_ate)->'totais'->>'com_divergencia')::bigint, 2);
  -- Recorte vazio: tudo zero, listas vazias.
  if rec_dashboard(p_fornecedor => 'Ninguém') <> jsonb_build_object(
       'totais', jsonb_build_object('itens', 0, 'com_divergencia', 0, 'sem_justificativa', 0,
                                    'positivas', 0, 'negativas', 0, 'embs', 0, 'fora_do_recorte_por_data', 0),
       'fornecedores', '[]'::jsonb, 'semanas', '[]'::jsonb) then
    raise exception 'FALHOU: recorte vazio (veio %)', rec_dashboard(p_fornecedor => 'Ninguém'); end if;
  raise notice 'filtros: ok';
end $t$;

-- ---------- 7. o filtro de sinal (clique em positivas / negativas) ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27', p_sinal => 'positiva');
begin
  perform pg_temp.confere('com divergência (só positivas)', (v->'totais'->>'com_divergencia')::bigint, 3);
  perform pg_temp.confere('sem justificativa (só positivas)', (v->'totais'->>'sem_justificativa')::bigint, 2);
  perform pg_temp.confere('itens não muda com o sinal', (v->'totais'->>'itens')::bigint, 9);
  -- Os dois contadores continuam visíveis, para dar para trocar de sinal.
  perform pg_temp.confere('positivas (só positivas)', (v->'totais'->>'positivas')::bigint, 3);
  perform pg_temp.confere('negativas (só positivas)', (v->'totais'->>'negativas')::bigint, 3);
  if v->'fornecedores' <> '[
      {"fornecedor": "",          "divergentes": 1, "itens": 1},
      {"fornecedor": "Panasonic", "divergentes": 1, "itens": 3},
      {"fornecedor": "Vishay",    "divergentes": 1, "itens": 4}
    ]'::jsonb then
    raise exception 'FALHOU: ranking só de positivas (veio %)', v->'fornecedores'; end if;
  perform pg_temp.confere('semana 21/09 só positivas, sem justificativa', (v->'semanas'->2->>'sem_justificativa')::bigint, 2);

  v := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27', p_sinal => 'negativa');
  perform pg_temp.confere('com divergência (só negativas)', (v->'totais'->>'com_divergencia')::bigint, 3);
  perform pg_temp.confere('sem justificativa (só negativas)', (v->'totais'->>'sem_justificativa')::bigint, 2);

  begin
    perform rec_dashboard(p_sinal => 'zero');
    raise exception 'FALHOU: sinal inválido tinha que levantar SINAL_INVALIDO';
  exception when others then
    if sqlerrm <> 'SINAL_INVALIDO' then raise; end if;
  end;
  raise notice 'filtro de sinal: ok';
end $t$;

-- ---------- 8. as opções das listas suspensas ----------
do $t$
declare v jsonb := rec_dashboard_opcoes();
begin
  -- Ordem conferida com collate "C" dos dois lados: o contêiner de teste não tem a collation do
  -- banco real, e o que importa aqui é o CONJUNTO (sem vazio, sem repetido).
  if (select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(v->'fornecedores') x)
       <> '["ACME", "Acme", "Panasonic", "Vishay"]'::jsonb then
    raise exception 'FALHOU: opções de fornecedor (veio %)', v->'fornecedores'; end if;
  if (select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(v->'compradores') x)
       <> '["Joana", "Pedro"]'::jsonb then
    raise exception 'FALHOU: opções de comprador (veio %)', v->'compradores'; end if;
  raise notice 'opções das listas: ok';
end $t$;

-- ---------- 9. a justificativa aparada (0152 §6.1) ----------
-- 9.1 A normalização: a 104 nasceu com '   ' e agora é ''; a 105 tem texto de verdade (com espaço
-- em volta) e NÃO é tocada; a 102 também não.
do $t$
begin
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000104') <> '' then
    raise exception 'FALHOU: a justificativa só de espaços tinha que virar vazia'; end if;
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000105') <> '  alinhado  ' then
    raise exception 'FALHOU: a normalização mexeu numa justificativa de verdade'; end if;
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000102') <> 'Fornecedor mandou a mais' then
    raise exception 'FALHOU: a normalização mexeu numa justificativa de verdade (102)'; end if;
  raise notice 'normalização das justificativas só de espaços: ok';
end $t$;

-- 9.2 A função grava aparado.
insert into public.usuarios (id, nome, email) values ('00000000-0000-0000-0000-000000000001', 'Maria Souza', 'maria@enterplak.com.br');
do $t$
declare v_texto text;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', '   ');
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto <> '' then
    raise exception 'FALHOU: só espaços pela função tinha que gravar vazio (veio "%")', v_texto; end if;

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', '  faltou, chega semana que vem  ');
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto <> 'faltou, chega semana que vem' then
    raise exception 'FALHOU: o texto tinha que ser gravado aparado (veio "%")', v_texto; end if;

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', null);
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto is distinct from '' then
    raise exception 'FALHOU: p_texto nulo tinha que gravar vazio (veio %)', coalesce(v_texto, 'NULL'); end if;

  -- A porta continua sendo administrar: visualizar não grava.
  perform set_config('teste.perms', 'recebimento.visualizar,recebimento.editar', false);
  begin
    perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', 'tentativa');
    raise exception 'FALHOU: sem administrar tinha que levantar SEM_PERMISSAO';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.rec_justificar_divergencia(uuid, text)', 'execute') then
    raise exception 'FALHOU: anon executa rec_justificar_divergencia (faltou o revoke)'; end if;
  if not has_function_privilege('authenticated', 'public.rec_justificar_divergencia(uuid, text)', 'execute') then
    raise exception 'FALHOU: authenticated perdeu o execute de rec_justificar_divergencia'; end if;
  raise notice 'justificativa aparada pela função: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 10. top 10 (por último: a massa extra mudaria os totais acima) ----------
-- 12 fornecedores F01..F12 do comprador 'Lote'; o Fk tem k itens divergentes.
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia)
select 'F' || lpad(k::text, 2, '0'), 'Lote', 'EMBLOTE', 'L' || k || '-' || i, '2026-01-05', '1'
  from generate_series(1, 12) k, generate_series(1, k) i
 where i <= k;
do $t$
declare v jsonb := rec_dashboard(p_comprador => 'Lote');
begin
  perform pg_temp.confere('fornecedores no top', jsonb_array_length(v->'fornecedores'), 10);
  if v->'fornecedores'->0->>'fornecedor' <> 'F12' or (v->'fornecedores'->0->>'divergentes')::int <> 12 then
    raise exception 'FALHOU: o primeiro do top tem que ser F12 com 12 (veio %)', v->'fornecedores'->0; end if;
  if v->'fornecedores'->9->>'fornecedor' <> 'F03' then
    raise exception 'FALHOU: o décimo do top tem que ser F03 (veio %)', v->'fornecedores'->9; end if;
  raise notice 'top 10: ok';
end $t$;

-- ---------- 11. o domingo fecha a semana da segunda anterior ----------
-- A massa não tem linha de domingo: trocar isodow por dow (domingo = 0) passaria na segunda e na
-- quarta e erraria só aqui. 27/09/2026 é domingo -> a semana começa em 21/09 (e a segunda 28/09
-- começa a seguinte, sem ser engolida).
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia)
values ('DomTeste', 'DomComprador', 'EMBDOM', 'DOM1', '2026-09-27', '1'),
       ('DomTeste', 'DomComprador', 'EMBDOM', 'DOM2', '2026-09-28', '1');
do $t$
declare v jsonb := rec_dashboard(p_comprador => 'DomComprador');
begin
  perform pg_temp.confere('semanas do domingo (quantidade)', jsonb_array_length(v->'semanas'), 2);
  if v->'semanas'->0->>'inicio' <> '2026-09-21' then
    raise exception 'FALHOU: domingo 27/09 tem que cair na semana de 21/09 (veio %)', v->'semanas'->0->>'inicio'; end if;
  if v->'semanas'->1->>'inicio' <> '2026-09-28' then
    raise exception 'FALHOU: segunda 28/09 abre a semana seguinte (veio %)', v->'semanas'->1->>'inicio'; end if;
  perform pg_temp.confere('domingo conta na semana de 21/09', (v->'semanas'->0->>'sem_justificativa')::bigint, 1);
  perform pg_temp.confere('segunda conta na semana de 28/09', (v->'semanas'->1->>'sem_justificativa')::bigint, 1);
  -- O recorte que TERMINA no domingo também tem que terminar a série na semana dele.
  v := rec_dashboard(p_comprador => 'DomComprador', p_de => '2026-09-27', p_ate => '2026-09-27');
  perform pg_temp.confere('recorte de um domingo: uma semana', jsonb_array_length(v->'semanas'), 1);
  if v->'semanas'->0->>'inicio' <> '2026-09-21' then
    raise exception 'FALHOU: recorte só de domingo (veio %)', v->'semanas'; end if;
  raise notice 'domingo na semana certa: ok';
end $t$;

-- ---------- 12. desempate do ranking, com empate na FRONTEIRA do top 10 ----------
-- Comprador 'Empate': G01..G07 com 20..14 divergentes (7 claros) e SEIS empatados em 3 (Uniform,
-- Victor, Whisky, Xray, Yankee, Zulu) disputando as 3 vagas que sobram. A ordem é
-- divergentes desc, fornecedor: ficam Uniform, Victor e Whisky; Xray, Yankee e Zulu são cortados.
-- Os empatados entram em ordem alfabética DECRESCENTE (Zulu primeiro): sem o desempate pelo nome,
-- a ordem física não conserta o resultado.
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia)
select t.f, 'Empate', 'EMBEMP', 'E-' || t.f || '-' || i, '2026-01-05', '1'
  from (values ('Zulu'), ('Yankee'), ('Xray'), ('Whisky'), ('Victor'), ('Uniform')) t(f), generate_series(1, 3) i;
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia)
select 'G' || lpad(k::text, 2, '0'), 'Empate', 'EMBEMP', 'EG' || k || '-' || i, '2026-01-05', '1'
  from generate_series(1, 7) k, generate_series(1, 21 - k) i;
do $t$
declare
  v jsonb := rec_dashboard(p_comprador => 'Empate');
begin
  perform pg_temp.confere('top 10 com empate: tamanho', jsonb_array_length(v->'fornecedores'), 10);
  if (select jsonb_agg(e->>'fornecedor' order by ord) from jsonb_array_elements(v->'fornecedores') with ordinality x(e, ord) where ord > 7)
       <> '["Uniform", "Victor", "Whisky"]'::jsonb then
    raise exception 'FALHOU: as 3 vagas do empate são de Uniform, Victor e Whisky, nessa ordem (veio %)', v->'fornecedores'; end if;
  if exists (select 1 from jsonb_array_elements(v->'fornecedores') e where e->>'fornecedor' in ('Xray', 'Yankee', 'Zulu')) then
    raise exception 'FALHOU: Xray, Yankee e Zulu empatam e têm que ser cortados (veio %)', v->'fornecedores'; end if;
  -- A ordem não varia entre duas cargas iguais.
  if rec_dashboard(p_comprador => 'Empate')->'fornecedores' <> v->'fornecedores' then
    raise exception 'FALHOU: ordem do ranking mudou entre duas chamadas'; end if;
  raise notice 'desempate do ranking: ok';
end $t$;

-- ---------- 13. janela de datas com recorte VAZIO ----------
-- Decisão: a série é o EIXO DA JANELA pedida, não do que existe. Fornecedor que não existe + De/Até
-- => zero itens, mas as semanas da janela aparecem zeradas (a tela mostra o eixo e a frase de vazio).
-- `semanas` só vem vazio quando NÃO há data nenhuma (nem De, nem Até, nem linha com data).
do $t$
declare v jsonb := rec_dashboard(p_fornecedor => 'Ninguém', p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('janela com recorte vazio: itens', (v->'totais'->>'itens')::bigint, 0);
  perform pg_temp.confere('janela com recorte vazio: semanas da janela', jsonb_array_length(v->'semanas'), 3);
  if exists (select 1 from jsonb_array_elements(v->'semanas') s
              where (s->>'justificadas')::int <> 0 or (s->>'sem_justificativa')::int <> 0) then
    raise exception 'FALHOU: semanas do recorte vazio têm que vir zeradas (veio %)', v->'semanas'; end if;
  if v->'fornecedores' <> '[]'::jsonb then raise exception 'FALHOU: ranking do recorte vazio'; end if;
  -- Só um lado da janela e nada no recorte: a série é a do lado que existe (uma semana).
  v := rec_dashboard(p_fornecedor => 'Ninguém', p_de => '2026-09-07');
  perform pg_temp.confere('só De, recorte vazio: uma semana', jsonb_array_length(v->'semanas'), 1);
  raise notice 'janela com recorte vazio: ok';
end $t$;

-- ---------- 14. btrim NÃO tira tabulação nem quebra de linha (limite conhecido) ----------
-- O app apara com trim() do JavaScript (tira tab e quebra de linha); o btrim do SQL tira só
-- espaço. Uma justificativa só de E'\t' continua "justificada" no SQL e a tela a trataria como
-- vazia. É CONHECIDO: o texto passa pelo app antes de gravar (trim), então só uma escrita direta
-- no banco produz isso — o que a contagem pré-Prod das notas de deploy mede. Este teste DOCUMENTA
-- o comportamento; se alguém trocar o btrim por regex, ele avisa que o contrato mudou.
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia, divergencia_justificativa)
values ('TabTeste', 'TabComprador', 'EMBTAB', 'TAB1', '2026-01-05', '1', E'\t'),
       ('TabTeste', 'TabComprador', 'EMBTAB', 'TAB2', '2026-01-05', '1', E'\n'),
       ('TabTeste', 'TabComprador', 'EMBTAB', 'TAB3', '2026-01-05', '1', '   ');
do $t$
declare v jsonb := rec_dashboard(p_comprador => 'TabComprador');
begin
  perform pg_temp.confere('tab e quebra de linha: com divergência', (v->'totais'->>'com_divergencia')::bigint, 3);
  -- Só os espaços viram "sem justificativa"; o \t e o \n ficam "justificados" (limite do btrim).
  perform pg_temp.confere('tab e quebra de linha ficam justificados no SQL', (v->'totais'->>'sem_justificativa')::bigint, 1);
  raise notice 'limite do btrim documentado: ok';
end $t$;

select 'RECEBIMENTO DASHBOARD OK' as resultado;
