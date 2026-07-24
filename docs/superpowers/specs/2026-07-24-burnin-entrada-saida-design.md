# Burn-in com entrada/saída + tempo — Design

> O posto Burn-in passa a registrar entrada e saída, com cálculo de duração e um painel
> "em andamento" ao vivo. Decidido com o usuário em 2026-07-24.

## Contexto
Burn-in é um posto **novo nosso** (não existe no legado). Hoje é "com status" (Aprovado/Reprovado)
e a reprova exige Manutenção. Registros são **imutáveis** (Fase 1: sem update/delete) e têm
`data_hora`. O usuário quer medir **quanto tempo a peça ficou no Burn-in** (processo cronometrado).

## Decisões (usuário, 2026-07-24)
1. **2 registros por ciclo:** um na **entrada**, um na **saída** (não editar 1 registro → respeita a imutabilidade).
2. **Sinalização explícita:** no Lançamento com posto=Burn-in, seletor **Entrada / Saída**.
3. **Status:** entrada é **neutra** (`status=''`); **saída** carrega **Aprovado/Reprovado**.
4. **Visualização:** **painel "Burn-in em andamento"** ao vivo (peças com entrada aberta + tempo
   decorrido) **+** duração no histórico (Pesquisa).
5. **Sem tempo-alvo/limite** por agora — só informativo.
6. **Peça aprovada no Burn-in não re-entra**; reprovada re-entra **só após Manutenção** (gate atual).

## Modelo (sem migração na `sf_registros`)
Os dois registros se distinguem pelo **status**, que já existe:
- **Entrada** = registro `posto='Burn-in'`, `status=''`.
- **Saída** = registro `posto='Burn-in'`, `status ∈ {Aprovado, Reprovado}` (+ 1 registro por defeito se reprovado).
- **Ciclo aberto** = o **último** registro de Burn-in da peça (`pmo,op,numero_serie_norm`) é uma entrada (`status=''`).
- **Duração** de um ciclo = `saída.data_hora − entrada.data_hora`. **Aberto** → `agora − entrada.data_hora`.

## Regras (na função atômica — corrida)
Burn-in tem lifecycle próprio → **RPC dedicada `sf_burnin`** (isola risco; **não** mexe no
`sf_lancar` genérico, que já teve bug de overload). O Lançamento roteia: posto=Burn-in → `sf_burnin`;
demais → `sf_lancar`.

- **Entrada** (`p_evento='entrada'`):
  - **Sequência:** o posto anterior do fluxo deve estar satisfeito p/ a peça (igual ao `sf_lancar`).
  - **Bloqueios:** se já há **entrada aberta** → `JA_DENTRO`; se o último ciclo terminou **Aprovado** →
    `JA_APROVADO` (não re-entra); se terminou **Reprovado** → exige **Manutenção** após a reprova,
    senão `SEM_MANUTENCAO` (gate atual).
  - Grava **1 registro** Burn-in `status=''`.
- **Saída** (`p_evento='saida'`):
  - Exige **entrada aberta** (último Burn-in é `status=''`), senão `SEM_ENTRADA`.
  - Grava **1 registro** Burn-in com `status` (Aprovado/Reprovado); reprovado → **1 registro por defeito**
    (código+posição+tipo obrigatórios, como nos demais "com status").
- **Posto seguinte** do fluxo: exige **saída Aprovado** — funciona pelo gate genérico já existente
  (`exists(... posto='Burn-in' and status='aprovado')`); entrada (`status=''`) não satisfaz. ✅

## Telas
- **Lançamento** (`/shopfloor/lancamento`): posto=Burn-in mostra o seletor **Entrada/Saída**. Entrada
  esconde status/defeitos; Saída mostra Aprovado/Reprovado (+ defeitos se reprovar). Mensagens novas:
  `JA_DENTRO`, `JA_APROVADO`, `SEM_ENTRADA` (+ reusa `SEM_MANUTENCAO`, `SEQUENCIA`).
- **Painel "Burn-in em andamento"** (novo, `/shopfloor/burn-in`, perm `visualizar`): tabela das peças
  com **entrada aberta** (cliente/PMO/OP/SN, hora de entrada, **tempo decorrido ao vivo** — relógio no
  cliente, atualiza sozinho a cada minuto). Ordena por mais antigo primeiro. Item no menu "Fluxo de
  Processos". Recarrega ao abrir (auto-refresh opcional depois).
- **Pesquisa** (histórico da peça): para os pares de Burn-in, exibir a **duração** do ciclo
  (ou "há X" se aberto) além dos eventos.
- **Grade**: célula de Burn-in com entrada aberta → **"Em andamento"**; com saída → Aprovado/Reprovado.

## Domínio (puro, testável)
- `pareaBurnin(registros)` — dado os registros de Burn-in de uma peça (ordenados), parear entrada↔saída,
  devolver ciclos `{entrada, saida?, duracaoMin?}` e o estado aberto. (TDD)
- `formatarDuracao(min)` — `6h30`, `há 3h12`, etc.

## O que NÃO muda
Demais postos (via `sf_lancar` intacto), Integração, Cadastro, Dashboard (Burn-in conta só Aprovado —
entrada `status=''` não é contada, correto). Manutenção: a reprova de Burn-in continua gerando pendência
(a "saída Reprovado" é a reprova; identidade posto+data_hora já casa).

## Casos de borda
- Saída sem entrada → `SEM_ENTRADA`. Entrada com ciclo aberto → `JA_DENTRO`. Reprovado→reparo→re-entrada OK.
- Peça que entrou e nunca saiu → aparece no painel "em andamento" indefinidamente (correto; é o dado real).
- Duração usa `data_hora` (fuso do banco, UTC) — o cliente formata em local.

## Migração
`0037` — RPC `sf_burnin` (nova função). Sem mudança na `sf_registros`. Só no Dev.
