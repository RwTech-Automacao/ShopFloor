-- =============================================================
-- Fluxo do Recebimento: os itens de uma caixa passam a trazer a justificativa da divergência.
--
-- O selo (? / ✅) do card do Fluxo precisa de três coisas que a 0142 pôs na linha do processo: o
-- texto, o NOME de quem justificou e quando. O nome vem da própria linha (denormalizado na 0142)
-- e não de `usuarios`, cuja policy de leitura esconde os outros.
--
-- Mudou o TIPO DE RETORNO (três colunas novas), e `create or replace` não aceita isso: por isso o
-- `drop function if exists` antes do `create`. Idempotente: reaplicar derruba e recria igual. Os
-- grants são refeitos aqui porque o drop leva os anteriores junto.
-- =============================================================

drop function if exists public.rec_fluxo_emb_itens(text, text, int);
create function public.rec_fluxo_emb_itens(
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
  segundos numeric,
  divergencia_justificativa text,
  divergencia_justificada_por_nome text,
  divergencia_justificada_em timestamptz
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
           p.divergencia_justificativa, p.divergencia_justificada_por_nome, p.divergencia_justificada_em,
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
         extract(epoch from (now() - i.desde)),
         -- A justificativa e o NOME de quem a escreveu vêm da própria linha: ler o nome em `usuarios`
         -- não serve, a policy de lá só deixa ler a si mesmo ou quem administra o sistema.
         coalesce(i.divergencia_justificativa, ''),
         coalesce(i.divergencia_justificada_por_nome, ''),
         i.divergencia_justificada_em
    from item i
   -- nulls last: item sem tempo conhecido vai pro fim (a tela mostra "—" nele).
   order by i.desde asc nulls last, i.numero asc
   limit greatest(1, coalesce(p_limite, 500));
end $func$;

revoke all on function public.rec_fluxo_emb_itens(text, text, int) from public, anon;
grant execute on function public.rec_fluxo_emb_itens(text, text, int) to authenticated;

notify pgrst, 'reload schema';
