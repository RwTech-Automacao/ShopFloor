-- =============================================================
-- Central do Cliente: índice e as funções que montam a "foto" enviada de hora em hora.
--
-- ⚠️ Numeração: a `main` deste repositório vai até a 0127; a branch `feat/posto-almoxarifado`
-- (não mergeada) já tem 0128-0133 commitados localmente. Esta 0134 usa `max(main, 0133) + 1`.
-- Se essa branch ganhar uma 0134 própria antes do merge, uma das duas migrações precisa ser
-- renumerada (ver tools/central-sync/README.md §5).
--
-- Só o que o cliente pode ver (contrato v1 — plano
-- docs/superpowers/plans/2026-09-29-central-do-cliente-5-sincronizacao.md do repositório
-- Central-Do-Cliente):
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
--
-- ⚠️ Os corpos usam $func$, e não os dois cifrões: o SQL Editor do Supabase recusa o de dois
-- cifrões, e o caminho do Dev é justamente colar isto lá. Não troque de volta.
create index concurrently if not exists sf_registros_pmo_op_data_hora
  on public.sf_registros (pmo, op, data_hora);

-- Cada função devolve um ÚNICO jsonb com a lista inteira (nunca `setof`/`table`): uma foto
-- consistente lida numa chamada só. Paginar por `.range()` no cliente leria a tabela em pedaços,
-- em instantes diferentes — linhas inseridas/alteradas entre uma página e outra poderiam faltar ou
-- duplicar, e a "foto" deixaria de ser uma foto.
create or replace function public.central_recebimentos_para_sincronizar()
returns jsonb
language sql stable security invoker set search_path = public as $func$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'projetos', trim(p.acp_cliente),
    'numero_emb', coalesce(p.numero_emb, ''),
    'data_chegada', p.data_chegada,
    'situacao', p.status
  ) order by p.id), '[]'::jsonb)
  from public.processos_recebimento p
  where coalesce(trim(p.acp_cliente), '') <> '' and p.status in ('aberto', 'em_conferencia', 'finalizado')
$func$;

create or replace function public.central_ordens_para_sincronizar()
returns jsonb
language sql stable security invoker set search_path = public as $func$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'projetos', trim(o.acp),
    'primeiro_registro', ((select min(r.data_hora) from public.sf_registros r where r.pmo = o.pmo and r.op = o.op)
                             at time zone 'America/Sao_Paulo')::date,
    'concluida', upper(coalesce(o.status, '')) = 'FINALIZADA'
  ) order by o.id), '[]'::jsonb)
  from public.sf_ordens o
  where coalesce(trim(o.acp), '') <> ''
$func$;

revoke all on function public.central_recebimentos_para_sincronizar() from public, anon, authenticated;
revoke all on function public.central_ordens_para_sincronizar() from public, anon, authenticated;
grant execute on function public.central_recebimentos_para_sincronizar() to service_role;
grant execute on function public.central_ordens_para_sincronizar() to service_role;

notify pgrst, 'reload schema';
