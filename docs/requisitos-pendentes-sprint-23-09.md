# O que falta para implementar cada card

**Data:** 24/09/2026
**Para que serve:** juntar, num lugar só, tudo o que ainda não sabemos — e **quem** pode
responder cada coisa. Enquanto essas respostas não vierem, qualquer desenho é chute.

Os cards já refinados (Abastecimento, clique fantasma, Alertas, Fluxo e Registros do
Recebimento) não estão aqui — têm spec própria em `docs/superpowers/specs/`.

---

# 1. Compels — posto Almoxarifado

## O que já está decidido

- O **Almoxarifado vira um posto** do fluxo do ShopFloor, com permissão própria, seguindo a
  mesma lógica do Lançamento (como a Integração virou posto).
- **Bipar um item ou uma caixa nesse posto é o que dá entrada no estoque do Compels**
  daquela PMO. Entrada = bipe no posto.
- A API é **na nuvem** (`api.erpeasy.compels.net`), o servidor da AWS alcança direto, e
  responde em 0,25 s. Não precisa de conector na intranet como o Repinmetro.
- **O bipe não espera o ERP:** grava no ShopFloor na hora e enfileira o envio, reusando a
  fila que já existe nos Alertas. Prender o operador a um sistema de terceiro é trocar um
  problema nosso por um problema deles.
- Chave de idempotência obrigatória, e o que falhar precisa ficar visível para alguém tratar.

## O que falta saber — **quem responde: Valdeí / Compels**

Detalhe completo em `docs/estudo-api-compels.md`. As que travam o desenho:

1. **Vocês já têm um caminho de integração para sistema de chão de fábrica?** A API tem
   endpoints escritos à mão para número de série, rota de estação, posto anterior, teste por
   SN e até um `verificaIntegracao` — alguém construiu isso de propósito. Se existe um
   caminho pensado, é por ele que devemos entrar.
2. **Qual é o endpoint oficial para dar entrada no estoque?**
3. **Gravar `saldo` executa a movimentação** (custo, rastreio, histórico contábil) **ou só
   escreve o número na tabela?** É a pergunta que vale mais que todas: a API é CRUD gerado
   sobre as tabelas, e escrever saldo pode deixar o estoque certo na tela e errado na
   contabilidade.
4. **Como autentica?** Nenhuma autenticação é declarada na documentação.
5. **Existe ambiente de teste?** Testar escrita de estoque na base real é criar divergência
   de propósito.
6. **Chamada repetida duplica a entrada?** Aceita um identificador nosso para evitar isso?
7. **Como amarrar nossa PMO/OP à ordem de produção de vocês?**
8. **Vocês querem receber os números de série peça a peça?** O modelo de vocês permite.
9. **Como desfazer uma entrada**, quando um lançamento é cancelado no ShopFloor?
10. **Existe limite de chamadas** a respeitar?

## O que falta decidir — **quem responde: Matheus / produção**

11. **O que exatamente é bipado no posto**: a peça individual, a caixa, ou depende do tipo de
    embalagem? (a spec preliminar diz "depende", e isso precisa virar regra)
12. **Quais outras métricas** você quer ver no ShopFloor além do estoque.
13. **Quem opera o posto Almoxarifado** e que permissão ele tem hoje.

---

# 2. Etiquetas do estoque antigo

## O que já se sabe

- A etiqueta que o Recebimento gera **é a mesma** que o Setup bipa na montagem.
- O problema é o material que entrou **antes do ShopFloor existir**: nunca passou pelo
  Recebimento, nunca ganhou etiqueta, e por isso **não pode ser usado na montagem**.

## A descoberta que muda o card

A etiqueta **não é só "que peça é essa"** — ela carrega a rastreabilidade da compra:

```
<código do material> - <pedido><documento><sequencial do volume>
```

| Parte | De onde vem |
|---|---|
| código do material | o "Item Recebido" do processo |
| pedido | número do pedido de compra (4 dígitos + ano) |
| documento | dígitos da **DI/DUINPI**; na falta dela, da **Nota Fiscal** |
| sequencial | um por volume (01, 02, 03…) |

Para etiquetar o estoque antigo, então, precisamos por item: **código, pedido, DI ou NF, e
quantidade de volumes**. Nenhum desses dados está no ShopFloor para esse material.

**Isso liga este card ao Compels.** Pedido e nota fiscal vivem no ERP, e a API do Compels
tem justamente Nota Fiscal, Pedido, Item e Lote. A "automação" que o card pede pode ser
exatamente isto: **buscar no ERP a origem do material que está na prateleira**.

E se nem no ERP existir ligação entre o que está na prateleira e a compra que o trouxe, a
conversa muda de figura: será preciso decidir um **formato de etiqueta para material sem
origem**, porque o formato de hoje não comporta.

## O que falta — **quem responde: Matheus + almoxarifado**

1. **Foto da etiqueta atual** do material antigo (se tiver alguma), incluindo o código de
   barras.
2. **A mensagem de erro** que o Setup dá ao bipar um rolo desse estoque — ela diz qual regra
   está barrando.
3. **Quantos itens são** — dezenas ou milhares. Muda a resposta entre "reimprimir tudo" e
   "tratar como exceção".
4. **Dá para saber de qual compra veio cada item da prateleira?** Existe registro em papel,
   planilha, ou só no ERP?
5. **Se não der para saber a origem:** o que colocar no lugar do pedido e do documento? (a
   decisão é de quem usa a rastreabilidade, não técnica)
6. Quem imprime etiqueta hoje e com qual impressora — a mesma do Recebimento?

---

# 3. Central do cliente

## O que já está decidido

- É uma **aplicação separada do ShopFloor**.
- O cliente acompanha o pedido **de ponta a ponta**: da compra da matéria-prima até a
  produção.
- A **produção** é a parte fácil: o ShopFloor já sabe, e já sabe de qual cliente é cada OP.
- O **recebimento** já tem base suficiente para mostrar ao cliente.
- O problema central é **mapear quais itens recebidos pertencem a qual cliente**.

## O nó, em uma frase

No ShopFloor, a ligação cliente → produção já existe (a ordem tem cliente). No Recebimento,
**não existe ligação clara entre o material que chegou e o cliente que o encomendou** — o
processo tem fornecedor, pedido e NF, mas o cliente final não aparece de forma confiável.
Sem resolver isso, a metade "matéria-prima" do portal não existe.

## O que falta — **quem responde: Matheus + comercial**

1. **Como se sabe, hoje, que um material recebido é para um cliente específico?** Alguém sabe
   de cabeça? Está no pedido de compra? Está no ERP? É pelo PMO/OP que vai consumir o
   material? **Esta é a pergunta que destrava o card.**
2. **Onde vivem as propostas aprovadas** — ERP, planilha, Plane?
3. **O que o cliente pode ver.** Mostrar % de conclusão e ritmo de produção para cliente
   externo é decisão comercial, não técnica.
4. **Quem responde** se o cliente mandar mensagem pelo portal.
5. **Domínio/subdomínio** previsto.
6. **Expectativa de prazo:** 10h entregam protótipo navegável e escopo fechado, não sistema
   no ar. Isso precisa estar combinado com quem pediu.

## Recomendações técnicas já formadas

- **Marcos automáticos, mais um campo livre.** Três ou quatro marcos (Proposta aprovada → Em
  produção → Em teste → Pronto para envio) preenchidos pelo que o sistema já sabe, mais um
  espaço para o comercial escrever um recado. O automático mantém o portal vivo; o campo
  livre atende o objetivo de relacionamento. Portal que depende de alguém alimentar todo dia
  morre em duas semanas.
- **Login por link mágico**, sem senha para cliente externo: menos senha para administrar,
  menos superfície de ataque, e nada de "esqueci minha senha" de gente de fora.

---

# Resumo: o que destrava o quê

| Card | A pergunta que destrava | Quem responde |
|---|---|---|
| **Compels** | Gravar saldo movimenta o estoque de verdade, ou só escreve o número? | Valdeí / Compels |
| **Etiquetas** | Dá para saber de qual compra veio cada item da prateleira? | Almoxarifado / ERP |
| **Central do cliente** | Como se sabe que um material recebido é de um cliente específico? | Comercial |

As três são perguntas de **negócio**, não de código. Nenhuma delas se resolve lendo o
sistema — todas dependem de alguém que conhece o processo responder.
