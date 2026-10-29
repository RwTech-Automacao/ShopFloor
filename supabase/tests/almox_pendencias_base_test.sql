-- Testes da 0167, lado das pendências: os TRÊS pares base + casca — sf_almox_pendencias_base(),
-- sf_almox_necessidades_base() e sf_almox_lotes_base() (sem checar permissão, para o cron do alerta de
-- parado, que roda como serviço sem auth.uid()) e as três públicas virando cascas com o gate de antes.
-- Roda no rodar-almoxarifado-test.sh com PLACAS=1 (rodar-placas-almoxarifado-test.sh), DEPOIS da suíte
-- inteira do almoxarifado e do placas_almoxarifado_test.sql, na mesma base: reaproveita a massa toda
-- (caixas coletivas, lotes do NQA, peças avulsas), os postos e os atalhos teste_reg/teste_op_postos.
-- Antes de aplicar a 0167, o runner guarda a saída da pública ANTIGA (a da 0165) em `pend_antes`.
--
-- O que prova:
--   (b) a pública, com permissão, devolve EXATAMENTE as linhas de antes nas 10 colunas do contrato; e
--       as públicas sf_almox_necessidades/sf_almox_lotes também (pela foto antes x depois do runner);
--   (a) como o cron (service_role, sem usuário nem permissão) a CADEIA inteira roda: a pendencias_base
--       devolve as linhas (inclusive caixa e lote, que passam pelas outras duas _base) e as três
--       públicas levantam SEM_PERMISSAO;
--   (c) `posto` é o posto Almoxarifado da ROTA nas três espécies de linha (caixa, lote, peça), inclusive
--       com um posto de almoxarifado de outro nome;
--   (d) nas avulsas, `em_mais_antiga` é o min e `em` continua o max; nas outras duas, são iguais;
--   (e) anon/authenticated não executam nenhuma _base; as públicas seguem de authenticated.

\set ON_ERROR_STOP on
select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $f$;

-- ---------- (b) o contrato da pública não mudou ----------
do $t$
declare n_antes int; n_agora int; so_agora int; so_antes int;
begin
  select count(*) into n_antes from pend_antes;
  select count(*) into n_agora from public.sf_almox_pendencias();
  perform pg_temp.confere(n_antes > 0, '(b) pend_antes vazia: o teste nao compararia nada');
  select count(*) into so_agora from ((select * from public.sf_almox_pendencias()) except all
                                      (select * from pend_antes)) x;
  select count(*) into so_antes from ((select * from pend_antes) except all
                                      (select * from public.sf_almox_pendencias())) y;
  perform pg_temp.confere(n_antes = n_agora and so_agora = 0 and so_antes = 0,
    format('(b) publica mudou: antes %s, agora %s, so agora %s, so antes %s', n_antes, n_agora, so_agora, so_antes));
  -- E a casca é a base nas 10 primeiras colunas.
  select count(*) into so_agora from (
    (select b.pmo, b.op, b.tipo, b.codigo, b.seq, b.pecas, b.lote_id, b.amostra, b.ja_lancadas, b.em
       from public.sf_almox_pendencias_base() b)
    except all (select * from public.sf_almox_pendencias())) z;
  perform pg_temp.confere(so_agora = 0, '(b) a base difere da publica nas colunas do contrato');
  raise notice '(b) publica identica a de antes (% linhas): ok', n_antes;
end $t$;

-- (b) as outras duas públicas: a foto do runner (foto_pre0167 x foto_pos0167) lê necessidades e lotes
-- de toda OP da massa. O runner já exige as fotos idênticas; aqui, que essas fontes NÃO estão vazias
-- (senão a igualdade não diria nada) e que batem fonte a fonte.
do $t$
declare v_fonte text; n int; d int;
begin
  foreach v_fonte in array array['necessidades', 'lotes'] loop
    select count(*) into n from foto_pre0167 where fonte = v_fonte;
    select count(*) into d from (
      (select * from foto_pos0167 where fonte = v_fonte) except all (select * from foto_pre0167 where fonte = v_fonte)
      union all
      ((select * from foto_pre0167 where fonte = v_fonte) except all (select * from foto_pos0167 where fonte = v_fonte))) x;
    perform pg_temp.confere(n > 0 and d = 0, format('(b) %s: %s linhas antes, %s diferentes', v_fonte, n, d));
  end loop;
  raise notice '(b) sf_almox_necessidades e sf_almox_lotes identicas as de antes: ok';
end $t$;

-- ---------- (a) o cron: service_role, sem permissão nenhuma ----------
do $t$
declare n_base int; n_pub int; v_erro text; v_erro_nec text; v_erro_lot text;
        n_caixa int; n_lote int; n_nec int; n_lot int;
        v_col record; v_ind record;
begin
  select count(*) into n_pub from public.sf_almox_pendencias();
  -- Uma OP coletiva com caixa pendente e uma individual com lote pendente, para chamar as _base direto.
  select pmo, op into v_col from public.sf_almox_pendencias() where tipo = 'caixa' order by pmo, op limit 1;
  select pmo, op into v_ind from public.sf_almox_pendencias() where tipo = 'lote' order by pmo, op limit 1;
  perform set_config('teste.perms', '', true);
  perform set_config('teste.uid', '', true);
  set local role service_role;
  select count(*), count(*) filter (where tipo = 'caixa'), count(*) filter (where tipo = 'lote')
    into n_base, n_caixa, n_lote from public.sf_almox_pendencias_base();
  select count(*) into n_nec from public.sf_almox_necessidades_base(v_col.pmo, v_col.op);
  select count(*) into n_lot from public.sf_almox_lotes_base(v_ind.pmo, v_ind.op);
  reset role;
  -- As públicas não são do service_role (grant só para authenticated). Quem as chama é um usuário
  -- logado: SEM permissão, as três recusam com o gate de antes.
  set local role authenticated;
  begin
    perform * from public.sf_almox_pendencias();
    v_erro := 'nenhum';
  exception when raise_exception then
    v_erro := sqlerrm;
  end;
  begin
    perform * from public.sf_almox_necessidades(v_col.pmo, v_col.op);
    v_erro_nec := 'nenhum';
  exception when raise_exception then
    v_erro_nec := sqlerrm;
  end;
  begin
    perform * from public.sf_almox_lotes(v_ind.pmo, v_ind.op);
    v_erro_lot := 'nenhum';
  exception when raise_exception then
    v_erro_lot := sqlerrm;
  end;
  reset role;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', true);
  perform pg_temp.confere(n_base = n_pub and n_base > 0,
    format('(a) base como service_role devolveu %s linhas (publica com permissao: %s)', n_base, n_pub));
  perform pg_temp.confere(n_caixa > 0 and n_lote > 0,
    format('(a) a cadeia nao passou por caixa (%s) e lote (%s)', n_caixa, n_lote));
  perform pg_temp.confere(n_nec > 0 and n_lot > 0,
    format('(a) _base direto como service_role: necessidades %s, lotes %s', n_nec, n_lot));
  perform pg_temp.confere(v_erro = 'SEM_PERMISSAO', format('(a) pendencias publica sem permissao: erro %s', v_erro));
  perform pg_temp.confere(v_erro_nec = 'SEM_PERMISSAO', format('(a) necessidades publica sem permissao: erro %s', v_erro_nec));
  perform pg_temp.confere(v_erro_lot = 'SEM_PERMISSAO', format('(a) lotes publica sem permissao: erro %s', v_erro_lot));
  raise notice '(a) a cadeia das tres _base roda sem permissao e as tres publicas recusam: ok';
end $t$;

-- ---------- massa própria: OP individual com almoxarifado de outro nome ----------
-- Três SNs esperando na Embalagem com horas diferentes (o min e o max das avulsas) e um quarto, mais
-- velho, já lançado no 'Almoxarifado B' — ele não pode puxar o min para baixo.
insert into public.sf_postos (chave, ordem, perfil)
select 'Almoxarifado B', 99, perfil from public.sf_postos where chave = 'Almoxarifado';
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual)
values ('PMOB01', '9601', 'Cliente B', '9600', '9700', true);
do $t$
declare v_t timestamptz := date_trunc('second', now()) - interval '5 hours';
begin
  perform public.teste_op_postos('PMOB01', '9601', array['Embalagem', 'Almoxarifado B']);
  perform public.teste_reg('PMOB01', '9601', 'Embalagem', '9600', '', '', v_t);
  perform public.teste_reg('PMOB01', '9601', 'Almoxarifado B', '9600', '', '', v_t + interval '10 minutes');
  perform public.teste_reg('PMOB01', '9601', 'Embalagem', '9601', '', '', v_t + interval '1 hour');
  perform public.teste_reg('PMOB01', '9601', 'Embalagem', '9602', '', '', v_t + interval '2 hours');
  perform public.teste_reg('PMOB01', '9601', 'Embalagem', '9603', '', '', v_t + interval '3 hours');
end $t$;

-- ---------- (c) o posto é o Almoxarifado da rota ----------
do $t$
declare n_errado int; v_tipos text[]; v_postos text[];
begin
  select count(*) into n_errado
    from public.sf_almox_pendencias_base() b
    join public.sf_ordens o on o.pmo = b.pmo and o.op = b.op
   where b.posto is distinct from (
           select opp.posto from public.sf_ordem_postos opp
             join public.sf_postos po on po.chave = opp.posto
             join public.sf_posto_perfis pe on pe.chave = po.perfil
            where opp.ordem_id = o.id and pe.recurso = 'almoxarifado'
            order by opp.ordem, opp.posto limit 1);
  perform pg_temp.confere(n_errado = 0, format('(c) %s linhas com posto diferente do da rota', n_errado));
  select array_agg(distinct b.tipo order by b.tipo), array_agg(distinct b.posto order by b.posto)
    into v_tipos, v_postos from public.sf_almox_pendencias_base() b;
  perform pg_temp.confere(v_tipos @> array['caixa', 'lote', 'peca'],
    format('(c) a massa nao tem as tres especies de linha: %s', v_tipos));
  perform pg_temp.confere(v_postos @> array['Almoxarifado', 'Almoxarifado B'],
    format('(c) postos devolvidos: %s', v_postos));
  perform pg_temp.confere(not exists (select 1 from public.sf_almox_pendencias_base() where posto is null),
    '(c) linha sem posto');
  raise notice '(c) posto Almoxarifado da rota nas tres especies (% ): ok', v_postos;
end $t$;

-- ---------- (d) em_mais_antiga = min nas avulsas; em segue o max ----------
do $t$
declare v record; v_t timestamptz;
begin
  select min(data_hora) into v_t from public.sf_registros where pmo = 'PMOB01' and op = '9601';
  select * into v from public.sf_almox_pendencias_base() b where b.pmo = 'PMOB01' and b.op = '9601';
  perform pg_temp.confere(v.tipo = 'peca' and v.codigo = 'AVULSAS' and v.pecas = 3 and v.posto = 'Almoxarifado B'
                          and v.em = v_t + interval '3 hours' and v.em_mais_antiga = v_t + interval '1 hour',
    format('(d) avulsas da PMOB01: %s', row_to_json(v)));
  perform pg_temp.confere(not exists (select 1 from public.sf_almox_pendencias_base()
                                       where tipo = 'peca' and em_mais_antiga > em),
    '(d) avulsa com em_mais_antiga depois de em');
  perform pg_temp.confere(not exists (select 1 from public.sf_almox_pendencias_base()
                                       where tipo in ('caixa', 'lote') and em_mais_antiga is distinct from em),
    '(d) caixa/lote com em_mais_antiga diferente de em');
  raise notice '(d) em_mais_antiga das avulsas e o min, em e o max: ok';
end $t$;

-- ---------- (e) grants ----------
do $t$
declare v_f text;
begin
  foreach v_f in array array['sf_almox_pendencias_base()', 'sf_almox_necessidades_base(text, text)',
                             'sf_almox_lotes_base(text, text)'] loop
    perform pg_temp.confere(not has_function_privilege('anon', 'public.' || v_f, 'execute'),
      '(e) anon executa ' || v_f);
    perform pg_temp.confere(not has_function_privilege('authenticated', 'public.' || v_f, 'execute'),
      '(e) authenticated executa ' || v_f);
    perform pg_temp.confere(has_function_privilege('service_role', 'public.' || v_f, 'execute'),
      '(e) service_role nao executa ' || v_f);
  end loop;
  foreach v_f in array array['sf_almox_pendencias()', 'sf_almox_necessidades(text, text)',
                             'sf_almox_lotes(text, text)'] loop
    perform pg_temp.confere(has_function_privilege('authenticated', 'public.' || v_f, 'execute')
                            and not has_function_privilege('anon', 'public.' || v_f, 'execute'),
      '(e) grants da publica mudaram: ' || v_f);
  end loop;
  raise notice '(e) as tres _base so para service_role; as publicas seguem de authenticated: ok';
end $t$;
