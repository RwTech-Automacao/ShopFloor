-- A RPC `processos_vizinhos` (0016) nasceu para a lista antiga e ficou duplamente
-- obsoleta: (1) ORDER BY fixo com a ordem do accordion por mês, que não existe mais
-- desde o grid (Fase 1); (2) parâmetros p_busca/p_status, o modelo de filtro da lista
-- antiga — o grid filtra por coluna arbitrária.
-- As setas passam a calcular os vizinhos com a MESMA consulta do grid (listarIdsGrid),
-- então esta função não tem mais chamador.
drop function if exists public.processos_vizinhos(uuid, text, text);
