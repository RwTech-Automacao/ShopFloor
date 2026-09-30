# Etiquetas na recontagem — design

**Card:** Avaliar automação para classificar/etiquetar o que está no estoque sem etiqueta —
Sprint 23/09/2026 [4h]
**Data:** 30/09/2026
**Substitui a abordagem de:** `2026-09-24-etiquetas-estoque-legado-design.md`

## O que mudou desde o desenho de 24/09

O desenho anterior importava a planilha "Saldo por Locação" do ERP, tratava cada linha como um
rolo e gerava uma leva inteira de etiquetas genéricas de uma vez. Estava pronto e testado na
branch `feat/etiquetas-estoque-legado`, segurado aguardando a reunião.

A reunião decidiu outra coisa: **a etiqueta passa a nascer dentro do processo de recontagem do
almoxarifado** (inventário rotativo — o nome exato está por confirmar). O almoxarife tira os rolos
da prateleira para conferir e, nesse mesmo gesto, etiqueta os que não têm etiqueta.

E isso trouxe uma informação que a planilha não tinha: **muitos rolos têm o número do pedido
escrito neles**. Quando tem, a pessoa digita; quando não tem, a etiqueta continua genérica.

A leva por planilha **não morre — fica oculta**: a tela sai do menu e a rota continua de pé, caso
um dia sirva para conferir a recontagem contra o saldo do ERP.

## O formato do código

```
CAPA78-123425L0004
└─cód─┘ └pedido┘└L+seq┘
```

Regra única, com o pedido **opcional**:

```
<código do componente> - [pedido normalizado] L <sequencial>
```

Sem pedido, sobra `CAPA78-L0004` — que é **exatamente** o formato que a 0126 já gera hoje. Um
caminho só, não dois.

### Por que o `L` continua, mesmo com o pedido conhecido

Este é o ponto que sustenta o formato. A etiqueta de verdade do Recebimento é
`<código>-<pedido><documento><sequencial>`. Se a etiqueta da recontagem fosse
`CAPA78-123425...` sem marca, um dia o Recebimento poderia receber material **do mesmo pedido
123425** e gerar um código parecido — dois rolos físicos diferentes com códigos que se confundem.
**O pior erro de rastreio é o que parece certo.**

O `L` ocupa o lugar do documento, que no real é DI ou NF e é **sempre numérico**. Documento nunca é
`L`, então os dois universos não se encostam — por construção, não por convenção. De brinde, dá
para listar tudo que saiu da recontagem procurando o `L`.

### O pedido é sempre dígitos — verificado no código

`formatarPedido` (`src/modules/etiquetas/domain/partnumber.ts:28`) já resolve isto para o
Recebimento e devolve **sempre 6 dígitos**:

- `1234/25` → `123425`
- `45/2025` → `004525` (zero à esquerda, ano cortado nos 2 últimos)
- qualquer outra coisa → só os dígitos

**Reusar essa função é requisito**, por dois motivos: o `L` só é um separador confiável porque
nunca haverá letra no pedido formatado; e o almoxarife pode digitar o pedido **como está escrito no
rolo**, sem aprender formato novo.

### O sequencial continua necessário

Um mesmo pedido pode ter vários rolos do mesmo item. Sem o sequencial, dois rolos na prateleira
bipam igual. A 0126 já garante **contínuo por item, nunca reaproveitado**, e resolve a concorrência
no banco.

## O gesto: rolo a rolo, impressão em leva

Decidido com o usuário: o almoxarife **etiqueta um rolo por vez** (não uma pilha do mesmo item),
mas a **impressão é em leva**.

Ele digita rolo a rolo, as linhas se acumulam, e no fim baixa **um CSV com tudo** — que é como a
impressão já funciona hoje, tanto no Recebimento quanto na versão da planilha. Um download por rolo
encheria a pasta de Downloads de arquivinhos e o pessoal abandonaria a ferramenta.

Impressão direta em impressora térmica ao lado ficou **fora de escopo**: não existe hoje e é
trabalho de verdade. Este desenho não impede migrar para ela depois.

## A fila, não a "leva"

**Não existe conceito de leva, sessão ou contagem.** Existe uma **fila de etiquetas pendentes de
impressão**:

- digitar um rolo cria uma **linha pendente**;
- a tela mostra sempre **o que ainda não foi impresso**, independente de quem digitou ou quando;
- baixar o CSV marca aquelas linhas como impressas (data + autor) e elas somem da lista;
- quem abrir depois — ele amanhã, ou outra pessoa — vê o que falta.

**Por que não modelar "leva":** exigiria decidir quem abre, quem fecha, o que fazer com uma leva
esquecida aberta e com uma de ontem que ninguém imprimiu. Nada disso é trabalho real — é
burocracia inventada. A fila responde as mesmas perguntas sem nenhum desses conceitos.

Isso atende o requisito que o usuário pediu: **a lista sobrevive a fechar a aba**, e outra pessoa
continua a mesma contagem.

**O que se abre mão:** não dá para dizer "esta contagem é da prateleira A". Se importar, resolve-se
depois com um campo de observação — **não entra agora**.

## A tela

**Onde:** em Recebimento, ao lado da tela da planilha, com a permissão que já existe
(`gerar_etiqueta`). A tela da planilha **sai do menu**; esta entra no lugar.

**Os campos:**

- **Código do componente** — obrigatório
- **Pedido** — opcional, do jeito que estiver escrito no rolo
- **Adicionar** (ou Enter no segundo campo)

Ao adicionar, a linha nasce **já com o número dela** e aparece no topo da lista mostrando o
**código final por extenso** (`CAPA78-123425L0004`).

O foco volta para o campo Código e **o pedido continua preenchido** — na recontagem vêm vários
rolos seguidos do mesmo pedido. O campo fica visível e editável, então ele vê que o pedido está lá.

**A lista** mostra as pendentes, mais novas em cima: código final, código digitado, pedido, quem
digitou e quando. Cada linha tem **remover**.

Remover **queima o número** — o próximo rolo daquele item pega o seguinte. É de propósito, e é a
regra que a 0126 já segue: não dá para saber se aquela etiqueta chegou a ser impressa e colada.

**Imprimir:** botão **Gerar etiquetas (CSV)**, que baixa tudo o que está pendente e marca as linhas
como impressas.

**Aba "Já impressas"**, com filtro por data e **"Baixar de novo"** — não desfaz nada, só gera o CSV
daquelas linhas outra vez. Existe para o caso de o download falhar, a impressora estar sem ribbon
ou o arquivo se perder: sem isso, o almoxarife redigitaria 40 rolos.

## Conferência do código digitado: NÃO HÁ

**Decisão explícita do usuário.** Foram apresentadas três opções (não conferir / avisar sem
bloquear / bloquear) contra a `st_estrutura`, e ele escolheu **não conferir**. O que for digitado
vira etiqueta.

Consequência assumida: um erro de digitação (`CAPA87` em vez de `CAPA78`) só aparece na bancada do
Setup, semanas depois. **A prévia do código final na lista é a única rede** — por isso ela é
requisito, e não enfeite.

**Uma recusa permanece, e é de formato, não de existência:** `etq_legado_item_valido` (0126)
rejeita código que contenha separador (`- – — _ : / espaço`), porque o Setup parte o código do rolo
no primeiro separador e leria só o pedaço anterior como componente. Sem essa recusa a etiqueta sai
**fisicamente errada**. Ela fica.

## O banco

**Não há tabela nova.** A `etiquetas_legado` (0126) já é a fila: uma linha por rolo, com `item`,
`sequencial`, `codigo` gravado, `usuario_id`, `usuario_nome` e `created_at`.

A migração **0135** faz um ALTER pequeno:

- `pedido text not null default ''` — o pedido **já normalizado**, vazio quando não há
- `impressa_em timestamptz` e `impressa_por uuid` — **pendente é `impressa_em` vazio**. Sem
  máquina de estados.

E recria a função do código para conhecer o pedido, **mantendo o resultado idêntico quando o pedido
é vazio** (é o que garante que a tela da planilha, se um dia voltar, continue gerando o mesmo
formato).

`codigo` continua **gravado, não recalculado**: a etiqueta física já existe no mundo, e o código
dela não pode mudar se a regra de formação mudar um dia.

O campo `locacao` da 0126 (posição de onde o rolo saiu, usado só na prévia da leva por planilha)
fica como está, vazio no caminho da recontagem.

⚠️ **A 0126 já está aplicada no Dev** — por isso a mudança vai como migração nova e não editando a
0126, que sairia de sincronia com o banco.

⚠️ **Numeração:** `0126` (etiquetas), `0128–0133` (posto Almoxarifado) e `0134` (Central do
Cliente) estão tomadas por branches não mergeadas. A 0135 é a próxima livre **hoje** — conferir
antes de aplicar, porque a ordem de merge entre as branches pode mudar.

## A branch

`feat/etiquetas-na-recontagem`, criada da main (`a775415`), **com a
`feat/etiquetas-estoque-legado` mergeada dentro** — em vez de copiar pedaços.

Isso traz de uma vez a 0126, o domínio do formato, as recusas e o gate, **e** a tela da planilha —
que é justamente o que se quer manter oculto. Tirar do menu é uma linha; não é preciso apagar nem
preservar código à mão.

## Testes

O que merece cuidado:

- **A formação do código** — pedido em todos os formatos que a pessoa pode escrever (`1234/25`,
  `1234/2025`, `1234-25`, com espaços), pedido ausente, e a equivalência com o formato atual quando
  o pedido é vazio.
- **A impossibilidade de colidir com etiqueta de verdade** — é a razão do `L`, e é o teste que
  protege a decisão de formato.
- **A recusa de código com separador** (`etq_legado_item_valido`).
- **Pendente × impressa** — baixar o CSV move as linhas, "Baixar de novo" não move nada.
- A concorrência do sequencial já é coberta pela 0126.

## Fora de escopo

- Impressão direta em impressora térmica.
- Conferir o código contra a `st_estrutura` (decisão do usuário).
- Separar a fila por prateleira ou por contagem.
- Reabilitar a tela da planilha no menu.
