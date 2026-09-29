-- Testes da RPC de entrada do posto Almoxarifado (migração 0129).
-- Roda num Postgres descartável: supabase/tests/rodar-almoxarifado-test.sh
-- Tudo numa única conexão (a configuração de sessão `teste.perms` alimenta o stub do RBAC).

-- ---------- stubs mínimos do Supabase ----------
create role anon; create role authenticated; create role service_role;
-- `teste.perms` = lista 'modulo.permissao' separada por vírgula. É a de DOIS argumentos de
-- propósito: a de um argumento anula o RBAC (revisão de segurança de 21/09/2026), e a RPC daqui
-- tem que continuar exigindo shopfloor.lancar e nada mais.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

-- ---------- tabelas (espelho enxuto do que a RPC toca) ----------
-- Só as colunas que importam aqui; a DDL real está em 0028 (ordens/postos/registros),
-- 0062 (perfis + sf_postos.perfil), 0070 (caixas) e 0100 (sf_caixas.revisao).
create table public.sf_posto_perfis (
  chave text primary key, nome text not null, tem_status boolean not null, reprova text not null,
  gate text not null, exige_manutencao boolean not null, recurso text not null
);
create table public.sf_postos (
  chave text primary key, ordem int not null,
  perfil text references public.sf_posto_perfis(chave)
);
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null, cliente text not null,
  sn_ini text not null default '', sn_fim text not null default '',
  embalagem_individual boolean not null default false,
  unique (pmo, op)
);
create table public.sf_caixas (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null, posto text not null, seq int not null,
  limite int not null, qtd int not null default 0, codigo text not null default '',
  fechada boolean not null default false, ultima boolean not null default false,
  revisao int not null default 0,
  created_at timestamptz not null default now(), fechada_em timestamptz,
  unique (pmo, op, posto, seq, revisao)
);
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  colaborador text not null default '', posto text not null, pmo text not null, op text not null,
  cliente text not null default '', numero_caixa text not null default '', qtd_por_caixa int,
  status text not null default '', numero_serie text not null default '',
  numero_serie_norm text not null default ''
);

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso) values
  ('passagem',  'Passagem',  false, 'nenhum', 'registrado', false, 'nenhum'),
  ('embalagem', 'Embalagem', false, 'nenhum', 'registrado', false, 'caixa');

\i /tmp/0128.sql
\i /tmp/0129.sql

select set_config('teste.perms', 'shopfloor.lancar', false);

-- ---------- massa de teste ----------
-- Dois postos de embalagem NÃO entram aqui: o que interessa é que o perfil (recurso 'caixa') é o
-- que identifica a Embalagem, e que 'Inspeção Final' (passagem) não serve de posto de almoxarifado.
insert into public.sf_postos (chave, ordem, perfil) values
  ('Embalagem', 10, 'embalagem'),
  ('Inspeção Final', 9, 'passagem'),
  ('Almoxarifado', 13, 'almoxarifado');

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC14', '8498', 'Cliente Coletiva',   '8000', '8100', false),  -- embalagem coletiva (caixa)
  ('PMOI01', '9000', 'Cliente Individual', '1000', '1100', true),   -- embalagem individual (peça)
  ('PMOI02', '9001', 'Cliente Sem Faixa',  '',     '',     true),   -- OP sem faixa cadastrada (individual)
  -- Segunda OP coletiva, só pra provar que o código de caixa não vaza de uma OP pra outra (teste
  -- 12) sem misturar com a checagem nova do achado 2 — PMOI01 é individual e recusaria antes de
  -- sequer olhar pra sf_caixas.
  ('PMOC16', '8499', 'Cliente Coletiva 2', '9000', '9100', false);

-- Caixas da OP coletiva:
--  seq 7 → fechada e etiquetada (o caso bom);
--  seq 8 → aberta MAS com código gravado: estado defensivo. Na prática o cancelamento de embalagem
--          (0106) limpa o código ao reabrir, então esta combinação só aparece fora de ordem — a
--          checagem existe pra nunca dar entrada numa caixa que não está lacrada;
--  seq 9 → montagem APOSENTADA pelo NQA (revisao 1, R no código): virou histórico.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao) values
  ('PMOC14', '8498', 'Embalagem', 7, 14, 14, 'CX[7][14]8498-PMOC14',  true,  0),
  ('PMOC14', '8498', 'Embalagem', 8, 14,  0, 'CX[8][14]8498-PMOC14',  false, 0),
  ('PMOC14', '8498', 'Embalagem', 9, 14, 14, 'CX[9]R[14]8498-PMOC14', true,  1),
-- seq 10 → linha já aposentada (revisao 1) com o código AINDA sem o R. É o retrato do meio da
-- corrida: o NQA reprovou depois que o bipe do almoxarifado já tinha achado a caixa pelo código
-- antigo (a 0100 troca revisao e código juntos). A releitura depois da trava é o que pega isso.
  ('PMOC14', '8498', 'Embalagem', 10, 14, 14, 'CX[10][14]8498-PMOC14', true, 1);

-- As 14 peças da caixa 7, carimbadas com o código final NO POSTO EMBALAGEM. Elas provam que a
-- duplicidade é por POSTO: se não fosse, o primeiro bipe do Almoxarifado já sairia como 'ja_lancado'.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[7][14]8498-PMOC14',
       (8000 + i)::text, (8000 + i)::text
from generate_series(1, 14) i;

-- OP individual: a peça 1042 passou pela Embalagem (embalagem individual grava numero_caixa = o
-- próprio SN); a 1055 só passou pela Inspeção Final, que não é Embalagem nenhuma.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm) values
  ('Marcos', 'Embalagem',      'PMOI01', '9000', 'Cliente Individual', '1042', 1, '1042', '1042'),
  ('Marcos', 'Inspeção Final', 'PMOI01', '9000', 'Cliente Individual', '',  null, '1055', '1055');
-- OP sem faixa: a peça também passou pela Embalagem.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm) values
  ('Marcos', 'Embalagem', 'PMOI02', '9001', 'Cliente Sem Faixa', '7777', 1, '7777', '7777');

-- ---------- 1. caixa fechada e nunca lançada ----------
do $t$
declare r jsonb; v record;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: caixa fechada não entrou: %', r; end if;
  if (r->>'quantidade')::int <> 14 then
    raise exception 'FALHOU: a quantidade tinha que vir do código (14): %', r; end if;

  -- Um registro por bipe: UMA linha, com o código da caixa e sem série.
  select count(*) as n, min(status) as status, min(cliente) as cliente,
         min(numero_serie) as sn, min(numero_serie_norm) as snn
    into v
    from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[7][14]8498-PMOC14';
  if v.n <> 1 then raise exception 'FALHOU: esperava 1 linha no Almoxarifado, veio %', v.n; end if;
  if v.status <> '' then raise exception 'FALHOU: o bipe não julga a peça, status tinha que ficar vazio: %', v.status; end if;
  if v.cliente <> 'Cliente Coletiva' then raise exception 'FALHOU: cliente não veio da ordem: %', v.cliente; end if;
  if v.sn <> '' or v.snn <> '' then raise exception 'FALHOU: bipe de caixa não tem série'; end if;
  raise notice '1. caixa fechada e nunca lançada: ok';
end $t$;

-- ---------- 2. a mesma caixa bipada de novo ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Bruno',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if coalesce((r->>'ok')::boolean, true) is not false then
    raise exception 'FALHOU: caixa entrou duas vezes: %', r; end if;
  if r->>'motivo' <> 'ja_lancado' then raise exception 'FALHOU: motivo errado: %', r; end if;
  -- O detalhe é o que a tela mostra pro operador: quando e por quem.
  if r->>'detalhe' not like '%Ana%' then
    raise exception 'FALHOU: o detalhe tinha que dizer quem lançou: %', r; end if;
  if r->>'detalhe' not like '%' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '%' then
    raise exception 'FALHOU: o detalhe tinha que dizer quando: %', r; end if;
  if (select count(*) from sf_registros where posto = 'Almoxarifado') <> 1 then
    raise exception 'FALHOU: a recusa gravou registro'; end if;
  raise notice '2. mesma caixa de novo → ja_lancado (com quando e por quem): ok';
end $t$;

-- ---------- 3. caixa que existe mas está aberta ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[8][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_aberta' then raise exception 'FALHOU: caixa aberta: %', r; end if;
  raise notice '3. caixa aberta: ok';
end $t$;

-- ---------- 4. caixa reprovada no NQA ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[9]R[14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_reprovada' then raise exception 'FALHOU: caixa reprovada: %', r; end if;
  -- Da segunda reprova em diante o código traz o número da revisão (R2, R3…). Esta etiqueta nem tem
  -- linha na tabela: a marca no código já basta pra recusar, e a resposta continua a verdadeira.
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[9]R2[14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_reprovada' then raise exception 'FALHOU: R2 também é reprovada: %', r; end if;
  -- Pelo outro caminho: código sem R, linha com revisao > 0 (a reprova aconteceu no meio do bipe).
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[10][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_reprovada' then
    raise exception 'FALHOU: reprova vista só na linha travada: %', r; end if;
  raise notice '4. caixa reprovada no NQA (R, R2 e reprova no meio do bipe): ok';
end $t$;

-- ---------- 5. série de OP individual que passou pela Embalagem ----------
do $t$
declare r jsonb; v record;
begin
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '1042', 'serie', 1, '1042');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: peça embalada não entrou: %', r; end if;
  if (r->>'quantidade')::int <> 1 then raise exception 'FALHOU: peça vale 1: %', r; end if;

  select count(*) as n, min(numero_caixa) as cx, min(numero_serie) as sn, min(numero_serie_norm) as snn
    into v from sf_registros where posto = 'Almoxarifado' and numero_serie_norm = '1042';
  if v.n <> 1 then raise exception 'FALHOU: esperava 1 linha, veio %', v.n; end if;
  if v.cx <> '' then raise exception 'FALHOU: bipe de peça não tem caixa: %', v.cx; end if;
  if v.sn <> '1042' or v.snn <> '1042' then raise exception 'FALHOU: série gravada errada: % / %', v.sn, v.snn; end if;
  raise notice '5. peça embalada: ok';
end $t$;

-- ---------- 6. série na faixa, sem registro na Embalagem ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '1055', 'serie', 1, '1055');
  if r->>'motivo' <> 'serie_sem_embalagem' then
    raise exception 'FALHOU: passar por outro posto não é ter sido embalado: %', r; end if;
  raise notice '6. série sem Embalagem: ok';
end $t$;

-- ---------- 7. série fora da faixa da OP ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '9999', 'serie', 1, '9999');
  if r->>'motivo' <> 'serie_fora_da_faixa' then raise exception 'FALHOU: fora da faixa: %', r; end if;
  -- OP sem faixa cadastrada não tem como julgar a série: passa (quem manda é a Embalagem).
  r := sf_almoxarifado_entrada('PMOI02', '9001', 'Almoxarifado', 'Ana', '7777', 'serie', 1, '7777');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: OP sem faixa tinha que aceitar: %', r; end if;
  raise notice '7. série fora da faixa (e OP sem faixa aceita): ok';
end $t$;

-- ---------- 8. a mesma série bipada duas vezes ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Bruno', '1042', 'serie', 1, '1042');
  if r->>'motivo' <> 'ja_lancado' then raise exception 'FALHOU: série entrou duas vezes: %', r; end if;
  if r->>'detalhe' not like '%Ana%' then
    raise exception 'FALHOU: o detalhe tinha que dizer quem lançou: %', r; end if;
  if (select count(*) from sf_registros where posto = 'Almoxarifado' and numero_serie_norm = '1042') <> 1 then
    raise exception 'FALHOU: a recusa gravou registro'; end if;
  raise notice '8. mesma série de novo → ja_lancado: ok';
end $t$;

-- ---------- 9. gate de permissão ----------
do $t$
declare r jsonb;
begin
  perform set_config('teste.perms', '', false);
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[8][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'sem_permissao' then raise exception 'FALHOU: sem permissão passou: %', r; end if;

  -- Permissão do módulo errado não serve (é o que a função de UM argumento deixava passar).
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.visualizar', false);
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[8][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'sem_permissao' then
    raise exception 'FALHOU: lancar de outro módulo passou: %', r; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '9. gate de permissão (recusa como dado, e por módulo): ok';
end $t$;

-- ---------- 10. OP inexistente ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOX99', '0000', 'Almoxarifado', 'Ana', '1042', 'serie', 1, '1042');
  if r->>'motivo' <> 'ordem_nao_encontrada' then raise exception 'FALHOU: OP inexistente: %', r; end if;
  raise notice '10. OP inexistente: ok';
end $t$;

-- ---------- 11. posto que não é de almoxarifado ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Inspeção Final', 'Ana',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'posto_invalido' then raise exception 'FALHOU: posto de outro perfil: %', r; end if;
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Posto Que Não Existe', 'Ana',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'posto_invalido' then raise exception 'FALHOU: posto inexistente: %', r; end if;
  raise notice '11. posto inválido: ok';
end $t$;

-- ---------- 12. código de caixa que não existe na OP ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[77][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_nao_encontrada' then raise exception 'FALHOU: caixa inexistente: %', r; end if;
  -- A caixa é da OP: o código da outra OP não vale nesta. PMOC16 (e não PMOI01) porque precisa ser
  -- coletiva — numa OP individual o achado 2 recusaria antes de olhar pra sf_caixas (ver teste 15).
  r := sf_almoxarifado_entrada('PMOC16', '8499', 'Almoxarifado', 'Ana',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_nao_encontrada' then raise exception 'FALHOU: caixa de outra OP: %', r; end if;
  raise notice '12. caixa não encontrada (e não vaza entre OPs): ok';
end $t$;

-- ---------- 13. nada além do esperado foi gravado ----------
do $t$
declare v_n int;
begin
  select count(*) into v_n from sf_registros where posto = 'Almoxarifado';
  -- caixa 7 + peça 1042 + peça 7777 (OP sem faixa) = 3; todo o resto foi recusa.
  if v_n <> 3 then raise exception 'FALHOU: esperava 3 entradas no Almoxarifado, veio %', v_n; end if;
  raise notice '13. só as entradas aceitas gravaram: ok';
end $t$;

-- ---------- 14. série normalizada vazia não vira entrada em branco ----------
-- Chamada fora do fluxo da tela (o domínio nunca deixa passar série vazia). Não pode casar com as
-- linhas de bipe de caixa, que gravam numero_serie_norm = ''.
do $t$
declare r jsonb;
begin
  -- PMOI01 (individual) e não PMOC14: numa OP coletiva o achado 2 recusaria por
  -- serie_em_op_coletiva antes mesmo de olhar pra faixa — o que este teste não quer exercitar aqui.
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '', 'serie', 1, '');
  if r->>'motivo' <> 'serie_fora_da_faixa' then
    raise exception 'FALHOU: série vazia está fora de qualquer faixa: %', r; end if;
  -- Na OP sem faixa quem barra é a exigência da Embalagem, e não as linhas de caixa (norm = '').
  r := sf_almoxarifado_entrada('PMOI02', '9001', 'Almoxarifado', 'Ana', '', 'serie', 1, '');
  if r->>'motivo' <> 'serie_sem_embalagem' then
    raise exception 'FALHOU: série vazia em OP sem faixa entrou: %', r; end if;
  raise notice '14. série vazia recusada nos dois caminhos: ok';
end $t$;

-- ---------- 15. caixa bipada numa OP individual (achado 2 da revisão) ----------
-- A regra "individual bipa série, coletiva bipa caixa" é conferida de novo aqui porque
-- embalagem_individual é editável numa OP já em andamento (Cadastrar OP) — sem esta trava, alguém
-- muda a flag depois que caixas já foram fechadas e a mesma peça entraria como caixa E como série.
-- Chama a RPC direto com p_tipo='caixa' (o que o TS nunca faria numa OP individual): é exatamente o
-- caminho que pula a classificação em TS e só o banco pode barrar.
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana',
                               'CX[7][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_em_op_individual' then
    raise exception 'FALHOU: caixa em OP individual tinha que ser recusada: %', r; end if;
  raise notice '15. caixa em OP individual: ok';
end $t$;

-- ---------- 16. série bipada numa OP coletiva (achado 2 da revisão) ----------
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana', '8001', 'serie', 1, '8001');
  if r->>'motivo' <> 'serie_em_op_coletiva' then
    raise exception 'FALHOU: série em OP coletiva tinha que ser recusada: %', r; end if;
  raise notice '16. série em OP coletiva: ok';
end $t$;

-- ---------- 17. nada das recusas de formato-por-dado gravou registro ----------
do $t$
declare v_n int;
begin
  select count(*) into v_n from sf_registros where posto = 'Almoxarifado';
  if v_n <> 3 then raise exception 'FALHOU: recusa de formato-por-dado não podia gravar: %', v_n; end if;
  raise notice '17. recusas 15 e 16 não gravaram nada: ok';
end $t$;
