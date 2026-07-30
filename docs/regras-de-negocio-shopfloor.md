# Regras de negócio — Módulo ShopFloor Processo

> **Documento vivo.** Toda regra em vigor no módulo está aqui, com o ponteiro de onde ela é
> implementada. Ao criar/mudar uma regra: atualize este arquivo na mesma PR.
> Última atualização: 2026-07-24.

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

> **Burn-in não é mais um "com status" simples.** Continua listado em `POSTOS_COM_STATUS` (o gate de
> sequência do posto seguinte exige *aprovado*), mas o **lançamento** do posto tem um lifecycle
> próprio de **entrada/saída** (2 registros) em vez de 1 registro com status — ver seção dedicada
> abaixo.

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

## Regras do Burn-in — entrada/saída (posto `Burn-in`)

Função atômica dedicada **`sf_burnin`** + view **`sf_burnin_aberto`** (migração `0037`; não passa
pelo `sf_lancar` — lifecycle próprio). Domínio puro: `src/modules/shopfloor/domain/burnin.ts`
(`pareaBurnin`, `estaAberto`, `formatarDuracao`).

1. **Modelo: 2 registros por ciclo**, distinguidos pelo `status`:
   - **Entrada** = registro `posto='Burn-in'`, `status=''`.
   - **Saída** = registro `posto='Burn-in'`, `status='Aprovado'`/`'Reprovado'` (+ defeitos se
     reprovado, mesma regra de "1 registro por defeito" do Lançamento).
   - **Ciclo aberto** = o último registro de Burn-in da peça naquela OP é uma entrada (`status=''`)
     sem saída correspondente ainda.
2. **Entrada** exige: último evento de Burn-in da peça **não** pode já ser uma entrada aberta
   (`JA_DENTRO`) nem uma saída **Aprovado** (`JA_APROVADO`); se a última saída foi **Reprovado** e o
   posto exige Manutenção (`exigeManutencao`), precisa existir reparo (posto `Manutenção`, origem
   `Burn-in`) **após** aquela reprova (`SEM_MANUTENCAO` — mesmo gate de Manutenção do Lançamento,
   regra 5). Além disso, a trava de sequência normal se aplica (posto anterior satisfeito).
3. **Saída** exige uma **entrada aberta**: se o último evento não é uma entrada (`status=''`), barra
   com `SEM_ENTRADA`. A saída grava o `status` informado (Aprovado/Reprovado); reprovado exige
   código + posição + tipo do defeito.
4. **Posto seguinte no fluxo** só libera com a **saída Aprovado** — o gate de sequência (regra 4 do
   Lançamento) olha o posto Burn-in como qualquer "com status": exige o último registro com
   `status='aprovado'`, então uma entrada aberta ou uma saída Reprovado **não** libera o próximo
   posto.
5. **Painel "em andamento"** (`/shopfloor/burn-in`): lista as peças com ciclo aberto agora
   (`sf_burnin_aberto` — `DISTINCT ON` no último registro de Burn-in por peça, filtrado por
   `status=''`), com tempo decorrido ao vivo (`formatarDuracao`, atualizado a cada minuto).
   → `app/(app)/shopfloor/burn-in/`, `infra/burnin-repository.ts` (`listarBurninAberto`)
6. **Duração no histórico**: a tela de **Pesquisa** (busca por SN) e a **Grade Geral** mostram o
   efeito do ciclo:
   - **Pesquisa** pareia entrada↔saída dos registros de Burn-in do SN (`pareaBurnin`, usa
     `dataHora`) e exibe a coluna **Duração**: tempo do ciclo (`formatarDuracao`) na linha da
     saída, ou **"há X"** (tempo decorrido até agora) na linha da entrada se o ciclo está aberto.
   - **Grade Geral** não carrega `dataHora` (só `posto/status/numeroCaixa`, por volume); detecta
     ciclo aberto por **contagem** (entradas > saídas para aquele SN/posto = ordem-independente) e
     mostra a célula **'Em andamento'** — só cai na regra "com status" normal (Aprovado vence
     Reprovado) quando não há ciclo aberto. → `domain/grade.ts` (`burninEmAndamento`,
     `montarGrade`)
7. Regras 1–8 do Lançamento (obrigatórios, faixa de SN, posto aplicável, gate de Manutenção) valem
   igual para o Burn-in, só a *gravação* do status muda de 1 registro para o par entrada/saída.
   **Só informativo**: não há tela separada de "consulta de ciclos" além do painel e da Pesquisa.

## Regras da Integração (`/shopfloor/integracao`)

Função atômica **`sf_integrar`** / **`sf_cancelar_integracao`** (migração `0032`).

1. **Registrar** exige: colaborador, OP do produto (com **Integração no fluxo**), SN do produto
   **na faixa** da OP, e ≥1 placa **completa** (PMO + OP + SN). Linha totalmente vazia é ignorada,
   mas linha **iniciada sem SN barra** — não integra pela metade (client exige SN em todas as linhas;
   servidor rejeita linha PMO/OP sem SN). → `domain/integracao-itens.ts`
2. **Duplicidades**: produto não pode estar em integração **ATIVA**; nenhuma placa pode estar
   vinculada a integração **ATIVA**; no mesmo envio, SN de placa **não pode repetir** nem ser igual
   ao do produto (melhoria sobre o legado). *Obs: o bloqueio de placa é global (qualquer cliente) —
   mais estrito que o legado, que só olhava a aba do cliente.*
3. **Trava de sequência (a Integração é um posto):** exige o **posto imediatamente anterior no
   fluxo** da OP satisfeito **para o produto** — *registrado* (anterior sem status) ou *aprovado*
   (anterior com status). Se a Integração é o **1º posto** do fluxo → sem anterior → libera. Espelha
   a regra 4 do Lançamento (`sf_integrar` com `p_prev_posto`/`p_prev_precisa_aprovado`, erro
   `SEQUENCIA`, migração `0035`).
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
8. **N1 (verificação do SN da placa)**: o SN da placa deve estar na faixa (`sn_ini..sn_fim`) da OP
   da placa — validado no cliente (aviso inline por linha, trava o botão) e na action `integrar`
   (`serieDentroDaFaixa`, erro `Nº de Série da placa N fora da faixa da OP <op>`). **Gradual:** OP
   sem faixa cadastrada não bloqueia. (N2 — placa produzida — e N3 — placa aprovada — ficam no
   backlog; cobertura de rastreio das placas é irregular.)
9. **Dropdown da OP da placa**: mostra `{op} ({qtd ?? '—'}/{concluídas})` + bolinha de status
   (verde = Ativa, cinza = Finalizada), e **lista ativas + finalizadas** (restaura o comportamento do
   legado `obterPMO_OPS`, que não filtrava status; a cascata do **produto** segue só-ativas).
   `concluídas` vem da view `sf_ordem_resumo` (migração `0036`) via `listarOrdensParaIntegracao`.

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
2. PMO, OP e cliente obrigatórios; **faixa de SN obrigatória**: os dois limites, **coerentes**
   (mesmo prefixo/sufixo, início ≤ fim; início==fim vale = OP de 1 peça).
3. **Fluxo de postos**: lista ordenável (quais postos + sequência); **"Puxar fluxo" opcional** de
   uma OP existente do mesmo PMO (modelo por produto). Manutenção não entra no fluxo. Quando
   **Integração** está no fluxo, também se cadastra a **receita** (PMOs de placa permitidas — vazia
   = qualquer PMO; ver regra 7 da Integração), reaproveitada pelo Puxar fluxo.
4. **Exclusão bloqueada** se a OP já tem lançamentos.
5. Status Ativa/Finalizada — OPs FINALIZADAS somem das cascatas do Lançamento/Integração.

## Permissões — relação completa (por módulo)

Desde o **RBAC por módulo** (2026-07-24), as permissões são **por módulo** (`perfil_permissao`). Um perfil
concede permissões dentro de cada módulo de forma independente. O RLS do banco é consciente de módulo
(`tem_permissao('<modulo>','<perm>')`) — Fase 1 (app) + 2a (`sf_*`) + 2b (Recebimento) + 2c (Sistema).

### Módulo `shopfloor` (Fluxo de Processos)
| Permissão | O que deixa fazer |
|---|---|
| `visualizar` | Ver **Pesquisa** (histórico por SN), **Grade**, **Dashboard**, painel **Burn-in**. Ler as tabelas `sf_*` (OPs, registros, integrações, defeitos). |
| `lancar` | **Lançar** peças por posto; **Integrar** (vincular produto↔placas) e buscar integração; **Manutenção** (registrar reparo); **Burn-in** entrada/saída. (RPCs `sf_lancar`/`sf_integrar`/`sf_burnin`/`sf_registrar_reparo`.) |
| `administrar` | **Cadastro de OP** (criar/editar/excluir OP, fluxo de postos, receita); **cancelar Integração**. |

**Mapa item-de-menu → permissão** (Fluxo de Processos — confirmado com o usuário 2026-07-28; é o que o
`app-shell.tsx` já aplica):
- **`visualizar`** (só acompanhar): **Pesquisa** (+ Grade), **Dashboard**, **Burn-in**, **Registros**.
- **`lancar`** (operar o chão): **Lançamento**, **Integração**, **Manutenção**.
- **`administrar`** (gerir): **Ordens de Produção** (Cadastro de OP + fluxo/receita).

Hierarquia: `visualizar` < `lancar` < `administrar`. O operador de chão (`lancar`) lança/integra/repara; o
gestor (`administrar`) cadastra OPs e monta o fluxo; quem só acompanha os números usa `visualizar`. (No
ShopFloor não há `editar` — o tier operacional é o `lancar`, equivalente ao `editar` do Recebimento.)

### Módulo `recebimento`
| Permissão | O que deixa fazer |
|---|---|
| `visualizar` | Ver processos, importações, anexos, etiquetas geradas (leitura). |
| `importar` | Importar planilhas de processos; criar/gerir **padrões de importação**; (com `editar`) inserir processos. |
| `editar` | Criar/editar **processos** (nos status aberto/em conferência); gerir **anexos** do processo. |
| `finalizar` | **Finalizar** um processo (status → finalizado); criar um processo já como finalizado. |
| `editar_finalizado` | Editar um processo que **já está finalizado**. |
| `excluir` | **Apagar** um processo (DELETE). ⚠️ **Sem UI hoje** — guard dormente (ver backlog). |
| `gerar_etiqueta` | **Gerar etiquetas** dos processos. |
| `administrar` | Gerir a **configuração** do Recebimento: listas e itens de lista, colunas da lista, campos, critérios de fornecedor, tabela NQA, padrões de importação. |

### Módulo `sistema`
| Permissão | O que deixa fazer |
|---|---|
| `administrar` | Gerir **usuários** (criar/editar/desativar/excluir), gerir **perfis** e suas permissões (grants), e ver o **log de auditoria** (`logs`). Único que abre a área de Sistema. |

**Notas:** cada usuário sempre lê a **própria** linha de `usuarios` (login funciona sem `sistema.administrar`).
`lancar` só existe no `shopfloor`; `importar`/`editar`/`finalizar`/`editar_finalizado`/`excluir`/`gerar_etiqueta`
só no `recebimento`; `visualizar` e `administrar` existem em vários módulos (é por isso que a separação por
módulo importa). Catálogo em `src/modules/auth/domain/modulos.ts`.

## Onde as regras vivem (mapa rápido)

- **Domínio puro (testado, TDD):** `src/modules/shopfloor/domain/` — serie, postos,
  regras-lancamento, lancamento-linhas, validar-ordem, integracao-itens, dashboard, `receita.ts`
  (receita/BOM por PMO), `burnin.ts` (`pareaBurnin`/`estaAberto`/`formatarDuracao`), `grade.ts`
  (`montarGrade`/`burninEmAndamento`).
- **Funções atômicas no banco (corrida/duplicidade):** `supabase/migrations/0031_sf_lancar.sql`,
  `0032_sf_integracoes.sql`, `0037_sf_burnin.sql` (+ view `sf_burnin_aberto`). Receita: tabela
  `sf_ordem_componentes` (migração `0034`).
- **Orquestração:** `src/modules/shopfloor/application/` — lancar-action, ordens-actions,
  integracao-actions, dashboard-actions, burnin-actions.
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
- **Cliente padronizado (ENTREGUE 2026-07-24)**: no Cadastro de OP o campo Cliente virou um **Select
  dos clientes já existentes** (distintos de `sf_ordens`) + item **"＋ Novo cliente…"** (revela texto).
  Se o "novo" bater com um existente ignorando maiúsculas, **reaproveita a grafia existente** (mata o
  LINCE vs Lince na fonte). Só a tela de OP (as outras pegam o cliente da OP). A limpeza pontual dos
  dados já divergentes (LINCE→Lince) foi feita no Dev em 2026-07-23. `ordem-form.tsx` + `page.tsx`.
- **Tela de "Registros" (log bruto por cliente)** *(usuário, 2026-07-23)*: equivale à antiga **aba do
  cliente** da planilha (lista corrida, append-only, de todos os `sf_registros`). Hoje a Pesquisa é
  orientada a consulta (por SN ou grade de uma OP) e **não** oferece o "despejo cronológico" de tudo
  de um cliente. Avaliar uma tabela filtrável (cliente/OP/posto/data) com export. **Antes de
  construir, confirmar se o pessoal usava a aba como lista corrida ou só consultava por SN/OP** — se
  for o segundo, a Pesquisa já cobre.
- **Verificar o SN da placa — N2/N3** *(N1 entregue 2026-07-24; N2/N3 no backlog)*: **N1** (SN dentro
  da faixa da OP da placa) foi implementado. Faltam os níveis mais fortes: **N2** placa tem ≥1 registro
  (foi produzida); **N3** placa aprovada no posto final (rastreio máximo). **Dado decisivo:** a cobertura
  de rastreio das placas é **irregular** — algumas OPs de placa têm histórico peça-a-peça, outras são
  "casca" (0 registros, ex.: PMO975/5937). Por isso N2/N3 bloqueariam placas legítimas não-rastreadas.
- **Obrigatoriedade de faixa/Nº de Série** *(usuário, 2026-07-24; faixa obrigatória no cadastro **feita** 2026-07-28)*:
  **exigir faixa em toda OP (no cadastro)** foi implementado — a faixa é agora obrigatória no Cadastro de
  OP com coerência validada (mesmo prefixo/sufixo, início ≤ fim). Permanecem no backlog: o N1 **não-gradual**
  no Lançamento/Integração (hoje o N1 é gradual — OP sem faixa não bloqueia) e a **obrigatoriedade do SN
  individual** no Lançamento (hoje ainda opcional em alguns postos).
- **Cadastro de OP — filtros + scroll (padrão Recebimento)** *(usuário, 2026-07-24)*: a tela de OP é
  tabela crua; com 130+ OPs (crescendo) precisa de filtros (cliente/PMO/status/busca) + header fixo/
  scroll, reusando o padrão da tela de processos do Recebimento. **P1.**
- **Ver o fluxo de postos da OP (olhinho na linha)** *(usuário, 2026-07-24)*: botão/ícone que abre o
  fluxo daquela OP. Duas ambições: (a) **texto + setas** (`Inicial → SMD → Teste → …`) — barato, num
  modal/expansão; (b) **diagrama de blocos estilo n8n** — bem maior. Fazer (a) primeiro; (b) fica junto
  do "flow-builder visual" (montador de fluxo) já sonhado pro Cadastro.
- **RBAC por módulo — Fase 2c + storage** *(Fase 1 + 2a + 2b entregues 2026-07-24)*: **Fase 1** = modelo
  (`perfil_permissao`) + tela por módulo + enforcement no app (0038/0039). **Fase 2a** = RLS dos `sf_*`
  por módulo (0040–0043). **Fase 2b** = RLS das 21 políticas do Recebimento por módulo (0051) — isolamento
  bidirecional validado com login real. **Falta a Fase 2c:** RLS das tabelas de **Sistema** (`usuarios`,
  `perfis`, `logs`) → `sistema.*` (hoje ainda usam a `tem_permissao(perm)` antiga); depois disso dá pra
  **remover** a função de 1 arg. **+ storage (na promoção do Prod):** as políticas do bucket
  `anexos-processos` (storage.objects) usam `tem_permissao('visualizar'/'editar')` mas **não existem no
  Dev** (bucket só no Prod) → continuam **cegas a módulo**; tratar no Prod com o mesmo padrão
  (`recebimento.*`). Itens menores do review Fase 1 (guard por página em usuarios/perfis; `validarEdicaoPerfil`
  OR global; save sem transação) resolver junto da 2c.
- **Tela de Registros / log por módulo** *(usuário, 2026-07-24; relacionado ao item "Tela de
  Registros" acima)*: os `sf_registros` (produção) são dado diferente do **log de ações de usuário**
  (auditoria) que já existe. Avaliar: (a) uma tela **Registros** dedicada no módulo (produção,
  filtrável); e/ou (b) adicionar **filtro por módulo** no log de usuários existente (isso vale pra
  auditoria multi-módulo). Não misturar produção com auditoria sem decidir.
- **Análise de telas redundantes** *(usuário, 2026-07-24)*: revisar se telas se sobrepõem (ex.:
  Pesquisa-grade × Dashboard; Busca-por-SN da Integração × Pesquisa). Análise barata; fazer cedo,
  informa as outras decisões.
- **Responsividade das telas do módulo** *(usuário, 2026-07-24)*: fazer **depois** que o funcional
  estiver travado (evita retrabalho de layout).
- **Extra máquina — "outras opções"** *(usuário; definição pendente)*: hoje só passagem; ganhará
  opções — o usuário vai verificar como e detalhar.
- **Processo de dev — Git Flow + worktree** *(usuário, 2026-07-24)*: avaliar adotar. Ver a análise
  na conversa (recomendação: modelo leve tipo GitHub Flow + worktrees pra trabalho paralelo; Git Flow
  completo com develop/release provavelmente é cerimônia demais pro tamanho atual).
- **(Recebimento) Permissões/ações órfãs — `excluir` e `cancelar`** *(achado 2026-07-24, durante o RBAC
  Fase 2b)*: a permissão **`excluir`** protege (no RLS) o DELETE de `processos_recebimento`, mas **não há
  função no front nem action** que apague um processo — guard dormente (delete só manual pelo banco). E o
  **`cancelar`** (status → `cancelado`) **também não tem UI hoje** (confirmado pelo usuário). **Decidir:**
  criar as telas de excluir/cancelar processo, ou remover a permissão/policy órfã. É do módulo Recebimento;
  registrado aqui porque surgiu ao mexer no RLS dele. (Na Fase 2b, `excluir` foi mapeada p/ `recebimento.excluir`.)
- **Higiene (ENTREGUE 2026-07-24):** removidos código morto (`gateSatisfeito`+`SnapshotPosto` em
  postos.ts, `burnin-actions.ts`, `nav-config.ts`) e a **policy de INSERT direto em `sf_registros`**
  (migração `0055`) — toda escrita passa pelos RPCs `security definer`; a policy era brecha (permitia
  forjar registro cru pulando as validações). Confirmado: INSERT direto → 403.
- **Higiene restante (opcional, pré-Prod):** follow-ups menores dos reviews — guard por página em
  `configuracoes/{usuarios,perfis,logs}` (hoje só o guard global do layout + RLS de backstop);
  `validarEdicaoPerfil` usa OR global; `salvarPerfil` grava `pode_*` e grants sem transação real.
- **Tela de Perfis — trocar a matriz de checks por "ver permissões" (olhinho)** *(usuário, 2026-07-28)*:
  hoje `/configuracoes/perfis` é uma **tabela larga** (Nome + ~10 colunas de permissão com ✓/—) que rola
  horizontal e piora conforme crescem permissões/módulos. Ideia: deixar só a **lista de perfis** (nome +
  ações) e, por linha, um **ícone de olho / botão "Ver permissões"** que abre as permissões daquele perfil
  (modal/painel, provavelmente agrupadas por módulo) — em vez da grade de checks inline. Mesmo padrão do
  "olhinho" do fluxo de postos da OP. Melhora legibilidade e escala.
- **Lançamento — campo Código de defeito vira combobox (abrir ao clicar)** *(usuário, 2026-07-29)*: hoje o
  campo Código do defeito no Lançamento usa `<datalist>` nativo (`lancamento-form.tsx:309-314`), que só
  mostra as sugestões **depois de digitar** (limitação do navegador; no Firefox clicar no campo vazio não
  abre a lista). Trocar por um **combobox** de verdade: abre a lista inteira ao focar/clicar e filtra ao
  digitar. Retoque pequeno e localizado. **ADIADO (anotado).**
- **Catálogo de defeitos — fazer o `tipo` peça/teste FILTRAR por posto** *(achado 2026-07-29)*: o
  `sf_defeitos.tipo` (1=peça | 2=teste) **hoje é inerte** no web — a lista de sugestões do Código no
  Lançamento mostra **todos** os códigos sem filtrar (`lancamento-form.tsx:310`, `defeitos.map` sem filtro).
  Veio do **legado**, que tinha **duas listas separadas** (defeitos de peça × de teste). Intenção original:
  postos de **inspeção visual/montagem** oferecem defeitos de **peça**; postos de **teste/burn-in** oferecem
  defeitos de **teste**. **Casar com a onda de "perfis de posto"** (onde os tipos de posto serão mapeados de
  qualquer forma). ⚠️ Não confundir com o **Tipo por linha** do Lançamento (`SMD/PTH/Integração/TOP/BOT/
  Funcional/Elétrico` — natureza/lugar do defeito na placa, `lancamento-form.tsx:16`), que é outra coisa e
  continua igual. **ADIADO (anotado).**
- **Feedbacks de sucesso/falha — maiores e mais claros** *(usuário, reunião 2026-07-30)*: hoje os retornos de
  ação usam `toast` (sonner) discreto no canto. A operação pediu **pop-ups/feedbacks maiores e mais claros**
  (sucesso E falha) — mais visíveis pro operador no chão de fábrica (ex.: banner/modal central destacado,
  cor/ícone forte, texto grande). Vale um padrão único reusável em todo o módulo (Lançamento, Integração,
  Manutenção, cadastros…). Definir o formato (toast maior × banner fixo × modal) num brainstorm quando pegar
  o item. **ADIADO (anotado).**
- **Manutenção/reparo — apresentação de "relatado × constatado" na Pesquisa/Registros** *(usuário, smoke
  2026-07-30)*: um reparo gera **≥2 linhas** em `sf_registros` na visão da Pesquisa/Registros — a(s) de
  **conserto** (que carregam o **defeito RELATADO**, ex.: `157 ERRO COMUNICAÇÃO`) e a(s) de **defeito
  CONSTATADO** (`reparo_constatado=true`, ex.: `9999 DEFEITO…`). Fica confuso ver duas linhas de "Manutenção"
  com defeitos diferentes. **Melhorar a apresentação:** agrupar o reparo numa visão só, ou rotular claramente
  "relatado" vs "constatado" (a coluna/flag `reparo_constatado` já existe pra distinguir). **ADIADO (anotado).**

- **Perfis de Posto — Fase 2** *(2026-07-30)*: (a) **criar perfis novos por config** (compor tem_status/reprova/
  gate/exige_manutencao; recurso=nenhum — bespoke continua código); (b) **Análise 100% name-free** — `grade.ts`/
  `dashboard.ts`/`pesquisa-form.tsx` ainda casam alguns postos por **nome** só na EXIBIÇÃO (célula de Manutenção/
  embalagem/burn-in) — migrar pra perfil/recurso; (c) `sf_postos.perfil` poderia virar `NOT NULL` (hoje há fallback
  `PERFIL_PADRAO`). **Fase 1 entregue** (perfis seed + atribuir + tela Cadastrar Posto). **ADIADO (anotado).**

- **Cadastrar Posto — guia/preview do perfil** *(usuário, smoke 2026-07-30)*: ao criar um posto, mostrar uma
  **visualização/guia** do que o perfil escolhido faz — quais campos/telas o posto terá (ex.: "Inspeção → pede
  Status; reprovado → defeitos"; "Passagem → só registra"; "Embalagem → Nº caixa + QTD"). Deixa claro o que
  está sendo criado antes de salvar. **ADIADO (anotado).**

## Priorização do backlog (2026-07-28, usuário)
- **Fazendo agora:** **consolidar busca por SN** (Integração → Pesquisa) + **análise de telas redundantes**
  — ligado à reestruturação de telas abaixo (decidir a estrutura antes de mover peças soltas).
- **Backlog 2 (adiado por ora):** Cadastro de OP filtros+scroll; Finalização de OP condicionada aos
  lançamentos; Export da Tela de Registros (Excel); Config de campos do detalhe de Registros.
- **Branch separada (afeta tela de Prod):** **Tela de Perfis com "olhinho/ver permissões"** — NÃO entra no
  batch atual do ShopFloor; merece PR próprio pra `main`, porque mexe numa tela **viva** (Configurações ›
  Perfis, usada em Prod). É importante, mas isolada.
- **Pós-funcional (quando as telas estiverem quase fechadas):** **responsividade**.
- **Técnico/higiene — ADIADO (análise 2026-07-28, não entra no batch atual):**
  - **Guard-por-página em `usuarios`/`perfis`/`logs`:** hoje essas telas dependem só do guard **no layout** de
    Configurações (`administrar` global) + RLS — é o **mesmo padrão auth-no-layout** que o opus apontou no
    ShopFloor. Correção = guard `sistema.administrar` **na página** (re-checa na navegação). **Rápido e baixo
    risco** quando for feito.
  - **Remover `tem_permissao(1-arg)`:** os únicos usos vivos são os **4 RPCs de `lancar`**
    (sf_lancar/sf_integrar/sf_registrar_reparo/sf_burnin). Remover exige **redefinir os 4 RPCs** (só pra trocar
    1 linha) + dropar a função. **Risco × valor ruim** (a função de 1-arg funciona; é só dívida técnica) →
    **baixa prioridade**; se fizer, redefinição cuidadosa + smoke pesado do Lançamento.
  - **Órfãs Recebimento (`excluir`/`cancelar`):** deixadas como estão por ora (policies dormentes, sem UI, sem
    risco imediato) — decidir depois entre criar a UI ou remover as policies.

## Reestruturação das telas do Fluxo — aproximar do formulário legado *(usuário, 2026-07-28)*
No legado (Apps Script), só **Registros** e **Ordem de Produção** eram separados (eram planilhas); o resto —
**Lançamento, Integração, Manutenção, Dashboard, Pesquisa** — vivia **junto num único formulário** com **abas
no topo** (Lançamento | Integração | Manutenção | Dashboard | Pesquisa). Hoje no web cada um é uma tela/rota
separada no menu. **Avaliar aproximar disso:** as telas operacionais dentro de um **container com abas** (não
precisa ser idêntico ao legado). Liga-se direto à "análise de telas redundantes" e à consolidação da busca por
SN — por isso essas decisões são tomadas juntas.
