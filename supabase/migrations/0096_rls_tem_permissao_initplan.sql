-- =============================================================
-- PERFORMANCE (raiz da lentidão do sistema inteiro): RLS chamando tem_permissao POR LINHA.
--
-- Diagnóstico medido no Prod (02/09/2026):
--   set role anon; select id from sf_registros limit 1;
--   → Seq Scan ... Filter: tem_permissao('shopfloor','visualizar')
--     Rows Removed by Filter: 27616   ← a função rodou 27.616 vezes
--     Execution Time: 401 ms          ← a MESMA consulta como superusuário: 0,086 ms
--
-- Causa: `tem_permissao` é SECURITY DEFINER + SET search_path, então o Postgres não consegue
-- "inlinear" a função. Na política de RLS ela vira um Filter avaliado LINHA A LINHA, e cada
-- chamada faz um join em usuarios+perfil_permissao.
--
-- Correção: envolver a chamada num subselect — `using ((select tem_permissao(...)))`. Como a
-- expressão não referencia nenhuma coluna da linha, o Postgres passa a avaliá-la UMA VEZ por
-- consulta (InitPlan / One-Time Filter) em vez de por linha.
--
-- ⚠️ A SEMÂNTICA NÃO MUDA: quem podia ver continua vendo exatamente o mesmo. Só muda QUANTAS
-- VEZES o Postgres executa a checagem.
--
-- Este script NÃO reescreve as políticas na mão (são 57 políticas vivas). Ele lê cada política do
-- catálogo e envolve CADA CHAMADA `tem_permissao(...)` num subselect, preservando o resto da
-- expressão intacto. Isso é essencial porque há políticas que misturam a permissão com colunas da
-- linha — nessas, envolver a expressão INTEIRA quebraria. Exemplos reais do Prod:
--
--   tem_permissao('visualizar')                                → (select tem_permissao('visualizar'))
--   (tem_permissao('rec','importar') OR tem_permissao('rec','administrar'))
--                                                              → cada chamada vira (select ...)
--   (tem_permissao('rec','editar') AND status = ANY (...))     → só a chamada é envolvida; `status` fica
--   ((id = auth.uid()) OR tem_permissao('sistema','administrar')) → idem, `id` fica de fora
--
-- Cobre as duas sobrecargas da função (1 e 2 argumentos). Idempotente: se já estiver envolvida,
-- a política é ignorada.
-- =============================================================
do $$
declare
  r          record;
  novo_qual  text;
  novo_check text;
  cmd        text;
  ajustadas  int := 0;
  -- Os argumentos são sempre literais ('x'::text) — sem parênteses aninhados — então este padrão
  -- casa a chamada inteira com segurança, em qualquer aridade.
  padrao     text := 'tem_permissao\(([^()]*)\)';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where (qual       is not null and qual       like '%tem_permissao%')
       or (with_check is not null and with_check like '%tem_permissao%')
    order by schemaname, tablename, policyname
  loop
    novo_qual  := null;
    novo_check := null;

    -- `( SELECT tem_permissao` = já ajustada numa execução anterior → não mexe (idempotência).
    if r.qual is not null and r.qual like '%tem_permissao%'
       and r.qual not like '%( SELECT tem_permissao%' then
      novo_qual := regexp_replace(r.qual, padrao, '(select tem_permissao(\1))', 'g');
    end if;

    if r.with_check is not null and r.with_check like '%tem_permissao%'
       and r.with_check not like '%( SELECT tem_permissao%' then
      novo_check := regexp_replace(r.with_check, padrao, '(select tem_permissao(\1))', 'g');
    end if;

    if novo_qual is not null or novo_check is not null then
      cmd := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if novo_qual  is not null then cmd := cmd || ' using ('      || novo_qual  || ')'; end if;
      if novo_check is not null then cmd := cmd || ' with check (' || novo_check || ')'; end if;
      execute cmd;
      ajustadas := ajustadas + 1;
      raise notice '  ok: %.% / %', r.schemaname, r.tablename, r.policyname;
    end if;
  end loop;

  raise notice 'Politicas ajustadas (tem_permissao -> subselect): %', ajustadas;
end
$$;

-- Conferência: depois de rodar, NENHUMA política pode sobrar com chamada "solta".
do $$
declare faltando int;
begin
  select count(*) into faltando
  from pg_policies
  where (qual       like '%tem_permissao%' and qual       not like '%( SELECT tem_permissao%')
     or (with_check like '%tem_permissao%' and with_check not like '%( SELECT tem_permissao%');
  if faltando > 0 then
    raise warning 'ATENCAO: % politica(s) ainda com tem_permissao fora do subselect', faltando;
  else
    raise notice 'Conferencia OK: nenhuma politica com tem_permissao solta.';
  end if;
end
$$;

notify pgrst, 'reload schema';
