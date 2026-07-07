# Histórico da Sessão — 2026-07-07 — ShopFloor Enterplak (Fundação)

> Registro fiel da conversa e das decisões desta sessão de desenvolvimento.
> Não é o transcript verbatim (indisponível), mas reconstrói a sequência de
> contexto → decisões → design → plano → execução.

---

## 1. Contexto inicial (usuário)

O usuário (gptropa@rwtech.com.br, empresa rwtech) pediu para atuar como Engenheiro
Sênior / Arquiteto / UX / Full Stack e desenvolver, de forma incremental e com boas
práticas (Clean Code, SOLID, componentização, documentação, escalabilidade), um
**sistema profissional de Shop Floor** para uma **indústria de manufatura
eletrônica** (Enterplak). Regra-guia: **preferir a implementação correta à rápida**;
nunca soluções temporárias quando existe arquitetura melhor; sempre explicar decisões
arquiteturais.

Em seguida o usuário forneceu um **spec detalhado** + **mockups** de telas + a **cor
primária** `#8D2033` + a **logo** (`Logo_Docs.png`), descrevendo:
- Sistema web modular; primeiro módulo = **Registro de Recebimento**.
- O Comercial mantém sua planilha Excel; o Recebimento importa (.xlsx/.csv),
  **mapeando manualmente** as colunas (nomes variam) para campos do sistema, com
  pré-visualização, e cada linha vira um **Processo de Recebimento** (status inicial
  "Aberto").
- Ciclo de vida do processo; finalização bloqueia edição (exceto Supervisor/Admin).
- Autenticação Supabase; 4 perfis (Administrador, Supervisor, Recebimento, Consulta)
  com permissões específicas.
- **Logs** de tudo, **imutáveis** (nada pode ser apagado).
- **Listas configuráveis** pelo próprio sistema (Tipo, Resultado, Tipo de Entrega…).
- Módulo futuro de **Geração de Etiquetas** de Part Number (substitui um Apps Script).
- Projeto Supabase já criado, sem tabelas.

---

## 2. Brainstorming — decisões tomadas (uma pergunta por vez)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Stack | **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase** |
| 2 | Hospedagem | **Nuvem — Vercel + Supabase Cloud** |
| 3 | Escopo do 1º spec | **Fundação + Recebimento** (Etiquetas depois) |
| 4 | Cardinalidade | **1 Processo = 1 material** |
| 5 | Ciclo de vida | **Aberto → Em Conferência → Finalizado (+ Cancelado)** |
| 6 | Obrigatoriedade de campos | **Configurável** pelo Admin (não fixa no código) |
| 7 | Tipo de campo (texto/lista) | **Configurável** e extensível a tipos futuros |
| 8 | Identificação do material | **Código + Descrição separados** |

Análise da planilha real (`EMB341EA - ESTADOS UNIDOS.xlsx`): cabeçalhos genéricos
(`Utilização, Tracking, Número, Nome, Código, Descrição, Quantidade, …`) que **não**
coincidem com os nomes internos do Recebimento — **confirma** a necessidade do
mapeamento manual. Lista definitiva: **15 campos do Comercial + 22 do Recebimento**.

Decomposição do sistema em incrementos: **0-Fundação + 1-Recebimento** (este spec) →
**2-Etiquetas** (pendente o Apps Script) → módulos futuros.

---

## 3. Design (spec)

Salvo em `docs/superpowers/specs/2026-07-07-fundacao-recebimento-design.md` e
aprovado pelo usuário. Pontos-chave:
- **Camadas:** `app/` (entrega) · `modules/<feature>/{domain,application,infra}` ·
  domínio em TS puro (sem Supabase/Next) · Server Actions finos.
- **Segurança:** RLS em toda tabela; RBAC por **flags booleanas em `perfis`** lidas
  por funções `SECURITY DEFINER`; 3 clients Supabase (browser/server/service).
- **Logs imutáveis** (RLS + trigger).
- **Listas configuráveis** (`listas`/`lista_itens`).
- **`configuracao_campos`**: metadados por campo (obrigatoriedade, rótulo, ordem,
  origem, e o **tipo** texto↔lista configurável) sem virar form builder dinâmico.
- **Campos de lista** guardam **valor-texto (snapshot)**.
- Importação: parsing no navegador (SheetJS) + gravação atômica por RPC.

---

## 4. Plano de implementação — Plano 1 (Fundação)

Salvo em `docs/superpowers/plans/2026-07-07-fundacao-base.md`. Decomposição em 3
planos sequenciais (Fundação → Configurações & Logs → Recebimento); este é o 1º, com
13 tasks em ciclos TDD. Execução escolhida: **Subagent-Driven Development** (um
subagente implementador por task + revisor + review final).

Ambiente da máquina (Linux Mint 22.3): só `git` presente. Pré-requisitos instalados:
- **Node.js v20.20.2**, **npm 10.8.2** (via apt/nodesource, pelo usuário).
- **Supabase CLI 2.109.1** (pelo usuário).
- Chaves do Supabase preenchidas pelo usuário no `.env.local` (não versionado).

---

## 5. Execução — progresso

| Task | Descrição | Status | Commits / notas |
|---|---|---|---|
| 1 | Scaffold Next.js + TS strict + Tailwind + shadcn + Vitest | ✅ PASS | `1224ced`. Stack real: Next 16, React 19, Tailwind v4 (`@config`), shadcn/Base UI. Minor: `--font-sans` autorreferente (fix 1 linha, p/ review final). |
| 2 | Clients Supabase + env + middleware | ✅ PASS | `3bd2a3d`. `@supabase/ssr` 0.12. Minors (p/ review final): clients não passam por `env.ts` (intencional — evita vazar service_role no bundle client); falta `server-only` em `service.ts`. |
| 3 | `supabase init` + login + link | ✅ | Projeto "Project Shop Floor" (ref `ykwkacfviarhfmxeisqk`, sa-east-1, PG17). Conexão remota OK sem senha. |
| 4–8 | Schema: perfis/usuarios/RBAC, listas, configuracao_campos, importacoes/processos, logs | ✅ PASS (após fix) | `f14f1a3`..`f7dd506`. Review opus **FAIL** → corrigido na migration **0006** (`1d9b925`). |

### Achados da revisão do schema (opus) e correções (migration 0006)
- **C1 (Crítico):** logs deletáveis via `TRUNCATE` (triggers FOR EACH ROW não disparam
  em TRUNCATE; sem REVOKE). → Corrigido: trigger `BEFORE TRUNCATE` de statement +
  `REVOKE TRUNCATE`. Live-tested: TRUNCATE agora levanta exceção.
- **I1 (Importante):** `processos_update` impedia o perfil **Recebimento de finalizar**
  (fluxo central) e `pode_finalizar` não era exigido. → Corrigido: WITH CHECK gateia a
  finalização em `finalizar`; edição de finalizado exige `editar_finalizado`.
- **Minors corrigidos:** log não-forjável (`usuario_id = auth.uid()`);
  `handle_new_user` tolera email nulo; `listas_delete` com guarda `sistema=false`;
  `search_path` nas funções utilitárias.

**Estado do banco (Supabase Cloud):** 8 tabelas com RLS, 4 perfis semeados, 9 listas
base, 38 registros em `configuracao_campos`, logs imutáveis (UPDATE/DELETE/TRUNCATE
bloqueados até para service_role). Migrations 0001–0006 aplicadas.

---

## 6. Próximos passos (pendentes nesta sessão)

- **Task 9:** domínio de perfil/permissões (TS puro, TDD).
- **Task 10:** sessão + mapeamento de perfil.
- **Task 11:** página de login + Server Actions (depende do `.env.local` — já preenchido).
- **Task 12:** layout autenticado (menu lateral por perfil, header, home).
- **Task 13:** doc de bootstrap do primeiro Administrador.
- Depois: review final do branch → Plano 2 (Configurações & Logs) → Plano 3 (Recebimento).

Pendências de ativos: **Google Apps Script atual de etiquetas** (para o Incremento 2).

---

## 7. Artefatos desta sessão

- Spec: `docs/superpowers/specs/2026-07-07-fundacao-recebimento-design.md`
- Plano: `docs/superpowers/plans/2026-07-07-fundacao-base.md`
- Ledger de progresso: `.superpowers/sdd/progress.md`
- Briefs/reports das tasks: `.superpowers/sdd/task-*.md`
- Migrations: `supabase/migrations/0001…0006_*.sql`
- Memória do projeto: `~/.claude/.../memory/projeto-shopfloor.md`, `preferencias-usuario-gptropa.md`
