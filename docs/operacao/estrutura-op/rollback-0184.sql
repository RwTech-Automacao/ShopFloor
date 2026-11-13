-- Rollback da 0184 (estrutura da OP). Roda numa transação (psql -1).
--
-- ⚠️ ANTES DE TIRAR A COLUNA ordem_id: as linhas de PRT pendentes são canceladas. Sem o ordem_id, uma linha
-- de PRT (pmo = código da PRT, op = OP filha) fica igual a uma linha da PMO, e o adaptador do Compels a
-- mandaria pelo caminho do Almoxarifado, sem a chave COMPELS_PRT_LIGADO nem a liberação pela OP-pai.
-- As enviadas (ok) não são tocadas: o que já chegou ao ERP fica como histórico.
--
-- ROLLBACK SÓ DO APP (voltar a versão do app e MANTER a 0184 no banco) tem a MESMA exposição: o app antigo não
-- conhece o ordem_id e trata a linha de PRT como linha da PMO. Nesse caso rode também o update abaixo (só ele)
-- e, se as triggers continuarem, ele precisa ser repetido até o app novo voltar (ou derrube as duas triggers):
--   update public.sf_estoque_envios set cancelado_em = now() where ordem_id is not null and not ok and cancelado_em is null;
update public.sf_estoque_envios set cancelado_em = now()
 where ordem_id is not null and not ok and cancelado_em is null;

drop trigger if exists sf_registros_trecho_ins on public.sf_registros;
drop trigger if exists sf_registros_trecho_del on public.sf_registros;
drop function if exists public.sf_salvar_estrutura(text, jsonb, text, text);
drop function if exists public.sf_trecho_enfileirar();
drop function if exists public.sf_trecho_desfazer();
drop function if exists public.sf_trecho_chave(uuid, text, text, text, text);
drop function if exists public.sf_resumo_trechos_op(text, text);
drop index if exists public.sf_estoque_envios_ordem;
drop index if exists public.sf_estoque_envios_ordem_alvo;
alter table public.sf_estoque_envios drop column if exists ordem_id;
drop table if exists public.sf_ordem_trechos;
drop table if exists public.sf_estrutura_trechos;
drop table if exists public.sf_estruturas;
notify pgrst, 'reload schema';
