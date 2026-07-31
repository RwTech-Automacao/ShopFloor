-- =============================================================
-- Corrige o posto de sf_integracoes usando o posto REAL gravado
-- nos registros da integração (sf_registros.id_integracao = codigo).
-- O 0066 assumiu 'Integração' pra todas; integrações feitas noutro
-- posto de Integração (ex.: 'Teste Integração') ficavam rotuladas
-- errado, mantendo o falso "produto já integrado".
-- =============================================================

update public.sf_integracoes g
set posto = sub.posto
from (
  select id_integracao, min(posto) as posto
  from public.sf_registros
  where id_integracao <> '' and posto <> ''
  group by id_integracao
) sub
where sub.id_integracao = g.codigo and sub.posto <> g.posto;
