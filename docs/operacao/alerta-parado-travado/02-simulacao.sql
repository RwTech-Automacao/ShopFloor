-- Simulação ANTES de criar a regra "Parado ou travado" de produção. SÓ LEITURA (transação read only, desfeita
-- no fim). Mostra o que a regra do caso de uso (1 semana = 168 h, relógio corrido, todos os postos, só OPs
-- ativas, com peças em Manutenção) enxergaria AGORA. Para outra configuração, troque os três valores da
-- linha "with p" de cada consulta (são três: postos, horas, só ativas) e rode de novo.
-- Cada OP da tabela 2 vira UMA ocorrência = UM e-mail por destinatário por dia: se vier OP demais, restrinja
-- os postos ou os PMOs da regra antes de criá-la.
begin read only;

-- 1) Por OP e posto, a mais parada primeiro. horas_relogio = idade da peça mais antiga do grupo.
with p as (
  select (select array_agg(chave) from public.sf_postos) as postos,
         168 as horas, true as so_ativas, true as incluir_manutencao
)
select t.pmo, t.op, t.posto, case when t.reprovada then 'reprovadas (conserto)' else 'paradas' end as situacao,
       t.pecas, t.em as desde,
       round((extract(epoch from now() - t.em) / 3600)::numeric, 1) as horas_relogio,
       t.amostras as exemplos_de_sn
  from p,
       lateral public.alerta_travados(p.postos, '{}'::text[], now() - make_interval(hours => p.horas),
                                      p.so_ativas, p.incluir_manutencao) t
 order by t.em asc, t.pmo, t.op, t.posto;

-- 2) Resumo por OP: cada linha é uma ocorrência (um e-mail por dia por destinatário).
with p as (
  select (select array_agg(chave) from public.sf_postos) as postos,
         168 as horas, true as so_ativas, true as incluir_manutencao
)
select t.pmo, t.op, count(*) as linhas, sum(t.pecas) as pecas, min(t.em) as desde,
       round((extract(epoch from now() - min(t.em)) / 3600)::numeric, 1) as horas_relogio
  from p,
       lateral public.alerta_travados(p.postos, '{}'::text[], now() - make_interval(hours => p.horas),
                                      p.so_ativas, p.incluir_manutencao) t
 group by t.pmo, t.op
 order by min(t.em) asc, t.pmo, t.op;

-- 3) Quantas OPs e peças no total (o tamanho do primeiro e-mail do dia).
with p as (
  select (select array_agg(chave) from public.sf_postos) as postos,
         168 as horas, true as so_ativas, true as incluir_manutencao
)
select count(distinct (t.pmo, t.op)) as ops, coalesce(sum(t.pecas), 0) as pecas
  from p,
       lateral public.alerta_travados(p.postos, '{}'::text[], now() - make_interval(hours => p.horas),
                                      p.so_ativas, p.incluir_manutencao) t;

rollback;
