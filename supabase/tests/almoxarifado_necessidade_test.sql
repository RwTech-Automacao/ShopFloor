-- Testes da 0155: a entrada do Almoxarifado olha o POSTO ANTERIOR da rota, e a lista de necessidades
-- (sf_almox_necessidades). Roda DEPOIS do almoxarifado_test.sql, na mesma base (reaproveita os stubs,
-- os perfis 'passagem'/'embalagem'/'almoxarifado'/'nqa' e os postos 'Embalagem', 'Inspeção Final',
-- 'Inspeção NQA' e 'Almoxarifado'). Massa própria, em OPs novas (PMON*), pra não mexer nos números
-- absolutos do arquivo antigo.
-- Runner: supabase/tests/rodar-almoxarifado-test.sh

select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);

-- Um posto com status de verdade (gate 'aprovado'), que não é NQA: a regra genérica.
-- (O stub do perfil 'nqa' tem gate 'registrado'; a 0155 trata recurso 'nqa' como "precisa Aprovado"
-- de qualquer jeito — o perfil de produção tem gate 'aprovado' — e os testes abaixo provam isso.)
insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso)
values ('inspecao', 'Inspeção (defeitos)', true, 'defeitos', 'aprovado', false, 'nenhum')
on conflict (chave) do nothing;
insert into public.sf_postos (chave, ordem, perfil) values ('Inspeção Saída', 8, 'inspecao');

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMON01', '9101', 'Cliente N', '5000', '5100', true),   -- peça, anterior = Inspeção Saída (aprovado)
  ('PMON02', '9102', 'Cliente N', '5100', '5200', true),   -- peça, anterior = Inspeção Final (registrado)
  ('PMON03', '9103', 'Cliente N', '5200', '5300', true),   -- peça, Almoxarifado é o PRIMEIRO da rota
  ('PMON04', '9104', 'Cliente N', '5300', '5400', true),   -- peça, anterior = Inspeção NQA
  ('PMON11', '9111', 'Cliente N', '6000', '6100', false),  -- caixa, anterior = Embalagem
  ('PMON12', '9112', 'Cliente N', '6100', '6200', false),  -- caixa, anterior = Inspeção NQA
  ('PMON13', '9113', 'Cliente N', '6200', '6300', false),  -- caixa, anterior = Inspeção Saída (aprovado)
  ('PMON14', '9114', 'Cliente N', '6300', '6400', false),  -- caixa, anterior = Inspeção Final (registrado)
  ('PMON15', '9115', 'Cliente N', '6400', '6500', false),  -- caixa, Almoxarifado é o PRIMEIRO da rota
  ('PMON16', '9116', 'Cliente N', '6500', '6600', false),  -- necessidades (anterior = Inspeção NQA)
  ('PMON17', '9117', 'Cliente N', '6600', '6700', false);  -- necessidades: OP SEM Almoxarifado na rota
do $t$ begin
  perform public.teste_op_postos('PMON01', '9101', array['Embalagem', 'Inspeção Saída', 'Almoxarifado']);
  perform public.teste_op_postos('PMON02', '9102', array['Embalagem', 'Inspeção Final', 'Almoxarifado']);
  perform public.teste_op_postos('PMON03', '9103', array['Almoxarifado', 'Embalagem']);
  perform public.teste_op_postos('PMON04', '9104', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMON11', '9111', array['Inspeção Saída', 'Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMON12', '9112', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMON13', '9113', array['Embalagem', 'Inspeção Saída', 'Almoxarifado']);
  perform public.teste_op_postos('PMON14', '9114', array['Embalagem', 'Inspeção Final', 'Almoxarifado']);
  perform public.teste_op_postos('PMON15', '9115', array['Almoxarifado', 'Embalagem']);
  perform public.teste_op_postos('PMON16', '9116', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMON17', '9117', array['Embalagem', 'Inspeção NQA']);
end $t$;

-- Atalhos de massa. Cada linha com um data_hora EXPLÍCITO quando a ordem importa (reprovado → aprovado).
create function public.teste_reg(p_pmo text, p_op text, p_posto text, p_sn text, p_status text,
                                 p_caixa text default '', p_quando timestamptz default now())
returns void language sql as $f$
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, status,
                                   numero_serie, numero_serie_norm, data_hora)
  values ('Massa', p_posto, p_pmo, p_op, 'Cliente N', p_caixa, p_status, p_sn, p_sn, p_quando);
$f$;
-- Caixa fechada com N peças carimbadas na Embalagem (como sf_fechar_caixa deixa).
create function public.teste_caixa(p_pmo text, p_op text, p_seq int, p_sn0 int, p_n int,
                                   p_fechada boolean default true, p_revisao int default 0)
returns text language plpgsql as $f$
declare v_cod text;
begin
  v_cod := case when p_revisao > 0
                then 'CX[' || p_seq || ']R[' || p_n || ']' || p_op || '-' || p_pmo
                else 'CX[' || p_seq || '][' || p_n || ']' || p_op || '-' || p_pmo end;
  insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
  values (p_pmo, p_op, 'Embalagem', p_seq, p_n, p_n, v_cod, p_fechada, p_revisao,
          case when p_fechada then now() end);
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  select 'Massa', 'Embalagem', p_pmo, p_op, 'Cliente N', v_cod, (p_sn0 + i)::text, (p_sn0 + i)::text
    from generate_series(0, p_n - 1) i;
  return v_cod;
end $f$;
-- Recusa padrão: ok=false, motivo, e NADA gravado (nem registro, nem fila) pro bipe.
create function public.teste_recusa_sem_rastro(r jsonb, p_motivo text, p_pmo text, p_onde text)
returns void language plpgsql as $f$
begin
  if coalesce((r->>'ok')::boolean, true) is not false or r->>'motivo' is distinct from p_motivo then
    raise exception 'FALHOU (%): esperava % e veio %', p_onde, p_motivo, r; end if;
  if r ? 'quantidade' then
    raise exception 'FALHOU (%): recusa não devolve quantidade: %', p_onde, r; end if;
end $f$;
create function public.teste_aceito(r jsonb, p_qtd int, p_onde text)
returns void language plpgsql as $f$
begin
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'quantidade')::int <> p_qtd then
    raise exception 'FALHOU (%): esperava ok com % peça(s), veio %', p_onde, p_qtd, r; end if;
end $f$;

-- =============================================================
-- N1. PEÇA, anterior com gate 'aprovado' (Inspeção Saída)
-- =============================================================
do $t$
declare r jsonb; t0 timestamptz := now() - interval '1 hour';
begin
  -- Toda peça foi embalada (senão cairia em serie_sem_embalagem, que vem ANTES e não muda).
  perform teste_reg('PMON01', '9101', 'Embalagem', s::text, '', s::text) from generate_series(5001, 5006) s;
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5001', 'Aprovado');
  -- 5002: nada na Inspeção Saída.
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5003', 'Reprovado', '', t0);
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5003', 'Aprovado',  '', t0 + interval '10 min');
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5004', 'Aprovado',  '', t0);
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5004', 'Reprovado', '', t0 + interval '10 min');
  perform teste_reg('PMON01', '9101', 'Inspeção Saída', '5005', 'Reprovado');
  -- 5006: aprovada em OUTRO posto com status (não o anterior): não conta.
  perform teste_reg('PMON01', '9101', 'Inspeção NQA', '5006', 'Aprovado');

  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5001', 'serie', 1, '5001');
  perform teste_aceito(r, 1, 'N1 aprovada no anterior');

  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5002', 'serie', 1, '5002');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON01', 'N1 sem registro no anterior');
  if r->>'detalhe' not like '%5002%' or r->>'detalhe' not like '%Inspeção Saída%'
     or r->>'detalhe' not like '%provad%' then
    raise exception 'FALHOU (N1): o detalhe tem que dizer a peça, o posto anterior e que precisa estar aprovada: %', r; end if;
  if r->>'posto_anterior' is distinct from 'Inspeção Saída' or (r->>'precisa_aprovado')::boolean is not true then
    raise exception 'FALHOU (N1): posto_anterior/precisa_aprovado no jsonb: %', r; end if;

  -- "EXISTE Aprovado" (paridade com o Lançamento, 0031/0103): reprovada e depois aprovada PASSA…
  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5003', 'serie', 1, '5003');
  perform teste_aceito(r, 1, 'N1 reprovada → aprovada');
  -- …e aprovada e depois reprovada TAMBÉM passa (é a regra de hoje, não o último status).
  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5004', 'serie', 1, '5004');
  perform teste_aceito(r, 1, 'N1 aprovada → reprovada (existe Aprovado)');

  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5005', 'serie', 1, '5005');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON01', 'N1 só reprovada');
  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5006', 'serie', 1, '5006');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON01', 'N1 aprovada em outro posto');

  if (select count(*) from sf_registros where pmo = 'PMON01' and posto = 'Almoxarifado') <> 3
     or (select count(*) from sf_estoque_envios where pmo = 'PMON01') <> 3 then
    raise exception 'FALHOU (N1): esperava 3 entradas (registros e fila), veio %/%',
      (select count(*) from sf_registros where pmo = 'PMON01' and posto = 'Almoxarifado'),
      (select count(*) from sf_estoque_envios where pmo = 'PMON01'); end if;

  -- As recusas que já existiam vêm ANTES e não mudam: duplicidade e "sem Embalagem".
  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Bruno', '5001', 'serie', 1, '5001');
  perform teste_recusa_sem_rastro(r, 'ja_lancado', 'PMON01', 'N1 rebipe');
  r := sf_almoxarifado_entrada('PMON01', '9101', 'Almoxarifado', 'Ana', '5050', 'serie', 1, '5050');
  perform teste_recusa_sem_rastro(r, 'serie_sem_embalagem', 'PMON01', 'N1 sem Embalagem');
  raise notice 'N1. peça, anterior aprovado: concluída entra, não concluída recusa, "existe Aprovado" mantido: ok';
end $t$;

-- =============================================================
-- N2. PEÇA, anterior com gate 'registrado' (Inspeção Final, passagem)
-- =============================================================
do $t$
declare r jsonb;
begin
  perform teste_reg('PMON02', '9102', 'Embalagem', s::text, '', s::text) from generate_series(5101, 5102) s;
  perform teste_reg('PMON02', '9102', 'Inspeção Final', '5101', '');
  r := sf_almoxarifado_entrada('PMON02', '9102', 'Almoxarifado', 'Ana', '5101', 'serie', 1, '5101');
  perform teste_aceito(r, 1, 'N2 registrada no anterior');
  r := sf_almoxarifado_entrada('PMON02', '9102', 'Almoxarifado', 'Ana', '5102', 'serie', 1, '5102');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON02', 'N2 sem registro');
  if r->>'detalhe' not like '%Inspeção Final%' or r->>'detalhe' like '%provad%' then
    raise exception 'FALHOU (N2): gate registrado não fala em aprovado, mas nomeia o posto: %', r; end if;
  if (r->>'precisa_aprovado')::boolean is not false then
    raise exception 'FALHOU (N2): precisa_aprovado tinha que ser false: %', r; end if;
  raise notice 'N2. peça, anterior registrado: ok';
end $t$;

-- =============================================================
-- N3. PEÇA, Almoxarifado é o primeiro da rota: a regra não se aplica
-- =============================================================
do $t$
declare r jsonb;
begin
  perform teste_reg('PMON03', '9103', 'Embalagem', '5201', '', '5201');
  r := sf_almoxarifado_entrada('PMON03', '9103', 'Almoxarifado', 'Ana', '5201', 'serie', 1, '5201');
  perform teste_aceito(r, 1, 'N3 sem posto anterior');
  raise notice 'N3. peça sem posto anterior: comportamento de hoje: ok';
end $t$;

-- =============================================================
-- N4. PEÇA, anterior NQA (recurso nqa = precisa Aprovado, mesmo com o gate do stub 'registrado')
-- =============================================================
do $t$
declare r jsonb;
begin
  perform teste_reg('PMON04', '9104', 'Embalagem', s::text, '', s::text) from generate_series(5301, 5303) s;
  perform teste_reg('PMON04', '9104', 'Inspeção NQA', '5301', 'Aprovado');
  perform teste_reg('PMON04', '9104', 'Inspeção NQA', '5302', 'Reprovado');
  -- Desde a 0156 a peça APROVADA no NQA passa pelo posto anterior e esbarra na recusa seguinte: na OP
  -- individual com NQA no anterior a entrada é pelo LOTE (almoxarifado_lote_test.sql). A trava do posto
  -- anterior, que é o que este caso mede, continua provada: a aprovada não ouve posto_anterior_nao_concluido.
  r := sf_almoxarifado_entrada('PMON04', '9104', 'Almoxarifado', 'Ana', '5301', 'serie', 1, '5301');
  perform teste_recusa_sem_rastro(r, 'serie_exige_lote', 'PMON04', 'N4 NQA aprovado');
  r := sf_almoxarifado_entrada('PMON04', '9104', 'Almoxarifado', 'Ana', '5302', 'serie', 1, '5302');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON04', 'N4 NQA reprovado');
  r := sf_almoxarifado_entrada('PMON04', '9104', 'Almoxarifado', 'Ana', '5303', 'serie', 1, '5303');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON04', 'N4 sem NQA');
  raise notice 'N4. peça, anterior NQA: só Aprovado entra: ok';
end $t$;

-- =============================================================
-- N11. CAIXA, anterior Embalagem: a caixa fechada basta
-- =============================================================
do $t$
declare r jsonb; v_ok text; v_aberta text;
begin
  v_ok := teste_caixa('PMON11', '9111', 1, 6001, 3);
  v_aberta := teste_caixa('PMON11', '9111', 2, 6011, 3, false);
  r := sf_almoxarifado_entrada('PMON11', '9111', 'Almoxarifado', 'Ana', v_ok, 'caixa', 3, '');
  perform teste_aceito(r, 3, 'N11 caixa fechada, anterior Embalagem');
  r := sf_almoxarifado_entrada('PMON11', '9111', 'Almoxarifado', 'Ana', v_aberta, 'caixa', 3, '');
  perform teste_recusa_sem_rastro(r, 'caixa_aberta', 'PMON11', 'N11 caixa aberta continua caixa_aberta');
  raise notice 'N11. caixa, anterior Embalagem: fechada entra, aberta continua caixa_aberta: ok';
end $t$;

-- =============================================================
-- N12. CAIXA, anterior NQA: TODAS as peças com NQA Aprovado (o NQA grava sem numero_caixa)
-- =============================================================
do $t$
declare r jsonb; c1 text; c2 text; c3 text; t0 timestamptz := now() - interval '1 hour';
begin
  c1 := teste_caixa('PMON12', '9112', 1, 6101, 3);
  c2 := teste_caixa('PMON12', '9112', 2, 6111, 3);
  c3 := teste_caixa('PMON12', '9112', 3, 6121, 2);
  -- c1: as 3 aprovadas (sem numero_caixa, como sf_nqa_caixa grava).
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', s::text, 'Aprovado') from generate_series(6101, 6103) s;
  -- c2: 2 de 3 aprovadas — uma peça sem NQA.
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', s::text, 'Aprovado') from generate_series(6111, 6112) s;
  -- c3: uma reprovada e depois aprovada (existe Aprovado), a outra aprovada.
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', '6121', 'Reprovado', '', t0);
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', '6121', 'Aprovado',  '', t0 + interval '5 min');
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', '6122', 'Aprovado');

  r := sf_almoxarifado_entrada('PMON12', '9112', 'Almoxarifado', 'Ana', c1, 'caixa', 3, '');
  perform teste_aceito(r, 3, 'N12 caixa toda aprovada no NQA');
  r := sf_almoxarifado_entrada('PMON12', '9112', 'Almoxarifado', 'Ana', c2, 'caixa', 3, '');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON12', 'N12 uma peça sem NQA');
  if r->>'detalhe' not like '%Inspeção NQA%' or r->>'detalhe' not like '%1 de 3%' then
    raise exception 'FALHOU (N12): o detalhe tem que nomear o posto e quantas faltam (1 de 3): %', r; end if;
  -- A contagem também vem em campos próprios (a tela monta a frase do operador com eles).
  if (r->>'faltam')::int <> 1 or (r->>'pecas')::int <> 3 then
    raise exception 'FALHOU (N12): faltam/pecas tinham que ser 1 e 3: %', r; end if;
  if (select count(*) from sf_registros where pmo = 'PMON12' and posto = 'Almoxarifado' and numero_caixa = c2) <> 0
     or exists (select 1 from sf_estoque_envios where bipe = c2) then
    raise exception 'FALHOU (N12): a recusa da caixa gravou alguma coisa'; end if;
  r := sf_almoxarifado_entrada('PMON12', '9112', 'Almoxarifado', 'Ana', c3, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N12 reprovada → aprovada');

  -- A peça que faltava é aprovada: agora a caixa 2 entra.
  perform teste_reg('PMON12', '9112', 'Inspeção NQA', '6113', 'Aprovado');
  r := sf_almoxarifado_entrada('PMON12', '9112', 'Almoxarifado', 'Ana', c2, 'caixa', 3, '');
  perform teste_aceito(r, 3, 'N12 caixa 2 depois da peça aprovada');
  raise notice 'N12. caixa, anterior NQA: todas aprovadas entra, uma sem NQA recusa: ok';
end $t$;

-- =============================================================
-- N13 / N14. CAIXA, anterior genérico: 'aprovado' e 'registrado'
-- =============================================================
do $t$
declare r jsonb; c1 text; c2 text;
begin
  c1 := teste_caixa('PMON13', '9113', 1, 6201, 2);
  c2 := teste_caixa('PMON13', '9113', 2, 6211, 2);
  perform teste_reg('PMON13', '9113', 'Inspeção Saída', s::text, 'Aprovado') from generate_series(6201, 6202) s;
  perform teste_reg('PMON13', '9113', 'Inspeção Saída', '6211', 'Aprovado');
  perform teste_reg('PMON13', '9113', 'Inspeção Saída', '6212', 'Reprovado');
  r := sf_almoxarifado_entrada('PMON13', '9113', 'Almoxarifado', 'Ana', c1, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N13 todas aprovadas');
  r := sf_almoxarifado_entrada('PMON13', '9113', 'Almoxarifado', 'Ana', c2, 'caixa', 2, '');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON13', 'N13 uma reprovada');

  c1 := teste_caixa('PMON14', '9114', 1, 6301, 2);
  c2 := teste_caixa('PMON14', '9114', 2, 6311, 2);
  perform teste_reg('PMON14', '9114', 'Inspeção Final', s::text, '') from generate_series(6301, 6302) s;
  perform teste_reg('PMON14', '9114', 'Inspeção Final', '6311', '');
  r := sf_almoxarifado_entrada('PMON14', '9114', 'Almoxarifado', 'Ana', c1, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N14 todas registradas');
  r := sf_almoxarifado_entrada('PMON14', '9114', 'Almoxarifado', 'Ana', c2, 'caixa', 2, '');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMON14', 'N14 uma sem registro');
  if r->>'detalhe' like '%provad%' then
    raise exception 'FALHOU (N14): gate registrado não fala em aprovado: %', r; end if;
  raise notice 'N13/N14. caixa, anterior genérico (aprovado e registrado): ok';
end $t$;

-- =============================================================
-- N15. CAIXA, Almoxarifado é o primeiro da rota: a regra não se aplica
-- =============================================================
do $t$
declare r jsonb; c1 text;
begin
  c1 := teste_caixa('PMON15', '9115', 1, 6401, 2);
  r := sf_almoxarifado_entrada('PMON15', '9115', 'Almoxarifado', 'Ana', c1, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N15 sem posto anterior');
  raise notice 'N15. caixa sem posto anterior: comportamento de hoje: ok';
end $t$;

-- =============================================================
-- N16. sf_almox_necessidades
-- =============================================================
do $t$
declare c1 text; c2 text; c3 text; c4r text; c4 text; c5 text; v_lista text; v record; r jsonb;
begin
  c1 := teste_caixa('PMON16', '9116', 1, 6501, 3);          -- fechada, NQA ok → NECESSIDADE
  c2 := teste_caixa('PMON16', '9116', 2, 6511, 3);          -- fechada, falta NQA de uma → não
  c3 := teste_caixa('PMON16', '9116', 3, 6521, 2, false);   -- aberta → não
  c4r := teste_caixa('PMON16', '9116', 4, 6531, 2, true, 1); -- montagem aposentada (revisão 1) → não
  c5 := teste_caixa('PMON16', '9116', 5, 6541, 2);          -- fechada, NQA ok, JÁ ENTROU → não
  -- A remontagem da caixa 4 (revisão 0, mesmo número, mesmas peças) → NECESSIDADE uma vez só.
  insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
  values ('PMON16', '9116', 'Embalagem', 4, 2, 2, 'CX[4][2]9116-PMON16', true, 0, now());
  c4 := 'CX[4][2]9116-PMON16';
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  select 'Massa', 'Embalagem', 'PMON16', '9116', 'Cliente N', c4, s::text, s::text from generate_series(6531, 6532) s;

  perform teste_reg('PMON16', '9116', 'Inspeção NQA', s::text, 'Aprovado')
     from generate_series(6501, 6503) s;
  perform teste_reg('PMON16', '9116', 'Inspeção NQA', s::text, 'Aprovado')
     from generate_series(6511, 6512) s;
  perform teste_reg('PMON16', '9116', 'Inspeção NQA', s::text, 'Aprovado')
     from generate_series(6521, 6522) s;
  perform teste_reg('PMON16', '9116', 'Inspeção NQA', s::text, 'Aprovado')
     from generate_series(6531, 6532) s;
  perform teste_reg('PMON16', '9116', 'Inspeção NQA', s::text, 'Aprovado')
     from generate_series(6541, 6542) s;
  r := sf_almoxarifado_entrada('PMON16', '9116', 'Almoxarifado', 'Ana', c5, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N16 massa: caixa 5 entra');

  select string_agg(codigo || '=' || pecas, ',' order by seq) into v_lista
    from sf_almox_necessidades('PMON16', '9116');
  if v_lista is distinct from c1 || '=3,' || c4 || '=2' then
    raise exception 'FALHOU (N16): necessidades esperadas % e %, veio %', c1, c4, v_lista; end if;
  select * into v from sf_almox_necessidades('PMON16', '9116') where codigo = c1;
  if v.seq <> 1 or v.fechada_em is null then
    raise exception 'FALHOU (N16): seq/fechada_em da necessidade: %', row_to_json(v); end if;

  -- Confirmar (o bipe de hoje) tira a caixa da lista.
  r := sf_almoxarifado_entrada('PMON16', '9116', 'Almoxarifado', 'Ana', c1, 'caixa', 3, '');
  perform teste_aceito(r, 3, 'N16 confirmação da caixa 1');
  select string_agg(codigo, ',' order by seq) into v_lista from sf_almox_necessidades('PMON16', '9116');
  if v_lista is distinct from c4 then
    raise exception 'FALHOU (N16): a caixa confirmada tinha que sair da lista; veio %', v_lista; end if;
  -- A remontagem entra UMA vez: confirmada, a lista fica vazia (e a aposentada não reaparece).
  r := sf_almoxarifado_entrada('PMON16', '9116', 'Almoxarifado', 'Ana', c4, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'N16 confirmação da remontagem');
  if exists (select 1 from sf_almox_necessidades('PMON16', '9116')) then
    raise exception 'FALHOU (N16): lista tinha que ficar vazia'; end if;
  -- A peça que faltava na caixa 2 é aprovada: ela vira necessidade.
  perform teste_reg('PMON16', '9116', 'Inspeção NQA', '6513', 'Aprovado');
  select string_agg(codigo, ',') into v_lista from sf_almox_necessidades('PMON16', '9116');
  if v_lista is distinct from c2 then
    raise exception 'FALHOU (N16): a caixa 2 concluída tinha que aparecer; veio %', v_lista; end if;
  raise notice 'N16. necessidades: só fechadas, concluídas, sem entrada; confirmada sai; remontagem uma vez: ok';
end $t$;

-- N17. OP sem Almoxarifado na rota, OP inexistente, OP individual, anterior Embalagem e sem anterior.
do $t$
declare n int;
begin
  perform teste_caixa('PMON17', '9117', 1, 6601, 2);
  perform teste_reg('PMON17', '9117', 'Inspeção NQA', s::text, 'Aprovado') from generate_series(6601, 6602) s;
  select count(*) into n from sf_almox_necessidades('PMON17', '9117');
  if n <> 0 then raise exception 'FALHOU (N17): OP sem Almoxarifado devolveu % necessidade(s)', n; end if;
  select count(*) into n from sf_almox_necessidades('PMOX99', '0000');
  if n <> 0 then raise exception 'FALHOU (N17): OP inexistente devolveu %', n; end if;
  select count(*) into n from sf_almox_necessidades('PMON01', '9101');
  if n <> 0 then raise exception 'FALHOU (N17): OP individual não tem caixa pra confirmar: %', n; end if;
  -- PMON11 (anterior Embalagem): a caixa 1 já entrou, a 2 está aberta → nada. Uma 3ª fechada aparece.
  select count(*) into n from sf_almox_necessidades('PMON11', '9111');
  if n <> 0 then raise exception 'FALHOU (N17): PMON11 devolveu % antes da caixa 3', n; end if;
  perform teste_caixa('PMON11', '9111', 3, 6021, 2);
  if (select string_agg(codigo, ',') from sf_almox_necessidades('PMON11', '9111'))
     is distinct from 'CX[3][2]9111-PMON11' then
    raise exception 'FALHOU (N17): anterior Embalagem: a caixa fechada tinha que ser necessidade'; end if;
  -- PMON15 (sem anterior): caixa fechada nova é necessidade.
  perform teste_caixa('PMON15', '9115', 2, 6411, 2);
  if (select string_agg(codigo, ',') from sf_almox_necessidades('PMON15', '9115'))
     is distinct from 'CX[2][2]9115-PMON15' then
    raise exception 'FALHOU (N17): sem posto anterior a caixa fechada é necessidade'; end if;
  raise notice 'N17. necessidades: OP sem Almoxarifado/inexistente/individual vazias; anterior Embalagem e sem anterior: ok';
end $t$;

-- N18. Permissão: sem recebimento.lancar + shopfloor.visualizar, ERRO (nunca lista vazia no lugar).
do $t$
declare v_erro text; n int;
begin
  perform set_config('teste.perms', 'recebimento.lancar', false);
  begin
    select count(*) into n from sf_almox_necessidades('PMON16', '9116');
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'SEM_PERMISSAO' then
    raise exception 'FALHOU (N18): sem shopfloor.visualizar tinha que dar SEM_PERMISSAO, veio "%"', v_erro; end if;
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    select count(*) into n from sf_almox_necessidades('PMON16', '9116');
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'SEM_PERMISSAO' then
    raise exception 'FALHOU (N18): sem recebimento.lancar tinha que dar SEM_PERMISSAO, veio "%"', v_erro; end if;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);
  raise notice 'N18. necessidades sem permissão: erro, não lista vazia: ok';
end $t$;

-- N19. Grants: anon não executa as funções novas; a auxiliar não é chamável por authenticated.
do $t$
begin
  if has_function_privilege('anon', 'public.sf_almox_necessidades(text, text)', 'execute') then
    raise exception 'FALHOU (N19): anon executa sf_almox_necessidades'; end if;
  if not has_function_privilege('authenticated', 'public.sf_almox_necessidades(text, text)', 'execute') then
    raise exception 'FALHOU (N19): authenticated não executa sf_almox_necessidades'; end if;
  if has_function_privilege('authenticated',
       'public.sf_almox_peca_concluida(text, text, text, text, boolean)', 'execute') then
    raise exception 'FALHOU (N19): a auxiliar não pode ser chamada direto'; end if;
  if has_function_privilege('anon',
       'public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)', 'execute') then
    raise exception 'FALHOU (N19): anon executa a entrada'; end if;
  raise notice 'N19. grants das funções novas e da entrada: ok';
end $t$;

do $t$ begin perform public.teste_fila_invariantes('depois dos testes da 0155'); end $t$;
