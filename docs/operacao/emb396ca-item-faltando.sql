-- EMB396CA: por que o item RWDPRV09 (Revenda, pedido 1212/26, 50 un.) não entrou? — SÓ LEITURA.
\set ON_ERROR_STOP on
begin;
\echo '=== 1) importações que criaram processos da EMB396CA (linhas lidas × processos criados)'
select i.id, i.arquivo_nome, i.total_linhas, i.total_processos_criados,
       to_char(i.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       (select count(*) from processos_recebimento p where p.importacao_id = i.id) as processos_hoje
  from importacoes i
 where i.id in (select distinct importacao_id from processos_recebimento where upper(trim(numero_emb)) = 'EMB396CA')
 order by i.created_at;

\echo '=== 2) mapeamento usado (coluna da planilha -> campo)'
select i.mapeamento from importacoes i
 where i.id in (select distinct importacao_id from processos_recebimento where upper(trim(numero_emb)) = 'EMB396CA');

\echo '=== 3) processos da EMB396CA (item, pedido, tipo, quantidade, status)'
select p.numero, p.codigo_material, p.numero_pedido, p.tipo, p.quantidade_pedido, p.status
  from processos_recebimento p where upper(trim(p.numero_emb)) = 'EMB396CA' order by p.numero;

\echo '=== 4) RWDPRV09 em qualquer EMB, e qualquer processo do pedido 1212/26'
select p.numero, p.numero_emb, p.codigo_material, p.numero_pedido, p.tipo, p.quantidade_pedido, p.status,
       to_char(p.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YY HH24:MI') as criado
  from processos_recebimento p
 where upper(p.codigo_material) like '%RWDPRV09%' or p.numero_pedido like '%1212%'
 order by p.created_at;
rollback;
