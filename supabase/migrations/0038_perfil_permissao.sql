-- =============================================================
-- RBAC por módulo — Fase 1. Grants por (perfil, módulo, permissão).
-- Fonte da verdade granular; as colunas pode_* seguem como derivadas p/ o RLS.
-- Popula a partir dos flags atuais (preserva o comportamento dos perfis).
-- =============================================================

create table public.perfil_permissao (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  modulo    text not null,
  permissao text not null,
  primary key (perfil_id, modulo, permissao)
);
alter table public.perfil_permissao enable row level security;
create policy perfil_permissao_select on public.perfil_permissao
  for select using (tem_permissao('visualizar'));
create policy perfil_permissao_admin on public.perfil_permissao
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- Popular a partir dos flags atuais de cada perfil:
insert into public.perfil_permissao (perfil_id, modulo, permissao)
select p.id, m.modulo, m.permissao
from public.perfis p
cross join lateral (values
  ('recebimento','visualizar', p.pode_visualizar),
  ('recebimento','importar', p.pode_importar),
  ('recebimento','editar', p.pode_editar),
  ('recebimento','finalizar', p.pode_finalizar),
  ('recebimento','editar_finalizado', p.pode_editar_finalizado),
  ('recebimento','excluir', p.pode_excluir),
  ('recebimento','gerar_etiqueta', p.pode_gerar_etiqueta),
  ('recebimento','administrar', p.pode_administrar),
  ('shopfloor','visualizar', p.pode_visualizar),
  ('shopfloor','lancar', p.pode_lancar),
  ('shopfloor','administrar', p.pode_administrar),
  ('sistema','administrar', p.pode_administrar)
) as m(modulo, permissao, tem)
where m.tem
on conflict do nothing;
