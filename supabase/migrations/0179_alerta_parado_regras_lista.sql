-- =============================================================
-- ALERTAS — LISTA DAS REGRAS "PARADO OU TRAVADO" para o seletor da aba "Peças paradas" (Análise)
--
-- A tela /shopfloor/analisar/parados (0177) ganhou aba na Análise. Sem `?regra=` ela abre na primeira regra
-- e mostra um seletor das outras. Quem abre a Análise tem `shopfloor.visualizar`, mas a RLS de alerta_regras
-- (0113/0149) só deixa ler quem ADMINISTRA o módulo. Por isso esta função security definer mínima:
--
--   alerta_parado_regras_lista(): id e nome das regras do tipo 'parado' ATIVAS e não excluídas, em ordem
--   alfabética (desempate pelo id). Nada além de id e nome: postos, PMOs e destinatários continuam só para
--   quem administra (a tela lê o resto pela alerta_parado_regra da 0177, regra a regra).
--
-- authenticated, com checagem `(select tem_permissao('shopfloor','visualizar'))` (sem permissão é ERRO
-- SEM_PERMISSAO, como na 0177, nunca lista vazia). Só leitura. Idempotente.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0179_alerta_parado_regras_lista.sql
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (a aba chama a função). O app antigo não a usa.
-- =============================================================

create or replace function public.alerta_parado_regras_lista()
returns table (id uuid, nome text)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
    select r.id, r.nome
      from public.alerta_regras r
     where r.tipo = 'parado' and r.ativa and r.excluida_em is null
     order by lower(r.nome), r.id;
end
$func$;

revoke all on function public.alerta_parado_regras_lista() from public, anon;
grant execute on function public.alerta_parado_regras_lista() to authenticated, service_role;

-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho. Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
