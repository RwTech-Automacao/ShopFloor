# Etiquetagem junto ao inventário rotativo — plano de implementação

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> (recomendada) ou `superpowers:executing-plans`, tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** durante o inventário rotativo, o almoxarife digita código (e o pedido, quando o rolo
tem) e gera a etiqueta daquele rolo; no fim baixa um CSV com tudo que ainda não foi impresso.

**Arquitetura:** não há tabela nova. A `etiquetas_legado` (0126) já é uma linha por rolo com
sequencial garantido no banco; a 0135 acrescenta `pedido`, `impressa_em`/`impressa_por` e ensina o
formato do código a incluir o pedido. A tela nova é um formulário de repetição que chama a mesma
`etq_legado_emitir` com **uma linha por vez**; a tela da planilha sai do menu e a rota fica.

**Pilha:** Next.js 16 (App Router) · React 19 · TypeScript · Postgres/Supabase · Vitest · Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-30-etiquetagem-inventario-rotativo-design.md`

## Global Constraints

- **`AGENTS.md`:** esta versão do Next tem mudanças de API; leia `node_modules/next/dist/docs/`
  antes de escrever código de framework. Não confie na memória. **`npx next build` faz parte do
  teste** — é o único que pega as regras de `'use server'` (um módulo `'use server'` só pode
  exportar funções async).
- Migração aditiva e idempotente: `if not exists`, `create or replace`, `drop policy if exists`.
- **Corpo de função com `$func$`, nunca dois cifrões** — nem dentro de comentário; o SQL Editor do
  Supabase recusa o arquivo.
- Toda função nova: `revoke all ... from public, anon` + grant explícito; a migração termina com
  `notify pgrst, 'reload schema';`.
- Permissão é `tem_permissao` de **dois** argumentos. A de um argumento anula o RBAC.
- **A próxima migração livre é a 0135.** `0126` (esta branch), `0128–0133` (posto Almoxarifado) e
  `0134` (Central do Cliente) estão em branches não mergeadas. **Confira antes de aplicar.**
- **A 0126 já está aplicada no Dev** — não edite a 0126; tudo novo vai na 0135.
- Português do Brasil em tudo que o usuário lê.
- Foco tablet, piso Chrome 111+.
- Rodar teste só do que se toca, com `--exclude "**/.claude/**"`. **Nunca a suíte inteira** — a
  máquina tem 4 núcleos e há worktrees antigas que inflam a contagem.
- `git add` com caminhos **explícitos**: há um `appscript/Rastreador-do-Pedido.pdf` solto que não é
  nosso e não pode entrar em commit.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0135_etiquetas_pedido_impressao.sql` | as 3 colunas, o código com pedido, emitir com pedido, remover, marcar impressas |
| `supabase/tests/etiquetas_legado_test.sql` (modificar) | os testes SQL da 0135 junto dos da 0126 |
| `src/modules/etiquetas/domain/partnumber-legado.ts` (modificar) | o formato com pedido e a recusa do pedido ilegível |
| `src/modules/etiquetas/infra/etiqueta-legado-repository.ts` (modificar) | as chamadas novas ao banco |
| `src/modules/etiquetas/application/etiquetar-rolo.ts` (criar) | as Server Actions da tela nova |
| `src/app/(app)/recebimento/etiquetar-rolo/page.tsx` (criar) | a página, com o gate |
| `src/app/(app)/recebimento/etiquetar-rolo/etiquetar-rolo-cliente.tsx` (criar) | o formulário, a lista e o CSV |
| `src/shared/ui/app-shell.tsx` (modificar) | entra a tela nova, sai a da planilha |

---

### Task 1: o formato do código aprende o pedido

**Arquivos:**
- Modificar: `src/modules/etiquetas/domain/partnumber-legado.ts:123-127`
- Teste: `src/modules/etiquetas/domain/__tests__/partnumber-legado.test.ts`

**Interfaces:**
- Consome: `formatarPedido` de `src/modules/etiquetas/domain/partnumber.ts:28` (já existe).
- Produz: `montarPartNumberLegado(item, sequencial, pedido?)` e
  `normalizarPedidoLegado(valor): { pedido: string } | { recusa: 'pedido_ilegivel' }`.

**Contexto que você precisa:** `formatarPedido` é a função que o Recebimento usa para transformar
o que a pessoa digitou em dígitos. Ela tem uma armadilha **já verificada rodando**:

| digitado | devolve |
|---|---|
| `1234/25` | `123425` |
| `45/2025` | `004525` |
| `1234-25` | `123425` |
| `12` | `0012` |
| `""` ou `"  "` | `""` |
| **`abc`** | **`0000`** ← a armadilha |

Texto sem nenhum dígito vira `0000` em vez de vazio. Se isso passar, o rolo recebe uma etiqueta com
pedido `0000` — um pedido que não existe, colado num rolo físico, e ninguém percebe. Por isso o
pedido ganha uma **recusa própria**, e não uma normalização silenciosa.

- [ ] **Passo 1: escreva os testes que falham**

Em `src/modules/etiquetas/domain/__tests__/partnumber-legado.test.ts`, acrescente ao fim:

```ts
import { montarPartNumberLegado, normalizarPedidoLegado } from '../partnumber-legado'

describe('pedido na etiqueta do inventário rotativo', () => {
  it('sem pedido, o código é o mesmo de hoje', () => {
    expect(montarPartNumberLegado('CAPA78', 4)).toBe('CAPA78-L0004')
    expect(montarPartNumberLegado('CAPA78', 4, '')).toBe('CAPA78-L0004')
  })

  it('com pedido, o pedido entra antes do L', () => {
    expect(montarPartNumberLegado('CAPA78', 4, '123425')).toBe('CAPA78-123425L0004')
  })

  it('o pedido aceita o que estiver escrito no rolo', () => {
    expect(normalizarPedidoLegado('1234/25')).toEqual({ pedido: '123425' })
    expect(normalizarPedidoLegado('45/2025')).toEqual({ pedido: '004525' })
    expect(normalizarPedidoLegado('1234-25')).toEqual({ pedido: '123425' })
    expect(normalizarPedidoLegado('  12  ')).toEqual({ pedido: '0012' })
  })

  it('campo vazio é ausência de pedido, não erro', () => {
    expect(normalizarPedidoLegado('')).toEqual({ pedido: '' })
    expect(normalizarPedidoLegado('   ')).toEqual({ pedido: '' })
    expect(normalizarPedidoLegado(null)).toEqual({ pedido: '' })
    expect(normalizarPedidoLegado(undefined)).toEqual({ pedido: '' })
  })

  // A armadilha: formatarPedido('abc') devolve '0000'. Sem esta recusa, um dedo errado vira uma
  // etiqueta com um pedido que não existe, colada num rolo — e ninguém vê.
  it('pedido sem nenhum dígito é RECUSADO, nunca vira 0000', () => {
    expect(normalizarPedidoLegado('abc')).toEqual({ recusa: 'pedido_ilegivel' })
    expect(normalizarPedidoLegado('x')).toEqual({ recusa: 'pedido_ilegivel' })
    expect(normalizarPedidoLegado('--')).toEqual({ recusa: 'pedido_ilegivel' })
  })

  // O L é o que impede uma etiqueta do inventário de colidir com uma etiqueta de verdade do
  // Recebimento (lá o lugar do L é o documento, DI ou NF, SEMPRE numérico).
  it('o pedido normalizado é só dígitos, então o L nunca fica ambíguo', () => {
    for (const bruto of ['1234/25', '45/2025', '1234-25', '12', '999999999']) {
      const r = normalizarPedidoLegado(bruto)
      expect('pedido' in r).toBe(true)
      expect((r as { pedido: string }).pedido).toMatch(/^[0-9]*$/)
    }
  })
})
```

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/modules/etiquetas/domain/__tests__/partnumber-legado.test.ts --exclude "**/.claude/**"`
Esperado: FALHA com `normalizarPedidoLegado is not a function`.

- [ ] **Passo 3: implemente**

Em `src/modules/etiquetas/domain/partnumber-legado.ts`, troque a `montarPartNumberLegado`
(linhas 123-127) por:

```ts
/**
 * O código da etiqueta do estoque legado, com o pedido quando o rolo tem um.
 *
 *     CAPA78-123425L0004        com pedido
 *     CAPA78-L0004              sem pedido (o formato de sempre)
 *
 * O `L` fica DEPOIS do pedido, no lugar que a etiqueta de verdade do Recebimento reserva para o
 * documento (DI ou NF). Documento real é sempre numérico, então uma etiqueta daqui nunca pode ser
 * confundida com uma de lá — por construção, não por convenção.
 */
export function montarPartNumberLegado(item: string, sequencial: number, pedido = ''): string {
  const numero = Math.trunc(sequencial)
  const lote = numero < 10000 ? String(numero).padStart(4, '0') : String(numero)
  return `${normalizarItem(item)}-${pedido}${MARCA_LEGADO}${lote}`
}

/**
 * O pedido que o almoxarife digitou, do jeito que está escrito no rolo, virando os dígitos que a
 * etiqueta usa — ou uma recusa.
 *
 * Campo vazio é ausência de pedido (etiqueta genérica), não erro. Mas texto SEM NENHUM DÍGITO é
 * recusado: `formatarPedido('abc')` devolve `'0000'`, e deixar passar colaria num rolo uma etiqueta
 * com um pedido que não existe.
 */
export function normalizarPedidoLegado(
  valor: unknown,
): { pedido: string } | { recusa: 'pedido_ilegivel' } {
  const bruto = String(valor ?? '').trim()
  if (bruto === '') return { pedido: '' }
  if (!/[0-9]/.test(bruto)) return { recusa: 'pedido_ilegivel' }
  return { pedido: formatarPedido(bruto) }
}
```

E acrescente `formatarPedido` ao import que já existe de `./partnumber` no topo do arquivo.

- [ ] **Passo 4: rode e veja passar**

Run: `npx vitest run src/modules/etiquetas/domain/__tests__/partnumber-legado.test.ts --exclude "**/.claude/**"`
Esperado: PASSA, incluindo os testes que já existiam (o parâmetro novo tem default, então nada muda
para quem chama com dois argumentos).

- [ ] **Passo 5: confira os tipos**

Run: `npx tsc --noEmit`
Esperado: sem saída.

- [ ] **Passo 6: commit**

```bash
git add src/modules/etiquetas/domain/partnumber-legado.ts src/modules/etiquetas/domain/__tests__/partnumber-legado.test.ts
git commit -m "etiquetas: o código aprende o pedido, e pedido ilegível é recusado"
```

---

### Task 2: o banco guarda o pedido e sabe o que já foi impresso

**Arquivos:**
- Criar: `supabase/migrations/0135_etiquetas_pedido_impressao.sql`
- Modificar: `supabase/tests/etiquetas_legado_test.sql`
- Modificar: `supabase/tests/rodar-etiquetas-legado-test.sh` (para carregar a 0135 depois da 0126)

**Interfaces:**
- Consome: `public.etiquetas_legado`, `etq_legado_emitir(jsonb)`, `etq_legado_item_valido(text)` —
  todos da 0126.
- Produz:
  - `etq_legado_codigo(p_item text, p_seq int, p_pedido text) returns text`
  - `etq_legado_emitir(p_linhas jsonb)` — **mesma assinatura**, passa a ler `pedido` de cada
    elemento e a devolver a coluna `pedido`
  - `etq_legado_remover(p_id uuid) returns int`
  - `etq_legado_marcar_impressas(p_ids uuid[]) returns int`

**Contexto que você precisa:**

A `etq_legado_emitir` de hoje recebe `[{"item":"CAPA78","locacao":"A1.C.39"}, ...]` e é usada pela
tela da planilha, **que continua existindo** (só sai do menu). **Não mude a assinatura dela** — o
pedido entra como mais uma chave dentro do JSON. Quem não mandar a chave recebe `''`, e o código
sai idêntico ao de hoje. Um caminho só.

A tela nova chama essa mesma função com **um elemento** no array.

- [ ] **Passo 1: escreva a migração**

Crie `supabase/migrations/0135_etiquetas_pedido_impressao.sql`:

```sql
-- =============================================================
-- Etiquetagem junto ao INVENTÁRIO ROTATIVO (spec de 30/09/2026).
--
-- A etiqueta deixa de sair de uma leva importada da planilha e passa a nascer no gesto da
-- recontagem: o almoxarife está com o rolo na mão, lê o que está escrito nele e digita. Muitos
-- rolos têm o número do PEDIDO escrito — quando tem, ele entra na etiqueta.
--
-- NÃO HÁ TABELA NOVA: a etiquetas_legado (0126) já é uma linha por rolo, com o sequencial
-- garantido no banco. Esta migração acrescenta três colunas e ensina o formato a incluir o pedido.
--
-- Convenções: corpo com $func$ (o SQL Editor do Supabase não aceita o de dois cifrões, nem em
-- comentário); aditiva e idempotente; revoke + grant explícitos; notify pgrst na última linha;
-- permissão pela função de DOIS argumentos (a de um anula o RBAC).
-- =============================================================

-- ---------- as três colunas ----------
-- `pedido`: JÁ NORMALIZADO (só dígitos) pelo app, ou '' quando o rolo não tem pedido escrito.
-- `impressa_em`/`impressa_por`: vazio = PENDENTE. Não há máquina de estados — "o que falta
-- imprimir" é `impressa_em is null`, e é isso que a tela lista.
alter table public.etiquetas_legado
  add column if not exists pedido text not null default '';
alter table public.etiquetas_legado
  add column if not exists impressa_em timestamptz;
alter table public.etiquetas_legado
  add column if not exists impressa_por uuid references public.usuarios(id);

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
  on public.etiquetas_legado (created_at desc) where impressa_em is null;

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
-- apagar a linha faria o sistema esquecer um código que existe no mundo físico.
--
-- O número NÃO volta: o próximo rolo daquele item pega o seguinte e o removido vira buraco. É a
-- mesma regra da 0126 (sequencial nunca reaproveitado), pelo mesmo motivo — não dá para saber se
-- aquela etiqueta chegou a ser impressa e colada.
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

  delete from public.etiquetas_legado
   where id = p_id and impressa_em is null;
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
   where id = any(p_ids) and impressa_em is null;
  get diagnostics v_n = row_count;

  return v_n;
end $func$;

-- ---------- permissões ----------
revoke all on function public.etq_legado_codigo(text, int, text) from public, anon, authenticated;
revoke all on function public.etq_legado_remover(uuid) from public, anon;
revoke all on function public.etq_legado_marcar_impressas(uuid[]) from public, anon;
grant execute on function public.etq_legado_remover(uuid) to authenticated;
grant execute on function public.etq_legado_marcar_impressas(uuid[]) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Passo 2: faça o runner carregar a 0135**

Em `supabase/tests/rodar-etiquetas-legado-test.sh`, logo depois da linha que copia e aplica a
0126, acrescente a 0135 do mesmo jeito (copie o padrão da linha da 0126 — `docker cp` + `psql -f`).

- [ ] **Passo 3: escreva os testes que falham**

Acrescente ao fim de `supabase/tests/etiquetas_legado_test.sql`, antes da linha final que imprime
o `ok` da suíte:

```sql
-- ---------- 0135: o pedido e a impressão ----------
do $t$
declare r record; v_id uuid; v_n int;
begin
  -- sem pedido, o código é o de sempre
  select * into r from public.etq_legado_emitir('[{"item":"PEDX01"}]'::jsonb);
  if r.codigo <> 'PEDX01-L0001' then
    raise exception 'FALHOU: sem pedido o código tinha que ser PEDX01-L0001, veio %', r.codigo; end if;
  if r.pedido <> '' then raise exception 'FALHOU: pedido tinha que vir vazio, veio %', r.pedido; end if;

  -- com pedido, ele entra antes do L, e o sequencial continua do mesmo item
  select * into r from public.etq_legado_emitir('[{"item":"PEDX01","pedido":"123425"}]'::jsonb);
  if r.codigo <> 'PEDX01-123425L0002' then
    raise exception 'FALHOU: com pedido o código tinha que ser PEDX01-123425L0002, veio %', r.codigo; end if;

  -- pedido com letra é recusado: o L deixaria de ser um separador confiável
  begin
    perform public.etq_legado_emitir('[{"item":"PEDX02","pedido":"12A4"}]'::jsonb);
    raise exception 'FALHOU: aceitou pedido com letra';
  exception when others then
    if SQLERRM not like '%PEDIDO_INVALIDO%' then raise; end if;
  end;

  -- remover só vale enquanto está pendente, e o número NÃO volta
  select id into v_id from public.etiquetas_legado where codigo = 'PEDX01-123425L0002';
  v_n := public.etq_legado_remover(v_id);
  if v_n <> 1 then raise exception 'FALHOU: remover devolveu %', v_n; end if;
  select * into r from public.etq_legado_emitir('[{"item":"PEDX01"}]'::jsonb);
  if r.sequencial <> 3 then
    raise exception 'FALHOU: o número do removido não pode voltar; esperava 3, veio %', r.sequencial; end if;

  -- marcar impressas move só o que está pendente, e a segunda chamada move zero
  select id into v_id from public.etiquetas_legado where codigo = 'PEDX01-L0001';
  v_n := public.etq_legado_marcar_impressas(array[v_id]);
  if v_n <> 1 then raise exception 'FALHOU: marcar devolveu %', v_n; end if;
  v_n := public.etq_legado_marcar_impressas(array[v_id]);
  if v_n <> 0 then raise exception 'FALHOU: marcar de novo tinha que mover 0, moveu %', v_n; end if;

  -- e o que já foi impresso não pode mais ser removido
  begin
    perform public.etq_legado_remover(v_id);
    raise exception 'FALHOU: removeu uma etiqueta já impressa';
  exception when others then
    if SQLERRM not like '%NAO_PENDENTE%' then raise; end if;
  end;

  raise notice '0135. pedido no código, remover só pendente, marcar impressas: ok';
end $t$;
```

- [ ] **Passo 4: rode e veja falhar**

Run: `supabase/tests/rodar-etiquetas-legado-test.sh`
Esperado: FALHA (a 0135 ainda não está no runner, ou as colunas não existem).
Depois do Passo 2 e da migração, deve passar — rode de novo no passo 5.

- [ ] **Passo 5: rode e veja passar**

Run: `supabase/tests/rodar-etiquetas-legado-test.sh`
Esperado: sai `0135. pedido no código, remover só pendente, marcar impressas: ok` e o script
termina com exit 0.

- [ ] **Passo 6: confira a idempotência**

Rode o script **de novo**. Esperado: passa igual (a migração é reaplicada pelo runner; só devem
aparecer `NOTICE ... already exists, skipping`).

- [ ] **Passo 7: confira as convenções**

```bash
grep -c '\$\$' supabase/migrations/0135_etiquetas_pedido_impressao.sql
tail -1 supabase/migrations/0135_etiquetas_pedido_impressao.sql
```
Esperado: `0` na primeira, e `notify pgrst, 'reload schema';` na segunda.

- [ ] **Passo 8: commit**

```bash
git add supabase/migrations/0135_etiquetas_pedido_impressao.sql supabase/tests/etiquetas_legado_test.sql supabase/tests/rodar-etiquetas-legado-test.sh
git commit -m "etiquetas: o banco guarda o pedido e sabe o que ainda não foi impresso (0135)"
```

---

### Task 3: as chamadas ao banco e as ações da tela

**Arquivos:**
- Modificar: `src/modules/etiquetas/infra/etiqueta-legado-repository.ts`
- Criar: `src/modules/etiquetas/application/etiquetar-rolo.ts`
- Teste: `src/modules/etiquetas/application/__tests__/etiquetar-rolo.test.ts`

**Interfaces:**
- Consome: `normalizarPedidoLegado`, `montarPartNumberLegado`, `recusaDoItem` e
  `linhasDoArquivoLegado` do domínio (Task 1 e 0126); `etq_legado_emitir`, `etq_legado_remover`,
  `etq_legado_marcar_impressas` (Task 2); `gerarCsv` de
  `src/modules/etiquetas/domain/partnumber.ts:101`.
- Produz, todas `async` (o módulo é `'use server'`):
  - `etiquetarRoloAction(codigo: string, pedido: string): Promise<{ ok: true; linha: RoloEtiquetado } | { ok: false; erro: string }>`
  - `listarPendentesAction(): Promise<{ ok: true; linhas: RoloEtiquetado[]; cortada: boolean } | { ok: false; erro: string }>`
  - `removerPendenteAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }>`
  - `gerarCsvPendentesAction(): Promise<{ ok: true; csv: string; fileName: string; quantidade: number } | { ok: false; erro: string }>`
  - `listarImpressasAction(desde: string, ate: string): Promise<{ ok: true; linhas: RoloEtiquetado[] } | { ok: false; erro: string }>`
  - `baixarDeNovoAction(ids: string[]): Promise<{ ok: true; csv: string; fileName: string } | { ok: false; erro: string }>`

`RoloEtiquetado` fica no domínio, em `partnumber-legado.ts`:

```ts
export interface RoloEtiquetado {
  id: string
  item: string
  pedido: string
  sequencial: number
  codigo: string
  usuarioNome: string
  criadoEm: string
  impressaEm: string | null
}
```

**Contexto que você precisa:**

⚠️ **`'use server'` nesta versão do Next só deixa exportar funções `async`.** Constantes e tipos
exportados do mesmo arquivo derrubam o `next build` — e nem `tsc` nem eslint pegam. Por isso
`RoloEtiquetado` fica no domínio, não no arquivo das actions.

O CSV é o **mesmo** que já sai hoje: `gerarCsv` com três colunas (`partNumber`, `codigo`,
`volume`), volume sempre `01-01`. Não invente formato — é o que o software da impressora consome.

**As mensagens de recusa**, que o almoxarife vai ler no tablet:

| situação | mensagem |
|---|---|
| código vazio | `Digite o código do componente.` |
| código com separador | `O código "{codigo}" tem separador (- _ : / ou espaço). O Setup leria só o pedaço antes dele. Confira o que está escrito no rolo.` |
| pedido sem dígito | `Não consegui ler o pedido "{pedido}". Digite só o número (ex.: 1234/25), ou deixe em branco se o rolo não tem pedido.` |
| sem permissão | `Você não tem permissão para gerar etiquetas.` |
| falha inesperada | `Não foi possível etiquetar o rolo. Tente de novo; se continuar, chame o desenvolvedor.` |

- [ ] **Passo 1: escreva os testes que falham**

Crie `src/modules/etiquetas/application/__tests__/etiquetar-rolo.test.ts` com o repositório
mockado (siga o molde de mock de um teste de action que já exista no módulo — por exemplo
`src/modules/etiquetas/...` ou `src/modules/shopfloor/application/__tests__/`), cobrindo:

```ts
describe('etiquetarRoloAction', () => {
  it('código vazio é recusado antes de chamar o banco', async () => {
    const r = await etiquetarRoloAction('', '')
    expect(r).toEqual({ ok: false, erro: 'Digite o código do componente.' })
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('código com separador é recusado com o motivo do Setup', async () => {
    const r = await etiquetarRoloAction('CAPA-78', '')
    expect(r.ok).toBe(false)
    expect((r as { erro: string }).erro).toContain('separador')
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('pedido sem dígito é recusado, e o banco não é chamado', async () => {
    const r = await etiquetarRoloAction('CAPA78', 'abc')
    expect(r.ok).toBe(false)
    expect((r as { erro: string }).erro).toContain('Não consegui ler o pedido')
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('o pedido chega ao banco JÁ normalizado', async () => {
    await etiquetarRoloAction('CAPA78', '1234/25')
    expect(emitirMock).toHaveBeenCalledWith([{ item: 'CAPA78', pedido: '123425' }])
  })

  it('sem pedido, manda string vazia — nunca 0000', async () => {
    await etiquetarRoloAction('CAPA78', '   ')
    expect(emitirMock).toHaveBeenCalledWith([{ item: 'CAPA78', pedido: '' }])
  })
})

describe('gerarCsvPendentesAction', () => {
  it('sem pendentes, não gera arquivo nem marca nada', async () => {
    listarMock.mockResolvedValue([])
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(false)
    expect(marcarMock).not.toHaveBeenCalled()
  })

  it('gera o CSV e marca como impressas as MESMAS linhas que entraram no arquivo', async () => {
    listarMock.mockResolvedValue([
      { id: 'a', item: 'CAPA78', pedido: '123425', sequencial: 4, codigo: 'CAPA78-123425L0004',
        usuarioNome: 'Ana', criadoEm: '2026-09-30T10:00:00Z', impressaEm: null },
    ])
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(true)
    expect((r as { csv: string }).csv).toContain('CAPA78-123425L0004')
    expect(marcarMock).toHaveBeenCalledWith(['a'])
  })
})
```

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/modules/etiquetas/application/__tests__/etiquetar-rolo.test.ts --exclude "**/.claude/**"`
Esperado: FALHA com módulo não encontrado.

- [ ] **Passo 3: acrescente as leituras e escritas ao repositório**

Em `src/modules/etiquetas/infra/etiqueta-legado-repository.ts`, seguindo o molde das funções que já
estão lá (`emitirEtiquetasLegado`, linha 62): acrescente `listarPendentesLegado`,
`listarImpressasLegado(desde, ate)`, `removerPendenteLegado(id)` e `marcarImpressasLegado(ids)`.

A leitura das pendentes é um `select` direto na tabela (a RLS da 0126 já exige
`recebimento:visualizar`), ordenado por `created_at desc`:

```ts
const { data, error } = await supabase
  .from('etiquetas_legado')
  .select('id,item,pedido,sequencial,codigo,usuario_nome,created_at,impressa_em')
  .is('impressa_em', null)
  .order('created_at', { ascending: false })
  .limit(LIMITE_LINHAS_LEGADO + 1)
```

Peça `LIMITE_LINHAS_LEGADO + 1` e devolva `cortada: linhas.length > LIMITE_LINHAS_LEGADO`,
exibindo só `LIMITE_LINHAS_LEGADO` — assim o aviso "há mais" não aparece quando há exatamente o
limite. As escritas vão pelas RPCs da Task 2.

- [ ] **Passo 4: escreva as actions**

Crie `src/modules/etiquetas/application/etiquetar-rolo.ts` com `'use server'` no topo, exportando
**só funções async**, com as assinaturas do bloco **Interfaces** acima e as mensagens da tabela de
recusas. O gate de permissão é o do banco (as RPCs já recusam com `SEM_PERMISSAO`); a action
traduz o erro para a frase da tabela.

- [ ] **Passo 5: rode e veja passar**

Run: `npx vitest run src/modules/etiquetas/application/__tests__/etiquetar-rolo.test.ts --exclude "**/.claude/**"`
Esperado: PASSA.

- [ ] **Passo 6: confira tipos, lint e build**

```bash
npx tsc --noEmit
npx eslint src/modules/etiquetas
npx next build
```
Esperado: os três limpos. O `next build` é o que pega `'use server'` exportando algo que não é
função async.

- [ ] **Passo 7: commit**

```bash
git add src/modules/etiquetas/infra/etiqueta-legado-repository.ts src/modules/etiquetas/application/etiquetar-rolo.ts src/modules/etiquetas/application/__tests__/etiquetar-rolo.test.ts src/modules/etiquetas/domain/partnumber-legado.ts
git commit -m "etiquetas: as ações de etiquetar o rolo, listar o que falta e gerar o arquivo"
```

---

### Task 4: a tela do inventário rotativo, e a da planilha sai do menu

**Arquivos:**
- Criar: `src/app/(app)/recebimento/etiquetar-rolo/page.tsx`
- Criar: `src/app/(app)/recebimento/etiquetar-rolo/etiquetar-rolo-cliente.tsx`
- Modificar: `src/shared/ui/app-shell.tsx:83`
- Teste: `src/app/(app)/recebimento/etiquetar-rolo/__tests__/etiquetar-rolo-cliente.test.tsx`

**Interfaces:**
- Consome: as seis actions da Task 3 e `RoloEtiquetado` do domínio.

**Contexto que você precisa:**

O molde da página e do gate é `src/app/(app)/recebimento/etiquetas-legado/page.tsx` (55 linhas) —
mesma permissão (`gerar_etiqueta`), mesma moldura.

**UX travada do projeto:** esta é uma tela de **operação com o tablet na mão**, mas não é um bipe —
é digitação. Use `toast` (o `Toaster` global já é `bottom-center`) para o resultado de cada ação,
como as telas de gestor fazem. O painel fixo grande é só para telas de bipe.

**O download** é o mesmo `dispararDownload` que já existe em
`src/app/(app)/recebimento/etiquetas-legado/etiquetas-legado-cliente.tsx:48` — copie a função.

**O comportamento do formulário, que é o coração da tela:**

- dois campos: **Código do componente** (obrigatório) e **Pedido** (opcional);
- Enter no campo Pedido, ou o botão **Adicionar**, chama `etiquetarRoloAction`;
- deu certo: a linha entra no topo da lista, o campo **Código é limpo e recebe o foco**, e o campo
  **Pedido CONTINUA preenchido** — na recontagem vêm vários rolos seguidos do mesmo pedido;
- deu errado: toast com a mensagem, **nada é limpo** (ele corrige o que digitou);
- a lista mostra **o código final por extenso** — é a única conferência que existe, já que o código
  digitado não é validado contra nada.

- [ ] **Passo 1: escreva os testes que falham**

Crie o teste do cliente (molde: `src/app/(app)/recebimento/etiquetas-legado/__tests__/` ou o
`gate-etiquetas-legado.test.tsx` que já existe na branch), cobrindo:

```tsx
it('depois de adicionar, o Código limpa e o Pedido continua', async () => {
  // preenche CAPA78 + 1234/25, adiciona
  expect(campoCodigo).toHaveValue('')
  expect(campoPedido).toHaveValue('1234/25')
})

it('a lista mostra o código final por extenso', async () => {
  expect(await screen.findByText('CAPA78-123425L0004')).toBeInTheDocument()
})

it('recusa mostra o motivo e não limpa o que foi digitado', async () => {
  // action devolve { ok: false, erro: 'Não consegui ler o pedido "abc". ...' }
  expect(await screen.findByText(/Não consegui ler o pedido/)).toBeInTheDocument()
  expect(campoCodigo).toHaveValue('CAPA78')
})

it('sem pendentes, o botão de gerar o CSV fica desabilitado', () => { /* ... */ })
```

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/app/\(app\)/recebimento/etiquetar-rolo --exclude "**/.claude/**"`
Esperado: FALHA com módulo não encontrado.

- [ ] **Passo 3: escreva a página e o cliente**

A página é Server Component com o gate de `gerar_etiqueta`, no molde da
`etiquetas-legado/page.tsx`. O cliente tem: o formulário, a lista de pendentes com **remover** em
cada linha, o botão **Gerar etiquetas (CSV)** (desabilitado quando não há pendentes) e a aba
**Já impressas** com filtro por data e **Baixar de novo**.

- [ ] **Passo 4: troque o item do menu**

Em `src/shared/ui/app-shell.tsx`, linha 83, troque a entrada da tela da planilha pela nova:

```ts
{ chave: 'etiquetar-rolo', rotulo: 'Etiquetar rolo', href: '/recebimento/etiquetar-rolo', icone: Tags, modulo: 'recebimento', perm: 'gerar_etiqueta' },
```

⚠️ **Só sai do menu — a rota `/recebimento/etiquetas-legado` continua de pé**, com o gate que já
tem. É o "deixa oculta" que o usuário pediu: se um dia servir para conferir a recontagem contra o
saldo do ERP, é uma linha para devolver ao menu.

- [ ] **Passo 5: rode e veja passar**

Run: `npx vitest run src/app/\(app\)/recebimento/etiquetar-rolo --exclude "**/.claude/**"`
Esperado: PASSA.

- [ ] **Passo 6: confira que a tela antiga continua alcançável**

Run: `npx next build`
Esperado: exit 0, e **as duas rotas** aparecem na lista — `/recebimento/etiquetar-rolo` e
`/recebimento/etiquetas-legado`.

- [ ] **Passo 7: rode o que você tocou**

```bash
npx vitest run src/modules/etiquetas src/app/\(app\)/recebimento --exclude "**/.claude/**"
npx tsc --noEmit
npx eslint src/app/\(app\)/recebimento/etiquetar-rolo src/shared/ui/app-shell.tsx
```
Esperado: os três limpos.

- [ ] **Passo 8: commit**

```bash
git add src/app/\(app\)/recebimento/etiquetar-rolo src/shared/ui/app-shell.tsx
git commit -m "etiquetas: a tela do inventário rotativo, e a da planilha sai do menu"
```

---

## Depois das quatro tarefas

1. Revisão da branch inteira com `superpowers:requesting-code-review`.
2. **Conferir a numeração da 0135** contra o que já tiver mergeado (0126, 0128–0133, 0134 estavam
   em branches abertas em 30/09).
3. Aplicar a 0126 **e** a 0135 no Dev — a 0126 já está lá, então na prática é só a 0135.
4. Smoke guiado: etiquetar um rolo com pedido, um sem, um código com separador (tem que recusar),
   um pedido ilegível (tem que recusar), remover uma linha e conferir que o número **não** volta,
   gerar o CSV e abrir o arquivo, e baixar de novo pela aba de impressas.
5. Merge.
