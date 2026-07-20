-- Marca contas que ainda usam senha temporária e precisam trocar no 1º acesso.
-- default true → toda conta nova (criada pelo trigger handle_new_user) nasce
-- provisória sem código extra. As contas já existentes recebem false (já têm
-- senha real definida por elas ou pelo gestor).
alter table public.usuarios
  add column senha_provisoria boolean not null default true;

update public.usuarios set senha_provisoria = false;
