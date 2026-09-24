-- =============================================================
-- Recebimento — Fluxo e Registros (somente leitura).
--
-- Duas telas novas: /recebimento/fluxo (onde estão os itens de uma EMB) e /recebimento/registros
-- (as passagens de etapa, com o que mudou em cada uma). Nada aqui grava nada.
--
-- O fluxo é:  Recebimento ──► Qualidade ──► Almoxarifado
--                                 │
--                                 └──► Reprovado na Qualidade   (fim de linha)
--   Divergência de Quantidade é MARCA que viaja com o item, não caixa.
--
-- Por que agregar no BANCO e não no cliente: a derivação da etapa é regra de negócio (mora num
-- lugar só) e `logs` é uma tabela global que cresce — filtrar/agrupar aqui evita trazer milhares
-- de linhas pro navegador só pra somar.
--
-- Espelha src/modules/recebimento/domain/etapa-processo.ts (a referência das regras, testada sem
-- banco). Mudou lá, muda aqui.
--
-- Corpo das funções com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: só `create or replace function` + grants. Reaplicar não faz mal.
-- =============================================================

-- ---------- helpers puros (espelham o domínio em TS) ----------

-- temDivergencia: vazio = não conferido (não é divergência); zero = sem divergência; qualquer outro
-- número = divergência; texto que não é número = sem divergência (não inventa significado).
create or replace function public.rec_divergente(p_valor text)
returns boolean
language plpgsql
immutable
set search_path = public
as $func$
declare v numeric;
begin
  if coalesce(btrim(p_valor), '') = '' then return false; end if;
  begin
    v := replace(btrim(p_valor), ',', '.')::numeric;
  exception when others then
    return false;
  end;
  return v <> 0;
end $func$;

-- etapaPorResultado: "Reprovado" é a ÚNICA saída lateral; qualquer outro resultado conta como
-- Almoxarifado (a lista "Resultado" é configurável — valor novo de aprovação entra sozinho).
create or replace function public.rec_etapa_por_resultado(p_resultado text)
returns text
language sql
immutable
set search_path = public
as $func$
  select case when lower(btrim(coalesce(p_resultado, ''))) = 'reprovado'
              then 'reprovado' else 'almoxarifado' end
$func$;

-- etapaPorStatus: 'aberto' = esperando conferência (Recebimento); 'em_conferencia' = conferência
-- começou (Qualidade); qualquer outro status é terminal e vale o Resultado.
create or replace function public.rec_etapa_por_status(p_status text)
returns text
language sql
immutable
set search_path = public
as $func$
  select case btrim(coalesce(p_status, ''))
           when 'aberto' then 'recebimento'
           when 'em_conferencia' then 'qualidade'
           else public.rec_etapa_por_resultado(p_status)
         end
$func$;

-- secaoDoDiff: a seção salva sai do GRUPO dos campos que o diff tocou (funciona pro histórico
-- antigo também, sem interpretar texto). null = diff vazio (salvar sem alterar nada grava
-- `dados: []`) ou diff que só tocou campos base, que as duas seções gravam.
create or replace function public.rec_secao_do_diff(p_dados jsonb)
returns text
language sql
stable
set search_path = public
as $func$
  select case
    when jsonb_typeof(p_dados) is distinct from 'array' then null
    when exists (
      select 1 from jsonb_array_elements(p_dados) d
        join public.configuracao_campos c on c.campo = d->>'campo'
       where c.grupo = 'qualidade'
    ) then 'qualidade'
    when exists (
      select 1 from jsonb_array_elements(p_dados) d
        join public.configuracao_campos c on c.campo = d->>'campo'
       where c.grupo = 'recebimento'
    ) then 'recebimento'
    else null
  end
$func$;

-- secaoDaDescricao: só o desempate de quando o diff não decide ("Processo #12 — seção X salva").
create or replace function public.rec_secao_da_descricao(p_descricao text)
returns text
language sql
immutable
set search_path = public
as $func$
  select substring(coalesce(p_descricao, '') from 'seção (recebimento|qualidade) salva')
$func$;

-- Seção efetiva de um log de `alterar_campo`: diff primeiro, descrição como desempate.
create or replace function public.rec_secao_do_log(p_descricao text, p_dados jsonb)
returns text
language sql
stable
set search_path = public
as $func$
  select coalesce(public.rec_secao_do_diff(p_dados), public.rec_secao_da_descricao(p_descricao))
$func$;

-- Caixa em que o item FICOU depois do evento. null = evento que não diz nada sobre o fluxo (foto
-- anexada, log de seção indecifrável) ou a promoção automática 'aberto → em_conferencia', que
-- acontece JUNTO com o 1º salvamento de seção — contar as duas mostraria o movimento duas vezes.
create or replace function public.rec_etapa_do_log(p_acao text, p_descricao text, p_dados jsonb)
returns text
language sql
stable
set search_path = public
as $func$
  select case
    when p_acao = 'criar' then 'recebimento'
    when p_acao = 'mudar_status' then
      case
        when btrim(coalesce(p_dados->>'para', '')) = 'em_conferencia' then
          case when btrim(coalesce(p_dados->>'de', '')) in ('', 'aberto')
               then null              -- promoção automática do 1º salvamento
               else 'qualidade' end   -- reabertura: volta pra Qualidade
        when btrim(coalesce(p_dados->>'para', '')) in ('', 'aberto') then null
        else public.rec_etapa_por_resultado(p_dados->>'para')
      end
    when p_acao = 'alterar_campo' then
      -- Salvar a seção Recebimento passa o item pra Qualidade; salvar a seção Qualidade é trabalho
      -- DENTRO da Qualidade (o item só sai dali ao finalizar). As duas deixam o item na Qualidade.
      case public.rec_secao_do_log(p_descricao, p_dados)
        when 'recebimento' then 'qualidade'
        when 'qualidade' then 'qualidade'
        else null
      end
    else null
  end
$func$;

-- ---------- Fluxo: contagem e tempo por caixa de uma EMB ----------
-- Sempre devolve as QUATRO caixas (mesmo vazias): a tela desenha as quatro.
--   itens          = quantos estão na caixa agora
--   divergentes    = quantos deles carregam a marca de divergência
--   media_segundos = média de há quanto tempo os itens da caixa estão nela (só os com tempo)
--   maior_segundos = o item mais antigo da caixa (o candidato a gargalo)
--   sem_tempo      = itens da caixa cujo histórico não permite saber desde quando (tela mostra "—")
--
-- "Desde quando" = começo da última corrida de eventos na caixa atual: vários salvamentos seguidos
-- na Qualidade não reiniciam o relógio, e uma reabertura reinicia (ela quebra a corrida).
create or replace function public.rec_fluxo_emb(p_emb text)
returns table (
  etapa text,
  itens bigint,
  divergentes bigint,
  media_segundos numeric,
  maior_segundos numeric,
  sem_tempo bigint
)
language plpgsql
stable
security definer
set search_path = public
as $func$
-- As colunas OUT do RETURNS TABLE (etapa/itens/...) viram variáveis no plpgsql e colidiriam com as
-- colunas homônimas das CTEs; use_column resolve toda referência sem qualificação como coluna.
#variable_conflict use_column
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  with base as (
    select p.id, p.created_at, p.finalizado_em, p.divergencia,
           public.rec_etapa_por_status(p.status) as etapa
      from public.processos_recebimento p
     where upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
  ),
  ev as (
    select l.entidade_id as processo_id, l.created_at,
           public.rec_etapa_do_log(l.acao, l.descricao, l.dados) as etapa
      from public.logs l
      join base b on b.id = l.entidade_id
     where l.entidade = 'processo'
  ),
  ev_ok as (select * from ev where etapa is not null),
  item as (
    select b.id, b.etapa, b.divergencia,
           case
             -- Entrar no Recebimento é nascer: created_at é not null, nunca falta o tempo.
             when b.etapa = 'recebimento' then b.created_at
             else coalesce(
               (select min(e.created_at) from ev_ok e
                 where e.processo_id = b.id and e.etapa = b.etapa
                   and e.created_at > coalesce(
                     (select max(x.created_at) from ev_ok x
                       where x.processo_id = b.id and x.etapa is distinct from b.etapa),
                     '-infinity'::timestamptz)),
               case when b.etapa in ('almoxarifado', 'reprovado') then b.finalizado_em end)
           end as desde
      from base b
  )
  select c.etapa,
         count(i.id),
         count(i.id) filter (where public.rec_divergente(i.divergencia)),
         avg(extract(epoch from (now() - i.desde))) filter (where i.desde is not null),
         max(extract(epoch from (now() - i.desde))),
         count(i.id) filter (where i.desde is null)
    from (values ('recebimento', 1), ('qualidade', 2), ('almoxarifado', 3), ('reprovado', 4))
           as c(etapa, ordem)
    left join item i on i.etapa = c.etapa
   group by c.etapa, c.ordem
   order by c.ordem;
end $func$;

-- ---------- Fluxo: os itens de uma caixa ----------
-- Mais antigo primeiro (é o que interessa em "essa EMB está travada em quê"). p_limite existe
-- porque o PostgREST corta a resposta em 1000 linhas: a tela compara com a contagem do resumo e
-- avisa quando está mostrando só uma parte.
create or replace function public.rec_fluxo_emb_itens(
  p_emb text,
  p_etapa text,
  p_limite int default 500
)
returns table (
  processo_id uuid,
  numero bigint,
  item text,
  descricao text,
  quantidade_pedido numeric,
  quantidade_recebida numeric,
  divergencia text,
  resultado text,
  desde timestamptz,
  segundos numeric
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  with base as (
    select p.id, p.numero, p.codigo_material, p.descricao_material, p.quantidade_pedido,
           p.quantidade_recebida, p.divergencia, p.resultado, p.created_at, p.finalizado_em,
           public.rec_etapa_por_status(p.status) as etapa
      from public.processos_recebimento p
     where upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
       and public.rec_etapa_por_status(p.status) = btrim(coalesce(p_etapa, ''))
  ),
  ev as (
    select l.entidade_id as processo_id, l.created_at,
           public.rec_etapa_do_log(l.acao, l.descricao, l.dados) as etapa
      from public.logs l
      join base b on b.id = l.entidade_id
     where l.entidade = 'processo'
  ),
  ev_ok as (select * from ev where etapa is not null),
  item as (
    select b.*,
           case
             when b.etapa = 'recebimento' then b.created_at
             else coalesce(
               (select min(e.created_at) from ev_ok e
                 where e.processo_id = b.id and e.etapa = b.etapa
                   and e.created_at > coalesce(
                     (select max(x.created_at) from ev_ok x
                       where x.processo_id = b.id and x.etapa is distinct from b.etapa),
                     '-infinity'::timestamptz)),
               case when b.etapa in ('almoxarifado', 'reprovado') then b.finalizado_em end)
           end as desde
      from base b
  )
  select i.id, i.numero,
         coalesce(i.codigo_material, ''), coalesce(i.descricao_material, ''),
         i.quantidade_pedido, i.quantidade_recebida,
         -- Só o valor: quem decide se é divergência é o domínio (temDivergencia), que a tela usa
         -- pra desenhar a marca. A contagem de divergentes por caixa vem do resumo.
         coalesce(i.divergencia, ''),
         coalesce(i.resultado, ''),
         i.desde,
         extract(epoch from (now() - i.desde))
    from item i
   -- nulls last: item sem tempo conhecido vai pro fim (a tela mostra "—" nele).
   order by i.desde asc nulls last, i.numero asc
   limit greatest(1, coalesce(p_limite, 500));
end $func$;

-- ---------- Registros: as passagens de etapa, com filtros e paginação ----------
-- Uma linha por evento de log do processo. As colunas de identidade do item (item, descrição,
-- fornecedor, fabricante, part number, EMB) vêm do PROCESSO — é o "quem é esse item", e refletem o
-- estado atual da linha, não o que estava lá na hora do evento.
--
-- `total` = quantas linhas casam com os filtros (window count), pra tela paginar sem 2ª consulta.
-- p_etapa filtra pela caixa em que o item FICOU depois do registro.
create or replace function public.rec_registros(
  p_emb text default null,
  p_item text default null,
  p_fornecedor text default null,
  p_etapa text default null,
  p_de timestamptz default null,
  p_ate timestamptz default null,
  p_colaborador text default null,
  p_pagina int default 0,
  p_tamanho int default 100
)
returns table (
  id uuid,
  data_hora timestamptz,
  colaborador text,
  processo_id uuid,
  numero bigint,
  emb text,
  item text,
  descricao text,
  fornecedor text,
  fabricante text,
  part_number text,
  acao text,
  secao text,
  etapa text,
  status_de text,
  status_para text,
  alteracoes jsonb,
  total bigint
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_tamanho int := least(greatest(1, coalesce(p_tamanho, 100)), 1000);
  v_pagina int := greatest(0, coalesce(p_pagina, 0));
  -- `%` e `_` são curingas do LIKE: escapamos o que a pessoa digitou, senão digitar "_" casaria
  -- qualquer caractere e o filtro traria mais do que ela pediu, sem ela entender por quê.
  v_item text := replace(replace(replace(btrim(coalesce(p_item, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_colab text := replace(replace(replace(btrim(coalesce(p_colaborador, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  with evento as (
    select l.id, l.created_at, l.usuario_nome, l.acao, l.descricao, l.dados,
           p.id as processo_id, p.numero, p.numero_emb, p.codigo_material, p.descricao_material,
           p.fornecedor, p.fabricante, p.part_number_recebido,
           public.rec_secao_do_log(l.descricao, l.dados) as secao,
           public.rec_etapa_do_log(l.acao, l.descricao, l.dados) as etapa
      from public.logs l
      join public.processos_recebimento p on p.id = l.entidade_id
     where l.entidade = 'processo'
       -- As três ações que contam a vida do processo (login/etiqueta/importação não são dele).
       and l.acao in ('criar', 'alterar_campo', 'mudar_status')
       and (btrim(coalesce(p_emb, '')) = ''
            or upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(p_emb)))
       and (v_item = '' or coalesce(p.codigo_material, '') ilike '%' || v_item || '%')
       and (btrim(coalesce(p_fornecedor, '')) = ''
            or btrim(coalesce(p.fornecedor, '')) = btrim(p_fornecedor))
       and (v_colab = '' or coalesce(l.usuario_nome, '') ilike '%' || v_colab || '%')
       and (p_de is null or l.created_at >= p_de)
       and (p_ate is null or l.created_at <= p_ate)
  ),
  filtrado as (
    select * from evento e
     where btrim(coalesce(p_etapa, '')) = '' or e.etapa = btrim(p_etapa)
  )
  select f.id, f.created_at, coalesce(f.usuario_nome, ''),
         f.processo_id, f.numero,
         coalesce(f.numero_emb, ''), coalesce(f.codigo_material, ''),
         coalesce(f.descricao_material, ''), coalesce(f.fornecedor, ''),
         coalesce(f.fabricante, ''), coalesce(f.part_number_recebido, ''),
         f.acao, f.secao, f.etapa,
         f.dados->>'de', f.dados->>'para',
         case when jsonb_typeof(f.dados) = 'array' then f.dados else '[]'::jsonb end,
         count(*) over ()
    from filtrado f
   order by f.created_at desc, f.id desc
   offset v_pagina * v_tamanho
   limit v_tamanho;
end $func$;

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key (pública, está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
-- Os helpers puros só são usados POR DENTRO das funções das telas (que são SECURITY DEFINER e
-- rodam como donas): ninguém de fora precisa chamá-los.
revoke all on function public.rec_divergente(text) from public, anon, authenticated;
revoke all on function public.rec_etapa_por_resultado(text) from public, anon, authenticated;
revoke all on function public.rec_etapa_por_status(text) from public, anon, authenticated;
revoke all on function public.rec_secao_do_diff(jsonb) from public, anon, authenticated;
revoke all on function public.rec_secao_da_descricao(text) from public, anon, authenticated;
revoke all on function public.rec_secao_do_log(text, jsonb) from public, anon, authenticated;
revoke all on function public.rec_etapa_do_log(text, text, jsonb) from public, anon, authenticated;

revoke all on function public.rec_fluxo_emb(text) from public, anon;
revoke all on function public.rec_fluxo_emb_itens(text, text, int) from public, anon;
revoke all on function public.rec_registros(text, text, text, text, timestamptz, timestamptz, text, int, int)
  from public, anon;

grant execute on function public.rec_fluxo_emb(text) to authenticated;
grant execute on function public.rec_fluxo_emb_itens(text, text, int) to authenticated;
grant execute on function public.rec_registros(text, text, text, text, timestamptz, timestamptz, text, int, int)
  to authenticated;

notify pgrst, 'reload schema';
