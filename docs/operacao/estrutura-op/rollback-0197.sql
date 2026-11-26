-- Rollback da 0197 (apontamento automático das PRTs por grupo, só OPs novas). Devolve as seis funções que a 0197
-- redefiniu ao texto anterior — sf_trecho_enfileirar e sf_trecho_desfazer (0194), sf_estoque_reservar (0132),
-- sf_estoque_enviado (0153), sf_resumo_trechos_op (0184) e sf_ordem_regravar_trechos (0195) — e apaga a sf_prt_agrupar,
-- a conclusão do grupo (trigger + função) e o CHECK sf_estoque_envios_grupo_coerente.
--
-- O app que chama a sf_prt_agrupar tem que sair ANTES (sem a função, o cron só loga a falha do agrupar e entrega o resto).
--
-- RECUSA (nada muda) se existir GRUPO enviado ou tocado (ok, ou tentado / com reserva viva e não cancelado): com a
-- reserva antiga as placas dele iriam ao Compels uma a uma (em dobro), e a soma antiga contaria grupo + placas. Isso só
-- acontece com COMPELS_PRT_LIGADO=1; aí o rollback é manual, grupo a grupo. Grupo ainda na fila e intocado é DESFEITO
-- (cancelado, placas soltas): com a reserva antiga elas voltam a sair uma a uma.
--
-- FICAM (inofensivos sem as funções novas, e o que impede a 0197 reaplicada de mexer de novo): sf_ordens.apontar_prt
-- (com os valores de hoje; a OP antiga continua false, mas o enfileirar antigo não a lê), sf_estoque_envios.grupo_id
-- (+ FK e índice) e o 'grupo_prt' no CHECK de tipo. As linhas de PRT canceladas na 0197 continuam canceladas.
--
-- ATENÇÃO, rollback seguido de REAPLICAÇÃO da 0197: entre os dois, o enfileirar antigo volta a pôr na fila as placas de
-- PRT das OPs antigas (apontar_prt = false). A 0197 reaplicada NÃO as cancela (o cancelamento só roda na primeira
-- aplicação, junto com a criação da coluna) e o agrupar não as pega (OP desligada): elas ficam paradas na fila. Para
-- ver e cancelar as intocadas à mão depois da reaplicação:
--   update sf_estoque_envios e set cancelado_em = now()
--    where e.ordem_id is not null and e.operacao = 'entrada' and not e.ok and e.cancelado_em is null
--      and e.tentativas = 0 and e.reservado_em is null and e.estornado = 0 and e.grupo_id is null
--      and exists (select 1 from sf_ordens o where o.id = e.ordem_id and not o.apontar_prt);
-- Idempotente: psql -1 -v ON_ERROR_STOP=1 -f docs/operacao/estrutura-op/rollback-0197.sql

do $rb$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sf_estoque_envios' and column_name = 'grupo_id') then
    if exists (select 1 from public.sf_estoque_envios g
                where g.tipo = 'grupo_prt' and g.cancelado_em is null
                  and (g.ok or g.tentativas > 0 or (g.reservado_em is not null and g.reservado_em >= now() - interval '15 minutes'))) then
      raise exception 'ROLLBACK_0197_GRUPO_ENVIADO: existe grupo de PRT enviado ou tocado; desfaça à mão (ver o cabeçalho)';
    end if;
    update public.sf_estoque_envios m set grupo_id = null
     where m.grupo_id in (select g.id from public.sf_estoque_envios g where g.tipo = 'grupo_prt' and not g.ok);
    update public.sf_estoque_envios g set cancelado_em = now()
     where g.tipo = 'grupo_prt' and not g.ok and g.cancelado_em is null;
  end if;
end $rb$;

drop trigger if exists sf_estoque_envios_grupo_concluir on public.sf_estoque_envios;
drop function if exists public.sf_estoque_grupo_concluir();
drop function if exists public.sf_prt_agrupar();
alter table public.sf_estoque_envios drop constraint if exists sf_estoque_envios_grupo_coerente;

-- ---------- sf_trecho_enfileirar e sf_trecho_desfazer: o texto da 0194 ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
begin
  if new.numero_serie_norm = '' or new.status ilike 'reprov%' then
    return new;
  end if;
  -- 0194: a linha da OP em KEY SHARE (só OP com trecho PRT) — espera a edição da OP (FOR UPDATE), não outro bipe
  perform 1 from public.sf_ordens o
   where o.pmo = new.pmo and o.op = new.op
     and exists (select 1 from public.sf_ordem_trechos ot where ot.ordem_id = o.id and ot.tipo = 'prt')
     for key share of o;
  for t in
    select ot.codigo, coalesce(ot.compels_op, '') as op_filha, ot.estoque, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = new.pmo and o.op = new.op and ot.posto_conclui = new.posto and ot.tipo = 'prt'
  loop
    perform pg_advisory_xact_lock(hashtext(t.ordem_id::text || '/' || t.codigo || '/' || new.numero_serie_norm));
    -- já existe entrada viva (não cancelada e com saldo — na fila ou enviada): reaprovação/rebipe não duplica.
    -- A que já foi estornada por inteiro (enviada ou tocada) não conta: a peça voltou e precisa de entrada nova.
    if exists (select 1 from public.sf_estoque_envios e
                where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = new.posto
                  and e.alvo = new.numero_serie_norm and e.operacao = 'entrada' and e.cancelado_em is null
                  and e.estornado < e.quantidade) then
      continue;
    end if;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id, criado_em)
    values
      (public.sf_trecho_chave(t.ordem_id, t.codigo, new.posto, new.numero_serie_norm, 'entrada'), 'entrada',
       t.codigo, t.op_filha, new.posto, 'serie', coalesce(nullif(new.numero_serie, ''), new.numero_serie_norm),
       new.numero_serie_norm, greatest(coalesce(new.pecas, 1), 1), t.estoque, t.ordem_id, clock_timestamp());
  end loop;
  return new;
end
$func$;
revoke all on function public.sf_trecho_enfileirar() from public, anon, authenticated;

create or replace function public.sf_trecho_desfazer()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_ent record;
  v_tocada boolean;
begin
  if old.numero_serie_norm = '' or old.status ilike 'reprov%' then
    return old;
  end if;
  -- 0194: a linha da OP em KEY SHARE (só OP com trecho PRT) — espera a edição da OP (FOR UPDATE), não outro bipe
  perform 1 from public.sf_ordens o
   where o.pmo = old.pmo and o.op = old.op
     and exists (select 1 from public.sf_ordem_trechos ot where ot.ordem_id = o.id and ot.tipo = 'prt')
     for key share of o;
  for t in
    select ot.codigo, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = old.pmo and o.op = old.op and ot.posto_conclui = old.posto and ot.tipo = 'prt'
  loop
    perform pg_advisory_xact_lock(hashtext(t.ordem_id::text || '/' || t.codigo || '/' || old.numero_serie_norm));
    -- outra aprovação da mesma peça no mesmo posto continua valendo: nada a desfazer
    if exists (select 1 from public.sf_registros r
                where r.pmo = old.pmo and r.op = old.op and r.posto = old.posto
                  and r.numero_serie_norm = old.numero_serie_norm and r.id <> old.id
                  and r.status not ilike 'reprov%') then
      continue;
    end if;
    -- a entrada VIGENTE da peça neste trecho (a mais recente ainda viva), travada: a mesma escolha da 0132 (seq_chave)
    select e.* into v_ent
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada'
       and e.cancelado_em is null and e.estornado < e.quantidade
     order by e.seq_chave desc nulls last, e.criado_em desc, e.id desc limit 1
     for update;
    if v_ent.id is null then
      continue;
    end if;
    -- LINHA TOCADA, exatamente como a sf_estoque_reverter (0132): uma rodada já a tentou (o ERP pode ter recebido
    -- com a resposta perdida), uma rodada a está entregando agora (reserva de 15 min) ou ela já teve estorno.
    v_tocada := v_ent.tentativas > 0
                or (v_ent.reservado_em is not null and v_ent.reservado_em >= now() - interval '15 minutes')
                or v_ent.estornado > 0;
    -- ainda na fila e ninguém mexeu → cancela (não se estorna o que não saiu)
    if not v_ent.ok and not v_tocada then
      update public.sf_estoque_envios set cancelado_em = now() where id = v_ent.id;
      continue;
    end if;
    -- enviada, ou tocada → estorno do saldo ligado à entrada (entrada_id) + baixa do saldo, na mesma transação.
    -- Na tocada a entrada segue na fila; a sf_estoque_reservar segura o estorno até ela estar ok.
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id, entrada_id, criado_em)
    values
      (public.sf_trecho_chave(t.ordem_id, v_ent.pmo, v_ent.posto, v_ent.alvo, 'estorno'), 'estorno',
       v_ent.pmo, v_ent.op, v_ent.posto, v_ent.tipo, v_ent.bipe, v_ent.serie_norm,
       v_ent.quantidade - v_ent.estornado, v_ent.estoque, t.ordem_id, v_ent.id, clock_timestamp());
    update public.sf_estoque_envios set estornado = quantidade where id = v_ent.id;
  end loop;
  return old;
end
$func$;
revoke all on function public.sf_trecho_desfazer() from public, anon, authenticated;

-- ---------- sf_estoque_reservar: o texto da 0132 ----------
create or replace function public.sf_estoque_reservar(p_limite int default 30)
returns table (id uuid, chave text, operacao text, pmo text, op text, posto text, tipo text,
               bipe text, serie_norm text, quantidade int, tentativas int, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  return query
    with alvo as (
      select e.id
        from public.sf_estoque_envios e
       where e.ok = false
         and e.cancelado_em is null
         and e.tentativas < 5
         and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
         and (e.adiado_ate is null or e.adiado_ate <= now())
         -- A ORDEM DO PAR (ver o ⚠️ acima): estorno só é elegível depois que A ENTRADA DELE virou
         -- `ok`. E a entrada dele não é inferida aqui: é a linha apontada pelo `entrada_id`, que a
         -- sf_estoque_reverter gravou com o id da entrada que ela travou e DEBITOU ao criar o estorno.
         -- Quem o estorno espera é, por construção, quem foi debitado por ele.
         --
         -- POR QUE O VÍNCULO É GRAVADO, e não recalculado aqui (a decisão inteira está junto da coluna
         -- `entrada_id`, lá em cima): este predicado já tentou DUAS formas de adivinhar o par, e as duas
         -- divergiram da reverter e prenderam a linha em silêncio.
         --   • "QUALQUER ANTERIOR NÃO-ok": o mesmo bipe tem várias entradas no histórico (E1 cancelada,
         --     E2 do rebipe, E3...) e uma entrada CANCELADA nunca vira `ok` (o check da tabela proíbe),
         --     então um ciclo JÁ ENCERRADO do bipe segurava o estorno do ciclo novo pra sempre.
         --   • "A VIGENTE ENTRE AS VIVAS CRIADAS ANTES DELE", com `criado_em <` ESTRITO: `criado_em` é
         --     `now()`, o instante da TRANSAÇÃO. Cancelar a caixa de uma linha tocada e rebipar na MESMA
         --     transação dá à E1 (que É o par, a debitada) o MESMO `criado_em` do estorno — e o estrito
         --     a excluía ANTES de o `ok` dela ser lido, então nem entregá-la soltava o estorno.
         -- Nos dois casos: tentativas = 0, sem `erro`, e a linha que bloqueava invisível na tela de
         -- pendências — o Compels ficaria com peças que o ShopFloor já removeu, sem nada acusar. Com o
         -- par gravado, não há mais o que divergir: a reverter escolhe UMA vez e escreve, e aqui só se
         -- lê o `ok` daquela linha. Não ponha `criado_em`, `order by` nem "vigente" aqui de novo.
         --
         -- E SE O `entrada_id` DE UM ESTORNO ESTIVER NULO? SEGURA — é o `coalesce(..., false)`, e a
         -- escolha é deliberada. Por construção não chega aqui (a sf_estoque_reverter é a única coisa
         -- que cria estorno e sempre preenche, e o CHECK
         -- sf_estoque_envios_entrada_id_so_no_estorno cobra isso na tabela), então só chega quem inserir
         -- à mão no SQL Editor depois de derrubar o check. As duas saídas são invisíveis sem a tela de
         -- pendências; o que difere é o que cada uma estraga. LIBERAR manda ao ERP uma saída de peça que
         -- ele nunca recebeu: estoque de menos lá, irreversível de cá, e ninguém sabendo — exatamente o
         -- que esta ordem existe pra evitar. SEGURAR deixa a linha parada e não estraga estoque nenhum,
         -- e é um erro que dá pra descobrir depois — a mesma escolha que o ⚠️ acima já faz pra entrada
         -- que chegou ao teto. Então segura. O mesmo vale pra entrada apontada que não está `ok` por
         -- estar CANCELADA (só alcançável afrouxando a ASSIMETRIA): `ok` é false, e segura.
         -- O que torna isso VISÍVEL é a tela de pendências (Task 5): "estorno pendente cuja entrada
         -- gravada não está `ok`" é esta mesma leitura, e é ela que transforma linha parada em item que
         -- alguém resolve.
         --
         -- CUSTO: um lookup por CHAVE PRIMÁRIA por estorno pendente, e nada mais — sem subconsulta
         -- ordenada, sem `seq_chave`, sem o rabo do índice que existia só pra servir esta ordem (ver
         -- sf_estoque_envios_alvo). Medido com `explain analyze` e `jit=off` (postgres:15, mesma massa
         -- pros dois: 80.950 linhas, 625 pendentes das quais 250 estornos): 2,15–2,35 ms contra
         -- 2,24–2,29 ms do predicado anterior (empate, e ele ainda precisava do rabo do índice), e
         -- 3,41–3,52 ms contra 18,3–18,5 ms na massa patológica (um bipe com 300 entradas no histórico e
         -- 500 estornos pendentes) — ~5x mais rápido justamente onde o anterior doía, porque ali ele
         -- reordenava as 300 entradas do bipe uma vez POR estorno pendente. Sem o rabo do índice, o
         -- anterior ia a 83 ms nessa massa; este predicado não muda com ou sem rabo (3,46–3,61 ms com
         -- ele), que é a razão de o rabo ter saído. A sf_estoque_reservar inteira (lote de 30) fecha em
         -- 8,0–8,2 ms na massa realista e 12,7–13,1 ms na patológica.
         and (e.operacao <> 'estorno'
              or coalesce((
                   select ent.ok
                     from public.sf_estoque_envios ent
                    where ent.id = e.entrada_id
                 ), false))
       order by (e.tentativas > 0), e.criado_em, e.id
       -- lote aparado: nulo cai no default, 0/negativo viram 1 e existe teto. Um lote gigante
       -- seguraria a reserva (e a rodada) por muito mais tempo do que a janela de 15 min cobre.
       limit least(greatest(coalesce(p_limite, 30), 1), 100)
       for update of e skip locked
    ),
    reservadas as (
      update public.sf_estoque_envios e
         set tentativas = e.tentativas + 1, reservado_em = now()
        from alvo
       where e.id = alvo.id
      returning e.id, e.chave, e.operacao, e.pmo, e.op, e.posto, e.tipo, e.bipe, e.serie_norm,
                e.quantidade, e.tentativas, e.criado_em
    )
    select r.id, r.chave, r.operacao, r.pmo, r.op, r.posto, r.tipo, r.bipe, r.serie_norm,
           r.quantidade, r.tentativas, r.criado_em
      from reservadas r
     order by (r.tentativas > 1), r.criado_em, r.id;
end
$func$;
revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated;
grant execute on function public.sf_estoque_reservar(int) to service_role;

-- ---------- sf_estoque_enviado: o texto da 0153 ----------
create or replace function public.sf_estoque_enviado(
  p_pmo text, p_op text, p_exceto uuid default null
) returns numeric
language sql
stable
security definer
set search_path = public
as $func$
  select coalesce(sum(case when e.operacao = 'estorno' then -e.quantidade else e.quantidade end), 0)
    from public.sf_estoque_envios e
   where e.pmo = p_pmo
     and e.op = p_op
     and e.ok
     and (p_exceto is null or e.id <> p_exceto)
$func$;
revoke all on function public.sf_estoque_enviado(text, text, uuid) from public, anon, authenticated;
grant execute on function public.sf_estoque_enviado(text, text, uuid) to service_role;

-- ---------- sf_resumo_trechos_op: o texto da 0184 ----------
create or replace function public.sf_resumo_trechos_op(p_pmo text, p_op text)
returns table (posto text, codigo text, compels_op text, apontadas int, na_fila int, motivo text)
language plpgsql stable security definer set search_path = public as $func$
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then raise exception 'sem permissão'; end if;
  return query
    select ot.posto_conclui, ot.codigo, ot.compels_op,
           coalesce((select sum(case when e.operacao = 'estorno' then -e.quantidade else e.quantidade end)
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.ok), 0)::int,
           coalesce((select sum(e.quantidade)
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
                        and not e.ok and e.cancelado_em is null), 0)::int,
           (select e.erro
              from public.sf_estoque_envios e
             where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
               and not e.ok and e.cancelado_em is null
             order by e.criado_em, e.id limit 1)
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = p_pmo and o.op = p_op and ot.tipo = 'prt'
     order by ot.seq;
end
$func$;
revoke all on function public.sf_resumo_trechos_op(text, text) from public, anon;
grant execute on function public.sf_resumo_trechos_op(text, text) to authenticated, service_role;

-- ---------- sf_ordem_regravar_trechos: o texto da 0195 ----------
create or replace function public.sf_ordem_regravar_trechos(
  p_ordem_id uuid, p_trechos jsonb, p_ordem jsonb, p_componentes jsonb, p_burnin jsonb
) returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo text; v_op text; v_status_antigo text; v_placas_antigo int;
  v_pmo_seq int;
  v_rep text;
  v_n int;
  v_almox text; v_almox_gravado text;
  v_entrada jsonb := case when jsonb_typeof(p_trechos) = 'array' then p_trechos else '[]'::jsonb end;
  v_o jsonb := case when jsonb_typeof(p_ordem) = 'object' then p_ordem else '{}'::jsonb end;
  v_comp jsonb := case when jsonb_typeof(p_componentes) = 'array' then p_componentes else '[]'::jsonb end;
  v_burn jsonb := case when jsonb_typeof(p_burnin) = 'array' then p_burnin else '[]'::jsonb end;
  v_t jsonb;  -- trechos: [{seq, codigo, tipo, sn_modo, sn_modo_antigo, conclui_antigo, postos[], faixas[]}]
  v_p jsonb;  -- rota nova: [{posto, seq, ord}]
  v_f jsonb;  -- faixas novas (PMO e PRT com série própria): [{seq, ord, sn_ini, sn_fim}], PMO primeiro
  v_status text; v_placas int; v_qtd int; v_cliente text;
  t record;
  v_hist boolean;
  v_postos_trecho text[];
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  -- as travas, na ordem do sf_lancar: advisory da OP, depois a linha (o trigger do bipe pega a linha em KEY SHARE)
  select o.pmo, o.op into v_pmo, v_op from sf_ordens o where o.id = p_ordem_id;
  if not found then raise exception 'OP_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);
  select o.status, o.placas_por_painel into v_status_antigo, v_placas_antigo
    from sf_ordens o where o.id = p_ordem_id and o.pmo = v_pmo and o.op = v_op for update;
  if not found then raise exception 'OP_INEXISTENTE'; end if; -- apagada ou trocada entre a leitura e a trava
  if not exists (select 1 from sf_ordem_trechos where ordem_id = p_ordem_id) then raise exception 'OP_SEM_TRECHOS'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';

  if jsonb_array_length(v_entrada) <> (select count(*) from sf_ordem_trechos where ordem_id = p_ordem_id)
     or (select count(distinct x->>'seq') from jsonb_array_elements(v_entrada) x) <> jsonb_array_length(v_entrada)
     or exists (select 1 from jsonb_array_elements(v_entrada) x
                 where not exists (select 1 from sf_ordem_trechos ot
                                    where ot.ordem_id = p_ordem_id and ot.seq::text = x->>'seq')) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;

  -- a entrada ligada ao trecho gravado
  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', ot.seq, 'codigo', ot.codigo, 'tipo', ot.tipo, 'sn_modo_antigo', ot.sn_modo, 'conclui_antigo', ot.posto_conclui,
           'sn_modo', case when ot.tipo = 'pmo' then 'mesmo' else coalesce(nullif(x->>'sn_modo', ''), ot.sn_modo) end,
           'postos', coalesce((select jsonb_agg(btrim(q.pp) order by q.o)
                                 from jsonb_array_elements_text(case when jsonb_typeof(x->'postos') = 'array' then x->'postos' else '[]'::jsonb end)
                                      with ordinality q(pp, o)
                                where btrim(q.pp) <> ''), '[]'::jsonb),
           'faixas', case when jsonb_typeof(x->'faixas') = 'array' then x->'faixas' else '[]'::jsonb end
         ) order by ot.seq), '[]'::jsonb)
    into v_t
    from sf_ordem_trechos ot join jsonb_array_elements(v_entrada) x on x->>'seq' = ot.seq::text
   where ot.ordem_id = p_ordem_id;

  select t2.codigo into v_rep
    from jsonb_to_recordset(v_t) t2(seq int, codigo text, sn_modo text)
   where t2.sn_modo not in ('mesmo', 'proprio') order by t2.seq limit 1;
  if v_rep is not null then raise exception 'SN_MODO_INVALIDO:%', v_rep; end if;

  select coalesce(jsonb_agg(jsonb_build_object('posto', p.posto, 'seq', t2.seq, 'ord', p.ord) order by t2.seq, p.ord), '[]'::jsonb)
    into v_p
    from jsonb_to_recordset(v_t) t2(seq int, postos jsonb), jsonb_array_elements_text(t2.postos) with ordinality p(posto, ord);

  select p.posto into v_rep from jsonb_to_recordset(v_p) p(posto text) group by p.posto having count(*) > 1 order by p.posto limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select t2.codigo into v_rep from jsonb_to_recordset(v_t) t2(seq int, codigo text, postos jsonb)
   where jsonb_array_length(t2.postos) = 0 order by t2.seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;

  -- Almoxarifado: um só, e só no fim do trecho da PMO; o que a rota gravada tinha não sai
  select count(*), min(p.posto) into v_n, v_almox
    from jsonb_to_recordset(v_p) p(posto text) join sf_postos s on s.chave = p.posto join sf_posto_perfis pf on pf.chave = s.perfil
   where pf.recurso = 'almoxarifado';
  if v_n > 1 then raise exception 'ALMOXARIFADO_REPETIDO'; end if;
  select op2.posto into v_almox_gravado
    from sf_ordem_postos op2 join sf_postos s on s.chave = op2.posto join sf_posto_perfis pf on pf.chave = s.perfil
   where op2.ordem_id = p_ordem_id and pf.recurso = 'almoxarifado' order by op2.ordem limit 1;
  if (v_almox is not null or v_almox_gravado is not null)
     and (select t2.postos->>(jsonb_array_length(t2.postos) - 1) from jsonb_to_recordset(v_t) t2(seq int, postos jsonb) where t2.seq = v_pmo_seq)
         is distinct from coalesce(v_almox, v_almox_gravado) then
    raise exception 'ALMOXARIFADO_FORA_DO_FIM';
  end if;

  -- faixas: as da PMO e as das PRTs com série própria (PRT 'mesmo' não tem faixa)
  -- `i` = a posição final (PMO primeiro, depois as PRTs na ordem) = o seq gravado em sf_ordem_faixas
  select coalesce(jsonb_agg(jsonb_build_object('i', z.i, 'seq', z.seq, 'ord', z.ord, 'sn_ini', z.sn_ini, 'sn_fim', z.sn_fim) order by z.i), '[]'::jsonb)
    into v_f
    from (select t2.seq, f.ord, btrim(coalesce(f.f->>'sn_ini', '')) as sn_ini, btrim(coalesce(f.f->>'sn_fim', '')) as sn_fim,
                 row_number() over (order by (t2.seq <> v_pmo_seq), t2.seq, f.ord) as i
            from jsonb_to_recordset(v_t) t2(seq int, tipo text, sn_modo text, faixas jsonb),
                 jsonb_array_elements(t2.faixas) with ordinality f(f, ord)
           where t2.tipo = 'pmo' or t2.sn_modo = 'proprio') z;
  select t2.codigo into v_rep from jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text)
   where (t2.tipo = 'pmo' or t2.sn_modo = 'proprio')
     and not exists (select 1 from jsonb_to_recordset(v_f) f(seq int) where f.seq = t2.seq)
   order by (t2.tipo <> 'pmo'), t2.seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  select t2.codigo into v_rep
    from jsonb_to_recordset(v_f) f(i int, seq int, sn_ini text, sn_fim text)
    join jsonb_to_recordset(v_t) t2(seq int, codigo text) on t2.seq = f.seq
   where not sf_faixa_coerente(f.sn_ini, f.sn_fim) order by f.i limit 1;
  if v_rep is not null then raise exception 'FAIXA_INVALIDA:%', v_rep; end if;
  select t2.codigo into v_rep
    from jsonb_to_recordset(v_f) a(i int, sn_ini text, sn_fim text)
    join jsonb_to_recordset(v_f) b(i int, seq int, sn_ini text, sn_fim text) on a.i < b.i
    join jsonb_to_recordset(v_t) t2(seq int, codigo text) on t2.seq = b.seq
   where sf_faixas_sobrepoem(a.sn_ini, a.sn_fim, b.sn_ini, b.sn_fim)
   order by b.i limit 1;
  if v_rep is not null then raise exception 'FAIXA_SOBREPOSTA:%', v_rep; end if;

  -- os dados da OP (as regras do editarOrdemAction)
  v_cliente := btrim(coalesce(v_o->>'cliente', ''));
  if v_cliente = '' then raise exception 'CLIENTE_VAZIO'; end if;
  if coalesce(v_o->>'qtd', '') !~ '^\d{0,9}$' then raise exception 'QTD_INVALIDA'; end if;
  v_qtd := nullif(v_o->>'qtd', '')::int;
  if coalesce(v_o->>'placas_por_painel', '') !~ '^\d{1,9}$' then raise exception 'PLACAS_INVALIDAS'; end if;
  v_placas := (v_o->>'placas_por_painel')::int;
  if v_placas < 1 then raise exception 'PLACAS_INVALIDAS'; end if;
  if v_placas <> v_placas_antigo and exists (select 1 from sf_registros r where r.pmo = v_pmo and r.op = v_op) then
    raise exception 'PLACAS_COM_REGISTROS';
  end if;
  v_status := coalesce(nullif(btrim(v_o->>'status'), ''), 'ATIVA');

  -- histórico 1: posto com registro na OP não troca de trecho
  select np.posto into v_rep
    from jsonb_to_recordset(v_p) np(posto text, seq int, ord int)
    join sf_ordem_postos op2 on op2.ordem_id = p_ordem_id and op2.posto = np.posto
   where coalesce(op2.trecho_seq, v_pmo_seq) <> np.seq
     and exists (select 1 from sf_registros r where r.pmo = v_pmo and r.op = v_op and r.posto = np.posto)
   order by np.seq, np.ord limit 1;
  if v_rep is not null then raise exception 'POSTO_COM_REGISTROS:%', v_rep; end if;

  -- histórico 2: PRT com fila/apontamento ou registro não troca o posto final nem a série; faixa mudada cobre os SNs usados
  for t in
    select t2.* from jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text, sn_modo_antigo text, conclui_antigo text, postos jsonb)
     where t2.tipo = 'prt' order by t2.seq
  loop
    v_postos_trecho := array(select op2.posto from sf_ordem_postos op2 where op2.ordem_id = p_ordem_id and op2.trecho_seq = t.seq)
                    || array(select jsonb_array_elements_text(t.postos));
    v_hist := exists (select 1 from sf_estoque_envios e
                       where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.cancelado_em is null)
           or exists (select 1 from sf_registros r
                       where r.pmo = v_pmo and r.op = v_op and r.posto = any (v_postos_trecho));
    continue when not v_hist;
    if t.postos->>(jsonb_array_length(t.postos) - 1) is distinct from t.conclui_antigo or t.sn_modo <> t.sn_modo_antigo then
      raise exception 'PRT_COM_HISTORICO:%', t.codigo;
    end if;
    continue when t.sn_modo <> 'proprio';
    -- só quando as faixas desta PRT mudaram
    continue when (select coalesce(jsonb_agg(jsonb_build_object('a', f.sn_ini, 'b', f.sn_fim) order by f.ord), '[]'::jsonb)
                     from jsonb_to_recordset(v_f) f(seq int, ord int, sn_ini text, sn_fim text) where f.seq = t.seq)
                = (select coalesce(jsonb_agg(jsonb_build_object('a', f.sn_ini, 'b', f.sn_fim) order by f.seq), '[]'::jsonb)
                     from sf_ordem_faixas f where f.ordem_id = p_ordem_id and f.trecho_seq = t.seq);
    if exists (
         with usados as (
           -- o SN CRU (com zeros e maiúsculas), o mesmo que sf_sn_na_faixa compara
           select r.numero_serie as sn from sf_registros r
            where r.pmo = v_pmo and r.op = v_op and btrim(r.numero_serie) <> '' and r.posto = any (v_postos_trecho)
           union
           select e.bipe from sf_estoque_envios e
            where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.operacao = 'entrada' and e.cancelado_em is null
         )
         select 1 from usados u
          where not coalesce((select bool_or(sf_sn_na_faixa(f.sn_ini, f.sn_fim, u.sn))
                                from jsonb_to_recordset(v_f) f(seq int, sn_ini text, sn_fim text) where f.seq = t.seq), false)) then
      raise exception 'PRT_FAIXA_COM_HISTORICO:%', t.codigo;
    end if;
  end loop;

  -- 0195: PRT da própria OP na receita só com série própria (a série NOVA; item de posto da rota nova: o único gravado),
  -- a não ser que o código seja também a PMO de uma OP cadastrada (aí vale como PMO)
  select btrim(c->>'pmo') into v_rep
    from jsonb_array_elements(v_comp) c
    join jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text)
      on t2.tipo = 'prt' and lower(btrim(t2.codigo)) = lower(btrim(coalesce(c->>'pmo', '')))
   where t2.sn_modo <> 'proprio'
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = c->>'posto')
     and not exists (select 1 from sf_ordens o2 where lower(btrim(o2.pmo)) = lower(btrim(c->>'pmo')))
   order by t2.seq limit 1;
  if v_rep is not null then raise exception 'RECEITA_PRT_INVALIDA:%', v_rep; end if;

  -- grava (nada acima escreveu): rota, trechos, faixas, receita, Burn-in e por último a OP
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, p.posto, (row_number() over (order by p.seq, p.ord) - 1)::int, p.seq
    from jsonb_to_recordset(v_p) p(posto text, seq int, ord int);
  update sf_ordem_trechos ot
     set posto_conclui = t2.postos->>(jsonb_array_length(t2.postos) - 1), sn_modo = t2.sn_modo
    from jsonb_to_recordset(v_t) t2(seq int, sn_modo text, postos jsonb)
   where ot.ordem_id = p_ordem_id and ot.seq = t2.seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, f.i, f.sn_ini, f.sn_fim, f.seq
    from jsonb_to_recordset(v_f) f(i int, seq int, sn_ini text, sn_fim text);
  delete from sf_ordem_componentes where ordem_id = p_ordem_id;
  insert into sf_ordem_componentes (ordem_id, posto, pmo_componente)
  select distinct p_ordem_id, c->>'posto', btrim(c->>'pmo')
    from jsonb_array_elements(v_comp) c
   where btrim(coalesce(c->>'pmo', '')) <> ''
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = c->>'posto');
  delete from sf_ordem_burnin where ordem_id = p_ordem_id;
  insert into sf_ordem_burnin (ordem_id, posto, tempo_min)
  select distinct on (b->>'posto') p_ordem_id, b->>'posto', (b->>'tempo_min')::int
    from jsonb_array_elements(v_burn) b
   where (b->>'tempo_min') ~ '^\d{1,9}$' and (b->>'tempo_min')::int > 0
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = b->>'posto');
  -- a faixa 1 da OP é a primeira da PMO: o trigger da 0181 reescreve a seq 1 com os mesmos valores
  update sf_ordens o
     set cliente = v_cliente,
         qtd = v_qtd,
         descricao = btrim(coalesce(v_o->>'descricao', '')),
         acp = btrim(coalesce(v_o->>'acp', '')),
         status = v_status,
         finalizada_por = case when upper(v_status) = 'FINALIZADA' then 'manual' end,
         reaberta_manual = case when upper(btrim(coalesce(v_status_antigo, ''))) = 'FINALIZADA' and upper(v_status) <> 'FINALIZADA'
                                then true else o.reaberta_manual end,
         embalagem_individual = coalesce((v_o->>'embalagem_individual')::boolean, false),
         placas_por_painel = v_placas,
         sn_ini = f.sn_ini, sn_fim = f.sn_fim,
         updated_at = now()
    from (select x.sn_ini, x.sn_fim from jsonb_to_recordset(v_f) x(i int, seq int, sn_ini text, sn_fim text) where x.seq = v_pmo_seq order by x.i limit 1) f
   where o.id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
