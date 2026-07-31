-- =============================================================
-- Tempo mínimo de Burn-in passa a ser por (OP, posto). Backfill:
-- tempo único da OP (sf_ordens.tempo_min_burnin) → cada posto de
-- perfil burnin no fluxo dela. Espelha sf_ordem_componentes.
-- =============================================================
create table public.sf_ordem_burnin (
  ordem_id  uuid not null references public.sf_ordens(id) on delete cascade,
  posto     text not null,
  tempo_min int  not null default 0,
  primary key (ordem_id, posto)
);
alter table public.sf_ordem_burnin enable row level security;
create policy sf_ordem_burnin_select on public.sf_ordem_burnin
  for select using (tem_permissao('visualizar'));
create policy sf_ordem_burnin_admin on public.sf_ordem_burnin
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

insert into public.sf_ordem_burnin (ordem_id, posto, tempo_min)
select o.id, op.posto, o.tempo_min_burnin
from public.sf_ordens o
join public.sf_ordem_postos op on op.ordem_id = o.id
join public.sf_postos p        on p.chave = op.posto
join public.sf_posto_perfis pf on pf.chave = p.perfil
where pf.recurso = 'burnin' and o.tempo_min_burnin > 0
on conflict (ordem_id, posto) do nothing;
