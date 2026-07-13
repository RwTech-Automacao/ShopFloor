-- Contagem de processos por mês da data de chegada, para as abas/accordions da
-- lista de Processos. O GROUP BY roda no banco → escala em qualquer volume, sem
-- o teto de linhas do PostgREST (que afetaria uma contagem feita buscando todas
-- as linhas). 'sem_data' agrupa os processos ainda sem data de chegada.
--
-- SECURITY INVOKER: respeita o RLS — conta apenas os processos que o usuário
-- pode ver (política processos_select exige `visualizar`). Filtros opcionais de
-- status (igualdade) e busca livre (ilike nas mesmas colunas de
-- COLUNAS_BUSCA_PROCESSO). O termo de busca já chega sanitizado do app.
create or replace function public.processos_meses(
  p_busca text default null,
  p_status text default null
)
returns table (chave text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(to_char(data_chegada, 'YYYY-MM'), 'sem_data') as chave,
    count(*) as total
  from public.processos_recebimento
  where (p_status is null or status = p_status)
    and (
      p_busca is null
      or numero_nf ilike '%' || p_busca || '%'
      or numero_pedido ilike '%' || p_busca || '%'
      or fornecedor ilike '%' || p_busca || '%'
      or codigo_material ilike '%' || p_busca || '%'
      or descricao_material ilike '%' || p_busca || '%'
    )
  group by 1;
$$;

grant execute on function public.processos_meses(text, text) to authenticated;
