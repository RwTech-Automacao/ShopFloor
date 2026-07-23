# ShopFloor Processo — Pesquisa + Grade Geral — Design

## Objetivo

Migrar a tela de **Pesquisa** (`appscript/pesquisa.html` + `buscarDetalhadoPorNumeroSerie` +
`gerarTabelaGeral` do `Código.gs`): consulta em duas visões numa tela só —
1. **Busca por Nº de Série**: o histórico completo da peça (todos os registros, em ordem).
2. **Grade Geral**: a matriz **SN × postos** de uma OP — cada linha é um SN da faixa, cada coluna um
   posto do fluxo, cada célula o estado (Pendente / Aprovado / Reprovado / Registrado / nome da
   caixa / Concluído) — com **filtro por caixa**.

## Regras (fiéis ao legado, adaptadas ao nosso modelo)

**Busca por SN:** normaliza o SN e lista TODOS os `sf_registros` com aquele `numero_serie_norm`
(qualquer OP/cliente), ordenados por data. Colunas: data/hora, colaborador, posto, PMO/OP, status,
caixa, defeito (cód/posição/tipo), NQA (visual/funcional), ID integração, reparo (conserto/posição).

**Grade Geral (por OP):**
- **Linhas** = a faixa completa de SNs da OP (gerada de `sn_ini..sn_fim`: prefixo + bloco numérico
  com zero-padding + sufixo). **Guarda: faixa > 2.000 SNs → erro amigável** (evita OP mal
  configurada travar a tela; o legado não tinha guarda).
- **Colunas** = os postos **do fluxo daquela OP, na ordem** + coluna **Manutenção** ao final.
  (Melhoria sobre o legado, que mostrava as 12 colunas fixas com "Não aplicável" — no nosso modelo
  por-OP, só os postos que aplicam.)
- **Célula por posto** (a partir dos registros do SN naquele posto):
  - Sem registro → **Pendente**.
  - Posto sem status (Inicial, Montagem PTH, Integração, Extra máquina) → **Registrado**.
  - **Embalagem** → o **nome da caixa** (registrado sem caixa → Registrado).
  - Posto com status (incl. NQA, que grava o status derivado) → **Aprovado** se houver aprovado;
    senão **Reprovado**.
  - **Manutenção** → **Concluído** se houver reparo do SN na OP; senão **—**.
- Registros com SN fora da faixa/prefixo da OP são ignorados (como no legado).
- **Filtro por caixa**: select com as caixas da OP; filtra as linhas cuja célula Embalagem = caixa.

## Modelo / implementação

- **SEM migração** — só leitura de `sf_registros` + `sf_ordens`/fluxo.
- **Domínio (TDD):** `gerarFaixaSNs(snIni, snFim)` (com a guarda de 2.000) e
  `montarGrade(sns, postosDaOp, registros)` (a lógica de célula, pura).
- Cascata Cliente→PMO→OP da Grade inclui **todas** as OPs (ativas E finalizadas — consulta é
  histórica; o legado também não filtrava).
- Server actions: `buscarHistoricoSN(sn)` e `carregarGrade(pmo, op)` (busca registros da OP +
  fluxo + monta no domínio).

## Tela (`/shopfloor/pesquisa` — perm **`visualizar`**; item "Pesquisa" no menu Fluxo de Processos)

- Consulta é leitura → permissão `visualizar` (gestor vê sem precisar de `lancar`).
- Card **Busca por SN**: input bipável (Enter busca) → tabela do histórico.
- Card **Grade Geral**: cascata Cliente→PMO→OP + filtro de caixa → matriz (header fixo, célula
  colorida: Aprovado verde, Reprovado vermelho, Pendente cinza, caixa/Registrado neutro).

## Testes / Smoke

TDD no domínio (faixa + células). Smoke no Dev via preview: buscar um SN lançado; abrir a grade de
uma OP com lançamentos (ver células corretas); filtrar por caixa; OP sem faixa → mensagem.

## Fora de escopo

Dashboard; migração do histórico (18 abas); mover a busca da Integração pra cá (backlog — avaliar
depois que esta tela existir).
