# Integração ShopFloor → Compels: entrada de produto acabado (Requisitar + Apontar)

**Data:** 16/10/2026 · **Estado:** rascunho de spec — a escrita no Compels ainda não foi capturada nem testada.
**Escrito para:** quem for implementar a integração e para a conversa com o Valdeí (Compels).
**Relacionado:** posto Almoxarifado (migrações 0128–0133, fila `sf_estoque_envios`, branch `feat/posto-almoxarifado`, ainda não mergeada).

---

## 1. Objetivo

Hoje o Almoxarifado dá entrada do produto acabado no estoque **à mão, no Compels** (tela Ordem de Produção → abas Requisitar e Apontar). O posto Almoxarifado do ShopFloor passa a registrar essa entrada; a integração replica o mesmo gesto no Compels, sem redigitação.

A integração **não** mexe em saldo direto. Ela faz o que o Almoxarifado faz na tela: **Requisitar** e **Apontar** na OP.

## 2. Como o Compels funciona (confirmado em leituras de 16/10, OP 8669 / PMOC57 / 149 un.)

### 2.1 Processo de negócio

| Etapa | Quem | Quando | Quantidade |
|---|---|---|---|
| Empenhar | Almoxarifado | Quando o material é pago/liberado | A OP inteira **ou em partes** (ver §2.5: a OP 8697 foi empenhada 4 + 1 + 5) |
| Requisitar | Almoxarifado | No momento da entrada em estoque | Só o que **já foi produzido e deu entrada** |
| Apontar | Almoxarifado | Logo depois do Requisitar | Idem |

- Entrada **parcial** é normal (quantidades "quebradas"). Cada entrada vira **um apontamento**.
- Regra de ordem do ERP: `apontada ≤ requisitada ≤ empenhada ≤ Qtd Total da OP`. Entrega acima da OP é recusada pelo ERP.
- Apontar **consome os insumos sozinho** (BOM × quantidade) e pode ser recusado por falta de saldo de componente.
- Apontar **cria um lote** do produto acabado e o saldo desse lote num estoque/locação. É assim que o produto entra no estoque; não existe POST de saldo direto. No exemplo: lote 260800720, estoque id 217, locação id 5314. A janela de apontamento não pede destino, então a hipótese é que o destino vem do cadastro do item (a confirmar).
- Ao apontar tudo, a OP passa de "Em Processo" para **"Produzida"**.
- A tela tem botão **Estornar** pré-preenchido com a quantidade apontada nas três abas. Um clique desfaz o apontamento.

### 2.2 Mapeamentos

- Nº da OP no Compels = nossa OP. Código do produto no Compels = nosso PMO (8403/PMOC31, 8669/PMOC57).
- Constantes vistas: Tipo Propriedade `0`, Negociante `160`, empresa `133`, unidade `UN`.
- Três ids diferentes: **número** da OP (8669) ≠ **id interno** da OP (13047) ≠ id do empenho (7064). A integração tem que resolver número → id.
- A OP pode ter **OPs filhas** (8669 → 8670 PMOC60). A integração só mexe na OP recebida, nunca nas filhas.
- Classificação do apontamento é opcional (`{id: 0}`) e a lista está vazia na empresa.

### 2.3 API (host `https://api.erpeasy.compels.net`)

É a API **interna da tela web**, no mesmo host da API pública do Swagger, mas **sem `/v1`** e com endpoints que o Swagger não lista (o estudo de 05/10 confirmou que a API pública não tem verbo de apontamento/empenho/requisição). Autenticação OAuth2 com token Bearer do usuário da sessão (cerca de 3 h de validade). Cabeçalho de resposta `vr: 002.300.001` indica a versão.

**Leituras mapeadas:**

| Para quê | Chamada |
|---|---|
| Achar a OP pelo número | `POST /ordemProducaoSimples/findAllFilter` (form: `filtro` JSON com `numero` e janela `dataInicial`/`dataFinal`, `page`, `start`, `limit`) |
| Dados da OP | `POST /ordemProducaoSimples/findById` (`id`) |
| Empenhos da OP | `GET /empenho/findByOrdemProducaoId?idOrdemProducao=` e `GET /empenho/findById/{id}` |
| Requisições da OP | `POST /requisicaoOrdemProducao/findByOrdemProducaoId` (`id`) e `POST /requisicaoOrdemProducao/findById` (`id`) |
| Apontamentos da OP | `POST /apontamentoOrdemProducao/findByOrdemProducaoId` (`id`) e `POST /apontamentoOrdemProducao/findById` (`id`) |
| OPs filhas | `POST /ordemProducaoSimples/findOpsFilhasbyId` |

**Trava de edição:** abrir a OP faz `POST /lock/eng.ordemproducaosimples/{idOP}` (201) e repete `PUT /lock/keep/...` a cada 20–30 s. OP aberta na tela de alguém fica **travada**; a gravação pode ser recusada.

### 2.4 ⚠️ Armadilha dos contadores

Os contadores de **listas** e da **OP embutida** dentro de qualquer detalhe vêm **zerados** mesmo quando tudo foi feito (ex.: OP 8669 com 149 apontados mostra 0).

Fontes confiáveis, por ordem de robustez:
1. **Soma dos registros de apontamento** (`apontamentoOrdemProducao/findByOrdemProducaoId` → `quantidadeProduzida` de cada um; a lista mostrou 149 correto).
2. `requisicaoOrdemProducao/findById` → `quantidadeApontada`, `quantidadeRequisitada`.
3. `empenho/findById` → `quantidadeEmpenhada`, `quantidadeRequisitada`.
4. `ordemProducaoSimples/findAllFilter` (a linha da OP vem com produzida/requisitada/empenhada reais), usar só como conferência.

Regra: **nunca concluir "nada foi enviado" a partir de zeros**; sempre cruzar com o nosso histórico e, se divergir, parar com erro "leitura inconsistente".

### 2.5 Caso real com entradas parciais: OP 8697 (10 un., lida em 16/10)

| Data | Empenho | Requisição | Apontamento (quem) | Lote |
|---|---|---|---|---|
| 30/09 | nº 1: 4 | nº 1: 4 | nº 1: 4 (Almoxarifado) | 260900446 |
| 02/10 | nº 2: 1 | nº 2: 1 | nº 2: 1 (Almoxarifado) | 261000018 |
| 06/10 | nº 3: 5 | nº 3: 5 | nº 3: **3** (Almoxarifado) | 261000102 |
| 08/10 | — | — | nº 4: **2** (usuário genérico "Expedicao", **sem requisição nova**) | 261000135 |

O que isso ensina:

1. **Empenho também é parcial** na prática (4, 1 e 5, em dias diferentes). A regra "empenho = OP inteira" não vale sempre.
2. **Requisição e apontamento não são 1 para 1.** A requisição nº 3 (5 un.) foi apontada em dois apontamentos (3 + 2). Por isso a decisão "uma requisição + um apontamento por entrada" **precisa ser revista** (ver §3.2).
3. **Contadores confiáveis:** soma dos apontamentos = 4 + 1 + 3 + 2 = 10 = OP. Cada `requisicaoOrdemProducao/findById` traz `quantidadeApontada` (4, 1, 5) e `quantidadeRequisitada` = **10, o total da OP**, não o da requisição. As listas continuam zeradas.
4. **Destino do estoque é fixo:** os 4 lotes entraram no mesmo estoque **217** e locação **5314** (mais o apontamento da OP 8669: 5 de 5). O destino vem sozinho, sem o usuário escolher. A confirmar só se vale para outros produtos.
5. **Lote:** o ERP numera sozinho (AAMM + sequência de 5 dígitos, recomeça a cada mês). A integração não manda número de lote.
6. **Datas:** `dataInicio` é a mesma nos quatro (00:00 de 30/09, igual à `dataInicial` da OP); `dataFim` é a hora do gesto, poucos segundos antes do registro (`data`).
7. **Mãe × filhas:** a OP 8697 está "Produzida" com 10/10 enquanto as filhas 8699 e 8700 estão "Aberta" (8698 e 8701 "Produzida"). Apontar a mãe **não exigiu** as filhas apontadas (um caso só).
8. **Responsável** do apontamento é o usuário que fez; um usuário de serviço aparecerá como tal.
9. O JSON do apontamento **não tem campo `observacao`** nem marca de estorno em nenhum dos 5 apontamentos vistos. O campo é omitido quando vazio ou não existe: continua sem prova para idempotência.

## 3. Desenho da integração

### 3.1 Fonte da verdade e fila

- Fonte da quantidade: as **entradas vigentes** do Almoxarifado na OP (não canceladas), em ordem. Acumulado `C(k)` após a entrada `k`.
- Fila existente do posto Almoxarifado (`sf_estoque_envios`) alimenta o worker; cada linha = uma entrada.

### 3.2 Algoritmo por OP (uma OP por vez, uma entrada por vez, em ordem)

Para a entrada `k` (quantidade `q_k`, acumulado anterior `C(k-1)`, novo `C(k) = C(k-1) + q_k`):

1. Resolver número → id interno da OP; ler status e contadores confiáveis (§2.4): `apontada` = soma dos apontamentos, `requisitada` = soma das requisições, `empenhada` = soma dos empenhos.
2. **Só estoque próprio:** `tipoPropriedade` da OP tem de ser 0; senão erro legível e a entrada é feita à mão (estoque em terceiros não é tratado).
3. Comparar `apontada` do ERP (antes de olhar o empenho: uma entrada já enviada nunca falha por falta de empenho):
   - `apontada ≥ C(k)` → já enviada, marca como enviada e segue;
   - `apontada == C(k-1)` → confere o **empenho** (empenhada ≥ `C(k)`; senão erro legível **"OP sem empenho suficiente"**, a integração **não empenha**: o empenho está ligado ao pagamento do material) e **envia** (passo 4);
   - qualquer outro valor (ex.: alguém apontou à mão) → **PARA** com **"OP com apontamento fora do esperado"**. Não conta em dobro.
4. **Requisitar só se faltar cobertura:** se `requisitada < C(k)`, Requisitar a diferença (`C(k) − requisitada`). Depois, **Apontar `q_k`**. Isso reproduz os dois jeitos que o Almoxarifado já usa (OP 8697): requisição nova para cada entrada, e apontamento extra dentro de uma requisição que já cobria.
5. Falha no meio (requisitou e não apontou) retoma sozinha: lê de novo e manda só o que falta.
6. Depois de gravar, **reler** e conferir que o ERP refletiu `C(k)`; só então marca enviado.

**Decisão a revisar (precisa do usuário):** a decisão de 16/10 era "uma requisição + um apontamento por entrada". A OP 8697 mostra que o jeito real é mais flexível. A proposta acima (um apontamento por entrada; requisição só quando falta cobertura) mantém um apontamento por entrada e evita requisições redundantes.

### 3.3 Erros legíveis (aparecem na tela de pendências)

| Situação | Mensagem | Tenta de novo? |
|---|---|---|
| OP aberta/travada por alguém | "OP em uso no Compels" | Sim |
| Sem empenho suficiente | "OP sem empenho suficiente" | Quando o empenho existir |
| Falta saldo de componente | texto do ERP | Quando houver saldo |
| Entrega acima da OP | texto do ERP | Não |
| ERP diverge do esperado | "OP com apontamento fora do esperado" | Não, exige gestor |
| Contadores incoerentes com o histórico | "Leitura inconsistente" | Não |
| Token expirado / 401 | renova e tenta de novo | Sim |
| Rede/5xx | backoff | Sim |

### 3.4 Autenticação e segurança

- Usuário e cliente de **serviço** dedicados, criados pelo Valdeí, com permissão nas telas de Requisição e Apontamento. **Nunca** o token de uma pessoa.
- Credenciais só em variáveis de ambiente do servidor; nunca em código, log, memória ou chat.
- Não ler nem registrar as respostas de `parametrizacao` e `getUsuarioEEmpresaSessao`.
- **Nunca gravar direto no banco do Compels.** Acesso ao banco, se vier, é só de leitura.

### 3.5 Implantação gradual

- Cliente `compels.ts` testado contra **respostas gravadas** (fixtures sanitizadas), antes de qualquer chamada real.
- Liga **OP por OP** (lista de OPs liberadas). Enquanto uma OP estiver ligada, **ninguém aponta à mão** na mesma OP (duplicaria); isso precisa de aviso aos usuários.
- Fase 2 (fora deste escopo): **estorno**, em ordem inversa (apontamento antes da requisição). Confirmado na tela (OP 8191, 16/10): estornar a **requisição** com tudo já apontado é recusado pelo ERP ("Quantidade Estornar excede a quantidade permitida"); com quantidade 0 também ("Quantidade Estornar deve ser maior que 0"). Ou seja, o ERP impõe a ordem e valida a quantidade.

## 4. Riscos

1. **API interna sem contrato.** Pode mudar sem aviso (o cabeçalho `vr` ajuda a detectar). Mitigação: fixtures + alerta quando a resposta mudar de forma.
2. **Autorização.** Usar a API interna com usuário de serviço exige o aval do Compels. O usuário consegue obter.
3. **Trava de edição** pode bloquear gravações em horário de uso. Mitigação: retentativa com backoff.
4. **Gesto de gravar ainda desconhecido** (URL, corpo, resposta de sucesso/erro). É o maior bloqueio técnico.
5. **Apontamento manual concorrente** na mesma OP. Mitigação: o passo 3 do algoritmo para em vez de duplicar.
6. **Destino do estoque** presumido automático (a confirmar).
7. **Idempotência** sem chave nossa: depende do algoritmo por contadores. A ideia de gravar nossa chave na Observação não está provada (nenhum apontamento visto tem Observação preenchida).

### 4.1 O que o Almoxarifado disse sobre o dia a dia (Gilvânia, 16/10, 14:07)

"Várias situações acontecem: falta de saldo, atualização de estrutura, estoque em terceiro. Varia muito.
Unidade de medida na ordem diferente da entrada do item (embalagens, colas, silicones)."

Consequências para o desenho:
- **O Compels vai recusar com frequência** (falta de saldo, estrutura mudada). A mensagem do ERP tem de chegar **inteira** à tela de pendências, e a entrada fica pendente até alguém resolver; nunca é descartada.
- **Estoque em terceiros** não é tratado (`propriedade_nao_suportada`): entrada à mão.
- **Unidade de medida diferente** entre a OP e a entrada (embalagens, colas, silicones): a quantidade que o ShopFloor conta pode não ser a que o Compels espera. **Ainda sem tratamento**; primeiro ver quais produtos têm isso (decidir se a integração só atende produtos em `UN` e deixa o resto manual).
- Ela não respondeu sobre Observação nem sobre estorno.

## 5. Perguntas ao Valdeí (Compels)

1. Contrato/autorização para usar a API interna e criação do usuário de serviço com as permissões necessárias.
2. De onde vem o estoque/locação de destino do produto apontado e o que acontece se o item não tiver destino padrão.
3. Em que casos o Apontar é recusado numa OP "Produzida".
4. O estorno tem custo/efeito contábil?
5. Como funciona a trava (tempo de expiração, quem a segura, como ver quem está usando).
6. Limites (taxa de chamadas, vida do token, restrição de IP).

## 6. Pendências de captura

Ver §7 (leituras restantes) e §8 (gesto de gravar, por último).

## 7. Leituras

**Feitas em 16/10:** OP 8669 (entrada total) e OP 8697 (quatro apontamentos parciais, três empenhos, três requisições; ver §2.5). Respondem: empenho parcial, requisição × apontamento, destino do estoque, datas, mãe × filhas.

**Ainda faltam (sem gravar nada):**
- Apontamento com **Observação preenchida** (o campo não apareceu em nenhum dos 5 vistos).
- Apontamento **estornado/cancelado** (como aparece na lista e nos contadores; também o `quantidadeEstornar` com valor).
- Conferir o destino do estoque em **outro produto** (cadastro do item, sem salvar).
- Opcional: leitura de **banco** (só SELECT) para conferir os contadores.

## 8. Captura da escrita (por último)

Gesto de Requisitar/Apontar numa OP real ou de teste: URL, corpo e resposta de sucesso e de erro. Só depois disso o `compels.ts` pode ser escrito. Protocolo a combinar com o usuário.

## 9. Fora de escopo

Empenhar automático, estorno (fase 2), OPs filhas, número de série peça a peça, qualquer escrita direta no banco do Compels.
