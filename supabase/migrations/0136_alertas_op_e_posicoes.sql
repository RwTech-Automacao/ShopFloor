-- =============================================================
-- ALERTAS — DIZER DE QUAL ORDEM (PMO/OP) E, NO DEFEITO, EM QUAIS POSIÇÕES
--
-- ⚠️ NUMERAÇÃO: a main para na 0127, mas 0128–0135 já estão commitadas em branches abertas
-- (feat/posto-almoxarifado 0128–0133, feat/sincronizacao-central 0134,
-- feat/etiquetas-inventario-rotativo 0135). A 0136 era a próxima livre quando este arquivo nasceu.
-- A ordem de merge entre as branches ainda pode mudar: CONFIRA a numeração antes de aplicar.
--
-- Aplica POR CIMA da 0113/0115/0122/0123 (nenhuma delas é editada). Idempotente: rodar de novo não
-- quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0136_alertas_op_e_posicoes.sql
--
-- O PROBLEMA: quem recebe o alerta no celular via o posto e o número que estourou o limite, mas não
-- a ordem de produção — e sem ela não há onde ir olhar. No alerta de defeito repetido faltava também
-- a POSIÇÃO na placa (o designador: R12, C47), que já está gravada em sf_registros.posicao desde a
-- 0028 e nunca era lida pelos alertas.
--
-- A DECISÃO DE PRODUTO: "a OP do alerta" não é um valor único. Uma janela de 60 minutos pode
-- atravessar 3 OPs, e escolher uma delas (a última, ou a de mais bipes) inventaria informação. Então
-- o alerta passa a levar TODAS as OPs da janela, numa lista (`dados.ops`), e quem formata é o TS.
-- As colunas `pmo`/`op` (escalares, preenchidas só na janela 'op') e as chaves `dados.pmo`/`dados.op`
-- ficam COMO ESTÃO: o texto da janela ("na OP PMO/OP") depende delas.
--
-- ONDE A FORMATAÇÃO MORA: aqui só saem números, códigos e listas cruas. Agrupar a posição repetida
-- em "R12 (3x)", ordenar, cortar no limite de 2000 caracteres do Discord — tudo isso é
-- src/modules/alertas/domain/mensagens.ts. Mesma divisão da 0113/0115.
--
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÕES EM PRODUÇÃO QUE ESTA MIGRAÇÃO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- Os corpos foram extraídos da 0123 (a versão viva) e transformados ponto a ponto; o `diff -u` entre
-- a versão da 0123 e a daqui tem SÓ estas diferenças. Quem revisar pode conferir do mesmo jeito.
--
-- public.alerta_avaliar(text)  — 8 diferenças:
--   1. ramo 'aprovacao': duas colunas novas no select ('{}'::text[] as posicoes, po.ops) e um
--      `cross join lateral public.alerta_ops(..., p_so_com_status => true)`;
--   2. ramo 'tempo': idem, com `p_so_com_status => false` (a janela do alerta_tempos não filtra
--      status — ver a ATENÇÃO mais abaixo);
--   3. ramo 'defeito': as colunas posicoes/ops saem do alerta_defeitos; o ramo do `union all` que
--      traz a ocorrência viva que saiu da janela reaproveita as OPs já gravadas (coalesce(oc.ops));
--   4. insert da ocorrência: grava a coluna nova `ops`;
--   5. update do "normalizou": `ops = coalesce(nullif(t.ops, '[]'::jsonb), ops)`;
--   6. update do "continua fora do limite": a mesma linha;
--   7. `dados` comum: chave 'ops';
--   8. `dados` do defeito: chave 'posicoes'.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, o cálculo de v_abaixo, a
--   carência da reabertura, o lembrete, a fila de pessoas e a fila do canal ficam byte a byte iguais.
--
-- public.alerta_resolver_interno(uuid, uuid, boolean) — 1 diferença:
--   o `dados` do envio 'resolvido' ganha 'pmo', 'op' e 'ops' (as colunas já existiam na ocorrência e
--   nunca eram repassadas). As três exceções (NAO_DESTINATARIO, OCORRENCIA_ENCERRADA, o
--   usuario_tem_permissao do DESTINATÁRIO) ficam iguais.
--
-- public.alerta_defeitos(text[], int, text[]) — assinatura muda (returns table ganha posicoes e
--   ops), então vai com `drop function if exists` antes. É função de leitura pura: não decide nada.
--
-- NÃO SÃO RECRIADAS, de propósito: alerta_taxas e alerta_tempos. São elas que calculam a taxa e a
--   cadência que a fábrica usa, e recriá-las só para devolver uma coluna a mais seria arriscar um
--   número em produção por conveniência. As OPs da janela saem de uma função NOVA (alerta_ops), que
--   por ser aditiva não pode mudar nenhum resultado existente. O preço é que a lógica das três
--   janelas ('tempo', 'bipes', 'op') aparece em dois lugares: se a janela do alerta_taxas mudar, a
--   do alerta_ops tem que mudar junto. Está escrito aqui porque é o risco real desta escolha — e,
--   para o aviso não ficar só neste arquivo, o trecho F põe um `comment on function` nas duas
--   apontando para a alerta_ops. `comment on` não mexe em corpo nem em permissão: elas seguem
--   intactas.
--   ATENÇÃO: as duas NÃO olham os mesmos bipes. O alerta_taxas conta só 'aprovado'/'reprovado'; o
--   alerta_tempos conta TODOS os bipes do posto. Por isso a alerta_ops recebe `p_so_com_status`: a
--   regra de aprovação pede a janela com status e a de tempo pede a janela sem. Sem esse parâmetro,
--   posto de passagem (status '', o default da 0028) alertava por lentidão com a lista de OPs vazia.
--
-- PERMISSÃO: nenhuma função ganha ou perde checagem. O `usuario_tem_permissao(uuid, text, text)` do
--   alerta_avaliar e do alerta_resolver_interno é o de TRÊS argumentos (usuário + módulo +
--   permissão), que é o certo para checar o DESTINATÁRIO. O `tem_permissao` de UM argumento anula o
--   RBAC e não aparece em lugar nenhum desta migração.
-- =============================================================

-- ---------- A. alerta_ocorrencias.ops: as OPs da janela, para o "resolvido" e o "normalizou" ----------
-- O envio 'resolvido' nasce no alerta_resolver_interno, longe da avaliação: ele só tem a ocorrência
-- na mão. Sem guardar a lista aqui, a mensagem de resolução seria a única sem dizer a ordem.
alter table public.alerta_ocorrencias
  add column if not exists ops jsonb;

comment on column public.alerta_ocorrencias.ops is
  'OPs da janela em que a ocorrência foi medida: jsonb array de {pmo, op}. Lista vazia = nenhum bipe '
  'com OP na janela. As colunas pmo/op (escalares) continuam só para a janela do tipo op.';

-- ---------- B. alerta_ops(): todas as OPs da janela do posto ----------
-- Função INTERNA e NOVA. Espelha a janela de quem mede: 'tempo' = os bipes dos últimos N minutos;
-- 'bipes' = os N últimos bipes (olhando no máximo 30 dias); 'op' = a OP em andamento do posto.
-- Devolve um jsonb array de {pmo, op} DISTINTOS, ordenado, e '[]' quando não há nenhum bipe com OP
-- na janela (posto parado, ou OP em branco no registro).
-- PMO aparada dos dois lados: 'PMOX' e ' PMOX ' são a mesma ordem (igual ao resto do módulo).
--
-- p_so_com_status: QUAIS bipes contam como "dentro da janela". É que as duas funções que medem não
-- olham os mesmos bipes:
--   alerta_taxas  conta só 'aprovado'/'reprovado' (é uma TAXA: sem status não há o que aprovar) →
--                 a regra de aprovação chama com true;
--   alerta_tempos mede a cadência de TODOS os bipes do posto, de qualquer status (é um RELÓGIO: o
--                 bipe aconteceu) → a regra de tempo chama com false.
-- Sem essa distinção, num POSTO DE PASSAGEM — status '', o default da 0028, que é o caso de
-- Printer, Montagem PTH, Manutenção e a entrada do Burn-in — o alerta de lentidão disparava e a
-- lista de OPs vinha VAZIA: a cadência existia, mas a mensagem não dizia a ordem. Mesma coisa, mais
-- brando, no posto de status misto (entrada de Burn-in '' + saída 'Aprovado'): a cadência conta as
-- duas pontas e a lista só traria as saídas.
-- POR QUE UM PARÂMETRO, e não um ramo/função só para o tempo: a diferença entre os dois chamadores é
-- ESTA linha; as três janelas, o filtro de PMO, o aparo da PMO e o descarte de OP vazia são os
-- mesmos. Uma segunda função duplicaria a janela uma terceira vez (já são duas) e seria mais um
-- lugar para esquecer de mudar junto. Os dois chamadores passam o valor por NOME, para o leitor do
-- alerta_avaliar ver qual janela está pedindo sem ter que vir ler esta função.
-- A janela 'bipes' também respeita o parâmetro (é o mesmo conceito de "bipe que conta"), ainda que
-- hoje nenhuma regra de tempo chegue aqui com ela: o check da 0115 RECUSA tipo 'tempo' com janela
-- 'bipes' (e o alerta_tempos nem tem ramo 'bipes'). Se um dia for liberada, a lista de OPs já
-- acompanha, em vez de voltar vazia de novo.
--
-- Assinatura nova (ganhou p_so_com_status) → a de 4 parâmetros sai antes, senão as duas conviveriam
-- e a chamada com 4 argumentos ficaria ambígua (a nova resolveria por default) num banco onde uma
-- versão anterior desta migração já rodou.
drop function if exists public.alerta_ops(text[], text, int, text[]);
create or replace function public.alerta_ops(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pmos text[], p_so_com_status boolean
)
returns table (posto text, ops jsonb)
language sql
stable
security definer
set search_path = public
-- cron a cada 5 min: o JIT compilaria o plano toda vez para uma consulta de milissegundos
set jit = off
as $func$
  select p.posto, coalesce(a.ops, '[]'::jsonb)
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    -- Nenhum `alerta_op_inicio` aqui: o ramo 'op' sai do próprio `u` (a OP em andamento), e o
    -- primeiro bipe dela só serviria para cortar a leitura de uma varredura que esta função não faz.
    -- O alerta_taxas precisa dele; copiar para cá seria chamar um CTE recursivo sobre sf_registros
    -- de graça, a cada avaliação, para um valor que ninguém lê.
    left join lateral (
      select jsonb_agg(jsonb_build_object('pmo', z.pmo, 'op', z.op) order by z.pmo, z.op) as ops
        from (
          -- `union` (e não `union all`) já tira a repetição entre os três ramos e dentro de cada um
          select btrim(r.pmo) as pmo, btrim(r.op) as op
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and (not p_so_com_status or lower(r.status) in ('aprovado', 'reprovado'))
             and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
          union
          select btrim(b.pmo), btrim(b.op)
            from (
              select r.pmo, r.op
                from sf_registros r
               where p_janela_tipo = 'bipes'
                 and r.posto = p.posto
                 and (not p_so_com_status or lower(r.status) in ('aprovado', 'reprovado'))
                 and r.data_hora >= now() - interval '30 days'
                 and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
               order by r.data_hora desc
               limit p_janela_valor
            ) b
          union
          select u.pmo, btrim(u.op)
           where p_janela_tipo = 'op' and u.op is not null
        ) z
       where coalesce(z.op, '') <> ''
    ) a on true
$func$;

-- ⚠️ O `revoke` ABAIXO NÃO É DECORAÇÃO, NÃO APLIQUE A MIGRAÇÃO SEM ELE. Função recém-criada nasce
-- com EXECUTE para o PUBLIC (é o default do Postgres, e `pg_proc.proacl` fica NULL), e esta é uma
-- `security definer` que varre sf_registros inteira: sem o revoke, `anon` — a chave pública do
-- PostgREST, que qualquer um lê no HTML — passa a poder listar as OPs de qualquer posto. É
-- exatamente o furo que a 0119 existiu só para fechar. Rodar este arquivo em pedaços pelo SQL
-- Editor é o jeito fácil de deixar o revoke para trás: cole o arquivo INTEIRO.
revoke all on function public.alerta_ops(text[], text, int, text[], boolean)
  from public, anon, authenticated, service_role;

-- ---------- C. alerta_defeitos(): agora com as POSIÇÕES e as OPs de cada código ----------
-- Função INTERNA. Mesmas linhas de antes (reprovadas, com código de defeito, na janela, das PMOs da
-- regra) e a MESMA contagem; o que entra é:
--   posicoes = UMA entrada por linha registrada, com a repetição preservada (sf_registros.posicao,
--              0028). A repetição é informação: é ela que o TS agrupa em "R12 (3x)". Posição em
--              branco fica fora (o `filter`), para a mensagem não listar vazio.
--   ops      = as OPs distintas daquele defeito naquele posto, no mesmo formato do alerta_ops.
-- A ordem de `posicoes` é a da varredura e não importa: quem conta e ordena é o TS.
-- Assinatura nova → a antiga (3 parâmetros com outro returns table) sai antes.
drop function if exists public.alerta_defeitos(text[], int, text[]);
create or replace function public.alerta_defeitos(p_postos text[], p_janela_min int, p_pmos text[])
returns table (posto text, defeito text, ocorrencias int, posicoes text[], ops jsonb)
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  select r.posto,
         btrim(r.codigo_defeito),
         count(*)::int,
         coalesce(array_agg(btrim(r.posicao)) filter (where btrim(r.posicao) <> ''), '{}'::text[]),
         coalesce(
           jsonb_agg(distinct jsonb_build_object('pmo', btrim(r.pmo), 'op', btrim(r.op)))
             filter (where btrim(r.op) <> ''),
           '[]'::jsonb)
    from sf_registros r
   where r.posto = any (p_postos)
     and r.data_hora >= now() - make_interval(mins => p_janela_min)
     and lower(r.status) = 'reprovado'
     and btrim(r.codigo_defeito) <> ''
     and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
   group by r.posto, btrim(r.codigo_defeito)
$func$;

-- ⚠️ O `revoke` ABAIXO É OBRIGATÓRIO, pelo mesmo motivo do alerta_ops — e aqui o risco é MAIOR,
-- porque esta função JÁ EXISTE em produção FECHADA e o `drop` acima joga a ACL dela no lixo. Um
-- `create or replace` preservaria as permissões; um `drop` + `create` recria do zero, e do zero
-- significa EXECUTE para o PUBLIC. Medido: aplicando só o trecho acima, sem este revoke,
-- `pg_proc.proacl` de alerta_defeitos fica NULL e
-- `has_function_privilege('anon', 'public.alerta_defeitos(text[],int,text[])', 'EXECUTE')` volta
-- `t` — uma `security definer` que varre sf_registros inteira, aberta para o `anon`. Cole o
-- arquivo INTEIRO no SQL Editor; não rode da linha do `create` até a do `$func$` e pare.
revoke all on function public.alerta_defeitos(text[], int, text[])
  from public, anon, authenticated, service_role;

-- ---------- D. alerta_avaliar(): carrega as OPs e as posições até a fila ----------
-- Recriada da 0123 com as 8 diferenças declaradas no cabeçalho, e só elas.
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
               rg.taxa_minima::numeric as limite,
               '{}'::text[] as posicoes, po.ops
          from public.alerta_regras rg
          cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                 public.alerta_pmos_normalizar(rg.pmos)) tx
          -- Mesma janela do alerta_taxas acima: só os bipes com status (é uma taxa).
          cross join lateral public.alerta_ops(array[tx.posto], rg.janela_tipo, rg.janela_valor,
                                               public.alerta_pmos_normalizar(rg.pmos),
                                               p_so_com_status => true) po
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
               rg.limite_tempo_seg::numeric,
               '{}'::text[], po.ops
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
               df.posicoes, df.ops
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
           valor_ultimo, amostras, aprovados, reprovados, aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto, t.defeito,
                case when t.janela_tipo = 'op' then btrim(t.pmo) end,
                case when t.janela_tipo = 'op' then t.op end,
                coalesce(t.ops, '[]'::jsonb),
                case when t.tipo = 'aprovacao' then t.valor end,
                case when t.tipo = 'aprovacao' then t.valor end,
                t.valor, t.valor, t.amostras, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif not v_abaixo then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             ops = coalesce(nullif(t.ops, '[]'::jsonb), ops),
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

revoke all on function public.alerta_avaliar(text) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text) to service_role;

-- ---------- E. alerta_resolver_interno(): o "resolvido" também diz a ordem ----------
-- Recriada da 0123 com a 1 diferença declarada no cabeçalho, e só ela.
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
                              'resolvida_em', o.resolvida_em,
                              'pmo', o.pmo, 'op', o.op, 'ops', coalesce(o.ops, '[]'::jsonb)),
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

-- ---------- F. O aviso da janela duplicada, DENTRO do banco ----------
-- A escolha de não recriar alerta_taxas/alerta_tempos (ver cabeçalho) deixa a lógica das janelas em
-- dois lugares. O cabeçalho deste arquivo avisa — mas quem for mexer na janela vai editar o
-- alerta_taxas/alerta_tempos (na 0115, ou já no \df do banco) e não tem motivo nenhum para abrir a
-- 0136. Então o aviso fica também no COMENTÁRIO das duas funções, que aparece no `\df+` e no Studio.
-- Só comentário: as funções NÃO são recriadas (nem o corpo, nem a ACL — `comment on` não mexe em
-- permissão).
comment on function public.alerta_taxas(text[], text, int, text[]) is
  'Aprovados/reprovados por posto na janela da regra. ⚠️ A JANELA ESTÁ EM DOIS LUGARES: '
  'public.alerta_ops(..., p_so_com_status => true) repete os mesmos três ramos (tempo/bipes/op) '
  'para listar as OPs do alerta (0136). Mexeu aqui, mexa lá. Diferença CONHECIDA entre as duas, na '
  'janela ''bipes'': o corte é "order by data_hora desc limit N" e, com empate de data_hora na '
  'fronteira do N, qual das empatadas entra é indefinido — cada função roda o corte por conta, '
  'então podem pegar linhas diferentes e a lista de OPs sair levemente diferente da amostra que '
  'gerou o número. Não afeta a decisão do alerta (o número sai daqui); afeta só o texto.';

comment on function public.alerta_tempos(text[], text, int, int, text[]) is
  'Cadência do posto (tempo médio entre bipes seguidos), de TODOS os bipes, de qualquer status. '
  '⚠️ A JANELA ESTÁ EM DOIS LUGARES: public.alerta_ops(..., p_so_com_status => false) repete os '
  'mesmos ramos para listar as OPs do alerta (0136) — o `false` existe porque esta função não '
  'filtra status, e exigir status deixaria a lista vazia em posto de passagem (status '''', o '
  'default da 0028: Printer, Montagem PTH, Manutenção, entrada do Burn-in). Mexeu aqui, mexa lá. '
  'Mesma ressalva do empate de data_hora na janela ''bipes'' descrita no comentário do '
  'alerta_taxas (hoje inofensiva aqui: esta função não tem ramo ''bipes'').';

notify pgrst, 'reload schema';
