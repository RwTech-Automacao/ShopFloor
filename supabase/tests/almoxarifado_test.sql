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
-- OS POSTOS DE CADA OP. É por aqui que o resto do ShopFloor responde "este posto está nesta OP?"
-- (fluxo-repository, lancamento-repository, pesquisa-repository, todos por ordem_id), e é a tabela
-- que a recusa `posto_fora_da_op` da 0129 consulta. Entra no stub sem a coluna `ordem` (0030): a RPC
-- da entrada só pergunta se o par existe, não em que posição ele está.
create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null references public.sf_postos(chave),
  primary key (ordem_id, posto)
);
-- "esta OP passa por estes postos", pra massa. Cada OP deste arquivo precisa dos postos dela desde
-- que a entrada passou a recusar `posto_fora_da_op`; sem o açúcar, cada uma repetiria o mesmo insert
-- com o subselect do ordem_id e a massa afogaria o teste.
create function public.teste_op_postos(p_pmo text, p_op text, p_postos text[])
returns void language sql as $f$
  insert into public.sf_ordem_postos (ordem_id, posto)
  select o.id, p.posto
    from public.sf_ordens o, unnest(p_postos) as p(posto)
   where o.pmo = p_pmo and o.op = p_op
  on conflict do nothing;
$f$;
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
-- A fila de envio ao Compels (0132) entra AQUI, antes do primeiro bipe: desde a Fase 2 a entrada
-- grava em sf_estoque_envios na MESMA transação em que grava os registros, então sem a tabela nem a
-- primeira chamada da RPC passaria. A 0129 chama a sf_estoque_chave da 0132, que tem número MAIOR —
-- as migrações desta branch nunca foram aplicadas em banco nenhum e vão juntas; o corpo plpgsql só
-- resolve o nome na hora de executar.
\i /tmp/0132.sql

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

-- Os postos de cada OP. Antes da recusa `posto_fora_da_op` a massa não precisava disto — e era esse o
-- defeito: a entrada aceitava bipe num posto que a OP não tem, e as peças sumiam do Fluxo (que só
-- monta nó pros postos da OP e descarta registro de posto fora do fluxo).
do $t$ begin
  perform public.teste_op_postos('PMOC14', '8498', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOI01', '9000', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOI02', '9001', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOC16', '8499', array['Embalagem', 'Almoxarifado']);
end $t$;

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

-- ---------- 23. sf_nqa_caixa (0130): o posto da caixa, e caixa que já foi pro estoque ----------
-- A 0130 recria a sf_nqa_caixa com duas mudanças em relação à 0100 (que está em produção e não é
-- editada no lugar), e este bloco mede as duas, mais um controle:
--
--   (a) o POSTO DA CAIXA não é mais `max(posto)` dos registros;
--   (b) a recusa NOVA `CAIXA_JA_NO_ALMOXARIFADO` — caixa que já deu entrada no Almoxarifado não se
--       inspeciona mais;
--   (c) o controle: OP sem posto de almoxarifado nenhum inspeciona exatamente como sempre.
--
-- (a) e (b) são a mesma história. Foi o posto Almoxarifado que pôs as linhas de uma caixa em DOIS
-- postos (uma linha por peça, com a série da peça E o código da caixa) e tirou o `max(posto)` do
-- lugar: com ele, v_posto_caixa vinha do nome maior, não estava no p_posto_retorno, e
-- sf_aposentar_caixa NÃO era chamada — a caixa reprovada ficava com revisao = 0 e o código original
-- (a 0129 deixaria ela dar entrada em estoque) e a montagem aposentada não virava histórico.
--
-- A (b) fecha esse caminho pela frente: o NQA vem ANTES do estoque, então a caixa que já entrou não
-- volta pra inspeção. Mas o `max(posto)` erra sozinho, sem Almoxarifado nenhum — dois postos de
-- EMBALAGEM da mesma OP podem carimbar o MESMO código de caixa (o código não é único por
-- construção, e é por isso que a 0130 tem o desempate por `exists`) —, e é esse o cenário que a (a)
-- mede daqui pra frente. A chave do posto é livre: os postos deste teste se chamam 'Embalagem SMD'
-- (que ordena DEPOIS de 'Embalagem') e 'Estoque' (que ordena depois dos dois), porque depender da
-- ordem do NOME é justamente o que este projeto decidiu não fazer.

-- Stubs só do que a sf_nqa_caixa toca além do que já existe aqui.
create table public.tabela_nqa (
  ordem int primary key, quantidade_min int not null, quantidade_max int, tamanho_amostra numeric not null
);
insert into public.tabela_nqa values (1, 1, 100, 2);
-- Espião no lugar da sf_aposentar_caixa (0100): o que este teste precisa provar é COM QUAL POSTO ela
-- é chamada — e, no caso (b), que ela NÃO é chamada. A aposentadoria de verdade tem os seus próprios
-- testes e renomearia o código no meio da massa daqui.
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
  -- Segundo posto de EMBALAGEM, com nome que ordena depois de 'Embalagem': é ele que faz o
  -- `max(posto)` errar no caso (a), sem precisar de posto de almoxarifado nenhum.
  ('Embalagem SMD', 12, 'embalagem'),
  ('Estoque', 14, 'almoxarifado');
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC17', '8500', 'Cliente NQA',           '9500', '9600', false),
  ('PMOC22', '8506', 'Cliente NQA Estoque',   '9900', '9990', false),
  ('PMOC23', '8507', 'Cliente NQA Sem Almox', '9920', '9999', false);
-- A PMOC17 TEM o posto de almoxarifado na rota (é OP de verdade), só não deu entrada ainda: é isso
-- que faz o caso (a) provar que a recusa nova olha a ENTRADA, e não a mera existência do posto.
do $t$ begin
  perform public.teste_op_postos('PMOC17', '8500', array['Embalagem', 'Embalagem SMD', 'Inspeção NQA', 'Estoque']);
  perform public.teste_op_postos('PMOC22', '8506', array['Embalagem', 'Inspeção NQA', 'Estoque']);
  -- A (c) não tem posto de almoxarifado nenhum: é o retrato de toda OP cadastrada antes de o posto existir.
  perform public.teste_op_postos('PMOC23', '8507', array['Embalagem', 'Inspeção NQA']);
end $t$;

-- (a) As DUAS caixas com o MESMO código, uma em cada posto de embalagem — o empate que o desempate
-- por `exists`/`order by` da 0130 resolve, e que o `max(posto)` resolvia pro lado errado.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC17', '8500', 'Embalagem',     1, 3, 3, 'CX[1][3]8500-PMOC17', true),
  ('PMOC17', '8500', 'Embalagem SMD', 1, 3, 3, 'CX[1][3]8500-PMOC17', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC17', '8500', 'Cliente NQA', 'CX[1][3]8500-PMOC17',
       'SN-' || (9500 + i)::text, (9500 + i)::text
from generate_series(1, 3) i;
-- AS MESMAS TRÊS SÉRIES carimbadas também no outro posto de embalagem (peça bipada no posto errado).
-- Séries repetidas de propósito: a caixa continua sendo de 3 peças (o total é contagem de séries
-- DISTINTAS), então os números deste teste medem o posto da aposentadoria e nada mais.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem SMD', 'PMOC17', '8500', 'Cliente NQA', 'CX[1][3]8500-PMOC17',
       'SN-' || (9500 + i)::text, (9500 + i)::text
from generate_series(1, 3) i;

do $t$
declare r jsonb; v record;
begin
  -- 'lancar' (global) alimenta o gate de UM argumento da sf_nqa_caixa; 'shopfloor.lancar' é o da RPC
  -- do Almoxarifado. Os dois juntos porque o teste roda as duas funções em sequência.
  perform set_config('teste.perms', 'shopfloor.lancar,lancar', false);

  -- O que faz o `max(posto)` errar: as linhas do código estão em DOIS postos, e o maior deles não é
  -- o posto da caixa que a qualidade vai mandar remontar.
  if (select max(posto) from sf_registros
       where pmo = 'PMOC17' and numero_caixa = 'CX[1][3]8500-PMOC17') <> 'Embalagem SMD' then
    raise exception 'FALHOU: o teste depende de o max(posto) dos registros NÃO ser o posto da caixa'; end if;

  -- A qualidade reprova a caixa da 'Embalagem' e manda de volta pra lá.
  r := sf_nqa_caixa('PMOC17', '8500', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8500-PMOC17',
                    'Reprovado', 'Embalagem',
                    '[{"sn_norm":"9501","visual":"Reprovado","funcional":"Aprovado","observacao":"riscada"}]'::jsonb);
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU (a): a reprova no NQA não passou: %', r; end if;
  -- As séries repetidas no outro posto não incham a caixa (total = séries distintas), e o NQA grava
  -- 3 registros, não 6.
  if (r->>'total')::int <> 3 then
    raise exception 'FALHOU (a): a caixa virou de % peças por causa das linhas do outro posto', r->>'total'; end if;
  if (select count(*) from sf_registros where pmo = 'PMOC17' and posto = 'Inspeção NQA') <> 3 then
    raise exception 'FALHOU (a): esperava 3 registros de NQA, veio %',
      (select count(*) from sf_registros where pmo = 'PMOC17' and posto = 'Inspeção NQA'); end if;

  -- O ponto do teste: a montagem foi aposentada NO POSTO DA CAIXA (Embalagem), e uma vez só.
  select count(*) as n, min(posto) as posto into v
    from teste_aposentadas where numero_caixa = 'CX[1][3]8500-PMOC17';
  if v.n <> 1 then
    raise exception 'FALHOU (a): sf_aposentar_caixa foi chamada % vez(es), esperava 1 — a caixa reprovada ficaria com o código original', v.n; end if;
  if v.posto <> 'Embalagem' then
    raise exception 'FALHOU (a): aposentou no posto errado (%) — o posto da caixa é da Embalagem', v.posto; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '23(a). NQA reprova: aposenta no posto da CAIXA, e não no max(posto) dos registros: ok';
end $t$;

-- (b) A RECUSA NOVA. Massa própria porque a PMOC17 já foi inspecionada (e seria recusada por
-- CAIXA_JA_INSPECIONADA antes de chegar na guarda que interessa aqui).
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC22', '8506', 'Embalagem', 1, 3, 3, 'CX[1][3]8506-PMOC22', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC22', '8506', 'Cliente NQA Estoque', 'CX[1][3]8506-PMOC22',
       'SN-' || (9900 + i)::text, (9900 + i)::text
from generate_series(1, 3) i;

do $t$
declare r jsonb; v_erro text; v_regs int; v_codigo text; v_revisao int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,lancar', false);

  -- A entrada no Almoxarifado ACONTECE de verdade: 3 linhas no posto 'Estoque', cada uma com a série
  -- da peça e o código da caixa. É esse estado que a recusa existe pra defender.
  r := sf_almoxarifado_entrada('PMOC22', '8506', 'Estoque', 'Ana',
                               'CX[1][3]8506-PMOC22', 'caixa', 3, '');
  if coalesce((r->>'ok')::boolean, false) is not true then
    raise exception 'FALHOU (b): a entrada no Almoxarifado não passou: %', r; end if;

  -- Agora a qualidade tenta reprovar a caixa que JÁ ESTÁ NO ESTOQUE. Sem a recusa, a 0100 renomearia
  -- só as linhas da Embalagem, as 3 do Estoque ficariam com o código antigo, o rebipe da remontagem
  -- morreria em `ja_lancado` e nem "Cancelar a caixa inteira" nem "Cancelar lançamento" aceitariam
  -- desfazer (o bipe do NQA passaria a ser o mais recente). A caixa física nunca mais entraria.
  begin
    r := sf_nqa_caixa('PMOC22', '8506', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8506-PMOC22',
                      'Reprovado', 'Embalagem',
                      '[{"sn_norm":"9901","visual":"Reprovado","funcional":"Aprovado","observacao":"riscada"}]'::jsonb);
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'CAIXA_JA_NO_ALMOXARIFADO' then
    raise exception 'FALHOU (b): a reprova de caixa já no Almoxarifado devolveu "%" (r = %)', v_erro, r; end if;

  -- O 'Aprovado' também é recusado, e com amostra INSUFICIENTE de propósito: a caixa é de 3 peças,
  -- a Tabela NQA pede 2 amostras e aqui vai 1. Se a resposta fosse AMOSTRAS_INSUFICIENTES, a guarda
  -- estaria depois das validações do formulário — e o inspetor inspecionaria peça por peça pra ouvir
  -- o "não" no fim. É o teste da POSIÇÃO da guarda, não só da existência dela.
  begin
    r := sf_nqa_caixa('PMOC22', '8506', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8506-PMOC22',
                      'Aprovado', '',
                      '[{"sn_norm":"9901","visual":"Aprovado","funcional":"Aprovado","observacao":""}]'::jsonb);
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'CAIXA_JA_NO_ALMOXARIFADO' then
    raise exception 'FALHOU (b): o Aprovado devolveu "%" — esperava a recusa da caixa já no estoque, antes das validações da amostra', v_erro; end if;

  -- E a recusa não deixou rastro: caixa NÃO aposentada (revisao 0, código intocado), espião nunca
  -- chamado, nenhum registro no posto de NQA — e as 3 linhas do Almoxarifado continuam de pé, que é
  -- o que permite cancelar a entrada (teste 49).
  select revisao, codigo into v_revisao, v_codigo from sf_caixas
   where pmo = 'PMOC22' and op = '8506' and posto = 'Embalagem' and seq = 1;
  if v_revisao <> 0 or v_codigo <> 'CX[1][3]8506-PMOC22' then
    raise exception 'FALHOU (b): a caixa foi aposentada mesmo com a recusa (revisao %, código %)', v_revisao, v_codigo; end if;
  if exists (select 1 from teste_aposentadas where numero_caixa = 'CX[1][3]8506-PMOC22') then
    raise exception 'FALHOU (b): sf_aposentar_caixa foi chamada numa inspeção recusada'; end if;
  select count(*) into v_regs from sf_registros where pmo = 'PMOC22' and posto = 'Inspeção NQA';
  if v_regs <> 0 then
    raise exception 'FALHOU (b): a recusa gravou % registro(s) no posto de NQA', v_regs; end if;
  select count(*) into v_regs from sf_registros
   where pmo = 'PMOC22' and posto = 'Estoque' and numero_caixa = 'CX[1][3]8506-PMOC22';
  if v_regs <> 3 then
    raise exception 'FALHOU (b): as 3 linhas do Almoxarifado viraram %', v_regs; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '23(b). caixa que já deu entrada no Almoxarifado: NQA recusado (reprova e aprova), sem rastro: ok';
end $t$;

-- (c) O CONTROLE: OP que não passa por posto de almoxarifado nenhum. A recusa nova olha registro em
-- posto de perfil almoxarifado, então aqui ela não tem o que ver — e é o retrato de todas as OPs que
-- estão em produção hoje, antes de o posto existir.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC23', '8507', 'Embalagem', 1, 3, 3, 'CX[1][3]8507-PMOC23', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC23', '8507', 'Cliente NQA Sem Almox', 'CX[1][3]8507-PMOC23',
       'SN-' || (9920 + i)::text, (9920 + i)::text
from generate_series(1, 3) i;

do $t$
declare r jsonb;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,lancar', false);

  r := sf_nqa_caixa('PMOC23', '8507', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8507-PMOC23',
                    'Reprovado', 'Embalagem',
                    '[{"sn_norm":"9921","visual":"Reprovado","funcional":"Aprovado","observacao":"riscada"}]'::jsonb);
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'total')::int <> 3 then
    raise exception 'FALHOU (c): a caixa de OP sem Almoxarifado não passou no NQA: %', r; end if;
  if (select count(*) from teste_aposentadas
       where numero_caixa = 'CX[1][3]8507-PMOC23' and posto = 'Embalagem') <> 1 then
    raise exception 'FALHOU (c): a montagem não foi aposentada na Embalagem'; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '23(c). OP sem posto de almoxarifado: NQA aprova/reprova como sempre: ok';
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
-- A 0133 troca a sf_cancelar_lancamento (create or replace) pra ela também reverter na fila de estoque
-- quando a linha cancelada é uma entrada de Almoxarifado. Depois da 0106, que é a versão de produção.
\i /tmp/0133.sql

-- Guarda ids entre blocos: cada `do $t$` é um escopo próprio, e o teste 28 precisa do id que o
-- teste 26 já apagou.
create table public.teste_caixa_ids (chave text primary key, id uuid);

-- Massa própria, numa OP nova: os testes de cima contam linhas do posto 'Almoxarifado' em números
-- absolutos, e mexer neles esconderia regressão.
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC18', '8501', 'Cliente Cancelar', '9700', '9800', false);
do $t$ begin perform public.teste_op_postos('PMOC18', '8501', array['Embalagem', 'Almoxarifado']); end $t$;
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

-- =============================================================
-- A FILA DE ENVIO AO COMPELS (0132) — o bipe enfileira, o cancelamento reverte (Fase 2, Task 2)
--
-- Por que estes testes moram AQUI e não no estoque_envios_test.sql: o que se prova nesta parte não é
-- a fila em si (a 0132 tem os testes dela), é o LIGAMENTO — que o bipe e o cancelamento gravam na
-- fila DENTRO da mesma transação em que mexem em sf_registros. Isso só se prova rodando as RPCs de
-- verdade, contra a massa que os testes de cima já montaram.
--
-- A 0132 é aplicada no topo deste arquivo (logo depois da 0129), então todas as entradas aceitas
-- pelos testes 1..32 já passaram pela fila. As asserções abaixo são sempre POR ALVO (o bipe) e nunca
-- por contagem total da tabela: contagem total viraria uma conta a acertar a cada teste novo.
-- =============================================================

-- ---------- 33. a entrada de PEÇA enfileira UMA linha, pendente ----------
-- A entrada do teste 5 (peça 1042, OP de embalagem individual). O que importa: uma linha só, com a
-- identidade do bipe em `alvo` = a SÉRIE NORMALIZADA (nunca o bipe cru — pelo cru, a mesma peça com
-- um zero à esquerda a mais no coletor geraria duas chaves e entraria duas vezes no ERP) e a chave
-- com E1, a primeira entrada daquele bipe.
do $t$
declare e public.sf_estoque_envios; v_n int;
begin
  select count(*) into v_n from sf_estoque_envios
   where pmo = 'PMOI01' and op = '9000' and posto = 'Almoxarifado' and alvo = '1042';
  if v_n <> 1 then
    raise exception 'FALHOU: o bipe da peça tinha que deixar 1 linha na fila, veio %', v_n; end if;

  select * into e from sf_estoque_envios
   where pmo = 'PMOI01' and op = '9000' and posto = 'Almoxarifado' and alvo = '1042';
  if e.chave <> 'ALMOX/PMOI01/9000/Almoxarifado/1042/E1' then
    raise exception 'FALHOU: chave errada: %', e.chave; end if;
  if e.operacao <> 'entrada' or e.tipo <> 'serie' then
    raise exception 'FALHOU: operacao/tipo errados: % / %', e.operacao, e.tipo; end if;
  if e.bipe <> '1042' or e.serie_norm <> '1042' then
    raise exception 'FALHOU: bipe/serie_norm errados: % / %', e.bipe, e.serie_norm; end if;
  if e.quantidade <> 1 then raise exception 'FALHOU: peça vale 1, veio %', e.quantidade; end if;
  -- Pendente: o bipe NÃO espera o ERP, só deixa a linha na fila.
  if e.ok or e.tentativas <> 0 or e.enviado_em is not null or e.cancelado_em is not null then
    raise exception 'FALHOU: a linha tinha que nascer pendente: %', to_jsonb(e); end if;
  raise notice '33. entrada de peça → 1 linha na fila (alvo = série normalizada, E1, pendente): ok';
end $t$;

-- ---------- 34. a entrada de CAIXA enfileira UMA linha POR BIPE, não uma por peça ----------
-- A GRANULARIDADE, que é a decisão desta tarefa: em sf_registros o bipe de caixa grava uma linha por
-- PEÇA (é o que faz o posto não ser especial pra nenhum leitor do sistema); na fila ele grava UMA
-- linha só, com `quantidade` = as peças que entraram. A unidade da fila é a MOVIMENTAÇÃO de estoque,
-- e a movimentação é o bipe: o ERP recebe "entraram 14 peças da caixa X", que é o que o operador fez.
-- Uma linha por peça daria 14 chamadas ao ERP pro mesmo gesto, 14 chances de erro parcial e uma fila
-- 14 vezes maior — e a identidade do bipe (`alvo`, a chave de idempotência) já é a da CAIXA, não a da
-- peça: por peça, a chave teria que ser outra e nada casaria com o cancelamento.
do $t$
declare e public.sf_estoque_envios; v_n int;
begin
  select count(*) into v_n from sf_estoque_envios
   where pmo = 'PMOC14' and op = '8498' and alvo = 'CX[7][14]8498-PMOC14';
  if v_n <> 1 then
    raise exception 'FALHOU: 14 peças, mas a fila é por BIPE — esperava 1 linha, veio %', v_n; end if;

  select * into e from sf_estoque_envios
   where pmo = 'PMOC14' and op = '8498' and alvo = 'CX[7][14]8498-PMOC14';
  if e.chave <> 'ALMOX/PMOC14/8498/Almoxarifado/CX[7][14]8498-PMOC14/E1' then
    raise exception 'FALHOU: chave errada: %', e.chave; end if;
  if e.tipo <> 'caixa' or e.bipe <> 'CX[7][14]8498-PMOC14' or e.serie_norm <> '' then
    raise exception 'FALHOU: tipo/bipe/serie_norm errados: %', to_jsonb(e); end if;
  if e.quantidade <> 14 then
    raise exception 'FALHOU: a quantidade da caixa é a contagem das peças (14), veio %', e.quantidade; end if;

  -- E a quantidade é a que REALMENTE entrou, não a da etiqueta: a caixa 12 do teste 20 promete 14 e
  -- tem 13 peças. Mandar 14 pro ERP por causa do número impresso inflaria o estoque em silêncio.
  select quantidade into v_n from sf_estoque_envios
   where pmo = 'PMOC14' and op = '8498' and alvo = 'CX[12][14]8498-PMOC14';
  if v_n <> 13 then
    raise exception 'FALHOU: etiqueta 14 × 13 peças reais — a fila tinha que levar 13, veio %', v_n; end if;
  raise notice '34. entrada de caixa → 1 linha na fila por BIPE, quantidade = peças reais: ok';
end $t$;

-- ---------- 35. A FALHA DE UM LADO ABORTA O BIPE: o erro PROPAGA, ninguém o engole ----------
-- É o que faz o registro e a fila serem um gesto só: os dois inserts estão na MESMA transação, então
-- basta o erro de um deles CHEGAR a quem chamou pra que nada do outro vingue. É isso que este teste
-- mede, com um gatilho que explode em cada lado:
--   (a) o registro explode → o erro tem que sair da RPC;
--   (b) a fila explode → o erro tem que sair da RPC.
-- O (b) é o que pega a "melhoria" mais provável de alguém escrever depois: engolir o erro da fila com
-- um `exception when others then null` pra "não quebrar o bipe por causa do ERP". Engolido, o insert
-- dos registros comitaria sozinho e a peça ficaria no ShopFloor sem NUNCA ir pro Compels, calada — o
-- erro silencioso que esta integração inteira existe pra não ter.
--
-- O QUE ESTE TESTE NÃO PROVA — e o comentário daqui prometia antes (achado de revisão): que não sobra
-- meio gesto gravado. Ele roda a RPC dentro de um `begin ... exception when others`, que abre uma
-- SUBTRANSAÇÃO: ela desfaz os dois lados de qualquer forma, então contar linhas depois dela devolve
-- zero MESMO SE a RPC tivesse gravado um lado só. A prova de que nada sobra tem que vir de FORA da
-- transação que falhou, e vem: está no rodar-almoxarifado-test.sh, seção "atomicidade vista de fora",
-- onde o bipe roda em autocommit numa sessão e a conferência vem de outra (é pra ela que a caixa 3
-- desta massa existe). Aqui ficam só as asserções que a subtransação não falseia: a mensagem de erro
-- que PROPAGOU, e o bipe entrando normal depois que os gatilhos saem. Lá fora os DOIS sentidos são
-- medidos: a fila explodindo (caixa 3) e o registro explodindo (caixa 4).
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC19', '8502', 'Cliente Transação', '9900', '9990', false);
do $t$ begin perform public.teste_op_postos('PMOC19', '8502', array['Embalagem', 'Almoxarifado']); end $t$;
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC19', '8502', 'Embalagem', 1, 2, 2, 'CX[1][2]8502-PMOC19', true),
  ('PMOC19', '8502', 'Embalagem', 2, 2, 2, 'CX[2][2]8502-PMOC19', true),
  -- as caixas 3 e 4 ficam de pé, sem entrada nenhuma: são a massa das duas provas de fora, no runner
  -- (a 3 para o lado da FILA explodindo, a 4 para o lado do REGISTRO — os dois sentidos)
  ('PMOC19', '8502', 'Embalagem', 3, 2, 2, 'CX[3][2]8502-PMOC19', true),
  ('PMOC19', '8502', 'Embalagem', 4, 2, 2, 'CX[4][2]8502-PMOC19', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC19', '8502', 'Cliente Transação', 'CX[1][2]8502-PMOC19',
       'SN-' || (9900 + i)::text, (9900 + i)::text from generate_series(1, 2) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC19', '8502', 'Cliente Transação', 'CX[2][2]8502-PMOC19',
       'SN-' || (9910 + i)::text, (9910 + i)::text from generate_series(1, 2) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC19', '8502', 'Cliente Transação', 'CX[3][2]8502-PMOC19',
       'SN-' || (9920 + i)::text, (9920 + i)::text from generate_series(1, 2) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC19', '8502', 'Cliente Transação', 'CX[4][2]8502-PMOC19',
       'SN-' || (9930 + i)::text, (9930 + i)::text from generate_series(1, 2) i;

-- Fica no banco depois do teste de propósito: a prova de fora, no runner, cria outro gatilho com ela.
create function public.teste_explode() returns trigger language plpgsql as $f$
begin
  raise exception 'EXPLODIU';
end $f$;

do $t$
declare v_erro text;
begin
  -- (a) o registro falha
  create trigger teste_explode_registro before insert on public.sf_registros
    for each row when (new.posto = 'Almoxarifado' and new.numero_caixa = 'CX[1][2]8502-PMOC19')
    execute function public.teste_explode();
  begin
    perform sf_almoxarifado_entrada('PMOC19', '8502', 'Almoxarifado', 'Ana',
                                    'CX[1][2]8502-PMOC19', 'caixa', 2, '');
  exception when others then v_erro := SQLERRM;
  end;
  drop trigger teste_explode_registro on public.sf_registros;
  if coalesce(v_erro, '') not like '%EXPLODIU%' then
    raise exception 'FALHOU: a RPC engoliu a falha do registro (erro = %)', v_erro; end if;

  -- (b) a fila falha
  create trigger teste_explode_fila before insert on public.sf_estoque_envios
    for each row when (new.bipe = 'CX[2][2]8502-PMOC19') execute function public.teste_explode();
  v_erro := null;
  begin
    perform sf_almoxarifado_entrada('PMOC19', '8502', 'Almoxarifado', 'Ana',
                                    'CX[2][2]8502-PMOC19', 'caixa', 2, '');
  exception when others then v_erro := SQLERRM;
  end;
  drop trigger teste_explode_fila on public.sf_estoque_envios;
  if coalesce(v_erro, '') not like '%EXPLODIU%' then
    raise exception 'FALHOU: a falha da fila não abortou o bipe (erro = %) — a peça entraria no ShopFloor e nunca no ERP', v_erro; end if;

  -- Sem os gatilhos, o mesmo bipe entra normal: um registro por peça, uma linha na fila.
  perform sf_almoxarifado_entrada('PMOC19', '8502', 'Almoxarifado', 'Ana',
                                  'CX[2][2]8502-PMOC19', 'caixa', 2, '');
  if (select count(*) from sf_registros
       where posto = 'Almoxarifado' and numero_caixa = 'CX[2][2]8502-PMOC19') <> 2
     or (select count(*) from sf_estoque_envios where alvo = 'CX[2][2]8502-PMOC19') <> 1 then
    raise exception 'FALHOU: depois dos gatilhos, o bipe tinha que entrar normal'; end if;
  raise notice '35. a falha de qualquer um dos dois lados propaga e aborta o bipe: ok';
end $t$;

-- =============================================================
-- O CANCELAMENTO NA FILA — a decisão que mais importa nesta tarefa.
--
-- Cancelar uma entrada que JÁ FOI pro ERP é um estorno: uma linha nova, com sinal trocado (operacao
-- = 'estorno', que a chave escreve como S). Cancelar uma que AINDA NÃO SAIU não é: é cancelar o
-- envio pendente (`cancelado_em`). Senão manda-se pro ERP uma entrada e uma saída que nunca
-- precisaram existir, e alguém do outro lado gasta meia hora entendendo por que apareceu movimento
-- de nada.
-- =============================================================

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC20', '8503', 'Cliente Estorno', '9950', '9999', false);
do $t$ begin perform public.teste_op_postos('PMOC20', '8503', array['Embalagem', 'Almoxarifado']); end $t$;
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 1, 3, 3, 'CX[1][3]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 2, 2, 2, 'CX[2][2]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 3, 3, 3, 'CX[3][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[1][3]8503-PMOC20',
       'SN-' || (9950 + i)::text, (9950 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[2][2]8503-PMOC20',
       'SN-' || (9960 + i)::text, (9960 + i)::text from generate_series(1, 2) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[3][3]8503-PMOC20',
       'SN-' || (9970 + i)::text, (9970 + i)::text from generate_series(1, 3) i;

-- ---------- 36. cancelar a caixa com o envio AINDA PENDENTE → cancela o envio, sem estorno ----------
do $t$
declare e public.sf_estoque_envios; v_id uuid; v_n int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[1][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 1 não entrou'; end if;

  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[1][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'bipou a caixa errada') <> 3 then
    raise exception 'FALHOU (massa): esperava cancelar as 3 peças'; end if;

  select * into e from sf_estoque_envios
   where alvo = 'CX[1][3]8503-PMOC20' and operacao = 'entrada';
  if e.cancelado_em is null then
    raise exception 'FALHOU: o envio ainda não tinha saído — tinha que ser CANCELADO, não estornado: %', to_jsonb(e); end if;
  if e.ok then raise exception 'FALHOU: cancelou uma entrada marcada como enviada: %', to_jsonb(e); end if;

  -- E nada de estorno: entrada e saída que nunca precisaram existir não vão pro ERP.
  select count(*) into v_n from sf_estoque_envios
   where alvo = 'CX[1][3]8503-PMOC20' and operacao = 'estorno';
  if v_n <> 0 then
    raise exception 'FALHOU: criou % estorno(s) de uma entrada que nunca saiu daqui', v_n; end if;
  raise notice '36. cancelar caixa com envio pendente → cancela o envio, sem estorno: ok';
end $t$;

-- ---------- 37. cancelar a caixa com o envio JÁ ENVIADO → estorno ----------
-- Aqui não tem escolha: o ERP já contou as peças, e a única forma de descontar é uma movimentação
-- nova de saída. A entrada continua como está (o check da 0132 proíbe cancelar o que já foi enviado).
do $t$
declare e public.sf_estoque_envios; v_ent public.sf_estoque_envios; v_id uuid;
begin
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[2][2]8503-PMOC20', 'caixa', 2, '')->>'quantidade')::int <> 2 then
    raise exception 'FALHOU (massa): a caixa 2 não entrou'; end if;
  -- O servidor entregou ao Compels (é o que a Task 3 vai fazer de verdade).
  update sf_estoque_envios set ok = true, enviado_em = now(), tentativas = 1
   where alvo = 'CX[2][2]8503-PMOC20' and operacao = 'entrada';

  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[2][2]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'caixa voltou do cliente') <> 2 then
    raise exception 'FALHOU (massa): esperava cancelar as 2 peças'; end if;

  select * into e from sf_estoque_envios
   where alvo = 'CX[2][2]8503-PMOC20' and operacao = 'estorno';
  if not found then
    raise exception 'FALHOU: a entrada já tinha ido pro ERP e ninguém enfileirou o estorno'; end if;
  -- Chave de MOVIMENTAÇÃO NOVA (S1), senão o ERP descartaria o estorno como repetição da entrada.
  if e.chave <> 'ALMOX/PMOC20/8503/Almoxarifado/CX[2][2]8503-PMOC20/S1' then
    raise exception 'FALHOU: chave do estorno errada: %', e.chave; end if;
  -- Mesma identidade de bipe da entrada (tipo/bipe/serie_norm copiados dela): é o que faz o `alvo`
  -- do estorno bater com o da entrada — sem isso, o contador da chave e a busca do cancelamento
  -- olhariam pra bipes diferentes.
  if e.tipo <> 'caixa' or e.bipe <> 'CX[2][2]8503-PMOC20' or e.serie_norm <> '' then
    raise exception 'FALHOU: o estorno não copiou a identidade do bipe: %', to_jsonb(e); end if;
  -- Quantidade SEMPRE positiva (o sinal é assunto da carga, montada na hora do envio) e igual ao
  -- que o ERP recebeu.
  if e.quantidade <> 2 then
    raise exception 'FALHOU: o estorno tinha que reverter as 2 peças que foram enviadas, veio %', e.quantidade; end if;
  if e.ok or e.cancelado_em is not null or e.tentativas <> 0 then
    raise exception 'FALHOU: o estorno tinha que nascer pendente: %', to_jsonb(e); end if;

  select * into v_ent from sf_estoque_envios
   where alvo = 'CX[2][2]8503-PMOC20' and operacao = 'entrada';
  if not v_ent.ok or v_ent.cancelado_em is not null then
    raise exception 'FALHOU: a entrada já enviada não se cancela: %', to_jsonb(v_ent); end if;
  raise notice '37. cancelar caixa com envio já entregue → estorno S1, entrada intacta: ok';
end $t$;

-- ---------- 38. rebipe depois do cancelamento gera chave NOVA ----------
-- Sem o contador na chave, o rebipe da caixa 1 bateria na chave da entrada de ontem (E1, cancelada) e
-- a caixa nunca chegaria ao estoque: uma chave gasta não se reaproveita, porque não se sabe se o ERP
-- viu a primeira (pode ter sido cancelada justamente depois de um envio com resposta perdida).
do $t$
declare e public.sf_estoque_envios;
begin
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Bruno',
                              'CX[1][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU: o rebipe depois do cancelamento tinha que ser aceito'; end if;

  select * into e from sf_estoque_envios
   where alvo = 'CX[1][3]8503-PMOC20' and operacao = 'entrada' and cancelado_em is null;
  if not found then raise exception 'FALHOU: o rebipe não enfileirou nada'; end if;
  if e.chave <> 'ALMOX/PMOC20/8503/Almoxarifado/CX[1][3]8503-PMOC20/E2' then
    raise exception 'FALHOU: o rebipe tinha que gerar chave nova (E2), veio %', e.chave; end if;
  if e.quantidade <> 3 then raise exception 'FALHOU: o rebipe tinha que repor as 3 peças, veio %', e.quantidade; end if;
  -- E a primeira continua cancelada, no lugar dela: é o histórico de que aquela entrada existiu.
  if (select count(*) from sf_estoque_envios
       where alvo = 'CX[1][3]8503-PMOC20' and operacao = 'entrada' and cancelado_em is not null) <> 1 then
    raise exception 'FALHOU: a entrada cancelada tinha que continuar na tabela'; end if;
  raise notice '38. rebipe depois de cancelar → E2, sem bater na chave de ontem: ok';
end $t$;

-- ---------- 39. CANCELAMENTO DE LINHA AVULSA (0133) também reverte na fila ----------
-- A sf_cancelar_lancamento é a irmã que desfaz UMA linha, e ela está em produção desde a 0087 — por
-- isso a mudança vem numa migração nova (0133, `create or replace`). Os três casos:
--   (a) peça individual com o envio pendente → cancela o envio (uma linha, uma peça, nada sobra);
--   (b) peça individual já enviada → estorno de 1;
--   (c) UMA peça de uma caixa cujo envio ainda está pendente → a linha da fila é AJUSTADA (3 → 2).
-- O (c) é a decisão menos óbvia: a entrada da caixa ainda não saiu, então ela ainda descreve o que
-- VAI ser enviado — e o que vai ser enviado agora são 2 peças. Mandar 3 e estornar 1 seria pedir ao
-- ERP duas movimentações para um número que ainda podia ser corrigido aqui. Quando a última peça da
-- caixa cair, a linha é cancelada (é o caso (a) de novo, por outro caminho).
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOI03', '9002', 'Cliente Avulso', '2000', '2100', true);
do $t$ begin perform public.teste_op_postos('PMOI03', '9002', array['Embalagem', 'Almoxarifado']); end $t$;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm)
values ('Marcos', 'Embalagem', 'PMOI03', '9002', 'Cliente Avulso', '2001', 1, '2001', '2001');

do $t$
declare e public.sf_estoque_envios; v_id uuid; v_n int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);

  -- (a) peça individual, envio PENDENTE: é a entrada do teste 5 (peça 1042), que nunca saiu.
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and pmo = 'PMOI01' and numero_serie_norm = '1042';
  perform sf_cancelar_lancamento(v_id, 'entrada errada');
  select * into e from sf_estoque_envios where alvo = '1042' and operacao = 'entrada';
  if e.cancelado_em is null then
    raise exception 'FALHOU: o envio pendente da peça tinha que ser cancelado: %', to_jsonb(e); end if;
  if (select count(*) from sf_estoque_envios where alvo = '1042' and operacao = 'estorno') <> 0 then
    raise exception 'FALHOU: estornou uma entrada que nunca saiu daqui'; end if;

  -- (b) peça individual JÁ ENVIADA: estorno de 1.
  if (sf_almoxarifado_entrada('PMOI03', '9002', 'Almoxarifado', 'Ana', '2001', 'serie', 1, '2001')
        ->>'quantidade')::int <> 1 then
    raise exception 'FALHOU (massa): a peça 2001 não entrou'; end if;
  update sf_estoque_envios set ok = true, enviado_em = now(), tentativas = 1
   where alvo = '2001' and operacao = 'entrada';
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and pmo = 'PMOI03' and numero_serie_norm = '2001';
  perform sf_cancelar_lancamento(v_id, 'peça voltou');
  select * into e from sf_estoque_envios where alvo = '2001' and operacao = 'estorno';
  if not found then raise exception 'FALHOU: a peça já enviada não gerou estorno'; end if;
  if e.chave <> 'ALMOX/PMOI03/9002/Almoxarifado/2001/S1' then
    raise exception 'FALHOU: chave do estorno da peça errada: %', e.chave; end if;
  if e.tipo <> 'serie' or e.serie_norm <> '2001' or e.quantidade <> 1 then
    raise exception 'FALHOU: estorno da peça errado: %', to_jsonb(e); end if;

  -- (c) uma peça de caixa com envio PENDENTE: a linha da fila é ajustada, não estornada.
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[3][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 3 não entrou'; end if;
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[3][3]8503-PMOC20' order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'uma peça só');
  select * into e from sf_estoque_envios where alvo = 'CX[3][3]8503-PMOC20' and operacao = 'entrada';
  if e.cancelado_em is not null then
    raise exception 'FALHOU: sobraram 2 peças na caixa — o envio não podia ser cancelado: %', to_jsonb(e); end if;
  if e.quantidade <> 2 then
    raise exception 'FALHOU: o envio pendente tinha que passar a valer 2 peças, veio %', e.quantidade; end if;
  if (select count(*) from sf_estoque_envios where alvo = 'CX[3][3]8503-PMOC20' and operacao = 'estorno') <> 0 then
    raise exception 'FALHOU: estornou peça de uma entrada que ainda nem saiu'; end if;

  -- E quando a última peça cai, o envio é cancelado (não sobra entrada de caixa vazia na fila).
  for v_id in select id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[3][3]8503-PMOC20' order by numero_serie_norm
  loop
    perform sf_cancelar_lancamento(v_id, 'e as outras duas');
  end loop;
  select * into e from sf_estoque_envios where alvo = 'CX[3][3]8503-PMOC20' and operacao = 'entrada';
  if e.cancelado_em is null then
    raise exception 'FALHOU: a caixa ficou sem nenhuma peça e o envio continuou pendente: %', to_jsonb(e); end if;
  select count(*) into v_n from sf_estoque_envios
   where alvo = 'CX[3][3]8503-PMOC20' and operacao = 'estorno';
  if v_n <> 0 then raise exception 'FALHOU: criou % estorno(s) de entrada que nunca saiu', v_n; end if;
  raise notice '39. cancelamento avulso: pendente cancela, enviado estorna, caixa parcial ajusta: ok';
end $t$;

-- ---------- 40. entrada SEM linha na fila (histórico) não inventa estorno ----------
-- Toda entrada gravada ANTES desta migração não tem linha na fila. Cancelar uma delas não pode
-- enfileirar estorno nenhum: seria mandar ao ERP uma saída de uma entrada que ele nunca recebeu.
do $t$
declare v_id uuid;
begin
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
  values ('Marcos', 'Almoxarifado', 'PMOI03', '9002', 'Cliente Avulso', '', '2099', '2099')
  returning id into v_id;

  perform sf_cancelar_lancamento(v_id, 'entrada antiga');
  if exists (select 1 from sf_estoque_envios where alvo = '2099') then
    raise exception 'FALHOU: inventou envio pra uma entrada que nunca passou pela fila'; end if;
  if exists (select 1 from sf_registros where id = v_id) then
    raise exception 'FALHOU: o cancelamento não apagou a linha'; end if;
  raise notice '40. entrada anterior à fila → cancela sem estorno: ok';
end $t$;


-- ---------- 41. A SOMA DOS ESTORNOS DE UMA ENTRADA NUNCA PASSA DO QUE FOI ENVIADO ----------
-- O achado que este teste trava: o estorno do BIPE INTEIRO (p_quantidade nulo) ignorava o que já
-- havia sido estornado peça por peça, e mandava a quantidade CHEIA de novo. Numa caixa de 3 já
-- entregue ao ERP: cancela 1 peça (estorno de 1), cancela a caixa inteira (estorno de 3) = 4 peças
-- estornadas de uma entrada de 3. O ERP fica com estoque NEGATIVO de uma peça, para sempre.
--
-- E não é caminho exótico: é a sequência que a PRÓPRIA recusa do sistema manda o gestor seguir num
-- estado parcial ("Um cancelamento anterior parou no meio: cancele a caixa inteira em Registros e
-- bipe outra vez", 0129) — com o rebipe que a frase pede, a caixa de 3 fecharia o ciclo valendo 2
-- peças no Compels.
--
-- A asserção é sobre a INVARIANTE, não sobre o mecanismo: somando todos os estornos daquele bipe, o
-- total tem que ser exatamente o que o ERP recebeu.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 4, 3, 3, 'CX[4][3]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 5, 3, 3, 'CX[5][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[4][3]8503-PMOC20',
       'SN-' || (9980 + i)::text, (9980 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[5][3]8503-PMOC20',
       'SN-' || (9985 + i)::text, (9985 + i)::text from generate_series(1, 3) i;

do $t$
declare v_id uuid; v_soma int; v_n int; v_est int; v_qtd int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[4][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 4 não entrou'; end if;
  -- O servidor entregou as 3 ao Compels (é o que a Task 3 vai fazer de verdade).
  update sf_estoque_envios set ok = true, enviado_em = now(), tentativas = 1
   where alvo = 'CX[4][3]8503-PMOC20' and operacao = 'entrada';

  -- (1) o gestor cancela UMA peça: estorno de 1, e sobram 2 no estoque do ERP.
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[4][3]8503-PMOC20'
   order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'uma peça só');

  -- (2) o gestor cancela a CAIXA INTEIRA (é o que a mensagem de recusa manda fazer).
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[4][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'cancela o resto') <> 2 then
    raise exception 'FALHOU (massa): esperava cancelar as 2 peças que sobraram'; end if;

  select coalesce(sum(quantidade), 0), count(*) into v_soma, v_n from sf_estoque_envios
   where alvo = 'CX[4][3]8503-PMOC20' and operacao = 'estorno';
  if v_soma <> 3 then
    raise exception 'FALHOU: a entrada mandou 3 peças ao ERP e os estornos somam % (em % linha(s)) — sobra/falta de % peça(s) no estoque do Compels',
      v_soma, v_n, v_soma - 3; end if;

  -- E o SALDO da entrada tem que contar isso: é ele que a próxima reversão vai olhar.
  select estornado, quantidade into v_est, v_qtd from sf_estoque_envios
   where alvo = 'CX[4][3]8503-PMOC20' and operacao = 'entrada';
  if v_est <> 3 or v_qtd <> 3 then
    raise exception 'FALHOU: a entrada tinha que ficar com quantidade 3 e estornado 3, veio %/%', v_qtd, v_est; end if;

  -- SALDO ESGOTADO: insistir não cria estorno nenhum e o retorno é 'nada' — não há mais nada lá para
  -- descontar, e uma saída a mais viraria estoque negativo no Compels.
  if sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[4][3]8503-PMOC20', null) <> 'nada' then
    raise exception 'FALHOU: reverter o bipe inteiro de uma entrada já revertida tinha que devolver nada'; end if;
  if sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[4][3]8503-PMOC20', 1) <> 'nada' then
    raise exception 'FALHOU: reverter uma peça de uma entrada já revertida tinha que devolver nada'; end if;
  select coalesce(sum(quantidade), 0), count(*) into v_soma, v_n from sf_estoque_envios
   where alvo = 'CX[4][3]8503-PMOC20' and operacao = 'estorno';
  if v_soma <> 3 or v_n <> 2 then
    raise exception 'FALHOU: saldo esgotado ainda inseriu linha de estorno (soma = %, linhas = %)', v_soma, v_n; end if;
  raise notice '41. estornos de uma entrada somam o que foi enviado, nem uma peça mais (saldo esgotado devolve nada): ok';
end $t$;

-- ---------- 42. LINHA JÁ RESERVADA NÃO SE AJUSTA: ESTORNA ----------
-- O ajuste (3 → 2) só é seguro enquanto NINGUÉM olhou para a linha. A sf_estoque_reservar devolve a
-- quantidade no momento da reserva e o servidor monta a carga com aquele número: se o cancelamento
-- cair na janela da reserva, o ajuste troca 3 por 2 numa linha cujo envio JÁ SAIU com 3. Depois o
-- servidor marca a linha como entregue e ela fica parecendo certa — o ERP com 3, o ShopFloor com 2,
-- e nenhuma linha cancelada, nenhum estorno, nenhuma chave por onde reconciliar. É o único caminho
-- que não deixa vestígio, e por isso é o pior.
do $t$
declare e public.sf_estoque_envios; v_id uuid; v_est public.sf_estoque_envios;
begin
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[5][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 5 não entrou'; end if;

  -- O servidor reserva o lote e sai para falar com o Compels: a carga desta linha leva 3 peças.
  perform sf_estoque_reservar(50);
  select * into e from sf_estoque_envios
   where alvo = 'CX[5][3]8503-PMOC20' and operacao = 'entrada';
  if e.reservado_em is null or e.tentativas <> 1 or e.ok then
    raise exception 'FALHOU (massa): a linha tinha que estar reservada e ainda não entregue: %', to_jsonb(e); end if;

  -- O cancelamento cai DENTRO da janela da reserva.
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[5][3]8503-PMOC20'
   order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'uma peça, com o envio em voo');

  select * into e from sf_estoque_envios
   where alvo = 'CX[5][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 3 then
    raise exception 'FALHOU: ajustou para % peças uma linha cujo envio já saiu com 3 — o ERP fica com 3, o ShopFloor com 2, e sem vestígio nenhum: %',
      e.quantidade, to_jsonb(e); end if;
  select * into v_est from sf_estoque_envios
   where alvo = 'CX[5][3]8503-PMOC20' and operacao = 'estorno';
  if not found then
    raise exception 'FALHOU: linha já reservada tinha que ser ESTORNADA (a peça pode ter ido no envio em voo), não ajustada em silêncio'; end if;
  if v_est.quantidade <> 1 then
    raise exception 'FALHOU: o estorno tinha que valer a 1 peça cancelada, veio %', v_est.quantidade; end if;
  -- E o saldo da entrada desce: as outras 2 peças ainda podem ser revertidas, uma terceira não.
  if e.estornado <> 1 then
    raise exception 'FALHOU: a entrada tinha que ficar com estornado = 1, veio %', e.estornado; end if;
  raise notice '42. cancelamento na janela da reserva → estorno com rastro, sem ajuste cego: ok';
end $t$;

-- ---------- 43. TENTATIVA JÁ GASTA TAMBÉM ESTORNA; LINHA INTOCADA AINDA AJUSTA ----------
-- Os dois lados da mesma decisão, olhados pelo RETORNO da sf_estoque_reverter:
--   (a) reserva VENCIDA mas `tentativas > 0` — a linha voltou pra fila, só que uma rodada já falou com
--       o Compels e a resposta pode ter sido perdida no caminho: a quantidade daquela carga já saiu,
--       então ajustar a linha seria mentir sobre o que foi mandado. Estorna, e a entrada fica intacta.
--       É por isso que a marca é `tentativas`, e não só a reserva viva: a reserva expira, o envio não.
--   (b) linha que NINGUÉM leu (sem reserva, tentativas = 0) — aí o ajuste continua sendo o certo: a
--       linha ainda descreve o que VAI ser enviado, e corrigir 3 para 2 poupa ao ERP duas
--       movimentações para um número que ainda podia ser arrumado aqui.
--   (c) RESERVA VIVA com tentativas = 0 — a outra perna da marca, sozinha (achado da re-revisão: sem
--       este caso nada travava a perna da reserva; trocando a marca inteira por `tentativas > 0` a
--       suíte ficava verde). Ela não é decorativa: a 0132 diz que `reservado_em` pode existir sem
--       tentativa (alguém mexendo na fila à mão), e o Reenviar da tela de pendências pode muito bem
--       reservar antes de contar. Uma linha reservada tem a carga dela EM VOO, com as 3 peças.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 6, 3, 3, 'CX[6][3]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 7, 3, 3, 'CX[7][3]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 8, 3, 3, 'CX[8][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[8][3]8503-PMOC20',
       'SN-' || (9954 + i)::text, (9954 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[6][3]8503-PMOC20',
       'SN-' || (9990 + i)::text, (9990 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[7][3]8503-PMOC20',
       'SN-' || (9995 + i)::text, (9995 + i)::text from generate_series(1, 3) i;

do $t$
declare e public.sf_estoque_envios; v_r text;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);

  -- (a) uma rodada tentou e a reserva já venceu (a linha está de volta na fila, mas tocada).
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[6][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 6 não entrou'; end if;
  update sf_estoque_envios set tentativas = 1, reservado_em = now() - interval '20 minutes',
                               erro = 'Compels não respondeu'
   where alvo = 'CX[6][3]8503-PMOC20' and operacao = 'entrada';

  v_r := sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[6][3]8503-PMOC20', 1);
  if v_r <> 'estorno' then
    raise exception 'FALHOU: linha já tentada tinha que ESTORNAR (a carga de 3 peças pode ter chegado), devolveu %', v_r; end if;
  select * into e from sf_estoque_envios
   where alvo = 'CX[6][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 3 or e.estornado <> 1 or e.cancelado_em is not null then
    raise exception 'FALHOU: a entrada já tentada tinha que ficar intacta (3 peças) com estornado 1: %', to_jsonb(e); end if;
  if (select count(*) from sf_estoque_envios
       where alvo = 'CX[6][3]8503-PMOC20' and operacao = 'estorno' and quantidade = 1) <> 1 then
    raise exception 'FALHOU: esperava um estorno de 1 peça da caixa 6'; end if;

  -- (b) a linha intocada: ajuste, como sempre foi.
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[7][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 7 não entrou'; end if;
  select * into e from sf_estoque_envios
   where alvo = 'CX[7][3]8503-PMOC20' and operacao = 'entrada';
  if e.tentativas <> 0 or e.reservado_em is not null then
    raise exception 'FALHOU (massa): a caixa 7 tinha que estar intocada: %', to_jsonb(e); end if;

  v_r := sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[7][3]8503-PMOC20', 1);
  if v_r <> 'ajustado' then
    raise exception 'FALHOU: linha que ninguém leu tinha que ser AJUSTADA, devolveu %', v_r; end if;
  select * into e from sf_estoque_envios
   where alvo = 'CX[7][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 2 or e.estornado <> 0 then
    raise exception 'FALHOU: o ajuste tinha que deixar 2 peças e estornado 0: %', to_jsonb(e); end if;
  if exists (select 1 from sf_estoque_envios
              where alvo = 'CX[7][3]8503-PMOC20' and operacao = 'estorno') then
    raise exception 'FALHOU: ajustou E estornou a mesma peça'; end if;

  -- (c) RESERVA VIVA, tentativas = 0: a perna da reserva sozinha. Sem ela a marca poderia ser só
  -- `tentativas > 0` e nada acusaria — e a linha reservada é exatamente aquela cuja carga de 3 peças
  -- está EM VOO, o caso que o ajuste não pode alcançar.
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[8][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 8 não entrou'; end if;
  update sf_estoque_envios set tentativas = 0, reservado_em = now()
   where alvo = 'CX[8][3]8503-PMOC20' and operacao = 'entrada';

  v_r := sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[8][3]8503-PMOC20', 1);
  if v_r <> 'estorno' then
    raise exception 'FALHOU: reserva VIVA (mesmo com tentativas = 0) tinha que ESTORNAR — a carga de 3 peças já saiu com a reserva; devolveu %', v_r; end if;
  select * into e from sf_estoque_envios
   where alvo = 'CX[8][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 3 or e.estornado <> 1 or e.cancelado_em is not null then
    raise exception 'FALHOU: a entrada reservada tinha que ficar intacta (3 peças) com estornado 1: %', to_jsonb(e); end if;
  raise notice '43. tentativa gasta estorna (entrada intacta); linha intocada ainda ajusta; reserva viva sem tentativa também estorna: ok';
end $t$;

-- ---------- 44. CANCELAR O BIPE INTEIRO DE UMA LINHA TOCADA NÃO DEIXA ESTORNO ÓRFÃO ----------
-- O achado que este teste trava, e que foi CRIADO pela correção do 42/43: a exceção "linha em voo
-- estorna em vez de ajustar" valia só quando vinha uma quantidade (0133, a peça). O caminho da caixa
-- (0131, p_quantidade nulo) continuava CANCELANDO a entrada — e cancelar uma entrada que já tem
-- estorno deixa o estorno na fila SEM PAR.
--
-- E a sequência não é exótica: é a que a própria mensagem de recusa da 0129 manda o gestor seguir
-- ("cancele a caixa inteira em Registros e bipe outra vez"):
--   1. caixa de 3 peças → entrada E1 de 3;
--   2. o servidor reserva o lote e sai pro Compels (a carga levou 3);
--   3. o gestor cancela 1 peça → estorno S1 de 1 (certo: a peça pode ter ido no envio em voo);
--   4. o gestor cancela a CAIXA INTEIRA → aqui estava o buraco: E1 ganhava `cancelado_em`;
--   5. o gestor rebipa → E2 de 3.
-- Estado que sobrava: E1 cancelada com estornado 1 · S1 pendente · E2 pendente. Ou o laço de envio
-- respeita a restrição de ordem escrita na 0132 (estorno não sai antes de a SUA entrada virar `ok`) e
-- o S1 fica preso para sempre, porque E1 está cancelada e nunca vira ok; ou o laço é menos rigoroso,
-- entrega o S1 depois do E2, e o Compels fica com 1 peça A MENOS que o ShopFloor, em silêncio.
--
-- As asserções são sobre as duas INVARIANTES, não sobre o mecanismo:
--   • a soma dos estornos daquela entrada fecha com o que foi mandado ao ERP (3);
--   • nenhum estorno fica sem par — o que, em dado, é "nenhuma entrada CANCELADA tem estornado > 0" e
--     "todo estorno tem uma entrada viva do mesmo bipe, criada antes dele". Essas duas valem para a
--     tabela TODA, não só para esta massa: é a forma mais barata de a suíte inteira vigiar isso.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 9, 3, 3, 'CX[9][3]8503-PMOC20', true),
  ('PMOC20', '8503', 'Embalagem', 10, 3, 3, 'CX[10][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[9][3]8503-PMOC20',
       'SN-' || (9956 + i)::text, (9956 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[10][3]8503-PMOC20',
       'SN-' || (9962 + i)::text, (9962 + i)::text from generate_series(1, 3) i;

-- (i) VARIANTE RESERVA VIVA — passos 1 a 4, com as RPCs reais (a reserva é a de verdade).
do $t$
declare e public.sf_estoque_envios; v_id uuid; v_soma int; v_n int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);

  -- 1. a caixa entra: E1 de 3 peças.
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[9][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 9 não entrou'; end if;

  -- 2. o servidor reserva e sai pro Compels — a carga desta linha levou 3 peças.
  perform sf_estoque_reservar(50);
  select * into e from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and operacao = 'entrada';
  if e.tentativas <> 1 or e.reservado_em is null or e.ok then
    raise exception 'FALHOU (massa): a linha tinha que estar reservada e ainda não entregue: %', to_jsonb(e); end if;

  -- 3. cancela UMA peça: estorno de 1 (é o fix do teste 42 funcionando).
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[9][3]8503-PMOC20'
   order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'uma peça, com o envio em voo');
  select * into e from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and operacao = 'entrada';
  if e.estornado <> 1 or e.cancelado_em is not null then
    raise exception 'FALHOU (massa): esperava a entrada viva com estornado 1: %', to_jsonb(e); end if;

  -- 4. cancela a CAIXA INTEIRA — o passo que a recusa da 0129 manda dar.
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[9][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'cancela o resto e rebipa') <> 2 then
    raise exception 'FALHOU (massa): esperava cancelar as 2 peças que sobraram'; end if;

  select * into e from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and operacao = 'entrada';
  -- A entrada TOCADA não se cancela: ela continua na fila e VAI chegar ao ERP, e é isso que faz os
  -- estornos dela terem par (e a restrição de ordem do laço de envio terminar algum dia).
  if e.cancelado_em is not null then
    raise exception 'FALHOU: cancelou uma entrada que já tinha estorno — o S1 fica na fila sem par (preso para sempre, ou entregue sozinho e o Compels fica com 1 peça a menos): %', to_jsonb(e); end if;
  if e.quantidade <> 3 or e.estornado <> 3 then
    raise exception 'FALHOU: a entrada tinha que ficar intacta (3) e inteiramente revertida (estornado 3), veio %/%', e.quantidade, e.estornado; end if;

  -- A INVARIANTE: o ERP recebeu (ou pode ter recebido) 3, e os estornos somam 3. Nem mais, nem menos.
  select coalesce(sum(quantidade), 0), count(*) into v_soma, v_n from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and operacao = 'estorno';
  if v_soma <> 3 then
    raise exception 'FALHOU: a carga mandou 3 peças e os estornos somam % (em % linha(s)) — sobra/falta de % peça(s) no Compels',
      v_soma, v_n, v_soma - 3; end if;
  raise notice '44(i). bipe inteiro de linha em voo → estorna o saldo, entrada viva, estornos fecham em 3: ok';
end $t$;

-- 5. O REBIPE, em transação própria (é o que acontece de verdade, e é o que dá ao E2 um criado_em
-- posterior ao do E1 — a entrada VIGENTE de um bipe é a mais recente não cancelada).
do $t$
declare e public.sf_estoque_envios; v_n int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Bruno',
                              'CX[9][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU: o rebipe depois do cancelamento tinha que ser aceito'; end if;

  -- Duas entradas VIVAS do mesmo bipe convivem: a E1 (revertida por inteiro, esperando chegar ao ERP)
  -- e a E2 (as 3 peças de agora). É por isso que o saldo é POR ENTRADA e não uma soma por bipe.
  select * into e from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and operacao = 'entrada'
   order by criado_em desc, id desc limit 1;
  if e.chave <> 'ALMOX/PMOC20/8503/Almoxarifado/CX[9][3]8503-PMOC20/E2' then
    raise exception 'FALHOU: o rebipe tinha que gerar E2, veio %', e.chave; end if;
  if e.quantidade <> 3 or e.estornado <> 0 or e.ok or e.cancelado_em is not null then
    raise exception 'FALHOU: a E2 tinha que nascer pendente, com 3 peças e nada revertido: %', to_jsonb(e); end if;

  -- E o ciclo fecha: 3 peças no ShopFloor contra 3 na fila não cancelada (E1 3 − 3 estornados + E2 3).
  select coalesce(sum(case when operacao = 'entrada' then quantidade - estornado else 0 end), 0)
    into v_n from sf_estoque_envios
   where alvo = 'CX[9][3]8503-PMOC20' and cancelado_em is null;
  if v_n <> 3 then
    raise exception 'FALHOU: o ShopFloor tem 3 peças e a fila não cancelada diz % — é a divergência que vai pro inventário do Compels', v_n; end if;
  raise notice '44(i). rebipe → E2 de 3, ciclo fecha em 3 peças dos dois lados: ok';
end $t$;

-- (ii) VARIANTE DESISTIU (tentativas = 5) — a mesma sequência na linha que já caiu da fila. Aqui o
-- cancelamento seria ainda pior: a entrada nunca foi entregue e não vai ser reenviada sozinha, então
-- os estornos seriam as ÚNICAS linhas entregáveis do bipe — saída de peça que o ERP nunca recebeu.
-- Não cancelando, entrada e estornos aparecem JUNTOS na tela de pendências, que é onde alguém decide.
do $t$
declare e public.sf_estoque_envios; v_id uuid; v_soma int; v_n int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[10][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 10 não entrou'; end if;
  -- Cinco rodadas tentaram e a última reserva já venceu: a linha está fora da fila (DESISTIU).
  update sf_estoque_envios
     set tentativas = 5, reservado_em = now() - interval '20 minutes', erro = 'Compels não respondeu'
   where alvo = 'CX[10][3]8503-PMOC20' and operacao = 'entrada';

  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[10][3]8503-PMOC20'
   order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'uma peça');
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[10][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'cancela o resto') <> 2 then
    raise exception 'FALHOU (massa): esperava cancelar as 2 peças que sobraram'; end if;

  select * into e from sf_estoque_envios
   where alvo = 'CX[10][3]8503-PMOC20' and operacao = 'entrada';
  if e.cancelado_em is not null then
    raise exception 'FALHOU: cancelou a entrada que DESISTIU e já tinha estorno — o estorno virou a única linha entregável do bipe: %', to_jsonb(e); end if;
  if e.quantidade <> 3 or e.estornado <> 3 then
    raise exception 'FALHOU: a entrada tinha que ficar com 3/3 (intacta e inteiramente revertida), veio %/%', e.quantidade, e.estornado; end if;
  select coalesce(sum(quantidade), 0), count(*) into v_soma, v_n from sf_estoque_envios
   where alvo = 'CX[10][3]8503-PMOC20' and operacao = 'estorno';
  if v_soma <> 3 then
    raise exception 'FALHOU: entrada de 3 peças e estornos somando % (em % linha(s))', v_soma, v_n; end if;
  raise notice '44(ii). bipe inteiro de linha que DESISTIU → estorna o saldo, nada cancelado, estornos fecham em 3: ok';
end $t$;

-- (iii) A REDE DA LINHA MEIO REVERTIDA: `estornado > 0` é marca de linha tocada por si só.
-- Hoje ninguém chega no ajuste com estornado > 0 — mas essa garantia era um PARÁGRAFO, e a 0132
-- promete uma tela de pendências "onde alguém aperta Reenviar". Este teste simula exatamente esse
-- Reenviar sobre uma linha meio revertida: zera tentativas e reservado_em de uma entrada com
-- estornado 2 de 3. Sem `estornado > 0` na marca, a peça seguinte cairia no AJUSTE e a linha passaria
-- a dizer 2 com 2 já estornados — a fila mentindo sobre o que mandou —, e a peça depois dela
-- estouraria o CHECK na cara do gestor.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 11, 3, 3, 'CX[11][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[11][3]8503-PMOC20',
       'SN-' || (9965 + i)::text, (9965 + i)::text from generate_series(1, 3) i;

do $t$
declare e public.sf_estoque_envios; v_id uuid; v_r text;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[11][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 11 não entrou'; end if;
  -- uma rodada já tentou: as duas peças canceladas agora viram estorno (é o caso 43(a))
  update sf_estoque_envios set tentativas = 1
   where alvo = 'CX[11][3]8503-PMOC20' and operacao = 'entrada';
  for v_id in select id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[11][3]8503-PMOC20'
   order by numero_serie_norm limit 2
  loop
    perform sf_cancelar_lancamento(v_id, 'duas peças, com a carga já em voo');
  end loop;
  select * into e from sf_estoque_envios
   where alvo = 'CX[11][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 3 or e.estornado <> 2 then
    raise exception 'FALHOU (massa): esperava a entrada 3 com estornado 2, veio %/%', e.quantidade, e.estornado; end if;

  -- O REENVIAR da tela de pendências, como ele pode muito bem ser escrito: devolve a linha pra fila
  -- limpando as marcas de rodada. A linha continua meio revertida.
  update sf_estoque_envios set tentativas = 0, reservado_em = null, erro = null
   where alvo = 'CX[11][3]8503-PMOC20' and operacao = 'entrada';

  v_r := sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[11][3]8503-PMOC20', 1);
  if v_r <> 'estorno' then
    raise exception 'FALHOU: linha com estornado 2 de 3 tinha que ESTORNAR mesmo com as marcas de rodada zeradas — ajustar reescreveria uma quantidade que já foi mandada; devolveu %', v_r; end if;
  select * into e from sf_estoque_envios
   where alvo = 'CX[11][3]8503-PMOC20' and operacao = 'entrada';
  if e.quantidade <> 3 or e.estornado <> 3 then
    raise exception 'FALHOU: a entrada tinha que ficar 3/3 (intacta, inteiramente revertida), veio %/%', e.quantidade, e.estornado; end if;
  raise notice '44(iii). Reenviar não reabre o ajuste numa linha meio revertida (estornado é marca de tocada): ok';
end $t$;

-- (iv) AS DUAS INVARIANTES, na TABELA TODA — e não só nesta massa: um teste que um dia deixe estorno
-- órfão estoura aqui, mesmo que ele não pense na fila.
--
-- Em forma de FUNÇÃO de propósito (e não de um do-block solto): este arquivo não é o fim da suíte. O
-- rodar-almoxarifado-test.sh continua DEPOIS dele com as etapas em bash (idempotência, as corridas, a
-- atomicidade vista de fora) — e essas etapas também dão entrada, cancelam caixa e enfileiram. Um
-- do-block aqui olharia só o que rodou ATÉ AQUI, e um teste escrito depois deste ponto passaria por
-- baixo dele. Com a função, a MESMA verificação é chamada em todo lugar onde ela vale: aqui, depois do
-- teste 45 (que mexe na fila e vem depois daqui) e na ÚLTIMA linha do runner, quando já rodou tudo,
-- inclusive o bash. Uma definição só, sem cópias pra divergirem — e a falha aparece perto de quem a
-- causou. Quem acrescentar um teste que mexa na fila: chame a função depois dele também. Ela mora neste
-- arquivo, junto das invariantes que descreve, no mesmo molde da teste_explode() que o runner usa.
create function public.teste_fila_invariantes(p_onde text) returns void language plpgsql as $f$
declare v_a int; v_b int; v_orf text;
begin
  -- Nenhuma entrada CANCELADA com estorno: cancelar é dizer "isto nunca saiu", e um estorno é dizer
  -- "isto saiu" — as duas coisas na mesma entrada é a contradição que gera o órfão.
  select string_agg(chave, ', ') into v_orf from sf_estoque_envios
   where operacao = 'entrada' and cancelado_em is not null and estornado > 0;
  if v_orf is not null then
    raise exception 'FALHOU: entrada(s) cancelada(s) com estorno já criado — os estornos ficaram sem par: %', v_orf; end if;

  -- E o par visto do outro lado: todo estorno APONTA (entrada_id) pra uma entrada VIVA do mesmo bipe.
  --
  -- ⚠️ Esta invariante já foi escrita por `criado_em <=` — "existe alguma entrada viva do mesmo bipe
  -- criada até o estorno" —, e era uma TERCEIRA definição de par, diferente da que a
  -- sf_estoque_reverter usava e da que a sf_estoque_reservar inferia. Justamente por ser a mais frouxa
  -- (o `<=` abençoava a entrada nascida na MESMA transação do estorno), ela dava tudo certo enquanto a
  -- reserva prendia o par pra sempre. Uma invariante que não é a mesma verdade que o código lê não
  -- prova nada: agora ela cobra O VÍNCULO, que é exatamente o que o predicado da reserva lê.
  select string_agg(s.chave, ', ') into v_orf from sf_estoque_envios s
   where s.operacao = 'estorno'
     and not exists (
       select 1 from sf_estoque_envios e
        where e.id = s.entrada_id
          and e.operacao = 'entrada' and e.cancelado_em is null
          and e.pmo = s.pmo and e.op = s.op and e.posto = s.posto and e.alvo = s.alvo);
  if v_orf is not null then
    raise exception 'FALHOU: estorno(s) cujo entrada_id não é uma entrada viva do mesmo bipe: %', v_orf; end if;

  -- E a contabilidade: cada estorno desceu o saldo da entrada dele, então as duas somas batem.
  select coalesce(sum(quantidade), 0) into v_a from sf_estoque_envios where operacao = 'estorno';
  select coalesce(sum(estornado), 0) into v_b from sf_estoque_envios where operacao = 'entrada';
  if v_a <> v_b then
    raise exception 'FALHOU: estornos somam % e os saldos descontados somam % — um dos dois lados ficou sem o outro', v_a, v_b; end if;
  raise notice '44(iv). tabela toda (%): nenhum estorno órfão, estornos e saldos descontados batem (%): ok',
    p_onde, v_a;

  -- A IDENTIDADE POR PAR, e não só a soma global acima: o `estornado` de CADA entrada bate com a soma
  -- dos estornos que APONTAM pra ela (entrada_id) — não com "algum estorno do mesmo bipe" nem com o
  -- total da tabela. As três invariantes de cima (nenhuma cancelada com estorno, todo estorno aponta pra
  -- uma entrada viva do mesmo bipe, soma global de estornos = soma global de saldos) PASSAM as três
  -- mesmo se um estorno apontar pra OUTRA entrada viva do MESMO bipe — a soma global não enxerga qual
  -- entrada recebeu qual estorno, só que a conta fecha. Achado da revisão: com E1 e E2 vivas do mesmo
  -- bipe CXB, saldo debitado da E2 mas vínculo (entrada_id) gravado na E1, esta é a única das quatro que
  -- pega — as outras três continuam passando.
  select string_agg(
           e.chave || ' estornado=' || e.estornado || ' apontado=' || coalesce(s.soma, 0), ', '
           order by e.chave)
    into v_orf
    from sf_estoque_envios e
    left join (
      select entrada_id, sum(quantidade) as soma
        from sf_estoque_envios where operacao = 'estorno'
       group by entrada_id
    ) s on s.entrada_id = e.id
   where e.operacao = 'entrada' and e.estornado <> coalesce(s.soma, 0);
  if v_orf is not null then
    raise exception 'FALHOU: entrada(s) cujo estornado não bate com a soma dos estornos que a apontam (entrada_id): %', v_orf; end if;
  raise notice '44(v). tabela toda (%): o estornado de cada entrada bate com a soma dos estornos que a apontam: ok',
    p_onde;
end $f$;

do $t$ begin perform public.teste_fila_invariantes('fim do arquivo de testes'); end $t$;

-- ---------- 45. QUAL É A ENTRADA VIGENTE NÃO PODE DEPENDER DO UUID ----------
-- O achado que este teste trava: desde que a linha TOCADA passou a ser ESTORNADA em vez de cancelada
-- (teste 44), duas entradas VIVAS do mesmo bipe são o normal — a E1 de saldo zero, que continua na
-- fila esperando chegar ao ERP, e a E2 do rebipe. Aí a ordem que escolhe "a entrada vigente" passou a
-- DECIDIR algo, e ela desempatava por `criado_em` — que é `now()`, o instante da TRANSAÇÃO. Cancelar a
-- caixa e rebipar na MESMA transação dá às duas o mesmo `criado_em`, e a decisão caía no uuid: quando
-- ele sorteava a E1 (saldo zero), a reversão da peça seguinte devolvia 'nada' CALADAMENTE — a peça
-- saía do ShopFloor e ficava no estoque do Compels, sem estorno, sem rastro, sem ninguém saber.
--
-- Em produção isso não é alcançável hoje (as duas chamadoras entram por RPCs separadas, uma transação
-- cada), e é por isso que o teste faz o empate à mão: um do-block é UMA transação, então a entrada, o
-- cancelamento e o rebipe daqui nascem todos com o mesmo `criado_em`. Os uuids também são fixados, e de
-- propósito ao contrário: com a ordem ANTIGA (`criado_em desc, id desc`) a E1 GANHA o desempate e este
-- teste falha — sempre, e não por sorte. Com o desempate pelo `E<n>` da chave, a E2 é a vigente.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 12, 3, 3, 'CX[12][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[12][3]8503-PMOC20',
       'SN-' || (9940 + i)::text, (9940 + i)::text from generate_series(1, 3) i;

do $t$
declare e1 public.sf_estoque_envios; e2 public.sf_estoque_envios; v_id uuid; v_r text;
  c_chave text := 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/';
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);

  -- E1: entrada de 3 peças com uma rodada já TOCADA (a carga de 3 saiu), cancelada por inteiro em
  -- Registros — o que a estorna e a deixa VIVA na fila com saldo zero (é o resultado do teste 44).
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[12][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 12 não entrou'; end if;
  update sf_estoque_envios set tentativas = 1
   where alvo = 'CX[12][3]8503-PMOC20' and operacao = 'entrada';
  -- O uuid da E1 é fixado AQUI, antes de existir estorno: ele tem que ser o MAIOR dos dois (ver o
  -- parágrafo dos uuids, abaixo), e depois do cancelamento não dá mais pra reescrever — o estorno vai
  -- apontar pra esta linha (`entrada_id`) e a chave estrangeira recusa trocar o id de uma linha
  -- apontada. Que é a garantia que se quer: o vínculo não fica pendurado no nada.
  update sf_estoque_envios set id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
   where chave = c_chave || 'E1';
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[12][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'em voo: estorna e rebipa') <> 3 then
    raise exception 'FALHOU (massa): esperava cancelar as 3 peças da caixa 12'; end if;

  -- E2: o rebipe, aqui na MESMA transação de propósito (é o empate que se quer provar).
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[12][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): o rebipe da caixa 12 tinha que ser aceito'; end if;

  select * into e1 from sf_estoque_envios where chave = c_chave || 'E1';
  select * into e2 from sf_estoque_envios where chave = c_chave || 'E2';
  if e1.quantidade <> 3 or e1.estornado <> 3 or e1.cancelado_em is not null then
    raise exception 'FALHOU (massa): a E1 tinha que ficar viva, 3/3 (saldo zero): %', to_jsonb(e1); end if;
  if e2.quantidade <> 3 or e2.estornado <> 0 or e2.tentativas <> 0 or e2.reservado_em is not null then
    raise exception 'FALHOU (massa): a E2 tinha que nascer limpa, 3/0: %', to_jsonb(e2); end if;

  -- O EMPATE. Aqui ele já existe (mesma transação, mesmo now()), e o update é a rede embaixo disso:
  -- se um dia o default de criado_em virar clock_timestamp(), o empate sumiria e este teste perderia o
  -- dente em silêncio. `criado_em` da E1 — e não da E2 — porque o estorno S1 nasceu entre as duas, e
  -- as invariantes do 44(iv) exigem uma entrada viva criada ATÉ o estorno.
  update sf_estoque_envios set criado_em = e1.criado_em where id = e2.id;
  -- E os uuids ao contrário do que o certo deveria escolher: a E1 (a errada) com o id MAIOR — já
  -- fixado lá em cima, antes de o estorno nascer — e a E2 com o MENOR. Assim `order by criado_em desc,
  -- id desc` — a ordem de antes — escolhe a E1 sempre.
  update sf_estoque_envios set id = '00000000-0000-4000-8000-000000000000' where id = e2.id;

  -- E O PAR DO ESTORNO ESTÁ GRAVADO NA E1: quem foi DEBITADO (o saldo dela foi a 3/3) é quem o estorno
  -- APONTA. É este vínculo que a sf_estoque_reservar lê pra decidir se solta a saída — enquanto ela
  -- inferia o par por conta própria, o `criado_em` empatado desta transação a fazia escolher NENHUMA
  -- entrada e prender o estorno pra sempre (ver o teste 47, que é a continuação deste estado).
  if (select entrada_id from sf_estoque_envios where chave = c_chave || 'S1')
     is distinct from 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid then
    raise exception 'FALHOU: o estorno tinha que apontar pra E1, que é de quem o saldo foi debitado; aponta pra %',
      (select entrada_id from sf_estoque_envios where chave = c_chave || 'S1'); end if;

  -- Uma peça da caixa REBIPADA é cancelada. A entrada vigente é a E2, que está limpa: a resposta certa
  -- é o AJUSTE de 3 pra 2. Se a ordem pegar a E1, o saldo dela é zero e a reversão devolve 'nada'.
  v_r := sf_estoque_reverter('PMOC20', '8503', 'Almoxarifado', 'CX[12][3]8503-PMOC20', 1);
  if v_r <> 'ajustado' then
    raise exception 'FALHOU: com criado_em empatado, a entrada vigente tinha que ser a E2 (a do rebipe, limpa) e a peça tinha que ser AJUSTADA; devolveu % — a ordem caiu no uuid e pegou a E1 de saldo zero: a peça sai do ShopFloor e fica no Compels, calada', v_r; end if;

  select * into e2 from sf_estoque_envios where chave = c_chave || 'E2';
  if e2.quantidade <> 2 or e2.estornado <> 0 or e2.cancelado_em is not null then
    raise exception 'FALHOU: o ajuste tinha que deixar a E2 com 2 peças e nada estornado: %', to_jsonb(e2); end if;
  select * into e1 from sf_estoque_envios where chave = c_chave || 'E1';
  if e1.quantidade <> 3 or e1.estornado <> 3 or e1.cancelado_em is not null then
    raise exception 'FALHOU: a E1 tinha que ficar intacta (3/3, viva): %', to_jsonb(e1); end if;
  -- E nenhum estorno novo: o ajuste e o estorno são caminhos EXCLUDENTES na mesma peça.
  if (select count(*) from sf_estoque_envios
       where alvo = 'CX[12][3]8503-PMOC20' and operacao = 'estorno') <> 1 then
    raise exception 'FALHOU: esperava só o estorno S1 (o da caixa inteira) no bipe da caixa 12'; end if;
  raise notice '45. entrada vigente pelo contador da chave (empate de criado_em não cai no uuid): ok';
end $t$;

-- As invariantes de novo, agora com a massa do 45 dentro (a chamada do fim do runner cobre as etapas
-- em bash que ainda vêm depois deste arquivo).
do $t$ begin perform public.teste_fila_invariantes('depois do teste 45'); end $t$;

-- ---------- 46. UM CICLO ANTIGO DO BIPE NÃO PRENDE O ESTORNO DO CICLO DE AGORA ----------
-- O Critical da revisão da Task 3, rodado pelas RPCs de verdade (a versão em estado montado à mão está
-- no teste 19 de supabase/tests/estoque_envios_test.sql, junto do predicado que ele cobre).
--
-- O filtro da ordem do par, na sf_estoque_reservar, dizia "QUALQUER entrada anterior do mesmo bipe que
-- não esteja `ok` segura o estorno". Só que uma entrada CANCELADA nunca vira `ok` (o check da tabela
-- proíbe), e o mesmo bipe tem várias entradas no histórico — então uma E1 cancelada num ciclo JÁ
-- ENCERRADO prendia PARA SEMPRE todo estorno futuro daquele bipe: tentativas = 0, `erro` nulo, e a
-- linha que o bloqueava INVISÍVEL na tela de pendências, que não lista canceladas. O Compels ficaria
-- com peças que o ShopFloor já removeu, sem erro, sem falha e sem linha nenhuma pra alguém ver.
--
-- Nada aqui é exótico: cada passo é um caminho que o sistema manda seguir.
--   1. bipe da caixa → E1 limpa na fila;
--   2. o gestor cancela a caixa antes da primeira rodada do cron → a E1 é CANCELADA, e é o caminho
--      CERTO na linha limpa (não se manda ao ERP uma entrada e uma saída que nunca precisaram existir);
--   3. o operador rebipa a mesma caixa — o que a recusa da 0129 manda fazer → E2;
--   4. o cron entrega a E2 ao Compels → ok;
--   5. o gestor cancela a caixa outra vez → agora é ESTORNO (S1), par da E2, e o saldo dela desce;
--   6. a reserva TEM que devolver a S1: a entrada dela — a VIGENTE entre as vivas, que é a E2 — está
--      `ok`. Com o predicado antigo, a E1 cancelada a segurava, nesta rodada e em todas as seguintes.
-- Cada passo em transação PRÓPIA de propósito: é assim que acontece de verdade (uma RPC por chamada),
-- e é o que dá à E2 um `criado_em` posterior ao da E1 e anterior ao do estorno.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC20', '8503', 'Embalagem', 13, 3, 3, 'CX[13][3]8503-PMOC20', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC20', '8503', 'Cliente Estorno', 'CX[13][3]8503-PMOC20',
       'SN-' || (9930 + i)::text, (9930 + i)::text from generate_series(1, 3) i;

-- 1 e 2. o primeiro ciclo, encerrado: a entrada limpa é CANCELADA (nada de estorno).
do $t$
declare e public.sf_estoque_envios; v_id uuid;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Ana',
                              'CX[13][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): a caixa 13 não entrou'; end if;
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[13][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'bipou a caixa errada, antes do cron') <> 3 then
    raise exception 'FALHOU (massa): esperava cancelar as 3 peças da caixa 13'; end if;

  select * into e from sf_estoque_envios
   where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/E1';
  if e.cancelado_em is null or e.estornado <> 0 then
    raise exception 'FALHOU (massa): a linha estava LIMPA, tinha que ser cancelada sem estorno: %', to_jsonb(e); end if;
  raise notice '46. passo 1-2: E1 limpa cancelada (o ciclo antigo, encerrado): ok';
end $t$;

-- 3. o rebipe, em transação própria (é o que dá à E2 um criado_em posterior ao da E1).
do $t$
declare e public.sf_estoque_envios;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  if (sf_almoxarifado_entrada('PMOC20', '8503', 'Almoxarifado', 'Bruno',
                              'CX[13][3]8503-PMOC20', 'caixa', 3, '')->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (massa): o rebipe da caixa 13 tinha que ser aceito'; end if;
  select * into e from sf_estoque_envios
   where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/E2';
  if not found or e.cancelado_em is not null or e.ok then
    raise exception 'FALHOU (massa): o rebipe tinha que enfileirar a E2, pendente: %', to_jsonb(e); end if;
  raise notice '46. passo 3: rebipe → E2 pendente: ok';
end $t$;

-- 4. o cron entrega a E2 (é o que a Task 3 faz de verdade; aqui só o efeito dela na linha).
update public.sf_estoque_envios set ok = true, enviado_em = now(), tentativas = 1, reservado_em = null
 where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/E2';

-- 5. o gestor cancela a caixa OUTRA VEZ: agora a entrada vigente já está no ERP, então é ESTORNO.
do $t$
declare e public.sf_estoque_envios; v_id uuid;
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[13][3]8503-PMOC20' limit 1;
  if sf_cancelar_caixa_almoxarifado(v_id, 'caixa voltou do cliente') <> 3 then
    raise exception 'FALHOU (massa): esperava cancelar as 3 peças do rebipe'; end if;

  select * into e from sf_estoque_envios
   where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/S1';
  if not found or e.quantidade <> 3 or e.tentativas <> 0 then
    raise exception 'FALHOU (massa): esperava o estorno S1 de 3 peças, pendente e intocado: %', to_jsonb(e); end if;
  select * into e from sf_estoque_envios
   where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/E2';
  if e.estornado <> 3 then
    raise exception 'FALHOU (massa): o estorno tinha que descer o saldo da E2 (a vigente), veio estornado %', e.estornado; end if;
  raise notice '46. passo 4-5: E2 entregue e cancelada de novo → estorno S1, saldo da E2 zerado: ok';
end $t$;

-- 6. A PROVA. A reserva é a de verdade, e o que importa é ela devolver a S1: a entrada vigente do bipe
-- (a E2) está no ERP, então a saída pode ir. Com o predicado antigo, a E1 CANCELADA a segurava — nesta
-- rodada e em todas as seguintes, sem erro e sem linha na tela de pendências.
do $t$
declare v_chaves text[];
begin
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r
   where r.bipe = 'CX[13][3]8503-PMOC20';
  if v_chaves is distinct from array['ALMOX/PMOC20/8503/Almoxarifado/CX[13][3]8503-PMOC20/S1'] then
    raise exception 'FALHOU: a E1 CANCELADA de um ciclo encerrado prendeu o estorno da E2, que já está no Compels — as peças saem do ShopFloor e ficam no estoque de lá, sem erro, sem falha e sem linha na tela; a reserva devolveu % pra este bipe', v_chaves;
  end if;
  raise notice '46. passo 6: a reserva libera o S1 (a E1 cancelada não é a entrada dele): ok';
end $t$;

-- As invariantes de novo, agora com a massa do 46 dentro.
do $t$ begin perform public.teste_fila_invariantes('depois do teste 46'); end $t$;

-- ---------- 47. O PAR GRAVADO É QUEM FOI DEBITADO — E É ELE QUE SOLTA O ESTORNO ----------
-- O Important desta rodada, pelas RPCs de verdade (a versão em estado montado está no teste 20 de
-- supabase/tests/estoque_envios_test.sql). Este teste CONTINUA o estado que o teste 45 deixou na caixa
-- 12, que é o estado difícil e não é exótico: a E1 tocada, inteiramente estornada e VIVA na fila
-- (continua indo pro ERP — ver A ASSIMETRIA na 0132), a E2 do rebipe, o estorno S1 da E1, e as TRÊS com
-- o MESMO `criado_em`, porque cancelar a caixa de uma linha em voo e rebipar cabe numa transação só e
-- `criado_em` é `now()`, o instante da transação.
--
-- Enquanto a sf_estoque_reservar INFERIA o par ("a mais recente das vivas criadas ANTES dele", com `<`
-- estrito), ela não achava entrada nenhuma para este S1 e o segurava — e continuava segurando DEPOIS de
-- a E1 ser entregue, porque o `criado_em <` excluía a E1 antes de o `ok` dela ser lido. Preso pra
-- sempre, com tentativas = 0 e sem `erro`: a saída nunca chega ao Compels e nada acusa. A
-- sf_estoque_reverter já acertava (debitava a E1); as duas discordavam sobre quem era o par.
--
-- Os quatro passos, cada um em transação própria (é assim que acontece de verdade):
--   (a) ESPELHO: com a E1 ainda não entregue, a reserva NÃO solta o S1 — senão o teste passaria com um
--       predicado que libera tudo, que é o desastre contrário (saída no ERP sem entrada);
--   (b) o cron entrega a E1 → a reserva SOLTA o S1. É a prova;
--   (c) mais uma peça cancelada: a entrada VIGENTE agora é a E2, e é dela que o saldo desce — com o
--       `order by` da sf_estoque_reverter invertido, ela debitaria a E1 (saldo zero) e devolveria 'nada',
--       calada;
--   (d) e o estorno novo aponta pra E2: a reserva o segura até a E2 estar `ok`, e então o solta. É o
--       vínculo fechando o ciclo — quem espera é quem foi debitado.
-- A reserva é GLOBAL (o `where r.bipe` dos testes filtra só a leitura), então as rodadas dos testes
-- anteriores já reservaram estas linhas de passagem. Soltar a reserva sem marcar entrega é exatamente o
-- que o laço de envio faz quando não conseguiu falar com o ERP (`reservado_em = null`, ver o
-- concluirEnvio em src/modules/shopfloor/infra/estoque-envios-repository.ts) — e é o que devolve as
-- linhas da caixa 12 à fila pra este teste. `tentativas` NÃO volta atrás, de propósito: elas continuam
-- TOCADAS, que é o estado deste cenário.
update public.sf_estoque_envios set reservado_em = null
 where alvo = 'CX[12][3]8503-PMOC20' and not ok and cancelado_em is null;

do $t$
declare v_chaves text[]; c_chave text := 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/';
begin
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r
   where r.bipe = 'CX[12][3]8503-PMOC20';
  if v_chaves is distinct from array[c_chave || 'E1', c_chave || 'E2'] then
    raise exception 'FALHOU (a): com a E1 ainda não entregue, a reserva tinha que levar só as duas entradas; veio %', v_chaves; end if;
  raise notice '47(a). espelho: o estorno fica enquanto a entrada gravada nele não está ok: ok';
end $t$;

update public.sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null
 where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/E1';

do $t$
declare v_chaves text[]; c_chave text := 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/';
begin
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r
   where r.bipe = 'CX[12][3]8503-PMOC20';
  if v_chaves is distinct from array[c_chave || 'S1'] then
    raise exception 'FALHOU (b): a E1 (o par GRAVADO no estorno) foi entregue e o estorno continuou preso — o par nasceu na MESMA transação que ele, e a reserva não o encontrava; veio %', v_chaves; end if;
  raise notice '47(b). a entrega da entrada gravada solta o estorno (mesma transação): ok';
end $t$;

do $t$
declare e1 public.sf_estoque_envios; e2 public.sf_estoque_envios; v_id uuid;
  c_chave text := 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/';
begin
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.administrar', false);
  select id into v_id from sf_registros
   where posto = 'Almoxarifado' and numero_caixa = 'CX[12][3]8503-PMOC20'
   order by numero_serie_norm limit 1;
  perform sf_cancelar_lancamento(v_id, 'mais uma peça, com a E2 já tocada');

  select * into e1 from sf_estoque_envios where chave = c_chave || 'E1';
  select * into e2 from sf_estoque_envios where chave = c_chave || 'E2';
  -- a VIGENTE é a E2 (E<n> maior), e é dela que a peça sai: 2 peças, 1 estornada
  if e2.quantidade <> 2 or e2.estornado <> 1 then
    raise exception 'FALHOU (c): o saldo tinha que descer da E2, a VIGENTE (esperava 2/1): %', to_jsonb(e2); end if;
  if e1.estornado <> 3 then
    raise exception 'FALHOU (c): a E1 tinha que ficar intacta (3/3); o order by da vigente pegou a entrada errada: %', to_jsonb(e1); end if;
  -- e o estorno novo aponta pra E2, que é quem foi debitado
  if (select entrada_id from sf_estoque_envios where chave = c_chave || 'S2') is distinct from e2.id then
    raise exception 'FALHOU (c): o estorno S2 tinha que apontar pra E2 (quem foi debitado); aponta pra %',
      (select entrada_id from sf_estoque_envios where chave = c_chave || 'S2'); end if;
  raise notice '47(c). duas entradas vivas: o saldo desce da VIGENTE, e o estorno grava ela: ok';
end $t$;

-- a rodada do passo (a) não entregou a E2: o laço solta a reserva DELA e ela volta pra fila. Só ela: o
-- S1 do passo (b) segue reservado (aquela rodada está entregando), e é isso que deixa a asserção abaixo
-- falar de uma linha só.
update public.sf_estoque_envios set reservado_em = null
 where chave = 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/E2' and not ok;

do $t$
declare v_chaves text[]; c_chave text := 'ALMOX/PMOC20/8503/Almoxarifado/CX[12][3]8503-PMOC20/';
begin
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r
   where r.bipe = 'CX[12][3]8503-PMOC20';
  -- a E2 ainda não está no ERP: ela sai, o estorno dela fica
  if v_chaves is distinct from array[c_chave || 'E2'] then
    raise exception 'FALHOU (d): esperava só a E2 (o estorno dela espera ela chegar ao ERP); veio %', v_chaves; end if;
  update sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null
   where chave = c_chave || 'E2';
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r
   where r.bipe = 'CX[12][3]8503-PMOC20';
  if v_chaves is distinct from array[c_chave || 'S2'] then
    raise exception 'FALHOU (d): a E2 entregue tinha que soltar o estorno dela; veio %', v_chaves; end if;
  raise notice '47(d). o estorno espera a entrada GRAVADA nele, e sai quando ela chega: ok';
end $t$;

-- As invariantes de novo, agora com a massa do 47 dentro.
do $t$ begin perform public.teste_fila_invariantes('depois do teste 47'); end $t$;

-- =============================================================
-- 48. O POSTO TEM QUE SER UM DOS POSTOS DA OP — nos dois caminhos (caixa e peça)
--
-- O defeito: a entrada conferia tudo (OP, perfil do posto, caixa, faixa, Embalagem, duplicidade) MENOS
-- se aquele posto pertence à OP. O bipe voltava `ok`, o operador lia "3 peças", e para o Fluxo e o
-- Dashboard aquelas linhas NÃO EXISTIAM: postoPendenteDePeca descarta todo registro de posto fora do
-- fluxo da OP (`doFluxo.has(p) || p === manut`) e sf_fluxo_op só monta nó pros postos da OP. As peças
-- ficavam como trabalho em processo na Embalagem e "Concluído" ficava 0 pra sempre — exatamente o modo
-- de falha que a decisão "uma linha por peça" veio matar, voltando por outra porta.
--
-- Massa própria, em OPs novas, porque as OPs de cima já têm o posto: aqui o que se mede é a AUSÊNCIA
-- dele, e depois a mesma massa com ele presente (só sf_ordem_postos muda entre os dois lados).
-- =============================================================

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOC21', '8505', 'Cliente Fora do Fluxo',  '8600', '8700', false),
  ('PMOI04', '9005', 'Cliente Fora Individual', '3000', '3100', true);
-- Nenhuma das duas tem o Almoxarifado: a OP passa pela Embalagem e para ali (é o retrato de toda OP
-- cadastrada antes de o posto existir).
do $t$ begin perform public.teste_op_postos('PMOC21', '8505', array['Embalagem']); end $t$;
do $t$ begin perform public.teste_op_postos('PMOI04', '9005', array['Embalagem']); end $t$;

insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada) values
  ('PMOC21', '8505', 'Embalagem', 1, 3, 3, 'CX[1][3]8505-PMOC21', true);
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
select 'Marcos', 'Embalagem', 'PMOC21', '8505', 'Cliente Fora do Fluxo', 'CX[1][3]8505-PMOC21',
       'SN-' || (8600 + i)::text, (8600 + i)::text from generate_series(1, 3) i;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm)
values ('Marcos', 'Embalagem', 'PMOI04', '9005', 'Cliente Fora Individual', '3001', 1, '3001', '3001');

do $t$
declare r jsonb; v_regs int; v_fila int;
begin
  perform set_config('teste.perms', 'shopfloor.lancar', false);

  -- (a) CAIXA, na OP que não tem o posto.
  r := sf_almoxarifado_entrada('PMOC21', '8505', 'Almoxarifado', 'Ana',
                               'CX[1][3]8505-PMOC21', 'caixa', 3, '');
  if r->>'motivo' is distinct from 'posto_fora_da_op' then
    raise exception 'FALHOU (a): a caixa entrou num posto que a OP não tem — as 3 peças sumiriam do Fluxo: %', r; end if;
  -- A frase é lida por um operador no coletor: tem que nomear o posto, a OP e o que fazer.
  if r->>'detalhe' not like '%Almoxarifado%'
     or r->>'detalhe' not like '%8505%'
     or r->>'detalhe' not like '%Cadastrar OP%' then
    raise exception 'FALHOU (a): o detalhe tem que dizer o posto, a OP e onde resolver: %', r->>'detalhe'; end if;

  -- (b) PEÇA, na OP individual que não tem o posto. O outro caminho da função, e ele precisa ser
  -- medido: a recusa mora antes do `if p_tipo = 'caixa'`, e um dia alguém pode movê-la pra dentro dele.
  r := sf_almoxarifado_entrada('PMOI04', '9005', 'Almoxarifado', 'Ana', '3001', 'serie', 1, '3001');
  if r->>'motivo' is distinct from 'posto_fora_da_op' then
    raise exception 'FALHOU (b): a peça entrou num posto que a OP não tem: %', r; end if;

  -- E nada ficou gravado por nenhum dos dois — nem registro nem linha na fila do Compels.
  select count(*) into v_regs from sf_registros
   where posto = 'Almoxarifado' and pmo in ('PMOC21', 'PMOI04');
  select count(*) into v_fila from sf_estoque_envios where pmo in ('PMOC21', 'PMOI04');
  if v_regs <> 0 or v_fila <> 0 then
    raise exception 'FALHOU (a/b): a recusa gravou % registro(s) e % linha(s) na fila', v_regs, v_fila; end if;

  raise notice '48(a/b). posto fora dos postos da OP: recusado nos dois caminhos, sem gravar nada: ok';
end $t$;

-- Agora o gestor faz o que a recusa mandou: acrescenta o posto nas duas OPs em Cadastrar OP.
do $t$ begin perform public.teste_op_postos('PMOC21', '8505', array['Almoxarifado']); end $t$;
do $t$ begin perform public.teste_op_postos('PMOI04', '9005', array['Almoxarifado']); end $t$;

do $t$
declare r jsonb;
begin
  perform set_config('teste.perms', 'shopfloor.lancar', false);

  -- (c) O CAMINHO LEGÍTIMO NÃO QUEBROU: mesma caixa, mesma massa, só o posto agora está na OP.
  r := sf_almoxarifado_entrada('PMOC21', '8505', 'Almoxarifado', 'Ana',
                               'CX[1][3]8505-PMOC21', 'caixa', 3, '');
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'quantidade')::int <> 3 then
    raise exception 'FALHOU (c): a caixa da OP que TEM o posto não entrou: %', r; end if;

  -- (d) e o mesmo pela peça.
  r := sf_almoxarifado_entrada('PMOI04', '9005', 'Almoxarifado', 'Ana', '3001', 'serie', 1, '3001');
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'quantidade')::int <> 1 then
    raise exception 'FALHOU (d): a peça da OP que TEM o posto não entrou: %', r; end if;

  raise notice '48(c/d). com o posto na OP, os dois caminhos entram normalmente: ok';
end $t$;

-- As invariantes de novo, agora com a massa do 48 dentro.
do $t$ begin perform public.teste_fila_invariantes('depois do teste 48'); end $t$;

-- =============================================================
-- 49. A RECUSA DO NQA TEM SAÍDA: cancelar a entrada devolve a caixa pra inspeção
--
-- O teste 23(b) prova que o NQA recusa a caixa que já deu entrada no Almoxarifado. Uma recusa sem
-- caminho de volta seria trocar um beco sem saída por outro — a frase da tela manda o gestor cancelar
-- a entrada em Registros → "Cancelar a caixa inteira" e inspecionar depois, e é isso que este teste
-- executa, com as funções REAIS: a 0131 (que só existe no arquivo a partir daqui) e a sf_nqa_caixa.
--
-- Usa a MESMA massa do 23(b) — a caixa recusada continua fechada, com as 3 linhas do Estoque de pé
-- e a montagem intocada, exatamente como o 23(b) deixou.
-- =============================================================

do $t$
declare r jsonb; v_id uuid; v_regs int; v_n int;
begin
  select id into v_id from sf_registros
   where pmo = 'PMOC22' and op = '8506' and posto = 'Estoque'
     and numero_caixa = 'CX[1][3]8506-PMOC22'
   limit 1;
  if v_id is null then
    raise exception 'FALHOU: o teste 49 depende das 3 linhas que o 23(b) deixou no Estoque'; end if;

  -- O gestor cancela a entrada inteira (um gesto, um motivo, as 3 linhas). A 0131 devolve a
  -- QUANTIDADE de linhas canceladas, não um jsonb.
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  v_n := sf_cancelar_caixa_almoxarifado(v_id, 'entrada dada antes do NQA');
  if v_n <> 3 then
    raise exception 'FALHOU: o cancelamento devolveu % linha(s), esperava 3', v_n; end if;
  select count(*) into v_regs from sf_registros
   where pmo = 'PMOC22' and posto = 'Estoque' and numero_caixa = 'CX[1][3]8506-PMOC22';
  if v_regs <> 0 then
    raise exception 'FALHOU: sobraram % linha(s) no Almoxarifado depois do cancelamento', v_regs; end if;

  -- E agora a inspeção passa: sem entrada em estoque, a guarda nova não tem o que ver.
  perform set_config('teste.perms', 'shopfloor.lancar,lancar', false);
  r := sf_nqa_caixa('PMOC22', '8506', 'Inspeção NQA', 'Qualidade', 'CX[1][3]8506-PMOC22',
                    'Reprovado', 'Embalagem',
                    '[{"sn_norm":"9901","visual":"Reprovado","funcional":"Aprovado","observacao":"riscada"}]'::jsonb);
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'total')::int <> 3 then
    raise exception 'FALHOU: depois de cancelar a entrada, o NQA ainda recusou: %', r; end if;
  if (select count(*) from teste_aposentadas
       where numero_caixa = 'CX[1][3]8506-PMOC22' and posto = 'Embalagem') <> 1 then
    raise exception 'FALHOU: a montagem não foi aposentada na Embalagem depois da reprova'; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  raise notice '49. cancelar a entrada devolve a caixa pro NQA (a recusa do 23(b) tem saída): ok';
end $t$;

-- As invariantes da fila de novo, agora com o cancelamento do 49 dentro (a entrada do 23(b) foi
-- estornada aqui).
do $t$ begin perform public.teste_fila_invariantes('depois do teste 49'); end $t$;
