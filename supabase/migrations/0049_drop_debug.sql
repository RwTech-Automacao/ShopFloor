-- Limpeza dos objetos de diagnóstico criados durante a validação da Fase 2a
-- (0044 canário já removido em 0045; aqui caem as funções de debug — eram
-- SECURITY DEFINER expostas a authenticated/anon, NÃO podem sobreviver).
drop function if exists public.zz_debug_pol(text);
drop function if exists public.zz_test_perm(uuid, text, text);
drop function if exists public.zz_diag(uuid);
