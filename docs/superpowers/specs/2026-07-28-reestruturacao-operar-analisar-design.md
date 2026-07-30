# Reestruturação das telas do Fluxo — containers Operação/Análise (abas por rota) — Design

> **Data:** 2026-07-28 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** refactor de navegação (não muda o conteúdo das telas). Segue o fluxo Dev × Prod.

## Contexto

No legado (Apps Script), as telas operacionais viviam **juntas num único formulário** com abas no topo
(Lançamento · Integração · Manutenção · Dashboard · Pesquisa); só **Registros** e **Ordem de Produção** eram
separados (eram planilhas). Hoje no web cada uma é uma **rota/item de menu** separado (~8 itens). O usuário
quer aproximar do legado — mas numa versão web organizada.

Decisão (brainstorm 2026-07-28): **agrupar por natureza** em 2 containers com **abas por rota**:
- **Operação** (`lancar`): Lançamento · Integração · Manutenção
- **Análise** (`visualizar`): Dashboard · Pesquisa · Burn-in

Também foi decidido, na "análise de telas redundantes", que a **busca por SN** da Integração e a da Pesquisa
**não são redundantes** (ação de integração × consulta de histórico) → **ficam como estão**.

## Objetivo

Reorganizar as 6 telas operacionais em **2 containers com barra de abas** (rota-based), encolhendo o menu de
~8 para 4 itens, **sem alterar o conteúdo/comportamento das telas**.

## Escopo

**Dentro:**
- Mover as 6 páginas pra sob 2 segmentos novos (`operar`, `analisar`), cada um com `layout.tsx` (guard +
  barra de abas) e `page.tsx` (redirect pra aba default).
- Um componente client de **barra de abas** (aba ativa via `usePathname`).
- Menu (`app-shell.tsx`): 4 itens (Operação · Análise · Registros · Ordens de Produção).
- Mover o **guard** pro layout de cada container (uma vez).
- Atualizar o único link interno afetado (`home/page.tsx`).

**Fora (confirmado):**
- **Conteúdo/lógica das telas** — não muda (só a localização do arquivo + o guard sobe pro layout).
- **Busca por SN** — sem mudança (não-redundante).
- **Registros** e **Ordens de Produção** — ficam onde estão (eram planilhas separadas no legado).
- Página única com abas client (descartada — perde URL/histórico e converteria server→client components).

## Design

### 1. Rotas (mover + 2 layouts + 2 redirects)
```
src/app/(app)/shopfloor/
├── operar/
│   ├── layout.tsx            (guard `lancar` + <AbasFluxo> + children)
│   ├── page.tsx              (redirect → /shopfloor/operar/lancamento)
│   ├── lancamento/           (movida de shopfloor/lancamento)
│   ├── integracao/           (movida de shopfloor/integracao)
│   └── manutencao/           (movida de shopfloor/manutencao)
├── analisar/
│   ├── layout.tsx            (guard `visualizar` + <AbasFluxo> + children)
│   ├── page.tsx              (redirect → /shopfloor/analisar/dashboard)
│   ├── dashboard/            (movida de shopfloor/dashboard)
│   ├── pesquisa/             (movida de shopfloor/pesquisa)
│   └── burn-in/              (movida de shopfloor/burn-in)
├── registros/               (inalterada)
└── ordens/                  (inalterada)
```
- Abas default: **Operação → Lançamento**, **Análise → Dashboard**.
- Os imports das páginas são absolutos (`@/modules/...`); os relativos (`./ordem-form`, etc.) movem junto.

### 2. Layout de container (`operar/layout.tsx`, `analisar/layout.tsx`)
Server component async:
- **Guard uma vez:** `getSessao()` + `podeNoModulo(sessao.perfil, 'shopfloor', '<perm-do-container>')`; se
  não, `<SemPermissao>`.
- Renderiza `<AbasFluxo tabs={...} />` (client) + `{children}`.
- `<perm-do-container>`: `operar` = `lancar`; `analisar` = `visualizar`.

### 3. Barra de abas — `AbasFluxo` (client, reusável)
`src/app/(app)/shopfloor/_abas/abas-fluxo.tsx` (ou similar):
- Props: `tabs: { rotulo: string; href: string }[]`.
- Usa `usePathname()` pra marcar a **aba ativa** (destaque visual, padrão de tabs do projeto/base-ui).
- Cada aba é um `<Link>` (navegação por rota). Como todas as abas de um container têm a **mesma permissão**
  (garantida pelo guard do layout), **não há filtro por aba**.

### 4. Guard sobe pro layout
Cada sub-page hoje faz `getSessao() + podeNoModulo(...) + <SemPermissao>`. Com o guard no layout:
- Remover o **early-return de permissão** das sub-pages (o layout já barra).
- Manter `getSessao()` **apenas** nas sub-pages que usam a sessão pra dados (ex.: `colaborador` default,
  `podeCancelar` na Integração) — sem o `<SemPermissao>`.
- (O acesso direto por URL de um usuário sem permissão cai no guard do layout → `<SemPermissao>`.)

### 5. Menu (`app-shell.tsx`)
No array `SHOPFLOOR`, substituir os 6 itens (lancamento/integracao/manutencao/burn-in/pesquisa/dashboard)
por **2**, mantendo Registros e Ordens:
```
{ chave: 'operar',   rotulo: 'Operação', href: '/shopfloor/operar',   icone: <op>,  modulo: 'shopfloor', perm: 'lancar' }
{ chave: 'analisar', rotulo: 'Análise',  href: '/shopfloor/analisar', icone: <an>,  modulo: 'shopfloor', perm: 'visualizar' }
{ chave: 'registros', ... perm: 'visualizar' }        (inalterado)
{ chave: 'op-ordens', ... perm: 'administrar' }       (inalterado)
```
Ícones: escolher 2 do lucide ainda não usados (ex.: `Factory`/`SlidersHorizontal` p/ Operação;
`ChartColumn` já é do Dashboard — usar outro p/ Análise, ex.: `LineChart`/`BarChart3`). Sem duplicar ícone.
- O "ativo" do menu (`pathname.startsWith('/shopfloor')`) continua valendo; cada item destaca por prefixo
  (`/shopfloor/operar`, `/shopfloor/analisar`, etc.).

### 6. Link interno
`src/app/(app)/home/page.tsx`: `/shopfloor/lancamento` → `/shopfloor/operar/lancamento`.

## Critérios de sucesso
- Menu do Fluxo mostra **4 itens** (Operação, Análise, Registros, Ordens), filtrados por permissão.
- `/shopfloor/operar` abre com a aba **Lançamento**; a barra de abas troca entre Lançamento/Integração/
  Manutenção **sem** recarregar o menu; URL muda por aba (link direto e botão voltar funcionam).
- `/shopfloor/analisar` idem, default **Dashboard** (Dashboard/Pesquisa/Burn-in).
- Cada tela funciona **igual a antes** (conteúdo/ações intactos).
- Usuário só-`visualizar` vê **Análise** mas não **Operação**; acesso direto a uma rota de Operação →
  `<SemPermissao>`.
- Build limpo; a home leva pra `/shopfloor/operar/lancamento`.

## Riscos / considerações
- **URLs mudam** (`/shopfloor/lancamento` → `/shopfloor/operar/lancamento`). É um módulo em **dark launch**
  (sem links externos/bookmarks relevantes); o único link interno (home) é atualizado. Sem necessidade de
  redirects legados.
- **Guard no layout:** confirmar que as sub-pages que usam `sessao` (Integração `podeCancelar`, Lançamento
  `colaborador`) seguem obtendo a sessão. Baixo risco (mudança mecânica).
- Refactor **mecânico** (mover pastas + 2 layouts + 1 componente de abas + menu); nenhuma mudança de
  banco/RLS/domínio.
