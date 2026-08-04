# Fluxo da OP estilo n8n — Design

> **Data:** 2026-08-04 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-fluxo-op`
> **Tipo:** nova tela de leitura + 1 RPC (migração **0071**). **Só visualizar** (não edita o fluxo).

## Contexto

Hoje o "ver fluxo da OP" é o olhinho na lista de OPs (`ordens/fluxo-botao.tsx`): um diálogo que mostra a
sequência de postos como **texto + setas**. O usuário quer um **canvas estilo n8n** (nós ligados por
linhas, com pan/zoom) que mostre, **ao vivo**, **onde as peças estão** no fluxo daquela OP — e, ao clicar
num posto, o **detalhe** (aprovadas/reprovadas/retestes/lista de Nº de Série).

Decisões travadas no brainstorm:
- **Só visualizar** (o editor de fluxo no Cadastro de OP continua como está).
- **Números ao vivo** por posto.
- **Canvas n8n com pan/zoom** → lib **React Flow** (`@xyflow/react`).
- Vive numa **aba própria "Fluxo"** em Análise (escolhe a OP → canvas).
- **Manutenção** = nó **ramo/paralelo** (não faz parte da cadeia linear).
- **Posição atual da peça** = **último bipe**; se o último registro foi **reprovado**, a peça conta em
  **Manutenção** (não no posto que reprovou).
- Números vêm de uma **RPC** (`sf_fluxo_op`) — opção B (agrega no Postgres numa chamada).

## Escopo

**Dentro:**
- Aba **Fluxo** em Análise: seletor de OP → canvas React Flow.
- **Nó fechado:** nome do posto + **WIP** (quantas peças estão nele agora).
- **Nó aberto (clique):** painel com **Aprovadas**, **Reprovadas**, **Passaram +de 1 vez** (retestes),
  e a **lista de Nº de Série** registrados no posto (com status).
- Nó **Manutenção** como ramo paralelo (abaixo da cadeia), com arestas tracejadas vindas dos postos que
  tiveram reprova.
- **RPC `sf_fluxo_op(p_pmo, p_op)`** (migração 0071) para os agregados por posto.
- A lista de SNs do posto (detalhe) é carregada **sob demanda** ao abrir o nó.

**Fora:** editar o fluxo no canvas; celular (foco desktop/tablet, mas o canvas já dá pan/zoom); trocar o
olhinho da lista de OPs (fica como está); auto-layout complexo (o fluxo é linear).

## Design

### A. Navegação — aba "Fluxo" em Análise
- `analisar/layout.tsx`: acrescentar `{ rotulo: 'Fluxo', href: '/shopfloor/analisar/fluxo' }` em `ABAS`.
- `analisar/fluxo/page.tsx` (server): carrega a **lista de OPs** (`sf_ordens`: pmo, op, cliente, descricao)
  e o **mapa posto→perfil** (pra saber quais postos "têm status") — passa pro client.
- `analisar/fluxo/fluxo-form.tsx` (client): **seletor de OP** (combobox/select, como o `caixas-form` faz) +
  o canvas. Ao escolher a OP → chama a action que roda a RPC e monta os nós.

### B. Dados — RPC `sf_fluxo_op` (migração 0071)
`sf_fluxo_op(p_pmo text, p_op text)` — `security definer`, `stable`, `set search_path = public`, com
**guard `tem_permissao('visualizar')`** (padrão das RPCs do módulo). Retorna **uma linha por posto**
(cadeia da OP **+ Manutenção**):

| coluna | significado |
|---|---|
| `posto` | nome do posto (ou `'Manutenção'`) |
| `wip` | peças **no posto agora** (último bipe da peça caiu aqui; reprova → Manutenção) |
| `registros` | total de registros no posto (útil pra postos **sem status**: embalagem/integração/burn-in) |
| `aprovadas` | registros com `lower(status)='aprovado'` no posto |
| `reprovadas` | registros com `lower(status)='reprovado'` no posto |
| `retestes` | Nº de Série **distintos** com **≥2 registros** no posto (reteste em teste/inspeção) |

**WIP (posição atual):** por SN (`numero_serie_norm <> ''`), pega o **registro mais recente**
(`order by data_hora desc, created_at desc`); se `lower(status)='reprovado'` → conta em **`'Manutenção'`**,
senão → conta no `posto` desse registro. SN nunca bipado não conta.

**Agregados (aprovadas/reprovadas/retestes/registros):** sobre **todos** os registros da OP, agrupados por
posto (independente da posição atual).

Ordem dos postos: a tela junta o retorno da RPC com a **sequência do fluxo** (`sf_ordem_postos.ordem`) —
a RPC não precisa devolver `ordem` (a tela já tem via `sf_ordens`→`sf_ordem_postos`).

### C. Detalhe do nó (lista de SNs) — sob demanda
Ao **abrir** um nó, o form chama uma leitura leve (repositório, PostgREST, **paginada**) que traz os SNs do
posto: `carregarSnsDoPosto(pmo, op, posto)` → `{ sn, status, vezes }[]` (`vezes` = nº de registros do SN
naquele posto). Não vem no payload inicial — só quando o operador expande o nó. (Evita puxar milhares de
SNs de OP grande de cara.)

### D. Canvas — React Flow (`@xyflow/react`)
- **Lib nova:** `@xyflow/react` (MIT). Importar o CSS da lib no componente client (`@xyflow/react/dist/style.css`).
- **Nó custom** (`FluxoNode`): card com nome do posto + WIP grande; cor/realce por estado (ex.: WIP>0 destaca).
  Clique **abre o painel de detalhe** (dentro do próprio nó expandido ou num painel lateral do canvas).
- **Layout determinístico** (fluxo é linear, sem dagre): posto `i` em `x = i * 220, y = 0`; **Manutenção**
  abaixo (`y = 180`, x centralizado). **Edges:** cadeia `posto[i] → posto[i+1]` (sólida); de cada posto com
  `reprovadas > 0` → **Manutenção** (tracejada, cor de alerta).
- Controles da lib: **pan/zoom**, botão **fitView** ("encaixar na tela"), minimap (opcional). Read-only:
  `nodesDraggable={false}` (ou permitir arrastar só visual, sem persistir).

### E. Convenção "posto tem status"
Reusar a lógica existente (`perfil-posto` / `mapaPostoPerfil` — gate `'aprovado'` vs `'registrado'`, como o
`dashboard.ts` já faz com `temStatus`). No nó, os rótulos do detalhe se adaptam:
- posto **com status** (teste/inspeção): mostra **Aprovadas / Reprovadas / Retestes**.
- posto **sem status** (embalagem/integração/burn-in): mostra **Registradas** (usa `registros`); reprovadas
  não se aplica.

## Fluxo de dados (resumo)
1. `page.tsx` (server) → lista de OPs + mapa posto→perfil.
2. Usuário escolhe OP no `fluxo-form`.
3. Action → `sf_fluxo_op(pmo, op)` (agregados) + `sf_ordem_postos` (ordem) → monta `nodes`/`edges`.
4. Canvas renderiza; WIP nos nós fechados.
5. Clique no nó → `carregarSnsDoPosto` (lazy) → painel de detalhe (aprovadas/reprovadas/retestes/SNs).

## Critérios de sucesso
- Aba **Fluxo** em Análise; escolher a OP mostra o canvas n8n com os postos na ordem do fluxo.
- **Nó fechado** mostra o WIP correto (soma dos WIP + Manutenção = peças já bipadas da OP).
- **Nó aberto** mostra aprovadas/reprovadas/retestes e a lista de SNs (lazy).
- **Manutenção** aparece como ramo; postos que reprovaram têm aresta tracejada até ela.
- Pan/zoom e "encaixar na tela" funcionam.
- Build/lint/test verdes. RPC com guard de permissão. Migração aplicada **Dev primeiro**.

## Riscos / considerações
- **Nova dependência** (`@xyflow/react`): peso no bundle da aba (client component; a aba é isolada). Aceitável.
- **OP grande (>2000 peças):** a RPC agrega no banco (rápido); a lista de SNs por posto é **paginada e lazy**.
- **Status vazio** em postos sem gate: WIP conta pelo posto do último registro (aprovado/vazio); reprova →
  Manutenção. `aprovadas` fica 0 nesses postos — por isso o nó usa `registros` no rótulo (item E).
- **Empate de horário** no "último bipe": desempata por `created_at desc` (determinístico).
- **Manutenção sem reprovas:** o nó ainda aparece (WIP 0) pra o fluxo ficar completo; sem arestas se ninguém reprovou.
- **RLS:** `security definer` + guard `tem_permissao('visualizar')`; leitura de SNs respeita a policy de select.
