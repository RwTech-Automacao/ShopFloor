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
-- A de UM argumento existe só porque a sf_nqa_caixa (0130) usa ela — o corpo vem da 0100, que está
-- em produção, e trocar o gate dela mudaria QUEM pode finalizar caixa no NQA. Lê a MESMA lista, sem
-- o prefixo do módulo, pra a permissão global e a do módulo não se confundirem no teste.
create function public.tem_permissao(p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_perm || ',%'
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
-- posto_retorno e created_at não são escritos por esta RPC, mas ENTRAM no stub porque o teste 18
-- roda a leitura do Fluxo (CTE de 0094) tal como ela é em produção — inclusive a rota de reteste e
-- o desempate por created_at. Sem as colunas, a prova seria uma imitação da consulta, não ela.
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  colaborador text not null default '', posto text not null, pmo text not null, op text not null,
  cliente text not null default '', numero_caixa text not null default '', qtd_por_caixa int,
  status text not null default '', numero_serie text not null default '',
  numero_serie_norm text not null default '',
  -- nqa_visual/nqa_funcional/observacao: a sf_nqa_caixa (0130) grava neles no teste 23, que prova o
  -- colateral desta correção no NQA. A RPC do Almoxarifado não toca nenhum dos três.
  nqa_visual text not null default '', nqa_funcional text not null default '',
  observacao text not null default '',
  posto_retorno text, created_at timestamptz not null default now()
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
  ('PMOC14', '8498', 'Embalagem', 10, 14, 14, 'CX[10][14]8498-PMOC14', true, 1),
-- seq 11 → fechada e etiquetada, mas NENHUMA peça carimbada com o código dela (teste 19). Na prática
-- é o rastro de um cancelamento de lançamento (0087) que levou as linhas da Embalagem pra auditoria.
  ('PMOC14', '8498', 'Embalagem', 11, 14, 14, 'CX[11][14]8498-PMOC14', true, 0),
-- seq 12 → etiqueta diz 14, mas só 13 peças estão carimbadas com o código (teste 20): a divergência
-- entre o número impresso e a contagem real.
  ('PMOC14', '8498', 'Embalagem', 12, 14, 14, 'CX[12][14]8498-PMOC14', true, 0);

-- As 14 peças da caixa 7, carimbadas com o código final NO POSTO EMBALAGEM (é o que
-- sf_fechar_caixa faz ao fechar: troca o marcador CX[7] pelo código). Elas provam que a
-- duplicidade é por POSTO — se não fosse, o primeiro bipe do Almoxarifado já sairia como
-- 'ja_lancado' — e são a LISTA de onde o bipe de caixa tira as peças.
--
-- A série CRUA é de propósito diferente da normalizada ('SN-8001' × '8001'): a entrada tem que
-- copiar as duas formas como a Embalagem gravou, e não inventar uma terceira. Se ela gravasse o
-- código da caixa ou uma normalização própria em numero_serie, a mesma peça apareceria de dois
-- jeitos na Pesquisa — foi o achado da revisão sobre gravar p_bipe cru.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[7][14]8498-PMOC14',
       'SN-' || (8000 + i)::text, (8000 + i)::text
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
  -- Etiqueta e contagem batendo: nada de qtd_etiqueta na resposta (o painel só fala da divergência
  -- quando ela existe — ver teste 20).
  if r ? 'qtd_etiqueta' then
    raise exception 'FALHOU: sem divergência não pode vir qtd_etiqueta: %', r; end if;

  -- UMA LINHA POR PEÇA: 14 peças na caixa, 14 linhas no Almoxarifado — cada uma com a SÉRIE da peça
  -- preenchida (é o que todo leitor do sistema conta) e com o código da caixa em numero_caixa (é o
  -- que amarra as 14 ao mesmo bipe). Era aqui que estava o defeito: uma linha só, com série vazia.
  select count(*) as n, count(distinct numero_serie_norm) as sns,
         min(status) as status, min(cliente) as cliente,
         count(*) filter (where numero_serie_norm = '') as sem_serie,
         count(*) filter (where numero_caixa <> 'CX[7][14]8498-PMOC14') as sem_caixa
    into v
    from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[7][14]8498-PMOC14';
  if v.n <> 14 then raise exception 'FALHOU: esperava 14 linhas no Almoxarifado (uma por peça), veio %', v.n; end if;
  if v.sns <> 14 then raise exception 'FALHOU: esperava 14 séries distintas, veio %', v.sns; end if;
  if v.sem_serie <> 0 then raise exception 'FALHOU: % linha(s) sem série — invisível pro Fluxo', v.sem_serie; end if;
  if v.sem_caixa <> 0 then raise exception 'FALHOU: % linha(s) sem o código da caixa', v.sem_caixa; end if;
  if v.status <> '' then raise exception 'FALHOU: o bipe não julga a peça, status tinha que ficar vazio: %', v.status; end if;
  if v.cliente <> 'Cliente Coletiva' then raise exception 'FALHOU: cliente não veio da ordem: %', v.cliente; end if;

  -- As séries são as MESMAS da Embalagem, nas duas formas: nada de série normalizada por conta
  -- própria nem do código da caixa no lugar da série.
  if exists (
    select 1 from sf_registros a
     where a.posto = 'Almoxarifado' and a.numero_caixa = 'CX[7][14]8498-PMOC14'
       and not exists (
         select 1 from sf_registros e
          where e.posto = 'Embalagem' and e.numero_caixa = a.numero_caixa
            and e.numero_serie = a.numero_serie and e.numero_serie_norm = a.numero_serie_norm)
  ) then
    raise exception 'FALHOU: série gravada em formato diferente do que a Embalagem gravou';
  end if;
  raise notice '1. caixa fechada e nunca lançada → 14 linhas, uma por peça: ok';
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
  -- Continuam as 14 linhas do primeiro bipe: a recusa não gravou nenhuma a mais (é o rebipe da
  -- caixa INTEIRA sendo recusado por inteiro — a duplicidade é pelo código, não peça por peça).
  if (select count(*) from sf_registros where posto = 'Almoxarifado') <> 14 then
    raise exception 'FALHOU: a recusa mexeu nas linhas (esperava 14, veio %)',
      (select count(*) from sf_registros where posto = 'Almoxarifado'); end if;
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
  -- 14 (as peças da caixa 7) + peça 1042 + peça 7777 (OP sem faixa) = 16; o resto foi recusa.
  if v_n <> 16 then raise exception 'FALHOU: esperava 16 entradas no Almoxarifado, veio %', v_n; end if;
  raise notice '13. só as entradas aceitas gravaram: ok';
end $t$;

-- ---------- 14. série normalizada vazia não vira entrada em branco ----------
-- Chamada fora do fluxo da tela (o domínio nunca deixa passar série vazia). O bipe de caixa NÃO
-- grava mais linha sem série (virou uma linha por peça), mas o histórico gravado ANTES dessa
-- correção continua no banco com numero_serie_norm = '' — e série vazia não pode casar com ele.
do $t$
declare r jsonb;
begin
  -- PMOI01 (individual) e não PMOC14: numa OP coletiva o achado 2 recusaria por
  -- serie_em_op_coletiva antes mesmo de olhar pra faixa — o que este teste não quer exercitar aqui.
  r := sf_almoxarifado_entrada('PMOI01', '9000', 'Almoxarifado', 'Ana', '', 'serie', 1, '');
  if r->>'motivo' <> 'serie_fora_da_faixa' then
    raise exception 'FALHOU: série vazia está fora de qualquer faixa: %', r; end if;
  -- Na OP sem faixa quem barra é a exigência da Embalagem: o `numero_serie_norm <> ''` da checagem
  -- é o que impede a série vazia de casar com linha antiga de bipe de caixa (norm = '').
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
  if v_n <> 16 then raise exception 'FALHOU: recusa de formato-por-dado não podia gravar: %', v_n; end if;
  raise notice '17. recusas 15 e 16 não gravaram nada: ok';
end $t$;

-- ---------- 18. A LEITURA DO FLUXO VÊ AS PEÇAS DO BIPE DE CAIXA ----------
-- Este é o teste do defeito. Não basta afirmar que agora existe série gravada: o que precisa ser
-- provado é o NÚMERO que as telas leem, porque foi exatamente isso que passou batido em seis
-- revisões. Com a gravação antiga (uma linha por caixa, série vazia) tudo aqui dava zero:
--   · o card do Almoxarifado no Fluxo mostrava 0 bipes e 0 de 14;
--   · o trabalho em processo das 14 peças continuava parado na EMBALAGEM (o último registro visível
--     de cada peça era o dela);
--   · "Concluído" ficava 0 pra sempre — a OP nunca concluía;
--   · o Dashboard (0101), que conta distinct numero_serie_norm não vazio, contava zero peça.
-- A consulta abaixo é a de produção, copiada da RPC sf_fluxo_op (0094, CTE `regs`/`ult`/`wip_t`) —
-- inclusive o filtro `numero_serie_norm <> ''`, que é o que tornava a linha de caixa invisível, e
-- que contarPendentesPorPosto repete em .neq('numero_serie_norm','').
do $t$
declare
  v_linhas     int;  -- o que contarPendentesPorPosto pagina (linhas visíveis no posto)
  v_pecas      int;  -- o que o Dashboard conta (peças distintas)
  v_wip_almox  int;
  v_wip_embal  int;
  v_ult_posto  int;
begin
  -- 1) As linhas do Almoxarifado passam pelo filtro dos dois leitores.
  select count(*), count(distinct numero_serie_norm) into v_linhas, v_pecas
    from sf_registros
   where pmo = 'PMOC14' and op = '8498' and posto = 'Almoxarifado' and numero_serie_norm <> '';
  if v_linhas <> 14 then
    raise exception 'FALHOU: o Fluxo/Dashboard vê % linha(s) no Almoxarifado, esperava 14', v_linhas; end if;
  if v_pecas <> 14 then
    raise exception 'FALHOU: o Dashboard conta % peça(s) no Almoxarifado, esperava 14', v_pecas; end if;

  -- 2) O trabalho em processo ANDOU: saiu da Embalagem e está no Almoxarifado. Mesmíssimas CTEs da
  --    sf_fluxo_op — o último registro de cada SN decide onde a peça está.
  with regs as (
    select numero_serie_norm, posto, status, posto_retorno, data_hora, created_at
    from sf_registros
    where pmo = 'PMOC14' and op = '8498' and numero_serie_norm <> ''
  ),
  ult as (
    select distinct on (numero_serie_norm) numero_serie_norm, posto, status, posto_retorno
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  ),
  wip_t as (
    select case
             when coalesce(posto_retorno, '') <> '' then split_part(posto_retorno, ',', 1)
             when lower(status) = 'reprovado' then 'Manutenção'
             else posto
           end as posto,
           count(*)::int as wip
    from ult
    group by 1
  )
  select coalesce(max(wip) filter (where posto = 'Almoxarifado'), 0),
         coalesce(max(wip) filter (where posto = 'Embalagem'), 0)
    into v_wip_almox, v_wip_embal
    from wip_t;
  if v_wip_almox <> 14 then
    raise exception 'FALHOU: trabalho em processo do Almoxarifado = %, esperava 14', v_wip_almox; end if;
  if v_wip_embal <> 0 then
    raise exception 'FALHOU: % peça(s) continuam paradas na Embalagem — era o defeito', v_wip_embal; end if;

  -- 3) "Concluído": o Almoxarifado é o ÚLTIMO posto por ordem, e o último registro de TODAS as 14
  --    peças é ele — então postoPendenteDePeca devolve null pra cada uma e as 14 contam como
  --    finalizadas. Antes, nenhuma: a OP não concluía nunca.
  if (select posto from (select chave as posto, ordem from sf_postos order by ordem desc limit 1) u)
     <> 'Almoxarifado' then
    raise exception 'FALHOU: o teste assume o Almoxarifado como último posto da linha'; end if;
  with regs as (
    select numero_serie_norm, posto, data_hora, created_at
    from sf_registros
    where pmo = 'PMOC14' and op = '8498' and numero_serie_norm <> ''
  ),
  ult as (
    select distinct on (numero_serie_norm) numero_serie_norm, posto
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  )
  select count(*) into v_ult_posto from ult where posto <> 'Almoxarifado';
  if v_ult_posto <> 0 then
    raise exception 'FALHOU: % peça(s) não chegaram ao último posto', v_ult_posto; end if;

  raise notice '18. o Fluxo vê as 14 peças do bipe de caixa (WIP no Almoxarifado, nenhuma na Embalagem): ok';
end $t$;

-- ---------- 19. caixa fechada e etiquetada, mas sem nenhuma peça ----------
-- Não existe no fluxo normal (sf_fechar_caixa recusa fechar caixa vazia), mas existe DEPOIS de um
-- cancelamento de lançamento (0087) levar as linhas da Embalagem pra auditoria. Sem esta recusa o
-- bipe gravaria zero linha e ainda devolveria ok: o painel diria "0 peças" e a caixa ficaria fora do
-- estoque em silêncio — o mesmo tipo de contagem calada que esta correção veio matar.
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[11][14]8498-PMOC14', 'caixa', 14, '');
  if r->>'motivo' <> 'caixa_sem_pecas' then
    raise exception 'FALHOU: caixa sem peça tinha que ser recusada: %', r; end if;
  if (select count(*) from sf_registros where posto = 'Almoxarifado') <> 16 then
    raise exception 'FALHOU: a recusa gravou registro'; end if;
  raise notice '19. caixa fechada sem peça nenhuma → caixa_sem_pecas: ok';
end $t$;

-- ---------- 20. etiqueta e contagem real divergem ----------
-- A etiqueta da caixa 12 promete 14, mas só 13 peças estão carimbadas com o código dela. Quem manda
-- é a PEÇA: entram 13 linhas e o painel mostra 13 — não há como inventar a 14ª série, e deixar de
-- gravar as 13 por causa do número da etiqueta esconderia peça embalada do Fluxo (o defeito de
-- origem). A divergência só é possível se alguém mexeu nos dados depois do fechamento, então é a
-- etiqueta que está velha. A função avisa em log (raise warning) sem barrar a entrada — E devolve
-- `qtd_etiqueta` na resposta, que é o que o painel usa pra dizer "14 peças na etiqueta, 13
-- entraram". Só o log não servia: warning em chamada via PostgREST é engolido pelo supabase-js.
do $t$
declare r jsonb; v_n int;
begin
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  select 'Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[12][14]8498-PMOC14',
         'SN-' || (8100 + i)::text, (8100 + i)::text
  from generate_series(1, 13) i;

  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[12][14]8498-PMOC14', 'caixa', 14, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: a divergência não podia barrar a entrada: %', r; end if;
  if (r->>'quantidade')::int <> 13 then
    raise exception 'FALHOU: a quantidade tinha que ser a contagem real (13), veio %', r->>'quantidade'; end if;
  -- A divergência chega à TELA, não só ao log do Postgres.
  if coalesce(r->>'qtd_etiqueta', '') <> '14' then
    raise exception 'FALHOU: a etiqueta (14) tinha que voltar no JSON pro painel: %', r; end if;
  select count(*) into v_n from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[12][14]8498-PMOC14';
  if v_n <> 13 then raise exception 'FALHOU: esperava 13 linhas, veio %', v_n; end if;
  raise notice '20. etiqueta 14 × 13 peças reais → entram as 13, painel diz 13: ok';
end $t$;

-- ---------- 21. uma peça bipada duas vezes na mesma caixa é uma peça só ----------
-- Espelha a regra de sf_fechar_caixa (count distinct): se a Embalagem tem duas linhas da mesma peça
-- na mesma caixa, a entrada grava UMA. Sem o distinct, a caixa entraria com uma peça inflada.
do $t$
declare r jsonb; v_n int;
begin
  insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada)
  values ('PMOC14', '8498', 'Embalagem', 13, 14, 2, 'CX[13][2]8498-PMOC14', true);
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  values ('Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[13][2]8498-PMOC14', 'SN-8200', '8200'),
         ('Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[13][2]8498-PMOC14', 'SN-8200', '8200'),
         ('Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[13][2]8498-PMOC14', 'SN-8201', '8201');

  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[13][2]8498-PMOC14', 'caixa', 2, '');
  if (r->>'quantidade')::int <> 2 then
    raise exception 'FALHOU: peça repetida na caixa contou duas vezes: %', r; end if;
  select count(*) into v_n from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[13][2]8498-PMOC14';
  if v_n <> 2 then raise exception 'FALHOU: esperava 2 linhas, veio %', v_n; end if;
  raise notice '21. peça repetida na caixa entra uma vez só: ok';
end $t$;

-- ---------- 22. o insert não gravou nada: recusa em vez de "ok, 0 peças" ----------
-- O guard `caixa_sem_pecas` conta as peças num statement e o insert copia as peças em OUTRO. Em READ
-- COMMITTED cada statement pega um snapshot novo: se entre os dois um cancelamento de embalagem
-- (0106) comitar e REABRIR a caixa — o que reescreve o numero_caixa das peças de volta pro marcador
-- CX[seq] —, o insert não acha mais nada. Sem a conferência DEPOIS do insert a função devolveria
-- ok com quantidade 0: o operador leria "0 peças" e a caixa ficaria fora do estoque em silêncio, que
-- é o mesmo defeito calado que a recusa existe pra matar. As duas travas não se serializam (a 0106
-- trava por (OP, posto de embalagem), esta por (OP, posto de almoxarifado, bipe)), então a janela é
-- real.
--
-- O QUE ESTE TESTE PROVA, e o que não prova: a CORRIDA em si não é reproduzível aqui, e as duas
-- tentativas ficam registradas pra ninguém repetir. (1) Um gatilho de statement que apaga as linhas
-- antes do insert não serve: o que ele apaga ganha um command id NOVO, invisível pro snapshot do
-- próprio insert, que grava as linhas normalmente. (2) Segurar o insert numa trava de tabela (share
-- mode noutra sessão) e comitar o delete durante a espera também não: o snapshot do statement é
-- anterior à espera pela trava, e o insert grava as linhas do mesmo jeito. Sobra reproduzir o ESTADO
-- que a corrida produz — o insert não gravar linha nenhuma —, com um gatilho de linha que devolve
-- null (a linha é descartada e `row_count` vem 0). É esse estado que o guard novo enxerga.
insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada)
values ('PMOC14', '8498', 'Embalagem', 14, 2, 2, 'CX[14][2]8498-PMOC14', true);
insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
values ('Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[14][2]8498-PMOC14', 'SN-8250', '8250'),
       ('Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[14][2]8498-PMOC14', 'SN-8251', '8251');

create function public.teste_engole_insert() returns trigger language plpgsql as $f$
begin
  -- Só as linhas da caixa marcada, e só no posto de almoxarifado: o resto do teste continua gravando.
  if new.numero_caixa = coalesce(current_setting('teste.engolir', true), '') and new.posto = 'Almoxarifado' then
    return null;
  end if;
  return new;
end $f$;
create trigger teste_engole before insert on public.sf_registros
  for each row execute function public.teste_engole_insert();

do $t$
declare r jsonb; v_n int;
begin
  perform set_config('teste.engolir', 'CX[14][2]8498-PMOC14', false);
  r := sf_almoxarifado_entrada('PMOC14', '8498', 'Almoxarifado', 'Ana',
                               'CX[14][2]8498-PMOC14', 'caixa', 2, '');
  perform set_config('teste.engolir', '', false);

  if coalesce((r->>'ok')::boolean, true) is not false then
    raise exception 'FALHOU: entrada de zero peça devolveu ok: %', r; end if;
  if r->>'motivo' <> 'caixa_sem_pecas' then
    raise exception 'FALHOU: motivo errado pra caixa que ficou sem peça: %', r; end if;
  if r ? 'quantidade' then
    raise exception 'FALHOU: recusa não devolve quantidade: %', r; end if;
  select count(*) into v_n from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[14][2]8498-PMOC14';
  if v_n <> 0 then raise exception 'FALHOU: gravou % linha(s) numa caixa sem peça', v_n; end if;
  raise notice '22. insert sem nenhuma linha gravada → caixa_sem_pecas (e não "ok, 0 peças"): ok';
end $t$;

drop trigger teste_engole on public.sf_registros;
drop function public.teste_engole_insert();

-- ---------- 23. o colateral no NQA: o posto da caixa não é mais max(posto) (0130) ----------
-- Com o bipe de caixa gravando uma linha por peça, as linhas com aquele `numero_caixa` passaram a
-- estar em DOIS postos — e a sf_nqa_caixa da 0100 derivava o posto da caixa de `max(posto)`. A chave
-- do posto é livre: aqui o posto de almoxarifado se chama 'Estoque', que ordena DEPOIS de
-- 'Embalagem'. Com o `max`, v_posto_caixa vinha 'Estoque', que não está no p_posto_retorno, e
-- sf_aposentar_caixa NÃO era chamada: a caixa reprovada ficava com revisao = 0 e o código original
-- (o guard `caixa_reprovada` da 0129 nunca dispararia e ela daria entrada em estoque), e a montagem
-- aposentada não virava histórico. Com a chave 'Almoxarifado' o defeito não aparece — ela ordena
-- antes de 'Embalagem' —, e é por isso que o teste usa 'Estoque': depender da ordem do NOME é
-- justamente o que este projeto decidiu não fazer.

-- Stubs só do que a sf_nqa_caixa toca além do que já existe aqui.
create table public.tabela_nqa (
  ordem int primary key, quantidade_min int not null, quantidade_max int, tamanho_amostra numeric not null
);
insert into public.tabela_nqa values (1, 1, 100, 2);
-- Espião no lugar da sf_aposentar_caixa (0100): o que este teste precisa provar é COM QUAL POSTO ela
-- é chamada. A aposentadoria de verdade tem os seus próprios testes e renomearia o código no meio da
-- massa daqui.
create table public.teste_aposentadas (pmo text, op text, posto text, numero_caixa text);
create function public.sf_aposentar_caixa(p_pmo text, p_op text, p_posto text, p_numero_caixa text)
returns jsonb language plpgsql as $f$
begin
  insert into public.teste_aposentadas values (p_pmo, p_op, p_posto, p_numero_caixa);
  return jsonb_build_object('ok', true);
end $f$;

\i /tmp/0130.sql

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso)
values ('nqa', 'NQA', true, 'escolhido', 'registrado', false, 'nqa');
insert into public.sf_postos (chave, ordem, perfil) values
  ('Inspeção NQA', 11, 'nqa'),
  ('Estoque', 14, 'almoxarifado');
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC17', '8500', 'Cliente NQA', '9500', '9600', false);
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC17', '8500', 'Embalagem', 1, 3, 3, 'CX[1][3]8500-PMOC17', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC17', '8500', 'Cliente NQA', 'CX[1][3]8500-PMOC17',
       'SN-' || (9500 + i)::text, (9500 + i)::text
from generate_series(1, 3) i;

do $t$
declare r jsonb; v record;
begin
  -- 'lancar' (global) alimenta o gate de UM argumento da sf_nqa_caixa; 'shopfloor.lancar' é o da RPC
  -- do Almoxarifado. Os dois juntos porque o teste roda as duas funções em sequência.
  perform set_config('teste.perms', 'shopfloor.lancar,lancar', false);

  -- A entrada no Almoxarifado ACONTECE de verdade (é ela que cria o colateral): 3 linhas no posto
  -- 'Estoque', cada uma com a série da peça e o código da caixa.
  r := sf_almoxarifado_entrada('PMOC17', '8500', 'Estoque', 'Ana',
                               'CX[1][3]8500-PMOC17', 'caixa', 3, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: a entrada no Almoxarifado não passou: %', r; end if;
  if (select count(*) from sf_registros
       where posto = 'Estoque' and numero_caixa = 'CX[1][3]8500-PMOC17') <> 3 then
    raise exception 'FALHOU: o teste depende das 3 linhas do Almoxarifado'; end if;

  -- Agora a qualidade reprova a caixa e manda de volta pra Embalagem.
  r := sf_nqa_caixa('PMOC17', '8500', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8500-PMOC17',
                    'Reprovado', 'Embalagem',
                    '[{"sn_norm":"9501","visual":"Reprovado","funcional":"Aprovado","observacao":"riscada"}]'::jsonb);
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: a reprova no NQA não passou: %', r; end if;
  -- As linhas do Almoxarifado repetem as MESMAS séries, então a caixa continua sendo de 3 peças (o
  -- total é contagem de séries distintas, não de linhas) e o NQA grava 3 registros, não 6.
  if (r->>'total')::int <> 3 then
    raise exception 'FALHOU: a caixa virou de % peças por causa das linhas do Almoxarifado', r->>'total'; end if;
  if (select count(*) from sf_registros where pmo = 'PMOC17' and posto = 'Inspeção NQA') <> 3 then
    raise exception 'FALHOU: esperava 3 registros de NQA, veio %',
      (select count(*) from sf_registros where pmo = 'PMOC17' and posto = 'Inspeção NQA'); end if;

  -- O ponto do teste: a montagem foi aposentada NO POSTO DA CAIXA (Embalagem), e uma vez só.
  select count(*) as n, min(posto) as posto into v
    from teste_aposentadas where numero_caixa = 'CX[1][3]8500-PMOC17';
  if v.n <> 1 then
    raise exception 'FALHOU: sf_aposentar_caixa foi chamada % vez(es), esperava 1 — a caixa reprovada ficaria com o código original', v.n; end if;
  if v.posto <> 'Embalagem' then
    raise exception 'FALHOU: aposentou no posto errado (%) — o posto da caixa é da Embalagem', v.posto; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '23. NQA reprova: aposenta no posto da CAIXA mesmo com a linha do Almoxarifado: ok';
end $t$;

-- =============================================================
-- CANCELAR A CAIXA INTEIRA (migração 0131)
--
-- A entrada foi UM gesto (o bipe do código da caixa gravou N linhas), então o desfazer também é: uma
-- chamada, um motivo, as N linhas de uma vez. Antes eram N cancelamentos linha a linha e, parando no
-- meio, a caixa ficava meio dentro/meio fora — com o rebipe recusado por `ja_lancado` e sem caminho
-- de volta pela tela.
--
-- Estes testes rodam contra as funções REAIS do cancelamento: a 0087 (tabela de auditoria
-- sf_registros_cancelados) e a 0106 (sf_cancelar_lancamento, que é como se produz o estado parcial do
-- teste 32). Nenhuma das duas é editada — as duas estão em produção.
-- =============================================================

-- auth.uid(): a 0131 grava quem cancelou, como a irmã. Vazio aqui (cancelado_por é nullable) —
-- o que importa provar é a linha inteira na auditoria e o motivo, não o dono da sessão.
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

\i /tmp/0087.sql
\i /tmp/0106.sql
\i /tmp/0131.sql

-- Guarda ids entre blocos: cada `do $t$` é um escopo próprio, e o teste 28 precisa do id que o
-- teste 26 já apagou.
create table public.teste_caixa_ids (chave text primary key, id uuid);

-- Massa própria, numa OP nova: os testes de cima contam linhas do posto 'Almoxarifado' em números
-- absolutos, e mexer neles esconderia regressão.
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC18', '8501', 'Cliente Cancelar', '9700', '9800', false);
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC18', '8501', 'Embalagem', 1, 4, 4, 'CX[1][4]8501-PMOC18', true),
  ('PMOC18', '8501', 'Embalagem', 2, 3, 3, 'CX[2][3]8501-PMOC18', true),
  ('PMOC18', '8501', 'Embalagem', 3, 4, 4, 'CX[3][4]8501-PMOC18', true);
-- As peças de cada caixa, carimbadas na Embalagem (é de onde a entrada tira a lista).
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC18', '8501', 'Cliente Cancelar', 'CX[1][4]8501-PMOC18',
       'SN-' || (9700 + i)::text, (9700 + i)::text from generate_series(1, 4) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC18', '8501', 'Cliente Cancelar', 'CX[2][3]8501-PMOC18',
       'SN-' || (9710 + i)::text, (9710 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC18', '8501', 'Cliente Cancelar', 'CX[3][4]8501-PMOC18',
       'SN-' || (9720 + i)::text, (9720 + i)::text from generate_series(1, 4) i;

-- As duas entradas que os testes abaixo vão desfazer.
do $t$
declare r jsonb;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Ana', 'CX[1][4]8501-PMOC18', 'caixa', 4, '');
  if (r->>'quantidade')::int <> 4 then raise exception 'FALHOU (massa): caixa 1 não entrou: %', r; end if;
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Ana', 'CX[2][3]8501-PMOC18', 'caixa', 3, '');
  if (r->>'quantidade')::int <> 3 then raise exception 'FALHOU (massa): caixa 2 não entrou: %', r; end if;
  insert into public.teste_caixa_ids (chave, id)
  select 'cx1', id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[1][4]8501-PMOC18' order by numero_serie_norm limit 1;
  insert into public.teste_caixa_ids (chave, id)
  select 'cx2', id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[2][3]8501-PMOC18' order by numero_serie_norm limit 1;
end $t$;

-- ---------- 24. sem permissão de gestor, recusa ----------
-- O gate é o de DOIS argumentos ('shopfloor','administrar'), o mesmo da irmã e o mesmo que a tela
-- confere: a função de um argumento anula o RBAC (revisão de segurança de 21/09/2026). Quem só pode
-- LANÇAR não pode desfazer — senão o operador desfaria a própria entrada sem ninguém saber.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid;
begin
  select id into v_id from teste_caixa_ids where chave = 'cx1';
  perform set_config('teste.perms', 'shopfloor.lancar', false);
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'teste');
    v_passou := true;  -- marca aqui: um `raise` dentro do bloco seria pego pelo próprio handler
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: cancelou sem permissão de administrar'; end if;
  if v_erro <> 'SEM_PERMISSAO' then raise exception 'FALHOU: erro errado: %', v_erro; end if;

  -- Permissão de administrar de OUTRO módulo não serve.
  v_erro := null;
  perform set_config('teste.perms', 'recebimento.administrar,shopfloor.visualizar', false);
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'teste');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: administrar de outro módulo passou'; end if;
  if v_erro <> 'SEM_PERMISSAO' then raise exception 'FALHOU: erro errado: %', v_erro; end if;

  if (select count(*) from sf_registros where numero_caixa = 'CX[1][4]8501-PMOC18' and posto = 'Almoxarifado') <> 4 then
    raise exception 'FALHOU: a recusa apagou linha'; end if;
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  raise notice '24. cancelar a caixa sem permissão de gestor → SEM_PERMISSAO: ok';
end $t$;

-- ---------- 25. motivo obrigatório ----------
-- Um motivo SÓ pra caixa inteira, mas obrigatório do mesmo jeito: cancelamento sem motivo é dado
-- apagado sem explicação na auditoria. Só espaço em branco não conta como motivo.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid;
begin
  select id into v_id from teste_caixa_ids where chave = 'cx1';
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, '   ');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: cancelou com motivo em branco'; end if;
  if v_erro <> 'MOTIVO_OBRIGATORIO' then raise exception 'FALHOU: erro errado: %', v_erro; end if;
  if (select count(*) from sf_registros where numero_caixa = 'CX[1][4]8501-PMOC18' and posto = 'Almoxarifado') <> 4 then
    raise exception 'FALHOU: a recusa apagou linha'; end if;
  raise notice '25. motivo em branco → MOTIVO_OBRIGATORIO: ok';
end $t$;

-- ---------- 26. cancelar a caixa inteira: as N somem juntas e vão inteiras pra auditoria ----------
-- O coração da correção. Uma chamada, pelo id de UMA das linhas, apaga as 4 e grava as 4 na
-- auditoria com o MESMO motivo — e não encosta na outra caixa do mesmo posto.
do $t$
declare v_id uuid; v_n int; v_aud record;
begin
  select id into v_id from teste_caixa_ids where chave = 'cx1';
  v_n := sf_cancelar_caixa_almoxarifado(v_id, 'caixa bipada por engano');

  -- A contagem devolvida é o que a tela mostra ("4 peças canceladas").
  if v_n <> 4 then raise exception 'FALHOU: devolveu % em vez de 4 linhas canceladas', v_n; end if;
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[1][4]8501-PMOC18') <> 0 then
    raise exception 'FALHOU: sobrou linha da caixa — é o estado meio dentro/meio fora'; end if;

  -- A auditoria: uma entrada por peça (a linha INTEIRA em `dados`), todas com o mesmo motivo. Linha a
  -- linha de propósito: é o retrato fiel do que existia, e é ele que permite reconstruir a caixa.
  select count(*) as n, count(distinct motivo) as motivos, count(distinct numero_serie_norm) as sns,
         count(*) filter (where dados->>'numero_caixa' = 'CX[1][4]8501-PMOC18') as com_caixa,
         count(*) filter (where dados->>'posto' = 'Almoxarifado') as com_posto,
         min(motivo) as motivo
    into v_aud
    from sf_registros_cancelados
   where pmo = 'PMOC18' and op = '8501' and posto = 'Almoxarifado';
  if v_aud.n <> 4 then raise exception 'FALHOU: auditoria com % entradas, esperava 4', v_aud.n; end if;
  if v_aud.sns <> 4 then raise exception 'FALHOU: auditoria com % séries distintas, esperava 4', v_aud.sns; end if;
  if v_aud.motivos <> 1 or v_aud.motivo <> 'caixa bipada por engano' then
    raise exception 'FALHOU: o motivo tinha que ser um só nas 4: % (%)', v_aud.motivos, v_aud.motivo; end if;
  if v_aud.com_caixa <> 4 or v_aud.com_posto <> 4 then
    raise exception 'FALHOU: `dados` não guardou a linha inteira (caixa=%, posto=%)',
      v_aud.com_caixa, v_aud.com_posto; end if;

  -- A OUTRA caixa do mesmo posto continua inteira: o alcance é a caixa, não o posto.
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[2][3]8501-PMOC18') <> 3 then
    raise exception 'FALHOU: cancelar a caixa 1 mexeu na caixa 2'; end if;
  -- E as peças continuam na EMBALAGEM: cancelar a entrada no estoque não desembala nada.
  if (select count(*) from sf_registros
       where posto = 'Embalagem' and numero_caixa = 'CX[1][4]8501-PMOC18') <> 4 then
    raise exception 'FALHOU: cancelar a entrada mexeu nas linhas da Embalagem'; end if;
  raise notice '26. cancelar a caixa inteira → 4 apagadas, 4 na auditoria, um motivo só: ok';
end $t$;

-- ---------- 27. depois do cancelamento completo, o REBIPE funciona ----------
-- É o que fechava o beco sem saída: a duplicidade da 0129 procura QUALQUER linha com aquele código
-- naquele posto, e depois do cancelamento não sobra nenhuma. Sem isto, cancelar não devolveria a
-- caixa ao fluxo — ela simplesmente sairia do estoque pra sempre.
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Bruno', 'CX[1][4]8501-PMOC18', 'caixa', 4, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: o rebipe depois do cancelamento foi recusado: %', r; end if;
  if (r->>'quantidade')::int <> 4 then
    raise exception 'FALHOU: o rebipe entrou com % peças, esperava 4', r->>'quantidade'; end if;
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[1][4]8501-PMOC18') <> 4 then
    raise exception 'FALHOU: o rebipe não repôs as 4 linhas'; end if;
  raise notice '27. rebipe depois do cancelamento completo → aceito, 4 peças de novo: ok';
end $t$;

-- ---------- 28. caixa já cancelada ----------
-- O id do teste 26 já não existe (o cancelamento apagou a própria linha do p_id), e o rebipe do teste
-- 27 criou linhas NOVAS. Recusa por NAO_ENCONTRADO — que a tela traduz como "talvez já cancelado" —
-- em vez de cancelar por engano a entrada nova que acabou de ser feita.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid;
begin
  select id into v_id from teste_caixa_ids where chave = 'cx1';
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'de novo');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: cancelou uma caixa já cancelada'; end if;
  if v_erro <> 'NAO_ENCONTRADO' then raise exception 'FALHOU: erro errado: %', v_erro; end if;
  -- E não levou as linhas do rebipe junto.
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[1][4]8501-PMOC18') <> 4 then
    raise exception 'FALHOU: a recusa apagou as linhas do rebipe'; end if;
  raise notice '28. cancelar duas vezes a mesma caixa → NAO_ENCONTRADO: ok';
end $t$;

-- ---------- 29. entrada de OP INDIVIDUAL não é entrada de caixa ----------
-- Na embalagem individual a entrada grava numero_caixa vazio: já é uma peça, um bipe, uma linha, e
-- quem desfaz é a sf_cancelar_lancamento. Sem esta recusa, `numero_caixa = ''` casaria com TODAS as
-- entradas individuais do posto e uma chamada apagaria o posto inteiro.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid; v_antes int;
begin
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and pmo = 'PMOI01' and numero_serie_norm = '1042' limit 1;
  if v_id is null then raise exception 'FALHOU (massa): o teste 5 tinha que ter deixado a entrada da peça 1042'; end if;
  select count(*) into v_antes from sf_registros where posto = 'Almoxarifado';
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'teste');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: aceitou uma entrada sem caixa'; end if;
  if v_erro <> 'NAO_E_ENTRADA_DE_CAIXA' then raise exception 'FALHOU: erro errado: %', v_erro; end if;
  if (select count(*) from sf_registros where posto = 'Almoxarifado') <> v_antes then
    raise exception 'FALHOU: a recusa apagou linha do posto'; end if;
  raise notice '29. entrada individual (sem código de caixa) → NAO_E_ENTRADA_DE_CAIXA: ok';
end $t$;

-- ---------- 30. linha da EMBALAGEM não entra por aqui ----------
-- A Embalagem também grava numero_caixa, mas lá a caixa é outra coisa: as peças estão DENTRO dela, o
-- cancelamento reabre a caixa (0106) e o LIFO de cada peça manda. Cair aqui esvaziaria a caixa sem
-- reabrir nada. O gate é pelo RECURSO do perfil ('almoxarifado' exigido), nunca pelo nome do posto.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid;
begin
  select id into v_id from sf_registros
   where posto = 'Embalagem' and numero_caixa = 'CX[2][3]8501-PMOC18' limit 1;
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'teste');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: aceitou cancelar uma caixa da Embalagem'; end if;
  if v_erro <> 'POSTO_NAO_CANCELAVEL' then raise exception 'FALHOU: erro errado: %', v_erro; end if;
  if (select count(*) from sf_registros
       where posto = 'Embalagem' and numero_caixa = 'CX[2][3]8501-PMOC18') <> 3 then
    raise exception 'FALHOU: a recusa apagou linha da Embalagem'; end if;
  raise notice '30. linha da Embalagem → POSTO_NAO_CANCELAVEL: ok';
end $t$;

-- ---------- 31. uma peça com bipe POSTERIOR recusa a caixa inteira ----------
-- O LIFO é por peça, e o Almoxarifado é o último posto — então na prática nenhuma linha dele tem bipe
-- posterior. Mas se tiver (um posto novo depois dele, uma correção manual), a caixa é recusada
-- INTEIRA, e não "cancela as que dá": previsível é o que importa, e meio dentro/meio fora é o estado
-- que esta função existe pra matar.
do $t$
declare v_passou boolean := false; v_erro text; v_id uuid;
begin
  -- Uma peça da caixa 2 ganha um bipe depois da entrada no Almoxarifado.
  insert into sf_registros (data_hora, colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm)
  values (now() + interval '1 minute', 'Carlos', 'Inspeção Final', 'PMOC18', '8501',
          'Cliente Cancelar', 'SN-9711', '9711');

  select id into v_id from teste_caixa_ids where chave = 'cx2';
  begin
    perform sf_cancelar_caixa_almoxarifado(v_id, 'teste');
    v_passou := true;
  exception when others then v_erro := SQLERRM;
  end;
  if v_passou then raise exception 'FALHOU: cancelou com uma peça tendo bipe posterior'; end if;
  if v_erro <> 'NAO_E_ULTIMO' then raise exception 'FALHOU: erro errado: %', v_erro; end if;
  -- Nada foi pela metade: as 3 linhas continuam e a auditoria não ganhou entrada nenhuma.
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[2][3]8501-PMOC18') <> 3 then
    raise exception 'FALHOU: a recusa apagou parte da caixa'; end if;
  if exists (select 1 from sf_registros_cancelados where dados->>'numero_caixa' = 'CX[2][3]8501-PMOC18') then
    raise exception 'FALHOU: a recusa gravou auditoria'; end if;

  -- Desfeito o bipe posterior, a caixa volta a poder ser cancelada — a saída é explícita, não um
  -- cancelamento parcial.
  delete from sf_registros where posto = 'Inspeção Final' and pmo = 'PMOC18' and numero_serie_norm = '9711';
  if sf_cancelar_caixa_almoxarifado(v_id, 'agora sim') <> 3 then
    raise exception 'FALHOU: depois de tirar o bipe posterior, a caixa tinha que cancelar as 3'; end if;
  raise notice '31. peça com bipe posterior → NAO_E_ULTIMO, caixa intacta; sem ele, cancela as 3: ok';
end $t$;

-- ---------- 32. ESTADO PARCIAL: o ja_lancado diz quantas das N estão lançadas ----------
-- O beco sem saída de antes: a caixa entra inteira, alguém cancela linha por linha (0087/0106) e
-- para no meio. O rebipe continua recusado — e tem que continuar, senão um rebipe desfaria em
-- silêncio um cancelamento feito de propósito —, mas a recusa agora DIZ o que o gestor está olhando
-- ("2 de 4 peças desta caixa estão lançadas") e aponta a saída. Depois, cancelar a caixa inteira leva
-- o que sobrou e o rebipe volta a ser aceito.
do $t$
declare r jsonb; v_id uuid; v_n int;
begin
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Ana', 'CX[3][4]8501-PMOC18', 'caixa', 4, '');
  if (r->>'quantidade')::int <> 4 then raise exception 'FALHOU: a caixa 3 não entrou: %', r; end if;

  -- Cancela DUAS das quatro linhas, uma a uma, como era o único jeito antes da 0131.
  for v_id in
    select id from sf_registros
     where posto = 'Almoxarifado' and numero_caixa = 'CX[3][4]8501-PMOC18'
     order by numero_serie_norm limit 2
  loop
    perform sf_cancelar_lancamento(v_id, 'uma por uma');
  end loop;
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[3][4]8501-PMOC18') <> 2 then
    raise exception 'FALHOU (massa): esperava a caixa parcial com 2 linhas'; end if;

  -- O rebipe continua recusado (a unidade do bipe é a caixa), mas a frase mudou: ela conta.
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Bruno', 'CX[3][4]8501-PMOC18', 'caixa', 4, '');
  if r->>'motivo' <> 'ja_lancado' then
    raise exception 'FALHOU: o rebipe parcial não pode ser aceito: %', r; end if;
  if r->>'detalhe' not like '%2 de 4 peças%' then
    raise exception 'FALHOU: o detalhe tinha que dizer quantas das N estão lançadas: %', r->>'detalhe'; end if;
  -- E aponta o caminho de volta, que é o que faltava pra não ser beco sem saída.
  if r->>'detalhe' not like '%cancele a caixa inteira%' then
    raise exception 'FALHOU: o detalhe tinha que apontar a saída: %', r->>'detalhe'; end if;
  if r->>'detalhe' not like '%Ana%' then
    raise exception 'FALHOU: o detalhe perdeu o quando/por quem: %', r->>'detalhe'; end if;

  -- Caixa cheia, sem estado parcial: a frase diz "4 de 4" e NÃO fala de cancelamento no meio.
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Bruno', 'CX[1][4]8501-PMOC18', 'caixa', 4, '');
  if r->>'motivo' <> 'ja_lancado' then raise exception 'FALHOU: rebipe da caixa cheia: %', r; end if;
  if r->>'detalhe' not like '%4 de 4 peças%' then
    raise exception 'FALHOU: caixa cheia tinha que dizer 4 de 4: %', r->>'detalhe'; end if;
  if r->>'detalhe' like '%parou no meio%' then
    raise exception 'FALHOU: caixa cheia não é estado parcial: %', r->>'detalhe'; end if;

  -- A saída: cancelar a caixa inteira leva as 2 que sobraram (uma chamada, um motivo)…
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[3][4]8501-PMOC18' limit 1;
  v_n := sf_cancelar_caixa_almoxarifado(v_id, 'desfazendo o parcial');
  if v_n <> 2 then raise exception 'FALHOU: esperava cancelar as 2 que sobraram, veio %', v_n; end if;
  -- …e o rebipe volta a ser aceito, com a caixa inteira.
  r := sf_almoxarifado_entrada('PMOC18', '8501', 'Almoxarifado', 'Bruno', 'CX[3][4]8501-PMOC18', 'caixa', 4, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU: o rebipe depois de limpar o parcial foi recusado: %', r; end if;
  if (r->>'quantidade')::int <> 4 then
    raise exception 'FALHOU: o rebipe tinha que repor as 4 peças, veio %', r->>'quantidade'; end if;
  raise notice '32. estado parcial → ja_lancado diz "2 de 4" e aponta a saída; cancelar a caixa destrava o rebipe: ok';
end $t$;
