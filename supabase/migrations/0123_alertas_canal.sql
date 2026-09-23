-- =============================================================
-- ALERTAS — AVISAR NUM CANAL DO DISCORD (além da conversa privada)
-- Spec: docs/superpowers/specs/2026-09-23-alertas-reabertura-e-canal-design.md (Parte 2)
--
-- Aplica POR CIMA da 0113/0115/0122 (nenhuma delas é editada). Idempotente: rodar de novo não
-- quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0123_alertas_canal.sql
--
-- O CONCEITO QUE SE SEPARA AQUI: até hoje `alerta_regras.destinatarios` significava duas coisas ao
-- mesmo tempo — quem RECEBE a mensagem e quem tem DIREITO DE ENCERRAR a ocorrência. Com o canal
-- entrando, uma regra que avisasse só no canal ficaria com o botão "Resolvido" visível para todos e
-- SEM NINGUÉM que conseguisse apertar. Então:
--
--   destinatarios   = os RESPONSÁVEIS (quem responde pelo alerta e pode encerrá-lo). Continua
--                     obrigatório ter pelo menos um, e continua sendo a régua do "Resolvido".
--   avisar_pessoas  = manda na conversa privada de cada responsável (o comportamento de hoje).
--   avisar_canal    = manda no canal do Discord do sistema.
--
-- "Só no canal" = avisar_pessoas = false e avisar_canal = true: ninguém recebe no privado, todos
-- veem no canal, e os responsáveis continuam podendo encerrar pelo botão.
--
-- MIGRAÇÃO ADITIVA E SEGURA: alerta_envios é a tabela por onde passa todo alerta que funciona hoje.
-- As linhas que já existem ganham destino_tipo = 'usuario' pelo default e continuam sendo
-- enfileiradas e reservadas exatamente como antes; as regras que já existem ganham
-- avisar_pessoas = true e avisar_canal = false, ou seja, o comportamento atual sem mudança nenhuma.
--
-- O ID DO CANAL vem do SERVIDOR (DISCORD_CANAL_ID), não do banco: o app passa em
-- alerta_avaliar(p_canal_discord) e o valor é congelado na linha da fila (destino_externo_id), do
-- mesmo jeito que `dados` congela o que o texto precisa. Sem o parâmetro (variável não
-- configurada), nada é enfileirado para canal — as pessoas continuam sendo avisadas normalmente.
--
-- Convenções (as mesmas da 0113/0115/0122): corpo de função com $func$ (o SQL Editor não aceita
-- dois cifrões, nem em comentário); grants e revokes explícitos; mudança de assinatura exige
-- drop antes; notify pgrst na última linha.
-- =============================================================

-- ---------- A. Regras: como avisar (pessoas e/ou canal) ----------
alter table public.alerta_regras
  add column if not exists avisar_pessoas boolean not null default true,
  add column if not exists avisar_canal   boolean not null default false;

-- Os dois desligados = regra que não avisa ninguém: não existe motivo para isso existir.
alter table public.alerta_regras drop constraint if exists alerta_regras_avisa_alguem;
alter table public.alerta_regras add constraint alerta_regras_avisa_alguem
  check (avisar_pessoas or avisar_canal);

-- O canal é DO DISCORD. O Telegram continua só na conversa privada, então avisar no canal sem
-- 'discord' marcado nos canais da regra não faria nada — é erro de cadastro, não silêncio.
alter table public.alerta_regras drop constraint if exists alerta_regras_canal_exige_discord;
alter table public.alerta_regras add constraint alerta_regras_canal_exige_discord
  check (not avisar_canal or 'discord' = any (canais));

-- ---------- B. Fila: linha de canal não tem usuário ----------
-- `usuario_id` deixa de ser obrigatório (um envio para canal não é de ninguém) e um check garante
-- que cada tipo de destino traga o que precisa — a garantia antiga (envio de pessoa SEMPRE com
-- usuario_id) continua valendo, agora escrita explicitamente.
alter table public.alerta_envios alter column usuario_id drop not null;

alter table public.alerta_envios
  add column if not exists destino_tipo       text not null default 'usuario',
  add column if not exists destino_externo_id text;

alter table public.alerta_envios drop constraint if exists alerta_envios_destino_tipo_valido;
alter table public.alerta_envios add constraint alerta_envios_destino_tipo_valido
  check (destino_tipo in ('usuario', 'canal'));

-- coalesce(..., false): sem ele um destino_tipo estranho daria NULL, e check com NULL PASSA.
alter table public.alerta_envios drop constraint if exists alerta_envios_destino_coerente;
alter table public.alerta_envios add constraint alerta_envios_destino_coerente check (coalesce(
  case destino_tipo
    when 'usuario' then usuario_id is not null
    when 'canal'   then destino_externo_id is not null and btrim(destino_externo_id) <> ''
  end, false));

-- ---------- C. alerta_avaliar(p_canal_discord): fan-out por pessoa e/ou uma linha de canal ----------
-- Igual à da 0122 + o destino:
--   avisar_pessoas -> o fan-out de sempre (uma linha por responsável x canal vinculado);
--   avisar_canal   -> UMA linha por ocorrência com destino_tipo = 'canal'. Uma, não uma por
--                     responsável: senão viram N mensagens iguais no mesmo canal.
-- Assinatura nova (o app passa o DISCORD_CANAL_ID): a antiga, sem parâmetro, sai antes.
drop function if exists public.alerta_avaliar();
create or replace function public.alerta_avaliar(p_canal_discord text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set jit = off
as $func$
#variable_conflict use_column
declare
  v_agora        timestamptz := now();
  v_avaliadas    int := 0;
  v_enfileirados int := 0;
  v_n            int;
  v_normalizadas uuid[];
  v_abaixo       boolean;
  v_tipo         text;
  v_lembrete     boolean;
  v_reabrir      boolean;
  v_nome         text;
  v_dados        jsonb;
  -- Canal do sistema (DISCORD_CANAL_ID). Vazio ou ausente = este ambiente não tem canal: as
  -- regras com avisar_canal simplesmente não enfileiram a linha de canal (e quem tem
  -- avisar_pessoas continua sendo avisado). Nada fica pendente à espera de configuração.
  v_canal        text := nullif(btrim(coalesce(p_canal_discord, '')), '');
  t              record;
  o              public.alerta_ocorrencias;
begin
  -- Duas avaliações ao mesmo tempo (cron atrasado + "Avaliar agora") abririam a MESMA ocorrência
  -- duas vezes. A segunda simplesmente vai embora avisando que está ocupado.
  if not pg_try_advisory_xact_lock(hashtext('alerta_avaliar')) then
    return jsonb_build_object('ocupado', true, 'avaliadas', 0, 'enfileirados', 0,
                              'normalizadas', '[]'::jsonb);
  end if;

  -- Regra desativada, EXCLUÍDA ou posto tirado da regra: a ocorrência viva encerra SEM envio.
  with encerradas as (
    update public.alerta_ocorrencias oc
       set estado = 'normalizada', normalizada_em = v_agora
      from public.alerta_regras rg
     where rg.id = oc.regra_id
       and oc.estado in ('aberta', 'resolvida')
       and (rg.ativa is false or rg.excluida_em is not null or not (oc.posto = any (rg.postos)))
    returning oc.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_normalizadas from encerradas;

  for t in
    select m.*
      from (
        -- Taxa de aprovação
        select rg.id as regra_id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               tx.posto, null::text as defeito, tx.pmo, tx.op,
               tx.aprovados, tx.reprovados,
               (tx.aprovados + tx.reprovados) as amostras,
               (tx.aprovados + tx.reprovados) >= rg.minimo_bipes as avaliavel,
               case when tx.aprovados + tx.reprovados > 0
                    then trunc((tx.aprovados * 100.0) / (tx.aprovados + tx.reprovados), 2)
               end as valor,
               rg.taxa_minima::numeric as limite
          from public.alerta_regras rg
          cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                 public.alerta_pmos_normalizar(rg.pmos)) tx
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'aprovacao'
        union all
        -- Tempo médio por peça
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               tp.posto, null::text, tp.pmo, tp.op,
               0, 0,
               tp.pecas,
               -- Mínimo de BIPES (peças), igual ao da aprovação — não de intervalos. `media_seg is not
               -- null` já garante pelo menos 1 intervalo válido para calcular a média.
               tp.pecas >= rg.minimo_bipes and tp.media_seg is not null,
               tp.media_seg,
               rg.limite_tempo_seg::numeric
          from public.alerta_regras rg
          cross join lateral public.alerta_tempos(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                  rg.pausa_max_min,
                                                  public.alerta_pmos_normalizar(rg.pmos)) tp
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'tempo'
        union all
        -- Defeito repetido: os códigos da janela + os que têm ocorrência viva (contagem 0 se sumiram)
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               df.posto, df.defeito, null::text, null::text,
               0, 0,
               df.ocorrencias,
               true,
               df.ocorrencias::numeric,
               rg.limite_ocorrencias::numeric
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select x.posto, x.defeito, x.ocorrencias
                from public.alerta_defeitos(rg.postos, rg.janela_valor,
                                              public.alerta_pmos_normalizar(rg.pmos)) x
            )
            select d.posto, d.defeito, d.ocorrencias from d
            union all
            select oc.posto, oc.defeito, 0
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.defeito = oc.defeito)
          ) df
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'defeito'
      ) m
     order by m.criado_em, m.regra_id, m.posto, m.defeito nulls first
  loop
    v_avaliadas := v_avaliadas + 1;
    -- Sem o mínimo (bipes ou intervalos), a regra não decide NADA (nem abre, nem normaliza).
    if not coalesce(t.avaliavel, false) then
      continue;
    end if;
    v_abaixo := coalesce(case t.tipo
                           when 'aprovacao' then t.valor <  t.limite
                           when 'tempo'     then t.valor >  t.limite
                           else                  t.valor >= t.limite
                         end, false);
    v_tipo := null;
    -- Zerado a cada item: sem isto v_reabrir sobreviveria para a volta seguinte do laço e o item
    -- seguinte sairia da fila marcado como reabertura.
    v_reabrir := false;

    select * into o
      from public.alerta_ocorrencias
     where regra_id = t.regra_id and posto = t.posto
       and coalesce(defeito, '') = coalesce(t.defeito, '')
       and estado in ('aberta', 'resolvida')
     for update;

    if not found then
      if v_abaixo then
        insert into public.alerta_ocorrencias
          (regra_id, posto, defeito, pmo, op, taxa_abertura, taxa_ultima, valor_abertura, valor_ultimo,
           amostras, aprovados, reprovados, aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto, t.defeito,
                case when t.janela_tipo = 'op' then btrim(t.pmo) end,
                case when t.janela_tipo = 'op' then t.op end,
                case when t.tipo = 'aprovacao' then t.valor end,
                case when t.tipo = 'aprovacao' then t.valor end,
                t.valor, t.valor, t.amostras, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif not v_abaixo then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados
       where id = o.id
      returning * into o;
      v_tipo := 'normalizou';
      v_normalizadas := v_normalizadas || o.id;

    else
      -- REABERTURA (0122): foi dada como resolvida, a carência venceu e o problema continua.
      -- `coalesce(o.resolvida_em, o.ultimo_envio_em)`: falha SEGURA. Toda resolução grava
      -- resolvida_em, mas uma linha antiga/estranha sem ela não pode ficar muda para sempre.
      v_reabrir := o.estado = 'resolvida'
                   and v_agora - coalesce(o.resolvida_em, o.ultimo_envio_em)
                       >= make_interval(mins => public.alerta_carencia_min(t.janela_tipo, t.janela_valor));

      -- Decide o lembrete ANTES do update, num booleano — nunca comparando `ultimo_envio_em`
      -- com `v_agora` depois (duas avaliações no mesmo instante teriam o mesmo `now()`).
      v_lembrete := o.estado = 'aberta' and t.lembrete_min is not null
                    and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min);

      update public.alerta_ocorrencias
         set taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados,
             -- Volta a 'aberta' (o botão "Resolvido" passa a valer de novo). resolvida_por e
             -- resolvida_em ficam como estão: o texto da reabertura usa, e a auditoria precisa.
             estado      = case when v_reabrir then 'aberta' else estado end,
             reaberta_em = case when v_reabrir then v_agora else reaberta_em end,
             reaberturas = reaberturas + case when v_reabrir then 1 else 0 end,
             -- Reabrir renova o ciclo de lembrete: o próximo conta a partir de agora.
             ultimo_envio_em = case when v_reabrir or v_lembrete then v_agora else o.ultimo_envio_em end
       where id = o.id
      returning * into o;
      if v_reabrir then
        v_tipo := 'alerta';
      elsif v_lembrete then
        v_tipo := 'lembrete';
      end if;
    end if;

    if v_tipo is not null then
      -- `dados` = o que o app precisa para montar o texto (ver domain/envio.ts). Números crus; a
      -- formatação (%, mm:ss, rótulo do defeito, fuso) mora só no TS. O texto do canal é o MESMO
      -- do privado — quem lê precisa da mesma informação.
      v_dados := jsonb_build_object(
                   'regra_tipo',   t.tipo,
                   'regra_nome',   t.nome,
                   'posto',        t.posto,
                   'janela_tipo',  t.janela_tipo,
                   'janela_valor', t.janela_valor,
                   'pmo',          btrim(t.pmo),
                   'op',           t.op,
                   'aberta_em',    o.aberta_em,
                   'agora',        v_agora)
                 || case t.tipo
                      when 'aprovacao' then jsonb_build_object(
                        'taxa', t.valor, 'taxa_minima', t.limite,
                        'aprovados', t.aprovados, 'reprovados', t.reprovados)
                      when 'tempo' then jsonb_build_object(
                        'media_seg', t.valor, 'limite_tempo_seg', t.limite, 'pecas', t.amostras)
                      else jsonb_build_object(
                        'defeito', t.defeito, 'ocorrencias', t.amostras, 'limite_ocorrencias', t.limite)
                    end;

      -- Reabertura: o texto tem que dizer que foi dado como resolvido por Fulano há X e que
      -- CONTINUA fora do limite. Sem isso, quem recebe acha que é um problema novo.
      if v_reabrir then
        select coalesce(nullif(btrim(nome), ''), email) into v_nome
          from public.usuarios where id = o.resolvida_por;
        v_dados := v_dados || jsonb_build_object(
                     'reabertura',         true,
                     'resolvida_por_nome', coalesce(v_nome, ''),
                     'resolvida_em',       o.resolvida_em,
                     'reaberturas',        o.reaberturas);
      end if;

      -- FILA (pessoas): uma linha pendente por RESPONSÁVEL x canal da regra QUE TENHA vínculo
      -- AGORA, que esteja ATIVO e que administre o ShopFloor. Mesma transação da decisão: ou as
      -- duas coisas ficam, ou nenhuma. `avisar_pessoas = false` = ninguém no privado.
      if t.avisar_pessoas then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo)
        select o.id, c.usuario_id, c.canal, v_tipo, v_dados, v_tipo in ('alerta', 'lembrete'), 'usuario'
          from public.alerta_contas c
          join public.usuarios u on u.id = c.usuario_id and u.ativo
         where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
           -- responsável precisa administrar o ShopFloor AGORA (spec 2026-09-18, decisão 5)
           and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
         order by c.usuario_id, c.canal;
        get diagnostics v_n = row_count;
        v_enfileirados := v_enfileirados + v_n;
      end if;

      -- FILA (canal): UMA linha por ocorrência, sem usuário. O `select` sem `from` devolve 1 linha
      -- quando o `where` é verdadeiro e 0 quando não — é assim que sai uma, e não uma por
      -- responsável (N mensagens iguais no mesmo canal).
      if t.avisar_canal and v_canal is not null and 'discord' = any (t.canais) then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo, destino_externo_id)
        select o.id, null, 'discord', v_tipo, v_dados, v_tipo in ('alerta', 'lembrete'), 'canal', v_canal;
        get diagnostics v_n = row_count;
        v_enfileirados := v_enfileirados + v_n;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas,
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas));
end
$func$;

revoke all on function public.alerta_avaliar(text) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text) to service_role;

-- ---------- D. alerta_reservar_envios(): reserva os dois tipos de destino ----------
-- O `join` com alerta_contas era INNER, e é ele que resolve o endereço: uma linha de canal nunca
-- seria reservada e ficaria pendente até expirar em 24 h. Agora os dois joins de pessoa são LEFT e
-- os filtros de usuário (ativo, shopfloor.administrar, conta vinculada) valem SÓ para
-- destino_tipo = 'usuario' — os envios de pessoa continuam sendo entregues exatamente como hoje.
-- O endereço sai de `coalesce(c.externo_id, e.destino_externo_id)`: a conta de AGORA para pessoa
-- (quem desvinculou não recebe), o id congelado no enfileiramento para canal.
--
-- O retorno ganhou destino_tipo no fim (o app precisa saber se manda DM ou posta no canal), então
-- a assinatura antiga sai antes do create.
drop function if exists public.alerta_reservar_envios(text[], int, uuid);
create or replace function public.alerta_reservar_envios(
  p_canais text[], p_limite int default 30, p_ocorrencia_id uuid default null
)
returns table (id uuid, ocorrencia_id uuid, usuario_id uuid, canal text, externo_id text,
               tipo text, dados jsonb, com_botao boolean, tentativas int, destino_tipo text)
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  return query
    with alvo as (
      select e.id, coalesce(c.externo_id, e.destino_externo_id) as externo_id
        from public.alerta_envios e
        left join public.alerta_contas c
               on e.destino_tipo = 'usuario' and c.usuario_id = e.usuario_id and c.canal = e.canal
        left join public.usuarios u
               on e.destino_tipo = 'usuario' and u.id = e.usuario_id
        left join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
       where e.ok = false
         and e.tentativas < 3
         and e.tipo <> 'teste'
         and e.criado_em >= now() - interval '24 hours'
         and e.canal = any (coalesce(p_canais, '{}'::text[]))
         and (p_ocorrencia_id is null or e.ocorrencia_id = p_ocorrencia_id)
         and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
         and (e.tipo not in ('alerta', 'lembrete') or oc.estado = 'aberta')
         and case e.destino_tipo
               -- pessoa: a régua de sempre (conta vinculada agora, usuário ativo, administra o
               -- ShopFloor). Quem perdeu qualquer uma nunca é reservado: a linha fica pendente,
               -- não conta tentativa nem falha, e sai da fila sozinha depois das 24 h.
               when 'usuario' then c.externo_id is not null and coalesce(u.ativo, false)
                                   and public.usuario_tem_permissao(e.usuario_id, 'shopfloor', 'administrar')
               -- canal: o endereço já vem congelado na linha; não há conta nem permissão a checar.
               when 'canal'   then e.destino_externo_id is not null
               else false
             end
       order by (e.tentativas > 0), e.criado_em, e.id
       limit least(greatest(coalesce(p_limite, 30), 1), 100)
       for update of e skip locked
    ),
    reservadas as (
      update public.alerta_envios e
         set tentativas = e.tentativas + 1, reservado_em = now()
        from alvo
       where e.id = alvo.id
      returning e.id, e.ocorrencia_id, e.usuario_id, e.canal, alvo.externo_id, e.tipo, e.dados,
                e.com_botao, e.tentativas, e.criado_em, e.destino_tipo
    )
    select r.id, r.ocorrencia_id, r.usuario_id, r.canal, r.externo_id, r.tipo, r.dados,
           r.com_botao, r.tentativas, r.destino_tipo
      from reservadas r
     order by (r.tentativas > 1), r.criado_em, r.id;
end
$func$;

revoke all on function public.alerta_reservar_envios(text[], int, uuid) from public, anon, authenticated;
grant execute on function public.alerta_reservar_envios(text[], int, uuid) to service_role;

-- ---------- E. alerta_resolver_interno(): o "✅ resolvido por X" respeita avisar_pessoas ----------
-- Igual à da 0115 + `r.avisar_pessoas` no aviso aos outros responsáveis. Numa regra que avisa SÓ no
-- canal, ninguém recebeu o alerta no privado: mandar só o "resolvido" na conversa privada seria uma
-- mensagem solta, sem contexto. No canal, o próprio clique já edita a mensagem (acrescenta quem
-- resolveu e apaga o botão), então o canal não precisa de linha nova na fila.
--
-- Quem pode encerrar NÃO muda: responsável da regra (destinatarios) e administrador do ShopFloor.
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
  -- `p_usuario_id is null` explícito: falha FECHADA (null = any(...) dá NULL, não false).
  if p_exigir_destinatario and (p_usuario_id is null or not (p_usuario_id = any (r.destinatarios))) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  -- Usuário inexistente, desativado OU sem shopfloor.administrar nunca é responsável válido, mesmo
  -- que o uuid ainda esteja no array `destinatarios` da regra (usuario_tem_permissao já exige ativo).
  if p_exigir_destinatario
     and not public.usuario_tem_permissao(p_usuario_id, 'shopfloor', 'administrar') then
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

  -- FILA: "✅ resolvido por X" para os OUTROS responsáveis ativos que administram o ShopFloor, na
  -- mesma transação da resolução. Só na primeira resolução — apertar o botão de novo não avisa.
  -- `defeito` (nulo nos outros tipos) vai junto: numa regra de defeito com 2 códigos abertos no
  -- mesmo posto, sem ele o texto não diria QUAL dos dois foi resolvido.
  if not v_ja and r.avisar_pessoas then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo)
    select o.id, c.usuario_id, c.canal, 'resolvido',
           jsonb_build_object('posto', o.posto, 'defeito', o.defeito, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em),
           false, 'usuario'
      from alerta_contas c
      join usuarios u on u.id = c.usuario_id and u.ativo
     where c.usuario_id = any (r.destinatarios)
       and c.canal = any (r.canais)
       and c.usuario_id is distinct from p_usuario_id
       and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
     order by c.usuario_id, c.canal;
  end if;

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

notify pgrst, 'reload schema';
