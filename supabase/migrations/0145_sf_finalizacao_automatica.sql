-- =============================================================
-- FINALIZAÇÃO AUTOMÁTICA DE OP
-- Spec: docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md
--
-- Nada no ShopFloor marcava uma OP como terminada, e o Dashboard monta uma aba por OP ativa.
-- Esta migração dá ao cron de 5 minutos dos alertas uma rotina que mantém sf_ordens.status em
-- sincronia com a % de conclusão que a 0121 já calcula (sf_ops_com_bipes) — sem tirar do gestor o
-- poder de encerrar na mão.
--
-- QUEM ENCERROU (sf_ordens.finalizada_por):
--   'rotina' = a regra dos 100% fechou  -> a rotina PODE reabrir se a conta cair abaixo de 100
--   'manual' = uma pessoa fechou pela tela de OP -> a rotina NUNCA mexe
--   nulo     = não dá para saber (as 7 OPs fechadas à mão em 08/10/2026, qualquer edição antiga)
--              -> a rotina NUNCA mexe. Regra de ouro: só reabre o que consegue provar que fechou.
-- Não há backfill de propósito: as linhas existentes ficam nulas.
--
-- COMPORTAMENTO:
--   - Fecha: status não finalizado (vazio, ATIVA, qualquer coisa que não seja FINALIZADA) e
--     pct_conclusao >= 100 (pode passar de 100). pct nulo (qtd nulo/0) nunca fecha.
--   - Reabre: finalizada_por = 'rotina', status FINALIZADA e a OP NÃO está mais em 100%. A OP que
--     a sf_ops_com_bipes não devolve (zero registros) conta como sem conclusão e também reabre.
--   - Estável: duas rodadas seguidas sem mudança no meio não escrevem NADA (nem updated_at). Os dois
--     update são disjuntos (um exige não-finalizada, o outro finalizada) e rodam sobre UMA leitura
--     da conta, num único comando.
--   - Rebipar peça já contada não muda a conta (é por número de série distinto): a OP não pisca.
--
-- Só o service_role executa (o cron). security definer + search_path travado para não depender dos
-- grants da tabela. Corpo com $func$ (o SQL Editor não aceita dois cifrões, nem em comentário).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0145_sf_finalizacao_automatica.sql
--
-- ORDEM DE DEPLOY: aplicar esta migração ANTES de subir o código (a tela de OP passa a gravar a
-- coluna nova; sem ela, salvar uma OP falha).
-- =============================================================

-- ---------- quem finalizou ----------
alter table public.sf_ordens add column if not exists finalizada_por text;

alter table public.sf_ordens drop constraint if exists sf_ordens_finalizada_por_check;
alter table public.sf_ordens
  add constraint sf_ordens_finalizada_por_check
  check (finalizada_por is null or finalizada_por in ('rotina', 'manual'));

-- ---------- a rotina ----------
create or replace function public.sf_sincronizar_finalizacao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_finalizadas integer;
  v_reabertas   integer;
begin
  with conclusao as materialized (
    -- Uma leitura só da conta. LEFT JOIN: a OP sem nenhum registro não aparece na sf_ops_com_bipes
    -- e fica com pct nulo (= sem conclusão).
    select o.id, c.pct_conclusao as pct
      from public.sf_ordens o
      left join public.sf_ops_com_bipes(null, null) c on c.pmo = o.pmo and c.op = o.op
  ),
  fechadas as (
    update public.sf_ordens o
       set status = 'FINALIZADA', finalizada_por = 'rotina', updated_at = now()
      from conclusao k
     where k.id = o.id
       and k.pct >= 100
       and upper(btrim(o.status)) <> 'FINALIZADA'
    returning o.id
  ),
  reabertas as (
    update public.sf_ordens o
       set status = 'ATIVA', finalizada_por = null, updated_at = now()
      from conclusao k
     where k.id = o.id
       and o.finalizada_por = 'rotina'
       and upper(btrim(o.status)) = 'FINALIZADA'
       and (k.pct is null or k.pct < 100)
    returning o.id
  )
  select (select count(*) from fechadas), (select count(*) from reabertas)
    into v_finalizadas, v_reabertas;

  return jsonb_build_object('finalizadas', v_finalizadas, 'reabertas', v_reabertas);
end
$func$;

revoke all on function public.sf_sincronizar_finalizacao() from public, anon, authenticated;
grant execute on function public.sf_sincronizar_finalizacao() to service_role;

notify pgrst, 'reload schema';
