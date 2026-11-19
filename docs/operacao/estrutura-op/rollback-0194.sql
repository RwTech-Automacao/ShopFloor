-- Rollback da 0194 (edição de OP por trecho). Remove as funções novas e devolve as quatro funções da 0184 que a 0194
-- redefiniu (os triggers do bipe e sf_ordem_regravar_postos/_faixas) ao texto da 0184, sem as travas.
-- O app que chama sf_ordem_regravar_trechos tem que sair ANTES (a página de edição de OP com trechos passa a falhar ao
-- salvar). Idempotente: psql -1 -v ON_ERROR_STOP=1 -f docs/operacao/estrutura-op/rollback-0194.sql
drop function if exists public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.sf_ordem_regravar_trechos(uuid, jsonb);
drop function if exists public.sf_faixas_sobrepoem(text, text, text, text);
drop function if exists public.sf_faixa_coerente(text, text);

-- ---------- as quatro funções como a 0184 as deixou ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
begin
  if new.numero_serie_norm = '' or new.status ilike 'reprov%' then
    return new;
  end if;
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

create or replace function public.sf_ordem_regravar_postos(p_ordem_id uuid, p_postos text[])
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_antigos jsonb;
  v_vazio text;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  select btrim(pp) into v_rep from unnest(coalesce(p_postos, '{}'::text[])) pp
   group by btrim(pp) having count(*) > 1 order by btrim(pp) limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  select coalesce(jsonb_object_agg(posto, trecho_seq), '{}'::jsonb) into v_antigos
    from sf_ordem_postos where ordem_id = p_ordem_id;
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, x.posto, (x.ord - 1)::int, coalesce((v_antigos->>x.posto)::int, v_pmo_seq)
    from unnest(coalesce(p_postos, '{}'::text[])) with ordinality x(posto, ord);
  select ot.codigo into v_vazio from sf_ordem_trechos ot
   where ot.ordem_id = p_ordem_id
     and not exists (select 1 from sf_ordem_postos p where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq)
   order by ot.seq limit 1;
  if v_vazio is not null then raise exception 'TRECHO_SEM_POSTO:%', v_vazio; end if;
  update sf_ordem_trechos ot
     set posto_conclui = (select p.posto from sf_ordem_postos p
                           where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq order by p.ordem desc limit 1)
   where ot.ordem_id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_postos(uuid, text[]) from public, anon;
grant execute on function public.sf_ordem_regravar_postos(uuid, text[]) to authenticated, service_role;

create or replace function public.sf_ordem_regravar_faixas(p_ordem_id uuid, p_faixas jsonb)
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_prt jsonb;
  v_faixas jsonb := case when jsonb_typeof(p_faixas) = 'array' then p_faixas else '[]'::jsonb end;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  -- OP com trechos: as faixas da PMO = as sem trecho_seq (ou com o da PMO); as de outro trecho não entram.
  -- Sem nenhuma da PMO, ou PRT 'proprio' que ficaria sem faixa: recusa antes de apagar qualquer coisa.
  if v_pmo_seq is not null then
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_faixas from jsonb_array_elements(v_faixas) f
     where coalesce((f->>'trecho_seq')::int, v_pmo_seq) = v_pmo_seq;
    if jsonb_array_length(v_faixas) = 0 then
      select codigo into v_rep from sf_ordem_trechos where ordem_id = p_ordem_id and seq = v_pmo_seq;
      raise exception 'TRECHO_SEM_FAIXA:%', v_rep;
    end if;
    select ot.codigo into v_rep from sf_ordem_trechos ot
     where ot.ordem_id = p_ordem_id and ot.tipo = 'prt' and ot.sn_modo = 'proprio'
       and not exists (select 1 from sf_ordem_faixas f where f.ordem_id = ot.ordem_id and f.trecho_seq = ot.seq)
     order by ot.seq limit 1;
    if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sn_ini', f.sn_ini, 'sn_fim', f.sn_fim, 'trecho_seq', f.trecho_seq) order by f.seq), '[]'::jsonb)
    into v_prt
    from sf_ordem_faixas f
   where f.ordem_id = p_ordem_id and f.trecho_seq is not null and f.trecho_seq is distinct from v_pmo_seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, row_number() over (order by z.grupo, z.ord), z.sn_ini, z.sn_fim, z.trecho_seq
    from (
      select 1 as grupo, a.ord, btrim(a.f->>'sn_ini') as sn_ini, btrim(a.f->>'sn_fim') as sn_fim, v_pmo_seq as trecho_seq
        from jsonb_array_elements(v_faixas) with ordinality a(f, ord)
      union all
      select 2, b.ord, b.f->>'sn_ini', b.f->>'sn_fim', (b.f->>'trecho_seq')::int
        from jsonb_array_elements(v_prt) with ordinality b(f, ord)
    ) z;
end
$func$;
revoke all on function public.sf_ordem_regravar_faixas(uuid, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_faixas(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
