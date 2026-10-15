-- =============================================================
-- RECEBIMENTO — DASHBOARD DE DIVERGÊNCIAS (somente leitura) + justificativa aparada
-- Spec: docs/superpowers/specs/2026-10-14-dashboard-recebimento-design.md
--
-- O QUÊ
--   0. rec_norm_texto(text)    → text: o aparo de texto (igual ao trim() do JavaScript) usado em todo
--                                filtro e agrupamento por fornecedor, comprador, EMB e código.
--   1. rec_dashboard(...)      → jsonb: os totais, o top 10 de fornecedores e a série semanal de
--                                itens divergentes, NUMA chamada só (a tela /recebimento/dashboard).
--   2. rec_dashboard_opcoes()  → jsonb: fornecedores e compradores distintos, para as duas listas.
--   3. rec_justificar_divergencia(uuid, text) recriada com o texto APARADO (btrim), mais a
--      normalização única das justificativas já gravadas que são só espaços.
--
-- POR QUÊ
--   Agregar no banco: a tabela inteira não vem para o navegador só para somar, e uma chamada só
--   porque o Fluxo do ShopFloor mostrou o custo de 12 requisições no carregamento.
--   A régua é a da spec §3, a mesma do filtro rápido "Divergências" da grade de Processos:
--   item = linha de processos_recebimento; cancelado fica de fora; "com divergência" =
--   divergencia_num <> 0 (coluna gerada da 0147); "sem justificativa" = com divergência e
--   btrim(divergencia_justificativa) = ''; tudo contado por data_chegada.
--   A justificativa: o app apara antes de gravar, mas a função da 0143 gravava sem aparar — uma
--   chamada direta com "   " ficava "justificada" no SQL e "pendente" na tela.
--
-- Fora da spec, de propósito: p_sinal ('positiva' | 'negativa' | ''). Clicar na barra de positivas
-- ou de negativas filtra a tela, e a assinatura da spec não tinha como receber esse filtro. Com
-- sinal, "divergente" passa a ser "divergente daquele sinal" nos totais, no ranking e na série;
-- os contadores positivas/negativas continuam mostrando os dois sinais (para dar para trocar).
--
-- Índice em data_chegada: NÃO entra. Medido em 15/10/2026 no harness (300 mil linhas, set role
-- authenticated, EXPLAIN ANALYZE, mediana de 3) COM a normalização por rec_norm_texto (regexp_replace):
-- recorte de 90 dias em 112 ms sem índice e 48 ms com — abaixo do teto de 150 ms. (Com btrim, antes
-- da rec_norm_texto, eram 104 ms; a regex custa uns 7 ms no recorte padrão.) Fora da carga padrão:
-- tabela inteira ~864 ms e rec_dashboard_opcoes ~644 ms nessas 300 mil linhas — o índice não ajuda
-- nenhuma das duas (varrem tudo). O volume real do Recebimento é bem menor que 300 mil linhas. O
-- usuário repete a medição no Dev com dados reais (plano, Task 6).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0152_rec_dashboard.sql
--
-- ⚠️ ANTES DO PROD: contar as justificativas só-de-espaços (a consulta de leitura está no plano
-- docs/superpowers/plans/2026-10-15-dashboard-recebimento.md, Task 6)
-- e dizer o número ao usuário. Elas passam de "justificada" para "pendente" no SQL — que é o que
-- a tela já mostrava.
--
-- Aditiva e idempotente: create or replace + grants + um update que, rodado de novo, não acha
-- linha nenhuma. Corpo de função com $func$ (o SQL Editor não aceita dois cifrões, nem em
-- comentário); tem_permissao SEMPRE com dois argumentos (a de um argumento anula o RBAC).
-- =============================================================

-- ---------- 0. a normalização do texto ----------
-- UMA régua só para fornecedor, comprador, EMB e código: tira das PONTAS o mesmo que o trim() do
-- JavaScript (espaço, tab, \r, \n, \f, \v e o NBSP, U+00A0). O btrim do Postgres tira só espaço:
-- com ele, a lista de opções oferecia "ACME<tab>", a URL levava ACME, o trim() do app aparava, o
-- SQL comparava btrim(...) = 'ACME' e os cartões zeravam para um fornecedor que a própria lista
-- oferece. O NBSP vem explícito (\u00a0) porque o \s do Postgres não o cobre em todo locale.
-- Imutável e SEM `set search_path` (que impediria o Postgres de embutir a função na consulta):
-- só usa regexp_replace, do pg_catalog.
-- Diferença que fica de propósito: a JUSTIFICATIVA (btrim(divergencia_justificativa), mais abaixo)
-- continua com btrim, que só tira espaço — o app apara com trim() antes de gravar, então só uma
-- escrita direta no banco deixa tab ou quebra de linha lá.
create or replace function public.rec_norm_texto(p_texto text)
returns text
language sql
immutable
as $func$
  select regexp_replace(p_texto, '^[\s\u00a0]+|[\s\u00a0]+$', '', 'g')
$func$;

-- ---------- 1. o dashboard ----------
-- Texto vazio (ou nulo) = sem filtro. Datas nulas = sem recorte por data. Os 90 dias são padrão
-- da TELA, não daqui.
--   Fornecedor e comprador: comparação exata depois de aparar com rec_norm_texto ("ACME" e "Acme"
--   são dois; tab, quebra de linha e NBSP nas pontas não contam).
--   EMB e código do material: exata, sem diferenciar maiúsculas, também aparados com rec_norm_texto.
--   De / Até: sobre data_chegada, inclusivos. Linha sem data_chegada fica fora de qualquer
--   recorte por data e é contada em totais.fora_do_recorte_por_data (só quando há recorte).
create or replace function public.rec_dashboard(
  p_fornecedor text default null,
  p_comprador  text default null,
  p_emb        text default null,
  p_codigo     text default null,
  p_de         date default null,
  p_ate        date default null,
  p_sinal      text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_forn     text := rec_norm_texto(coalesce(p_fornecedor, ''));
  v_comp     text := rec_norm_texto(coalesce(p_comprador, ''));
  v_emb      text := upper(rec_norm_texto(coalesce(p_emb, '')));
  v_cod      text := upper(rec_norm_texto(coalesce(p_codigo, '')));
  v_sinal    text := lower(btrim(coalesce(p_sinal, '')));
  v_com_data boolean := p_de is not null or p_ate is not null;
  v_resultado jsonb;
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_sinal not in ('', 'positiva', 'negativa') then raise exception 'SINAL_INVALIDO'; end if;

  -- `not materialized`: `base` é lida duas vezes (o recorte e a contagem de fora do período) e, sem
  -- isto, o Postgres a materializaria inteira — o filtro de data não chegaria à tabela. Medido no
  -- harness com 300 mil linhas: 324 ms → 109 ms no recorte de 90 dias.
  with base as not materialized (
    -- Os filtros que NÃO são de data. Daqui sai também a contagem de quem ficou fora do período.
    select rec_norm_texto(coalesce(p.fornecedor, '')) as fornecedor,
           upper(rec_norm_texto(coalesce(p.numero_emb, ''))) as emb,
           p.data_chegada,
           p.divergencia_num,
           btrim(coalesce(p.divergencia_justificativa, '')) = '' as sem_texto
      from public.processos_recebimento p
     where p.status <> 'cancelado'
       and (v_forn = '' or rec_norm_texto(coalesce(p.fornecedor, '')) = v_forn)
       and (v_comp = '' or rec_norm_texto(coalesce(p.comprador, '')) = v_comp)
       and (v_emb  = '' or upper(rec_norm_texto(coalesce(p.numero_emb, ''))) = v_emb)
       and (v_cod  = '' or upper(rec_norm_texto(coalesce(p.codigo_material, ''))) = v_cod)
  ),
  recorte as (
    -- divergencia_num nulo (não conferido, texto) dá nulo na comparação: o coalesce o põe em
    -- "não divergente" — conta em Itens e nunca em "com divergência".
    select b.*,
           coalesce(case v_sinal
                      when 'positiva' then b.divergencia_num > 0
                      when 'negativa' then b.divergencia_num < 0
                      else b.divergencia_num <> 0
                    end, false) as divergente
      from base b
     where (p_de  is null or b.data_chegada >= p_de)
       and (p_ate is null or b.data_chegada <= p_ate)
  ),
  totais as (
    select jsonb_build_object(
             'itens',             count(*),
             'com_divergencia',   count(*) filter (where r.divergente),
             'sem_justificativa', count(*) filter (where r.divergente and r.sem_texto),
             'positivas',         count(*) filter (where r.divergencia_num > 0),
             'negativas',         count(*) filter (where r.divergencia_num < 0),
             'embs',              count(distinct nullif(r.emb, '')),
             'fora_do_recorte_por_data',
               case when v_com_data
                    then (select count(*) from base b where b.data_chegada is null)
                    else 0 end
           ) as j
      from recorte r
  ),
  por_fornecedor as (
    select r.fornecedor,
           count(*) filter (where r.divergente) as divergentes,
           count(*) as itens
      from recorte r
     group by r.fornecedor
  ),
  fornecedores as (
    -- Os 10 com mais itens divergentes; empate desempata pelo nome (a ordem não pode variar entre
    -- duas cargas iguais). Fornecedor em branco vem como '' e a tela escreve "(sem fornecedor)".
    select coalesce(jsonb_agg(jsonb_build_object(
                      'fornecedor',  f.fornecedor,
                      'divergentes', f.divergentes,
                      'itens',       f.itens)
                    order by f.divergentes desc, f.fornecedor), '[]'::jsonb) as j
      from (select * from por_fornecedor
             where divergentes > 0
             order by divergentes desc, fornecedor
             limit 10) f
  ),
  limites as (
    -- A série vai do começo ao fim da JANELA pedida (De / Até); o lado que falta vem da primeira
    -- ou da última chegada do recorte. Por isso uma janela com recorte VAZIO (fornecedor que não
    -- existe, por exemplo) devolve as semanas da janela zeradas — é o eixo da janela, de propósito.
    -- `semanas` só vem vazio quando não há data nenhuma (sem De, sem Até e sem linha com data) ou
    -- quando De > Até.
    -- TETO de 520 semanas (cerca de 10 anos): uma data suja (serial 0 do Excel = 1899, ano digitado
    -- errado) sem janela faria milhares de colunas de 1 px. Passou do teto, a série COMEÇA em
    -- (última semana − 519 semanas) e termina onde terminava; só a série é cortada — totais,
    -- ranking e cartões contam tudo.
    -- O FIM também tem teto quando o usuário não dá o Até: uma chegada mais de 52 semanas à frente de
    -- hoje (ano digitado errado, 2062) é tratada como data suja SÓ no gráfico, senão a série terminaria
    -- no futuro e mostraria dez anos vazios; com Até informado, vale exatamente o que o usuário pediu.
    select coalesce(p_de,  min(r.data_chegada), p_ate) as ini,
           coalesce(p_ate,
                    case when max(r.data_chegada) is not null
                         then least(max(r.data_chegada), current_date + 52 * 7) end,
                    p_de) as fim
      from recorte r
  ),
  serie as (
    -- Uma linha por semana (segunda a domingo), contínua: semana sem nada aparece com zero.
    select g.semana::date as inicio
      from limites l,
           generate_series(
             greatest(l.ini - (extract(isodow from l.ini)::int - 1),
                      l.fim - (extract(isodow from l.fim)::int - 1) - 519 * 7)::timestamp,
             (l.fim - (extract(isodow from l.fim)::int - 1))::timestamp,
             interval '7 days') as g(semana)
     where l.ini is not null and l.fim is not null and l.ini <= l.fim
  ),
  por_semana as (
    select r.data_chegada - (extract(isodow from r.data_chegada)::int - 1) as inicio,
           count(*) filter (where r.divergente and not r.sem_texto) as justificadas,
           count(*) filter (where r.divergente and r.sem_texto)     as sem_justificativa
      from recorte r
     where r.data_chegada is not null
     group by 1
  ),
  semanas as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'inicio',            to_char(s.inicio, 'YYYY-MM-DD'),
                      'justificadas',      coalesce(w.justificadas, 0),
                      'sem_justificativa', coalesce(w.sem_justificativa, 0))
                    order by s.inicio), '[]'::jsonb) as j
      from serie s
      left join por_semana w on w.inicio = s.inicio
  )
  select jsonb_build_object('totais', t.j, 'fornecedores', f.j, 'semanas', s.j)
    into v_resultado
    from totais t, fornecedores f, semanas s;

  return v_resultado;
end $func$;

-- ---------- 2. as opções das listas suspensas ----------
-- Valores distintos, aparados com rec_norm_texto (a mesma régua do filtro), não vazios, em ordem. Inclui os de processos cancelados: a lista
-- mostra o que existe no banco (spec §4), e o número de um fornecedor só-cancelado sai zero.
create or replace function public.rec_dashboard_opcoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_resultado jsonb;
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  select jsonb_build_object(
           'fornecedores', coalesce((
             select jsonb_agg(x.valor order by x.valor)
               from (select distinct rec_norm_texto(p.fornecedor) as valor
                       from public.processos_recebimento p
                      where rec_norm_texto(coalesce(p.fornecedor, '')) <> '') x), '[]'::jsonb),
           'compradores', coalesce((
             select jsonb_agg(x.valor order by x.valor)
               from (select distinct rec_norm_texto(p.comprador) as valor
                       from public.processos_recebimento p
                      where rec_norm_texto(coalesce(p.comprador, '')) <> '') x), '[]'::jsonb)
         )
    into v_resultado;

  return v_resultado;
end $func$;

-- ---------- 3. a justificativa aparada ----------
-- Mesma assinatura da 0143 (por isso NÃO tem drop function), mesma porta (recebimento.administrar),
-- mesmo security definer, mesmos grants. A única diferença é o btrim no texto gravado.
-- O btrim daqui tira só espaço (não tab nem quebra de linha) — diferente de rec_norm_texto, usada nos
-- filtros; é limite documentado e de baixo risco, porque o app apara com trim() antes de gravar.
create or replace function public.rec_justificar_divergencia(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_nome text;
begin
  if not tem_permissao('recebimento', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- Nome de exibição igual ao resto do app (registrarLog): nome, e o e-mail se o nome estiver vazio.
  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome
    from public.usuarios u where u.id = auth.uid();

  update public.processos_recebimento
     set divergencia_justificativa = coalesce(btrim(p_texto), ''),
         divergencia_justificada_por = auth.uid(),
         divergencia_justificada_em = now(),
         divergencia_justificada_por_nome = coalesce(v_nome, '')
   where id = p_id;

  if not found then
    raise exception 'PROCESSO_NAO_ENCONTRADO';
  end if;
end;
$func$;

-- Normalização única do que já está gravado: só linhas só-de-espaços. Autor e instante da
-- justificativa (justificada_por/_em/_por_nome) ficam como estão (é limpeza, não é alguém
-- justificando), mas o gatilho processos_updated_at (migração 0004) mexe no updated_at dessas
-- linhas, como em qualquer update. Rodar de novo atualiza 0 linhas.
update public.processos_recebimento
   set divergencia_justificativa = ''
 where divergencia_justificativa <> ''
   and btrim(divergencia_justificativa) = '';

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key (pública, está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
revoke all on function public.rec_norm_texto(text) from public, anon, authenticated;
revoke all on function public.rec_dashboard(text, text, text, text, date, date, text) from public, anon, authenticated;
revoke all on function public.rec_dashboard_opcoes() from public, anon, authenticated;
revoke all on function public.rec_justificar_divergencia(uuid, text) from public, anon, authenticated;

grant execute on function public.rec_norm_texto(text) to authenticated;
grant execute on function public.rec_dashboard(text, text, text, text, date, date, text) to authenticated;
grant execute on function public.rec_dashboard_opcoes() to authenticated;
grant execute on function public.rec_justificar_divergencia(uuid, text) to authenticated;

notify pgrst, 'reload schema';
