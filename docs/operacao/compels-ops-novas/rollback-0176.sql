-- Rollback da 0176: as OPs voltam a depender só da variável COMPELS_OPS_LIBERADAS.
alter table public.sf_ordens drop column if exists integrar_compels;
