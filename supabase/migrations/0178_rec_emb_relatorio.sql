-- =============================================================
-- RECEBIMENTO — RELATÓRIO DE UMA EMB (tela /recebimento/emb/<emb>), aberta pelo link da mensagem do
-- alerta "Fim de EMB" (0150).
--
-- rec_emb_relatorio(p_emb): consulta, sem tabela. Devolve jsonb:
--   {ok:true, emb, processos, pedidos, fechada, fechada_em, divergencias:[{id, numero, item, descricao,
--    quantidade_pedido, quantidade_recebida, divergencia, justificativa, justificada_por_nome, justificada_em}]}
--   {ok:false, motivo:'emb_inexistente'} quando nenhum processo tem essa EMB.
--
-- REGRA: nenhuma nova. As divergências vêm da MESMA rec_emb_divergencias que o alerta usa (0150: mesma EMB
-- normalizada, sem cancelado, rec_divergente), com o id do processo acrescentado pelo `numero` (único) para a
-- tela linkar /recebimento/processos/<id>. "Fechada" e "fechada_em" são a conta da rec_embs_fechadas (0150)
-- SEM o piso da regra: tem processo não cancelado e todos estão num terminal (almoxarifado ou reprovado);
-- fechada_em = a última finalização (coalesce(finalizado_em, created_at)). `pedidos` = os Nº da PO distintos
-- (numero_pedido, como no Fluxo da 0171) dos processos não cancelados.
--
-- Acesso: authenticated, com `(select tem_permissao('recebimento','visualizar'))` — sem permissão é ERRO
-- SEM_PERMISSAO, nunca resposta vazia. Só leitura. A rec_emb_divergencias continua revogada de todos (só é
-- alcançada por dentro desta função e do alerta_avaliar, ambos security definer do owner).
--
-- Corpo com $func$ (o SQL Editor não aceita dois cifrões). Aditiva e idempotente. Depende da 0150 e 0124.
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0178_rec_emb_relatorio.sql
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (a tela chama a função).
-- =============================================================
create or replace function public.rec_emb_relatorio(p_emb text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_emb text := upper(btrim(coalesce(p_emb, '')));
  v_cab record;
  v_divs jsonb;
begin
  if not (select tem_permissao('recebimento', 'visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if v_emb = '' then
    return jsonb_build_object('ok', false, 'motivo', 'emb_inexistente');
  end if;

  select count(*) as todos,
         count(*) filter (where p.status <> 'cancelado') as vivos,
         bool_and(public.rec_etapa_por_status(p.status) in ('almoxarifado', 'reprovado'))
           filter (where p.status <> 'cancelado') as terminados,
         max(coalesce(p.finalizado_em, p.created_at)) filter (where p.status <> 'cancelado') as ultima,
         coalesce(array_agg(distinct btrim(p.numero_pedido))
                    filter (where p.status <> 'cancelado' and coalesce(btrim(p.numero_pedido), '') <> ''),
                  '{}'::text[]) as pedidos
    into v_cab
    from public.processos_recebimento p
   where upper(btrim(coalesce(p.numero_emb, ''))) = v_emb;

  if v_cab.todos = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'emb_inexistente');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'numero', d.numero, 'item', d.item, 'descricao', d.descricao,
           'quantidade_pedido', d.quantidade_pedido, 'quantidade_recebida', d.quantidade_recebida,
           'divergencia', d.divergencia, 'justificativa', d.justificativa,
           'justificada_por_nome', d.justificada_por_nome, 'justificada_em', d.justificada_em)
         order by d.numero), '[]'::jsonb)
    into v_divs
    from public.rec_emb_divergencias(v_emb) d
    left join public.processos_recebimento p on p.numero = d.numero;

  return jsonb_build_object(
    'ok', true,
    'emb', v_emb,
    'processos', v_cab.vivos,
    'pedidos', to_jsonb(v_cab.pedidos),
    'fechada', coalesce(v_cab.vivos > 0 and v_cab.terminados, false),
    'fechada_em', case when v_cab.vivos > 0 and v_cab.terminados then v_cab.ultima end,
    'divergencias', v_divs);
end
$func$;

revoke all on function public.rec_emb_relatorio(text) from public, anon;
grant execute on function public.rec_emb_relatorio(text) to authenticated, service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
