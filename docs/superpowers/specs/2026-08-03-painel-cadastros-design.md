# Painel de Resultado nos cadastros — Design · Fase 2 (ShopFloor)

> **Data:** 2026-08-03 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-painel-cadastros`
> **Tipo:** UX — leva o `PainelResultado` (Fase 1) pros cadastros. **Sem migração, sem backend.**

## Contexto

A Fase 1 trocou os toasts pelo `PainelResultado` nas telas de bipe. Falta os **cadastros do ShopFloor**
(Cadastro de OP, Cadastrar Posto, Cadastrar Defeito). Hoje: **erro** = textinho vermelho inline no diálogo;
**sucesso** = o diálogo fecha (silencioso ou toast). Comportamento aprovado: **erro no diálogo, sucesso na lista**.

## Objetivo

Nos 3 cadastros do ShopFloor: **erro** → `PainelResultado` **dentro do diálogo** (no lugar do textinho vermelho);
**sucesso** (criar/editar/excluir) → `PainelResultado` **na lista** (ex.: "OP PMO973/12345 criada"). Reusa o
componente e o tipo `ResultadoAcao` da Fase 1.

## Escopo

**Dentro:** Cadastro de OP (`ordem-form` + `ordens-lista` + `ordens/page`), Cadastrar Posto (`posto-form` +
`postos-lista`), Cadastrar Defeito (`defeito-form` + `defeitos-lista`).
**Fora:** cadastros de Configurações/Recebimento (outro módulo); os toasts de **salvar/puxar padrão de fluxo**
(sub-ações dentro do diálogo de OP) seguem como estão; confirmação de exclusão continua como hoje.

## Design

### Padrão (igual nos 3)
- A **Lista** (client) passa a guardar `const [resultado, setResultado] = useState<ResultadoAcao | null>(null)` e
  renderiza `<PainelResultado resultado={resultado} />` **no topo**. Ela já é dona do "Novo" + "Editar"/"Excluir".
- **Form (criar/editar)** ganha prop `onSucesso?: (r: ResultadoAcao) => void`:
  - **Erro** (`state.erro`): renderiza `<PainelResultado resultado={{ tipo:'erro', titulo: state.erro }} />` **no
    diálogo**, no lugar do `<p className="text-sm text-red-600">{state.erro}</p>`.
  - **Sucesso** (`state.ok`): chama `onSucesso({ tipo:'ok', titulo: … })` e fecha o diálogo (a Lista mostra o painel).
- **Excluir** (botão da lista): sucesso/erro → `onResultado(...)` no painel da lista (é onde a ação acontece; troca os toasts atuais).

### 1. Cadastro de OP
- **Mover** o `<OrdemForm>` "Nova OP" da **página** pra dentro da **`OrdensLista`** (ela já recebe todas as props:
  `postos`, `postosPerfil`, `padroes`, `pmosExistentes`, `clientesExistentes`, `dadosPorPmo`). A `ordens/page.tsx`
  passa a renderizar só `<OrdensLista>` (com as props do form também). Assim a Lista é dona de tudo.
- `OrdensLista`: `resultado` state + `<PainelResultado>` no topo; renderiza a Nova OP (`<OrdemForm onSucesso={setResultado} />`)
  e as de edição por linha (`<OrdemForm ordem={o} onSucesso={setResultado} />`); o `<ExcluirOrdemBotao>` recebe `onResultado={setResultado}`.
- `ordem-form`: prop `onSucesso`; troca o inline error (linha ~428) pelo `PainelResultado`; no sucesso, chama
  `onSucesso({ tipo:'ok', titulo: ehEdicao ? \`OP ${pmo}/${op} editada\` : \`OP ${pmo}/${op} criada\` })` antes de fechar.
- `excluir-ordem-botao`: prop `onResultado`; troca `toast.success('OP excluída.')`/`toast.error(r.erro)` por
  `onResultado({ tipo:'ok', titulo:'OP excluída' })` / `onResultado({ tipo:'erro', titulo:r.erro })`.

### 2. Cadastrar Posto
- `PostosLista`: já é dona do `<PostoForm>` (Novo) + `<EditarPostoButton>`/`<ExcluirPostoButton>` por linha. Adicionar
  `resultado` state + `<PainelResultado>` no topo; passar `onSucesso`/`onResultado` aos componentes.
- `posto-form`: erro no diálogo via `PainelResultado`; sucesso → `onSucesso({ tipo:'ok', titulo: <criado/editado> })`;
  excluir → `onResultado(...)`. Mensagens: "Posto {nome} criado/editado/excluído".

### 3. Cadastrar Defeito
- `DefeitosLista`: dona do `<DefeitoForm>` (Novo) + `<ExcluirDefeitoButton>` por linha. `resultado` + `<PainelResultado>`
  no topo; passar callbacks. Mensagens: "Defeito {código} criado/excluído".
- `defeito-form`: erro no diálogo; sucesso → `onSucesso(...)`; excluir → `onResultado(...)`.

## Critérios de sucesso
- Em cada cadastro (OP, Posto, Defeito): erro aparece **grande dentro do diálogo**; ao salvar/excluir com sucesso,
  o diálogo fecha e o **painel verde aparece na lista** com a informação (ex.: "OP …/… criada").
- Sem os textinhos vermelhos inline nem os toasts dessas ações. Build/lint/test verdes. Sem migração.

## Riscos / considerações
- **Mover a Nova OP** pra `OrdensLista` é um ajuste de organização — conferir que a página só passa a renderizar a Lista e que as props batem (a Lista já as recebia).
- **`onSucesso`/`onResultado` opcionais** — se não passados, o form só fecha (compatível caso reusem noutro lugar).
- O painel da lista **persiste** até a próxima ação (some ao abrir/salvar de novo? decisão de plano: limpar ao abrir um novo diálogo, mostrar no fechamento com sucesso).
- Smoke: criar/editar/excluir cada um com sucesso (painel na lista) e com erro (painel no diálogo — ex.: OP duplicada, posto em uso), dark mode.
