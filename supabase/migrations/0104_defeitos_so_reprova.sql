-- =============================================================
-- Defeitos contam só a REPROVA — não os registros de Manutenção.
--
-- Uma reprova no Teste com o defeito X gerava VÁRIAS linhas com o código X em sf_registros:
--   1. a reprova, no posto que reprovou (status 'Reprovado');
--   2. uma linha por CONSERTO na Manutenção — `sf_registrar_reparo` copia o defeito relatado nela;
--   3. uma linha por DEFEITO CONSTATADO na Manutenção.
-- As linhas 2 e 3 nascem com status vazio. Contando `count(*)` de toda linha com código, uma única
-- falha consertada com dois consertos aparecia QUATRO vezes no ranking: o número media quantos
-- consertos cada peça teve, não quantas vezes o defeito aconteceu.
--
-- Decisão do usuário (11/09/2026): conta o defeito da REPROVA — o que o testador viu na linha, que
-- existe no instante da reprova (a tela é de "o que está falhando agora"). O constatado, que só
-- existe depois do reparo, fica de fora.
--
-- Com isso o filtro de posto deixa de precisar do `posto_origem`: ele só existe nas linhas da
-- Manutenção, que não entram mais. A reprova sempre traz o posto que reprovou em `posto`.
--
-- Mesma assinatura da 0099 → os grants se mantêm. Índice `sf_registros_defeitos_op` (0095) segue
-- servindo: o filtro de status só enxuga as linhas que ele já entrega.
-- =============================================================

create or replace function public.sf_defeitos_resumo(
  p_pmo   text,
  p_op    text,
  p_posto text default ''
)
returns table (codigo text, total int, ultima_hora int)
language plpgsql
stable
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  select r.codigo_defeito,
         count(*)::int,
         -- Janela DESLIZANTE de 60 min (não é "a hora cheia"): é o ritmo do chão de fábrica agora.
         count(*) filter (where r.data_hora >= now() - interval '1 hour')::int
  from sf_registros r
  where r.pmo = p_pmo and r.op = p_op and r.codigo_defeito <> ''
    and lower(r.status) = 'reprovado'
    and (p_posto = '' or r.posto = p_posto)
  group by r.codigo_defeito
  order by count(*) desc, r.codigo_defeito;
end;
$func$;

notify pgrst, 'reload schema';
