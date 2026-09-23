-- Testes SQL da 0123 (avisar num canal do Discord). Rodar com supabase/tests/rodar-alertas-test.sh:
-- roda DEPOIS de alertas_reabertura_test.sql, na mesma base, com a 0123 aplicada por cima de tudo —
-- igual à produção, onde alerta_envios já está cheia de linhas de pessoa. Os helpers (teste_regra,
-- teste_bipes, teste_contas_ana_bruno) vêm dos arquivos anteriores.
--
-- Cobre os casos 7 a 10 da seção "Testes" da spec (o 11, front, está em regra-form.test.tsx):
--   7.  avisar_canal enfileira UMA linha de canal por ocorrência, com qualquer número de responsáveis;
--   8.  os dois ligados enfileiram as duas coisas; avisar_pessoas = false não enfileira pessoa;
--   9.  a reserva devolve linhas de canal (não são descartadas por falta de conta vinculada);
--   10. validação: avisar_canal sem 'discord' nos canais é recusado; os dois desligados também.
--
-- Mais o que a spec chama de risco: a migração é aditiva e os envios de PESSOA continuam sendo
-- enfileirados e reservados exatamente como antes.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- O id do canal do sistema é o literal 'C0000000001' em todo o arquivo (no app vem de
-- DISCORD_CANAL_ID e é passado em alerta_avaliar). Nada de variável do psql: ela não seria
-- interpolada dentro dos corpos dollar-quoted dos blocos `do`.

-- ---------- T0. A migração é aditiva: o que já existia continua de pé ----------
do $t$
begin
  -- Toda regra que já existia avisa as pessoas, e nenhuma avisa canal.
  if exists (select 1 from alerta_regras where not avisar_pessoas or avisar_canal) then
    raise exception 'FALHOU: regra antiga mudou de comportamento';
  end if;
  -- Toda linha da fila que já existia é de pessoa, com usuário.
  if exists (select 1 from alerta_envios where destino_tipo <> 'usuario' or usuario_id is null) then
    raise exception 'FALHOU: linha antiga da fila não ficou como envio de pessoa';
  end if;
  if exists (select 1 from alerta_envios where destino_externo_id is not null) then
    raise exception 'FALHOU: linha antiga da fila ganhou endereço de canal';
  end if;
  -- usuario_id deixou de ser obrigatório (é o que permite a linha de canal).
  if (select is_nullable from information_schema.columns
       where table_name = 'alerta_envios' and column_name = 'usuario_id') <> 'YES' then
    raise exception 'FALHOU: alerta_envios.usuario_id continua not null';
  end if;
end $t$;

-- Preparação: o que as suítes anteriores deixaram ligado sai do caminho e a fila antiga "desiste".
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- T1. CASO 10: validação no banco ----------
do $t$
declare v_id uuid;
begin
  -- avisar_canal sem 'discord' nos canais: o canal é DO Discord.
  begin
    insert into alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                               canais, destinatarios, avisar_canal)
    values ('Canal sem discord', array['X'], 90, 'tempo', 60, 10, array['telegram'],
            array['00000000-0000-0000-0000-000000000001']::uuid[], true);
    raise exception 'FALHOU: aceitou avisar_canal sem discord nos canais';
  exception when check_violation then
    null;
  end;

  -- Os dois desligados: a regra não avisaria ninguém.
  begin
    insert into alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                               canais, destinatarios, avisar_pessoas, avisar_canal)
    values ('Canal muda', array['X'], 90, 'tempo', 60, 10, array['discord'],
            array['00000000-0000-0000-0000-000000000001']::uuid[], false, false);
    raise exception 'FALHOU: aceitou regra que não avisa ninguém';
  exception when check_violation then
    null;
  end;

  -- Só no canal (pessoas desligadas) é VÁLIDO: os responsáveis continuam podendo encerrar.
  insert into alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                             canais, destinatarios, avisar_pessoas, avisar_canal, ativa)
  values ('Canal valido', array['X'], 90, 'tempo', 60, 10, array['discord'],
          array['00000000-0000-0000-0000-000000000001']::uuid[], false, true, false)
  returning id into v_id;
  -- Tirar o discord de uma regra que avisa no canal também é recusado.
  begin
    update alerta_regras set canais = array['telegram'] where id = v_id;
    raise exception 'FALHOU: deixou tirar o discord de uma regra que avisa no canal';
  exception when check_violation then
    null;
  end;
end $t$;

-- Linha de canal sem endereço, ou de pessoa sem usuário: o check de coerência recusa.
set role service_role;
do $t$
begin
  begin
    insert into alerta_envios (usuario_id, canal, tipo, destino_tipo)
    values (null, 'discord', 'resolvido', 'canal');
    raise exception 'FALHOU: aceitou linha de canal sem endereço';
  exception when check_violation then
    null;
  end;
  begin
    insert into alerta_envios (usuario_id, canal, tipo, destino_tipo)
    values (null, 'discord', 'resolvido', 'usuario');
    raise exception 'FALHOU: aceitou envio de pessoa sem usuário';
  exception when check_violation then
    null;
  end;
end $t$;
reset role;

-- ---------- T2. CASOS 7 e 8: pessoas e/ou canal ----------
-- Dois responsáveis (Ana e Bruno), Telegram + Discord. 15 aprovados + 5 reprovados = 75% < 90.
select public.teste_bipes('C-Ambos', 'PMOA', '1', 15, 5, 10);
select public.teste_bipes('C-Soh',   'PMOA', '1', 15, 5, 10);
select public.teste_bipes('C-Sem',   'PMOA', '1', 15, 5, 10);
do $t$
begin
  -- os dois ligados
  perform teste_regra('Canal ambos', 'aprovacao', array['C-Ambos'], 90, 'tempo', 60, 10, null, null, null);
  -- só no canal
  perform teste_regra('Canal so',    'aprovacao', array['C-Soh'],   90, 'tempo', 60, 10, null, null, null);
  -- nenhum canal (o comportamento de hoje, para comparar)
  perform teste_regra('Canal sem',   'aprovacao', array['C-Sem'],   90, 'tempo', 60, 10, null, null, null);
end $t$;
update public.alerta_regras set avisar_canal = true                          where nome = 'Canal ambos';
update public.alerta_regras set avisar_canal = true, avisar_pessoas = false   where nome = 'Canal so';

-- Quantas linhas cada regra pôs na fila, por tipo de destino.
create or replace function public.teste_destinos(p_regra text, p_posto text)
returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  select jsonb_build_object(
           'pessoas', count(*) filter (where e.destino_tipo = 'usuario'),
           'canais',  count(*) filter (where e.destino_tipo = 'canal'),
           'canal_endereco', min(e.destino_externo_id) filter (where e.destino_tipo = 'canal'),
           'canal_usuario_nulo', bool_and(e.usuario_id is null) filter (where e.destino_tipo = 'canal'),
           'canal_com_botao', bool_and(e.com_botao) filter (where e.destino_tipo = 'canal'),
           'canal_texto_igual', bool_and(e.dados = (select e2.dados from alerta_envios e2
                                                     where e2.ocorrencia_id = e.ocorrencia_id
                                                       and e2.criado_em = now()
                                                       and e2.destino_tipo = 'usuario' limit 1))
                                filter (where e.destino_tipo = 'canal'))
    into v
    from alerta_envios e
    join alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join alerta_regras rg on rg.id = oc.regra_id
   where e.criado_em = now() and rg.nome = p_regra and oc.posto = p_posto;
  return v;
end
$f$;

set role service_role;
do $t$
declare a jsonb; b jsonb; c jsonb;
begin
  perform alerta_avaliar('C0000000001');
  a := teste_destinos('Canal ambos', 'C-Ambos');
  b := teste_destinos('Canal so',    'C-Soh');
  c := teste_destinos('Canal sem',   'C-Sem');

  -- CASO 8: os dois ligados enfileiram as duas coisas.
  if (a->>'pessoas')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: pessoas da regra com os dois ligados %', a;
  end if;
  -- CASO 7: UMA linha de canal, mesmo com 2 responsáveis x 2 canais vinculados.
  if (a->>'canais')::int <> 1 then raise exception 'FALHOU: devia ser 1 linha de canal %', a; end if;
  if a->>'canal_endereco' <> 'C0000000001' then raise exception 'FALHOU: endereço do canal %', a; end if;
  if (a->>'canal_usuario_nulo')::boolean is not true then
    raise exception 'FALHOU: linha de canal com usuário %', a;
  end if;
  if (a->>'canal_com_botao')::boolean is not true then
    raise exception 'FALHOU: alerta no canal sem o botão Resolvido %', a;
  end if;
  -- O texto do canal é o mesmo do privado.
  if (a->>'canal_texto_igual')::boolean is not true then
    raise exception 'FALHOU: dados do canal diferentes do privado %', a;
  end if;

  -- CASO 8: avisar_pessoas = false não enfileira nenhuma linha de pessoa.
  if (b->>'pessoas')::int <> 0 then raise exception 'FALHOU: "só no canal" avisou no privado %', b; end if;
  if (b->>'canais')::int <> 1 then raise exception 'FALHOU: "só no canal" sem linha de canal %', b; end if;

  -- Regra sem canal: exatamente o comportamento de antes da 0123.
  if (c->>'pessoas')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: regra sem canal mudou o fan-out de pessoa %', c;
  end if;
  if coalesce((c->>'canais')::int, 0) <> 0 then raise exception 'FALHOU: regra sem canal enfileirou canal %', c; end if;
end $t$;
reset role;

-- ---------- T3. Sem o id do canal (DISCORD_CANAL_ID vazio), nada de canal é enfileirado ----------
-- A pessoa continua sendo avisada; nada fica pendente à espera de configuração.
update public.alerta_ocorrencias oc
   set ultimo_envio_em = now() - interval '1 hour'
  from public.alerta_regras rg
 where rg.id = oc.regra_id and rg.nome in ('Canal ambos', 'Canal so');
update public.alerta_regras set lembrete_min = 10 where nome in ('Canal ambos', 'Canal so');
set role service_role;
do $t$
declare a jsonb; b jsonb;
begin
  perform alerta_avaliar();   -- sem parâmetro = ambiente sem canal
  a := teste_destinos('Canal ambos', 'C-Ambos');
  b := teste_destinos('Canal so',    'C-Soh');
  if coalesce((a->>'canais')::int, 0) <> 0 then
    raise exception 'FALHOU: enfileirou canal sem o id do canal %', a;
  end if;
  if (a->>'pessoas')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: sem canal configurado o privado devia continuar %', a;
  end if;
  -- "Só no canal" sem canal configurado simplesmente não avisa ninguém nesta rodada.
  if coalesce((b->>'pessoas')::int, 0) <> 0 or coalesce((b->>'canais')::int, 0) <> 0 then
    raise exception 'FALHOU: "só no canal" sem canal configurado enfileirou algo %', b;
  end if;
end $t$;
reset role;

-- ---------- T4. CASO 9: a reserva devolve as linhas de canal ----------
-- Antes da 0123 o join com alerta_contas era INNER: uma linha de canal nunca seria reservada e
-- ficaria pendente até expirar em 24 h.
set role service_role;
create temp table t_reserva as
  select * from alerta_reservar_envios(array['telegram', 'discord'], 100);
reset role;
do $t$
declare v_canal int; v_pessoa int; v_end text;
begin
  select count(*) filter (where destino_tipo = 'canal'),
         count(*) filter (where destino_tipo = 'usuario'),
         min(externo_id) filter (where destino_tipo = 'canal')
    into v_canal, v_pessoa, v_end
    from t_reserva;
  if v_canal = 0 then raise exception 'FALHOU: a reserva não devolveu nenhuma linha de canal'; end if;
  if v_end <> 'C0000000001' then raise exception 'FALHOU: endereço da linha de canal reservada = %', v_end; end if;
  -- Os envios de pessoa continuam sendo entregues exatamente como antes.
  if v_pessoa = 0 then raise exception 'FALHOU: a reserva parou de devolver envios de pessoa'; end if;
  -- Linha de canal não tem usuário, e ninguém reclamou de conta vinculada.
  if exists (select 1 from t_reserva where destino_tipo = 'canal' and usuario_id is not null) then
    raise exception 'FALHOU: linha de canal reservada com usuário';
  end if;
  -- Nenhuma linha de pessoa veio sem endereço (era o que o join inner garantia).
  if exists (select 1 from t_reserva where destino_tipo = 'usuario' and coalesce(externo_id, '') = '') then
    raise exception 'FALHOU: envio de pessoa reservado sem endereço';
  end if;
end $t$;
drop table t_reserva;

-- A régua de pessoa continua valendo: quem não tem conta vinculada nunca é reservado, mesmo agora
-- que os joins são LEFT. (Carla tem Telegram mas não administra o ShopFloor; Zeca está inativo.)
set role service_role;
do $t$
begin
  insert into alerta_envios (usuario_id, canal, tipo, dados, destino_tipo)
  values ('00000000-0000-0000-0000-000000000003', 'discord', 'resolvido',
          jsonb_build_object('posto', 'C-Sem'), 'usuario');   -- Carla: sem conta no Discord
  if exists (select 1 from alerta_reservar_envios(array['telegram', 'discord'], 100)
              where usuario_id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'FALHOU: reservou envio de quem não tem conta vinculada no canal';
  end if;
end $t$;
reset role;

-- ---------- T5. O "resolvido por X" respeita avisar_pessoas ----------
-- Numa regra que avisa SÓ no canal, ninguém recebeu o alerta no privado: mandar só o "resolvido"
-- no privado seria mensagem solta. No canal, o próprio clique edita a mensagem.
set role authenticated;
do $t$
declare r jsonb;
begin
  select alerta_resolver_admin(oc.id) into r
    from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Canal so' and oc.estado = 'aberta';
  if r is null or (r->>'ja_resolvida')::boolean then raise exception 'FALHOU: resolver "só no canal" %', r; end if;
  if exists (select 1 from alerta_envios e
              where e.ocorrencia_id = (r->>'ocorrencia_id')::uuid and e.tipo = 'resolvido') then
    raise exception 'FALHOU: "só no canal" mandou o resolvido no privado';
  end if;
end $t$;
reset role;

-- Regra que avisa as pessoas continua avisando o resolvido, como sempre.
set role authenticated;
do $t$
declare r jsonb;
begin
  select alerta_resolver_admin(oc.id) into r
    from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Canal ambos' and oc.estado = 'aberta';
  if not exists (select 1 from alerta_envios e
                  where e.ocorrencia_id = (r->>'ocorrencia_id')::uuid and e.tipo = 'resolvido'
                    and e.destino_tipo = 'usuario') then
    raise exception 'FALHOU: regra com avisar_pessoas parou de avisar o resolvido %', r;
  end if;
end $t$;
reset role;
