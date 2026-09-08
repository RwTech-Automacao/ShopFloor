-- Fluxo — Onda 3: contagens por PERÍODO (janela de tempo) por posto.
-- Usada pra (a) cadência = minutos_da_janela ÷ registros no posto; (b) "produção do turno" no card.
-- O cliente soma faixas (ex.: Dia = matutino + vespertino em 2 chamadas). WIP/1ª-passagem seguem no sf_fluxo_op.
-- Idempotente. Mesmo gate/segurança das RPCs do Fluxo (0088/0089).

create or replace function public.sf_fluxo_periodo(
  p_pmo text, p_op text, p_ini timestamptz, p_fim timestamptz
)
returns table (posto text, registros int, aprovadas int, reprovadas int)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  select posto,
         count(*)::int                                              as registros,
         count(*) filter (where lower(status) = 'aprovado')::int    as aprovadas,
         count(*) filter (where lower(status) = 'reprovado')::int   as reprovadas
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
    and data_hora >= p_ini and data_hora < p_fim
  group by posto;
end;
$func$;

grant execute on function public.sf_fluxo_periodo(text, text, timestamptz, timestamptz) to authenticated;
