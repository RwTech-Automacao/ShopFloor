-- 0161: placas por painel. Peso do bipe gravado em sf_registros.pecas pelo trigger.
alter table public.sf_ordens
  add column if not exists placas_por_painel int not null default 1;
alter table public.sf_ordens drop constraint if exists sf_ordens_placas_por_painel_ck;
alter table public.sf_ordens
  add constraint sf_ordens_placas_por_painel_ck check (placas_por_painel >= 1);

alter table public.sf_registros
  add column if not exists pecas int not null default 1;
alter table public.sf_registros drop constraint if exists sf_registros_pecas_ck;
alter table public.sf_registros
  add constraint sf_registros_pecas_ck check (pecas >= 1);

create or replace function public.sf_registros_definir_pecas()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  new.pecas := coalesce(
    (select o.placas_por_painel from public.sf_ordens o where o.pmo = new.pmo and o.op = new.op),
    1);
  return new;
end
$func$;

drop trigger if exists sf_registros_pecas on public.sf_registros;
create trigger sf_registros_pecas before insert on public.sf_registros
  for each row execute function public.sf_registros_definir_pecas();

notify pgrst, 'reload schema';
