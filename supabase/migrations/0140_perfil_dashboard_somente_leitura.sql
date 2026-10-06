-- =============================================================
-- Perfil "Dashboard (somente leitura)" — o da conta compartilhada que entra por SSO no /embed
-- (Fluxo da OP embutido no Dashboard).
--
-- INDEPENDENTE da 0138 (conserto confirmado) e da 0139 (alertas): esta migracao toca SO
-- `perfis` e `perfil_permissao`, nao depende de nada que elas criem e nada nelas depende
-- dela. Pode ser aplicada fora de ordem, antes ou depois, sem risco.
--
-- Grant granular (fonte da verdade): perfil_permissao = (shopfloor, visualizar) e mais nada.
-- Coluna derivada: pode_visualizar = true, igual ao que a tela de perfis grava ao marcar
-- "visualizar" em qualquer modulo. Ela e NECESSARIA: os RPCs do Fluxo (sf_fluxo_op,
-- sf_producao_periodo ...) ainda checam a tem_permissao('visualizar') de 1 argumento, que le
-- essa coluna. As demais pode_* ficam false (default).
--
-- ⚠️ ALCANCE REAL DESTA CONTA (nao e "somente o ShopFloor"):
-- a flag `pode_visualizar` e GLOBAL, e hoje 9 policies de SELECT ainda usam a
-- tem_permissao('visualizar') de 1 argumento — entre elas TRES de outro sistema:
--   * repinmetro_logs     — logs de teste de qualidade dos repinmetros (~52 mil linhas):
--                           nº de serie, modelo, datas, status e os 15 resultados por linha;
--   * repinmetro_revendas — o serial de cada REP ligado a RAZAO SOCIAL da revenda
--                           (a relacao produto ↔ cliente final);
--   * repinmetro_producao — os seriais de cada peca montada (impressora, MRP, modulo bio,
--                           RFID, fonte, barras) + 12 resultados de teste.
-- As outras 6 sao do proprio ShopFloor (sf_caixas, sf_lotes, sf_consertos,
-- sf_conserto_confirmado, sf_ordem_burnin, sf_registros_cancelados).
--
-- FORA de alcance (ja migradas para a forma por modulo): Recebimento inteiro — processos,
-- importacoes, anexos e os arquivos no Storage (0051 e 0057) —, Setup/Abastecimento, a tabela
-- `logs` de auditoria e os Alertas (0054).
--
-- A conta nao escreve: nenhuma policy de INSERT/UPDATE/DELETE e alcancavel so com 'visualizar'.
-- A CURA do excesso de leitura e trocar as policies repinmetro_*_select para a forma de 2
-- argumentos (tem_permissao('repinmetro','visualizar')) ou migrar os 8 RPCs do Fluxo para a
-- forma por modulo. As duas mexem em tela de producao → OUTRA BRANCH, nao esta.
--
-- O USUARIO nao nasce aqui (GoTrue/auth.users nao e SQL versionado): ver
-- docs/operacao/conta-dashboard-sso.md.
-- Idempotente: pode rodar de novo sem efeito.
-- =============================================================

insert into public.perfis (nome, pode_visualizar, sistema)
values ('Dashboard (somente leitura)', true, true)
on conflict (nome) do nothing;

insert into public.perfil_permissao (perfil_id, modulo, permissao)
select p.id, 'shopfloor', 'visualizar'
  from public.perfis p
 where p.nome = 'Dashboard (somente leitura)'
on conflict do nothing;

notify pgrst, 'reload schema';
