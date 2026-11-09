-- =============================================================
-- ALERTAS — "PARADO OU TRAVADO NA PRODUÇÃO" (reescreve o tipo de regra 'parado' da 0167)
--
-- O tipo 'parado' avisava só de caixa/lote/peça pronta esperando entrada no Almoxarifado. Passa a avisar
-- quando PEÇAS ficam paradas em QUALQUER posto da rota por mais de X horas, sem terminar. O identificador
-- do tipo continua 'parado' (nenhuma linha migra; o rótulo novo está no app).
--
-- Aplica POR CIMA da 0167 (parado), da 0169 e da 0170 (compels). Idempotente.
--
--   A. alerta_regras: duas opções do tipo — so_ops_ativas (só OPs não finalizadas, padrão true) e
--      incluir_manutencao (conta a peça reprovada que aguarda conserto, padrão true) — e o limite_horas
--      sobe de 1..72 para 1..720 (30 dias).
--   B. REGRAS 'parado' QUE JÁ EXISTEM (feitas para o Almoxarifado): ficam como estão, com as duas opções
--      no padrão, mas são DESATIVADAS uma única vez (a guarda é a coluna nova ainda não existir; rodar a
--      migração de novo não desativa regra nenhuma). Motivo: o postos delas são postos de Almoxarifado, onde
--      a peça já terminou; ligadas, ficariam mudas e a pessoa acharia que está coberta. A ocorrência viva
--      delas é encerrada sem envio pelo primeiro bloco do alerta_avaliar (regra inativa). Em Prod não há
--      nenhuma regra 'parado'.
--   C. alerta_travados(postos, pmos, corte, so_ativas, incluir_manutencao): as peças paradas, uma linha por
--      OP x posto (x reprovada). Só leitura, só service_role (o cron roda sem usuário).
--   D. alerta_avaliar (MESMA assinatura de 4 parâmetros; create or replace, sem drop): partiu do corpo da 0170
--      e mudou SÓ o bloco do parado — a mensagem passa a saber se a conta foi em expediente (dados.expediente).
--      Todo o resto é idêntico à 0170 (conferido por diff).
--
--   "PEÇA PARADA" = o SN (por OP) cujo ÚLTIMO registro (data_hora, desempate created_at) está num dos postos
--   da regra, tem data_hora <= corte (o app calcula o corte: agora menos o limite, em expediente ou relógio
--   corrido) e NÃO terminou. "Terminou" é a conta da finalização automática (0121/0145/0162): o último registro
--   do SN no ÚLTIMO posto da rota da OP (sf_ordem_postos, maior `ordem`) não é 'Reprovado'. "OP ativa" é a da
--   finalização/Dashboard: sf_ordens.status diferente de 'FINALIZADA' (sem maiúsculas e sem espaços).
--   Peça reprovada aguardando conserto (último registro 'Reprovado', ou o último registro é no posto
--   Manutenção) só conta quando incluir_manutencao é true; vem numa linha própria (reprovada = true).
--   Só entram OPs que existem em sf_ordens.
--
--   OCORRÊNCIA: uma por OP (chave PMO/OP em `defeito`, posto = o 1º posto da regra, fixo), como a 0167; lembra a
--   cada `lembrete_min`; normaliza sozinha quando a OP não tem mais peça parada.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0172_alerta_parado_travado.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app. O app novo lê as colunas so_ops_ativas/incluir_manutencao
--    na lista de regras e chama alerta_travados: app antes da migração derruba a listagem de regras de TODOS
--    os tipos e o cron devolve 503. O app ANTIGO, com o banco novo, segue funcionando (a regra 'parado' dele
--    chama sf_almox_pendencias_base, que esta migração não remove).
-- ⚠️ NÃO apaga sf_almox_pendencias/necessidades/lotes nem as _base: a tela do Almoxarifado as usa.
-- ⚠️ Sem índice novo: o plano usa sf_registros_ordem_sn (pmo, op, numero_serie_norm), medido em volume de
--    produção (docs/operacao/alerta-parado-travado/01-medir.sql). create index concurrently não cabe em -1.
-- Convenções: corpo de função com $func$ (o SQL Editor recusa o de dois cifrões); grants e revokes
-- explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- B. regras 'parado' antigas: desativa UMA vez (antes da coluna nova existir) ----------
do $func$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'alerta_regras'
                    and column_name = 'so_ops_ativas') then
    update public.alerta_regras set ativa = false where tipo = 'parado' and ativa;
  end if;
end
$func$;

-- ---------- A. colunas e limite ----------
alter table public.alerta_regras add column if not exists so_ops_ativas boolean not null default true;
alter table public.alerta_regras add column if not exists incluir_manutencao boolean not null default true;

comment on column public.alerta_regras.so_ops_ativas is
  'Só parado: true = olha só as OPs não finalizadas; false = também as finalizadas. Nos outros tipos é ignorada.';
comment on column public.alerta_regras.incluir_manutencao is
  'Só parado: true = conta também a peça reprovada que aguarda conserto/Manutenção. Nos outros tipos é ignorada.';

alter table public.alerta_regras drop constraint if exists alerta_regras_limite_horas_so_parado;
alter table public.alerta_regras add constraint alerta_regras_limite_horas_so_parado
  -- `coalesce(..., false)`: sem ele, limite_horas NULO numa regra 'parado' daria NULL no `between`, e
  -- check com resultado NULL PASSA. A regra nunca abriria (o limite nulo nunca é atingido).
  check (coalesce((tipo = 'parado' and limite_horas between 1 and 720)
                  or (tipo <> 'parado' and limite_horas is null), false));

-- ---------- C. as peças paradas ----------
create or replace function public.alerta_travados(
  p_postos text[], p_pmos text[], p_corte timestamptz,
  p_so_ativas boolean default true, p_incluir_manutencao boolean default true
)
returns table (pmo text, op text, posto text, reprovada boolean, pecas bigint, em timestamptz, amostras text[])
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  with ordens as materialized (
    -- As OPs que a regra olha. Em sf_ordens (poucas centenas de linhas), antes de tocar em sf_registros.
    select o.id, o.pmo, o.op,
           (select p.posto from public.sf_ordem_postos p where p.ordem_id = o.id order by p.ordem desc limit 1)
             as ultimo_posto
      from public.sf_ordens o
     where (not coalesce(p_so_ativas, true) or upper(btrim(o.status)) <> 'FINALIZADA')
       and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(o.pmo) = any (p_pmos))
  ),
  ult as (
    -- O último registro de cada SN na OP (um SN por OP; `pecas` é o peso do bipe, 0161/0162). Um LATERAL por OP:
    -- cada ordenação é de uma OP só (~milhares de linhas, em memória) e sai do índice sf_registros_ordem_sn;
    -- um distinct on global ordenaria todos os registros das OPs de uma vez (disco), 2x mais lento medido.
    select o.ultimo_posto, u.*
      from ordens o
     cross join lateral (
       select distinct on (r.numero_serie_norm)
              r.pmo, r.op, r.numero_serie_norm, r.numero_serie, r.posto, r.status, r.data_hora, r.pecas
         from public.sf_registros r
        where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm <> ''
        order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
     ) u
  ),
  cand as (
    select u.*, (lower(u.status) = 'reprovado') as reprovada
      from ult u
     where u.posto = any (coalesce(p_postos, '{}'::text[]))
       and u.data_hora <= p_corte
       -- Atalho barato do "terminou" (é a maioria das peças): o último registro já é no último posto da rota
       -- e não é reprovação (OP sem rota: `ultimo_posto` nulo, o atalho não vale). Só o resto paga a consulta de baixo.
       and not coalesce(u.posto = u.ultimo_posto and lower(u.status) <> 'reprovado', false)
       and (coalesce(p_incluir_manutencao, true)
            or (lower(u.status) <> 'reprovado' and lower(u.posto) <> 'manutenção'))
  )
  select btrim(c.pmo), c.op, c.posto, c.reprovada,
         sum(c.pecas)::bigint, min(c.data_hora),
         (array_agg(c.numero_serie order by c.data_hora, c.numero_serie_norm))[1:3]
    from cand c
   where not coalesce((
     -- Terminou (a conta da finalização automática): o último registro do SN no último posto da rota não é
     -- reprovação. Só para as candidatas, que são poucas. Sem registro no último posto: não terminou.
     select lower(r2.status) <> 'reprovado'
       from public.sf_registros r2
      where r2.pmo = c.pmo and r2.op = c.op and r2.numero_serie_norm = c.numero_serie_norm
        and r2.posto = c.ultimo_posto
      order by r2.data_hora desc, r2.created_at desc
      limit 1
   ), false)
   group by btrim(c.pmo), c.op, c.posto, c.reprovada
$func$;

revoke all on function public.alerta_travados(text[], text[], timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.alerta_travados(text[], text[], timestamptz, boolean, boolean) to service_role;

-- ---------- D. alerta_avaliar: só o bloco do parado muda (dados.expediente) ----------
create or replace function public.alerta_avaliar(
  p_canal_discord text default null, p_blocos jsonb default null, p_resumos jsonb default null,
  p_parados jsonb default null
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
  -- TETO DE IDADE do aviso de fim de EMB (uma linha para mudar). Só o piso `criado_em` não bastava:
  -- regra desativada por semanas e reativada, ou sem ninguém alcançável por dias, avisaria de uma
  -- vez TODA EMB fechada desde a criação (50 por rodada, a cada 5 min) — mensagem "atrasada" em
  -- massa. EMB fechada há mais que isto não avisa e NÃO é marcada. Vale o mais tardio dos dois.
  v_teto_idade   interval := interval '3 days';
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
  -- Só o fim de EMB usa estas (ver o bloco no topo do laço).
  v_emb          record;
  v_divs         jsonb;
  v_emb_n        int;
  -- Só o parado ou travado usa estas (itens da OP e se a conta foi em expediente, vindos do app em p_parados).
  v_itens        jsonb;
  v_expediente   boolean;
  -- Só o Compels (0170) usa estas: os avisos de gravação novos da rodada e os ids para marcar.
  v_avisos       jsonb;
  v_ids          uuid[];
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
               rg.modulo,
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
               rg.modulo,
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
               rg.modulo,
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
               rg.modulo,
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
        union all
        -- Fim de EMB (0150): UMA linha por regra, nunca uma por EMB — quem abre as EMBs é o bloco
        -- do topo do laço (como no resumo diário). Toda regra de fim de EMB ATIVA entra: não há
        -- mapa vindo do app aqui, porque não há conta de fuso nenhuma nesta feature (o gatilho é
        -- "todos os processos terminais", não um horário).
        -- A ORDEM DAS COLUNAS é a do ramo da aprovação, e o `union all` é POSICIONAL: 26 colunas,
        -- com `rg.modulo` na 12ª (depois de rg.criado_em), que é onde a 0149 a pôs.
        -- ⚠️ `avaliavel = false`, `valor`/`limite` nulos: cinto E suspensório, igual ao resumo.
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               rg.modulo,
               null::text, null::text, null::text, null::text,
               0, 0,
               0,
               false,
               null::numeric,
               null::numeric,
               '{}'::text[], '[]'::jsonb,
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'emb'
        union all
        -- Parado no Almoxarifado (0167): UMA linha por OP com item acima do limite, e uma linha de valor 0
        -- por ocorrência viva que deixou de ter item parado (é ela que normaliza). A CONTA DE HORÁRIO
        -- VEM DO APP em p_parados ({"<regra_id>": [{pmo, op, posto, mais_antiga_min, itens}]}); o banco
        -- só decide abrir, atualizar e normalizar. REGRA AUSENTE DO MAPA É PULADA: se o app não conseguiu
        -- ler as pendências, nada é decidido (normalizar por engano seria pior que atrasar). Valor que
        -- não é lista também pula. Sem o operador `?` de propósito: o SQL Editor e clientes com
        -- placeholder posicional o confundem com parâmetro.
        -- A chave da ocorrência é PMO/OP na coluna `defeito` (índice único alerta_ocorrencias_viva_defeito).
        -- A ORDEM DAS COLUNAS é a do ramo da aprovação (união posicional, 26 colunas).
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               rg.modulo,
               pd.posto, pd.chave, pd.pmo, pd.op,
               0, 0,
               pd.amostras,
               true,
               pd.valor,
               (rg.limite_horas * 60)::numeric,
               '{}'::text[], jsonb_build_array(jsonb_build_object('pmo', pd.pmo, 'op', pd.op)),
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select e ->> 'posto' as posto, (e ->> 'pmo') || '/' || (e ->> 'op') as chave,
                     e ->> 'pmo' as pmo, e ->> 'op' as op,
                     coalesce(jsonb_array_length(e -> 'itens'), 0) as amostras,
                     (e ->> 'mais_antiga_min')::numeric as valor
                from jsonb_array_elements(
                       case when jsonb_typeof(p_parados -> rg.id::text) = 'array'
                            then p_parados -> rg.id::text else '[]'::jsonb end) e
               where e ->> 'posto' = any (rg.postos)
            )
            select d.posto, d.chave, d.pmo, d.op, d.amostras, d.valor from d
            union all
            select oc.posto, oc.defeito, oc.pmo, oc.op, 0, 0::numeric
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.chave = oc.defeito)
          ) pd
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'parado'
           and jsonb_typeof(p_parados -> rg.id::text) = 'array'
        union all
        -- Problemas no envio ao Compels (0170), OCORRÊNCIA: UMA linha por OP com linha da fila em erro/espera
        -- (alerta_compels_problemas), e uma linha de valor 0 por ocorrência viva que deixou de ter problema (é
        -- ela que normaliza). Diferente do parado, o banco LÊ a fila sozinho: não há mapa vindo do app, e por
        -- isso não existe "regra ausente do mapa". A chave da ocorrência é PMO/OP na coluna `defeito` (índice
        -- único alerta_ocorrencias_viva_defeito). valor = quantas linhas da fila estão com problema; limite = 1
        -- (`valor >= limite`): AVISA NA PRIMEIRA FALHA, sem espera. ORDEM DAS COLUNAS = a do ramo da aprovação.
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               rg.modulo,
               cp.posto, cp.chave, cp.pmo, cp.op,
               0, 0,
               cp.linhas,
               true,
               cp.linhas::numeric,
               1::numeric,
               '{}'::text[], jsonb_build_array(jsonb_build_object('pmo', cp.pmo, 'op', cp.op)),
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select * from public.alerta_compels_problemas(rg.postos, coalesce(public.alerta_pmos_normalizar(rg.pmos), '{}'::text[]))
            )
            select d.posto, d.chave, d.pmo, d.op, d.linhas from d
            union all
            select oc.posto, oc.defeito, oc.pmo, oc.op, 0
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.chave = oc.defeito)
          ) cp
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'compels'
        union all
        -- Problemas no envio ao Compels (0170), AVISOS DE GRAVAÇÃO: UMA linha por regra, com `posto` NULO (é o
        -- que a distingue das linhas de ocorrência acima). O aviso de uma entrada JÁ ENVIADA é permanente,
        -- então não vira ocorrência: o laço o trata no bloco próprio (como o fim de EMB), com marca de "já avisei".
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               rg.modulo,
               null::text, null::text, null::text, null::text,
               0, 0,
               0,
               false,
               null::numeric,
               null::numeric,
               '{}'::text[], '[]'::jsonb,
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'compels'
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
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
          select null, d.usuario_id, d.canal, 'resumo', t.modulo, v_dados, false, 'usuario'
            from (
              -- Telegram e Discord: pela conta vinculada de AGORA (quem desvinculou não recebe).
              select c.usuario_id, c.canal
                from public.alerta_contas c
               where c.usuario_id = any (t.destinatarios)
                 and c.canal = any (t.canais)
              union all
              -- E-mail: NÃO há vínculo — o endereço é o do login (usuarios.email, decisão 7 da spec).
              -- Quem está com o endereço em branco fica fora: não há endereço a inventar.
              select u2.id, 'email'
                from public.usuarios u2
               where u2.id = any (t.destinatarios)
                 and 'email' = any (t.canais)
                 and nullif(btrim(u2.email), '') is not null
            ) d
            join public.usuarios u on u.id = d.usuario_id and u.ativo
           where public.usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')
           order by d.usuario_id, d.canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        if t.avisar_canal and v_canal is not null then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo, destino_externo_id)
          select null, null, 'discord', 'resumo', t.modulo, v_dados, false, 'canal', v_canal;
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

    -- ⚠️ O FIM DE EMB (0150) SAI POR AQUI E POR MAIS LUGAR NENHUM (ver o aviso do cabeçalho).
    -- Também não conta em `avaliadas`, que continua sendo "itens de posto avaliados": numa rodada
    -- só de fim de EMB o retorno traz `avaliadas: 0` com `enfileirados > 0`, e isso NÃO é
    -- contradição.
    if t.tipo = 'emb' then
      for v_emb in
        -- O PISO é o criado_em DA REGRA (ver o cabeçalho): EMB fechada antes de a regra existir
        -- não avisa; e EMB fechada há mais de v_teto_idade (3 dias) também não — nem é marcada. O teto de 50 por rodada (EMBS_POR_RODADA) é cinto e suspensório — com 200
        -- pendentes, saem em quatro rodadas (20 min) em vez de 200 mensagens de uma vez. Mais
        -- antigas primeiro.
        select f.emb, f.fechada_em
          from public.rec_embs_fechadas(t.criado_em) f
         where f.fechada_em >= v_agora - v_teto_idade   -- o TETO (ver v_teto_idade, no topo)
           and not exists (select 1
                             from public.alerta_emb_avisada a
                            where a.regra_id = t.regra_id and a.emb = f.emb)
         order by f.fechada_em, f.emb
         limit 50
      loop
        -- SÓ as divergências, com a justificativa de cada uma (decisão 4 da spec). Quem decide o
        -- texto do "ninguém justificou" é o TS: aqui a justificativa vazia viaja vazia.
        select coalesce(jsonb_agg(jsonb_build_object(
                          'numero',              d.numero,
                          'item',                d.item,
                          'descricao',           d.descricao,
                          'quantidade_pedido',   d.quantidade_pedido,
                          'quantidade_recebida', d.quantidade_recebida,
                          'divergencia',         d.divergencia,
                          'justificativa',       d.justificativa,
                          'justificada_por_nome', d.justificada_por_nome)
                        order by d.numero), '[]'::jsonb)
          into v_divs
          from public.rec_emb_divergencias(v_emb.emb) d;

        v_emb_n := 0;

        -- ⚠️ TODA EMB QUE FECHA MANDA MENSAGEM (decisão 5 da spec, corrigida em 14/10/2026). Com
        -- divergência, a lista viaja no `dados`; SEM divergência, `divergencias` viaja VAZIA (`[]`)
        -- e quem escreve a frase "fechou sem divergência" é o TS (domain/emb.ts) — esta migração
        -- não decide texto nenhum. Por isso NÃO há aqui nenhum `if` em volta do `jsonb_build_object`
        -- e do fan-out: a EMB limpa percorre exatamente o mesmo caminho da EMB divergente.
        -- ⚠️ Até 09/10 este bloco começava com `if jsonb_array_length(v_divs) > 0 then` e PULAVA a
        -- EMB limpa. Se esse `if` reaparecer, é a decisão antiga ressurgindo: confira a spec.
        v_dados := jsonb_build_object(
                     'regra_tipo',   t.tipo,
                     'regra_nome',   t.nome,
                     'emb',          v_emb.emb,
                     'fechada_em',   v_emb.fechada_em,
                     'divergencias', v_divs,
                     'agora',        v_agora);

        -- Mesmas duas filas do resumo, SEM ocorrência, sem botão, com o tipo de envio 'emb' e o
        -- módulo da regra congelado na linha (0149).
        if t.avisar_pessoas then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
          select null, d.usuario_id, d.canal, 'emb', t.modulo, v_dados, false, 'usuario'
            from (
              -- Telegram e Discord: pela conta vinculada de AGORA (quem desvinculou não recebe).
              select c.usuario_id, c.canal
                from public.alerta_contas c
               where c.usuario_id = any (t.destinatarios)
                 and c.canal = any (t.canais)
              union all
              -- E-mail: NÃO há vínculo — o endereço é o do login (usuarios.email, decisão 7 da spec).
              -- Quem está com o endereço em branco fica fora: não há endereço a inventar.
              select u2.id, 'email'
                from public.usuarios u2
               where u2.id = any (t.destinatarios)
                 and 'email' = any (t.canais)
                 and nullif(btrim(u2.email), '') is not null
            ) d
            join public.usuarios u on u.id = d.usuario_id and u.ativo
           where public.usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')
           order by d.usuario_id, d.canal;
          get diagnostics v_n = row_count;
          v_emb_n := v_emb_n + v_n;
        end if;

        if t.avisar_canal and v_canal is not null then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo,
             destino_externo_id)
          select null, null, 'discord', 'emb', t.modulo, v_dados, false, 'canal', v_canal;
          get diagnostics v_n = row_count;
          v_emb_n := v_emb_n + v_n;
        end if;

        v_enfileirados := v_enfileirados + v_emb_n;

        -- A MARCA (ver o aviso do cabeçalho): UM critério só, igual ao do resumo diário — grava
        -- depois de enfileirar, e só se algo foi para a fila. Ninguém alcançável NÃO grava: volta
        -- na próxima rodada, com ou sem divergência.
        if v_emb_n > 0 then
          insert into public.alerta_emb_avisada (regra_id, emb, avisada_em, divergencias, enviados)
          values (t.regra_id, v_emb.emb, v_agora, jsonb_array_length(v_divs), v_emb_n)
          -- Corrida (cron atrasado + "Avaliar agora"): a trava advisory já impede, e o `do nothing`
          -- é a terceira linha de defesa. Nunca sobrescreve a marca que já existe.
          on conflict (regra_id, emb) do nothing;
        else
          -- Havia o que avisar (ainda que fosse só "a EMB fechou limpa") e ninguém alcançável. Sem
          -- este rastro, uma regra cujos responsáveis nunca vincularam conta deixaria o aviso sem
          -- sair toda rodada, sem log e sem contador.
          raise log 'alerta_avaliar: EMB % da regra % (%) nao foi avisada (% divergencia(s)): ninguem alcancavel',
            v_emb.emb, t.regra_id, t.nome, jsonb_array_length(v_divs);
        end if;
      end loop;

      continue;
    end if;

    -- ⚠️ OS AVISOS DE GRAVAÇÃO DO COMPELS (0170) SAEM POR AQUI E POR MAIS LUGAR NENHUM. A linha de regra
    -- (posto nulo) NÃO é ocorrência: o aviso de uma entrada já enviada é permanente, e uma ocorrência
    -- aberta para sempre não resolve nada. Mensagem única por envio, com a marca em
    -- alerta_compels_avisados (grava depois de enfileirar, e só se algo foi para a fila — mesmo critério
    -- do fim de EMB). Piso: o criado_em da regra; teto: v_teto_idade (3 dias), para ligar a regra não
    -- despejar os avisos antigos. Não conta em `avaliadas`.
    if t.tipo = 'compels' and t.posto is null then
      select rg.postos, coalesce(public.alerta_pmos_normalizar(rg.pmos), '{}'::text[])
        into v_postos, v_pmos_resumo
        from public.alerta_regras rg
       where rg.id = t.regra_id;

      select coalesce(jsonb_agg(jsonb_build_object('pmo', x.pmo, 'op', x.op, 'quantidade', x.quantidade,
                                                   'aviso', x.aviso)
                                order by x.enviado_em, x.id), '[]'::jsonb),
             coalesce(array_agg(x.id order by x.enviado_em, x.id), '{}'::uuid[])
        into v_avisos, v_ids
        from (
          select e.id, btrim(e.pmo) as pmo, e.op, e.quantidade, e.aviso, e.enviado_em
            from public.sf_estoque_envios e
           where e.operacao = 'entrada'
             and e.ok
             and e.cancelado_em is null
             and nullif(btrim(coalesce(e.aviso, '')), '') is not null
             and e.posto = any (v_postos)
             and (cardinality(v_pmos_resumo) = 0 or btrim(e.pmo) = any (v_pmos_resumo))
             and e.enviado_em >= greatest(t.criado_em, v_agora - v_teto_idade)
             and not exists (select 1
                               from public.alerta_compels_avisados a
                              where a.regra_id = t.regra_id and a.envio_id = e.id)
           order by e.enviado_em, e.id
           limit 30
        ) x;

      if jsonb_array_length(v_avisos) > 0 then
        v_dados := jsonb_build_object(
                     'regra_tipo', t.tipo,
                     'regra_nome', t.nome,
                     'avisos',     v_avisos,
                     'agora',      v_agora);
        v_resumo_n := 0;

        if t.avisar_pessoas then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
          select null, d.usuario_id, d.canal, 'compels_aviso', t.modulo, v_dados, false, 'usuario'
            from (
              select c.usuario_id, c.canal
                from public.alerta_contas c
               where c.usuario_id = any (t.destinatarios)
                 and c.canal = any (t.canais)
              union all
              select u2.id, 'email'
                from public.usuarios u2
               where u2.id = any (t.destinatarios)
                 and 'email' = any (t.canais)
                 and nullif(btrim(u2.email), '') is not null
            ) d
            join public.usuarios u on u.id = d.usuario_id and u.ativo
           where public.usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')
           order by d.usuario_id, d.canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        if t.avisar_canal and v_canal is not null then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo, destino_externo_id)
          select null, null, 'discord', 'compels_aviso', t.modulo, v_dados, false, 'canal', v_canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        v_enfileirados := v_enfileirados + v_resumo_n;

        if v_resumo_n > 0 then
          insert into public.alerta_compels_avisados (regra_id, envio_id, avisada_em)
          select t.regra_id, i, v_agora from unnest(v_ids) i
          on conflict (regra_id, envio_id) do nothing;
        else
          raise log 'alerta_avaliar: % aviso(s) de gravacao do Compels da regra % (%) nao enviados: ninguem alcancavel',
            jsonb_array_length(v_avisos), t.regra_id, t.nome;
        end if;
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
      -- Itens da OP (só o parado): o app os mandou em p_parados; na normalização não há, e vai [].
      v_itens := null;
      v_expediente := null;
      if t.tipo = 'parado' then
        -- 0172: junto com os itens vem se a conta foi em horas de EXPEDIENTE (a regra tem turno) ou em
        -- relógio corrido; o texto diz "de expediente" só no primeiro caso. Na normalização não há entrada.
        select e -> 'itens', (e ->> 'expediente')::boolean into v_itens, v_expediente
          from jsonb_array_elements(coalesce(p_parados -> t.regra_id::text, '[]'::jsonb)) e
         where e ->> 'pmo' = t.pmo and e ->> 'op' = t.op
         limit 1;
      elsif t.tipo = 'compels' then
        -- Os motivos da OP (agrupados por texto), lidos da própria fila. Na normalização a OP já não tem
        -- problema e vai [].
        select d.itens into v_itens
          from public.alerta_compels_problemas(array[t.posto], '{}'::text[]) d
         where d.pmo = btrim(t.pmo) and d.op = t.op
         limit 1;
      end if;
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
                      when 'parado' then jsonb_build_object(
                        'limite_horas', (t.limite / 60)::int, 'mais_antiga_min', t.valor,
                        'expediente', coalesce(v_expediente, false),
                        'itens', coalesce(v_itens, '[]'::jsonb))
                      when 'compels' then jsonb_build_object(
                        'linhas', t.valor::int,
                        'itens', coalesce(v_itens, '[]'::jsonb))
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
      -- AGORA, que esteja ATIVO e que administre O MÓDULO DA REGRA (t.modulo, desde a 0149; era
      -- 'shopfloor' fixo). Mesma transação da decisão: ou as
      -- duas coisas ficam, ou nenhuma. `avisar_pessoas = false` = ninguém no privado.
      if t.avisar_pessoas then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
        select o.id, d.usuario_id, d.canal, v_tipo, t.modulo, v_dados, v_tipo in ('alerta', 'lembrete'), 'usuario'
        from (
          -- Telegram e Discord: pela conta vinculada de AGORA (quem desvinculou não recebe).
          select c.usuario_id, c.canal
            from public.alerta_contas c
           where c.usuario_id = any (t.destinatarios)
             and c.canal = any (t.canais)
          union all
          -- E-mail: NÃO há vínculo — o endereço é o do login (usuarios.email, decisão 7 da spec).
          -- Quem está com o endereço em branco fica fora: não há endereço a inventar.
          select u2.id, 'email'
            from public.usuarios u2
           where u2.id = any (t.destinatarios)
             and 'email' = any (t.canais)
             and nullif(btrim(u2.email), '') is not null
        ) d
        join public.usuarios u on u.id = d.usuario_id and u.ativo
        -- responsável precisa administrar O MÓDULO DA REGRA agora (spec 2026-09-18, decisão 5;
        -- por módulo desde a 0149)
        where public.usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')
        order by d.usuario_id, d.canal;
        get diagnostics v_n = row_count;
        v_enfileirados := v_enfileirados + v_n;
      end if;

      -- FILA (canal): UMA linha por ocorrência, sem usuário. O `select` sem `from` devolve 1 linha
      -- quando o `where` é verdadeiro e 0 quando não — é assim que sai uma, e não uma por
      -- responsável (N mensagens iguais no mesmo canal). Não olha `canais`: aquilo é a conversa
      -- privada; o canal é sempre o do Discord (DISCORD_CANAL_ID).
      if t.avisar_canal and v_canal is not null then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo, destino_externo_id)
        select o.id, null, 'discord', v_tipo, t.modulo, v_dados, v_tipo in ('alerta', 'lembrete'), 'canal', v_canal;
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

revoke all on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
