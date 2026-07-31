-- supabase/migrations/0061_sf_reparo_constatado.sql
-- Reparo: defeitos constatados (do catálogo) viram linhas de defeito da peça.
-- Marca a linha com reparo_constatado=true (codigo_defeito = código do catálogo).

alter table public.sf_registros
  add column if not exists reparo_constatado boolean not null default false;
comment on column public.sf_registros.reparo_constatado is
  'true = linha de defeito CONSTATADO durante o reparo (codigo_defeito = defeito do catálogo).';

-- Redefinir sf_registrar_reparo com o parâmetro novo. A aridade muda → dropar a
-- assinatura antiga primeiro (senão create-or-replace vira OVERLOAD ambíguo).
drop function if exists public.sf_registrar_reparo(
  text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb);

create or replace function public.sf_registrar_reparo(
  p_colaborador          text,
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_sn                   text,
  p_sn_norm              text,
  p_cod                  text,
  p_pos                  text,
  p_tipo                 text,
  p_posto_origem         text,
  p_data_hora_origem     timestamptz,
  p_consertos            jsonb,   -- [{descricao, posicao}]
  p_defeitos_constatados jsonb    -- ["1002 TRILHA ROMPIDA", ...] (códigos do catálogo)
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  if coalesce(jsonb_array_length(p_consertos), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSERTOS');
  end if;
  if coalesce(jsonb_array_length(p_defeitos_constatados), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSTATADOS_DEFEITO');
  end if;

  -- Linhas de conserto (INALTERADO): 1 por conserto, com o defeito relatado.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posicao, tipo_defeito, reparo_conserto, reparo_posicao, posto_origem, data_hora_origem)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    coalesce(p_cod, ''), coalesce(p_pos, ''), coalesce(p_tipo, ''),
    coalesce(x->>'descricao', ''), coalesce(x->>'posicao', ''),
    p_posto_origem, p_data_hora_origem
  from jsonb_array_elements(p_consertos) x;

  -- Linhas de defeito CONSTATADO (NOVO): 1 por código; status '' e reparo_constatado=true.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posto_origem, data_hora_origem, reparo_constatado)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    d, p_posto_origem, p_data_hora_origem, true
  from jsonb_array_elements_text(p_defeitos_constatados) d
  where coalesce(d, '') <> '';

  return jsonb_build_object('ok', true,
    'linhas', jsonb_array_length(p_consertos),
    'constatados', jsonb_array_length(p_defeitos_constatados));
end;
$$;
