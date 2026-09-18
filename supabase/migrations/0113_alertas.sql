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
drop policy if exists alerta_contas_select_propria on public.alerta_contas;
create policy alerta_contas_select_propria on public.alerta_contas
  for select using (usuario_id = (select auth.uid()));
drop policy if exists alerta_contas_delete_propria on public.alerta_contas;
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

drop policy if exists alerta_codigos_select_proprio on public.alerta_codigos;
create policy alerta_codigos_select_proprio on public.alerta_codigos
  for select using (usuario_id = (select auth.uid()));

grant select on public.alerta_codigos to authenticated;
grant select, insert, update, delete on public.alerta_codigos to service_role;

-- ---------- Tentativas de vínculo (proteção contra força bruta do código) ----------
-- Sem policy nenhuma: RLS ligado + zero policies = ninguém sem bypassrls enxerga ou grava aqui,
-- não importa o que um `grant` amplo (tipo o padrão do Supabase Dev) libere na tabela.
create table if not exists public.alerta_tentativas (
  canal      text not null,
  externo_id text not null,
  em         timestamptz not null default now()
);
alter table public.alerta_tentativas enable row level security;
create index if not exists alerta_tentativas_canal_externo_em
  on public.alerta_tentativas (canal, externo_id, em);

revoke all on public.alerta_tentativas from public, anon, authenticated;
grant select, insert, delete on public.alerta_tentativas to service_role;

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

drop policy if exists alerta_regras_admin on public.alerta_regras;
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

drop policy if exists alerta_ocorrencias_select_admin on public.alerta_ocorrencias;
create policy alerta_ocorrencias_select_admin on public.alerta_ocorrencias
  for select using ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_ocorrencias_update_admin on public.alerta_ocorrencias;
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

drop policy if exists alerta_envios_select_admin on public.alerta_envios;
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
  delete from alerta_tentativas where em < now() - interval '1 day';

  loop
    v_codigo := 'ALERTA-';
    for i in 1..4 loop
      -- fonte aleatória do pgcrypto (gen_random_uuid), não random(): 32 = 256/8, sem víes no módulo
      v_codigo := v_codigo || substr(v_alfabeto, 1 + get_byte(uuid_send(gen_random_uuid()), i) % 32, 1);
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
--
-- Contrato: SEMPRE retorna jsonb, nunca levanta exceção de regra de negócio.
--   sucesso: {"ok": true,  "nome": "<nome do usuário>"}
--   falha:   {"ok": false, "erro": "CANAL_INVALIDO" | "CODIGO_INVALIDO" | "CONTA_JA_VINCULADA"
--                                  | "MUITAS_TENTATIVAS"}
-- (Erros de sistema — conexão, etc. — continuam propagando como exceção normal.)
--
-- Por quê não `raise exception` aqui: a proteção contra força bruta precisa GRAVAR a tentativa
-- falha antes de devolver o erro, e um `raise` sem tratamento aborta a transação inteira da
-- chamada — inclusive o insert em alerta_tentativas que acabou de rodar. Devolvendo o erro como
-- valor normal, o insert é commitado junto com o resto da chamada.
--
-- CODIGO_INVALIDO cobre "não existe", "já usado" E "expirado" de propósito: uma mensagem única
-- não dá pra quem está tentando adivinhar código saber se chegou perto.
create or replace function public.alerta_vincular(p_codigo text, p_canal text, p_externo_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v         alerta_codigos;
  v_nome    text;
  v_codigo  text := upper(btrim(coalesce(p_codigo, '')));
  v_ext     text := btrim(coalesce(p_externo_id, ''));
  v_falhas  int;
begin
  -- `p_canal is null` explícito: `null not in (...)` dá NULL (não true) e o NULL seguiria até o
  -- insert em alerta_tentativas, estourando not_null_violation em vez de CANAL_INVALIDO.
  if p_canal is null or p_canal not in ('telegram', 'discord') or v_ext = '' then
    return jsonb_build_object('ok', false, 'erro', 'CANAL_INVALIDO');
  end if;

  -- Serializa as chamadas do MESMO (canal, externo_id): sem isso, várias chamadas simultâneas
  -- contariam as falhas ao mesmo tempo e passariam juntas do limite de 5.
  perform pg_advisory_xact_lock(hashtextextended(p_canal || ':' || v_ext, 0));

  -- Proteção contra força bruta: 5+ falhas do mesmo (canal, externo_id) nos últimos 15 min
  -- travam esse par, mesmo que o código desta chamada esteja certo.
  select count(*) into v_falhas
    from alerta_tentativas
   where canal = p_canal and externo_id = v_ext and em > now() - interval '15 minutes';
  if v_falhas >= 5 then
    return jsonb_build_object('ok', false, 'erro', 'MUITAS_TENTATIVAS');
  end if;

  select * into v from alerta_codigos where codigo = v_codigo for update;
  if not found or v.usado_em is not null or v.expira_em < now() then
    insert into alerta_tentativas (canal, externo_id) values (p_canal, v_ext);
    return jsonb_build_object('ok', false, 'erro', 'CODIGO_INVALIDO');
  end if;

  if exists (select 1 from alerta_contas
              where canal = p_canal and externo_id = v_ext and usuario_id <> v.usuario_id) then
    return jsonb_build_object('ok', false, 'erro', 'CONTA_JA_VINCULADA');
  end if;

  begin
    insert into alerta_contas (usuario_id, canal, externo_id)
    values (v.usuario_id, p_canal, v_ext)
    on conflict (usuario_id, canal)
      do update set externo_id = excluded.externo_id, vinculado_em = now();
  exception when unique_violation then
    -- corrida: outra chamada vinculou esse (canal, externo_id) a outro usuário entre o exists()
    -- acima e este insert.
    return jsonb_build_object('ok', false, 'erro', 'CONTA_JA_VINCULADA');
  end;

  update alerta_codigos set usado_em = now() where codigo = v.codigo;
  delete from alerta_tentativas where canal = p_canal and externo_id = v_ext;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = v.usuario_id;
  return jsonb_build_object('ok', true, 'nome', coalesce(v_nome, ''));
end
$func$;

revoke all on function public.alerta_vincular(text, text, text) from public, anon, authenticated;
grant execute on function public.alerta_vincular(text, text, text) to service_role;

-- ---------- alerta_taxas(): a conta de aprovados/reprovados por posto em cada janela ----------
-- Função INTERNA (sem grant): é chamada por alerta_avaliar e alerta_previa, que já fazem o gate.
-- As três janelas convivem num único SELECT para o avaliar fazer uma passada só no banco.
create or replace function public.alerta_taxas(p_postos text[], p_janela_tipo text, p_janela_valor int)
returns table (posto text, aprovados int, reprovados int, pmo text, op text)
language sql
stable
security definer
set search_path = public
as $func$
  select p.posto,
         coalesce(c.aprovados, 0)::int,
         coalesce(c.reprovados, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    -- janela 'op': a OP do ÚLTIMO bipe do posto, e só se esse bipe tem menos de 2 horas
    left join lateral (
      select r.pmo, r.op
        from sf_registros r
       where p_janela_tipo = 'op'
         and r.posto = p.posto
         and r.data_hora >= now() - interval '2 hours'
       order by r.data_hora desc
       limit 1
    ) u on true
    left join lateral (
      select count(*) filter (where lower(x.status) = 'aprovado')  as aprovados,
             count(*) filter (where lower(x.status) = 'reprovado') as reprovados
        from (
          -- janela 'tempo': todos os bipes do posto nos últimos N minutos, de todas as OPs
          select r.status
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and lower(r.status) in ('aprovado', 'reprovado')
          union all
          -- janela 'bipes': os N últimos bipes COM status do posto, sem limite de tempo
          (select r.status
             from sf_registros r
            where p_janela_tipo = 'bipes'
              and r.posto = p.posto
              and lower(r.status) in ('aprovado', 'reprovado')
            order by r.data_hora desc
            limit p_janela_valor)
          union all
          -- janela 'op': todos os bipes do posto naquela OP
          select r.status
            from sf_registros r
           where p_janela_tipo = 'op'
             and r.posto = p.posto
             and r.pmo = u.pmo and r.op = u.op
             and lower(r.status) in ('aprovado', 'reprovado')
        ) x
    ) c on true
$func$;

revoke all on function public.alerta_taxas(text[], text, int) from public, anon, authenticated, service_role;

-- ---------- alerta_avaliar(): decide tudo e devolve a lista de envios ----------
create or replace function public.alerta_avaliar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_agora     timestamptz := now();
  v_acoes     jsonb := '[]'::jsonb;
  v_avaliadas int := 0;
  v_total     int;
  v_taxa      numeric(5,2);
  v_tipo      text;
  v_contas    jsonb;
  t           record;
  o           public.alerta_ocorrencias;
begin
  -- Duas avaliações ao mesmo tempo (cron atrasado + "Avaliar agora") abririam a MESMA ocorrência
  -- duas vezes. A segunda simplesmente vai embora avisando que está ocupado.
  if not pg_try_advisory_xact_lock(hashtext('alerta_avaliar')) then
    return jsonb_build_object('ocupado', true, 'avaliadas', 0, 'acoes', '[]'::jsonb);
  end if;

  -- Regra desativada ou posto tirado da regra: a ocorrência viva encerra SEM envio.
  update public.alerta_ocorrencias oc
     set estado = 'normalizada', normalizada_em = v_agora
    from public.alerta_regras rg
   where rg.id = oc.regra_id
     and oc.estado in ('aberta', 'resolvida')
     and (rg.ativa is false or not (oc.posto = any (rg.postos)));

  for t in
    select rg.id as regra_id, rg.nome, rg.taxa_minima, rg.janela_tipo, rg.janela_valor,
           rg.minimo_bipes, rg.lembrete_min, rg.canais, rg.destinatarios,
           tx.posto, tx.aprovados, tx.reprovados, tx.pmo, tx.op
      from public.alerta_regras rg
      cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor) tx
     where rg.ativa
     order by rg.criado_em, tx.posto
  loop
    v_avaliadas := v_avaliadas + 1;
    v_total := t.aprovados + t.reprovados;
    -- Abaixo do mínimo de bipes a regra não decide NADA (nem abre, nem normaliza).
    if v_total < t.minimo_bipes then
      continue;
    end if;
    v_taxa := trunc((t.aprovados * 100.0) / v_total, 2);
    v_tipo := null;

    select * into o
      from public.alerta_ocorrencias
     where regra_id = t.regra_id and posto = t.posto and estado in ('aberta', 'resolvida')
     for update;

    if not found then
      if v_taxa < t.taxa_minima then
        insert into public.alerta_ocorrencias
          (regra_id, posto, pmo, op, taxa_abertura, taxa_ultima, aprovados, reprovados,
           aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto,
                case when t.janela_tipo = 'op' then t.pmo end,
                case when t.janela_tipo = 'op' then t.op end,
                v_taxa, v_taxa, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif v_taxa >= t.taxa_minima then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             taxa_ultima = v_taxa, aprovados = t.aprovados, reprovados = t.reprovados
       where id = o.id
      returning * into o;
      v_tipo := 'normalizou';

    else
      -- Continua abaixo: atualiza a foto da taxa e, se for hora, marca o lembrete.
      update public.alerta_ocorrencias
         set taxa_ultima = v_taxa, aprovados = t.aprovados, reprovados = t.reprovados,
             ultimo_envio_em = case
               when o.estado = 'aberta' and t.lembrete_min is not null
                    and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min)
                 then v_agora
               else o.ultimo_envio_em
             end
       where id = o.id
      returning * into o;
      if o.estado = 'aberta' and t.lembrete_min is not null and o.ultimo_envio_em = v_agora then
        v_tipo := 'lembrete';
      end if;
    end if;

    if v_tipo is not null then
      -- Um envio por destinatário x canal da regra QUE TENHA vínculo. Sem vínculo, é pulado aqui.
      v_contas := coalesce((
        select jsonb_agg(jsonb_build_object('usuario_id', c.usuario_id, 'canal', c.canal,
                                            'externo_id', c.externo_id)
                         order by c.usuario_id, c.canal)
          from alerta_contas c
         where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
      ), '[]'::jsonb);

      v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
        'ocorrencia_id', o.id,
        'tipo',          v_tipo,
        'regra_id',      t.regra_id,
        'regra_nome',    t.nome,
        'posto',         t.posto,
        'taxa',          v_taxa,
        'taxa_minima',   t.taxa_minima,
        'aprovados',     t.aprovados,
        'reprovados',    t.reprovados,
        'janela_tipo',   t.janela_tipo,
        'janela_valor',  t.janela_valor,
        'pmo',           t.pmo,
        'op',            t.op,
        'aberta_em',     o.aberta_em,
        'agora',         v_agora,
        'contas',        v_contas
      ));
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas, 'acoes', v_acoes);
end
$func$;

revoke all on function public.alerta_avaliar() from public, anon, authenticated;
grant execute on function public.alerta_avaliar() to service_role;

-- ---------- alerta_previa(): a taxa de agora, sem gravar nada (prévia do formulário) ----------
create or replace function public.alerta_previa(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int
)
returns table (posto text, aprovados int, reprovados int, taxa numeric, avaliavel boolean,
               pmo text, op text)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_janela_tipo not in ('tempo', 'bipes', 'op') then raise exception 'JANELA_INVALIDA'; end if;

  return query
    select t.posto, t.aprovados, t.reprovados,
           case when t.aprovados + t.reprovados > 0
                then trunc((t.aprovados * 100.0) / (t.aprovados + t.reprovados), 2)
           end,
           (t.aprovados + t.reprovados) >= greatest(coalesce(p_minimo, 1), 1),
           t.pmo, t.op
      from public.alerta_taxas(p_postos, p_janela_tipo, p_janela_valor) t;
end
$func$;

revoke all on function public.alerta_previa(text[], text, int, int) from public, anon;
grant execute on function public.alerta_previa(text[], text, int, int) to authenticated, service_role;

-- ---------- Resolver ----------
-- O núcleo é interno; as duas portas mudam só QUEM pode chamar e se exige ser destinatário:
--   alerta_resolver       -> webhook (service_role), exige ser destinatário da regra;
--   alerta_resolver_admin -> tela (authenticated + shopfloor.administrar).
create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  o     public.alerta_ocorrencias;
  r     public.alerta_regras;
  v_ja  boolean := true;
  v_nome text;
begin
  select * into o from alerta_ocorrencias where id = p_ocorrencia_id for update;
  if not found then raise exception 'OCORRENCIA_INEXISTENTE'; end if;
  select * into r from alerta_regras where id = o.regra_id;
  if p_exigir_destinatario and not (p_usuario_id = any (r.destinatarios)) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  if o.estado = 'normalizada' then raise exception 'OCORRENCIA_ENCERRADA'; end if;

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now()
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  return jsonb_build_object(
    'ocorrencia_id',      o.id,
    'regra_id',           o.regra_id,
    'posto',              o.posto,
    'ja_resolvida',       v_ja,
    'resolvida_por',      o.resolvida_por,
    'resolvida_por_nome', coalesce(v_nome, ''),
    'resolvida_em',       o.resolvida_em
  );
end
$func$;

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.alerta_resolver(p_ocorrencia_id uuid, p_usuario_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $func$
  select public.alerta_resolver_interno(p_ocorrencia_id, p_usuario_id, true)
$func$;

revoke all on function public.alerta_resolver(uuid, uuid) from public, anon, authenticated;
grant execute on function public.alerta_resolver(uuid, uuid) to service_role;

create or replace function public.alerta_resolver_admin(p_ocorrencia_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return public.alerta_resolver_interno(p_ocorrencia_id, auth.uid(), false);
end
$func$;

revoke all on function public.alerta_resolver_admin(uuid) from public, anon;
grant execute on function public.alerta_resolver_admin(uuid) to authenticated, service_role;

-- ---------- alerta_destinatarios(): quem pode receber, e por quais canais ----------
-- Devolve o VÍNCULO como booleano (nunca o externo_id) — a tela só precisa saber se existe.
create or replace function public.alerta_destinatarios()
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord')
      from usuarios u
     where u.ativo
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios() from public, anon;
grant execute on function public.alerta_destinatarios() to authenticated, service_role;

-- ---------- alerta_listar_ocorrencias(): aba Ocorrências ----------
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select oc.id, oc.regra_id, rg.nome, oc.posto, oc.pmo, oc.op, oc.estado,
           oc.taxa_abertura, oc.taxa_ultima, oc.aprovados, oc.reprovados, oc.aberta_em,
           coalesce(nullif(btrim(u.nome), ''), u.email, ''),
           oc.resolvida_em, oc.normalizada_em,
           coalesce(e.ok_qtd, 0)::int, coalesce(e.falha_qtd, 0)::int
      from alerta_ocorrencias oc
      join alerta_regras rg on rg.id = oc.regra_id
      left join usuarios u on u.id = oc.resolvida_por
      left join lateral (
        select count(*) filter (where ev.ok)     as ok_qtd,
               count(*) filter (where not ev.ok) as falha_qtd
          from alerta_envios ev
         where ev.ocorrencia_id = oc.id
      ) e on true
     where oc.aberta_em >= p_de
       and oc.aberta_em <= p_ate
       and (coalesce(p_estado, '') = '' or oc.estado = p_estado)
     order by oc.aberta_em desc
     limit 500;
end
$func$;

revoke all on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
