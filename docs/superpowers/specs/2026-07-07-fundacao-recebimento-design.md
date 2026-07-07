# Design — ShopFloor Enterplak: Fundação + Módulo de Recebimento

**Data:** 2026-07-07
**Status:** Aprovado para planejamento
**Escopo desta entrega:** Incremento 0 (Fundação) + Incremento 1 (Recebimento)

---

## 1. Contexto e objetivo

Sistema web modular de **Shop Floor** para uma indústria de manufatura eletrônica
(Enterplak). Objetivo: digitalizar, centralizar e otimizar processos hoje feitos em
planilhas Excel, Google Forms e scripts em Google Apps Script.

Uso em **produção**, por múltiplos setores, com arquitetura preparada para crescer
por anos. Prioridade explícita: **implementação correta sobre implementação rápida**.

### Decomposição em incrementos

| Incremento | Conteúdo | Situação |
|---|---|---|
| **0 — Fundação** | Auth Supabase, perfis/RBAC configurável, layout base, schema, logs imutáveis, listas e campos configuráveis | Neste spec |
| **1 — Recebimento** | Wizard de importação, ciclo de vida do Processo, formulário digital, histórico | Neste spec |
| **2 — Etiquetas** | Geração de CSV de Part Number (regras do Apps Script atual), histórico de gerações | Spec futuro |

O Comercial **continua usando sua planilha atual** — o sistema se adapta a ela, sem
exigir mudança de rotina daquele setor.

---

## 2. Stack e hospedagem

- **Frontend/BFF:** Next.js (App Router) + TypeScript (strict)
- **UI:** Tailwind CSS + shadcn/ui, tema com identidade Enterplak (primária `#8D2033`)
- **Backend/dados:** Supabase (Postgres + Auth + RLS)
- **Parsing de planilha:** SheetJS (client-side)
- **Testes:** Vitest (foco em `domain/` e `application/`)
- **Qualidade:** ESLint + Prettier, migrations SQL versionadas
- **Hospedagem:** Vercel (app) + Supabase Cloud (banco)

---

## 3. Arquitetura

### 3.1 Camadas (decisão central)

Separação estrita entre **negócio** e **infraestrutura**. Next.js e Supabase são
detalhes de entrega/persistência e não podem contaminar as regras de domínio.

```
app/  (Next App Router)          → UI + Server Actions finos      [entrega]
modules/<feature>/application/    → casos de uso (orquestração)    [aplicação]
modules/<feature>/domain/         → entidades, regras, máquina     [negócio — TS puro]
                                     de estados (sem Supabase/Next)
modules/<feature>/infra/          → repositórios (Supabase)        [infra]
Supabase: Postgres + RLS + Auth
```

O `domain/` é TypeScript puro (não importa Supabase nem React) → testável
isoladamente e protegido de troca de tecnologia. Server Actions ficam finos:
autenticam, chamam um caso de uso, retornam.

### 3.2 Estrutura de pastas (monólito modular, por feature)

```
src/
  app/
    (auth)/login/
    (app)/
      home/
      recebimento/
        importar/          # wizard 4 passos
        processos/         # lista + [id] detalhe/form
      configuracoes/
        usuarios/  perfis/  listas/  campos/  importacoes/  logs/  sobre/
  modules/
    recebimento/{domain,application,infra}
    auth/       {domain,application,infra}
    logs/       {domain,application,infra}
    listas/     {domain,application,infra}
    configuracao/{domain,application,infra}
  shared/
    ui/                    # design system (wrappers shadcn + tema Enterplak)
    lib/supabase/          # clients: browser | server | service-role
    lib/  types/
supabase/
  migrations/              # SQL versionado (fonte da verdade do schema)
  seed.sql
```

Cada módulo é uma fatia vertical independente. Adicionar Etiquetas no futuro =
adicionar `modules/etiquetas/` + rotas, sem tocar no resto.

### 3.3 Modelo de segurança (defesa em profundidade)

- **Autenticação:** Supabase Auth (e-mail/senha).
- **Autorização real no banco (RLS):** toda tabela com Row Level Security. A
  permissão é decidida no Postgres a partir do perfil do usuário. A UI apenas
  esconde/desabilita; **o banco é o portão real**.
- **Três clients Supabase:** *browser* (leitura sob RLS), *server* (ações do
  usuário sob RLS), *service-role* (só em código de servidor confiável — logs e
  operações controladas).
- **Funções `SECURITY DEFINER`** leem as flags de permissão do perfil atual para
  as políticas RLS (ex.: `pode_finalizar()`, `pode_administrar()`).
- **Logs imutáveis por construção:** RLS nega `UPDATE`/`DELETE` na tabela de logs
  para todos os perfis + trigger de reforço.

---

## 4. Modelo de dados

### Diagrama

```
auth.users ─1:1─ usuarios ─N:1─ perfis
                    │
                    ├─1:N─ importacoes ─1:N─ processos_recebimento
                    │                              │ (campos de lista → validação)
listas ─1:N─ lista_itens ◄───────────────────────┘
configuracao_campos  (metadados/obrigatoriedade dos campos do processo)
logs  ◄── (polimórfico: entidade + entidade_id) ── todas as entidades
```

### 4.1 `perfis` — RBAC configurável

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| nome | text | Administrador, Supervisor, Recebimento, Consulta |
| pode_visualizar | boolean | |
| pode_importar | boolean | |
| pode_editar | boolean | editar processos abertos/em conferência |
| pode_finalizar | boolean | |
| pode_editar_finalizado | boolean | editar/reabrir processo finalizado |
| pode_excluir | boolean | |
| pode_gerar_etiqueta | boolean | (uso no incremento 2) |
| pode_administrar | boolean | usuários, perfis, listas, campos |
| sistema | boolean | true = perfil base, não excluível |

Permissões são **flags no banco**, editáveis pela tela *Configurações › Perfis*.
As políticas RLS leem essas flags → permissão muda **sem deploy**.

### 4.2 `usuarios`

`id (=auth.users.id)`, `nome`, `email`, `perfil_id → perfis`, `ativo`,
`created_at`, `updated_at`.

### 4.3 `listas` + `lista_itens` — listas administráveis

- **`listas`**: `id`, `chave` (slug único: `tipo`, `resultado`, `tipo_entrega`,
  `fornecedor`, `comprador`, …), `nome`, `descricao`, `sistema` (bool).
- **`lista_itens`**: `id`, `lista_id → listas`, `valor`, `ordem`, `ativo`,
  `created_at`.

Criar uma lista nova = inserir linhas — **zero código**. Desativar um item preserva
registros históricos (ver 4.5).

### 4.4 `configuracao_campos` — metadados/obrigatoriedade dos campos do processo

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| campo | text único | chave técnica (ex.: `numero_nf`) — mapeia a uma coluna real de `processos_recebimento` |
| rotulo | text | rótulo exibido no formulário e no mapeamento |
| grupo | text | `comercial` / `material` / `recebimento` / `qualidade` |
| tipo | text | **editável pelo Admin**: `texto` / `lista` (dropdown). `numero` / `data` reservados a campos estruturais |
| lista_chave | text nulo | quando `tipo=lista`, aponta para `listas.chave` |
| obrigatorio_importacao | boolean | valida no passo de importação |
| obrigatorio_finalizacao | boolean | valida ao finalizar |
| origem | text | `comercial` (mapeável na importação) / `recebimento` (preenchido no formulário) |
| ordem | int | ordem no formulário |
| ativo | boolean | |

Configurável pelo Admin em *Configurações › Campos*. **Não** cria/remove colunas do
banco — apenas governa comportamento (obrigatoriedade, rótulo, ordem, origem e o
**tipo de apresentação** do campo) sobre colunas fixas.

> **Tipo de campo configurável:** o Admin alterna um campo da "família texto" entre
> `texto` (livre) e `lista` (dropdown) sem migração — ambos são gravados como
> valor-texto. O conjunto de tipos é **extensível** no futuro (ex.: `sim_nao`,
> `multipla_escolha`, `calculado`) adicionando um novo valor + renderizador, sem
> alterar o schema. Campos estruturalmente numéricos/data permanecem tipados no
> banco (para filtros e cálculos corretos) e não trocam de tipo. Evita virar
> "form builder" dinâmico, mantendo integridade e manutenção sã.

### 4.5 `processos_recebimento` — o coração (1 processo = 1 material)

Campos definitivos, conforme a planilha de controle real. `origem = comercial`
significa que o valor **vem da planilha do Comercial** (mapeável na importação);
`origem = recebimento` é preenchido no formulário digital.

**Identidade / auditoria** (colunas de sistema, não editáveis pelo usuário):
`id`, `numero` (sequencial simples e global), `importacao_id → importacoes` (nulo se
criado manualmente), `status` (`aberto`/`em_conferencia`/`finalizado`/`cancelado`),
`criado_por`, `atualizado_por`, `finalizado_por`, `finalizado_em`, `cancelado_por`,
`motivo_cancelamento`, `created_at`, `updated_at`.

**Campos do Comercial** (`origem = comercial`)
| coluna | tipo DB | apresentação padrão |
|---|---|---|
| `numero_nf` | text | texto |
| `numero_emb` | text | texto |
| `di_inpi` | text | texto |
| `acp_cliente` | text | texto |
| `numero_pedido` | text | texto |
| `data_chegada` | date | data |
| `data_compra` | date | data |
| `data_prevista` | date | data |
| `atraso` | text | lista (configurável) |
| `tipo` | text | lista |
| `comprador` | text | lista |
| `fornecedor` | text | lista |
| `critico` | text | lista (ex.: Sim/Não) |
| `codigo_material` | text | texto — código curto (ex.: CON604) |
| `descricao_material` | text | texto — descrição (ex.: .CONECTOR HEADER…) |
| `quantidade_pedido` | numeric | número |

**Campos do Recebimento** (`origem = recebimento`, preenchidos no formulário)
| coluna | tipo DB | apresentação padrão |
|---|---|---|
| `quantidade_recebida` | numeric | número |
| `volumes` | integer | número (base para sequenciamento de etiquetas — Increm. 2) |
| `divergencia` | text | lista (configurável) |
| `responsavel_contagem` | text | texto/lista |
| `tipo_entrega` | text | lista |
| `amostral` | text | lista |
| `part_number_recebido` | text | texto |
| `inscricoes` | text | texto/lista |
| `fabricante` | text | texto/lista |
| `medida_eletrica` | text | texto/lista |
| `coloracao` | text | texto/lista |
| `dimensional` | text | texto/lista |
| `impressoes` | text | texto/lista |
| `data_validade` | date | data |
| `revisao` | text | texto/lista |
| `material` | text | texto/lista |
| `resultado` | text | lista (ex.: Aprovado/Reprovado) |
| `quantidade_reprovada` | numeric | número |
| `motivo_reprovacao` | text | texto/lista |
| `rnc` | text | texto |
| `rac` | text | texto |
| `observacao` | text | texto |

> **Snapshot de listas:** todo campo apresentado como `lista` grava o **valor-texto**
> escolhido, validado contra os itens *ativos* da lista na gravação. Se o item for
> renomeado/desativado depois, o processo mantém o valor original — essencial para
> registro finalizado e auditável. A apresentação `texto`↔`lista` de cada campo da
> "família texto" é definida em `configuracao_campos` (ver 4.4) e pode ser trocada
> pelo Admin sem migração.

### 4.6 `importacoes` — histórico/auditoria de importações

`id`, `arquivo_nome`, `formato` (xlsx/csv), `total_linhas`,
`total_processos_criados`, `mapeamento (jsonb)` (de-para coluna→campo usado),
`usuario_id`, `created_at`.

### 4.7 `logs` — trilha de auditoria imutável (polimórfica)

`id`, `entidade` (`processo`/`importacao`/`usuario`/`perfil`/`lista`/`campo`/`etiqueta`),
`entidade_id`, `acao` (`criar`/`importar`/`alterar_campo`/`mudar_status`/
`gerar_etiqueta`/`excluir`/`login`), `descricao`, `dados (jsonb)` (snapshot
antes→depois), `usuario_id`, `usuario_nome` (snapshot), `created_at`.

Append-only: RLS nega `UPDATE`/`DELETE` para todos + trigger de reforço.

---

## 5. Módulo de Recebimento

### 5.1 Wizard de importação (4 passos)

1. **Selecionar arquivo** — drag & drop `.xlsx`/`.csv` (máx. 20 MB). Parsing
   **no navegador** (SheetJS): lê colunas e linhas localmente. O arquivo bruto não
   é enviado ao servidor — só dados estruturados + mapeamento seguem na confirmação.
2. **Mapear colunas** — tabela *coluna da planilha → campo do sistema*. O sistema
   **sugere** por similaridade de nome, mas nada é fixo: o usuário confirma
   manualmente a cada importação. Bloqueia avançar se um campo
   `obrigatorio_importacao` não foi mapeado.
3. **Pré-visualização** — mostra as primeiras linhas já convertidas, destacando
   erros (quantidade não-numérica, data inválida, valor fora da lista) antes de
   qualquer gravação.
4. **Importar** — transação atômica via função Postgres (RPC)
   `importar_processos(mapeamento, linhas)`: cria 1 `importacao` + N
   `processos_recebimento` (status `aberto`) + logs. Tudo entra ou nada.

Apenas campos com `origem = comercial` aparecem como destino no mapeamento.

**Obrigatoriedade de campos** governada por `configuracao_campos`:
- *para importar*: campos com `obrigatorio_importacao = true` (padrão inicial:
  `numero_pedido`, `codigo_material`, `descricao_material`, `quantidade_pedido`);
- *para finalizar*: campos com `obrigatorio_finalizacao = true`.

Ambos ajustáveis pelo Admin sem alterar código.

### 5.2 Ciclo de vida (máquina de estados no `domain/`)

```
 (novo) ──[importar/criar]──► ABERTO ──[editar/salvar]──► EM_CONFERÊNCIA ──[Finalizar]──► FINALIZADO
                                │                              │                             │ (bloqueado)
                                └──────────[Cancelar]──────────┘                             │
                                                                    FINALIZADO ──[Reabrir]──► EM_CONFERÊNCIA
                                                                    (só Supervisor/Admin)
```

- **Finalizar** valida os obrigatórios de finalização, grava
  `finalizado_por`/`finalizado_em` e bloqueia edição.
- **Finalizado** é somente-leitura, exceto Supervisor/Admin (podem Reabrir —
  transição logada).
- **Cancelar** exige justificativa (`motivo_cancelamento`), registrada em log.
- Toda transição validada no domínio **e** reforçada por RLS.

### 5.3 Formulário digital & log de alterações

- Seções derivadas do `grupo` em `configuracao_campos` (*Comercial*, *Material*,
  *Recebimento*, *Qualidade*), com campos renderizados/ordenados por `ordem` e `tipo`.
- Campos de lista → selects populados de `lista_itens` ativos; campos de texto →
  inputs; conforme o `tipo` configurado.
- Salvamento parcial permitido enquanto `aberto`/`em_conferencia`.
- Cada save calcula o *diff* no servidor e grava logs `alterar_campo` com
  `{campo, de, para}`.

### 5.4 Matriz de permissões (mapeia para as flags de `perfis`)

| Ação | Admin | Supervisor | Recebimento | Consulta |
|---|:--:|:--:|:--:|:--:|
| Visualizar | ✓ | ✓ | ✓ | ✓ |
| Importar | ✓ | ✓ | ✓ | — |
| Editar (aberto/em conf.) | ✓ | ✓ | ✓ | — |
| Finalizar | ✓ | ✓ | ✓ | — |
| Editar/Reabrir finalizado | ✓ | ✓ | — | — |
| Excluir | ✓ | ✓ | — | — |
| Administrar (usuários/perfis/listas/campos) | ✓ | — | — | — |

---

## 6. Configurações (telas)

- **Usuários** — CRUD + atribuição de perfil.
- **Perfis** — edição das flags de permissão.
- **Listas** — CRUD de listas e itens (reordenar, desativar).
- **Campos** — obrigatoriedade, rótulo, ordem e lista associada de cada campo do processo.
- **Importações** — histórico.
- **Logs** — consulta filtrável, **somente leitura**.
- **Sobre o Sistema** — versão e informações.

---

## 7. Tratamento de erros

- Erros de importação exibidos na pré-visualização, por linha/campo, antes de gravar.
- Importação transacional (tudo ou nada) via RPC.
- Server Actions retornam resultado tipado (sucesso/erro) → toasts na UI.
- Validações de domínio (transições de estado, obrigatoriedade) executadas no
  servidor, independentemente da UI.

---

## 8. Testes

- **Vitest** no `domain/` e `application/`: máquina de estados, validação de
  mapeamento, obrigatoriedade por estágio, regras de transição.
- TDD nas regras de negócio (onde bugs custam caro).
- Migrations e políticas RLS verificadas em ambiente Supabase local.

---

## 9. Fora de escopo (desta entrega)

- Módulo de Etiquetas (Incremento 2).
- Integração automática com máquinas da linha (SMT/AOI/fornos).
- Fornecedor/Comprador como entidades ricas (CNPJ, contato) — hoje são listas
  configuráveis; podem "graduar" para tabelas próprias em incremento futuro.

---

## 10. Pendências / ativos

- ✅ Planilha do Comercial recebida (`EMB341EA - ESTADOS UNIDOS.xlsx`). Cabeçalhos
  reais: `Utilização, Tracking, Número, Nome, Código, Descrição, Quantidade, Unidade,
  NCM, Preço Moeda Estrangeira, Total do Item, Total Invoice, Invoice, Projetos,
  Data prevista para entrega do item, Data de entrega do item, Data prevista do
  embarque, Booking, Carga em trânsito`. São genéricos e **não** coincidem com os
  nomes internos — o que confirma a necessidade do mapeamento manual.
- ✅ Lista definitiva dos campos do Processo (15 do Comercial + 22 do Recebimento),
  refletida na seção 4.5.
- 📜 **Google Apps Script atual de etiquetas** — necessário para o Incremento 2.
- Projeto Supabase já criado; tabelas ainda não existem (serão criadas por migrations).

### Valores de listas a definir (seed) com o setor de Recebimento

Antes do go-live será necessário popular os itens de: `tipo`, `resultado`,
`tipo_entrega`, `fornecedor`, `comprador`, `atraso`, `critico`, `divergencia`,
`amostral` e demais campos que o Admin marcar como `lista`. Não bloqueia o
desenvolvimento (as listas são administráveis pela própria tela).
