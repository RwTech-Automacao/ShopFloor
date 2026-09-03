-- =============================================================
-- ROLLBACK da migração 0096 (RLS: tem_permissao dentro de subselect).
--
-- ⚠️ NÃO é uma migração — é o plano de volta. Fica fora de supabase/migrations/ de propósito,
--    pra não ser aplicado por engano numa sequência de migrações.
--
-- O que faz: desfaz o `(select tem_permissao(...))` de volta para `tem_permissao(...)`,
-- restaurando exatamente o estado anterior das políticas. A permissão em si nunca muda —
-- só volta a ser avaliada linha a linha (ou seja: volta a ficar LENTO).
--
-- Uso:  psql "host=... sslmode=require" -f docs/rollback-0096-rls.sql
-- =============================================================
do $$
declare
  r          record;
  novo_qual  text;
  novo_check text;
  cmd        text;
  revertidas int := 0;
  -- casa o subselect que a 0096 criou, capturando a chamada original
  padrao     text := '\( SELECT (tem_permissao\([^()]*\))\)';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where (qual       is not null and qual       like '%( SELECT tem_permissao%')
       or (with_check is not null and with_check like '%( SELECT tem_permissao%')
    order by schemaname, tablename, policyname
  loop
    novo_qual  := null;
    novo_check := null;

    if r.qual is not null and r.qual like '%( SELECT tem_permissao%' then
      novo_qual := regexp_replace(r.qual, padrao, '\1', 'g');
    end if;

    if r.with_check is not null and r.with_check like '%( SELECT tem_permissao%' then
      novo_check := regexp_replace(r.with_check, padrao, '\1', 'g');
    end if;

    if novo_qual is not null or novo_check is not null then
      cmd := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if novo_qual  is not null then cmd := cmd || ' using ('      || novo_qual  || ')'; end if;
      if novo_check is not null then cmd := cmd || ' with check (' || novo_check || ')'; end if;
      execute cmd;
      revertidas := revertidas + 1;
    end if;
  end loop;

  raise notice 'Politicas revertidas ao formato original: %', revertidas;
end
$$;

notify pgrst, 'reload schema';
