-- Massa sintética em volume de produção para medir alerta_travados (0172). Usada por
-- supabase/tests/rodar-alertas-travados-medir.sh; NÃO roda no runner de alertas (é lenta de propósito).
--   200 OPs (80 ativas, 120 finalizadas), rota de 5 postos, 1000 peças por OP; 70% das peças terminam e o
--   resto para num posto qualquer (ou volta reprovada, 3%); datas espalhadas em ~120 dias. ≈ 850 mil registros.
-- Entra numa transação só e SEM ANALYZE depois: é o estado de uma tabela/OP nova em que o planejador não tem
-- estatística (a lição da 0167 — o plano ruim só aparece assim).
begin;
insert into public.sf_ordens (pmo, op, status)
select 'PMO' || lpad((g / 10)::text, 3, '0'), 'OP' || lpad(g::text, 4, '0'),
       case when g % 5 < 2 then 'ATIVA' else 'FINALIZADA' end
  from generate_series(1, 200) g;

insert into public.sf_ordem_postos (ordem_id, posto, ordem)
select o.id, p.posto, p.ordem
  from public.sf_ordens o
 cross join (values ('Inicial', 1), ('Teste', 2), ('Embalagem', 3), ('Inspeção', 4), ('Almoxarifado', 5)) p(posto, ordem);

insert into public.sf_registros (pmo, op, numero_serie, numero_serie_norm, posto, status, data_hora, pecas)
select o.pmo, o.op, 'SN' || o.op || '-' || s, upper('SN' || o.op || '-' || s), p.posto,
       case when abs(hashtext(o.op || s || p.posto)) % 100 < 3 then 'Reprovado' else 'Aprovado' end,
       now() - make_interval(days => (abs(hashtext(o.op)) % 120)) + make_interval(hours => 6 * p.ordem),
       1
  from public.sf_ordens o
 cross join generate_series(1, 1000) s
 cross join lateral (select posto, ordem from public.sf_ordem_postos where ordem_id = o.id) p
 where p.ordem <= case when abs(hashtext(o.op || '-' || s)) % 10 < 7 then 5
                       else 1 + abs(hashtext(s || o.op)) % 4 end;
commit;
