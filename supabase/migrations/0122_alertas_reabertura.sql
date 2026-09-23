-- =============================================================
-- ALERTAS — REABRIR OCORRÊNCIA RESOLVIDA QUE NÃO FOI RESOLVIDA DE VERDADE
-- Spec: docs/superpowers/specs/2026-09-23-alertas-reabertura-e-canal-design.md (Parte 1)
--
-- Aplica POR CIMA da 0113/0115 (já em produção — nenhuma das duas é editada). Idempotente: rodar
-- de novo não quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0122_alertas_reabertura.sql
--
-- O DEFEITO QUE ISTO CORRIGE (está em produção hoje): ao apertar "Resolvido" a ocorrência vira
-- 'resolvida' e, com o problema continuando, nada mais acontece — o lembrete exige
-- estado = 'aberta', a avaliação não abre outra (o índice único alerta_ocorrencias_viva_defeito
-- cobre 'aberta' E 'resolvida') e a reserva da fila filtra oc.estado = 'aberta'. Ou seja: apertar
-- Resolvido SILENCIA aquele problema até ele normalizar sozinho.
--
-- O DESENHO: ocorrência 'resolvida' + condição ainda ruim + carência vencida = volta para 'aberta'
-- e avisa de novo, com o texto marcando que é REABERTURA.
--
-- O que muda:
--   A. alerta_ocorrencias ganha reaberta_em e reaberturas (a contagem NÃO corta o aviso — teto de
--      reaberturas traria de volta o defeito que estamos corrigindo).
--   B. alerta_carencia_min(): quanto esperar depois do "Resolvido", a partir da janela da regra.
--   C. alerta_avaliar(): no ramo "continua ruim e já existe ocorrência viva", ANTES do cálculo do
--      lembrete, entra o sub-ramo de reabertura.
--   D. alerta_listar_ocorrencias(): devolve reaberta_em e reaberturas (a tela mostra "Reaberta").
--
-- O que NÃO muda: o índice único (os dois estados já estavam cobertos), a fila e a reserva (o
-- filtro oc.estado = 'aberta' volta a valer sozinho quando a ocorrência reabre) e quem pode
-- encerrar. resolvida_por/resolvida_em são PRESERVADOS: são o que o texto da reabertura usa e o
-- que mantém a auditoria honesta.
--
-- Convenções (as mesmas da 0113/0115): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A. Ocorrências: quando reabriu e quantas vezes ----------
alter table public.alerta_ocorrencias
  add column if not exists reaberta_em  timestamptz,
  add column if not exists reaberturas  int not null default 0;

alter table public.alerta_ocorrencias drop constraint if exists alerta_ocorrencias_reaberturas_positivo;
alter table public.alerta_ocorrencias add constraint alerta_ocorrencias_reaberturas_positivo
  check (reaberturas >= 0);

-- ---------- B. alerta_carencia_min(): quanto esperar depois do "Resolvido" ----------
-- Função INTERNA (sem grant): só alerta_avaliar chama, e ela é security definer (roda como dona).
--
-- A carência sai da JANELA DA REGRA, e o motivo é técnico: a janela é o tempo que o problema leva
-- para sair da conta. Numa regra de 60 min, uma correção feita agora só aparece por completo daqui
-- a 60 min — os bipes ruins continuam dentro da janela. Reabrir antes disso reabriria MESMO quando
-- o problema foi resolvido de verdade, e alarme falso destrói a confiança no alerta.
--
--   janela 'tempo' -> o próprio N de minutos
--   janela 'bipes' -> 60 min fixos (não dá para converter bipes em tempo: depende do ritmo)
--   janela 'op'    -> 60 min fixos (a janela nunca "passa": é a OP inteira)
--
-- Nos tipos 'bipes' e 'op' o valor fixo existe também porque NÃO SE PODE LER o campo de minutos:
-- com "OP em andamento" marcado o campo fica desabilitado na tela, e o número que está lá é resto
-- do que havia antes (ou o padrão do formulário) — a pessoa nunca escolheu aquilo.
--
-- Piso e teto, porque a janela aceita extremos: janela de 5 min reabriria a cada 5 min (spam, e a
-- pessoa desliga a regra); janela de 7 dias com carência de 7 dias é o defeito de hoje de volta.
create or replace function public.alerta_carencia_min(p_janela_tipo text, p_janela_valor int)
returns int
language sql
immutable
set search_path = public
as $func$
  select greatest(15, least(120,
           case when p_janela_tipo = 'tempo' and coalesce(p_janela_valor, 0) > 0
                then p_janela_valor
                else 60
           end))
$func$;

revoke all on function public.alerta_carencia_min(text, int)
  from public, anon, authenticated, service_role;

-- ---------- C. alerta_avaliar(): reabre a ocorrência dada como resolvida ----------
-- Igual à da 0115 + o sub-ramo de REABERTURA no ramo "continua ruim com ocorrência viva":
--
--   estado = 'resolvida' e já passou a carência  -> volta para 'aberta', reaberturas + 1,
--                                                   ultimo_envio_em renovado (o ciclo de lembrete
--                                                   recomeça do zero) e envio do tipo 'alerta' com
--                                                   'reabertura' nos dados;
--   estado = 'resolvida' e AINDA na carência     -> nada (nem lembrete, nem envio) — é o silêncio
--                                                   de propósito, esperando a janela virar;
--   estado = 'aberta'                            -> exatamente o lembrete de antes.
--
-- Sem teto de reaberturas: "no máximo N" traria de volta o defeito que esta migração corrige
-- (depois da última, silêncio). Se um problema fica 6 horas fora do limite, é certo que ele avise
-- 6 vezes. A contagem é guardada para aparecer na tela e para medirmos se isso vira incômodo.
create or replace function public.alerta_avaliar()
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
               rg.canais, rg.destinatarios, rg.criado_em,
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
               rg.canais, rg.destinatarios, rg.criado_em,
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
               rg.canais, rg.destinatarios, rg.criado_em,
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
      -- REABERTURA: foi dada como resolvida, a carência venceu e o problema continua.
      -- `coalesce(o.resolvida_em, o.ultimo_envio_em)`: falha SEGURA. Toda resolução grava
      -- resolvida_em, mas uma linha antiga/estranha sem ela não pode ficar muda para sempre — que
      -- é justamente o defeito corrigido aqui.
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
      -- formatação (%, mm:ss, rótulo do defeito, fuso) mora só no TS.
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

      -- FILA: uma linha pendente por destinatário x canal da regra QUE TENHA vínculo AGORA, que
      -- esteja ATIVO e que administre o ShopFloor. Mesma transação da decisão: ou as duas coisas ficam, ou nenhuma.
      insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao)
      select o.id, c.usuario_id, c.canal, v_tipo, v_dados, v_tipo in ('alerta', 'lembrete')
        from public.alerta_contas c
        join public.usuarios u on u.id = c.usuario_id and u.ativo
       where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
         -- destinatário precisa administrar o ShopFloor AGORA (spec 2026-09-18, decisão 5)
         and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
       order by c.usuario_id, c.canal;
      get diagnostics v_n = row_count;
      v_enfileirados := v_enfileirados + v_n;
    end if;

  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas,
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas));
end
$func$;

revoke all on function public.alerta_avaliar() from public, anon, authenticated;
grant execute on function public.alerta_avaliar() to service_role;

-- ---------- D. alerta_listar_ocorrencias(): + reaberta_em e reaberturas ----------
-- O retorno mudou (colunas novas no FIM): create or replace não troca retorno, então drop antes.
drop function if exists public.alerta_listar_ocorrencias(timestamptz, timestamptz, text);
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int,
  regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int,
  reaberta_em timestamptz, reaberturas int
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
    select oc.id, oc.regra_id,
           rg.nome || case when rg.excluida_em is not null then ' (excluída)' else '' end,
           oc.posto, oc.pmo, oc.op, oc.estado,
           oc.taxa_abertura, oc.taxa_ultima, oc.aprovados, oc.reprovados, oc.aberta_em,
           coalesce(nullif(btrim(u.nome), ''), u.email, ''),
           oc.resolvida_em, oc.normalizada_em,
           coalesce(e.ok_qtd, 0)::int, coalesce(e.falha_qtd, 0)::int,
           rg.tipo, oc.defeito, oc.valor_abertura, oc.valor_ultimo, oc.amostras,
           oc.reaberta_em, oc.reaberturas
      from alerta_ocorrencias oc
      join alerta_regras rg on rg.id = oc.regra_id
      left join usuarios u on u.id = oc.resolvida_por
      left join lateral (
        -- falha = tentou e não entregou, ou gastou as 3 tentativas (mesma régua da 0113)
        select count(*) filter (where ev.ok)                                        as ok_qtd,
               count(*) filter (where not ev.ok
                                  and (ev.erro is not null or ev.tentativas >= 3)) as falha_qtd
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
