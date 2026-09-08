-- 0085_sf_postos_coletivo.sql
-- Lançamento coletivo: flag por posto (só faz sentido p/ perfis passagem/spi/inspecao;
-- o gate de qual perfil pode marcar é na UI/actions). Aditiva.
alter table public.sf_postos add column if not exists coletivo boolean not null default false;
