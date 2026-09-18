-- =============================================================
-- ALERTAS DE TAXA DE APROVAÇÃO POR POSTO (Telegram/Discord)
--
-- O gestor cria REGRAS (postos, taxa mínima, janela, mínimo de bipes, lembrete, canais,
-- destinatários). Uma checagem a cada 5 min (crontab -> rota do app -> alerta_avaliar) decide
-- ABRIR / LEMBRAR / NORMALIZAR e devolve a lista de envios; o app só entrega as mensagens.
--
-- Convenções deste repositório:
--   - corpo de função com $func$ (o SQL Editor do Supabase não aceita dois cifrões);
--   - policies com (select tem_permissao(...)) — padrão da 0096 (InitPlan, não por linha);
--   - GRANT explícito a authenticated e service_role; funções de servidor são REVOGADAS de
--     anon/authenticated (as default privileges do Supabase dão execute a todos);
--   - notify pgrst no fim (recarrega o schema do PostgREST).
-- =============================================================

-- ---------- Contas vinculadas (Telegram / Discord) ----------
create table if not exists public.alerta_contas (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  canal        text not null check (canal in ('telegram', 'discord')),
  externo_id   text not null check (btrim(externo_id) <> ''),
  vinculado_em timestamptz not null default now(),
  unique (usuario_id, canal),
  unique (canal, externo_id)
);
alter table public.alerta_contas enable row level security;

-- O usuário lê e apaga SÓ a própria linha. Quem grava é o servidor (alerta_vincular).
create policy alerta_contas_select_propria on public.alerta_contas
  for select using (usuario_id = (select auth.uid()));
create policy alerta_contas_delete_propria on public.alerta_contas
  for delete using (usuario_id = (select auth.uid()));

grant select, delete on public.alerta_contas to authenticated;
grant select, insert, update, delete on public.alerta_contas to service_role;

-- ---------- Códigos de vínculo (ALERTA-XXXX, 15 min, uso único) ----------
create table if not exists public.alerta_codigos (
  codigo     text primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  expira_em  timestamptz not null default now() + interval '15 minutes',
  usado_em   timestamptz,
  criado_em  timestamptz not null default now()
);
alter table public.alerta_codigos enable row level security;

create policy alerta_codigos_select_proprio on public.alerta_codigos
  for select using (usuario_id = (select auth.uid()));

grant select on public.alerta_codigos to authenticated;
grant select, insert, update, delete on public.alerta_codigos to service_role;

-- ---------- Regras ----------
create table if not exists public.alerta_regras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (btrim(nome) <> ''),
  postos        text[] not null check (cardinality(postos) > 0),
  taxa_minima   numeric(5,2) not null check (taxa_minima >= 0 and taxa_minima <= 100),
  janela_tipo   text not null check (janela_tipo in ('tempo', 'bipes', 'op')),
  -- minutos (tempo) ou quantidade de bipes (bipes); no tipo 'op' não existe valor
  janela_valor  int check (
                  (janela_tipo = 'op' and janela_valor is null)
                  or (janela_tipo <> 'op' and janela_valor > 0)
                ),
  minimo_bipes  int not null default 20 check (minimo_bipes > 0),
  lembrete_min  int check (lembrete_min is null or lembrete_min > 0),
  canais        text[] not null check (cardinality(canais) > 0 and canais <@ array['telegram', 'discord']),
  destinatarios uuid[] not null check (cardinality(destinatarios) > 0),
  ativa         boolean not null default true,
  criado_por    uuid references public.usuarios(id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.alerta_regras enable row level security;

create policy alerta_regras_admin on public.alerta_regras
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

grant select, insert, update, delete on public.alerta_regras to authenticated, service_role;

-- ---------- Ocorrências (uma por regra x posto enquanto viva) ----------
create table if not exists public.alerta_ocorrencias (
  id              uuid primary key default gen_random_uuid(),
  regra_id        uuid not null references public.alerta_regras(id) on delete cascade,
  posto           text not null,
  pmo             text,
  op              text,
  estado          text not null default 'aberta' check (estado in ('aberta', 'resolvida', 'normalizada')),
  taxa_abertura   numeric(5,2) not null,
  taxa_ultima     numeric(5,2) not null,
  aprovados       int not null default 0,
  reprovados      int not null default 0,
  aberta_em       timestamptz not null default now(),
  resolvida_por   uuid references public.usuarios(id) on delete set null,
  resolvida_em    timestamptz,
  normalizada_em  timestamptz,
  ultimo_envio_em timestamptz not null default now()
);
alter table public.alerta_ocorrencias enable row level security;

-- É ESTE índice que garante "no máximo uma ocorrência viva por regra x posto", mesmo se duas
-- avaliações se cruzarem.
create unique index if not exists alerta_ocorrencias_viva
  on public.alerta_ocorrencias (regra_id, posto)
  where estado in ('aberta', 'resolvida');
create index if not exists alerta_ocorrencias_aberta_em
  on public.alerta_ocorrencias (aberta_em desc);

create policy alerta_ocorrencias_select_admin on public.alerta_ocorrencias
  for select using ((select tem_permissao('shopfloor', 'administrar')));
create policy alerta_ocorrencias_update_admin on public.alerta_ocorrencias
  for update using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

grant select, update on public.alerta_ocorrencias to authenticated;
grant select, insert, update, delete on public.alerta_ocorrencias to service_role;

-- ---------- Envios (auditoria + reenvio de falha) ----------
-- `texto` e `com_botao` ficam guardados para o REENVIO sair idêntico ao que falhou, sem ter que
-- remontar a mensagem a partir de um estado que já mudou.
create table if not exists public.alerta_envios (
  id                  uuid primary key default gen_random_uuid(),
  ocorrencia_id       uuid references public.alerta_ocorrencias(id) on delete cascade,
  usuario_id          uuid not null references public.usuarios(id) on delete cascade,
  canal               text not null check (canal in ('telegram', 'discord')),
  tipo                text not null check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste')),
  texto               text not null default '',
  com_botao           boolean not null default false,
  mensagem_externa_id text,
  ok                  boolean not null default false,
  erro                text,
  tentativas          int not null default 0,
  criado_em           timestamptz not null default now()
);
alter table public.alerta_envios enable row level security;

create index if not exists alerta_envios_ocorrencia on public.alerta_envios (ocorrencia_id);
create index if not exists alerta_envios_pendentes on public.alerta_envios (criado_em)
  where ok = false and tentativas < 3;

create policy alerta_envios_select_admin on public.alerta_envios
  for select using ((select tem_permissao('shopfloor', 'administrar')));

grant select on public.alerta_envios to authenticated;
grant select, insert, update, delete on public.alerta_envios to service_role;

-- ---------- alerta_gerar_codigo(): código de vínculo do usuário logado ----------
create or replace function public.alerta_gerar_codigo()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  -- alfabeto sem I, O, 0 e 1: o código é LIDO na tela e DIGITADO no celular
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_uid    uuid := auth.uid();
  v_codigo text;
  v_expira timestamptz;
  i        int;
begin
  if v_uid is null or not exists (select 1 from usuarios where id = v_uid and ativo) then
    raise exception 'SEM_USUARIO';
  end if;

  -- higiene: códigos velhos de qualquer um (liberam o espaço de nomes) e os meus ainda não usados
  delete from alerta_codigos where expira_em < now() - interval '1 day';
  delete from alerta_codigos where usuario_id = v_uid and usado_em is null;

  loop
    v_codigo := 'ALERTA-';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    begin
      insert into alerta_codigos (codigo, usuario_id) values (v_codigo, v_uid)
      returning expira_em into v_expira;
      exit;
    exception when unique_violation then
      -- colisão com um código ainda vivo: sorteia outro
    end;
  end loop;

  return jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
end
$func$;

revoke all on function public.alerta_gerar_codigo() from public, anon;
grant execute on function public.alerta_gerar_codigo() to authenticated, service_role;

-- ---------- alerta_vincular(): consome o código e grava a conta (SÓ o servidor) ----------
create or replace function public.alerta_vincular(p_codigo text, p_canal text, p_externo_id text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v        alerta_codigos;
  v_nome   text;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_ext    text := btrim(coalesce(p_externo_id, ''));
begin
  if p_canal not in ('telegram', 'discord') then raise exception 'CANAL_INVALIDO'; end if;
  if v_ext = '' then raise exception 'CANAL_INVALIDO'; end if;

  select * into v from alerta_codigos where codigo = v_codigo for update;
  if not found or v.usado_em is not null then raise exception 'CODIGO_INVALIDO'; end if;
  if v.expira_em < now() then raise exception 'CODIGO_EXPIRADO'; end if;

  if exists (select 1 from alerta_contas
              where canal = p_canal and externo_id = v_ext and usuario_id <> v.usuario_id) then
    raise exception 'CONTA_JA_VINCULADA';
  end if;

  insert into alerta_contas (usuario_id, canal, externo_id)
  values (v.usuario_id, p_canal, v_ext)
  on conflict (usuario_id, canal)
    do update set externo_id = excluded.externo_id, vinculado_em = now();

  update alerta_codigos set usado_em = now() where codigo = v.codigo;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = v.usuario_id;
  return coalesce(v_nome, '');
end
$func$;

revoke all on function public.alerta_vincular(text, text, text) from public, anon, authenticated;
grant execute on function public.alerta_vincular(text, text, text) to service_role;

notify pgrst, 'reload schema';
