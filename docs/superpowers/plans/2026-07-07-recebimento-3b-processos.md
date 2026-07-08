# ShopFloor Enterplak — Plano 3B: Recebimento (Processos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o formulário completo do Processo de Recebimento (dinâmico, de `configuracao_campos`), o ciclo de vida (Aberto→Em Conferência→Finalizado/Cancelado, Reabrir) com auditoria, e busca/filtros na lista.

**Architecture:** Camadas dos planos anteriores. Máquina de estados no domínio (pura, testada); transições como Server Actions finas que checam permissão + validam + logam; RLS como reforço. Formulário renderizado a partir dos metadados de campos.

**Tech Stack:** Next.js 16 App Router + TS strict, Tailwind v4 + shadcn/Base UI, Supabase (Postgres/RLS), Vitest.

## Global Constraints

- pt-BR; TS strict (sem `any`); cor `enterplak`.
- Permissões por transição: editar=`editar`; finalizar=`finalizar`; cancelar=`excluir`; reabrir/editar-finalizado=`editar_finalizado`; ver=`visualizar`.
- Aberto → Em Conferência **automático** no 1º salvamento.
- Finalizar exige todos os `obrigatorio_finalizacao` preenchidos; grava finalizado_por/em; bloqueia edição.
- Cancelar exige justificativa (`motivo_cancelamento`).
- Toda mutação/transição grava log (`registrarLog`: `alterar_campo` com diff, `mudar_status`).
- Campos de lista guardam valor-texto (snapshot).
- Padrões existentes: Server Actions checam permissão via `getSessao`/`podeFazer`; `registrarLog`/`calcularDiff` (`src/modules/logs/*`); formulários `useActionState` (ver `configuracoes/usuarios/usuario-form.tsx`); status badge (`src/modules/recebimento/domain/status-processo.ts`).
- Spec: `docs/superpowers/specs/2026-07-07-recebimento-3b-processos-design.md`.

---

## Task 1: Máquina de estados do processo (domínio, TDD)

**Files:**
- Create: `src/modules/recebimento/domain/ciclo-vida.ts`
- Create: `src/modules/recebimento/domain/__tests__/ciclo-vida.test.ts`

**Interfaces:**
- Produces:
  - `type StatusProcesso = 'aberto' | 'em_conferencia' | 'finalizado' | 'cancelado'`
  - `podeTransicionar(de: StatusProcesso, para: StatusProcesso): boolean`
  - `camposFaltantesFinalizacao(valores: Record<string, unknown>, campos: { campo: string; obrigatorioFinalizacao: boolean }[]): string[]`

- [ ] **Step 1: Escrever os testes**

Criar `src/modules/recebimento/domain/__tests__/ciclo-vida.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { podeTransicionar, camposFaltantesFinalizacao } from '../ciclo-vida'

describe('podeTransicionar', () => {
  it('aberto → em_conferencia e aberto → cancelado', () => {
    expect(podeTransicionar('aberto', 'em_conferencia')).toBe(true)
    expect(podeTransicionar('aberto', 'cancelado')).toBe(true)
  })
  it('em_conferencia → finalizado e → cancelado', () => {
    expect(podeTransicionar('em_conferencia', 'finalizado')).toBe(true)
    expect(podeTransicionar('em_conferencia', 'cancelado')).toBe(true)
  })
  it('finalizado → em_conferencia (reabrir), mas não → cancelado', () => {
    expect(podeTransicionar('finalizado', 'em_conferencia')).toBe(true)
    expect(podeTransicionar('finalizado', 'cancelado')).toBe(false)
  })
  it('cancelado é terminal', () => {
    expect(podeTransicionar('cancelado', 'em_conferencia')).toBe(false)
  })
  it('aberto → finalizado é inválido (precisa passar por conferência)', () => {
    expect(podeTransicionar('aberto', 'finalizado')).toBe(false)
  })
})

describe('camposFaltantesFinalizacao', () => {
  const campos = [
    { campo: 'numero_nf', obrigatorioFinalizacao: true },
    { campo: 'observacao', obrigatorioFinalizacao: false },
  ]
  it('lista os obrigatórios de finalização vazios', () => {
    expect(camposFaltantesFinalizacao({ numero_nf: '', observacao: 'x' }, campos)).toEqual(['numero_nf'])
  })
  it('vazio quando todos os obrigatórios estão preenchidos', () => {
    expect(camposFaltantesFinalizacao({ numero_nf: '123', observacao: null }, campos)).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar (falha)**

Run: `npm test -- ciclo-vida` → FAIL.

- [ ] **Step 3: Implementar**

Criar `src/modules/recebimento/domain/ciclo-vida.ts`:

```ts
export type StatusProcesso = 'aberto' | 'em_conferencia' | 'finalizado' | 'cancelado'

const TRANSICOES: Record<StatusProcesso, StatusProcesso[]> = {
  aberto: ['em_conferencia', 'cancelado'],
  em_conferencia: ['finalizado', 'cancelado'],
  finalizado: ['em_conferencia'],
  cancelado: [],
}

export function podeTransicionar(de: StatusProcesso, para: StatusProcesso): boolean {
  return TRANSICOES[de].includes(para)
}

export function camposFaltantesFinalizacao(
  valores: Record<string, unknown>,
  campos: { campo: string; obrigatorioFinalizacao: boolean }[],
): string[] {
  return campos
    .filter((c) => c.obrigatorioFinalizacao)
    .filter((c) => {
      const v = valores[c.campo]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map((c) => c.campo)
}
```

- [ ] **Step 4: Rodar (passa) + build + commit**

```bash
npm test -- ciclo-vida
npm test && npm run build
git add src/modules/recebimento/domain/ciclo-vida.ts src/modules/recebimento/domain/__tests__/ciclo-vida.test.ts
git commit -m "feat(recebimento): máquina de estados do processo + validação de finalização (TDD)"
```

---

## Task 2: Migration 0009 — reforço RLS do cancelamento

**Files:**
- Create: `supabase/migrations/0009_rls_cancelamento.sql`

**Interfaces:**
- Produces: `processos_update` refinada para exigir `excluir` ao gravar `status='cancelado'`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0009_rls_cancelamento.sql`:

```sql
-- Cancelar (status -> 'cancelado') passa a exigir a permissão 'excluir'
-- (Supervisor/Admin). Editar e finalizar seguem como antes.
drop policy processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('finalizar') or public.tem_permissao('editar_finalizado'))
    and (status <> 'cancelado' or public.tem_permissao('excluir'))
  );
```

- [ ] **Step 2: Aplicar e verificar**

```bash
supabase db push   # com SUPABASE_GO_BINARY se necessário
supabase db query --linked "select with_check from pg_policies where tablename='processos_recebimento' and policyname='processos_update';"
# Espera: expressão contendo tem_permissao('excluir') e ('cancelado')
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_rls_cancelamento.sql
git commit -m "feat(db): RLS — cancelar processo exige permissão excluir"
```

---

## Task 3: Repositório de processo + Server Actions (salvar + transições)

**Files:**
- Create: `src/modules/recebimento/infra/processo-detalhe-repository.ts`
- Create: `src/modules/recebimento/application/salvar-processo.ts`
- Create: `src/modules/recebimento/application/transicoes-processo.ts`

**Interfaces:**
- Consumes: `createServerSupabase`, `getSessao`, `podeFazer`, `registrarLog`, `calcularDiff`, `podeTransicionar`, `camposFaltantesFinalizacao`, `carregarCamposComerciais`-style leitura de `configuracao_campos` (todos os campos, não só comercial).
- Produces:
  - `buscarProcesso(id): Promise<ProcessoRow | null>` (todas as colunas).
  - `carregarCamposFormulario(): Promise<CampoFormulario[]>` — todos os `configuracao_campos` ativos (campo, rotulo, grupo, tipo, listaChave, origem, obrigatorioFinalizacao, ordem).
  - Server Actions: `salvarProcesso(id, valores)`, `finalizarProcesso(id)`, `cancelarProcesso(id, motivo)`, `reabrirProcesso(id)` — cada uma `{ ok } | { erro }` + `revalidatePath`.

- [ ] **Step 1: Implementar o repositório**

`processo-detalhe-repository.ts`: `buscarProcesso(id)` (`select *` do processo). `carregarCamposFormulario()` (todos `configuracao_campos` ativos, ordenados por grupo/ordem; mapear snake→camel). `atualizarProcesso(id, patch)` (`update` das colunas editáveis + `atualizado_por`, `status` e campos de auditoria conforme a ação). Todos via `createServerSupabase()` (RLS).

- [ ] **Step 2: `salvarProcesso`**

`salvar-processo.ts` (`'use server'`):
1. `getSessao()`; carregar o processo atual. Se `!podeFazer('editar')` → `{erro}`. Se o processo está `finalizado` e `!podeFazer('editar_finalizado')` → `{erro}`. Se `cancelado` → `{erro}` (não edita cancelado).
2. Aceitar apenas os campos editáveis vindos do form; validar/converter por tipo (reusar `converterValor` do 3A; para lista, aceitar valor-texto).
3. `calcularDiff(atual, novo, camposEditados)`.
4. Definir `patch` = valores + `atualizado_por`. Se `status === 'aberto'` → `patch.status = 'em_conferencia'`.
5. `atualizarProcesso(id, patch)`; `registrarLog('processo', id, 'alterar_campo', diff)`; se houve auto-transição, `registrarLog('processo', id, 'mudar_status', {de:'aberto', para:'em_conferencia'})`.
6. `revalidatePath('/recebimento/processos/'+id)`; retornar `{ok}`.

- [ ] **Step 3: `finalizarProcesso` / `cancelarProcesso` / `reabrirProcesso`**

`transicoes-processo.ts` (`'use server'`). Cada uma: `getSessao` + checagem de permissão (finalizar→`finalizar`; cancelar→`excluir`; reabrir→`editar_finalizado`); carregar processo; validar `podeTransicionar(status_atual, alvo)`; regra específica:
- **finalizar:** `camposFaltantesFinalizacao(processo, campos)`; se não-vazio → `{erro: 'Preencha: ...'}`. Senão `patch = {status:'finalizado', finalizado_por: sessao.usuarioId, finalizado_em: now}`.
- **cancelar:** exigir `motivo` não-vazio; `patch = {status:'cancelado', cancelado_por, motivo_cancelamento: motivo}`.
- **reabrir:** exigir status atual `finalizado`; `patch = {status:'em_conferencia', finalizado_em: null}`.
Aplicar `atualizarProcesso`; `registrarLog('processo', id, 'mudar_status', {de, para, ...})`; `revalidatePath`; `{ok}|{erro}`.

- [ ] **Step 4: Build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/infra/processo-detalhe-repository.ts src/modules/recebimento/application/salvar-processo.ts src/modules/recebimento/application/transicoes-processo.ts
git commit -m "feat(recebimento): salvar processo + transições (finalizar/cancelar/reabrir) com permissão e log"
```

---

## Task 4: Tela de detalhe do processo + formulário dinâmico

**Files:**
- Create: `src/app/(app)/recebimento/processos/[id]/page.tsx`
- Create: `src/app/(app)/recebimento/processos/[id]/processo-form.tsx`
- Create: `src/app/(app)/recebimento/processos/[id]/acoes-processo.tsx`

**Interfaces:**
- Consumes: `buscarProcesso`, `carregarCamposFormulario`, `carregarItensPorLista`, `getSessao`, `podeFazer`, as Server Actions da Task 3, `podeTransicionar`.

- [ ] **Step 1: Página (Server Component)**

`[id]/page.tsx`: valida `visualizar` (layout já garante); `buscarProcesso(id)` (`notFound()` se nulo); `carregarCamposFormulario()` + `carregarItensPorLista(chaves de tipo=lista)`; determina permissões do usuário (editar, finalizar, excluir, editar_finalizado) e o modo (edição vs somente-leitura, conforme status). Renderiza cabeçalho (Nº, status badge, fornecedor) + `<ProcessoForm>` + `<AcoesProcesso>`.

- [ ] **Step 2: Formulário dinâmico (client)**

`processo-form.tsx` (`'use client'`): recebe `campos`, `itensPorLista`, `valoresIniciais`, `somenteLeitura`. Agrupa por `grupo` (Comercial, Material, Recebimento, Qualidade) e ordena por `ordem`; para cada campo renderiza o controle por `tipo` (texto/numero/data = input; lista = select dos itens ativos, preservando o valor atual). Botão **Salvar** chama `salvarProcesso(id, valores)` via `useActionState`/`useTransition`; mostra sucesso/erro. `somenteLeitura` desabilita os campos e o Salvar.

- [ ] **Step 3: Ações de status (client)**

`acoes-processo.tsx` (`'use client'`): botões contextuais conforme status + permissões:
- `em_conferencia` + `finalizar` → **Finalizar** (chama `finalizarProcesso`; mostra os campos faltantes se erro).
- `aberto`/`em_conferencia` + `excluir` → **Cancelar** (dialog com campo de justificativa → `cancelarProcesso`).
- `finalizado` + `editar_finalizado` → **Reabrir** (`reabrirProcesso`).
Cada ação mostra toast/erro e revalida.

- [ ] **Step 4: Ligar a lista ao detalhe**

Na lista de processos (`/recebimento/processos`), cada linha vira link para `/recebimento/processos/[id]`.

- [ ] **Step 5: Build + commit**

```bash
npm test && npm run build
git add "src/app/(app)/recebimento/processos/"
git commit -m "feat(recebimento): tela de detalhe do processo com formulário dinâmico e ações de ciclo de vida"
```

---

## Task 5: Busca e filtros na lista de processos

**Files:**
- Modify: `src/modules/recebimento/infra/processo-repository.ts` (`listarProcessos` com filtros)
- Modify: `src/app/(app)/recebimento/processos/page.tsx` (controles de filtro)
- Create: `src/app/(app)/recebimento/processos/processos-filtros.tsx`

**Interfaces:**
- Produces: `listarProcessos({ busca?, status?, pagina, tamanho })` — filtra por status e por texto (Nº NF, Nº Pedido, fornecedor, código/descrição do material) via `.or(...ilike...)`.

- [ ] **Step 1: Filtros no repositório**

Estender `listarProcessos` para aceitar `busca` e `status`. `status` → `.eq('status', status)`. `busca` → `.or('numero_nf.ilike.%b%,numero_pedido.ilike.%b%,fornecedor.ilike.%b%,codigo_material.ilike.%b%,descricao_material.ilike.%b%')` (escapar `%`/`,` do termo). Manter paginação/ordenação.

- [ ] **Step 2: UI de filtros**

`processos-filtros.tsx` (`'use client'`): input de busca + select de status; ao aplicar, `router.push` com `searchParams` (busca, status, pagina=0). A página lê `searchParams` e passa ao repositório.

- [ ] **Step 3: Build + commit**

```bash
npm test && npm run build
git add src/modules/recebimento/infra/processo-repository.ts "src/app/(app)/recebimento/processos/"
git commit -m "feat(recebimento): busca e filtros na lista de processos"
```

---

## Self-Review (autor do plano)

**1. Cobertura do spec 3B:**
- Máquina de estados (transições + validação de finalização) → Task 1 ✅
- Reforço RLS do cancelamento → Task 2 ✅
- Salvar + auto Aberto→Em Conferência + log de alterações → Task 3 ✅
- Finalizar/Cancelar/Reabrir com permissão + log → Task 3 ✅
- Formulário dinâmico (de `configuracao_campos`, por grupo/tipo) → Task 4 ✅
- Ações de ciclo de vida na UI (contextuais por status/permissão) → Task 4 ✅
- Busca e filtros na lista → Task 5 ✅

**2. Placeholders:** domínio, migration e o contrato das Server Actions têm código/assinatura verbatim; a UI (form/ações/filtros) tem esqueleto detalhado seguindo padrões existentes (usuario-form, logs-filtros) — decisão deliberada; o subagente completa e é revisado (revisão pesada na Task 3, mais leve nas de UI).

**3. Consistência de tipos:** `StatusProcesso`, `podeTransicionar`, `camposFaltantesFinalizacao`, `salvarProcesso`, `finalizarProcesso`, `cancelarProcesso`, `reabrirProcesso`, `buscarProcesso`, `carregarCamposFormulario`, `listarProcessos` usados de forma idêntica entre as tasks. Colunas de auditoria (finalizado_por/em, cancelado_por, motivo_cancelamento, atualizado_por) já existem em `processos_recebimento` (migration 0004). Permissões (`editar`, `finalizar`, `excluir`, `editar_finalizado`, `visualizar`) já em `perfis`/`tem_permissao`.
