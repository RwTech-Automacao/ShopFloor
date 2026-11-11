-- =============================================================
-- ALERTAS — RESPONSÁVEIS DA REGRA 'compels' (Problemas no envio ao Compels)
--
-- Até aqui, responsável de QUALQUER regra do ShopFloor tinha de ADMINISTRAR o ShopFloor
-- (usuario_tem_permissao(u, 'shopfloor', 'administrar')). A regra 'compels' fala da fila de envio do
-- ALMOXARIFADO ao Compels, e quem resolve o problema é o pessoal do Almoxarifado — que não administra o
-- ShopFloor e por isso nem aparecia na lista de responsáveis (caso da Gilania, perfil Almoxarifado).
--
-- A RÉGUA NOVA, SÓ PARA O TIPO 'compels': além de quem administra o módulo da regra, vale quem pode usar a
-- tela do Almoxarifado (/recebimento/almoxarifado), que exige DUAS permissões do perfil:
-- `recebimento.lancar` E `shopfloor.visualizar` (ver src/app/(app)/recebimento/almoxarifado/page.tsx).
-- Usuário ativo, sempre. NOS OUTROS TIPOS NADA MUDA: a função nova devolve exatamente o que o
-- usuario_tem_permissao(u, modulo, 'administrar') devolvia.
--
--   A. alerta_pode_receber(usuário, módulo, tipo): a régua num lugar só. Só service_role (o app não chama;
--      as funções de alerta, security definer, chamam como dono).
--   B. alerta_destinatarios(p_modulo, p_tipo): ganha o 2º parâmetro (opcional; nulo = a lista de sempre, só
--      quem administra) e a coluna `administra`. A tela pede a lista do 'compels' e mostra, nos outros tipos,
--      só quem administra. A assinatura de 1 parâmetro é DERRUBADA antes (com o default do 2º, a chamada
--      antiga `alerta_destinatarios(p_modulo => ...)` do app atual continua resolvendo — sem ambiguidade).
--   C. alerta_avaliar (MESMA assinatura de 4 parâmetros; create or replace) — a versão viva é a da 0173 —
--      2 diferenças, e só elas (o runner confere por diff):
--        1. no fan-out de pessoas do AVISO DE GRAVAÇÃO do Compels ('compels_aviso');
--        2. no fan-out de pessoas do caminho da OCORRÊNCIA (alerta/lembrete/normalizou, todos os tipos que
--           abrem ocorrência),
--      `usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')` vira
--      `alerta_pode_receber(d.usuario_id, t.modulo, t.tipo)`. Nos tipos que não são 'compels' é o mesmo valor.
--   D. alerta_resolver_interno — a versão viva é a da 0151 — 2 diferenças:
--        1. QUEM PODE APERTAR "Resolvido" no botão da mensagem: `usuario_tem_permissao(p_usuario_id,
--           'shopfloor', 'administrar')` vira `alerta_pode_receber(p_usuario_id, 'shopfloor', r.tipo)`
--           (o 'shopfloor' fixo da 0149 fica: ver a nota de lá);
--        2. o fan-out do "resolvido por X" usa `alerta_pode_receber(d.usuario_id, r.modulo, r.tipo)`.
--   E. alerta_reservar_envios — a versão viva é a da 0151 — 1 diferença: a régua do ramo 'usuario' vira
--      `alerta_pode_receber(e.usuario_id, e.modulo, <tipo da regra>)`, com o tipo vindo da regra da
--      ocorrência (novo `left join alerta_regras rg on rg.id = oc.regra_id`) ou, no aviso de gravação do
--      Compels (sem ocorrência), da própria linha (`e.tipo = 'compels_aviso'` -> 'compels'). Sem isso a linha
--      da Gilania entraria na fila e nunca seria reservada (ficaria pendente e expiraria em 24 h).
--   Assinaturas de C, D e E iguais: sem `drop function`; grants reemitidos.
--
--   Aplica POR CIMA da 0173 (a alerta_avaliar vigente) e da 0151 (resolver_interno e reservar_envios
--   vigentes). Idempotente.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0182_alerta_compels_destinatarios.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app. O app novo chama alerta_destinatarios com p_tipo; o app
--    ANTIGO, com o banco novo, segue funcionando (chama só com p_modulo e recebe a lista de sempre).
-- Convenções: corpo de função com $func$ (o SQL Editor recusa o de dois cifrões); grants e revokes
-- explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A. alerta_pode_receber(): quem pode ser responsável de uma regra ----------
create or replace function public.alerta_pode_receber(p_usuario uuid, p_modulo text, p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select public.usuario_tem_permissao(p_usuario, p_modulo, 'administrar')
      or (p_tipo = 'compels'
          and public.usuario_tem_permissao(p_usuario, 'recebimento', 'lancar')
          and public.usuario_tem_permissao(p_usuario, 'shopfloor', 'visualizar'))
$func$;

revoke all on function public.alerta_pode_receber(uuid, text, text) from public, anon, authenticated;
grant execute on function public.alerta_pode_receber(uuid, text, text) to service_role;

-- ---------- B. alerta_destinatarios(p_modulo, p_tipo): quem a tela oferece ----------
-- O drop da assinatura de 1 parâmetro vem ANTES do create: com as duas no ar, a chamada só com p_modulo
-- seria ambígua. Tudo numa transação (psql -1): não há instante sem a função.
drop function if exists public.alerta_destinatarios(text);
drop function if exists public.alerta_destinatarios(text, text);
create function public.alerta_destinatarios(p_modulo text default 'shopfloor', p_tipo text default null)
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean,
               email_ok boolean, administra boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_modulo text := btrim(coalesce(p_modulo, ''));
  v_tipo   text := nullif(btrim(coalesce(p_tipo, '')), '');
begin
  if v_modulo not in ('shopfloor', 'recebimento') then raise exception 'MODULO_INVALIDO'; end if;
  if not tem_permissao(v_modulo, 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord'),
           nullif(btrim(u.email), '') is not null,
           -- false = só entrou pela régua do tipo (hoje: o Almoxarifado na regra 'compels').
           public.usuario_tem_permissao(u.id, v_modulo, 'administrar')
      from usuarios u
     where u.ativo
       and public.alerta_pode_receber(u.id, v_modulo, v_tipo)
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios(text, text) from public, anon;
grant execute on function public.alerta_destinatarios(text, text) to authenticated, service_role;

-- ---------- C. alerta_avaliar: a régua do responsável passa pelo tipo ----------
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
  -- Só a ficha de apontamento (0173) usa estas: a ficha da vez, os PMOs da regra e quantas ficaram sem ninguém.
  v_ficha        record;
  v_ficha_sem    int;
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
        union all
        -- Ficha de apontamento (0173): UMA linha por regra, com `posto` NULO. Não há ocorrência nem medida: o laço
        -- trata no bloco próprio (uma mensagem por caixa/lote novo, com marca de "já avisei"). ORDEM DAS COLUNAS =
        -- a do ramo da aprovação (união posicional, 26 colunas), igual ao aviso de gravação do compels acima.
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
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'ficha'
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
           where public.alerta_pode_receber(d.usuario_id, t.modulo, t.tipo)
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

    -- ⚠️ A FICHA DE APONTAMENTO (0173) SAI POR AQUI E POR MAIS LUGAR NENHUM. Sem ocorrência, sem botão: uma
    -- mensagem por caixa/lote novo, com a marca em alerta_ficha_avisadas (gravada DEPOIS de enfileirar e só se
    -- alguém foi alcançável — sem ninguém, a marca não grava e a ficha sai quando alguém vincular a conta, se
    -- ainda estiver dentro do teto). Piso = criado_em da regra; teto = v_teto_idade (3 dias); no máximo 30 por
    -- regra a cada rodada. Não conta em `avaliadas`. Os destinatários são os mesmos dos outros avisos únicos.
    if t.tipo = 'ficha' then
      select coalesce(public.alerta_pmos_normalizar(rg.pmos), '{}'::text[])
        into v_pmos_resumo
        from public.alerta_regras rg
       where rg.id = t.regra_id;

      v_ficha_sem := 0;
      for v_ficha in
        select * from public.alerta_ficha_novas(t.regra_id, v_pmos_resumo,
                                                greatest(t.criado_em, v_agora - v_teto_idade), 30)
      loop
        v_dados := jsonb_build_object(
                     'regra_tipo',          t.tipo,
                     'regra_nome',          t.nome,
                     'unidade',             v_ficha.tipo,
                     'qr',                  v_ficha.codigo,
                     'codigo',              v_ficha.codigo,
                     'pmo',                 btrim(v_ficha.pmo),
                     'op',                  v_ficha.op,
                     'produto',             coalesce(v_ficha.produto, ''),
                     'quantidade_op',       v_ficha.quantidade_op,
                     'quantidade_apontada', v_ficha.pecas,
                     'data_producao',       v_ficha.em,
                     'responsavel',         coalesce(v_ficha.responsavel, ''),
                     'agora',               v_agora);
        v_resumo_n := 0;

        if t.avisar_pessoas then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
          select null, d.usuario_id, d.canal, 'ficha', t.modulo, v_dados, false, 'usuario'
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
          select null, null, 'discord', 'ficha', t.modulo, v_dados, false, 'canal', v_canal;
          get diagnostics v_n = row_count;
          v_resumo_n := v_resumo_n + v_n;
        end if;

        v_enfileirados := v_enfileirados + v_resumo_n;

        if v_resumo_n > 0 then
          insert into public.alerta_ficha_avisadas (regra_id, tipo, pmo, op, chave, avisada_em)
          values (t.regra_id, v_ficha.tipo, v_ficha.pmo, v_ficha.op, v_ficha.chave, v_agora)
          on conflict (regra_id, tipo, pmo, op, chave) do nothing;
        else
          v_ficha_sem := v_ficha_sem + 1;
        end if;
      end loop;

      -- Um registro por rodada (e não por ficha): com 30 fichas sem destinatário o log não vira enxurrada.
      if v_ficha_sem > 0 then
        raise log 'alerta_avaliar: % ficha(s) de apontamento da regra % (%) nao enviadas: ninguem alcancavel',
          v_ficha_sem, t.regra_id, t.nome;
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
        where public.alerta_pode_receber(d.usuario_id, t.modulo, t.tipo)
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

-- A assinatura é a MESMA da 0173, então `create or replace` preserva a ACL; os comandos são
-- reemitidos de propósito (convenção da 0113).
revoke all on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) to service_role;

-- ---------- D. alerta_resolver_interno: o Almoxarifado também resolve o alerta do Compels ----------
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
  -- 0182: na regra 'compels' vale também quem pode usar a tela do Almoxarifado (alerta_pode_receber).
  -- Nos outros tipos a função devolve exatamente usuario_tem_permissao(..., 'shopfloor', 'administrar').
  if p_exigir_destinatario
     and not public.alerta_pode_receber(p_usuario_id, 'shopfloor', r.tipo) then
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

  -- FILA: "✅ resolvido por X" para os OUTROS responsáveis ativos que administram O MÓDULO DA
  -- REGRA (r.modulo, desde a 0149; era 'shopfloor' fixo), na
  -- mesma transação da resolução. Só na primeira resolução — apertar o botão de novo não avisa.
  -- `defeito` (nulo nos outros tipos) vai junto: numa regra de defeito com 2 códigos abertos no
  -- mesmo posto, sem ele o texto não diria QUAL dos dois foi resolvido.
  -- A explicação entra por `||` CONDICIONAL, e não como chave fixa: sem texto, a chave não existe, e
  -- o TS não precisa distinguir "não disse" de "disse nada" para não imprimir o rabo do "por X:".
  -- `o.explicacao` (e não v_expl) é o valor que REALMENTE ficou gravado na ocorrência.
  if not v_ja and r.avisar_pessoas then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
    select o.id, d.usuario_id, d.canal, 'resolvido', r.modulo,
           jsonb_build_object('posto', o.posto, 'defeito', o.defeito, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em,
                              'pmo', o.pmo, 'op', o.op, 'ops', coalesce(o.ops, '[]'::jsonb))
           || case when coalesce(o.explicacao, '') <> ''
                   then jsonb_build_object('explicacao', o.explicacao)
                   else '{}'::jsonb
              end,
           false, 'usuario'
        from (
          -- Telegram e Discord: pela conta vinculada de AGORA (quem desvinculou não recebe).
          select c.usuario_id, c.canal
            from public.alerta_contas c
           where c.usuario_id = any (r.destinatarios)
             and c.canal = any (r.canais)
          union all
          -- E-mail: NÃO há vínculo — o endereço é o do login (usuarios.email, decisão 7 da spec).
          -- Quem está com o endereço em branco fica fora: não há endereço a inventar.
          select u2.id, 'email'
            from public.usuarios u2
           where u2.id = any (r.destinatarios)
             and 'email' = any (r.canais)
             and nullif(btrim(u2.email), '') is not null
        ) d
        join public.usuarios u on u.id = d.usuario_id and u.ativo
       where public.alerta_pode_receber(d.usuario_id, r.modulo, r.tipo)
       and d.usuario_id is distinct from p_usuario_id
       order by d.usuario_id, d.canal;
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

-- ---------- E. alerta_reservar_envios: a linha do Almoxarifado é reservada ----------
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
      -- E-mail não tem vínculo: o endereço é o do login (usuarios.email). Para os outros canais, a
      -- conta vinculada (ou o endereço congelado na linha, no caso do canal do Discord).
      select e.id,
             case when e.canal = 'email' then nullif(btrim(u.email), '')
                  else coalesce(c.externo_id, e.destino_externo_id)
             end as externo_id
        from public.alerta_envios e
        left join public.alerta_contas c
               on e.destino_tipo = 'usuario' and c.usuario_id = e.usuario_id and c.canal = e.canal
        left join public.usuarios u
               on e.destino_tipo = 'usuario' and u.id = e.usuario_id
        left join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
        -- 0182: o TIPO da regra, para a régua do responsável (alerta_pode_receber). Linha de ocorrência:
        -- pela regra da ocorrência. Aviso de gravação do Compels (sem ocorrência): o tipo da linha já diz.
        left join public.alerta_regras rg on rg.id = oc.regra_id
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
               -- MÓDULO DA LINHA — e.modulo, congelado no enfileiramento; era 'shopfloor' fixo
               -- até a 0149). Quem perdeu qualquer uma nunca é reservado: a linha fica pendente,
               -- não conta tentativa nem falha, e sai da fila sozinha depois das 24 h.
               -- E-mail (0151): no lugar da conta vinculada, exige endereço de login não vazio.
               when 'usuario' then (case when e.canal = 'email'
                                         then nullif(btrim(u.email), '') is not null
                                         else c.externo_id is not null
                                    end)
                                   and coalesce(u.ativo, false)
                                   and public.alerta_pode_receber(
                                         e.usuario_id, e.modulo,
                                         case when e.tipo = 'compels_aviso' then 'compels' else rg.tipo end)
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

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
