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
   - NQA: + Inspeção Visual + Funcional.
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
   - **Regra futura já definida:** Teste, Teste Final e Burn-in só poderão re-lançar se a peça
     **passou pela Manutenção** após a reprova (entra quando o módulo Manutenção existir).
     SMD/PTH seguem liberando direto (retrabalho "extra-máquina" é físico, fora do sistema).
     *Pendente de alinhamento: no legado, reprovas de SMD/PTH também geram pendência de Manutenção.*
6. **Caixa (Embalagem)**: conta as peças da caixa (mesma PMO/OP/caixa); `≥ limite` → barra
   ("caixa cheia"); devolve a contagem pós-envio.
7. **NQA**: status derivado — Aprovado se visual **e** funcional aprovados, senão Reprovado.
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

## Regras do Cadastro de OP (`/shopfloor/ordens` — admin)

1. OP única por `(pmo, op)` — duplicada barra com mensagem.
2. PMO, OP e cliente obrigatórios; faixa de SN opcional, mas **os dois limites juntos** ou nenhum.
3. **Fluxo de postos**: lista ordenável (quais postos + sequência); **"Puxar fluxo" opcional** de
   uma OP existente do mesmo PMO (modelo por produto). Manutenção não entra no fluxo.
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
  regras-lancamento, lancamento-linhas, validar-ordem, integracao-itens.
- **Funções atômicas no banco (corrida/duplicidade):** `supabase/migrations/0031_sf_lancar.sql`,
  `0032_sf_integracoes.sql`.
- **Orquestração:** `src/modules/shopfloor/application/` — lancar-action, ordens-actions,
  integracao-actions.
- **Legado de referência:** `appscript/` (Código.gs + telas).

## Backlog de regras/telas futuras

- **Integração — placas restritas à PMO "mãe"** *(regra citada pelo usuário, 2026-07-23)*: hoje a
  tabela de placas aceita **qualquer** PMO/OP ativa. Futuramente, cada PMO de produto ("mãe") deve
  ter definido **quais PMOs de placa a compõem** (estrutura tipo BOM — ex.: no Cadastro de OP/PMO,
  uma lista de "PMOs de componentes"), e a tela de Integração só oferecerá placas dessas PMOs.
- **Integração — mover a "Busca por Nº de Série"** para outra tela *(usuário, 2026-07-23)*: hoje a
  busca mora na própria tela de Integração (como no legado); avaliar movê-la — candidata natural: a
  futura tela de **Pesquisa** (que já busca o histórico por SN; pode incorporar a visão do vínculo).
- **Manutenção**: pendências por reprova + registro de reparo (`REP-...`); ao existir, ligar o gate
  "re-teste só após Manutenção" (Teste/Teste Final/Burn-in) e decidir a regra p/ SMD/PTH.
- **Pesquisa + Grade Geral**: consulta por SN + matriz SN×postos com filtro por caixa/cliente.
- **Dashboard**: contagens por posto com período.
- **Extra máquina**: hoje só passagem; ganhará "outras opções" (a definir com o usuário).
- Higiene técnica: remover policy de INSERT direto em `sf_registros` (toda escrita já passa pelas
  funções); `gateSatisfeito` morto em postos.ts.
