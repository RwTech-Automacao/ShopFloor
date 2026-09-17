-- =============================================================
-- Módulo Setup (montagem de setup e abastecimento de componentes).
-- O módulo é só uma chave nova em perfil_permissao (sem CHECK de módulo): esta migração apenas
-- dá acesso inicial a quem já administra o sistema, pra alguém conseguir configurar os perfis.
-- =============================================================
insert into public.perfil_permissao (perfil_id, modulo, permissao)
select pp.perfil_id, 'setup', p.permissao
from public.perfil_permissao pp
cross join (values ('visualizar'), ('lancar'), ('administrar')) as p(permissao)
where pp.modulo = 'sistema' and pp.permissao = 'administrar'
on conflict do nothing;

notify pgrst, 'reload schema';
