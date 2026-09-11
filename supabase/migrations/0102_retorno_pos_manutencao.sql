-- =============================================================
-- Retorno pós-manutenção: a peça reparada passa por um posto intermediário antes de voltar.
--
-- Regra do chão de fábrica: peça reprovada no Teste, depois de reparada, tem que passar pela
-- Inspeção PTH antes de ser testada de novo — e se reprovar na inspeção, volta pra Manutenção.
--
--   Teste reprova → Manutenção → Inspeção PTH → Teste
--                                    ↓ reprova      ↓ reprova
--                                 Manutenção     Manutenção
--
-- NADA DISSO É MECANISMO NOVO. É o mesmo `posto_retorno` que roteia a reprova do NQA desde a 0080:
-- uma lista de postos que a peça precisa repassar, em ordem, consumida um por um pelo `sf_lancar`.
-- Aqui só passamos a GRAVAR essa lista no registro de Manutenção.
--
-- E a volta pra Manutenção em caso de reprova sai de graça: o `sf_lancar` só propaga a rota quando
-- o resultado NÃO é reprovado. Reprovando, vale a regra normal do posto — que manda pra Manutenção.
--
-- CONFIGURÁVEL POR POSTO, não fixo no código nem no perfil:
--   • fixar 'Inspeção PTH' no código desfaria a generalização por perfil da 0062, que tirou toda a
--     lógica presa a NOME de posto;
--   • pôr no PERFIL daria a regra de brinde a todo posto que compartilha o perfil — hoje Teste e
--     Teste Final usam o mesmo, e podem querer caminhos diferentes.
-- =============================================================

alter table public.sf_postos
  add column if not exists retorno_pos_manutencao text not null default '';

comment on column public.sf_postos.retorno_pos_manutencao is
  'Postos que a peça deve repassar depois da Manutenção antes de voltar A ESTE posto (lista separada '
  'por vírgula, na ordem). Vazio = volta direto, como sempre foi.';

-- ---------------------------------------------------------------------------
-- sf_registrar_reparo: grava a rota de retorno nos registros de Manutenção
-- ---------------------------------------------------------------------------
-- Corpo idêntico à 0061, com uma diferença: lê o `retorno_pos_manutencao` do posto de ORIGEM (o que
-- reprovou) e grava `posto_retorno` nas linhas.
--
-- A rota termina no PRÓPRIO posto de origem: 'Inspeção PTH,Teste' quer dizer "passe pela Inspeção
-- PTH e depois volte pro Teste". Sem o posto de origem no fim, o `sf_lancar` consumiria a inspeção,
-- ficaria com a rota vazia e a peça voltaria pro Teste pela trava de sequência normal — que a
-- barraria, porque ela já passou por lá. Mesma forma que o NQA usa (postos escolhidos + o NQA no fim).
--
-- Vai nos DOIS inserts (consertos e defeitos constatados) porque o `sf_lancar` olha o ÚLTIMO
-- registro da peça, e qual dos dois é o último depende da ordem de gravação.
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
  p_consertos            jsonb,
  p_defeitos_constatados jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rota text;
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

  -- Rota do posto que reprovou. Sem configuração, `v_rota` fica null e o comportamento é o de
  -- sempre: a peça volta direto pro posto de origem.
  select nullif(trim(retorno_pos_manutencao), '') into v_rota
  from sf_postos where chave = p_posto_origem;
  if v_rota is not null then
    v_rota := v_rota || ',' || p_posto_origem;
  end if;

  -- Linhas de conserto: 1 por conserto, com o defeito relatado.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posicao, tipo_defeito, reparo_conserto, reparo_posicao, posto_origem,
    data_hora_origem, posto_retorno)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    coalesce(p_cod, ''), coalesce(p_pos, ''), coalesce(p_tipo, ''),
    coalesce(x->>'descricao', ''), coalesce(x->>'posicao', ''),
    p_posto_origem, p_data_hora_origem, v_rota
  from jsonb_array_elements(p_consertos) x;

  -- Linhas de defeito CONSTATADO: 1 por código; status '' e reparo_constatado=true.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posto_origem, data_hora_origem, reparo_constatado, posto_retorno)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    d, p_posto_origem, p_data_hora_origem, true, v_rota
  from jsonb_array_elements_text(p_defeitos_constatados) d
  where coalesce(d, '') <> '';

  return jsonb_build_object('ok', true,
    'linhas', jsonb_array_length(p_consertos),
    'constatados', jsonb_array_length(p_defeitos_constatados),
    'rota', coalesce(v_rota, ''));
end;
$$;

notify pgrst, 'reload schema';
