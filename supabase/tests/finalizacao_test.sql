-- Prova a 0145. Roda depois da 0121 e da 0145 (esta aplicada duas vezes).
\set ON_ERROR_STOP on

-- ---------- ferramentas ----------
create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $func$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $func$;

-- Estado legível: "OP=STATUS/origem" em ordem de OP.
create function pg_temp.estado() returns text language sql as $func$
  select string_agg(op || '=' || status || '/' || coalesce(finalizada_por, '-'), ' ' order by op)
    from public.sf_ordens
$func$;

-- Impressão digital do banco INTEIRO de ordens, inclusive updated_at: prova "não reescreveu nada".
create function pg_temp.digital() returns text language sql as $func$
  select md5(coalesce(string_agg(id::text || '|' || status || '|' || coalesce(finalizada_por, '~')
                                 || '|' || updated_at::text, ';' order by id), ''))
    from public.sf_ordens
$func$;

create function pg_temp.rodar() returns jsonb language sql as $func$
  select public.sf_sincronizar_finalizacao()
$func$;

-- Insere n peças aprovadas no ÚLTIMO posto (EMB) de uma OP.
create function pg_temp.pecas(p_op text, n int, p_status text default 'aprovado') returns void language sql as $func$
  insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm)
  select 'PMO1', p_op, 'EMB', p_status, p_op || '-SN' || g from generate_series(1, n) g
$func$;

-- ---------- cenário ----------
-- Toda OP tem rota MONT(1) -> EMB(2): o último posto é EMB.
insert into public.sf_ordens (pmo, op, qtd, status, finalizada_por) values
  ('PMO1', 'A', 2,    'ATIVA',      null),      -- 100%                         -> fecha (caso 1)
  ('PMO1', 'B', 2,    'ATIVA',      null),      -- 50%                          -> fica
  ('PMO1', 'C', 0,    'ATIVA',      null),      -- qtd 0, com peças             -> nunca fecha (caso 6)
  ('PMO1', 'D', null, 'ATIVA',      null),      -- qtd nulo, com peças          -> nunca fecha (caso 6)
  ('PMO1', 'E', 2,    'FINALIZADA', 'manual'),  -- 50%, fechada por pessoa      -> continua (caso 4)
  ('PMO1', 'F', 2,    'FINALIZADA', null),      -- 50%, sem marcação (as 7)     -> intocada (caso 5)
  ('PMO1', 'G', 2,    'FINALIZADA', null),      -- 100%, sem marcação           -> intocada, continua nula
  ('PMO1', 'H', 3,    'ATIVA',      null),      -- 100%, depois a qtd sobe      -> reabre (caso 3)
  ('PMO1', 'I', 2,    '',           null),      -- status vazio conta como ativa-> fecha
  ('PMO1', 'J', 1,    'ATIVA',      null),      -- só reprovada                 -> 0%, fica
  ('PMO1', 'K', 1,    'ATIVA',      null),      -- fecha, depois perde os bipes -> reabre
  ('PMO1', 'L', 2,    'finalizada', 'manual'),  -- grafia minúscula, manual, 100% -> intocada
  ('PMO1', 'M', 2,    'ATIVA',      null);      -- 150% (passou da quantidade)  -> fecha (>= 100, não = 100)
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
  select id, p.posto, p.ordem from public.sf_ordens, (values ('MONT', 1), ('EMB', 2)) as p(posto, ordem);

select pg_temp.pecas('A', 2);
select pg_temp.pecas('B', 1);
select pg_temp.pecas('C', 2);
select pg_temp.pecas('D', 2);
select pg_temp.pecas('E', 1);
select pg_temp.pecas('F', 1);
select pg_temp.pecas('G', 2);
select pg_temp.pecas('H', 3);
select pg_temp.pecas('I', 2);
select pg_temp.pecas('J', 1, 'reprovado');
select pg_temp.pecas('K', 1);
select pg_temp.pecas('L', 2);
select pg_temp.pecas('M', 3);

-- ---------- 0. a coluna recusa valor fora da lista ----------
do $func$
begin
  begin
    update public.sf_ordens set finalizada_por = 'robo' where op = 'B';
    raise exception 'FALHOU: aceitou finalizada_por = robo';
  exception when check_violation then null;
  end;
end $func$;

-- ---------- caso 1: 100% e ativa -> fecha, marcada como rotina ----------
create temp table r1 as select pg_temp.rodar() as j;
select pg_temp.confere((select j->>'finalizadas' from r1) = '5',
  'primeira rodada deveria finalizar A, H, I, K e M (5); resumo=' || (select j::text from r1));
select pg_temp.confere((select j->>'reabertas' from r1) = '0', 'primeira rodada não reabre nada');
select pg_temp.confere(pg_temp.estado() =
  'A=FINALIZADA/rotina B=ATIVA/- C=ATIVA/- D=ATIVA/- E=FINALIZADA/manual F=FINALIZADA/- G=FINALIZADA/- '
  || 'H=FINALIZADA/rotina I=FINALIZADA/rotina J=ATIVA/- K=FINALIZADA/rotina L=finalizada/manual M=FINALIZADA/rotina',
  'estado depois da rodada 1: ' || pg_temp.estado());

-- ---------- caso 2: segunda rodada -> NADA muda (convergência, bit a bit) ----------
create temp table d1 as select pg_temp.digital() as d;
create temp table r2 as select pg_temp.rodar() as j;
select pg_temp.confere((select j from r2) = '{"finalizadas": 0, "reabertas": 0}'::jsonb,
  'segunda rodada deveria ser {0,0}; veio ' || (select j::text from r2));
select pg_temp.confere(pg_temp.digital() = (select d from d1),
  'segunda rodada MEXEU no banco (status, origem ou updated_at)');
create temp table r2b as select pg_temp.rodar() as j;
select pg_temp.confere(pg_temp.digital() = (select d from d1), 'terceira rodada mexeu no banco');

-- ---------- caso 7: rebipar peça JÁ contada numa OP fechada -> a OP não pisca ----------
insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm)
  values ('PMO1', 'A', 'EMB', 'aprovado', 'A-SN1'), ('PMO1', 'A', 'EMB', 'retrabalho', 'A-SN2');
select pg_temp.confere((select pct_conclusao from public.sf_ops_com_bipes(null, null) where op = 'A') = 100.0,
  'a conta de A deveria seguir em 100 depois de rebipar peça já contada');
select pg_temp.confere(pg_temp.rodar() = '{"finalizadas": 0, "reabertas": 0}'::jsonb,
  'rebipe de peça já contada fez a rotina agir (piscou)');
select pg_temp.confere(pg_temp.digital() = (select d from d1), 'rebipe mudou o status/updated_at de A');

-- ---------- caso 3: fechada pela rotina cuja qtd sobe -> reabre (e volta a fechar se desfizer) ----------
update public.sf_ordens set qtd = 4 where op = 'H';   -- 3/4 = 75%
create temp table r3 as select pg_temp.rodar() as j;
select pg_temp.confere((select j->>'reabertas' from r3) = '1', 'H deveria reabrir; resumo=' || (select j::text from r3));
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'H') = 'ATIVA/-',
  'H reaberta deveria ficar ATIVA sem origem');
update public.sf_ordens set qtd = 3 where op = 'H';   -- volta a 100%
select pg_temp.confere((pg_temp.rodar()->>'finalizadas') = '1', 'H deveria fechar de novo');
select pg_temp.confere((select finalizada_por from public.sf_ordens where op = 'H') = 'rotina', 'H fechada de novo pela rotina');

-- ---------- caso 4: manual abaixo de 100% -> continua fechada, rodada após rodada ----------
select pg_temp.rodar(); select pg_temp.rodar(); select pg_temp.rodar();
select pg_temp.confere((select status || '/' || finalizada_por from public.sf_ordens where op = 'E') = 'FINALIZADA/manual',
  'E (manual, 50%) foi reaberta pela rotina');

-- ---------- caso 5: FINALIZADA sem marcação (as 7 de 08/10) -> a rotina não encosta ----------
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'F') = 'FINALIZADA/-',
  'F (sem marcação, 50%) foi tocada');
select pg_temp.confere((select status || '/' || coalesce(finalizada_por, '-') from public.sf_ordens where op = 'G') = 'FINALIZADA/-',
  'G (sem marcação, 100%) foi marcada ou reescrita: a rotina não pode "adotar" a OP');

-- ---------- caso 6: qtd nulo ou zero -> nunca fecha ----------
select pg_temp.confere((select count(*) from public.sf_ordens where op in ('C', 'D') and status <> 'ATIVA') = 0,
  'OP com qtd nulo/zero foi finalizada');

-- ---------- fechada pela rotina que perde TODOS os bipes (sumiu da sf_ops_com_bipes) -> reabre ----------
delete from public.sf_registros where op = 'K';
select pg_temp.confere((pg_temp.rodar()->>'reabertas') = '1', 'K sem nenhum bipe deveria reabrir');
select pg_temp.confere((select status from public.sf_ordens where op = 'K') = 'ATIVA', 'K deveria estar ATIVA');

-- ---------- qtd zerada depois de fechada pela rotina -> pct nulo -> reabre ----------
update public.sf_ordens set qtd = 0 where op = 'A';
select pg_temp.confere((pg_temp.rodar()->>'reabertas') = '1', 'A com qtd 0 deveria reabrir (sem denominador não há conclusão)');
update public.sf_ordens set qtd = 2 where op = 'A';
select pg_temp.rodar();   -- A volta a fechar

-- ---------- convergência final depois de toda a bagunça ----------
create temp table d2 as select pg_temp.digital() as d;
select pg_temp.confere(pg_temp.rodar() = '{"finalizadas": 0, "reabertas": 0}'::jsonb, 'estado final não convergiu');
select pg_temp.confere(pg_temp.digital() = (select d from d2), 'rodada final mexeu no banco');

-- ---------- permissões: só service_role executa ----------
set role authenticated;
do $func$
begin
  begin
    perform public.sf_sincronizar_finalizacao();
    raise exception 'FALHOU: authenticated conseguiu executar a rotina';
  exception when insufficient_privilege then null;
  end;
end $func$;
reset role;
set role anon;
do $func$
begin
  begin
    perform public.sf_sincronizar_finalizacao();
    raise exception 'FALHOU: anon conseguiu executar a rotina';
  exception when insufficient_privilege then null;
  end;
end $func$;
reset role;
set role service_role;
select pg_temp.confere(public.sf_sincronizar_finalizacao() is not null, 'service_role deveria executar');
reset role;

\echo 'finalizacao_test: ok'
