# Estudo da API do Compels (ERP Easy)

**Data:** 23/09/2026
**Para que serve:** base da conversa com o Valdeí/Compels sobre o card do **posto Almoxarifado**
(bipar item/caixa no ShopFloor tem que dar entrada no estoque do ERP deles).

Tudo aqui saiu da documentação pública da API. **Nenhum endpoint de dados foi chamado** —
sondar o sistema de um terceiro sem autorização não faz parte do trabalho.

## Como chegar na documentação

| O quê | Endereço |
|---|---|
| Página do Swagger | `https://api.erpeasy.compels.net/swagger-ui/index.html` |
| Configuração que a página lê | `/v1/docs/swagger-config` |
| **Especificação OpenAPI (o que interessa)** | **`GET https://api.erpeasy.compels.net/v1/docs`** |

A especificação tem **1,7 MB** e **826 endpoints**, OpenAPI 3.0.1, título "ERP Easy - REST API".

**A API não é lenta.** Ela responde em **0,25 a 0,42 segundo**. A demora de ~10 minutos é a
página do Swagger montando 1,7 MB de documentação dentro do navegador. Isso importa para o
desenho: o tempo de resposta não é, por si só, impedimento para chamar durante o bipe.

**HTTPS funciona**, apesar de a especificação declarar `http://api.erpeasy.compels.net` como
servidor. Usar sempre HTTPS.

## Que tipo de API é

É **CRUD gerado automaticamente sobre as tabelas** (padrão Spring Data REST): um conjunto de
endpoints por entidade, relacionamentos enviados como lista de URLs (`text/uri-list`),
caminhos do tipo `/v1/itemLoteEstoque/{id}/estoque`. São 826 endpoints porque são as tabelas
do ERP, não operações de negócio.

**Essa é a questão central do card.** Numa API de negócio, chamar "dar entrada no estoque"
faz o ERP executar tudo: movimentação, custo, rastreio, histórico. Aqui o caminho aparente é
criar um registro com um campo de **saldo** — ou seja, **escrever o saldo** em vez de lançar
um movimento. Se as regras do ERP não rodarem nesse caminho, o estoque fica certo na tela e
errado na contabilidade, e ninguém descobre até o inventário.

## Endpoints de estoque

| Endpoint | Para quê |
|---|---|
| `GET/POST /v1/estoque` | Cadastro de estoques (depósitos). Campos: `codigo`, `descricao`, `id` |
| `GET/POST/PUT/PATCH/DELETE /v1/itemLoteEstoque` | **Saldo de um lote em um estoque** — o candidato a "dar entrada" |
| `/v1/itemLoteEstoque/{id}/estoque` e `/{id}/itemLote` | Ligações do registro com o estoque e com o lote |
| `GET/POST /v1/itemLote` | Lote de um item. Campos: `item`, `numero`, `ordemProducaoSimples` |
| `GET/POST /v1/itemLoteEstoqueLocacao` | Lote numa locação dentro do estoque |

**Corpo de `POST /v1/itemLoteEstoque`** (`ItemLoteEstoqueRestRequestBody`):

```
codigoEstoque, codigoItem, descricaoEstoque, descricaoItem,
estoque (URL), itemLote (URL), numeroLote, saldo, tipoPropriedadeEstoque, id
```

**Nenhum campo é declarado obrigatório** em nenhum schema da API — é característico desse
tipo de documentação gerada. A documentação não diz o que é exigido; só o pessoal do Compels
sabe.

## A descoberta mais importante: o ERP já tem um módulo de chão de fábrica

Além do CRUD gerado, existem endpoints de busca **escritos à mão**, e eles são exatamente o
nosso domínio:

| Endpoint | O que faz |
|---|---|
| `/v1/itemLoteNumeroSerie/search/findOneByNumeroSerie` | Acha a peça pelo número de série |
| `/v1/itemLoteNumeroSerie/search/**verificaIntegracao**` | Verificação de integração |
| `/v1/itemRotaEstacaoOrdemProducao/search/**findProximaRotaEstacao**` | Próximo posto da rota |
| `/v1/itemRotaEstacaoOrdemProducao/search/**getRotaEstacaoAnterior**` | **Posto anterior** |
| `/v1/testeOrdemProducao/search/findByNumeroSerieProduto` | Teste pelo SN do produto |
| `/v1/testeOrdemProducao/search/findTopBy…OrderByDataHoraAlteracaoDesc` | Último teste da peça |
| `/v1/itemEmbalagemOrdemProducao/search/findOneByItemLoteNumeroSerieNumeroSerie` | Embalagem pelo SN |

E os grupos correspondentes: *Estação de Ordem de Produção (Shopfloor)*, *Rota de Estação de
OP (Shopfloor)*, *Item na Rota de Estação de OP (Shopfloor)*, *Teste de Ordem de Produção*,
*Embalagem de Ordem de Produção*, *Defeito*, *Solução do Defeito*, *Conferente*.

Ou seja: **número de série, rota de postos, posto anterior e próximo, teste, defeito,
embalagem** — o ERP modela a mesma coisa que o ShopFloor. Esses endpoints foram escritos de
propósito, provavelmente para integrar com um sistema de chão de fábrica.

**Consequência prática:** pode existir um caminho de integração já pensado por eles, muito
melhor do que escrever saldo na mão. Vale perguntar antes de desenhar qualquer coisa.

## O que a documentação NÃO responde

- **Autenticação:** nenhum esquema de segurança é declarado na especificação, e a
  documentação abriu sem credencial. Não dá para saber, sem perguntar, se os endpoints de
  dados exigem token, usuário/senha ou chave por empresa.
- **Campos obrigatórios:** nenhum, em nenhum schema.
- **Regras de negócio:** se `POST /v1/itemLoteEstoque` movimenta estoque de verdade ou só
  grava um número.
- **Idempotência:** se a mesma chamada repetida duplica a entrada.
- **Limites:** nada sobre quantidade de chamadas por minuto.

## Perguntas para o Valdeí / Compels

1. **Vocês já têm um caminho de integração para sistema de chão de fábrica?** Os endpoints de
   rota de estação, teste por número de série e `verificaIntegracao` sugerem que sim. Se
   existe, é por ele que devemos entrar, e não escrevendo saldo.
2. **Qual é o endpoint oficial para dar entrada no estoque?** `POST /v1/itemLoteEstoque` é o
   caminho aprovado?
3. **Gravar `saldo` executa a movimentação** (custo, rastreio, histórico contábil) ou só
   escreve o número na tabela?
4. **Como autentica?**
5. **Existe ambiente de teste?** Testar escrita de estoque na base real é criar divergência
   de propósito.
6. **Chamada repetida duplica a entrada?** Aceita um identificador nosso para evitar isso?
7. **Como amarrar nossa PMO/OP à ordem de produção de vocês** (`ordemProducaoSimples` tem
   `numero`, `codigoProduto`, `numeroPedidoVenda`)?
8. **Vocês querem receber os números de série peça a peça?** O modelo de vocês
   (`itemLoteNumeroSerie`) permite, e isso daria rastreio por peça no ERP.
9. **Como desfazer uma entrada**, quando um lançamento é cancelado no ShopFloor?
10. **Existe limite de chamadas** que a gente precise respeitar?

## Como isso encaixa no card do Almoxarifado

Desenho preliminar, a confirmar depois das respostas:

- **Almoxarifado vira um posto** do fluxo, com permissão própria, mesma lógica do Lançamento
  (como a Integração virou posto). Bipar item ou caixa nesse posto é o evento que dá entrada
  no estoque.
- **O bipe não espera o ERP.** Grava no ShopFloor na hora e enfileira o envio, reaproveitando
  a fila de envios que já existe nos Alertas (tentativa com repetição, reserva, contagem de
  falhas). Mesmo com a API respondendo em 0,25 s, prender o operador a um sistema de terceiro
  é trocar um problema nosso por um problema deles.
- **Idempotência obrigatória.** Bipe repetido, tentativa após timeout ou reprocessamento da
  fila não podem virar entrada dobrada no estoque deles.
- **O que falhou precisa ficar visível** para alguém tratar. Divergência de estoque
  silenciosa é o pior resultado possível deste card.
- **Cancelamento de lançamento** no posto Almoxarifado precisa decidir o que fazer com a
  entrada já enviada (estornar ou bloquear o cancelamento).
