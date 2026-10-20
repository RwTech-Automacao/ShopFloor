-- =============================================================
-- RECEBIMENTO — MÉTRICAS DO DASHBOARD (somente leitura)
-- Spec:  docs/superpowers/specs/2026-10-20-dashboard-recebimento-metricas-design.md
-- Plano: docs/superpowers/plans/2026-10-20-dashboard-recebimento-metricas.md
--
-- O QUÊ
--   rec_dashboard_metricas(...) → jsonb: Volume, Qualidade, Atraso, Tempo e Pendências NUMA chamada
--   só (mesmo molde da rec_dashboard da 0152, que NÃO é alterada: a tela atual segue igual).
--
-- A RÉGUA (decidida com o usuário em 20/10/2026)
--   * Item = linha de processos_recebimento; status 'cancelado' fica fora de tudo. Fornecedor,
--     comprador, EMB e código passam por rec_norm_texto (0152); EMB e código comparam em maiúsculas.
--   * reprovado   = status 'reprovado' OU resultado 'reprovado' (o resultado pode vir vazio em item
--                   já finalizado: o status terminal espelha o resultado).
--   * com resultado = status fora de ('aberto','em_conferencia') OU resultado preenchido.
--     Taxa de reprovação por item = reprovados / com resultado.
--   * De / Até (data_chegada, inclusivos) valem para Volume, Qualidade, Atraso e Tempo (durações).
--     NÃO valem para Pendências nem para Parados (estado atual). Os demais filtros valem para tudo.
--   * Parados: X dias em (3, 7, 15, 30), padrão 7; outro valor → PARADO_INVALIDO. (null vale 7.)
--   * "Hoje" = data de São Paulo. Semana = segunda a domingo. Eixo do mais antigo para o mais novo.
--   * Atraso = data_chegada - data_prevista (a coluna de texto `atraso` NÃO é usada).
--   * Tempo: a primeira e a última entrada na Qualidade vêm de logs (entidade 'processo', acao
--     'mudar_status', dados->>'para' = 'em_conferencia'). Recebimento = dias (de calendário, em São
--     Paulo) da chegada até a 1ª entrada; Qualidade = dias corridos (fração) da 1ª entrada até
--     finalizado_em; ambos com piso 0.
--   * Médias/medianas: 1 casa decimal; null quando não há base (a tela mostra "—", nunca zero).
--   * Rankings: top 10 (motivos: top 5), por quantidade desc e depois pelo nome (ordem estável).
--   Interpretações conservadoras onde o plano era aberto: (a) Pendências.fornecedores lista TODO
--   fornecedor com pendente (top 10 por atrasados, mesmo com 0 atrasados); (b) p_parado_dias nulo
--   vale 7; (c) "finalizado" no Tempo/Qualidade = finalizado_em preenchido.
--
-- POR QUÊ
--   Agregar no banco, uma chamada, sem puxar a tabela para o navegador (a lição do Fluxo: 12
--   requisições no carregamento). A função nova deixa a rec_dashboard intocada.
--
-- MEDIÇÃO (harness, Postgres 15 em Docker, 300 mil linhas, 50 mil com log, set role authenticated,
--   EXPLAIN ANALYZE, mediana de 3, recorte de 90 dias, ~18 mil linhas no recorte, ~6 mil abertas/em
--   conferência, ~297 mil entradas de log): ~630 ms com os índices que já existem (PK e logs
--   (entidade, entidade_id)); a META de 250 ms NÃO foi atingida. Com três índices de teste no harness
--   (processos_recebimento (data_chegada); parcial em processos_recebimento (status) where status in
--   ('aberto','em_conferencia'); parcial em logs (entidade_id, created_at) where entidade='processo' and
--   acao='mudar_status' and dados->>'para'='em_conferencia') caiu para ~410 ms. Os índices NÃO entram
--   aqui (a regra é medir no Dev com dados reais antes); esse volume (200 chegadas/dia, 300 mil linhas)
--   é muito maior que o real do Recebimento. Sem recorte de data, a tabela inteira leva ~6 s no
--   harness (a tela sempre manda De/Até: 90 dias é o padrão dela). Tentativas que PIORARAM e foram
--   descartadas: agregar o log inteiro (+500 ms) e busca por id com lateral (+250 ms).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0154_rec_dashboard_metricas.sql
--
-- Aditiva e idempotente (create or replace + grants). Corpo com $func$ (o SQL Editor não aceita
-- dois cifrões, nem em comentário); tem_permissao SEMPRE com dois argumentos. Depende da 0152
-- (rec_norm_texto) e da tabela logs.
-- =============================================================

-- Atalho da rec_norm_texto (0152) para o caminho comum: se o primeiro e o último caractere são ASCII
-- imprimíveis (código 33 a 126), nenhum é espaço de qualquer tipo, então o aparo não muda nada e o
-- regexp_replace (o custo dominante nesta função: ~4 us por chamada, 4 por linha) é dispensado.
-- Qualquer outro caso (vazio, espaço, tab, NBSP, acento na ponta) cai na rec_norm_texto: o resultado
-- é SEMPRE igual ao dela. Imutável, sem search_path (para o Postgres poder embuti-la na consulta).
create or replace function public.rec_norm_texto_rapido(p_texto text)
returns text
language sql
immutable
as $func$
  select case when ascii(left(p_texto, 1)) between 33 and 126
               and ascii(right(p_texto, 1)) between 33 and 126
              then p_texto
              else public.rec_norm_texto(p_texto) end
$func$;

create or replace function public.rec_dashboard_metricas(
  p_fornecedor  text    default null,
  p_comprador   text    default null,
  p_emb         text    default null,
  p_codigo      text    default null,
  p_de          date    default null,
  p_ate         date    default null,
  p_parado_dias integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_forn   text := rec_norm_texto(coalesce(p_fornecedor, ''));
  v_comp   text := rec_norm_texto(coalesce(p_comprador, ''));
  v_emb    text := upper(rec_norm_texto(coalesce(p_emb, '')));
  v_cod    text := upper(rec_norm_texto(coalesce(p_codigo, '')));
  v_x      integer := coalesce(p_parado_dias, 7);
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_resultado jsonb;
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_x not in (3, 7, 15, 30) then raise exception 'PARADO_INVALIDO'; end if;

  with cand as materialized (
    -- UMA leitura da tabela para tudo: os filtros que NÃO são de data, e só as linhas que alguma parte
    -- usa (as do recorte por data_chegada, mais as que estão abertas ou em conferência, que alimentam
    -- Pendências e Parados e NÃO obedecem ao recorte). As colunas aqui são cruas: o aparo de texto
    -- (regexp) só roda adiante, nas linhas que precisam dele. Medido: quatro varreduras separadas da
    -- tabela custavam ~350 ms em 300 mil linhas; esta uma custa a quarta parte.
    select p.id, p.status, p.resultado, p.fornecedor, p.numero_emb, p.codigo_material,
           p.descricao_material, p.motivo_reprovacao, p.data_chegada, p.data_prevista,
           p.finalizado_em, p.quantidade_recebida, p.quantidade_reprovada,
           ((p_de  is null or p.data_chegada >= p_de)
            and (p_ate is null or p.data_chegada <= p_ate)) as no_recorte
      from public.processos_recebimento p
     where p.status <> 'cancelado'
       and (v_forn = '' or rec_norm_texto(coalesce(p.fornecedor, '')) = v_forn)
       and (v_comp = '' or rec_norm_texto(coalesce(p.comprador, '')) = v_comp)
       and (v_emb  = '' or upper(rec_norm_texto(coalesce(p.numero_emb, ''))) = v_emb)
       and (v_cod  = '' or upper(rec_norm_texto(coalesce(p.codigo_material, ''))) = v_cod)
       and (p.status in ('aberto', 'em_conferencia')
            or ((p_de  is null or p.data_chegada >= p_de)
                and (p_ate is null or p.data_chegada <= p_ate)))
  ),
  rec as materialized (
    -- O recorte por data_chegada (inclusivo). Sem De nem Até, é tudo (linhas sem data inclusive).
    select c.id, c.status, c.data_chegada, c.data_prevista, c.finalizado_em,
           c.descricao_material, c.quantidade_recebida, c.quantidade_reprovada,
           rec_norm_texto_rapido(coalesce(c.fornecedor, ''))             as fornecedor,
           upper(rec_norm_texto_rapido(coalesce(c.numero_emb, '')))      as emb,
           upper(rec_norm_texto_rapido(coalesce(c.codigo_material, ''))) as codigo,
           rec_norm_texto_rapido(coalesce(c.motivo_reprovacao, ''))      as motivo,
           (lower(btrim(c.status)) = 'reprovado'
              or lower(btrim(coalesce(c.resultado, ''))) = 'reprovado') as reprovado,
           (lower(btrim(c.status)) not in ('aberto', 'em_conferencia')
              or btrim(coalesce(c.resultado, '')) <> '')          as com_resultado
      from cand c
     where c.no_recorte
  ),
  lg as (
    -- Entradas na Qualidade (primeira e última por processo), SÓ dos itens que alguma parte usa (o
    -- recorte e os que estão em conferência). Agregar o log inteiro custava ~500 ms em 300 mil entradas.
    select l.entidade_id as id,
           min(l.created_at) as primeira,
           max(l.created_at) as ultima
      from (select c.id from cand c where c.no_recorte or c.status = 'em_conferencia') i
      join public.logs l on l.entidade_id = i.id
     where l.entidade = 'processo'
       and l.acao = 'mudar_status'
       and l.dados->>'para' = 'em_conferencia'
     group by l.entidade_id
  ),
  -- ---------- Volume ----------
  limites as (
    -- Mesma lógica da 0152: o eixo vai da janela pedida; o lado que falta vem da 1ª/última chegada
    -- do recorte (a última limitada a hoje + 52 semanas contra data suja). Tetos: 520 semanas, 120 meses.
    select coalesce(p_de, min(r.data_chegada), p_ate) as ini,
           coalesce(p_ate,
                    case when max(r.data_chegada) is not null
                         then least(max(r.data_chegada), current_date + 52 * 7) end,
                    p_de) as fim
      from rec r
  ),
  serie_sem as (
    select g.semana::date as inicio
      from limites l,
           generate_series(
             greatest(l.ini - (extract(isodow from l.ini)::int - 1),
                      l.fim - (extract(isodow from l.fim)::int - 1) - 519 * 7)::timestamp,
             (l.fim - (extract(isodow from l.fim)::int - 1))::timestamp,
             interval '7 days') as g(semana)
     where l.ini is not null and l.fim is not null and l.ini <= l.fim
  ),
  por_sem as (
    select r.data_chegada - (extract(isodow from r.data_chegada)::int - 1) as inicio,
           count(*) as itens,
           count(distinct nullif(r.emb, '')) as embs
      from rec r
     where r.data_chegada is not null
     group by 1
  ),
  semanas as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'inicio', to_char(s.inicio, 'YYYY-MM-DD'),
                      'itens',  coalesce(w.itens, 0),
                      'embs',   coalesce(w.embs, 0))
                    order by s.inicio), '[]'::jsonb) as j
      from serie_sem s
      left join por_sem w on w.inicio = s.inicio
  ),
  serie_mes as (
    select g.mes::date as inicio
      from limites l,
           generate_series(
             greatest(date_trunc('month', l.ini),
                      date_trunc('month', l.fim) - interval '119 months'),
             date_trunc('month', l.fim),
             interval '1 month') as g(mes)
     where l.ini is not null and l.fim is not null and l.ini <= l.fim
  ),
  por_mes as (
    select date_trunc('month', r.data_chegada)::date as inicio,
           count(*) as itens,
           count(distinct nullif(r.emb, '')) as embs
      from rec r
     where r.data_chegada is not null
     group by 1
  ),
  meses as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'inicio', to_char(s.inicio, 'YYYY-MM-DD'),
                      'itens',  coalesce(w.itens, 0),
                      'embs',   coalesce(w.embs, 0))
                    order by s.inicio), '[]'::jsonb) as j
      from serie_mes s
      left join por_mes w on w.inicio = s.inicio
  ),
  -- ---------- Qualidade ----------
  q_tot as (
    select jsonb_build_object(
             'com_resultado',    count(*),
             'reprovados',       count(*) filter (where r.reprovado),
             'pecas_recebidas',  coalesce(sum(coalesce(r.quantidade_recebida, 0)), 0),
             'pecas_reprovadas', coalesce(sum(coalesce(r.quantidade_reprovada, 0)), 0)) as j
      from rec r
     where r.com_resultado
  ),
  q_forn as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'fornecedor', x.fornecedor, 'com_resultado', x.com_resultado, 'reprovados', x.reprovados)
                    order by x.reprovados desc, x.fornecedor), '[]'::jsonb) as j
      from (select r.fornecedor, count(*) as com_resultado, count(*) filter (where r.reprovado) as reprovados
              from rec r where r.com_resultado
             group by r.fornecedor
            having count(*) filter (where r.reprovado) > 0
             order by 3 desc, 1
             limit 10) x
  ),
  q_mat as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'codigo', x.codigo, 'descricao', coalesce(x.descricao, ''),
                      'com_resultado', x.com_resultado, 'reprovados', x.reprovados)
                    order by x.reprovados desc, x.codigo), '[]'::jsonb) as j
      from (select r.codigo, max(r.descricao_material) as descricao,
                   count(*) as com_resultado, count(*) filter (where r.reprovado) as reprovados
              from rec r where r.com_resultado and r.codigo <> ''
             group by r.codigo
            having count(*) filter (where r.reprovado) > 0
             order by 4 desc, 1
             limit 10) x
  ),
  q_mot as (
    select coalesce(jsonb_agg(jsonb_build_object('motivo', x.motivo, 'itens', x.itens)
                    order by x.itens desc, x.motivo), '[]'::jsonb) as j
      from (select r.motivo, count(*) as itens
              from rec r where r.reprovado and r.motivo <> ''
             group by r.motivo
             order by 2 desc, 1
             limit 5) x
  ),
  -- ---------- Atraso ----------
  at_base as (
    select r.fornecedor, (r.data_chegada - r.data_prevista) as dias
      from rec r
     where r.data_prevista is not null and r.data_chegada is not null
  ),
  at_tot as (
    select jsonb_build_object(
             'com_prazo', count(*),
             'atrasados', count(*) filter (where a.dias > 0),
             'media_dias_atraso', round(avg(a.dias) filter (where a.dias > 0)::numeric, 1)) as j
      from at_base a
  ),
  at_forn as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'fornecedor', x.fornecedor, 'com_prazo', x.com_prazo,
                      'atrasados', x.atrasados, 'media_dias', x.media)
                    order by x.atrasados desc, x.fornecedor), '[]'::jsonb) as j
      from (select a.fornecedor, count(*) as com_prazo,
                   count(*) filter (where a.dias > 0) as atrasados,
                   round(avg(a.dias) filter (where a.dias > 0)::numeric, 1) as media
              from at_base a
             group by a.fornecedor
            having count(*) filter (where a.dias > 0) > 0
             order by 3 desc, 1
             limit 10) x
  ),
  -- ---------- Tempo ----------
  t_rec as (
    select greatest(0, (g.primeira at time zone 'America/Sao_Paulo')::date - r.data_chegada) as d
      from rec r join lg g on g.id = r.id
     where r.data_chegada is not null
  ),
  t_qua as (
    select greatest(0::numeric, extract(epoch from (r.finalizado_em - g.primeira)) / 86400) as d
      from rec r join lg g on g.id = r.id
     where r.finalizado_em is not null
  ),
  t_par as (
    -- Estado atual: SEM o recorte de data (parte de `cand`, não de `rec`).
    select jsonb_build_object(
             'dias', v_x,
             'recebimento', (select count(*) from cand b
                              where b.status = 'aberto' and b.data_chegada is not null
                                and v_hoje - b.data_chegada > v_x),
             'qualidade',   (select count(*) from cand b join lg g on g.id = b.id
                              where b.status = 'em_conferencia'
                                and now() - g.ultima > v_x * interval '1 day')) as j
  ),
  tempo as (
    select jsonb_build_object(
             'recebimento', (select jsonb_build_object('n', count(*),
                                      'media_dias',   round(avg(d)::numeric, 1),
                                      'mediana_dias', round((percentile_cont(0.5) within group (order by d))::numeric, 1))
                               from t_rec),
             'qualidade',   (select jsonb_build_object('n', count(*),
                                      'media_dias',   round(avg(d)::numeric, 1),
                                      'mediana_dias', round((percentile_cont(0.5) within group (order by d))::numeric, 1))
                               from t_qua),
             'parados',     (select j from t_par),
             'sem_tempo',   (select count(*) from rec r
                              where r.status <> 'aberto'
                                and not exists (select 1 from lg g where g.id = r.id))) as j
  ),
  -- ---------- Pendências (estado atual, sem recorte de data) ----------
  pend as (
    select rec_norm_texto_rapido(coalesce(b.fornecedor, '')) as fornecedor,
           (v_hoje - b.data_prevista) as dias,
           b.data_prevista
      from cand b
     where b.status = 'aberto' and b.data_chegada is null
  ),
  pend_json as (
    select jsonb_build_object(
             'total', (select count(*) from pend),
             'faixas', (select jsonb_build_object(
                          'no_prazo',     count(*) filter (where p.data_prevista is not null and p.dias <= 0),
                          'd1_7',         count(*) filter (where p.dias between 1 and 7),
                          'd8_30',        count(*) filter (where p.dias between 8 and 30),
                          'd30_mais',     count(*) filter (where p.dias > 30),
                          'sem_prevista', count(*) filter (where p.data_prevista is null))
                        from pend p),
             'fornecedores', (select coalesce(jsonb_agg(jsonb_build_object(
                                        'fornecedor', x.fornecedor, 'pendentes', x.pendentes, 'atrasados', x.atrasados)
                                      order by x.atrasados desc, x.fornecedor), '[]'::jsonb)
                                from (select p.fornecedor, count(*) as pendentes,
                                             count(*) filter (where p.dias > 0) as atrasados
                                        from pend p
                                       group by p.fornecedor
                                       order by 3 desc, 1
                                       limit 10) x)) as j
  )
  select jsonb_build_object(
           'volume',     jsonb_build_object('semanas', s.j, 'meses', m.j),
           'qualidade',  jsonb_build_object('totais', qt.j, 'fornecedores', qf.j, 'materiais', qm.j, 'motivos', qo.j),
           'atraso',     jsonb_build_object('totais', att.j, 'fornecedores', atf.j),
           'tempo',      t.j,
           'pendencias', pj.j)
    into v_resultado
    from semanas s, meses m, q_tot qt, q_forn qf, q_mat qm, q_mot qo,
         at_tot att, at_forn atf, tempo t, pend_json pj;

  return v_resultado;
end $func$;

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key chamaria direto.
revoke all on function public.rec_norm_texto_rapido(text) from public, anon, authenticated;
revoke all on function public.rec_dashboard_metricas(text, text, text, text, date, date, integer) from public, anon, authenticated;
grant execute on function public.rec_norm_texto_rapido(text) to authenticated;
grant execute on function public.rec_dashboard_metricas(text, text, text, text, date, date, integer) to authenticated;

notify pgrst, 'reload schema';
