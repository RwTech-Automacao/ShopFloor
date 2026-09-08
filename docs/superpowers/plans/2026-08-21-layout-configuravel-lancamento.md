# Layout configurável do Lançamento — Plano de Implementação

> **Para quem executa:** SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans, tarefa a tarefa. Passos com checkbox (`- [ ]`).

**Goal:** Admin define, central (vale pra todos), a ORDEM dos painéis da tela de Lançamento
(arrastar pra trocar de lugar); o Lançamento renderiza nessa ordem. Substitui o 2×2 fixo.

**Arquitetura:** config global chave→JSON no banco (nova `sf_config` + RPC gated de admin); o
Lançamento (server component) lê as 2 ordens e passa ao form; o form mapeia painel→slot pela
ordem. Tela de admin em Configurações com arrastar-trocar (HTML5 DnD, sem dependência nova).

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase (Postgres+RLS+RPC) · Vitest.

## Global Constraints (copiar verbatim do spec)

- Spec: `docs/superpowers/specs/2026-08-21-layout-configuravel-lancamento-design.md`.
- **v1 = SÓ reordenar** (sem ocultar; todos os painéis sempre visíveis). **Admin central**
  (um padrão pra todos). Cobre **normal (4 painéis)** e **especiais (2 painéis)**.
- Chaves normal: `peca` · `contexto` · `historico` · `ultimo`. Chaves especiais: `painel` · `contexto`.
- Ordem padrão normal: `["peca","contexto","historico","ultimo"]`; especiais: `["painel","contexto"]`.
- Índice no array = slot (0=topo-esq, 1=topo-dir, 2=base-esq, 3=base-dir; especiais 0=esq,1=dir).
- **Fallback:** sem config/config inválida → ordem padrão (NUNCA quebra).
- **NÃO alterar a automação do bipe** — só a POSIÇÃO dos painéis muda; lógica/handlers/foco/fluxo idênticos.
- ⚠️ **Numeração da migração:** conferir a próxima livre (há gaps 0079/EMB fora do Prod e
  0081/NQA-followup pendente) ANTES de nomear o arquivo. Usar `create table if not exists` /
  `create or replace function` (idempotente).
- Permissão de admin: confirmar a chave usada nas telas de Config do ShopFloor (provável
  `tem_permissao('shopfloor','configurar')`) lendo uma tela de config existente antes do gate.
- Build pesado: `NODE_OPTIONS="--max-old-space-size=6144" npm run build`. Testes: vitest.

---

### Task 1: Domínio — ordem → slots (lógica pura + fallback + validação)

**Files:**
- Create: `src/modules/shopfloor/domain/layout-lancamento.ts`
- Test: `src/modules/shopfloor/domain/__tests__/layout-lancamento.test.ts`

**Interfaces (produz):**
- `type PainelNormal = 'peca' | 'contexto' | 'historico' | 'ultimo'`
- `type PainelEspecial = 'painel' | 'contexto'`
- `const ORDEM_PADRAO_NORMAL: PainelNormal[]` e `ORDEM_PADRAO_ESPECIAIS: PainelEspecial[]`
- `normalizarOrdem<T extends string>(bruto: unknown, padrao: T[]): T[]` — devolve uma permutação
  VÁLIDA (mesmo conjunto de `padrao`, sem faltar/sobrar/repetir); qualquer entrada inválida →
  `padrao`. É o fallback e o backstop do cliente.

- [ ] **Passo 1: teste que falha** — cobrir: (a) ordem válida passa igual; (b) ordem com item
  desconhecido → padrão; (c) ordem incompleta/repetida → padrão; (d) não-array/undefined/null →
  padrão; (e) mesma composição em ordem diferente é aceita (permutação).
- [ ] **Passo 2: rodar e ver falhar.**
- [ ] **Passo 3: implementar** `normalizarOrdem` (checar `Array.isArray`, tamanho igual,
  `new Set` == conjunto do padrão) + as constantes/tipos.
- [ ] **Passo 4: rodar testes (verde).**
- [ ] **Passo 5: commit** `feat(shopfloor): domínio da ordem de painéis do Lançamento`.

### Task 2: Migração — `sf_config` + seed + RPC + RLS

**Files:**
- Create: `supabase/migrations/00XX_sf_config_layout.sql` (⚠️ numerar conforme Global Constraints)

**Conteúdo:**
- `create table if not exists sf_config (chave text primary key, valor jsonb not null,
  atualizado_em timestamptz not null default now(), atualizado_por uuid);`
- Seed idempotente (só se não existir) das 2 linhas com a ordem padrão:
  `insert into sf_config(chave,valor) values
   ('layout_lancamento_normal','{"ordem":["peca","contexto","historico","ultimo"]}'::jsonb),
   ('layout_lancamento_especiais','{"ordem":["painel","contexto"]}'::jsonb)
   on conflict (chave) do nothing;`
- **RLS:** `alter table sf_config enable row level security;`
  - select liberado a `authenticated` (operadores leem): policy `using (true)`.
  - sem policy de insert/update direto (escrita só via RPC definer).
- **RPC** `sf_salvar_layout(p_chave text, p_ordem jsonb)` **SECURITY DEFINER**:
  - gate: `if not tem_permissao('shopfloor','configurar') then raise exception 'SEM_PERMISSAO'; end if;`
    (⚠️ confirmar a chave da permissão — Global Constraints).
  - valida `p_chave in ('layout_lancamento_normal','layout_lancamento_especiais')` senão
    `raise exception 'CHAVE_INVALIDA'`.
  - valida que `p_ordem` é um array JSON cujo conjunto == o esperado pra aquela chave (backstop
    server; ex.: normal = peca/contexto/historico/ultimo) senão `raise exception 'ORDEM_INVALIDA'`.
  - `insert ... on conflict (chave) do update set valor = jsonb_build_object('ordem', p_ordem),
    atualizado_em = now(), atualizado_por = auth.uid();`

- [ ] **Passo 1:** escrever o `.sql`.
- [ ] **Passo 2:** aplicar no **Dev** (`supabase db push`; ⚠️ pode precisar do temp-0079 pelo
  gap do 0079/EMB — ver [[supabase-cli-db-push]] / memória). Conferir seed + RPC criados.
- [ ] **Passo 3: commit** `feat(shopfloor): migração sf_config + RPC sf_salvar_layout`.

### Task 3: Infra — ler/gravar layouts

**Files:**
- Create: `src/modules/shopfloor/infra/config-repository.ts`

**Interfaces (produz):**
- `carregarLayoutsLancamento(): Promise<{ normal: PainelNormal[]; especiais: PainelEspecial[] }>`
  — select das 2 linhas de `sf_config`; passa cada `valor.ordem` por `normalizarOrdem` (fallback).
- `chamarSalvarLayout(chave: string, ordem: string[]): Promise<{ ok: boolean; erro?: string }>`
  — `supabase.rpc('sf_salvar_layout', { p_chave, p_ordem })`; mapeia erros
  (SEM_PERMISSAO/CHAVE_INVALIDA/ORDEM_INVALIDA) pra mensagem amigável.

- [ ] **Passo 1:** implementar as duas funções (server-only; usa `createServerSupabase`).
- [ ] **Passo 2:** `tsc` + lint verdes.
- [ ] **Passo 3: commit** `feat(shopfloor): infra de leitura/escrita do layout`.

### Task 4: Application — action de salvar (gate de sessão)

**Files:**
- Create: `src/modules/shopfloor/application/layout-actions.ts`

**Interfaces (produz):**
- `'use server'`; `salvarLayoutLancamento(chave: string, ordem: string[])` — `getSessao()` +
  `podeNoModulo(sessao.perfil,'shopfloor','configurar')` (confirmar helper existente); normaliza
  a ordem no servidor (`normalizarOrdem`) antes de chamar `chamarSalvarLayout`. Retorno
  `{ ok, erro? }`.

- [ ] **Passo 1:** implementar (espelhar o padrão de outra action de config do módulo).
- [ ] **Passo 2:** `tsc` + lint.
- [ ] **Passo 3: commit** `feat(shopfloor): action salvarLayoutLancamento`.

### Task 5: Lançamento renderiza pela ordem (SEM mudar a automação)

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/page.tsx` (server: `carregarLayoutsLancamento()`
  → passa `layouts` como prop ao form)
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Mudança (só posicionamento):**
- Prop nova `layouts: { normal: PainelNormal[]; especiais: PainelEspecial[] }`.
- Construir um **mapa chave→JSX** com os cards que HOJE já existem (Peça, Contexto, Histórico,
  Último) — extrair cada um pra uma variável/const, SEM tocar em estado/handlers/foco.
- No ramo bipe normal (2×2): percorrer `layouts.normal` e posicionar cada painel no slot pelo
  índice (derivar `lg:col-start`/`lg:row-start` de `idx`: 0→(1,1) 1→(2,1) 2→(1,2) 3→(2,2)); a
  ordem no DOM segue `layouts.normal` (empilhamento no estreito = mesma ordem).
- No ramo especial: percorrer `layouts.especiais` (`painel`/`contexto`) e posicionar em 2 colunas.
- **Fallback:** se a prop vier vazia, usa `ORDEM_PADRAO_*` (o server já normaliza, mas manter o
  default no form por segurança).
- ⚠️ **NADA de lógica muda** — reviewer confere que o diff é só extração dos painéis pra um mapa
  + posicionamento por índice. Bipe/foco/gravação/trava idênticos.

- [ ] **Passo 1:** extrair os 4 painéis (normal) e o par (especiais) pra um mapa; render por índice.
- [ ] **Passo 2:** `page.tsx` busca os layouts e passa a prop.
- [ ] **Passo 3:** `tsc` + lint + **testes existentes verdes** (é layout; sem novo teste de unidade aqui).
- [ ] **Passo 4: commit** `feat(shopfloor): Lançamento renderiza os painéis pela ordem configurada`.

### Task 6: Tela do admin — arrastar-trocar

**Files:**
- Create: `src/app/(app)/shopfloor/configuracoes/layout-lancamento/page.tsx` (server: carrega layouts,
  gate de admin, renderiza o form)
- Create: `src/app/(app)/shopfloor/configuracoes/layout-lancamento/layout-form.tsx` (client)
- Modify: o menu/índice de Configurações do ShopFloor (adicionar o item "Layout do Lançamento",
  visível só p/ quem tem `configurar`) — localizar a lista de configs existente.

**Form (client):**
- Duas seções: "Lançamento (bipe normal)" (4 cards) e "Telas especiais" (2 cards).
- Estado local `ordemNormal` / `ordemEspeciais` (inicializado das props).
- Cada card = `draggable`; `onDragStart` guarda o índice; `onDragOver` `preventDefault`;
  `onDrop` **troca** os dois índices no array (swap). Feedback visual (`aria-grabbed`/classe).
- Cada card mostra rótulo do painel + um mini-ícone (Peça=campo; Contexto=fichinha;
  Histórico=lista; Último=✓; Painel=caixa). Grade 2×2 (normal) / 2-col (especiais) refletindo a ordem.
- Botões: **Salvar** (chama `salvarLayoutLancamento` p/ cada chave alterada; toast ok/erro) e
  **Restaurar padrão** (volta `ORDEM_PADRAO_*` no estado; salva ao confirmar).

- [ ] **Passo 1:** `layout-form.tsx` com o swap por DnD + preview + salvar.
- [ ] **Passo 2:** `page.tsx` (gate admin + carrega layouts) + item no menu de Config.
- [ ] **Passo 3:** `tsc` + lint + build (`NODE_OPTIONS=... npm run build`).
- [ ] **Passo 4: commit** `feat(shopfloor): tela de config Layout do Lançamento (arrastar-trocar)`.

### Task 7: Smoke + review + promoção

- [ ] Smoke no Dev/preview: admin troca painéis → Salvar → recarrega (persiste) → operador vê a
  nova ordem (normal e especial); tablet retrato empilha na ordem; sem config = 2×2 padrão; bipe
  segue automático e a trava da gravação intacta.
- [ ] `/code-review` (usuário dispara — mexe em RPC + render do Lançamento).
- [ ] Promover a migração pro **Prod** (janela de baixo uso) → merge. main + Dev alinhados.

## Self-Review (feito)
- Cobertura do spec: dados (T2) · domínio/fallback (T1) · leitura/escrita (T3/T4) · render por
  ordem (T5) · tela admin (T6) · promoção (T7). ✔
- Sem placeholders de lógica (os `00XX`/nome-de-permissão são verificações explícitas marcadas). ✔
- Tipos consistentes (`PainelNormal`/`PainelEspecial`/`normalizarOrdem` usados igual em T1/T3/T4/T5). ✔
