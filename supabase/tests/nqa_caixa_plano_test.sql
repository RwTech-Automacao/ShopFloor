-- Testes do plano estável da sf_nqa_caixa (migração 0160) num Postgres descartável.
-- Roda ao FINAL de supabase/tests/rodar-almoxarifado-test.sh, na mesma base do almoxarifado_test.sql
-- (já tem os stubs de RBAC, sf_registros, tabela_nqa, o espião da sf_aposentar_caixa e a 0130/0160).
--
-- O INCIDENTE (22/10/2026): numa OP grande e NOVA — que o Postgres ainda não conhece (sem ANALYZE) —
-- o NQA por caixa levou 36,9 s, porque o planejador estimou 1 linha pra (pmo, op) e escolheu um
-- Nested Loop Semi Join que varria o índice (pmo, op) uma vez por peça. Aqui a OP é nova e o
-- autovacuum da tabela fica desligado durante o teste, pra a estatística continuar velha de forma
-- determinística. O teste exige a chamada em menos de 3 s (hoje: dezenas de segundos).

-- Índices que existem em produção na sf_registros (0091 e 0028): o stub do almoxarifado não os cria,
-- e o plano ruim do incidente é justamente o do índice (pmo, op, ...). O da 0160 vem da própria 0160.
create index if not exists sf_registros_ordem_sn on public.sf_registros (pmo, op, numero_serie_norm);
create index if not exists sf_registros_caixa    on public.sf_registros (pmo, op, posto, numero_caixa);
create index if not exists sf_registros_sn_norm  on public.sf_registros (numero_serie_norm);

-- Determinismo: sem analyze automático durante o teste (restaurado no fim).
alter table public.sf_registros set (autovacuum_enabled = false);

-- ---------- massa: OP nova e grande, SEM analyze depois ----------
-- 1.250 peças x 8 postos = 10.000 registros. A Embalagem carimba a caixa de 24 (CX[n][24]8559-PMOZZ);
-- os outros 7 postos gravam a peça sem caixa.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
select 'Marcos', p.posto, 'PMOZZ', '8559', 'Cliente Grande',
       case when p.posto = 'Embalagem'
            then 'CX[' || ((i - 1) / 24 + 1)::text || '][24]8559-PMOZZ' else '' end,
       'SN-' || (20000 + i)::text, (20000 + i)::text,
       now() - make_interval(mins => 600 - p.ord * 10) + make_interval(secs => i)
from generate_series(1, 1250) i,
     (values ('Posto1',1),('Posto2',2),('Posto3',3),('Posto4',4),('Posto5',5),('Posto6',6),('Posto7',7),('Embalagem',8)) p(posto, ord);

do $t$
declare
  r jsonb; t0 timestamptz; seg numeric; v_amostras jsonb; v_req int; v_erro text;
begin
  perform set_config('teste.perms', 'lancar', false);
  -- Mesma escolha da função (primeira faixa POR ORDEM): outros arquivos do runner acrescentam faixas à tabela.
  select tamanho_amostra::int into v_req from tabela_nqa
   where quantidade_min <= 24 and (quantidade_max is null or 24 <= quantidade_max)
   order by ordem limit 1;

  -- Caixa 1 = peças 20001..20024. Amostra do tamanho exigido, tudo aprovado.
  select jsonb_agg(jsonb_build_object('sn_norm', (20000 + g)::text, 'visual', 'Aprovado', 'funcional', 'Aprovado', 'observacao', ''))
    into v_amostras from generate_series(1, v_req) g;

  t0 := clock_timestamp();
  r := sf_nqa_caixa('PMOZZ', '8559', 'Inspeção NQA', 'Qualidade', 'CX[1][24]8559-PMOZZ',
                    'Aprovado', '', v_amostras);
  seg := extract(epoch from clock_timestamp() - t0);
  raise notice 'TEMPO sf_nqa_caixa em OP nova de % registros (sem analyze): % s',
    (select count(*) from sf_registros where pmo = 'PMOZZ' and op = '8559'), round(seg, 3);

  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'total')::int <> 24 then
    raise exception 'FALHOU (desempenho): esperava ok=true e total=24, veio %', r; end if;
  if (select count(*) from sf_registros where pmo = 'PMOZZ' and posto = 'Inspeção NQA') <> 24 then
    raise exception 'FALHOU (desempenho): esperava 24 linhas de NQA, vieram %',
      (select count(*) from sf_registros where pmo = 'PMOZZ' and posto = 'Inspeção NQA'); end if;
  if seg >= 3 then
    raise exception 'FALHOU (desempenho): sf_nqa_caixa levou % s numa OP nova sem analyze (limite 3 s) — plano dependente da estatística', round(seg, 1); end if;
  raise notice 'NQA-plano 1. OP grande e nova, sem analyze: % s (< 3 s), ok=true, total=24, 24 linhas de NQA: ok', round(seg, 3);

  -- Comportamento preservado na OP grande: a mesma caixa de novo é recusada (último registro das
  -- peças já é o posto do NQA).
  begin
    perform sf_nqa_caixa('PMOZZ', '8559', 'Inspeção NQA', 'Qualidade', 'CX[1][24]8559-PMOZZ',
                         'Aprovado', '', v_amostras);
    raise exception 'FALHOU: a caixa já inspecionada foi aceita de novo';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro <> 'CAIXA_JA_INSPECIONADA' then
      raise exception 'FALHOU: esperava CAIXA_JA_INSPECIONADA, veio %', v_erro; end if;
  end;
  raise notice 'NQA-plano 2. caixa já inspecionada na OP grande: CAIXA_JA_INSPECIONADA: ok';

  -- Amostra de OUTRA caixa (peça 20049 é da caixa 3) numa caixa ainda não inspecionada (a 2).
  begin
    perform sf_nqa_caixa('PMOZZ', '8559', 'Inspeção NQA', 'Qualidade', 'CX[2][24]8559-PMOZZ',
                         'Aprovado', '',
                         '[{"sn_norm":"20049","visual":"Aprovado","funcional":"Aprovado","observacao":""},
                           {"sn_norm":"20025","visual":"Aprovado","funcional":"Aprovado","observacao":""}]'::jsonb);
    raise exception 'FALHOU: amostra de outra caixa foi aceita';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro <> 'AMOSTRA_FORA_DA_CAIXA' then
      raise exception 'FALHOU: esperava AMOSTRA_FORA_DA_CAIXA, veio %', v_erro; end if;
  end;
  if (select count(*) from sf_registros where pmo = 'PMOZZ' and posto = 'Inspeção NQA') <> 24 then
    raise exception 'FALHOU: a recusa da amostra gravou NQA mesmo assim'; end if;
  raise notice 'NQA-plano 3. amostra fora da caixa na OP grande: AMOSTRA_FORA_DA_CAIXA: ok';

  -- E a caixa 2, com amostras corretas, é aceita (a recusa acima não era por outra coisa).
  -- As amostras da caixa 2 (peças 20025 em diante) na quantidade que a Tabela NQA exige pelo tamanho dela
  -- (v_req): a tabela do banco de teste muda conforme os outros arquivos do runner, então nada fixo aqui.
  select jsonb_agg(jsonb_build_object('sn_norm', (20024 + g)::text, 'visual', 'Aprovado', 'funcional', 'Aprovado', 'observacao', ''))
    into v_amostras from generate_series(1, v_req) g;
  r := sf_nqa_caixa('PMOZZ', '8559', 'Inspeção NQA', 'Qualidade', 'CX[2][24]8559-PMOZZ',
                    'Aprovado', '', v_amostras);
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'total')::int <> 24 then
    raise exception 'FALHOU: a caixa 2 com amostras corretas não passou: %', r; end if;
  raise notice 'NQA-plano 4. caixa 2 com amostras da própria caixa: aceita: ok';

  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar', false);
end $t$;

alter table public.sf_registros reset (autovacuum_enabled);
