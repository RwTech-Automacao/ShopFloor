-- =============================================================
-- Etiquetas do estoque legado (spec 2026-09-24-etiquetas-estoque-legado-design.md).
--
-- Material que entrou antes do ShopFloor nunca ganhou etiqueta e, sem etiqueta, não pode ser
-- bipado na montagem do Setup. Pedido/DI/NF desse material são irrecuperáveis, então a etiqueta
-- legado carrega só o que o Setup precisa:
--
--     CAPA78-L0001
--     └─ código do item ─┘ └ lote livre (L marca "legado" + sequencial do rolo)
--
-- O Setup parte o código no primeiro separador: antes = componente (confere com a estrutura da
-- PMO), depois = lote, texto livre (src/modules/setup/domain/codigo-rolo.ts / st_rolo_prefixo).
--
-- A REGRA CRÍTICA: o sequencial é POR ITEM e CONTÍNUO PARA SEMPRE — nunca reinicia a cada
-- planilha. Dois rolos com o mesmo código fazem o Setup tratá-los como um só (recusa "já
-- montado" ou aceita no lugar errado), e isso é falha silenciosa no chão de fábrica. Por isso:
--   1) quem atribui o sequencial é o BANCO (etq_legado_emitir), numa transação só;
--   2) o par (item, sequencial) tem índice ÚNICO — a garantia não depende de o app estar certo.
-- O pior caso possível passa a ser um rolo com duas etiquetas (desperdício visível), nunca dois
-- rolos com a mesma.
--
-- Ferramenta de mutirão: roda uma vez sobre o estoque antigo. Nada aqui altera a etiqueta do
-- material novo, o Recebimento, o Setup ou a impressão.
--
-- Corpo das funções com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- Aditiva e idempotente: `if not exists` + `create or replace` + `drop policy if exists`.
-- Reaplicar não faz mal.
-- =============================================================

-- ---------- a tabela do que já foi emitido ----------
-- `codigo` é derivado de (item, sequencial), mas fica gravado: é o que está impresso e colado no
-- rolo, e o índice único nele é o segundo cinto de segurança contra código repetido.
-- `locacao` é a posição de onde o rolo saiu (só para reconhecer repetição na prévia da próxima
-- leva — não vai para a etiqueta, e a posição muda com o tempo).
create table if not exists public.etiquetas_legado (
  id           uuid primary key default gen_random_uuid(),
  item         text not null,
  sequencial   int  not null,
  codigo       text not null,
  locacao      text not null default '',
  usuario_id   uuid references public.usuarios(id),
  usuario_nome text not null default '',
  created_at   timestamptz not null default now(),
  constraint etiquetas_legado_item_preenchido check (btrim(item) <> ''),
  constraint etiquetas_legado_sequencial_positivo check (sequencial >= 1)
);

-- A regra mais importante da spec, no banco: um sequencial por item, uma vez só.
create unique index if not exists etiquetas_legado_item_sequencial_uidx
  on public.etiquetas_legado (item, sequencial);
create unique index if not exists etiquetas_legado_codigo_uidx
  on public.etiquetas_legado (codigo);
-- Prévia: "este item já foi etiquetado nesta posição?" (item + locação, com a data).
create index if not exists etiquetas_legado_item_locacao_idx
  on public.etiquetas_legado (item, locacao);
create index if not exists etiquetas_legado_created_idx
  on public.etiquetas_legado (created_at desc);

alter table public.etiquetas_legado enable row level security;

-- Leitura: quem vê o Recebimento. Escrita: SÓ por etq_legado_emitir (security definer) — sem
-- policy de insert, ninguém grava direto e o sequencial nunca é escolhido de fora.
drop policy if exists etiquetas_legado_select on public.etiquetas_legado;
create policy etiquetas_legado_select on public.etiquetas_legado
  for select to authenticated using ((select tem_permissao('recebimento', 'visualizar')));

-- ---------- o formato do código, no banco ----------
-- Espelha montarPartNumberLegado (src/modules/etiquetas/domain/partnumber-legado.ts). Mudou lá,
-- muda aqui. lpad TRUNCA quando o texto é maior que a largura (lpad('10000',4,'0') = '1000'),
-- então acima de 9999 o número vai inteiro, sem preenchimento.
create or replace function public.etq_legado_codigo(p_item text, p_seq int)
returns text
language sql
immutable
set search_path = public
as $func$
  select upper(btrim(coalesce(p_item, ''))) || '-L' ||
         case when coalesce(p_seq, 0) < 10000 then lpad(coalesce(p_seq, 0)::text, 4, '0')
              else p_seq::text end
$func$;

-- Item que o Setup consegue ler como prefixo: não vazio e SEM separador (- – — _ : / espaço).
-- Um item com separador quebraria a divisão do código do rolo — o Setup leria só o pedaço antes
-- do separador como componente. Espelha contemSeparador (setup/domain/codigo-rolo.ts).
create or replace function public.etq_legado_item_valido(p_item text)
returns boolean
language sql
immutable
set search_path = public
as $func$
  select upper(btrim(coalesce(p_item, ''))) <> ''
     and upper(btrim(coalesce(p_item, ''))) !~ '[-–—_:/[:space:]]'
$func$;

-- ---------- prévia: o que já foi etiquetado ----------
-- Uma linha por par (item, locação) distinto da planilha que o usuário subiu:
--   emitidas_na_locacao / ultima_na_locacao = "este item já saiu desta posição antes?" (com a
--     data, porque é o usuário quem decide se é rolo novo ou repetição — o sistema não decide);
--   ultimo_sequencial = onde o contador daquele item está, para a prévia projetar o código.
create or replace function public.etq_legado_conferir(p_linhas jsonb)
returns table (
  item text,
  locacao text,
  emitidas_na_locacao bigint,
  ultima_na_locacao timestamptz,
  ultimo_sequencial int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('recebimento', 'gerar_etiqueta') then raise exception 'SEM_PERMISSAO'; end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'LINHAS_INVALIDAS'; end if;

  return query
  with entrada as (
    select distinct
           upper(btrim(coalesce(e.value->>'item', ''))) as item,
           upper(btrim(coalesce(e.value->>'locacao', ''))) as locacao
      from jsonb_array_elements(p_linhas) e
     where upper(btrim(coalesce(e.value->>'item', ''))) <> ''
  )
  select n.item,
         n.locacao,
         count(el_loc.id),
         max(el_loc.created_at),
         coalesce((select max(el.sequencial) from public.etiquetas_legado el where el.item = n.item), 0)
    from entrada n
    left join public.etiquetas_legado el_loc
           on el_loc.item = n.item and el_loc.locacao = n.locacao
   group by n.item, n.locacao
   order by n.item, n.locacao;
end $func$;

-- ---------- progresso do mutirão ----------
create or replace function public.etq_legado_resumo()
returns table (total_etiquetas bigint, total_itens bigint, ultima timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('recebimento', 'gerar_etiqueta') then raise exception 'SEM_PERMISSAO'; end if;

  return query
  select count(*), count(distinct el.item), max(el.created_at) from public.etiquetas_legado el;
end $func$;

-- ---------- emitir: o banco é quem numera ----------
-- p_linhas = [{"item":"CAPA78","locacao":"A1.C.39"}, ...] NA ORDEM DA PLANILHA (a ordem importa:
-- quem cola as etiquetas segue a mesma ordem). Devolve `ordem` para o app remontar essa ordem.
--
-- Tudo numa transação: lê o último sequencial de cada item, numera a partir dele e grava. O
-- advisory lock serializa duas gerações simultâneas — sem ele, as duas leriam o mesmo "último",
-- e o índice único derrubaria a segunda (correto, mas o usuário levaria um erro sem motivo).
create or replace function public.etq_legado_emitir(p_linhas jsonb)
returns table (ordem int, item text, sequencial int, codigo text, locacao text)
language plpgsql
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_nome text := '';
begin
  if not tem_permissao('recebimento', 'gerar_etiqueta') then raise exception 'SEM_PERMISSAO'; end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'LINHAS_INVALIDAS'; end if;
  if jsonb_array_length(p_linhas) = 0 then raise exception 'SEM_LINHAS'; end if;
  -- Teto da leva = 1.000, o mesmo LIMITE_LINHAS_LEGADO do app: é o corte do PostgREST
  -- (config.toml: max_rows). Passando disso, parte das etiquetas gravadas não voltaria no
  -- resultado — rolo sem etiqueta e código gasto, em silêncio.
  if jsonb_array_length(p_linhas) > 1000 then raise exception 'LINHAS_DEMAIS'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_linhas) e
     where not public.etq_legado_item_valido(e.value->>'item')
  ) then
    raise exception 'ITEM_INVALIDO';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.etiquetas_legado'));

  select coalesce(u.nome, '') into v_nome from public.usuarios u where u.id = v_uid;

  return query
  with entrada as (
    select e.ordinalidade::int as ordem,
           upper(btrim(e.valor->>'item')) as item,
           upper(btrim(coalesce(e.valor->>'locacao', ''))) as locacao
      from jsonb_array_elements(p_linhas) with ordinality as e(valor, ordinalidade)
  ),
  ultimo as (
    select i.item,
           coalesce((select max(el.sequencial) from public.etiquetas_legado el where el.item = i.item), 0) as seq
      from (select distinct item from entrada) i
  ),
  numerada as (
    select en.ordem, en.item, en.locacao,
           (u.seq + row_number() over (partition by en.item order by en.ordem))::int as sequencial
      from entrada en
      join ultimo u on u.item = en.item
  ),
  gravada as (
    insert into public.etiquetas_legado (item, sequencial, codigo, locacao, usuario_id, usuario_nome)
    select n.item, n.sequencial, public.etq_legado_codigo(n.item, n.sequencial),
           n.locacao, v_uid, coalesce(v_nome, '')
      from numerada n
    returning item, sequencial, codigo, locacao
  )
  select n.ordem, g.item, g.sequencial, g.codigo, g.locacao
    from gravada g
    join numerada n on n.item = g.item and n.sequencial = g.sequencial
   order by n.ordem;
end $func$;

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key (pública, está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login. Os helpers puros só
-- são usados por dentro das funções acima.
revoke all on function public.etq_legado_codigo(text, int) from public, anon, authenticated;
revoke all on function public.etq_legado_item_valido(text) from public, anon, authenticated;

revoke all on function public.etq_legado_conferir(jsonb) from public, anon;
revoke all on function public.etq_legado_resumo() from public, anon;
revoke all on function public.etq_legado_emitir(jsonb) from public, anon;

grant execute on function public.etq_legado_conferir(jsonb) to authenticated;
grant execute on function public.etq_legado_resumo() to authenticated;
grant execute on function public.etq_legado_emitir(jsonb) to authenticated;

grant select on public.etiquetas_legado to authenticated;

notify pgrst, 'reload schema';
