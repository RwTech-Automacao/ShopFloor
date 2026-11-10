-- Colunas de produção que a 0183 lê e o esquema mínimo do runner de alertas não tem (mesmos tipos de produção:
-- posto_retorno da 0102/0103, posto_origem do reparo).
alter table public.sf_registros add column if not exists posto_retorno text;
alter table public.sf_registros add column if not exists posto_origem text not null default '';
