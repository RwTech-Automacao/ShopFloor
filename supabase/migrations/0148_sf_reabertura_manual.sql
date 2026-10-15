-- =============================================================
-- REATIVAR UMA OP NA MÃO TIRA ELA DO CONTROLE AUTOMÁTICO, PARA SEMPRE
-- Spec: docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md
--       (adendo de 09/10/2026 — "Reativar tira a OP do automático")
--
-- A 0145 deu ao cron uma rotina (sf_sincronizar_finalizacao) que fecha qualquer OP com
-- pct_conclusao >= 100 e status não-finalizado. A 0148 nasceu de um aperto prático disso: quando o
-- bipe passa a BLOQUEAR em OP finalizada, o gestor reativa a OP para a peça atrasada entrar — e a
-- rotina a fecha de novo em até 5 minutos, às vezes antes de o operador conseguir bipar.
--
-- Reabrir não dá para resolver com a coluna que já existe. finalizada_por descreve quem FECHOU
-- ('rotina' | 'manual' por check constraint), e reabrir pela tela LIMPA esse campo: "uma pessoa
-- reabriu isto" é outra informação, e precisa de um lugar próprio.
--
-- A MARCA (sf_ordens.reaberta_manual):
--   false (o default) = nunca foi reaberta na mão -> a rotina fecha quando a conta bater 100%
--   true              = uma pessoa reativou pela tela de Cadastro de OP -> a rotina NUNCA fecha
--                       esta OP de novo, nem na rodada seguinte nem em nenhuma depois.
-- É definitiva de propósito (decisão do usuário, 09/10): só fecha quem reabriu. O preço, aceito, é
-- que cada peça atrasada tira aquela OP do automático para sempre, e ela volta a aparecer no
-- Dashboard até alguém fechá-la na mão.
--
-- Nasce FALSA e sem backfill, e isso importa: default true desligaria a finalização automática da
-- base inteira de uma vez. Nada no código limpa a marca — reativar é o único jeito de ligá-la.
--
-- A rotina só honra a marca ao FECHAR. Reabrir não é fechar: a OP que a rotina fechou (e que
-- portanto não estava marcada) continua reabrindo sozinha se a conta cair abaixo de 100%. Como a
-- marca impede o fechamento, a combinação "marcada + fechada pela rotina" não existe.
--
-- Idempotente: add column if not exists (o default não reescreve a tabela, Postgres 11+) e
-- create or replace function. Corpo com $func$ (o SQL Editor não aceita dois cifrões, nem dentro de
-- comentário).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0148_sf_reabertura_manual.sql
--
-- ORDEM DE DEPLOY: aplicar esta migração ANTES de subir o código (a tela de OP passa a gravar a
-- coluna nova ao reativar; sem ela, salvar a OP reativada falha).
-- =============================================================

-- ---------- a marca ----------
alter table public.sf_ordens add column if not exists reaberta_manual boolean not null default false;

comment on column public.sf_ordens.reaberta_manual is
  'Uma pessoa reativou esta OP pela tela de Cadastro de OP (FINALIZADA -> outro status). Quando verdadeira, sf_sincronizar_finalizacao NUNCA volta a fechar a OP: a partir daí só fecha quem reabriu. Nasce falsa e nada a limpa.';

-- ---------- a rotina, agora respeitando a marca ----------
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
       -- 0148: OP reativada na mão sai do automático para sempre. coalesce por segurança, para a
       -- rotina não parar de fechar NADA se um dia a coluna virar nula.
       and not coalesce(o.reaberta_manual, false)
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
