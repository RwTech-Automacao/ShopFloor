-- =============================================================
-- TESTE DA INTEGRAÇÃO COM O COMPELS — OP 8649 (PMO PRT446) — MONTAR O CENÁRIO DE TESTE
--
-- Cria, no ShopFloor, uma OP DE TESTE com o número 8649 (a mesma do Compels) e PMO PRT446, com:
--   - rota: Embalagem -> Almoxarifado;
--   - 5 peças já embaladas (Embalagem), prontas para dar entrada no Almoxarifado:
--       TST864900001 a TST864900005 (faixa TST864900001..TST864900100; embalagem individual, 1 peça por bipe);
--   - tudo marcado com o cliente 'TESTE INTEGRACAO COMPELS' e o colaborador 'TESTE INTEGRACAO COMPELS',
--     para o 03-desmontar-cenario.sql apagar só isto.
-- Se ainda não houver posto com perfil Almoxarifado, cria o posto "Almoxarifado".
--
-- SE RECUSA (raise exception, nada é gravado) quando:
--   - a OP 8649 já existe e NÃO é de teste (cliente diferente de 'TESTE INTEGRACAO COMPELS'): é uma OP REAL;
--   - não existe nenhum posto de Embalagem cadastrado;
--   - já existem registros de outra origem nessa OP.
-- Pode rodar de novo: se o cenário de teste já existe, só completa o que faltar (não duplica nada).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/op8649-02.sql
-- =============================================================

do $func$
declare
  v_marca    constant text := 'TESTE INTEGRACAO COMPELS';
  v_pmo      constant text := 'PRT446';
  v_op       constant text := '8649';
  v_ordem    uuid;
  v_cliente  text;
  v_posto_embalagem text;
  v_posto_almox     text;
  v_ordem_emb int;
  v_n        int;
begin
  -- A OP existe? Se existir, só segue quando é a de teste.
  select id, cliente into v_ordem, v_cliente from public.sf_ordens where op = v_op;
  if found and v_cliente <> v_marca then
    raise exception 'A OP % já existe no ShopFloor e NÃO é de teste (cliente "%"). Não monte o cenário nela.', v_op, v_cliente;
  end if;

  -- Posto de Embalagem (perfil com recurso caixa): o primeiro por ordem.
  select p.chave into v_posto_embalagem
    from public.sf_postos p
    join public.sf_posto_perfis pp on pp.chave = p.perfil
   where pp.recurso = 'caixa'
   order by p.ordem, p.chave
   limit 1;
  if v_posto_embalagem is null then
    raise exception 'Não há posto de Embalagem cadastrado (perfil com recurso caixa). O cenário precisa de um.';
  end if;

  -- Posto de Almoxarifado: usa o que existir, ou cria "Almoxarifado".
  select p.chave into v_posto_almox
    from public.sf_postos p
    join public.sf_posto_perfis pp on pp.chave = p.perfil
   where pp.recurso = 'almoxarifado'
   order by p.ordem, p.chave
   limit 1;
  if v_posto_almox is null then
    insert into public.sf_postos (chave, ordem, perfil)
    values ('Almoxarifado', coalesce((select max(ordem) from public.sf_postos), 0) + 1, 'almoxarifado')
    on conflict (chave) do update set perfil = 'almoxarifado';
    v_posto_almox := 'Almoxarifado';
    raise notice 'Posto "Almoxarifado" criado (perfil almoxarifado).';
  end if;

  -- A OP de teste.
  if v_ordem is null then
    insert into public.sf_ordens (pmo, op, cliente, qtd, descricao, status, sn_ini, sn_fim, embalagem_individual)
    values (v_pmo, v_op, v_marca, 100, 'OP DE TESTE da integração com o Compels (apagar depois)', 'ATIVA',
            'TST864900001', 'TST864900100', true)
    returning id into v_ordem;
    raise notice 'OP de teste % / % criada.', v_pmo, v_op;
  end if;

  -- Rota: Embalagem -> Almoxarifado.
  select count(*) into v_n from public.sf_ordem_postos where ordem_id = v_ordem;
  if v_n = 0 then
    insert into public.sf_ordem_postos (ordem_id, posto, ordem) values
      (v_ordem, v_posto_embalagem, 1),
      (v_ordem, v_posto_almox, 2);
  end if;

  -- Registros que NÃO são de teste nessa OP: recusa.
  select count(*) into v_n from public.sf_registros where op = v_op and colaborador <> v_marca
     and posto <> v_posto_almox;
  if v_n > 0 then
    raise exception 'A OP % tem % registro(s) que não são de teste. Não monte o cenário nela.', v_op, v_n;
  end if;

  -- 5 peças embaladas (idempotente: só as que faltam).
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  select v_marca, v_posto_embalagem, v_pmo, v_op, v_marca, '',
         'TST8649' || lpad(g::text, 5, '0'), lower('TST8649' || lpad(g::text, 5, '0'))
    from generate_series(1, 5) g
   where not exists (
     select 1 from public.sf_registros r
      where r.op = v_op and r.posto = v_posto_embalagem
        and r.numero_serie_norm = lower('TST8649' || lpad(g::text, 5, '0'))
   );

  raise notice 'Cenário pronto: OP % / % com a rota % -> % e 5 peças embaladas (TST864900001 a TST864900005).',
    v_pmo, v_op, v_posto_embalagem, v_posto_almox;
end
$func$;

\echo
\echo '== O que ficou (esperado: 1 OP de teste, rota Embalagem -> Almoxarifado, 5 registros de Embalagem):'
select pmo, op, cliente, status, embalagem_individual, sn_ini, sn_fim from public.sf_ordens where op = '8649';
select op2.ordem, op2.posto from public.sf_ordens o join public.sf_ordem_postos op2 on op2.ordem_id = o.id where o.op = '8649' order by op2.ordem;
select posto, count(*) as pecas from public.sf_registros where op = '8649' group by posto order by posto;
