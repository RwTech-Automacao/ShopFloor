-- Simulação ANTES da primeira regra de produção. SÓ LEITURA (transação read only, desfeita no fim).
-- Lista tudo o que o alerta de parado enxergaria AGORA (o que sf_almox_pendencias_base() devolve),
-- com a idade em horas de RELÓGIO (o alerta conta horas de EXPEDIENTE, que são menos: use esta idade
-- como teto). "desde" = a hora mais antiga do item (das peças avulsas, a da peça mais antiga).
begin read only;

-- 1) Item a item, o mais antigo primeiro.
select pmo, op, tipo, codigo, pecas,
       coalesce(em_mais_antiga, em) as desde,
       round((extract(epoch from now() - coalesce(em_mais_antiga, em)) / 3600)::numeric, 1) as horas_relogio
  from public.sf_almox_pendencias_base()
 order by coalesce(em_mais_antiga, em) asc, pmo, op, codigo;

-- 2) Resumo por OP: quantos itens, quantas placas e a idade do mais antigo. Cada OP vira UMA ocorrência.
select pmo, op, count(*) as itens, sum(pecas) as placas,
       min(coalesce(em_mais_antiga, em)) as desde,
       round((extract(epoch from now() - min(coalesce(em_mais_antiga, em))) / 3600)::numeric, 1) as horas_relogio
  from public.sf_almox_pendencias_base()
 group by pmo, op
 order by min(coalesce(em_mais_antiga, em)) asc, pmo, op;

rollback;
