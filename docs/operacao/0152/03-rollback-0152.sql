-- =============================================================
-- 0152 — ROLLBACK (só se algo der errado DEPOIS de a 0152 ter sido aplicada)
--
-- ⚠️ PRIMEIRO O APP, DEPOIS ESTE ARQUIVO. Volte o app para o commit de antes (DEPLOY-0152.md,
-- "Se algo der errado", passo 1) ANTES de rodar isto. Se o app novo continuar no ar, o item
-- "Dashboard" do menu e a página /recebimento/dashboard chamam rec_dashboard e
-- rec_dashboard_opcoes, que este arquivo apaga.
--
-- O que faz, numa transação só (tudo ou nada):
--   a) recria rec_justificar_divergencia(uuid, text) com o corpo da 0143, copiado byte a byte de
--      supabase/migrations/0143_rec_justificar_divergencia.sql, com os mesmos grants;
--   b) devolve o texto original das justificativas que a 0152 deixou vazias, lendo a cópia
--      public.processos_recebimento_bkp_0152 (feita pelo 02-copiar-linhas-do-update.sql). Só volta
--      a linha que ainda está EXATAMENTE como a 0152 deixou: texto '' e o mesmo autor e instante
--      da cópia. Se alguém justificou de novo depois da 0152, a justificativa nova fica.
--      (O updated_at dessas linhas vira "agora": o gatilho processos_updated_at mexe nele em todo
--      update, e não dá para voltar sem desligar o gatilho.)
--      Sem a cópia, o passo b só avisa e o resto do rollback segue;
--   c) apaga rec_dashboard, rec_dashboard_opcoes e rec_norm_texto (as assinaturas da 0152);
--   d) avisa o PostgREST (notify pgrst).
--
-- Idempotente: rodar de novo recria a mesma função, não acha linha para devolver e os drops são
-- "if exists". A tabela de cópia NÃO é apagada (fica como registro; apagar à mão depois).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/0152-03.sql
-- Depois: cd ~/supabase/docker && docker compose restart rest
-- =============================================================

begin;

-- ---------- a) rec_justificar_divergencia de volta ao corpo da 0143 (byte a byte) ----------
create or replace function public.rec_justificar_divergencia(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_nome text;
begin
  if not tem_permissao('recebimento', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- Nome de exibicao igual ao resto do app (registrarLog): nome, e o e-mail se o nome estiver vazio.
  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome
    from public.usuarios u where u.id = auth.uid();

  update public.processos_recebimento
     set divergencia_justificativa = coalesce(p_texto, ''),
         divergencia_justificada_por = auth.uid(),
         divergencia_justificada_em = now(),
         divergencia_justificada_por_nome = coalesce(v_nome, '')
   where id = p_id;

  if not found then
    raise exception 'PROCESSO_NAO_ENCONTRADO';
  end if;
end;
$func$;

revoke all on function public.rec_justificar_divergencia(uuid, text) from public, anon;
grant execute on function public.rec_justificar_divergencia(uuid, text) to authenticated;

-- ---------- b) as justificativas só-de-espaços de volta ----------
do $func$
declare
  v_copia     bigint;
  v_devolvida bigint;
begin
  if to_regclass('public.processos_recebimento_bkp_0152') is null then
    raise notice 'b) SEM a tabela processos_recebimento_bkp_0152: nenhuma justificativa devolvida (o 02 não rodou).';
    return;
  end if;

  select count(*) into v_copia from public.processos_recebimento_bkp_0152;

  update public.processos_recebimento p
     set divergencia_justificativa        = b.divergencia_justificativa,
         divergencia_justificada_por      = b.divergencia_justificada_por,
         divergencia_justificada_em       = b.divergencia_justificada_em,
         divergencia_justificada_por_nome = coalesce(b.divergencia_justificada_por_nome, '')
    from public.processos_recebimento_bkp_0152 b
   where p.id = b.id
     and p.divergencia_justificativa = ''
     and p.divergencia_justificada_por is not distinct from b.divergencia_justificada_por
     and p.divergencia_justificada_em  is not distinct from b.divergencia_justificada_em;
  get diagnostics v_devolvida = row_count;

  raise notice 'b) linhas na cópia: %, justificativas devolvidas agora: %, deixadas como estão (alteradas depois da 0152, ou já devolvidas antes): %',
    v_copia, v_devolvida, v_copia - v_devolvida;
end
$func$;

-- ---------- c) as funções novas da 0152 ----------
drop function if exists public.rec_dashboard(text, text, text, text, date, date, text);
drop function if exists public.rec_dashboard_opcoes();
drop function if exists public.rec_norm_texto(text);

-- ---------- d) o PostgREST ----------
notify pgrst, 'reload schema';

commit;
