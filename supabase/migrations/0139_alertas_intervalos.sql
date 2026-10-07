-- =============================================================
-- ALERTAS — JANELA POR BLOCOS DE TURNO
-- Spec: docs/superpowers/specs/2026-10-06-alerta-por-horario-design.md
--
-- Aplica POR CIMA da 0113/0115/0136/0137 (a 0113 NÃO é editada). Idempotente: rodar de novo não
-- quebra (create ... if not exists, drop ... if exists antes de recriar, add column if not exists).
--
-- O gestor cadastra os intervalos do turno (ex.: 07:00-12:00 e 13:30-17:30) e um passo. O APP
-- calcula qual bloco fechou (src/modules/alertas/domain/intervalos.ts) e manda os instantes
-- prontos; o banco NÃO faz aritmética de horário: só guarda os intervalos como time e conta bipes
-- entre dois instantes que recebe.
--
-- O arquivo tem duas metades: primeiro o ESQUEMA (o check da janela nova, a tabela filha dos
-- intervalos e a coluna bloco_reportado); depois a LÓGICA (alerta_taxas e alerta_avaliar), com
-- cabeçalho próprio declarando diferença por diferença.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0139_alertas_intervalos.sql
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- janela_tipo aceita 'intervalos' ----------
-- O check de coluna da 0113 recebeu o nome automático alerta_regras_janela_tipo_check.
alter table public.alerta_regras drop constraint if exists alerta_regras_janela_tipo_check;
alter table public.alerta_regras
  add constraint alerta_regras_janela_tipo_check
  check (janela_tipo in ('tempo', 'bipes', 'op', 'intervalos'));

-- A janela por blocos é só da taxa de aprovação, e o janela_valor guarda o PASSO em minutos.
-- (O check da 0113 janela_valor > 0 para tipos diferentes de 'op' já cobre 'intervalos'.)
alter table public.alerta_regras drop constraint if exists alerta_regras_intervalos_check;
alter table public.alerta_regras
  add constraint alerta_regras_intervalos_check
  check (janela_tipo <> 'intervalos' or (tipo = 'aprovacao' and janela_valor >= 15));

-- ---------- os intervalos do turno ----------
create table if not exists public.alerta_regra_intervalos (
  id       uuid primary key default gen_random_uuid(),
  regra_id uuid not null references public.alerta_regras(id) on delete cascade,
  inicio   time not null,
  fim      time not null,
  constraint alerta_regra_intervalos_ordem check (fim > inicio),
  -- 15 minutos é o passo mínimo; intervalo menor que isso deixaria o passo sem valor válido.
  constraint alerta_regra_intervalos_minimo check (fim - inicio >= interval '15 minutes')
);

create index if not exists alerta_regra_intervalos_regra_idx
  on public.alerta_regra_intervalos (regra_id, inicio);

alter table public.alerta_regra_intervalos enable row level security;

-- Mesmo gate da tabela mãe (alerta_regras): shopfloor.administrar, com DOIS argumentos (permissão
-- do módulo, não a global) e dentro de (select ...) para o planner avaliar uma vez (padrão 0096).
-- Diferença da mãe, de propósito: aqui há policy de DELETE. A regra é excluída de forma lógica,
-- mas os intervalos dela são editáveis (o gestor remove/troca um intervalo ao ajustar o turno).
drop policy if exists alerta_regra_intervalos_select_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_select_admin on public.alerta_regra_intervalos
  for select using ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_insert_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_insert_admin on public.alerta_regra_intervalos
  for insert with check ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_update_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_update_admin on public.alerta_regra_intervalos
  for update using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_delete_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_delete_admin on public.alerta_regra_intervalos
  for delete using ((select tem_permissao('shopfloor', 'administrar')));

revoke all on public.alerta_regra_intervalos from public, anon;
grant select, insert, update, delete on public.alerta_regra_intervalos to authenticated;
grant select, insert, update, delete on public.alerta_regra_intervalos to service_role;

-- ---------- o bloco já avisado ----------
-- Quem comanda a insistência nesta janela: a mensagem sai quando o bloco avaliado é MAIS NOVO que
-- este. Null = nenhum bloco avisado ainda. Não usa lembrete_min.
alter table public.alerta_ocorrencias
  add column if not exists bloco_reportado timestamptz;

-- =============================================================
-- A LÓGICA: o ramo do bloco em alerta_taxas, a decisão por bloco em alerta_avaliar
--
-- ⚠️ ONDE A CONTA DE HORÁRIO MORA: em src/modules/alertas/domain/intervalos.ts, NÃO aqui. O banco
-- recebe os dois instantes do bloco PRONTOS e só conta os bipes entre eles. Ladrilhar o intervalo a
-- partir do passo, resolver o fuso America/Sao_Paulo num servidor que roda em UTC e decidir "só o
-- bloco que fechou hoje" são contas que erram em silêncio — e no TS elas têm 100+ testes rodando em
-- quatro fusos, enquanto SQL aqui não tem teste de unidade nenhum. É o mesmo padrão que esta função
-- já usa com p_canal_discord (o id do canal mora no SERVIDOR, não no banco —
-- src/modules/alertas/infra/repositorio-servico.ts). Nenhum now(), current_date ou `at time zone`
-- aparece nesta migração de propósito: se a vontade aparecer, o cálculo está no lugar errado.
--
-- O CONTRATO NOVO: alerta_avaliar(p_canal_discord text, p_blocos jsonb). p_blocos é
-- {"<regra_id>": {"inicio": "<iso>", "fim": "<iso>"}} e traz SÓ as regras de janela 'intervalos'
-- com bloco FECHADO agora. Regra de janela 'intervalos' AUSENTE do mapa é PULADA na rodada.
--
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÕES EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- Os corpos foram extraídos da versão VIVA de cada uma e transformados ponto a ponto; o `diff -u`
-- entre a versão viva e a daqui tem SÓ estas diferenças. Quem revisar pode conferir do mesmo jeito.
--
-- public.alerta_taxas — a versão viva é a da 0115 (a 0136 NÃO a recriou, de propósito) — 2 diferenças:
--   1. a assinatura ganha p_bloco_inicio/p_bloco_fim (timestamptz, os dois com default null);
--   2. um quarto ramo no `union all`: a janela 'intervalos', os bipes com status entre os dois
--      instantes, com o MESMO filtro de PMO dos outros três ramos.
--   NADA MAIS muda: os ramos 'tempo', 'bipes' e 'op', o `set jit = off`, o security definer e o
--   search_path ficam iguais.
--
-- public.alerta_avaliar — a versão viva é a da 0136 (a 0137 não a recriou) — 10 diferenças:
--   1. a assinatura ganha `p_blocos jsonb default null` ao fim;
--   2. ramo 'aprovacao': um `cross join lateral` que lê o bloco da regra em p_blocos, as duas
--      colunas novas no select (bl.bloco_inicio, bl.bloco_fim) e os dois argumentos novos no
--      alerta_taxas, passados por NOME;
--   3. ramo 'aprovacao': no `where`, regra de janela 'intervalos' sem bloco no mapa não entra;
--   4. ramo 'tempo': duas colunas `null::timestamptz`, só para casar o `union all`;
--   5. ramo 'defeito': idem;
--   6. insert da abertura: grava a coluna nova `bloco_reportado`;
--   7. update do "normalizou": grava `bloco_reportado`;
--   8. a insistência: na janela 'intervalos' o lembrete sai da comparação do bloco com
--      `bloco_reportado`, não de `lembrete_min` x `ultimo_envio_em`;
--   9. update do "continua fora do limite": grava `bloco_reportado` quando (e só quando) envia;
--  10. `dados`: as chaves 'bloco_inicio' e 'bloco_fim'.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, o v_abaixo, a carência
--   da reabertura, a fila de pessoas e a fila do canal ficam byte a byte iguais. As outras TRÊS
--   janelas passam pelo mesmo caminho de antes: p_blocos não tem a chave delas, os dois instantes
--   saem nulos, a condição nova do `where` é verdadeira por `rg.janela_tipo <> 'intervalos'`, o
--   `v_lembrete` cai no `else` idêntico ao de hoje e os `case` do bloco_reportado mantêm o valor.
--
-- ⚠️ OS QUATRO CAMINHOS QUE ENVIAM GRAVAM `bloco_reportado`, E SÓ ELES: abertura, normalização,
-- insistência e REABERTURA (a 4ª, que a 0122 acrescentou e continua valendo nesta janela — a
-- carência vem de alerta_carencia_min, que no 'intervalos' cai no `else 60` minutos). Gravar num
-- caminho que NÃO envia — em especial no `continue` do mínimo de bipes — faria o bloco seguinte
-- parecer "já avisado" e o alerta dele desapareceria em silêncio. É o defeito mais fácil de
-- introduzir aqui e o mais difícil de notar.
--
-- ⚠️ AS ASSINATURAS ANTIGAS SAEM (os dois `drop function if exists`, depois dos `create`). Nas
-- duas funções o parâmetro novo é o ÚLTIMO e tem default, então a assinatura nova atende quem
-- chama sem ele — o alerta_previa, que chama alerta_taxas com 4 argumentos, e o app/cron/webhook,
-- que chamam alerta_avaliar com 1. Mas `create or replace` não substitui função de assinatura
-- diferente: sem o drop, a velha e a nova COEXISTIRIAM, e a chamada curta ou fica ambígua
-- ("function ... is not unique" — o acidente que o cabeçalho da 0122 documenta) ou cai na VELHA,
-- que não conhece bloco nenhum. Nos dois casos é defeito, e o segundo é silencioso. Mesmo cuidado
-- do alerta_ops na 0136.
-- =============================================================

-- ---------- 1. alerta_taxas(): o ramo 'intervalos' (os bipes do bloco) ----------
-- Função INTERNA (sem grant): quem chama é o alerta_avaliar e o alerta_previa, que já fazem o gate.
create or replace function public.alerta_taxas(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pmos text[],
  p_bloco_inicio timestamptz default null, p_bloco_fim timestamptz default null
)
returns table (posto text, aprovados int, reprovados int, pmo text, op text)
language sql
stable
security definer
set search_path = public
-- cron a cada 5 min: o JIT compilaria o plano toda vez (~30 ms) para uma consulta de milissegundos
set jit = off
as $func$
  select p.posto,
         coalesce(c.aprovados, 0)::int,
         coalesce(c.reprovados, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    left join lateral (
      select public.alerta_op_inicio(p.posto, u.pmo, u.op) as inicio where u.op is not null
    ) f on true
    left join lateral (
      select count(*) filter (where lower(y.status) = 'aprovado')  as aprovados,
             count(*) filter (where lower(y.status) = 'reprovado') as reprovados
        from (
          -- janela 'tempo': os bipes do posto nos últimos N minutos, de todas as OPs (das PMOs da regra)
          select r.status
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and lower(r.status) in ('aprovado', 'reprovado')
             and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
          union all
          -- janela 'bipes': os N últimos bipes COM status do posto, olhando no máximo 30 dias
          (select r.status
             from sf_registros r
            where p_janela_tipo = 'bipes'
              and r.posto = p.posto
              and lower(r.status) in ('aprovado', 'reprovado')
              and r.data_hora >= now() - interval '30 days'
              and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
            order by r.data_hora desc
            limit p_janela_valor)
          union all
          -- janela 'op': todos os bipes do posto naquela OP (a OP já saiu das PMOs da regra); PMO
          -- aparada dos dois lados ('PMOX' e ' PMOX ' são a mesma OP). O corte no primeiro bipe da
          -- OP não muda o resultado (antes dele não há bipe dela) e evita varrer o histórico do posto.
          select r.status
            from sf_registros r
           where p_janela_tipo = 'op'
             and r.posto = p.posto
             and r.data_hora >= f.inicio
             and btrim(r.pmo) = u.pmo and r.op = u.op
             and lower(r.status) in ('aprovado', 'reprovado')
          union all
          -- janela 'intervalos': os bipes do posto DENTRO DO BLOCO que o app calculou. Os dois
          -- instantes chegam prontos (ver o aviso acima); aqui só se conta o que está entre eles.
          --
          -- ⚠️ A FRONTEIRA É `>=` NO INÍCIO E `<` NO FIM: o bipe das 08:00:00 pertence ao bloco
          -- 08:00–09:00, e não ao 07:00–08:00. Com `<=` no fim ele entraria nos DOIS blocos e as
          -- duas taxas sairiam erradas — e a errada é justamente a que dispara (ou não) o alerta.
          --
          -- Bloco não recebido (os dois parâmetros nulos) conta ZERO linhas: `data_hora >= null` e
          -- `data_hora < null` são NULOS, e nulo não é verdadeiro. Não é daqui, porém, que vem o
          -- "pular a regra" — quem pula é o alerta_avaliar, ANTES de chamar esta função. Contar
          -- zero deixaria a regra abaixo do mínimo de bipes, que também não decide nada, mas por
          -- outro motivo; os dois caminhos são seguros e o declarado é o do avaliar.
          --
          -- O filtro de PMO é o MESMO dos outros três ramos, e não é enfeite: uma regra com PMO
          -- escolhida e janela por blocos contaria os bipes de OUTRAS PMOs sem ele — número errado,
          -- em silêncio. PMO aparada dos dois lados ('PMOX' e ' PMOX ' são a mesma ordem).
          --
          -- O índice (posto, data_hora desc) da 0114 atende esta faixa do mesmo jeito que atende a
          -- janela 'tempo' (é a mesma forma de consulta, só com teto além do piso): não há índice
          -- novo a criar.
          select r.status
            from sf_registros r
           where p_janela_tipo = 'intervalos'
             and r.posto = p.posto
             and r.data_hora >= p_bloco_inicio
             and r.data_hora <  p_bloco_fim
             and lower(r.status) in ('aprovado', 'reprovado')
             and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
        ) y
    ) c on true
$func$;

-- ⚠️ O `revoke` ABAIXO NÃO É OPCIONAL: a assinatura é NOVA, então para o Postgres é outra função, e
-- função recém-criada nasce com EXECUTE para o PUBLIC (proacl NULL). Esta é uma security definer que
-- varre sf_registros: sem o revoke, `anon` — a chave pública do PostgREST, que qualquer um lê no
-- HTML — passa a poder contar os bipes de qualquer posto. É o furo que a 0119 existiu para fechar.
-- Cole o arquivo INTEIRO no SQL Editor; não rode só até o `$func$;` e pare.
revoke all on function public.alerta_taxas(text[], text, int, text[], timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- A assinatura de 4 parâmetros sai de cena (ver o aviso do cabeçalho). Vai DEPOIS do create: entre
-- as duas instruções a chamada de 4 argumentos ficaria ambígua, e é por isso que elas moram na
-- mesma migração — o `-1` do psql aplica tudo numa transação só.
drop function if exists public.alerta_taxas(text[], text, int, text[]);

-- O aviso da janela duplicada, que a 0136 pôs no comentário da função, MORRE COM O DROP acima
-- (comentário é de assinatura, não de nome). Reposto aqui, na assinatura nova, com o acréscimo da
-- janela 'intervalos' — que a alerta_ops NÃO tem, e a consequência está dita.
comment on function public.alerta_taxas(text[], text, int, text[], timestamptz, timestamptz) is
  'Aprovados/reprovados por posto na janela da regra. ⚠️ A JANELA ESTÁ EM DOIS LUGARES: '
  'public.alerta_ops(..., p_so_com_status => true) repete os mesmos ramos (tempo/bipes/op) para '
  'listar as OPs do alerta (0136). Mexeu aqui, mexa lá. Diferença CONHECIDA entre as duas, na '
  'janela ''bipes'': o corte é "order by data_hora desc limit N" e, com empate de data_hora na '
  'fronteira do N, qual das empatadas entra é indefinido — cada função roda o corte por conta, '
  'então podem pegar linhas diferentes e a lista de OPs sair levemente diferente da amostra que '
  'gerou o número. Não afeta a decisão do alerta (o número sai daqui); afeta só o texto. '
  '⚠️ A janela ''intervalos'' (0139) existe AQUI e NÃO na alerta_ops: o alerta por blocos de turno '
  'sai com dados.ops = [] e a mensagem dele não diz a OP. Acrescentar o ramo lá pede os dois '
  'instantes do bloco na assinatura dela também.';

-- ---------- 2. alerta_avaliar(): a decisão por bloco ----------
-- Recriada da 0136 (a versão viva) com as 10 diferenças declaradas no cabeçalho, e só elas.
create or replace function public.alerta_avaliar(
  p_canal_discord text default null, p_blocos jsonb default null
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

revoke all on function public.alerta_avaliar(text, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb) to service_role;

-- A assinatura de 1 parâmetro sai de cena (ver o aviso do cabeçalho). Depois do create, pelo mesmo
-- motivo do alerta_taxas.
drop function if exists public.alerta_avaliar(text);

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho: sem isto, a chamada da RPC continua
-- batendo na assinatura antiga (que já não existe) e a tela de alertas quebra — foi o que
-- aconteceu depois da 0137. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
