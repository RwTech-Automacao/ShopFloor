-- 0187 — SAT: entrada por NF (spec docs/superpowers/specs/2026-11-17-sat-entrada-por-nf-design.md).
--
-- A entrada passa a ser UMA NOTA com N relógios:
--   - `sat_nfs` (nova): a nota — número, CNPJ, empresa, valor, situação (aprovada/reprovada + motivos), quem/quando.
--   - `sat_entradas`: um relógio; ganha `nf_id` e perde o que é da nota (nf, valor, empresa, cnpj, situação, motivos)
--     e o que saiu da tela (frete, custo, defeito — o defeito vem da OS).
--   - `sat_historico` (substitui `sat_entradas_historico`): entrada / correção / troca da nota e troca de OS.
--   - A OS de cada relógio é escolhida PELO BANCO (`sat__os_automatica`): a mais recente daquele NS com solução
--     "Envio ao SAT" ou "Troca do Relógio" que não esteja ligada a outra entrada. Índice único: uma OS, um relógio.
--   - Funções novas: sat_registrar_nf, sat_corrigir_nf(nf), sat_trocar_nf(nf, jsonb), sat_associar_os.
--     Saem: sat_registrar_entrada, sat_motivo_salvar e as versões antigas (por entrada) de corrigir/trocar.
--
-- Dados existentes: cada entrada vira uma nota (mesmo id), e o histórico antigo é copiado. Reaplicar não muda nada.
-- Se duas entradas antigas apontarem para a mesma OS, só a mais antiga fica com ela (o índice único exige).

-- ---------- a nota ----------
create table if not exists public.sat_nfs (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null check (btrim(numero) <> ''),
  cnpj              text not null default '',
  empresa           text not null default '',
  negociante_codigo text,
  valor             numeric(14, 2) check (valor >= 0),
  situacao          text not null check (situacao in ('aprovada', 'reprovada')),
  motivos           text[] not null default '{}',
  responsavel       uuid references public.usuarios(id) on delete set null,
  responsavel_nome  text not null default '',
  data              date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  -- reprovada ⇔ tem motivo
  constraint sat_nfs_motivos check ((situacao = 'reprovada') = (cardinality(motivos) > 0))
);
create index if not exists sat_nfs_criado_em on public.sat_nfs (criado_em desc);

alter table public.sat_entradas add column if not exists nf_id uuid references public.sat_nfs(id) on delete restrict;

-- ---------- histórico da nota e da OS ----------
create table if not exists public.sat_historico (
  id           uuid primary key default gen_random_uuid(),
  nf_id        uuid not null references public.sat_nfs(id) on delete cascade,
  -- só no tipo 'os' (a troca de OS é de um relógio; o resto é da nota inteira)
  entrada_id   uuid references public.sat_entradas(id) on delete cascade,
  tipo         text not null check (tipo in ('entrada', 'correcao', 'troca', 'os')),
  de           jsonb,
  para         jsonb not null default '{}'::jsonb,
  motivos      text[] not null default '{}',
  usuario      uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null default '',
  em           timestamptz not null default now(),
  constraint sat_historico_os check ((tipo = 'os') = (entrada_id is not null))
);
create index if not exists sat_historico_nf on public.sat_historico (nf_id, em);
create index if not exists sat_historico_entrada on public.sat_historico (entrada_id, em);

-- ---------- os dados antigos (só na primeira aplicação: enquanto `sat_entradas.nf` existir) ----------
do $migra$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sat_entradas' and column_name = 'nf') then
    execute $q$
      insert into public.sat_nfs (id, numero, cnpj, empresa, valor, situacao, motivos, responsavel, responsavel_nome,
                                  data, criado_em, atualizado_em)
      select e.id, e.nf, e.cnpj, e.empresa, e.valor, e.nf_situacao, e.nf_motivos, e.responsavel, e.responsavel_nome,
             e.data, e.criado_em, e.atualizado_em
        from public.sat_entradas e
       where e.nf_id is null
      on conflict (id) do nothing
    $q$;
    execute 'update public.sat_entradas set nf_id = id where nf_id is null';
    execute $q$
      insert into public.sat_historico (nf_id, tipo, de, para, motivos, usuario, usuario_nome, em)
      select h.entrada_id, h.tipo,
             case when h.nf_de is null then null
                  else jsonb_build_object('numero', h.nf_de, 'situacao', h.situacao_de) end,
             jsonb_build_object('numero', h.nf_para, 'situacao', h.situacao_para),
             h.motivos, h.usuario, h.usuario_nome, h.em
        from public.sat_entradas_historico h
    $q$;
    execute 'alter table public.sat_entradas drop constraint if exists sat_entradas_motivos';
    execute 'alter table public.sat_entradas drop column nf, drop column valor, drop column empresa, '
         || 'drop column cnpj, drop column frete, drop column custo, drop column defeito, '
         || 'drop column nf_situacao, drop column nf_motivos';
    execute 'drop table public.sat_entradas_historico';
  end if;
end
$migra$;

alter table public.sat_entradas alter column nf_id set not null;
create index if not exists sat_entradas_nf on public.sat_entradas (nf_id);

-- uma OS liga no máximo um relógio (entradas antigas repetidas: fica a mais antiga)
update public.sat_entradas e set os_id = null, os_numero = ''
 where e.os_id is not null
   and exists (select 1 from public.sat_entradas o
                where o.os_id = e.os_id and (o.criado_em, o.id) < (e.criado_em, e.id));
create unique index if not exists sat_entradas_os_unica on public.sat_entradas (os_id) where os_id is not null;

-- ---------- RLS: só leitura, com sat.visualizar ----------
alter table public.sat_nfs enable row level security;
alter table public.sat_historico enable row level security;
drop policy if exists sat_nfs_select on public.sat_nfs;
create policy sat_nfs_select on public.sat_nfs
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_historico_select on public.sat_historico;
create policy sat_historico_select on public.sat_historico
  for select using ((select tem_permissao('sat', 'visualizar')));

revoke all on public.sat_nfs, public.sat_historico from public, anon, authenticated;
grant select on public.sat_nfs, public.sat_historico to authenticated;
grant select, insert, update, delete on public.sat_nfs, public.sat_historico to service_role;

-- ---------- as funções antigas saem ----------
drop function if exists public.sat_registrar_entrada(jsonb);
drop function if exists public.sat_motivo_salvar(uuid, text, boolean);
drop function if exists public.sat_corrigir_nf(uuid, text, uuid[]);
drop function if exists public.sat_trocar_nf(uuid, text, text, uuid[]);

-- ---------- auxiliares (uso interno) ----------
-- Solução em que o equipamento VOLTA para a fábrica (mesma regra de `voltaParaFabrica` no app).
create or replace function public.sat__volta_para_fabrica(p_solucao text)
returns boolean
language sql
immutable
set search_path = public
as $func$
  select upper(translate(coalesce(p_solucao, ''),
                         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         ~ '(ENVIO AO SAT|TROCA DO RELOGIO)'
$func$;
revoke all on function public.sat__volta_para_fabrica(text) from public, anon, authenticated;

-- A OS automática de um NS: a mais recente (data, depois número) que volta para a fábrica e está livre.
-- Sem modelo, casa só pela sequência (como a busca da tela).
create or replace function public.sat__os_automatica(p_modelo text, p_sequencia text)
returns uuid
language sql
stable
set search_path = public
as $func$
  select o.id
    from sat_os o
   where coalesce(p_sequencia, '') <> ''
     and exists (select 1 from sat_os_itens i
                  where i.os_id = o.id and i.sequencia = p_sequencia
                    and (coalesce(p_modelo, '') = '' or i.modelo = p_modelo))
     and sat__volta_para_fabrica(o.solucao)
     and not exists (select 1 from sat_entradas e where e.os_id = o.id)
   order by o.data desc nulls last, length(o.numero) desc, o.numero desc
   limit 1
$func$;
revoke all on function public.sat__os_automatica(text, text) from public, anon, authenticated;

create or replace function public.sat__nome_usuario()
returns text
language sql
stable
security definer
set search_path = public
as $func$
  select coalesce((select coalesce(nullif(btrim(u.nome), ''), u.email, '') from usuarios u where u.id = auth.uid()), '')
$func$;
revoke all on function public.sat__nome_usuario() from public, anon, authenticated;

-- CNPJ (14 dígitos) ou CPF (11), devolvido com máscara; outra coisa → CNPJ_INVALIDO.
create or replace function public.sat__cnpj(p text)
returns text
language plpgsql
immutable
set search_path = public
as $func$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 14 then
    return substr(d, 1, 2) || '.' || substr(d, 3, 3) || '.' || substr(d, 6, 3) || '/' || substr(d, 9, 4) || '-' || substr(d, 13, 2);
  elsif length(d) = 11 then
    return substr(d, 1, 3) || '.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-' || substr(d, 10, 2);
  end if;
  raise exception 'CNPJ_INVALIDO';
end
$func$;
revoke all on function public.sat__cnpj(text) from public, anon, authenticated;

-- ---------- sat_registrar_nf: a tela de entrada grava a nota e os relógios (sat.registrar_entrada) ----------
-- p = {numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos: [uuid],
--      relogios: [{ns, modelo, sequencia, produto, itens_junto: [..], itens_junto_outros, locacao}]}
-- Devolve {nf_id, motivos: [texto], relogios: [{id, ns, os_numero}]} (na ordem enviada).
create or replace function public.sat_registrar_nf(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_nome     text;
  v_numero   text;
  v_cnpj     text;
  v_situacao text;
  v_motivos  text[];
  v_nf_id    uuid;
  v_r        jsonb;
  v_itens    text[];
  v_os_id    uuid;
  v_os_num   text;
  v_ent_id   uuid;
  v_saida    jsonb := '[]'::jsonb;
  v_chaves   text[] := '{}';
  v_chave    text;
begin
  if not tem_permissao('sat', 'registrar_entrada') then raise exception 'SEM_PERMISSAO'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'ENTRADA_INVALIDA'; end if;
  v_numero := btrim(coalesce(p->>'numero', ''));
  if v_numero = '' then raise exception 'NF_OBRIGATORIA'; end if;
  v_cnpj := sat__cnpj(p->>'cnpj');
  if jsonb_typeof(p->'relogios') is distinct from 'array' or jsonb_array_length(p->'relogios') = 0 then
    raise exception 'SEM_RELOGIOS';
  end if;
  if jsonb_array_length(p->'relogios') > 200 then raise exception 'RELOGIOS_DEMAIS'; end if;
  v_situacao := p->>'situacao';
  v_motivos := sat__motivos(v_situacao,
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'motivos', '[]'::jsonb)) x));
  v_nome := sat__nome_usuario();

  -- a escolha da OS automática é serializada: duas notas ao mesmo tempo não disputam a mesma OS
  perform pg_advisory_xact_lock(hashtext('sat__os_automatica'));

  insert into sat_nfs (numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos, responsavel, responsavel_nome)
  values (v_numero, v_cnpj, btrim(coalesce(p->>'empresa', '')), nullif(btrim(coalesce(p->>'negociante_codigo', '')), ''),
          nullif(p->>'valor', '')::numeric, v_situacao, v_motivos, auth.uid(), v_nome)
  returning id into v_nf_id;

  for v_r in select e from jsonb_array_elements(p->'relogios') e loop
    if jsonb_typeof(v_r) <> 'object'
       or jsonb_typeof(coalesce(v_r->'itens_junto', '[]'::jsonb)) <> 'array' then raise exception 'ENTRADA_INVALIDA'; end if;
    if coalesce(btrim(v_r->>'ns'), '') = '' then raise exception 'NS_OBRIGATORIO'; end if;
    v_chave := case when coalesce(v_r->>'sequencia', '') <> ''
                    then coalesce(v_r->>'modelo', '') || '/' || (v_r->>'sequencia')
                    else '#' || upper(btrim(v_r->>'ns')) end;
    if v_chave = any (v_chaves) then raise exception 'NS_REPETIDO'; end if;
    v_chaves := v_chaves || v_chave;

    select coalesce(array_agg(distinct x), '{}'::text[]) into v_itens
      from jsonb_array_elements_text(coalesce(v_r->'itens_junto', '[]'::jsonb)) x;
    if not (v_itens <@ array['bobina', 'chave', 'fonte', 'outros']::text[]) then raise exception 'ITEM_INVALIDO'; end if;
    if 'outros' = any (v_itens) and coalesce(btrim(v_r->>'itens_junto_outros'), '') = '' then
      raise exception 'OUTROS_SEM_TEXTO';
    end if;

    v_os_id := sat__os_automatica(nullif(v_r->>'modelo', ''), nullif(v_r->>'sequencia', ''));
    v_os_num := '';
    if v_os_id is not null then select o.numero into v_os_num from sat_os o where o.id = v_os_id; end if;

    insert into sat_entradas (nf_id, ns_escrito, modelo, sequencia, os_id, os_numero, produto, itens_junto,
                              itens_junto_outros, locacao, responsavel, responsavel_nome)
    values (v_nf_id, btrim(v_r->>'ns'), nullif(v_r->>'modelo', ''), nullif(v_r->>'sequencia', ''), v_os_id,
            coalesce(v_os_num, ''), btrim(coalesce(v_r->>'produto', '')), v_itens,
            case when 'outros' = any (v_itens) then btrim(coalesce(v_r->>'itens_junto_outros', '')) else '' end,
            btrim(coalesce(v_r->>'locacao', '')), auth.uid(), v_nome)
    returning id into v_ent_id;
    v_saida := v_saida || jsonb_build_object('id', v_ent_id, 'ns', btrim(v_r->>'ns'), 'os_numero', coalesce(v_os_num, ''));
  end loop;

  insert into sat_historico (nf_id, tipo, para, motivos, usuario, usuario_nome)
  values (v_nf_id, 'entrada',
          jsonb_build_object('numero', v_numero, 'situacao', v_situacao, 'cnpj', v_cnpj,
                             'empresa', btrim(coalesce(p->>'empresa', '')), 'valor', nullif(p->>'valor', '')::numeric),
          v_motivos, auth.uid(), v_nome);

  return jsonb_build_object('nf_id', v_nf_id, 'motivos', to_jsonb(v_motivos), 'relogios', v_saida);
end
$func$;

revoke all on function public.sat_registrar_nf(jsonb) from public, anon;
grant execute on function public.sat_registrar_nf(jsonb) to authenticated, service_role;

-- Para o aviso: {nf_id, numero_de, numero_para, empresa, cnpj, situacao_de, situacao_para, motivos, ns: [..]}
create or replace function public.sat__resumo_mudanca(p_antes sat_nfs, p_nf uuid)
returns jsonb
language sql
stable
set search_path = public
as $func$
  select jsonb_build_object(
    'nf_id', n.id, 'numero_de', p_antes.numero, 'numero_para', n.numero, 'empresa', n.empresa, 'cnpj', n.cnpj,
    'situacao_de', p_antes.situacao, 'situacao_para', n.situacao, 'motivos', to_jsonb(n.motivos),
    'ns', coalesce((select jsonb_agg(e.ns_escrito order by e.criado_em, e.id) from sat_entradas e where e.nf_id = n.id),
                   '[]'::jsonb))
    from sat_nfs n where n.id = p_nf
$func$;
revoke all on function public.sat__resumo_mudanca(sat_nfs, uuid) from public, anon, authenticated;

-- ---------- sat_corrigir_nf: a MESMA nota muda de situação, para todos os relógios (sat.aprovar_nf) ----------
create or replace function public.sat_corrigir_nf(p_nf uuid, p_situacao text, p_motivos uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_n       sat_nfs;
  v_motivos text[];
  v_nome    text;
begin
  if not tem_permissao('sat', 'aprovar_nf') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_n from sat_nfs n where n.id = p_nf for update;
  if not found then raise exception 'NF_NAO_ENCONTRADA'; end if;
  v_motivos := sat__motivos(p_situacao, p_motivos);
  if p_situacao = v_n.situacao and v_motivos = v_n.motivos then raise exception 'NADA_A_MUDAR'; end if;
  v_nome := sat__nome_usuario();

  update sat_nfs set situacao = p_situacao, motivos = v_motivos, atualizado_em = now() where id = p_nf;
  insert into sat_historico (nf_id, tipo, de, para, motivos, usuario, usuario_nome)
  values (p_nf, 'correcao', jsonb_build_object('numero', v_n.numero, 'situacao', v_n.situacao),
          jsonb_build_object('numero', v_n.numero, 'situacao', p_situacao), v_motivos, auth.uid(), v_nome);
  return sat__resumo_mudanca(v_n, p_nf);
end
$func$;

revoke all on function public.sat_corrigir_nf(uuid, text, uuid[]) from public, anon;
grant execute on function public.sat_corrigir_nf(uuid, text, uuid[]) to authenticated, service_role;

-- ---------- sat_trocar_nf: nota NOVA (número, CNPJ, empresa, valor, situação); vale para todos os relógios ----------
-- p = {numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos: [uuid]}
create or replace function public.sat_trocar_nf(p_nf uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_n       sat_nfs;
  v_motivos text[];
  v_nome    text;
  v_numero  text;
  v_cnpj    text;
begin
  if not tem_permissao('sat', 'aprovar_nf') then raise exception 'SEM_PERMISSAO'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'ENTRADA_INVALIDA'; end if;
  v_numero := btrim(coalesce(p->>'numero', ''));
  if v_numero = '' then raise exception 'NF_OBRIGATORIA'; end if;
  v_cnpj := sat__cnpj(p->>'cnpj');
  select * into v_n from sat_nfs n where n.id = p_nf for update;
  if not found then raise exception 'NF_NAO_ENCONTRADA'; end if;
  if lower(v_numero) = lower(btrim(v_n.numero)) and v_cnpj = v_n.cnpj then raise exception 'MESMA_NF'; end if;
  v_motivos := sat__motivos(p->>'situacao',
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'motivos', '[]'::jsonb)) x));
  v_nome := sat__nome_usuario();

  update sat_nfs set numero = v_numero, cnpj = v_cnpj, empresa = btrim(coalesce(p->>'empresa', '')),
                     negociante_codigo = nullif(btrim(coalesce(p->>'negociante_codigo', '')), ''),
                     valor = nullif(p->>'valor', '')::numeric, situacao = p->>'situacao', motivos = v_motivos,
                     atualizado_em = now()
   where id = p_nf;
  insert into sat_historico (nf_id, tipo, de, para, motivos, usuario, usuario_nome)
  values (p_nf, 'troca',
          jsonb_build_object('numero', v_n.numero, 'situacao', v_n.situacao, 'cnpj', v_n.cnpj, 'empresa', v_n.empresa,
                             'valor', v_n.valor),
          jsonb_build_object('numero', v_numero, 'situacao', p->>'situacao', 'cnpj', v_cnpj,
                             'empresa', btrim(coalesce(p->>'empresa', '')), 'valor', nullif(p->>'valor', '')::numeric),
          v_motivos, auth.uid(), v_nome);
  return sat__resumo_mudanca(v_n, p_nf);
end
$func$;

revoke all on function public.sat_trocar_nf(uuid, jsonb) from public, anon;
grant execute on function public.sat_trocar_nf(uuid, jsonb) to authenticated, service_role;

-- ---------- sat_associar_os: o técnico troca a OS de um relógio (sat.associar_os) ----------
-- p_os null = sem OS. A OS precisa ter este NS e não estar em outra entrada.
-- Devolve {ns, os_de, os_para}.
create or replace function public.sat_associar_os(p_entrada uuid, p_os uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_e      sat_entradas;
  v_num    text := '';
begin
  if not tem_permissao('sat', 'associar_os') then raise exception 'SEM_PERMISSAO'; end if;
  perform pg_advisory_xact_lock(hashtext('sat__os_automatica'));
  select * into v_e from sat_entradas e where e.id = p_entrada for update;
  if not found then raise exception 'ENTRADA_NAO_ENCONTRADA'; end if;
  if p_os is not distinct from v_e.os_id then raise exception 'NADA_A_MUDAR'; end if;
  if p_os is not null then
    select o.numero into v_num from sat_os o where o.id = p_os;
    if not found then raise exception 'OS_NAO_ENCONTRADA'; end if;
    if not exists (select 1 from sat_os_itens i
                    where i.os_id = p_os and i.sequencia = v_e.sequencia
                      and (coalesce(v_e.modelo, '') = '' or i.modelo = v_e.modelo)) then
      raise exception 'OS_DE_OUTRO_NS';
    end if;
    if exists (select 1 from sat_entradas e where e.os_id = p_os and e.id <> p_entrada) then
      raise exception 'OS_EM_USO';
    end if;
  end if;

  update sat_entradas set os_id = p_os, os_numero = coalesce(v_num, ''), atualizado_em = now() where id = p_entrada;
  insert into sat_historico (nf_id, entrada_id, tipo, de, para, usuario, usuario_nome)
  values (v_e.nf_id, p_entrada, 'os',
          jsonb_build_object('os_id', v_e.os_id, 'os_numero', v_e.os_numero),
          jsonb_build_object('os_id', p_os, 'os_numero', coalesce(v_num, '')), auth.uid(), sat__nome_usuario());
  return jsonb_build_object('ns', v_e.ns_escrito, 'os_de', v_e.os_numero, 'os_para', coalesce(v_num, ''));
end
$func$;

revoke all on function public.sat_associar_os(uuid, uuid) from public, anon;
grant execute on function public.sat_associar_os(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
