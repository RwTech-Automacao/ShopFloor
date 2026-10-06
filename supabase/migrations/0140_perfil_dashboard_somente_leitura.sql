-- =============================================================
-- Perfil "Dashboard (somente leitura)" — o da conta compartilhada que entra por SSO no /embed
-- (Fluxo da OP embutido no Dashboard).
-- Limita o estrago se o segredo do SSO vazar: quem entrar so enxerga o ShopFloor; nao lanca,
-- nao configura, nao apaga, nao ve Recebimento/Setup/Sistema.
--
-- Grant granular (fonte da verdade): perfil_permissao = (shopfloor, visualizar) e mais nada.
-- Coluna derivada: pode_visualizar = true, igual ao que a tela de perfis grava ao marcar
-- "visualizar" em qualquer modulo. Ela e NECESSARIA: os RPCs do Fluxo (sf_fluxo_op,
-- sf_producao_periodo ...) ainda checam a tem_permissao('visualizar') de 1 argumento, que le
-- essa coluna. As demais pode_* ficam false (default).
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
