-- Testes SQL da 0139 (janela por blocos de turno: janela_tipo = 'intervalos'). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_explicacao_test.sql, na mesma base,
-- com a 0139 aplicada por cima da 0113/0114/0115/0122/0123/0136/0137 — igual à produção, onde já
-- existem regras, ocorrências e fila.
--
-- Reaproveita os helpers criados pelos arquivos anteriores: teste_regra e teste_regra_recusada
-- (alertas_tipos_test.sql), teste_bipes (alertas_test.sql), teste_fila e teste_contas_ana_bruno
-- (alertas_tipos_test.sql).
--
-- ⚠️ COMPARAÇÃO DE jsonb É `is distinct from`, NUNCA `<>` (cabeçalho do teste da 0137): chave
-- ausente faz `dados->'x'` virar NULL, `NULL <> y` é NULL e o `if` NÃO dispara — a mutação que
-- apaga a chave passaria batida. Aqui isso vale para as chaves novas 'bloco_inicio'/'bloco_fim'.
--
-- ⚠️ OS BLOCOS DESTE ARQUIVO SÃO INSTANTES FIXOS DE 2026-03-10, e não `now() - interval`. É de
-- propósito, por dois motivos: (1) o ramo 'intervalos' do alerta_taxas não tem now() nenhum — quem
-- calcula o bloco é o app (domain/intervalos.ts) —, então o teste também não deve ter; (2) bipe de
-- março fica FORA das janelas 'tempo' (minutos) e 'bipes' (30 dias), e é isso que deixa o teste de
-- vazamento (T15) ser honesto: se o ramo novo perdesse a guarda `p_janela_tipo = 'intervalos'`, os
-- bipes do bloco entrariam na conta das OUTRAS janelas e o número mudaria.
--
-- O mapa dos testes:
--   T1  esquema: a coluna bloco_reportado, a tabela filha dos intervalos, RLS e grants dela;
--   T2  checks da regra: 'intervalos' só na aprovação e com passo >= 15;
--   T3  assinaturas e grants: a de 4 parâmetros do alerta_taxas sumiu, a de 6 está fechada;
--   T4  ⚠️ a fronteira do bloco é `>=` no início e `<` no fim (o bipe da virada é de UM bloco só);
--   T5  o filtro de PMO vale no ramo novo (com btrim);
--   T6  bloco não recebido conta zero; e as outras janelas IGNORAM os dois instantes;
--   T7  a carência da reabertura nesta janela é a fixa de 60 min;
--   T8  o fluxo: abertura → mesmo bloco (nada) → ⚠️ bloco VAZIO (não mexe no bloco_reportado) →
--       bloco ruim seguinte (lembrete) → bloco bom (normalizou), com 'bloco_inicio'/'bloco_fim'
--       no `dados` de todos eles;
--   T9  a 4ª via que envia: REABERTURA (e a resolvida dentro da carência, que NÃO envia, não grava);
--   T10 ocorrência legada (bloco_reportado nulo) avisa no primeiro bloco avaliado;
--   T11 regra de janela 'intervalos' ausente do p_blocos é PULADA (não abre, não normaliza, não
--       encosta no bloco_reportado);
--   T12 faixa pela metade (só 'inicio' ou só 'fim') também é pulada;
--   T13 o filtro de PMO ponta a ponta na janela nova;
--   T14 ⚠️ as outras três janelas ('tempo', 'bipes', 'op') não mudaram: o lembrete continua saindo
--       pelos MINUTOS decorridos, e o bloco_reportado delas fica nulo;
--   T15 ⚠️ vazamento: regra de janela 'tempo' COM bloco no mapa não conta os bipes do bloco.
-- (A idempotência da 0139 — aplicada duas vezes — é do runner, por construção.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Preparação: as regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Helper: bipes de um posto num INSTANTE dado (os aprovados a partir de +1 s, os reprovados a
-- partir de +31 s). Serve para encher um bloco; generate_series(1, 0) não devolve linha nenhuma,
-- então "0 aprovados" simplesmente não insere.
create function public.teste_bipes_em(
  p_posto text, p_pmo text, p_op text, p_aprovados int, p_reprovados int, p_instante timestamptz
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select p_instante + make_interval(secs => g), p_posto, p_pmo, p_op, 'Aprovado'
    from generate_series(1, p_aprovados) g;
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select p_instante + make_interval(secs => 30 + g), p_posto, p_pmo, p_op, 'REPROVADO'
    from generate_series(1, p_reprovados) g;
$f$;

-- Helper: o p_blocos do alerta_avaliar para UMA regra, pelo nome — {"<regra_id>": {"inicio", "fim"}}.
-- A chave é o uuid em texto, a forma canônica que o app manda, e os instantes vão como o jsonb
-- rende um timestamptz (ISO 8601), igual ao toISOString do TS.
create function public.teste_bloco(p_regra text, p_inicio timestamptz, p_fim timestamptz)
returns jsonb language sql as $f$
  select jsonb_build_object(rg.id::text, jsonb_build_object('inicio', p_inicio, 'fim', p_fim))
    from public.alerta_regras rg where rg.nome = p_regra
$f$;

-- Helper: a ocorrência viva (ou normalizada) de uma regra, pelo nome.
create function public.teste_ocorrencia(p_regra text) returns public.alerta_ocorrencias
language sql as $f$
  select oc.* from public.alerta_ocorrencias oc
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra
   order by oc.aberta_em desc
   limit 1
$f$;

-- ---------------------------------------------------------------------------------------------
-- T1. ESQUEMA: a coluna do bloco avisado, a tabela filha dos intervalos, RLS e grants.
do $t$
declare
  rid uuid;
  n   int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'alerta_ocorrencias' and column_name = 'bloco_reportado'
                    and data_type = 'timestamp with time zone') then
    raise exception 'FALHOU: alerta_ocorrencias.bloco_reportado não existe como timestamptz';
  end if;
  -- Ocorrências antigas (dos testes anteriores) têm de ficar com o valor nulo.
  if exists (select 1 from public.alerta_ocorrencias where bloco_reportado is not null) then
    raise exception 'FALHOU: ocorrência antiga nasceu com bloco_reportado preenchido';
  end if;

  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'alerta_regra_intervalos') then
    raise exception 'FALHOU: a tabela alerta_regra_intervalos não existe';
  end if;
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'alerta_regra_intervalos'
                    and rowsecurity) then
    raise exception 'FALHOU: alerta_regra_intervalos sem row level security';
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'alerta_regra_intervalos';
  if n <> 4 then
    raise exception 'FALHOU: alerta_regra_intervalos tem % policies (esperava 4: select/insert/update/delete)', n;
  end if;
  if not exists (select 1 from pg_indexes
                  where indexname = 'alerta_regra_intervalos_regra_idx') then
    raise exception 'FALHOU: índice alerta_regra_intervalos_regra_idx não existe';
  end if;

  -- GRANTS: a tabela guarda o turno do cliente e não é pública. `anon` é a chave que qualquer um lê
  -- no HTML; só `authenticated` (com o gate da policy) e o service_role entram.
  if has_table_privilege('anon', 'public.alerta_regra_intervalos', 'SELECT') then
    raise exception 'FALHOU: alerta_regra_intervalos está aberta para o anon';
  end if;
  if not has_table_privilege('authenticated', 'public.alerta_regra_intervalos', 'SELECT')
     or not has_table_privilege('authenticated', 'public.alerta_regra_intervalos', 'INSERT')
     or not has_table_privilege('authenticated', 'public.alerta_regra_intervalos', 'UPDATE')
     -- DELETE existe de propósito (ao contrário da tabela mãe): o gestor troca um intervalo do turno.
     or not has_table_privilege('authenticated', 'public.alerta_regra_intervalos', 'DELETE') then
    raise exception 'FALHOU: authenticated sem um dos grants de alerta_regra_intervalos';
  end if;

  -- Os checks da tabela: fim depois do início e pelo menos 15 min de intervalo.
  rid := public.teste_regra('IV esquema', 'aprovacao', array['IV-Esquema'], 90, 'intervalos', 60, 2,
                            null, null, null, '{}', null, false);
  insert into public.alerta_regra_intervalos (regra_id, inicio, fim)
  values (rid, '07:00', '12:00'), (rid, '13:30', '17:30');
  begin
    insert into public.alerta_regra_intervalos (regra_id, inicio, fim) values (rid, '12:00', '11:00');
    raise exception 'FALHOU: aceitou intervalo com fim antes do início';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regra_intervalos (regra_id, inicio, fim) values (rid, '07:00', '07:14');
    raise exception 'FALHOU: aceitou intervalo menor que o passo mínimo de 15 min';
  exception when check_violation then null;
  end;
  insert into public.alerta_regra_intervalos (regra_id, inicio, fim) values (rid, '19:00', '19:15');

  -- CASCATA: os intervalos são filhos da regra.
  delete from public.alerta_regras where id = rid;
  select count(*) into n from public.alerta_regra_intervalos where regra_id = rid;
  if n <> 0 then
    raise exception 'FALHOU: sobraram % intervalos depois de apagar a regra', n;
  end if;
end $t$;

-- T1b. A policy na prática: sem shopfloor.administrar, o authenticated não vê nenhum intervalo.
do $t$
declare rid uuid;
begin
  rid := public.teste_regra('IV rls', 'aprovacao', array['IV-Rls'], 90, 'intervalos', 60, 2,
                            null, null, null, '{}', null, false);
  insert into public.alerta_regra_intervalos (regra_id, inicio, fim) values (rid, '07:00', '12:00');
end $t$;

set role authenticated;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  if exists (select 1 from public.alerta_regra_intervalos) then
    raise exception 'FALHOU: quem só visualiza o ShopFloor está lendo os intervalos do turno';
  end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
do $t$
begin
  if not exists (select 1 from public.alerta_regra_intervalos) then
    raise exception 'FALHOU: quem administra o ShopFloor não está lendo os intervalos do turno';
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T2. CHECKS DA REGRA: a janela nova é aceita, e só onde faz sentido.
do $t$
begin
  -- Válida: aprovação, passo de 60 min (e o passo mínimo de 15 exato também passa).
  perform public.teste_regra('IV valida 60', 'aprovacao', array['X'], 90, 'intervalos', 60, 2,
                             null, null, null, '{}', null, false);
  perform public.teste_regra('IV valida 15', 'aprovacao', array['X'], 90, 'intervalos', 15, 2,
                             null, null, null, '{}', null, false);
  -- Recusadas: passo abaixo de 15, e a janela por blocos nos outros dois tipos de regra.
  perform public.teste_regra_recusada('blocos com passo 14',  'aprovacao', 90,   'intervalos', 14, 2,    null, null, null);
  perform public.teste_regra_recusada('blocos com passo 0',   'aprovacao', 90,   'intervalos', 0,  2,    null, null, null);
  perform public.teste_regra_recusada('blocos no tipo tempo', 'tempo',     null, 'intervalos', 60, 10,   120,  null, 30);
  perform public.teste_regra_recusada('blocos no tipo defeito','defeito',  null, 'intervalos', 60, null, null, 3,    null);
  -- E o check continua FECHADO: nome parecido não entra (o `in (...)` não virou texto livre).
  perform public.teste_regra_recusada('janela intervalo (singular)', 'aprovacao', 90, 'intervalo', 60, 2, null, null, null);
  perform public.teste_regra_recusada('janela desconhecida',         'aprovacao', 90, 'xyz',       60, 2, null, null, null);
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T3. ASSINATURAS E GRANTS. Os dois `drop function` da 0139 são o que impede a assinatura velha de
--     conviver com a nova (chamada curta ambígua, ou — pior — caindo na velha, que não conhece
--     bloco nenhum). É o mesmo cuidado que alertas_tipos_test.sql cobra do alerta_previa.
do $t$
declare
  c text;
begin
  if (select count(*) from pg_proc
       where proname = 'alerta_taxas' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALHOU: a assinatura antiga do alerta_taxas (4 parâmetros) continua lá';
  end if;
  if not exists (select 1 from pg_proc
                  where proname = 'alerta_taxas' and pronamespace = 'public'::regnamespace
                    and pronargs = 6) then
    raise exception 'FALHOU: alerta_taxas nova (6 parâmetros) não existe';
  end if;
  if (select count(*) from pg_proc
       where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALHOU: a assinatura antiga do alerta_avaliar (1 parâmetro) continua lá';
  end if;
  if not exists (select 1 from pg_proc
                  where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace
                    and pronargs = 2) then
    raise exception 'FALHOU: alerta_avaliar nova (2 parâmetros) não existe';
  end if;

  -- A assinatura NOVA é outra função para o Postgres e nasce com EXECUTE para o PUBLIC: é o
  -- `revoke` da 0139 que fecha. Sem ele, `anon` conta os bipes de qualquer posto por uma security
  -- definer (o furo que a 0119 existiu para fechar).
  if has_function_privilege('anon',
       'public.alerta_taxas(text[],text,int,text[],timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.alerta_taxas(text[],text,int,text[],timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role',
       'public.alerta_taxas(text[],text,int,text[],timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FALHOU: alerta_taxas de 6 parâmetros está aberta';
  end if;
  if has_function_privilege('anon', 'public.alerta_avaliar(text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.alerta_avaliar(text,jsonb)', 'EXECUTE') then
    raise exception 'FALHOU: alerta_avaliar está aberta para anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.alerta_avaliar(text,jsonb)', 'EXECUTE') then
    raise exception 'FALHOU: o service_role (o cron) perdeu o alerta_avaliar';
  end if;

  -- O aviso da janela duplicada MORRE COM O DROP (comentário é de assinatura, não de nome). A 0139
  -- o repõe na assinatura nova, com o parágrafo da janela 'intervalos' não existir no alerta_ops.
  c := obj_description(
         'public.alerta_taxas(text[],text,int,text[],timestamptz,timestamptz)'::regprocedure, 'pg_proc');
  if coalesce(c, '') not like '%alerta_ops%' then
    raise exception 'FALHOU: o comentário do alerta_taxas perdeu o aviso da janela duplicada (%)', c;
  end if;
  if coalesce(c, '') not like '%intervalos%' then
    raise exception 'FALHOU: o comentário do alerta_taxas não avisa da janela nova (%)', c;
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T4. ⚠️ A FRONTEIRA DO BLOCO: `>=` no início e `<` no fim. O bipe do instante EXATO da virada
--     pertence a UM bloco só. Com `<=` no fim ele entraria nos dois e as duas taxas sairiam
--     erradas — e a errada é justamente a que dispara (ou não) o alerta.
insert into public.sf_registros (data_hora, posto, pmo, op, status) values
  ('2026-03-10 07:59:59+00', 'IV-Fronteira', 'PMOI', '1', 'Reprovado'),
  ('2026-03-10 08:00:00+00', 'IV-Fronteira', 'PMOI', '1', 'Aprovado'),
  ('2026-03-10 08:00:01+00', 'IV-Fronteira', 'PMOI', '1', 'Aprovado'),
  ('2026-03-10 08:59:59+00', 'IV-Fronteira', 'PMOI', '1', 'Aprovado'),
  ('2026-03-10 09:00:00+00', 'IV-Fronteira', 'PMOI', '1', 'Aprovado');

do $t$
declare
  r record;
begin
  -- Bloco 07:00–08:00: só o bipe das 07:59:59. O das 08:00:00 é do bloco SEGUINTE.
  select * into r from public.alerta_taxas(array['IV-Fronteira'], 'intervalos', 60, '{}',
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 0 or r.reprovados <> 1 then
    raise exception 'FALHOU: bloco 07–08 contou % aprovados e % reprovados (esperava 0 e 1; o bipe das 08:00:00 não é deste bloco)',
                    r.aprovados, r.reprovados;
  end if;
  -- Bloco 08:00–09:00: o das 08:00:00 (fronteira de baixo), o das 08:00:01 e o das 08:59:59.
  -- O das 09:00:00 fica para o bloco seguinte.
  select * into r from public.alerta_taxas(array['IV-Fronteira'], 'intervalos', 60, '{}',
                                           '2026-03-10 08:00:00+00', '2026-03-10 09:00:00+00');
  if r.aprovados <> 3 or r.reprovados <> 0 then
    raise exception 'FALHOU: bloco 08–09 contou % aprovados e % reprovados (esperava 3 e 0; o início é >= e o fim é <)',
                    r.aprovados, r.reprovados;
  end if;
  -- Bloco 09:00–10:00: o bipe da virada aparece AQUI, e uma vez só.
  select * into r from public.alerta_taxas(array['IV-Fronteira'], 'intervalos', 60, '{}',
                                           '2026-03-10 09:00:00+00', '2026-03-10 10:00:00+00');
  if r.aprovados <> 1 or r.reprovados <> 0 then
    raise exception 'FALHOU: bloco 09–10 contou % aprovados e % reprovados (esperava 1 e 0)',
                    r.aprovados, r.reprovados;
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T5. O FILTRO DE PMO VALE NO RAMO NOVO (ele não estava no trecho original da spec). Sem ele, uma
--     regra com PMO escolhida contaria os bipes de OUTRA PMO — número errado, em silêncio. PMO
--     aparada dos dois lados, como nos outros três ramos (' PMOA ' e 'PMOA' são a mesma ordem).
select public.teste_bipes_em('IV-Pmo', 'PMOA',   '1', 1, 1, '2026-03-10 07:05:00+00');
select public.teste_bipes_em('IV-Pmo', ' PMOA ', '1', 1, 0, '2026-03-10 07:20:00+00');
select public.teste_bipes_em('IV-Pmo', 'PMOB',   '2', 0, 3, '2026-03-10 07:35:00+00');

do $t$
declare
  r record;
begin
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'intervalos', 60, array['PMOA'],
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 2 or r.reprovados <> 1 then
    raise exception 'FALHOU: com PMOA o bloco contou % e % (esperava 2 e 1; os 3 reprovados da PMOB entraram?)',
                    r.aprovados, r.reprovados;
  end if;
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'intervalos', 60, '{}',
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 2 or r.reprovados <> 4 then
    raise exception 'FALHOU: sem filtro de PMO o bloco contou % e % (esperava 2 e 4)',
                    r.aprovados, r.reprovados;
  end if;
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'intervalos', 60, array['PMOZ'],
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 0 or r.reprovados <> 0 then
    raise exception 'FALHOU: PMO que não existe no posto contou % e %', r.aprovados, r.reprovados;
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T6. Bloco NÃO recebido conta zero (`>= null` e `< null` são nulos), e — o que importa de verdade
--     — as OUTRAS janelas ignoram os dois instantes. Sem a guarda `p_janela_tipo = 'intervalos'` no
--     ramo novo, os bipes do bloco entrariam no `union all` de todas as janelas.
do $t$
declare
  r record;
begin
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'intervalos', 60, '{}', null, null);
  if r.aprovados <> 0 or r.reprovados <> 0 then
    raise exception 'FALHOU: sem bloco a janela nova contou % e %', r.aprovados, r.reprovados;
  end if;
  -- Faixa pela metade: também zero (cinto e suspensório — quem PULA a regra é o alerta_avaliar).
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'intervalos', 60, '{}',
                                           '2026-03-10 07:00:00+00', null);
  if r.aprovados <> 0 or r.reprovados <> 0 then
    raise exception 'FALHOU: faixa só com início contou % e %', r.aprovados, r.reprovados;
  end if;
  -- Os bipes do IV-Pmo são de março: fora da janela 'tempo' de 60 min e da de 30 dias do 'bipes'.
  -- Passar o bloco de março junto NÃO pode trazê-los de volta.
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'tempo', 60, '{}',
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 0 or r.reprovados <> 0 then
    raise exception 'FALHOU: a janela ''tempo'' contou os bipes do bloco (% e %)',
                    r.aprovados, r.reprovados;
  end if;
  select * into r from public.alerta_taxas(array['IV-Pmo'], 'bipes', 50, '{}',
                                           '2026-03-10 07:00:00+00', '2026-03-10 08:00:00+00');
  if r.aprovados <> 0 or r.reprovados <> 0 then
    raise exception 'FALHOU: a janela ''bipes'' contou os bipes do bloco (% e %)',
                    r.aprovados, r.reprovados;
  end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T7. A carência da reabertura (0122) nesta janela: cai no fixo de 60 min e NÃO lê o passo — se
--     devolvesse nulo, a comparação da reabertura ficaria nula para sempre e a 4ª via que envia
--     (T9) nunca aconteceria.
do $t$
begin
  if alerta_carencia_min('intervalos', 60) <> 60 then
    raise exception 'FALHOU: carência da janela por blocos = %', alerta_carencia_min('intervalos', 60);
  end if;
  if alerta_carencia_min('intervalos', 15)   <> 60 then raise exception 'FALHOU: a carência leu o passo (15)'; end if;
  if alerta_carencia_min('intervalos', 1440) <> 60 then raise exception 'FALHOU: a carência leu o passo (1440)'; end if;
  if alerta_carencia_min('intervalos', null) <> 60 then raise exception 'FALHOU: carência com passo nulo'; end if;
end $t$;

-- ---------------------------------------------------------------------------------------------
-- T8. O FLUXO INTEIRO, bloco a bloco, num posto só. Quatro blocos de 60 min:
--       B1 07:00–08:00  2 reprovados  -> ABRE (taxa 0% < 90%)
--       B2 08:00–09:00  NENHUM bipe   -> nada, e ⚠️ não encosta no bloco_reportado
--       B3 09:00–10:00  2 reprovados  -> LEMBRETE (é o bloco mais novo que o avisado)
--       B4 10:00–11:00  2 aprovados   -> NORMALIZOU
--     A regra vai SEM lembrete_min de propósito: nesta janela quem manda é o bloco.
do $t$
begin
  perform public.teste_regra('IV fluxo', 'aprovacao', array['IV-Fluxo'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-Fluxo', 'PMOI', '1', 0, 2, '2026-03-10 07:10:00+00');
select public.teste_bipes_em('IV-Fluxo', 'PMOI', '1', 0, 2, '2026-03-10 09:10:00+00');
select public.teste_bipes_em('IV-Fluxo', 'PMOI', '1', 2, 0, '2026-03-10 10:10:00+00');

-- B1: abre. CAMINHO QUE ENVIA 1/4 (abertura) -> grava bloco_reportado, e o `dados` leva a faixa.
set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 07:00:00+00',
                                                       '2026-03-10 08:00:00+00'));
  a := teste_fila('IV fluxo', 'IV-Fluxo');
  if a is null or a->>'tipo' <> 'alerta' then
    raise exception 'FALHOU: o bloco B1 não abriu a ocorrência %', a;
  end if;
  if a->>'janela_tipo' <> 'intervalos' or (a->>'janela_valor')::int <> 60 then
    raise exception 'FALHOU: a janela no dados = %', a;
  end if;
  -- As duas chaves novas: existência SEPARADA do valor (chave apagada deixaria o `->>` nulo e a
  -- comparação de valor passaria batida).
  if not (a ? 'bloco_inicio') or not (a ? 'bloco_fim') then
    raise exception 'FALHOU: o dados do alerta não leva bloco_inicio/bloco_fim (%)', a;
  end if;
  if (a->>'bloco_inicio')::timestamptz is distinct from '2026-03-10 07:00:00+00'::timestamptz
     or (a->>'bloco_fim')::timestamptz is distinct from '2026-03-10 08:00:00+00'::timestamptz then
    raise exception 'FALHOU: a faixa do bloco no dados = % / %', a->>'bloco_inicio', a->>'bloco_fim';
  end if;
  if (a->>'taxa')::numeric <> 0 or (a->>'aprovados')::int <> 0 or (a->>'reprovados')::int <> 2 then
    raise exception 'FALHOU: os números do bloco B1 no dados = %', a;
  end if;
  -- LIMITE CONHECIDO (relatório da Task 6, preocupação 3): o alerta_ops não tem o ramo 'intervalos',
  -- então a mensagem desta janela sai sem a ordem. Se alguém acrescentar o ramo lá, é aqui que o
  -- teste avisa que o texto mudou — não é defeito, é contrato de hoje.
  if a->'ops' is distinct from '[]'::jsonb then
    raise exception 'FALHOU: dados.ops da janela por blocos = % (hoje o alerta_ops não tem o ramo)', a->'ops';
  end if;

  o := teste_ocorrencia('IV fluxo');
  if o.estado <> 'aberta' then raise exception 'FALHOU: estado da ocorrência = %', o.estado; end if;
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: a abertura não gravou o bloco avisado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- B1 DE NOVO: é o que o cron de 5 em 5 minutos faz o dia inteiro. Um aviso por bloco — a segunda
-- avaliação do MESMO bloco não enfileira nada.
set role service_role;
do $t$
declare
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 07:00:00+00',
                                                       '2026-03-10 08:00:00+00'));
  if teste_fila('IV fluxo', 'IV-Fluxo') is not null then
    raise exception 'FALHOU: o MESMO bloco avisou duas vezes (o cron de 5 min viraria spam)';
  end if;
  o := teste_ocorrencia('IV fluxo');
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: a reavaliação do mesmo bloco mexeu no bloco_reportado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- ⚠️ B2 (08:00–09:00) NÃO TEM BIPE NENHUM: fica abaixo do mínimo, cai no `continue` e NÃO decide
-- nada. Se ele gravasse o bloco_reportado, o bloco B3 não pareceria mais novo que o avisado e o
-- alerta dele DESAPARECERIA EM SILÊNCIO. É o defeito mais fácil de introduzir nesta migração.
set role service_role;
do $t$
declare
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 08:00:00+00',
                                                       '2026-03-10 09:00:00+00'));
  if teste_fila('IV fluxo', 'IV-Fluxo') is not null then
    raise exception 'FALHOU: bloco sem bipe nenhum avisou';
  end if;
  o := teste_ocorrencia('IV fluxo');
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: o bloco SEM BIPE mexeu no bloco_reportado (% em vez de 07:00) — o alerta do bloco seguinte desapareceria em silêncio',
                    o.bloco_reportado;
  end if;
  -- O `continue` vem ANTES de qualquer escrita: a foto da taxa também fica a do B1.
  if o.estado <> 'aberta' or o.amostras <> 2 or o.reprovados <> 2 then
    raise exception 'FALHOU: o bloco sem bipe escreveu na ocorrência (estado %, amostras %, reprovados %)',
                    o.estado, o.amostras, o.reprovados;
  end if;
end $t$;
reset role;

-- B3: bloco mais novo e a taxa continua ruim. CAMINHO QUE ENVIA 3/4 (insistência) -> 'lembrete',
-- pregado no fechamento do bloco, e grava o bloco avisado. É o pagamento do teste do B2.
set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 09:00:00+00',
                                                       '2026-03-10 10:00:00+00'));
  a := teste_fila('IV fluxo', 'IV-Fluxo');
  if a is null or a->>'tipo' <> 'lembrete' then
    raise exception 'FALHOU: o bloco B3 (mais novo, ainda ruim) não insistiu %', a;
  end if;
  if (a->>'bloco_inicio')::timestamptz is distinct from '2026-03-10 09:00:00+00'::timestamptz
     or (a->>'bloco_fim')::timestamptz is distinct from '2026-03-10 10:00:00+00'::timestamptz then
    raise exception 'FALHOU: a faixa do lembrete = % / %', a->>'bloco_inicio', a->>'bloco_fim';
  end if;
  if (a->>'n')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: destinos do lembrete do bloco %', a;
  end if;
  o := teste_ocorrencia('IV fluxo');
  if o.bloco_reportado is distinct from '2026-03-10 09:00:00+00'::timestamptz then
    raise exception 'FALHOU: a insistência não gravou o bloco avisado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- B4: a taxa volta ao normal. CAMINHO QUE ENVIA 2/4 (normalização) -> grava o bloco avisado.
set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 10:00:00+00',
                                                       '2026-03-10 11:00:00+00'));
  a := teste_fila('IV fluxo', 'IV-Fluxo');
  if a is null or a->>'tipo' <> 'normalizou' then
    raise exception 'FALHOU: o bloco B4 (2 aprovados) não normalizou %', a;
  end if;
  if (a->>'bloco_inicio')::timestamptz is distinct from '2026-03-10 10:00:00+00'::timestamptz then
    raise exception 'FALHOU: a faixa da normalização = %', a->>'bloco_inicio';
  end if;
  if (a->>'taxa')::numeric <> 100 then
    raise exception 'FALHOU: a taxa do bloco B4 = %', a->>'taxa';
  end if;
  o := teste_ocorrencia('IV fluxo');
  if o.estado <> 'normalizada' then
    raise exception 'FALHOU: a ocorrência não encerrou (%)', o.estado;
  end if;
  if o.bloco_reportado is distinct from '2026-03-10 10:00:00+00'::timestamptz then
    raise exception 'FALHOU: a normalização não gravou o bloco avisado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T9. A 4ª VIA QUE ENVIA: a REABERTURA (0122), que o plano original esqueceu. E, no caminho, o
--     caso que NÃO envia e por isso NÃO pode gravar: resolvida dentro da carência.
do $t$
begin
  perform public.teste_regra('IV reab', 'aprovacao', array['IV-Reab'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-Reab', 'PMOI', '1', 0, 2, '2026-03-10 07:10:00+00');
select public.teste_bipes_em('IV-Reab', 'PMOI', '1', 0, 2, '2026-03-10 08:10:00+00');
select public.teste_bipes_em('IV-Reab', 'PMOI', '1', 0, 2, '2026-03-10 09:10:00+00');

set role service_role;
do $t$
begin
  perform alerta_avaliar(null, teste_bloco('IV reab', '2026-03-10 07:00:00+00',
                                                      '2026-03-10 08:00:00+00'));
  if teste_fila('IV reab', 'IV-Reab') is null then
    raise exception 'FALHOU: a ocorrência do IV-Reab não abriu';
  end if;
end $t$;
reset role;

-- O gestor aperta "Resolvido" (pela tela).
set role authenticated;
do $t$
declare r jsonb;
begin
  select alerta_resolver_admin(oc.id) into r
    from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'IV reab' and oc.estado = 'aberta';
  if r is null or (r->>'ja_resolvida')::boolean then raise exception 'FALHOU: resolver %', r; end if;
end $t$;
reset role;

-- Bloco NOVO, problema continua, mas ainda estamos DENTRO da carência (resolvida agora mesmo):
-- nenhum envio — e, por isso, NENHUMA gravação do bloco avisado. É o caso que mata a mutação de
-- gravar o bloco_reportado fora dos quatro caminhos que enviam.
set role service_role;
do $t$
declare
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV reab', '2026-03-10 08:00:00+00',
                                                      '2026-03-10 09:00:00+00'));
  if teste_fila('IV reab', 'IV-Reab') is not null then
    raise exception 'FALHOU: reabriu (ou insistiu) dentro da carência';
  end if;
  o := teste_ocorrencia('IV reab');
  if o.estado <> 'resolvida' then
    raise exception 'FALHOU: dentro da carência a ocorrência devia continuar resolvida (%)', o.estado;
  end if;
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: um bloco que NÃO enviou gravou o bloco_reportado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- A carência de 60 min vence e chega o bloco seguinte, ainda ruim: REABRE.
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '61 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'IV reab' and oc.estado = 'resolvida';

set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV reab', '2026-03-10 09:00:00+00',
                                                      '2026-03-10 10:00:00+00'));
  a := teste_fila('IV reab', 'IV-Reab');
  if a is null or a->>'tipo' <> 'alerta' then
    raise exception 'FALHOU: a reabertura na janela por blocos não saiu %', a;
  end if;
  if (a->>'reabertura')::boolean is not true then
    raise exception 'FALHOU: o alerta da reabertura sem a marca %', a;
  end if;
  if (a->>'bloco_inicio')::timestamptz is distinct from '2026-03-10 09:00:00+00'::timestamptz then
    raise exception 'FALHOU: a faixa da reabertura = %', a->>'bloco_inicio';
  end if;
  o := teste_ocorrencia('IV reab');
  if o.estado <> 'aberta' or o.reaberturas <> 1 then
    raise exception 'FALHOU: estado % / reaberturas % depois da reabertura', o.estado, o.reaberturas;
  end if;
  if o.bloco_reportado is distinct from '2026-03-10 09:00:00+00'::timestamptz then
    raise exception 'FALHOU: a REABERTURA não gravou o bloco avisado (%) — é a 4ª via que envia',
                    o.bloco_reportado;
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T10. Ocorrência LEGADA: aberta antes da 0139 (ou por uma rodada em que a regra era de outra
--      janela) tem bloco_reportado nulo. O primeiro bloco avaliado avisa, mesmo não sendo "mais
--      novo" que nada.
do $t$
begin
  perform public.teste_regra('IV legado', 'aprovacao', array['IV-Legado'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-Legado', 'PMOI', '1', 0, 2, '2026-03-10 07:10:00+00');

set role service_role;
do $t$
begin
  perform alerta_avaliar(null, teste_bloco('IV legado', '2026-03-10 07:00:00+00',
                                                        '2026-03-10 08:00:00+00'));
  if teste_fila('IV legado', 'IV-Legado') is null then
    raise exception 'FALHOU: a ocorrência do IV-Legado não abriu';
  end if;
end $t$;
reset role;

-- A ocorrência "envelhece": o valor volta a nulo, como numa linha de antes da migração.
update public.alerta_ocorrencias oc
   set bloco_reportado = null
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'IV legado';

set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV legado', '2026-03-10 07:00:00+00',
                                                        '2026-03-10 08:00:00+00'));
  a := teste_fila('IV legado', 'IV-Legado');
  if a is null or a->>'tipo' <> 'lembrete' then
    raise exception 'FALHOU: ocorrência com bloco_reportado nulo não avisou no primeiro bloco %', a;
  end if;
  o := teste_ocorrencia('IV legado');
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: o aviso da ocorrência legada não gravou o bloco (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T11. Regra de janela 'intervalos' AUSENTE do p_blocos é PULADA: nenhum bloco fechou (fora do
--      turno, antes do primeiro bloco do dia) ou o app não a viu. Pulada = não decide NADA.
do $t$
begin
  perform public.teste_regra('IV pulada', 'aprovacao', array['IV-Pulada'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-Pulada', 'PMOI', '1', 0, 2, '2026-03-10 07:10:00+00');

-- (a) p_blocos nulo: é o cron rodando fora do turno. A ocorrência não nasce.
set role service_role;
do $t$
begin
  perform alerta_avaliar();
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'IV pulada') then
    raise exception 'FALHOU: regra de blocos sem bloco no mapa abriu ocorrência (p_blocos nulo)';
  end if;
end $t$;
reset role;

-- (a2) "Pulada" quer dizer que a linha NÃO ENTRA NO LAÇO, e é o contador `avaliadas` do retorno
--      que mostra isso (a tela diz "N regras avaliadas"). Sem o `where` da 0139, a regra entraria,
--      mediria uma faixa nula, contaria zero bipes e cairia no `continue` do mínimo — o resultado
--      visível seria o mesmo, mas ela apareceria como avaliada e teria custado duas consultas.
--      Aqui: com NENHUMA regra de blocos no mapa, o contador é X; pondo UMA (a do IV fluxo, cuja
--      ocorrência já está normalizada e cuja taxa está boa — entra na conta e não decide nada), o
--      contador sobe exatamente 1.
set role service_role;
do $t$
declare
  r0 jsonb;
  r1 jsonb;
begin
  r0 := alerta_avaliar();
  r1 := alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 10:00:00+00',
                                                     '2026-03-10 11:00:00+00'));
  if (r0->>'ocupado')::boolean or (r1->>'ocupado')::boolean then
    raise exception 'FALHOU: a trava recusou uma das avaliações (% / %)', r0, r1;
  end if;
  if (r1->>'avaliadas')::int - (r0->>'avaliadas')::int <> 1 then
    raise exception 'FALHOU: avaliadas foi de % para % (esperava +1: regra de blocos sem bloco no mapa não entra no laço)',
                    r0->>'avaliadas', r1->>'avaliadas';
  end if;
end $t$;
reset role;

-- (b) p_blocos com a chave de OUTRA regra: continua pulada (a chave é o uuid da regra).
set role service_role;
do $t$
begin
  perform alerta_avaliar(null, teste_bloco('IV fluxo', '2026-03-10 07:00:00+00',
                                                       '2026-03-10 08:00:00+00'));
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'IV pulada') then
    raise exception 'FALHOU: regra de blocos abriu com o bloco de OUTRA regra no mapa';
  end if;
end $t$;
reset role;

-- (c) O setup estava ruim de propósito: com o bloco dela, abre. (Senão a prova de (a) e (b) seria
--     "não abriu porque não havia nada para abrir".)
set role service_role;
do $t$
begin
  perform alerta_avaliar(null, teste_bloco('IV pulada', '2026-03-10 07:00:00+00',
                                                        '2026-03-10 08:00:00+00'));
  if teste_fila('IV pulada', 'IV-Pulada') is null then
    raise exception 'FALHOU: com o bloco no mapa a regra devia abrir';
  end if;
end $t$;
reset role;

-- (d) Com a ocorrência ABERTA e a taxa já boa, uma rodada sem o bloco dela não normaliza nem
--     encosta no bloco_reportado — "pulada" vale para os dois lados.
select public.teste_bipes_em('IV-Pulada', 'PMOI', '1', 9, 0, '2026-03-10 08:10:00+00');
set role service_role;
do $t$
declare
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar();
  if teste_fila('IV pulada', 'IV-Pulada') is not null then
    raise exception 'FALHOU: regra pulada enfileirou algo';
  end if;
  o := teste_ocorrencia('IV pulada');
  if o.estado <> 'aberta' then
    raise exception 'FALHOU: regra pulada normalizou a ocorrência (%)', o.estado;
  end if;
  if o.bloco_reportado is distinct from '2026-03-10 07:00:00+00'::timestamptz then
    raise exception 'FALHOU: regra pulada mexeu no bloco_reportado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T12. Faixa pela METADE (defeito de quem monta o mapa): pula a regra em vez de medir uma faixa
--      aberta. Os DOIS instantes são exigidos.
do $t$
begin
  perform public.teste_regra('IV metade', 'aprovacao', array['IV-Metade'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-Metade', 'PMOI', '1', 0, 2, '2026-03-10 07:10:00+00');

set role service_role;
do $t$
declare
  rid uuid;
  r   jsonb;
begin
  select id into rid from alerta_regras where nome = 'IV metade';
  -- só 'inicio'. As três avaliações são da MESMA transação; a trava advisory é reentrante para
  -- quem já a tem, mas o `ocupado` é conferido para a prova não ser "não abriu porque nem rodou".
  r := alerta_avaliar(null, jsonb_build_object(
         rid::text, jsonb_build_object('inicio', '2026-03-10 07:00:00+00'::timestamptz)));
  if (r->>'ocupado')::boolean then raise exception 'FALHOU: a avaliação nem rodou (%)', r; end if;
  if exists (select 1 from alerta_ocorrencias where regra_id = rid) then
    raise exception 'FALHOU: faixa só com ''inicio'' abriu ocorrência';
  end if;
  -- só 'fim'
  r := alerta_avaliar(null, jsonb_build_object(
         rid::text, jsonb_build_object('fim', '2026-03-10 08:00:00+00'::timestamptz)));
  if (r->>'ocupado')::boolean then raise exception 'FALHOU: a avaliação nem rodou (%)', r; end if;
  if exists (select 1 from alerta_ocorrencias where regra_id = rid) then
    raise exception 'FALHOU: faixa só com ''fim'' abriu ocorrência';
  end if;
  -- mapa vazio para a regra
  r := alerta_avaliar(null, jsonb_build_object(rid::text, '{}'::jsonb));
  if (r->>'ocupado')::boolean then raise exception 'FALHOU: a avaliação nem rodou (%)', r; end if;
  if exists (select 1 from alerta_ocorrencias where regra_id = rid) then
    raise exception 'FALHOU: faixa vazia abriu ocorrência';
  end if;
end $t$;
reset role;

-- E com a faixa inteira abre (o setup era bom).
set role service_role;
do $t$
begin
  perform alerta_avaliar(null, teste_bloco('IV metade', '2026-03-10 07:00:00+00',
                                                        '2026-03-10 08:00:00+00'));
  if teste_fila('IV metade', 'IV-Metade') is null then
    raise exception 'FALHOU: com os dois instantes a regra devia abrir';
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T13. O FILTRO DE PMO PONTA A PONTA na janela nova. Duas regras no MESMO posto e no MESMO bloco:
--      a da PMOA vê 2 aprovados (100%, não abre); a sem filtro vê também os 5 reprovados da PMOB
--      (28,57%, abre). O par é a prova: sem o filtro no ramo novo as duas abririam.
do $t$
begin
  perform public.teste_regra('IV pmo A',     'aprovacao', array['IV-PmoE2E'], 90, 'intervalos', 60, 2,
                             null, null, null, array['PMOA']);
  perform public.teste_regra('IV pmo todas', 'aprovacao', array['IV-PmoE2E'], 90, 'intervalos', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes_em('IV-PmoE2E', 'PMOA', '1', 2, 0, '2026-03-10 07:05:00+00');
select public.teste_bipes_em('IV-PmoE2E', 'PMOB', '2', 0, 5, '2026-03-10 07:35:00+00');

set role service_role;
do $t$
declare
  a jsonb;
begin
  perform alerta_avaliar(null, teste_bloco('IV pmo A', '2026-03-10 07:00:00+00',
                                                       '2026-03-10 08:00:00+00')
                               || teste_bloco('IV pmo todas', '2026-03-10 07:00:00+00',
                                                              '2026-03-10 08:00:00+00'));
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'IV pmo A') then
    raise exception 'FALHOU: a regra com PMOA abriu — contou os reprovados da PMOB no bloco';
  end if;
  a := teste_fila('IV pmo todas', 'IV-PmoE2E');
  if a is null or a->>'tipo' <> 'alerta' then
    raise exception 'FALHOU: a regra sem filtro de PMO devia abrir no mesmo bloco %', a;
  end if;
  if (a->>'aprovados')::int <> 2 or (a->>'reprovados')::int <> 5 then
    raise exception 'FALHOU: os números da regra sem filtro = %', a;
  end if;
end $t$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- T14. ⚠️ AS OUTRAS TRÊS JANELAS NÃO MUDARAM DE COMPORTAMENTO. A prova honesta: um caso de cada,
--      COM lembrete_min, mostrando que a insistência continua saindo pelos MINUTOS decorridos (e
--      não pelo bloco) — e que o bloco_reportado delas fica nulo.
--
-- Roda como postgres (superusuário), não como service_role: as três avaliações precisam acontecer
-- na MESMA transação (é assim que a contagem da fila distingue uma rodada da outra), e inserir em
-- sf_registros é coisa de quem tem grant de insert.
create function public.teste_lembrete_por_minutos(
  p_regra text, p_posto text, p_janela_tipo text, p_janela_valor int
) returns void language plpgsql as $f$
declare
  n0 int;
  d  jsonb;
  o  public.alerta_ocorrencias;
begin
  perform public.teste_regra(p_regra, 'aprovacao', array[p_posto], 90, p_janela_tipo, p_janela_valor,
                             2, null, null, null, '{}', 10);
  -- 2 reprovados há 5 min: taxa 0% nas três janelas (a 'op' precisa de bipe nas últimas 2 h).
  perform public.teste_bipes(p_posto, 'PMOJ', '1', 0, 2, 5);

  -- 1. abre
  perform public.alerta_avaliar();
  select count(*) into n0 from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and e.tipo = 'alerta';
  if n0 = 0 then
    raise exception 'FALHOU: a janela % não abriu', p_janela_tipo;
  end if;
  o := public.teste_ocorrencia(p_regra);
  if o.bloco_reportado is not null then
    raise exception 'FALHOU: a janela % gravou bloco_reportado (%)', p_janela_tipo, o.bloco_reportado;
  end if;

  -- 2. logo depois: o lembrete de 10 min NÃO saiu (nem com p_blocos nulo, nem por bloco algum)
  perform public.alerta_avaliar();
  select count(*) into n0 from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and e.tipo = 'lembrete';
  if n0 <> 0 then
    raise exception 'FALHOU: a janela % insistiu antes dos 10 min do lembrete_min', p_janela_tipo;
  end if;

  -- 3. passados 11 min do último envio, o lembrete sai — pelos MINUTOS, como antes da 0139
  update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '11 minutes'
   where id = o.id;
  perform public.alerta_avaliar();
  select count(*) into n0 from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and e.tipo = 'lembrete';
  if n0 = 0 then
    raise exception 'FALHOU: a janela % não insistiu depois dos 11 min (o lembrete_min parou de valer)',
                    p_janela_tipo;
  end if;

  -- As chaves novas existem em todo envio, nulas fora da janela por blocos (quem lê o `dados`
  -- trata chave nula; apagar a chave é o que quebraria o app).
  select e.dados into d from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = p_regra and e.tipo = 'lembrete' limit 1;
  if not (d ? 'bloco_inicio') or not (d ? 'bloco_fim') then
    raise exception 'FALHOU: o dados da janela % perdeu as chaves do bloco (%)', p_janela_tipo, d;
  end if;
  if d->'bloco_inicio' is distinct from 'null'::jsonb or d->'bloco_fim' is distinct from 'null'::jsonb then
    raise exception 'FALHOU: a janela % saiu com faixa de bloco no dados (%)', p_janela_tipo, d;
  end if;

  o := public.teste_ocorrencia(p_regra);
  if o.bloco_reportado is not null then
    raise exception 'FALHOU: a insistência da janela % gravou bloco_reportado (%)',
                    p_janela_tipo, o.bloco_reportado;
  end if;
end
$f$;

select public.teste_lembrete_por_minutos('IV outra tempo', 'IV-OutraTempo', 'tempo', 60);
select public.teste_lembrete_por_minutos('IV outra bipes', 'IV-OutraBipes', 'bipes', 50);
select public.teste_lembrete_por_minutos('IV outra op',    'IV-OutraOp',    'op',    null);

-- ---------------------------------------------------------------------------------------------
-- T15. ⚠️ VAZAMENTO, ponta a ponta: uma regra de janela 'tempo' cujo id ESTÁ no p_blocos (o app não
--      deveria mandar, mas o banco não confia) não pode contar os bipes do bloco. O posto tem 2
--      reprovados AGORA (dentro dos 60 min) e 8 aprovados em março (dentro do bloco): a taxa tem de
--      sair 0%, com 0 aprovados. Sem a guarda do ramo novo, sairia 80% com 8 aprovados.
do $t$
begin
  perform public.teste_regra('IV nao vaza', 'aprovacao', array['IV-NaoVaza'], 90, 'tempo', 60, 2,
                             null, null, null);
end $t$;
select public.teste_bipes('IV-NaoVaza', 'PMOJ', '1', 0, 2, 5);
select public.teste_bipes_em('IV-NaoVaza', 'PMOJ', '1', 8, 0, '2026-03-10 07:10:00+00');

set role service_role;
do $t$
declare
  a jsonb;
  o public.alerta_ocorrencias;
begin
  perform alerta_avaliar(null, teste_bloco('IV nao vaza', '2026-03-10 07:00:00+00',
                                                          '2026-03-10 08:00:00+00'));
  a := teste_fila('IV nao vaza', 'IV-NaoVaza');
  if a is null or a->>'tipo' <> 'alerta' then
    raise exception 'FALHOU: a regra de janela ''tempo'' não abriu %', a;
  end if;
  if (a->>'aprovados')::int <> 0 or (a->>'reprovados')::int <> 2 or (a->>'taxa')::numeric <> 0 then
    raise exception 'FALHOU: a janela ''tempo'' contou os bipes do bloco (%)', a;
  end if;
  if a->>'janela_tipo' <> 'tempo' then
    raise exception 'FALHOU: janela_tipo no dados = %', a->>'janela_tipo';
  end if;
  o := teste_ocorrencia('IV nao vaza');
  if o.bloco_reportado is not null then
    raise exception 'FALHOU: a janela ''tempo'' gravou bloco_reportado (%)', o.bloco_reportado;
  end if;
end $t$;
reset role;

drop function public.teste_lembrete_por_minutos(text, text, text, int);
drop function public.teste_ocorrencia(text);
drop function public.teste_bloco(text, timestamptz, timestamptz);
drop function public.teste_bipes_em(text, text, text, int, int, timestamptz);

select 'alertas 0139 (janela por blocos de turno): ok' as resultado;
