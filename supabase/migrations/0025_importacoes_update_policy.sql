-- Bug: "Nº de processos" na tela de Importações vinha SEMPRE zerado.
--
-- Causa raiz: a RPC `importar_processos` é SECURITY INVOKER (roda como o usuário
-- que importa). Depois de inserir os processos ela faz
--   `update importacoes set total_processos_criados = <n> where id = <import>`.
-- Como `importacoes` só tinha policy de INSERT e SELECT (nenhuma de UPDATE), a
-- RLS filtrava esse UPDATE SILENCIOSAMENTE (0 linhas afetadas, sem erro) — então
-- a coluna permanecia no seu default 0. O log da importação registrava o total
-- correto (é INSERT, que tem policy), por isso o valor certo existia no log mas
-- não na coluna.
--
-- Correção: policy de UPDATE com escopo mínimo — o dono da importação
-- (`usuario_id = auth.uid()`, setado no próprio INSERT da RPC) pode atualizar a
-- própria linha. O WITH CHECK impede reatribuir a importação a outro usuário.
create policy importacoes_update on public.importacoes
  for update
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Backfill: corrige as importações que ficaram com 0 por causa do bug, usando a
-- contagem real de processos ligados a cada importação. (Roda como o dono da
-- migração, que não passa pela RLS.)
update public.importacoes i
set total_processos_criados = (
  select count(*) from public.processos_recebimento p where p.importacao_id = i.id
);
