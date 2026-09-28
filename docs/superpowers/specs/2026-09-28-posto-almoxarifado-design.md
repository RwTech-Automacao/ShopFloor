# Posto Almoxarifado — design

**Card:** Compels (estoque) — Sprint 23/09/2026
**Data:** 28/09/2026
**Estado:** refinado; falta a resposta do fornecedor sobre o endpoint de entrada

## O que é

Um **posto novo do ShopFloor**, no fim da linha, onde o operador bipa o que acabou de ser embalado.
Esse bipe é o que **dá entrada no estoque do Compels** — o ERP da empresa.

Hoje a entrada de estoque é feita à mão, fora do ShopFloor. A ideia é que ela deixe de ser uma
digitação separada e passe a ser consequência de um gesto que já existe no chão de fábrica.

A lógica é a mesma que já foi usada para a Integração: ela era uma aba própria e virou posto do
Lançamento. O Almoxarifado segue o mesmo caminho — permissão própria, aparece no fluxo da OP, e o
registro nasce de um bipe.

## Onde ele fica no fluxo

**É o último posto.** Ele encerra a peça: depois do Almoxarifado não há mais para onde ir. No Fluxo
da OP, entra como uma caixa nova depois da Embalagem.

## Os dois jeitos de bipar

O que o operador bipa depende de como a OP embala — a flag `embalagem_individual` da ordem (0078).

### OP de embalagem individual

Um produto por caixa. A Embalagem confere o número de série do produto com o da caixa, e **não
existe código de caixa** — o painel de embalagem individual não usa `CX[...]`.

No Almoxarifado o operador bipa **o número de série**:

```
00043-00462-0015718   →   1 unidade
```

Uma peça, um bipe, uma unidade. Numa OP de 149 peças são 149 bipes — o mesmo esforço que a
Embalagem já teve com as mesmas 149.

### OP de embalagem coletiva

Várias peças por caixa. Enquanto a caixa está aberta ela é só `CX[3]`; ao fechar, ganha o código
final `CX[seq][qtd]OP-PMO`.

No Almoxarifado o operador bipa **o código da caixa**:

```
CX[3][10]12345-PMO973   →   10 unidades
```

Uma caixa, um bipe, dez unidades. Uma OP de 500 peças com 10 por caixa vira 50 bipes.

**Um campo só atende os dois.** O formato distingue sem ambiguidade: código de caixa começa com
`CX[`, número de série não.

## O que o posto recusa

Cada recusa existe por um motivo concreto, não por zelo:

- **Caixa ainda aberta** (`CX[3]`, sem a quantidade). Caixa que não fechou não tem quantidade
  definida, e quantidade errada no ERP é pior do que entrada nenhuma.
- **Caixa ou peça já lançada.** Recusa **visível**, dizendo quando e por quem — é o que impede o
  estoque de dobrar quando alguém bipa duas vezes por dúvida.
- **Peça solta numa OP coletiva.** Se a entrada é por caixa, aceitar a peça avulsa cria dois
  caminhos para o mesmo estoque e as contas deixam de fechar.
- **Caixa reprovada no NQA** (`CX[7]R[14]…`). Ela virou histórico e a remontagem herda o número;
  dar entrada nela seria contar material que voltou para a linha.
- **Número de série que não passou pela Embalagem**, mesmo existindo na faixa da OP. O que não foi
  embalado não está pronto para o estoque.

## O que vai para o ERP

**PMO, OP e quantidade.** O produto é identificado **pela PMO** — o par `(pmo, op)` é único no
ShopFloor, a PMO diz o que é e a OP diz qual lote —, e a PMO existe no Compels com o mesmo código.
Não é preciso campo novo na ordem nem tabela de-para.

**O bipe não espera o ERP.** Ele grava no ShopFloor, enfileira o envio e libera o operador na hora.
A fila é a mesma dos Alertas, que já roda em produção. Três consequências que o desenho assume:

- **chave de idempotência obrigatória** — o código bipado —, para que reenvio não vire entrada
  dobrada do outro lado;
- **o que falhou fica visível**, numa tela de pendências: fila que engole erro em silêncio é pior
  que não ter fila;
- **o ShopFloor é a verdade do que foi bipado**; o ERP é o destino, não a fonte.

## O QR da caixa

A folha da caixa já existe e já sai com um QR, em produção desde 11/09. Só que o conteúdo dele é a
**lista de números de série**, um por linha — foi feito para conferência pelo celular, e é isso que
a fábrica usa hoje.

Um leitor de mão lendo esse QR digitaria dez linhas de números de série, não o código da caixa.

**Decisão: acrescentar um segundo QR** na mesma folha, pequeno, com **só o código final da caixa**.
Os dois convivem porque servem a coisas diferentes — o grande é a conferência pelo celular, o
pequeno é o que o Almoxarifado bipa. O gerador de QR já está no servidor; é acrescentar um SVG.

**Vale para toda caixa fechada**, não sob demanda: ao fechar a caixa, a folha tem de sair com o
código. ⚠️ **Navegador não imprime em silêncio** — o "Fechar caixa" abre a folha pronta para
imprimir e a pessoa confirma no diálogo do sistema. É um gesto a mais, e é inevitável enquanto a
impressão passar pelo navegador.

**Descartados, e por quê:** trocar o conteúdo do QR atual (tira da fábrica a conferência pelo
celular que funciona hoje) · um QR só com tudo (o leitor de mão digitaria a lista inteira) ·
digitar o código à mão (`CX[3][10]…` tem colchete, e colchete em teclado de chão de fábrica é
convite a erro) · listar as caixas na tela para o operador escolher (some a garantia de que a caixa
está fisicamente ali, que é a razão de existir o posto).

## O que dá para construir agora

Tudo, menos o envio:

- o posto, com permissão própria, no molde da Integração;
- o bipe com os dois formatos e as cinco recusas;
- o segundo QR, saindo em toda caixa fechada;
- a fila com idempotência e a tela do que falhou;
- o Almoxarifado como última caixa do Fluxo da OP.

O envio ao Compels entra depois, atrás da fila — que é onde ele já ia ficar de qualquer forma.

## O que falta saber

Três perguntas para o fornecedor, e só a primeira bloqueia o envio:

1. **Qual é o endpoint oficial de entrada de estoque**, e **gravar `saldo` executa a movimentação**
   ou só escreve o número? O estudo da API mostrou que ela é CRUD gerado sobre as tabelas
   (Spring Data REST), não API de negócio — o candidato é `POST /v1/itemLoteEstoque`, mas gravar o
   saldo pode não movimentar nada.
2. **Autenticação e ambiente de teste.**
3. **Como estornar** quando um lançamento é cancelado aqui.

**Atalho combinado:** quando houver acesso à tela do ERP, abrir o F12 na aba Rede e fazer alguém
lançar uma entrada real. O próprio Compels mostra qual chamada faz, o que responde de uma vez o
endpoint, os campos obrigatórios e a autenticação.

## Riscos

- **Bipe a mais no chão de fábrica.** Na embalagem individual são 149 bipes numa OP de 149. O
  ganho é trocar uma digitação separada por um gesto na linha, mas é trabalho novo para quem opera —
  e se a rotina não pegar, o estoque fica pela metade, que é pior do que hoje.
- **A folha impressa vira pré-requisito.** Caixa sem folha não tem o que bipar. Isso muda a rotina
  da Embalagem, não só a tela.
- **Entrada pingada no ERP.** Uma OP de 500 gera 50 lançamentos em vez de um. É mais fiel ao que
  aconteceu, mas pode ser ruído do lado deles — vale confirmar com quem usa o Compels.
- **Divergência entre os dois sistemas.** Se o envio falhar e ninguém olhar a tela de pendências, o
  ShopFloor diz que entrou e o ERP não tem. A tela de pendências é o que impede isso, e por isso ela
  não é opcional.
