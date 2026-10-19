# Compels (ERP Easy) — caminhos para dar saldo no estoque

**Data:** 05/10/2026
**Continua:** `docs/estudo-api-compels.md` (23/09). Aquele arquivo fica como está; este corrige
dois pontos dele e vai mais fundo num assunto só.
**Para que serve:** decidir o desenho do último metro do posto Almoxarifado
(`src/modules/shopfloor/infra/compels.ts`) e cortar a lista de perguntas ao Valdeí para o que
realmente destrava.

**Pergunta única deste documento:** no ERP do Compels, **como se dá saldo no estoque pela API?**
O módulo de chão de fábrica deles desceu de prioridade de propósito (§6): não é o nosso problema.

## O limite, e como ele foi respeitado

Baixei **só a especificação pública** (`GET https://api.erpeasy.compels.net/v1/docs`, 1.721.568
bytes, HTTP 200, gzip). **Nenhum endpoint de dados foi chamado** — nem leitura. Tudo aqui saiu de
varredura por script no JSON da especificação. Sondar o sistema de um terceiro sem autorização não
faz parte do trabalho.

**Como ler este documento.** Cada afirmação está marcada:

- **[FATO]** — está escrito na especificação. Dá para conferir rodando o script de novo.
- **[INFERÊNCIA]** — minha conclusão a partir dos fatos. Pode estar errada, e quando puder estar eu
  digo por quê.

Essa separação é o valor do documento. Um caminho provável apresentado como certeza vale menos que
nada — faz a gente construir em cima de uma suposição sem saber que é uma.

---

## 1. Duas correções ao estudo de 23/09

**[FATO] Correção 1 — "nenhum campo é declarado obrigatório em nenhum schema" está errado.**
**163 dos 494 schemas declaram `required`.** Exemplos: `ItemRestRequestBody` exige
`codigo, descricao, linha, precoCustoPadrao, unidade`; `MovimentoRestRequestBody` exige
`contaBancaria, data, dataUltimaAlteracao, empresaId, numeroMovimento, usuarioUltimaAlteracao`.

Isso **muda o peso do silêncio nos schemas de estoque**. Antes parecia que o gerador simplesmente
não declarava nada; agora sabemos que ele declara quando há o que declarar. E **nenhum** dos
schemas de estoque (`EstoqueRest`, `ItemLoteRest`, `ItemLoteEstoqueRest`,
`ItemLoteEstoqueLocacaoRest`, `LocacaoRest`, `ItemLoteNumeroSerieRest`) tem `required`.

**[INFERÊNCIA]** Nesse tipo de gerador, `required` costuma espelhar coluna `not null` no banco.
Se for o caso aqui, as tabelas de estoque têm **todas as colunas anuláveis** — inclusive `saldo`.
Isso não é documentação faltando: é uma tabela que aceita quase qualquer coisa. Quem protege a
regra, então, não é o banco nem a API; é a aplicação deles, que a gente não vai usar. **Vale
confirmar com o Valdeí**, porque a conclusão prática é desconfortável: um `POST` nosso malformado
provavelmente é aceito em silêncio.

**[FATO] Correção 2 — a especificação não declara autenticação em lugar nenhum.** Varri o
documento inteiro: `components.securitySchemes` **não existe**, `security` no topo é **nulo**, e
**nenhuma das 2.202 operações** declara `security`. Antes isso era uma impressão da leitura; agora
é resultado de varredura.

**[INFERÊNCIA]** Não significa que a API seja aberta. Significa que a autenticação dela é
**invisível para quem só tem a documentação** — provavelmente resolvida fora do Spring Data REST
(um filtro, um gateway, um proxy). Continua sendo pergunta obrigatória.

---

## 2. Números da especificação, para contexto

**[FATO]**

| O quê | Quanto |
|---|---|
| Caminhos (`paths`) | **826** |
| Operações HTTP | **2.202** |
| Schemas | **494** (163 com `required`) |
| Recursos de primeiro nível (`/v1/<recurso>`) | **107** |
| Grupos (tags nas operações) | 106 |
| `readOnly` em qualquer campo | **0** |
| `nullable` em qualquer campo | **0** |
| `description` em qualquer campo ou schema | **0** |
| Esquemas de segurança | **0** |
| Endpoints `/search/` (escritos à mão) | **17**, em 10 recursos |

As três linhas de zero importam: **a especificação não tem uma única frase de documentação de
campo**. Nada é `readOnly` (então nada avisa "este campo é calculado, não mande"), nada é
`nullable` (então o documento não distingue "aceita nulo" de "não sei"). É uma planta baixa do
banco, não um contrato.

---

## 3. O inventário: tudo que é estoque, por nome

Varri **caminhos, nomes de schema, nomes de campo, grupos e descrições** procurando: `estoque`,
`saldo`, `movimenta`, `movimento`, `inventario`, `entrada`, `saida`, `deposito`, `almoxarifado`,
`lote`, `locacao`, `transferencia`, `ajuste`, `requisicao`, `nota`, `recebimento`, `stock`,
`balance`, `inventory`, `warehouse`, `movement` — com e sem acento. Esta é a lista completa.

### 3.1 O que é estoque de verdade — **seis recursos, e só eles**

**[FATO]**

| Recurso | Grupo | Operações | Verbos | Schema do corpo |
|---|---|---|---|---|
| `/v1/estoque` | Estoque | 6 | GET, POST, GET/PUT/PATCH/DELETE `{id}` | `EstoqueRestRequestBody` |
| `/v1/locacao` | Locação | 6 | GET, POST, GET/PUT/PATCH/DELETE `{id}` | `LocacaoRestRequestBody` |
| `/v1/itemLote` | Lote de Item | 18 | idem + relações `item`, `ordemProducaoSimples` | `ItemLoteRestRequestBody` |
| **`/v1/itemLoteEstoque`** | **Lote no Estoque** | **18** | idem + relações `estoque`, `itemLote` | **`ItemLoteEstoqueRestRequestBody`** |
| **`/v1/itemLoteEstoqueLocacao`** | **Lote na Locação do Estoque** | **18** | idem + relações `itemLoteEstoque`, `locacao` | **`ItemLoteEstoqueLocacaoRestRequestBody`** |
| `/v1/itemLoteNumeroSerie` | Número de Série no Lote | 33 | idem + 4 relações + **3 buscas** | `ItemLoteNumeroSerieRestRequestBody` |

Os campos, na íntegra **[FATO]** (tipo entre parênteses; nos `RequestBody` as relações viram
**string de URL**, que é como o Spring Data REST aponta para outro registro):

```
EstoqueRest                   id(int64)  codigo(string)  descricao(string)
LocacaoRest                   id(int64)                                   ← SÓ ISSO
ItemLoteRest                  id  numero(int64)  item(→Item)  ordemProducaoSimples(→OP)
ItemLoteEstoqueRest           id  saldo(double)  tipoPropriedadeEstoque(int32)
                              estoque(→Estoque)  itemLote(→ItemLote)  numeroLote(int64)
                              codigoEstoque  descricaoEstoque  codigoItem  descricaoItem
ItemLoteEstoqueLocacaoRest    id  saldo(double)  saldoInicial(double)
                              itemLoteEstoque(→)  locacao(→Locacao)
ItemLoteNumeroSerieRest       id  numeroSerie(string)  substituiu(string)
                              garantia(date-time)  itemLote(→)  itemLoteEstoqueLocacao(→)
                              itemRotaEstacaoOrdemProducao(→)  itemEmbalagemOrdemProducao(→)
                              itemNotaIcms(→)
```

Três observações que vão importar adiante **[FATO]**:

- **`saldo` só existe em dois lugares no estoque:** `ItemLoteEstoque` (saldo do lote num depósito) e
  `ItemLoteEstoqueLocacao` (saldo do lote numa locação dentro do depósito). Há um terceiro `saldo`
  na especificação, em `DuplicataRest`, que é saldo de título a receber — não é estoque.
- **`LocacaoRest` tem só `id`.** Nem código, nem descrição. Não há como saber, pela API, qual
  locação é qual.
- **`tipoPropriedadeEstoque` é um `int32` sem `enum` e sem descrição.** É um código de domínio
  (provavelmente "próprio / de terceiro / em terceiro") que a documentação não revela.

### 3.2 Os falsos positivos — e por que eles enganam

Isto é metade do valor da varredura. Três nomes parecem estoque e **não são** **[FATO]**:

| Nome | Parece | É |
|---|---|---|
| `/v1/movimento` (13 caminhos, 37 ops) | movimentação de estoque | **Movimento Bancário.** Campos: `contaBancaria`, `numeroMovimento`, `tipoCobranca`, `lancamentos`, `transferencia`. É extrato de conta. |
| `/v1/recebimento` (8 caminhos, 24 ops) | recebimento de mercadoria | **Recebimento/Pagamento.** Campos: `duplicata`, `compensacao`, `movimento`, `valor`. É baixa de título. |
| `/v1/notaICMS`, `/v1/notaISS`, `itemNota*`, `xmlNotaISS` (~200 ops) | entrada por nota | **Documento fiscal** (NF-e e NFS-e). Ver §5.3. |
| `transferencia` (campo em `MovimentoRest`) | transferência entre depósitos | **transferência entre contas bancárias** |

**Por que isto é importante:** se alguém varrer essa API procurando "movimento de estoque" e achar
`/v1/movimento`, vai desenhar a integração inteira em cima do extrato bancário. O nome bate; o
domínio, não.

### 3.3 O grafo mínimo do estoque

**[FATO]** Montado a partir dos `$ref` e dos caminhos de relação:

```
Item ──┐
       ├──< ItemLote >── OrdemProducaoSimples        (o lote nasce de uma OP deles)
       │        │
Estoque ├───< ItemLoteEstoque >── saldo              (saldo do lote NO DEPÓSITO)
       │        │
Locacao ├──< ItemLoteEstoqueLocacao >── saldo, saldoInicial   (saldo do lote NA LOCAÇÃO)
                │
                └──< ItemLoteNumeroSerie ── numeroSerie       (a PEÇA, com SN)
```

**[INFERÊNCIA]** Lê-se de baixo para cima: uma **peça com número de série** está numa **locação**,
que pertence a um **lote num depósito**, que é de um **item** e nasceu de uma **OP**. É um modelo de
estoque rastreado por série — exatamente o que a Enterplak precisa. **A estrutura serve.** O
problema não é o modelo; é não haver como mexer nele.

---

## 4. A resposta que mais importa: **não existe verbo de movimentação**

A pergunta era: nos 826 caminhos, existe algo que **movimenta** estoque (lançar, dar entrada,
ajustar, transferir) em vez de apenas **escrever** um número de saldo numa tabela?

**[FATO] Não existe. A varredura é exaustiva, e aqui está como ela foi feita** — porque "não achei"
só vale se der para checar.

Classifiquei **todos os 826 caminhos** em quatro formas. Cada caminho caiu em exatamente uma:

| Forma | Quantos | O que é |
|---|---|---|
| `/v1/<recurso>` e `/v1/<recurso>/{id}` | — | CRUD gerado |
| `/v1/<recurso>/{id}/<relacao>` e `.../{propertyId}` | — | ligar/desligar registros (Spring Data REST) |
| `/v1/profile/<recurso>` | 107 | metadados ALPS, gerados automaticamente |
| `/v1/<recurso>/search/<metodo>` | **17** | **o único código escrito à mão** |

**Sobrou zero.** Não há um único caminho na API que seja uma operação de negócio — nenhum
`/estoque/entrada`, `/movimentacao`, `/ajuste`, `/transferencia`, `/inventario`. O que existe fora
do CRUD é `/profile/*` (que é gerado) e as 17 buscas.

**[FATO] E das 17 buscas escritas à mão, nenhuma é de estoque.** A lista completa, por recurso:

| Recurso | Buscas |
|---|---|
| `conferente` | `findByEmail`, `findByEmpresaId` |
| `defeito` | `findOneByCodigoIgnoreCase` |
| `fatura` | `findNextNumero` |
| `itemEmbalagemOrdemProducao` | `findOneByItemLoteNumeroSerieNumeroSerie` |
| **`itemLoteNumeroSerie`** | **`findByNumeroSerie`, `findOneByNumeroSerie`, `verificaIntegracao`** |
| `itemRotaEstacaoOrdemProducao` | `findProximaRotaEstacao`, `findProximaRotaEstacaoWithItemRotaEstacaoOrdemProducaoIdNull`, `findRotaEstacaoOrdemProducaoById`, `getRotaEstacaoAnterior` |
| `movimento` | `findNextNumeroMovimentoByContaBancariaId` |
| `negociante` | `findNextCodigo` |
| `notaISS` | `findNextNumeroSaida` |
| `testeOrdemProducao` | `findByNumeroSerieProduto`, `findTopByItemLoteNumeroSerieNumeroSerieOrderByDataHoraAlteracaoDesc` |

**`estoque`, `locacao`, `itemLote`, `itemLoteEstoque` e `itemLoteEstoqueLocacao` não têm nenhuma.**
São CRUD puro, sem uma linha de código escrita para eles.

**[INFERÊNCIA] — e esta é a conclusão central deste documento.** O estudo de 23/09 achou só
`itemLoteEstoque` e perguntou se existiria algo melhor escondido nos 826 endpoints. **A resposta é
não.** Pela API pública, **escrever `saldo` é a única coisa que se pode fazer com o estoque deles.**

Isso **inverte o ônus da conversa com o Valdeí**. Antes a pergunta era "qual é o endpoint certo?",
como se houvesse um a descobrir. Agora é: *"só existe escrever saldo; isso movimenta estoque de
verdade? Se não, precisamos de um endpoint que não existe."* A segunda pergunta não se responde
com documentação — só o fornecedor responde, e talvez a resposta seja "vamos ter que criar".

---

## 5. Três coisas que a varredura revelou e ninguém tinha notado

### 5.1 **[FATO] Não há como consultar o estoque por item.** Nenhum filtro, em lugar nenhum.

Todas as coleções `GET /v1/<recurso>` aceitam **exatamente três parâmetros: `page`, `size`,
`sort`**. Não existe `?codigoItem=`, não existe `?projection=`, não existe `findBy` em estoque.

**Consequência prática, e é grave:** para somar quantidade ao saldo existente de um lote num
depósito, é preciso primeiro **achar aquela linha de `itemLoteEstoque`**. E não há como. As opções
são:

1. **paginar a tabela inteira** até achar (inviável: é a tabela de saldos de um ERP em produção, e
   seriam dezenas de requisições por bipe);
2. **guardar do nosso lado o `id`** que o ERP devolveu quando nós mesmos criamos a linha (só
   funciona para lotes que nós criamos, e nada impede o ERP de criar o mesmo lote pela tela deles);
3. **sempre criar linha nova** (e aí ou duplica saldo, ou o ERP rejeita).

**[INFERÊNCIA]** O caminho (a) do estudo anterior — "escrever saldo em `itemLoteEstoque`" — **não é
implementável como está**, e o motivo não é regra de negócio: é que não há como achar o registro
a atualizar. Mesmo que o Valdeí responda "sim, pode escrever saldo", ainda falta um `findBy`.
**Isso virou pergunta nova e é das que mais destravam** (§8, pergunta 3).

Nota de honestidade: o gerador declara as 17 buscas que existem, então ele **declara** buscas
quando elas existem. Por isso a ausência é evidência forte — mas não é prova: pode haver filtro
implementado e não documentado. É baratíssimo de confirmar com uma pergunta.

### 5.2 **[FATO] O caminho por peça tem busca por número de série — e isso dá idempotência de graça.**

`GET /v1/itemLoteNumeroSerie/search/findOneByNumeroSerie?numeroSerie=<SN>` → devolve
`EntityModelItemLoteNumeroSerieRest` com **200** ou **404**.

**[INFERÊNCIA]** Isso é o oposto do problema de 5.1. No caminho por peça existe uma pergunta
natural e barata — *"esta peça já está no estoque deles?"* —, e ela é respondida por um `GET` com a
chave que o operador acabou de bipar. **O 404 é o nosso teste de idempotência**, sem precisar que
eles aceitem um identificador nosso. Para uma fila com reenvio, como a nossa, isso é exatamente o
que falta: hoje a `chave` da 0132 é uma aposta de que eles aceitarão um id nosso (§7), e aqui a
aposta deixa de ser necessária.

Vale o aviso: o nome `findOneBy...` **[INFERÊNCIA]** sugere unicidade global do SN no banco deles.
Se dois clientes diferentes puderem ter a mesma série, essa busca é ambígua — e existe
`findByNumeroSerie` ao lado, que devolve o mesmo tipo mas talvez não o mesmo contrato. Perguntar.

### 5.3 **[FATO] O ERP marca "não movimenta estoque" no item da **nota fiscal**.**

`ItemNotaICMSRest` tem um campo booleano chamado **`naoMovimentaEstoque`**. E tem também
`ordemProducaoSimplesId`, `ordemProducaoSimplesNumero` e `ordemProducaoSimplesInspecaoId`.

**[INFERÊNCIA], e é a pista mais reveladora da varredura:** um campo que diz *"este item **não**
movimenta estoque"* só faz sentido se, por padrão, **o item da nota movimenta** — ou seja, **o
motor de movimentação de estoque do ERP está pendurado no documento fiscal**, não numa tabela de
saldo. É a arquitetura clássica de ERP brasileiro: a nota é o fato gerador, e `itemLoteEstoque` é o
**resultado** do processamento dela, não a porta de entrada.

Se isso estiver certo, então **escrever `saldo` direto é escrever no resultado, pulando o motor** —
exatamente o cenário do estudo de 23/09: "o estoque fica certo na tela e errado na contabilidade, e
ninguém descobre até o inventário". **Isto não é resposta à pergunta 1; é uma razão forte para
desconfiar que a resposta será "não, não movimenta".** E, portanto, uma razão para fazer a pergunta
de um jeito que não aceite "pode escrever saldo" como resposta sem explicação.

---

## 6. O módulo de chão de fábrica deles — um parágrafo, como combinado

**[FATO]** Existe e é escrito à mão: `estacaoOrdemProducao` (`descricao`, `tipo`),
`rotaEstacaoOrdemProducao`, `itemRotaEstacaoOrdemProducao` (`sequencia`, `integrado`,
`estacaoOrdemProducao`, `testeOrdemProducao`), `testeOrdemProducao`, `embalagemOrdemProducao`
(`numeroSerie`, `quantidade`, `completa`, `revenda`), `itemEmbalagemOrdemProducao`, `defeito`,
`defeitoSolucao`, `conferente` — mais as 9 buscas da tabela do §4.

**[FATO] Nenhum desses endpoints escreve saldo, e nenhum tem `saldo` entre os campos.** O único elo
deles com o estoque é indireto: `ItemLoteNumeroSerie` aponta ao mesmo tempo para
`itemLoteEstoqueLocacao` (estoque) e para `itemRotaEstacaoOrdemProducao` (chão de fábrica).

**[INFERÊNCIA]** Então: **o módulo de chão de fábrica deles não é uma porta para dar entrada no
estoque.** Ele é um caminho para registrar que uma peça passou por uma estação — o que o ShopFloor
já faz, melhor, do nosso lado. Entrar por ali seria duplicar o nosso sistema dentro do deles, e
mesmo assim o saldo não se moveria. **Está encerrado como caminho de estoque.** Fica só a
observação de que `ItemLoteNumeroSerie` é o ponto onde os dois mundos se encontram — e é por isso
que ele aparece no Caminho B.

---

## 7. O que o bipe sabe × o que os endpoints pedem

O que a fila entrega ao último metro **[FATO]**, do `returns table` da `sf_estoque_reservar`
(0132) mais o que dá para buscar em `sf_ordens` por `(pmo, op)`:

| Temos | De onde |
|---|---|
| `chave`, `operacao` (entrada/estorno), `tentativas`, `criadoEm` | a fila |
| `pmo`, `op`, `posto` | a fila |
| `tipo` (`caixa`/`serie`), `bipe` (código da caixa ou série crua), `serieNorm` | a fila |
| `quantidade` (sempre positiva; o sentido é o `operacao`) | a fila |
| `cliente`, `descricao`, `acp`, `qtd` da OP, faixa `sn_ini`–`sn_fim`, `embalagem_individual` | `sf_ordens` |
| as séries que estão **dentro** de uma caixa fechada | `sf_caixas` |

O que `ItemLoteEstoqueRestRequestBody` pede, e se temos **[FATO]** para a coluna da esquerda,
**[FATO]** para a da direita:

| Campo deles | Temos? |
|---|---|
| `saldo` | **sim** (é a `quantidade`) — mas é saldo ABSOLUTO, não incremento (§5.1) |
| `codigoItem` / `descricaoItem` | **NÃO temos código.** Só `descricao` (texto livre) e `acp` |
| `codigoEstoque` / `estoque` (URL) | **não** — nunca soubemos qual depósito é o almoxarifado |
| `numeroLote` / `itemLote` (URL) | **não** — o ShopFloor não tem conceito de lote |
| `tipoPropriedadeEstoque` | **não** — `int32` sem `enum` nem descrição |
| `id` | **não** — e não há como descobrir (§5.1) |

**[FATO] O buraco maior é o código do item.** `sf_ordens` tem `pmo, op, cliente, qtd, descricao,
acp, status, sn_ini, sn_fim` — **nenhuma coluna de código de produto**. Conferi o módulo todo: a
única menção a `codigo_produto`/`codigo_material` no ShopFloor está no comentário do próprio
`compels.ts`. (O `codigo_material` que aparece na memória do projeto é do módulo **Recebimento**,
outra coisa.)

**[INFERÊNCIA]** Isso quer dizer que **nenhum dos caminhos funciona sem trabalho do nosso lado**,
independentemente do que o Valdeí responder: alguém tem que estabelecer a correspondência entre
uma OP do ShopFloor e um **item** do catálogo do Compels. As duas formas são (i) guardar o código
do item na OP, no cadastro (uma coluna nova em `sf_ordens` e um campo na tela), ou (ii) uma tabela
de correspondência PMO→item mantida à mão. **Isto é um card nosso, e dá para começar agora** — não
depende de resposta nenhuma. É, de longe, a coisa mais produtiva a fazer enquanto o Valdeí não
responde.

**[FATO] Nota sobre multiempresa:** muitos `RequestBody` da API exigem `empresaId`
(`LancamentoRestRequestBody`, `MovimentoRestRequestBody`, `NotaISSRestRequestBody`,
`DuplicataRest...`), e `conferente` tem `findByEmpresaId`. **Os schemas de estoque não têm
`empresaId`.** **[INFERÊNCIA]** Ou o estoque não é multiempresa, ou a empresa é determinada pela
credencial. Isso liga direto na pergunta de autenticação, e errar significa dar entrada no estoque
da empresa errada.

---

## 8. Os três caminhos para dar saldo

Cada um tem: a sequência de chamadas, **o que teria de ser verdade** (a premissa que o Valdeí
confirma ou derruba) e o que pode dar errado. Nenhum dos três está pronto para implementar.

### Caminho A — escrever `saldo` em `itemLoteEstoque` (o do estudo anterior)

```
1. GET  /v1/estoque?page=&size=            → achar o depósito do almoxarifado (1×, em cache)
2. ???  achar o itemLote do produto da OP   → NÃO HÁ BUSCA. Ou criar:
   POST /v1/itemLote  { item: <URL>, ordemProducaoSimples: <URL>, numero }
3. ???  achar a linha itemLoteEstoque de (itemLote, estoque)  → NÃO HÁ BUSCA (§5.1)
4. PATCH /v1/itemLoteEstoque/{id}  { saldo: <saldo lido> + quantidade }
```

**O que teria de ser verdade:** (1) que gravar `saldo` **execute** a movimentação no ERP — custo,
rastreio, histórico contábil; (2) que exista alguma forma de **achar** a linha do passo 3; (3) que
exista onde pendurar a nossa chave de idempotência.

**O que dá errado:**
- **[FATO]** o passo 3 não tem endpoint. O caminho está interrompido no meio.
- **[FATO]** `saldo` é absoluto, não incremento. Então o passo 4 é ler-modificar-escrever **sem
  transação**: se alguém dá baixa pela tela do ERP entre a leitura e a escrita, **a nossa escrita
  apaga a baixa dele.** Não é corrida improvável; é o dia normal de um almoxarifado.
- **[FATO]** `ItemLoteEstoqueRestRequestBody` **não tem nenhum campo livre** para a nossa `chave`.
  Nem a API declara header de idempotência. Então um reenvio da fila **soma duas vezes**, e a única
  proteção seria a nossa fila nunca errar — o que é justamente o que uma fila com reenvio não pode
  garantir.
- **[INFERÊNCIA]** §5.3 sugere que este caminho escreve no resultado e pula o motor.

**Veredito [INFERÊNCIA]:** é o caminho aparente e **o pior dos três**. Se o Valdeí disser "pode
escrever saldo", ainda faltam um `findBy` e um lugar para a chave. Não construir em cima disto sem
as três confirmações.

### Caminho B — peça a peça, por `itemLoteNumeroSerie` ⭐

```
1. GET  /v1/itemLoteNumeroSerie/search/findOneByNumeroSerie?numeroSerie=<SN>
        → 200 = já está lá, não faça nada (idempotente)
        → 404 = segue
2. POST /v1/itemLoteNumeroSerie
        { numeroSerie, itemLote: <URL>, itemLoteEstoqueLocacao: <URL> }
```

Para o bipe de **caixa**, o laço roda uma vez por série de dentro dela (temos as séries em
`sf_caixas`) — a quantidade da caixa deixa de ser um número e passa a ser uma lista de peças.

**O que teria de ser verdade:** que o ERP **derive o saldo das séries**, ou que criar a série
**acione** o ajuste de saldo do lado deles. Se o saldo for um número independente que ninguém
recalcula, B registra as peças e **o saldo não se move** — o pior dos resultados, porque parece ter
funcionado.

**O que dá errado:**
- **[FATO]** `itemLoteEstoqueLocacao` ainda precisa existir e ser achado — e `LocacaoRest` tem **só
  `id`** (§3.1), então não há como saber qual locação é a certa sem alguém dizer o número.
- **[FATO]** só vale para peça com número de série. OP de embalagem coletiva funciona via
  `sf_caixas`; qualquer item sem série não tem caminho aqui.
- **[FATO]** N peças = N+1 requisições. A 0,25–0,42 s cada, uma caixa de 20 peças é ~10 s. Para a
  nossa fila isso é irrelevante (ela já é assíncrona); vale citar porque muda o `-m` do cron.

**Veredito [INFERÊNCIA]:** **é o melhor candidato**, e por uma razão de engenharia, não de gosto:
é o único que tem uma **pergunta de verificação** (`findOneByNumeroSerie`). Idempotência derivada
de um fato do ERP é mais forte que idempotência derivada de uma chave nossa que eles talvez
guardem. E é o caminho que dá rastreio por peça no ERP deles — o que a Enterplak quer de todo jeito.

### Caminho C — nota fiscal de entrada (`notaICMS` + `itemNotaICMS`)

```
1. POST /v1/notaICMS     { numero, serie, especie, tipo, dataEmissao, ... }
2. POST /v1/itemNotaICMS { notaICMS, itemId, codigo, quantidadeInterna,
                           ordemProducaoSimplesId, naoMovimentaEstoque: false, ... }
```

**O que teria de ser verdade:** que exista uma **espécie de nota interna** (entrada de produção,
sem emissão para a SEFAZ) e que lançá-la pela API faça o estoque andar.

**O que dá errado:**
- **[FATO]** `ItemNotaICMSRestRequestBody` tem **315 campos** — impostos, CFOP, ICMS-ST, PIS,
  COFINS, IBS, CBS. Montar isso corretamente é trabalho de quem entende tributação, não de uma
  integração de chão de fábrica.
- **[INFERÊNCIA]** emitir documento fiscal a cada bipe de operador é inaceitável: um erro nosso não
  vira divergência de estoque, vira **problema fiscal**.

**Veredito [INFERÊNCIA]:** **não é o caminho** — mas é a **melhor pista** que a varredura
produziu. Ele existe neste documento porque o campo `naoMovimentaEstoque` é a evidência de onde o
motor de estoque realmente está (§5.3), e é isso que dá à pergunta 1 a forma certa.

### Caminho D (que não é na API) — pedir um endpoint

**[INFERÊNCIA]** Se a pergunta 1 for respondida com "não, escrever `saldo` não movimenta nada", os
caminhos A, B e C acabam, e a saída é **o Compels expor uma operação de negócio** — um
`POST /v1/estoque/entrada` que receba item, depósito, quantidade, OP e **um identificador nosso**, e
que rode as regras deles por dentro. Vale ter isto na manga na conversa, com a carga que a gente
precisaria, porque a pergunta "vocês conseguem criar isso?" é muito mais fácil de responder quando
vem junto do desenho. **Do nosso lado nada muda:** a fila, a reversão, o cron e a tela de
pendências já estão prontos, e `compels.ts` é o único arquivo a escrever (é exatamente por isso que
ele foi deixado por último).

---

## 9. O que a especificação respondeu das 10 perguntas

| # | Pergunta de 23/09 | A especificação responde? |
|---|---|---|
| 1 | Vocês já têm caminho de integração para chão de fábrica? | **Em grande parte, e a resposta é inútil para nós.** Existe o módulo (§6), mas **nenhum endpoint dele toca saldo**. Como caminho de estoque, **está derrubado**. |
| 2 | Qual é o endpoint oficial para dar entrada? | **Sim, por eliminação.** Varredura exaustiva: só `itemLoteEstoque` e `itemLoteEstoqueLocacao` têm `saldo`, e **não há nenhum verbo de negócio em 826 caminhos** (§4). A pergunta deixa de ser "qual é" e passa a ser "é esse mesmo, e como". |
| 3 | Gravar `saldo` executa a movimentação? | **Não responde.** E §5.3 dá motivo forte para desconfiar que **não**. **Segue sendo a pergunta nº 1.** |
| 4 | Como autentica? | **Não responde — e agora isso é fato verificado:** 0 `securitySchemes`, `security` nulo no topo, 0 operações com `security` (§1). |
| 5 | Existe ambiente de teste? | **Não responde.** `servers` lista um só: `http://api.erpeasy.compels.net`. |
| 6 | Chamada repetida duplica? Aceita identificador nosso? | **Responde a metade, e é má notícia:** **nenhum schema de estoque tem campo livre** para a nossa `chave`, e a API não declara header de idempotência. **Mas** `findOneByNumeroSerie` dá idempotência por consulta no caminho B (§5.2). Se duplica, continua sem resposta. |
| 7 | Como amarrar nossa PMO/OP à OP deles? | **Responde a estrutura:** o elo é `itemLote.ordemProducaoSimples`, e `OrdemProducaoSimplesRest` tem `numero`, `codigoProduto`, `numeroPedidoVenda`, `quantidade`. **Mas não há busca por número de OP** — mesmo problema do §5.1. |
| 8 | Vocês querem os números de série peça a peça? | **Responde que o modelo permite e tem busca por SN** (§5.2). Querer é decisão deles. |
| 9 | Como desfazer uma entrada? | **Não responde.** `DELETE` e `PATCH` existem em tudo, mas desfazer saldo é escrever saldo menor — e aí volta o problema do §5.1. |
| 10 | Existe limite de chamadas? | **Não responde.** Nada sobre isso em lugar nenhum. |

**O que continua sem resposta, em uma frase:** tudo que depende de **comportamento** —
se a escrita movimenta, se duplica, se há limite, se há ambiente de teste, como autentica. A
especificação descreve **forma**, e só isso. Era previsível, e é por isso que ela só serve para
**fazer melhor as perguntas** — que é o que este documento fez.

---

## 10. As perguntas ao Valdeí, reordenadas

O Valdeí tem pouca atenção para dar. Esta lista está ordenada por **quanto cada resposta
destrava** — não por importância abstrata. Cada uma diz **o que fazemos se sim e o que fazemos se
não**, porque uma pergunta cuja resposta não muda a nossa próxima ação não vale o crédito de
atenção que gasta.

**Nota sobre a ordem:** a autenticação é o que bloqueia *testar*, mas a resposta dela nunca é
"não" — é sempre um procedimento. A pergunta 1 é a única cuja resposta pode **derrubar a
arquitetura inteira** e nos mandar para o Caminho D. Por isso ela vem primeiro. As duas devem ser
feitas no mesmo contato.

### 1. Gravar `saldo` em `itemLoteEstoque` (ou `itemLoteEstoqueLocacao`) **movimenta o estoque de verdade** — custo, rastreio, histórico contábil — ou só escreve um número na tabela?

Pergunte assim, não como "pode escrever saldo?". E com a pista na mão: *"vimos que
`itemNotaICMS` tem `naoMovimentaEstoque`, o que sugere que quem movimenta estoque aí é a nota.
Escrever `saldo` direto pula isso?"*

- **Se movimenta:** seguimos para a pergunta 3 (como achar a linha) e temos Caminho A.
- **Se não movimenta:** A está morto, e provavelmente B também. Vamos ao **Caminho D** (pedir um
  endpoint de negócio) e levamos o desenho da carga pronto.

### 2. Como a API autentica, e como ela sabe de que empresa é a escrita?

Os schemas de estoque não têm `empresaId`, mas muitos outros exigem. Dar entrada na empresa errada
é pior que não dar entrada.

- **Se é token/chave:** entra por variável de ambiente, nunca no código nem no `argv`.
- **Se é por empresa na credencial:** precisamos de uma credencial por empresa e de saber qual é a
  da Enterplak.
- **Se não há autenticação:** isso é um problema de segurança **deles** que vira risco nosso, e
  precisa ser dito a eles com clareza.

### 3. Como achamos a linha de `itemLoteEstoque` de um item num depósito? Não existe `findBy` nem filtro — só `page`/`size`/`sort`.

- **Se existe filtro não documentado:** ótimo, só precisamos do formato.
- **Se não existe:** pedimos um `findByCodigoItemAndCodigoEstoque`. **Sem isso o Caminho A é
  inimplementável**, mesmo que a pergunta 1 seja "sim" — e é melhor descobrir agora que depois de
  escrever o código.

### 4. Vocês preferem receber **peça a peça** (`itemLoteNumeroSerie`, usando `findOneByNumeroSerie` para não duplicar) ou a **quantidade** da caixa?

- **Se peça a peça:** vamos de **Caminho B**, idempotência vem do `404`, e eles ganham rastreio por
  série. **É a resposta que a gente quer.** Aí pergunte também: criar a série **mexe no saldo**, ou
  precisamos escrever o saldo à parte?
- **Se por quantidade:** voltamos ao A e a pergunta 5 (idempotência) fica crítica.

### 5. A nossa chave de idempotência tem onde morar? Nenhum schema de estoque tem campo livre, e a API não declara header de idempotência.

O reenvio é uma garantia da nossa fila, não um defeito dela: se a resposta se perder no meio, a
linha volta e é enviada de novo.

- **Se aceitam um campo/header nosso:** usamos a `chave` da 0132 (`ALMOX/<pmo>/<op>/<posto>/<alvo>/<E|S><n>`),
  que já está gravada e pronta.
- **Se não aceitam:** só o Caminho B é seguro (consulta antes de criar). Para o A, teríamos que
  deixar a fila **sem reenvio automático** — o que vai contra o desenho e precisa ser dito ao
  usuário como perda consciente.

### 6. Existe ambiente de teste (homologação)?

- **Se existe:** validamos tudo lá antes de encostar na base real.
- **Se não existe:** o primeiro teste é em produção. Então pedimos um item e um depósito de teste
  combinados, com data e hora marcadas, e um jeito de conferir e desfazer — e isso tem de ser
  acordado **antes** de a primeira chamada sair.

### 7. Qual é o **código do item** do Compels que corresponde a um produto nosso, e como o obtemos?

O `codigoItem` é obrigatório na prática e **o ShopFloor não tem código de produto nenhum** (§7).

- **Se há um caminho (ex.: pelo `numeroPedidoVenda` ou pela OP deles):** desenhamos a busca.
- **De qualquer forma:** abrimos **do nosso lado** o card de guardar o código do item na OP. **Isto
  não depende de resposta e já pode começar** — é o trabalho mais produtivo disponível hoje.

### 8. Qual `estoque` (depósito) e qual `locacao` são o almoxarifado da Enterplak? E o que é `tipoPropriedadeEstoque`?

`LocacaoRest` só tem `id`, e `tipoPropriedadeEstoque` é um `int32` sem documentação. Sem os valores,
não há como montar carga nenhuma.

- **Se derem os códigos/ids:** entram em configuração, nunca no código.
- **Se não houver locação em uso:** `itemLoteEstoque` (depósito) basta, e o Caminho B precisa ser
  revisto, porque a série se prende à **locação**, não ao depósito.

### 9. Como se **desfaz** uma entrada, quando um lançamento é cancelado no ShopFloor?

A nossa fila já trata o estorno como linha própria, com ordem garantida (a saída nunca vai antes da
entrada) — a mecânica está pronta, falta o endpoint.

- **Se há caminho de estorno:** implementamos como está desenhado.
- **Se não há:** ou escrevemos saldo menor (com todos os problemas do §5.1), ou **bloqueamos o
  cancelamento** no posto Almoxarifado depois de a entrada ter ido. A segunda é honesta; a primeira
  cria divergência silenciosa.

### 10. Qual é o atraso aceitável entre o bipe e o estoque andar, e uma movimentação de dias atrás ainda é aceita?

A nossa fila não descarta nada por idade.

- **Se minutos:** cron de 5 em 5 minutos, como o dos Alertas.
- **Se o dia:** uma rodada por hora basta (a linha já está escrita, comentada, em
  `tools/estoque/README.md`).
- **Se movimentação antiga é rejeitada:** precisamos de um limite de idade na fila e de a tela de
  pendências dizer "esta não vai mais ser aceita" — hoje ela não diz, e prometeria algo falso.

### Caíram da lista de 23/09

- **"Vocês já têm um caminho de integração para chão de fábrica?"** — a especificação respondeu
  (§6): existe o módulo, **nenhum endpoint dele toca saldo**.
- **"Qual é o endpoint oficial para dar entrada?"** — respondida por eliminação (§4): só existe
  escrever `saldo`. Virou parte da pergunta 1.

### Nasceram

- **a 3** (como achar a linha de saldo sem filtro) — pode inviabilizar o Caminho A sozinha;
- **a 7** (qual código de item) — e é a única que a gente resolve sem o Valdeí;
- **a 8** (qual depósito, qual locação, o que é `tipoPropriedadeEstoque`);
- a metade nova da **5**: a chave não tem campo onde morar, o que era suposição e agora é fato.

---

## 11. Em resumo

1. **[FATO]** Em 826 caminhos **não existe verbo de movimentação de estoque**. Pela API pública,
   **escrever `saldo` é a única coisa possível** — e os nomes que parecem movimentação
   (`movimento`, `recebimento`) são financeiros.
2. **[FATO]** Não há **filtro nenhum** nas coleções. Não há como achar a linha de saldo a
   atualizar. O caminho aparente está interrompido no meio, por um motivo que não é regra de
   negócio.
3. **[FATO]** O caminho **por peça** (`itemLoteNumeroSerie`) tem **busca por número de série**, e é
   o único dos três com idempotência verificável sem depender da boa vontade deles. **É o melhor
   candidato.**
4. **[INFERÊNCIA]** O campo `naoMovimentaEstoque` no item da nota fiscal indica que **o motor de
   estoque do ERP está na nota**, não na tabela de saldo. Escrever `saldo` direto provavelmente
   pula o motor — e é por isso que a pergunta 1 tem de ser feita com essa pista na mesa.
5. **[FATO]** Falta um dado **nosso**, não deles: o ShopFloor **não tem código de produto**.
   Qualquer caminho precisa disso, e **esse card pode começar hoje**, sem esperar ninguém.
6. **[FATO]** Nada do que foi construído está desperdiçado: fila, idempotência, reversão, cron e
   tela de pendências continuam válidos nos três caminhos e no quarto. O único arquivo a escrever
   segue sendo `infra/compels.ts`.
