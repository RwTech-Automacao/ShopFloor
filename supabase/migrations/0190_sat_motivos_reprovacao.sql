-- =============================================================
-- 0190 — SAT: motivos de reprovação da NF (lista fixa) + "Outro" com o texto digitado.
--
-- A tela de cadastro de motivos saiu (0187), então a lista vem daqui. Hoje `sat_motivos_nf` está vazia em Prod e a
-- NF "reprovada" não grava. Esta migração:
--   - `sat_motivos_nf` ganha `ordem` (a ordem na tela) e `exige_texto` (o motivo pede um texto: só o "Outro").
--   - Grava os 6 motivos, nesta ordem (pelo texto, sem diferenciar maiúscula — índice sat_motivos_nf_texto):
--       1 Sem nota fiscal (só declaração dos Correios) · 2 CFOP errado · 3 Natureza de operação errada ·
--       4 Descrição errada · 5 CNPJ da RW errado na nota · 6 Outro (a pessoa digita o motivo, até 200 caracteres).
--     Qualquer outro motivo que exista na tabela é DESATIVADO (as notas antigas guardam o texto; nada se perde).
--   - `sat__motivos(situacao, ids, outro)`: o texto do "Outro" é obrigatório quando ele está marcado
--     (OUTRO_SEM_TEXTO; acima de 200 → OUTRO_TEXTO_LONGO) e é ignorado quando não está. Na nota fica
--     'Outro: <texto>'. Os textos voltam na `ordem`. A versão de 2 argumentos sai (ninguém mais a usa).
--   - sat_registrar_nf e sat_trocar_nf leem `p->>'motivo_outro'`; sat_corrigir_nf ganha `p_motivo_outro`
--     (assinatura nova: a de 3 argumentos sai). O resto das três funções é idêntico à 0187.
-- Precisa do deploy do app junto (a tela manda o texto do "Outro"). Idempotente; reaplicar não muda nada.
--
--   RDS:  psql ... -1 -v ON_ERROR_STOP=1 -f 0190_sat_motivos_reprovacao.sql
-- =============================================================

-- ---------- colunas novas ----------
alter table public.sat_motivos_nf add column if not exists ordem int;
alter table public.sat_motivos_nf add column if not exists exige_texto boolean not null default false;

-- ---------- a lista ----------
insert into public.sat_motivos_nf as m (texto, ordem, ativo, exige_texto)
values ('Sem nota fiscal (só declaração dos Correios)', 1, true, false),
       ('CFOP errado',                                  2, true, false),
       ('Natureza de operação errada',                  3, true, false),
       ('Descrição errada',                             4, true, false),
       ('CNPJ da RW errado na nota',                    5, true, false),
       ('Outro',                                        6, true, true)
on conflict ((lower(btrim(texto)))) do update
   set texto = excluded.texto, ordem = excluded.ordem, ativo = true, exige_texto = excluded.exige_texto
 where (m.texto, m.ordem, m.ativo, m.exige_texto)
       is distinct from (excluded.texto, excluded.ordem, true, excluded.exige_texto);

update public.sat_motivos_nf
   set ativo = false
 where ativo
   and lower(btrim(texto)) not in ('sem nota fiscal (só declaração dos correios)', 'cfop errado',
                                   'natureza de operação errada', 'descrição errada', 'cnpj da rw errado na nota',
                                   'outro');

-- ---------- sat__motivos: confere os motivos da situação e devolve os textos (uso interno) ----------
-- p_outro: o texto do motivo que exige texto ("Outro"); obrigatório se ele está marcado, ignorado se não está.
drop function if exists public.sat__motivos(text, uuid[]);

create or replace function public.sat__motivos(p_situacao text, p_ids uuid[], p_outro text)
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
  v_outro  text := regexp_replace(btrim(coalesce(p_outro, '')), '\s+', ' ', 'g');
begin
  if p_situacao is null or p_situacao not in ('aprovada', 'reprovada') then raise exception 'SITUACAO_INVALIDA'; end if;
  select array_agg(distinct m) into v_ids from unnest(coalesce(p_ids, '{}'::uuid[])) m where m is not null;
  if p_situacao = 'aprovada' then
    if v_ids is not null then raise exception 'MOTIVO_EM_NF_APROVADA'; end if;
    return '{}'::text[];
  end if;
  if v_ids is null then raise exception 'MOTIVO_OBRIGATORIO'; end if;
  if exists (select 1 from sat_motivos_nf m where m.id = any (v_ids) and m.ativo and m.exige_texto) then
    if v_outro = '' then raise exception 'OUTRO_SEM_TEXTO'; end if;
    if length(v_outro) > 200 then raise exception 'OUTRO_TEXTO_LONGO'; end if;
  end if;
  select array_agg(case when m.exige_texto then m.texto || ': ' || v_outro else m.texto end
                   order by m.ordem nulls last, m.texto)
    into v_textos
    from sat_motivos_nf m where m.id = any (v_ids) and m.ativo;
  if v_textos is null or cardinality(v_textos) <> cardinality(v_ids) then raise exception 'MOTIVO_INVALIDO'; end if;
  return v_textos;
end
$func$;

revoke all on function public.sat__motivos(text, uuid[], text) from public, anon, authenticated;

-- ---------- sat_registrar_nf: a tela de entrada grava a nota e os relógios (sat.registrar_entrada) ----------
-- p = {numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos: [uuid], motivo_outro,
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
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'motivos', '[]'::jsonb)) x),
    p->>'motivo_outro');
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

-- a assinatura muda (ganha p_motivo_outro): a de 3 argumentos sai antes
drop function if exists public.sat_corrigir_nf(uuid, text, uuid[]);

-- ---------- sat_corrigir_nf: a MESMA nota muda de situação, para todos os relógios (sat.aprovar_nf) ----------
create or replace function public.sat_corrigir_nf(p_nf uuid, p_situacao text, p_motivos uuid[],
                                                  p_motivo_outro text default null)
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
  v_motivos := sat__motivos(p_situacao, p_motivos, p_motivo_outro);
  if p_situacao = v_n.situacao and v_motivos = v_n.motivos then raise exception 'NADA_A_MUDAR'; end if;
  v_nome := sat__nome_usuario();

  update sat_nfs set situacao = p_situacao, motivos = v_motivos, atualizado_em = now() where id = p_nf;
  insert into sat_historico (nf_id, tipo, de, para, motivos, usuario, usuario_nome)
  values (p_nf, 'correcao', jsonb_build_object('numero', v_n.numero, 'situacao', v_n.situacao),
          jsonb_build_object('numero', v_n.numero, 'situacao', p_situacao), v_motivos, auth.uid(), v_nome);
  return sat__resumo_mudanca(v_n, p_nf);
end
$func$;

revoke all on function public.sat_corrigir_nf(uuid, text, uuid[], text) from public, anon;
grant execute on function public.sat_corrigir_nf(uuid, text, uuid[], text) to authenticated, service_role;

-- ---------- sat_trocar_nf: nota NOVA (número, CNPJ, empresa, valor, situação); vale para todos os relógios ----------
-- p = {numero, cnpj, empresa, negociante_codigo, valor, situacao, motivos: [uuid], motivo_outro}
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
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'motivos', '[]'::jsonb)) x),
    p->>'motivo_outro');
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

notify pgrst, 'reload schema';
