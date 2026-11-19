-- Rollback da 0194 (edição de OP por trecho). Só remove as funções novas: as tabelas e as funções da 0184 ficam.
-- O app que chama sf_ordem_regravar_trechos tem que sair ANTES (a página de edição de OP com trechos passa a falhar
-- ao salvar). Idempotente: psql -1 -v ON_ERROR_STOP=1 -f docs/operacao/estrutura-op/rollback-0194.sql
drop function if exists public.sf_ordem_regravar_trechos(uuid, jsonb);
drop function if exists public.sf_faixas_sobrepoem(text, text, text, text);
drop function if exists public.sf_faixa_coerente(text, text);
notify pgrst, 'reload schema';
