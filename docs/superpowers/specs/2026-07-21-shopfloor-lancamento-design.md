# ShopFloor Processo — Fundação + Lançamento — Design

## Objetivo

Recriar no ShopFloor (nosso app web) o **coração da rastreabilidade** que hoje roda em Google
Apps Script + Google Sheets: o **Lançamento** — o registro de cada peça (por **Nº de Série**) ao
passar por cada **posto** da linha de montagem, por **PMO/OP**. Esta primeira fatia do módulo
entrega a **fundação de dados** (OPs, postos, defeitos, registros) + a **tela de Lançamento**
(operador) + o **cadastro de OPs** (PCP). Princípio da Fase 1: **copiar e deixar funcional**;
integração/otimização vêm depois.

## Contexto (sistema atual)

- Webapp Apps Script (`Código.gs` + `formulario.html`) sobre a planilha `ShopFloor WebApp.xlsx`:
  - `PMO_OPS` (989 OPs): PMO, Nº OP, Qtd, Descrição, ACP, Cliente, Status, **Padrão SN / Padrão
    SN final** (a faixa), e colunas **SIM/NÃO de aplicabilidade** de cada posto.
  - `Defeitos` (~1000): Código do Defeito + Tipo (1 ou 2).
  - **18 abas de cliente** = os registros (SN × posto). `INTEGRACAO_HDR`, `Manutencao` (futuras).
- A complexidade atual é sobretudo **da planilha**: `LockService` contra corrida, uma aba por
  cliente, "adivinhar" índice de coluna pelo cabeçalho, espelho em "Registros". No **Postgres**
  isso vira tabelas + **transações** + **constraints** — mesmo comportamento, mais robusto.
- **Layout:** segue o **design do nosso app** (paleta Enterplak, mesmos componentes/padrões do
  módulo Recebimento) — consistência de sistema, **não** o azul do Apps Script. A tela de
  Lançamento é otimizada pro chão de fábrica (campos grandes, **foco automático no Nº de Série**
  pro leitor/bipagem).

## Escopo desta fatia

- **DENTRO:** modelo de dados; migração de **OPs ativas + defeitos**; **cadastro de OP** (PCP);
  **Lançamento** (operador) com os 10 postos do dropdown e todas as regras de submit.
- **FORA (próximas sub-features):** Grade Geral, Dashboard, Integração, Manutenção, Pesquisa, o
  **histórico de registros** (as 18 abas), e o refino do Colaborador (vira log de usuário depois).

## Modelo de dados (Postgres, com RLS)

- **`sf_postos`** — catálogo dos postos (chave, rótulo, ordem no fluxo). Seed fixo dos 12 na ordem:
  Inicial, Inspeção SPI, Inspeção SMD, Montagem PTH, Inspeção PTH, Teste, Integração, Teste Final,
  Inspeção Final, Embalagem, Inspeção NQA, Manutenção. (O Lançamento usa os **10** do dropdown;
  Integração e Manutenção existem no catálogo pro **gate de sequência**, mas têm telas próprias.)
- **`sf_defeitos`** — código (texto), tipo (`1` peça | `2` teste). Migrado (~1000). Admin edita.
- **`sf_ordens`** — a OP: `pmo`, `op`, `cliente`, `qtd`, `descricao`, `acp`, `status`, `sn_ini`,
  `sn_fim`. **Único (pmo, op).**
- **`sf_ordem_postos`** — aplicabilidade: (ordem_id, posto) = quais postos aplicam à OP. A tela de
  cadastro liga/desliga. (Normalizado; substitui as colunas SIM/NÃO da planilha.)
- **`sf_registros`** — o evento **SN × posto** (o coração): `data_hora`, `colaborador`, `posto`,
  `pmo`, `op`, `cliente`, `numero_caixa`, `qtd_por_caixa`, `status`, `numero_serie`,
  `numero_serie_norm` (normalizado p/ comparação/duplicidade), `codigo_defeito`, `posicao`,
  `tipo_defeito`, `nqa_visual`, `nqa_funcional`. (`id_integracao` e `reparo_*` ficam pras
  sub-features de Integração/Manutenção.)
  - Índices p/ as regras: por (`pmo`,`op`,`numero_serie_norm`) e por (`pmo`,`op`,`posto`,
    `numero_caixa`). Constraint/consulta na transação garante a anti-duplicidade.

## Regras de submit (Server Action — autoritativas no servidor)

Reproduz o `_enviarFormularioComContagem_` do `Código.gs`. As validações puras (obrigatórios, faixa de
SN, posto aplicável) rodam **no servidor em TS** (reusando o domínio do Plano A) para feedback rápido; as
checagens **sensíveis a corrida** (anti-duplicidade, sequência, caixa) + a gravação acontecem numa
**função no banco (`sf_lancar`, plpgsql)** com **advisory lock por (pmo, op)** — substitui o `LockService`
do Apps Script, garantindo atomicidade (sem janela de corrida). É uma migração nova.
1. **Config da OP** (cliente, faixa de SN, aplicabilidade) — de `sf_ordens`/`sf_ordem_postos`.
2. **Obrigatórios por posto:** Inicial/Montagem PTH → colaborador, posto, pmo, op, SN. Embalagem →
   + nº caixa + qtd por caixa. NQA → + visual + funcional. SPI → + status (reprovado: ≥1 posição).
   Demais (SMD, PTH, Teste, Teste Final, Inspeção Final) → + status (reprovado: cód + posição +
   tipo).
3. **Faixa de SN:** o SN precisa estar entre `sn_ini` e `sn_fim` (parse prefixo+dígitos+sufixo).
4. **Posto aplicável:** o posto tem que aplicar à OP.
5. **Trava de sequência:** o **posto anterior aplicável** precisa estar concluído — *registrado*
   p/ Inicial/Montagem/Integração/Embalagem; *aprovado* p/ NQA e demais.
6. **Anti-duplicidade / re-lançamento** por posto (olha o último registro daquela peça —
   pmo+op+numero_serie_norm — naquele posto). Princípio: **aprovado nunca repete o posto**.
   - **Sem status** (Inicial, Montagem PTH, Integração, Embalagem): registra 1× só; barra duplicado.
   - **Inspeção SMD / Inspeção PTH**: re-lança se a última foi **reprovada** (retrabalho "extra-máquina" é
     físico, fora do sistema); aprovada → barra.
   - **Teste / Teste Final**: idem interino (re-lança se reprovada) — o gate de "passou por Manutenção"
     entra quando o módulo Manutenção existir; aprovada → barra.
   - **Inspeção SPI / Inspeção Final / NQA** (PROVISÓRIO, aguardando confirmação): mesma regra — aprovado
     barra, reprovado libera.
7. **Caixa (Embalagem):** conta peças na caixa (mesma PMO/OP/caixa); se ≥ limite → erro "caixa
   cheia"; grava e **devolve a contagem** pós-envio.
8. **Gravação:** 1 registro; Reprovado com múltiplos defeitos → **1 registro por defeito**; SPI
   reprovado → **1 registro por posição**. Status normalizado (capitalizado; vazio nos postos
   sem status).

A lógica pura (parse/faixa de SN, gate de sequência, obrigatórios por posto, limite de caixa,
normalização de SN) vira **domínio testável com TDD** — como no Recebimento.

## Telas

### Lançamento (`/shopfloor/lancamento` — operador)
Reproduz o `formulario.html` no nosso design:
- **Contexto/login:** Colaborador (texto **bipado**), Posto (10 opções), **Cliente → PMO → OP**
  (selects em cascata), Descrição (auto, read-only), + Nº da Caixa / Qtd por Caixa quando
  Embalagem.
- **Form dinâmico por posto:** Status (some em Inicial/Montagem/Embalagem/NQA), **Nº de Série**
  (foco automático, scanner-friendly), **defeitos múltiplos** (código via lista por tipo +
  posição + tipo, quando Reprovado), SPI (só posição na reprova), NQA (visual + funcional).
- **Validação no cliente** (espelha o servidor p/ feedback rápido): faixa de SN, posto aplicável,
  obrigatórios; o botão Enviar só habilita quando válido.
- **Após enviar:** mensagem de sucesso (+ "peças na caixa X: N" na Embalagem), limpa e devolve o
  **foco pro Nº de Série** (fluxo de bipagem contínuo).

### Cadastro de OP (`/shopfloor/ordens` — PCP/admin)
CRUD das OPs: criar/editar `pmo`, `op`, `cliente`, `qtd`, `descricao`, `acp`, `status`, faixa de
SN, e os **toggles de quais postos aplicam**. Restrito a admin/PCP (guard próprio de `administrar`).

**Menu:** o ShopFloor Processo é um **módulo principal** — seção própria "Fluxo de Processos" no menu
lateral (accordion, como o Recebimento), NÃO dentro de Configurações. A seção agrupa o Cadastro
de OP (admin) e o Lançamento (operador); cada item filtra pela sua permissão.

## Migração (script único; o controller roda no Dev primeiro)

Lê a `ShopFloor WebApp.xlsx`: popula `sf_defeitos` (todos) e `sf_ordens` + `sf_ordem_postos` (as
**ativas** = Status ≠ FINALIZADA). Resolve a inconsistência da coluna **[18]** (o header diz
"Integração", o `código.gs` trata como "Inspeção SPI") conferindo os dados reais. **Não** migra o
histórico de registros (fica pras sub-features que o exibem).

## Permissões (RLS — reusa o modelo de perfis existente)

- **Lançar** (criar registro): nova permissão de operador/produção (ex.: `lancar`). A estação faz
  login no app (compartilhada); o Colaborador bipado identifica quem operou.
- **Cadastro de OP:** `administrar` (ou perfil PCP).
- Definir as permissões novas no cadastro de perfis existente.

## Testes

- **TDD** no domínio puro: parse/faixa de SN, normalização de SN, gate de sequência (posto
  anterior aplicável), obrigatórios por posto, limite de caixa.
- **Sem TDD** na UI; garantia por tsc + lint + build + **smoke no Dev**.
- **Smoke:** cadastrar uma OP (com faixa de SN + postos); lançar um SN em Inicial; tentar Teste
  sem o posto anterior (deve **travar**); lançar SN fora da faixa (deve **barrar**); Embalagem
  respeitando o limite da caixa (e mostrando a contagem); NQA (visual+funcional); Reprovado com
  defeitos múltiplos (1 linha por defeito); duplicado no mesmo posto (deve **barrar**).
