-- =============================================================
-- Reclassificação: no catálogo, códigos cujo NÚMERO INICIAL tem
-- 4 dígitos são, na verdade, CONSERTOS (processo da Enterplak).
-- Os de 3 dígitos continuam defeitos. Move de sf_defeitos → sf_consertos.
-- Idempotente (on conflict + delete). Regex: exatamente 4 dígitos no início
-- (5+ dígitos, ex.: '99998 TESTE', NÃO são pegos).
-- =============================================================
insert into public.sf_consertos (codigo)
  select codigo from public.sf_defeitos where codigo ~ '^[0-9]{4}([^0-9]|$)'
  on conflict (codigo) do nothing;

delete from public.sf_defeitos where codigo ~ '^[0-9]{4}([^0-9]|$)';
