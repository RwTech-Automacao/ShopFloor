-- =============================================================
-- Espelho dos logs de teste do repinmetro (tela Teste Qualidade).
-- Alimentada pelo conector (tools/repinmetro-conector/) via service_role.
-- O ShopFloor só LÊ (tela "Repinmetro" em Análise, consulta por Nº de Série).
-- Chave de origem = teste.id (sequencial +1) → origem_id (watermark do conector).
-- =============================================================
create table public.repinmetro_logs (
  origem_id      bigint primary key,          -- teste.id na origem (watermark; upsert por aqui)
  numero_serie   text not null,               -- numeroserierep (produto final) — chave de consulta
  numero_serie_norm text not null default '', -- SN normalizado (sem zeros à esquerda etc.) — busca "13976" acha "0013976"
  modelo         text,                        -- serialmodelorep
  data_inicio    timestamptz,                 -- datahorainicio
  data_fim       timestamptz,                 -- datahorafim
  status         text,                        -- status geral do teste
  observacao     text,
  remanufaturado text,
  lacre          text,
  op_codigo      text,                        -- codigoop  (bônus p/ v2: ligar à placa do ShopFloor)
  op_ano         text,                        -- anoop
  placa_op       text,                        -- numeroplacaop
  resultados     jsonb not null default '{}'::jsonb,  -- 15 itens (statusteste*), chave = coluna de origem
  espelhado_em   timestamptz not null default now()   -- quando o conector trouxe esta linha
);

create index repinmetro_logs_numero_serie on public.repinmetro_logs (numero_serie);
create index repinmetro_logs_numero_serie_norm on public.repinmetro_logs (numero_serie_norm);

alter table public.repinmetro_logs enable row level security;
-- Leitura: quem pode visualizar. Escrita: só o conector (service_role bypassa RLS);
-- a policy de admin cobre correção manual pela equipe.
create policy repinmetro_logs_select on public.repinmetro_logs
  for select using (tem_permissao('visualizar'));
create policy repinmetro_logs_admin on public.repinmetro_logs
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- Modelos distintos (pro filtro suspenso da tela). SECURITY DEFINER: só devolve nomes de modelo
-- (não sensível) e a action checa 'visualizar' antes de chamar; evita entraves de RLS dentro do RPC.
create or replace function public.repinmetro_modelos()
returns table (modelo text)
language sql stable security definer set search_path = public as $$
  select distinct modelo
  from public.repinmetro_logs
  where modelo is not null and btrim(modelo) <> ''
  order by modelo
$$;
grant execute on function public.repinmetro_modelos() to anon, authenticated;
