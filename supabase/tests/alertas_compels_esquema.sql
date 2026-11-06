-- Esquema mínimo da fila do Compels (sf_estoque_envios) para o teste da 0170 (alertas_compels_test.sql).
-- Esta base do runner de alertas só tem o _stubs.sql: a fila de verdade (0132/0153/0156/0169) depende do
-- Almoxarifado inteiro, e o que a 0170 e o alerta leem são só estas colunas. Mesmos nomes, tipos e checks
-- que importam (ok = enviado_em, cancelado não enviado).
--
-- Roda ANTES da 0170, com linhas "legadas" (de antes da coluna erro_esperado) para provar o backfill:
-- as três frases que o app gravava como espera esperada, e uma falha de verdade.
create table public.sf_estoque_envios (
  id           uuid primary key default gen_random_uuid(),
  chave        text not null default gen_random_uuid()::text,
  operacao     text not null default 'entrada' check (operacao in ('entrada', 'estorno')),
  pmo          text not null,
  op           text not null,
  posto        text not null,
  tipo         text not null default 'caixa',
  bipe         text not null default 'CX1',
  quantidade   int  not null default 1 check (quantidade > 0),
  ok           boolean not null default false,
  erro         text,
  aviso        text,
  tentativas   int  not null default 0,
  enviado_em   timestamptz,
  cancelado_em timestamptz,
  criado_em    timestamptz not null default now(),
  check (ok = (enviado_em is not null)),
  check (cancelado_em is null or not ok)
);

insert into public.sf_estoque_envios (pmo, op, posto, operacao, erro) values
  ('PMOLEG', 'LEG1', 'ALMOX', 'entrada',
   'OP LEG1 ainda não está liberada para a integração com o Compels. Faça a entrada à mão no ERP, ou libere a OP.'),
  ('PMOLEG', 'LEG2', 'ALMOX', 'entrada',
   'Integração com o Compels não configurada neste ambiente. COMPELS_EZPOINT_USUARIO ausente'),
  ('PMOLEG', 'LEG3', 'ALMOX', 'estorno',
   'O estorno no Compels ainda é manual: estorne o apontamento, a requisição e o empenho na tela do ERP.'),
  ('PMOLEG', 'LEG4', 'ALMOX', 'entrada', 'Aguardando requisição no Compels: tela em uso');
