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
