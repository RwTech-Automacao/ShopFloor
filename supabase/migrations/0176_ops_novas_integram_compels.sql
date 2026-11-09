-- =============================================================
-- 0176: INTEGRAÇÃO COM O COMPELS AUTOMÁTICA PARA AS OPs NOVAS (09/11/2026)
--
-- Regra: toda OP criada a partir de 09/11/2026 fica liberada sozinha para a integração com o Compels.
-- As OPs que já existiam NÃO mudam: continuam só liberadas se estiverem na variável COMPELS_OPS_LIBERADAS.
--
-- Como: sf_ordens.integrar_compels boolean not null. A coluna entra com default false, o que marca TODAS
-- as linhas existentes como false; em seguida o default passa a true, e só as OPs criadas daqui em diante
-- nascem true. A liberação é a lista do ambiente OU esta coluna (compels.ts, criarPortaCompels).
--
-- Idempotente: reaplicar não muda nada. Na 2ª aplicação a coluna já existe (o add não roda de novo, então
-- as OPs nascidas entre as aplicações seguem true) e o set default repete o mesmo valor.
-- Rollback: docs/operacao/compels-ops-novas/rollback-0176.sql
-- =============================================================

alter table public.sf_ordens add column if not exists integrar_compels boolean not null default false;
alter table public.sf_ordens alter column integrar_compels set default true;

comment on column public.sf_ordens.integrar_compels is
  'Integração com o Compels liberada para a OP. Default true: OPs criadas a partir de 09/11/2026 nascem liberadas; as que já existiam ficaram false (só entram pela variável COMPELS_OPS_LIBERADAS). 0176.';
