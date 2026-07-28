-- Índices de performance para a Tela de Registros (log de produção).
-- sf_registros cresce grande (dezenas de milhares de linhas); a tela ordena por
-- data_hora desc e filtra por cliente. Índices aditivos, sem alterar dados/RLS.
create index if not exists sf_registros_data_hora
  on public.sf_registros (data_hora desc);
create index if not exists sf_registros_cliente_data
  on public.sf_registros (cliente, data_hora desc);
