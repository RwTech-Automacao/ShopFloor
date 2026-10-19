-- =============================================================
-- Perfil "almoxarifado": o último posto da linha, onde o bipe do que foi embalado
-- registra a entrada no estoque.
--
-- Não tem status (não julga a peça) e não exige manutenção. O gate é 'registrado' e não
-- 'aprovado' porque a peça já foi aprovada antes de ser embalada — exigir aprovação de novo
-- recusaria tudo o que veio de um posto de passagem, como a própria Embalagem.
--
-- Atribuível no Cadastrar Posto: ao contrário da Manutenção, nada aqui depende do NOME do posto.
-- =============================================================

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso)
values ('almoxarifado', 'Almoxarifado', false, 'nenhum', 'registrado', false, 'almoxarifado')
on conflict (chave) do update
  set nome = excluded.nome,
      tem_status = excluded.tem_status,
      reprova = excluded.reprova,
      gate = excluded.gate,
      exige_manutencao = excluded.exige_manutencao,
      recurso = excluded.recurso;

notify pgrst, 'reload schema';
