-- Massa do dashboard (0152). Roda DEPOIS da 0142/0143/0147 e ANTES da 0152: as linhas 104 e 105
-- nascem com a justificativa como pode estar no banco hoje, para a normalização da 0152 agir.
--
-- Semanas (segunda a domingo):  A = 07/09–13/09/2026 · B = 14/09–20/09 (VAZIA) · C = 21/09–27/09
--
--  id   status          fornecedor  comprador  EMB   código  chegada     divergência  justificativa
--  101  aberto          Panasonic   Joana      EMB1  CAP1    08/09 (A)   -10          ''
--  102  finalizado      Panasonic   Joana      EMB1  CAP2    09/09 (A)   5            'Fornecedor mandou a mais'
--  103  finalizado      Panasonic   Joana      EMB1  CAP3    10/09 (A)   0            ''
--  104  em_conferencia  Vishay      Pedro      EMB2  RES1    22/09 (C)   3            '   '  (só espaços)
--  105  finalizado      Vishay      Pedro      EMB2  RES2    23/09 (C)   -1,5         '  alinhado  '
--  106  finalizado      Vishay      Pedro      EMB2  RES3    24/09 (C)   nulo         ''
--  107  finalizado      Vishay      Pedro      EMB2  RES4    24/09 (C)   'ok'         ''
--  108  cancelado       Vishay      Pedro      EMB2  RES5    24/09 (C)   99           ''   ← fora de tudo
--  109  aberto          (nulo)      Joana      EMB3  DIO1    25/09 (C)   7            ''
--  110  aberto          Acme        Pedro      EMB4  X1      (nula)      2            ''
--  111  aberto          ACME        Pedro      EMB4  X2      21/09 (C)   -4           ''
--  112  finalizado      Panasonic   Joana      EMB0  OLD1    01/06       8            ''
--
-- As contas esperadas estão no cabeçalho de recebimento_dashboard_test.sql.
insert into public.processos_recebimento
  (id, status, fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia, divergencia_justificativa)
values
  ('00000000-0000-0000-0000-000000000101', 'aberto',         'Panasonic', 'Joana', 'EMB1', 'CAP1', '2026-09-08', '-10',  ''),
  ('00000000-0000-0000-0000-000000000102', 'finalizado',     'Panasonic', 'Joana', 'EMB1', 'CAP2', '2026-09-09', '5',    'Fornecedor mandou a mais'),
  ('00000000-0000-0000-0000-000000000103', 'finalizado',     'Panasonic', 'Joana', 'EMB1', 'CAP3', '2026-09-10', '0',    ''),
  ('00000000-0000-0000-0000-000000000104', 'em_conferencia', 'Vishay',    'Pedro', 'EMB2', 'RES1', '2026-09-22', '3',    '   '),
  ('00000000-0000-0000-0000-000000000105', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES2', '2026-09-23', '-1,5', '  alinhado  '),
  ('00000000-0000-0000-0000-000000000106', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES3', '2026-09-24', null,   ''),
  ('00000000-0000-0000-0000-000000000107', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES4', '2026-09-24', 'ok',   ''),
  ('00000000-0000-0000-0000-000000000108', 'cancelado',      'Vishay',    'Pedro', 'EMB2', 'RES5', '2026-09-24', '99',   ''),
  ('00000000-0000-0000-0000-000000000109', 'aberto',         null,        'Joana', 'EMB3', 'DIO1', '2026-09-25', '7',    ''),
  ('00000000-0000-0000-0000-000000000110', 'aberto',         'Acme',      'Pedro', 'EMB4', 'X1',   null,         '2',    ''),
  ('00000000-0000-0000-0000-000000000111', 'aberto',         'ACME',      'Pedro', 'EMB4', 'X2',   '2026-09-21', '-4',   ''),
  ('00000000-0000-0000-0000-000000000112', 'finalizado',     'Panasonic', 'Joana', 'EMB0', 'OLD1', '2026-06-01', '8',    '');
