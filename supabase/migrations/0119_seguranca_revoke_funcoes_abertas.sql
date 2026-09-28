-- =============================================================
-- Segurança: fecha funções SECURITY DEFINER que qualquer um conseguia chamar pela API.
--
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem `revoke ... from public, anon`, a anon key
-- (pública, está no JavaScript do navegador) chama a função direto no PostgREST, sem login.
--
-- sf_aposentar_caixa (0100): não confere permissão e renomeia caixas (CX[n] → CX[n]R…), reescrevendo
-- numero_caixa em sf_registros. Só é usada POR DENTRO de sf_nqa_caixa (que é SECURITY DEFINER e roda
-- como dona) — então ninguém de fora precisa chamá-la. Revisão de segurança de 21/09/2026.
--
-- repinmetro_modelos (0077): tinha grant explícito pro anon; a tela só chama com usuário logado.
-- =============================================================

revoke all on function public.sf_aposentar_caixa(text, text, text, text) from public, anon, authenticated;

revoke all on function public.repinmetro_modelos() from public, anon;
grant execute on function public.repinmetro_modelos() to authenticated, service_role;

notify pgrst, 'reload schema';
