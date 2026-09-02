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
-- Este script NÃO reescreve as políticas na mão (são 84 cláusulas). Ele lê as políticas atuais do
-- catálogo e reaplica cada uma com o subselect, e SÓ quando a expressão é uma chamada pura
-- `tem_permissao('modulo','permissao')` — sem referência a coluna da linha. Qualquer política com
-- expressão composta é PULADA e listada no aviso, pra tratarmos caso a caso.
-- =============================================================
do $$
declare
  r          record;
  novo_qual  text;
  novo_check text;
  cmd        text;
  ajustadas  int  := 0;
  pulados    text := '';
  -- chamada PURA: tem_permissao('x'[::text], 'y'[::text]) e nada mais
  padrao     text := '^tem_permissao\(''[^'']+''(::text)?, *''[^'']+''(::text)?\)$';
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

    if r.qual is not null and r.qual like '%tem_permissao%' then
      if r.qual ~ padrao then
        novo_qual := '(select ' || r.qual || ')';
      else
        pulados := pulados || format(E'\n  - %s.%s / %s (USING): %s',
                                     r.schemaname, r.tablename, r.policyname, r.qual);
      end if;
    end if;

    if r.with_check is not null and r.with_check like '%tem_permissao%' then
      if r.with_check ~ padrao then
        novo_check := '(select ' || r.with_check || ')';
      else
        pulados := pulados || format(E'\n  - %s.%s / %s (WITH CHECK): %s',
                                     r.schemaname, r.tablename, r.policyname, r.with_check);
      end if;
    end if;

    if novo_qual is not null or novo_check is not null then
      cmd := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if novo_qual  is not null then cmd := cmd || ' using '      || novo_qual;  end if;
      if novo_check is not null then cmd := cmd || ' with check ' || novo_check; end if;
      execute cmd;
      ajustadas := ajustadas + 1;
    end if;
  end loop;

  raise notice 'Politicas ajustadas (tem_permissao -> subselect): %', ajustadas;
  if pulados <> '' then
    raise notice 'PULADAS (expressao composta, tratar a mao):%', pulados;
  else
    raise notice 'Nenhuma politica composta — todas ajustadas.';
  end if;
end
$$;

notify pgrst, 'reload schema';
