-- Fluxo — #1 (D2 pragmático): tempo típico entre postos consecutivos.
-- Por par (origem→destino) da cadeia, mediana do tempo entre o 1º registro da peça na origem e no
-- destino, DESCARTANDO trajetos noturnos/longos (proxy da jornada, sem config): >4h OU dias diferentes.
-- Jornada configurável (turno/almoço) = fase 2. Idempotente. ⚠️ numeração 0084 a reconciliar com gaps.

create or replace function public.sf_fluxo_tempos(p_pmo text, p_op text)
returns table (origem text, destino text, segundos int)
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
  with ordem as ( -- postos do fluxo desta OP em sequência (row_number evita depender de 'ordem' sem gaps)
    select op2.posto, row_number() over (order by op2.ordem) as rn
    from sf_ordens o
    join sf_ordem_postos op2 on op2.ordem_id = o.id
    where o.pmo = p_pmo and o.op = p_op
  ),
  pares as ( -- pares consecutivos origem→destino
    select a.posto as origem, b.posto as destino
    from ordem a
    join ordem b on b.rn = a.rn + 1
  ),
  primeiro as ( -- 1º registro de cada peça em cada posto (quando "passou" por ele)
    select distinct on (posto, numero_serie_norm) posto, numero_serie_norm, data_hora
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
    order by posto, numero_serie_norm, data_hora asc, created_at asc
  ),
  transitos as ( -- por par + peça: tempo entre passar na origem e no destino
    select pr.origem, pr.destino,
           extract(epoch from (pd.data_hora - po.data_hora)) as seg,
           (po.data_hora::date = pd.data_hora::date) as mesmo_dia
    from pares pr
    join primeiro po on po.posto = pr.origem
    join primeiro pd on pd.posto = pr.destino and pd.numero_serie_norm = po.numero_serie_norm
    where pd.data_hora > po.data_hora
  ),
  validos as ( -- descarta noturnos/longos (proxy da jornada)
    select origem, destino, seg
    from transitos
    where seg <= 4 * 3600 and mesmo_dia
  )
  select origem, destino,
         round(percentile_cont(0.5) within group (order by seg))::int as segundos
  from validos
  group by origem, destino;
end;
$func$;

grant execute on function public.sf_fluxo_tempos(text, text) to authenticated;
