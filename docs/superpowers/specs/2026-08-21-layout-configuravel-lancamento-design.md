# Layout configurável do Lançamento (admin, central)

> Design/spec. Sucede as features A (2×2) e D. Permite o **admin** definir, de forma
> **central (vale pra todos)**, a **ordem dos painéis** da tela de Lançamento — arrastando pra
> trocar de lugar. Substitui o arranjo 2×2 fixo (normal e especiais) por um arranjo
> configurável. Tela: ShopFloor → Operar → Lançamento; config em ShopFloor → Configurações.

## Contexto

Depois da feature A, o Lançamento tem um 2×2 **fixo**: bipe normal = Peça(topo-esq) ·
Contexto(topo-dir) · Histórico(base-esq) · Último(base-dir); telas especiais
(Integração/Embalagem/NQA-caixa) = [Painel | Contexto]. A fábrica quer poder **reordenar**
esses painéis de forma padronizada (um arranjo pra todos), decidido pelo admin.

## Escopo (v1)

- **Só REORDENAR** (trocar painéis de slot). **Sem ocultar** painéis (todos sempre visíveis).
- **Admin define, central** (um padrão pra todos os operadores) — gravado no banco.
- Cobre **as duas telas**: `layout_normal` (4 painéis) e `layout_especiais` (2 painéis).
- Interação: **arrastar um painel pro slot de outro → trocam** (drag-and-drop).

**Fora de escopo (v1):** ocultar painéis · por-perfil/por-posto · por-usuário · arrastar-livre
(canvas) · redimensionar colunas.

## Modelo de dados (migração)

Config global chave→JSON. Nova tabela pequena:

```sql
create table if not exists sf_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
```

Duas linhas (semeadas com o padrão atual):
- `layout_lancamento_normal` → `{ "ordem": ["peca","contexto","historico","ultimo"] }`
- `layout_lancamento_especiais` → `{ "ordem": ["painel","contexto"] }`

O array `ordem` é uma **permutação** das chaves dos painéis; a posição no array = o slot
(índice 0 = topo-esq, 1 = topo-dir, 2 = base-esq, 3 = base-dir; nas especiais 0 = esq, 1 = dir).

**Chaves dos painéis:**
- Normal: `peca` · `contexto` · `historico` · `ultimo`
- Especiais: `painel` (o painel especial da vez: Integração/Embalagem/NQA-caixa) · `contexto`

**RLS/gate:**
- **Leitura:** qualquer usuário autenticado (operadores precisam ler o layout). RLS select
  liberado pra `authenticated`.
- **Escrita:** só admin. Via RPC `sf_salvar_layout(p_chave text, p_ordem jsonb)`
  **SECURITY DEFINER** com gate explícito `tem_permissao('shopfloor','configurar')` (ou a
  permissão de admin equivalente já usada nas telas de Config — confirmar no código). Segue o
  padrão dos outros `sf_*` RPCs (ver `postos-repository.ts` / migração de perfis).
- A RPC valida que `p_ordem` é uma permutação válida do conjunto esperado pra aquela chave
  (backstop server-side; evita gravar lixo).

## Tela do admin — "Layout do Lançamento"

Em **Configurações** (só quem tem a permissão de config do ShopFloor). Uma tela com **duas
seções**: "Lançamento (bipe normal)" e "Telas especiais".

Cada seção mostra a **grade com os painéis** representados por **cards-rótulo** (nome do
painel + um mini-desenho/ícone que lembre o conteúdo — ex.: Peça = campo de bipe; Histórico =
lista; Último = ✓). Cada card é **arrastável**:
- Arrastar o card A e soltar sobre o card B → **trocam de posição** na `ordem`.
- Feedback visual de "arrastando" e de "solte aqui".
- Botões: **Salvar** (chama a RPC) e **Restaurar padrão** (volta à ordem semente).

Implementação do drag: **HTML5 drag-and-drop nativo** (`draggable`, `onDragStart`/`onDrop`) —
4 itens, sem dependência nova. Estado local da ordem; salva ao clicar Salvar.

## Lançamento (operador)

- Server component busca as 2 configs (`layout_lancamento_normal` + `..._especiais`) e passa
  ao `LancamentoForm`.
- O `LancamentoForm` renderiza os painéis **na ordem** definida, mapeando índice → slot da
  grade (mesma grade `lg:grid-cols-2` de hoje; `lg:col-start`/`lg:row-start` derivados do
  índice).
- **Painéis viram um mapa** chave→JSX: `{ peca: <Card Peça/>, contexto: <Card Contexto/>,
  historico: <Card Histórico/>, ultimo: <Card Último/> }` (normal) e `{ painel: <PainelEspecial/>,
  contexto: <Card Contexto/> }` (especiais). A grade percorre `ordem` e posiciona cada um.
- **Estado sem OP** e **tela estreita** seguem como na feature A (sem OP = só Contexto de
  bipe; estreito empilha na ordem configurada).

## Responsivo

- A ordem configurada vale como **ordem de empilhamento** no estreito (índice 0 primeiro).
- Em `lg`, a mesma ordem preenche os slots da grade (2×2 normal; 2 colunas especiais).

## Migração e compatibilidade

- Migração nova (próxima livre; ⚠️ conferir a numeração — há gaps: 0079/EMB fora do Prod,
  0081/NQA-followup pendente). Cria `sf_config` + semeia as 2 linhas + a RPC
  `sf_salvar_layout` + RLS.
- Se a config não existir/vier vazia, o Lançamento usa a **ordem padrão** (fallback no
  código) — nunca quebra.

## Arquivos (previsão)

- **Migração** `00XX_sf_config_layout.sql` (tabela + seed + RPC + RLS)
- **Infra** `src/modules/shopfloor/infra/config-repository.ts` (ler layouts; chamar
  `sf_salvar_layout`)
- **Application** action `salvarLayoutLancamento` (gate de sessão + RPC)
- **Config UI** `src/app/(app)/shopfloor/configuracoes/layout-lancamento/` (page + form de
  arrastar-trocar) + item no menu de Configurações
- **Lançamento** `lancamento-form.tsx` (renderizar por `ordem`) + o server component que busca
  a config e passa como prop

## Fora de escopo

Ocultar painéis · granularidade por perfil/posto · por-usuário · arrastar-livre · redimensionar
· configurar a ordem das telas que não são Lançamento.

## Como saber que deu certo

- Admin abre "Layout do Lançamento", arrasta (ex.) Contexto pra o slot da Peça → trocam;
  Salvar; recarrega e a ordem persiste.
- Operador abre o Lançamento (bipe normal) e vê os painéis na ordem que o admin definiu; no
  tablet retrato, empilham na mesma ordem.
- Telas especiais respeitam a ordem [Painel/Contexto] configurada.
- Sem config (fallback) = o 2×2 padrão de hoje.
- `npm run lint` + `tsc` + testes verdes (a ordem→slots é lógica pura → cobrir com testes de
  unidade).
