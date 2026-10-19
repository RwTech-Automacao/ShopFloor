-- =============================================================
-- TESTE DA INTEGRAÇÃO COM O COMPELS — OP 8649 (PMO PRT446) — CONFERIR ANTES DE MONTAR O CENÁRIO
-- SOMENTE LEITURA: a sessão é aberta como read only, nada é gravado.
--
-- Responde: a OP 8649 já existe no ShopFloor de produção? É a mesma que o Compels (PRT446)? Tem registros
-- de verdade? E existem os postos que o cenário precisa (um de Embalagem e um de Almoxarifado)?
-- Com a saída dá para decidir se o 02-montar-cenario.sql pode rodar (ele mesmo recusa se a OP for real).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/op8649-01.sql
-- =============================================================
set default_transaction_read_only = on;

\echo
\echo '== 1) A OP 8649 existe no ShopFloor? (0 linhas = não existe: o cenário cria uma OP de teste)'
select pmo, op, cliente, qtd, status, embalagem_individual, sn_ini, sn_fim, created_at
  from public.sf_ordens
 where op = '8649';

\echo
\echo '== 2) Rota (postos) dessa OP, na ordem'
select o.pmo, o.op, op2.ordem, op2.posto, p.perfil
  from public.sf_ordens o
  join public.sf_ordem_postos op2 on op2.ordem_id = o.id
  left join public.sf_postos p on p.chave = op2.posto
 where o.op = '8649'
 order by op2.ordem;

\echo
\echo '== 3) Registros dessa OP por posto (se houver registros que NÃO são de teste, a OP é REAL: não monte o cenário nela)'
select posto, count(*) as registros, min(colaborador) as exemplo_colaborador
  from public.sf_registros
 where op = '8649'
 group by posto
 order by posto;

\echo
\echo '== 4) Linhas na fila de estoque para essa OP (esperado: nenhuma)'
select count(*) as linhas_na_fila
  from public.sf_estoque_envios
 where op = '8649';

\echo
\echo '== 5) Postos de Embalagem e de Almoxarifado cadastrados (o cenário precisa de UM de cada; sem Almoxarifado ele cria o posto "Almoxarifado")'
select p.chave, p.ordem, p.perfil, pp.recurso
  from public.sf_postos p
  left join public.sf_posto_perfis pp on pp.chave = p.perfil
 where pp.recurso in ('caixa', 'almoxarifado')
 order by pp.recurso, p.ordem;

\echo
\echo '== 6) Alguma OP com o mesmo PMO PRT446 no ShopFloor? (informativo)'
select pmo, op, cliente, status from public.sf_ordens where pmo = 'PRT446' order by op;
