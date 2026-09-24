-- =============================================================
-- Recebimento — histórico de uma etapa (painel do Fluxo).
--
-- Clicar num nó do Fluxo do ShopFloor abre um painel com "agora" (pendentes no posto) E o
-- "histórico do posto" (uma linha por passagem, mais recente primeiro, paginado). Esta migração dá
-- ao Recebimento o mesmo histórico: quem passou por aquela etapa e quando.
--
-- "Passou pela etapa X" = evento cuja PASSAGEM envolve X — entrou em X, trabalhou em X, ou saiu de
-- X. É uma regra só, e cobre as quatro caixas:
--   Recebimento → as criações (→ Recebimento) e as saídas (Recebimento → Qualidade)
--   Qualidade   → entradas, salvamentos da seção Qualidade, reaberturas e finalizações
--   Almoxarifado/Reprovado → as chegadas (e a reabertura, que tira o item de lá)
--
-- Precisa da etapa de ORIGEM do evento, que a 0124 não calculava (ela só derivava o destino).
-- Espelha o `de` de `passagemDoEvento` (src/modules/recebimento/domain/etapa-processo.ts).
--
-- Somente leitura. Corpo em $func$ ($$ não passa no SQL Editor do Supabase). Aditiva e idempotente.
-- =============================================================

-- Caixa de ONDE o item saiu no evento. null = não saiu de lugar nenhum (criação, edição na própria
-- caixa, ou evento que não diz nada sobre o fluxo).
create or replace function public.rec_etapa_origem_do_log(p_acao text, p_descricao text, p_dados jsonb)
returns text
language sql
stable
set search_path = public
as $func$
  select case
    when p_acao = 'mudar_status' then
      case
        when btrim(coalesce(p_dados->>'para', '')) = 'em_conferencia' then
          case when btrim(coalesce(p_dados->>'de', '')) in ('', 'aberto')
               then null  -- promoção automática do 1º salvamento: não é passagem
               else public.rec_etapa_por_resultado(p_dados->>'de') end  -- reabertura: saiu do terminal
        when btrim(coalesce(p_dados->>'para', '')) in ('', 'aberto') then null
        else 'qualidade'  -- finalização: sai da Qualidade
      end
    when p_acao = 'alterar_campo' then
      -- Salvar a seção Recebimento tira o item do Recebimento; salvar a Qualidade não o move.
      case when public.rec_secao_do_log(p_descricao, p_dados) = 'recebimento' then 'recebimento' end
    else null  -- 'criar' nasce: não vem de caixa nenhuma
  end
$func$;

-- ---------- Histórico de uma etapa da EMB ----------
-- Mais recente primeiro, paginado (p_offset/p_limite), como o histórico do posto do ShopFloor.
-- `total` (window count) vai em toda linha pra tela saber se ainda tem mais sem 2ª consulta.
-- As colunas de identidade do item vêm do PROCESSO (estado atual da linha), não do log.
create or replace function public.rec_fluxo_emb_historico(
  p_emb text,
  p_etapa text,
  p_offset int default 0,
  p_limite int default 100
)
returns table (
  id uuid,
  data_hora timestamptz,
  colaborador text,
  processo_id uuid,
  numero bigint,
  item text,
  descricao text,
  acao text,
  secao text,
  etapa text,
  etapa_origem text,
  status_de text,
  status_para text,
  total bigint
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_limite int := least(greatest(1, coalesce(p_limite, 100)), 1000);
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_etapa text := btrim(coalesce(p_etapa, ''));
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  with evento as (
    select l.id, l.created_at, l.usuario_nome, l.acao, l.descricao, l.dados,
           p.id as processo_id, p.numero, p.codigo_material, p.descricao_material,
           public.rec_secao_do_log(l.descricao, l.dados) as secao,
           public.rec_etapa_do_log(l.acao, l.descricao, l.dados) as etapa,
           public.rec_etapa_origem_do_log(l.acao, l.descricao, l.dados) as etapa_origem
      from public.logs l
      join public.processos_recebimento p on p.id = l.entidade_id
     where l.entidade = 'processo'
       and l.acao in ('criar', 'alterar_campo', 'mudar_status')
       and upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
  ),
  filtrado as (
    -- Envolve a etapa: chegou nela, trabalhou nela, ou saiu dela.
    select * from evento e where e.etapa = v_etapa or e.etapa_origem = v_etapa
  )
  select f.id, f.created_at, coalesce(f.usuario_nome, ''),
         f.processo_id, f.numero,
         coalesce(f.codigo_material, ''), coalesce(f.descricao_material, ''),
         f.acao, f.secao, f.etapa, f.etapa_origem,
         f.dados->>'de', f.dados->>'para',
         count(*) over ()
    from filtrado f
   order by f.created_at desc, f.id desc
   offset v_offset
   limit v_limite;
end $func$;

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key (pública, está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
revoke all on function public.rec_etapa_origem_do_log(text, text, jsonb) from public, anon, authenticated;

revoke all on function public.rec_fluxo_emb_historico(text, text, int, int) from public, anon;
grant execute on function public.rec_fluxo_emb_historico(text, text, int, int) to authenticated;

notify pgrst, 'reload schema';
