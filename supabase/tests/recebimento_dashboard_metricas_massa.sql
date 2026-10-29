-- Massa das métricas do dashboard do Recebimento (0154). Roda DEPOIS da 0142/0143/0147/0152 e ANTES da 0154.
-- Datas FIXAS para tudo que entra nas janelas de teste; "hoje" (São Paulo) só nos itens de estado
-- atual (Pendências e Parados), que ficam FORA das janelas (sem data_chegada, ou chegada recente).
--
-- JANELA W = 01/08/2020 a 30/09/2020 
-- (2020 de propósito: 07/09 e 31/08 são segundas, e os itens relativos a "hoje" nunca caem nela).
-- Semanas de W (segunda a domingo): 27/07 · 03/08 · 10/08 · 17/08 ·
-- 24/08 · 31/08 · 07/09 · 14/09 · 21/09 · 28/09  → itens 0,0,0,0,0,1,4,1,4,0  (EMBs distintas 0,0,0,0,0,1,3,0,2,0)
-- Meses de W: 08/2020 (1 item, 1 EMB) · 09/2020 (9 itens, 5 EMBs).
--
--  id   status         resultado   forn  comprador EMB       cód   chegada  prevista  rec/rej   log(1ª conf.)  finalizado_em
--  201  finalizado     Aprovado    ACME  Joana     EMB-A1    C1    31/08    31/08     1000/0    02/09          05/09   (rec 2d · qual 3d)
--  202  finalizado     ''          ACME  Joana     EMB-A1    C2    08/09    04/09     500/0     09/09          10/09   (atraso 4 · rec 1 · qual 1)
--  203  reprovado      ''          ACME  Joana     EMB-A2    C1    09/09    07/09     200/50    11/09          14/09   (atraso 2 · rec 2 · qual 3)
--  204  finalizado     Reprovado   BETA  Pedro     EMB-B1    C1    22/09    22/09     300/300   22/09          23/09   (rec 0 · qual 1)
--  205  finalizado     Aprovado    BETA  Pedro     EMB-B1    C3    23/09    20/09     100/0     25/09 e 27/09  28/09   (atraso 3 · rec 2 · qual 3 da 1ª)
--  206  finalizado     Aprovado    GAMA  Joana     EMB-G1    C4    24/09    30/09     nulo/0    23/09 (antes da chegada → rec 0) 26/09 (qual 3)
--  207  finalizado     REPROVADO   GAMA  Joana     EMB-G1    C4    24/09    (nula)    800/nulo  SEM LOG        29/09   (entra em sem_tempo)
--  209  aberto         ''          ACME  Joana     ' emb-a1 ' C2   10/09    05/09     9999/9999 —              —       (atraso 5; sem resultado → fora da Qualidade)
--  210  cancelado      Aprovado    ACME  Joana     EMB-A1    C1    10/09    01/09     —         —              —       (FORA DE TUDO)
--  212  finalizado     Aprovado    ''    Pedro     ''        C6    15/09    15/09     50/nulo   16/09          17/09   (rec 1 · qual 1)
--  213  aberto         'Reprovado ' GAMA Joana     EMB-G2    ' c5 ' 12/09   12/09     40/40     —              —       (resultado preenchido → com resultado)
--  211  finalizado     Aprovado    ACME  Joana     EMB-A1    C1    01/06    25/05     —         02/06          05/06   (FORA de W)
--
-- CONTAS ESPERADAS em W:
--   Volume: acima.
--   Qualidade: com_resultado 9 (201-207,212,213) · reprovados 4 (203,204,207,213) · peças recebidas 2990 · reprovadas 390
--     fornecedores (reprovados>0): GAMA 3/2 · ACME 3/1 · BETA 2/1 ('' fora)
--     materiais: C1 'Capacitor SMD' 3/2 · C4 'Diodo X' 2/1 · C5 'Fusível' 1/1
--     motivos: 'Fora de especificação' 3 (203,204,213) · 'Dano no transporte' 1 (207)
--   Atraso: com_prazo 9 (todos menos 207) · atrasados 4 (202,203,205,209) · média 3,5 · fornecedores: ACME 4/3 média 3,7 · BETA 2/1 média 3,0
--   Tempo: recebimento n=7 média 1,1 mediana 1,0 · qualidade n=7 média 2,1 mediana 3,0 · sem_tempo 1
--
-- ESTADO ATUAL (fora de W; ZETA é só dele):
--   Pendências (aberto, SEM data_chegada; prevista relativa a hoje): 401 ACME +5 · 402 ACME 0 · 403 ACME -1 · 404 ACME -7 ·
--     405 BETA -8 · 406 BETA -30 · 407 BETA -31 · 408 '' -100 · 409 GAMA sem prevista · 410 cancelado (fora)
--     → total 9 · no_prazo 2 · d1_7 2 · d8_30 2 · d30_mais 2 · sem_prevista 1
--     fornecedores por atrasados: BETA 3/3 (pend./atras.) · ACME 4/2 · '' 1/1 · GAMA 1/0
--   Parados no Recebimento (aberto COM chegada; ZETA 301-305 + as fixas 209 e 213, sempre parados): 301 há 10d · 302 há 20d ·
--     303 há 40d · 304 há 2d · 305 há 7d   → X=3: 6 · X=7: 5 · X=15: 4 · X=30: 3
--   Parados na Qualidade (em_conferencia, última entrada há): 311 2d · 312 5d · 313 10d · 314 20d (e uma entrada antiga de 50d) ·
--     315 40d (mais logs que NÃO contam) · 316 sem log   → X=3: 4 · X=7: 3 · X=15: 2 · X=30: 1
insert into public.processos_recebimento
  (id, status, resultado, fornecedor, comprador, numero_emb, codigo_material, descricao_material,
   data_chegada, data_prevista, quantidade_recebida, quantidade_reprovada, motivo_reprovacao, finalizado_em, divergencia)
values
  ('00000000-0000-0000-0000-000000000201','finalizado','Aprovado',  'ACME','Joana','EMB-A1','C1','Capacitor',    '2020-08-31','2020-08-31',1000,0,   null,                     '2020-09-05 12:00+00', null),
  ('00000000-0000-0000-0000-000000000202','finalizado','',          'ACME','Joana','EMB-A1','C2','Resistor',     '2020-09-08','2020-09-04',500, 0,   'Ruído (não conta)',      '2020-09-10 12:00+00', null),
  ('00000000-0000-0000-0000-000000000203','reprovado', '',          'ACME','Joana','EMB-A2','C1','Capacitor',    '2020-09-09','2020-09-07',200, 50,  'Fora de especificação',  '2020-09-14 12:00+00', null),
  ('00000000-0000-0000-0000-000000000204','finalizado','Reprovado', 'BETA','Pedro','EMB-B1','C1','Capacitor SMD','2020-09-22','2020-09-22',300, 300, 'Fora de especificação',  '2020-09-23 12:00+00', null),
  ('00000000-0000-0000-0000-000000000205','finalizado','Aprovado',  'BETA','Pedro','EMB-B1','C3','Diodo',        '2020-09-23','2020-09-20',100, 0,   null,                     '2020-09-28 12:00+00', null),
  ('00000000-0000-0000-0000-000000000206','finalizado','Aprovado',  'GAMA','Joana','EMB-G1','C4','Diodo',        '2020-09-24','2020-09-30',null,0,   null,                     '2020-09-26 12:00+00', null),
  ('00000000-0000-0000-0000-000000000207','finalizado','REPROVADO', 'GAMA','Joana','EMB-G1','C4','Diodo X',      '2020-09-24',null,        800, null,'Dano no transporte',     '2020-09-29 12:00+00', null),
  ('00000000-0000-0000-0000-000000000209','aberto',    '',          'ACME','Joana',' emb-a1 ','C2','Resistor',   '2020-09-10','2020-09-05',9999,9999,'Motivo que não conta',   null, null),
  ('00000000-0000-0000-0000-000000000210','cancelado', 'Aprovado',  'ACME','Joana','EMB-A1','C1','Capacitor',    '2020-09-10','2020-09-01',100, 0,   null,                     null, null),
  ('00000000-0000-0000-0000-000000000212','finalizado','Aprovado',  '',    'Pedro','',      'C6','Outro',        '2020-09-15','2020-09-15',50,  null,null,                     '2020-09-17 12:00+00', null),
  ('00000000-0000-0000-0000-000000000213','aberto',    'Reprovado ','GAMA','Joana','EMB-G2',' c5 ','Fusível',    '2020-09-12','2020-09-12',40,  40,  'Fora de especificação',  null, null),
  ('00000000-0000-0000-0000-000000000211','finalizado','Aprovado',  'ACME','Joana','EMB-A1','C1','Capacitor',    '2020-06-01','2020-05-25',null,null,null,                     '2020-06-05 12:00+00', null);

-- Estado atual. Pendências: aberto SEM data_chegada, prevista relativa a hoje (São Paulo).
insert into public.processos_recebimento (id, status, fornecedor, comprador, numero_emb, codigo_material, data_chegada, data_prevista)
select ('00000000-0000-0000-0000-000000000' || v.n)::uuid, v.st, v.f, 'Joana', 'EMB-P', 'P1', null,
       case when v.d is null then null else (now() at time zone 'America/Sao_Paulo')::date + v.d end
  from (values
    ('401','aberto','ACME', 5), ('402','aberto','ACME', 0), ('403','aberto','ACME',-1), ('404','aberto','ACME',-7),
    ('405','aberto','BETA',-8), ('406','aberto','BETA',-30), ('407','aberto','BETA',-31), ('408','aberto','',-100),
    ('409','aberto','GAMA',null), ('410','cancelado','GAMA',-50)
  ) as v(n, st, f, d);

-- Parados no Recebimento (ZETA): aberto COM chegada recente (relativa) e já passou do prazo, mas fora de W.
insert into public.processos_recebimento (id, status, fornecedor, comprador, numero_emb, codigo_material, data_chegada)
select ('00000000-0000-0000-0000-000000000' || v.n)::uuid, 'aberto', 'ZETA', 'Joana', 'EMB-Z', 'Z1',
       (now() at time zone 'America/Sao_Paulo')::date - v.d
  from (values ('301',10), ('302',20), ('303',40), ('304',2), ('305',7)) as v(n, d);

-- Parados na Qualidade (ZETA): em_conferencia, chegada recente (fora de W), log relativo a agora.
insert into public.processos_recebimento (id, status, fornecedor, comprador, numero_emb, codigo_material, data_chegada)
select ('00000000-0000-0000-0000-000000000' || v.n)::uuid, 'em_conferencia', 'ZETA', 'Joana', 'EMB-Z', 'Z2',
       (now() at time zone 'America/Sao_Paulo')::date - 3
  from (values ('311'), ('312'), ('313'), ('314'), ('315'), ('316')) as v(n);

-- Logs: a ENTRADA na Qualidade é entidade 'processo' + acao 'mudar_status' + dados.para = 'em_conferencia'.
insert into public.logs (entidade, entidade_id, acao, dados, created_at)
select 'processo', ('00000000-0000-0000-0000-000000000' || v.n)::uuid, 'mudar_status', jsonb_build_object('para', 'em_conferencia'), v.quando::timestamptz
  from (values
    ('201','2020-09-02 12:00+00'), ('202','2020-09-09 12:00+00'), ('203','2020-09-11 12:00+00'),
    ('204','2020-09-22 12:00+00'), ('205','2020-09-25 12:00+00'), ('205','2020-09-27 12:00+00'),
    ('206','2020-09-23 12:00+00'), ('212','2020-09-16 12:00+00'), ('211','2020-06-02 12:00+00')
  ) as v(n, quando);
insert into public.logs (entidade, entidade_id, acao, dados, created_at)
select 'processo', ('00000000-0000-0000-0000-000000000' || v.n)::uuid, 'mudar_status', jsonb_build_object('para', 'em_conferencia'), now() - v.d * interval '1 day'
  from (values ('311', 2), ('312', 5), ('313', 10), ('314', 20), ('314', 50), ('315', 40)) as v(n, d);
-- Logs que NÃO contam para a 315: outra transição, outra ação, outra entidade (nenhum deles é "entrada na Qualidade").
insert into public.logs (entidade, entidade_id, acao, dados, created_at) values
  ('processo', '00000000-0000-0000-0000-000000000315', 'mudar_status', '{"para":"finalizado"}', now() - interval '1 day'),
  ('processo', '00000000-0000-0000-0000-000000000315', 'editar',       '{"para":"em_conferencia"}', now() - interval '1 day'),
  ('outra',    '00000000-0000-0000-0000-000000000315', 'mudar_status', '{"para":"em_conferencia"}', now() - interval '1 day');
