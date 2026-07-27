-- =============================================================
-- Fix: handle_new_user quebrava a criação de usuário quando não existe um perfil
-- chamado exatamente 'Consulta' (ex.: renomeado p/ 'Consulta Recebimento') →
-- perfil_padrao NULL → viola NOT NULL de usuarios.perfil_id → createUser 500.
-- O perfil default é só um PLACEHOLDER transitório (a action de criar usuário
-- sobrescreve pelo perfil escolhido logo em seguida). Tornamos robusto: se não
-- houver 'Consulta', cai no perfil de MENOR privilégio (nunca insere NULL).
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil_padrao uuid;
begin
  select id into perfil_padrao from public.perfis where nome = 'Consulta' limit 1;
  if perfil_padrao is null then
    -- fallback resiliente: perfil de menor privilégio (pode_administrar=false primeiro)
    select id into perfil_padrao from public.perfis order by pode_administrar, created_at limit 1;
  end if;
  insert into public.usuarios (id, email, nome, perfil_id)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nome', ''), perfil_padrao);
  return new;
end;
$$;
