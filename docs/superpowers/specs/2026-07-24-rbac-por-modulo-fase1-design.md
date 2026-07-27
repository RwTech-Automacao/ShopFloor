# RBAC por módulo — Fase 1 (modelo + tela + enforcement no app) — Design

> Permissões de perfil passam a ser **por módulo**. Fase 1: modelo granular + tela com
> accordions + enforcement no app (menu/guards). RLS segue global (Fase 2 aperta depois).
> Decidido com o usuário em 2026-07-24.

## Contexto
Hoje o perfil tem flags **globais** (`pode_visualizar/importar/editar/finalizar/editar_finalizado/
excluir/gerar_etiqueta/lancar/administrar` — tabela `perfis`). O RLS (82 políticas em 22 migrações)
chama `tem_permissao('administrar')` etc. — **cego a módulo**: `administrar` é o mesmo flag pro
ShopFloor e pro Recebimento. Objetivo: um perfil poder ser admin de um módulo e não de outro.

## Decisão de escopo (usuário, 2026-07-24)
**Fase 1** = modelo módulo×permissão + tela de perfil (accordions) + enforcement no **app** (menu +
guards de página). **RLS continua global** (as colunas `pode_*` seguem existindo). **Fase 2** (futura):
tornar o RLS consciente de módulo (`tem_permissao('shopfloor.administrar')` — as 82 políticas).
**Limitação aceita da Fase 1:** a separação é de **interface/uso** — no banco, um "admin do ShopFloor"
ainda poderia tocar dados do Recebimento via API (o RLS lê o flag global derivado). Documentar.

## Catálogo (módulos × permissões)
| Módulo (chave) | Permissões |
|---|---|
| `recebimento` | visualizar, importar, editar, finalizar, editar_finalizado, excluir, gerar_etiqueta, administrar |
| `shopfloor` | visualizar, lancar, administrar |
| `sistema` | administrar *(gerir usuários, perfis, listas, campos)* |

→ catálogo no domínio: `src/modules/auth/domain/modulos.ts` (`MODULOS`, `PERMISSOES_POR_MODULO`).

## Arquitetura

### Dados — grants como fonte da verdade + flags derivadas
- Nova tabela **`perfil_permissao(perfil_id uuid FK on delete cascade, modulo text, permissao text,
  primary key(perfil_id, modulo, permissao))`**. RLS: select `visualizar`; all `administrar` (como as
  outras de config).
- As colunas `pode_*` de `perfis` **permanecem** (RLS Fase 1) mas viram **derivadas**: ao salvar um
  perfil, recalcular `pode_X = existe grant de X em QUALQUER módulo`. Feito na **action** de salvar
  (transação: grava grants + atualiza os `pode_*`). Fonte da verdade = grants; `pode_*` = cache p/ RLS.

### Domínio
- `Perfil` ganha `porModulo: Record<string, Record<Permissao, boolean>>` (além do `permissoes` global,
  que continua sendo o OR — usado onde o código ainda é global).
- Nova função **`podeNoModulo(perfil, modulo, permissao)`** = grant existe naquele módulo. `podeFazer`
  (global) permanece (compat) mas passa a ser derivado do OR dos módulos.

### Enforcement no app
- **Menu** (`app-shell.tsx`): cada item passa a ter `{ modulo, permissao }`; o filtro usa `podeNoModulo`.
  Os grupos do menu já são por módulo (Recebimento / Fluxo de Processos / Configurações).
- **Guards de página**: cada `page.tsx` troca `podeFazer(sessao.perfil, '<perm>')` por
  `podeNoModulo(sessao.perfil, '<modulo>', '<perm>')`. Mapeamento: telas de `recebimento/*` → módulo
  `recebimento`; `shopfloor/*` → `shopfloor`; `configuracoes/*` (usuários/perfis/listas/campos) →
  `sistema`. (As **server actions** também devem checar — trocar os `podeFazer` correspondentes.)

### Migração dos perfis atuais (preserva comportamento)
Migração `0038`: cria a tabela; **popula `perfil_permissao`** a partir dos flags atuais de cada perfil:
- `pode_importar/editar/finalizar/editar_finalizado/excluir/gerar_etiqueta` → `recebimento.<perm>`.
- `pode_lancar` → `shopfloor.lancar`.
- `pode_visualizar` → `recebimento.visualizar` **e** `shopfloor.visualizar`.
- `pode_administrar` → `recebimento.administrar`, `shopfloor.administrar`, `sistema.administrar`.
Quem é Admin hoje segue podendo tudo; quem só via, só vê — agora por módulo. Os `pode_*` já refletem
(nada muda neles nesta migração de dados).

### Tela de perfil (`configuracoes/perfis/perfil-form.tsx`)
- Substitui a lista plana de checkboxes por **um accordion por módulo** (Recebimento / ShopFloor /
  Sistema), cada um com os checkboxes das permissões daquele módulo (do catálogo). Estado = set de
  grants `{modulo, permissao}`. A action de salvar grava os grants e recalcula os `pode_*`.

## O que NÃO muda (Fase 1)
- O RLS e a função `tem_permissao` (seguem lendo `pode_*`). As 82 políticas ficam intactas.
- O comportamento efetivo dos perfis atuais (migração preserva). Módulos Recebimento/ShopFloor funcionam igual.

## Casos de borda
- Perfil `sistema` (flag `sistema=true` em `perfis`) — perfis de sistema não são editáveis/excluíveis
  (regra atual); a tela mantém isso. Um perfil sem grant nenhum num módulo → some do menu daquele módulo.
- `administrar` desdobrado: garantir que a página de **Cadastro de OP** passe a exigir
  `shopfloor.administrar` (não o global), e usuários/perfis/listas → `sistema.administrar`.

## Testes
- **Domínio (TDD):** `podeNoModulo` (grant existe/não); derivação `pode_* = OR`; catálogo consistente.
- **Smoke no Dev:** migração popula grants coerentes p/ os perfis existentes (Admin tem tudo; um perfil
  "só visualizar" tem visualizar nos 2 módulos e nada de admin). Menu/guards respeitam por módulo (teste visual).

## Migração
`0038` (tabela `perfil_permissao` + popular a partir dos flags). Só no Dev. Sem tocar RLS/`tem_permissao`.
