-- =============================================================
-- Integração com o Compels — PONTO DE PARTIDA DA OP
--
-- A integração decide cada entrada comparando o apontado que o ERP mostra com o que o ShopFloor já enviou.
-- Se a OP já tinha apontamento ANTES da integração (feito à mão, ou de outra leva da mesma OP), esse apontado
-- não é nosso, e a comparação "ERP == o que enviamos" nunca fechava: a OP ficava recusada.
--
-- Esta tabela guarda, por OP do Compels (os dígitos: 8682 e 8682_F são a MESMA OP lá), o apontado que ela já
-- tinha quando a integração gravou pela primeira vez. A integração lê o número no ERP, guarda aqui ANTES de gravar
-- e passa a contar a partir dele (ponto de partida + o que enviou). Guardar e não reler a cada entrada é o que
-- impede qualquer apontamento de fora, feito depois, de virar "ponto de partida" e desligar a conferência.
--
-- Só o servidor (service_role) lê e grava. Sem policy de propósito: nenhuma tela usa isto.
-- Para refazer o ponto de uma OP (por exemplo, depois de um apontamento manual conferido):
--   delete from public.sf_compels_op_base where op = '8682';
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0168_sf_compels_op_base.sql
--
-- Aditiva e idempotente. Rollback: drop table public.sf_compels_op_base;
-- =============================================================

create table if not exists public.sf_compels_op_base (
  -- Número da OP no Compels (só dígitos, sem o sufixo da segunda leva do ShopFloor).
  op           text primary key check (op ~ '^[0-9]+$'),
  -- Apontado que a OP já tinha lá quando a integração começou. Nunca negativo.
  base         numeric not null check (base >= 0),
  capturado_em timestamptz not null default now()
);

alter table public.sf_compels_op_base enable row level security;

revoke all on table public.sf_compels_op_base from public, anon, authenticated;
grant select, insert, delete on table public.sf_compels_op_base to service_role;

notify pgrst, 'reload schema';
