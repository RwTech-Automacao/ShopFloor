-- =============================================================
-- FIM DE EMB (0149 + 0150 + 0151) — ROLLBACK
-- Só se algo der errado DEPOIS de as três migrações terem sido aplicadas.
--
-- ⚠️ PRIMEIRO O APP, DEPOIS ESTE ARQUIVO. Volte o app para o commit de antes (DEPLOY-FIM-DE-EMB.md,
-- "Se algo der errado", passo 1) ANTES de rodar isto. O app novo chama alerta_destinatarios com o
-- módulo, lê a coluna email_ok, grava regras com `modulo` e o tipo 'emb' — tudo o que este arquivo
-- apaga. O app VELHO funciona com o banco novo (a 0149 foi feita para isso), então a ordem
-- "app primeiro" não deixa janela quebrada; a ordem contrária deixaria.
--
-- Devolve o banco ao estado de ANTES da 0149, numa transação só (tudo ou nada):
--   a) cria public.alerta_bkp_0149_0151_linhas_removidas (RLS ligada, fechada para o app);
--   b) TIRA DO CAMINHO as linhas que os checks antigos recusariam, guardando cada uma inteira
--      (to_jsonb) na tabela do passo a, e imprime quantas foram:
--        - alerta_envios de canal 'email', de tipo 'emb' ou de módulo 'recebimento' → apagadas;
--        - linhas de alerta_emb_avisada (a tabela é apagada no passo h) → copiadas;
--        - regras de tipo 'emb' / módulo 'recebimento' → apagadas;
--        - regras do ShopFloor que ganharam 'email' nos canais → o 'email' sai dos canais; se não
--          sobrar canal nenhum, a regra fica com '{telegram}' e DESATIVADA (ativa = false), porque
--          o check antigo exige pelo menos um canal e a regra não pode sair avisando por um canal
--          que ninguém escolheu. A linha original fica guardada;
--   c) as 3 policies de alerta_regras voltam às da 0113 (texto copiado da 0113);
--   d) sai o trigger alerta_regras_modulo_fixo e a função dele;
--   e) os CHECKs voltam aos de antes: tipo_valido e campos_por_tipo da 0141, alerta_envios_tipo_check
--      da 0141, e os três de nome automático da 0113 (alerta_regras_postos_check,
--      alerta_regras_canais_check, alerta_envios_canal_check); saem os 7 checks novos;
--   f) saem as colunas `modulo` de alerta_regras e alerta_envios;
--   g) as 5 funções voltam ao corpo de antes, COPIADO BYTE A BYTE das migrações que as definiram por
--      último antes da 0149 — alerta_avaliar (0141), alerta_resolver_interno (0137),
--      alerta_reservar_envios (0123), alerta_destinatarios() (0115) e
--      alerta_listar_ocorrencias de 3 parâmetros (0137) —, com as mesmas ACLs; as assinaturas novas
--      (alerta_destinatarios(text) e alerta_listar_ocorrencias de 4) saem;
--   h) saem rec_embs_fechadas, rec_emb_divergencias e a tabela alerta_emb_avisada;
--   i) CONFERE o resultado contra a cópia public.alerta_bkp_0149_0151_objetos (feita pelo
--      02-copiar-antes.sql): avisa, por objeto, se o que voltou não é igual ao que estava em
--      produção antes. Sem a cópia, só avisa e segue;
--   j) avisa o PostgREST (notify pgrst).
--
-- Idempotente: rodar de novo não acha linha para mover, recria as mesmas funções, e os drops são
-- "if exists". As tabelas de cópia NÃO são apagadas (ficam como registro; apagar à mão depois).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/fimemb-03.sql
-- Depois: cd ~/supabase/docker && docker compose restart rest
-- =============================================================

begin;

-- ---------- a) onde ficam as linhas tiradas do caminho ----------
create table if not exists public.alerta_bkp_0149_0151_linhas_removidas (
  id          bigserial primary key,
  tabela      text not null,
  motivo      text not null,
  linha       jsonb not null,
  removido_em timestamptz not null default now()
);

comment on table public.alerta_bkp_0149_0151_linhas_removidas is
  'Linhas que o 03-rollback-0149-0151.sql tirou do caminho (os checks de antes da 0149 as recusariam), guardadas inteiras em jsonb. Apagar depois.';

alter table public.alerta_bkp_0149_0151_linhas_removidas enable row level security;
revoke all on table public.alerta_bkp_0149_0151_linhas_removidas from public, anon, authenticated;
revoke all on sequence public.alerta_bkp_0149_0151_linhas_removidas_id_seq from public, anon, authenticated;

-- ---------- b) as linhas que os checks antigos recusariam ----------
do $func$
declare
  v_tem_modulo_envios boolean := exists (select 1 from information_schema.columns
                                          where table_schema = 'public' and table_name = 'alerta_envios'
                                            and column_name = 'modulo');
  v_tem_modulo_regras boolean := exists (select 1 from information_schema.columns
                                          where table_schema = 'public' and table_name = 'alerta_regras'
                                            and column_name = 'modulo');
  v_cond      text;
  v_envios    bigint := 0;
  v_avisadas  bigint := 0;
  v_regras    bigint := 0;
  v_email     bigint := 0;
  v_desligadas bigint := 0;
begin
  -- b1) fila: e-mail, tipo 'emb' e tudo o que é do Recebimento. SQL dinâmico porque na segunda
  -- rodada a coluna `modulo` já não existe (e citá-la daria erro mesmo atrás de um `false`).
  v_cond := 'e.canal not in (''telegram'', ''discord'')'
         || ' or e.tipo not in (''alerta'', ''lembrete'', ''resolvido'', ''normalizou'', ''teste'', ''resumo'')'
         || case when v_tem_modulo_envios then ' or e.modulo <> ''shopfloor''' else '' end;
  execute format(
    'with m as (delete from public.alerta_envios e where %s returning e.*) '
    'insert into public.alerta_bkp_0149_0151_linhas_removidas (tabela, motivo, linha) '
    'select ''alerta_envios'', ''canal email / tipo emb / modulo recebimento'', to_jsonb(m) from m', v_cond);
  get diagnostics v_envios = row_count;

  -- b2) as marcas de "já avisei" do Fim de EMB (a tabela some no passo h)
  if to_regclass('public.alerta_emb_avisada') is not null then
    execute 'insert into public.alerta_bkp_0149_0151_linhas_removidas (tabela, motivo, linha) '
            'select ''alerta_emb_avisada'', ''tabela apagada pelo rollback'', to_jsonb(a) from public.alerta_emb_avisada a';
    get diagnostics v_avisadas = row_count;
  end if;

  -- b3) regras do Recebimento (tipo 'emb'). Não têm ocorrência (o Fim de EMB não abre), então a FK
  -- `on delete restrict` de alerta_ocorrencias não as segura; se um dia tiver, o delete dá erro e
  -- a transação inteira volta — é para alguém olhar, não para apagar ocorrência em silêncio.
  v_cond := 'r.tipo not in (''aprovacao'', ''tempo'', ''defeito'', ''resumo'')'
         || case when v_tem_modulo_regras then ' or r.modulo <> ''shopfloor''' else '' end;
  execute format(
    'with m as (delete from public.alerta_regras r where %s returning r.*) '
    'insert into public.alerta_bkp_0149_0151_linhas_removidas (tabela, motivo, linha) '
    'select ''alerta_regras'', ''regra do Recebimento / tipo emb'', to_jsonb(m) from m', v_cond);
  get diagnostics v_regras = row_count;

  -- b4) regras do ShopFloor com 'email' nos canais: a linha inteira vai para a cópia ANTES do update.
  insert into public.alerta_bkp_0149_0151_linhas_removidas (tabela, motivo, linha)
  select 'alerta_regras', 'canal email retirado (linha como estava)', to_jsonb(r)
    from public.alerta_regras r
   where not (r.canais <@ array['telegram', 'discord']);
  get diagnostics v_email = row_count;

  update public.alerta_regras
     set canais = array_remove(canais, 'email')
   where not (canais <@ array['telegram', 'discord'])
     and cardinality(array_remove(canais, 'email')) > 0;

  update public.alerta_regras
     set canais = array['telegram'], ativa = false
   where not (canais <@ array['telegram', 'discord']);
  get diagnostics v_desligadas = row_count;

  raise notice 'b) envios apagados: % | marcas de EMB copiadas: % | regras do Recebimento apagadas: % | regras com e-mail tirado dos canais: % (destas, desativadas por ficarem sem canal: %)',
    v_envios, v_avisadas, v_regras, v_email, v_desligadas;
end
$func$;

-- ---------- c) as policies de alerta_regras de volta às da 0113 (texto copiado da 0113) ----------
drop policy if exists alerta_regras_select_admin on public.alerta_regras;
create policy alerta_regras_select_admin on public.alerta_regras
  for select using ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regras_insert_admin on public.alerta_regras;
create policy alerta_regras_insert_admin on public.alerta_regras
  for insert with check ((select tem_permissao('shopfloor', 'administrar')) and excluida_em is null);
drop policy if exists alerta_regras_update_admin on public.alerta_regras;
create policy alerta_regras_update_admin on public.alerta_regras
  for update using ((select tem_permissao('shopfloor', 'administrar')) and excluida_em is null)
  with check ((select tem_permissao('shopfloor', 'administrar')));

-- ---------- d) o trigger do módulo fixo ----------
drop trigger if exists alerta_regras_modulo_fixo on public.alerta_regras;
drop function if exists public.alerta_regras_modulo_fixo();

-- ---------- e) os CHECKs de antes ----------
-- alerta_regras: os dois da 0141, recriados (mesmo nome, definição de antes).
alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_tipo;
alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_valido;

alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo'));

-- campos_por_tipo da 0141 (texto copiado da 0141):
alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_campos_por_tipo check (coalesce(
  case tipo
    when 'aprovacao' then
          taxa_minima is not null and minimo_bipes is not null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'tempo' then
          janela_tipo in ('tempo', 'op')
      and limite_tempo_seg between 1 and 3600
      and minimo_bipes is not null
      and (pausa_max_min is null or pausa_max_min between 1 and 240)
      and (pausa_max_min is null or limite_tempo_seg < pausa_max_min * 60)
      and taxa_minima is null and limite_ocorrencias is null
    when 'defeito' then
          janela_tipo = 'tempo'
      and limite_ocorrencias >= 2
      and taxa_minima is null and minimo_bipes is null
      and limite_tempo_seg is null and pausa_max_min is null
    when 'resumo' then
          janela_tipo = 'intervalos'
      and janela_valor is null
      and taxa_minima is null and minimo_bipes is null and lembrete_min is null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
  end, false));

-- Os dois de nome automático da 0113 (postos e canais) e o da fila (canal): entram ANTES de os
-- novos caírem, com o nome que o Postgres deu a eles na 0113. "if not exists" à mão, porque
-- `add constraint` não tem essa opção.
do $func$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.alerta_regras'::regclass and conname = 'alerta_regras_postos_check') then
    alter table public.alerta_regras add constraint alerta_regras_postos_check
      check (cardinality(postos) > 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.alerta_regras'::regclass and conname = 'alerta_regras_canais_check') then
    alter table public.alerta_regras add constraint alerta_regras_canais_check
      check (cardinality(canais) > 0 and canais <@ array['telegram', 'discord']);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.alerta_envios'::regclass and conname = 'alerta_envios_canal_check') then
    alter table public.alerta_envios add constraint alerta_envios_canal_check
      check (canal in ('telegram', 'discord'));
  end if;
end
$func$;

alter table public.alerta_regras drop constraint if exists alerta_regras_postos_por_tipo;
alter table public.alerta_regras drop constraint if exists alerta_regras_canais_validos;

-- alerta_envios: o tipo_check da 0141 e a saída dos três novos.
alter table public.alerta_envios drop constraint if exists alerta_envios_tipo_check;
alter table public.alerta_envios
  add constraint alerta_envios_tipo_check
  check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo'));
alter table public.alerta_envios drop constraint if exists alerta_envios_canal_valido;
alter table public.alerta_envios drop constraint if exists alerta_envios_email_so_pessoa;
alter table public.alerta_envios drop constraint if exists alerta_envios_modulo_valido;

-- ---------- f) as colunas de módulo ----------
alter table public.alerta_regras drop column if exists modulo;
alter table public.alerta_envios drop column if exists modulo;

-- ---------- g) as 5 funções de antes (corpos copiados byte a byte das migrações) ----------
-- g1) alerta_destinatarios(): a de 0 parâmetros, da 0115. A de 1 parâmetro (0149/0151) sai antes:
-- com as duas no ar, a chamada curta seria ambígua.
drop function if exists public.alerta_destinatarios(text);
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
       and public.usuario_tem_permissao(u.id, 'shopfloor', 'administrar')
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios() from public, anon;
grant execute on function public.alerta_destinatarios() to authenticated, service_role;

-- g2) alerta_listar_ocorrencias de 3 parâmetros, da 0137; a de 4 (0149) sai depois.
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int,
  regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int,
  reaberta_em timestamptz, reaberturas int, explicacao text
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
           oc.reaberta_em, oc.reaberturas, oc.explicacao
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

drop function if exists public.alerta_listar_ocorrencias(timestamptz, timestamptz, text, text);

-- g3) alerta_avaliar, da 0141 (mesma assinatura: create or replace).
create or replace function public.alerta_avaliar(
  p_canal_discord text default null, p_blocos jsonb default null, p_resumos jsonb default null
)
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
  v_resumos_vazios int := 0;
  v_n            int;
  v_normalizadas uuid[];
  v_abaixo       boolean;
  v_tipo         text;
  v_lembrete     boolean;
  v_reabrir      boolean;
  v_nome         text;
  v_dados        jsonb;
  -- Só o resumo diário usa estas (ver o bloco no topo do laço).
  v_dia          date;
  v_faixas       jsonb;
  v_postos       text[];
  v_pmos_resumo  text[];
  v_linhas       jsonb;
  v_resumo_n     int;
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
               rg.taxa_minima::numeric as limite,
               '{}'::text[] as posicoes, po.ops,
               bl.bloco_inicio, bl.bloco_fim
          from public.alerta_regras rg
          -- O BLOCO DA REGRA, PRONTO, VINDO DO APP. p_blocos é
          -- {"<regra_id>": {"inicio": "<iso>", "fim": "<iso>"}} e traz SÓ as regras de janela
          -- 'intervalos' que têm bloco FECHADO agora (src/modules/alertas/infra/repositorio-servico.ts).
          -- A chave é o uuid da regra em texto — a forma canônica, a mesma que o PostgREST entrega
          -- ao app. Nenhuma conta de horário aqui, nem em lugar nenhum deste arquivo: ela mora em
          -- domain/intervalos.ts, onde tem teste nos quatro fusos. É o mesmo padrão do
          -- p_canal_discord (o id do canal mora no SERVIDOR, não no banco).
          -- Nas outras três janelas p_blocos não tem a chave, e os dois instantes saem nulos.
          -- O cast é o ÚNICO juiz do formato: o app manda ISO 8601 (toISOString), e um valor
          -- estranho ali derruba a rodada inteira com 22007, barulhento, em vez de medir uma faixa
          -- inventada. Para o alerta, falhar alto é melhor que um número errado (a rodada seguinte,
          -- 5 min depois, tenta de novo).
          cross join lateral (
            select (p_blocos -> rg.id::text ->> 'inicio')::timestamptz as bloco_inicio,
                   (p_blocos -> rg.id::text ->> 'fim')::timestamptz    as bloco_fim
          ) bl
          cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                 public.alerta_pmos_normalizar(rg.pmos),
                                                 p_bloco_inicio => bl.bloco_inicio,
                                                 p_bloco_fim    => bl.bloco_fim) tx
          -- Mesma janela do alerta_taxas acima: só os bipes com status (é uma taxa).
          cross join lateral public.alerta_ops(array[tx.posto], rg.janela_tipo, rg.janela_valor,
                                               public.alerta_pmos_normalizar(rg.pmos),
                                               p_so_com_status => true) po
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'aprovacao'
           -- REGRA DE JANELA 'intervalos' SEM BLOCO NO MAPA É PULADA NESTA RODADA: nenhum bloco
           -- fechou (fora do turno, antes do primeiro bloco do dia) ou o app não a viu. Pulada =
           -- não decide NADA: não abre, não insiste, não normaliza e não encosta no
           -- bloco_reportado. É o que faz o cron de 5 em 5 minutos poder rodar o dia inteiro sem
           -- reavaliar bloco que não existe. As outras três janelas nunca entram nesta condição.
           -- Os DOIS instantes são exigidos: entrada pela metade (defeito de quem monta o mapa)
           -- pula a regra em vez de medir uma faixa aberta.
           and (rg.janela_tipo <> 'intervalos'
                or (bl.bloco_inicio is not null and bl.bloco_fim is not null))
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
               rg.limite_tempo_seg::numeric,
               '{}'::text[], po.ops,
               -- Janela por blocos é só da taxa de aprovação (check da 0139): aqui nunca há bloco.
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
          cross join lateral public.alerta_tempos(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                  rg.pausa_max_min,
                                                  public.alerta_pmos_normalizar(rg.pmos)) tp
          -- Mesma janela do alerta_tempos acima: TODOS os bipes do posto, de qualquer status. Com
          -- `true` aqui, um posto de passagem (status '', o default da 0028) alertaria por lentidão
          -- com a lista de OPs vazia — a mensagem sem a ordem é justamente o que a 0136 conserta.
          cross join lateral public.alerta_ops(array[tp.posto], rg.janela_tipo, rg.janela_valor,
                                               public.alerta_pmos_normalizar(rg.pmos),
                                               p_so_com_status => false) po
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
               rg.limite_ocorrencias::numeric,
               df.posicoes, df.ops,
               -- Idem: o tipo 'defeito' não tem janela por blocos.
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select x.posto, x.defeito, x.ocorrencias, x.posicoes, x.ops
                from public.alerta_defeitos(rg.postos, rg.janela_valor,
                                              public.alerta_pmos_normalizar(rg.pmos)) x
            )
            select d.posto, d.defeito, d.ocorrencias, d.posicoes, d.ops from d
            union all
            select oc.posto, oc.defeito, 0, '{}'::text[], coalesce(oc.ops, '[]'::jsonb)
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.defeito = oc.defeito)
          ) df
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'defeito'
        union all
        -- Resumo diário (0141): UMA linha por regra, nunca uma por posto — quem abre os postos é o
        -- bloco do topo do laço. Só entra quem o app pôs em p_resumos (a hora chegou e ainda não
        -- mandou hoje). Regra de resumo ausente do mapa é PULADA: nem chega ao laço.
        -- ⚠️ `avaliavel = false`, `valor`/`limite` nulos: é cinto E suspensório. O bloco do topo do
        -- laço dá `continue` antes de qualquer outra coisa; se alguém um dia tirar aquele bloco, a
        -- primeira guarda do caminho da ocorrência (`if not coalesce(t.avaliavel, false)`) ainda
        -- pula a linha, e o resumo não vira ocorrência fantasma.
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               null::text, null::text, null::text, null::text,
               0, 0,
               0,
               false,
               null::numeric,
               null::numeric,
               '{}'::text[], '[]'::jsonb,
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'resumo'
           and (p_resumos -> rg.id::text ->> 'dia') is not null
           -- ⚠️ A GUARDA CONTRA REENVIO (I-1): quem já mandou NESTE dia não entra de novo. O dia é o
           -- que o app mandou no mapa (o mesmo que o laço grava), então guarda e gravação não têm
           -- como divergir. `is distinct from` cobre a data ainda nula (nunca enviou).
           and rg.resumo_enviado_em is distinct from (p_resumos -> rg.id::text ->> 'dia')::date
      ) m
     order by m.criado_em, m.regra_id, m.posto, m.defeito nulls first
  loop
    -- ⚠️ O RESUMO DIÁRIO (0141) SAI POR AQUI E POR MAIS LUGAR NENHUM. Este bloco tem `continue` no
    -- fim: o caminho da ocorrência (mínimo de bipes, v_abaixo, select ... for update, abrir /
    -- normalizar / insistir / reabrir) NÃO ganhou condição nenhuma e nunca vê uma regra de resumo.
    -- É de propósito. A alternativa seria um `t.tipo <> 'resumo'` em cada um desses seis passos,
    -- numa função de ~400 linhas SEM teste de unidade, e esquecer UM deles não dá erro: dá
    -- ocorrência fantasma de relatório, botão "Resolvido" num relatório ou o relatório reenviado a
    -- cada 5 minutos. Uma saída única, no topo, só pode falhar de um jeito, e esse jeito aparece.
    -- Também não conta em `avaliadas` (que continua sendo "itens de posto avaliados"): num dia só de resumo o retorno
    -- traz `avaliadas: 0` com `enfileirados > 0`, e isso NÃO é contradição.
    if t.tipo = 'resumo' then
      -- O DIA E AS FAIXAS VÊM PRONTOS DO APP (p_resumos), e o banco NÃO faz conta de fuso nenhuma:
      -- o dia de São Paulo e a conversão de 'HH:MM' em instante moram em domain/resumo.ts, com
      -- teste em quatro fusos. Daqui sai a mesma data para a guarda do cursor, a faixa medida e a
      -- data gravada. Faixas ausentes ou que não são lista valem lista vazia: nenhum bipe entra,
      -- nada é enviado e a data não é gravada.
      v_dia := (p_resumos -> t.regra_id::text ->> 'dia')::date;
      v_faixas := case when jsonb_typeof(p_resumos -> t.regra_id::text -> 'faixas') = 'array'
                       then p_resumos -> t.regra_id::text -> 'faixas'
                       else '[]'::jsonb end;

      select rg.postos, public.alerta_pmos_normalizar(rg.pmos)
        into v_postos, v_pmos_resumo
        from public.alerta_regras rg
       where rg.id = t.regra_id;

      -- Uma linha por posto COM dado: posto sem nenhum bipe com status no dia fica FORA (não vira
      -- "—" nem 0%). "O dia" = só o que cai dentro das faixas que o app mandou, que são os
      -- intervalos cadastrados na regra (hora extra e almoço não entram). Fronteira `>=` no início e `<` no fim, como no alerta_taxas: o bipe
      -- da hora exata do fim pertence ao intervalo seguinte, não a este. `exists` (e não join)
      -- para um bipe num intervalo sobreposto não contar duas vezes. Filtro de PMO igual ao dos
      -- outros tipos. Ordem: a dos postos na regra.
      select coalesce(jsonb_agg(jsonb_build_object('posto', x.posto,
                                                   'aprovados', x.aprovados,
                                                   'reprovados', x.reprovados)
                                order by x.ordem), '[]'::jsonb)
        into v_linhas
        from (
          select p.posto, min(p.ordem) as ordem,
                 count(*) filter (where lower(r.status) = 'aprovado')::int  as aprovados,
                 count(*) filter (where lower(r.status) = 'reprovado')::int as reprovados
            from unnest(v_postos) with ordinality as p(posto, ordem)
            join public.sf_registros r on r.posto = p.posto
           where lower(r.status) in ('aprovado', 'reprovado')
             and (coalesce(cardinality(v_pmos_resumo), 0) = 0 or btrim(r.pmo) = any (v_pmos_resumo))
             and exists (
                   select 1
                     from jsonb_array_elements(v_faixas) f
                    where r.data_hora >= (f ->> 'inicio')::timestamptz
                      and r.data_hora <  (f ->> 'fim')::timestamptz)
           group by p.posto
        ) x;

      -- Nenhum posto com dado (fim de semana, feriado, linha parada): NÃO envia e NÃO grava a data.
      -- Gravar sem enviar faria o relatório sumir o dia inteiro em silêncio; sem gravar, a próxima
      -- rodada reavalia (barato) e amanhã tenta de novo. Relatório vazio não é informação.
      if jsonb_array_length(v_linhas) > 0 then
        v_dados := jsonb_build_object(
                     'regra_tipo', t.tipo,
                     'regra_nome', t.nome,
                     'dia',        v_dia,
                     'linhas',     v_linhas,
                     'agora',      v_agora);
        v_resumo_n := 0;

        -- Mesmas duas filas do caminho da ocorrência, SEM ocorrência (ocorrencia_id nulo, que a
        -- coluna permite desde a 0113), sem botão e com o tipo de envio 'resumo'.
        if t.avisar_pessoas then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo)
          select null, c.usuario_id, c.canal, 'resumo', v_dados, false, 'usuario'
            from public.alerta_contas c
            join public.usuarios u on u.id = c.usuario_id and u.ativo
           where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
             and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
           order by c.usuario_id, c.canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        if t.avisar_canal and v_canal is not null then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo, destino_externo_id)
          select null, null, 'discord', 'resumo', v_dados, false, 'canal', v_canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        v_enfileirados := v_enfileirados + v_resumo_n;

        -- A DATA SÓ É GRAVADA AQUI, DEPOIS DE ENFILEIRAR, e só se algo foi para a fila. Há dado mas
        -- ninguém alcançável (responsável sem conta vinculada, sem canal configurado) = nada
        -- enfileirado = data NÃO gravada: quando alguém vincular a conta ainda hoje, o relatório
        -- sai; o custo de esperar é uma consulta a cada 5 min, e não há envio duplicado.
        if v_resumo_n > 0 then
          update public.alerta_regras
             set resumo_enviado_em = v_dia
           where id = t.regra_id;
        end if;
      else
        -- O resumo era DEVIDO e saiu vazio. Sem este rastro, intervalos que não casam com o turno
        -- real (ou um filtro de PMOs que não bate) deixariam o relatório sem sair todo dia, sem log
        -- e sem contador: `avaliadas: 0, enfileirados: 0` é igual a "nenhum resumo era devido".
        v_resumos_vazios := v_resumos_vazios + 1;
        raise log 'alerta_avaliar: resumo da regra % (%) devido em % e sem nenhum posto com dado', t.regra_id, t.nome, v_dia;
      end if;

      continue;
    end if;

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
          (regra_id, posto, defeito, pmo, op, ops, taxa_abertura, taxa_ultima, valor_abertura,
           valor_ultimo, amostras, aprovados, reprovados, aberta_em, ultimo_envio_em,
           bloco_reportado)
        values (t.regra_id, t.posto, t.defeito,
                case when t.janela_tipo = 'op' then btrim(t.pmo) end,
                case when t.janela_tipo = 'op' then t.op end,
                coalesce(t.ops, '[]'::jsonb),
                case when t.tipo = 'aprovacao' then t.valor end,
                case when t.tipo = 'aprovacao' then t.valor end,
                t.valor, t.valor, t.amostras, t.aprovados, t.reprovados, v_agora, v_agora,
                -- CAMINHO QUE ENVIA (1/4: abertura) → grava o bloco avisado. Nas outras janelas
                -- fica nulo, e nada o lê (quem lê é só o ramo 'intervalos' do lembrete).
                case when t.janela_tipo = 'intervalos' then t.bloco_inicio end)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif not v_abaixo then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             ops = coalesce(nullif(t.ops, '[]'::jsonb), ops),
             -- CAMINHO QUE ENVIA (2/4: normalização) → grava o bloco avisado. A ocorrência está
             -- sendo encerrada e ninguém mais vai ler este valor nela (a busca exige estado
             -- 'aberta'/'resolvida'); fica para a história ficar honesta e para o caminho que
             -- envia ser sempre o caminho que grava.
             bloco_reportado = case when t.janela_tipo = 'intervalos'
                                    then t.bloco_inicio else bloco_reportado end,
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
      if t.janela_tipo = 'intervalos' then
        -- UM AVISO POR BLOCO, e é o BLOCO que manda — não o `lembrete_min` (que a validação da
        -- regra força a nulo nesta janela, justamente para não existir dois donos da insistência).
        -- O cron roda de 5 em 5 min e vai reavaliar o MESMO bloco fechado várias vezes: da segunda
        -- em diante o bloco não é mais novo que o já avisado e nada sai. Quando o bloco seguinte
        -- fecha, ele é mais novo e a insistência sai, pregada no fechamento do bloco.
        -- `bloco_reportado is null` = ocorrência aberta antes desta migração, ou aberta por uma
        -- rodada em que a regra ainda era de outra janela: o primeiro bloco avaliado avisa.
        v_lembrete := o.estado = 'aberta'
                      and (o.bloco_reportado is null or t.bloco_inicio > o.bloco_reportado);
      else
        v_lembrete := o.estado = 'aberta' and t.lembrete_min is not null
                      and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min);
      end if;

      update public.alerta_ocorrencias
         set ops = coalesce(nullif(t.ops, '[]'::jsonb), ops),
             taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados,
             -- Volta a 'aberta' (o botão "Resolvido" passa a valer de novo). resolvida_por e
             -- resolvida_em ficam como estão: o texto da reabertura usa, e a auditoria precisa.
             estado      = case when v_reabrir then 'aberta' else estado end,
             reaberta_em = case when v_reabrir then v_agora else reaberta_em end,
             reaberturas = reaberturas + case when v_reabrir then 1 else 0 end,
             -- Reabrir renova o ciclo de lembrete: o próximo conta a partir de agora.
             ultimo_envio_em = case when v_reabrir or v_lembrete then v_agora else o.ultimo_envio_em end,
             -- CAMINHOS QUE ENVIAM (3/4: insistência · 4/4: reabertura) → gravam o bloco avisado.
             -- A condição é `v_reabrir or v_lembrete`, que é EXATAMENTE quando este ramo enfileira
             -- (logo abaixo, o v_tipo só sai de nulo nesses dois casos). Bloco pulado por falta de
             -- bipes não chega aqui (o `continue` do mínimo vem antes) e bloco reavaliado cai no
             -- `else`, que mantém o valor: é isso que deixa o bloco SEGUINTE ainda avisar. Gravar
             -- fora desses dois casos faria o alerta do bloco seguinte desaparecer em silêncio.
             bloco_reportado = case when t.janela_tipo = 'intervalos' and (v_reabrir or v_lembrete)
                                    then t.bloco_inicio else bloco_reportado end
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
                   -- A faixa do bloco medido, para o texto dizer "das 10:00 às 11:00" em vez de
                   -- "no bloco do turno" (domain/janela.ts, textoJanela). Vão junto com as outras
                   -- chaves da janela e, como 'pmo'/'op' fora da janela 'op', entram NULAS nas
                   -- outras janelas — quem lê o `dados` trata chave nula, e congelar a faixa na
                   -- linha da fila é o que faz o reenvio sair idêntico ao primeiro envio.
                   'bloco_inicio', t.bloco_inicio,
                   'bloco_fim',    t.bloco_fim,
                   'pmo',          btrim(t.pmo),
                   'op',           t.op,
                   'ops',          coalesce(o.ops, '[]'::jsonb),
                   'aberta_em',    o.aberta_em,
                   'agora',        v_agora)
                 || case t.tipo
                      when 'aprovacao' then jsonb_build_object(
                        'taxa', t.valor, 'taxa_minima', t.limite,
                        'aprovados', t.aprovados, 'reprovados', t.reprovados)
                      when 'tempo' then jsonb_build_object(
                        'media_seg', t.valor, 'limite_tempo_seg', t.limite, 'pecas', t.amostras)
                      else jsonb_build_object(
                        'defeito', t.defeito, 'ocorrencias', t.amostras, 'limite_ocorrencias', t.limite,
                        'posicoes', coalesce(t.posicoes, '{}'::text[]))
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
      -- responsável (N mensagens iguais no mesmo canal). Não olha `canais`: aquilo é a conversa
      -- privada; o canal é sempre o do Discord (DISCORD_CANAL_ID).
      if t.avisar_canal and v_canal is not null then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo, destino_externo_id)
        select o.id, null, 'discord', v_tipo, v_dados, v_tipo in ('alerta', 'lembrete'), 'canal', v_canal;
        get diagnostics v_n = row_count;
        v_enfileirados := v_enfileirados + v_n;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas,
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas),
                            'resumos_vazios', v_resumos_vazios);
end
$func$;

revoke all on function public.alerta_avaliar(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb, jsonb) to service_role;

-- g4) alerta_resolver_interno, da 0137.
create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean,
  p_explicacao text default ''
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
  v_expl text;
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

  -- Aparar as pontas e tratar nulo como vazio: quem digita só espaços não escreveu nada, e um
  -- `dados.explicacao` de espaços viraria "resolvido por Ana:" com nada depois na mensagem.
  v_expl := btrim(coalesce(p_explicacao, ''));

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now(),
           explicacao = v_expl
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  -- FILA: "✅ resolvido por X" para os OUTROS responsáveis ativos que administram o ShopFloor, na
  -- mesma transação da resolução. Só na primeira resolução — apertar o botão de novo não avisa.
  -- `defeito` (nulo nos outros tipos) vai junto: numa regra de defeito com 2 códigos abertos no
  -- mesmo posto, sem ele o texto não diria QUAL dos dois foi resolvido.
  -- A explicação entra por `||` CONDICIONAL, e não como chave fixa: sem texto, a chave não existe, e
  -- o TS não precisa distinguir "não disse" de "disse nada" para não imprimir o rabo do "por X:".
  -- `o.explicacao` (e não v_expl) é o valor que REALMENTE ficou gravado na ocorrência.
  if not v_ja and r.avisar_pessoas then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo)
    select o.id, c.usuario_id, c.canal, 'resolvido',
           jsonb_build_object('posto', o.posto, 'defeito', o.defeito, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em,
                              'pmo', o.pmo, 'op', o.op, 'ops', coalesce(o.ops, '[]'::jsonb))
           || case when coalesce(o.explicacao, '') <> ''
                   then jsonb_build_object('explicacao', o.explicacao)
                   else '{}'::jsonb
              end,
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

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

-- g5) alerta_reservar_envios, da 0123.
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

-- ---------- h) o que só a 0150 criou ----------
drop function if exists public.rec_embs_fechadas(timestamptz);
drop function if exists public.rec_emb_divergencias(text);
drop table if exists public.alerta_emb_avisada;

-- ---------- i) conferência contra a cópia do 02 ----------
do $func$
declare
  v_iguais     int := 0;
  v_diferentes int := 0;
  v_faltando   int := 0;
  b            record;
  v_md5        text;
  v_acl        text;
  v_atual      text;
  v_extras     int := 0;
begin
  if to_regclass('public.alerta_bkp_0149_0151_objetos') is null then
    raise notice 'i) SEM a cópia alerta_bkp_0149_0151_objetos (o 02 não rodou): nada a conferir.';
    return;
  end if;

  for b in select * from public.alerta_bkp_0149_0151_objetos order by tipo, nome loop
    if b.tipo = 'funcao' then
      select md5(p.prosrc), p.proacl::text into v_md5, v_acl
        from pg_proc p where p.oid = to_regprocedure(b.nome);
      if v_md5 is null then
        v_faltando := v_faltando + 1;
        raise warning 'i) função % NÃO existe depois do rollback', b.nome;
      elsif v_md5 = b.md5_corpo and v_acl is not distinct from b.acl then
        v_iguais := v_iguais + 1;
      else
        v_diferentes := v_diferentes + 1;
        raise warning 'i) função % DIFERENTE da cópia (corpo igual: %, acl igual: %)',
          b.nome, v_md5 = b.md5_corpo, v_acl is not distinct from b.acl;
      end if;
    elsif b.tipo = 'policy' then
      select format('cmd=%s roles=%s using=%s check=%s', p.cmd, array_to_string(p.roles, ','),
                    coalesce(p.qual, ''), coalesce(p.with_check, ''))
        into v_atual
        from pg_policies p
       where p.schemaname = 'public' and p.tablename || '.' || p.policyname = b.nome;
      if v_atual is null then
        v_faltando := v_faltando + 1;
        raise warning 'i) policy % NÃO existe depois do rollback', b.nome;
      elsif v_atual = b.definicao then
        v_iguais := v_iguais + 1;
      else
        v_diferentes := v_diferentes + 1;
        raise warning 'i) policy % DIFERENTE da cópia', b.nome;
      end if;
    else
      select pg_get_constraintdef(c.oid) into v_atual
        from pg_constraint c
       where c.contype = 'c' and c.conrelid::regclass::text || '.' || c.conname = b.nome;
      if v_atual is null then
        v_faltando := v_faltando + 1;
        raise warning 'i) check % NÃO existe depois do rollback', b.nome;
      elsif v_atual = b.definicao then
        v_iguais := v_iguais + 1;
      else
        v_diferentes := v_diferentes + 1;
        raise warning 'i) check % DIFERENTE da cópia', b.nome;
      end if;
    end if;
    v_md5 := null; v_acl := null; v_atual := null;
  end loop;

  -- o caminho inverso: check que existe agora e não existia na cópia
  select count(*) into v_extras
    from pg_constraint c
   where c.contype = 'c'
     and c.conrelid in ('public.alerta_regras'::regclass, 'public.alerta_envios'::regclass)
     and not exists (select 1 from public.alerta_bkp_0149_0151_objetos o
                      where o.tipo = 'check' and o.nome = c.conrelid::regclass::text || '.' || c.conname);

  raise notice 'i) conferência com a cópia do 02: % iguais, % diferentes, % faltando, % checks a mais (o normal: tudo igual, 0, 0 e 0)',
    v_iguais, v_diferentes, v_faltando, v_extras;
end
$func$;

-- ---------- j) o PostgREST ----------
notify pgrst, 'reload schema';

commit;
