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
--
-- AVISO 1 — A TELA DA PLANILHA NUNCA MARCA NADA COMO IMPRESSA. Ela continua existindo (fora do
-- menu) e só chama `etq_legado_emitir`; quem marca `impressa_em` é a tela do inventário, ao baixar
-- o CSV. Enquanto a tela da planilha está desativada isso não incomoda, mas se um dia ela for
-- reativada as linhas dela vão nascer PENDENTES e cair na lista do inventário rotativo — rolos "a
-- etiquetar" que já foram etiquetados, o mesmo problema que o backfill abaixo resolve para o
-- passado. Quem reativar a tela da planilha tem de resolver isso (marcar impressa ao gerar o
-- arquivo, ou separar as duas origens); não há nada aqui que a proteja.
--
-- AVISO 2 — REAPLICAR ESTA DUPLA COMEÇA NA 0135, NUNCA NA 0126. A 0126 deixou de ser reaplicável
-- sozinha depois desta migração: `etq_legado_emitir` ganhou aqui a coluna `pedido` no retorno, e o
-- `create or replace` da 0126 morre em "cannot change return type of existing function". O
-- problema é ONDE ele morre: depois de a 0126 já ter recriado `etq_legado_codigo(text,int)` (o
-- helper de 2 argumentos que esta migração dropa) e ANTES do bloco de `revoke` no fim do arquivo —
-- deixando esse helper com EXECUTE para PUBLIC. Não há dano de dado (é formatação de string pura),
-- mas fura a convenção do repositório de nenhuma função ficar aberta para `public`/`anon`. A 0135 é
-- a versão vigente das duas funções e recria tudo o que a 0126 criou, então colar SÓ ESTE arquivo
-- no SQL Editor é o caminho de reaplicação correto.
-- =============================================================

-- ---------- as colunas ----------
-- `pedido`: JÁ NORMALIZADO (só dígitos) pelo app, ou '' quando o rolo não tem pedido escrito.
-- `impressa_em`/`impressa_por`: vazio = PENDENTE. Não há máquina de estados — "o que falta
-- imprimir" é `impressa_em is null`, e é isso que a tela lista.
alter table public.etiquetas_legado
  add column if not exists pedido text not null default '';

-- BACKFILL: toda linha que já existia nasce IMPRESSA.
--
-- Antes desta migração não havia estado nenhum: a tela da planilha emitia a leva e o único desfecho
-- possível era baixar o CSV e imprimir — não existia outro destino para uma linha emitida, nem
-- botão de "imprimir depois". Então dizer que essas linhas já foram impressas não é uma suposição
-- conveniente, é registrar o que aconteceu. Sem isso, a primeira abertura da tela do inventário
-- listaria TODO o histórico como pendente: etiquetas há muito impressas e coladas nos rolos
-- voltariam para o CSV, e poderiam até ser "removidas" — queimando números de etiquetas que
-- existem no mundo físico.
--
-- `created_at` é a melhor data que existe (o momento da emissão) e, pela regra acima, é também o
-- momento em que a etiqueta saiu no arquivo.
--
-- POR QUE É SEGURO RODAR DE NOVO: o backfill só acontece junto com a criação da coluna. Depois da
-- primeira aplicação a coluna já existe, o bloco não roda, e as linhas pendentes que a tela do
-- inventário criou desde então ficam intactas — elas serão marcadas pelo caminho normal
-- (`etq_legado_marcar_impressas`, ao baixar o CSV). Fora do `if`, um `update ... where impressa_em
-- is null` solto varreria justamente essas pendentes de verdade a cada reaplicação: o usuário
-- reaplica migração quando fica na dúvida, e o rolo na prateleira nunca receberia etiqueta.
do $bf$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'etiquetas_legado'
       and column_name = 'impressa_em'
  ) then
    alter table public.etiquetas_legado add column impressa_em timestamptz;
    update public.etiquetas_legado set impressa_em = created_at where impressa_em is null;
  end if;
end $bf$;

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

-- ---------- as duas leituras, agora cientes da linha removida ----------
-- A `removida_em` é nova, então as funções de leitura da 0126 não a conhecem e contam a linha
-- removida como se ela valesse. A 0126 está congelada (já aplicada no Dev), então as duas são
-- recriadas aqui — mesma assinatura, `create or replace`, nada mais mudou nelas.
--
-- ATENÇÃO: NÃO é o mesmo filtro nas duas. O que vale é a pergunta que cada número responde.

-- `etq_legado_resumo` é o progresso do mutirão: "quantas etiquetas existem". A removida foi
-- descartada antes de imprimir — ela não existe como etiqueta, e inflava o total e o total_itens.
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
  select count(*), count(distinct el.item), max(el.created_at)
    from public.etiquetas_legado el
   where el.removida_em is null;
end $func$;

-- `etq_legado_conferir` devolve DOIS números com naturezas opostas, e o filtro vale para um só:
--
--   emitidas_na_locacao / ultima_na_locacao (o LEFT JOIN el_loc) = "este item já saiu desta posição
--     antes?". É um aviso de repetição para o usuário decidir. Contar a linha removida aqui produz
--     um "já etiquetada" ESPÚRIO por um rolo que foi descartado — é o bug que se corrige. O filtro
--     vai no ON, não num WHERE: no WHERE ele viraria um inner join e o item sem histórico
--     desapareceria da prévia.
--
--   ultimo_sequencial (o max(el.sequencial)) = "onde o contador daquele item está", para a prévia
--     projetar o próximo código. Aqui a linha removida TEM de continuar contando: remover QUEIMA o
--     número, e é esse max que queima. Filtrar `removida_em is null` neste subselect devolveria o
--     número queimado à prévia — reintroduzindo exatamente o bug que a 0135 fecha, e ainda por um
--     caminho pior: a prévia mostraria um código que `etq_legado_emitir` (que não filtra, de
--     propósito) não vai gerar.
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
          and el_loc.removida_em is null
   group by n.item, n.locacao
   order by n.item, n.locacao;
end $func$;

-- ---------- permissões ----------
revoke all on function public.etq_legado_codigo(text, int, text) from public, anon, authenticated;
revoke all on function public.etq_legado_emitir(jsonb) from public, anon;
revoke all on function public.etq_legado_remover(uuid) from public, anon;
revoke all on function public.etq_legado_marcar_impressas(uuid[]) from public, anon;
-- As duas recriadas acima: o `create or replace` preserva a ACL, mas repetir o revoke + grant é o
-- que garante o estado, inclusive se alguém tiver reaplicado a 0126 e aberto algo no caminho.
revoke all on function public.etq_legado_conferir(jsonb) from public, anon;
revoke all on function public.etq_legado_resumo() from public, anon;
grant execute on function public.etq_legado_conferir(jsonb) to authenticated;
grant execute on function public.etq_legado_resumo() to authenticated;
grant execute on function public.etq_legado_emitir(jsonb) to authenticated;
grant execute on function public.etq_legado_remover(uuid) to authenticated;
grant execute on function public.etq_legado_marcar_impressas(uuid[]) to authenticated;

notify pgrst, 'reload schema';
