-- =============================================================
-- Reparo: a rota de retorno respeita a ROTA DA OP.
--
-- BUG (apontado em 06/11/2026): `sf_postos.retorno_pos_manutencao` é configurado POR POSTO (ex.: Teste =
-- 'Inspeção PTH'), não por OP. A `sf_registrar_reparo` (0102/0103) copiava a lista inteira para o `posto_retorno`
-- da peça, e a `sf_lancar` (0103) recusa qualquer outro posto com RETESTE_PENDENTE até o primeiro da lista ser
-- passado. Numa OP SEM a Inspeção PTH na rota, a peça reparada passava a dever um posto que a OP não tem: ninguém
-- consegue lançar ali, e a peça FICAVA PRESA depois da Manutenção.
--
-- CORREÇÃO: a lista é filtrada pelos postos que a rota da OP (`sf_ordem_postos`) realmente tem, na mesma ordem.
-- Sobrando só o posto de origem (ou nada), a peça volta direto pra ele, como sempre foi sem configuração. A dívida
-- que a peça JÁ carrega (reprova no meio da rota) passa pelo mesmo filtro — assim a peça presa se solta na próxima
-- ida à Manutenção; as que já estão presas hoje saem pelo script de reparo em docs/operacao/correcao-reparo-rota/.
--
-- NÃO mexe na `sf_lancar`. Só SQL: não precisa de deploy do app. Idempotente (create or replace).
-- Corpo da `sf_registrar_reparo` idêntico ao da 0103 fora do bloco da rota, marcado "0174".
-- =============================================================

-- A lista de postos (separada por vírgula) só com os que a OP tem, na ordem da lista, sem espaços. Nulo se nenhum.
create or replace function public.sf_filtrar_rota_pela_op(p_pmo text, p_op text, p_lista text)
returns text
language sql
stable
security definer
set search_path = public
as $func$
  select nullif(string_agg(btrim(x.posto), ',' order by x.n), '')
    from unnest(string_to_array(coalesce(p_lista, ''), ',')) with ordinality as x(posto, n)
   where btrim(x.posto) <> ''
     and exists (select 1
                   from public.sf_ordens o
                   join public.sf_ordem_postos op on op.ordem_id = o.id
                  where o.pmo = p_pmo and o.op = p_op and op.posto = btrim(x.posto))
$func$;

revoke all on function public.sf_filtrar_rota_pela_op(text, text, text) from public, anon, authenticated;

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
as $func$
declare
  v_rota      text;
  v_rota_atual text;
  v_cfg       text;
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

  -- A peça JÁ devia uma rota? Então o reparo não a inventa de novo nem a apaga: preserva.
  -- É o caso da reprova no meio do caminho — reprovou na Inspeção PTH, veio pra cá, e continua
  -- devendo "Inspeção PTH, depois Teste". Ler a configuração do posto de origem aqui daria a rota
  -- ERRADA: a origem passou a ser a Inspeção PTH, que não tem configuração nenhuma, e a peça
  -- voltaria direto pro Teste — exatamente o furo que a 0103 fecha do outro lado.
  select nullif(trim(posto_retorno), '') into v_rota_atual
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = p_sn_norm
  order by data_hora desc, created_at desc
  limit 1;

  if v_rota_atual is not null then
    -- 0174: a dívida de rota que a peça JÁ carrega também é filtrada pela rota DESTA OP. É o que destrava a peça que
    -- ficou presa antes desta migração (devendo um posto que a OP não tem) quando ela volta à Manutenção.
    v_rota := public.sf_filtrar_rota_pela_op(p_pmo, p_op, v_rota_atual);
  else
    -- Primeira ida à Manutenção: a rota sai da configuração do posto que reprovou, MAS só com os postos que a rota
    -- DESTA OP tem (0174). Antes a lista ia inteira: numa OP sem Inspeção PTH a peça passava a dever um posto que
    -- ninguém consegue lançar (RETESTE_PENDENTE) e ficava presa.
    select nullif(trim(retorno_pos_manutencao), '') into v_cfg
    from sf_postos where chave = p_posto_origem;
    v_rota := public.sf_filtrar_rota_pela_op(p_pmo, p_op, v_cfg);
    if v_rota is not null then
      v_rota := v_rota || ',' || p_posto_origem;
    end if;
  end if;

  -- Sobrou só o posto de origem (ou nada): volta direto pra ele, como sempre foi sem configuração.
  if v_rota is not null and position(',' in v_rota) = 0 then
    v_rota := null;
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
$func$;

notify pgrst, 'reload schema';
