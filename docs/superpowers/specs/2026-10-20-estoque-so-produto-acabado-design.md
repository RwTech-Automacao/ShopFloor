# Estoque só do produto acabado no card do Fluxo (rascunho para aprovação)

Estado: **rascunho de 20/10/2026**, sem código. **Bloqueado por uma captura** do Compels (abaixo).

## Situação hoje

O card **Estoque no Compels** (embaixo do Concluído, no Fluxo da OP) mostra o estoque **próprio** do item **somando todos os estoques** do Compels:
`buscarEstoqueCompels(pmo)` (`infra/estoque-compels.ts`, cache de 60 s) → `ClienteCompels.consultarSaldoItem(codigo)` → `POST /itemMovimento/findFilter` (form `filter` JSON
`{codigo, descricao, data, exibeItensComSaldoZerado:true}`, mais `page`, `start`, `limit`). `saldoDoItem` (`domain/saldo-item.ts`) confere o código exato e lê `saldoItemEstoqueProprio`,
`saldoItemPendencia`, `saldoItemEstoqueEmTerceiros`, `saldoItemEstoqueDeTerceiros`. O número mostrado (`proprio`) **não é só o produto acabado**.

O destino das entradas da integração é o estoque **217 "PA"**, locação **5314 "Padrão"** (`COMPELS_ESTOQUE_ID`, `COMPELS_LOCACAO_ID`).

## O que se sabe e o que falta

- A resposta da linha traz também `saldoLote`, `saldoLoteEstoque` e `saldoLoteLocacao` (spec de 16/10, §2.7), mas a própria spec registra: **"Não temos a quebra por estoque/locação (217 × 224 × ...)"**
  e que seria preciso outra captura. Nada no código lê esses campos.
- **Falta captura:** a chamada que a tela **Movimento de Item** faz ao **expandir a linha do item**, com a resposta, e uma resposta de um item que esteja em mais de um estoque (217 `PA` e 224 `EINTER`).

## Proposta

1. Se `saldoLoteEstoque` vier como lista com `estoque.id`, filtrar `estoque.id == 217` (configuração `COMPELS_ESTOQUE_ID`) em `domain/saldo-item.ts` e criar `saldoPaDoItem`.
2. Se a linha principal **não** trouxer a quebra, adicionar `consultarSaldoPorEstoque(itemId)` ao `ClienteCompels` com o endpoint capturado.
3. O card passa a mostrar **"Produto acabado (PA)"** e, em tom secundário, o total.

## Testes

Fixtures sanitizadas da resposta expandida em `domain/__tests__/saldo-item.test.ts` (item só no 217; no 217 e no 224; em nenhum; estoque ausente), cliente em `infra/__tests__/cliente.test.ts`, cache e erro em
`shopfloor/infra/__tests__/estoque-compels.test.ts`. O fake local precisa devolver a quebra por estoque.

## Riscos

- Mostrar um número "PA" errado se o filtro por estoque falhar silenciosamente: na dúvida, mostrar o total com o rótulo atual, nunca o PA suposto.
- API interna sem contrato: o formato pode mudar.
- A consulta roda ao abrir o Fluxo (uma vez por PMO por minuto): com a chamada extra por item, observar o tempo de resposta (timeout atual de 10 s).

## Capturas que preciso do usuário

No Compels, **Movimento de Item**: pesquisar uma PMO que esteja no estoque 217 e em outro (por exemplo 224), **clicar na linha para expandir** o detalhe por estoque/locação e salvar o HAR da expansão
(DevTools → Network → Preserve log → "Save all as HAR with content"), depois rodar `tools/compels/sanitizar_har.py`. Os HARs brutos têm token e **não vão para commit**.
