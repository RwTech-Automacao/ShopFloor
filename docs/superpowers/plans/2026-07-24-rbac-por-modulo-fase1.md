# RBAC por módulo — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** permissões de perfil por módulo (modelo + tela com accordions + enforcement no app). RLS
segue global (Fase 2 depois). Spec: `docs/superpowers/specs/2026-07-24-rbac-por-modulo-fase1-design.md`.

## Global Constraints
- Branch `feat/shopfloor-lancamento`. TS strict. Migração só no **Dev**. **NÃO tocar RLS/`tem_permissao`.**
- Grants (`perfil_permissao`) = fonte da verdade; `pode_*` = derivadas (OR dos módulos) p/ o RLS.
- **Compat:** `podeFazer(perfil, perm)` (global OR) permanece; permissões de módulo único (lancar,
  importar, editar, excluir, gerar_etiqueta, finalizar, editar_finalizado) dão o mesmo resultado por
  `podeNoModulo` — a conversão delas é segura/idêntica. As que **mudam de comportamento** são
  `visualizar` e `administrar` (compartilhadas).
- Catálogo: `recebimento`(visualizar,importar,editar,finalizar,editar_finalizado,excluir,gerar_etiqueta,administrar)
  · `shopfloor`(visualizar,lancar,administrar) · `sistema`(administrar).
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verificação por task: `npx tsc --noEmit && npm run lint && npm run test`.

## File Structure
- Create: `src/modules/auth/domain/modulos.ts` + `__tests__/`
- Modify: `src/modules/auth/domain/perfil.ts` (`porModulo`, `podeNoModulo`), `mapear-perfil.ts` (grants→porModulo + derivar), `__tests__/mapear-perfil.test.ts`
- Create: `supabase/migrations/0038_perfil_permissao.sql`
- Modify: `src/modules/auth/infra/usuario-repository.ts` (embed grants)
- Modify: `src/modules/perfis/domain/regras-perfil.ts` (catálogo por módulo), `src/modules/perfis/application/actions.ts` (grava grants + recalcula pode_*), `src/app/(app)/configuracoes/perfis/perfil-form.tsx` (accordions)
- Modify: `src/shared/ui/app-shell.tsx` (menu por módulo) + os guards (ver Task 4)
- Modify: `docs/regras-de-negocio-shopfloor.md` (nota) — opcional

---

### Task 1: Domínio — catálogo + `podeNoModulo` (TDD)

**Files:** Create `src/modules/auth/domain/modulos.ts` + `__tests__/modulos.test.ts`; Modify `perfil.ts`, `mapear-perfil.ts`, `__tests__/mapear-perfil.test.ts`.

- [ ] **Step 1: Catálogo** — `src/modules/auth/domain/modulos.ts`:

```ts
import type { Permissao } from './perfil'

export type Modulo = 'recebimento' | 'shopfloor' | 'sistema'

export const MODULOS: { chave: Modulo; rotulo: string }[] = [
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'shopfloor', rotulo: 'Fluxo de Processos' },
  { chave: 'sistema', rotulo: 'Sistema' },
]

/** Permissões que cada módulo expõe (define os accordions e a migração). */
export const PERMISSOES_POR_MODULO: Record<Modulo, Permissao[]> = {
  recebimento: ['visualizar', 'importar', 'editar', 'finalizar', 'editar_finalizado', 'excluir', 'gerar_etiqueta', 'administrar'],
  shopfloor: ['visualizar', 'lancar', 'administrar'],
  sistema: ['administrar'],
}
```

- [ ] **Step 2: `perfil.ts`** — adicionar `porModulo` + `podeNoModulo` (manter `permissoes`/`podeFazer`):

```ts
import type { Modulo } from './modulos'

export interface Perfil {
  id: string
  nome: string
  permissoes: Record<Permissao, boolean>       // OR global (compat)
  porModulo: Record<Modulo, Partial<Record<Permissao, boolean>>>
  sistema: boolean
}

export function podeFazer(perfil: Perfil | null, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.permissoes[acao] === true
}

export function podeNoModulo(perfil: Perfil | null, modulo: Modulo, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.porModulo[modulo]?.[acao] === true
}
```
(Evitar import circular: `Modulo` é só um tipo; se necessário, declarar `export type Modulo = 'recebimento'|'shopfloor'|'sistema'` em `perfil.ts` e reexportar em `modulos.ts`. Escolha a que não cria ciclo — recomendo mover o `type Modulo` para `perfil.ts` e `modulos.ts` importar dele.)

- [ ] **Step 3: `mapear-perfil.ts`** — `PerfilRow` ganha os grants; `mapearPerfil` monta `porModulo` a
  partir dos grants e mantém `permissoes` (agora derivado do OR dos módulos, com fallback pros `pode_*`
  quando não houver grants — segurança durante a transição):

```ts
import type { Perfil, Permissao } from './perfil'
import type { Modulo } from './perfil'

export interface PerfilRow {
  id: string
  nome: string
  pode_visualizar: boolean
  pode_importar: boolean
  pode_editar: boolean
  pode_finalizar: boolean
  pode_editar_finalizado: boolean
  pode_excluir: boolean
  pode_gerar_etiqueta: boolean
  pode_administrar: boolean
  pode_lancar: boolean
  sistema: boolean
  perfil_permissao?: { modulo: string; permissao: string }[]
}

export function mapearPerfil(row: PerfilRow): Perfil {
  const porModulo: Perfil['porModulo'] = { recebimento: {}, shopfloor: {}, sistema: {} }
  for (const g of row.perfil_permissao ?? []) {
    const m = g.modulo as Modulo
    if (porModulo[m]) porModulo[m][g.permissao as Permissao] = true
  }
  const flags: Record<Permissao, boolean> = {
    visualizar: row.pode_visualizar,
    importar: row.pode_importar,
    editar: row.pode_editar,
    finalizar: row.pode_finalizar,
    editar_finalizado: row.pode_editar_finalizado,
    excluir: row.pode_excluir,
    gerar_etiqueta: row.pode_gerar_etiqueta,
    administrar: row.pode_administrar,
    lancar: row.pode_lancar,
  }
  return { id: row.id, nome: row.nome, sistema: row.sistema, permissoes: flags, porModulo }
}
```

- [ ] **Step 4: Testes** — `__tests__/modulos.test.ts` (catálogo tem os 3 módulos; shopfloor tem lancar;
  sistema só administrar) e estender `__tests__/mapear-perfil.test.ts` (grants → `porModulo`;
  `podeNoModulo` true só onde há grant; `permissoes` reflete os `pode_*`). Rodar, ver passar. `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(auth): catálogo de módulos + podeNoModulo (grants por módulo) TDD`.

---

### Task 2: Migração `0038` + carregar grants na sessão

**Files:** Create `supabase/migrations/0038_perfil_permissao.sql`; Modify `usuario-repository.ts`.

- [ ] **Step 1: Migração** — `supabase/migrations/0038_perfil_permissao.sql`:

```sql
-- =============================================================
-- RBAC por módulo — Fase 1. Grants por (perfil, módulo, permissão).
-- Fonte da verdade granular; as colunas pode_* seguem como derivadas p/ o RLS.
-- Popula a partir dos flags atuais (preserva o comportamento dos perfis).
-- =============================================================

create table public.perfil_permissao (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  modulo    text not null,
  permissao text not null,
  primary key (perfil_id, modulo, permissao)
);
alter table public.perfil_permissao enable row level security;
create policy perfil_permissao_select on public.perfil_permissao
  for select using (tem_permissao('visualizar'));
create policy perfil_permissao_admin on public.perfil_permissao
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- Popular a partir dos flags atuais de cada perfil:
insert into public.perfil_permissao (perfil_id, modulo, permissao)
select p.id, m.modulo, m.permissao
from public.perfis p
cross join lateral (values
  ('recebimento','visualizar', p.pode_visualizar),
  ('recebimento','importar', p.pode_importar),
  ('recebimento','editar', p.pode_editar),
  ('recebimento','finalizar', p.pode_finalizar),
  ('recebimento','editar_finalizado', p.pode_editar_finalizado),
  ('recebimento','excluir', p.pode_excluir),
  ('recebimento','gerar_etiqueta', p.pode_gerar_etiqueta),
  ('recebimento','administrar', p.pode_administrar),
  ('shopfloor','visualizar', p.pode_visualizar),
  ('shopfloor','lancar', p.pode_lancar),
  ('shopfloor','administrar', p.pode_administrar),
  ('sistema','administrar', p.pode_administrar)
) as m(modulo, permissao, tem)
where m.tem
on conflict do nothing;
```

- [ ] **Step 2: Aplicar no Dev** — `SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" supabase db push` (só `0038`).

- [ ] **Step 3: Embed dos grants na sessão** — em `usuario-repository.ts`, trocar o select:
  `.select('id, nome, email, ativo, perfis(*, perfil_permissao(modulo,permissao))')`. O `mapearPerfil`
  (Task 1) já lê `row.perfil_permissao`.

- [ ] **Step 4: Smoke no Dev** (script em arquivo): p/ o perfil Admin, `perfil_permissao` tem
  administrar nos 3 módulos + lancar em shopfloor; p/ um perfil "só visualizar" (se existir), tem
  visualizar em recebimento+shopfloor e nada de administrar. Contagens coerentes.

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit`. Commit `feat(auth): migração 0038 — perfil_permissao (grants) + carregar na sessão`.

---

### Task 3: Tela de perfil (accordions) + salvar grants

**Files:** Modify `regras-perfil.ts`, `perfis/application/actions.ts`, `perfil-form.tsx`.

- [ ] **Step 1: Form** — em `perfil-form.tsx`, trocar a grid plana de `PERMISSOES` por **um bloco por
  módulo** (`MODULOS` × `PERMISSOES_POR_MODULO`), cada permissão com um `Switch` nomeado
  **`<modulo>.<permissao>`** (ex.: `name="shopfloor.administrar"`), `defaultChecked` a partir dos grants
  do perfil (nova prop: passar os grants do perfil pro form — a página de perfis carrega
  `perfil_permissao` junto). Usar accordions simples (pode ser `<details>`/`<summary>` estilizados ou
  seções com título por módulo; o app não tem componente Accordion — uma seção com `<Label>` do módulo +
  grid de switches basta, "accordion" pode ser um `<details>`).

- [ ] **Step 2: Action `salvarPerfil`** — em `perfis/application/actions.ts`:
  - Ler os grants do FormData: para cada `modulo` de `MODULOS` e cada `permissao` de
    `PERMISSOES_POR_MODULO[modulo]`, `formData.get('<modulo>.<permissao>') === 'on'`.
  - Recalcular os `pode_*` = OR entre módulos: `pode_administrar = grant em qualquer módulo`,
    `pode_visualizar = idem`, `pode_lancar = shopfloor.lancar`, `pode_importar = recebimento.importar`, etc.
    (mapa: cada `Permissao` → true se aparece em algum grant marcado).
  - Persistir: gravar/atualizar o perfil com os `pode_*` (caminho atual) **e** ressincronizar
    `perfil_permissao` (deletar do perfil + reinserir os grants marcados) — numa transação lógica na
    action (duas chamadas ao repo). Manter a regra `validarEdicaoPerfil` (não remover admin do próprio
    perfil) — agora "administrarNasNovasFlags" = há algum grant `administrar` em qualquer módulo.
  - A página de perfis (`perfis/page.tsx`) deve carregar os grants junto (select com
    `perfil_permissao(modulo,permissao)`) e passar ao form.

- [ ] **Step 3: `regras-perfil.ts`** — pode manter `PERMISSOES` (compat) mas o form passa a usar
  `MODULOS`/`PERMISSOES_POR_MODULO`. Ajustar `validarEdicaoPerfil` se necessário (assinatura mantém).

- [ ] **Step 4: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`. Commit
  `feat(perfis): edição de permissões por módulo (accordions) + grava grants`.

---

### Task 4: Enforcement — menu + guards por módulo

**Files:** Modify `app-shell.tsx` + os guards abaixo. Import `podeNoModulo` (e `Modulo`) onde trocar.

**Mapa (call site → módulo):**
- **shopfloor** (`podeNoModulo(_, 'shopfloor', <perm>)`): todas as `src/app/(app)/shopfloor/*/page.tsx`
  (burn-in/pesquisa/dashboard = visualizar; lancamento/manutencao/integracao = lancar; ordens =
  administrar; integracao `podeCancelar` = administrar) e todas as
  `src/modules/shopfloor/application/*` (dashboard/pesquisa/burnin = visualizar; lancar/manutencao/
  integracao = lancar; ordens = administrar; integracao cancelar = administrar).
- **recebimento** (`podeNoModulo(_, 'recebimento', <perm>)`): `src/app/(app)/recebimento/*` (layout =
  visualizar; processos/novo/[id] = editar/finalizar/editar_finalizado; importar = importar; etiquetas
  = gerar_etiqueta; exportar-fotos = administrar) · `src/app/api/anexos/[chave]/route.ts` = visualizar ·
  `src/modules/recebimento/application/*` (editar/importar/finalizar/visualizar conforme o call site) ·
  `src/modules/etiquetas/application/*` = gerar_etiqueta · referencias/exportar-fotos/colunas-lista =
  administrar · `src/modules/listas/application/actions.ts` e
  `src/modules/configuracao-campos/application/actions.ts` = **recebimento.administrar** (config do
  Recebimento).
- **sistema** (`podeNoModulo(_, 'sistema', 'administrar')`): `src/modules/usuarios/application/actions.ts`
  e `src/modules/perfis/application/actions.ts`.
- **Mantém `podeFazer` global**: `src/app/(app)/configuracoes/layout.tsx` (porta da área de
  Configurações — qualquer admin entra; os itens internos filtram fino no menu) e
  `src/app/(app)/home/page.tsx` (os atalhos já têm `permissao`; converter os atalhos p/ `{modulo,perm}`
  e usar `podeNoModulo`).

- [ ] **Step 1: Menu** (`app-shell.tsx`) — cada item de menu ganha `{ modulo, perm }` e o filtro de
  visibilidade usa `podeNoModulo(perfil, item.modulo, item.perm)`. Recebimento→recebimento;
  Fluxo de Processos→shopfloor; "Ajustes Recebimento"→recebimento.administrar; Usuários/Perfis→
  sistema.administrar. Ler o arquivo e casar a estrutura atual dos grupos.

- [ ] **Step 2: Guards das páginas** — trocar `podeFazer(sessao.perfil, X)` por
  `podeNoModulo(sessao.perfil, '<modulo>', X)` em cada page/route do mapa. (Mecânico; um por vez, casar
  o import.)

- [ ] **Step 3: Guards das actions** — idem nos `src/modules/**/application/*`. As de módulo único
  (lancar/importar/editar/etc.) dão o mesmo resultado — trocar mesmo assim p/ consistência.

- [ ] **Step 4: home** — atalhos com `{modulo, perm}` + `podeNoModulo`.

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit && npm run lint && npm run test`. Commit
  `feat(auth): menu e guards por módulo (podeNoModulo)`.

---

### Task 5 (controller): suíte + review amplo + smoke Dev + push
- `npx tsc --noEmit && npm run lint && npm run test`.
- Smoke Dev (script): criar um perfil de teste com grants só de `shopfloor` (visualizar+lancar) e
  conferir `perfil_permissao` + os `pode_*` derivados (pode_lancar=true, pode_administrar=false);
  apagar ao fim. (O efeito no menu/guards prova-se no teste visual — logar com um usuário desse perfil.)
- Review amplo (opus): foco em (a) nenhum guard virou mais permissivo por engano; (b) `visualizar`/
  `administrar` por módulo corretos; (c) migração preserva o comportamento; (d) recompute dos pode_*.
- Push + atualizar regras/memória (RBAC Fase 1; Fase 2 = RLS por módulo no backlog).

## Self-Review
- Cobertura: catálogo+domínio (T1), tabela+sessão (T2), tela (T3), enforcement (T4).
- RLS/`tem_permissao` intactos; `pode_*` derivados mantêm o RLS funcionando.
- Risco concentrado no T4 (mecânico) — mapa explícito por módulo; single-module = idêntico.
