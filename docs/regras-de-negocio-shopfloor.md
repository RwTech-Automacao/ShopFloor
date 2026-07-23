# Regras de negócio — Módulo ShopFloor Processo

> **Documento vivo.** Toda regra em vigor no módulo está aqui, com o ponteiro de onde ela é
> implementada. Ao criar/mudar uma regra: atualize este arquivo na mesma PR.
> Última atualização: 2026-07-23.

## Conceitos

- **OP** = PMO (código do produto) + Nº da OP. Única por `(pmo, op)`.
- **Fluxo da OP**: cada OP define **quais postos aplicam e em que ordem** (definido no Cadastro de
  OP; tabela `sf_ordem_postos.ordem`). Não existe mais ordem global fixa.
- **Nº de Série (SN)**: identifica a peça. Interpretado como `[letras?][dígitos][letras?]`;
  comparações usam o SN **normalizado** (sem separadores/zeros à esquerda, minúsculo).
  → `src/modules/shopfloor/domain/serie.ts`
- **Faixa de SN da OP**: `sn_ini..sn_fim` (mesmo prefixo/sufixo; só o bloco numérico varia).

## Catálogo de postos (14)

Inicial · Inspeção SPI · Inspeção SMD · Montagem PTH · Inspeção PTH · Teste · Burn-in ·
Integração · Teste Final · Inspeção Final · Embalagem · Inspeção NQA · Extra máquina · Manutenção

| Grupo | Postos | Característica |
|---|---|---|
| **Sem status** (só passagem) | Inicial, Montagem PTH, Integração, Embalagem, Extra máquina | Não têm Aprovado/Reprovado; registram 1× |
| **Com status** | Inspeção SPI, Inspeção SMD, Inspeção PTH, Teste, Burn-in, Teste Final, Inspeção Final, Inspeção NQA | Aprovado/Reprovado (NQA: derivado de visual+funcional) |

→ classificação: `src/modules/shopfloor/domain/lancamento-linhas.ts` (`POSTOS_COM_STATUS`,
`POSTOS_SO_REGISTRADO`)

## Regras do Lançamento (`/shopfloor/lancamento`)

Validações puras no servidor (TS) + checagens sensíveis a corrida na função atômica **`sf_lancar`**
(migração `0031`; advisory lock por PMO/OP — substitui o LockService do legado).

1. **Obrigatórios por posto** → `domain/regras-lancamento.ts`
   - Sem status: colaborador + PMO + OP + SN.
   - Embalagem: + Nº da caixa + Qtd por caixa (**inteiro > 0**).
   - NQA: + Inspeção Visual + Funcional (Funcional aceita **Aprovado, Reprovado ou "Não
     aplicável"** — paridade com o legado; Visual só Aprovado/Reprovado).
   - SPI: + Status; reprovado exige **≥1 posição** (sem código/tipo).
   - Demais com status: + Status; reprovado exige **código + posição + tipo** do defeito.
2. **Faixa de SN**: o SN deve estar na faixa da OP. **OP sem faixa cadastrada → barra.**
   → `domain/serie.ts` (`serieDentroDaFaixa`) + `application/lancar-action.ts`
3. **Posto aplicável**: o posto deve estar no fluxo da OP. **Exceção: Integração não é lançável
   pela tela de Lançamento** (tem tela própria, que exige o vínculo real produto↔placas).
4. **Trava de sequência**: o posto **imediatamente anterior na ordem da OP** precisa estar
   satisfeito — *registrado* (postos sem status) ou *aprovado* (demais).
   → `domain/postos.ts` (`postoAnteriorNaSequencia`) + `precisaAprovado` + check no `sf_lancar`
5. **Anti-duplicidade / re-lançamento** (olha o ÚLTIMO registro da peça naquele posto):
   - **Princípio: peça APROVADA num posto nunca repete aquele posto.**
   - Sem status → registra **1× só** (qualquer registro barra).
   - Com status → último **Reprovado** (ou inexistente) **libera** re-lançamento; Aprovado barra.
   - **Gate de Manutenção (ATIVO desde 2026-07-23):** em **Teste, Burn-in e Teste Final**, peça
     reprovada só re-lança se existir **reparo registrado** (posto Manutenção, mesmo posto de
     origem) **após a última reprova** — senão erro `SEM_MANUTENCAO`. **SMD/PTH liberam direto**
     (retrabalho "extra-máquina" é físico, fora do sistema — decisão do usuário; o legado incluía
     SMD/PTH na Manutenção, nós NÃO).
6. **Caixa (Embalagem)**: conta as peças da caixa (mesma PMO/OP/caixa); `≥ limite` → barra
   ("caixa cheia"); devolve a contagem pós-envio.
7. **NQA**: status derivado — Aprovado se visual **aprovado** e funcional **aprovado OU "não
   aplicável"**, senão Reprovado (paridade com o legado, `appscript/Código.gs`).
8. **Gravação**: 1 registro; Reprovado com N defeitos → **1 registro por defeito**; SPI reprovado →
   **1 registro por posição**.

## Regras da Integração (`/shopfloor/integracao`)

Função atômica **`sf_integrar`** / **`sf_cancelar_integracao`** (migração `0032`).

1. **Registrar** exige: colaborador, OP do produto (com **Integração no fluxo**), SN do produto
   **na faixa** da OP, e ≥1 placa (cada uma com PMO/OP/SN).
2. **Duplicidades**: produto não pode estar em integração **ATIVA**; nenhuma placa pode estar
   vinculada a integração **ATIVA**; no mesmo envio, SN de placa **não pode repetir** nem ser igual
   ao do produto (melhoria sobre o legado). *Obs: o bloqueio de placa é global (qualquer cliente) —
   mais estrito que o legado, que só olhava a aba do cliente.*
3. **Fidelidades ao legado**: placa **não** valida faixa de SN; a Integração **não** exige posto
   anterior (o gate age sobre o posto seguinte do produto).
4. **Efeito**: cria o cabeçalho (`INT-...`, ATIVA) + itens + **registros posto=Integração**
   (1 do produto + 1 por placa) — o registro do produto **satisfaz o gate** do Lançamento.
5. **Busca**: por SN de produto OU placa; só integrações **ATIVAS**.
6. **Cancelamento (só admin)**: marca CANCELADA (quem/quando) + **apaga os registros** da
   integração → o gate volta a travar e produto/placas ficam livres pra re-integrar; cabeçalho e
   itens ficam como histórico. Registros de postos posteriores já lançados **não** são apagados.
7. **Receita (BOM por PMO)**: a OP do produto pode ter uma lista de PMOs de placa permitidas
   (cadastrada no fluxo, só quando Integração está no fluxo; reaproveitada pelo Puxar fluxo).
   **Vazia = qualquer PMO.** Definida = a Integração só oferece/aceita placas dessas PMOs (dropdown
   esconde; `sf_integrar` barra `PLACA_FORA_DA_RECEITA` como rede de segurança). Só restringe QUAIS
   PMOs — sem quantidade nem exigir a lista completa.

## Regras da Manutenção (`/shopfloor/manutencao`)

Função atômica **`sf_registrar_reparo`** (migração `0033`). Perm `lancar`.

1. **Pendência é derivada** (não se cadastra): cada reprova em **Teste, Burn-in ou Teste Final**
   vira uma **ocorrência** — identidade `PMO|OP|SN|posto de origem|data/hora`; várias posições da
   mesma reprova são agregadas numa ocorrência só.
2. **Status:** *Concluída* quando existe registro de Manutenção casando com a ocorrência (posto de
   origem + data/hora de origem); senão *Pendente*.
3. **Registrar reparo:** N consertos (descrição obrigatória + posição) → **1 registro por
   conserto** (posto=`Manutenção`, com o defeito original + posto/data de origem). Um envio
   conclui a ocorrência inteira e **libera o re-lançamento** no posto de origem (regra 5 do
   Lançamento).
4. SMD/PTH **não** geram pendência (extra-máquina física).

## Regras do Dashboard (`/shopfloor/dashboard`)

Perm `visualizar`. Consulta somente leitura — sem função atômica (não grava nada).

1. **Colunas**: o **fluxo da OP** (`sf_ordem_postos`, na ordem cadastrada) **+ Manutenção** (sempre
   incluída, mesmo fora do fluxo).
   → `domain/dashboard.ts` (`contarPorPosto`)
2. **Contagem por coluna** (mesma regra do grupo sem-status/com-status do Lançamento):
   - Posto **sem status** (Inicial, Montagem PTH, Integração, Embalagem, Extra máquina **e
     Manutenção**): conta **cada registro**.
   - Posto **com status**: conta só os registros com `status = Aprovado`.
   - **NQA** usa o `status` já derivado e gravado no lançamento (regra 7 do Lançamento: Visual
     aprovado **e** Funcional aprovado **ou "não aplicável"** → Aprovado, senão Reprovado) — o
     Dashboard não reprocessa `nqa_visual`/`nqa_funcional`, só lê `status`.
3. **Filtro de período**: opcional, por `data_hora` do registro, **dia inteiro** (`00:00:00` a
   `23:59:59`, fuso **-03:00**, inclusive nos dois extremos).
   → `infra/dashboard-repository.ts` (`listarContagemDaOp`)
4. **Total/barra**: total = `qtd` cadastrada na OP. **Sem `qtd` → só a contagem aparece (sem
   barra nem "/ total")**. Com `qtd`, a contagem **pode ultrapassar o total** (ex.: Manutenção
   conta cada conserto, e uma peça pode ser reparada mais de uma vez) — a barra visual **trava em
   100%**, mas o número exibido é o real.

## Regras do Cadastro de OP (`/shopfloor/ordens` — admin)

1. OP única por `(pmo, op)` — duplicada barra com mensagem.
2. PMO, OP e cliente obrigatórios; faixa de SN opcional, mas **os dois limites juntos** ou nenhum.
3. **Fluxo de postos**: lista ordenável (quais postos + sequência); **"Puxar fluxo" opcional** de
   uma OP existente do mesmo PMO (modelo por produto). Manutenção não entra no fluxo. Quando
   **Integração** está no fluxo, também se cadastra a **receita** (PMOs de placa permitidas — vazia
   = qualquer PMO; ver regra 7 da Integração), reaproveitada pelo Puxar fluxo.
4. **Exclusão bloqueada** se a OP já tem lançamentos.
5. Status Ativa/Finalizada — OPs FINALIZADAS somem das cascatas do Lançamento/Integração.

## Permissões

| Ação | Permissão |
|---|---|
| Lançar, Integrar, Buscar integração | `lancar` |
| Cadastro de OP, Cancelar integração | `administrar` |
| Ver telas/relatórios | `visualizar` |

## Onde as regras vivem (mapa rápido)

- **Domínio puro (testado, TDD):** `src/modules/shopfloor/domain/` — serie, postos,
  regras-lancamento, lancamento-linhas, validar-ordem, integracao-itens, dashboard, `receita.ts`
  (receita/BOM por PMO).
- **Funções atômicas no banco (corrida/duplicidade):** `supabase/migrations/0031_sf_lancar.sql`,
  `0032_sf_integracoes.sql`. Receita: tabela `sf_ordem_componentes` (migração `0034`).
- **Orquestração:** `src/modules/shopfloor/application/` — lancar-action, ordens-actions,
  integracao-actions, dashboard-actions.
- **Dashboard:** `domain/dashboard.ts` (`contarPorPosto`) · `application/dashboard-actions.ts`
  (`carregarDashboard`) · `infra/dashboard-repository.ts` (`listarContagemDaOp`) ·
  `app/(app)/shopfloor/dashboard/` (tela).
- **Legado de referência:** `appscript/` (Código.gs + telas).

## Backlog de regras/telas futuras

- **Integração — mover a "Busca por Nº de Série"** para outra tela *(usuário, 2026-07-23)*: hoje a
  busca mora na própria tela de Integração (como no legado); avaliar movê-la — candidata natural: a
  futura tela de **Pesquisa** (que já busca o histórico por SN; pode incorporar a visão do vínculo).
- **Finalização de OP condicionada aos lançamentos** *(usuário, 2026-07-23)*: hoje o status
  Ativa/Finalizada é um **rótulo manual**, independente dos registros (a OP PMO973/7892 veio do
  histórico como FINALIZADA com **0 lançamentos** — a flag foi migrada, o histórico peça-a-peça não
  existia na origem). Avaliar exigir/avisar na finalização: só permitir marcar "Finalizada" quando
  todas as peças da faixa estiverem concluídas (ou avisar "faltam X peças"). No legado não havia
  essa trava.
- **Cliente padronizado (evitar duplicata por casing)** *(usuário, 2026-07-23)*: `cliente` é texto
  livre → grafias divergentes duplicam na cascata (achado real: `LINCE` vs `Lince`; a planilha tinha
  só a aba `Lince`, a divergência veio da coluna de cliente em PMO_OPS). Solução: no Cadastro de OP,
  **escolher o cliente de uma lista dos já existentes** (+ "novo cliente"), como as PMOs da receita —
  nunca auto-Title-Case (quebraria siglas legítimas: KTW, VMI, STB, RW Tech, AS Mídia). Inclui uma
  **limpeza pontual** dos dados já divergentes.
- **Tela de "Registros" (log bruto por cliente)** *(usuário, 2026-07-23)*: equivale à antiga **aba do
  cliente** da planilha (lista corrida, append-only, de todos os `sf_registros`). Hoje a Pesquisa é
  orientada a consulta (por SN ou grade de uma OP) e **não** oferece o "despejo cronológico" de tudo
  de um cliente. Avaliar uma tabela filtrável (cliente/OP/posto/data) com export. **Antes de
  construir, confirmar se o pessoal usava a aba como lista corrida ou só consultava por SN/OP** — se
  for o segundo, a Pesquisa já cobre.
- **Extra máquina**: hoje só passagem; ganhará "outras opções" (a definir com o usuário).
- Higiene técnica: remover policy de INSERT direto em `sf_registros` (toda escrita já passa pelas
  funções); `gateSatisfeito` morto em postos.ts.
