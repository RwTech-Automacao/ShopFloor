-- Conferência pós-migração + MEDIÇÃO do plano da lista de pendências do Almoxarifado (lição do incidente do NQA
-- de 22/10: medir com EXPLAIN ANALYZE logo depois de aplicar). Só lê (a medição roda dentro de uma transação
-- que é desfeita). Rode com: psql ... -f <este arquivo>   (opcional: -v email='outro@usuario.com')
-- O usuário usado na medição precisa ter recebimento.lancar e shopfloor.visualizar (o padrão é o do Matheus).
\if :{?email}
\else
  \set email 'matheus.silva@rwtech.com.br'
\endif

-- 1) As 6 funções do Almoxarifado/Fluxo existem? (ok = true)
select f as funcao, to_regprocedure(f) is not null as ok from (values
  ('public.sf_almox_posto_anterior(uuid,text)'),
  ('public.sf_almox_necessidades(text,text)'),
  ('public.sf_almox_lotes(text,text)'),
  ('public.sf_almox_pendencias()'),
  ('public.sf_almox_detalhe(text,text,text,uuid)'),
  ('public.sf_almoxarifado_lote(text,text,text,text,uuid,text[])')
) v(f);

-- 2) Medição: a função confere a permissão do usuário logado (auth.uid() lê as claims), então a transação
-- simula a sessão desse usuário; nada é gravado.
select u.id as uid from usuarios u where u.email = :'email' \gset
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
explain (analyze, buffers) select * from sf_almox_pendencias();
rollback;
