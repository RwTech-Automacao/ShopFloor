-- =============================================================
-- FATURAMENTO — FILA DE PRIORIDADE DA BAIXA DE NF (spec 2026-11-17-faturamento-baixa-nf-design.md)
--
-- A tela /faturamento/baixa-nf só baixa o que alguém selecionou. Ao confirmar, a nota com saldo baixa na hora;
-- a sem saldo entra no FIM desta fila, e o cron (POST /api/compels/baixa-nf, service role) percorre a fila em
-- ordem de `posicao` e baixa cada nota que já tem saldo.
--
--   - `fat_fila_baixa_nf`: uma linha por nota colocada na fila (e o registro das baixas feitas direto na
--     confirmação — `baixada`/`simulada` —, para saber quem baixou). `posicao` cresce por sequência: a ordem da
--     fila é a ordem em que as notas entraram. Reordenar = tirar e selecionar de novo (vai pro fim).
--   - ÍNDICE ÚNICO PARCIAL: uma linha `aguardando` por `nota_id` — a mesma nota não entra duas vezes na fila.
--   - RLS: leitura com faturamento.visualizar (`(select tem_permissao(...))`, InitPlan — padrão da 0096); SEM
--     policy de escrita: o usuário grava só pelas funções abaixo (security definer, faturamento.baixar); o cron
--     grava com a service role.
--   - `colocado_por_nome` / `finalizado_por_nome`: a tabela `usuarios` não é legível por quem só tem
--     Faturamento, então o nome fica guardado na linha.
--
-- Aditiva e idempotente (if not exists, create or replace, drop policy if exists). Funções com $func$ (o SQL
-- Editor recusa o de dois cifrões); grants e revokes explícitos; notify pgrst na última linha.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0185_fat_fila_baixa_nf.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (a tela e o cron novos leem a tabela). O app antigo não a usa.
-- =============================================================

create sequence if not exists public.fat_fila_baixa_nf_posicao_seq;

create table if not exists public.fat_fila_baixa_nf (
  id                  uuid primary key default gen_random_uuid(),
  -- id da nota (notaICMS) no Compels e o número dela, para a tela.
  nota_id             bigint not null,
  numero              bigint not null,
  cliente             text not null default '',
  posicao             bigint not null default nextval('public.fat_fila_baixa_nf_posicao_seq'),
  status              text not null default 'aguardando'
                      check (status in ('aguardando', 'baixada', 'simulada', 'baixada_fora', 'removida', 'falhou')),
  colocado_por        uuid references public.usuarios(id) on delete set null,
  colocado_por_nome   text not null default '',
  colocado_em         timestamptz not null default now(),
  -- Falhas SEGUIDAS da baixa (recusa/erro do Compels); na 5ª a nota sai como 'falhou' (regra no app).
  tentativas          int not null default 0 check (tentativas >= 0),
  ultima_tentativa_em timestamptz,
  ultima_mensagem     text not null default '',
  finalizado_por      uuid references public.usuarios(id) on delete set null,
  finalizado_por_nome text not null default '',
  finalizado_em       timestamptz,
  -- aguardando ⇔ ainda não finalizada: a fila e o histórico nunca discordam.
  constraint fat_fila_baixa_nf_finalizada check ((status = 'aguardando') = (finalizado_em is null))
);

alter sequence public.fat_fila_baixa_nf_posicao_seq owned by public.fat_fila_baixa_nf.posicao;

create unique index if not exists fat_fila_baixa_nf_uma_aguardando
  on public.fat_fila_baixa_nf (nota_id) where status = 'aguardando';
create index if not exists fat_fila_baixa_nf_status_posicao
  on public.fat_fila_baixa_nf (status, posicao);

alter table public.fat_fila_baixa_nf enable row level security;

drop policy if exists fat_fila_baixa_nf_select on public.fat_fila_baixa_nf;
create policy fat_fila_baixa_nf_select on public.fat_fila_baixa_nf
  for select using ((select tem_permissao('faturamento', 'visualizar')));

revoke all on public.fat_fila_baixa_nf from public, anon, authenticated;
grant select on public.fat_fila_baixa_nf to authenticated;
grant select, insert, update, delete on public.fat_fila_baixa_nf to service_role;
revoke all on sequence public.fat_fila_baixa_nf_posicao_seq from public, anon, authenticated;
grant usage, select on sequence public.fat_fila_baixa_nf_posicao_seq to service_role;

-- ---------- fat_fila_colocar: a confirmação da tela grava aqui ----------
-- p_status 'aguardando' = entra no fim da fila (devolve a posição NA FILA, 1 = a próxima); se a nota já está
-- aguardando, não duplica e devolve a posição dela. 'baixada'/'simulada' = só registra a baixa feita na hora
-- (devolve null).
create or replace function public.fat_fila_colocar(
  p_nota_id bigint, p_numero bigint, p_cliente text, p_status text, p_mensagem text, p_tentativas int default 0
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_nome    text;
  v_posicao bigint;
begin
  if not tem_permissao('faturamento', 'baixar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_status is null or p_status not in ('aguardando', 'baixada', 'simulada') then raise exception 'STATUS_INVALIDO'; end if;
  if p_nota_id is null or p_numero is null then raise exception 'NOTA_INVALIDA'; end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome from usuarios u where u.id = auth.uid();

  if p_status = 'aguardando' then
    insert into fat_fila_baixa_nf (nota_id, numero, cliente, colocado_por, colocado_por_nome, tentativas,
                                   ultima_tentativa_em, ultima_mensagem)
    values (p_nota_id, p_numero, coalesce(p_cliente, ''), auth.uid(), coalesce(v_nome, ''),
            greatest(coalesce(p_tentativas, 0), 0), now(), coalesce(p_mensagem, ''))
    on conflict (nota_id) where status = 'aguardando' do nothing;

    select f.posicao into v_posicao from fat_fila_baixa_nf f where f.nota_id = p_nota_id and f.status = 'aguardando';
    return (select count(*) from fat_fila_baixa_nf f where f.status = 'aguardando' and f.posicao <= v_posicao)::int;
  end if;

  insert into fat_fila_baixa_nf (nota_id, numero, cliente, status, colocado_por, colocado_por_nome,
                                 ultima_tentativa_em, ultima_mensagem, finalizado_por, finalizado_por_nome,
                                 finalizado_em)
  values (p_nota_id, p_numero, coalesce(p_cliente, ''), p_status, auth.uid(), coalesce(v_nome, ''),
          now(), coalesce(p_mensagem, ''), auth.uid(), coalesce(v_nome, ''), now());
  return null;
end
$func$;

revoke all on function public.fat_fila_colocar(bigint, bigint, text, text, text, int) from public, anon;
grant execute on function public.fat_fila_colocar(bigint, bigint, text, text, text, int) to authenticated, service_role;

-- ---------- fat_fila_tirar: botão "Tirar da fila" ----------
-- true = tirou; false = a linha já não estava aguardando (o cron baixou antes, ou outro alguém tirou).
create or replace function public.fat_fila_tirar(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_nome text;
begin
  if not tem_permissao('faturamento', 'baixar') then raise exception 'SEM_PERMISSAO'; end if;
  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome from usuarios u where u.id = auth.uid();
  update fat_fila_baixa_nf
     set status = 'removida', finalizado_em = now(), finalizado_por = auth.uid(),
         finalizado_por_nome = coalesce(v_nome, '')
   where id = p_id and status = 'aguardando';
  return found;
end
$func$;

revoke all on function public.fat_fila_tirar(uuid) from public, anon;
grant execute on function public.fat_fila_tirar(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
