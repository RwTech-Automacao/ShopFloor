-- =============================================================
-- ALERTAS — RESUMO DIÁRIO POR POSTO
-- Spec: docs/superpowers/specs/2026-10-08-alertas-resumo-diario-design.md
--
-- Aplica POR CIMA da 0113/0115/0123/0139 (nenhuma é editada). Idempotente: rodar de novo não
-- quebra (add column if not exists, drop ... if exists antes de recriar cada check).
--
-- Um tipo de regra novo, 'resumo': na hora configurada, manda UMA mensagem com a taxa de aprovação
-- do dia de cada posto da regra. Posto sem bipe no dia fica fora; dia sem nenhum posto com dado
-- não envia e não grava. Relatório não abre ocorrência, não tem "Resolvido", não insiste e não
-- normaliza.
--
-- O período ("o dia") é o que cai dentro dos intervalos cadastrados na regra, na tabela
-- alerta_regra_intervalos da 0139. A hora de envio é decidida pelo APP (src/modules/alertas/domain/
-- resumo.ts, com testes nos fusos): o banco recebe só o mapa p_resumos e não compara horário.
-- NENHUMA conta de fuso mora aqui: o app manda o DIA de São Paulo e as faixas já em instantes
-- (ver o contrato abaixo), e o banco só compara instantes e grava a data que recebeu.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0141_alertas_resumo_diario.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app. A assinatura nova de alerta_avaliar derruba a
-- anterior; app novo contra banco velho quebra o cron.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- as colunas do resumo ----------
-- hora_resumo: a hora de envio ('HH:MM' na fábrica). resumo_enviado_em: a DATA do último envio.
-- Data, não instante: a pergunta é "já mandei hoje?", e com instante uma rodada atrasada moveria a
-- hora do relatório um pouco a cada dia.
alter table public.alerta_regras
  add column if not exists hora_resumo       time,
  add column if not exists resumo_enviado_em date;

alter table public.alerta_regras drop constraint if exists alerta_regras_resumo_hora;
alter table public.alerta_regras
  add constraint alerta_regras_resumo_hora
  check (tipo <> 'resumo' or hora_resumo is not null);

-- Faixa da hora: ela mantém o relatório longe da virada do dia. ⚠️ Os mesmos valores de
-- HORA_RESUMO_MIN / HORA_RESUMO_MAX em src/modules/alertas/domain/resumo.ts: os dois lugares têm
-- de concordar. Nulo passa (só o tipo resumo exige hora, pelo check acima).
alter table public.alerta_regras drop constraint if exists alerta_regras_resumo_hora_faixa;
alter table public.alerta_regras
  add constraint alerta_regras_resumo_hora_faixa
  check (hora_resumo is null or hora_resumo between time '06:00' and time '19:00');

-- ---------- o tipo e os campos de cada tipo ----------
alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo'));

-- Os três ramos antigos são IGUAIS aos da 0115; o 'resumo' é o único acréscimo. Ele não usa nenhum
-- campo de limite (o domínio recusa se vier preenchido) e sai com janela 'intervalos' sem passo.
-- coalesce(..., false): sem ele, um campo NULO faria a expressão dar NULL — e check com NULL PASSA.
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

-- ---------- os DOIS checks de janela_valor que o resumo atravessa ----------
-- O resumo sai com janela_tipo = 'intervalos' e janela_valor NULO (não tem passo).
--
-- (1) O check da 0139 BARRAVA o resumo (exigia tipo = 'aprovacao' e janela_valor >= 15). Agora: a
--     aprovação mantém o piso de 15 minutos; o resumo exige valor NULO. Escrito com
--     `janela_valor is not null and janela_valor >= 15` de propósito: sem o `is not null`, valor
--     nulo daria `NULL`, e check com NULL passa — uma aprovação por blocos sem passo entraria.
alter table public.alerta_regras drop constraint if exists alerta_regras_intervalos_check;
alter table public.alerta_regras
  add constraint alerta_regras_intervalos_check
  check (janela_tipo <> 'intervalos'
         or (tipo = 'aprovacao' and janela_valor is not null and janela_valor >= 15)
         or (tipo = 'resumo' and janela_valor is null));

-- (2) O check da 0113 NÃO barrava o resumo — mas por ACIDENTE. Com 'intervalos' e valor nulo, o
--     primeiro ramo dava false e o segundo `true and (null > 0)` = NULL; `false or NULL` = NULL, e
--     um CHECK só rejeita quando o resultado é FALSE. Funcionava pela lógica de três valores do SQL,
--     não porque alguém tivesse escrito que 'intervalos' pode ter valor nulo.
--     ⚠️ O COMENTÁRIO DA 0139 ("o check da 0113 já cobre 'intervalos'") ESTÁ ERRADO: cobria o caso
--     de valor preenchido e deixava o nulo passar sem querer. É isto aqui que cobre.
--     Agora a intenção está escrita: 'op' e 'intervalos' PODEM ter valor nulo; 'tempo' e 'bipes'
--     exigem valor positivo (e o `is not null` explícito fecha o mesmo buraco do NULL neles).
--     Quem "arrumar" esta expressão: o resumo precisa continuar passando com valor nulo.
--
-- ORDEM: o check NOVO entra ANTES de o antigo cair. Se o novo falhar (linha legada que ele recusa),
-- o velho continua no lugar, rodando a migração com `psql -1` ou sem. Derrubar primeiro deixava a
-- tabela SEM check de janela_valor num `psql -f` sem transação única.
-- ⚠️ Não há `else`: um 5o janela_tipo no futuro é RECUSADO (os ramos dão false). É falha alta, de
-- propósito, mas quem acrescentar um janela_tipo TEM de mexer aqui, como no resumo (acima).
-- O check de coluna da 0113 tem DUAS colunas na expressão, então o Postgres lhe deu um nome
-- automático que não dá para adivinhar (alerta_regras_check, alerta_regras_check1...). Acha-se pela
-- definição: a única que traz `janela_valor > 0`. O novo tem nome próprio, que o loop poupa.
alter table public.alerta_regras drop constraint if exists alerta_regras_janela_valor_nulo_explicito;
alter table public.alerta_regras
  add constraint alerta_regras_janela_valor_nulo_explicito
  check (
    (janela_tipo = 'op' and janela_valor is null)
    or (janela_tipo = 'intervalos' and (janela_valor is null or janela_valor > 0))
    or (janela_tipo in ('tempo', 'bipes') and janela_valor is not null and janela_valor > 0)
  );

-- Agora o antigo da 0113 pode cair (o novo, já presente, é poupado pelo loop).
do $func$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.alerta_regras'::regclass
       and c.contype = 'c'
       and c.conname <> 'alerta_regras_janela_valor_nulo_explicito'
       and pg_get_constraintdef(c.oid) like '%janela_valor > 0%'
  loop
    execute format('alter table public.alerta_regras drop constraint %I', v_nome);
  end loop;
end
$func$;

-- ---------- o tipo de envio 'resumo' ----------
-- O envio do relatório não é alerta, lembrete, resolvido nem normalizou: ele nasce SEM ocorrência
-- (ocorrencia_id nulo, que a coluna permite) e SEM botão. Tipo próprio, para a fila e o texto não
-- o confundirem com um deles. O check de coluna da 0113 tem uma coluna só: nome automático.
alter table public.alerta_envios drop constraint if exists alerta_envios_tipo_check;
alter table public.alerta_envios
  add constraint alerta_envios_tipo_check
  check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo'));

-- =============================================================
-- A LÓGICA: alerta_avaliar ganha a saída do resumo
--
-- O CONTRATO NOVO: alerta_avaliar(p_canal_discord text, p_blocos jsonb, p_resumos jsonb).
-- p_resumos é
--   {"<regra_id>": {"dia": "2026-10-08",
--                   "faixas": [{"inicio": "<timestamptz ISO>", "fim": "<timestamptz ISO>"}, ...]}}
-- e traz SÓ as regras de resumo cuja hora chegou e que ainda não mandaram hoje
-- (src/modules/alertas/domain/resumo.ts decide e calcula: o dia de São Paulo e cada intervalo do
-- turno posto nesse dia como instante). Regra de resumo AUSENTE do mapa é PULADA. Mesmo padrão do
-- p_blocos da 0139: o que depende de fuso chega pronto do servidor, onde tem teste em quatro fusos.
--
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÃO EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- public.alerta_avaliar — a versão viva é a da 0139 — 4 diferenças:
--   1. a assinatura ganha `p_resumos jsonb default null` ao fim;
--   2. variáveis novas (v_dia, v_faixas, v_postos, v_pmos_resumo, v_linhas, v_resumo_n), só do resumo;
--   3. um QUARTO ramo no `union all` do cursor: uma linha por regra de resumo presente em
--      p_resumos, com avaliavel = false e valor/limite nulos;
--   4. UM bloco no topo do laço, `if t.tipo = 'resumo' then ... continue; end if;`.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, os três ramos antigos
--   do cursor, o mínimo de bipes, o v_abaixo, o `select ... for update`, abrir / normalizar /
--   insistir / reabrir, o bloco_reportado, o `dados` e as duas filas ficam byte a byte iguais. O
--   `diff -u` contra o corpo da 0139 mostra só estas quatro coisas. Os tipos 'aprovacao', 'tempo' e
--   'defeito' nunca entram no `if t.tipo = 'resumo'` (a condição é falsa) e a linha de resumo
--   nunca chega ao resto.
--
-- ⚠️ POR QUE UMA SAÍDA ÚNICA NO TOPO, E NÃO `t.tipo <> 'resumo'` ESPALHADO: o caminho da ocorrência
-- tem seis passos (mínimo de bipes, v_abaixo, busca com `for update`, abrir, normalizar,
-- insistir/reabrir) numa função de ~400 linhas SEM teste de unidade. Uma condição em cada um seria
-- seis chances de esquecer uma, e esquecer não dá erro: dá ocorrência fantasma de relatório, o
-- botão "Resolvido" num relatório ou o relatório reenviado a cada 5 minutos. Com a saída única o
-- caminho da ocorrência fica como estava, e quem o lê não precisa saber que o resumo existe. A
-- linha do cursor ainda sai com avaliavel = false: se o bloco do topo for removido por engano, a
-- primeira guarda do caminho antigo pula a linha em vez de abrir ocorrência.
--
-- ⚠️ A DATA (resumo_enviado_em) É GRAVADA EM UM LUGAR SÓ: logo depois de enfileirar, e só se
-- alguma linha entrou na fila. Dia sem posto com dado: não enfileira, não grava. Gravar num caminho
-- que não envia faria o relatório sumir por um dia inteiro em silêncio.
--
-- ⚠️ A ASSINATURA ANTIGA SAI (o `drop function if exists`, depois do `create`). O parâmetro novo é
-- o ÚLTIMO e tem default, então a assinatura nova atende quem chama com 1 ou 2 argumentos. Mas
-- `create or replace` não substitui função de assinatura diferente: sem o drop, a velha e a nova
-- coexistiriam, e a chamada curta ficaria ambígua ("function ... is not unique") ou cairia na
-- velha, que não conhece resumo nenhum.
-- =============================================================

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
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas));
end
$func$;

-- A assinatura nova é OUTRA função: nasce com EXECUTE para o PUBLIC. O revoke não é opcional (é uma
-- security definer; sem ele `anon` a chamaria) — o mesmo furo que a 0119 fechou.
revoke all on function public.alerta_avaliar(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb, jsonb) to service_role;

-- A assinatura de 2 parâmetros sai de cena (ver o aviso do cabeçalho). Depois do create: o `-1` do
-- psql aplica tudo numa transação só, então não há instante com a chamada ambígua.
drop function if exists public.alerta_avaliar(text, jsonb);

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho: sem isto, a RPC continua batendo na
-- assinatura antiga (que já não existe). Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
