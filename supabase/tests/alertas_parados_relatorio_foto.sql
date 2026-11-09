-- FOTO da alerta_travados da 0172, tirada ANTES da 0177 (alertas_parados_relatorio_test.sql compara depois).
-- A massa é a que o alertas_travados_test.sql deixou na base (T2–T9: cada caso de "parada", "terminou",
-- Manutenção, OP finalizada, sem rota, outra PMO, corte, painel). A grade cobre os 5 parâmetros.
create table public.teste_foto_cortes (corte timestamptz primary key);
insert into public.teste_foto_cortes
select now() - make_interval(secs => (d * 86400)::int) from unnest(array[0, 0.04, 1, 7, 8.5, 10, 30, 365]::numeric[]) d;
insert into public.teste_foto_cortes values ('2026-01-01 12:00:00+00'), ('2026-01-01 11:59:59+00');

create table public.teste_foto_postos (id int primary key, postos text[]);
insert into public.teste_foto_postos values
  (1, array['Inicial', 'Teste', 'Embalagem', 'Almoxarifado', 'Manutenção']),
  (2, array['Teste']), (3, array['Embalagem', 'Almoxarifado']), (4, '{}'::text[]);

create table public.teste_foto_pmos (id int primary key, pmos text[]);
insert into public.teste_foto_pmos values (1, '{}'::text[]), (2, array['PMOT']), (3, array['PMOZ', 'NADA']);

create table public.teste_foto_travados as
select c.corte, p.id as postos_id, m.id as pmos_id, a.so_ativas, b.manut, t.*
  from public.teste_foto_cortes c
 cross join public.teste_foto_postos p
 cross join public.teste_foto_pmos m
 cross join (values (true), (false)) a(so_ativas)
 cross join (values (true), (false)) b(manut)
 cross join lateral public.alerta_travados(p.postos, m.pmos, c.corte, a.so_ativas, b.manut) t;

do $t$
begin
  if (select count(*) from public.teste_foto_travados) < 50 then
    raise exception 'FOTO da 0172 pequena demais (% linhas): a massa do alertas_travados_test.sql sumiu?',
      (select count(*) from public.teste_foto_travados);
  end if;
end $t$;
