-- Testes da fila de envio de estoque ao Compels (migração 0132).
-- Roda num Postgres descartável: supabase/tests/rodar-estoque-envios-test.sh
-- Tudo numa única conexão (a configuração de sessão `teste.perms` alimenta o stub do RBAC).

-- ---------- stubs mínimos do Supabase ----------
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula. É a de DOIS argumentos de
-- propósito: a de um argumento anula o RBAC (revisão de segurança de 21/09/2026), e a leitura da
-- fila tem que continuar exigindo shopfloor.visualizar e nada mais.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

\i /tmp/0132.sql

-- Imita os privilégios padrão de tabela do Supabase Dev (tudo liberado pro authenticated/anon),
-- deixando SÓ o RLS como barreira real. Se algum teste de segurança abaixo só passa por causa de um
-- `grant` estreito, essa linha estoura ele.
grant all on all tables in schema public to anon, authenticated;

select set_config('teste.perms', 'shopfloor.visualizar', false);

-- Ajuda dos testes: N linhas pendentes de uma OP, a g-ésima criada g minutos atrás (assim a ordem
-- da fila — mais antiga primeiro — é determinística, sem depender do uuid).
create function public.teste_fila(p_op text, p_n int) returns void language sql as $f$
  insert into public.sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, criado_em)
  select p_op || '/E' || g, 'PMOT01', p_op, 'Almoxarifado', 'caixa',
         'CX[' || g || '][14]' || p_op || '-PMOT01', 14, now() - make_interval(mins => g)
    from generate_series(1, p_n) g;
$f$;

-- 1. A linha nasce PENDENTE, e o check ok = (enviado_em is not null) vale nas duas direções: sem
--    ele, "entregue" e "com data de entrega" poderiam discordar e a fila mentiria pros dois lados.
do $t$
declare r public.sf_estoque_envios;
begin
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values ('K1', 'PMOA01', '9100', 'Almoxarifado', 'caixa', 'CX[1][14]9100-PMOA01', 14)
  returning * into r;
  if r.ok or r.tentativas <> 0 or r.reservado_em is not null or r.enviado_em is not null
     or r.cancelado_em is not null then
    raise exception 'FALHOU: linha nova tinha que nascer pendente: %', to_jsonb(r);
  end if;
  if r.operacao <> 'entrada' then
    raise exception 'FALHOU: operacao default tinha que ser entrada, veio %', r.operacao;
  end if;
  -- alvo (coluna gerada) = o que identifica o bipe: o código da caixa aqui, a série normalizada no
  -- caminho da peça. É a mesma escolha que a trava do sf_almoxarifado_entrada (0129) faz.
  if r.alvo <> 'CX[1][14]9100-PMOA01' then
    raise exception 'FALHOU: alvo da caixa tinha que ser o código bipado, veio %', r.alvo;
  end if;

  begin
    update sf_estoque_envios set ok = true where chave = 'K1';
    raise exception 'FALHOU: aceitou ok = true sem enviado_em';
  exception when check_violation then null;
  end;
  begin
    update sf_estoque_envios set enviado_em = now() where chave = 'K1';
    raise exception 'FALHOU: aceitou enviado_em sem ok';
  exception when check_violation then null;
  end;

  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
  values ('K2', 'PMOA01', '9101', 'Almoxarifado', 'serie', '00043-00462-0015718', '430046200015718', 1)
  returning * into r;
  if r.alvo <> '430046200015718' then
    raise exception 'FALHOU: alvo da peça tinha que ser a série normalizada, veio %', r.alvo;
  end if;

  raise notice 'estrutura da fila: ok';
end $t$;

-- 2. A CHAVE DE IDEMPOTÊNCIA É ÚNICA. É a linha de defesa que impede a mesma entrada de virar duas
--    no ERP: dois caminhos enfileirando o mesmo bipe, um deles morre aqui.
do $t$
begin
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('K1', 'PMOA01', '9100', 'Almoxarifado', 'caixa', 'CX[1][14]9100-PMOA01', 14);
    raise exception 'FALHOU: aceitou chave repetida';
  exception when unique_violation then null;
  end;
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values (null, 'PMOA01', '9100', 'Almoxarifado', 'caixa', 'CX[9][14]9100-PMOA01', 14);
    raise exception 'FALHOU: aceitou linha sem chave';
  exception when not_null_violation then null;
  end;
  raise notice 'chave única e obrigatória: ok';
end $t$;

-- 3. sf_estoque_chave: a chave do MESMO bipe muda a cada ciclo (entrada, estorno, entrada de novo).
--    É o que permite o caminho de volta documentado na 0131 — cancelar a caixa inteira e bipar
--    outra vez — sem a chave de ontem bloquear a entrada de hoje.
do $t$
declare k1 text; k2 text; ks text; v_e1 uuid;
begin
  k1 := sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[5][14]9102-PMOA01', 'entrada');
  if k1 <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[5][14]9102-PMOA01/E1' then
    raise exception 'FALHOU: primeira chave de entrada veio %', k1;
  end if;

  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values (k1, 'PMOA01', '9102', 'Almoxarifado', 'caixa', 'CX[5][14]9102-PMOA01', 14)
  returning id into v_e1;

  -- o estorno do mesmo bipe é outra movimentação: chave própria, que não colide com a entrada. E ele
  -- nasce com o PAR GRAVADO (`entrada_id`), como a sf_estoque_reverter faz — o CHECK da tabela cobra.
  ks := sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[5][14]9102-PMOA01', 'estorno');
  if ks <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[5][14]9102-PMOA01/S1' then
    raise exception 'FALHOU: chave do estorno veio %', ks;
  end if;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, entrada_id)
  values (ks, 'estorno', 'PMOA01', '9102', 'Almoxarifado', 'caixa', 'CX[5][14]9102-PMOA01', 14, v_e1);

  -- a caixa é bipada DE NOVO depois do estorno: entrada número 2, chave nova
  k2 := sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[5][14]9102-PMOA01', 'entrada');
  if k2 <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[5][14]9102-PMOA01/E2' then
    raise exception 'FALHOU: segunda entrada do mesmo bipe veio %', k2;
  end if;
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values (k2, 'PMOA01', '9102', 'Almoxarifado', 'caixa', 'CX[5][14]9102-PMOA01', 14);

  -- outro bipe (outra caixa) começa no E1: o contador é POR bipe, não por OP
  if sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[6][14]9102-PMOA01', 'entrada')
     <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[6][14]9102-PMOA01/E1' then
    raise exception 'FALHOU: o contador da chave vazou de um bipe pro outro';
  end if;

  -- a chave da PEÇA usa a série NORMALIZADA (o alvo), não o bipe cru: dois bipes crus diferentes da
  -- mesma peça (zero à esquerda a mais no coletor) têm que dar a MESMA identidade.
  if sf_estoque_chave('PMOA01', '9103', 'Almoxarifado', '430046200015718', 'entrada')
     <> 'ALMOX/PMOA01/9103/Almoxarifado/430046200015718/E1' then
    raise exception 'FALHOU: chave da peça';
  end if;

  raise notice 'sf_estoque_chave (ciclo do mesmo bipe): ok';
end $t$;

-- 4. RESERVA EM LOTE RESPEITANDO O LIMITE, com ordem previsível e a marca da tentativa.
do $t$
declare n int; v_ids uuid[]; v_espera uuid[];
begin
  -- limpa a fila do que veio dos testes de cima (cancelada nunca é reservada — teste 9)
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;

  perform teste_fila('9200', 5);
  -- as duas MAIS ANTIGAS, calculadas antes da reserva
  select array_agg(x.id order by x.id) into v_espera
    from (select id from sf_estoque_envios where op = '9200' order by criado_em limit 2) x;

  select array_agg(r.id order by r.id) into v_ids from sf_estoque_reservar(2) r;
  n := coalesce(cardinality(v_ids), 0);
  if n <> 2 then raise exception 'FALHOU: reservar(2) devolveu % linhas', n; end if;
  if v_ids <> v_espera then
    raise exception 'FALHOU: a reserva não pegou as duas mais antigas';
  end if;

  select count(*) into n from sf_estoque_envios
   where id = any (v_ids) and tentativas = 1 and reservado_em is not null;
  if n <> 2 then raise exception 'FALHOU: a reserva não marcou tentativa/reservado_em'; end if;

  select count(*) into n from sf_estoque_envios
   where op = '9200' and not (id = any (v_ids)) and (tentativas <> 0 or reservado_em is not null);
  if n <> 0 then raise exception 'FALHOU: a reserva mexeu em linha que não reservou'; end if;

  raise notice 'reserva em lote com limite: ok';
end $t$;

-- 5. Enquanto a reserva está VIVA, a linha não sai de novo: é isso que impede duas rodadas do cron
--    de mandarem a mesma entrada ao ERP.
do $t$
declare n int;
begin
  select count(*) into n from sf_estoque_reservar(100) where op = '9200' and tentativas = 2;
  if n <> 0 then raise exception 'FALHOU: reservou de novo linha com reserva viva (%)', n; end if;
  -- as 3 que ninguém tinha reservado continuam saindo
  select count(*) into n from sf_estoque_envios where op = '9200' and tentativas = 1;
  if n <> 5 then raise exception 'FALHOU: as 3 restantes tinham que ter sido reservadas, deu %', n; end if;
  raise notice 'reserva viva não sai duas vezes: ok';
end $t$;

-- 6. RESERVA VENCIDA volta pra fila: se o processo cair entre reservar e enviar, a entrada não pode
--    ficar presa pra sempre (entrega "pelo menos uma vez").
do $t$
declare n int;
begin
  update sf_estoque_envios set reservado_em = now() - interval '20 minutes'
   where op = '9200' and tentativas = 1;
  select count(*) into n from sf_estoque_reservar(100);
  if n <> 5 then raise exception 'FALHOU: reserva vencida não voltou pra fila (% de 5)', n; end if;
  select count(*) into n from sf_estoque_envios where op = '9200' and tentativas = 2;
  if n <> 5 then raise exception 'FALHOU: a segunda reserva não contou tentativa'; end if;
  raise notice 'reserva vencida volta pra fila: ok';
end $t$;

-- 7. TETO DE TENTATIVAS: linha que já gastou as tentativas sai da fila (e fica visível na tela de
--    pendências como falha, em vez de girar pra sempre).
do $t$
declare n int; v_teto int := 5;
begin
  update sf_estoque_envios
     set tentativas = v_teto, reservado_em = null, erro = 'Compels não configurado'
   where op = '9200';
  select count(*) into n from sf_estoque_reservar(100);
  if n <> 0 then raise exception 'FALHOU: reservou % linha(s) no teto de tentativas', n; end if;
  -- uma tentativa abaixo do teto ainda é reservável (o teto é "gastou tudo", não "quase")
  update sf_estoque_envios set tentativas = v_teto - 1 where op = '9200';
  select count(*) into n from sf_estoque_reservar(100);
  if n <> 5 then raise exception 'FALHOU: teto errado — % de 5 abaixo do teto', n; end if;
  raise notice 'teto de tentativas: ok';
end $t$;

-- 8. Linha ENTREGUE não volta pra fila.
do $t$
declare n int;
begin
  update sf_estoque_envios set ok = true, enviado_em = now(), erro = null
   where op = '9200';
  select count(*) into n from sf_estoque_reservar(100);
  if n <> 0 then raise exception 'FALHOU: reservou % linha já entregue', n; end if;
  raise notice 'linha entregue não é reservada: ok';
end $t$;

-- 9. Linha CANCELADA não volta pra fila. É o caminho da Task 2: cancelar a entrada antes de ela
--    chegar ao ERP cancela o envio pendente, em vez de mandar uma entrada e uma saída que nunca
--    precisaram existir.
do $t$
declare n int;
begin
  perform teste_fila('9300', 3);
  update sf_estoque_envios set cancelado_em = now() where op = '9300';
  select count(*) into n from sf_estoque_reservar(100);
  if n <> 0 then raise exception 'FALHOU: reservou % linha cancelada', n; end if;
  raise notice 'linha cancelada não é reservada: ok';
end $t$;

-- 10. SEM TETO DE 24 HORAS — a diferença de propósito em relação aos Alertas. Lá, mensagem velha não
--     interessa mais e a reserva ignora o que passou de um dia; aqui, entrada que não chegou ao ERP
--     continua interessando semanas depois. Este teste existe pra que ninguém "conserte" a reserva
--     copiando o filtro de 24 h dos Alertas sem perceber que está jogando estoque fora.
do $t$
declare n int;
begin
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, criado_em)
  values ('VELHA', 'PMOT01', '9400', 'Almoxarifado', 'caixa', 'CX[1][14]9400-PMOT01', 14,
          now() - interval '45 days');
  select count(*) into n from sf_estoque_reservar(100) where chave = 'VELHA';
  if n <> 1 then raise exception 'FALHOU: entrada de 45 dias atrás não foi reservada'; end if;
  raise notice 'sem teto de 24 h (entrada velha continua na fila): ok';
end $t$;

-- 11. O limite é aparado: nulo cai no default, zero/negativo viram 1, e existe teto — um lote
--     gigante seguraria a reserva (e o cron) muito mais do que a janela de reserva cobre.
do $t$
declare n int;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  -- mais linhas do que o teto de propósito: com 130 o "teto" seria só o resto da fila
  perform teste_fila('9500', 180);

  select count(*) into n from sf_estoque_reservar(0);
  if n <> 1 then raise exception 'FALHOU: limite 0 tinha que devolver 1 linha, deu %', n; end if;
  select count(*) into n from sf_estoque_reservar(-7);
  if n <> 1 then raise exception 'FALHOU: limite negativo tinha que devolver 1 linha, deu %', n; end if;
  select count(*) into n from sf_estoque_reservar(null);
  if n <> 30 then raise exception 'FALHOU: limite nulo tinha que cair no default 30, deu %', n; end if;
  -- 180 - 32 já reservadas = 148 disponíveis: o que limita aqui é o TETO, não a fila
  select count(*) into n from sf_estoque_reservar(9999);
  if n <> 100 then raise exception 'FALHOU: o teto do lote não valeu (deu %)', n; end if;
  raise notice 'limite do lote aparado: ok';
end $t$;

-- 12. RLS: quem tem shopfloor.visualizar LÊ a fila; quem não tem, não lê nada. Escrita não tem
--     policy nenhuma — quem grava é a RPC do bipe (security definer), nunca o navegador.
set role authenticated;
do $t$
declare n int;
begin
  select count(*) into n from sf_estoque_envios;
  if n = 0 then raise exception 'FALHOU: com shopfloor.visualizar a fila tinha que ser legível'; end if;

  perform set_config('teste.perms', 'shopfloor.lancar', false);
  select count(*) into n from sf_estoque_envios;
  if n <> 0 then raise exception 'FALHOU: sem shopfloor.visualizar leu % linha(s)', n; end if;
  perform set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('RLS', 'PMOA01', '9600', 'Almoxarifado', 'caixa', 'CX[1][1]9600-PMOA01', 1);
    raise exception 'FALHOU: authenticated gravou na fila';
  exception when insufficient_privilege then null;
  end;
  -- update sem policy não estoura: a linha simplesmente não é visível pra escrita. O que prova a
  -- trava é o número de linhas afetadas.
  update sf_estoque_envios set tentativas = 0;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: authenticated atualizou % linha(s) da fila', n; end if;
  raise notice 'RLS da fila (lê com visualizar, não escreve): ok';
end $t$;
reset role;

-- 13. Quem RESERVA é o servidor. A reserva conta tentativa e esconde a linha por 15 min: aberta ao
--     authenticated, qualquer aba logada queimaria as tentativas das entradas de estoque.
set role authenticated;
do $t$
declare n int;
begin
  begin
    select count(*) into n from sf_estoque_reservar(1);
    raise exception 'FALHOU: authenticated executou sf_estoque_reservar';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sf_estoque_chave('PMOA01', '9700', 'Almoxarifado', 'X', 'entrada');
    raise exception 'FALHOU: authenticated executou sf_estoque_chave';
  exception when insufficient_privilege then null;
  end;
  raise notice 'gate de execução (só o servidor reserva): ok';
end $t$;
reset role;

set role service_role;
do $t$
declare n int;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  perform teste_fila('9800', 2);
  select count(*) into n from sf_estoque_reservar(10);
  if n <> 2 then raise exception 'FALHOU: service_role não reservou (% de 2)', n; end if;
  raise notice 'service_role reserva: ok';
end $t$;
reset role;

-- 14. TIPO 'SERIE' EXIGE SERIE_NORM NÃO VAZIO: é o que garante que alvo (coluna gerada) nunca cai
--     na identidade do bipe cru. Sem serie_norm preenchida, um bug futuro na RPC deixaria a mesma
--     peça (com variação de formato cru) gerar duas chaves e duas linhas no ERP, violando a
--     intenção da chave única.
do $t$
begin
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
    values ('K_SERIE_VAZIO', 'PMOA01', '9900', 'Almoxarifado', 'serie', '00043-00462-0015718', '', 1);
    raise exception 'FALHOU: aceitou tipo=serie com serie_norm vazio';
  exception when check_violation then null;
  end;
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
    values ('K_SERIE_VAZIO_ESPACOS', 'PMOA01', '9901', 'Almoxarifado', 'serie', '00043-00462-0015718', '   ', 1);
    raise exception 'FALHOU: aceitou tipo=serie com serie_norm só espaços';
  exception when check_violation then null;
  end;
  -- tipo=caixa COM serie_norm preenchida é permitido (não causa problema): alvo cai no bipe de
  -- qualquer forma, e é a RPC security definer que controla quando preenchê-lo.
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
  values ('K_CAIXA_COM_SERIE', 'PMOA01', '9902', 'Almoxarifado', 'caixa', 'CX[1][14]9902-PMOA01',
          'SERIE_PODE_TER', 14);
  raise notice 'tipo=serie exige serie_norm, caixa pode ter ou não: ok';
end $t$;

-- 15. A CHAVE é obrigatória e não pode ser vazia — ela é a identidade do bipe no ERP. O CHECK
--     btrim(chave) <> '' garante que chave não é null e não é só espaços em branco. Este teste
--     exercita especificamente o CHECK de valor vazio que existia antes.
do $t$
begin
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('', 'PMOA01', '9903', 'Almoxarifado', 'caixa', 'CX[1][14]9903-PMOA01', 14);
    raise exception 'FALHOU: aceitou chave vazia';
  exception when check_violation then null;
  end;
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('   ', 'PMOA01', '9904', 'Almoxarifado', 'caixa', 'CX[1][14]9904-PMOA01', 14);
    raise exception 'FALHOU: aceitou chave só espaços';
  exception when check_violation then null;
  end;
  raise notice 'chave obrigatória e não vazia: ok';
end $t$;

-- 16. `estornado` DENTRO DA QUANTIDADE — a invariante da reversão escrita como CHECK: a soma do que
--     é estornado de uma entrada nunca passa do que foi enviado ao ERP. A conta em si é da
--     sf_estoque_reverter (e o teste dela está no almoxarifado_test.sql, que roda o cancelamento de
--     verdade); aqui prova-se a rede EMBAIXO dela — a que também vale pra próxima função que alguém
--     escrever pra mexer na fila, e pro `update` manual no SQL Editor às 18h. Sem ela, o erro seria
--     silencioso: estoque errado no Compels, e ninguém do lado de cá sabendo.
do $t$
declare v_id uuid;
begin
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values ('K_ESTORNADO', 'PMOA01', '9905', 'Almoxarifado', 'caixa', 'CX[1][3]9905-PMOA01', 3)
  returning id into v_id;
  -- nasce sem nada revertido: é o saldo cheio que a reversão vai encontrar
  if (select estornado from sf_estoque_envios where id = v_id) <> 0 then
    raise exception 'FALHOU: estornado tinha que nascer 0'; end if;

  begin
    update sf_estoque_envios set estornado = -1 where id = v_id;
    raise exception 'FALHOU: aceitou estornado negativo';
  exception when check_violation then null;
  end;
  begin
    update sf_estoque_envios set estornado = 4 where id = v_id;
    raise exception 'FALHOU: aceitou estornar 4 de uma entrada de 3';
  exception when check_violation then null;
  end;
  -- reverter por INTEIRO é válido (é o fim normal de uma caixa cancelada depois de entregue)
  update sf_estoque_envios set estornado = 3 where id = v_id;
  -- e depois disso a quantidade não pode encolher abaixo do que já foi revertido: seria dizer que o
  -- ERP recebeu menos do que já lhe foi devolvido.
  begin
    update sf_estoque_envios set quantidade = 2 where id = v_id;
    raise exception 'FALHOU: aceitou quantidade menor que o já estornado';
  exception when check_violation then null;
  end;
  raise notice 'estornado dentro da quantidade (a invariante da reversão): ok';
end $t$;

-- 17. A ORDEM DO PAR: O ESTORNO NÃO É RESERVADO ENQUANTO A ENTRADA GRAVADA NELE NÃO ESTÁ `ok`. É a
--     regra que impede o ERP de receber a saída antes da entrada (estoque negativo, ou uma saída
--     recusada), e ela mora AQUI, na reserva, e não no laço de envio — o porquê está no ⚠️ do
--     cabeçalho da sf_estoque_reservar. Aqui o bipe tem UMA entrada só, então o que se prova são as
--     duas metades da regra (os casos de várias entradas são os testes 19 e 20):
--       • a entrada em voo (uma rodada já tentou, a reserva venceu) sai; o estorno dela fica;
--       • e o estorno segurado NÃO paga tentativa — linha segurada não é linha que falhou. Se ela
--         pagasse, cinco rodadas de espera a tirariam da fila (tentativas < 5) sem nunca ter sido
--         enviada, que é o desastre que o teto existe pra evitar, chegando pelo lado errado.
--     O estorno nasce com `entrada_id` apontando pra entrada dele, que é o que a sf_estoque_reverter
--     grava — e o que a reserva LÊ (ela não infere mais par nenhum).
do $t$
declare n int; v_chaves text[]; v_e1 uuid;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;

  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, reservado_em)
  values ('PAR/E1', 'entrada', 'PMOT01', '9906', 'Almoxarifado', 'caixa', 'CX[1][3]9906-PMOT01', 3,
          now() - interval '10 minutes', 1, now() - interval '20 minutes')
  returning id into v_e1;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, reservado_em, entrada_id)
  values ('PAR/S1', 'estorno', 'PMOT01', '9906', 'Almoxarifado', 'caixa', 'CX[1][3]9906-PMOT01', 3,
          now() - interval '5 minutes', 0, null, v_e1);

  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is distinct from array['PAR/E1'] then
    raise exception 'FALHOU: a reserva tinha que devolver só a entrada, veio %', v_chaves;
  end if;
  select count(*) into n from sf_estoque_envios
   where chave = 'PAR/S1' and tentativas = 0 and reservado_em is null and erro is null;
  if n <> 1 then raise exception 'FALHOU: o estorno segurado saiu marcado/tentado da reserva'; end if;

  -- a entrada chega ao ERP: na rodada SEGUINTE o estorno é liberado (é o fim normal da espera)
  update sf_estoque_envios set ok = true, enviado_em = now() where chave = 'PAR/E1';
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is distinct from array['PAR/S1'] then
    raise exception 'FALHOU: entrada entregue não liberou o estorno, veio %', v_chaves;
  end if;
  raise notice 'ordem do par (estorno espera a entrada, sem pagar tentativa): ok';
end $t$;

-- 18. AS TRÊS BORDAS DA MESMA REGRA, cada uma com um jeito de dar errado:
--     (a) entrada que DESISTIU (teto de tentativas) segura o estorno — a espera passa a esperar UMA
--         PESSOA (o Reenviar da tela de pendências), e "resolver" isso entregando a saída sozinha
--         deixaria o Compels com uma saída que ele nunca recebeu;
--     (b) estorno cuja entrada GRAVADA está CANCELADA também segura: uma entrada cancelada nunca vira
--         `ok` (o check da tabela proíbe), então a reserva lê `ok = false` e não solta.
--         ⚠️ Este caso já afirmou outras duas coisas, e as duas vezes a razão estava errada. Primeiro
--         "entrada cancelada do bipe segura o estorno", que valia pra QUALQUER cancelada — inclusive
--         uma de um ciclo antigo já encerrado, que prendia pra sempre o estorno de um ciclo novo (o
--         Critical da rodada anterior; a sequência está no teste 19). Depois "sem entrada VIVA anterior,
--         segura", que era a inferência que discordava da sf_estoque_reverter (o Important desta
--         rodada). Hoje não há inferência nenhuma: o estorno DIZ quem é o par dele, e este caso é o par
--         cancelado. Sob as regras da sf_estoque_reverter ele não é alcançável (ela nunca cancela
--         entrada que já tem estorno — ver A ASSIMETRIA), então é a rede pra quem afrouxar aquela
--         regra, ou mexer na fila pelo SQL Editor;
--     (c) e a entrada criada DEPOIS do estorno (o rebipe da caixa) NÃO é par dele e NÃO pode segurá-lo:
--         senão um rebipe que falha prende para sempre um estorno que já tinha a entrada dele entregue.
--         Com o par gravado isso é verdade por construção — o estorno aponta pra E1 e a E2 não tem como
--         entrar na conta —, e o teste fica como rede pra quem quiser "melhorar" o predicado olhando o
--         bipe outra vez.
do $t$
declare v_chaves text[]; v_teto uuid; v_canc uuid; v_reb uuid;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em)
  values ('TETO/E1', 'entrada', 'PMOT01', '9907', 'Almoxarifado', 'caixa', 'CX[1][3]9907-PMOT01', 3,
          now() - interval '10 minutes', 5, false, null, null)
  returning id into v_teto;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em)
  values ('CANC/E1', 'entrada', 'PMOT01', '9908', 'Almoxarifado', 'caixa', 'CX[1][3]9908-PMOT01', 3,
          now() - interval '10 minutes', 0, false, null, now())
  returning id into v_canc;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em)
  values ('REB/E1', 'entrada', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '30 minutes', 1, true, now(), null)
  returning id into v_reb;
  -- os três estornos, cada um apontando pro par dele, e o rebipe pendente que não é par de ninguém
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em, entrada_id)
  values ('TETO/S1', 'estorno', 'PMOT01', '9907', 'Almoxarifado', 'caixa', 'CX[1][3]9907-PMOT01', 3,
          now() - interval '5 minutes', 0, false, null, null, v_teto),
         ('CANC/S1', 'estorno', 'PMOT01', '9908', 'Almoxarifado', 'caixa', 'CX[1][3]9908-PMOT01', 3,
          now() - interval '5 minutes', 0, false, null, null, v_canc),
         ('REB/S1', 'estorno', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '20 minutes', 0, false, null, null, v_reb);
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em)
  values ('REB/E2', 'entrada', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '10 minutes', 0, false, null, null);

  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  -- só o rebipe pendente e o estorno já pareado: os dois estornos presos (teto e cancelada) ficam
  if v_chaves is distinct from array['REB/E2', 'REB/S1'] then
    raise exception 'FALHOU: as bordas da ordem do par não bateram, veio %', v_chaves;
  end if;
  raise notice 'bordas da ordem do par (teto, par cancelado, rebipe posterior): ok';
end $t$;

-- 19. UM CICLO ANTIGO DO MESMO BIPE NÃO SEGURA O ESTORNO DO CICLO DE AGORA (o Critical da revisão da
--     Task 3). O predicado dizia "qualquer entrada anterior não-ok segura", e uma entrada CANCELADA
--     nunca vira `ok` (o check da tabela proíbe): uma E1 cancelada em qualquer momento da vida do bipe
--     prendia PARA SEMPRE todo estorno futuro dele — com tentativas = 0, sem `erro`, e com a linha que
--     o bloqueava invisível na tela de pendências, que não lista canceladas. Resultado: o Compels
--     ficava com peças que o ShopFloor já removeu, sem erro, sem falha e sem linha nenhuma — a perda
--     silenciosa que esta feature existe pra não ter.
--
--     Os seis passos abaixo são só caminhos documentados, nenhum estado inventado (o mesmo roteiro
--     rodado pelas RPCs de verdade está no teste 46 do almoxarifado_test.sql):
--       1. bipe da caixa → E1 limpa na fila;
--       2. o gestor cancela antes da primeira rodada do cron → a E1 é CANCELADA (é o caminho certo na
--          linha limpa: não se manda ao ERP uma entrada e uma saída que nunca precisaram existir);
--       3. o operador rebipa a mesma caixa, que é o que a recusa da 0129 manda fazer → E2;
--       4. o cron entrega a E2 → ok;
--       5. o gestor cancela a caixa outra vez → estorno S1, par da E2 (é o que o `entrada_id` dele
--          GRAVA, porque é da E2 que a sf_estoque_reverter desceu o saldo);
--       6. a reserva TEM que devolver a S1: a entrada gravada nela (a E2) está `ok`.
--     Hoje o passo 6 é verdade por construção — a E1 não tem como entrar na conta, porque a S1 diz de
--     quem ela saiu. O teste fica como rede pra quem voltar a procurar o par pelo bipe.
do $t$
declare v_chaves text[]; c_pre text := 'ALMOX/PMOT01/9910/Almoxarifado/CX[1][3]9910-PMOT01/';
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em, estornado)
  values
    -- 1+2. o primeiro ciclo, encerrado: entrada limpa cancelada antes de qualquer rodada
    (c_pre || 'E1', 'entrada', 'PMOT01', '9910',
     'Almoxarifado', 'caixa', 'CX[1][3]9910-PMOT01', 3,
     now() - interval '40 minutes', 0, false, null, now() - interval '35 minutes', 0),
    -- 3+4. o rebipe, entregue ao ERP
    (c_pre || 'E2', 'entrada', 'PMOT01', '9910',
     'Almoxarifado', 'caixa', 'CX[1][3]9910-PMOT01', 3,
     now() - interval '30 minutes', 1, true, now() - interval '25 minutes', null, 3);
  -- 5. o estorno da E2 (o saldo dela já desceu pra 3/3 e o par está gravado, como a
  --    sf_estoque_reverter faz)
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em, estornado, entrada_id)
  values
    (c_pre || 'S1', 'estorno', 'PMOT01', '9910',
     'Almoxarifado', 'caixa', 'CX[1][3]9910-PMOT01', 3,
     now() - interval '5 minutes', 0, false, null, null, 0,
     (select id from sf_estoque_envios where chave = c_pre || 'E2'));

  -- 6. A PROVA. Com o predicado que procurava o par pelo bipe ("qualquer anterior não-ok"), a E1
  -- cancelada segura a S1 e este array vem VAZIO — agora e em toda rodada seguinte, calado.
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is distinct from array[c_pre || 'S1'] then
    raise exception 'FALHOU: a E1 CANCELADA de um ciclo encerrado prendeu o estorno da E2, que já está no ERP — o Compels fica com peças que o ShopFloor removeu, sem erro e sem linha na tela; veio %', v_chaves;
  end if;
  raise notice '19. ciclo antigo (E1 cancelada) não segura o estorno da entrada gravada: ok';
end $t$;

-- 20. O PAR NASCIDO NA MESMA TRANSAÇÃO DO ESTORNO (o Important desta rodada). Quando o predicado
--     INFERIA o par — "a mais recente das vivas do mesmo bipe criadas ANTES dele" —, o `<` estrito
--     escolhia NENHUMA: cancelar a caixa de uma linha tocada e rebipar acontece numa transação só, e
--     `criado_em` é `now()`, o instante da TRANSAÇÃO, então a E1 (que É o par, a que foi DEBITADA) tem
--     exatamente o mesmo `criado_em` do estorno. A reserva caía no lado "segura" e — aqui está o pior —
--     continuava caindo nele DEPOIS de a E1 ser entregue, porque o `criado_em <` a excluía antes de o
--     `ok` dela ser lido. Preso para sempre, com tentativas = 0 e sem `erro`: o mesmo perfil silencioso
--     do Critical do teste 19, por outra porta. É o estado que o teste 45 do almoxarifado_test.sql
--     constrói pelas RPCs (um do-block é UMA transação), e a sf_estoque_reverter já o tratava certo — as
--     duas funções discordavam sobre qual entrada era o par, e discordar aqui é ficar preso.
--
--     Com o par GRAVADO não há mais o que discordar: a reserva lê o `ok` da linha que o estorno aponta.
--     As duas metades:
--       • a entrada do par ENTREGUE (viva, `ok`, saldo todo estornado) → a reserva SOLTA o estorno;
--       • a mesma coisa com ela AINDA NÃO entregue → SEGURA (o espelho, senão o teste passaria com um
--         predicado que libera tudo).
do $t$
declare v_chaves text[]; v_e1 uuid; v_t timestamptz := now() - interval '7 minutes';
  c_pre text := 'ALMOX/PMOT01/9911/Almoxarifado/CX[1][3]9911-PMOT01/';
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;

  -- A E1 tocada e inteiramente estornada, VIVA na fila (é o que a sf_estoque_reverter deixa quando
  -- cancelam a caixa de uma linha em voo: a entrada continua indo pro ERP), e a E2 do rebipe. As três
  -- linhas com o MESMO `criado_em`, que é o empate da transação única.
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, estornado)
  values (c_pre || 'E1', 'entrada', 'PMOT01', '9911', 'Almoxarifado', 'caixa',
          'CX[1][3]9911-PMOT01', 3, v_t, 1, 3)
  returning id into v_e1;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, estornado)
  values (c_pre || 'E2', 'entrada', 'PMOT01', '9911', 'Almoxarifado', 'caixa',
          'CX[1][3]9911-PMOT01', 3, v_t, 0, 0);
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, entrada_id)
  values (c_pre || 'S1', 'estorno', 'PMOT01', '9911', 'Almoxarifado', 'caixa',
          'CX[1][3]9911-PMOT01', 3, v_t, 0, v_e1);

  -- ESPELHO: a E1 ainda não chegou ao ERP, então o estorno dela NÃO sai (as duas entradas saem).
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is distinct from array[c_pre || 'E1', c_pre || 'E2'] then
    raise exception 'FALHOU: com a entrada do par ainda não entregue, o estorno tinha que ficar; veio %', v_chaves;
  end if;

  -- O cron entrega a E1 — a entrada do par, mesmo tendo nascido na mesma transação do estorno.
  update sf_estoque_envios set ok = true, enviado_em = now(), reservado_em = null
   where chave = c_pre || 'E1';
  -- A PROVA: a reserva solta a S1. Com o `criado_em <` estrito ela vinha VAZIA, agora e sempre.
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is distinct from array[c_pre || 'S1'] then
    raise exception 'FALHOU: a entrada do par foi entregue e o estorno continuou preso — o par nasceu na MESMA transação e o predicado não o achou; veio %', v_chaves;
  end if;
  raise notice '20. par nascido na mesma transação: entrega da entrada gravada solta o estorno: ok';
end $t$;

-- 21. O VÍNCULO COMO INVARIANTE DA TABELA, e o que a reserva faz sem ele. Ter par é EXATAMENTE ser
--     estorno: o CHECK recusa estorno sem `entrada_id` (o estado que a reserva não sabe ler) e entrada
--     COM `entrada_id` (uma entrada não tem par — ela É o par). A rede vale pro `insert` à mão no SQL
--     Editor e pra próxima função que alguém escrever pra mexer na fila, igual ao check do `estornado`.
--     E o último pedaço: com o check DERRUBADO à mão, um estorno sem vínculo é SEGURADO, e não
--     liberado. É a escolha escrita no predicado — liberar mandaria ao ERP uma saída de peça que ele
--     nunca recebeu (estoque de menos lá, irreversível de cá, e ninguém sabendo); segurar deixa a linha
--     parada, sem estragar estoque nenhum, e é um erro que dá pra descobrir depois.
do $t$
declare v_chaves text[]; v_e1 uuid;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, ok, enviado_em)
  values ('VINC/E1', 'entrada', 'PMOT01', '9912', 'Almoxarifado', 'caixa', 'CX[1][3]9912-PMOT01', 3,
          true, now())
  returning id into v_e1;

  begin
    insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade)
    values ('VINC/S0', 'estorno', 'PMOT01', '9912', 'Almoxarifado', 'caixa', 'CX[1][3]9912-PMOT01', 3);
    raise exception 'FALHOU: aceitou estorno SEM entrada_id';
  exception when check_violation then null;
  end;
  begin
    insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, entrada_id)
    values ('VINC/E2', 'entrada', 'PMOT01', '9912', 'Almoxarifado', 'caixa', 'CX[1][3]9912-PMOT01', 3,
            v_e1);
    raise exception 'FALHOU: aceitou ENTRADA com entrada_id (entrada não tem par, ela é o par)';
  exception when check_violation then null;
  end;
  -- e o vínculo tem que apontar pra uma linha que existe: a chave estrangeira é a outra metade
  begin
    insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, entrada_id)
    values ('VINC/S9', 'estorno', 'PMOT01', '9912', 'Almoxarifado', 'caixa', 'CX[1][3]9912-PMOT01', 3,
            '11111111-1111-4111-8111-111111111111');
    raise exception 'FALHOU: aceitou estorno apontando pra linha que não existe';
  exception when foreign_key_violation then null;
  end;

  -- Com o check fora do caminho (é só assim que este estado nasce), o estorno sem vínculo SEGURA.
  alter table sf_estoque_envios drop constraint sf_estoque_envios_entrada_id_so_no_estorno;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade)
  values ('VINC/S1', 'estorno', 'PMOT01', '9912', 'Almoxarifado', 'caixa', 'CX[1][3]9912-PMOT01', 3);
  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  if v_chaves is not null then
    raise exception 'FALHOU: estorno sem vínculo tinha que ser SEGURADO (liberar manda ao ERP uma saída que ele nunca recebeu); a reserva devolveu %', v_chaves;
  end if;
  -- desfaz o estado inválido e devolve o check, pra a reaplicação da migração (que roda no runner
  -- depois deste arquivo) não encontrar a tabela sem ele nem com linha que o viola
  delete from sf_estoque_envios where chave = 'VINC/S1';
  alter table sf_estoque_envios
    add constraint sf_estoque_envios_entrada_id_so_no_estorno
    check ((operacao = 'estorno') = (entrada_id is not null));
  raise notice '21. vínculo obrigatório no estorno (e proibido na entrada); sem vínculo, segura: ok';
end $t$;

-- 22. O REENVIAR DA TELA DE PENDÊNCIAS (Task 5), E POR QUE ELE NÃO ZERA `tentativas`.
--     A tela tem um botão que devolve à fila a linha que gastou o teto — sem ele, quem vê o problema
--     não tem o que fazer além de chamar o desenvolvedor. Para voltar, `tentativas` TEM de cair abaixo
--     de 5 (é o filtro da reserva e o predicado do índice parcial). A decisão da tela é voltar para 1,
--     e NUNCA para 0, porque `tentativas > 0` é a primeira perna da marca de LINHA TOCADA que a
--     sf_estoque_reverter usa para ESTORNAR em vez de ajustar/cancelar — e essa marca existe porque a
--     reserva soma 1 ANTES de falar com o ERP, então uma linha já tentada PODE ter chegado lá com a
--     resposta perdida no caminho. Este teste prova as três coisas que a decisão promete:
--       (a) com tentativas = 1 a linha VOLTA a ser reservada, e o estorno dela continua retido (a
--           ordem do par não é afrouxada pelo reenvio);
--       (b) com `estornado > 0`, o cancelamento de uma peça ainda ESTORNA depois do reenvio — o
--           caminho do ajuste, que reduziria a `quantidade` abaixo do já estornado e estouraria o
--           CHECK na cara do gestor, segue FECHADO;
--       (c) o contraste, que é o que justifica a decisão: com `estornado = 0`, a MESMA linha
--           reenviada COM 1 estorna, e reenviada COM 0 ela é CANCELADA — ou seja, zerar
--           transformaria uma entrada que talvez já esteja no Compels em entrada cancelada, sem
--           estorno e sem nada acusando. É a perda silenciosa que a fila existe para não ter.
--     As três partes NASCEM NO TETO (tentativas = 5, a linha que saiu da fila) e passam pelo MESMO
--     `update` que a `liberarParaReenvio` faz, em vez de já nascerem com o valor final inserido à
--     mão: assim é o VALOR QUE O REENVIAR GRAVA que está sob teste, e não uma propriedade do banco
--     que valeria para qualquer número. Trocar o `1` deste teste por `0` tem de derrubá-lo.
do $t$
declare v_chaves text[]; v_e uuid; n int; v_res text; r public.sf_estoque_envios;
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;

  -- (a) O PAR TRAVADO: a entrada gastou o teto (saiu da fila) e por isso segura o estorno dela para
  --     sempre. É o caso que SÓ um Reenviar humano destrava, e é o que a tela mostra junto.
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, estornado,
                                 tentativas, erro, criado_em)
  values ('PEND/9920/E1', 'entrada', 'PMOT01', '9920', 'Almoxarifado', 'caixa',
          'CX[1][3]9920-PMOT01', 3, 2, 5, 'Compels: envio não implementado',
          now() - interval '30 minutes')
  returning id into v_e;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, entrada_id,
                                 criado_em)
  values ('PEND/9920/S1', 'estorno', 'PMOT01', '9920', 'Almoxarifado', 'caixa',
          'CX[1][3]9920-PMOT01', 2, v_e, now() - interval '20 minutes');

  select array_agg(x.chave order by x.chave) into v_chaves from sf_estoque_reservar(100) x;
  if v_chaves is not null then
    raise exception 'FALHOU: par travado (entrada no teto) não podia sair da fila, veio %', v_chaves;
  end if;

  -- O REENVIAR, exatamente como a `liberarParaReenvio` escreve (tentativas = 1, solta a reserva, e a
  -- cerca que impede sobrescrever uma linha que mudou no meio).
  update sf_estoque_envios set tentativas = 1, reservado_em = null
   where id = v_e and ok = false and cancelado_em is null and tentativas >= 5;
  if not found then raise exception 'FALHOU: o Reenviar não encontrou a linha para liberar'; end if;

  -- O VALOR GRAVADO, conferido ANTES da reserva (que soma 1 e apagaria a evidência): 1, e nunca 0 —
  -- `tentativas > 0` é a primeira perna da marca de LINHA TOCADA de que dependem (b) e (c).
  select * into r from sf_estoque_envios where id = v_e;
  if r.tentativas <> 1 then
    raise exception 'FALHOU: o Reenviar tinha que deixar tentativas = 1 (nunca 0), veio %', r.tentativas;
  end if;
  if r.reservado_em is not null then raise exception 'FALHOU: o Reenviar não soltou a reserva'; end if;

  select array_agg(x.chave order by x.chave) into v_chaves from sf_estoque_reservar(100) x;
  if v_chaves is distinct from array['PEND/9920/E1'] then
    raise exception 'FALHOU: depois do Reenviar a reserva tinha que devolver só a entrada, veio %', v_chaves;
  end if;
  -- e o estorno CONTINUA retido, sem pagar tentativa: o reenvio da entrada não afrouxa a ordem do par
  select count(*) into n from sf_estoque_envios
   where chave = 'PEND/9920/S1' and tentativas = 0 and reservado_em is null and erro is null;
  if n <> 1 then raise exception 'FALHOU: o reenvio da entrada mexeu no estorno retido'; end if;
  -- o erro da última falha FICA na linha: é o que a tela mostra até a próxima rodada dar resultado
  select * into r from sf_estoque_envios where id = v_e;
  if r.erro is null then raise exception 'FALHOU: o Reenviar apagou o motivo da última falha'; end if;
  if r.quantidade <> 3 or r.estornado <> 2 then
    raise exception 'FALHOU: o Reenviar mexeu em quantidade/estornado: %', to_jsonb(r);
  end if;

  -- (b) `estornado > 0` DEPOIS DO REENVIAR: o cancelamento de uma peça ESTORNA, não ajusta. A linha
  --     nasce no teto e é o `update` do Reenviar que a devolve à fila — é ele que está sob teste.
  --     Bipe novo porque a linha de (a) já está reservada por aquela rodada.
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, estornado,
                                 tentativas, reservado_em)
  values ('PEND/9921/E1', 'entrada', 'PMOT01', '9921', 'Almoxarifado', 'caixa',
          'CX[1][3]9921-PMOT01', 3, 2, 5, null)
  returning id into v_e;
  update sf_estoque_envios set tentativas = 1, reservado_em = null
   where id = v_e and ok = false and cancelado_em is null and tentativas >= 5;
  if not found then raise exception 'FALHOU (b): o Reenviar não encontrou a linha'; end if;
  select * into r from sf_estoque_envios where id = v_e;
  if r.tentativas <> 1 then
    raise exception 'FALHOU (b): o Reenviar tinha que deixar tentativas = 1, veio %', r.tentativas;
  end if;
  v_res := sf_estoque_reverter('PMOT01', '9921', 'Almoxarifado', 'CX[1][3]9921-PMOT01', 1);
  if v_res <> 'estorno' then
    raise exception 'FALHOU: linha reenviada com estornado > 0 tinha que ESTORNAR, veio %', v_res;
  end if;
  select * into r from sf_estoque_envios where id = v_e;
  if r.quantidade <> 3 or r.estornado <> 3 then
    raise exception 'FALHOU: o ajuste continuava alcançável (quantidade/estornado erradas): %', to_jsonb(r);
  end if;
  -- e o saldo zerado não gera mais estorno nenhum
  if sf_estoque_reverter('PMOT01', '9921', 'Almoxarifado', 'CX[1][3]9921-PMOT01', 1) <> 'nada' then
    raise exception 'FALHOU: estornou além do saldo';
  end if;

  -- (c) O CONTRASTE que justifica a decisão: `estornado = 0`, o caso em que a rede
  --     `or estornado > 0` da reverter NÃO ajuda. Reenviada como o código faz (tentativas = 1) a
  --     entrada é ESTORNADA e continua viva para chegar ao ERP...
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, tentativas)
  values ('PEND/9922/E1', 'entrada', 'PMOT01', '9922', 'Almoxarifado', 'caixa',
          'CX[1][3]9922-PMOT01', 3, 5)
  returning id into v_e;
  update sf_estoque_envios set tentativas = 1, reservado_em = null
   where id = v_e and ok = false and cancelado_em is null and tentativas >= 5;
  if not found then raise exception 'FALHOU (c): o Reenviar não encontrou a linha'; end if;
  v_res := sf_estoque_reverter('PMOT01', '9922', 'Almoxarifado', 'CX[1][3]9922-PMOT01', null);
  if v_res <> 'estorno' then
    raise exception 'FALHOU: linha reenviada pelo código tinha que ESTORNAR, veio %', v_res;
  end if;
  select * into r from sf_estoque_envios where id = v_e;
  if r.cancelado_em is not null or r.estornado <> 3 then
    raise exception 'FALHOU: a entrada reenviada tinha que ficar viva e inteiramente estornada: %', to_jsonb(r);
  end if;

  -- ...e o MESMO Reenviar escrito com 0 (o defeito que a decisão impede) deixa a MESMA linha ser
  -- CANCELADA: o Compels ficaria com peças que o ShopFloor removeu, sem estorno e sem nada acusando.
  -- Esta linha nasce igualzinha à de cima — a ÚNICA diferença entre as duas é o número gravado.
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, tentativas)
  values ('PEND/9923/E1', 'entrada', 'PMOT01', '9923', 'Almoxarifado', 'caixa',
          'CX[1][3]9923-PMOT01', 3, 5)
  returning id into v_e;
  update sf_estoque_envios set tentativas = 0, reservado_em = null
   where id = v_e and ok = false and cancelado_em is null and tentativas >= 5;
  if not found then raise exception 'FALHOU (contraste): o Reenviar não encontrou a linha'; end if;
  v_res := sf_estoque_reverter('PMOT01', '9923', 'Almoxarifado', 'CX[1][3]9923-PMOT01', null);
  if v_res <> 'cancelado' then
    raise exception 'FALHOU: o contraste não vale nada se a linha zerada não for cancelada, veio %', v_res;
  end if;

  raise notice '22. Reenviar devolve à fila com tentativas = 1: o par não é afrouxado e o ajuste/cancelamento segue fechado: ok';
end $t$;

select 'ESTOQUE ENVIOS SQL OK' as fim;
