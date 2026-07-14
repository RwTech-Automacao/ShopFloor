-- Limpa o `lista_chave` "morto" dos campos calculados. Campos como Amostral,
-- Atraso, Crítico? e Divergência viraram calculados na 0010 (o valor vem de
-- fórmula/tabelas — NQA, criticidade, datas), mas mantiveram o `lista_chave`
-- antigo de quando eram campos de lista. Esse vínculo obsoleto faz a checagem
-- "lista em uso" (excluirListaAction) dar falso positivo e a FK
-- configuracao_campos.lista_chave -> listas(chave) barrar a exclusão dessas
-- listas. Um campo calculado não usa dropdown, então o vínculo deve ser nulo.
update public.configuracao_campos
set lista_chave = null
where calculado = true
  and lista_chave is not null;
