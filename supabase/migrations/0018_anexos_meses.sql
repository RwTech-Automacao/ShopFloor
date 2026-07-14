-- Export mensal de fotos (subsistema B): RPCs de agrupamento por mês da data de
-- chegada e de listagem das fotos de um mês (para o ZIP e a limpeza).

-- Contagem de fotos por mês da data de chegada do processo. 'sem_data' agrupa
-- fotos de processos sem data de chegada. security invoker: chamado pelo
-- client de serviço (bypassa RLS) → conta todas as fotos.
create or replace function public.anexos_meses()
returns table (chave text, total bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(to_char(p.data_chegada, 'YYYY-MM'), 'sem_data') as chave,
         count(*) as total
  from public.anexos_processo a
  join public.processos_recebimento p on p.id = a.processo_id
  group by 1;
$$;
grant execute on function public.anexos_meses() to authenticated, service_role;

-- Fotos de um mês (para montar o ZIP e para a limpeza). Ordenadas por numero do
-- processo e created_at → o índice da foto dentro do processo é estável.
-- p_mes no formato 'YYYY-MM' ou 'sem_data'.
create or replace function public.anexos_do_mes(p_mes text)
returns table (
  id uuid,
  path text,
  mime text,
  numero bigint,
  numero_pedido text,
  codigo_material text
)
language sql stable security invoker set search_path = public as $$
  select a.id, a.path, a.mime, p.numero, p.numero_pedido, p.codigo_material
  from public.anexos_processo a
  join public.processos_recebimento p on p.id = a.processo_id
  where coalesce(to_char(p.data_chegada, 'YYYY-MM'), 'sem_data') = p_mes
  order by p.numero, a.created_at;
$$;
grant execute on function public.anexos_do_mes(text) to authenticated, service_role;
