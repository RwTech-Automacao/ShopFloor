-- =============================================================
-- ShopFloor Processo — Burn-in com entrada/saída.
-- Entrada = registro posto='Burn-in' status='' ; Saída = status set (+defeitos).
-- Ciclo aberto = último registro de Burn-in da peça é status=''.
-- RPC dedicada (não toca sf_lancar) + view das peças em andamento.
-- =============================================================

create or replace function public.sf_burnin(
  p_evento                text,     -- 'entrada' | 'saida'
  p_pmo                   text,
  p_op                    text,
  p_cliente               text,
  p_colaborador           text,
  p_sn                    text,
  p_sn_norm               text,
  p_status                text,     -- só na saída (Aprovado/Reprovado); '' na entrada
  p_prev_posto            text,
  p_prev_precisa_aprovado boolean,
  p_exige_manutencao      boolean,
  p_linhas                jsonb     -- defeitos na saída reprovado; [] senão
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ultimo_status text;
  v_ultima_data   timestamptz;
  v_prev_ok       boolean;
  v_tem_reparo    boolean;
  v_linha         jsonb;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- último evento de Burn-in da peça: null=nunca; ''=entrada aberta; Aprovado/Reprovado=fechado
  select status, data_hora into v_ultimo_status, v_ultima_data
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm and posto = 'Burn-in'
  order by data_hora desc
  limit 1;

  if p_evento = 'entrada' then
    if v_ultimo_status is not null and v_ultimo_status = '' then
      return jsonb_build_object('ok', false, 'erro', 'JA_DENTRO');
    end if;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'aprovado' then
      return jsonb_build_object('ok', false, 'erro', 'JA_APROVADO');
    end if;
    if v_ultimo_status is not null and lower(v_ultimo_status) = 'reprovado' and p_exige_manutencao then
      select exists(
        select 1 from sf_registros m
        where m.pmo = p_pmo and m.op = p_op and m.numero_serie_norm = p_sn_norm
          and m.posto = 'Manutenção' and m.posto_origem = 'Burn-in' and m.data_hora > v_ultima_data
      ) into v_tem_reparo;
      if not v_tem_reparo then
        return jsonb_build_object('ok', false, 'erro', 'SEM_MANUTENCAO');
      end if;
    end if;
    -- trava de sequência (posto anterior)
    if p_prev_posto <> '' then
      if p_prev_precisa_aprovado then
        select exists(select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
            and posto = p_prev_posto and lower(status) = 'aprovado') into v_prev_ok;
      else
        select exists(select 1 from sf_registros
          where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
            and posto = p_prev_posto) into v_prev_ok;
      end if;
      if not v_prev_ok then
        return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA');
      end if;
    end if;
    insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm)
    values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, '', p_sn, p_sn_norm);
    return jsonb_build_object('ok', true, 'evento', 'entrada');

  elsif p_evento = 'saida' then
    if v_ultimo_status is null or v_ultimo_status <> '' then
      return jsonb_build_object('ok', false, 'erro', 'SEM_ENTRADA');
    end if;
    if jsonb_array_length(p_linhas) = 0 then
      insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm)
      values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, p_status, p_sn, p_sn_norm);
    else
      for v_linha in select * from jsonb_array_elements(p_linhas)
      loop
        insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm,
          codigo_defeito, posicao, tipo_defeito)
        values (p_colaborador, 'Burn-in', p_pmo, p_op, p_cliente, p_status, p_sn, p_sn_norm,
          coalesce(v_linha->>'codigo_defeito', ''), coalesce(v_linha->>'posicao', ''), coalesce(v_linha->>'tipo_defeito', ''));
      end loop;
    end if;
    return jsonb_build_object('ok', true, 'evento', 'saida');

  else
    return jsonb_build_object('ok', false, 'erro', 'EVENTO_INVALIDO');
  end if;
end;
$$;

-- Peças AGORA no Burn-in (último evento é entrada). security_invoker respeita a RLS do caller.
create or replace view public.sf_burnin_aberto
with (security_invoker = true) as
select cliente, pmo, op, numero_serie, numero_serie_norm, data_hora as entrada
from (
  select distinct on (pmo, op, numero_serie_norm)
    cliente, pmo, op, numero_serie, numero_serie_norm, data_hora, status
  from public.sf_registros
  where posto = 'Burn-in'
  order by pmo, op, numero_serie_norm, data_hora desc
) ultimo
where ultimo.status = '';

grant select on public.sf_burnin_aberto to authenticated;
