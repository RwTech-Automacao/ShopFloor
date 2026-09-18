-- =============================================================
-- ALERTAS — TIPOS DE REGRA, DESTINATÁRIOS DO SHOPFLOOR E FILTRO DE PMO
-- Spec: docs/superpowers/specs/2026-09-18-alertas-tipos-de-regra-design.md
--
-- Aplica POR CIMA da 0113/0114 (já em produção — a 0113 NÃO é editada). Idempotente: rodar de
-- novo não quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql
--
-- O que muda:
--   A. alerta_regras ganha tipo ('aprovacao' | 'tempo' | 'defeito') + os campos de cada tipo +
--      pmos; a ocorrência ganha defeito e valores genéricos; usuario_tem_permissao; alerta_pmos.
--   B. alerta_avaliar decide os 3 tipos (alerta_taxas com PMO, alerta_tempos, alerta_defeitos);
--      filtro de PMO aparado dos dois lados (alerta_pmos_normalizar + btrim da coluna);
--      janela OP começa no primeiro bipe da OP no posto (alerta_op_inicio);
--      alerta_previa e alerta_listar_ocorrencias novas.
--   C. Destinatário = usuário ativo com shopfloor.administrar no PERFIL DELE: na lista da tela, na
--      fila, na reserva e no botão Resolvido.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A1. Regras: tipo, campos de cada tipo e PMOs ----------
alter table public.alerta_regras
  add column if not exists tipo               text   not null default 'aprovacao',
  add column if not exists limite_tempo_seg   int,
  add column if not exists limite_ocorrencias int,
  add column if not exists pausa_max_min      int,
  add column if not exists pmos               text[] not null default '{}'::text[];

-- Cada tipo usa só os seus campos: taxa_minima e minimo_bipes deixam de ser obrigatórios. (O
-- default 20 de minimo_bipes fica — quem grava regra de defeito manda null explícito.)
alter table public.alerta_regras alter column taxa_minima  drop not null;
alter table public.alerta_regras alter column minimo_bipes drop not null;

alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito'));

-- coalesce(..., false): sem ele, um campo NULO faria a expressão dar NULL — e check com NULL PASSA.
alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_campos_por_tipo check (coalesce(
  case tipo
    when 'aprovacao' then
          taxa_minima is not null and minimo_bipes is not null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'tempo' then
          janela_tipo in ('tempo', 'op')
      and limite_tempo_seg between 1 and 3600
      and minimo_bipes is not null
      and pausa_max_min between 1 and 240
      -- intervalo maior que a pausa sai da média: com limite >= pausa a regra nunca dispararia
      and limite_tempo_seg < pausa_max_min * 60
      and taxa_minima is null and limite_ocorrencias is null
    when 'defeito' then
          janela_tipo = 'tempo'
      and limite_ocorrencias >= 2
      and taxa_minima is null and minimo_bipes is null
      and limite_tempo_seg is null and pausa_max_min is null
  end, false));

alter table public.alerta_regras drop constraint if exists alerta_regras_pmos_sem_nulo;
alter table public.alerta_regras add constraint alerta_regras_pmos_sem_nulo
  check (array_position(pmos, null) is null);

-- O tipo não muda depois de criado (spec §1, decisão 2). Trigger, não policy: a policy de update não
-- enxerga a linha antiga.
create or replace function public.alerta_regras_tipo_fixo()
returns trigger
language plpgsql
as $func$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'TIPO_FIXO';
  end if;
  return new;
end
$func$;

-- Função de trigger: ninguém chama direto (o Postgres só confere EXECUTE ao CRIAR o trigger, não
-- ao disparar), então sai de todo mundo.
revoke all on function public.alerta_regras_tipo_fixo() from public, anon, authenticated, service_role;

drop trigger if exists alerta_regras_tipo_fixo on public.alerta_regras;
create trigger alerta_regras_tipo_fixo
  before update on public.alerta_regras
  for each row execute function public.alerta_regras_tipo_fixo();

-- ---------- A2. Ocorrências: defeito + valores genéricos ----------
-- valor_* = o que foi medido na régua do tipo: aprovação = taxa (%), tempo = média (segundos),
-- defeito = contagem. amostras = bipes com resultado (aprovação), peças (tempo) ou vezes (defeito).
-- taxa_abertura/taxa_ultima continuam (só aprovação) para não quebrar nada que já lê essas colunas.
alter table public.alerta_ocorrencias
  add column if not exists defeito        text,
  add column if not exists valor_abertura numeric(12,2),
  add column if not exists valor_ultimo   numeric(12,2),
  add column if not exists amostras       int;
alter table public.alerta_ocorrencias alter column taxa_abertura drop not null;
alter table public.alerta_ocorrencias alter column taxa_ultima   drop not null;

-- Ocorrências de antes da 0115 (todas de aprovação): copia a taxa para os valores genéricos.
update public.alerta_ocorrencias
   set valor_abertura = taxa_abertura,
       valor_ultimo   = taxa_ultima,
       amostras       = aprovados + reprovados
 where valor_abertura is null and taxa_abertura is not null;

-- Uma ocorrência viva por regra x posto x DEFEITO (tipos sem defeito: ''). Cada defeito que passa do
-- limite abre a SUA ocorrência. O índice antigo (regra x posto) impediria isso — sai.
drop index if exists public.alerta_ocorrencias_viva;
create unique index if not exists alerta_ocorrencias_viva_defeito
  on public.alerta_ocorrencias (regra_id, posto, coalesce(defeito, ''))
  where estado in ('aberta', 'resolvida');

-- ---------- A3. usuario_tem_permissao(): a permissão de UM USUÁRIO (não de quem chama) ----------
-- Mesma régua da tem_permissao(text, text) da 0043 (perfil_permissao pelo usuarios.perfil_id, só
-- usuário ativo), mas para o usuário informado: é assim que a fila sabe se o DESTINATÁRIO ainda
-- administra o ShopFloor. Só o servidor chama direto; as funções de alerta (security definer)
-- chamam como dono.
create or replace function public.usuario_tem_permissao(p_usuario uuid, p_modulo text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1
      from public.usuarios u
      join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
     where u.id = p_usuario
       and u.ativo
       and pp.modulo = p_modulo
       and pp.permissao = p_perm
  )
$func$;

revoke all on function public.usuario_tem_permissao(uuid, text, text) from public, anon, authenticated;
grant execute on function public.usuario_tem_permissao(uuid, text, text) to service_role;

-- ---------- A4. alerta_pmos(): as PMOs que o formulário oferece ----------
-- Um array só (não uma linha por PMO): o PostgREST corta resultado em 1000 linhas, e um valor único
-- não é cortado.
create or replace function public.alerta_pmos()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return (
    select coalesce(array_agg(x.pmo order by x.pmo), '{}'::text[])
      from (select distinct btrim(o.pmo) as pmo from public.sf_ordens o where btrim(o.pmo) <> '') x
  );
end
$func$;

revoke all on function public.alerta_pmos() from public, anon;
grant execute on function public.alerta_pmos() to authenticated, service_role;

-- ---------- B0. alerta_pmos_normalizar(): a lista de PMOs da regra sem espaços nas pontas ----------
-- Função INTERNA. O filtro de PMO compara dos DOIS lados aparado: a lista passa por aqui (nos
-- chamadores: alerta_avaliar e alerta_previa) e a coluna sf_registros.pmo entra com btrim — assim
-- uma PMO salva 'PMOX' casa com o bipe gravado ' PMOX ' (e vice-versa). Lista nula = vazia = todas.
create or replace function public.alerta_pmos_normalizar(p_pmos text[])
returns text[]
language sql
immutable
set search_path = public
as $func$
  select coalesce(array(select btrim(x) from unnest(p_pmos) as x), '{}'::text[])
$func$;

revoke all on function public.alerta_pmos_normalizar(text[]) from public, anon, authenticated, service_role;

-- ---------- B1. alerta_ultima_op(): a OP do último bipe do posto (só PMOs da regra) ----------
-- Função INTERNA (sem grant). Janela 'op': o último bipe do posto nas PMOs da regra (vazio = todas)
-- e só se ele tem menos de 2 horas. Devolve a PMO APARADA: é ela que vai para a ocorrência e para
-- os dados da fila, e quem compara a OP apara o outro lado também.
create or replace function public.alerta_ultima_op(p_posto text, p_pmos text[])
returns table (pmo text, op text)
language sql
stable
-- rows 1: devolve no máximo uma linha. Sem isso o planejador supõe 1000 por posto, o custo
-- estimado de alerta_taxas/alerta_tempos explode e liga o JIT (~300-400 ms a mais por chamada).
rows 1
security definer
set search_path = public
as $func$
  select btrim(r.pmo), r.op
    from sf_registros r
   where r.posto = p_posto
     and r.data_hora >= now() - interval '2 hours'
     and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
   order by r.data_hora desc
   limit 1
$func$;

revoke all on function public.alerta_ultima_op(text, text[]) from public, anon, authenticated, service_role;

-- ---------- B1b. alerta_op_inicio(): o PRIMEIRO bipe daquela OP naquele posto ----------
-- Função INTERNA (sem grant). É o limite inferior de tempo da janela 'op' (taxa e tempo): a leitura
-- dos bipes do posto começa aqui, pelo índice (posto, data_hora desc), em vez de varrer o histórico
-- inteiro do posto. A PMO vem APARADA (alerta_ultima_op) e o bipe pode ter gravado ' PMOX ': para
-- achar o mínimo pelo índice (pmo, op, posto, ...) sem btrim na coluna, primeiro listam-se as PMOs
-- distintas da tabela por "loose index scan" (um salto no índice por PMO — são poucas) e ficam as
-- que, aparadas, são a PMO da OP. Resultado exato (o mesmo do min com btrim(pmo) = p_pmo).
create or replace function public.alerta_op_inicio(p_posto text, p_pmo text, p_op text)
returns timestamptz
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  with recursive d(pmo) as (
    select min(r.pmo) from sf_registros r
    union all
    select (select min(r.pmo) from sf_registros r where r.pmo > d.pmo)
      from d
     where d.pmo is not null
  )
  select min(r.data_hora)
    from sf_registros r
   where r.pmo in (select d.pmo from d where d.pmo is not null and btrim(d.pmo) = p_pmo)
     and r.op = p_op
     and r.posto = p_posto
$func$;

revoke all on function public.alerta_op_inicio(text, text, text) from public, anon, authenticated, service_role;

-- ---------- B2. alerta_taxas(): aprovados/reprovados por posto, agora com filtro de PMO ----------
-- Função INTERNA. Ganhou p_pmos: a assinatura antiga (3 parâmetros) sai antes.
drop function if exists public.alerta_taxas(text[], text, int);
create or replace function public.alerta_taxas(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pmos text[]
)
returns table (posto text, aprovados int, reprovados int, pmo text, op text)
language sql
stable
security definer
set search_path = public
-- cron a cada 5 min: o JIT compilaria o plano toda vez (~30 ms) para uma consulta de milissegundos
set jit = off
as $func$
  select p.posto,
         coalesce(c.aprovados, 0)::int,
         coalesce(c.reprovados, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    left join lateral (
      select public.alerta_op_inicio(p.posto, u.pmo, u.op) as inicio where u.op is not null
    ) f on true
    left join lateral (
      select count(*) filter (where lower(y.status) = 'aprovado')  as aprovados,
             count(*) filter (where lower(y.status) = 'reprovado') as reprovados
        from (
          -- janela 'tempo': os bipes do posto nos últimos N minutos, de todas as OPs (das PMOs da regra)
          select r.status
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and lower(r.status) in ('aprovado', 'reprovado')
             and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
          union all
          -- janela 'bipes': os N últimos bipes COM status do posto, olhando no máximo 30 dias
          (select r.status
             from sf_registros r
            where p_janela_tipo = 'bipes'
              and r.posto = p.posto
              and lower(r.status) in ('aprovado', 'reprovado')
              and r.data_hora >= now() - interval '30 days'
              and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
            order by r.data_hora desc
            limit p_janela_valor)
          union all
          -- janela 'op': todos os bipes do posto naquela OP (a OP já saiu das PMOs da regra); PMO
          -- aparada dos dois lados ('PMOX' e ' PMOX ' são a mesma OP). O corte no primeiro bipe da
          -- OP não muda o resultado (antes dele não há bipe dela) e evita varrer o histórico do posto.
          select r.status
            from sf_registros r
           where p_janela_tipo = 'op'
             and r.posto = p.posto
             and r.data_hora >= f.inicio
             and btrim(r.pmo) = u.pmo and r.op = u.op
             and lower(r.status) in ('aprovado', 'reprovado')
        ) y
    ) c on true
$func$;

revoke all on function public.alerta_taxas(text[], text, int, text[]) from public, anon, authenticated, service_role;

-- ---------- B3. alerta_tempos(): cadência do posto (tempo médio entre bipes seguidos) ----------
-- Função INTERNA. Um BIPE = um data_hora distinto do posto (um bipe com várias linhas de defeito
-- grava todas com o mesmo data_hora — conta como uma peça só). Qualquer status entra. Intervalos
-- maiores que p_pausa_max_min (almoço, troca de turno, máquina parada) ficam FORA da média.
-- Filtro de PMO num posto MISTO: o intervalo é medido entre bipes seguidos do POSTO (de qualquer
-- PMO) e só entram os que TERMINAM num bipe das PMOs da regra. Filtrar antes do lag faria o
-- intervalo entre duas peças da PMO X engolir as peças da PMO Y feitas no meio (posto "lento" à
-- toa). Sem filtro de PMO, todo bipe é da regra e o resultado é o mesmo de antes.
-- Janela 'op': mesma regra. Lê TODOS os bipes do posto desde o primeiro bipe daquela OP no posto
-- (alerta_op_inicio), da_regra = o bipe é daquela OP, e só entram os intervalos que TERMINAM num bipe
-- dela — outra OP intercalada no mesmo posto não vira lentidão da OP.
--   intervalos = intervalos válidos que terminam num bipe da regra (o mínimo da regra olha para isto);
--   media_seg  = média desses, truncada em 2 casas (null sem nenhum válido);
--   pecas      = bipes distintos da regra na janela.
create or replace function public.alerta_tempos(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pausa_max_min int, p_pmos text[]
)
returns table (posto text, intervalos int, media_seg numeric, pecas int, pmo text, op text)
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  select p.posto,
         coalesce(m.intervalos, 0)::int,
         m.media_seg,
         coalesce(m.pecas, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    left join lateral (
      select public.alerta_op_inicio(p.posto, u.pmo, u.op) as inicio where u.op is not null
    ) f on true
    left join lateral (
      select count(g.seg) filter (where g.da_regra and g.seg <= p_pausa_max_min * 60)         as intervalos,
             trunc(avg(g.seg) filter (where g.da_regra and g.seg <= p_pausa_max_min * 60), 2) as media_seg,
             count(*) filter (where g.da_regra)                                                 as pecas
        from (
          select b.da_regra,
                 extract(epoch from b.data_hora - lag(b.data_hora) over (order by b.data_hora)) as seg
            from (
              -- janela 'tempo': TODOS os bipes do posto (um por data_hora); da_regra = o bipe tem
              -- alguma linha das PMOs da regra (sem filtro: todos)
              select r.data_hora,
                     coalesce(bool_or(coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos)),
                              false) as da_regra
                from sf_registros r
               where p_janela_tipo = 'tempo'
                 and r.posto = p.posto
                 and r.data_hora >= now() - make_interval(mins => p_janela_valor)
               group by r.data_hora
              union all
              -- janela 'op': TODOS os bipes do posto desde o primeiro bipe daquela OP nele;
              -- da_regra = o bipe é daquela OP (PMO aparada dos dois lados)
              select r.data_hora,
                     coalesce(bool_or(btrim(r.pmo) = u.pmo and r.op = u.op), false) as da_regra
                from sf_registros r
               where p_janela_tipo = 'op'
                 and r.posto = p.posto
                 and r.data_hora >= f.inicio
               group by r.data_hora
            ) b
        ) g
    ) m on true
$func$;

revoke all on function public.alerta_tempos(text[], text, int, int, text[]) from public, anon, authenticated, service_role;

-- ---------- B4. alerta_defeitos(): o mesmo código de defeito repetido no posto ----------
-- Função INTERNA. Linhas REPROVADAS com código de defeito preenchido, nos últimos p_janela_min
-- minutos, por posto x código (cada linha conta uma vez). Só devolve códigos com pelo menos 1.
-- Código aparado: '2040 X' e '2040 X ' são o mesmo defeito (e o aparado é o que vai para a ocorrência).
create or replace function public.alerta_defeitos(p_postos text[], p_janela_min int, p_pmos text[])
returns table (posto text, defeito text, ocorrencias int)
language sql
stable
security definer
set search_path = public
set jit = off
as $func$
  select r.posto, btrim(r.codigo_defeito), count(*)::int
    from sf_registros r
   where r.posto = any (p_postos)
     and r.data_hora >= now() - make_interval(mins => p_janela_min)
     and lower(r.status) = 'reprovado'
     and btrim(r.codigo_defeito) <> ''
     and (coalesce(cardinality(p_pmos), 0) = 0 or btrim(r.pmo) = any (p_pmos))
   group by r.posto, btrim(r.codigo_defeito)
$func$;

revoke all on function public.alerta_defeitos(text[], int, text[]) from public, anon, authenticated, service_role;

-- ---------- B5. alerta_avaliar(): decide os 3 tipos e põe os envios na fila ----------
-- Mesmo contrato da 0113: {"ocupado", "avaliadas", "enfileirados", "normalizadas": [uuid]}.
-- Cada tipo vira uma MEDIÇÃO por (regra, posto, defeito) com o mesmo formato; as transições
-- (abrir / lembrar / normalizar) são as mesmas para todos:
--   aprovacao: valor = taxa (%),   abaixo = valor <  taxa_minima,       avaliável = bipes >= mínimo
--   tempo:     valor = média (s),  abaixo = valor >  limite_tempo_seg,  avaliável = intervalos >= mínimo
--   defeito:   valor = contagem,   abaixo = valor >= limite_ocorrencias, sempre avaliável
-- No defeito, além dos códigos da janela, entram os códigos que têm ocorrência VIVA (com contagem 0
-- se sumiram da janela) — é assim que cada defeito normaliza sozinho.
create or replace function public.alerta_avaliar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set jit = off
as $func$
#variable_conflict use_column
declare
  v_agora        timestamptz := now();
  v_avaliadas    int := 0;
  v_enfileirados int := 0;
  v_n            int;
  v_normalizadas uuid[];
  v_abaixo       boolean;
  v_tipo         text;
  v_lembrete     boolean;
  v_dados        jsonb;
  t              record;
  o              public.alerta_ocorrencias;
begin
  -- Duas avaliações ao mesmo tempo (cron atrasado + "Avaliar agora") abririam a MESMA ocorrência
  -- duas vezes. A segunda simplesmente vai embora avisando que está ocupado.
  if not pg_try_advisory_xact_lock(hashtext('alerta_avaliar')) then
    return jsonb_build_object('ocupado', true, 'avaliadas', 0, 'enfileirados', 0,
                              'normalizadas', '[]'::jsonb);
  end if;

  -- Regra desativada, EXCLUÍDA ou posto tirado da regra: a ocorrência viva encerra SEM envio.
  with encerradas as (
    update public.alerta_ocorrencias oc
       set estado = 'normalizada', normalizada_em = v_agora
      from public.alerta_regras rg
     where rg.id = oc.regra_id
       and oc.estado in ('aberta', 'resolvida')
       and (rg.ativa is false or rg.excluida_em is not null or not (oc.posto = any (rg.postos)))
    returning oc.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_normalizadas from encerradas;

  for t in
    select m.*
      from (
        -- Taxa de aprovação
        select rg.id as regra_id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               tx.posto, null::text as defeito, tx.pmo, tx.op,
               tx.aprovados, tx.reprovados,
               (tx.aprovados + tx.reprovados) as amostras,
               (tx.aprovados + tx.reprovados) >= rg.minimo_bipes as avaliavel,
               case when tx.aprovados + tx.reprovados > 0
                    then trunc((tx.aprovados * 100.0) / (tx.aprovados + tx.reprovados), 2)
               end as valor,
               rg.taxa_minima::numeric as limite
          from public.alerta_regras rg
          cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                 public.alerta_pmos_normalizar(rg.pmos)) tx
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'aprovacao'
        union all
        -- Tempo médio por peça
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               tp.posto, null::text, tp.pmo, tp.op,
               0, 0,
               tp.pecas,
               tp.intervalos >= rg.minimo_bipes and tp.media_seg is not null,
               tp.media_seg,
               rg.limite_tempo_seg::numeric
          from public.alerta_regras rg
          cross join lateral public.alerta_tempos(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                  rg.pausa_max_min,
                                                  public.alerta_pmos_normalizar(rg.pmos)) tp
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'tempo'
        union all
        -- Defeito repetido: os códigos da janela + os que têm ocorrência viva (contagem 0 se sumiram)
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               df.posto, df.defeito, null::text, null::text,
               0, 0,
               df.ocorrencias,
               true,
               df.ocorrencias::numeric,
               rg.limite_ocorrencias::numeric
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select x.posto, x.defeito, x.ocorrencias
                from public.alerta_defeitos(rg.postos, rg.janela_valor,
                                              public.alerta_pmos_normalizar(rg.pmos)) x
            )
            select d.posto, d.defeito, d.ocorrencias from d
            union all
            select oc.posto, oc.defeito, 0
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.defeito = oc.defeito)
          ) df
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'defeito'
      ) m
     order by m.criado_em, m.regra_id, m.posto, m.defeito nulls first
  loop
    v_avaliadas := v_avaliadas + 1;
    -- Sem o mínimo (bipes ou intervalos), a regra não decide NADA (nem abre, nem normaliza).
    if not coalesce(t.avaliavel, false) then
      continue;
    end if;
    v_abaixo := coalesce(case t.tipo
                           when 'aprovacao' then t.valor <  t.limite
                           when 'tempo'     then t.valor >  t.limite
                           else                  t.valor >= t.limite
                         end, false);
    v_tipo := null;

    select * into o
      from public.alerta_ocorrencias
     where regra_id = t.regra_id and posto = t.posto
       and coalesce(defeito, '') = coalesce(t.defeito, '')
       and estado in ('aberta', 'resolvida')
     for update;

    if not found then
      if v_abaixo then
        insert into public.alerta_ocorrencias
          (regra_id, posto, defeito, pmo, op, taxa_abertura, taxa_ultima, valor_abertura, valor_ultimo,
           amostras, aprovados, reprovados, aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto, t.defeito,
                case when t.janela_tipo = 'op' then btrim(t.pmo) end,
                case when t.janela_tipo = 'op' then t.op end,
                case when t.tipo = 'aprovacao' then t.valor end,
                case when t.tipo = 'aprovacao' then t.valor end,
                t.valor, t.valor, t.amostras, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif not v_abaixo then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados
       where id = o.id
      returning * into o;
      v_tipo := 'normalizou';
      v_normalizadas := v_normalizadas || o.id;

    else
      -- Decide o lembrete ANTES do update, num booleano — nunca comparando `ultimo_envio_em`
      -- com `v_agora` depois (duas avaliações no mesmo instante teriam o mesmo `now()`).
      v_lembrete := o.estado = 'aberta' and t.lembrete_min is not null
                    and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min);

      update public.alerta_ocorrencias
         set taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados,
             ultimo_envio_em = case when v_lembrete then v_agora else o.ultimo_envio_em end
       where id = o.id
      returning * into o;
      if v_lembrete then
        v_tipo := 'lembrete';
      end if;
    end if;

    if v_tipo is not null then
      -- `dados` = o que o app precisa para montar o texto (ver domain/envio.ts). Números crus; a
      -- formatação (%, mm:ss, rótulo do defeito, fuso) mora só no TS.
      v_dados := jsonb_build_object(
                   'regra_tipo',   t.tipo,
                   'regra_nome',   t.nome,
                   'posto',        t.posto,
                   'janela_tipo',  t.janela_tipo,
                   'janela_valor', t.janela_valor,
                   'pmo',          btrim(t.pmo),
                   'op',           t.op,
                   'aberta_em',    o.aberta_em,
                   'agora',        v_agora)
                 || case t.tipo
                      when 'aprovacao' then jsonb_build_object(
                        'taxa', t.valor, 'taxa_minima', t.limite,
                        'aprovados', t.aprovados, 'reprovados', t.reprovados)
                      when 'tempo' then jsonb_build_object(
                        'media_seg', t.valor, 'limite_tempo_seg', t.limite, 'pecas', t.amostras)
                      else jsonb_build_object(
                        'defeito', t.defeito, 'ocorrencias', t.amostras, 'limite_ocorrencias', t.limite)
                    end;

      -- FILA: uma linha pendente por destinatário x canal da regra QUE TENHA vínculo AGORA, que
      -- esteja ATIVO e que administre o ShopFloor. Mesma transação da decisão: ou as duas coisas ficam, ou nenhuma.
      insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao)
      select o.id, c.usuario_id, c.canal, v_tipo, v_dados, v_tipo in ('alerta', 'lembrete')
        from public.alerta_contas c
        join public.usuarios u on u.id = c.usuario_id and u.ativo
       where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
         -- destinatário precisa administrar o ShopFloor AGORA (spec 2026-09-18, decisão 5)
         and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
       order by c.usuario_id, c.canal;
      get diagnostics v_n = row_count;
      v_enfileirados := v_enfileirados + v_n;
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas,
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas));
end
$func$;

revoke all on function public.alerta_avaliar() from public, anon, authenticated;
grant execute on function public.alerta_avaliar() to service_role;

-- ---------- B6. alerta_previa(): o valor de agora, por tipo, sem gravar nada ----------
-- Assinatura nova (tipo + parâmetros de cálculo + PMOs): a antiga (4 parâmetros) sai antes.
-- Retorno largo, cada tipo preenche o seu pedaço:
--   aprovacao: aprovados, reprovados, taxa, avaliavel (bipes >= mínimo), pmo/op (janela OP)
--   tempo:     media_seg, intervalos, pecas, avaliavel (intervalos >= mínimo), pmo/op
--   defeito:   uma linha por (posto, defeito com contagem >= N); posto sem nenhum = uma linha com
--              defeito nulo e ocorrencias 0
drop function if exists public.alerta_previa(text[], text, int, int);
create or replace function public.alerta_previa(
  p_tipo text, p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int,
  p_pausa_max_min int, p_limite_ocorrencias int, p_pmos text[]
)
returns table (posto text, defeito text, aprovados int, reprovados int, taxa numeric,
               media_seg numeric, intervalos int, pecas int, ocorrencias int, avaliavel boolean,
               pmo text, op text)
language plpgsql
stable
security definer
set search_path = public
set jit = off
as $func$
#variable_conflict use_column
declare
  v_pmos text[] := public.alerta_pmos_normalizar(p_pmos);
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_tipo is null or p_tipo not in ('aprovacao', 'tempo', 'defeito') then
    raise exception 'TIPO_INVALIDO';
  end if;
  if p_janela_tipo is null or p_janela_tipo not in ('tempo', 'bipes', 'op')
     or (p_tipo = 'tempo' and p_janela_tipo = 'bipes')
     or (p_tipo = 'defeito' and p_janela_tipo <> 'tempo') then
    raise exception 'JANELA_INVALIDA';
  end if;
  if p_janela_tipo <> 'op' and coalesce(p_janela_valor, 0) <= 0 then
    raise exception 'JANELA_INVALIDA';
  end if;

  if p_tipo = 'aprovacao' then
    return query
      select t.posto, null::text, t.aprovados, t.reprovados,
             case when t.aprovados + t.reprovados > 0
                  then trunc((t.aprovados * 100.0) / (t.aprovados + t.reprovados), 2)
             end,
             null::numeric, 0, 0, 0,
             (t.aprovados + t.reprovados) >= greatest(coalesce(p_minimo, 1), 1),
             t.pmo, t.op
        from public.alerta_taxas(p_postos, p_janela_tipo, p_janela_valor, v_pmos) t;

  elsif p_tipo = 'tempo' then
    if coalesce(p_pausa_max_min, 0) not between 1 and 240 then raise exception 'PAUSA_INVALIDA'; end if;
    return query
      select t.posto, null::text, 0, 0, null::numeric,
             t.media_seg, t.intervalos, t.pecas, 0,
             t.intervalos >= greatest(coalesce(p_minimo, 1), 1) and t.media_seg is not null,
             t.pmo, t.op
        from public.alerta_tempos(p_postos, p_janela_tipo, p_janela_valor, p_pausa_max_min, v_pmos) t;

  else
    if coalesce(p_limite_ocorrencias, 0) < 2 then raise exception 'LIMITE_INVALIDO'; end if;
    return query
      select p.posto, d.defeito, 0, 0, null::numeric, null::numeric, 0, 0,
             coalesce(d.ocorrencias, 0), true, null::text, null::text
        from unnest(p_postos) as p(posto)
        left join lateral (
          select x.defeito, x.ocorrencias
            from public.alerta_defeitos(array[p.posto], p_janela_valor, v_pmos) x
           where x.ocorrencias >= p_limite_ocorrencias
        ) d on true
       order by p.posto, d.ocorrencias desc nulls last, d.defeito;
  end if;
end
$func$;

revoke all on function public.alerta_previa(text, text[], text, int, int, int, int, text[]) from public, anon;
grant execute on function public.alerta_previa(text, text[], text, int, int, int, int, text[])
  to authenticated, service_role;

-- ---------- B7. alerta_listar_ocorrencias(): + tipo, defeito e valores ----------
-- O retorno mudou (colunas novas no FIM): create or replace não troca retorno, então drop antes.
drop function if exists public.alerta_listar_ocorrencias(timestamptz, timestamptz, text);
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int,
  regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select oc.id, oc.regra_id,
           rg.nome || case when rg.excluida_em is not null then ' (excluída)' else '' end,
           oc.posto, oc.pmo, oc.op, oc.estado,
           oc.taxa_abertura, oc.taxa_ultima, oc.aprovados, oc.reprovados, oc.aberta_em,
           coalesce(nullif(btrim(u.nome), ''), u.email, ''),
           oc.resolvida_em, oc.normalizada_em,
           coalesce(e.ok_qtd, 0)::int, coalesce(e.falha_qtd, 0)::int,
           rg.tipo, oc.defeito, oc.valor_abertura, oc.valor_ultimo, oc.amostras
      from alerta_ocorrencias oc
      join alerta_regras rg on rg.id = oc.regra_id
      left join usuarios u on u.id = oc.resolvida_por
      left join lateral (
        -- falha = tentou e não entregou, ou gastou as 3 tentativas (mesma régua da 0113)
        select count(*) filter (where ev.ok)                                        as ok_qtd,
               count(*) filter (where not ev.ok
                                  and (ev.erro is not null or ev.tentativas >= 3)) as falha_qtd
          from alerta_envios ev
         where ev.ocorrencia_id = oc.id
      ) e on true
     where oc.aberta_em >= p_de
       and oc.aberta_em <= p_ate
       and (coalesce(p_estado, '') = '' or oc.estado = p_estado)
     order by oc.aberta_em desc
     limit 500;
end
$func$;

revoke all on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text)
  to authenticated, service_role;

-- ---------- C1. alerta_reservar_envios(): só entrega a quem ainda administra o ShopFloor ----------
-- Igual à 0113 + o filtro de permissão. Quem perdeu shopfloor.administrar DEPOIS de a linha ser
-- enfileirada não recebe: a linha fica pendente, nunca é reservada (não conta tentativa nem falha)
-- e sai da fila sozinha quando passa das 24 h — o mesmo caminho do usuário desativado.
create or replace function public.alerta_reservar_envios(
  p_canais text[], p_limite int default 30, p_ocorrencia_id uuid default null
)
returns table (id uuid, ocorrencia_id uuid, usuario_id uuid, canal text, externo_id text,
               tipo text, dados jsonb, com_botao boolean, tentativas int)
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  return query
    with alvo as (
      select e.id, c.externo_id
        from public.alerta_envios e
        join public.alerta_contas c on c.usuario_id = e.usuario_id and c.canal = e.canal
        join public.usuarios u on u.id = e.usuario_id and u.ativo
        left join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
       where e.ok = false
         and e.tentativas < 3
         and e.tipo <> 'teste'
         and e.criado_em >= now() - interval '24 hours'
         and e.canal = any (coalesce(p_canais, '{}'::text[]))
         and (p_ocorrencia_id is null or e.ocorrencia_id = p_ocorrencia_id)
         and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
         and (e.tipo not in ('alerta', 'lembrete') or oc.estado = 'aberta')
         and public.usuario_tem_permissao(e.usuario_id, 'shopfloor', 'administrar')
       order by (e.tentativas > 0), e.criado_em, e.id
       limit least(greatest(coalesce(p_limite, 30), 1), 100)
       for update of e skip locked
    ),
    reservadas as (
      update public.alerta_envios e
         set tentativas = e.tentativas + 1, reservado_em = now()
        from alvo
       where e.id = alvo.id
      returning e.id, e.ocorrencia_id, e.usuario_id, e.canal, alvo.externo_id, e.tipo, e.dados,
                e.com_botao, e.tentativas, e.criado_em
    )
    select r.id, r.ocorrencia_id, r.usuario_id, r.canal, r.externo_id, r.tipo, r.dados,
           r.com_botao, r.tentativas
      from reservadas r
     order by (r.tentativas > 1), r.criado_em, r.id;
end
$func$;

revoke all on function public.alerta_reservar_envios(text[], int, uuid) from public, anon, authenticated;
grant execute on function public.alerta_reservar_envios(text[], int, uuid) to service_role;

-- ---------- C2. alerta_resolver_interno(): destinatário precisa administrar o ShopFloor ----------
-- Igual à 0113 + a permissão: pelo botão (p_exigir_destinatario), quem perdeu shopfloor.administrar
-- recebe NAO_DESTINATARIO; o "✅ resolvido por" só vai para quem administra. Pela tela
-- (alerta_resolver_admin) a permissão já é checada em quem chama.
create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  o     public.alerta_ocorrencias;
  r     public.alerta_regras;
  v_ja  boolean := true;
  v_nome text;
begin
  select * into o from alerta_ocorrencias where id = p_ocorrencia_id for update;
  if not found then raise exception 'OCORRENCIA_INEXISTENTE'; end if;
  select * into r from alerta_regras where id = o.regra_id;
  -- `p_usuario_id is null` explícito: falha FECHADA (null = any(...) dá NULL, não false).
  if p_exigir_destinatario and (p_usuario_id is null or not (p_usuario_id = any (r.destinatarios))) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  -- Usuário inexistente, desativado OU sem shopfloor.administrar nunca é destinatário válido, mesmo
  -- que o uuid ainda esteja no array `destinatarios` da regra (usuario_tem_permissao já exige ativo).
  if p_exigir_destinatario
     and not public.usuario_tem_permissao(p_usuario_id, 'shopfloor', 'administrar') then
    raise exception 'NAO_DESTINATARIO';
  end if;
  if o.estado = 'normalizada' then raise exception 'OCORRENCIA_ENCERRADA'; end if;

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now()
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  -- FILA: "✅ resolvido por X" para os OUTROS destinatários ativos que administram o ShopFloor, na
  -- mesma transação da resolução. Só na primeira resolução.
  if not v_ja then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao)
    select o.id, c.usuario_id, c.canal, 'resolvido',
           jsonb_build_object('posto', o.posto, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em),
           false
      from alerta_contas c
      join usuarios u on u.id = c.usuario_id and u.ativo
     where c.usuario_id = any (r.destinatarios)
       and c.canal = any (r.canais)
       and c.usuario_id is distinct from p_usuario_id
       and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
     order by c.usuario_id, c.canal;
  end if;

  return jsonb_build_object(
    'ocorrencia_id',      o.id,
    'regra_id',           o.regra_id,
    'posto',              o.posto,
    'ja_resolvida',       v_ja,
    'resolvida_por',      o.resolvida_por,
    'resolvida_por_nome', coalesce(v_nome, ''),
    'resolvida_em',       o.resolvida_em
  );
end
$func$;

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- ---------- C3. alerta_destinatarios(): quem a tela oferece ----------
-- Só usuários ATIVOS que administram o ShopFloor (a permissão do USUÁRIO listado, não de quem
-- chama). Devolve o vínculo como booleano (nunca o externo_id).
create or replace function public.alerta_destinatarios()
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord')
      from usuarios u
     where u.ativo
       and public.usuario_tem_permissao(u.id, 'shopfloor', 'administrar')
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios() from public, anon;
grant execute on function public.alerta_destinatarios() to authenticated, service_role;

notify pgrst, 'reload schema';
