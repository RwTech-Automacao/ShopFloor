-- Testes SQL da 0122 (reabrir ocorrência resolvida que não foi resolvida de verdade). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_tipos_test.sql, na mesma base, com a
-- 0122 aplicada por cima da 0113/0114/0115 — igual à produção, onde já existem regras, ocorrências
-- e fila. Os helpers (teste_regra, teste_bipes, teste_fila, teste_contas_ana_bruno) foram criados
-- pelos testes anteriores e continuam na base.
--
-- Cobre os 6 casos da seção "Testes" da spec (Parte 1):
--   1. resolvida + condição ruim ANTES da carência  -> continua resolvida, nenhum envio;
--   2. a mesma DEPOIS da carência                   -> volta a 'aberta', reaberturas = 1, 1 alerta;
--   3. resolvida cuja condição NORMALIZOU           -> vira normalizada, não reabre;
--   4. carência por tipo de janela                  -> 'tempo' usa o N; 'bipes' e 'op' usam 60 min;
--   5. piso e teto                                  -> janela 5 min espera 15; 7 dias espera 2 h;
--   6. a reabertura renova o ciclo de lembrete.
--
-- A passagem do tempo é simulada como no resto da suíte: recuando `resolvida_em` /
-- `ultimo_envio_em` da ocorrência (a carência é medida a partir de resolvida_em).

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Colunas novas.
do $t$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'alerta_ocorrencias' and column_name = 'reaberta_em') then
    raise exception 'FALHOU: alerta_ocorrencias sem reaberta_em';
  end if;
  if exists (select 1 from alerta_ocorrencias where reaberturas is null or reaberturas <> 0) then
    raise exception 'FALHOU: ocorrências antigas deviam ficar com reaberturas = 0';
  end if;
  if exists (select 1 from alerta_ocorrencias where reaberta_em is not null) then
    raise exception 'FALHOU: ocorrências antigas deviam ficar sem reaberta_em';
  end if;
end $t$;

-- Preparação: tudo o que as suítes anteriores deixaram ligado sai do caminho, e a fila antiga
-- vira "desistiu" (tentativas = 3) para não se confundir com o que este arquivo enfileira.
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- T1. alerta_carencia_min: casos 4 e 5 da spec ----------
do $t$
begin
  -- caso 4: janela 'tempo' usa o próprio N
  if alerta_carencia_min('tempo', 60) <> 60 then raise exception 'FALHOU: carência de tempo 60'; end if;
  if alerta_carencia_min('tempo', 30) <> 30 then raise exception 'FALHOU: carência de tempo 30'; end if;
  -- caso 4: 'bipes' e 'op' usam 60 min fixos e NÃO leem janela_valor
  if alerta_carencia_min('bipes', 50)  <> 60 then raise exception 'FALHOU: carência de bipes'; end if;
  if alerta_carencia_min('bipes', 5)   <> 60 then raise exception 'FALHOU: carência de bipes leu o valor'; end if;
  if alerta_carencia_min('op', null)   <> 60 then raise exception 'FALHOU: carência da OP'; end if;
  if alerta_carencia_min('op', 9999)   <> 60 then raise exception 'FALHOU: carência da OP leu o valor'; end if;
  -- caso 5: piso de 15 min e teto de 2 h
  if alerta_carencia_min('tempo', 5)     <> 15  then raise exception 'FALHOU: piso de 15 min'; end if;
  if alerta_carencia_min('tempo', 1)     <> 15  then raise exception 'FALHOU: piso de 15 min (janela 1)'; end if;
  if alerta_carencia_min('tempo', 120)   <> 120 then raise exception 'FALHOU: teto exato de 2 h'; end if;
  if alerta_carencia_min('tempo', 10080) <> 120 then raise exception 'FALHOU: teto de 2 h (7 dias)'; end if;
  -- valor ausente/absurdo na janela de tempo cai no fixo (falha segura, não em 15 min de spam)
  if alerta_carencia_min('tempo', null) <> 60 then raise exception 'FALHOU: janela de tempo sem valor'; end if;
  if alerta_carencia_min('tempo', 0)    <> 60 then raise exception 'FALHOU: janela de tempo com 0'; end if;
end $t$;

-- ---------- T2. Casos 1, 2 e 6: carência, reabertura e o ciclo de lembrete ----------
-- Taxa de aprovação, janela de 60 min (carência = 60), lembrete a cada 10 min.
-- 15 aprovados + 5 reprovados = 75% < 90.
select public.teste_bipes('R-Posto', 'PMOA', '1', 15, 5, 10);
do $t$
begin
  perform teste_regra('Reab taxa', 'aprovacao', array['R-Posto'], 90, 'tempo', 60, 10,
                      null, null, null, '{}', 10);
end $t$;

-- Abre normalmente.
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab taxa', 'R-Posto');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: alerta inicial %', a; end if;
  if a ? 'reabertura' then raise exception 'FALHOU: alerta inicial marcado como reabertura %', a; end if;
end $t$;
reset role;

-- O gestor aperta "Resolvido" (pela tela).
set role authenticated;
do $t$
declare r jsonb;
begin
  select alerta_resolver_admin(oc.id) into r
    from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Reab taxa' and oc.estado = 'aberta';
  if r is null or (r->>'ja_resolvida')::boolean then raise exception 'FALHOU: resolver %', r; end if;
end $t$;
reset role;

-- CASO 1: o problema continua, mas ainda estamos DENTRO da carência (resolvida agora mesmo).
set role service_role;
do $t$
begin
  perform alerta_avaliar();
  if teste_fila('Reab taxa', 'R-Posto') is not null then
    raise exception 'FALHOU: reabriu (ou lembrou) dentro da carência';
  end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Reab taxa' and oc.estado = 'resolvida'
                    and oc.reaberturas = 0 and oc.reaberta_em is null) then
    raise exception 'FALHOU: dentro da carência a ocorrência devia continuar resolvida e intacta';
  end if;
end $t$;
reset role;

-- CASO 2 + CASO 6 (preparação): a carência vence (resolvida há 61 min) e `ultimo_envio_em` fica
-- BEM velho de propósito — se a reabertura não renovasse o ciclo, a avaliação seguinte mandaria
-- um lembrete na hora, e é justamente isso que o caso 6 tem que provar que não acontece.
update public.alerta_ocorrencias oc
   set resolvida_em    = now() - interval '61 minutes',
       ultimo_envio_em = now() - interval '2 hours'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab taxa' and oc.estado = 'resolvida';

set role service_role;
do $t$
declare a jsonb; o public.alerta_ocorrencias;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab taxa', 'R-Posto');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: reabertura sem alerta %', a; end if;
  if (a->>'reabertura')::boolean is not true then raise exception 'FALHOU: alerta sem a marca de reabertura %', a; end if;
  if a->>'resolvida_por_nome' <> 'Ana Gestora' then raise exception 'FALHOU: quem resolveu no texto %', a; end if;
  if a->>'resolvida_em' is null then raise exception 'FALHOU: reabertura sem resolvida_em %', a; end if;
  if (a->>'reaberturas')::int <> 1 then raise exception 'FALHOU: contagem de reaberturas nos dados %', a; end if;
  -- Mesmos destinos do alerta normal: uma linha por destinatário x canal.
  if (a->>'n')::int <> teste_contas_ana_bruno() then raise exception 'FALHOU: destinos da reabertura %', a; end if;

  select oc.* into o from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Reab taxa';
  if o.estado <> 'aberta' then raise exception 'FALHOU: não voltou para aberta (%)', o.estado; end if;
  if o.reaberturas <> 1 then raise exception 'FALHOU: reaberturas = % ', o.reaberturas; end if;
  if o.reaberta_em is null then raise exception 'FALHOU: reaberta_em vazio'; end if;
  -- Auditoria honesta: quem resolveu e quando ficam gravados.
  if o.resolvida_por is null or o.resolvida_em is null then
    raise exception 'FALHOU: reabertura apagou resolvida_por/resolvida_em';
  end if;
  -- CASO 6: o ciclo de lembrete recomeça do zero.
  if o.ultimo_envio_em <> now() then raise exception 'FALHOU: ultimo_envio_em não foi renovado'; end if;
  -- O alerta da reabertura leva o botão "Resolvido" (é um alerta como os outros).
  if not exists (select 1 from alerta_envios e
                  where e.ocorrencia_id = o.id and e.criado_em = now() and e.tipo = 'alerta' and e.com_botao) then
    raise exception 'FALHOU: alerta da reabertura sem botão';
  end if;
end $t$;
reset role;

-- CASO 6: logo depois da reabertura, o lembrete de 10 min NÃO sai (o relógio foi zerado).
set role service_role;
do $t$
begin
  perform alerta_avaliar();
  if teste_fila('Reab taxa', 'R-Posto') is not null then
    raise exception 'FALHOU: lembrete saiu logo depois da reabertura (ciclo não renovado)';
  end if;
end $t$;
reset role;

-- CASO 6: passados 11 min da reabertura, o lembrete volta a sair normalmente.
update public.alerta_ocorrencias oc
   set ultimo_envio_em = now() - interval '11 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab taxa';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab taxa', 'R-Posto');
  if a is null or a->>'tipo' <> 'lembrete' then raise exception 'FALHOU: lembrete depois da reabertura %', a; end if;
  if a ? 'reabertura' then raise exception 'FALHOU: lembrete marcado como reabertura %', a; end if;
end $t$;
reset role;

-- O botão "Resolvido" volta a valer (a ocorrência está aberta de novo) e uma 2ª reabertura conta 2.
set role authenticated;
do $t$
declare r jsonb;
begin
  select alerta_resolver_admin(oc.id) into r
    from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Reab taxa' and oc.estado = 'aberta';
  if r is null or (r->>'ja_resolvida')::boolean then
    raise exception 'FALHOU: Resolvido não valeu depois da reabertura %', r;
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '61 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab taxa' and oc.estado = 'resolvida';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab taxa', 'R-Posto');
  if a is null or (a->>'reaberturas')::int <> 2 then raise exception 'FALHOU: 2ª reabertura %', a; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Reab taxa' and oc.estado = 'aberta' and oc.reaberturas = 2) then
    raise exception 'FALHOU: sem teto de reaberturas — a 2ª devia contar 2';
  end if;
end $t$;
reset role;

-- ---------- T3. CASO 3: resolvida cuja condição NORMALIZOU não reabre ----------
-- 8 aprovados + 2 reprovados = 80% < 90 (mínimo 10 bipes).
select public.teste_bipes('R-Norm', 'PMOA', '1', 8, 2, 10);
do $t$
begin
  perform teste_regra('Reab normaliza', 'aprovacao', array['R-Norm'], 90, 'tempo', 60, 10,
                      null, null, null);
end $t$;
set role service_role;
do $t$
begin
  perform alerta_avaliar();
  if teste_fila('Reab normaliza', 'R-Norm') is null then raise exception 'FALHOU: alerta do R-Norm'; end if;
end $t$;
reset role;
set role authenticated;
do $t$
begin
  perform alerta_resolver_admin((select oc.id from alerta_ocorrencias oc
                                  join alerta_regras rg on rg.id = oc.regra_id
                                 where rg.nome = 'Reab normaliza' and oc.estado = 'aberta'));
end $t$;
reset role;
-- A carência vence E o posto melhora de verdade: 48 aprovados em 50 = 96%.
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '61 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab normaliza';
select public.teste_bipes('R-Norm', 'PMOA', '1', 40, 0, 5);
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab normaliza', 'R-Norm');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: devia normalizar, não reabrir %', a; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Reab normaliza' and oc.estado = 'normalizada'
                    and oc.reaberturas = 0 and oc.reaberta_em is null) then
    raise exception 'FALHOU: a ocorrência do R-Norm devia ficar normalizada, sem reabertura';
  end if;
end $t$;
reset role;

-- ---------- T4. CASO 4 no comportamento: janela por BIPES espera 60 min, não 50 ----------
-- A regra olha os últimos 50 bipes. Se a carência lesse o campo da janela, 55 min já reabririam.
select public.teste_bipes('R-Bipes', 'PMOA', '1', 15, 5, 10);
do $t$
begin
  perform teste_regra('Reab bipes', 'aprovacao', array['R-Bipes'], 90, 'bipes', 50, 10,
                      null, null, null);
end $t$;
set role service_role;
do $t$ begin
  perform alerta_avaliar();
  if teste_fila('Reab bipes', 'R-Bipes') is null then raise exception 'FALHOU: alerta do R-Bipes'; end if;
end $t$;
reset role;
set role authenticated;
do $t$ begin
  perform alerta_resolver_admin((select oc.id from alerta_ocorrencias oc
                                  join alerta_regras rg on rg.id = oc.regra_id
                                 where rg.nome = 'Reab bipes' and oc.estado = 'aberta'));
end $t$;
reset role;
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '55 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab bipes';
set role service_role;
do $t$ begin
  perform alerta_avaliar();
  if teste_fila('Reab bipes', 'R-Bipes') is not null then
    raise exception 'FALHOU: janela por bipes reabriu com 55 min (leu os 50 do campo)';
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '61 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab bipes';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab bipes', 'R-Bipes');
  if a is null or (a->>'reabertura')::boolean is not true then
    raise exception 'FALHOU: janela por bipes não reabriu com 61 min %', a;
  end if;
end $t$;
reset role;

-- ---------- T5. CASO 5 no comportamento: piso de 15 min numa janela de 5 min ----------
select public.teste_bipes('R-Curta', 'PMOA', '1', 15, 5, 1);
do $t$
begin
  perform teste_regra('Reab curta', 'aprovacao', array['R-Curta'], 90, 'tempo', 5, 10,
                      null, null, null);
end $t$;
set role service_role;
do $t$ begin
  perform alerta_avaliar();
  if teste_fila('Reab curta', 'R-Curta') is null then raise exception 'FALHOU: alerta do R-Curta'; end if;
end $t$;
reset role;
set role authenticated;
do $t$ begin
  perform alerta_resolver_admin((select oc.id from alerta_ocorrencias oc
                                  join alerta_regras rg on rg.id = oc.regra_id
                                 where rg.nome = 'Reab curta' and oc.estado = 'aberta'));
end $t$;
reset role;
-- 6 min: já passou a janela de 5, mas NÃO o piso de 15.
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '6 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab curta';
set role service_role;
do $t$ begin
  perform alerta_avaliar();
  if teste_fila('Reab curta', 'R-Curta') is not null then
    raise exception 'FALHOU: janela de 5 min reabriu em 6 min (piso de 15 não segurou)';
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias oc
   set resolvida_em = now() - interval '16 minutes'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome = 'Reab curta';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Reab curta', 'R-Curta');
  if a is null or (a->>'reabertura')::boolean is not true then
    raise exception 'FALHOU: piso de 15 min não reabriu em 16 min %', a;
  end if;
end $t$;
reset role;

-- ---------- T6. A fila entrega a reabertura (a reserva volta a ver a ocorrência) ----------
-- A linha de alerta da reabertura só é reservável porque a ocorrência voltou a 'aberta' — este é o
-- filtro `oc.estado = 'aberta'` da reserva, que antes da 0122 barrava tudo depois do "Resolvido".
set role service_role;
do $t$
declare v int;
begin
  select count(*) into v
    from alerta_reservar_envios(array['telegram', 'discord'], 100)
   where tipo = 'alerta';
  if v = 0 then raise exception 'FALHOU: a reserva não entregou nenhum alerta de reabertura'; end if;
end $t$;
reset role;

-- ---------- T7. A lista de ocorrências devolve reaberta_em e reaberturas ----------
set role authenticated;
do $t$
declare v record;
begin
  select * into v
    from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', '')
   where regra_nome = 'Reab taxa';
  if v is null then raise exception 'FALHOU: a lista não trouxe a ocorrência reaberta'; end if;
  if v.reaberturas <> 2 then raise exception 'FALHOU: reaberturas na lista = %', v.reaberturas; end if;
  if v.reaberta_em is null then raise exception 'FALHOU: reaberta_em na lista'; end if;
end $t$;
reset role;
