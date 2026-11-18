-- =============================================================
-- SAT — ENTRADA DE EQUIPAMENTOS E A PLANILHA "PEÇAS EM GARANTIA" NO BANCO
-- (spec docs/superpowers/specs/2026-11-17-sat-entrada-design.md)
--
-- Equipamento que volta do cliente: a OS nasce na planilha "Peças em garantia" (Google Form → n8n), e quem recebe
-- o equipamento preenchia a ficha de papel FO-161. Aqui:
--
--   - `sat_os` / `sat_os_itens`: a planilha, copiada pelo cron (POST /api/sat/sincronizar-planilha, service role,
--     pela função `sat_sincronizar_planilha`). Uma OS tem vários equipamentos e várias peças: um item por
--     NS × peça. Acrescenta e atualiza, NUNCA apaga (linha apagada na planilha continua aqui). Célula vazia na
--     planilha não apaga o que já estava gravado.
--   - `sat_motivos_nf`: motivos de reprovação da NF de entrada (cadastro na tela, sat.administrar).
--   - `sat_entradas` / `sat_entradas_historico`: a metade de entrada da FO-161 e toda mudança da NF (entrada,
--     correção, troca), com quem/quando/de/para/motivos.
--   - O NS é guardado como foi digitado e em MODELO + SEQUÊNCIA (sem zeros à esquerda); a busca usa o par.
--
--   - RLS: leitura com sat.visualizar (`(select tem_permissao(...))`, InitPlan — padrão da 0096); SEM policy de
--     escrita: o usuário grava só pelas funções security definer abaixo; a sincronização usa a service role.
--   - `sat_consultar_ns`: o perfil do SAT não lê o repinmetro nem o ShopFloor (as policies deles olham as flags
--     `pode_*`, que o SAT não liga); a função devolve SÓ o que a tela de entrada mostra daquele NS.
--   - `*_nome`: a tabela `usuarios` não é legível por quem só tem SAT, então o nome fica guardado na linha.
--
-- Aditiva e idempotente (if not exists, create or replace, drop policy if exists). Funções com $func$ (o SQL
-- Editor recusa o de dois cifrões); grants e revokes explícitos; notify pgrst na última linha.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0186_sat_entrada.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (as telas e o cron novos leem as tabelas). O app antigo não as usa.
-- =============================================================

-- ---------- a planilha ----------
create table if not exists public.sat_os (
  id                uuid primary key default gen_random_uuid(),
  -- nº da OS (maiúsculo, espaços normalizados); sem número na planilha = 'sem-os|data|cliente|equipamento'
  chave             text not null unique,
  numero            text not null default '',
  data              date,
  tecnico           text not null default '',
  cliente           text not null default '',
  equipamento       text not null default '',
  garantia          text not null default '',
  primeiro_registro text not null default '',
  defeito           text not null default '',
  observacao        text not null default '',
  solucao           text not null default '',
  vendedor          text not null default '',
  aba_origem        text not null default '',
  linha_origem      int,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create table if not exists public.sat_os_itens (
  id            uuid primary key default gen_random_uuid(),
  os_id         uuid not null references public.sat_os(id) on delete cascade,
  -- NS + peça + data: a mesma peça repetida em duas abas grava uma vez
  chave         text not null,
  ns_escrito    text not null default '',
  modelo        text,
  sequencia     text,
  codigo_peca   text not null default '',
  peca          text not null default '',
  quantidade    numeric,
  data          date,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (os_id, chave)
);
create index if not exists sat_os_itens_ns on public.sat_os_itens (sequencia, modelo);

-- ---------- motivos de reprovação da NF ----------
create table if not exists public.sat_motivos_nf (
  id        uuid primary key default gen_random_uuid(),
  texto     text not null check (btrim(texto) <> '' and length(texto) <= 200),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists sat_motivos_nf_texto on public.sat_motivos_nf (lower(btrim(texto)));

-- ---------- a entrada (metade de cima da FO-161) ----------
create table if not exists public.sat_entradas (
  id                 uuid primary key default gen_random_uuid(),
  ns_escrito         text not null check (btrim(ns_escrito) <> ''),
  modelo             text,
  sequencia          text,
  os_id              uuid references public.sat_os(id) on delete set null,
  os_numero          text not null default '',
  empresa            text not null default '',
  cnpj               text not null default '',
  produto            text not null default '',
  nf                 text not null check (btrim(nf) <> ''),
  valor              numeric(14, 2) check (valor >= 0),
  frete              text check (frete in ('a_cobrar', 'pago')),
  itens_junto        text[] not null default '{}'
                     check (itens_junto <@ array['bobina', 'chave', 'fonte', 'outros']::text[]),
  itens_junto_outros text not null default '',
  defeito            text not null default '',
  locacao            text not null default '',
  custo              numeric(14, 2) check (custo >= 0),
  nf_situacao        text not null check (nf_situacao in ('aprovada', 'reprovada')),
  nf_motivos         text[] not null default '{}',
  responsavel        uuid references public.usuarios(id) on delete set null,
  responsavel_nome   text not null default '',
  data               date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  -- reprovada ⇔ tem motivo
  constraint sat_entradas_motivos check ((nf_situacao = 'reprovada') = (cardinality(nf_motivos) > 0))
);
create index if not exists sat_entradas_ns on public.sat_entradas (sequencia, modelo);
create index if not exists sat_entradas_criado_em on public.sat_entradas (criado_em desc);

create table if not exists public.sat_entradas_historico (
  id            uuid primary key default gen_random_uuid(),
  entrada_id    uuid not null references public.sat_entradas(id) on delete cascade,
  tipo          text not null check (tipo in ('entrada', 'correcao', 'troca')),
  nf_de         text,
  situacao_de   text,
  nf_para       text not null,
  situacao_para text not null check (situacao_para in ('aprovada', 'reprovada')),
  motivos       text[] not null default '{}',
  usuario       uuid references public.usuarios(id) on delete set null,
  usuario_nome  text not null default '',
  em            timestamptz not null default now()
);
create index if not exists sat_entradas_historico_entrada on public.sat_entradas_historico (entrada_id, em);

-- ---------- RLS: só leitura, com sat.visualizar ----------
alter table public.sat_os enable row level security;
alter table public.sat_os_itens enable row level security;
alter table public.sat_motivos_nf enable row level security;
alter table public.sat_entradas enable row level security;
alter table public.sat_entradas_historico enable row level security;

drop policy if exists sat_os_select on public.sat_os;
create policy sat_os_select on public.sat_os
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_os_itens_select on public.sat_os_itens;
create policy sat_os_itens_select on public.sat_os_itens
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_motivos_nf_select on public.sat_motivos_nf;
create policy sat_motivos_nf_select on public.sat_motivos_nf
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_entradas_select on public.sat_entradas;
create policy sat_entradas_select on public.sat_entradas
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_entradas_historico_select on public.sat_entradas_historico;
create policy sat_entradas_historico_select on public.sat_entradas_historico
  for select using ((select tem_permissao('sat', 'visualizar')));

revoke all on public.sat_os, public.sat_os_itens, public.sat_motivos_nf, public.sat_entradas,
  public.sat_entradas_historico from public, anon, authenticated;
grant select on public.sat_os, public.sat_os_itens, public.sat_motivos_nf, public.sat_entradas,
  public.sat_entradas_historico to authenticated;
grant select, insert, update, delete on public.sat_os, public.sat_os_itens, public.sat_motivos_nf,
  public.sat_entradas, public.sat_entradas_historico to service_role;

-- ---------- sat_sincronizar_planilha: o cron grava um lote de OS (só service_role) ----------
-- p_os = [{chave, numero, data, tecnico, cliente, equipamento, garantia, primeiro_registro, defeito, observacao,
--          solucao, vendedor, aba, linha, itens: [{chave, ns, modelo, sequencia, codigo_peca, peca, quantidade, data}]}]
-- Valor vazio não apaga o gravado. Devolve as contagens: os_novas, os_atualizadas, itens_novos, itens_atualizados.
create or replace function public.sat_sincronizar_planilha(p_os jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_os         jsonb;
  v_it         jsonb;
  v_id         uuid;
  v_novo       boolean;
  v_item_id    uuid;
  v_os_novas   int := 0;
  v_os_atual   int := 0;
  v_it_novos   int := 0;
  v_it_atual   int := 0;
begin
  if p_os is null or jsonb_typeof(p_os) <> 'array' then raise exception 'LOTE_INVALIDO'; end if;

  for v_os in select e from jsonb_array_elements(p_os) e loop
    if coalesce(btrim(v_os->>'chave'), '') = '' then raise exception 'OS_SEM_CHAVE'; end if;
    v_id := null;
    insert into sat_os as o (chave, numero, data, tecnico, cliente, equipamento, garantia, primeiro_registro,
                             defeito, observacao, solucao, vendedor, aba_origem, linha_origem)
    values (v_os->>'chave', coalesce(v_os->>'numero', ''), nullif(v_os->>'data', '')::date,
            coalesce(v_os->>'tecnico', ''), coalesce(v_os->>'cliente', ''), coalesce(v_os->>'equipamento', ''),
            coalesce(v_os->>'garantia', ''), coalesce(v_os->>'primeiro_registro', ''),
            coalesce(v_os->>'defeito', ''), coalesce(v_os->>'observacao', ''), coalesce(v_os->>'solucao', ''),
            coalesce(v_os->>'vendedor', ''), coalesce(v_os->>'aba', ''), nullif(v_os->>'linha', '')::int)
    on conflict (chave) do update set
      numero            = coalesce(nullif(excluded.numero, ''), o.numero),
      data              = coalesce(excluded.data, o.data),
      tecnico           = coalesce(nullif(excluded.tecnico, ''), o.tecnico),
      cliente           = coalesce(nullif(excluded.cliente, ''), o.cliente),
      equipamento       = coalesce(nullif(excluded.equipamento, ''), o.equipamento),
      garantia          = coalesce(nullif(excluded.garantia, ''), o.garantia),
      primeiro_registro = coalesce(nullif(excluded.primeiro_registro, ''), o.primeiro_registro),
      defeito           = coalesce(nullif(excluded.defeito, ''), o.defeito),
      observacao        = coalesce(nullif(excluded.observacao, ''), o.observacao),
      solucao           = coalesce(nullif(excluded.solucao, ''), o.solucao),
      vendedor          = coalesce(nullif(excluded.vendedor, ''), o.vendedor),
      aba_origem        = coalesce(nullif(excluded.aba_origem, ''), o.aba_origem),
      linha_origem      = coalesce(excluded.linha_origem, o.linha_origem),
      atualizado_em     = now()
    where (coalesce(nullif(excluded.numero, ''), o.numero), coalesce(excluded.data, o.data),
           coalesce(nullif(excluded.tecnico, ''), o.tecnico), coalesce(nullif(excluded.cliente, ''), o.cliente),
           coalesce(nullif(excluded.equipamento, ''), o.equipamento),
           coalesce(nullif(excluded.garantia, ''), o.garantia),
           coalesce(nullif(excluded.primeiro_registro, ''), o.primeiro_registro),
           coalesce(nullif(excluded.defeito, ''), o.defeito), coalesce(nullif(excluded.observacao, ''), o.observacao),
           coalesce(nullif(excluded.solucao, ''), o.solucao), coalesce(nullif(excluded.vendedor, ''), o.vendedor))
          is distinct from
          (o.numero, o.data, o.tecnico, o.cliente, o.equipamento, o.garantia, o.primeiro_registro, o.defeito,
           o.observacao, o.solucao, o.vendedor)
    returning o.id, (o.xmax = 0) into v_id, v_novo;

    if v_id is null then
      select o.id into v_id from sat_os o where o.chave = v_os->>'chave';
    elsif v_novo then
      v_os_novas := v_os_novas + 1;
    else
      v_os_atual := v_os_atual + 1;
    end if;

    for v_it in select e from jsonb_array_elements(coalesce(v_os->'itens', '[]'::jsonb)) e loop
      if coalesce(v_it->>'chave', '') = '' then raise exception 'ITEM_SEM_CHAVE'; end if;
      v_item_id := null;
      insert into sat_os_itens as i (os_id, chave, ns_escrito, modelo, sequencia, codigo_peca, peca, quantidade, data)
      values (v_id, v_it->>'chave', coalesce(v_it->>'ns', ''), nullif(v_it->>'modelo', ''),
              nullif(v_it->>'sequencia', ''), coalesce(v_it->>'codigo_peca', ''), coalesce(v_it->>'peca', ''),
              nullif(v_it->>'quantidade', '')::numeric, nullif(v_it->>'data', '')::date)
      on conflict (os_id, chave) do update set
        ns_escrito    = coalesce(nullif(excluded.ns_escrito, ''), i.ns_escrito),
        codigo_peca   = coalesce(nullif(excluded.codigo_peca, ''), i.codigo_peca),
        peca          = coalesce(nullif(excluded.peca, ''), i.peca),
        quantidade    = coalesce(excluded.quantidade, i.quantidade),
        atualizado_em = now()
      where (coalesce(nullif(excluded.ns_escrito, ''), i.ns_escrito),
             coalesce(nullif(excluded.codigo_peca, ''), i.codigo_peca), coalesce(nullif(excluded.peca, ''), i.peca),
             coalesce(excluded.quantidade, i.quantidade))
            is distinct from (i.ns_escrito, i.codigo_peca, i.peca, i.quantidade)
      returning i.id, (i.xmax = 0) into v_item_id, v_novo;
      if v_item_id is not null then
        if v_novo then v_it_novos := v_it_novos + 1; else v_it_atual := v_it_atual + 1; end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('os_novas', v_os_novas, 'os_atualizadas', v_os_atual,
                            'itens_novos', v_it_novos, 'itens_atualizados', v_it_atual);
end
$func$;

revoke all on function public.sat_sincronizar_planilha(jsonb) from public, anon, authenticated;
grant execute on function public.sat_sincronizar_planilha(jsonb) to service_role;

-- ---------- sat_consultar_ns: o que o repinmetro e o ShopFloor sabem do NS (sat.visualizar) ----------
-- p_modelo/p_sequencia: o par normalizado (sem zeros à esquerda); sem par, o repinmetro não é consultado.
-- p_sns_norm: as formas normalizadas do NS (normalizarSerie) para casar com o bipe do ShopFloor (até 10).
create or replace function public.sat_consultar_ns(p_modelo text, p_sequencia text, p_sns_norm text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_revendas  jsonb := '[]'::jsonb;
  v_producao  jsonb := '[]'::jsonb;
  v_shopfloor jsonb := '[]'::jsonb;
  v_sns       text[];
begin
  if not tem_permissao('sat', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  if coalesce(p_modelo, '') <> '' and coalesce(p_sequencia, '') <> '' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero_serie_completo', r.numero_serie_completo, 'revenda', r.revenda,
             'gravada_em', r.gravada_em, 'saida_em', r.saida_em) order by r.gravada_em desc nulls last), '[]'::jsonb)
      into v_revendas
      from repinmetro_revendas r
     where r.numero_serie_norm = p_sequencia and ltrim(r.modelo, '0') = p_modelo;

    select coalesce(jsonb_agg(x.j order by x.inicio desc nulls last), '[]'::jsonb) into v_producao
      from (select p.data_inicio as inicio, jsonb_build_object(
                     'numero_serie', p.numero_serie, 'modelo', p.modelo, 'data_inicio', p.data_inicio,
                     'data_fim', p.data_fim, 'status', p.status,
                     'serial_impressora', p.serial_impressora, 'serial_mrp', p.serial_mrp,
                     'serial_modulo_bio', p.serial_modulo_bio, 'serial_rfid', p.serial_rfid,
                     'serial_fonte', p.serial_fonte, 'serial_barras', p.serial_barras) as j
              from repinmetro_producao p
             where p.numero_serie_norm = p_sequencia and ltrim(coalesce(p.modelo, ''), '0') = p_modelo
             order by p.data_inicio desc nulls last
             limit 5) x;
  end if;

  select array_agg(distinct s) into v_sns
    from unnest(coalesce(p_sns_norm, '{}'::text[])) s where coalesce(s, '') <> '';
  if v_sns is not null and cardinality(v_sns) > 10 then raise exception 'NS_DEMAIS'; end if;

  if v_sns is not null then
    select coalesce(jsonb_agg(x.j order by x.ultimo desc), '[]'::jsonb) into v_shopfloor
      from (select g.ultimo, jsonb_build_object(
                     'pmo', g.pmo, 'op', g.op, 'cliente', g.cliente, 'ultimo_posto', g.ultimo_posto,
                     'ultimo_em', g.ultimo, 'descricao', coalesce(o.descricao, '')) as j
              from (select r.pmo, r.op, max(r.cliente) as cliente, max(r.data_hora) as ultimo,
                           (array_agg(r.posto order by r.data_hora desc))[1] as ultimo_posto
                      from sf_registros r
                     where r.numero_serie_norm = any (v_sns)
                     group by r.pmo, r.op) g
              left join sf_ordens o on o.pmo = g.pmo and o.op = g.op
             order by g.ultimo desc
             limit 10) x;
  end if;

  return jsonb_build_object('revendas', v_revendas, 'producao', v_producao, 'shopfloor', v_shopfloor);
end
$func$;

revoke all on function public.sat_consultar_ns(text, text, text[]) from public, anon;
grant execute on function public.sat_consultar_ns(text, text, text[]) to authenticated, service_role;

-- ---------- sat__motivos: confere os motivos da situação e devolve os textos (uso interno) ----------
create or replace function public.sat__motivos(p_situacao text, p_ids uuid[])
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_ids    uuid[];
  v_textos text[];
begin
  if p_situacao is null or p_situacao not in ('aprovada', 'reprovada') then raise exception 'SITUACAO_INVALIDA'; end if;
  select array_agg(distinct m) into v_ids from unnest(coalesce(p_ids, '{}'::uuid[])) m where m is not null;
  if p_situacao = 'aprovada' then
    if v_ids is not null then raise exception 'MOTIVO_EM_NF_APROVADA'; end if;
    return '{}'::text[];
  end if;
  if v_ids is null then raise exception 'MOTIVO_OBRIGATORIO'; end if;
  select array_agg(m.texto order by m.texto) into v_textos
    from sat_motivos_nf m where m.id = any (v_ids) and m.ativo;
  if v_textos is null or cardinality(v_textos) <> cardinality(v_ids) then raise exception 'MOTIVO_INVALIDO'; end if;
  return v_textos;
end
$func$;

revoke all on function public.sat__motivos(text, uuid[]) from public, anon, authenticated;

-- ---------- sat_registrar_entrada: a tela de entrada grava aqui (sat.registrar_entrada) ----------
-- p = {ns, modelo, sequencia, os_id, empresa, cnpj, produto, nf, valor, frete, itens_junto, itens_junto_outros,
--      defeito, locacao, custo, nf_situacao, motivos: [uuid]}. Devolve {id, os_numero, motivos: [texto]}.
create or replace function public.sat_registrar_entrada(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_nome     text;
  v_motivos  text[];
  v_itens    text[];
  v_os_id    uuid;
  v_os_num   text := '';
  v_id       uuid;
  v_nf       text;
  v_situacao text;
begin
  if not tem_permissao('sat', 'registrar_entrada') then raise exception 'SEM_PERMISSAO'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'ENTRADA_INVALIDA'; end if;
  if coalesce(btrim(p->>'ns'), '') = '' then raise exception 'NS_OBRIGATORIO'; end if;
  v_nf := btrim(coalesce(p->>'nf', ''));
  if v_nf = '' then raise exception 'NF_OBRIGATORIA'; end if;
  v_situacao := p->>'nf_situacao';
  v_motivos := sat__motivos(v_situacao,
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'motivos', '[]'::jsonb)) x));

  select coalesce(array_agg(distinct x), '{}'::text[]) into v_itens
    from jsonb_array_elements_text(coalesce(p->'itens_junto', '[]'::jsonb)) x;
  if 'outros' = any (v_itens) and coalesce(btrim(p->>'itens_junto_outros'), '') = '' then
    raise exception 'OUTROS_SEM_TEXTO';
  end if;

  v_os_id := nullif(p->>'os_id', '')::uuid;
  if v_os_id is not null then
    select o.numero into v_os_num from sat_os o where o.id = v_os_id;
    if not found then raise exception 'OS_NAO_ENCONTRADA'; end if;
  end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome from usuarios u where u.id = auth.uid();

  insert into sat_entradas (ns_escrito, modelo, sequencia, os_id, os_numero, empresa, cnpj, produto, nf, valor,
                            frete, itens_junto, itens_junto_outros, defeito, locacao, custo, nf_situacao,
                            nf_motivos, responsavel, responsavel_nome)
  values (btrim(p->>'ns'), nullif(p->>'modelo', ''), nullif(p->>'sequencia', ''), v_os_id, coalesce(v_os_num, ''),
          btrim(coalesce(p->>'empresa', '')), btrim(coalesce(p->>'cnpj', '')), btrim(coalesce(p->>'produto', '')),
          v_nf, nullif(p->>'valor', '')::numeric, nullif(p->>'frete', ''), v_itens,
          case when 'outros' = any (v_itens) then btrim(coalesce(p->>'itens_junto_outros', '')) else '' end,
          btrim(coalesce(p->>'defeito', '')), btrim(coalesce(p->>'locacao', '')), nullif(p->>'custo', '')::numeric,
          v_situacao, v_motivos, auth.uid(), coalesce(v_nome, ''))
  returning id into v_id;

  insert into sat_entradas_historico (entrada_id, tipo, nf_para, situacao_para, motivos, usuario, usuario_nome)
  values (v_id, 'entrada', v_nf, v_situacao, v_motivos, auth.uid(), coalesce(v_nome, ''));

  return jsonb_build_object('id', v_id, 'os_numero', coalesce(v_os_num, ''), 'motivos', to_jsonb(v_motivos));
end
$func$;

revoke all on function public.sat_registrar_entrada(jsonb) from public, anon;
grant execute on function public.sat_registrar_entrada(jsonb) to authenticated, service_role;

-- ---------- sat_corrigir_nf: a MESMA nota muda de situação (sat.aprovar_nf) ----------
-- Devolve {ns, empresa, os_numero, nf_de, nf_para, situacao_de, situacao_para, motivos} (para o aviso).
create or replace function public.sat_corrigir_nf(p_entrada uuid, p_situacao text, p_motivos uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_e       sat_entradas;
  v_motivos text[];
  v_nome    text;
begin
  if not tem_permissao('sat', 'aprovar_nf') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_e from sat_entradas e where e.id = p_entrada for update;
  if not found then raise exception 'ENTRADA_NAO_ENCONTRADA'; end if;
  v_motivos := sat__motivos(p_situacao, p_motivos);
  if p_situacao = v_e.nf_situacao and v_motivos = v_e.nf_motivos then raise exception 'NADA_A_MUDAR'; end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome from usuarios u where u.id = auth.uid();
  update sat_entradas set nf_situacao = p_situacao, nf_motivos = v_motivos, atualizado_em = now()
   where id = p_entrada;
  insert into sat_entradas_historico (entrada_id, tipo, nf_de, situacao_de, nf_para, situacao_para, motivos,
                                      usuario, usuario_nome)
  values (p_entrada, 'correcao', v_e.nf, v_e.nf_situacao, v_e.nf, p_situacao, v_motivos, auth.uid(),
          coalesce(v_nome, ''));

  return jsonb_build_object('ns', v_e.ns_escrito, 'empresa', v_e.empresa, 'os_numero', v_e.os_numero,
                            'nf_de', v_e.nf, 'nf_para', v_e.nf, 'situacao_de', v_e.nf_situacao,
                            'situacao_para', p_situacao, 'motivos', to_jsonb(v_motivos));
end
$func$;

revoke all on function public.sat_corrigir_nf(uuid, text, uuid[]) from public, anon;
grant execute on function public.sat_corrigir_nf(uuid, text, uuid[]) to authenticated, service_role;

-- ---------- sat_trocar_nf: nota NOVA; a antiga fica no histórico como substituída (sat.aprovar_nf) ----------
create or replace function public.sat_trocar_nf(p_entrada uuid, p_nf text, p_situacao text, p_motivos uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_e       sat_entradas;
  v_motivos text[];
  v_nome    text;
  v_nf      text := btrim(coalesce(p_nf, ''));
begin
  if not tem_permissao('sat', 'aprovar_nf') then raise exception 'SEM_PERMISSAO'; end if;
  if v_nf = '' then raise exception 'NF_OBRIGATORIA'; end if;
  select * into v_e from sat_entradas e where e.id = p_entrada for update;
  if not found then raise exception 'ENTRADA_NAO_ENCONTRADA'; end if;
  if lower(v_nf) = lower(btrim(v_e.nf)) then raise exception 'MESMA_NF'; end if;
  v_motivos := sat__motivos(p_situacao, p_motivos);

  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome from usuarios u where u.id = auth.uid();
  update sat_entradas set nf = v_nf, nf_situacao = p_situacao, nf_motivos = v_motivos, atualizado_em = now()
   where id = p_entrada;
  insert into sat_entradas_historico (entrada_id, tipo, nf_de, situacao_de, nf_para, situacao_para, motivos,
                                      usuario, usuario_nome)
  values (p_entrada, 'troca', v_e.nf, v_e.nf_situacao, v_nf, p_situacao, v_motivos, auth.uid(), coalesce(v_nome, ''));

  return jsonb_build_object('ns', v_e.ns_escrito, 'empresa', v_e.empresa, 'os_numero', v_e.os_numero,
                            'nf_de', v_e.nf, 'nf_para', v_nf, 'situacao_de', v_e.nf_situacao,
                            'situacao_para', p_situacao, 'motivos', to_jsonb(v_motivos));
end
$func$;

revoke all on function public.sat_trocar_nf(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.sat_trocar_nf(uuid, text, text, uuid[]) to authenticated, service_role;

-- ---------- sat_motivo_salvar: cadastro dos motivos (sat.administrar) ----------
-- p_id null = novo. Texto repetido (sem diferenciar maiúscula) estoura unique_violation.
create or replace function public.sat_motivo_salvar(p_id uuid, p_texto text, p_ativo boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id    uuid;
begin
  if not tem_permissao('sat', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_texto = '' or length(v_texto) > 200 then raise exception 'TEXTO_INVALIDO'; end if;
  if p_id is null then
    insert into sat_motivos_nf (texto, ativo) values (v_texto, coalesce(p_ativo, true)) returning id into v_id;
  else
    update sat_motivos_nf set texto = v_texto, ativo = coalesce(p_ativo, ativo) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'MOTIVO_NAO_ENCONTRADO'; end if;
  end if;
  return v_id;
end
$func$;

revoke all on function public.sat_motivo_salvar(uuid, text, boolean) from public, anon;
grant execute on function public.sat_motivo_salvar(uuid, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
