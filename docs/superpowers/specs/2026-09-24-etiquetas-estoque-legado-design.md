# Etiquetas do estoque legado — design

**Card:** Avaliar automação para classificar/etiquetar o que está no estoque sem etiqueta —
Sprint 23/09/2026 [4h]
**Data:** 24/09/2026

## O problema

Material que entrou **antes do ShopFloor existir** nunca passou pelo Recebimento e nunca
ganhou etiqueta. Sem etiqueta, **não pode ser bipado na montagem do Setup** — na prática,
está parado na prateleira sem poder ser usado.

## Por que não dá para gerar a etiqueta "de verdade"

A etiqueta do Recebimento carrega a rastreabilidade da compra:

```
<código do material>-<pedido><documento (DI ou NF)><sequencial do volume>
```

Para o estoque antigo, **pedido e documento não existem em lugar nenhum** que dê para
automatizar. O que está escrito fisicamente nos rolos não tem padrão: a maioria tem o código
do item e o número do pedido **à mão** — e transcrever à mão é o oposto de automatizar. O
lote é irrecuperável.

## A descoberta que resolve

**O Setup não precisa de nada disso.** Ele parte o código bipado no primeiro separador e usa
duas coisas:

- **antes do separador** — tem de ser o código do componente, e existir na estrutura da PMO;
- **depois do separador** — lote, **texto livre**.

Pedido, DI e nota fiscal são exigência do Recebimento, não da montagem. Então uma etiqueta
genérica **funciona no Setup hoje, sem mudar uma linha de código**.

**Formato adotado:**

```
CAPA78-L0001
```

O `L` marca material legado. Na etiqueta o código vira **QR code** (não código de barras —
correção de 25/09), então o comprimento quase não pesa na leitura; `L` foi escolhido em vez de
`GEN` por ser curto e legível a olho na etiqueta. E como o material novo tem pedido e nota no
código, a diferença já é evidente sem precisar da palavra.

**O que se perde:** rastrear de qual compra veio aquele rolo. Para material que já está na
prateleira há tempo, isso provavelmente já estava perdido.

## A fonte: a planilha do ERP

Export "Saldo por Locação", em xlsx. Colunas: **código do item, descrição, locação,
categoria (linha), estoque, negociante, saldo, unidade, peso**.

**Cada linha é um rolo físico** — confirmado pelo usuário. É o que torna a automação
possível: uma etiqueta por linha.

A locação tem o formato `coluna.lado.posição` (ex.: `A.C.67`), e o ERP exporta a coluna como
**faixa** (`A.C.67 - A.C.67`) — o que vale é a posição inicial. O lado **C é o centro** e segue em
uso junto com D e E (correção de 25/09; antes eu havia registrado que C estava saindo de uso).

**A locação não identifica o rolo** e não entra na etiqueta: dez itens da amostra ocupam
duas posições cada, a posição `A1.C.66` guarda três itens diferentes, e a posição muda com o
tempo.

**Volume:** até **5.000 rolos**, com uma **leva de teste de no máximo 200** antes.

## O sequencial: contínuo por item, para sempre

**É o ponto mais importante da spec.** O sequencial **não** reinicia a cada leva. Ele é
por **código de item** e continua de onde parou, independentemente de quantas planilhas
forem processadas e em que ordem:

```
Leva da coluna A1:   CAPA78-L0001
                     CAPA78-L0002
Leva da coluna B1:   CAPA78-L0003     ← continua
```

**Por que isso não é detalhe:** se o contador reiniciasse por leva, dois rolos diferentes
receberiam `CAPA78-L0001`. O Setup identifica o rolo exatamente por esse código — dois rolos
com o mesmo código fazem o sistema tratá-los como um só: ao bipar o segundo, ou recusa
dizendo que já está montado, ou aceita no lugar errado. É falha silenciosa no chão de
fábrica.

Com o contador contínuo, o pior caso possível passa a ser **um rolo com duas etiquetas
diferentes** — desperdício visível e corrigível — em vez de **dois rolos com a mesma**.

Para isso, o sistema **registra cada etiqueta emitida**. Esse registro também responde
"quanto do estoque antigo já foi etiquetado", que é como o progresso vai ser acompanhado.

## A tela

Em **Recebimento › Etiquetas**, ao lado do que já existe. Fluxo:

1. **Subir a planilha** do ERP (xlsx), como o Importar Planilha já faz.
2. **Prévia antes de gerar**, mostrando: quantas linhas serão etiquetadas, quantas já têm
   etiqueta gerada para o mesmo item na mesma posição (com a data), e quantas foram
   **recusadas** e por quê.
3. **Gerar** produz o arquivo de etiquetas e registra o que foi emitido.

**A leva sai na ordem da prateleira** — por coluna, por lado, e a posição em ordem numérica
(ordenar por texto colocaria a posição 67 antes da 7). O ERP não garante ordem no export, e é essa
ordem que quem cola vai seguir de ponta a ponta da estante. Locação fora do padrão vai para o fim
da lista, sinalizada.

**O arquivo de saída é o mesmo do Recebimento** — três colunas, mesmo formato, mesma
impressora. Nada muda no modelo de impressão, e isso é deliberado: é a diferença entre
funcionar no primeiro teste e ter de mexer no layout da etiqueta.

**Uma etiqueta por rolo** — nunca por volume, porque aqui cada linha já é um rolo.

## O que a tela recusa (e avisa)

A planilha vem do ERP com sujeira, e o gerador não pode transformar sujeira em etiqueta:

- **Código de item vazio** → recusa a linha.
- **Locação fora do padrão** — na amostra existe `A1.C37`, sem o ponto, quando todas as
  outras seguem `coluna.lado.posição`. A locação não vai para a etiqueta, mas serve para
  reconhecer repetição; linha malformada é **sinalizada**, não descartada em silêncio.
- **Linha repetida na mesma planilha** (mesmo item e mesma posição) → avisa.
- **Item que já teve etiqueta gerada nessa mesma posição** → avisa com a data, e **o usuário
  decide** se é rolo novo ou repetição. O sistema não decide sozinho.

Nada disso impede a geração do resto: o que está bom é gerado, o que é duvidoso é mostrado.

**Ignorado de propósito:** saldo, unidade, peso, categoria e negociante. Não vão para a
etiqueta e não entram em nenhuma regra. (A unidade, aliás, vem em três grafias diferentes na
mesma planilha — `PC - PEÇA`, `PÇ - PEÇA`, `UN - UNIDADE` —, o que é mais um motivo para não
depender dela.)

## Permissão

A mesma que já existe para etiquetas: **`recebimento: gerar_etiqueta`**. Sem permissão nova.
O gate se repete na server action, não só na tela.

## Impacto técnico

**Migração 0126** — uma tabela para as etiquetas legado emitidas: item, sequencial, locação
de origem, quando e por quem; e o índice que garante que **o par (item, sequencial) é único**
no banco, não só na aplicação. A unicidade é a regra mais importante desta spec e não pode
depender de o código estar correto.

**Reaproveita** a leitura de xlsx (`ler-composicao-xlsx.ts` e o wizard de importação) e o
gerador de arquivo de etiquetas (`src/modules/etiquetas/`). O formato do part number legado
vai para o domínio de etiquetas, ao lado do `montarPartNumber` que já existe.

**Nada muda** na etiqueta do material novo, no Recebimento, no Setup ou na impressão.

## Testes

1. Sequencial contínuo por item: duas levas com o mesmo item geram 0001, 0002 e 0003 — nunca
   repetem, qualquer que seja a ordem.
2. Itens diferentes têm sequenciais independentes.
3. O código gerado passa nas regras do Setup: o prefixo é reconhecido como o componente e o
   lote não é vazio.
4. Linha sem código é recusada; locação malformada é sinalizada e não impede o resto.
5. Repetição na mesma planilha e repetição entre levas aparecem na prévia, com data.
6. O arquivo de saída tem exatamente o mesmo formato do arquivo de etiquetas de hoje.
7. Sem `recebimento: gerar_etiqueta`, a tela e a ação recusam.
8. O banco recusa (item, sequencial) duplicado, mesmo que a aplicação erre.

## Fora de escopo

- Recuperar a origem da compra do material antigo (pedido, DI, nota) — já constatado inviável.
- A locação na etiqueta.
- Reimpressão de etiqueta perdida — se acontecer, o assunto volta com dado real de quanto
  acontece.
- Quem cola as etiquetas: é trabalho de chão de fábrica, ainda a combinar, e provavelmente o
  maior custo do card.

## Riscos

- **Etiqueta colada no rolo errado.** O sistema gera na ordem da planilha; quem cola precisa
  seguir a mesma ordem. Com 5.000 rolos, uma troca de posição no meio do caminho contamina
  tudo o que vem depois. Vale imprimir **por coluna da prateleira** e colar coluna por coluna,
  em vez de gerar as 5.000 de uma vez.
- **Rolo que se move entre a geração e a colagem.** A prévia reconhece repetição por item +
  posição; se o rolo mudou de lugar nesse intervalo, o sistema o verá como novo. É aceitável
  — o resultado é uma etiqueta a mais, não um código repetido.
- **A leva de teste de 200 é a que vale.** É nela que se descobre se o código sai legível na
  impressora, se o Setup aceita o bipe e se a ordem da colagem funciona na prateleira. Só
  depois disso faz sentido gerar as 5.000.
