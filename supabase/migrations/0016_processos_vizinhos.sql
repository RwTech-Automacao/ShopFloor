-- Vizinhos (anterior/próximo) de um processo na ORDEM da lista (feature 3b):
-- 'Aguardando data de chegada' (data_chegada nula) no topo → meses do mais
-- recente ao mais antigo → número desc dentro do grupo; respeitando busca/status.
-- SECURITY INVOKER: respeita o RLS (só considera processos que o usuário vê).
create or replace function public.processos_vizinhos(
  p_id uuid, p_busca text default null, p_status text default null
)
returns table (anterior uuid, proximo uuid)
language sql stable security invoker set search_path = public
as $$
  with ordenados as (
    select id,
      lag(id)  over w as ant,
      lead(id) over w as prox
    from public.processos_recebimento
    where (p_status is null or status = p_status)
      and (p_busca is null
           or numero_nf ilike '%' || p_busca || '%'
           or numero_pedido ilike '%' || p_busca || '%'
           or fornecedor ilike '%' || p_busca || '%'
           or codigo_material ilike '%' || p_busca || '%'
           or descricao_material ilike '%' || p_busca || '%')
    window w as (
      order by (data_chegada is not null) asc,
               date_trunc('month', data_chegada) desc,
               numero desc
    )
  )
  select ant, prox from ordenados where id = p_id;
$$;
grant execute on function public.processos_vizinhos(uuid, text, text) to authenticated;
