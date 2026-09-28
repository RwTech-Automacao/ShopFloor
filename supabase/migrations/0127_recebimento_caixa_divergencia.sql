-- =============================================================
-- Fluxo do Recebimento: a caixa paralela "Divergência de quantidade".
--
-- Estava no alinhamento de 24/09 ("postos paralelos estilo manutenção: Divergência de Quantidade e
-- Reprovado na Qualidade") e só o Reprovado foi construído; a divergência virou marca no card das
-- outras caixas, o que se lê errado (no Almoxarifado parecia que a divergência aconteceu ali).
--
-- A DIFERENÇA em relação ao Reprovado, que manda no desenho: no Reprovado o item ESTÁ ali — saiu do
-- fluxo, é fim de linha. Aqui o item NÃO sai do fluxo (decisão do usuário em 24/09): ele segue para
-- a Qualidade e para o Almoxarifado, só fica sinalizado. Ou seja, esta é uma caixa de VISTA: o item
-- aparece nela E na caixa real dele. Por consequência, as caixas deixam de somar o total da EMB —
-- a tela avisa isso no subtítulo e o rodapé continua contando cada item uma vez só.
--
-- As duas funções mudam só o CORPO, com a mesma assinatura e o mesmo tipo de retorno: `create or
-- replace` resolve, sem `drop function` (que exigiria recriar grants e quebraria chamadas em voo).
-- Aditiva e idempotente: reaplicar não faz mal.
-- =============================================================

-- ---------- Resumo: agora com a quinta caixa ----------
-- A caixa `divergencia` conta os itens MARCADOS da EMB inteira, em qualquer etapa. Ela não tem
-- tempo: "há quanto tempo está divergente" não é registrado em lugar nenhum, e inventar a partir da
-- entrada na caixa atual seria número errado com cara de certo.
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
  ),
  -- As quatro caixas de verdade: cada item conta uma vez, na caixa em que está.
  reais as (
    select c.etapa, c.ordem,
           count(i.id) as itens,
           count(i.id) filter (where public.rec_divergente(i.divergencia)) as divergentes,
           avg(extract(epoch from (now() - i.desde))) filter (where i.desde is not null) as media_segundos,
           max(extract(epoch from (now() - i.desde))) as maior_segundos,
           count(i.id) filter (where i.desde is null) as sem_tempo
      from (values ('recebimento', 1), ('qualidade', 2), ('almoxarifado', 3), ('reprovado', 4))
             as c(etapa, ordem)
      left join item i on i.etapa = c.etapa
     group by c.etapa, c.ordem
  ),
  -- A caixa de vista: os marcados da EMB inteira, onde quer que estejam.
  marcados as (
    select 'divergencia'::text as etapa, 5 as ordem,
           count(*) as itens,
           count(*) as divergentes,
           null::numeric as media_segundos,
           null::numeric as maior_segundos,
           0::bigint as sem_tempo
      from item i
     where public.rec_divergente(i.divergencia)
  )
  select r.etapa, r.itens, r.divergentes, r.media_segundos, r.maior_segundos, r.sem_tempo
    from (select * from reais union all select * from marcados) r
   order by r.ordem;
end $func$;

-- ---------- Itens de uma caixa: `divergencia` devolve os marcados da EMB ----------
-- Para as quatro caixas de verdade nada muda. Para `divergencia`, o filtro deixa de ser a etapa e
-- passa a ser a marca — e o "desde" continua sendo o da caixa REAL do item, que é a informação
-- honesta: há quanto tempo ele está onde está.
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
declare
  v_etapa text := btrim(coalesce(p_etapa, ''));
  v_so_marcados boolean := v_etapa = 'divergencia';
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  with base as (
    select p.id, p.numero, p.codigo_material, p.descricao_material, p.quantidade_pedido,
           p.quantidade_recebida, p.divergencia, p.resultado, p.created_at, p.finalizado_em,
           public.rec_etapa_por_status(p.status) as etapa
      from public.processos_recebimento p
     where upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
       and (
         case when v_so_marcados
              then public.rec_divergente(p.divergencia)
              else public.rec_etapa_por_status(p.status) = v_etapa
         end
       )
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

-- Os grants das duas já existem desde a 0124 (create or replace não os derruba); repetidos aqui
-- para a migração ser autossuficiente se alguém aplicar num banco novo fora de ordem.
revoke all on function public.rec_fluxo_emb(text) from public, anon;
revoke all on function public.rec_fluxo_emb_itens(text, text, int) from public, anon;
grant execute on function public.rec_fluxo_emb(text) to authenticated;
grant execute on function public.rec_fluxo_emb_itens(text, text, int) to authenticated;

notify pgrst, 'reload schema';
