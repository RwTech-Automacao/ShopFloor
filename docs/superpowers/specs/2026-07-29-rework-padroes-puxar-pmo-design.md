# Rework Padrões de Fluxo + Puxar Cliente/Descrição por PMO + fix do cache — Design

> **Data:** 2026-07-29 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** rework/feature no Cadastro de OP. Segue o fluxo Dev × Prod.

## Contexto

No Cadastro de OP (`/shopfloor/ordens`), três pontos de feedback (2026-07-29):
1. **Auto-preencher por PMO:** ao digitar uma PMO já existente, o usuário quer que **Cliente + Descrição**
   sejam puxados automaticamente (menos digitação, mais consistência). Dado vem da **OP mais recente**
   daquela PMO (já existe; sem cadastro novo).
2. **Padrão de Fluxo — associação à PMO explícita:** hoje o padrão fica amarrado **automaticamente** à PMO
   do form no momento de salvar, e tem um campo **Descrição** que não faz sentido. Trocar: **escolher a PMO**
   explicitamente (campo) **no lugar da Descrição**.
3. **Bug do "cache":** ao salvar uma OP, o form só **fecha** o Dialog (não reseta); reabrir "Nova OP" mostra
   dados da última OP.

## Objetivo

(1) Auto-preencher Cliente+Descrição ao trocar a PMO; (2) no salvar-padrão, associar a PMO explicitamente
(sem Descrição); (3) resetar o form ao abrir.

## Escopo

**Dentro:**
- Auto-preenchimento de Cliente + Descrição por PMO (mapa `PMO → {cliente, descrição}` da OP mais recente).
- Descrição da OP vira campo **controlado** (pra poder auto-preencher).
- Dialog "Salvar como padrão": tira Descrição, coloca **"Associar à PMO"** (pré-preenchido com a PMO do form).
- Dropdown de padrões passa a mostrar só o **nome**.
- Fix: reset do form ao abrir o Dialog.

**Fora (confirmado):**
- **Migração** — nenhuma (a tabela `sf_padroes_fluxo` já tem `pmo`; a coluna `descricao` fica sem uso,
  inofensiva). O padrão **continua por-PMO**, com **postos + receita**.
- Tela dedicada de gestão de padrões (segue o inline).

## Design

### 1. Puxar Cliente + Descrição pela PMO
- **`page.tsx`** monta `dadosPorPmo: Record<string, { cliente: string; descricao: string }>` a partir das
  ordens já carregadas (`listarOrdens()`): pra cada PMO, o `{cliente, descricao}` da OP **mais recente**
  (maior `created_at`). Passa `dadosPorPmo` pro `<OrdemForm>` e pro `<OrdensLista>` (→ form de edição).
- **`ordem-form.tsx`:** ao **mudar a PMO** (`onChange` do input de PMO), se `dadosPorPmo[pmo.trim()]` existe →
  **substitui** `setCliente(...)` + `setDescricao(...)` pelos dados da PMO. (Substitui sempre — decisão do
  usuário; a lógica dispara na mudança, então abrir uma OP de edição não auto-preenche sozinho.)
- **Descrição controlada:** hoje é `<Input name="descricao" defaultValue={...} />` (solto). Vira
  `const [descricao, setDescricao] = useState(ordem?.descricao ?? '')` + `<Input value={descricao}
  onChange={(e) => setDescricao(e.target.value)} />`. (Vale tanto pro auto-preenchimento quanto pro reset.)

### 2. Padrão de Fluxo — associar à PMO explícita (sem Descrição)
- No dialog **"Salvar como padrão"**: remover o input **Descrição**; adicionar **"Associar à PMO"** — um
  `<Input>` de texto **pré-preenchido com o `pmo` atual do form**, editável (a pessoa pode associar a outra
  PMO). Estado `const [pmoPadrao, setPmoPadrao] = useState('')`, inicializado com o `pmo` do form ao abrir o
  dialog (`abrirSalvarPadrao` faz `setPmoPadrao(pmo)`).
- `salvarPadraoAction` passa a receber o `pmo` **escolhido** (`pmoPadrao`), não o `pmo` do form; `descricao`
  vai vazia (`''`). Validação: `pmoPadrao` e `nome` não-vazios, `fluxo` não-vazio (já existe).
- **Dropdown de padrões:** o `SelectValue` e os `SelectItem` mostram só `p.nome` (sem ` — descricao`).
- O padrão continua salvando **postos** (`fluxo`) + **componentes** (`receita`) atuais.

### 3. Fix do bug do "cache" (reset ao abrir)
- No `<Dialog onOpenChange>`, ao **abrir** (`v === true`): resetar o estado controlado pro inicial —
  `setPmo(ordem?.pmo ?? '')`, `setFluxo(ordem?.postos ?? [])`, `setReceita(ordem?.componentes ?? [])`,
  `setCliente(ordem?.cliente ?? '')`, `setDescricao(ordem?.descricao ?? '')`, `setModoNovoCliente(false)`,
  `setPadraoSelecionado('')`.
- Os inputs **não-controlados** restantes (`op`, `qtd`, `acp`, `status`, `sn_ini`, `sn_fim` — `defaultValue`)
  são remontados por uma **`key` no `<form>`** que incrementa ao abrir (`setInstanciaForm((n) => n + 1)`) →
  `defaultValue` reaplica.
- Efeito: "Nova OP" abre limpa; edição reabre com os dados da OP (evita o vazamento da última OP salva).

## Critérios de sucesso
- Digitar/mudar a PMO pra uma existente → Cliente + Descrição preenchem (substituem) com os dados da OP mais
  recente daquela PMO; PMO nova (sem OP) não preenche.
- "Salvar como padrão" pede Nome + "Associar à PMO" (pré = PMO do form), sem Descrição; o padrão fica
  associado à PMO escolhida e aparece nas OPs dela.
- Dropdown de padrões mostra só o nome.
- Abrir "Nova OP" após salvar → form **limpo** (sem dados da OP anterior); abrir edição → dados da OP.
- Build limpo; nada de banco/RLS.

## Riscos / considerações
- **`key` no form + `useActionState`:** remontar o `<form>` reaplica `defaultValue` sem quebrar a action (o
  `formAction` vem do hook, estável no componente). Confirmar no build/smoke.
- **Auto-preencher na edição:** dispara só na **mudança** de PMO, não ao abrir — então editar uma OP não
  sobrescreve sozinho; só se a pessoa trocar a PMO (aí substitui, como pedido).
- **Coluna `descricao` do padrão** fica sem uso — deixada como está (sem migração); revisitar só se incomodar.
- Baixo risco: mudanças concentradas no `ordem-form.tsx` + `page.tsx`/`ordens-lista.tsx` (prop nova) + a
  action de salvar padrão; sem banco.
