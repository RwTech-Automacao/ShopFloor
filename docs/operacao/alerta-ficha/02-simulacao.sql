-- Simulação ANTES de criar a regra "Ficha de apontamento". SÓ LEITURA (transação read only, desfeita no fim).
--
-- ⚠️ O QUE ISTO MOSTRA E O QUE NÃO MOSTRA. Mostra as caixas e lotes que estão AGORA na lista de confirmação do
-- Almoxarifado, de OPs não finalizadas, que fecharam/foram aprovados nos últimos 3 dias — com exatamente os campos
-- da ficha. Uma regra criada agora NÃO manda nenhuma delas (o piso é o momento em que a regra é criada): só
-- vão ficha as que NASCEREM depois. Serve para (a) conferir os campos e o RESPONSÁVEL contra a tela do Almoxarifado
-- ("fechada em ... por <nome>") e (b) ter ideia do volume por dia (no máximo 30 por rodada de 5 minutos).
-- Para ver só um PMO, troque '{}'::text[] por array['PMOF52_F'] nas consultas.
begin read only;

-- 1) As fichas que sairiam, a mais antiga primeiro (uma linha por caixa/lote).
select f.tipo, f.pmo, f.op, f.codigo as qr,
       to_char(f.em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as data_producao,
       f.produto, f.quantidade_op, f.pecas as quantidade_apontada,
       coalesce(f.responsavel, '—') as responsavel
  from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 1000) f
 order by f.em, f.pmo, f.op, f.chave;

-- 2) Resumo por OP e tipo.
select f.pmo, f.op, f.tipo, count(*) as fichas, sum(f.pecas) as pecas, min(f.em) as desde
  from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 100000) f
 group by f.pmo, f.op, f.tipo
 order by min(f.em), f.pmo, f.op;

-- 3) Quem aparece como responsável (se vier muito "—" ou um nome estranho, a regra do responsável precisa de ajuste:
--    é a função public.alerta_ficha_responsavel, de poucas linhas).
select coalesce(f.responsavel, '— (sem colaborador)') as responsavel, count(*) as fichas
  from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 100000) f
 group by 1
 order by 2 desc;

rollback;
