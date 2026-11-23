-- =============================================================
-- 0197: APONTAMENTO AUTOMÁTICO DAS PRTs NO COMPELS — SÓ OPs NOVAS, E A PRT VAI POR GRUPO (não placa a placa).
--
-- Decisões do usuário (23/11/2026):
--   1. SÓ OPs NOVAS. sf_ordens.apontar_prt (default true): TODA OP que já existe quando a migração roda fica false
--      (inclusive as com trechos cadastradas desde 18/11); a OP cadastrada depois nasce true (sf_cadastrar_op não muda).
--      sf_trecho_enfileirar só enfileira a PRT da OP com apontar_prt. As linhas de PRT dessas OPs que ainda estavam
--      na fila são CANCELADAS se intocadas (a regra da 0132/0184: nenhuma rodada tentou, sem reserva viva, sem
--      estorno). A TOCADA (tentativas > 0, reserva viva ou estorno) NÃO é cancelada: uma rodada pode tê-la levado ao
--      ERP com a resposta perdida. Ela fica como está — a reserva não a pega mais (item 3) e o agrupar também não (a OP
--      está desligada); aparece na tela de pendências para alguém decidir à mão.
--      Só na PRIMEIRA aplicação: o update e o cancelamento rodam no mesmo bloco que cria a coluna, então reaplicar a
--      migração não desliga OP nova nem cancela nada.
--   2. A PLACA VIRA CONTAGEM, O ENVIO É POR GRUPO. As linhas por placa de PRT (ordem_id preenchido, operacao 'entrada',
--      tipo <> 'grupo_prt') continuam nascendo no bipe (0184/0194) mas NÃO são mais reservadas sozinhas.
--      sf_prt_agrupar() (só service_role; o cron chama antes de entregar a fila) cria, para cada (OP, PRT) com placas
--      pendentes sem grupo, UMA linha tipo 'grupo_prt' (quantidade = soma das placas; op = filha ATUAL do trecho;
--      estoque e posto do trecho; chave PRT/<ordem_id>/<codigo>/G<n>; bipe GRUPO[G<n>][<quantidade>]) e liga as
--      placas a ela (sf_estoque_envios.grupo_id). O grupo nasce quando o PRIMEIRO destes vale:
--        a. TRECHO FECHOU: placas vivas do trecho (não canceladas, descontado o estornado — na fila, no grupo ou
--           enviadas) >= sf_ordens.qtd (qtd vazia: não vale);
--        b. OP FINALIZADA: upper(btrim(sf_ordens.status)) = 'FINALIZADA' (o valor da 0145 e da edição manual);
--        c. PMO ESPERANDO: há linha da PMO da mesma OP na fila (ordem_id null, pmo/op = os da OP, entrada, não ok, não
--           cancelada) MAIS NOVA que o último grupo vivo da PRT — aponta o que a PRT já tem para a caixa não travar por
--           falta de saldo, uma vez por caixa (a caixa presa não gera um grupo a cada rodada).
--      Grupos da mesma OP nascem na ordem do trecho (seq: SMT antes de PTH), com criado_em crescente
--      (clock_timestamp), que é a ordem da reserva.
--      TRAVA: pg_advisory_xact_lock(hashtext('PRT-GRUPO/<ordem_id>/<codigo>')) — a sf_prt_agrupar e o desfazer do bipe
--      (sf_trecho_desfazer) pegam a mesma. Duas rodadas não criam dois grupos; o cancelamento de um bipe não cruza com
--      o agrupamento. O bipe que ENTRA (sf_trecho_enfileirar) não pega essa trava (só insere linha nova; a que nasce
--      durante o agrupamento fica para o próximo grupo). Ordem das travas de linha, a mesma em todo caminho: o GRUPO
--      antes das PLACAS (a conclusão do grupo e o desfazer) — assim os dois não se travam um ao outro.
--   3. RESERVA: sf_estoque_reservar (texto da 0132) pula a placa de PRT (ordem_id não nulo, entrada, tipo <> grupo_prt).
--      O ESTORNO de PRT continua sendo reservado (o adaptador o deixa como "estorno manual", esperado).
--   4. CONCLUSÃO: trigger sf_estoque_envios_grupo_concluir — o grupo vira ok → as placas dele viram ok (enviado_em do
--      grupo). LEITORES QUE SOMAM a fila não contam a placa que tem grupo (o grupo já conta por elas):
--      sf_estoque_enviado (0153, o "já mandamos" da conferência do acumulado), sf_resumo_trechos_op (0184, card do
--      Fluxo / edição da OP). A conferência de faixa da edição (sf_ordem_regravar_trechos, 0195) ignora o bipe do
--      grupo (GRUPO[...] não é SN).
--   5. ESTORNO: placa removida ANTES de agrupar → cancela, como antes. Placa de um grupo AINDA INTOCADO (não ok, nenhuma
--      tentativa, sem reserva viva) → o grupo é DESFEITO (cancelado, as placas soltas) e a placa cancelada; a próxima
--      rodada reagrupa o que sobrou, se o gatilho ainda valer. Placa de grupo TOCADO ou ENVIADO → estorno ligado à
--      PLACA (entrada_id), na op do GRUPO (quem levou a placa ao Compels); ele espera a placa ficar ok (quando o grupo
--      chegar) e segue manual no adaptador. O estoque do estorno vem da placa (trigger da 0175), o mesmo do grupo.
--      Ao desmontar um grupo, a placa dele que já tinha estorno (grupo tocado que voltou a intocado: a rodada só
--      esperou) é cancelada junto com o estorno pendente dela — nada saiu ao ERP, e sem isso as duas ficavam órfãs.
--
-- Esquema: sf_ordens.apontar_prt; sf_estoque_envios.grupo_id (FK para a própria tabela) + índice; o CHECK de tipo
-- ganha 'grupo_prt'; CHECK sf_estoque_envios_grupo_coerente.
-- ORDEM DE DEPLOY: migração ANTES do app (o app novo chama sf_prt_agrupar e lê o tipo 'grupo_prt'; o app antigo leria
-- o grupo como linha ilegível). COMPELS_PRT_LIGADO continua desligado: com ele desligado o grupo só espera.
-- Depende de: 0132, 0153, 0156 (CHECK de tipo), 0184, 0194, 0195.
-- Idempotente (psql -1 -v ON_ERROR_STOP=1 -f). Rollback: docs/operacao/estrutura-op/rollback-0197.sql.
--
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0197_prt_apontamento_automatico.sql
-- =============================================================

-- ---------- 1. só OPs novas (o update e o cancelamento só na primeira aplicação) ----------
do $mig$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sf_ordens' and column_name = 'apontar_prt') then
    alter table public.sf_ordens add column apontar_prt boolean not null default true;
    update public.sf_ordens set apontar_prt = false;
    -- as placas de PRT dessas OPs que estão na fila e ninguém tocou: canceladas (a tocada fica — ver o cabeçalho)
    update public.sf_estoque_envios e
       set cancelado_em = now()
     where e.ordem_id is not null
       and e.operacao = 'entrada'
       and not e.ok
       and e.cancelado_em is null
       and e.tentativas = 0
       and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
       and e.estornado = 0
       and exists (select 1 from public.sf_ordens o where o.id = e.ordem_id and not o.apontar_prt);
  end if;
end $mig$;
comment on column public.sf_ordens.apontar_prt is
  'A integração aponta as PRTs (trechos) desta OP no Compels. false = OP que já existia na 0197 (só OPs novas). 0197.';

-- ---------- 2. o grupo na fila ----------
alter table public.sf_estoque_envios add column if not exists grupo_id uuid;
comment on column public.sf_estoque_envios.grupo_id is
  'Placa de PRT: o grupo (linha tipo grupo_prt) que a leva ao Compels. null = ainda sem grupo (ou não é placa de PRT). 0197.';
do $chk$
declare v_nome text;
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.sf_estoque_envios'::regclass and conname = 'sf_estoque_envios_grupo_fk') then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_grupo_fk foreign key (grupo_id) references public.sf_estoque_envios (id) on delete restrict;
  end if;
  -- o CHECK de tipo ganha 'grupo_prt' (o mesmo jeito da 0156: derruba o que não tem e recria com o nome conhecido)
  for v_nome in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.sf_estoque_envios'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like 'CHECK ((tipo = ANY (ARRAY[%'
       and pg_get_constraintdef(c.oid) not like '%''grupo_prt''%'
  loop
    execute format('alter table public.sf_estoque_envios drop constraint %I', v_nome);
  end loop;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.sf_estoque_envios'::regclass and conname = 'sf_estoque_envios_tipo_check') then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_tipo_check check (tipo in ('caixa', 'serie', 'lote', 'grupo_prt'));
  end if;
  -- grupo: só de PRT e só entrada; placa ligada a grupo: entrada de PRT, não cancelada (desfazer o grupo solta antes)
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.sf_estoque_envios'::regclass and conname = 'sf_estoque_envios_grupo_coerente') then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_grupo_coerente check (
        (tipo <> 'grupo_prt' or (ordem_id is not null and operacao = 'entrada' and grupo_id is null))
        and (grupo_id is null or (ordem_id is not null and operacao = 'entrada' and tipo <> 'grupo_prt'
                                  and cancelado_em is null)));
  end if;
end $chk$;
create index if not exists sf_estoque_envios_grupo on public.sf_estoque_envios (grupo_id) where grupo_id is not null;

-- ---------- enfileirar a PRT no bipe aprovado: o texto da 0194, só para OP com apontar_prt ----------
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
       and o.apontar_prt  -- 0197: só OP nova (a que já existia na 0197 não aponta PRT)
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

-- ---------- desfazer quando o registro sai: o texto da 0194 + o grupo (item 5 do cabeçalho) ----------
create or replace function public.sf_trecho_desfazer()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_id uuid;
  v_grupo uuid;
  v_g record;
  v_ent record;
  v_tocada boolean;
  v_op text;
  v_membros uuid[];
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
    -- 0197: a trava do agrupamento desta PRT (a mesma da sf_prt_agrupar): com ela o grupo da placa não muda debaixo
    perform pg_advisory_xact_lock(hashtext('PRT-GRUPO/' || t.ordem_id::text || '/' || t.codigo));
    -- a entrada VIGENTE da peça neste trecho (a mais recente ainda viva): a mesma escolha da 0132 (seq_chave)
    select e.id, e.grupo_id into v_id, v_grupo
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada'
       and e.cancelado_em is null and e.estornado < e.quantidade
     order by e.seq_chave desc nulls last, e.criado_em desc, e.id desc limit 1;
    if v_id is null then
      continue;
    end if;
    -- as travas de linha na ordem da conclusão do grupo (trigger sf_estoque_envios_grupo_concluir): grupo, depois placa
    if v_grupo is not null then
      select g.* into v_g from public.sf_estoque_envios g where g.id = v_grupo for update;
    end if;
    select e.* into v_ent from public.sf_estoque_envios e where e.id = v_id for update;
    -- LINHA TOCADA, exatamente como a sf_estoque_reverter (0132): uma rodada já a tentou (o ERP pode ter recebido
    -- com a resposta perdida), uma rodada a está entregando agora (reserva de 15 min) ou ela já teve estorno.
    v_tocada := v_ent.tentativas > 0
                or (v_ent.reservado_em is not null and v_ent.reservado_em >= now() - interval '15 minutes')
                or v_ent.estornado > 0;
    -- 0197: placa num grupo. Grupo intocado (não ok, nenhuma tentativa, sem reserva viva) → desfaz o grupo (cancela e
    -- solta as placas; a próxima rodada reagrupa) e a placa segue a regra de sempre. Grupo tocado ou enviado → a placa
    -- conta como tocada: estorno ligado a ela.
    v_op := v_ent.op;
    if v_ent.grupo_id is not null then
      if not v_g.ok and v_g.tentativas = 0
         and (v_g.reservado_em is null or v_g.reservado_em < now() - interval '15 minutes') then
        v_membros := array(select m.id from public.sf_estoque_envios m where m.grupo_id = v_g.id);
        update public.sf_estoque_envios set grupo_id = null where id = any (v_membros);
        update public.sf_estoque_envios set cancelado_em = coalesce(cancelado_em, now()) where id = v_g.id;
        -- a placa do grupo que já tinha estorno (o grupo foi tocado e voltou a intocado: a rodada só esperou, nada foi
        -- ao ERP) não fica órfã na fila: ela e o estorno pendente dela são cancelados (nunca saíram)
        update public.sf_estoque_envios s set cancelado_em = now()
         where s.operacao = 'estorno' and s.entrada_id = any (v_membros) and not s.ok and s.cancelado_em is null;
        update public.sf_estoque_envios m set cancelado_em = now()
         where m.id = any (v_membros) and m.id <> v_ent.id and not m.ok and m.cancelado_em is null
           and m.estornado >= m.quantidade;
      else
        v_tocada := true;
        -- quem levou a placa ao Compels (ou vai levar) é o GRUPO: o estorno sai na op dele (a filha atual do trecho)
        v_op := v_g.op;
      end if;
    end if;
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
       v_ent.pmo, v_op, v_ent.posto, v_ent.tipo, v_ent.bipe, v_ent.serie_norm,
       v_ent.quantidade - v_ent.estornado, v_ent.estoque, t.ordem_id, v_ent.id, clock_timestamp());
    update public.sf_estoque_envios set estornado = quantidade where id = v_ent.id;
  end loop;
  return old;
end
$func$;
revoke all on function public.sf_trecho_desfazer() from public, anon, authenticated;

-- ---------- o agrupamento (o cron chama no começo de cada rodada) ----------
-- Devolve quantos grupos criou. Uma transação: as travas (advisory por OP/PRT e as linhas das placas) valem até o fim.
create or replace function public.sf_prt_agrupar()
returns int language plpgsql volatile security definer set search_path = public as $func$
declare
  t record;
  v_vale boolean;
  v_ids uuid[];
  v_qtd int;
  v_n int;
  v_grupo uuid;
  v_criados int := 0;
begin
  for t in
    select o.id as ordem_id, o.pmo, o.op, o.qtd, o.status, ot.seq, ot.codigo,
           coalesce(ot.compels_op, '') as op_filha, ot.estoque, ot.posto_conclui
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id and ot.tipo = 'prt'
     where o.apontar_prt
       and exists (select 1 from public.sf_estoque_envios e
                    where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
                      and e.tipo <> 'grupo_prt' and e.grupo_id is null and not e.ok and e.cancelado_em is null)
     order by o.created_at, o.id, ot.seq
  loop
    perform pg_advisory_xact_lock(hashtext('PRT-GRUPO/' || t.ordem_id::text || '/' || t.codigo));
    v_vale :=
      -- b. OP finalizada
      upper(btrim(coalesce(t.status, ''))) = 'FINALIZADA'
      -- a. trecho fechou: placas vivas (na fila, no grupo ou enviadas; descontado o estornado) >= qtd da OP
      or (t.qtd is not null
          and (select coalesce(sum(e.quantidade - e.estornado), 0) from public.sf_estoque_envios e
                where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.operacao = 'entrada'
                  and e.tipo <> 'grupo_prt' and e.cancelado_em is null) >= t.qtd)
      -- c. a PMO da mesma OP esperando na fila — uma linha da PMO MAIS NOVA que o último grupo vivo desta PRT (sem
      --    grupo: qualquer uma). Sem isto uma caixa PRESA (OP não liberada, sem configuração, 5 tentativas, erro
      --    permanente) gerava um grupo minúsculo a cada rodada.
      or exists (select 1 from public.sf_estoque_envios p
                  where p.ordem_id is null and p.pmo = t.pmo and p.op = t.op and p.operacao = 'entrada'
                    and not p.ok and p.cancelado_em is null
                    and p.criado_em > coalesce((select max(g.criado_em) from public.sf_estoque_envios g
                                                 where g.ordem_id = t.ordem_id and g.pmo = t.codigo
                                                   and g.tipo = 'grupo_prt' and g.cancelado_em is null),
                                               '-infinity'::timestamptz));
    continue when not v_vale;
    -- as placas pendentes sem grupo, travadas (relidas depois da trava: o que outra rodada agrupou não vem)
    v_ids := array(
      select e.id from public.sf_estoque_envios e
       where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.operacao = 'entrada' and e.tipo <> 'grupo_prt'
         and e.grupo_id is null and not e.ok and e.cancelado_em is null and e.estornado = 0
       order by e.criado_em, e.id
         for update);
    continue when coalesce(cardinality(v_ids), 0) = 0;
    select sum(e.quantidade)::int into v_qtd from public.sf_estoque_envios e where e.id = any (v_ids);
    select count(*) + 1 into v_n from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.tipo = 'grupo_prt';
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id, criado_em)
    values
      ('PRT/' || t.ordem_id::text || '/' || t.codigo || '/G' || v_n, 'entrada', t.codigo, t.op_filha, t.posto_conclui,
       'grupo_prt', 'GRUPO[G' || v_n || '][' || v_qtd || ']', '', v_qtd, t.estoque, t.ordem_id, clock_timestamp())
    returning id into v_grupo;
    update public.sf_estoque_envios set grupo_id = v_grupo where id = any (v_ids);
    v_criados := v_criados + 1;
  end loop;
  return v_criados;
end
$func$;
revoke all on function public.sf_prt_agrupar() from public, anon, authenticated;
grant execute on function public.sf_prt_agrupar() to service_role;

-- ---------- o grupo chegou ao Compels: as placas dele também ----------
create or replace function public.sf_estoque_grupo_concluir()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  update public.sf_estoque_envios m
     set ok = true, enviado_em = new.enviado_em, erro = null, reservado_em = null, adiado_ate = null
   where m.grupo_id = new.id and not m.ok and m.cancelado_em is null;
  return null;
end
$func$;
revoke all on function public.sf_estoque_grupo_concluir() from public, anon, authenticated;
drop trigger if exists sf_estoque_envios_grupo_concluir on public.sf_estoque_envios;
create trigger sf_estoque_envios_grupo_concluir after update of ok on public.sf_estoque_envios
  for each row when (new.tipo = 'grupo_prt' and new.ok and not old.ok)
  execute function public.sf_estoque_grupo_concluir();

-- ---------- a reserva (texto da 0132): pula a placa de PRT, que vai no grupo ----------
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
         and (e.operacao <> 'estorno'
              or coalesce((
                   select ent.ok
                     from public.sf_estoque_envios ent
                    where ent.id = e.entrada_id
                 ), false))
         -- 0197: a placa de PRT não vai sozinha ao Compels — vai no grupo dela (sf_prt_agrupar). O estorno vai.
         and not (e.ordem_id is not null and e.operacao = 'entrada' and e.tipo <> 'grupo_prt')
       order by (e.tentativas > 0), e.criado_em, e.id
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

-- ---------- o "já mandamos" da conferência do acumulado (0153): a placa com grupo não conta (o grupo conta) ----------
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
     and e.grupo_id is null  -- 0197: placa que foi no grupo
     and (p_exceto is null or e.id <> p_exceto)
$func$;
revoke all on function public.sf_estoque_enviado(text, text, uuid) from public, anon, authenticated;
grant execute on function public.sf_estoque_enviado(text, text, uuid) to service_role;

-- ---------- resumo por trecho do card do Fluxo (0184): a placa com grupo não conta (o grupo conta) ----------
create or replace function public.sf_resumo_trechos_op(p_pmo text, p_op text)
returns table (posto text, codigo text, compels_op text, apontadas int, na_fila int, motivo text)
language plpgsql stable security definer set search_path = public as $func$
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then raise exception 'sem permissão'; end if;
  return query
    select ot.posto_conclui, ot.codigo, ot.compels_op,
           coalesce((select sum(case when e.operacao = 'estorno' then -e.quantidade else e.quantidade end)
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.ok and e.grupo_id is null), 0)::int,
           coalesce((select sum(e.quantidade - e.estornado)  -- 0197: a placa estornada na fila não conta
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
                        and not e.ok and e.cancelado_em is null and e.grupo_id is null), 0)::int,
           (select e.erro
              from public.sf_estoque_envios e
             where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
               and not e.ok and e.cancelado_em is null and e.grupo_id is null
             order by e.criado_em, e.id limit 1)
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = p_pmo and o.op = p_op and ot.tipo = 'prt'
     order by ot.seq;
end
$func$;
revoke all on function public.sf_resumo_trechos_op(text, text) from public, anon;
grant execute on function public.sf_resumo_trechos_op(text, text) to authenticated, service_role;

-- ---------- sf_ordem_regravar_trechos: o texto da 0195; a conferência de faixa ignora o bipe do grupo ----------
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
              and e.tipo <> 'grupo_prt'  -- 0197: o bipe do grupo (GRUPO[...]) não é SN
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
