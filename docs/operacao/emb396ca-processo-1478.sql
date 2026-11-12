-- EMB396CA: o processo 1478 (deveria ser o RWDPRV09) está vazio. Nasceu vazio ou foi apagado depois? — SÓ LEITURA.
\set ON_ERROR_STOP on
begin;
\echo '=== 1) o processo 1478 hoje (todos os campos comerciais + quem criou/alterou)'
select p.numero, p.status, p.numero_emb, p.codigo_material, p.descricao_material, p.numero_pedido, p.fornecedor, p.acp_cliente,
       p.quantidade_pedido, p.quantidade_recebida, p.tipo,
       to_char(p.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as criado,
       to_char(p.updated_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as alterado,
       c.nome as criado_por, a.nome as alterado_por
  from processos_recebimento p
  left join usuarios c on c.id = p.criado_por left join usuarios a on a.id = p.atualizado_por
 where p.numero = 1478;

\echo '=== 2) TODO o log do processo 1478 (cada salvamento grava o antes/depois em dados)'
select to_char(l.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as quando, l.acao, l.usuario_nome,
       l.descricao, l.dados
  from logs l
 where l.entidade_id = (select id from processos_recebimento where numero = 1478)
 order by l.created_at;

\echo '=== 3) log da importação da EMB396CA (quantos processos criou)'
select to_char(l.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as quando, l.acao, l.usuario_nome, l.descricao
  from logs l
 where l.entidade = 'importacao' and l.entidade_id = '8cdd0c86-c2ff-494f-b064-2c3a3cef3788';

\echo '=== 4) qualquer log que cite RWDPRV09 ou 1212/26 (ex.: código apagado numa edição)'
select to_char(l.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as quando, l.entidade, l.acao, l.usuario_nome, l.descricao,
       left(l.dados::text, 400) as dados
  from logs l
 where l.dados::text like '%RWDPRV09%' or l.dados::text like '%1212/26%'
 order by l.created_at;
rollback;
