-- Grid de Processos (Fase 1): layout das colunas da LISTA + valores distintos por coluna.

-- Layout da lista, SEPARADO de configuracao_campos (que dita o formulário do processo):
-- reordenar/ocultar coluna na lista não pode alterar a configuração dos campos.
-- `campo` é texto livre (NÃO é FK) de propósito: precisa acomodar as colunas de sistema
-- `numero` e `status`, que não existem em configuracao_campos.
create table public.colunas_lista (
  campo text primary key,
  visivel boolean not null default false,
  ordem int not null default 0
);

alter table public.colunas_lista enable row level security;

-- Todo autenticado LÊ (a lista precisa do layout para renderizar); só admin escreve
-- (a tela de editar chega na Fase 2).
create policy colunas_lista_select on public.colunas_lista
  for select to authenticated using (true);
create policy colunas_lista_write on public.colunas_lista
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));

-- Semente: as 11 colunas do padrão, visíveis, na ordem acordada.
insert into public.colunas_lista (campo, visivel, ordem) values
  ('numero', true, 1),
  ('numero_nf', true, 2),
  ('numero_emb', true, 3),
  ('di_inpi', true, 4),
  ('acp_cliente', true, 5),
  ('numero_pedido', true, 6),
  ('tipo', true, 7),
  ('fornecedor', true, 8),
  ('codigo_material', true, 9),
  ('data_chegada', true, 10),
  ('status', true, 11);

-- Os demais campos do catálogo nascem OCULTOS. Offset 100 para, quando forem ligados
-- na Fase 2, aparecerem depois dos visíveis por padrão.
insert into public.colunas_lista (campo, visivel, ordem)
select c.campo, false, 100 + c.ordem
from public.configuracao_campos c
where c.ativo = true
on conflict (campo) do nothing;

-- Valores distintos de uma coluna, para a lista de checkbox do filtro (estilo Excel).
-- É o ÚNICO ponto do projeto com SQL dinâmico — por isso a whitelist é obrigatória.
-- O tipo é resolvido ANTES de montar o SQL: um CASE com to_char() não compilaria para
-- coluna de texto (o Postgres resolve a assinatura da função no plan time).
create or replace function public.valores_distintos_processos(
  p_coluna text,
  p_limite int default 200
)
returns table (valor text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tipo text;
begin
  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'processos_recebimento'
    and column_name = p_coluna;

  if v_tipo is null then
    raise exception 'coluna inválida: %', p_coluna;
  end if;

  if v_tipo = 'date' then
    -- Coluna de data: o valor distinto é o MÊS ('YYYY-MM'), e nulo vira 'sem_data' —
    -- é assim que o usuário filtra o mês, substituindo o accordion.
    return query execute format(
      'select distinct coalesce(to_char(%I, ''YYYY-MM''), ''sem_data'') as valor
         from public.processos_recebimento
        order by 1
        limit %L',
      p_coluna, p_limite
    );
  else
    -- Demais colunas: valores reais, sem nulos (filtrar "vazio" fica fora da Fase 1).
    return query execute format(
      'select distinct %I::text as valor
         from public.processos_recebimento
        where %I is not null
        order by 1
        limit %L',
      p_coluna, p_coluna, p_limite
    );
  end if;
end $$;

grant execute on function public.valores_distintos_processos(text, int) to authenticated;
