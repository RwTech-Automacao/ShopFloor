# Compels: estorno automático e empenho automático (rascunho para aprovação)

Estado: **rascunho de 20/10/2026**, sem código. Complementa `2026-10-16-integracao-compels-apontamento-design.md` (fase 2). **Bloqueado por capturas**
que o repositório não tem (lista no fim). Só se afirma aqui o que tem evidência escrita; o resto está marcado como "falta captura".

## Situação hoje

- **Estorno é manual.** Cancelar uma entrada já enviada cria na fila uma linha `operacao = 'estorno'` (com `entrada_id`, 0132) que fica "Esperando o Compels", com o texto
  "O estorno no Compels ainda é manual", sem gastar tentativa (`criarPortaCompels`, `infra/compels.ts`). A ordem manual correta é **apontamento → requisição → empenho**.
- **Empenho é manual:** o Almoxarifado empenha antes; a integração só **confere** (`pendencia_no_erp`, `sem_empenho`).

## Evidência existente (spec de 16/10, §2.6, linhas 96–101)

| Gesto | Chamada | Corpo (campos) | Resposta |
|---|---|---|---|
| Estornar apontamento | `POST /apontamentoOrdemProducao/estornar` (form) | `quantidadeEstornar`, `apontamentoId`, `ordemProducaoId` | `{success:true, msg:"Apontamento estornado com sucesso!"}` |
| Excluir requisição | `POST /requisicaoOrdemProducao/excluir` (form `jsonData`) | `id`, itens com `quantidadeEstornar` e `quantidadeApontada` | "Requisição de mercadoria excluída com sucesso!" |
| Estornar empenho | `PUT /empenho/estornar` (JSON) | `id`, itens com `quantidadeEstornar` | 200 (corpo não registrado) |
| Criar empenho | `POST /empenho` (JSON) | OP, `quantidade`, itens (`item.id`, `quantidadeEmpenhar`, `itemOrdemProducaoId`) | `{message:"Empenho realizado com sucesso!"}` |

**Nenhum HAR com esses gestos está no repositório.** Os dois HARs em `~/Downloads` não têm `estornar`; o único `POST /empenho` presente deu 400. Regras vistas na tela: estornar a
requisição com tudo apontado é recusado; quantidade 0 é recusada; depois de estornar, as listas voltam **vazias** e a OP volta a "Aberta" (a soma das linhas reflete o estorno).

## Parte 1: estorno automático

**Problema central:** o apontamento no ERP **não tem marca nossa** (a observação não aparece nas leituras). Para saber **qual** `apontamentoId` estornar é preciso casar por quantidade, ordem ou data,
e entradas parciais ou manuais na mesma OP (OP 8697, apontamento manual "Expedição") tornam o casamento ambíguo.

**Regra proposta:** estornar automaticamente **só quando o ERP bate exatamente com o nosso acumulado**; em qualquer outra situação parar com erro legível e deixar manual.

**Fluxo proposto:** (1) OP liberada; (2) adquirir a trava `POST /lock/eng.ordemproducaosimples/{id}`, liberar sempre; (3) reler as três listas (nunca os contadores zerados); (4) conferir que a quantidade apontada
no ERP ≥ a estornar e igual ao acumulado esperado; (5) estornar o apontamento, reler; (6) excluir a requisição correspondente, reler; (7) empenho só se a parte 2 existir, senão continua manual com aviso. Idempotência por
**reconciliação** (se o ERP já está no valor de depois, marcar `ok` sem chamar). Erros a mapear: `op_em_uso`, `quantidade_acima`, `pendencia_no_erp`, leitura inconsistente (classes já existem em `domain/resposta-erp.ts`).

**Código:** método `estornarEntrada` no `ClienteCompels` (hoje só tem leituras, trava, `requisitar`, `apontar`, `consultarSaldoItem`), corpos em `domain/corpos.ts`, decisão pura em `estado-op`/`reconciliar`,
aplicação `application/enviar-estorno.ts` e um ramo no `criarPortaCompels`. **Testes:** corpos contra a captura sanitizada; decisão pura; aplicação com cliente falso (molde de `enviar-entrada.test.ts`); fila no harness SQL.
O fake local (`ShopFloor-ensaio/fake-compels.mjs`) **não cobre** `estornar`, `excluir`, `PUT /empenho/estornar` nem `POST /empenho`; precisa ganhar esses endpoints (a linha some das listas).

## Parte 2: empenho automático

- **Passo 1, só leitura:** relatório por OP liberada com empenhada (soma dos `findById`), requisitada, apontada, quantidade da OP e o nosso acumulado enviado; coluna "empenho que falta para cobrir a próxima entrada".
  Leituras conhecidas: `GET /empenho/findByOrdemProducaoId` e `GET /empenho/findById/{id}` (contadores de lista vêm **zerados**: cruzar sempre com `findById` e com o histórico).
- **Passo 2, decidir empenhar sozinho** (só depois de medir quantas entradas ficaram esperando por "sem empenho suficiente"): critério sugerido, não está em documento nenhum: autorização **formal** do Almoxarifado/Compels; só quando `empenhada < necessário` e sem "Pendente";
  nunca acima de `Qtd da OP − empenhada`; só a quantidade exata da entrada; só OP liberada e com trava.
- Fatos de negócio: ordem `apontada ≤ requisitada ≤ empenhada ≤ Qtd da OP`; falta de saldo gera `situacao:"Pendente"` **sem erro HTTP** e exige "Pagar Pendência"; o empenho está ligado ao pagamento do material (decisão de 16/10).

## Riscos

- Casar o apontamento errado ao estornar (sem marca nossa), principalmente com entradas manuais misturadas.
- Estorno **parcial** desconhecido; efeito no **lote criado** e no saldo dos componentes depois do estorno também (spec de 16/10, linha 276).
- Estornar apontamento sem a requisição (ou o inverso) deixa o ERP inconsistente se uma etapa falhar no meio: precisa de retomada pela fila e pela reconciliação.
- API interna, sem contrato (`vr: 002.300.001`) e **sem autorização formal do Compels**: o cron do estoque não deve ser ligado antes disso.
- Empenhar a mais, tomar o material de outra OP ou gerar "Pendente" que ninguém vê. O empenho pode ser um compromisso que o Almoxarifado queira controlar.
- Os HARs brutos têm token e **não vão para commit**: rodar `tools/compels/sanitizar_har.py`.

## Capturas que preciso do usuário (DevTools → Network → Preserve log → Fetch/XHR → "Save all as HAR with content")

1. **Estorno completo** numa OP de teste com apontamento e requisição criados por nós: Estornar o apontamento (quantidade total), Excluir a requisição, Estornar o empenho. Um HAR por gesto, com corpos e respostas.
2. **Estorno parcial:** apontamento de 10, estornar 4; ver se a requisição aceita estornar 4 e anotar a mensagem se recusar.
3. **Recusa por material já consumido:** estornar um apontamento cujo lote já foi movimentado e anotar a mensagem; abrir o Movimento de Item do componente antes e depois.
4. **`POST /empenho` de sucesso**, total e parcial, e um empenho que fique "Pendente".
5. **Observação do apontamento:** na tela de Apontamento da OP 8649, ver se o campo Observação aparece e se a lista devolve o texto (decide a marca para casar o apontamento a estornar).

## Ordem sugerida

Capturas → fake com os endpoints novos → estorno automático **restrito ao caso exato** → relatório de empenho (só leitura) → decisão sobre empenhar sozinho.
