-- =============================================================
-- Etiquetagem junto ao INVENTÁRIO ROTATIVO (spec de 30/09/2026).
--
-- A etiqueta deixa de sair de uma leva importada da planilha e passa a nascer no gesto da
-- recontagem: o almoxarife está com o rolo na mão, lê o que está escrito nele e digita. Muitos
-- rolos têm o número do PEDIDO escrito — quando tem, ele entra na etiqueta.
--
-- NÃO HÁ TABELA NOVA: a etiquetas_legado (0126) já é uma linha por rolo, com o sequencial
-- garantido no banco. Esta migração acrescenta colunas e ensina o formato a incluir o pedido.
--
-- Convenções: corpo com $func$ (o SQL Editor do Supabase não aceita o de dois cifrões, nem em
-- comentário); aditiva e idempotente; revoke + grant explícitos; notify pgrst na última linha;
-- permissão pela função de DOIS argumentos (a de um anula o RBAC).
-- =============================================================

-- ---------- as colunas ----------
-- `pedido`: JÁ NORMALIZADO (só dígitos) pelo app, ou '' quando o rolo não tem pedido escrito.
-- `impressa_em`/`impressa_por`: vazio = PENDENTE. Não há máquina de estados — "o que falta
-- imprimir" é `impressa_em is null`, e é isso que a tela lista.
alter table public.etiquetas_legado
  add column if not exists pedido text not null default '';
alter table public.etiquetas_legado
  add column if not exists impressa_em timestamptz;
alter table public.etiquetas_legado
  add column if not exists impressa_por uuid references public.usuarios(id);

-- `removida_em`: a linha que o almoxarife tirou da lista antes de imprimir.
--
-- Ela CONTINUA na tabela de propósito. Remover QUEIMA O NÚMERO (spec: "o próximo rolo daquele item
-- pega o seguinte"), e quem garante isso é o sequencial do próprio registro: `etq_legado_emitir`
-- numera a partir de `max(sequencial)` do item, então apagar a linha de verdade devolveria o
-- número ao próximo rolo — exatamente o que a regra proíbe. A linha removida é o registro de que
-- aquele número existiu e foi descartado.
--
-- CONSEQUÊNCIA PARA QUEM LÊ A TABELA: "pendente" é `impressa_em is null AND removida_em is null`.
-- Filtrar só por `impressa_em is null` traz de volta o que o usuário mandou remover.
alter table public.etiquetas_legado
  add column if not exists removida_em timestamptz;

-- O pedido é o que separa o código do `L`. Se entrar letra aqui, o `L` deixa de ser um separador
-- confiável e um código gravado hoje vira ambíguo de ler amanhã. O CHECK é essa garantia escrita.
do $chk$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = 'etiquetas_legado'
       and constraint_name = 'etiquetas_legado_pedido_so_digitos'
  ) then
    alter table public.etiquetas_legado
      add constraint etiquetas_legado_pedido_so_digitos check (pedido ~ '^[0-9]*$');
  end if;
end $chk$;

-- A tela lista as pendentes, mais novas em cima.
create index if not exists etiquetas_legado_pendentes_idx
  on public.etiquetas_legado (created_at desc)
  where impressa_em is null and removida_em is null;

-- ---------- o formato do código, agora com o pedido ----------
-- Espelha montarPartNumberLegado (src/modules/etiquetas/domain/partnumber-legado.ts). Mudou lá,
-- muda aqui. Com pedido vazio o resultado é IDÊNTICO ao da 0126 — é o que garante que a tela da
-- planilha, se um dia voltar, continue gerando o mesmo formato.
drop function if exists public.etq_legado_codigo(text, int);
create or replace function public.etq_legado_codigo(p_item text, p_seq int, p_pedido text)
returns text
language sql
immutable
set search_path = public
as $func$
  select upper(btrim(coalesce(p_item, ''))) || '-' || coalesce(p_pedido, '') || 'L' ||
         case when coalesce(p_seq, 0) < 10000 then lpad(coalesce(p_seq, 0)::text, 4, '0')
              else p_seq::text end
$func$;

-- ---------- emitir: mesma assinatura, agora lendo o pedido ----------
-- A chave `pedido` é OPCIONAL no JSON: a tela da planilha não a manda e continua funcionando.
-- A tela do inventário rotativo manda UM elemento por vez (um rolo).
--
-- O drop é obrigatório: a função ganha a coluna `pedido` no retorno, e `create or replace` não
-- muda as colunas de saída de uma função existente ("cannot change return type"). O parâmetro
-- (jsonb) é o mesmo, então nada que chama a função precisa mudar.
drop function if exists public.etq_legado_emitir(jsonb);
create or replace function public.etq_legado_emitir(p_linhas jsonb)
returns table (ordem int, item text, sequencial int, codigo text, locacao text, pedido text)
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
  if jsonb_array_length(p_linhas) > 1000 then raise exception 'LINHAS_DEMAIS'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_linhas) e
     where not public.etq_legado_item_valido(e.value->>'item')
  ) then
    raise exception 'ITEM_INVALIDO';
  end if;
  -- O app normaliza o pedido antes de mandar; aqui é a cerca contra qualquer outro caminho.
  if exists (
    select 1 from jsonb_array_elements(p_linhas) e
     where coalesce(e.value->>'pedido', '') !~ '^[0-9]*$'
  ) then
    raise exception 'PEDIDO_INVALIDO';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.etiquetas_legado'));

  select coalesce(u.nome, '') into v_nome from public.usuarios u where u.id = v_uid;

  return query
  with entrada as (
    select e.ordinalidade::int as ordem,
           upper(btrim(e.valor->>'item')) as item,
           upper(btrim(coalesce(e.valor->>'locacao', ''))) as locacao,
           coalesce(e.valor->>'pedido', '') as pedido
      from jsonb_array_elements(p_linhas) with ordinality as e(valor, ordinalidade)
  ),
  ultimo as (
    -- Sem filtro de removida_em/impressa_em de propósito: o contador conta TODO número já dado
    -- àquele item, inclusive o das linhas removidas. É o que queima o número.
    select i.item,
           coalesce((select max(el.sequencial) from public.etiquetas_legado el where el.item = i.item), 0) as seq
      from (select distinct item from entrada) i
  ),
  numerada as (
    select en.ordem, en.item, en.locacao, en.pedido,
           (u.seq + row_number() over (partition by en.item order by en.ordem))::int as sequencial
      from entrada en
      join ultimo u on u.item = en.item
  ),
  gravada as (
    insert into public.etiquetas_legado (item, sequencial, codigo, locacao, pedido, usuario_id, usuario_nome)
    select n.item, n.sequencial, public.etq_legado_codigo(n.item, n.sequencial, n.pedido),
           n.locacao, n.pedido, v_uid, coalesce(v_nome, '')
      from numerada n
    returning item, sequencial, codigo, locacao, pedido
  )
  select n.ordem, g.item, g.sequencial, g.codigo, g.locacao, g.pedido
    from gravada g
    join numerada n on n.item = g.item and n.sequencial = g.sequencial
   order by n.ordem;
end $func$;

-- ---------- remover uma linha antes de imprimir ----------
-- Só o que AINDA NÃO foi impresso. Depois de impressa, a etiqueta pode estar colada num rolo — e
-- esquecer um código que existe no mundo físico é pior do que mantê-lo na lista.
--
-- O número NÃO volta: o próximo rolo daquele item pega o seguinte e o removido vira buraco. É a
-- mesma regra da 0126 (sequencial nunca reaproveitado), pelo mesmo motivo — não dá para saber se
-- aquela etiqueta chegou a ser impressa e colada.
--
-- Por isso a remoção é uma MARCA, não um delete: é a linha que guarda o sequencial, e sem ela o
-- `max(sequencial)` de `etq_legado_emitir` devolveria o número ao próximo rolo.
create or replace function public.etq_legado_remover(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_n int;
begin
  if not tem_permissao('recebimento', 'gerar_etiqueta') then raise exception 'SEM_PERMISSAO'; end if;

  update public.etiquetas_legado
     set removida_em = now()
   where id = p_id and impressa_em is null and removida_em is null;
  get diagnostics v_n = row_count;

  if v_n = 0 then raise exception 'NAO_PENDENTE'; end if;
  return v_n;
end $func$;

-- ---------- marcar como impressas ----------
-- Chamada depois de o CSV ser gerado. Só move o que está pendente: se duas pessoas baixarem ao
-- mesmo tempo, a segunda marca zero linhas em vez de reescrever a autoria da primeira.
create or replace function public.etq_legado_marcar_impressas(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_n int;
begin
  if not tem_permissao('recebimento', 'gerar_etiqueta') then raise exception 'SEM_PERMISSAO'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'SEM_LINHAS'; end if;

  update public.etiquetas_legado
     set impressa_em = now(), impressa_por = auth.uid()
   where id = any(p_ids) and impressa_em is null and removida_em is null;
  get diagnostics v_n = row_count;

  return v_n;
end $func$;

-- ---------- permissões ----------
revoke all on function public.etq_legado_codigo(text, int, text) from public, anon, authenticated;
revoke all on function public.etq_legado_emitir(jsonb) from public, anon;
revoke all on function public.etq_legado_remover(uuid) from public, anon;
revoke all on function public.etq_legado_marcar_impressas(uuid[]) from public, anon;
grant execute on function public.etq_legado_emitir(jsonb) to authenticated;
grant execute on function public.etq_legado_remover(uuid) to authenticated;
grant execute on function public.etq_legado_marcar_impressas(uuid[]) to authenticated;

notify pgrst, 'reload schema';
