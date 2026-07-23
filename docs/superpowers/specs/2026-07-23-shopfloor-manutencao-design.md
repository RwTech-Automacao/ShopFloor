# ShopFloor Processo — Manutenção — Design

## Objetivo

Migrar a tela de **Manutenção** (`appscript/manutencao.html` + seção Manutenção do `Código.gs`):
listar as **pendências de reparo** (peças reprovadas nos postos de origem) e **registrar o
conserto**. Com a Manutenção no ar, **liga o gate** definido pelo usuário: *Teste, Burn-in e Teste
Final só re-lançam uma peça reprovada depois de um reparo registrado.*

## Decisões (usuário, 2026-07-23)

1. **Postos de origem = Teste, Burn-in, Teste Final.** (**Diverge do legado**, que incluía Inspeção
   SMD/PTH — nessas, o retrabalho é "extra-máquina física" e fica fora da Manutenção; o
   re-lançamento delas continua liberado pela reprova.)
2. **Gate ativado:** re-lançamento em Teste/Burn-in/Teste Final passa a exigir **reparo registrado
   APÓS a última reprova naquele posto** (substitui a regra interina "reprovada libera").
3. **Burn-in** entra como origem (não existia no legado).

## Como funciona (modelo do legado, adaptado)

- **Pendência é derivada, não cadastrada:** cada reprova num posto de origem vira uma **ocorrência**
  — identidade `PMO|OP|SN|posto de origem|data/hora`; várias posições da mesma reprova são
  **agregadas** numa ocorrência só.
- **Status da ocorrência:** *Concluída* quando existe registro de **Manutenção** casando com ela;
  senão *Pendente*.
- **Registrar reparo:** seleciona a ocorrência → informa **N consertos** (descrição + posição) →
  grava **1 registro por conserto** (posto=`Manutenção`) carregando o defeito original + **posto de
  origem + data/hora de origem**. Um envio conclui a ocorrência inteira.

## Modelo de dados (migração `0033`)

- `sf_registros` ganha: `reparo_conserto text`, `reparo_posicao text`, `posto_origem text`,
  `data_hora_origem timestamptz` (as colunas que a spec original já previa para esta sub-feature).
- **Sem tabela nova** (pendências são consulta derivada).
- **`sf_registrar_reparo(...)`** — função atômica (security definer, perm `lancar`): insere 1
  registro por conserto com os campos acima.
- **`sf_lancar`** atualizada (`create or replace`, parâmetro novo `p_exige_manutencao boolean
  default false`): no re-lançamento de posto com status, se o último foi **Reprovado** e o posto
  exige manutenção → só libera se existir registro de Manutenção para a peça com
  `posto_origem = posto` e `data_hora` **posterior à última reprova**; senão erro `SEM_MANUTENCAO`
  ("A peça reprovou e precisa passar pela Manutenção antes de ser lançada de novo.").

## Domínio (TDD)

- `exigeManutencao(posto)` — true p/ Teste, Burn-in, Teste Final (lista
  `POSTOS_REPARO_VIA_MANUTENCAO` em `lancamento-linhas.ts`).
- `agruparPendencias(reprovas, reparos)` — puro: agrupa reprovas por ocorrência, agrega posições
  (sem duplicar), casa reparos (posto_origem + data/hora de origem) e marca Pendente/Concluída.

## Tela (`/shopfloor/manutencao` — operador, perm `lancar`; item "Manutenção" no menu Fluxo de Processos)

- **Filtros:** Cliente · PMO · OP · Status (Pendente/Concluída/todas) · período · SN.
- **Lista de ocorrências:** data · cliente · PMO/OP · SN · posto de origem · defeito (cód/tipo) ·
  posições · status. Ordenada da mais recente.
- **Registrar reparo** (nas pendentes): dialog com Colaborador (bipado) + **N consertos**
  (descrição + posição; adicionar/remover) → grava e a ocorrência vira Concluída.
- Log de auditoria (`registrarLog`, entidade `sf_reparo`, acao `criar`).

## Testes / Smoke

- TDD no agrupamento e na classificação.
- Smoke (script no Dev): reprovar peça no Teste → aparece Pendente → **re-lançar no Teste barra
  (SEM_MANUTENCAO)** → registrar reparo (2 consertos) → ocorrência Concluída → re-lançar no Teste
  **libera** → SMD reprovada NÃO aparece na lista e re-lança direto (regra 1b).

## Fora de escopo

Pesquisa/Grade, Dashboard. `manut_buscarSN` do legado (pré-preenchimento por SN) — a lista com
filtro por SN cobre o caso. Atualizar `docs/regras-de-negocio-shopfloor.md` faz parte da entrega.
