-- =============================================================
-- ShopFloor Processo — fluxo de postos por OP.
-- sf_ordem_postos ganha `ordem` (sequência por OP); + 2 postos novos.
-- =============================================================

-- 1) Coluna de ordem por OP.
alter table public.sf_ordem_postos add column ordem int not null default 0;

-- 2) Abrir espaço no catálogo e inserir Burn-in (após Teste) e Extra máquina (antes de Manutenção).
update public.sf_postos set ordem = 8  where chave = 'Integração';
update public.sf_postos set ordem = 9  where chave = 'Teste Final';
update public.sf_postos set ordem = 10 where chave = 'Inspeção Final';
update public.sf_postos set ordem = 11 where chave = 'Embalagem';
update public.sf_postos set ordem = 12 where chave = 'Inspeção NQA';
update public.sf_postos set ordem = 14 where chave = 'Manutenção';
insert into public.sf_postos (chave, ordem) values ('Burn-in', 7), ('Extra máquina', 13)
  on conflict (chave) do nothing;

-- 3) Backfill: dá a cada OP uma sequência inicial coerente com a ordem global do catálogo.
update public.sf_ordem_postos op
set ordem = p.ordem
from public.sf_postos p
where op.posto = p.chave;
