-- Tela de Defeitos (Fluxo) — ranking por defeito + ocorrências na ÚLTIMA HORA, agregados NO BANCO.
--
-- A tela mostra (a) um ranking com o total de defeitos da OP e (b) em cada card, quantas vezes
-- aquele MESMO defeito ocorreu na última hora (o campeão da hora fica vermelho). Contar isso no
-- cliente exigiria puxar TODAS as linhas de defeito da OP — dezenas de milhares em produção, e o
-- PostgREST ainda corta em 1000 sem avisar. Um group by no banco devolve dezenas de linhas.
--
-- "Defeito semelhante" = MESMO `codigo_defeito` (o texto do catálogo). A posição não entra: o mesmo
-- defeito em H1 e em H2 é o mesmo problema pra quem acompanha a linha.
--
-- p_posto = '' → OP inteira. Com posto, casa `posto` OU `posto_origem` — mesma regra da lista
-- (0095/listarDefeitosDaOp): a reprova que virou reparo na Manutenção guarda o posto do teste em
-- posto_origem, e ela pertence ao posto que reprovou.
--
-- Índice: `sf_registros_defeitos_op` (0095) cobre (pmo, op) com o filtro parcial codigo_defeito <> ''.

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
    and (p_posto = '' or r.posto = p_posto or r.posto_origem = p_posto)
  group by r.codigo_defeito
  order by count(*) desc, r.codigo_defeito;
end;
$func$;

grant execute on function public.sf_defeitos_resumo(text, text, text) to authenticated;

notify pgrst, 'reload schema';
