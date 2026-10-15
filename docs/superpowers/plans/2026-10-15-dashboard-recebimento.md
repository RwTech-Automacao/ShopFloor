# Dashboard de divergências do Recebimento — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar.

**Goal:** uma tela de leitura em `/recebimento/dashboard` que responde de relance *quanto do que chegou veio com divergência de quantidade, de quem, quando — e quanto ainda ninguém explicou*: filtros em cima (na URL), três números grandes com ⓘ, rodapé da contagem e três gráficos (ranking por fornecedor, divergências por semana, positivas × negativas) em que clicar filtra a tela inteira. A mesma migração fecha o furo da justificativa gravada sem aparar.

**Architecture:** o banco agrega tudo numa chamada só (`rec_dashboard`, migração **0152**, molde das `rec_*` da 0124: `security definer`, `tem_permissao('recebimento', 'visualizar')` de dois argumentos, `$func$`, grants). O app tem um domínio puro (`domain/dashboard.ts`: tipos, filtros ↔ URL, 90 dias, porcentagem, ⓘ, o que cada clique faz; `domain/dashboard-grafico.ts`: a escala do gráfico semanal), um repositório fino (`infra/dashboard-repository.ts`), uma página servidor com o gate e componentes cliente que só desenham e navegam. **O estado mora na URL:** aplicar um filtro é `router.push` para a URL nova e o servidor recalcula — o link compartilhado reproduz a tela.

**Tech Stack:** Next.js 16.3 (App Router, Server Components, `searchParams` como Promise), React 19, TypeScript, Tailwind v4 (tokens do tema em `src/app/globals.css`, variante `dark:`), lucide-react 1.23, Vitest 4 + Testing Library (jsdom), Supabase/Postgres 15, harness SQL em Docker (`supabase/tests/`).

**Spec (fonte da verdade):** `docs/superpowers/specs/2026-10-14-dashboard-recebimento-design.md` — leia inteira antes, inclusive §6.1 e §10.

**Branch / worktree:** `feat/recebimento-dashboard-divergencia`, em `/home/rwtech/Área de trabalho/ShopFloor-dash-receb`. Todo comando abaixo roda a partir dessa pasta.

---

## Decisões que este plano fixa (onde a spec deixou espaço)

Cada uma está implementada e testada nas tarefas; quem executa **não** decide de novo.

1. **`p_sinal` (7º parâmetro, fora da assinatura da spec).** A spec manda "clicar numa fatia positiva/negativa aplica o filtro correspondente", mas a assinatura de `rec_dashboard` não tinha como receber esse filtro. Com `p_sinal = 'positiva' | 'negativa'`, "divergente" vira "divergente daquele sinal" em `com_divergencia`, `sem_justificativa`, no ranking e na série; **`itens`, `positivas` e `negativas` não mudam** (os dois contadores continuam visíveis, para dar para trocar de sinal). Assim o cartão "Com divergência (só positivas)" bate com o filtro rápido "positivas" da grade.
2. **Fornecedor em branco não filtra.** Texto vazio, no banco, é "sem filtro" (spec §6). A barra "(sem fornecedor)" aparece no ranking, mas não é clicável (title explica).
3. **"Limpar filtros" tira TODOS, inclusive o período** (spec §4: "tira todas" as etiquetas; o período padrão é uma etiqueta). A URL vira `?periodo=tudo`. Para voltar aos 90 dias, basta abrir o item do menu (URL sem parâmetros).
4. **Cliques aplicam, não alternam.** Tirar um filtro é pela etiqueta (spec §4). Clicar numa semana troca o período por aquela semana (segunda a domingo).
5. **"em 42 EMBs" do rodapé = EMBs distintas entre os itens do recorte** (com ou sem divergência). A spec não diz qual; o ⓘ do rodapé diz.
6. **Ranking e positivas × negativas em barras HTML; só o semanal em SVG.** A spec diz "SVG à mão, como os do dashboard do ShopFloor" — mas os gráficos do dashboard do ShopFloor (`src/app/(app)/shopfloor/analisar/dashboard/dashboard-painel.tsx`) são barras HTML/CSS (o único SVG à mão do projeto é o gráfico de produção do Fluxo do ShopFloor). Barra horizontal com nome longo fica melhor em HTML (reticências + `title`, botão acessível, cabe no celular). O gráfico semanal, que precisa de eixo, é SVG. Nenhum depende de código do ShopFloor: a ideia é copiada.
7. **As opções das listas incluem fornecedores/compradores que só têm processos cancelados** (spec §4: "os valores distintos que existem"); escolher um deles dá zero.
8. **Série semanal:** vai de `De` (ou da 1ª chegada do recorte) até `Até` (ou da última). `De > Até` dá série vazia. Itens sem `data_chegada` contam nos totais quando NÃO há recorte de data, mas nunca entram na série (o ⓘ do gráfico diz).
9. **Harness: banco próprio.** O dashboard conta a TABELA INTEIRA; a massa do `recebimento_fluxo_test.sql` mudaria todos os totais. Os testes da 0152 rodam no banco `dashboard`, dentro do mesmo contêiner do `rodar-recebimento-test.sh`.
10. **`with base as not materialized`.** `base` é lida duas vezes; sem isto o Postgres a materializa inteira e o filtro de data não chega à tabela (medido no harness com 300 mil linhas: 324 ms → 109 ms no recorte de 90 dias). Isso é correção de plano, não índice; o índice continua decidido pela medição (Task 1, passo 13, e Task 6).
11. **Corte das tarefas (ajuste ao sugerido):** a página foi da Task 3 para a Task 4. A página renderiza o componente cliente da tela; se ela nascesse na Task 3, a Task 4 teria de reescrever o arquivo. Agora: Task 3 = repositório + menu; Task 4 = página + filtros + cartões + rodapé; Task 5 = gráficos (edita o orquestrador com três trocas exatas).

---

## Global Constraints

Valem para **todas** as tarefas; os requisitos de cada tarefa incluem esta seção implicitamente.

- **Idioma:** tudo em português do Brasil — nomes, comentários, mensagens de teste, textos de tela, mensagens de commit.
- **AGENTS.md:** este Next.js tem mudanças que quebram o que você conhece. Toda tarefa que mexe em rota, `searchParams`, Server Component ou `'use client'` lê antes o guia correspondente em `node_modules/next/dist/docs/` (a tarefa diz qual).
- **Migração:** número **0152** (`supabase/migrations/0152_rec_dashboard.sql`; a 0149–0151 estão na `feat/alertas-fim-de-emb`, 0128–0134 em outras branches, Prod está em 0148). Aditiva e idempotente: `create or replace function`, grants, um `update` que na segunda rodada não acha linha. **`$func$` só — nunca dois cifrões, nem em comentário** (o SQL Editor do Supabase recusa o arquivo inteiro). `notify pgrst, 'reload schema';` **uma vez, na última linha**. Cabeçalho com o QUÊ, o PORQUÊ e as duas linhas de como aplicar (SQL Editor; `psql -1 -v ON_ERROR_STOP=1 -f`), no estilo da `0141_alertas_resumo_diario.sql`.
- **`tem_permissao` SEMPRE com dois argumentos:** `tem_permissao('recebimento', 'visualizar')` (e `'administrar'` na justificativa). A de um argumento aceita qualquer módulo e anula o RBAC.
- **Régua (spec §3, literal):** `status <> 'cancelado'`; com divergência = `divergencia_num <> 0`; sem justificativa = com divergência e `btrim(divergencia_justificativa) = ''`; positiva/negativa pelo sinal; contado por `data_chegada`; sem `data_chegada` = fora de qualquer recorte por data (o rodapé diz quantos); `divergencia_num` nulo conta em Itens e nunca em "com divergência"; porcentagem **não** arredonda para 100 quando não é 100.
- **Harness SQL:** `bash supabase/tests/rodar-recebimento-test.sh` (Docker, Postgres descartável). Cada migração aplicada **duas vezes** com `-1 -v ON_ERROR_STOP=1`. Toda asserção tem de **falhar de verdade** se a regra estiver errada — a Task 1 prova por sabotagem.
- **Não rode nada contra Dev nem Prod.** As consultas de Dev/Prod da Task 6 são para o USUÁRIO rodar; você entrega o texto.
- **Vitest:** sempre `npx vitest run --maxWorkers=2` (sem isso o processo morre com exit 137 nesta máquina de 4 núcleos). **Não existe `--reporter=basic`** — não passe essa flag.
- **TDD:** escreva o teste, rode e **veja falhar** pelo motivo certo, implemente, rode e veja passar, commite.
- **`git add` com caminhos explícitos.** Nunca `git add -A`, nunca `git add .`. Não fazer push; não mergear.
- **Commit:** mensagem em português terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Nunca leia nem imprima `.env*`.**
- **`'use server'` não exporta valor que não seja função** (tipos podem; `const`, objetos e arrays não). Este plano não cria arquivo `'use server'`; constantes ficam em `domain/`.
- **Server Component não importa valor de módulo `'use client'`** (vira referência, não o valor). A página importa do `domain/` e do `infra/`; os componentes cliente recebem dados por props.
- **Tema:** cor de texto sempre de token (`text-foreground`, `text-muted-foreground`, `fill-muted-foreground`, `stroke-border`); cor de marca (barra) sempre com par claro/escuro explícito (`fill-[#8D2033] dark:fill-[#d2566c]`). Todo `<rect>` tem `fill` explícito por classe.
- **Celular:** a tela cabe em 360 px com o respiro de 16 px do `<main>` e **sem rolagem horizontal da página** (`min-w-0` nos contêineres de grid/flex, SVG com `h-auto max-w-full`, nomes com `truncate`).

---

## Estrutura de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `supabase/migrations/0152_rec_dashboard.sql` | 1 (criar) | `rec_dashboard`, `rec_dashboard_opcoes`, `rec_justificar_divergencia` aparada, normalização, grants |
| `supabase/tests/recebimento_dashboard_esquema.sql` | 1 (criar) | stubs + tabela mínima do banco `dashboard` |
| `supabase/tests/recebimento_dashboard_massa.sql` | 1 (criar) | 12 linhas conhecidas, ANTES da 0152 |
| `supabase/tests/recebimento_dashboard_test.sql` | 1 (criar) | as asserções (porta, totais, grade, série, ranking, filtros, sinal, opções, justificativa, top 10) |
| `supabase/tests/rodar-recebimento-test.sh` | 1 (modificar) | aplica a 0152 duas vezes no banco `dashboard` e roda o teste |
| `src/modules/recebimento/domain/dashboard.ts` | 2 (criar) | tipos, `FILTROS_LIMPOS`, 90 dias, filtros ↔ URL, cliques, etiquetas, `percentual`, rodapé, `EXPLICA` |
| `src/modules/recebimento/domain/__tests__/dashboard.test.ts` | 2 (criar) | testes do domínio |
| `src/modules/recebimento/infra/dashboard-repository.ts` | 3 (criar) | `carregarDashboard`, `carregarOpcoesDashboard` |
| `src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts` | 3 (criar) | parâmetros do `rpc` e tradução |
| `src/shared/ui/app-shell.tsx` | 3 (modificar) | item "Dashboard" entre Fluxo e Registros; `export` em `RECEBIMENTO` |
| `src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts` | 3 (criar) | posição, rota, permissão e ícone do item |
| `src/app/(app)/recebimento/dashboard/page.tsx` | 4 (criar) | servidor: gate, filtros da URL, as duas chamadas, erro degradado |
| `src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx` | 4 (criar), 5 (modificar) | cliente: navegação pela URL, monta filtros/cartões/gráficos |
| `src/app/(app)/recebimento/dashboard/filtros-dashboard.tsx` | 4 (criar) | formulário, Limpar filtros, etiquetas removíveis |
| `src/app/(app)/recebimento/dashboard/cartoes-dashboard.tsx` | 4 (criar) | três cartões + rodapé |
| `src/app/(app)/recebimento/dashboard/explica.tsx` | 4 (criar) | o ⓘ (Popover) |
| `src/app/(app)/recebimento/dashboard/__tests__/page.test.tsx` | 4 (criar) | gate e filtros da URL |
| `src/app/(app)/recebimento/dashboard/__tests__/filtros-cartoes.test.tsx` | 4 (criar) | formulário, etiquetas, cartões, rodapé |
| `src/modules/recebimento/domain/dashboard-grafico.ts` | 5 (criar) | escala e geometria do gráfico semanal |
| `src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts` | 5 (criar) | uma escala, empilhamento, bordas, 1 semana, muitas semanas |
| `src/app/(app)/recebimento/dashboard/graficos-dashboard.tsx` | 5 (criar) | `CartaoGrafico`, `LegendaSemanas`, `RankingFornecedores`, `GraficoSemanas`, `PositivasNegativas` |
| `src/app/(app)/recebimento/dashboard/__tests__/graficos-dashboard.test.tsx` | 5 (criar) | os três gráficos, vazios e casos de borda |
| `src/app/(app)/recebimento/dashboard/__tests__/dashboard-recebimento.test.tsx` | 5 (criar) | clique → URL |

---

## Task 1: Migração 0152 + testes SQL + medição que decide o índice

**Arquivos:**
- Criar: `supabase/tests/recebimento_dashboard_esquema.sql`, `supabase/tests/recebimento_dashboard_massa.sql`, `supabase/tests/recebimento_dashboard_test.sql`, `supabase/migrations/0152_rec_dashboard.sql`
- Modificar: `supabase/tests/rodar-recebimento-test.sh`

**Interfaces — produz (contrato que as Tasks 3–5 consomem):**

```text
public.rec_dashboard(
  p_fornecedor text default null,   -- '' ou null = sem filtro; comparação exata depois de btrim
  p_comprador  text default null,   -- idem
  p_emb        text default null,   -- exata sem diferenciar maiúsculas (upper(btrim))
  p_codigo     text default null,   -- idem, sobre codigo_material
  p_de         date default null,   -- data_chegada >= p_de (null = aberto)
  p_ate        date default null,   -- data_chegada <= p_ate (null = aberto)
  p_sinal      text default null    -- '' | 'positiva' | 'negativa'; outro valor → SINAL_INVALIDO
) returns jsonb
  {
    "totais": { "itens", "com_divergencia", "sem_justificativa", "positivas", "negativas",
                "embs", "fora_do_recorte_por_data" },               -- todos inteiros
    "fornecedores": [ { "fornecedor": text ('' = em branco), "divergentes": int, "itens": int } ],  -- até 10,
                     -- só com divergentes > 0, ordem: divergentes desc, fornecedor asc
    "semanas": [ { "inicio": "AAAA-MM-DD" (segunda), "justificadas": int, "sem_justificativa": int } ]
                     -- contínua, em ordem; [] quando o recorte não tem data nenhuma ou De > Até
  }
  Sem recebimento.visualizar → raise 'SEM_PERMISSAO'.

public.rec_dashboard_opcoes() returns jsonb
  { "fornecedores": [text], "compradores": [text] }   -- distintos, aparados, não vazios, ordenados
  Sem recebimento.visualizar → raise 'SEM_PERMISSAO'.

public.rec_justificar_divergencia(p_id uuid, p_texto text) returns void   -- MESMA assinatura da 0143
  grava coalesce(btrim(p_texto), ''); porta recebimento.administrar; security definer.
```

**Leia antes:** `supabase/migrations/0124_recebimento_fluxo_registros.sql` (o molde: `security definer`, `set search_path`, porta de dois argumentos, revoke/grant), `0143_rec_justificar_divergencia.sql` (a função que a 0152 recria), `0147_divergencia_num.sql` (a coluna gerada e o índice parcial), `0142_divergencia_justificativa.sql` (a coluna `divergencia_justificativa` é `not null default ''`), `0141_alertas_resumo_diario.sql` (o estilo do cabeçalho), `supabase/tests/rodar-recebimento-test.sh` e `supabase/tests/recebimento_fluxo_test.sql` (como o stub de `tem_permissao` lê `teste.perms` e como os testes levantam `FALHOU`).

- [ ] **Passo 1: criar o esquema do banco de teste**

`supabase/tests/recebimento_dashboard_esquema.sql`:

```sql
-- Esquema mínimo para os testes do dashboard do Recebimento (0152), num banco PRÓPRIO (`dashboard`)
-- dentro do contêiner de supabase/tests/rodar-recebimento-test.sh. Banco próprio porque o dashboard
-- conta a TABELA INTEIRA: a massa do recebimento_fluxo_test.sql mudaria todos os totais.
-- Roda ANTES das migrações (0142, 0143, 0147, 0152), que o runner aplica uma a uma.

-- ---------- stubs mínimos do Supabase ----------
-- Papéis são do CLUSTER, não do banco: o recebimento_fluxo_test.sql (banco postgres, mesmo contêiner)
-- já os criou. Criar só o que faltar.
do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $r$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;
-- `teste.perms` = lista 'modulo.permissao' separada por vírgula (mesmo stub do recebimento_fluxo_test.sql).
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

-- FK da 0142 (divergencia_justificada_por) e o nome lido pela rec_justificar_divergencia.
create table public.usuarios (id uuid primary key, nome text not null default '', email text);

-- As colunas que o dashboard lê, com os tipos do banco real (0004): data_chegada é DATE.
create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'aberto',
  numero_emb text,
  fornecedor text,
  comprador text,
  codigo_material text,
  data_chegada date,
  divergencia text,
  created_at timestamptz not null default now()
);
```

- [ ] **Passo 2: criar a massa conhecida**

`supabase/tests/recebimento_dashboard_massa.sql`:

```sql
-- Massa do dashboard (0152). Roda DEPOIS da 0142/0143/0147 e ANTES da 0152: as linhas 104 e 105
-- nascem com a justificativa como pode estar no banco hoje, para a normalização da 0152 agir.
--
-- Semanas (segunda a domingo):  A = 07/09–13/09/2026 · B = 14/09–20/09 (VAZIA) · C = 21/09–27/09
--
--  id   status          fornecedor  comprador  EMB   código  chegada     divergência  justificativa
--  101  aberto          Panasonic   Joana      EMB1  CAP1    08/09 (A)   -10          ''
--  102  finalizado      Panasonic   Joana      EMB1  CAP2    09/09 (A)   5            'Fornecedor mandou a mais'
--  103  finalizado      Panasonic   Joana      EMB1  CAP3    10/09 (A)   0            ''
--  104  em_conferencia  Vishay      Pedro      EMB2  RES1    22/09 (C)   3            '   '  (só espaços)
--  105  finalizado      Vishay      Pedro      EMB2  RES2    23/09 (C)   -1,5         '  alinhado  '
--  106  finalizado      Vishay      Pedro      EMB2  RES3    24/09 (C)   nulo         ''
--  107  finalizado      Vishay      Pedro      EMB2  RES4    24/09 (C)   'ok'         ''
--  108  cancelado       Vishay      Pedro      EMB2  RES5    24/09 (C)   99           ''   ← fora de tudo
--  109  aberto          (nulo)      Joana      EMB3  DIO1    25/09 (C)   7            ''
--  110  aberto          Acme        Pedro      EMB4  X1      (nula)      2            ''
--  111  aberto          ACME        Pedro      EMB4  X2      21/09 (C)   -4           ''
--  112  finalizado      Panasonic   Joana      EMB0  OLD1    01/06       8            ''
--
-- As contas esperadas estão no cabeçalho de recebimento_dashboard_test.sql.
insert into public.processos_recebimento
  (id, status, fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia, divergencia_justificativa)
values
  ('00000000-0000-0000-0000-000000000101', 'aberto',         'Panasonic', 'Joana', 'EMB1', 'CAP1', '2026-09-08', '-10',  ''),
  ('00000000-0000-0000-0000-000000000102', 'finalizado',     'Panasonic', 'Joana', 'EMB1', 'CAP2', '2026-09-09', '5',    'Fornecedor mandou a mais'),
  ('00000000-0000-0000-0000-000000000103', 'finalizado',     'Panasonic', 'Joana', 'EMB1', 'CAP3', '2026-09-10', '0',    ''),
  ('00000000-0000-0000-0000-000000000104', 'em_conferencia', 'Vishay',    'Pedro', 'EMB2', 'RES1', '2026-09-22', '3',    '   '),
  ('00000000-0000-0000-0000-000000000105', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES2', '2026-09-23', '-1,5', '  alinhado  '),
  ('00000000-0000-0000-0000-000000000106', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES3', '2026-09-24', null,   ''),
  ('00000000-0000-0000-0000-000000000107', 'finalizado',     'Vishay',    'Pedro', 'EMB2', 'RES4', '2026-09-24', 'ok',   ''),
  ('00000000-0000-0000-0000-000000000108', 'cancelado',      'Vishay',    'Pedro', 'EMB2', 'RES5', '2026-09-24', '99',   ''),
  ('00000000-0000-0000-0000-000000000109', 'aberto',         null,        'Joana', 'EMB3', 'DIO1', '2026-09-25', '7',    ''),
  ('00000000-0000-0000-0000-000000000110', 'aberto',         'Acme',      'Pedro', 'EMB4', 'X1',   null,         '2',    ''),
  ('00000000-0000-0000-0000-000000000111', 'aberto',         'ACME',      'Pedro', 'EMB4', 'X2',   '2026-09-21', '-4',   ''),
  ('00000000-0000-0000-0000-000000000112', 'finalizado',     'Panasonic', 'Joana', 'EMB0', 'OLD1', '2026-06-01', '8',    '');
```

- [ ] **Passo 3: criar o arquivo de teste**

`supabase/tests/recebimento_dashboard_test.sql`:

```sql
-- Testes do dashboard do Recebimento e da justificativa aparada (migração 0152).
-- Roda no banco `dashboard` de supabase/tests/rodar-recebimento-test.sh, DEPOIS de:
--   recebimento_dashboard_esquema.sql → 0142 → 0143 → 0147 → recebimento_dashboard_massa.sql → 0152 → 0152
-- Tudo numa conexão só (as configurações `teste.*` alimentam os stubs de auth/RBAC).
--
-- Contas esperadas (ver a tabela da massa):
--   SEM filtro nenhum:  itens 11 (108 cancelado fora) · com divergência 8 (101,102,104,105,109,110,111,112)
--                       sem justificativa 6 (101,104,109,110,111,112) · positivas 5 · negativas 3 · EMBs 5
--   07/09 a 27/09:      itens 9 · com divergência 6 · sem justificativa 4 · positivas 3 · negativas 3
--                       EMBs 4 · fora do recorte por data 1 (a 110, sem data_chegada)
--                       semanas: 07/09 (1 just., 1 sem) · 14/09 (0, 0) · 21/09 (1 just., 3 sem)
--                       fornecedores: Panasonic 2/3 · Vishay 2/4 · '' 1/1 · ACME 1/1

-- Confere um número; a mensagem diz o que era esperado e o que veio.
create function pg_temp.confere(p_rotulo text, p_obtido bigint, p_esperado bigint) returns void
language plpgsql as $f$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % devia ser % e veio %', p_rotulo, p_esperado, coalesce(p_obtido::text, 'nulo');
  end if;
end $f$;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- ---------- 0. a porta: recebimento.visualizar, e só ela ----------
do $t$
begin
  perform set_config('teste.perms', '', false);
  begin
    perform rec_dashboard();
    raise exception 'FALHOU: rec_dashboard sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform rec_dashboard_opcoes();
    raise exception 'FALHOU: rec_dashboard_opcoes sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  -- Quem só tem ShopFloor (e quem só edita o Recebimento) não vê.
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.editar', false);
  begin
    perform rec_dashboard();
    raise exception 'FALHOU: permissão de outro módulo abriu rec_dashboard';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform rec_dashboard_opcoes();
    raise exception 'FALHOU: permissão de outro módulo abriu rec_dashboard_opcoes';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  raise notice 'porta do dashboard: ok';
end $t$;

do $t$
begin
  if has_function_privilege('anon', 'public.rec_dashboard(text, text, text, text, date, date, text)', 'execute') then
    raise exception 'FALHOU: anon executa rec_dashboard (faltou o revoke)'; end if;
  if has_function_privilege('anon', 'public.rec_dashboard_opcoes()', 'execute') then
    raise exception 'FALHOU: anon executa rec_dashboard_opcoes (faltou o revoke)'; end if;
  if not has_function_privilege('authenticated', 'public.rec_dashboard(text, text, text, text, date, date, text)', 'execute') then
    raise exception 'FALHOU: authenticated não executa rec_dashboard'; end if;
  if not has_function_privilege('authenticated', 'public.rec_dashboard_opcoes()', 'execute') then
    raise exception 'FALHOU: authenticated não executa rec_dashboard_opcoes'; end if;
  if (select count(*) from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('rec_dashboard', 'rec_dashboard_opcoes', 'rec_justificar_divergencia')
         and prosecdef) <> 3 then
    raise exception 'FALHOU: as três funções têm que ser security definer'; end if;
  raise notice 'grants e security definer: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 1. totais sem filtro nenhum ----------
do $t$
declare v jsonb := rec_dashboard();
begin
  perform pg_temp.confere('itens (sem filtro)',             (v->'totais'->>'itens')::bigint, 11);
  perform pg_temp.confere('com divergência (sem filtro)',   (v->'totais'->>'com_divergencia')::bigint, 8);
  perform pg_temp.confere('sem justificativa (sem filtro)', (v->'totais'->>'sem_justificativa')::bigint, 6);
  perform pg_temp.confere('positivas (sem filtro)',         (v->'totais'->>'positivas')::bigint, 5);
  perform pg_temp.confere('negativas (sem filtro)',         (v->'totais'->>'negativas')::bigint, 3);
  perform pg_temp.confere('EMBs (sem filtro)',              (v->'totais'->>'embs')::bigint, 5);
  -- Sem recorte de data ninguém "fica de fora do período".
  perform pg_temp.confere('fora do recorte (sem data)',     (v->'totais'->>'fora_do_recorte_por_data')::bigint, 0);
  -- Texto vazio = sem filtro: tem que dar exatamente o mesmo resultado.
  if rec_dashboard('', '', '', '', null, null, '') is distinct from v then
    raise exception 'FALHOU: texto vazio tinha que valer como sem filtro'; end if;
  raise notice 'totais sem filtro: ok';
end $t$;

-- ---------- 2. totais no recorte 07/09 a 27/09 ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('itens (recorte)',             (v->'totais'->>'itens')::bigint, 9);
  perform pg_temp.confere('com divergência (recorte)',   (v->'totais'->>'com_divergencia')::bigint, 6);
  perform pg_temp.confere('sem justificativa (recorte)', (v->'totais'->>'sem_justificativa')::bigint, 4);
  perform pg_temp.confere('positivas (recorte)',         (v->'totais'->>'positivas')::bigint, 3);
  perform pg_temp.confere('negativas (recorte)',         (v->'totais'->>'negativas')::bigint, 3);
  perform pg_temp.confere('EMBs (recorte)',              (v->'totais'->>'embs')::bigint, 4);
  -- A 110 (Acme) não tem data_chegada: fica fora do recorte e o rodapé conta. A 108 (cancelada)
  -- não conta nem aqui.
  perform pg_temp.confere('fora do recorte por data',    (v->'totais'->>'fora_do_recorte_por_data')::bigint, 1);
  raise notice 'totais no recorte: ok';
end $t$;

-- ---------- 3. os números batem com a CONDIÇÃO da grade de Processos ----------
-- Até a branch feat/recebimento-filtros-divergencia chegar à main, a comparação é contra a
-- condição (divergencia_num <> 0 / > 0 / < 0, e status <> 'cancelado'), não contra a tela.
do $t$
declare
  v_tudo jsonb := rec_dashboard();
  v_rec  jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('com divergência × grade (sem filtro)', (v_tudo->'totais'->>'com_divergencia')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num <> 0 and status <> 'cancelado'));
  perform pg_temp.confere('positivas × grade (sem filtro)', (v_tudo->'totais'->>'positivas')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num > 0 and status <> 'cancelado'));
  perform pg_temp.confere('negativas × grade (sem filtro)', (v_tudo->'totais'->>'negativas')::bigint,
    (select count(*) from public.processos_recebimento where divergencia_num < 0 and status <> 'cancelado'));
  perform pg_temp.confere('com divergência × grade (recorte)', (v_rec->'totais'->>'com_divergencia')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num <> 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  perform pg_temp.confere('positivas × grade (recorte)', (v_rec->'totais'->>'positivas')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num > 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  perform pg_temp.confere('negativas × grade (recorte)', (v_rec->'totais'->>'negativas')::bigint,
    (select count(*) from public.processos_recebimento
      where divergencia_num < 0 and status <> 'cancelado' and data_chegada between '2026-09-07' and '2026-09-27'));
  -- positivas + negativas fecha com "com divergência": nenhuma divergente sem sinal.
  perform pg_temp.confere('positivas + negativas = com divergência',
    (v_rec->'totais'->>'positivas')::bigint + (v_rec->'totais'->>'negativas')::bigint,
    (v_rec->'totais'->>'com_divergencia')::bigint);
  raise notice 'números batem com a condição da grade: ok';
end $t$;

-- ---------- 4. a série semanal ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('quantidade de semanas', jsonb_array_length(v->'semanas'), 3);
  if v->'semanas'->0->>'inicio' <> '2026-09-07' or v->'semanas'->1->>'inicio' <> '2026-09-14'
     or v->'semanas'->2->>'inicio' <> '2026-09-21' then
    raise exception 'FALHOU: as semanas começam na segunda e seguem em ordem (veio %)', v->'semanas'; end if;
  -- A semana 14/09 não tem nada: tem que ESTAR na série, com zero (o eixo não pula semana).
  perform pg_temp.confere('semana vazia, justificadas', (v->'semanas'->1->>'justificadas')::bigint, 0);
  perform pg_temp.confere('semana vazia, sem justificativa', (v->'semanas'->1->>'sem_justificativa')::bigint, 0);
  perform pg_temp.confere('semana 07/09, justificadas', (v->'semanas'->0->>'justificadas')::bigint, 1);
  perform pg_temp.confere('semana 07/09, sem justificativa', (v->'semanas'->0->>'sem_justificativa')::bigint, 1);
  perform pg_temp.confere('semana 21/09, justificadas', (v->'semanas'->2->>'justificadas')::bigint, 1);
  -- 104 (só espaços, normalizada pela 0152), 109 e 111.
  perform pg_temp.confere('semana 21/09, sem justificativa', (v->'semanas'->2->>'sem_justificativa')::bigint, 3);

  -- Só "De": a série vai até a última chegada do recorte — uma semana só.
  v := rec_dashboard(p_de => '2026-09-21');
  perform pg_temp.confere('semanas a partir de 21/09', jsonb_array_length(v->'semanas'), 1);
  perform pg_temp.confere('itens a partir de 21/09', (v->'totais'->>'itens')::bigint, 6);
  perform pg_temp.confere('fora do recorte, só De', (v->'totais'->>'fora_do_recorte_por_data')::bigint, 1);

  -- De > Até: recorte vazio, série vazia, sem erro.
  v := rec_dashboard(p_de => '2026-09-27', p_ate => '2026-09-07');
  perform pg_temp.confere('itens com De > Até', (v->'totais'->>'itens')::bigint, 0);
  if v->'semanas' <> '[]'::jsonb then raise exception 'FALHOU: De > Até tinha que dar série vazia'; end if;

  -- De = Até: inclusivo nas duas pontas.
  v := rec_dashboard(p_de => '2026-09-08', p_ate => '2026-09-08');
  perform pg_temp.confere('itens no dia 08/09', (v->'totais'->>'itens')::bigint, 1);
  raise notice 'série semanal: ok';
end $t$;

-- ---------- 5. ranking de fornecedores ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27');
begin
  perform pg_temp.confere('fornecedores no ranking', jsonb_array_length(v->'fornecedores'), 4);
  if v->'fornecedores' <> '[
      {"fornecedor": "Panasonic", "divergentes": 2, "itens": 3},
      {"fornecedor": "Vishay",    "divergentes": 2, "itens": 4},
      {"fornecedor": "",          "divergentes": 1, "itens": 1},
      {"fornecedor": "ACME",      "divergentes": 1, "itens": 1}
    ]'::jsonb then
    raise exception 'FALHOU: ranking de fornecedores (veio %)', v->'fornecedores'; end if;
  raise notice 'ranking de fornecedores: ok';
end $t$;

-- ---------- 6. os filtros ----------
do $t$
declare
  v_rec date := '2026-09-07';
  v_ate date := '2026-09-27';
begin
  perform pg_temp.confere('fornecedor Vishay', (rec_dashboard('Vishay', '', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  perform pg_temp.confere('fornecedor Vishay aparado', (rec_dashboard('  Vishay ', '', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  -- "ACME" e "Acme" são dois fornecedores: comparação exata.
  perform pg_temp.confere('fornecedor ACME', (rec_dashboard(p_fornecedor => 'ACME')->'totais'->>'itens')::bigint, 1);
  perform pg_temp.confere('fornecedor Acme', (rec_dashboard(p_fornecedor => 'Acme')->'totais'->>'itens')::bigint, 1);
  perform pg_temp.confere('fornecedor acme', (rec_dashboard(p_fornecedor => 'acme')->'totais'->>'itens')::bigint, 0);
  perform pg_temp.confere('comprador Pedro', (rec_dashboard('', 'Pedro', '', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 5);
  -- EMB e código: exatos, sem diferenciar maiúsculas.
  perform pg_temp.confere('EMB emb2', (rec_dashboard('', '', ' emb2 ', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 4);
  perform pg_temp.confere('EMB emb', (rec_dashboard('', '', 'emb', '', v_rec, v_ate)->'totais'->>'itens')::bigint, 0);
  perform pg_temp.confere('código cap1', (rec_dashboard(p_codigo => 'cap1')->'totais'->>'itens')::bigint, 1);
  -- Filtros combinados.
  perform pg_temp.confere('Panasonic + EMB1 + recorte',
    (rec_dashboard('Panasonic', 'Joana', 'EMB1', '', v_rec, v_ate)->'totais'->>'com_divergencia')::bigint, 2);
  -- Recorte vazio: tudo zero, listas vazias.
  if rec_dashboard(p_fornecedor => 'Ninguém') <> jsonb_build_object(
       'totais', jsonb_build_object('itens', 0, 'com_divergencia', 0, 'sem_justificativa', 0,
                                    'positivas', 0, 'negativas', 0, 'embs', 0, 'fora_do_recorte_por_data', 0),
       'fornecedores', '[]'::jsonb, 'semanas', '[]'::jsonb) then
    raise exception 'FALHOU: recorte vazio (veio %)', rec_dashboard(p_fornecedor => 'Ninguém'); end if;
  raise notice 'filtros: ok';
end $t$;

-- ---------- 7. o filtro de sinal (clique em positivas / negativas) ----------
do $t$
declare v jsonb := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27', p_sinal => 'positiva');
begin
  perform pg_temp.confere('com divergência (só positivas)', (v->'totais'->>'com_divergencia')::bigint, 3);
  perform pg_temp.confere('sem justificativa (só positivas)', (v->'totais'->>'sem_justificativa')::bigint, 2);
  perform pg_temp.confere('itens não muda com o sinal', (v->'totais'->>'itens')::bigint, 9);
  -- Os dois contadores continuam visíveis, para dar para trocar de sinal.
  perform pg_temp.confere('positivas (só positivas)', (v->'totais'->>'positivas')::bigint, 3);
  perform pg_temp.confere('negativas (só positivas)', (v->'totais'->>'negativas')::bigint, 3);
  if v->'fornecedores' <> '[
      {"fornecedor": "",          "divergentes": 1, "itens": 1},
      {"fornecedor": "Panasonic", "divergentes": 1, "itens": 3},
      {"fornecedor": "Vishay",    "divergentes": 1, "itens": 4}
    ]'::jsonb then
    raise exception 'FALHOU: ranking só de positivas (veio %)', v->'fornecedores'; end if;
  perform pg_temp.confere('semana 21/09 só positivas, sem justificativa', (v->'semanas'->2->>'sem_justificativa')::bigint, 2);

  v := rec_dashboard(p_de => '2026-09-07', p_ate => '2026-09-27', p_sinal => 'negativa');
  perform pg_temp.confere('com divergência (só negativas)', (v->'totais'->>'com_divergencia')::bigint, 3);
  perform pg_temp.confere('sem justificativa (só negativas)', (v->'totais'->>'sem_justificativa')::bigint, 2);

  begin
    perform rec_dashboard(p_sinal => 'zero');
    raise exception 'FALHOU: sinal inválido tinha que levantar SINAL_INVALIDO';
  exception when others then
    if sqlerrm <> 'SINAL_INVALIDO' then raise; end if;
  end;
  raise notice 'filtro de sinal: ok';
end $t$;

-- ---------- 8. as opções das listas suspensas ----------
do $t$
declare v jsonb := rec_dashboard_opcoes();
begin
  -- Ordem conferida com collate "C" dos dois lados: o contêiner de teste não tem a collation do
  -- banco real, e o que importa aqui é o CONJUNTO (sem vazio, sem repetido).
  if (select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(v->'fornecedores') x)
       <> '["ACME", "Acme", "Panasonic", "Vishay"]'::jsonb then
    raise exception 'FALHOU: opções de fornecedor (veio %)', v->'fornecedores'; end if;
  if (select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(v->'compradores') x)
       <> '["Joana", "Pedro"]'::jsonb then
    raise exception 'FALHOU: opções de comprador (veio %)', v->'compradores'; end if;
  raise notice 'opções das listas: ok';
end $t$;

-- ---------- 9. a justificativa aparada (0152 §6.1) ----------
-- 9.1 A normalização: a 104 nasceu com '   ' e agora é ''; a 105 tem texto de verdade (com espaço
-- em volta) e NÃO é tocada; a 102 também não.
do $t$
begin
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000104') <> '' then
    raise exception 'FALHOU: a justificativa só de espaços tinha que virar vazia'; end if;
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000105') <> '  alinhado  ' then
    raise exception 'FALHOU: a normalização mexeu numa justificativa de verdade'; end if;
  if (select divergencia_justificativa from public.processos_recebimento
       where id = '00000000-0000-0000-0000-000000000102') <> 'Fornecedor mandou a mais' then
    raise exception 'FALHOU: a normalização mexeu numa justificativa de verdade (102)'; end if;
  raise notice 'normalização das justificativas só de espaços: ok';
end $t$;

-- 9.2 A função grava aparado.
insert into public.usuarios (id, nome, email) values ('00000000-0000-0000-0000-000000000001', 'Maria Souza', 'maria@enterplak.com.br');
do $t$
declare v_texto text;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', '   ');
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto <> '' then
    raise exception 'FALHOU: só espaços pela função tinha que gravar vazio (veio "%")', v_texto; end if;

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', '  faltou, chega semana que vem  ');
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto <> 'faltou, chega semana que vem' then
    raise exception 'FALHOU: o texto tinha que ser gravado aparado (veio "%")', v_texto; end if;

  perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', null);
  select divergencia_justificativa into v_texto from public.processos_recebimento
   where id = '00000000-0000-0000-0000-000000000101';
  if v_texto is distinct from '' then
    raise exception 'FALHOU: p_texto nulo tinha que gravar vazio (veio %)', coalesce(v_texto, 'NULL'); end if;

  -- A porta continua sendo administrar: visualizar não grava.
  perform set_config('teste.perms', 'recebimento.visualizar,recebimento.editar', false);
  begin
    perform rec_justificar_divergencia('00000000-0000-0000-0000-000000000101', 'tentativa');
    raise exception 'FALHOU: sem administrar tinha que levantar SEM_PERMISSAO';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.rec_justificar_divergencia(uuid, text)', 'execute') then
    raise exception 'FALHOU: anon executa rec_justificar_divergencia (faltou o revoke)'; end if;
  if not has_function_privilege('authenticated', 'public.rec_justificar_divergencia(uuid, text)', 'execute') then
    raise exception 'FALHOU: authenticated perdeu o execute de rec_justificar_divergencia'; end if;
  raise notice 'justificativa aparada pela função: ok';
end $t$;

select set_config('teste.perms', 'recebimento.visualizar', false);

-- ---------- 10. top 10 (por último: a massa extra mudaria os totais acima) ----------
-- 12 fornecedores F01..F12 do comprador 'Lote'; o Fk tem k itens divergentes.
insert into public.processos_recebimento (fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia)
select 'F' || lpad(k::text, 2, '0'), 'Lote', 'EMBLOTE', 'L' || k || '-' || i, '2026-01-05', '1'
  from generate_series(1, 12) k, generate_series(1, k) i
 where i <= k;
do $t$
declare v jsonb := rec_dashboard(p_comprador => 'Lote');
begin
  perform pg_temp.confere('fornecedores no top', jsonb_array_length(v->'fornecedores'), 10);
  if v->'fornecedores'->0->>'fornecedor' <> 'F12' or (v->'fornecedores'->0->>'divergentes')::int <> 12 then
    raise exception 'FALHOU: o primeiro do top tem que ser F12 com 12 (veio %)', v->'fornecedores'->0; end if;
  if v->'fornecedores'->9->>'fornecedor' <> 'F03' then
    raise exception 'FALHOU: o décimo do top tem que ser F03 (veio %)', v->'fornecedores'->9; end if;
  raise notice 'top 10: ok';
end $t$;

select 'RECEBIMENTO DASHBOARD OK' as resultado;
```

- [ ] **Passo 4: ligar o teste ao runner**

Em `supabase/tests/rodar-recebimento-test.sh`, troque a linha 2:

```bash
# Testes SQL do Fluxo e dos Registros do Recebimento (0124/0125/0127/0142/0143/0144/0147) num Postgres descartável.
```

por:

```bash
# Testes SQL do Recebimento (0124/0125/0127/0142/0143/0144/0147 e o dashboard da 0152) num Postgres descartável.
```

e acrescente **no fim do arquivo** (depois do último `|| { echo "idempotência ... FALHOU"; exit 1; }`):

```bash

# ---------- Dashboard (0152) num banco PRÓPRIO ----------
# O dashboard conta a TABELA INTEIRA: a massa do recebimento_fluxo_test.sql mudaria todos os totais.
# Ordem: esquema → 0142/0143/0147 → massa (com justificativa só de espaços, ANTES da 0152, para a
# normalização ter o que normalizar) → 0152 DUAS vezes (idempotência; -1 = cada aplicação numa
# transação, como no SQL Editor) → teste.
docker cp supabase/migrations/0152_rec_dashboard.sql "$NOME":/tmp/0152.sql
docker cp supabase/tests/recebimento_dashboard_esquema.sql "$NOME":/tmp/dash_esquema.sql
docker cp supabase/tests/recebimento_dashboard_massa.sql "$NOME":/tmp/dash_massa.sql
docker cp supabase/tests/recebimento_dashboard_test.sql "$NOME":/tmp/dash_teste.sql
docker exec "$NOME" createdb -U postgres dashboard
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_esquema.sql
for m in 0142 0143 0147; do
  docker exec "$NOME" psql -U postgres -d dashboard -1 -v ON_ERROR_STOP=1 -q -f "/tmp/$m.sql"
done
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_massa.sql
for _ in 1 2; do
  docker exec "$NOME" psql -U postgres -d dashboard -1 -v ON_ERROR_STOP=1 -q -f /tmp/0152.sql
done
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_teste.sql
```

(Os `/tmp/0142.sql`, `/tmp/0143.sql` e `/tmp/0147.sql` já foram copiados para o contêiner no começo do script.)

- [ ] **Passo 5: rodar e ver FALHAR**

```bash
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | tail -5
```

Esperado: os testes antigos passam e o script para em `docker cp supabase/migrations/0152_rec_dashboard.sql ...` com *no such file or directory* (a migração ainda não existe). Exit diferente de zero.

- [ ] **Passo 6: escrever a migração**

`supabase/migrations/0152_rec_dashboard.sql`:

```sql
-- =============================================================
-- RECEBIMENTO — DASHBOARD DE DIVERGÊNCIAS (somente leitura) + justificativa aparada
-- Spec: docs/superpowers/specs/2026-10-14-dashboard-recebimento-design.md
--
-- O QUÊ
--   1. rec_dashboard(...)      → jsonb: os totais, o top 10 de fornecedores e a série semanal de
--                                itens divergentes, NUMA chamada só (a tela /recebimento/dashboard).
--   2. rec_dashboard_opcoes()  → jsonb: fornecedores e compradores distintos, para as duas listas.
--   3. rec_justificar_divergencia(uuid, text) recriada com o texto APARADO (btrim), mais a
--      normalização única das justificativas já gravadas que são só espaços.
--
-- POR QUÊ
--   Agregar no banco: a tabela inteira não vem para o navegador só para somar, e uma chamada só
--   porque o Fluxo do ShopFloor mostrou o custo de 12 requisições no carregamento.
--   A régua é a da spec §3, a mesma do filtro rápido "Divergências" da grade de Processos:
--   item = linha de processos_recebimento; cancelado fica de fora; "com divergência" =
--   divergencia_num <> 0 (coluna gerada da 0147); "sem justificativa" = com divergência e
--   btrim(divergencia_justificativa) = ''; tudo contado por data_chegada.
--   A justificativa: o app apara antes de gravar, mas a função da 0143 gravava sem aparar — uma
--   chamada direta com "   " ficava "justificada" no SQL e "pendente" na tela.
--
-- Fora da spec, de propósito: p_sinal ('positiva' | 'negativa' | ''). Clicar na barra de positivas
-- ou de negativas filtra a tela, e a assinatura da spec não tinha como receber esse filtro. Com
-- sinal, "divergente" passa a ser "divergente daquele sinal" nos totais, no ranking e na série;
-- os contadores positivas/negativas continuam mostrando os dois sinais (para dar para trocar).
--
-- Índice em data_chegada: DECIDIDO PELA MEDIÇÃO (Task 1 do plano). Esta linha é trocada
-- pelo resultado: "não entra — medido em <data>, <n> ms com set role" ou o create index abaixo.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0152_rec_dashboard.sql
--
-- ⚠️ ANTES DO PROD: contar as justificativas só-de-espaços (a consulta de leitura está no plano
-- docs/superpowers/plans/2026-10-15-dashboard-recebimento.md, Task 6)
-- e dizer o número ao usuário. Elas passam de "justificada" para "pendente" no SQL — que é o que
-- a tela já mostrava.
--
-- Aditiva e idempotente: create or replace + grants + um update que, rodado de novo, não acha
-- linha nenhuma. Corpo de função com $func$ (o SQL Editor não aceita dois cifrões, nem em
-- comentário); tem_permissao SEMPRE com dois argumentos (a de um argumento anula o RBAC).
-- =============================================================

-- ---------- 1. o dashboard ----------
-- Texto vazio (ou nulo) = sem filtro. Datas nulas = sem recorte por data. Os 90 dias são padrão
-- da TELA, não daqui.
--   Fornecedor e comprador: comparação exata depois de aparar ("ACME" e "Acme" são dois).
--   EMB e código do material: exata, sem diferenciar maiúsculas.
--   De / Até: sobre data_chegada, inclusivos. Linha sem data_chegada fica fora de qualquer
--   recorte por data e é contada em totais.fora_do_recorte_por_data (só quando há recorte).
create or replace function public.rec_dashboard(
  p_fornecedor text default null,
  p_comprador  text default null,
  p_emb        text default null,
  p_codigo     text default null,
  p_de         date default null,
  p_ate        date default null,
  p_sinal      text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_forn     text := btrim(coalesce(p_fornecedor, ''));
  v_comp     text := btrim(coalesce(p_comprador, ''));
  v_emb      text := upper(btrim(coalesce(p_emb, '')));
  v_cod      text := upper(btrim(coalesce(p_codigo, '')));
  v_sinal    text := lower(btrim(coalesce(p_sinal, '')));
  v_com_data boolean := p_de is not null or p_ate is not null;
  v_resultado jsonb;
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_sinal not in ('', 'positiva', 'negativa') then raise exception 'SINAL_INVALIDO'; end if;

  -- `not materialized`: `base` é lida duas vezes (o recorte e a contagem de fora do período) e, sem
  -- isto, o Postgres a materializaria inteira — o filtro de data não chegaria à tabela. Medido no
  -- harness com 300 mil linhas: 324 ms → 109 ms no recorte de 90 dias.
  with base as not materialized (
    -- Os filtros que NÃO são de data. Daqui sai também a contagem de quem ficou fora do período.
    select btrim(coalesce(p.fornecedor, '')) as fornecedor,
           upper(btrim(coalesce(p.numero_emb, ''))) as emb,
           p.data_chegada,
           p.divergencia_num,
           btrim(coalesce(p.divergencia_justificativa, '')) = '' as sem_texto
      from public.processos_recebimento p
     where p.status <> 'cancelado'
       and (v_forn = '' or btrim(coalesce(p.fornecedor, '')) = v_forn)
       and (v_comp = '' or btrim(coalesce(p.comprador, '')) = v_comp)
       and (v_emb  = '' or upper(btrim(coalesce(p.numero_emb, ''))) = v_emb)
       and (v_cod  = '' or upper(btrim(coalesce(p.codigo_material, ''))) = v_cod)
  ),
  recorte as (
    -- divergencia_num nulo (não conferido, texto) dá nulo na comparação: o coalesce o põe em
    -- "não divergente" — conta em Itens e nunca em "com divergência".
    select b.*,
           coalesce(case v_sinal
                      when 'positiva' then b.divergencia_num > 0
                      when 'negativa' then b.divergencia_num < 0
                      else b.divergencia_num <> 0
                    end, false) as divergente
      from base b
     where (p_de  is null or b.data_chegada >= p_de)
       and (p_ate is null or b.data_chegada <= p_ate)
  ),
  totais as (
    select jsonb_build_object(
             'itens',             count(*),
             'com_divergencia',   count(*) filter (where r.divergente),
             'sem_justificativa', count(*) filter (where r.divergente and r.sem_texto),
             'positivas',         count(*) filter (where r.divergencia_num > 0),
             'negativas',         count(*) filter (where r.divergencia_num < 0),
             'embs',              count(distinct nullif(r.emb, '')),
             'fora_do_recorte_por_data',
               case when v_com_data
                    then (select count(*) from base b where b.data_chegada is null)
                    else 0 end
           ) as j
      from recorte r
  ),
  por_fornecedor as (
    select r.fornecedor,
           count(*) filter (where r.divergente) as divergentes,
           count(*) as itens
      from recorte r
     group by r.fornecedor
  ),
  fornecedores as (
    -- Os 10 com mais itens divergentes; empate desempata pelo nome (a ordem não pode variar entre
    -- duas cargas iguais). Fornecedor em branco vem como '' e a tela escreve "(sem fornecedor)".
    select coalesce(jsonb_agg(jsonb_build_object(
                      'fornecedor',  f.fornecedor,
                      'divergentes', f.divergentes,
                      'itens',       f.itens)
                    order by f.divergentes desc, f.fornecedor), '[]'::jsonb) as j
      from (select * from por_fornecedor
             where divergentes > 0
             order by divergentes desc, fornecedor
             limit 10) f
  ),
  limites as (
    -- A série vai do começo ao fim do recorte; sem recorte, da primeira à última chegada.
    select coalesce(p_de,  min(r.data_chegada), p_ate) as ini,
           coalesce(p_ate, max(r.data_chegada), p_de)  as fim
      from recorte r
  ),
  serie as (
    -- Uma linha por semana (segunda a domingo), contínua: semana sem nada aparece com zero.
    select g.semana::date as inicio
      from limites l,
           generate_series(
             (l.ini - (extract(isodow from l.ini)::int - 1))::timestamp,
             (l.fim - (extract(isodow from l.fim)::int - 1))::timestamp,
             interval '7 days') as g(semana)
     where l.ini is not null and l.fim is not null and l.ini <= l.fim
  ),
  por_semana as (
    select r.data_chegada - (extract(isodow from r.data_chegada)::int - 1) as inicio,
           count(*) filter (where r.divergente and not r.sem_texto) as justificadas,
           count(*) filter (where r.divergente and r.sem_texto)     as sem_justificativa
      from recorte r
     where r.data_chegada is not null
     group by 1
  ),
  semanas as (
    select coalesce(jsonb_agg(jsonb_build_object(
                      'inicio',            to_char(s.inicio, 'YYYY-MM-DD'),
                      'justificadas',      coalesce(w.justificadas, 0),
                      'sem_justificativa', coalesce(w.sem_justificativa, 0))
                    order by s.inicio), '[]'::jsonb) as j
      from serie s
      left join por_semana w on w.inicio = s.inicio
  )
  select jsonb_build_object('totais', t.j, 'fornecedores', f.j, 'semanas', s.j)
    into v_resultado
    from totais t, fornecedores f, semanas s;

  return v_resultado;
end $func$;

-- ---------- 2. as opções das listas suspensas ----------
-- Valores distintos, aparados, não vazios, em ordem. Inclui os de processos cancelados: a lista
-- mostra o que existe no banco (spec §4), e o número de um fornecedor só-cancelado sai zero.
create or replace function public.rec_dashboard_opcoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_resultado jsonb;
begin
  if not tem_permissao('recebimento', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;

  select jsonb_build_object(
           'fornecedores', coalesce((
             select jsonb_agg(x.valor order by x.valor)
               from (select distinct btrim(p.fornecedor) as valor
                       from public.processos_recebimento p
                      where btrim(coalesce(p.fornecedor, '')) <> '') x), '[]'::jsonb),
           'compradores', coalesce((
             select jsonb_agg(x.valor order by x.valor)
               from (select distinct btrim(p.comprador) as valor
                       from public.processos_recebimento p
                      where btrim(coalesce(p.comprador, '')) <> '') x), '[]'::jsonb)
         )
    into v_resultado;

  return v_resultado;
end $func$;

-- ---------- 3. a justificativa aparada ----------
-- Mesma assinatura da 0143 (por isso NÃO tem drop function), mesma porta (recebimento.administrar),
-- mesmo security definer, mesmos grants. A única diferença é o btrim no texto gravado.
create or replace function public.rec_justificar_divergencia(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_nome text;
begin
  if not tem_permissao('recebimento', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- Nome de exibição igual ao resto do app (registrarLog): nome, e o e-mail se o nome estiver vazio.
  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome
    from public.usuarios u where u.id = auth.uid();

  update public.processos_recebimento
     set divergencia_justificativa = coalesce(btrim(p_texto), ''),
         divergencia_justificada_por = auth.uid(),
         divergencia_justificada_em = now(),
         divergencia_justificada_por_nome = coalesce(v_nome, '')
   where id = p_id;

  if not found then
    raise exception 'PROCESSO_NAO_ENCONTRADO';
  end if;
end;
$func$;

-- Normalização única do que já está gravado: só linhas só-de-espaços. Autor e instante ficam como
-- estão (é limpeza, não é alguém justificando). Rodar de novo atualiza 0 linhas.
update public.processos_recebimento
   set divergencia_justificativa = ''
 where divergencia_justificativa <> ''
   and btrim(divergencia_justificativa) = '';

-- ---------- permissões ----------
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; sem o revoke, a anon key (pública, está no
-- JavaScript do navegador) chamaria a função direto no PostgREST, sem login.
revoke all on function public.rec_dashboard(text, text, text, text, date, date, text) from public, anon;
revoke all on function public.rec_dashboard_opcoes() from public, anon;
revoke all on function public.rec_justificar_divergencia(uuid, text) from public, anon;

grant execute on function public.rec_dashboard(text, text, text, text, date, date, text) to authenticated;
grant execute on function public.rec_dashboard_opcoes() to authenticated;
grant execute on function public.rec_justificar_divergencia(uuid, text) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Passo 7: rodar e ver PASSAR**

```bash
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | grep -E "ok$|OK|FALHOU|ERROR" | tail -16
```

Esperado (fim da saída): as 13 linhas `NOTICE: ... ok` do dashboard (`porta do dashboard`, `grants e security definer`, `totais sem filtro`, `totais no recorte`, `números batem com a condição da grade`, `série semanal`, `ranking de fornecedores`, `filtros`, `filtro de sinal`, `opções das listas`, `normalização das justificativas só de espaços`, `justificativa aparada pela função`, `top 10`) e por último ` RECEBIMENTO DASHBOARD OK`. Nenhum `FALHOU`, nenhum `ERROR`.

- [ ] **Passo 8: conferir as convenções do arquivo**

```bash
grep -c '\$\$' supabase/migrations/0152_rec_dashboard.sql
grep -c "notify pgrst" supabase/migrations/0152_rec_dashboard.sql
tail -1 supabase/migrations/0152_rec_dashboard.sql
grep -n "tem_permissao(" supabase/migrations/0152_rec_dashboard.sql
```

Esperado: `0`; `1`; `notify pgrst, 'reload schema';`; três linhas, todas com dois argumentos (`'recebimento', 'visualizar'` duas vezes e `'recebimento', 'administrar'` uma).

- [ ] **Passo 9: commit**

```bash
git add supabase/migrations/0152_rec_dashboard.sql supabase/tests/recebimento_dashboard_esquema.sql supabase/tests/recebimento_dashboard_massa.sql supabase/tests/recebimento_dashboard_test.sql supabase/tests/rodar-recebimento-test.sh
git commit -m "$(cat <<'EOF'
recebimento: rec_dashboard e rec_dashboard_opcoes (0152) e a justificativa aparada

Agrega no banco, numa chamada so, os totais, o top 10 de fornecedores e a serie semanal das
divergencias do Recebimento, com a regua da spec (cancelado fora, divergencia_num <> 0, contado
por data_chegada). A mesma migracao recria rec_justificar_divergencia com btrim e normaliza as
justificativas que eram so espacos. Testes num banco proprio do harness.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Passo 10: provar os dentes — sabotar e ver falhar (uma sabotagem por vez)**

Para cada linha da tabela: rode o `sed`, rode o teste, confira a mensagem, **restaure** com `git checkout`. O arquivo está commitado, então a restauração é exata.

```bash
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | grep -m1 FALHOU; git checkout -- supabase/migrations/0152_rec_dashboard.sql
```

| # | Sabotagem (`sed -i ... supabase/migrations/0152_rec_dashboard.sql`) | Mensagem esperada |
|---|---|---|
| S1 | `sed -i "s/coalesce(btrim(p_texto), '')/coalesce(p_texto, '')/"` (spec §6.1: volta ao comportamento da 0143) | `FALHOU: só espaços pela função tinha que gravar vazio (veio "   ")` |
| S2 | `sed -i "s/   and btrim(divergencia_justificativa) = '';/   and false;/"` (normalização desligada) | `FALHOU: a justificativa só de espaços tinha que virar vazia` |
| S3 | `sed -i "s/ where p.status <> 'cancelado'/ where true/"` | `FALHOU: itens (sem filtro) devia ser 11 e veio 12` |
| S4 | `sed -i "s/else b.divergencia_num <> 0/else b.divergencia_num is not null/"` | `FALHOU: com divergência (sem filtro) devia ser 8 e veio 9` |
| S5 | `sed -i "s/end, false) as divergente/end, true) as divergente/"` (nulo contaria como divergente) | `FALHOU: com divergência (sem filtro) devia ser 8 e veio 10` |
| S6 | `sed -i "s/      left join por_semana w on/      join por_semana w on/"` (série pula semana) | `FALHOU: quantidade de semanas devia ser 3 e veio 2` |
| S7 | `sed -i "s/then (select count(\*) from base b where b.data_chegada is null)/then 0/"` | `FALHOU: fora do recorte por data devia ser 1 e veio 0` |
| S8 | `sed -i "s/tem_permissao('recebimento', 'visualizar')/tem_permissao('shopfloor', 'visualizar')/"` | `FALHOU: permissão de outro módulo abriu rec_dashboard` |
| S9 | `sed -i "s/             limit 10) f/             limit 11) f/"` | `FALHOU: fornecedores no top devia ser 10 e veio 11` |
| S10 | `sed -i "s/b.data_chegada <= p_ate/b.data_chegada < p_ate/"` (Até deixa de ser inclusivo) | `FALHOU: itens no dia 08/09 devia ser 1 e veio 0` |

Se algum `sed` não mudar o arquivo (`git diff --stat` vazio depois dele), o texto da migração divergiu do plano: pare e confira. Se alguma sabotagem **não** fizer o teste falhar, a asserção correspondente não tem dentes: corrija o TESTE, não a migração.

- [ ] **Passo 11: confirmar que voltou ao verde e que nada ficou sujo**

```bash
git status --short
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | tail -3
```

Esperado: `git status` sem linhas; a última linha útil é ` RECEBIMENTO DASHBOARD OK`.

- [ ] **Passo 12: medir com volume no harness — o passo que DECIDE o índice em `data_chegada`**

O Dev pode estar pausado, então a decisão sai daqui (300 mil linhas geradas, `set role authenticated`, `EXPLAIN (ANALYZE)`), e a Task 6 manda o usuário repetir no Dev com dados reais. A função é `security definer` (roda como dona, sem RLS); o `set role` existe para medir com a mesma porta que a tela usa — a lição da 0096 é nunca medir como superusuário.

```bash
bash <<'BASH'
set -euo pipefail
NOME=pg-dash-volume
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
for f in supabase/tests/recebimento_dashboard_esquema.sql \
         supabase/migrations/0142_divergencia_justificativa.sql \
         supabase/migrations/0143_rec_justificar_divergencia.sql \
         supabase/migrations/0147_divergencia_num.sql \
         supabase/migrations/0152_rec_dashboard.sql; do
  docker exec -i "$NOME" psql -U postgres -q -1 -v ON_ERROR_STOP=1 -f - < "$f"
done
docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' | grep -E "linhas|^ +[0-9]+$|Execution Time|SEM ÍNDICE|COM ÍNDICE"
-- 300 mil itens em 5 anos de chegada; 1 em 50 sem data; ~11% divergentes; 1/6 cancelados.
insert into public.processos_recebimento
  (status, fornecedor, comprador, numero_emb, codigo_material, data_chegada, divergencia, divergencia_justificativa)
select (array['aberto','em_conferencia','finalizado','finalizado','finalizado','cancelado'])[1 + (g % 6)],
       'FORN' || (g % 400), 'COMP' || (g % 12), 'EMB' || (g / 40), 'MAT' || (g % 5000),
       case when g % 50 = 0 then null else date '2021-10-15' + (g % 1826) end,
       case when g % 9 = 0 then ((g % 21) - 10)::text when g % 13 = 0 then '' else '0' end,
       case when g % 18 = 0 then 'alinhado' else '' end
  from generate_series(1, 300000) g;
analyze public.processos_recebimento;
select count(*) as linhas from public.processos_recebimento;
select 'SEM ÍNDICE';
begin;
select set_config('teste.perms', 'recebimento.visualizar', true);
set local role authenticated;
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
explain (analyze, timing off) select public.rec_dashboard();
explain (analyze, timing off) select public.rec_dashboard_opcoes();
rollback;
create index processos_recebimento_data_chegada_idx on public.processos_recebimento (data_chegada);
analyze public.processos_recebimento;
select 'COM ÍNDICE';
begin;
select set_config('teste.perms', 'recebimento.visualizar', true);
set local role authenticated;
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
explain (analyze, timing off) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
rollback;
SQL
BASH
```

Esperado: `300000`, depois "SEM ÍNDICE" com cinco `Execution Time` (três do recorte de 90 dias, um da tabela inteira, um das opções) e "COM ÍNDICE" com três. Referência medida ao escrever este plano (notebook de 4 núcleos), recorte de 90 dias: sem índice 109 / 103 / 103 ms (mediana 103); com índice 40 / 83 / 83 ms (mediana 83 — da 2ª chamada em diante o plpgsql passa ao plano genérico e o ganho encolhe); tabela inteira ≈ 670 ms; opções ≈ 290 ms. Com esses números a regra abaixo dá **não entra** (103 ≤ 150).

**Regra de decisão** (use a MEDIANA dos três do recorte de 90 dias, que é o carregamento padrão da tela):

- mediana sem índice **≤ 150 ms** → o índice **NÃO entra**;
- mediana sem índice **> 150 ms** e com índice **pelo menos 30% menor** → o índice **entra**;
- mediana sem índice > 150 ms e o índice não ganha 30% → **não entra**, e escreva no relatório que o gargalo é outro (cole os dois planos).

- [ ] **Passo 13: registrar a decisão no cabeçalho da 0152 (e o índice, se entrar)**

Troque no cabeçalho as duas linhas:

```sql
-- Índice em data_chegada: DECIDIDO PELA MEDIÇÃO (Task 1 do plano). Esta linha é trocada
-- pelo resultado: "não entra — medido em <data>, <n> ms com set role" ou o create index abaixo.
```

**Se NÃO entra**, por (troque os dois números pelos que VOCÊ mediu no passo 12, em ms inteiros, e a data pela de hoje):

```sql
-- Índice em data_chegada: NÃO entra. Medido em 15/10/2026 no harness (300 mil linhas, set role
-- authenticated, EXPLAIN ANALYZE, mediana de 3): recorte de 90 dias em 103 ms sem índice e 83 ms
-- com — abaixo do teto de 150 ms. O usuário repete a medição no Dev com dados reais (plano, Task 6).
```

**Se entra**, por (idem: os números do exemplo são ilustrativos, os seus vêm do passo 12):

```sql
-- Índice em data_chegada: ENTRA (seção "índice", abaixo). Medido em 15/10/2026 no harness (300 mil
-- linhas, set role authenticated, EXPLAIN ANALYZE, mediana de 3): recorte de 90 dias em 180 ms sem
-- índice e 95 ms com. O usuário repete a medição no Dev com dados reais (plano, Task 6).
```

e acrescente, imediatamente **antes** da linha `-- ---------- permissões ----------`:

```sql
-- ---------- índice (decidido pela medição) ----------
-- Serve ao recorte por data, que é o carregamento padrão da tela (últimos 90 dias).
create index if not exists processos_recebimento_data_chegada_idx
  on public.processos_recebimento (data_chegada);

```

Depois, nos dois casos:

```bash
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | tail -3
grep -c '\$\$' supabase/migrations/0152_rec_dashboard.sql
git add supabase/migrations/0152_rec_dashboard.sql
git commit -m "$(cat <<'EOF'
recebimento: 0152 registra a decisao do indice em data_chegada pela medicao

Medido no harness com 300 mil linhas, set role authenticated e EXPLAIN ANALYZE; a regra de
decisao e os numeros estao no cabecalho da migracao.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

Esperado: ` RECEBIMENTO DASHBOARD OK`; `0`; commit feito.

---

## Task 2: Domínio — tipos, filtros ↔ URL, 90 dias, porcentagem, ⓘ

**Arquivos:**
- Criar: `src/modules/recebimento/domain/dashboard.ts`
- Criar: `src/modules/recebimento/domain/__tests__/dashboard.test.ts`

**Interfaces — consome:** nada (puro; não importa nada do projeto).

**Interfaces — produz** (as Tasks 3, 4 e 5 importam exatamente estes nomes de `@/modules/recebimento/domain/dashboard`):

```ts
export type Sinal = 'positiva' | 'negativa'
export interface FiltrosDashboard { fornecedor: string; comprador: string; emb: string; codigo: string; de: string; ate: string; sinal: Sinal | '' }
export const FILTROS_LIMPOS: FiltrosDashboard
export interface TotaisDashboard { itens: number; comDivergencia: number; semJustificativa: number; positivas: number; negativas: number; embs: number; foraDoRecortePorData: number }
export interface FornecedorDashboard { fornecedor: string; divergentes: number; itens: number }
export interface SemanaDashboard { inicio: string; justificadas: number; semJustificativa: number }
export interface DadosDashboard { totais: TotaisDashboard; fornecedores: FornecedorDashboard[]; semanas: SemanaDashboard[] }
export interface OpcoesDashboard { fornecedores: string[]; compradores: string[] }
export type CliqueDashboard = { fornecedor: string } | { semana: string } | { sinal: Sinal }
export const DIAS_JANELA_PADRAO = 90
export const PERIODO_TUDO = 'tudo'
export function diaValido(valor: string): boolean
export function somarDias(dia: string, n: number): string
export function hojeSp(agora: Date): string
export function janelaPadrao(agora: Date): { de: string; ate: string }
export function fimDaSemana(inicio: string): string
export function filtrosDaUrl(sp: Record<string, string | string[] | undefined>, agora: Date): FiltrosDashboard
export function urlDosFiltros(f: FiltrosDashboard, agora: Date): string   // sem o '?'
export function aplicarClique(f: FiltrosDashboard, clique: CliqueDashboard): FiltrosDashboard
export type ChaveEtiqueta = 'fornecedor' | 'comprador' | 'emb' | 'codigo' | 'periodo' | 'sinal'
export interface EtiquetaFiltro { chave: ChaveEtiqueta; texto: string }
export function diaBr(dia: string): string
export function etiquetasDosFiltros(f: FiltrosDashboard): EtiquetaFiltro[]
export function semFiltro(f: FiltrosDashboard, chave: ChaveEtiqueta): FiltrosDashboard
export function percentual(parte: number, total: number): number | null
export function formatarNumero(n: number): string
export function formatarPercentual(p: number | null): string
export function rotuloFornecedor(fornecedor: string): string
export function textoRodape(t: TotaisDashboard): string
export const EXPLICA: { itens; comDivergencia; semJustificativa; embs; fornecedores; semanas; sinal }  // todos string
```

**Leia antes:** `src/modules/recebimento/domain/registros-filtros.ts` (como uma tela irmã valida `searchParams`) e `src/modules/recebimento/domain/divergencia.ts` (estilo de domínio puro).

- [ ] **Passo 1: escrever os testes**

`src/modules/recebimento/domain/__tests__/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  FILTROS_LIMPOS,
  aplicarClique,
  diaValido,
  etiquetasDosFiltros,
  filtrosDaUrl,
  formatarPercentual,
  hojeSp,
  janelaPadrao,
  percentual,
  rotuloFornecedor,
  semFiltro,
  textoRodape,
  urlDosFiltros,
  type FiltrosDashboard,
  type TotaisDashboard,
} from '../dashboard'

// 15/10/2026, meio-dia em São Paulo.
const AGORA = new Date('2026-10-15T15:00:00Z')
const PADRAO = { de: '2026-07-18', ate: '2026-10-15' }

describe('percentual', () => {
  it('uma casa, arredondando', () => {
    expect(percentual(137, 1284)).toBe(10.7)
    expect(percentual(1, 3)).toBe(33.3)
    expect(percentual(0, 5)).toBe(0)
  })
  it('NÃO arredonda para 100 quando não é 100', () => {
    expect(percentual(9999, 10000)).toBe(99.9)
    expect(percentual(19999, 20000)).toBe(99.9)
  })
  it('100 só quando é tudo', () => {
    expect(percentual(5, 5)).toBe(100)
  })
  it('total zero não tem porcentagem', () => {
    expect(percentual(0, 0)).toBeNull()
    expect(percentual(3, 0)).toBeNull()
  })
  it('formata em pt-BR', () => {
    expect(formatarPercentual(10.7)).toBe('10,7%')
    expect(formatarPercentual(100)).toBe('100%')
    expect(formatarPercentual(99.9)).toBe('99,9%')
    expect(formatarPercentual(null)).toBe('—')
  })
})

describe('recorte padrão de 90 dias', () => {
  it('são os últimos 90 dias contando hoje', () => {
    expect(janelaPadrao(AGORA)).toEqual(PADRAO)
  })
  it('hoje é o dia de São Paulo, não o do servidor em UTC', () => {
    // 02:30 UTC do dia 16 ainda é 23:30 do dia 15 em São Paulo.
    expect(hojeSp(new Date('2026-10-16T02:30:00Z'))).toBe('2026-10-15')
    expect(janelaPadrao(new Date('2026-10-16T02:30:00Z')).ate).toBe('2026-10-15')
  })
  it('atravessa a virada do ano', () => {
    expect(janelaPadrao(new Date('2027-01-10T15:00:00Z'))).toEqual({ de: '2026-10-13', ate: '2027-01-10' })
  })
})

describe('filtros ↔ URL', () => {
  it('URL vazia = os 90 dias e nada mais', () => {
    expect(filtrosDaUrl({}, AGORA)).toEqual({ ...FILTROS_LIMPOS, ...PADRAO })
  })
  it('lê todos os filtros, aparando', () => {
    expect(filtrosDaUrl({
      fornecedor: ' Panasonic ', comprador: 'Joana', emb: 'EMB390', codigo: 'CAPJ91',
      de: '2026-09-01', ate: '2026-09-30', sinal: 'negativa',
    }, AGORA)).toEqual({
      fornecedor: 'Panasonic', comprador: 'Joana', emb: 'EMB390', codigo: 'CAPJ91',
      de: '2026-09-01', ate: '2026-09-30', sinal: 'negativa',
    })
  })
  it('periodo=tudo tira o recorte de data, mesmo com de/ate na URL', () => {
    const f = filtrosDaUrl({ periodo: 'tudo', de: '2026-09-01' }, AGORA)
    expect(f.de).toBe('')
    expect(f.ate).toBe('')
  })
  it('um lado só da data fica aberto do outro', () => {
    expect(filtrosDaUrl({ de: '2026-09-01' }, AGORA)).toMatchObject({ de: '2026-09-01', ate: '' })
    expect(filtrosDaUrl({ ate: '2026-09-30' }, AGORA)).toMatchObject({ de: '', ate: '2026-09-30' })
  })
  it('data inválida e sinal desconhecido são ignorados', () => {
    expect(filtrosDaUrl({ de: '2026-02-30', ate: 'ontem', sinal: 'zero' }, AGORA))
      .toEqual({ ...FILTROS_LIMPOS, ...PADRAO })
  })
  it('valor repetido na URL: vale o primeiro', () => {
    expect(filtrosDaUrl({ emb: ['EMB1', 'EMB2'] }, AGORA).emb).toBe('EMB1')
  })
  it('o padrão NÃO vai para a URL; sem recorte vira periodo=tudo', () => {
    expect(urlDosFiltros({ ...FILTROS_LIMPOS, ...PADRAO }, AGORA)).toBe('')
    expect(urlDosFiltros(FILTROS_LIMPOS, AGORA)).toBe('periodo=tudo')
  })
  it('ida e volta reproduz os filtros (o link compartilhado reproduz a tela)', () => {
    const casos: FiltrosDashboard[] = [
      { ...FILTROS_LIMPOS, ...PADRAO },
      FILTROS_LIMPOS,
      { fornecedor: 'ACME & Filhos', comprador: 'Pedro', emb: 'EMB 1', codigo: 'X/1', de: '2026-09-07', ate: '2026-09-13', sinal: 'positiva' },
      { ...FILTROS_LIMPOS, de: '2026-09-01', ate: '' },
      { ...FILTROS_LIMPOS, de: '', ate: '2026-09-30' },
    ]
    for (const f of casos) {
      const sp = Object.fromEntries(new URLSearchParams(urlDosFiltros(f, AGORA)))
      expect(filtrosDaUrl(sp, AGORA), JSON.stringify(f)).toEqual(f)
    }
  })
  it('diaValido recusa o que não existe no calendário', () => {
    expect(diaValido('2026-09-30')).toBe(true)
    expect(diaValido('2028-02-29')).toBe(true)
    expect(diaValido('2026-02-29')).toBe(false)
    expect(diaValido('2026-9-3')).toBe(false)
    expect(diaValido('')).toBe(false)
  })
})

describe('cliques nos gráficos', () => {
  const f: FiltrosDashboard = { ...FILTROS_LIMPOS, ...PADRAO }
  it('fornecedor aplica o filtro', () => {
    expect(aplicarClique(f, { fornecedor: 'Vishay' }).fornecedor).toBe('Vishay')
  })
  it('fornecedor em branco não vira filtro', () => {
    expect(aplicarClique(f, { fornecedor: '' })).toEqual(f)
  })
  it('semana vira o recorte de segunda a domingo', () => {
    expect(aplicarClique(f, { semana: '2026-09-07' })).toMatchObject({ de: '2026-09-07', ate: '2026-09-13' })
  })
  it('sinal aplica só positivas / só negativas', () => {
    expect(aplicarClique(f, { sinal: 'negativa' }).sinal).toBe('negativa')
  })
})

describe('etiquetas dos filtros aplicados', () => {
  it('uma por filtro, na ordem da barra', () => {
    expect(etiquetasDosFiltros({
      fornecedor: 'Vishay', comprador: 'Pedro', emb: 'EMB2', codigo: 'RES1',
      de: '2026-09-07', ate: '2026-09-13', sinal: 'positiva',
    })).toEqual([
      { chave: 'fornecedor', texto: 'Fornecedor: Vishay' },
      { chave: 'comprador', texto: 'Comprador: Pedro' },
      { chave: 'emb', texto: 'EMB: EMB2' },
      { chave: 'codigo', texto: 'Código: RES1' },
      { chave: 'periodo', texto: 'Chegada: 07/09/2026 a 13/09/2026' },
      { chave: 'sinal', texto: 'Só positivas' },
    ])
  })
  it('período de um lado só', () => {
    expect(etiquetasDosFiltros({ ...FILTROS_LIMPOS, de: '2026-09-01' })[0]!.texto).toBe('Chegada: a partir de 01/09/2026')
    expect(etiquetasDosFiltros({ ...FILTROS_LIMPOS, ate: '2026-09-30' })[0]!.texto).toBe('Chegada: até 30/09/2026')
  })
  it('sem filtro, sem etiqueta', () => {
    expect(etiquetasDosFiltros(FILTROS_LIMPOS)).toEqual([])
  })
  it('tirar o período deixa sem recorte de data; tirar o resto zera só ele', () => {
    const f: FiltrosDashboard = { ...FILTROS_LIMPOS, ...PADRAO, emb: 'EMB2', sinal: 'negativa' }
    expect(semFiltro(f, 'periodo')).toEqual({ ...f, de: '', ate: '' })
    expect(semFiltro(f, 'emb')).toEqual({ ...f, emb: '' })
    expect(semFiltro(f, 'sinal')).toEqual({ ...f, sinal: '' })
  })
})

describe('rodapé e rótulos', () => {
  const t: TotaisDashboard = {
    itens: 1284, comDivergencia: 137, semJustificativa: 40, positivas: 80, negativas: 57,
    embs: 42, foraDoRecortePorData: 0,
  }
  it('o texto da spec', () => {
    expect(textoRodape(t)).toBe('137 de 1.284 itens (10,7%) em 42 EMBs')
  })
  it('diz quantos ficaram fora do período', () => {
    expect(textoRodape({ ...t, foraDoRecortePorData: 12 }))
      .toBe('137 de 1.284 itens (10,7%) em 42 EMBs. 12 itens sem data de chegada ficaram fora do período.')
    expect(textoRodape({ ...t, foraDoRecortePorData: 1 }))
      .toBe('137 de 1.284 itens (10,7%) em 42 EMBs. 1 item sem data de chegada ficou fora do período.')
  })
  it('singular e recorte vazio', () => {
    expect(textoRodape({ ...t, itens: 1, comDivergencia: 1, embs: 1 })).toBe('1 de 1 item (100%) em 1 EMB')
    expect(textoRodape({ ...t, itens: 0, comDivergencia: 0, embs: 0 })).toBe('Nenhum item neste recorte.')
  })
  it('fornecedor em branco tem nome na tela', () => {
    expect(rotuloFornecedor('')).toBe('(sem fornecedor)')
    expect(rotuloFornecedor('Vishay')).toBe('Vishay')
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/domain/__tests__/dashboard.test.ts
```

Esperado: FAIL — `Failed to resolve import "../dashboard"`.

- [ ] **Passo 3: implementar**

`src/modules/recebimento/domain/dashboard.ts`:

```ts
// Dashboard de divergências do Recebimento — regras puras (sem banco, sem React).
// Spec: docs/superpowers/specs/2026-10-14-dashboard-recebimento-design.md
// A régua de contagem mora no banco (rec_dashboard, migração 0152); aqui ficam os filtros e a URL,
// a porcentagem, os textos dos ⓘ e o que cada clique num gráfico faz com os filtros.

/** Sinal da divergência que um clique em "Positivas × negativas" aplica. */
export type Sinal = 'positiva' | 'negativa'

/** Os filtros da tela. String vazia = sem filtro. Datas em 'AAAA-MM-DD' (data_chegada é DATE). */
export interface FiltrosDashboard {
  fornecedor: string
  comprador: string
  emb: string
  codigo: string
  de: string
  ate: string
  sinal: Sinal | ''
}

/** Nenhum filtro, nem de data — é o que "Limpar filtros" aplica. */
export const FILTROS_LIMPOS: FiltrosDashboard = {
  fornecedor: '', comprador: '', emb: '', codigo: '', de: '', ate: '', sinal: '',
}

export interface TotaisDashboard {
  itens: number
  comDivergencia: number
  semJustificativa: number
  positivas: number
  negativas: number
  embs: number
  /** Itens sem data_chegada que um recorte por data deixou de fora (0 quando não há recorte). */
  foraDoRecortePorData: number
}

export interface FornecedorDashboard {
  /** '' = fornecedor em branco (a tela escreve "(sem fornecedor)"). */
  fornecedor: string
  divergentes: number
  itens: number
}

export interface SemanaDashboard {
  /** Segunda-feira da semana, 'AAAA-MM-DD'. */
  inicio: string
  justificadas: number
  semJustificativa: number
}

export interface DadosDashboard {
  totais: TotaisDashboard
  fornecedores: FornecedorDashboard[]
  semanas: SemanaDashboard[]
}

export interface OpcoesDashboard {
  fornecedores: string[]
  compradores: string[]
}

/** O que um clique num gráfico pede. */
export type CliqueDashboard = { fornecedor: string } | { semana: string } | { sinal: Sinal }

/** Recorte de data padrão, em dias, contando hoje. É padrão da TELA (o banco não tem padrão). */
export const DIAS_JANELA_PADRAO = 90

/** Parâmetro de URL que diz "sem recorte de data" (sem ele, a URL sem datas vale os 90 dias). */
export const PERIODO_TUDO = 'tudo'

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** 'AAAA-MM-DD' de um dia que existe no calendário; qualquer outra coisa é inválida. */
export function diaValido(valor: string): boolean {
  if (!RE_DIA.test(valor)) return false
  const [a, m, d] = valor.split('-').map(Number)
  const data = new Date(Date.UTC(a!, m! - 1, d!))
  return data.getUTCFullYear() === a && data.getUTCMonth() === m! - 1 && data.getUTCDate() === d
}

/** Soma (ou subtrai) dias de um 'AAAA-MM-DD', sem fuso no meio (conta em UTC puro). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** O dia de hoje na fábrica (São Paulo), 'AAAA-MM-DD' — nunca o dia do servidor (que roda em UTC). */
export function hojeSp(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora)
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('year')}-${parte('month')}-${parte('day')}`
}

/** Os últimos 90 dias, contando hoje: de = hoje − 89, até = hoje. */
export function janelaPadrao(agora: Date): { de: string; ate: string } {
  const ate = hojeSp(agora)
  return { de: somarDias(ate, -(DIAS_JANELA_PADRAO - 1)), ate }
}

/** Domingo da semana que começa nessa segunda. */
export function fimDaSemana(inicio: string): string {
  return somarDias(inicio, 6)
}

type ParamsUrl = Record<string, string | string[] | undefined>

function primeiro(sp: ParamsUrl, chave: string): string {
  const v = sp[chave]
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

/**
 * Os filtros a partir da URL (searchParams). Nada da URL é confiável: data inválida e sinal
 * desconhecido são ignorados.
 *   - `periodo=tudo`            → sem recorte de data (ignora de/ate).
 *   - sem `de` e sem `ate`      → os últimos 90 dias (o padrão).
 *   - com `de` e/ou `ate`       → o que veio (um lado só = aberto do outro).
 */
export function filtrosDaUrl(sp: ParamsUrl, agora: Date): FiltrosDashboard {
  const sinal = primeiro(sp, 'sinal')
  const f: FiltrosDashboard = {
    fornecedor: primeiro(sp, 'fornecedor'),
    comprador: primeiro(sp, 'comprador'),
    emb: primeiro(sp, 'emb'),
    codigo: primeiro(sp, 'codigo'),
    de: '',
    ate: '',
    sinal: sinal === 'positiva' || sinal === 'negativa' ? sinal : '',
  }
  if (primeiro(sp, 'periodo') === PERIODO_TUDO) return f
  const de = primeiro(sp, 'de')
  const ate = primeiro(sp, 'ate')
  const deOk = diaValido(de) ? de : ''
  const ateOk = diaValido(ate) ? ate : ''
  if (deOk === '' && ateOk === '') return { ...f, ...janelaPadrao(agora) }
  return { ...f, de: deOk, ate: ateOk }
}

/**
 * A query string (sem o '?') que reproduz esses filtros. O recorte padrão NÃO vai para a URL
 * (o link "limpo" continua querendo dizer "os últimos 90 dias" para quem abrir amanhã); sem recorte
 * nenhum vira `periodo=tudo`.
 */
export function urlDosFiltros(f: FiltrosDashboard, agora: Date): string {
  const p = new URLSearchParams()
  if (f.fornecedor) p.set('fornecedor', f.fornecedor)
  if (f.comprador) p.set('comprador', f.comprador)
  if (f.emb) p.set('emb', f.emb)
  if (f.codigo) p.set('codigo', f.codigo)
  const padrao = janelaPadrao(agora)
  if (f.de === '' && f.ate === '') p.set('periodo', PERIODO_TUDO)
  else if (f.de !== padrao.de || f.ate !== padrao.ate) {
    if (f.de) p.set('de', f.de)
    if (f.ate) p.set('ate', f.ate)
  }
  if (f.sinal) p.set('sinal', f.sinal)
  return p.toString()
}

/** O que um clique num gráfico faz com os filtros: APLICA (não alterna). Tirar é pela etiqueta. */
export function aplicarClique(f: FiltrosDashboard, clique: CliqueDashboard): FiltrosDashboard {
  if ('fornecedor' in clique) {
    // Fornecedor em branco não vira filtro: texto vazio, no banco, é "sem filtro".
    return clique.fornecedor === '' ? f : { ...f, fornecedor: clique.fornecedor }
  }
  if ('semana' in clique) return { ...f, de: clique.semana, ate: fimDaSemana(clique.semana) }
  return { ...f, sinal: clique.sinal }
}

export type ChaveEtiqueta = 'fornecedor' | 'comprador' | 'emb' | 'codigo' | 'periodo' | 'sinal'

export interface EtiquetaFiltro {
  chave: ChaveEtiqueta
  texto: string
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function diaBr(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

/** As etiquetas removíveis dos filtros aplicados, na ordem da barra de filtros. */
export function etiquetasDosFiltros(f: FiltrosDashboard): EtiquetaFiltro[] {
  const e: EtiquetaFiltro[] = []
  if (f.fornecedor) e.push({ chave: 'fornecedor', texto: `Fornecedor: ${f.fornecedor}` })
  if (f.comprador) e.push({ chave: 'comprador', texto: `Comprador: ${f.comprador}` })
  if (f.emb) e.push({ chave: 'emb', texto: `EMB: ${f.emb}` })
  if (f.codigo) e.push({ chave: 'codigo', texto: `Código: ${f.codigo}` })
  if (f.de && f.ate) e.push({ chave: 'periodo', texto: `Chegada: ${diaBr(f.de)} a ${diaBr(f.ate)}` })
  else if (f.de) e.push({ chave: 'periodo', texto: `Chegada: a partir de ${diaBr(f.de)}` })
  else if (f.ate) e.push({ chave: 'periodo', texto: `Chegada: até ${diaBr(f.ate)}` })
  if (f.sinal) e.push({ chave: 'sinal', texto: f.sinal === 'positiva' ? 'Só positivas' : 'Só negativas' })
  return e
}

/** Os filtros sem aquele que a etiqueta representa. Tirar o período = sem recorte de data. */
export function semFiltro(f: FiltrosDashboard, chave: ChaveEtiqueta): FiltrosDashboard {
  if (chave === 'periodo') return { ...f, de: '', ate: '' }
  return { ...f, [chave]: '' }
}

/**
 * Porcentagem com uma casa. NÃO arredonda para 100 quando não é 100 (lição do dashboard do
 * ShopFloor, 02/09): 9.999 de 10.000 é 99,9%, não 100%. Total zero = null (a tela mostra "—").
 */
export function percentual(parte: number, total: number): number | null {
  if (!(total > 0)) return null
  const arredondado = Math.round((parte * 1000) / total) / 10
  if (arredondado >= 100 && parte < total) return 99.9
  return arredondado
}

const fmtNumero = new Intl.NumberFormat('pt-BR')
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

export function formatarNumero(n: number): string {
  return fmtNumero.format(n)
}

/** 10.7 → '10,7%' · 100 → '100%' · null → '—'. */
export function formatarPercentual(p: number | null): string {
  return p === null ? '—' : `${fmtPct.format(p)}%`
}

/** '' → '(sem fornecedor)'. */
export function rotuloFornecedor(fornecedor: string): string {
  return fornecedor === '' ? '(sem fornecedor)' : fornecedor
}

/**
 * O rodapé da contagem: "137 de 1.284 itens (10,7%) em 42 EMBs", e quantos ficaram fora do período
 * por não ter data de chegada.
 */
export function textoRodape(t: TotaisDashboard): string {
  if (t.itens === 0) {
    return t.foraDoRecortePorData > 0
      ? `Nenhum item neste recorte. ${textoFora(t.foraDoRecortePorData)}`
      : 'Nenhum item neste recorte.'
  }
  const itens = t.itens === 1 ? 'item' : 'itens'
  const embs = t.embs === 1 ? 'EMB' : 'EMBs'
  const base = `${formatarNumero(t.comDivergencia)} de ${formatarNumero(t.itens)} ${itens} ` +
    `(${formatarPercentual(percentual(t.comDivergencia, t.itens))}) em ${formatarNumero(t.embs)} ${embs}`
  return t.foraDoRecortePorData > 0 ? `${base}. ${textoFora(t.foraDoRecortePorData)}` : base
}

function textoFora(n: number): string {
  return n === 1
    ? '1 item sem data de chegada ficou fora do período.'
    : `${formatarNumero(n)} itens sem data de chegada ficaram fora do período.`
}

/** Os textos dos ⓘ — a definição de cada número em português (spec §3). */
export const EXPLICA = {
  itens:
    'Linhas de processo (um material de uma EMB) que caem nos filtros, contadas pela data de ' +
    'chegada. Processos cancelados ficam de fora.',
  comDivergencia:
    'Dos itens, os que têm divergência de quantidade diferente de zero — a mesma regra do filtro ' +
    '"Divergências" da grade de Processos. Item ainda não conferido (divergência vazia ou que não ' +
    'é número) não conta. Com "Só positivas" ou "Só negativas", conta só aquele sinal.',
  semJustificativa:
    'Dos itens com divergência, os que ninguém justificou ainda (justificativa vazia ou só com ' +
    'espaços). Justificar é na grade de Processos.',
  embs:
    'EMBs distintas entre os itens do recorte (com ou sem divergência).',
  fornecedores:
    'Os 10 fornecedores com mais itens divergentes no recorte. Ao lado, quanto isso é dos itens ' +
    'daquele fornecedor. Clique numa barra para filtrar a tela por ele.',
  semanas:
    'Itens divergentes por semana de chegada (segunda a domingo), separados em justificados e sem ' +
    'justificativa. Semana sem divergência aparece com altura zero. Itens sem data de chegada não ' +
    'entram aqui. Clique numa semana para filtrar por ela.',
  sinal:
    'Itens que chegaram a mais (divergência maior que zero) e a menos (menor que zero). Clique numa ' +
    'barra para ver só aquele sinal.',
} as const
```

- [ ] **Passo 4: rodar e ver passar; tipos e lint**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/domain/__tests__/dashboard.test.ts
npx tsc --noEmit -p .
npx eslint src/modules/recebimento/domain/dashboard.ts src/modules/recebimento/domain/__tests__/dashboard.test.ts
```

Esperado: todos os testes passam (6 `describe`, 29 `it`); `tsc` sem saída; `eslint` sem saída.

- [ ] **Passo 5: commit**

```bash
git add src/modules/recebimento/domain/dashboard.ts src/modules/recebimento/domain/__tests__/dashboard.test.ts
git commit -m "$(cat <<'EOF'
recebimento: dominio do dashboard (filtros na URL, 90 dias, porcentagem, textos dos i)

Regras puras da tela: o recorte padrao dos ultimos 90 dias no dia de Sao Paulo, filtros de ida e
volta pela URL (o padrao nao vai para a URL; sem recorte vira periodo=tudo), o que cada clique de
grafico aplica, as etiquetas removiveis, a porcentagem que nao arredonda para 100 e o rodape.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Repositório + item "Dashboard" no menu

**Arquivos:**
- Criar: `src/modules/recebimento/infra/dashboard-repository.ts`, `src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts`
- Criar: `src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts`
- Modificar: `src/shared/ui/app-shell.tsx`

**Interfaces — consome:** de `../domain/dashboard` (Task 2): `DadosDashboard`, `FiltrosDashboard`, `OpcoesDashboard`, `FILTROS_LIMPOS` (no teste). Do banco (Task 1): `rec_dashboard(p_fornecedor, p_comprador, p_emb, p_codigo, p_de, p_ate, p_sinal)` e `rec_dashboard_opcoes()`, com o jsonb descrito na Task 1.

**Interfaces — produz:**

```ts
// src/modules/recebimento/infra/dashboard-repository.ts  ('server-only')
export async function carregarDashboard(filtros: FiltrosDashboard): Promise<DadosDashboard>   // lança o erro do rpc
export async function carregarOpcoesDashboard(): Promise<OpcoesDashboard>                     // lança o erro do rpc
// src/shared/ui/app-shell.tsx
export const RECEBIMENTO: FolhaModular[]   // passa a ser exportado; ganha { chave: 'rec-dashboard', ... }
```

**Leia antes:** `src/modules/recebimento/infra/fluxo-repository.ts` e `registros-repository.ts` (como se chama e tipa um `rpc`), `src/modules/recebimento/infra/__tests__/fluxo-repository-chegada.test.ts` (como se falsifica o Supabase), `src/shared/ui/app-shell.tsx` linhas 1–90 (o menu real; `recebimento-nav.ts` é código morto — não mexa nele).

- [ ] **Passo 1: testes do repositório e do menu**

`src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ rpc }),
}))

import { carregarDashboard, carregarOpcoesDashboard } from '../dashboard-repository'
import { FILTROS_LIMPOS } from '../../domain/dashboard'

beforeEach(() => rpc.mockReset())

describe('carregarDashboard', () => {
  it('manda os filtros como a rec_dashboard espera: texto vazio = sem filtro, data vazia = null', async () => {
    rpc.mockResolvedValue({
      data: {
        totais: { itens: 0, com_divergencia: 0, sem_justificativa: 0, positivas: 0, negativas: 0, embs: 0, fora_do_recorte_por_data: 0 },
        fornecedores: [], semanas: [],
      },
      error: null,
    })
    await carregarDashboard({ ...FILTROS_LIMPOS, emb: 'EMB2', de: '2026-09-01', sinal: 'positiva' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rec_dashboard', {
      p_fornecedor: '', p_comprador: '', p_emb: 'EMB2', p_codigo: '',
      p_de: '2026-09-01', p_ate: null, p_sinal: 'positiva',
    })
  })

  it('traduz o jsonb para camelCase e número', async () => {
    rpc.mockResolvedValue({
      data: {
        totais: { itens: 9, com_divergencia: 6, sem_justificativa: 4, positivas: 3, negativas: 3, embs: 4, fora_do_recorte_por_data: 1 },
        fornecedores: [{ fornecedor: '', divergentes: 1, itens: 1 }],
        semanas: [{ inicio: '2026-09-14', justificadas: 0, sem_justificativa: 0 }],
      },
      error: null,
    })
    expect(await carregarDashboard(FILTROS_LIMPOS)).toEqual({
      totais: { itens: 9, comDivergencia: 6, semJustificativa: 4, positivas: 3, negativas: 3, embs: 4, foraDoRecortePorData: 1 },
      fornecedores: [{ fornecedor: '', divergentes: 1, itens: 1 }],
      semanas: [{ inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 }],
    })
  })

  it('erro do banco sobe (a página decide o que mostrar)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_PERMISSAO' } })
    await expect(carregarDashboard(FILTROS_LIMPOS)).rejects.toEqual({ message: 'SEM_PERMISSAO' })
  })
})

describe('carregarOpcoesDashboard', () => {
  it('devolve as duas listas, vazias quando o banco não tem nada', async () => {
    rpc.mockResolvedValue({ data: { fornecedores: ['ACME', 'Vishay'], compradores: null }, error: null })
    expect(await carregarOpcoesDashboard()).toEqual({ fornecedores: ['ACME', 'Vishay'], compradores: [] })
    expect(rpc).toHaveBeenCalledWith('rec_dashboard_opcoes')
  })
})
```

`src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ChartColumn } from 'lucide-react'

// O app-shell importa a server action de sair e o router; nenhum dos dois importa aqui.
vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/actions', () => ({ sair: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

import { RECEBIMENTO } from '../app-shell'

describe('menu do Recebimento', () => {
  it('"Dashboard" fica entre Fluxo e Registros', () => {
    const chaves = RECEBIMENTO.map((i) => i.chave)
    const fluxo = chaves.indexOf('rec-fluxo')
    expect(chaves[fluxo + 1]).toBe('rec-dashboard')
    expect(chaves[fluxo + 2]).toBe('rec-registros')
  })
  it('aponta para /recebimento/dashboard, com ícone de gráfico e a permissão de visualizar', () => {
    const item = RECEBIMENTO.find((i) => i.chave === 'rec-dashboard')!
    expect(item).toMatchObject({
      rotulo: 'Dashboard', href: '/recebimento/dashboard', modulo: 'recebimento', perm: 'visualizar',
    })
    expect(item.icone).toBe(ChartColumn)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts
```

Esperado: FAIL — o repositório: `Failed to resolve import "../dashboard-repository"`; o menu: `RECEBIMENTO` é `undefined` (não exportado) e o teste quebra em `RECEBIMENTO.map`.

- [ ] **Passo 3: o repositório**

`src/modules/recebimento/infra/dashboard-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { DadosDashboard, FiltrosDashboard, OpcoesDashboard } from '../domain/dashboard'

/** O jsonb que a `rec_dashboard` (0152) devolve, em snake_case. */
interface DashboardRpc {
  totais: {
    itens: number
    com_divergencia: number
    sem_justificativa: number
    positivas: number
    negativas: number
    embs: number
    fora_do_recorte_por_data: number
  }
  fornecedores: { fornecedor: string; divergentes: number; itens: number }[]
  semanas: { inicio: string; justificadas: number; sem_justificativa: number }[]
}

interface OpcoesRpc {
  fornecedores: string[] | null
  compradores: string[] | null
}

/**
 * Tudo da tela numa chamada só: a `rec_dashboard` filtra, conta, ranqueia e monta a série no banco.
 * Texto vazio = sem filtro (o banco entende assim); data vazia vai como null (sem recorte).
 */
export async function carregarDashboard(filtros: FiltrosDashboard): Promise<DadosDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_dashboard', {
    p_fornecedor: filtros.fornecedor,
    p_comprador: filtros.comprador,
    p_emb: filtros.emb,
    p_codigo: filtros.codigo,
    p_de: filtros.de || null,
    p_ate: filtros.ate || null,
    p_sinal: filtros.sinal,
  })
  if (error) throw error
  const r = data as DashboardRpc
  return {
    totais: {
      itens: Number(r.totais.itens),
      comDivergencia: Number(r.totais.com_divergencia),
      semJustificativa: Number(r.totais.sem_justificativa),
      positivas: Number(r.totais.positivas),
      negativas: Number(r.totais.negativas),
      embs: Number(r.totais.embs),
      foraDoRecortePorData: Number(r.totais.fora_do_recorte_por_data),
    },
    fornecedores: (r.fornecedores ?? []).map((f) => ({
      fornecedor: f.fornecedor ?? '',
      divergentes: Number(f.divergentes),
      itens: Number(f.itens),
    })),
    semanas: (r.semanas ?? []).map((s) => ({
      inicio: s.inicio,
      justificadas: Number(s.justificadas),
      semJustificativa: Number(s.sem_justificativa),
    })),
  }
}

/** Fornecedores e compradores distintos, para as duas listas suspensas (`rec_dashboard_opcoes`). */
export async function carregarOpcoesDashboard(): Promise<OpcoesDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_dashboard_opcoes')
  if (error) throw error
  const r = (data ?? {}) as OpcoesRpc
  return { fornecedores: r.fornecedores ?? [], compradores: r.compradores ?? [] }
}
```

- [ ] **Passo 4: o menu — três trocas exatas em `src/shared/ui/app-shell.tsx`**

4a. No import de `lucide-react`, troque:

```ts
  Server,
  type LucideIcon,
```

por:

```ts
  Server,
  ChartColumn,
  type LucideIcon,
```

4b. Troque `const RECEBIMENTO: FolhaModular[] = [` por `export const RECEBIMENTO: FolhaModular[] = [` (exportar uma constante de um arquivo `'use client'` é permitido; a regra de só exportar função é de `'use server'`).

4c. Logo depois da linha do Fluxo do Recebimento:

```ts
  { chave: 'rec-fluxo', rotulo: 'Fluxo', href: '/recebimento/fluxo', icone: Workflow, modulo: 'recebimento', perm: 'visualizar' },
```

acrescente a linha:

```ts
  { chave: 'rec-dashboard', rotulo: 'Dashboard', href: '/recebimento/dashboard', icone: ChartColumn, modulo: 'recebimento', perm: 'visualizar' },
```

- [ ] **Passo 5: rodar e ver passar; tipos e lint**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts
npx tsc --noEmit -p .
npx eslint src/modules/recebimento/infra/dashboard-repository.ts src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts src/shared/ui/app-shell.tsx src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts
```

Esperado: 6 testes passam; `tsc` e `eslint` sem saída.

- [ ] **Passo 6: commit**

```bash
git add src/modules/recebimento/infra/dashboard-repository.ts src/modules/recebimento/infra/__tests__/dashboard-repository.test.ts src/shared/ui/app-shell.tsx src/shared/ui/__tests__/app-shell-menu-recebimento.test.ts
git commit -m "$(cat <<'EOF'
recebimento: repositorio do dashboard e o item Dashboard no menu

carregarDashboard e carregarOpcoesDashboard chamam rec_dashboard e rec_dashboard_opcoes (0152)
e traduzem o jsonb. O menu do Recebimento ganha "Dashboard" entre Fluxo e Registros, com a
permissao recebimento.visualizar.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Página (gate) + barra de filtros + três cartões + rodapé

**Arquivos:**
- Criar: `src/app/(app)/recebimento/dashboard/page.tsx`, `dashboard-recebimento.tsx`, `filtros-dashboard.tsx`, `cartoes-dashboard.tsx`, `explica.tsx`
- Criar: `src/app/(app)/recebimento/dashboard/__tests__/page.test.tsx`, `__tests__/filtros-cartoes.test.tsx`

**Interfaces — consome:** do domínio (Task 2): `filtrosDaUrl`, `urlDosFiltros`, `FILTROS_LIMPOS`, `etiquetasDosFiltros`, `semFiltro`, `percentual`, `formatarNumero`, `formatarPercentual`, `textoRodape`, `EXPLICA` e os tipos `FiltrosDashboard`, `DadosDashboard`, `OpcoesDashboard`, `TotaisDashboard`, `Sinal`. Do repositório (Task 3): `carregarDashboard`, `carregarOpcoesDashboard`. Do projeto: `getSessao` (`@/modules/auth/application/get-sessao`), `podeNoModulo` (`@/modules/auth/domain/perfil`), `SemPermissao` (`@/shared/ui/sem-permissao`), `Button`, `Input`, `Label`, `Select*`, `Card*`, `Popover*` (`@/components/ui/*`).

**Interfaces — produz:**

```ts
// page.tsx (Server Component)
export const dynamic = 'force-dynamic'
export default async function DashboardRecebimentoPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<JSX.Element>
// dashboard-recebimento.tsx ('use client')
export function DashboardRecebimento(props: { filtros: FiltrosDashboard; dados: DadosDashboard | null; opcoes: OpcoesDashboard; erro: string | null }): JSX.Element
// filtros-dashboard.tsx ('use client')
export function FiltrosDashboardBarra(props: { filtros: FiltrosDashboard; opcoes: OpcoesDashboard; onAplicar: (f: FiltrosDashboard) => void }): JSX.Element
// cartoes-dashboard.tsx ('use client')
export function CartoesDashboard(props: { totais: TotaisDashboard; sinal: Sinal | '' }): JSX.Element
// explica.tsx ('use client')
export function Explica(props: { texto: string; rotulo?: string }): JSX.Element   // rotulo padrão: 'Como é calculado'
```

`dashboard-recebimento.tsx` nasce com a linha-marcador `{/* Os três gráficos entram aqui (Task 5). */}`, que a Task 5 troca.

**Leia antes (AGENTS.md):** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (seção `searchParams`: é uma **Promise**), `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` e `use-pathname.md`. Depois: `src/app/(app)/recebimento/registros/page.tsx` e `registros-filtros.tsx` (o molde da tela irmã: gate, `searchParams`, Select com sentinela "Todos"), `src/app/(app)/recebimento/__tests__/gate-telas.test.tsx` (como se testa o gate) e, só como referência visual, `src/app/(app)/shopfloor/analisar/dashboard/dashboard-painel.tsx` (cartões com ⓘ). **Não** importe nada do ShopFloor e **não** use `useSearchParams` (a página entrega os filtros por props; isso evita a fronteira de Suspense).

- [ ] **Passo 1: testes**

`src/app/(app)/recebimento/dashboard/__tests__/page.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
// Os componentes da tela são clientes e usam o router do App Router, que não existe no teste.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

const { getSessao, carregarDashboard, carregarOpcoesDashboard } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  carregarDashboard: vi.fn(),
  carregarOpcoesDashboard: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/dashboard-repository', () => ({ carregarDashboard, carregarOpcoesDashboard }))

import DashboardRecebimentoPage from '../page'
import { FILTROS_LIMPOS } from '@/modules/recebimento/domain/dashboard'

function sessao(porModulo: Record<string, Record<string, boolean>>) {
  return {
    usuarioId: 'u1',
    nome: 'Carla Operadora',
    email: 'carla@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo, sistema: false },
  }
}

const VAZIO = {
  totais: { itens: 0, comDivergencia: 0, semJustificativa: 0, positivas: 0, negativas: 0, embs: 0, foraDoRecortePorData: 0 },
  fornecedores: [],
  semanas: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Só o relógio é falso: 15/10/2026, meio-dia em São Paulo.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
  carregarDashboard.mockResolvedValue(VAZIO)
  carregarOpcoesDashboard.mockResolvedValue({ fornecedores: ['Vishay'], compradores: ['Pedro'] })
})
afterEach(() => vi.useRealTimers())

describe('página do dashboard do Recebimento — o gate', () => {
  it('sem sessão: recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(null)
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
    expect(carregarOpcoesDashboard).not.toHaveBeenCalled()
  })

  it('sem `recebimento: visualizar`: recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { editar: true, importar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/não tem permissão para ver o dashboard do Recebimento/i)).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
  })

  it('permissão do ShopFloor não abre o dashboard do Recebimento', async () => {
    getSessao.mockResolvedValue(sessao({ shopfloor: { visualizar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
  })
})

describe('página do dashboard do Recebimento — os filtros da URL', () => {
  it('URL vazia: consulta os últimos 90 dias', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(carregarDashboard).toHaveBeenCalledWith({ ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' })
    expect(screen.getByText('Dashboard de divergências')).toBeInTheDocument()
  })

  it('consulta com os filtros da URL', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    render(await DashboardRecebimentoPage({
      searchParams: Promise.resolve({ fornecedor: 'Vishay', emb: 'EMB2', periodo: 'tudo', sinal: 'negativa' }),
    }))
    expect(carregarDashboard).toHaveBeenCalledWith({ ...FILTROS_LIMPOS, fornecedor: 'Vishay', emb: 'EMB2', sinal: 'negativa' })
  })

  it('erro do banco não derruba a página: mostra o aviso e os filtros', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    carregarDashboard.mockRejectedValue(new Error('boom'))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/Não foi possível carregar o dashboard/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
  })
})
```

`src/app/(app)/recebimento/dashboard/__tests__/filtros-cartoes.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FILTROS_LIMPOS, type FiltrosDashboard, type TotaisDashboard } from '@/modules/recebimento/domain/dashboard'
import { FiltrosDashboardBarra } from '../filtros-dashboard'
import { CartoesDashboard } from '../cartoes-dashboard'

const OPCOES = { fornecedores: ['ACME', 'Vishay'], compradores: ['Pedro'] }
const NOVENTA: FiltrosDashboard = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }

describe('barra de filtros', () => {
  it('nasce com os filtros aplicados', () => {
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, emb: 'EMB2' }} opcoes={OPCOES} onAplicar={vi.fn()} />)
    expect(screen.getByLabelText('EMB')).toHaveValue('EMB2')
    expect(screen.getByLabelText('De')).toHaveValue('2026-07-18')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-10-15')
  })

  it('Filtrar manda o formulário, aparado, e preserva o sinal (que vem do gráfico)', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, sinal: 'positiva' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    fireEvent.change(screen.getByLabelText('EMB'), { target: { value: ' emb2 ' } })
    fireEvent.change(screen.getByLabelText('Código do material'), { target: { value: 'RES1' } })
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onAplicar).toHaveBeenCalledWith({
      ...NOVENTA, emb: 'emb2', codigo: 'RES1', de: '2026-09-01', sinal: 'positiva',
    })
  })

  it('Limpar filtros tira TODOS, inclusive o período', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, fornecedor: 'Vishay' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(onAplicar).toHaveBeenCalledWith(FILTROS_LIMPOS)
  })

  it('cada filtro aplicado vira uma etiqueta que se tira sozinha', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, fornecedor: 'Vishay', sinal: 'negativa' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    const lista = screen.getByRole('list', { name: 'Filtros aplicados' })
    expect(lista).toHaveTextContent('Fornecedor: Vishay')
    expect(lista).toHaveTextContent('Chegada: 18/07/2026 a 15/10/2026')
    expect(lista).toHaveTextContent('Só negativas')
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o filtro Fornecedor: Vishay' }))
    expect(onAplicar).toHaveBeenLastCalledWith({ ...NOVENTA, sinal: 'negativa' })
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o filtro Chegada: 18/07/2026 a 15/10/2026' }))
    expect(onAplicar).toHaveBeenLastCalledWith({ ...FILTROS_LIMPOS, fornecedor: 'Vishay', sinal: 'negativa' })
  })

  it('sem filtro nenhum, sem lista de etiquetas', () => {
    render(<FiltrosDashboardBarra filtros={FILTROS_LIMPOS} opcoes={OPCOES} onAplicar={vi.fn()} />)
    expect(screen.queryByRole('list', { name: 'Filtros aplicados' })).not.toBeInTheDocument()
  })
})

describe('cartões e rodapé', () => {
  const t: TotaisDashboard = {
    itens: 1284, comDivergencia: 137, semJustificativa: 40, positivas: 80, negativas: 57,
    embs: 42, foraDoRecortePorData: 12,
  }
  it('os três números grandes, com a porcentagem sem arredondar para 100', () => {
    render(<CartoesDashboard totais={{ ...t, itens: 10000, comDivergencia: 9999 }} sinal="" />)
    expect(screen.getByText('10.000')).toBeInTheDocument()
    expect(screen.getByText('9.999')).toBeInTheDocument()
    expect(screen.getByText('99,9% dos itens')).toBeInTheDocument()
  })
  it('o rodapé diz o recorte e quem ficou fora do período', () => {
    render(<CartoesDashboard totais={t} sinal="" />)
    expect(screen.getByTestId('rodape-contagem')).toHaveTextContent(
      '137 de 1.284 itens (10,7%) em 42 EMBs. 12 itens sem data de chegada ficaram fora do período.',
    )
  })
  it('com sinal, o cartão diz qual', () => {
    render(<CartoesDashboard totais={t} sinal="negativa" />)
    expect(screen.getByText('Com divergência (só negativas)')).toBeInTheDocument()
  })
  it('cada número tem o seu ⓘ', () => {
    render(<CartoesDashboard totais={t} sinal="" />)
    // 3 cartões + o do rodapé (o que conta como EMB).
    expect(screen.getAllByRole('button', { name: 'Como é calculado' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'O que conta como EMB' })).toBeInTheDocument()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run --maxWorkers=2 "src/app/(app)/recebimento/dashboard"
```

Esperado: FAIL — `Failed to resolve import "../page"` e `Failed to resolve import "../filtros-dashboard"`.

- [ ] **Passo 3: o ⓘ**

`src/app/(app)/recebimento/dashboard/explica.tsx`:

```tsx
'use client'

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * O "ⓘ" com a definição de um número. Abre no hover e no toque (tablet). Mesma ideia do dashboard
 * do ShopFloor, copiada de propósito: esta tela não depende de código do ShopFloor.
 */
export function Explica({ texto, rotulo = 'Como é calculado' }: { texto: string; rotulo?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        aria-label={rotulo}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 max-w-[calc(100vw-2rem)] gap-1 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">{rotulo}</p>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Passo 4: os cartões e o rodapé**

`src/app/(app)/recebimento/dashboard/cartoes-dashboard.tsx`:

```tsx
'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  EXPLICA,
  formatarNumero,
  formatarPercentual,
  percentual,
  textoRodape,
  type Sinal,
  type TotaisDashboard,
} from '@/modules/recebimento/domain/dashboard'
import { Explica } from './explica'

/** Os três números grandes e o rodapé da contagem. */
export function CartoesDashboard({ totais, sinal }: { totais: TotaisDashboard; sinal: Sinal | '' }) {
  const sufixo = sinal === 'positiva' ? ' (só positivas)' : sinal === 'negativa' ? ' (só negativas)' : ''
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao rotulo="Itens" valor={totais.itens} explica={EXPLICA.itens} />
        <Cartao
          rotulo={`Com divergência${sufixo}`}
          valor={totais.comDivergencia}
          detalhe={`${formatarPercentual(percentual(totais.comDivergencia, totais.itens))} dos itens`}
          explica={EXPLICA.comDivergencia}
        />
        <Cartao
          rotulo="Sem justificativa"
          valor={totais.semJustificativa}
          detalhe={`de ${formatarNumero(totais.comDivergencia)} com divergência`}
          explica={EXPLICA.semJustificativa}
        />
      </div>
      {/* Frase corrida num <p> comum: com flex, cada pedaço de texto viraria um item e a quebra de
          linha cairia no meio da frase. */}
      <p className="text-xs text-muted-foreground">
        <span data-testid="rodape-contagem">{textoRodape(totais)}</span>{' '}
        <Explica texto={EXPLICA.embs} rotulo="O que conta como EMB" />
      </p>
    </div>
  )
}

function Cartao({ rotulo, valor, detalhe, explica }: {
  rotulo: string; valor: number; detalhe?: string; explica: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
          <Explica texto={explica} />
        </div>
        <p className="text-3xl font-bold tabular-nums text-foreground">{formatarNumero(valor)}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Passo 5: a barra de filtros**

`src/app/(app)/recebimento/dashboard/filtros-dashboard.tsx`:

```tsx
'use client'

import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  FILTROS_LIMPOS,
  etiquetasDosFiltros,
  semFiltro,
  type FiltrosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'

// O Select não aceita item com value="" (é o "nada escolhido" interno dele): marcador para "Todos".
const TODOS = '__todos__'

interface FiltrosDashboardProps {
  /** Os filtros aplicados agora (vêm da URL). O formulário nasce com eles. */
  filtros: FiltrosDashboard
  opcoes: OpcoesDashboard
  /** Leva os filtros para a URL — a tela inteira recalcula. */
  onAplicar: (filtros: FiltrosDashboard) => void
}

/**
 * Fornecedor · Comprador · EMB · Código · De · Até · Filtrar · Limpar filtros, e as etiquetas
 * removíveis do que está aplicado. Quem chama remonta este componente (key) quando os filtros da
 * URL mudam, para o formulário acompanhar um clique num gráfico.
 */
export function FiltrosDashboardBarra({ filtros, opcoes, onAplicar }: FiltrosDashboardProps) {
  const [fornecedor, setFornecedor] = useState(filtros.fornecedor)
  const [comprador, setComprador] = useState(filtros.comprador)
  const [emb, setEmb] = useState(filtros.emb)
  const [codigo, setCodigo] = useState(filtros.codigo)
  const [de, setDe] = useState(filtros.de)
  const [ate, setAte] = useState(filtros.ate)
  const etiquetas = etiquetasDosFiltros(filtros)

  // Enter em qualquer campo filtra. O sinal não está no formulário (vem do gráfico): preserva.
  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    onAplicar({ fornecedor, comprador, emb: emb.trim(), codigo: codigo.trim(), de, ate, sinal: filtros.sinal })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <form
        onSubmit={aoEnviar}
        className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
      >
        <CampoLista id="dash-fornecedor" rotulo="Fornecedor" valor={fornecedor} opcoes={opcoes.fornecedores} aoMudar={setFornecedor} />
        <CampoLista id="dash-comprador" rotulo="Comprador" valor={comprador} opcoes={opcoes.compradores} aoMudar={setComprador} />

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-emb">EMB</Label>
          <Input id="dash-emb" value={emb} onChange={(e) => setEmb(e.target.value)} placeholder="Número da EMB" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-codigo">Código do material</Label>
          <Input id="dash-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-de">De</Label>
          <Input id="dash-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="dash-ate">Até</Label>
          <Input id="dash-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <Button type="submit" className="bg-enterplak hover:bg-enterplak-700">Filtrar</Button>
          <Button type="button" variant="outline" onClick={() => onAplicar(FILTROS_LIMPOS)}>Limpar filtros</Button>
        </div>
      </form>

      {etiquetas.length > 0 && (
        <ul aria-label="Filtros aplicados" className="flex flex-wrap gap-2">
          {etiquetas.map((e) => (
            <li key={e.chave} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onAplicar(semFiltro(filtros, e.chave))}
                aria-label={`Tirar o filtro ${e.texto}`}
                title={`Tirar o filtro ${e.texto}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="truncate">{e.texto}</span>
                <X className="size-3 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CampoLista({ id, rotulo, valor, opcoes, aoMudar }: {
  id: string; rotulo: string; valor: string; opcoes: string[]; aoMudar: (v: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Select value={valor || TODOS} onValueChange={(v) => aoMudar(v === TODOS ? '' : String(v))}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue placeholder="Todos">
            {(v: string | null) => (!v || v === TODOS ? 'Todos' : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Passo 6: o orquestrador (sem os gráficos ainda)**

`src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  urlDosFiltros,
  type DadosDashboard,
  type FiltrosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'
import { CartoesDashboard } from './cartoes-dashboard'
import { FiltrosDashboardBarra } from './filtros-dashboard'

interface DashboardRecebimentoProps {
  filtros: FiltrosDashboard
  /** null quando o banco falhou (a página mostra `erro`). */
  dados: DadosDashboard | null
  opcoes: OpcoesDashboard
  erro: string | null
}

/**
 * A tela do dashboard. O estado dos filtros mora na URL: aplicar um filtro (pelo formulário, por
 * uma etiqueta ou por um clique num gráfico) é navegar para a URL nova, e o servidor recalcula.
 * Assim o link compartilhado reproduz a tela.
 */
export function DashboardRecebimento({ filtros, dados, opcoes, erro }: DashboardRecebimentoProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [pendente, iniciar] = useTransition()

  function navegar(novos: FiltrosDashboard) {
    const query = urlDosFiltros(novos, new Date())
    iniciar(() => router.push(query ? `${pathname}?${query}` : pathname))
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* key: um clique num gráfico muda a URL, e o formulário tem que nascer de novo com ela. */}
      <FiltrosDashboardBarra key={JSON.stringify(filtros)} filtros={filtros} opcoes={opcoes} onAplicar={navegar} />

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {dados && (
        // Recalculando: segura a foto anterior esmaecida, sem pular o layout nem piscar em branco.
        <div className={`flex min-w-0 flex-col gap-4 transition-opacity ${pendente ? 'opacity-60' : ''}`}>
          <CartoesDashboard totais={dados.totais} sinal={filtros.sinal} />
          {/* Os três gráficos entram aqui (Task 5). */}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Passo 7: a página**

`src/app/(app)/recebimento/dashboard/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import {
  filtrosDaUrl,
  type DadosDashboard,
  type OpcoesDashboard,
} from '@/modules/recebimento/domain/dashboard'
import {
  carregarDashboard,
  carregarOpcoesDashboard,
} from '@/modules/recebimento/infra/dashboard-repository'
import { DashboardRecebimento } from './dashboard-recebimento'

export const dynamic = 'force-dynamic'

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardRecebimentoPage({ searchParams }: DashboardPageProps) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver o dashboard do Recebimento." />
  }

  // Estado vem da URL e é validado no domínio (nada dele é confiável). Sem datas na URL = 90 dias.
  const filtros = filtrosDaUrl(await searchParams, new Date())

  // Sem isto, um erro do banco derrubaria a rota inteira — e o link ficaria quebrado, já que o
  // estado mora na URL. Degrada para a mensagem, com os filtros ainda na tela.
  let dados: DadosDashboard | null = null
  let opcoes: OpcoesDashboard = { fornecedores: [], compradores: [] }
  let erro: string | null = null
  try {
    ;[dados, opcoes] = await Promise.all([carregarDashboard(filtros), carregarOpcoesDashboard()])
  } catch {
    erro = 'Não foi possível carregar o dashboard. Tente de novo ou limpe os filtros.'
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Dashboard de divergências</h2>
        <p className="text-sm text-muted-foreground">
          Quanto do que chegou veio com divergência de quantidade, de quem, quando — e quanto ainda
          ninguém explicou. Clique num gráfico para filtrar a tela.
        </p>
      </div>
      <DashboardRecebimento filtros={filtros} dados={dados} opcoes={opcoes} erro={erro} />
    </div>
  )
}
```

- [ ] **Passo 8: rodar e ver passar; tipos e lint**

```bash
npx vitest run --maxWorkers=2 "src/app/(app)/recebimento/dashboard"
npx tsc --noEmit -p .
npx eslint "src/app/(app)/recebimento/dashboard"
```

Esperado: 2 arquivos, 15 testes passam; `tsc` e `eslint` sem saída.

- [ ] **Passo 9: commit**

```bash
git add "src/app/(app)/recebimento/dashboard/page.tsx" "src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx" "src/app/(app)/recebimento/dashboard/filtros-dashboard.tsx" "src/app/(app)/recebimento/dashboard/cartoes-dashboard.tsx" "src/app/(app)/recebimento/dashboard/explica.tsx" "src/app/(app)/recebimento/dashboard/__tests__/page.test.tsx" "src/app/(app)/recebimento/dashboard/__tests__/filtros-cartoes.test.tsx"
git commit -m "$(cat <<'EOF'
recebimento: pagina do dashboard com gate, filtros na URL, cartoes e rodape

/recebimento/dashboard exige recebimento.visualizar; os filtros vem da URL (sem datas = ultimos
90 dias), aplicar e navegar. Tres cartoes com o i de cada definicao e o rodape da contagem. Erro
do banco degrada para aviso, sem derrubar a rota.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Os três gráficos + clique que filtra

**Arquivos:**
- Criar: `src/modules/recebimento/domain/dashboard-grafico.ts`, `src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts`
- Criar: `src/app/(app)/recebimento/dashboard/graficos-dashboard.tsx`, `__tests__/graficos-dashboard.test.tsx`, `__tests__/dashboard-recebimento.test.tsx`
- Modificar: `src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx` (três trocas exatas)

**Interfaces — consome:** do domínio (Task 2): `SemanaDashboard`, `FornecedorDashboard`, `Sinal`, `DadosDashboard`, `FILTROS_LIMPOS`, `aplicarClique`, `fimDaSemana`, `diaBr`, `rotuloFornecedor`, `percentual`, `formatarNumero`, `formatarPercentual`, `EXPLICA`. Da Task 4: `Explica` (`./explica`), `DashboardRecebimento` e sua linha-marcador.

**Interfaces — produz:**

```ts
// src/modules/recebimento/domain/dashboard-grafico.ts (puro)
export function passoRedondo(maximo: number): number
export function eixoInteiro(maximo: number): { topo: number; marcas: number[] }
export interface BarraSemana { inicio: string; x: number; largura: number; xFaixa: number; larguraFaixa: number; yJustificadas: number; alturaJustificadas: number; ySem: number; alturaSem: number; rotulo: string | null; centro: number }
export interface GeometriaSemanas { largura: number; altura: number; esquerda: number; topoPlot: number; basePlot: number; direita: number; marcas: { valor: number; y: number }[]; barras: BarraSemana[] }
export const ALTURA_GRAFICO = 220
export function geometriaSemanas(semanas: SemanaDashboard[], larguraContainer: number): GeometriaSemanas
// src/app/(app)/recebimento/dashboard/graficos-dashboard.tsx ('use client')
export function CartaoGrafico(props: { titulo: string; explica: string; acao?: ReactNode; children: ReactNode }): JSX.Element
export function LegendaSemanas(): JSX.Element
export function RankingFornecedores(props: { fornecedores: FornecedorDashboard[]; ativo: string; onClique: (fornecedor: string) => void }): JSX.Element
export function GraficoSemanas(props: { semanas: SemanaDashboard[]; ativo: string; onClique: (inicio: string) => void }): JSX.Element
export function PositivasNegativas(props: { positivas: number; negativas: number; ativo: Sinal | ''; onClique: (sinal: Sinal) => void }): JSX.Element
```

**Leia antes (AGENTS.md):** `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`. Depois, como referência de ideia (não importe): `src/app/(app)/shopfloor/analisar/dashboard/dashboard-painel.tsx` (`BarrasRanking`, `BarraProporcao`: barras HTML com a linha inteira clicável) e o gráfico SVG de `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx` (linhas ~330–410: largura medida com `ResizeObserver`, coordenadas 1:1).

**Como cada gráfico é desenhado em escala (o código abaixo já faz; o teste confere):**

- **Divergências por semana (SVG).** Uma escala só, `y(v) = topoPlot + alturaPlot · (1 − v/topo)`, desenha as barras, as linhas de grade e os rótulos do eixo Y — o rótulo "4" fica exatamente na altura do topo de uma barra que soma 4. O `topo` é a última marca, múltiplo de um passo redondo (1, 2, 5 × 10ⁿ) e ≥ o maior valor: os rótulos só nomeiam valores que o eixo alcança. A margem esquerda cresce com o número de caracteres do maior rótulo (`10 + 7 px × caracteres`), a direita reserva 24 px (metade de um "DD/MM" a 10 px + folga), o topo 12 px (meia altura do rótulo mais alto) e a base 28 px (rótulos do eixo X): os rótulos das pontas cabem no `viewBox`. Coordenadas 1:1 com pixels (largura do container medida; mínimo 280); `h-auto max-w-full` faz o SVG encolher junto num container menor, sem rolagem horizontal. Duas séries empilhadas: justificadas embaixo (ardósia), sem justificativa em cima (vinho). Coluna inteira clicável (retângulo com `fill-transparent` explícito — sem fill o navegador não entrega o clique na área vazia), com `role="button"`, `tabIndex`, Enter/Espaço e `<title>`. Rótulos do eixo X pulam para ficarem a ≥ 44 px um do outro. Texto em `fill-muted-foreground`, grade em `stroke-border`.
- **Ranking por fornecedor (HTML).** Largura da barra = `divergentes ÷ maior divergentes × 100%` (mínimo 2 px, para o menor não sumir), mesma escala para as 10 linhas. Nome com `truncate` + `title` com o nome inteiro (nome longo nunca empurra a barra para fora). À direita, o número e "x% dos itens dele" (empilhados no celular). "(sem fornecedor)" em itálico, não clicável.
- **Positivas × negativas (HTML).** Duas barras, mesma escala (`valor ÷ maior das duas`), número e porcentagem das divergentes; barra de zero não é desenhada (zero é barra nenhuma). Âmbar (a mais) × azul (a menos), pares claro/escuro com luminosidades diferentes entre si.
- **Vazios e bordas:** sem semanas (recorte sem data) → "Nenhum item com data de chegada neste recorte."; semanas todas zero → "Nenhum item divergente neste recorte." (o eixo de 0 a 1 existe na geometria, mas a tela mostra a frase); uma semana → uma barra centrada, larga no máximo 32 px; ranking vazio → "Nenhum fornecedor com item divergente neste recorte."; positivas e negativas zero → "Nenhum item divergente neste recorte.".

- [ ] **Passo 1: testes da geometria**

`src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALTURA_GRAFICO, eixoInteiro, geometriaSemanas, passoRedondo } from '../dashboard-grafico'
import type { SemanaDashboard } from '../dashboard'

const s = (inicio: string, justificadas: number, semJustificativa: number): SemanaDashboard =>
  ({ inicio, justificadas, semJustificativa })

describe('eixo Y', () => {
  it('passo redondo e inteiro', () => {
    expect(passoRedondo(1)).toBe(1)
    expect(passoRedondo(7)).toBe(2)
    expect(passoRedondo(10)).toBe(5)
    expect(passoRedondo(137)).toBe(50)
  })
  it('o topo é a última marca e cobre o maior valor', () => {
    expect(eixoInteiro(7)).toEqual({ topo: 8, marcas: [0, 2, 4, 6, 8] })
    expect(eixoInteiro(4)).toEqual({ topo: 4, marcas: [0, 1, 2, 3, 4] })
    expect(eixoInteiro(137)).toEqual({ topo: 150, marcas: [0, 50, 100, 150] })
    expect(eixoInteiro(1500)).toEqual({ topo: 1500, marcas: [0, 500, 1000, 1500] })
  })
  it('tudo zero ainda tem um eixo de 0 a 1 (sem divisão por zero)', () => {
    expect(eixoInteiro(0)).toEqual({ topo: 1, marcas: [0, 1] })
  })
})

describe('geometriaSemanas', () => {
  const semanas = [s('2026-09-07', 1, 1), s('2026-09-14', 0, 0), s('2026-09-21', 1, 3)]
  const g = geometriaSemanas(semanas, 640)

  it('UMA escala: a marca "4" está na altura do topo da barra que soma 4', () => {
    const marca4 = g.marcas.find((m) => m.valor === 4)!
    expect(g.barras[2]!.ySem).toBeCloseTo(marca4.y, 6)
    const marca0 = g.marcas.find((m) => m.valor === 0)!
    expect(marca0.y).toBeCloseTo(g.basePlot, 6)
  })
  it('as barras empilham: justificadas embaixo, sem justificativa em cima, na base do eixo', () => {
    const b = g.barras[0]!
    expect(b.yJustificadas + b.alturaJustificadas).toBeCloseTo(g.basePlot, 6)
    expect(b.ySem + b.alturaSem).toBeCloseTo(b.yJustificadas, 6)
    expect(b.alturaJustificadas).toBeCloseTo(b.alturaSem, 6) // 1 e 1
  })
  it('semana vazia tem altura zero, mas está lá (o eixo não pula semana)', () => {
    expect(g.barras).toHaveLength(3)
    expect(g.barras[1]!.alturaJustificadas).toBe(0)
    expect(g.barras[1]!.alturaSem).toBe(0)
  })
  it('tudo cabe na largura e na altura do SVG', () => {
    for (const b of g.barras) {
      expect(b.x).toBeGreaterThanOrEqual(g.esquerda)
      expect(b.x + b.largura).toBeLessThanOrEqual(g.direita + 1e-6)
      expect(b.ySem).toBeGreaterThanOrEqual(g.topoPlot - 1e-6)
    }
    expect(g.altura).toBe(ALTURA_GRAFICO)
    expect(g.direita).toBeLessThan(g.largura)
  })
  it('uma semana só: uma barra centrada, larga no máximo 32 px', () => {
    const um = geometriaSemanas([s('2026-09-21', 2, 0)], 640)
    expect(um.barras).toHaveLength(1)
    expect(um.barras[0]!.largura).toBe(32)
    expect(um.barras[0]!.centro).toBeCloseTo((um.esquerda + um.direita) / 2, 6)
    expect(um.barras[0]!.rotulo).toBe('21/09')
  })
  it('muitas semanas: rótulos pulam para não encavalar (≥ 44 px entre eles)', () => {
    const muitas = Array.from({ length: 52 }, (_, i) => s(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 1, 0))
    const gm = geometriaSemanas(muitas, 360)
    const comRotulo = gm.barras.filter((b) => b.rotulo !== null)
    expect(comRotulo.length).toBeGreaterThan(1)
    for (let i = 1; i < comRotulo.length; i++) {
      expect(comRotulo[i]!.centro - comRotulo[i - 1]!.centro).toBeGreaterThanOrEqual(44 - 1e-6)
    }
  })
  it('a margem esquerda cresce com o tamanho do maior rótulo do eixo', () => {
    const pequeno = geometriaSemanas([s('2026-09-21', 3, 0)], 640)
    const grande = geometriaSemanas([s('2026-09-21', 1400, 0)], 640)
    expect(grande.esquerda).toBeGreaterThan(pequeno.esquerda)
  })
  it('largura mínima de 280 px (celular estreito)', () => {
    expect(geometriaSemanas(semanas, 200).largura).toBe(280)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts
```

Esperado: FAIL — `Failed to resolve import "../dashboard-grafico"`.

- [ ] **Passo 3: implementar a geometria**

`src/modules/recebimento/domain/dashboard-grafico.ts`:

```ts
// Geometria do gráfico "Divergências por semana" — conta pura, testável sem DOM.
// UMA escala só (`y`) desenha as barras, as linhas de grade e os rótulos do eixo: o rótulo "4" fica
// exatamente na altura de uma barra de valor 4. Coordenadas 1:1 com pixels (a largura vem do
// container medido), então texto e linha não distorcem.
import type { SemanaDashboard } from './dashboard'

/** Passo "redondo" (1, 2, 5 × 10ⁿ), inteiro e ≥ 1, para ~4 divisões do eixo. */
export function passoRedondo(maximo: number): number {
  const bruto = maximo / 4
  if (bruto <= 1) return 1
  const potencia = 10 ** Math.floor(Math.log10(bruto))
  const m = bruto / potencia
  const redondo = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
  return redondo * potencia
}

/** Topo do eixo e as marcas: 0, passo, 2·passo… até o topo (o topo é a última marca). */
export function eixoInteiro(maximo: number): { topo: number; marcas: number[] } {
  const passo = passoRedondo(Math.max(1, maximo))
  const topo = Math.max(passo, Math.ceil(maximo / passo) * passo)
  const marcas: number[] = []
  for (let v = 0; v <= topo; v += passo) marcas.push(v)
  return { topo, marcas }
}

export interface BarraSemana {
  inicio: string
  /** Canto esquerdo e largura da barra desenhada. */
  x: number
  largura: number
  /** Faixa clicável: a coluna inteira da semana (mais fácil de acertar que a barra). */
  xFaixa: number
  larguraFaixa: number
  /** Segmento de baixo: justificadas. */
  yJustificadas: number
  alturaJustificadas: number
  /** Segmento de cima: sem justificativa. */
  ySem: number
  alturaSem: number
  /** Rótulo do eixo X ('DD/MM') ou null quando é pulado para não encavalar. */
  rotulo: string | null
  /** Centro da coluna (onde o rótulo é ancorado). */
  centro: number
}

export interface GeometriaSemanas {
  largura: number
  altura: number
  esquerda: number
  topoPlot: number
  basePlot: number
  direita: number
  marcas: { valor: number; y: number }[]
  barras: BarraSemana[]
}

/** Altura total do SVG. */
export const ALTURA_GRAFICO = 220
const TOPO = 12          // folga em cima para o rótulo da marca mais alta não ser cortado
const BASE = 28          // faixa dos rótulos do eixo X
const DIREITA = 24       // metade de um 'DD/MM' (10 px de fonte ≈ 32 px de largura) + folga
const LARGURA_MAX_BARRA = 32
const ESPACO_ROTULO = 44 // distância mínima entre dois rótulos do eixo X, em px
const LARGURA_DIGITO = 7 // largura aproximada de um algarismo a 11 px

/**
 * A geometria do gráfico para uma largura de container. A margem esquerda cresce com o número de
 * dígitos do maior rótulo do eixo Y — "1.500" precisa de mais espaço que "8".
 */
export function geometriaSemanas(semanas: SemanaDashboard[], larguraContainer: number): GeometriaSemanas {
  const largura = Math.max(280, Math.round(larguraContainer))
  const maximo = semanas.reduce((m, s) => Math.max(m, s.justificadas + s.semJustificativa), 0)
  const { topo, marcas } = eixoInteiro(maximo)
  const rotuloMaisLargo = new Intl.NumberFormat('pt-BR').format(topo).length
  const esquerda = 10 + rotuloMaisLargo * LARGURA_DIGITO
  const basePlot = ALTURA_GRAFICO - BASE
  const alturaPlot = basePlot - TOPO
  const larguraPlot = Math.max(1, largura - esquerda - DIREITA)
  const y = (v: number) => TOPO + alturaPlot * (1 - v / topo)

  const n = semanas.length
  const coluna = n > 0 ? larguraPlot / n : larguraPlot
  const larguraBarra = Math.max(1, Math.min(LARGURA_MAX_BARRA, coluna * 0.7))
  const passoRotulo = Math.max(1, Math.ceil(ESPACO_ROTULO / coluna))

  const barras = semanas.map((s, i): BarraSemana => {
    const xFaixa = esquerda + i * coluna
    const yJ = y(s.justificadas)
    const yS = y(s.justificadas + s.semJustificativa)
    const [, mes, dia] = s.inicio.split('-')
    return {
      inicio: s.inicio,
      x: xFaixa + (coluna - larguraBarra) / 2,
      largura: larguraBarra,
      xFaixa,
      larguraFaixa: coluna,
      yJustificadas: yJ,
      alturaJustificadas: basePlot - yJ,
      ySem: yS,
      alturaSem: yJ - yS,
      rotulo: i % passoRotulo === 0 ? `${dia}/${mes}` : null,
      centro: xFaixa + coluna / 2,
    }
  })

  return {
    largura,
    altura: ALTURA_GRAFICO,
    esquerda,
    topoPlot: TOPO,
    basePlot,
    direita: largura - DIREITA,
    marcas: marcas.map((valor) => ({ valor, y: y(valor) })),
    barras,
  }
}
```

- [ ] **Passo 4: verde da geometria**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts
```

Esperado: 11 testes passam.

- [ ] **Passo 5: testes dos gráficos e do clique → URL**

`src/app/(app)/recebimento/dashboard/__tests__/graficos-dashboard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GraficoSemanas, PositivasNegativas, RankingFornecedores } from '../graficos-dashboard'

describe('ranking por fornecedor', () => {
  const fornecedores = [
    { fornecedor: 'Panasonic', divergentes: 2, itens: 3 },
    { fornecedor: 'Fornecedora Internacional de Componentes Eletrônicos e Passivos Ltda.', divergentes: 2, itens: 4 },
    { fornecedor: '', divergentes: 1, itens: 1 },
  ]
  it('cada barra mostra os divergentes e "x% dos itens dele"', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Panasonic/ })).toHaveTextContent('66,7% dos itens dele')
  })
  it('clicar aplica o filtro do fornecedor', () => {
    const onClique = vi.fn()
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={onClique} />)
    fireEvent.click(screen.getByRole('button', { name: /Panasonic/ }))
    expect(onClique).toHaveBeenCalledWith('Panasonic')
  })
  it('fornecedor em branco aparece como "(sem fornecedor)" e não é clicável', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    const semFornecedor = screen.getByText('(sem fornecedor)')
    expect(semFornecedor.closest('button')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
  it('nome longo corta com reticências e guarda o nome inteiro no title', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    const nome = screen.getByText(/^Fornecedora Internacional/)
    expect(nome).toHaveClass('truncate')
    expect(nome).toHaveAttribute('title', fornecedores[1]!.fornecedor)
  })
  it('o filtrado fica marcado', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="Panasonic" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Panasonic/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('vazio: mensagem, sem barra', () => {
    render(<RankingFornecedores fornecedores={[]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum fornecedor com item divergente neste recorte.')).toBeInTheDocument()
  })
})

describe('divergências por semana', () => {
  const semanas = [
    { inicio: '2026-09-07', justificadas: 1, semJustificativa: 1 },
    { inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 },
    { inicio: '2026-09-21', justificadas: 1, semJustificativa: 3 },
  ]
  it('uma coluna clicável por semana, inclusive a vazia', () => {
    render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
  it('a semana vazia não desenha barra; as outras empilham as duas séries', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    const colunas = container.querySelectorAll('g[role="button"]')
    expect(colunas[1]!.querySelectorAll('rect[data-serie]')).toHaveLength(0)
    expect(colunas[2]!.querySelectorAll('rect[data-serie]')).toHaveLength(2)
  })
  it('todo retângulo tem cor explícita (classe de fill)', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    for (const r of container.querySelectorAll('rect')) expect(r.getAttribute('class') ?? '').toMatch(/fill-/)
  })
  it('clique e Enter filtram pela semana', () => {
    const onClique = vi.fn()
    render(<GraficoSemanas semanas={semanas} ativo="" onClique={onClique} />)
    fireEvent.click(screen.getByRole('button', { name: /Semana de 07\/09\/2026 a 13\/09\/2026/ }))
    expect(onClique).toHaveBeenLastCalledWith('2026-09-07')
    fireEvent.keyDown(screen.getByRole('button', { name: /Semana de 21\/09\/2026/ }), { key: 'Enter' })
    expect(onClique).toHaveBeenLastCalledWith('2026-09-21')
  })
  it('uma semana só: uma coluna', () => {
    render(<GraficoSemanas semanas={[semanas[2]!]} ativo="2026-09-21" onClique={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
  it('nenhuma divergência: mensagem no lugar do gráfico', () => {
    render(<GraficoSemanas semanas={[semanas[1]!]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item divergente neste recorte.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('sem semana nenhuma (recorte sem datas): mensagem', () => {
    render(<GraficoSemanas semanas={[]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item com data de chegada neste recorte.')).toBeInTheDocument()
  })
})

describe('positivas × negativas', () => {
  it('duas barras com número e porcentagem; clique aplica o sinal', () => {
    const onClique = vi.fn()
    render(<PositivasNegativas positivas={3} negativas={1} ativo="" onClique={onClique} />)
    expect(screen.getByRole('button', { name: /Positivas/ })).toHaveTextContent('75%')
    fireEvent.click(screen.getByRole('button', { name: /Negativas/ }))
    expect(onClique).toHaveBeenCalledWith('negativa')
  })
  it('o sinal filtrado fica marcado', () => {
    render(<PositivasNegativas positivas={3} negativas={1} ativo="positiva" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Positivas/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('nenhuma divergência: mensagem', () => {
    render(<PositivasNegativas positivas={0} negativas={0} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item divergente neste recorte.')).toBeInTheDocument()
  })
})
```

`src/app/(app)/recebimento/dashboard/__tests__/dashboard-recebimento.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

import { DashboardRecebimento } from '../dashboard-recebimento'
import { FILTROS_LIMPOS, type DadosDashboard } from '@/modules/recebimento/domain/dashboard'

const NOVENTA = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }
const DADOS: DadosDashboard = {
  totais: { itens: 9, comDivergencia: 6, semJustificativa: 4, positivas: 3, negativas: 3, embs: 4, foraDoRecortePorData: 1 },
  fornecedores: [
    { fornecedor: 'Panasonic', divergentes: 2, itens: 3 },
    { fornecedor: 'Vishay', divergentes: 2, itens: 4 },
  ],
  semanas: [
    { inicio: '2026-09-07', justificadas: 1, semJustificativa: 1 },
    { inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 },
  ],
}
const OPCOES = { fornecedores: ['Panasonic', 'Vishay'], compradores: [] }

beforeEach(() => {
  push.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('clicar num gráfico aplica o filtro e a tela inteira recalcula (pela URL)', () => {
  it('barra de fornecedor', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Vishay/ }))
    // O recorte padrão não vai para a URL.
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?fornecedor=Vishay')
  })
  it('semana', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /Semana de 07\/09\/2026/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?de=2026-09-07&ate=2026-09-13')
  })
  it('positivas / negativas', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Negativas/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?sinal=negativa')
  })
  it('Limpar filtros leva para "sem recorte nenhum"', () => {
    render(<DashboardRecebimento filtros={{ ...NOVENTA, fornecedor: 'Vishay' }} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?periodo=tudo')
  })
  it('a semana filtrada fica marcada no gráfico', () => {
    render(<DashboardRecebimento filtros={{ ...FILTROS_LIMPOS, de: '2026-09-07', ate: '2026-09-13' }} dados={DADOS} opcoes={OPCOES} erro={null} />)
    expect(screen.getByRole('button', { name: /Semana de 07\/09\/2026/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Passo 6: rodar e ver falhar**

```bash
npx vitest run --maxWorkers=2 "src/app/(app)/recebimento/dashboard/__tests__/graficos-dashboard.test.tsx" "src/app/(app)/recebimento/dashboard/__tests__/dashboard-recebimento.test.tsx"
```

Esperado: FAIL — `Failed to resolve import "../graficos-dashboard"`; e, em `dashboard-recebimento.test.tsx`, `Unable to find an accessible element with the role "button" and name /^Vishay/` (os gráficos ainda não estão na tela).

- [ ] **Passo 7: os gráficos**

`src/app/(app)/recebimento/dashboard/graficos-dashboard.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  diaBr,
  fimDaSemana,
  formatarNumero,
  formatarPercentual,
  percentual,
  rotuloFornecedor,
  type FornecedorDashboard,
  type SemanaDashboard,
  type Sinal,
} from '@/modules/recebimento/domain/dashboard'
import { geometriaSemanas } from '@/modules/recebimento/domain/dashboard-grafico'
import { Explica } from './explica'

// Cores das MARCAS (barras). Cada uma tem par claro/escuro; texto nunca usa estas cores — número e
// rótulo ficam na cor de texto do tema, e a identidade vem da barra ao lado.
//   sem justificativa / divergentes: o vinho da marca (o mesmo do dashboard do ShopFloor).
//   justificadas: ardósia — neutra, "resolvido", recua atrás do vinho na pilha.
//   positivas (a mais) × negativas (a menos): âmbar × azul, luminosidades diferentes entre si.
const COR_SEM = 'bg-[#8D2033] dark:bg-[#d2566c]'
const COR_SEM_SVG = 'fill-[#8D2033] dark:fill-[#d2566c]'
const COR_JUST = 'bg-[#64748b] dark:bg-[#94a3b8]'
const COR_JUST_SVG = 'fill-[#64748b] dark:fill-[#94a3b8]'
const COR_POSITIVA = 'bg-[#b45309] dark:bg-[#f59e0b]'
const COR_NEGATIVA = 'bg-[#1d4ed8] dark:bg-[#60a5fa]'

/** Linha clicável de um gráfico de barras horizontais: a linha inteira é o alvo. */
const LINHA = 'grid w-full grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 rounded px-1 py-0.5 text-left text-sm'
const LINHA_CLICAVEL = 'hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring'
const LINHA_ATIVA = 'bg-enterplak/10 dark:bg-enterplak/25'

/** Cartão de um gráfico: título, ⓘ e (opcional) a legenda à direita. */
export function CartaoGrafico({ titulo, explica, acao, children }: {
  titulo: string; explica: string; acao?: ReactNode; children: ReactNode
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex min-w-0 flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{titulo}</p>
            <Explica texto={explica} />
          </div>
          {acao}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function LegendaSemanas() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <li className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${COR_JUST}`} aria-hidden />Justificadas</li>
      <li className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${COR_SEM}`} aria-hidden />Sem justificativa</li>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 1. Ranking por fornecedor — barras horizontais em HTML (escala: divergentes ÷ o maior).
// ---------------------------------------------------------------------------

export function RankingFornecedores({ fornecedores, ativo, onClique }: {
  fornecedores: FornecedorDashboard[]
  /** Fornecedor do filtro aplicado ('' = nenhum): a barra dele fica marcada. */
  ativo: string
  onClique: (fornecedor: string) => void
}) {
  if (fornecedores.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum fornecedor com item divergente neste recorte.</p>
  }
  const maior = Math.max(...fornecedores.map((f) => f.divergentes))
  return (
    <ul className="flex flex-col gap-0.5">
      {fornecedores.map((f) => {
        const nome = rotuloFornecedor(f.fornecedor)
        const pct = formatarPercentual(percentual(f.divergentes, f.itens))
        const emBranco = f.fornecedor === ''
        const estaAtivo = !emBranco && ativo === f.fornecedor
        const conteudo = (
          <>
            {/* Nome longo corta com reticências; o nome inteiro fica no title. */}
            <span className={`truncate ${emBranco ? 'italic text-muted-foreground' : 'text-foreground'}`} title={nome}>{nome}</span>
            <div className="h-3.5 min-w-0">
              <div className={`h-full rounded-r-[4px] ${COR_SEM}`} style={{ width: `max(2px, ${(f.divergentes / maior) * 100}%)` }} />
            </div>
            <span className="flex flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:gap-1.5">
              <span className="tabular-nums font-medium text-foreground">{formatarNumero(f.divergentes)}</span>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{pct} dos itens dele</span>
            </span>
          </>
        )
        const dica = `${nome}: ${formatarNumero(f.divergentes)} de ${formatarNumero(f.itens)} itens com divergência (${pct})`
        return (
          <li key={f.fornecedor || '__sem__'}>
            {emBranco ? (
              // Texto vazio, no banco, é "sem filtro": fornecedor em branco não tem como virar filtro.
              <div className={LINHA} title={`${dica} — fornecedor em branco não filtra`}>{conteudo}</div>
            ) : (
              <button type="button" onClick={() => onClique(f.fornecedor)} aria-pressed={estaAtivo}
                title={`${dica} — clique para filtrar`}
                className={`${LINHA} ${LINHA_CLICAVEL} ${estaAtivo ? LINHA_ATIVA : ''}`}>
                {conteudo}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 2. Divergências por semana — SVG à mão, UMA escala (dashboard-grafico.ts).
// ---------------------------------------------------------------------------

/** Largura real do container, para desenhar 1:1 com pixels. Sem ResizeObserver (testes): 640. */
function useLarguraContainer(padrao = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(padrao)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entradas) => {
      for (const e of entradas) setLargura(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, largura] as const
}

export function GraficoSemanas({ semanas, ativo, onClique }: {
  semanas: SemanaDashboard[]
  /** Segunda-feira da semana que está filtrada ('' = nenhuma). */
  ativo: string
  onClique: (inicio: string) => void
}) {
  const [ref, largura] = useLarguraContainer()
  const total = semanas.reduce((n, s) => n + s.justificadas + s.semJustificativa, 0)

  // O div medido existe SEMPRE: o ResizeObserver é ligado uma vez só, na montagem.
  let corpo: ReactNode
  if (semanas.length === 0) {
    corpo = <p className="text-sm text-muted-foreground">Nenhum item com data de chegada neste recorte.</p>
  } else if (total === 0) {
    corpo = <p className="text-sm text-muted-foreground">Nenhum item divergente neste recorte.</p>
  } else {
    const g = geometriaSemanas(semanas, largura)
    corpo = (
      // h-auto + max-w-full: num container menor que 280 px o SVG encolhe junto (viewBox), em vez
      // de criar rolagem horizontal na página.
      <svg width={g.largura} height={g.altura} viewBox={`0 0 ${g.largura} ${g.altura}`}
        className="block h-auto max-w-full" role="group" aria-label="Itens divergentes por semana de chegada">
        {g.marcas.map((m) => (
          <g key={m.valor}>
            <line x1={g.esquerda} x2={g.direita} y1={m.y} y2={m.y} className="stroke-border" strokeWidth={1} />
            <text x={g.esquerda - 6} y={m.y} textAnchor="end" dominantBaseline="middle"
              className="fill-muted-foreground" style={{ fontSize: 11 }}>{formatarNumero(m.valor)}</text>
          </g>
        ))}
        {g.barras.map((b, i) => {
          const s = semanas[i]!
          const estaAtivo = ativo === b.inicio
          const titulo = `Semana de ${diaBr(b.inicio)} a ${diaBr(fimDaSemana(b.inicio))}: ` +
            `${formatarNumero(s.justificadas)} justificada(s), ${formatarNumero(s.semJustificativa)} sem justificativa — ` +
            'clique para filtrar por esta semana'
          const aoTeclar = (e: KeyboardEvent<SVGGElement>) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClique(b.inicio) }
          }
          return (
            <g key={b.inicio} role="button" tabIndex={0} aria-label={titulo} aria-pressed={estaAtivo}
              onClick={() => onClique(b.inicio)} onKeyDown={aoTeclar}
              className="group cursor-pointer outline-none">
              <title>{titulo}</title>
              {/* A coluna inteira é o alvo do clique — fill explícito (transparente), senão o
                  navegador não entrega o clique na área vazia. */}
              <rect x={b.xFaixa} y={g.topoPlot} width={b.larguraFaixa} height={g.basePlot - g.topoPlot}
                className={estaAtivo ? 'fill-enterplak/10' : 'fill-transparent group-hover:fill-muted/60 group-focus-visible:fill-muted'} />
              {b.alturaJustificadas > 0 && (
                <rect data-serie="justificadas" x={b.x} y={b.yJustificadas} width={b.largura} height={b.alturaJustificadas} className={COR_JUST_SVG} />
              )}
              {b.alturaSem > 0 && (
                <rect data-serie="sem-justificativa" x={b.x} y={b.ySem} width={b.largura} height={b.alturaSem} className={COR_SEM_SVG} />
              )}
              {b.rotulo && (
                <text x={b.centro} y={g.altura - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{b.rotulo}</text>
              )}
            </g>
          )
        })}
        <line x1={g.esquerda} x2={g.direita} y1={g.basePlot} y2={g.basePlot} className="stroke-muted-foreground/60" strokeWidth={1} />
      </svg>
    )
  }

  return <div ref={ref} className="w-full min-w-0">{corpo}</div>
}

// ---------------------------------------------------------------------------
// 3. Positivas × negativas — duas barras horizontais em HTML, mesma escala (÷ a maior das duas).
// ---------------------------------------------------------------------------

export function PositivasNegativas({ positivas, negativas, ativo, onClique }: {
  positivas: number
  negativas: number
  ativo: Sinal | ''
  onClique: (sinal: Sinal) => void
}) {
  const total = positivas + negativas
  if (total === 0) return <p className="text-sm text-muted-foreground">Nenhum item divergente neste recorte.</p>
  const maior = Math.max(positivas, negativas)
  const linhas: { sinal: Sinal; rotulo: string; valor: number; cor: string }[] = [
    { sinal: 'positiva', rotulo: 'Positivas (a mais)', valor: positivas, cor: COR_POSITIVA },
    { sinal: 'negativa', rotulo: 'Negativas (a menos)', valor: negativas, cor: COR_NEGATIVA },
  ]
  return (
    <ul className="flex flex-col gap-1">
      {linhas.map((l) => {
        const estaAtivo = ativo === l.sinal
        const pct = formatarPercentual(percentual(l.valor, total))
        return (
          <li key={l.sinal}>
            <button type="button" onClick={() => onClique(l.sinal)} aria-pressed={estaAtivo}
              title={`${l.rotulo}: ${formatarNumero(l.valor)} (${pct} das divergentes) — clique para ver só estas`}
              className={`${LINHA} ${LINHA_CLICAVEL} ${estaAtivo ? LINHA_ATIVA : ''}`}>
              <span className="truncate text-foreground">{l.rotulo}</span>
              <div className="h-3.5 min-w-0">
                {/* Zero não ganha o mínimo de 2 px: barra de zero é barra nenhuma. */}
                {l.valor > 0 && (
                  <div className={`h-full rounded-r-[4px] ${l.cor}`} style={{ width: `max(2px, ${(l.valor / maior) * 100}%)` }} />
                )}
              </div>
              <span className="flex flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:gap-1.5">
                <span className="tabular-nums font-medium text-foreground">{formatarNumero(l.valor)}</span>
                <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{pct}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Passo 8: ligar os gráficos no orquestrador — três trocas exatas em `dashboard-recebimento.tsx`**

8a. Troque:

```tsx
import {
  urlDosFiltros,
  type DadosDashboard,
```

por:

```tsx
import {
  aplicarClique,
  fimDaSemana,
  urlDosFiltros,
  EXPLICA,
  type DadosDashboard,
```

8b. Troque:

```tsx
import { FiltrosDashboardBarra } from './filtros-dashboard'
```

por:

```tsx
import { FiltrosDashboardBarra } from './filtros-dashboard'
import {
  CartaoGrafico,
  GraficoSemanas,
  LegendaSemanas,
  PositivasNegativas,
  RankingFornecedores,
} from './graficos-dashboard'
```

8c. Troque a linha-marcador:

```tsx
          {/* Os três gráficos entram aqui (Task 5). */}
```

por:

```tsx
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <CartaoGrafico titulo="Ranking por fornecedor" explica={EXPLICA.fornecedores}>
              <RankingFornecedores fornecedores={dados.fornecedores} ativo={filtros.fornecedor}
                onClique={(fornecedor) => navegar(aplicarClique(filtros, { fornecedor }))} />
            </CartaoGrafico>
            <CartaoGrafico titulo="Positivas × negativas" explica={EXPLICA.sinal}>
              <PositivasNegativas positivas={dados.totais.positivas} negativas={dados.totais.negativas}
                ativo={filtros.sinal} onClique={(sinal) => navegar(aplicarClique(filtros, { sinal }))} />
            </CartaoGrafico>
          </div>
          <CartaoGrafico titulo="Divergências por semana" explica={EXPLICA.semanas} acao={<LegendaSemanas />}>
            <GraficoSemanas semanas={dados.semanas}
              ativo={filtros.de !== '' && filtros.ate === fimDaSemana(filtros.de) ? filtros.de : ''}
              onClique={(semana) => navegar(aplicarClique(filtros, { semana }))} />
          </CartaoGrafico>
```

- [ ] **Passo 9: rodar e ver passar; tipos e lint**

```bash
npx vitest run --maxWorkers=2 src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts "src/app/(app)/recebimento/dashboard"
npx tsc --noEmit -p .
npx eslint "src/app/(app)/recebimento/dashboard" src/modules/recebimento/domain/dashboard-grafico.ts src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts
```

Esperado: 5 arquivos passam (geometria 11, gráficos 16, clique → URL 5, página 6, filtros/cartões 9); `tsc` e `eslint` sem saída.

- [ ] **Passo 10: commit**

```bash
git add src/modules/recebimento/domain/dashboard-grafico.ts src/modules/recebimento/domain/__tests__/dashboard-grafico.test.ts "src/app/(app)/recebimento/dashboard/graficos-dashboard.tsx" "src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx" "src/app/(app)/recebimento/dashboard/__tests__/graficos-dashboard.test.tsx" "src/app/(app)/recebimento/dashboard/__tests__/dashboard-recebimento.test.tsx"
git commit -m "$(cat <<'EOF'
recebimento: os tres graficos do dashboard e o clique que filtra a tela

Ranking dos 10 fornecedores, divergencias por semana (SVG, uma escala so para barras, grade e
rotulos; semana vazia com altura zero) e positivas x negativas. Clicar numa barra, semana ou
sinal aplica o filtro pela URL e a tela inteira recalcula.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verificação final (`next build`) + notas de deploy

**Arquivos:** nenhum novo. Só muda a 0152 se a medição do Dev (passo 5) mandar o índice entrar.

**Interfaces — consome:** tudo das Tasks 1–5.

**Leia antes (AGENTS.md):** `node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`.

- [ ] **Passo 1: a suíte inteira, os tipos e o lint**

```bash
npx vitest run --maxWorkers=2
npx tsc --noEmit -p .
npx eslint
```

Esperado: todos os arquivos de teste passam (os novos e os que já existiam); `tsc` e `eslint` sem erro.

- [ ] **Passo 2: o harness SQL de novo**

```bash
bash supabase/tests/rodar-recebimento-test.sh 2>&1 | tail -3
```

Esperado: ` RECEBIMENTO DASHBOARD OK`.

- [ ] **Passo 3: `next build`**

O `node_modules` desta worktree é uma cópia de verdade (hard links), então o build roda. As três variáveis são fictícias, só para o `env.ts` carregar — **não** leia `.env*`.

```bash
NODE_OPTIONS="--max-old-space-size=4096" \
NEXT_PUBLIC_SUPABASE_URL=https://exemplo.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=chave-anon-ficticia \
SUPABASE_SERVICE_ROLE_KEY=chave-service-ficticia \
npx next build 2>&1 | grep -E "Compiled|recebimento/dashboard|Error|Failed"
```

Esperado: `✓ Compiled successfully` e a rota `├ ƒ /recebimento/dashboard` (dinâmica). Nenhum `Error`/`Failed`. Um erro do tipo *"Only async functions are allowed to be exported in a 'use server' file"* ou *"You're importing a component that needs useState"* indica quebra das regras das Global Constraints — corrija na tarefa de origem.

- [ ] **Passo 4: deixar a worktree limpa**

```bash
git status --short
```

Esperado: nada (o `.next/` é ignorado pelo git).

- [ ] **Passo 5: notas de deploy — entregar ao usuário no relatório final (você NÃO roda nada disto)**

Copie este bloco para o relatório:

> **Ordem de deploy da 0152**
> 1. **Antes de tudo, a contagem só de leitura** — no SQL Editor do Dev e no do Prod (Studio da AWS, ou `psql` no RDS). Diga os números ao usuário antes de a 0152 chegar ao Prod:
>    ```sql
>    select count(*) as so_espacos,
>           count(*) filter (where divergencia_num <> 0 and status <> 'cancelado') as so_espacos_em_divergentes,
>           (select count(*) from public.processos_recebimento
>             where btrim(divergencia_justificativa) <> ''
>               and regexp_replace(divergencia_justificativa, '\s', '', 'g') = '') as so_tab_ou_quebra_de_linha
>      from public.processos_recebimento
>     where divergencia_justificativa <> ''
>       and btrim(divergencia_justificativa) = '';
>    ```
>    `so_espacos` = linhas que a normalização vai tocar (passam de "justificada" para "pendente" no SQL — é o que a tela já mostrava). `so_tab_ou_quebra_de_linha` = linhas que o `btrim` **não** apara (ver "Achado" abaixo); é só informação.
> 2. **0152 no Dev** (SQL Editor: cola o arquivo inteiro). A 0152 não depende da 0149–0151 (outra branch): pode entrar antes delas.
> 3. **Medição no Dev com dados reais e `set role`** — três rodadas (cada bloco é UMA execução do SQL Editor; o `set local` vale até o fim daquela execução):
>    ```sql
>    select count(*) as linhas,
>           count(*) filter (where data_chegada >= current_date - 89) as ultimos_90_dias
>      from public.processos_recebimento;
>    ```
>    ```sql
>    select set_config('request.jwt.claims',
>             json_build_object('role', 'authenticated', 'sub',
>               (select u.id from public.usuarios u
>                 where u.ativo and public.usuario_tem_permissao(u.id, 'recebimento', 'visualizar')
>                 order by u.id limit 1))::text, true);
>    set local role authenticated;
>    explain (analyze, buffers) select public.rec_dashboard(p_de => current_date - 89, p_ate => current_date);
>    ```
>    Mesma regra da Task 1: mediana dos três `Execution Time` ≤ 150 ms → sem índice. Acima disso, criar no Dev `create index if not exists processos_recebimento_data_chegada_idx on public.processos_recebimento (data_chegada);`, medir de novo; se cair ≥ 30%, o índice entra na 0152 (o bloco "índice" do passo 13 da Task 1, harness de novo, commit) e fica no Dev; se não cair, `drop index public.processos_recebimento_data_chegada_idx;` e segue sem.
> 4. **Smoke no Dev** (cópia dos dados reais), em 360 px de largura e no desktop, claro e escuro:
>    - o item "Dashboard" aparece entre Fluxo e Registros só para quem tem `recebimento.visualizar`;
>    - abre com os últimos 90 dias preenchidos e a etiqueta "Chegada: …";
>    - **3 números contra a grade de Processos no mesmo recorte**: "Com divergência" × filtro rápido "Divergências"; "Positivas"/"Negativas" (no gráfico) × filtros "positivas"/"negativas". ⚠️ Enquanto a `feat/recebimento-filtros-divergencia` não estiver na `main`, a grade ainda **conta processos cancelados** e o dashboard não: se os números diferirem, conte os cancelados divergentes do recorte e confira que a diferença é exatamente essa;
>    - clicar numa barra de fornecedor, numa semana e em Negativas filtra a tela inteira e vira etiqueta; tirar a etiqueta desfaz; "Limpar filtros" tira tudo (inclusive o período);
>    - copiar a URL filtrada e abrir em outra aba reproduz a tela;
>    - nenhuma rolagem horizontal da página em 360 px; nome de fornecedor longo corta com reticências.
> 5. **0152 no Prod ANTES do deploy do app** (RDS: `PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W` com a conexão do RDS, `-1 -v ON_ERROR_STOP=1 -f supabase/migrations/0152_rec_dashboard.sql`). App novo contra banco velho não quebra a rota (a página degrada para o aviso), mas o menu já mostraria o item.
> 6. Deploy do app.

> **Verificações no Prod antes do merge (consultas só de leitura, para o usuário rodar)**
> Cada bloco abaixo cola e roda como está no SQL Editor (Studio da AWS ou `psql` no RDS); nenhum altera dado. Diga os resultados antes do merge.
> - **(i) Existe processo "cancelado"?** A regra do dashboard (e do ramo dos filtros) é `status <> 'cancelado'`, literal. Desde a migração 0015 o status é dinâmico e nada em `src/` grava `'cancelado'` hoje:
>   ```sql
>   select status, count(*) from public.processos_recebimento group by 1 order by 2 desc;
>   ```
>   Se NÃO aparecer nenhuma variante de "cancelado": a regra não exclui nada hoje e é inofensiva. Se aparecer qualquer variante (maiúscula, minúscula, com espaço nas pontas, "Cancelado"…): a regra tem que virar `lower(btrim(status)) <> 'cancelado'` nos DOIS lugares — no dashboard (0152) e no ramo dos filtros (`feat/recebimento-filtros-divergencia`) — antes do merge.
> - **(ii) Fornecedor ou comprador com espaço/tab/quebra de linha nas pontas?** A 0152 agora apara com `rec_norm_texto` (igual ao `trim()` do app), então isto é só para dimensionar o efeito: quantas linhas vão passar a agrupar junto com a versão limpa.
>   ```sql
>   select count(*) filter (where fornecedor ~ '^\s|\s$') as fornecedor_com_pontas,
>          count(*) filter (where comprador ~ '^\s|\s$') as comprador_com_pontas
>     from public.processos_recebimento;
>   ```
>   Zero: nada muda. Maior que zero: no ranking e nas listas essas linhas se juntam ao fornecedor/comprador limpo (era um nome duplicado na lista); nenhuma ação necessária.
> - **(iii) Datas de chegada sujas?** A tela só aceita datas de 2000 a 2100 na URL e a série semanal mostra no máximo as últimas 520 semanas do recorte:
>   ```sql
>   select min(data_chegada) as primeira, max(data_chegada) as ultima, count(*) as linhas,
>          count(*) filter (where data_chegada < date '2000-01-01' or data_chegada > date '2100-12-31') as fora_de_2000_2100
>     from public.processos_recebimento;
>   ```
>   `fora_de_2000_2100` = zero: nada a fazer. Maior que zero: são datas digitadas/importadas erradas (serial 0 do Excel = 1899, ano com typo); contam nos totais e no ranking, ficam fora do gráfico semanal quando passam do teto, e valem uma limpeza de dados pelo usuário.
> - **(iv) Justificativas só de espaços** (a normalização da 0152 as muda): é a consulta do item 1 de "Ordem de deploy da 0152", acima.
> - **No smoke**, compare "Com divergência × Divergências" usando **meses inteiros** no dashboard (de dia 1 a último dia do mês): a grade filtra a data só por mês inteiro, então um recorte de dias soltos não é comparável.

- [ ] **Passo 6: relatório**

Diga: a decisão do índice e os números (Task 1, passo 12), o resultado do `next build`, e cole o bloco do passo 5.

---

## Autorrevisão

### Cobertura da spec

| Requisito da spec | Onde |
|---|---|
| §1 tela de leitura; quem tem `recebimento.visualizar` vê; ninguém edita | Task 4 (gate na página + layout do Recebimento já redireciona); Task 1 (porta `visualizar` nas duas funções) |
| §2 item "Dashboard" entre Fluxo e Registros, `/recebimento/dashboard`, ícone de gráfico, `recebimento.visualizar`, em `app-shell.tsx` | Task 3, passo 4 + teste do menu |
| §3 unidade = item; contado por `data_chegada` | Task 1 (`recorte` filtra `data_chegada`; série por `data_chegada`) |
| §3 Itens = `status <> 'cancelado'` | Task 1 (`base`); testes 1/2/3; sabotagem S3 |
| §3 Com divergência = `divergencia_num <> 0` | Task 1; testes 1/2/3; sabotagem S4 |
| §3 Sem justificativa = com divergência e `btrim(...) = ''` | Task 1 (`sem_texto`); testes 1/2/4 |
| §3 Positiva / negativa pelo sinal | Task 1; testes 1/2/3 |
| §3 bate com o filtro "Divergências" da grade (comparado contra a CONDIÇÃO, §10) | Task 1, teste 3 (contra `divergencia_num <> 0 / > 0 / < 0 and status <> 'cancelado'`); Task 6 smoke |
| §3 sem `data_chegada` fora do recorte por data e contada no rodapé | Task 1 (`fora_do_recorte_por_data`; teste 2; S7); Task 2 (`textoRodape`) |
| §3 `divergencia_num` nulo conta em Itens e nunca em divergência | Task 1 (`coalesce(..., false)`; linhas 106/107 da massa; S5) |
| §3 ⓘ em cada número com a definição | Task 2 (`EXPLICA`); Task 4 (`Explica` nos três cartões + rodapé; teste) ; Task 5 (ⓘ dos gráficos) |
| §3 rodapé "137 de 1.284 itens (10,7%) em 42 EMBs", sempre visível | Task 2 (`textoRodape`, teste com o texto literal); Task 4 (`CartoesDashboard`) |
| §3 porcentagem não arredonda para 100 | Task 2 (`percentual`, testes 9.999/10.000); Task 4 (teste "99,9% dos itens") |
| §4 filtros Fornecedor · Comprador · EMB · Código · De · Até · Limpar | Task 4 (`FiltrosDashboardBarra`) |
| §4 Fornecedor/Comprador = lista com os distintos, comparação exata | Task 1 (`rec_dashboard_opcoes`; teste 8; teste 6 "ACME"/"Acme"); Task 4 (`CampoLista`) |
| §4 EMB/Código exatos sem diferenciar maiúsculas | Task 1 (`upper(btrim)`; teste 6) |
| §4 De/Até inclusivos sobre `data_chegada`; padrão 90 dias preenchido e limpável | Task 1 (teste 4 "De = Até"; S10); Task 2 (`janelaPadrao`, `filtrosDaUrl`, `semFiltro('periodo')`); Task 4 (teste "URL vazia: consulta os últimos 90 dias") |
| §4 clique em fornecedor/semana/fatia aplica o filtro e a tela recalcula | Task 2 (`aplicarClique`); Task 5 (gráficos + `dashboard-recebimento.test.tsx`) |
| §4 filtro aplicado vira etiqueta removível; Limpar tira todas | Task 2 (`etiquetasDosFiltros`, `semFiltro`); Task 4 (testes das etiquetas e do Limpar) |
| §5.1 ranking top 10, nº divergentes + "x% dos itens dele", "(sem fornecedor)" | Task 1 (top 10; teste 10; S9); Task 5 (`RankingFornecedores`; testes) |
| §5.2 semanas segunda a domingo, contínuas, vazia com altura zero, empilhadas justificadas × sem | Task 1 (série; teste 4; S6); Task 5 (`geometriaSemanas`, `GraficoSemanas`; testes) |
| §5.3 positivas × negativas | Task 5 (`PositivasNegativas`) + decisão 1 (`p_sinal`) |
| §5 SVG à mão, tokens do tema, claro e escuro | Task 5 (SVG do semanal; cores com par `dark:`; texto de tokens) + decisão 6 |
| §6 0152 aditiva, idempotente, molde da 0124, `$func$`, revoke/grant, porta de 2 argumentos | Task 1 (passos 6–8, runner aplica 2×) |
| §6 `rec_dashboard` tudo numa chamada; texto vazio = sem filtro; datas nulas = sem recorte | Task 1 (teste 1 "texto vazio = sem filtro"); Task 3 (uma chamada no repositório) |
| §6 `rec_dashboard_opcoes` distintos, não vazios, ordenados | Task 1 (teste 8) |
| §6.1 `rec_justificar_divergencia` com `coalesce(btrim(p_texto), '')`, mesma assinatura, sem drop, mantém definer/administrar/grants | Task 1 (função; teste 9.2; teste "grants e security definer"; S1) |
| §6.1 normalização única idempotente | Task 1 (`update`; teste 9.1; S2; 0152 aplicada 2×) |
| §6.1 contar antes do Prod e dizer ao usuário | Task 6, passo 5, item 1 |
| §6 desempenho: medir com `set role` e `EXPLAIN (ANALYZE)` antes de decidir índice | Task 1, passos 12–13 (harness, decide); Task 6, passo 5, item 3 (Dev) |
| §7 domínio, repositório, página servidor com gate, componentes cliente, estado na URL, menu | Tasks 2, 3, 4, 5 |
| §8 SQL: 2×, totais, bate com a grade, cancelado fora, data nula, semana vazia, `SEM_PERMISSAO` para quem só tem ShopFloor, sabotagem | Task 1 (testes 0–10; passo 10) |
| §8 Vitest: `percentual`, 90 dias, filtros ↔ URL, página com gate | Task 2; Task 4 (`page.test.tsx`) |
| §8 smoke no Dev com 3 números contra a grade | Task 6, passo 5, item 4 |
| §9 fora do escopo (exportar, comprador, peças, abrir grade filtrada, alertas) | nada implementado |
| §10.2 cancelado fora; dependência da branch dos filtros | Task 1 (teste 3 contra a condição); Task 6 smoke (aviso) |

### Varredura de placeholders

Nenhum "TBD", "TODO", "semelhante à Task N" ou "tratar erros adequadamente". Os únicos valores que quem executa preenche são **medidos** (os milissegundos e a data no cabeçalho da 0152, Task 1 passo 13), e o texto de exemplo já vem com os números da medição deste plano. O `"<conexão>"` do cabeçalho da 0152 é o mesmo da 0141 (documentação para quem aplica no RDS), não um comando deste plano.

### Consistência de nomes e tipos entre tarefas

- `FiltrosDashboard` / `FILTROS_LIMPOS` / `urlDosFiltros` / `filtrosDaUrl` / `aplicarClique` / `semFiltro` / `etiquetasDosFiltros`: definidos na Task 2, usados com a mesma grafia nas Tasks 3 (teste), 4 e 5.
- jsonb do banco (`com_divergencia`, `sem_justificativa`, `fora_do_recorte_por_data`, `sem_justificativa` das semanas) ↔ camelCase (`comDivergencia`, `semJustificativa`, `foraDoRecortePorData`): a tradução mora só em `carregarDashboard` (Task 3) e é testada.
- Parâmetros do `rpc` (`p_fornecedor`, `p_comprador`, `p_emb`, `p_codigo`, `p_de`, `p_ate`, `p_sinal`) = assinatura da 0152 (Task 1); os grants usam `(text, text, text, text, date, date, text)`.
- `Sinal` = `'positiva' | 'negativa'` no TS = os valores aceitos por `p_sinal` no SQL (`SINAL_INVALIDO` para outro).
- `DashboardRecebimento` (Task 4) é o nome que a Task 5 edita e testa; a linha-marcador da Task 4 é exatamente a `old_string` da troca 8c.
- `Explica` (Task 4) é importado por `graficos-dashboard.tsx` (Task 5) de `./explica`.
- `geometriaSemanas` / `BarraSemana` (Task 5, domínio) são consumidos só por `GraficoSemanas` (Task 5).
- Contagens esperadas dos passos de verificação conferidas contra os arquivos de teste: domínio 29 testes; repositório 4 + menu 2 = 6; página 6 + filtros/cartões 9 = 15; geometria 11; gráficos 16; clique → URL 5.

### Achados na spec (relatados ao usuário)

1. **Assinatura sem o filtro de sinal** — resolvido com `p_sinal` (decisão 1).
2. **"SVG como os do ShopFloor"** — os do dashboard do ShopFloor são HTML/CSS (decisão 6).
3. **`btrim` só apara espaço**, não tab nem quebra de linha. O app apara com `trim()` (todo espaço em branco), então uma justificativa só de `\t`/`\n` gravada por chamada direta continua "justificada" no SQL e "pendente" na tela. Este plano segue a régua literal da spec (`btrim`) e mede quantas linhas existem assim (Task 6, item 1); se o número não for zero, é uma decisão do usuário (`btrim(x, E' \t\r\n')` na 0152 e no dashboard).
4. **"em 42 EMBs" ambíguo** e **"Limpar filtros" × período padrão** — decisões 5 e 3.
