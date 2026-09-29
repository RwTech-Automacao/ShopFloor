-- =============================================================
-- Central do Cliente: índice e as funções que montam a "foto" enviada de hora em hora.
--
-- Só o que o cliente pode ver (global-constraints-p5.md):
--   Recebimento: id, acp_cliente (como texto), numero_emb, data_chegada e o status — só
--   'aberto', 'em_conferencia' e 'finalizado'; 'cancelado' NUNCA vai.
--   Ordem: id, acp (como texto), a DATA do primeiro registro de produção (fuso de São Paulo) e se
--   está finalizada (upper(status) = 'FINALIZADA').
--   NUNCA vão colaborador, defeito, número de série, fornecedor, NF, comprador ou reprovação.
-- Só linhas com ACP preenchida (texto não vazio depois de aparar).
--
-- ⚠️ CONCURRENTLY não roda dentro de transação (mesmo caso da 0091/0095/0114):
--    - Dev (SQL Editor do Supabase): REMOVA a palavra "concurrently" da linha abaixo.
--    - Prod/RDS: psql -f supabase/migrations/0134_central_sincronizacao.sql  (SEM -1)
-- sf_registros é grande e recebe bipe o tempo todo; CONCURRENTLY não trava a escrita.
create index concurrently if not exists sf_registros_pmo_op_data_hora
  on public.sf_registros (pmo, op, data_hora);

create or replace function public.central_recebimentos_para_sincronizar()
returns table (id uuid, projetos text, numero_emb text, data_chegada date, situacao text)
language sql stable as $$
  select p.id, trim(p.acp_cliente), coalesce(p.numero_emb, ''), p.data_chegada, p.status
  from public.processos_recebimento p
  where coalesce(trim(p.acp_cliente), '') <> '' and p.status in ('aberto', 'em_conferencia', 'finalizado')
  order by p.id
$$;

create or replace function public.central_ordens_para_sincronizar()
returns table (id uuid, projetos text, primeiro_registro date, concluida boolean)
language sql stable as $$
  select o.id, trim(o.acp),
         ((select min(r.data_hora) from public.sf_registros r where r.pmo = o.pmo and r.op = o.op)
            at time zone 'America/Sao_Paulo')::date,
         upper(coalesce(o.status, '')) = 'FINALIZADA'
  from public.sf_ordens o
  where coalesce(trim(o.acp), '') <> ''
  order by o.id
$$;

revoke all on function public.central_recebimentos_para_sincronizar() from public, anon, authenticated;
revoke all on function public.central_ordens_para_sincronizar() from public, anon, authenticated;
grant execute on function public.central_recebimentos_para_sincronizar() to service_role;
grant execute on function public.central_ordens_para_sincronizar() to service_role;

notify pgrst, 'reload schema';
