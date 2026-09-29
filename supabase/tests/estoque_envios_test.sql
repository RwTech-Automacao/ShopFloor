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
declare k1 text; k2 text; ks text;
begin
  k1 := sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[5][14]9102-PMOA01', 'entrada');
  if k1 <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[5][14]9102-PMOA01/E1' then
    raise exception 'FALHOU: primeira chave de entrada veio %', k1;
  end if;

  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values (k1, 'PMOA01', '9102', 'Almoxarifado', 'caixa', 'CX[5][14]9102-PMOA01', 14);

  -- o estorno do mesmo bipe é outra movimentação: chave própria, que não colide com a entrada
  ks := sf_estoque_chave('PMOA01', '9102', 'Almoxarifado', 'CX[5][14]9102-PMOA01', 'estorno');
  if ks <> 'ALMOX/PMOA01/9102/Almoxarifado/CX[5][14]9102-PMOA01/S1' then
    raise exception 'FALHOU: chave do estorno veio %', ks;
  end if;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade)
  values (ks, 'estorno', 'PMOA01', '9102', 'Almoxarifado', 'caixa', 'CX[5][14]9102-PMOA01', 14);

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

-- 17. A ORDEM DO PAR: O ESTORNO NÃO É RESERVADO ENQUANTO A ENTRADA DELE NÃO ESTÁ `ok`. É a regra que
--     impede o ERP de receber a saída antes da entrada (estoque negativo, ou uma saída recusada), e
--     ela mora AQUI, na reserva, e não no laço de envio — o porquê está no ⚠️ do cabeçalho da
--     sf_estoque_reservar. As duas metades do teste são as duas metades da regra:
--       • a entrada em voo (uma rodada já tentou, a reserva venceu) sai; o estorno dela fica;
--       • e o estorno segurado NÃO paga tentativa — linha segurada não é linha que falhou. Se ela
--         pagasse, cinco rodadas de espera a tirariam da fila (tentativas < 5) sem nunca ter sido
--         enviada, que é o desastre que o teto existe pra evitar, chegando pelo lado errado.
do $t$
declare n int; v_chaves text[];
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;

  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, reservado_em)
  values ('PAR/E1', 'entrada', 'PMOT01', '9906', 'Almoxarifado', 'caixa', 'CX[1][3]9906-PMOT01', 3,
          now() - interval '10 minutes', 1, now() - interval '20 minutes'),
         ('PAR/S1', 'estorno', 'PMOT01', '9906', 'Almoxarifado', 'caixa', 'CX[1][3]9906-PMOT01', 3,
          now() - interval '5 minutes', 0, null);

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
--     (b) entrada CANCELADA também segura, pelo mesmo motivo literal (não está `ok`). Sob as regras
--         da sf_estoque_reverter isso não acontece (ela nunca cancela entrada que já tem estorno —
--         ver A ASSIMETRIA), então este caso é a rede pra quem afrouxar aquela regra depois;
--     (c) mas a entrada criada DEPOIS do estorno (o rebipe da caixa) NÃO é par dele e NÃO pode
--         segurá-lo: senão um rebipe que falha prende para sempre um estorno que já tinha a entrada
--         dele entregue.
do $t$
declare v_chaves text[];
begin
  update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, criado_em,
                                 tentativas, ok, enviado_em, cancelado_em)
  values ('TETO/E1', 'entrada', 'PMOT01', '9907', 'Almoxarifado', 'caixa', 'CX[1][3]9907-PMOT01', 3,
          now() - interval '10 minutes', 5, false, null, null),
         ('TETO/S1', 'estorno', 'PMOT01', '9907', 'Almoxarifado', 'caixa', 'CX[1][3]9907-PMOT01', 3,
          now() - interval '5 minutes', 0, false, null, null),
         ('CANC/E1', 'entrada', 'PMOT01', '9908', 'Almoxarifado', 'caixa', 'CX[1][3]9908-PMOT01', 3,
          now() - interval '10 minutes', 0, false, null, now()),
         ('CANC/S1', 'estorno', 'PMOT01', '9908', 'Almoxarifado', 'caixa', 'CX[1][3]9908-PMOT01', 3,
          now() - interval '5 minutes', 0, false, null, null),
         ('REB/E1', 'entrada', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '30 minutes', 1, true, now(), null),
         ('REB/S1', 'estorno', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '20 minutes', 0, false, null, null),
         ('REB/E2', 'entrada', 'PMOT01', '9909', 'Almoxarifado', 'caixa', 'CX[1][3]9909-PMOT01', 3,
          now() - interval '10 minutes', 0, false, null, null);

  select array_agg(r.chave order by r.chave) into v_chaves from sf_estoque_reservar(100) r;
  -- só o rebipe pendente e o estorno já pareado: os dois estornos presos (teto e cancelada) ficam
  if v_chaves is distinct from array['REB/E2', 'REB/S1'] then
    raise exception 'FALHOU: as bordas da ordem do par não bateram, veio %', v_chaves;
  end if;
  raise notice 'bordas da ordem do par (teto, cancelada, rebipe posterior): ok';
end $t$;

select 'ESTOQUE ENVIOS SQL OK' as fim;
