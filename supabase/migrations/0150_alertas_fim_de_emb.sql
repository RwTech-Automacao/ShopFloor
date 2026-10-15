-- =============================================================
-- ALERTAS — AVISO DE FIM DE EMB
-- Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md
--
-- Aplica POR CIMA da 0113/0115/0123/0139/0141/0149 (nenhuma é editada). Idempotente.
--
-- Um tipo de regra novo, 'emb', do módulo RECEBIMENTO: quando TODOS os processos de uma EMB chegam
-- ao fim do fluxo (Almoxarifado ou Reprovado na Qualidade — as duas saídas terminais), sai UMA
-- mensagem com as divergências de quantidade daquela EMB e, em cada uma, a justificativa ou o vazio
-- de quem não justificou. EMB sem nenhuma divergência TAMBÉM manda: a mensagem diz que a EMB
-- fechou e que fechou SEM divergência (decisão 5 da spec, corrigida em 14/10/2026 — a versão
-- original dizia que EMB limpa não mandava nada). Quem escreve a frase é o TS, não esta migração:
-- aqui a EMB limpa enfileira com `divergencias` VAZIA.
--
-- Não abre ocorrência, não tem botão "Resolvido", não insiste e não normaliza — igual ao resumo
-- diário da 0141, de quem este trecho é cópia estrutural.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0150_alertas_fim_de_emb.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (o app novo manda tipo 'emb', que o banco velho
-- recusa). E DEPOIS da 0149, que é quem cria a coluna `modulo`. As duas sobem JUNTAS: em 14/10/2026
-- produção está em 0148 e a 0149 ainda não subiu.
--
-- ⚠️ OS TRÊS `add constraint` DAQUI VALIDAM AS LINHAS QUE JÁ EXISTEM. Em produção isso é seguro
-- porque não há nenhuma regra de módulo 'recebimento' (a 0149 nem subiu). Se um dia houver uma
-- regra de 'recebimento' com tipo que não seja 'emb' — combinação que nenhum caminho do app
-- produz —, o `alerta_regras_modulo_tipo` aqui recusa a migração inteira, de propósito: é para
-- alguém olhar a linha, não para a migração relaxar o check.
--
-- ⚠️ A REGRA DE FIM DE EMB NÃO TEM POSTO E NÃO TEM JANELA. Ela guarda `postos = '{}'` (o check de
-- `cardinality(postos) > 0` da 0113 é reescrito aqui para abrir exceção SÓ a ela) e
-- `janela_tipo = 'op'` com `janela_valor` nulo. O 'op' é um VALOR DE FACHADA, escolhido porque o
-- ramo dele dos dois checks de janela_valor já aceita valor nulo — assim nenhum dos dois é mexido
-- (um 5º janela_tipo obrigaria a reescrever os dois e o JanelaTipo do domínio por uma grandeza que
-- ninguém mede). Quem lê a regra NUNCA vê esse valor: a coluna "Janela" da lista mostra a frase
-- própria "Quando a EMB fecha" (resumoJanelaRegra, em src/modules/alertas/domain/regra.ts). É o
-- mesmo caminho que o resumo diário abriu ao forçar 'intervalos' e mostrar a hora.
--
-- ⚠️ O PISO rg.criado_em NÃO É DETALHE: sem ele, na PRIMEIRA rodada depois do deploy toda EMB
-- historicamente fechada atenderia ao gatilho e sairia uma avalanche de avisos. Só entram as EMBs
-- cuja última finalização é >= criado_em da regra. Mais um limite de EMBS_POR_RODADA por rodada.
--
-- ⚠️ O TETO DE IDADE (15/10/2026): o piso sozinho não cobre regra desativada por semanas e depois
-- reativada, nem regra sem ninguém alcançável por dias (a marca só é gravada quando algo entra na
-- fila): toda EMB fechada desde a criação avisaria de uma vez, 50 por rodada. Por isso EMB fechada
-- há mais de 3 dias NÃO avisa e NÃO é marcada (v_teto_idade, uma linha no alerta_avaliar).
-- Regra do aviso: fechada_em >= o MAIS TARDIO entre criado_em da regra (piso) e agora - 3 dias.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- o tipo 'emb' ----------
alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo', 'emb'));

-- Módulo x tipo (da 0149): agora o Recebimento tem um tipo.
alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_tipo;
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo')
    when 'recebimento' then tipo in ('emb')
  end, false));

-- Os quatro ramos antigos são IGUAIS aos da 0141; o 'emb' é o único acréscimo. Ele não usa NENHUM
-- campo de medida: nem taxa, nem janela em minutos, nem bipes, nem lembrete, nem limite, nem hora.
-- ⚠️ `minimo_bipes is null` NÃO sai de graça: a coluna é nullable desde a 0115 mas manteve o
-- `default 20` da 0113. Quem inserir uma regra de fim de EMB sem citar a coluna leva o 20 e é
-- recusado aqui — é por isso que a regras-repository.ts manda TODA coluna no insert, e é o mesmo
-- cuidado que o tipo 'resumo' já exige.
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
    when 'emb' then
          janela_tipo = 'op'
      and janela_valor is null
      and cardinality(postos) = 0
      and coalesce(cardinality(pmos), 0) = 0
      and taxa_minima is null and minimo_bipes is null and lembrete_min is null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
      and hora_resumo is null
  end, false));

-- ---------- `postos` vazio: SÓ no fim de EMB ----------
-- O check de coluna da 0113 (`cardinality(postos) > 0`) tem UMA coluna na expressão, então o
-- Postgres lhe deu nome automático (alerta_regras_postos_check ou parecido). Acha-se pela
-- definição. O novo tem nome próprio, que o loop poupa.
-- ORDEM: o novo entra ANTES de o antigo cair (se o novo falhar numa linha legada, o velho continua
-- no lugar). Mesmo padrão da 0141 com o janela_valor.
alter table public.alerta_regras drop constraint if exists alerta_regras_postos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_postos_por_tipo
  check ((tipo = 'emb' and cardinality(postos) = 0)
         or (tipo <> 'emb' and cardinality(postos) > 0));

do $func$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.alerta_regras'::regclass
       and c.contype = 'c'
       and c.conname <> 'alerta_regras_postos_por_tipo'
       and pg_get_constraintdef(c.oid) like '%cardinality(postos) > 0%'
  loop
    execute format('alter table public.alerta_regras drop constraint %I', v_nome);
  end loop;
end
$func$;

-- ---------- o tipo de envio 'emb' ----------
-- Nasce SEM ocorrência (ocorrencia_id nulo, que a coluna permite desde a 0113) e SEM botão. Tipo
-- próprio, para a fila e o texto não o confundirem com alerta, lembrete, resolvido ou resumo.
alter table public.alerta_envios drop constraint if exists alerta_envios_tipo_check;
alter table public.alerta_envios
  add constraint alerta_envios_tipo_check
  check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo', 'emb'));

-- ---------- a marca de "já avisei" ----------
-- ⚠️ POR QUE UMA TABELA, E NÃO UMA COLUNA COMO O resumo_enviado_em DA 0141: o resumo guarda UMA
-- data por regra porque o evento dele é "o dia". Aqui o evento é "esta EMB", e são muitas por
-- regra. É o MESMO mecanismo (estado gravado no banco, na mesma transação do enfileiramento, só
-- depois de enfileirar) na forma que o grão exige.
--
-- ⚠️ CONSEQUÊNCIA DE REABRIR, ESCRITA DE PROPÓSITO (spec): se um processo de uma EMB já avisada
-- voltar atrás, a EMB deixa de estar fechada; quando fechar de novo, ela NÃO avisa de novo — a
-- marca já está aqui. O aviso é "a EMB fechou", não "a EMB mudou".
create table if not exists public.alerta_emb_avisada (
  regra_id     uuid not null references public.alerta_regras(id) on delete cascade,
  -- Sempre em MAIÚSCULA e aparada: é como rec_embs_fechadas devolve, e é o que faz 'emb390' e
  -- ' EMB390 ' serem a MESMA EMB para a marca (o Recebimento compara EMB assim desde a 0124).
  emb          text not null check (btrim(emb) <> '' and emb = upper(btrim(emb))),
  avisada_em   timestamptz not null default now(),
  -- Para a auditoria responder "quantas divergências esta EMB tinha e para quantas pessoas a
  -- mensagem saiu?" sem reconstituir nada. `divergencias = 0` é a EMB que fechou limpa — e que
  -- TAMBÉM mandou mensagem (decisão 5 da spec, corrigida em 14/10/2026).
  divergencias int not null default 0 check (divergencias >= 0),
  enviados     int not null default 0 check (enviados >= 0),
  primary key (regra_id, emb)
);
alter table public.alerta_emb_avisada enable row level security;

drop policy if exists alerta_emb_avisada_select_admin on public.alerta_emb_avisada;
create policy alerta_emb_avisada_select_admin on public.alerta_emb_avisada
  for select using ((select tem_permissao('recebimento', 'administrar')));

revoke all on public.alerta_emb_avisada from public, anon;
grant select on public.alerta_emb_avisada to authenticated;
grant select, insert, update, delete on public.alerta_emb_avisada to service_role;

comment on table public.alerta_emb_avisada is
  'A marca de "já avisei" do aviso de fim de EMB: uma linha por (regra, EMB). Escrita SÓ pelo banco, dentro da alerta_avaliar, depois de enfileirar. Duas fontes nela = aviso duas vezes.';

-- ---------- o GATILHO: quais EMBs estão fechadas ----------
-- Uma EMB está fechada quando tem pelo menos 1 processo e TODOS eles estão num terminal. Terminal =
-- rec_etapa_por_status() em ('almoxarifado', 'reprovado'): o item reprovado também terminou, só que
-- pelo outro lado (spec: "não é 'saiu da Qualidade'").
--
-- `fechada_em` é a última finalização da EMB. coalesce(finalizado_em, created_at) porque o
-- histórico antigo tem terminal sem finalizado_em; cair no created_at joga a EMB para TRÁS no
-- tempo, então ela fica abaixo do piso e NÃO avisa — erra para o lado de calar, não de inundar.
--
-- ⚠️ p_desde é o PISO (o criado_em da regra). Sem ele, a primeira rodada em produção avisaria toda
-- EMB historicamente fechada.
--
-- Função INTERNA: só a alerta_avaliar (security definer, do owner) a chama. Sem tem_permissao
-- próprio e revogada de todos — ninguém a alcança de fora.
create or replace function public.rec_embs_fechadas(p_desde timestamptz)
returns table (emb text, fechada_em timestamptz)
language sql
stable
security definer
set search_path = public
as $func$
  select upper(btrim(p.numero_emb)) as emb,
         max(coalesce(p.finalizado_em, p.created_at)) as fechada_em
    from public.processos_recebimento p
   where coalesce(btrim(p.numero_emb), '') <> ''
   group by upper(btrim(p.numero_emb))
  having bool_and(public.rec_etapa_por_status(p.status) in ('almoxarifado', 'reprovado'))
     and max(coalesce(p.finalizado_em, p.created_at)) >= p_desde
$func$;

revoke all on function public.rec_embs_fechadas(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- o CONTEÚDO: as divergências de uma EMB, com as justificativas ----------
-- Só os itens que CARREGAM a marca de divergência (rec_divergente: vazio = não conferido, não é
-- divergência; zero = sem divergência; texto que não é número = sem divergência). A justificativa
-- vem como está: VAZIA quando ninguém justificou — é justamente a que precisa de ação, e quem
-- escolhe a palavra para o vazio é o TS (domain/emb.ts), não o SQL.
create or replace function public.rec_emb_divergencias(p_emb text)
returns table (
  numero bigint, item text, descricao text,
  quantidade_pedido numeric, quantidade_recebida numeric, divergencia text,
  justificativa text, justificada_por_nome text, justificada_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $func$
  select p.numero,
         coalesce(p.codigo_material, ''),
         coalesce(p.descricao_material, ''),
         p.quantidade_pedido,
         p.quantidade_recebida,
         coalesce(p.divergencia, ''),
         coalesce(p.divergencia_justificativa, ''),
         coalesce(p.divergencia_justificada_por_nome, ''),
         p.divergencia_justificada_em
    from public.processos_recebimento p
   where upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
     and public.rec_divergente(p.divergencia)
   order by p.numero
$func$;

revoke all on function public.rec_emb_divergencias(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÃO EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- public.alerta_avaliar(text, jsonb, jsonb) — a versão viva é a da 0149 — 4 diferenças:
--   1. variáveis novas (v_emb record, v_divs jsonb, v_emb_n int), só do fim de EMB;
--   2. um QUINTO ramo no `union all` do cursor: uma linha por regra de fim de EMB ativa, com
--      avaliavel = false e valor/limite nulos;
--   3. UM bloco no topo do laço, `if t.tipo = 'emb' then ... continue; end if;`, DEPOIS do bloco
--      do resumo;
--   4. a constante EMBS_POR_RODADA (50) escrita no `limit` desse bloco.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, os quatro ramos
--   anteriores do cursor, o bloco do resumo, o mínimo de bipes, o v_abaixo, o
--   `select ... for update`, abrir / normalizar / insistir / reabrir, o bloco_reportado, o `dados`
--   e as duas filas ficam byte a byte iguais. A assinatura NÃO muda: sem `drop function`.
--   O corpo abaixo foi EXTRAÍDO por linha da 0149 (linhas 292–792) e conferido com `diff -u`
--   depois de montado: três trechos ACRESCENTADOS, zero linha removida ou alterada.
--
-- ⚠️ POR QUE UMA SAÍDA ÚNICA NO TOPO, E NÃO `t.tipo not in ('resumo','emb')` ESPALHADO: é a mesma
-- razão escrita na 0141. O caminho da ocorrência tem seis passos numa função de ~450 linhas sem
-- teste de unidade; uma condição em cada um seria seis chances de esquecer uma, e esquecer não dá
-- erro — dá ocorrência fantasma de EMB, botão "Resolvido" num aviso de EMB ou o aviso reenviado a
-- cada 5 minutos. A linha do cursor ainda sai com avaliavel = false: se o bloco do topo for
-- removido por engano, a primeira guarda do caminho antigo pula a linha em vez de abrir ocorrência.
--
-- ⚠️ A MARCA (alerta_emb_avisada) É GRAVADA EM UM LUGAR SÓ, e por UM critério só: algo entrou na
--   fila. Ninguém alcançável (responsável sem conta vinculada) NÃO grava: quando a pessoa vincular
--   a conta, o aviso sai; o custo de esperar é uma consulta a cada 5 min, e não há envio duplicado.
--   É exatamente o critério do resumo diário, sem exceção nenhuma.
--   ⚠️ CORRIGIDO EM 14/10/2026: havia aqui um segundo caso — "a EMB fechou sem nenhuma divergência"
--   —, necessário porque a EMB limpa não mandava mensagem e precisava ser marcada de algum jeito.
--   Com a decisão 5 corrigida (toda EMB que fecha manda mensagem), esse caso DESAPARECEU: toda EMB
--   fechada enfileira, logo toda EMB fechada e alcançável recebe a marca pelo caminho normal.
-- ---------------------------------------------------------------------------------------------
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
          select null, c.usuario_id, c.canal, 'resumo', t.modulo, v_dados, false, 'usuario'
            from public.alerta_contas c
            join public.usuarios u on u.id = c.usuario_id and u.ativo
           where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
             and public.usuario_tem_permissao(c.usuario_id, t.modulo, 'administrar')
           order by c.usuario_id, c.canal;
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
          select null, c.usuario_id, c.canal, 'emb', t.modulo, v_dados, false, 'usuario'
            from public.alerta_contas c
            join public.usuarios u on u.id = c.usuario_id and u.ativo
           where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
             and public.usuario_tem_permissao(c.usuario_id, t.modulo, 'administrar')
           order by c.usuario_id, c.canal;
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
      -- AGORA, que esteja ATIVO e que administre O MÓDULO DA REGRA (t.modulo, desde a 0149; era
      -- 'shopfloor' fixo). Mesma transação da decisão: ou as
      -- duas coisas ficam, ou nenhuma. `avisar_pessoas = false` = ninguém no privado.
      if t.avisar_pessoas then
        insert into public.alerta_envios
          (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
        select o.id, c.usuario_id, c.canal, v_tipo, t.modulo, v_dados, v_tipo in ('alerta', 'lembrete'), 'usuario'
          from public.alerta_contas c
          join public.usuarios u on u.id = c.usuario_id and u.ativo
         where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
           -- responsável precisa administrar O MÓDULO DA REGRA agora (spec 2026-09-18, decisão 5;
           -- por módulo desde a 0149)
           and public.usuario_tem_permissao(c.usuario_id, t.modulo, 'administrar')
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

-- A assinatura é a MESMA da 0149, então `create or replace` preserva a ACL. Os dois comandos são
-- reemitidos de propósito (convenção da 0113: grants explícitos, e rodar de novo não muda nada).
revoke all on function public.alerta_avaliar(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb, jsonb) to service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
