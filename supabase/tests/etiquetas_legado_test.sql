-- Testes das funções e do índice único das etiquetas do estoque legado (migração 0126).
-- Roda num Postgres descartável: supabase/tests/rodar-etiquetas-legado-test.sh
-- Tudo numa única conexão (as configurações de sessão `teste.*` alimentam os stubs de auth/RBAC).

-- ---------- stubs mínimos do Supabase ----------
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;
-- `teste.perms` = lista 'modulo.permissao' separada por vírgula.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

create table public.usuarios (
  id    uuid primary key,
  nome  text not null default '',
  email text not null default ''
);
insert into public.usuarios (id, nome, email)
values ('00000000-0000-0000-0000-000000000001', 'Ana Gestora', 'ana@enterplak.com.br');

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'recebimento.gerar_etiqueta,recebimento.visualizar', false);

\i /tmp/0126.sql

-- ---------- helper: emitir uma leva e mostrar o resultado ----------
create function public.leva(p_linhas jsonb)
returns table (ordem int, codigo text) language sql as $f$
  select e.ordem, e.codigo from public.etq_legado_emitir(p_linhas) e order by e.ordem
$f$;

\echo '--- 1. sequencial contínuo por item entre levas ---'
-- Leva da coluna A1: dois rolos do MESMO item.
select * from public.leva('[{"item":"CAPA78","locacao":"A1.C.39"},{"item":"CAPA78","locacao":"A1.C.40"}]'::jsonb);
do $t$
declare v text[];
begin
  select array_agg(codigo order by sequencial) into v from public.etiquetas_legado where item = 'CAPA78';
  if v <> array['CAPA78-L0001','CAPA78-L0002'] then
    raise exception 'esperava L0001/L0002, veio %', v;
  end if;
end $t$;

-- Leva da coluna B1, DEPOIS: o contador continua de onde parou (não reinicia).
select * from public.leva('[{"item":"CAPA78","locacao":"B1.D.12"}]'::jsonb);
do $t$
declare v text[];
begin
  select array_agg(codigo order by sequencial) into v from public.etiquetas_legado where item = 'CAPA78';
  if v <> array['CAPA78-L0001','CAPA78-L0002','CAPA78-L0003'] then
    raise exception 'o contador reiniciou: %', v;
  end if;
end $t$;
\echo 'ok'

\echo '--- 2. itens diferentes têm sequenciais independentes ---'
select * from public.leva('[{"item":"RESY99","locacao":"A1.C.71"},{"item":"TRA234","locacao":"A1.C.53"},{"item":"RESY99","locacao":"A1.C.72"}]'::jsonb);
do $t$
declare v text[];
begin
  select array_agg(codigo order by item, sequencial) into v
    from public.etiquetas_legado where item in ('RESY99','TRA234');
  if v <> array['RESY99-L0001','RESY99-L0002','TRA234-L0001'] then
    raise exception 'sequenciais vazaram entre itens: %', v;
  end if;
end $t$;
\echo 'ok'

\echo '--- 3. o código gerado passa nas regras do Setup (prefixo = componente, lote não vazio) ---'
-- Espelha separarRolo/st_rolo_prefixo: parte no PRIMEIRO separador.
do $t$
declare r record;
begin
  for r in select codigo, item from public.etiquetas_legado loop
    if split_part(r.codigo, '-', 1) <> r.item then
      raise exception 'prefixo % não é o componente % (código %)', split_part(r.codigo, '-', 1), r.item, r.codigo;
    end if;
    if btrim(substring(r.codigo from position('-' in r.codigo) + 1)) = '' then
      raise exception 'lote vazio no código %', r.codigo;
    end if;
  end loop;
end $t$;
\echo 'ok'

\echo '--- 4. item vazio ou com separador é recusado pela função ---'
do $t$
declare v text;
begin
  begin
    perform public.etq_legado_emitir('[{"item":"","locacao":"A1.C.01"}]'::jsonb);
    raise exception 'item vazio passou';
  exception when others then
    if sqlerrm <> 'ITEM_INVALIDO' then raise; end if;
  end;
  begin
    perform public.etq_legado_emitir('[{"item":"CAP 986","locacao":"A1.C.15"}]'::jsonb);
    raise exception 'item com espaço passou';
  exception when others then
    if sqlerrm <> 'ITEM_INVALIDO' then raise; end if;
  end;
  begin
    perform public.etq_legado_emitir('[{"item":"CAP-986","locacao":"A1.C.15"}]'::jsonb);
    raise exception 'item com hífen passou';
  exception when others then
    if sqlerrm <> 'ITEM_INVALIDO' then raise; end if;
  end;
  -- Locação malformada NÃO impede a geração (a locação não vai para a etiqueta).
  perform public.etq_legado_emitir('[{"item":"CAPF47","locacao":"A1.C37"}]'::jsonb);
  select codigo into v from public.etiquetas_legado where item = 'CAPF47';
  if v <> 'CAPF47-L0001' then raise exception 'locação malformada barrou a geração: %', v; end if;
end $t$;
\echo 'ok'

\echo '--- 5. a conferência devolve repetição por item+locação, com a data, e o último sequencial ---'
select item, locacao, emitidas_na_locacao, (ultima_na_locacao is not null) as tem_data, ultimo_sequencial
  from public.etq_legado_conferir(
    '[{"item":"CAPA78","locacao":"A1.C.39"},{"item":"CAPA78","locacao":"Z9.E.99"},{"item":"NOVO01","locacao":"A1.C.02"}]'::jsonb
  );
do $t$
declare r record;
begin
  select * into r from public.etq_legado_conferir('[{"item":"CAPA78","locacao":"A1.C.39"}]'::jsonb);
  if r.emitidas_na_locacao <> 1 or r.ultima_na_locacao is null or r.ultimo_sequencial <> 3 then
    raise exception 'conferência errada: % / % / %', r.emitidas_na_locacao, r.ultima_na_locacao, r.ultimo_sequencial;
  end if;
  select * into r from public.etq_legado_conferir('[{"item":"NOVO01","locacao":"A1.C.02"}]'::jsonb);
  if r.emitidas_na_locacao <> 0 or r.ultima_na_locacao is not null or r.ultimo_sequencial <> 0 then
    raise exception 'item novo não deveria ter histórico: %', r.emitidas_na_locacao;
  end if;
end $t$;
\echo 'ok'

\echo '--- 7. sem `recebimento: gerar_etiqueta`, as três funções recusam ---'
select set_config('teste.perms', 'recebimento.visualizar', false);
do $t$
begin
  begin
    perform public.etq_legado_emitir('[{"item":"CAPG05","locacao":"A1.C.65"}]'::jsonb);
    raise exception 'emitir passou sem permissão';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform public.etq_legado_conferir('[{"item":"CAPG05","locacao":"A1.C.65"}]'::jsonb);
    raise exception 'conferir passou sem permissão';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform public.etq_legado_resumo();
    raise exception 'resumo passou sem permissão';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'recebimento.gerar_etiqueta,recebimento.visualizar', false);
\echo 'ok'

\echo '--- 8. o BANCO recusa (item, sequencial) duplicado, mesmo que a aplicação erre ---'
do $t$
begin
  -- Insert direto, por fora da função: é o cenário "o app errou".
  begin
    insert into public.etiquetas_legado (item, sequencial, codigo)
    values ('CAPA78', 1, 'CAPA78-L0001-copia');
    raise exception 'o índice único de (item, sequencial) não barrou';
  exception when unique_violation then
    null;
  end;
  -- E o código repetido também não passa (segundo cinto).
  begin
    insert into public.etiquetas_legado (item, sequencial, codigo)
    values ('CAPA78', 99, 'CAPA78-L0001');
    raise exception 'o índice único de codigo não barrou';
  exception when unique_violation then
    null;
  end;
end $t$;
\echo 'ok'

\echo '--- resumo do mutirão ---'
select * from public.etq_legado_resumo();

\echo '--- acima de 9999 o número vai inteiro (lpad trunca) ---'
select public.etq_legado_codigo('CAPA78', 9999) as nove_mil, public.etq_legado_codigo('CAPA78', 10000) as dez_mil;
do $t$
begin
  if public.etq_legado_codigo('CAPA78', 9999) <> 'CAPA78-L9999' then raise exception 'pad de 4 quebrou'; end if;
  if public.etq_legado_codigo('CAPA78', 10000) <> 'CAPA78-L10000' then raise exception 'truncou acima de 9999'; end if;
end $t$;
\echo 'ok'

\echo 'TODOS OS TESTES DA 0126 PASSARAM'
