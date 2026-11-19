-- Teste da 0196 (placa de PRT com série própria que terminou o trecho não fica parada nem pendente).
-- Pré-requisito: a 0193 aplicada (alerta_travados_sns/sf_pecas_paradas vigentes) e o parados_prt_fim_esquema.sql.
-- Roda numa transação só (now() fixo) e desfaz tudo no fim (rollback): monta a massa, tira a FOTO da 0193, aplica a
-- 0196 (\i /tmp/0196.sql) e confere:
--   P1  equivalência: nas OPs SEM PRT de série própria (sem trechos; PRT de série 'mesmo') a saída da
--       alerta_travados_sns e da sf_pecas_paradas é IDÊNTICA à da 0193 (cortes, ativas/todas, com/sem Manutenção);
--   P2  placa de série própria APROVADA no fim do trecho (posto que exige Aprovado): some (na 0193 aparecia);
--   P3  REPROVADA no fim do trecho: continua aparecendo (reprovada, no posto);
--   P4  no MEIO do trecho: continua aparecendo, pendente no último posto do trecho;
--   P5  fim do trecho exige Aprovado e o registro não é Aprovado (status vazio): continua aparecendo;
--   P6  fim de trecho num posto de passagem (gate 'registrado'): o registro sem status basta, some;
--   P7  placa da PMO na mesma OP: inalterada;
--   P8  sf_pecas_paradas (a tela) segue a mesma regra.
\set ON_ERROR_STOP on
begin;
select set_config('teste.perms', 'shopfloor.visualizar', true);

-- ---------- postos e perfis ----------
insert into public.sf_posto_perfis (chave, recurso, gate) values
  ('pf_aprov', '', 'aprovado'), ('pf_reg', '', 'registrado')
on conflict (chave) do update set gate = excluded.gate;
insert into public.sf_postos (chave, perfil) values
  ('P_SPI', 'pf_aprov'), ('P_AOI', 'pf_aprov'), ('P_MONT', 'pf_reg'), ('P_TESTE', 'pf_aprov'), ('P_ALMOX', 'pf_reg')
on conflict (chave) do update set perfil = excluded.perfil;

create temp table t_op (pmo text, op text, id uuid);
insert into t_op values
  ('PRTA', '9001', gen_random_uuid()),  -- sem trechos
  ('PRTB', '9002', gen_random_uuid()),  -- PRT de série 'mesmo'
  ('PRTC', '9003', gen_random_uuid()),  -- PRT de série própria, fim num posto que exige Aprovado
  ('PRTD', '9004', gen_random_uuid());  -- PRT de série própria, fim num posto de passagem
insert into public.sf_ordens (id, pmo, op, status) select id, pmo, op, 'EM ANDAMENTO' from t_op;

insert into public.sf_ordem_postos (ordem_id, posto, ordem)
select o.id, x.posto, x.ordem
  from t_op o
  join (values ('PRTA', 'P_MONT', 1), ('PRTA', 'P_TESTE', 2), ('PRTA', 'P_ALMOX', 3),
               ('PRTB', 'P_SPI', 1), ('PRTB', 'P_AOI', 2), ('PRTB', 'P_TESTE', 3), ('PRTB', 'P_ALMOX', 4),
               ('PRTC', 'P_SPI', 1), ('PRTC', 'P_AOI', 2), ('PRTC', 'P_TESTE', 3), ('PRTC', 'P_ALMOX', 4),
               ('PRTD', 'P_SPI', 1), ('PRTD', 'P_MONT', 2), ('PRTD', 'P_TESTE', 3), ('PRTD', 'P_ALMOX', 4))
       x(pmo, posto, ordem) on x.pmo = o.pmo;

insert into public.sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, sn_modo)
select o.id, x.seq, x.codigo, x.tipo, x.conclui, x.modo
  from t_op o
  join (values ('PRTB', 1, 'PRT_B', 'prt', 'P_AOI', 'mesmo'), ('PRTB', 2, 'PRTB', 'pmo', 'P_ALMOX', 'mesmo'),
               ('PRTC', 1, 'PRT_C', 'prt', 'P_AOI', 'proprio'), ('PRTC', 2, 'PRTC', 'pmo', 'P_ALMOX', 'mesmo'),
               ('PRTD', 1, 'PRT_D', 'prt', 'P_MONT', 'proprio'), ('PRTD', 2, 'PRTD', 'pmo', 'P_ALMOX', 'mesmo'))
       x(pmo, seq, codigo, tipo, conclui, modo) on x.pmo = o.pmo;

-- ---------- registros (horas atrás; o último de cada SN decide) ----------
insert into public.sf_registros (pmo, op, posto, status, numero_serie, numero_serie_norm, data_hora, created_at)
select o.pmo, o.op, x.posto, x.status, x.sn, x.sn, now() - make_interval(hours => x.h), now() - make_interval(hours => x.h)
  from t_op o
  join (values
    -- A (sem trechos)
    ('PRTA', 'A1', 'P_MONT', '', 50),
    ('PRTA', 'A2', 'P_MONT', '', 50), ('PRTA', 'A2', 'P_TESTE', 'Reprovado', 40),
    ('PRTA', 'A3', 'P_MONT', '', 50), ('PRTA', 'A3', 'P_TESTE', 'Aprovado', 40),
    ('PRTA', 'A4', 'P_MONT', '', 50), ('PRTA', 'A4', 'P_TESTE', 'Aprovado', 40), ('PRTA', 'A4', 'P_ALMOX', '', 30),
    ('PRTA', 'A5', 'P_MONT', '', 50), ('PRTA', 'A5', 'P_TESTE', 'Reprovado', 40), ('PRTA', 'A5', 'Manutenção', '', 30),
    -- B (PRT de série 'mesmo': a placa segue a rota da PMO)
    ('PRTB', 'B1', 'P_SPI', 'Aprovado', 50), ('PRTB', 'B1', 'P_AOI', 'Aprovado', 40),
    ('PRTB', 'B2', 'P_SPI', 'Aprovado', 50),
    ('PRTB', 'B3', 'P_SPI', 'Aprovado', 50), ('PRTB', 'B3', 'P_AOI', 'Reprovado', 40),
    -- C (PRT de série própria, fim = P_AOI, que exige Aprovado)
    ('PRTC', 'C1', 'P_SPI', 'Aprovado', 50), ('PRTC', 'C1', 'P_AOI', 'Aprovado', 40),
    ('PRTC', 'C2', 'P_SPI', 'Aprovado', 50), ('PRTC', 'C2', 'P_AOI', 'Reprovado', 40),
    ('PRTC', 'C3', 'P_SPI', 'Aprovado', 50),
    ('PRTC', 'C4', 'P_SPI', 'Aprovado', 50), ('PRTC', 'C4', 'P_AOI', '', 40),
    ('PRTC', 'C5', 'P_SPI', 'Aprovado', 50), ('PRTC', 'C5', 'P_AOI', 'Reprovado', 45), ('PRTC', 'C5', 'P_AOI', 'Aprovado', 40),
    ('PRTC', 'C9', 'P_TESTE', 'Aprovado', 40),  -- placa da PMO
    -- D (PRT de série própria, fim = P_MONT, passagem)
    ('PRTD', 'D1', 'P_SPI', 'Aprovado', 50), ('PRTD', 'D1', 'P_MONT', '', 40),
    ('PRTD', 'D2', 'P_SPI', 'Aprovado', 50))
       x(pmo, sn, posto, status, h) on x.pmo = o.pmo;

create temp table t_casos (k text, corte timestamptz, ativas boolean, man boolean, pmos text[], postos text[]);
insert into t_casos
select c || '/' || a || '/' || m || '/' || coalesce(array_to_string(pm, ','), '-'),
       now() - make_interval(hours => h), a, m, pm,
       array['P_SPI', 'P_AOI', 'P_MONT', 'P_TESTE', 'P_ALMOX', 'Manutenção']
  from (values ('agora', 0), ('35h', 35), ('45h', 45)) cc(c, h)
 cross join (values (true), (false)) aa(a)
 cross join (values (true), (false)) mm(m)
 cross join (values (null::text[]), (array['PRTA', 'PRTB', 'PRTC', 'PRTD']), (array[' PRTA ', 'PRTB'])) pp(pm);

-- OPs sem PRT de série própria: a foto da equivalência (P1)
create temp table t_antes as
select c.k, t::text as linha from t_casos c
 cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t
 where t.pmo in ('PRTA', 'PRTB');
create temp table t_antes_tela as
select s.sit, t::text as linha from (values ('ativas'), ('todas')) s(sit)
 cross join lateral public.sf_pecas_paradas(now(), s.sit, array['PRTA', 'PRTB']) t;
-- A 0193 mostra o defeito: C1 (terminou o trecho) aparece pendente no P_TESTE.
create temp table t_antes_c as
select t.* from public.alerta_travados_sns(array['P_SPI', 'P_AOI', 'P_MONT', 'P_TESTE', 'P_ALMOX', 'Manutenção'],
                                            array['PRTC', 'PRTD'], now(), true, true) t;

do $t$ begin
  if (select count(*) from t_antes) < 30 then raise exception 'FOTO vazia demais (%)', (select count(*) from t_antes); end if;
  if not exists (select 1 from t_antes_c where numero_serie_norm = 'C1' and posto = 'P_TESTE') then
    raise exception 'pré-condição: na 0193 o C1 deveria aparecer pendente no P_TESTE';
  end if;
  if not exists (select 1 from t_antes_c where numero_serie_norm = 'D1' and posto = 'P_TESTE') then
    raise exception 'pré-condição: na 0193 o D1 deveria aparecer pendente no P_TESTE';
  end if;
end $t$;

\i /tmp/0196.sql

do $t$
declare v int;
  r record;
  todos constant text[] := array['P_SPI', 'P_AOI', 'P_MONT', 'P_TESTE', 'P_ALMOX', 'Manutenção'];
begin
  -- P1
  select count(*) into v from (
    (select k, linha from t_antes except all
     select c.k, t::text from t_casos c cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t
      where t.pmo in ('PRTA', 'PRTB'))
    union all
    (select c.k, t::text from t_casos c cross join lateral public.alerta_travados_sns(c.postos, c.pmos, c.corte, c.ativas, c.man) t
      where t.pmo in ('PRTA', 'PRTB')
     except all select k, linha from t_antes)) x;
  if v <> 0 then raise exception 'P1 FALHOU: alerta_travados_sns difere da 0193 em % linha(s) sem PRT própria', v; end if;
  select count(*) into v from (
    (select sit, linha from t_antes_tela except all
     select s.sit, t::text from (values ('ativas'), ('todas')) s(sit)
      cross join lateral public.sf_pecas_paradas(now(), s.sit, array['PRTA', 'PRTB']) t)
    union all
    (select s.sit, t::text from (values ('ativas'), ('todas')) s(sit)
      cross join lateral public.sf_pecas_paradas(now(), s.sit, array['PRTA', 'PRTB']) t
     except all select sit, linha from t_antes_tela)) x;
  if v <> 0 then raise exception 'P1 FALHOU: sf_pecas_paradas difere da 0193 em % linha(s) sem PRT própria', v; end if;
  -- B1 (série 'mesmo', aprovada no fim do trecho) continua pendente no P_TESTE
  if not exists (select 1 from public.alerta_travados_sns(todos, array['PRTB'], now(), true, true)
                  where numero_serie_norm = 'B1' and posto = 'P_TESTE') then
    raise exception 'P1 FALHOU: B1 (PRT de série mesmo) deveria seguir pendente no P_TESTE';
  end if;

  create temp table t_depois as
  select t.* from public.alerta_travados_sns(todos, array['PRTC', 'PRTD'], now(), true, true) t;

  -- P2
  if exists (select 1 from t_depois where numero_serie_norm = 'C1') then
    raise exception 'P2 FALHOU: C1 terminou o trecho (Aprovado em P_AOI) e ainda aparece';
  end if;
  -- reprovada e depois aprovada no fim (C5): o último registro é Aprovado → some
  if exists (select 1 from t_depois where numero_serie_norm = 'C5') then
    raise exception 'P2 FALHOU: C5 (reprovou e foi aprovada no fim) ainda aparece';
  end if;
  -- P3
  select * into r from t_depois where numero_serie_norm = 'C2';
  if r is null or r.posto <> 'P_AOI' or not r.reprovada then
    raise exception 'P3 FALHOU: C2 (reprovada no fim do trecho) deveria aparecer reprovada no P_AOI: %', r;
  end if;
  -- P4
  if not exists (select 1 from t_depois where numero_serie_norm = 'C3' and posto = 'P_AOI' and not reprovada) then
    raise exception 'P4 FALHOU: C3 (no meio do trecho) deveria aparecer pendente no P_AOI';
  end if;
  if not exists (select 1 from t_depois where numero_serie_norm = 'D2' and posto = 'P_MONT') then
    raise exception 'P4 FALHOU: D2 (no meio do trecho) deveria aparecer pendente no P_MONT';
  end if;
  -- P5
  if not exists (select 1 from t_depois where numero_serie_norm = 'C4' and posto = 'P_TESTE') then
    raise exception 'P5 FALHOU: C4 (fim do trecho sem Aprovado) deveria seguir pendente no P_TESTE';
  end if;
  -- P6
  if exists (select 1 from t_depois where numero_serie_norm = 'D1') then
    raise exception 'P6 FALHOU: D1 terminou o trecho num posto de passagem e ainda aparece';
  end if;
  -- P7
  if not exists (select 1 from t_depois where numero_serie_norm = 'C9' and posto = 'P_ALMOX') then
    raise exception 'P7 FALHOU: C9 (placa da PMO) deveria seguir pendente no P_ALMOX';
  end if;
  select count(*) into v from t_depois;
  if v <> 5 then raise exception 'P2-P7: esperava 5 linhas (C2, C3, C4, C9, D2), veio %', v; end if;
  -- P8
  select count(*) into v from public.sf_pecas_paradas(now(), 'ativas', array['PRTC', 'PRTD']) t
   where t.numero_serie in ('C1', 'C5', 'D1');
  if v <> 0 then raise exception 'P8 FALHOU: a tela ainda mostra % placa(s) que terminaram o trecho', v; end if;
  select count(*) into v from public.sf_pecas_paradas(now(), 'ativas', array['PRTC', 'PRTD']) t;
  if v <> 5 then raise exception 'P8 FALHOU: a tela deveria ter 5 linhas em PRTC/PRTD, veio %', v; end if;
  raise notice '0196: % linhas sem PRT própria idênticas à 0193; P2–P8 ok', (select count(*) from t_antes);
end $t$;
rollback;
