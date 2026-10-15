-- Teste do TETO DE IDADE (3 dias) do aviso de fim de EMB (0150, copiado na 0151).
-- Rodado PELO RUNNER duas vezes: apos a 0150 e apos a 0151 (em producao a funcao viva e a da 0151,
-- que reproduz o corpo inteiro: a copia do teto la tambem precisa de prova). O runner troca @P@ por
-- um sufixo por passada (massa de teste propria) e limpa tudo no fim; nenhuma funcao vaza.
-- Variaveis do psql: run_ab (T11a/b) e run_c (T11c), 1 ou 0 — permitem provar cada caso SOZINHO.
--
-- Por que o piso criado_em nao bastava: regra reativada apos semanas, ou sem ninguem alcancavel por
-- dias, tinha toda EMB fechada desde a criacao avisada de uma vez (a marca so nasce quando algo
-- entra na fila). EMB fechada ha mais de 3 dias nao avisa e nao e marcada.
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

create function public.teto_regra(p_nome text, p_dest uuid[], p_criado_em timestamptz)
returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, minimo_bipes, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por, criado_em)
  values (p_nome, 'emb', 'recebimento', '{}'::text[], 'op', null, null, array['telegram'],
          p_dest, true, false, true, '00000000-0000-0000-0000-000000000001', p_criado_em)
  returning id
$f$;

-- Item de EMB aprovado com divergencia, fechado ha p_intervalo.
create function public.teto_emb(p_emb text, p_item text, p_intervalo interval) returns void language sql as $f$
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     divergencia, status, resultado, divergencia_justificativa, divergencia_justificada_por_nome,
     created_at, finalizado_em)
  values (p_emb, p_item, 'CAPACITOR ' || p_item, 10, 9, '-1', 'Aprovado', 'Aprovado', '', '',
          now() - p_intervalo - interval '1 day', now() - p_intervalo)
$f$;

create function public.teto_envios(p_regra text, p_emb text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'emb' and dados->>'regra_nome' = p_regra and dados->>'emb' = upper(btrim(p_emb))
$f$;

create function public.teto_marca(p_regra text, p_emb text) returns boolean language sql as $f$
  select exists (select 1 from public.alerta_emb_avisada a
                   join public.alerta_regras rg on rg.id = a.regra_id
                  where rg.nome = p_regra and a.emb = upper(btrim(p_emb)))
$f$;

create function public.teto_avaliar() returns void language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
end $f$;

\if :run_ab
-- (a) + (b): regra alcancavel criada ha 10 dias; EMB de 4 dias NAO avisa e NAO marca; EMB de 2 dias
-- avisa e marca (controle positivo no mesmo teste: nao passa por "nao fazer nada").
select public.teto_regra('Teto 3 dias @P@', array['00000000-0000-0000-0000-0000000000b1']::uuid[], now() - interval '10 days');
select public.teto_emb('EMB810@P@', 'T-1', interval '4 days');
select public.teto_emb('EMB811@P@', 'T-2', interval '2 days');
do $t$
begin
  set local role service_role;
  perform public.teto_avaliar();
  reset role;
  if public.teto_envios('Teto 3 dias @P@', 'EMB810@P@') <> 0 then
    raise exception 'T11a FALHOU: EMB fechada ha 4 dias foi avisada (passou do teto)';
  end if;
  if public.teto_marca('Teto 3 dias @P@', 'EMB810@P@') then
    raise exception 'T11a FALHOU: EMB fora do teto recebeu marca';
  end if;
  if public.teto_envios('Teto 3 dias @P@', 'EMB811@P@') <> 1 then
    raise exception 'T11b FALHOU: EMB fechada ha 2 dias nao foi avisada (controle positivo)';
  end if;
  if not public.teto_marca('Teto 3 dias @P@', 'EMB811@P@') then
    raise exception 'T11b FALHOU: EMB dentro do teto nao foi marcada';
  end if;
end $t$;
\echo 'T11a/b @P@ (teto de 3 dias: 4 dias nao avisa, 2 dias avisa): ok'
\endif

\if :run_c
-- (c) a regra "travada": ninguem alcancavel (Dora, sem conta) enquanto uma EMB de 5 dias e uma de
-- ontem fecham; depois a regra passa a ter quem receba (Beto). A velha continua sem aviso; a de
-- ontem avisa.
select public.teto_regra('Teto travada @P@', array['00000000-0000-0000-0000-0000000000b2']::uuid[], now() - interval '10 days');
select public.teto_emb('EMB820@P@', 'T-3', interval '5 days');
select public.teto_emb('EMB821@P@', 'T-4', interval '1 day');
do $t$
begin
  set local role service_role;
  perform public.teto_avaliar();
  reset role;
  if public.teto_envios('Teto travada @P@', 'EMB820@P@') + public.teto_envios('Teto travada @P@', 'EMB821@P@') <> 0 then
    raise exception 'T11c FALHOU: enfileirou enquanto ninguem era alcancavel';
  end if;
  update public.alerta_regras set destinatarios = array['00000000-0000-0000-0000-0000000000b1']::uuid[]
   where nome = 'Teto travada @P@';
  set local role service_role;
  perform public.teto_avaliar();
  reset role;
  if public.teto_envios('Teto travada @P@', 'EMB820@P@') <> 0 or public.teto_marca('Teto travada @P@', 'EMB820@P@') then
    raise exception 'T11c FALHOU: a EMB de 5 dias foi avisada/marcada quando a regra voltou a alcancar';
  end if;
  if public.teto_envios('Teto travada @P@', 'EMB821@P@') <> 1 then
    raise exception 'T11c FALHOU: a EMB de ontem nao foi avisada quando a regra voltou a alcancar';
  end if;
end $t$;
\echo 'T11c @P@ (regra travada que volta a alcancar: so a recente avisa): ok'
\endif

-- Limpeza: nada desta passada fica para a proxima.
delete from public.alerta_envios where tipo = 'emb' and dados->>'regra_nome' like '%@P@';
delete from public.alerta_emb_avisada where regra_id in (select id from public.alerta_regras where nome like 'Teto % @P@');
delete from public.alerta_regras where nome like 'Teto % @P@';
delete from public.processos_recebimento where numero_emb like 'EMB8__@P@';
drop function public.teto_regra(text, uuid[], timestamptz);
drop function public.teto_emb(text, text, interval);
drop function public.teto_envios(text, text);
drop function public.teto_marca(text, text);
drop function public.teto_avaliar();
