-- Simulação ANTES de criar a regra "Parado ou travado" de produção. SÓ LEITURA (transação read only, desfeita
-- no fim). Mostra o que a regra do caso de uso (1 semana = 168 h, relógio corrido, todos os postos, só OPs
-- ativas, com peças em Manutenção) enxergaria AGORA. Para outra configuração, troque os três valores da
-- linha "with p" de cada consulta (são três: postos, horas, só ativas) e rode de novo.
-- A regra gera UM relatório por dia útil por destinatário (todas as OPs da tabela 2 numa mensagem só). A
-- tabela 4 mostra como ficaria: se vier OP demais, a mensagem é cortada em 2000 caracteres ("… e mais K OPs");
-- restrinja os postos ou os PMOs da regra, ou marque só OPs ativas.
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

-- 2) Resumo por OP: cada linha é uma linha do relatório.
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

-- 3) Quantas OPs e peças no total (o assunto do e-mail: "N peças paradas há mais de X em M OPs").
with p as (
  select (select array_agg(chave) from public.sf_postos) as postos,
         168 as horas, true as so_ativas, true as incluir_manutencao
)
select count(distinct (t.pmo, t.op)) as ops, coalesce(sum(t.pecas), 0) as pecas
  from p,
       lateral public.alerta_travados(p.postos, '{}'::text[], now() - make_interval(hours => p.horas),
                                      p.so_ativas, p.incluir_manutencao) t;

-- 4) O relatório como ficaria (relógio corrido; a regra com turnos conta horas de expediente no app, então a
-- idade pode ser menor lá). Cada linha do resultado é uma linha da mensagem, na ordem; o app ainda corta a
-- lista em 2000 caracteres no total.
with p as (
  select (select array_agg(chave) from public.sf_postos) as postos,
         168 as horas, true as so_ativas, true as incluir_manutencao
), t as (
  select t.* from p,
         lateral public.alerta_travados(p.postos, '{}'::text[], now() - make_interval(hours => p.horas),
                                        p.so_ativas, p.incluir_manutencao) t
), por_op as (
  select pmo, op, sum(pecas) as pecas, min(em) as desde,
         string_agg(posto || ' (' || pecas || ')', ', ' order by em, posto) filter (where not reprovada) as postos,
         string_agg(posto || ' (' || pecas || ')', ', ' order by em, posto) filter (where reprovada) as consertos
    from t group by pmo, op
), linhas as (
  select desde, pmo, op,
         pmo || '/' || op || ' · ' || pecas || case when pecas = 1 then ' peça' else ' peças' end
         || ' · mais antiga há ' || case when now() - desde >= interval '1 day'
                                         then floor(extract(epoch from now() - desde) / 86400)::int || 'd'
                                         else floor(extract(epoch from now() - desde) / 3600)::int || ' h' end
         || coalesce(' · ' || postos, '')
         || coalesce(E'\n   ↳ reprovadas, aguardando conserto: ' || consertos, '') as linha
    from por_op
)
select 0 as ordem,
       '⏰ ' || coalesce(sum(pecas), 0) || ' peças paradas há mais de 7 dias em ' || count(*) || ' OPs' as texto
  from por_op
union all
select row_number() over (order by desde, pmo, op), linha from linhas
order by 1;

rollback;
