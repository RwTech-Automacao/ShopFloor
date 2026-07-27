# ShopFloor Processo — Integração — Design

## Objetivo

Migrar a tela de **Integração** do webapp Apps Script (`integracao.html` + seção Integração do
`Código.gs`, em `appscript/`): vincular o **SN do produto final** aos **SNs das placas** que o
compõem — o elo de rastreabilidade produto↔componentes. Operador bipa o produto e as placas;
o sistema valida e grava o vínculo com um **ID** (`INT-...`). Inclui **busca por SN** (produto ou
placa → mostra a integração inteira) e — melhoria sobre o legado — **cancelamento** (admin).

## Como funciona no legado (fiel, confirmado no código)

- **Registrar** (`registrarIntegracao`): exige colaborador, cliente, PMO/OP do produto, SN do
  produto e ≥1 placa (cada uma com PMO/OP/SN). Valida: Integração **aplicável** à OP do produto;
  SN do produto **na faixa** da OP; produto **não integrado** em integração ATIVA; nenhuma placa
  **já vinculada** a integração ATIVA. Grava 1 linha no cabeçalho `INTEGRACAO_HDR` (ID, ATIVO) +
  na aba do cliente: **1 linha do produto + 1 por placa**, todas posto=`Integração` com o ID —
  a linha do produto é o que **satisfaz o gate de sequência** do Lançamento.
- **Buscar** (`buscarIntegracaoPorSN`): SN de produto (via HDR) ou de placa (via linhas) → devolve
  o cabeçalho + a lista completa (produto + placas). Só considera integrações ATIVAS.
- **Não existe cancelamento** no legado (o campo Status=ATIVO existe, mas nada o altera).
- Fidelidades mantidas: placa **não** valida faixa de SN; a Integração em si **não** exige posto
  anterior (o gate age sobre o posto seguinte do produto).
- Melhoria (bug do legado): o legado **não** barra a mesma placa repetida dentro do MESMO envio —
  nós barramos (SNs duplicados na lista, e produto aparecendo como placa).

## Modelo de dados (migração `0032`, com RLS)

- **`sf_integracoes`** (o cabeçalho): `id uuid pk`, `codigo` (`INT-aaaammdd-hhmmss-XXXX`, único,
  exibido ao usuário), `data_hora`, `colaborador`, `cliente`, `pmo`, `op`, `produto_sn`,
  `produto_sn_norm`, `qtd_placas`, `status` (`ATIVA` | `CANCELADA`), `cancelada_em`/`cancelada_por`
  (nullable). RLS: select=`visualizar`; escrita só via funções (security definer).
- **`sf_integracao_itens`** (o vínculo durável das placas): `integracao_id fk`, `placa_pmo`,
  `placa_op`, `placa_sn`, `placa_sn_norm`. Sobrevive ao cancelamento (auditoria).
- **`sf_registros`** ganha coluna **`id_integracao text`** (o `codigo`): no registrar, gravamos
  **1 registro do produto + 1 por placa** (posto=`Integração`, com o código) — igual ao legado;
  é o que alimenta o gate do Lançamento e, no futuro, Grade/Dashboard/Pesquisa.

## Funções no banco (atômicas, padrão `sf_lancar`)

- **`sf_integrar(...)`** — advisory lock; checa produto não-integrado (ATIVA) e placas não-vinculadas
  (itens de integrações ATIVAS); insere HDR + itens + registros (produto + placas). Devolve
  `{ok, codigo}` ou `{ok:false, erro: 'PRODUTO_JA_INTEGRADO...' | 'PLACA_JA_VINCULADA...'}`.
  Guarda `tem_permissao('lancar')`. (Validações puras — aplicabilidade, faixa do produto, lista de
  placas — rodam antes, em TS, reusando o domínio.)
- **`sf_cancelar_integracao(codigo)`** — advisory lock; marca `CANCELADA` (+quem/quando) e **apaga
  os `sf_registros`** daquela integração (produto + placas) → o gate volta a travar e os SNs ficam
  livres pra re-integrar; HDR + itens ficam como histórico. Guarda `tem_permissao('administrar')`.

## Tela (`/shopfloor/integracao` — operador; item "Integração" no menu Fluxo de Processos, perm `lancar`)

Nosso design (Enterplak), espelhando o legado:
- **Contexto:** Colaborador (bipado) · Cliente → PMO → OP (do produto, cascata; só OPs com
  Integração aplicável no fluxo) · Descrição (auto).
- **Placas:** tabela com 1 linha por placa — PMO (select) · OP (select, cascata) · Descrição (auto)
  · **SN da placa** (bipado). Botões: **+ Adicionar linha**, **Gerar N linhas** (qtd + botão),
  **Limpar**. (Teto de 200 linhas, como no Coletivo.)
- **Produto Final:** SN (bipado, campo grande) + botão **Registrar Integração**.
- Sucesso: toast com o **código INT-...**, limpa e devolve o foco.
- **Busca na mesma tela:** campo SN (produto ou placa) → mostra o cabeçalho (código, quem/quando,
  produto, qtd) + a lista (produto + placas). Se o usuário tem `administrar`, aparece o botão
  **Cancelar integração** (com confirmação); cancelada → some da busca padrão.
- Validação no cliente espelha o servidor (obrigatórios, faixa do produto, duplicatas na lista).

## Permissões

- **Registrar/buscar:** `lancar` (tela de operador).
- **Cancelar:** `administrar`.
- Logs de auditoria via `registrarLog` (`sf_integracao`: criar / excluir=cancelar).

## Testes

- **TDD** no domínio puro novo: `validarItensIntegracao` (todas as linhas com PMO/OP/SN; sem SN
  duplicado na lista; produto não pode aparecer como placa).
- Smoke (via preview/Dev): registrar integração com 2 placas → buscar pelo produto e por uma placa
  → tentar re-integrar o produto (barra com o código) → tentar reusar uma placa (barra) → lançar o
  posto seguinte do produto no Lançamento (gate liberado) → cancelar (admin) → gate volta a travar
  e produto/placas re-integráveis.

## Fora de escopo

Manutenção, Pesquisa/Grade, Dashboard (próximas). Validação de faixa das placas (legado não faz).
