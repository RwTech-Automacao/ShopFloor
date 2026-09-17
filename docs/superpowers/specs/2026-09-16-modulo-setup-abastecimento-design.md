# Módulo Setup — Montagem de setup e abastecimento de componentes (design)

> Card da sprint 14/09/2026: **Tela de Setup [16h]**. Módulo 2 do roadmap ("Set up e reabastecimento de montagem").
> Desenho validado com o usuário em 16/09/2026.

## 1. Contexto

Hoje o processo roda num Google Apps Script sobre a planilha "Conferência Componentes SMT", com três telas:

- **Set Up** — por OP, monta o mapa Linha/Máquina/Face → Posição → Feeder → Código do componente (no PTH: Bloco/Face → Posto → Locação → Código) e registra o SN de Abertura.
- **Abastecimento** — na troca de rolo, bipa Posição, Feeder, Código de saída, Código de entrada e SN Inicial. Aprova se o prefixo é o mesmo, o sequencial é diferente e o prefixo está cadastrado naquela posição/feeder. Grava aprovados e reprovados.
- **Consulta** — só do mapa do setup.

O código do rolo tem o formato `CÓDIGO_ERP-LOTE_E_NÚMERO_DO_ROLO` (ex.: `CAPJ41-8521556004`).
- **Antes do `-`:** o código do item no ERP (o mesmo da composição de produto). Identifica o componente.
- **Depois do `-`:** lote do recebimento + número do rolo. É **único por rolo** (dois rolos do mesmo lote têm etiquetas diferentes). Não é conferido contra nada nesta versão; no futuro pode ligar ao Recebimento pra rastreabilidade.

**Problemas do legado que este módulo resolve:**
- Regra de separação do código diferente entre SMD e PTH.
- Face gravada de dois jeitos.
- Reenvio devolvendo reprovação antiga.
- Setup sem trava de concorrência.
- Leitura da planilha inteira a cada bipe.
- Tipagem do Sheets (posição "01" vira 1, SN vira número).
- Troca de feeder corrigida à mão.
- Operador em texto livre.
- Nenhuma consulta das trocas.
- XSS nos modais.

## 2. Decisões

| # | Decisão |
|---|---|
| 1 | **Módulo próprio**, fora do ShopFloor (como o Recebimento): seção própria no menu e permissões próprias (`Modulo` ganha `'setup'`). |
| 2 | **OPs vêm do ShopFloor** (`sf_ordens`), só leitura: PMO, OP, cliente e faixa de SN (`sn_ini`/`sn_fim`). A OP precisa existir no ShopFloor antes do setup. Como a RLS de `sf_ordens` é do módulo ShopFloor, o Setup lê por uma função `security definer` (`st_listar_ordens`) que checa `tem_permissao('setup', 'visualizar')` e devolve só esses campos. |
| 3 | **Estrutura de componentes da PMO**: cadastrada uma vez por PMO e reutilizada por todas as OPs. Cada componente guarda o **código do ERP** e o **processo (SMD ou PTH)**. |
| 4 | A estrutura entra por **importação da composição de produto do ERP (Excel) + ajuste manual**. Formato na seção 6. |
| 5 | **O setup só aceita componentes da estrutura da PMO e do mesmo processo** (setup SMD só componentes SMD; PTH só PTH). Código fora dela é recusado na montagem. |
| 6 | **Setup por OP**, com opção de **copiar de uma OP anterior** da mesma PMO. |
| 7 | **Controle do rolo montado**: o sistema guarda o rolo (código completo) de cada posição. Na troca, o rolo que sai tem que ser exatamente o montado. |
| 8 | **Reprovação só registra**: não trava a posição, e o rolo montado não muda. |
| 9 | **Feeder e posição podem ser trocados ou editados no meio da OP só pelo admin do módulo**, com histórico. |
| 10 | **SN de Abertura e SN Inicial conferidos contra a faixa de SN da OP.** |
| 11 | **PTH mantém os campos do legado** (Linha, Bloco, Face, Posto, Locação). O significado deles será confirmado com a produção. |
| 12 | **Começa do zero**: a planilha não é migrada. |
| 13 | **Permissões**: montar setup e trocar rolo = `lancar`; estrutura, cadastros e edição no meio da OP = `administrar`; consultas = `visualizar`. |

## 3. Menu e telas

```
SETUP
 ├─ Operação
 │   ├─ Montar Setup      (lancar)
 │   └─ Abastecimento     (lancar)
 ├─ Consultas
 │   ├─ Setups            (visualizar)
 │   └─ Trocas de rolo    (visualizar)
 └─ Cadastros             (administrar)
     ├─ Estrutura da PMO
     └─ Linhas, Máquinas e Blocos
```

## 4. Modelo de dados

Todas as tabelas têm RLS por módulo (`tem_permissao('setup', <nível>)` envolvido em `(select …)`, padrão da 0096) e GRANTs explícitos (padrão da 0107).

| Tabela | Colunas principais | Regras |
|---|---|---|
| `st_equipamentos` | `id`, `processo` (SMD/PTH), `linha`, `maquina` (SMD) ou `bloco` (PTH), `posicoes` (int, opcional), `ativo` | Único por (processo, linha, maquina/bloco). Semeada com YSM10/MG5 (L1), YSM10 (L2, 148), CP40 (L3); PTH Linhas 1–6 × Blocos A/B. |
| `st_estrutura` | `pmo`, `componente` (código do ERP normalizado), `processo` (SMD/PTH), `origem` (importação/manual), `criado_em`, `criado_por` | PK (pmo, componente). |
| `st_setups` | `id`, `pmo`, `op`, `processo`, `linha`, `maquina_bloco`, `face` (normalizada), `sn_abertura`, `estado` (`montagem`/`liberado`), `copiado_de` (setup de origem), `criado_por/em`, `liberado_por/em` | Único por (pmo, op, processo, linha, maquina_bloco, face). |
| `st_setup_itens` | `id`, `setup_id`, `posicao` e `feeder` (SMD) ou `posto` e `locacao` (PTH), `componente`, `rolo` (código completo, nulo = falta bipar), `atualizado_por/em` | Únicos por setup: (posição, feeder) / (posto, locação); feeder único no setup; rolo único no setup. |
| `st_trocas` | `id`, `setup_id`, `item_id`, `posicao/feeder` ou `posto/locacao` bipados, `rolo_saida`, `rolo_entrada`, `sn_inicial`, `resultado` (APROVADO/REPROVADO), `motivos` (text[]), `operador` (usuário), `data_hora` | Grava toda tentativa. |
| `st_alteracoes` | `id`, `setup_id`, `item_id`, `tipo` (troca de feeder, troca de posição, correção, inclusão, remoção), `antes` (jsonb), `depois` (jsonb), `usuario`, `data_hora` | Toda mudança do admin em setup liberado. |

**Textos normalizados:**
- **Posição, feeder, posto, locação e códigos:** maiúsculas e sem espaços nas pontas, sempre como texto ("01" continua "01").
- **SN:** usa a mesma normalização do ShopFloor.
- **Face:** `TOP`, `BOT` ou `TOP E BOT` (a forma "BOT E TOP" vira "TOP E BOT").

## 5. Regras de negócio (domínio TS puro + reforçadas no banco)

**Código do rolo:**
- `PREFIXO` = texto até o primeiro separador (`-`, `–`, `—`, `_`, `:`, `/` ou espaço).
- `SEQUENCIAL` = o resto. Comparado sem zeros à esquerda.
- **É um só parser** pro SMD e pro PTH.

**Faces:** duas faces se sobrepõem se forem iguais ou se uma for `TOP E BOT`.

**Montagem (inclusão de item), recusa com motivo quando:**
1. O setup está **liberado** (só admin mexe, pela edição).
2. O **componente** do rolo (código antes do `-`) não está na estrutura da PMO, ou é de **outro processo** (SMD × PTH).
3. **Posição + feeder** (ou posto + locação) já existe no setup.
4. O **feeder já está em outra posição**, ou a **posição já está com outro feeder**.
5. O **rolo** já está montado em outra posição do setup.
6. **Setup copiado**, posição que já existe na cópia: o rolo bipado precisa ser do **mesmo componente** da posição.

**Copiar de OP anterior:**
- Lista os setups da **mesma PMO**, mesmo processo, linha, máquina/bloco e face, do mais recente pro mais antigo.
- Cria o setup novo com os itens (posição, feeder, componente) e `rolo = nulo`.

**Liberar:** só quando todos os itens têm rolo e o setup tem ao menos 1 item.

**SN de Abertura / SN Inicial:** precisam estar na faixa de SN da OP (`sf_ordens.sn_ini`/`sn_fim`, mesma regra do `serieDentroDaFaixa` do ShopFloor). Fora da faixa, recusa. **OP sem faixa cadastrada:** o SN é aceito e gravado sem conferência (a tela avisa que a OP não tem faixa).

**Troca de rolo (Abastecimento):** só em setup liberado. APROVADO somente se todas passarem, e os motivos saem na ordem abaixo:
1. Posição e feeder existem no setup e estão juntos (mensagens específicas: posição inexistente, feeder inexistente, par não confere).
2. Rolo que sai = rolo montado no item.
3. Prefixo do rolo que entra = prefixo do rolo que sai (mesmo componente).
4. Sequencial diferente (outro rolo).
5. SN Inicial na faixa da OP.

APROVADO atualiza `st_setup_itens.rolo` para o rolo que entrou. Toda tentativa grava em `st_trocas`.

**Operação atômica no banco:**
- **Funções `security definer`** checam a permissão explicitamente: `st_incluir_item`, `st_liberar_setup`, `st_trocar_rolo`, `st_copiar_setup` e `st_editar_item` (admin).
- **Lock por setup** (`pg_advisory_xact_lock`), pra dois tablets não gravarem o mesmo feeder ou trocarem o mesmo rolo ao mesmo tempo.
- **Constraints únicas** como última linha de defesa.

**Reenvio:** o botão fica travado enquanto grava. O banco não "deduplica" devolvendo resultado antigo: cada tentativa é avaliada de novo.

## 6. Telas

**Montar Setup**
1. **Cabeçalho:** OP (combobox das OPs do ShopFloor) → Processo → Linha → Máquina/Bloco → Face → SN de Abertura.
2. **Setup existente:** abre pra continuar. **Não existe:** "Montar do zero" ou "Copiar de uma OP anterior".
3. **Bipe:** Posição → Feeder → Rolo. Enter avança e o último Enter grava. Depois de gravar, limpa e volta o foco pra Posição.
4. **Resultado:** painel grande verde/vermelho (`PainelResultado`) com o motivo, e som de erro (`som-erro`) na recusa.
5. **Lista de itens:** posições com componente, rolo e a marca "falta bipar o rolo". Enquanto está em montagem, quem lança pode **remover** um item.
6. **Liberar setup:** habilitado quando não falta rolo.

**Abastecimento**
1. **Seleção:** OP → Linha → Máquina/Bloco → Face (só setups liberados).
2. **Bipe:** Posição → Feeder → Rolo que sai → Rolo que entra → SN Inicial. O último Enter grava.
3. **Resultado:** painel + som; no APROVADO, limpa e volta pra Posição.
4. **Histórico:** últimas trocas desse setup.

**Consultas**
- **Setups:** filtros (cliente, PMO, OP, processo, linha, máquina/bloco, face, estado). O setup aberto mostra o mapa com o rolo montado, a busca rápida e o histórico de alterações.
- **Trocas de rolo:** filtros (período, OP, linha, máquina, resultado, posição, rolo, SN Inicial), tabela paginada e exportação CSV/Excel.

**Cadastros**
- **Linhas, Máquinas e Blocos:** CRUD simples.
- **Estrutura da PMO:**
  - escolher a PMO → lista de componentes (código e processo) → adicionar ou remover código (informando SMD/PTH);
  - **Importar a composição de produto do ERP** com prévia → confirmar.

  **Formato do arquivo** (exemplo: `composicao_produto_com_preco_PMOG13.xlsx`):
  - Aba "COMPOSIÇÃO DE PRODUTO"; linha 1 = empresa; **linha 3 = cabeçalho**; itens a partir da linha 4. Colunas localizadas pelo **nome do cabeçalho**: `NÍVEL`, `CÓDIGO ITEM`, `DESCRIÇÃO ITEM`, `LOCALIZAÇÃO`.
  - **PMO** = `CÓDIGO ITEM` da linha de **nível 1**. A PMO precisa existir no ShopFloor; se não existir, a importação é recusada.
  - **Entram só as linhas com `LOCALIZAÇÃO` preenchida** (componentes de montagem). Embalagem, subconjuntos e a placa nua ficam de fora e aparecem na prévia como ignorados, com o motivo.
  - **Processo** = pelo subconjunto pai: itens abaixo de uma linha cuja descrição começa com "PARTES PTH" são PTH; abaixo de "PARTES SMD", SMD (o pai é a linha mais próxima acima com nível menor). Componente sem subconjunto reconhecível aparece na prévia como "processo indefinido" e não entra.
  - **Prévia:** novos, já existentes (sem mudança), processo diferente do cadastrado (atualiza), ignorados, duplicados no arquivo.
  - Importar **não remove** componentes que já estavam na estrutura e não vieram no arquivo; a prévia os lista pra remoção manual.
- **Remoção de componente em uso:** não altera setups existentes; só impede novos usos.
- **Edição no meio da OP (admin, setup liberado):** trocar o feeder de uma posição, trocar a posição de um feeder, corrigir um item, incluir ou remover. Mesmas regras de unicidade, tudo registrado em `st_alteracoes`.

## 7. Fora do escopo desta versão
- Relatório "qual rolo estava na máquina quando a placa X foi feita" (os dados já ficam gravados).
- Renomear campos do PTH (aguardando a produção).
- Migração da planilha.
- Descrição/quantidade do componente.

## 8. Testes
- **Domínio (Vitest):**
  - parser do código;
  - normalização e sobreposição de faces;
  - regras de unicidade da montagem;
  - avaliação da troca com os motivos em ordem;
  - SN na faixa;
  - pré-condições de liberação.
- **Banco (Postgres descartável):** migrações, RLS por nível, funções atômicas (incluir, copiar, liberar, trocar, editar) e dois bipes concorrentes no mesmo feeder ou rolo.
- **Smoke do usuário no preview**, com as migrações no Dev.

## 9. Pendências com a produção
- Significado de Bloco, Posto e Locação no PTH, e se as Linhas 1–6 e os Blocos A/B são reais.
