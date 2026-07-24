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
- **Verificar o SN da placa — N2/N3** *(N1 entregue 2026-07-24; N2/N3 no backlog)*: **N1** (SN dentro
  da faixa da OP da placa) foi implementado. Faltam os níveis mais fortes: **N2** placa tem ≥1 registro
  (foi produzida); **N3** placa aprovada no posto final (rastreio máximo). **Dado decisivo:** a cobertura
  de rastreio das placas é **irregular** — algumas OPs de placa têm histórico peça-a-peça, outras são
  "casca" (0 registros, ex.: PMO975/5937). Por isso N2/N3 bloqueariam placas legítimas não-rastreadas.
- **Obrigatoriedade de faixa/Nº de Série** *(usuário, 2026-07-24)*: o N1 é **gradual** (OP sem faixa não
  bloqueia — senão quebraria as OPs migradas sem faixa). Futuro possível: **exigir faixa em toda OP**
  (tornar o N1 obrigatório, sem o "escape" gradual) e/ou tornar o Nº de Série obrigatório onde hoje é
  opcional. Decidir quando a cobertura de faixas estiver boa.
- **Cadastro de OP — filtros + scroll (padrão Recebimento)** *(usuário, 2026-07-24)*: a tela de OP é
  tabela crua; com 130+ OPs (crescendo) precisa de filtros (cliente/PMO/status/busca) + header fixo/
  scroll, reusando o padrão da tela de processos do Recebimento. **P1.**
- **Ver o fluxo de postos da OP (olhinho na linha)** *(usuário, 2026-07-24)*: botão/ícone que abre o
  fluxo daquela OP. Duas ambições: (a) **texto + setas** (`Inicial → SMD → Teste → …`) — barato, num
  modal/expansão; (b) **diagrama de blocos estilo n8n** — bem maior. Fazer (a) primeiro; (b) fica junto
  do "flow-builder visual" (montador de fluxo) já sonhado pro Cadastro.
- **RBAC por módulo — Fase 2 (RLS por módulo)** *(Fase 1 entregue 2026-07-24)*: a **Fase 1** entregou o
  modelo (`perfil_permissao` = grants por módulo, fonte da verdade; `pode_*` derivadas), a tela de perfil
  com accordions por módulo, e o **enforcement no app** (menu + guards `podeNoModulo`). Migrações 0038/0039.
  **Fase 2** (falta): tornar o **RLS consciente de módulo** — hoje as ~82 políticas ainda leem os `pode_*`
  globais, então a separação é de **interface/uso**, não de banco (um admin de um módulo ainda alcançaria
  dados de outro via API direta). Itens do review a resolver na Fase 2: (a) páginas de leitura de
  `configuracoes/usuarios` e `perfis` só têm o guard global do layout — um admin de módulo alcançaria a
  **leitura** por URL direta (as escritas já exigem `sistema.administrar`); dar guard por página; (b)
  `validarEdicaoPerfil` usa o OR global — dá pra tirar `sistema.administrar` de si mesmo mantendo outro
  admin (auto-lockout, não escalação); (c) `salvarPerfil` grava `pode_*` e grants sem transação real.
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
- Higiene técnica: remover policy de INSERT direto em `sf_registros` (toda escrita já passa pelas
  funções); `gateSatisfeito` morto em postos.ts.
