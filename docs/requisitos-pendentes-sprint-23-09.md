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

---

# Atualização de 24/09 (tarde)

## Etiquetas — o card encolheu e ficou quase pronto para desenhar

**A descoberta que resolve:** o Setup **não precisa** do part number completo. Ele parte o
código bipado no primeiro separador e usa só duas coisas: **o que vem antes** (tem de ser o
código do componente, e existir na estrutura da PMO) e **o que vem depois** (lote, texto
livre). Pedido, DI e nota fiscal são rastreabilidade do Recebimento, **não requisito da
montagem**. Logo, uma etiqueta genérica tipo `CAPJ91-L0001` **funciona no Setup hoje, sem
mudar uma linha de código**. Perde-se só a rastreabilidade da compra — que, para material
antigo, provavelmente já está perdida.

**A posição NÃO serve como identificador.** Foi a primeira ideia e os dados a derrubaram
(planilha `Saldo_por_Locacoes.xlsx`, coluna A1, 68 linhas):
- **dez itens ocupam duas posições cada** (CAPH22 em A1.C.47 e 48; IND276 em 55 e 56; …);
- **a posição A1.C.66 tem três itens diferentes** (dois capacitores e um circuito integrado).
Além disso o usuário avisou que a posição **muda**.

**Formato da locação:** `coluna.lado.posição` (ex.: `A1.C.66` = coluna A1, lado C, posição
66). O lado **C é nomenclatura antiga saindo de uso**; o padrão novo é D e E. Na amostra:
65 posições em C, 1 em D, 1 em E — a migração mal começou.

**O que a planilha tem:** código do item, descrição, locação, categoria, estoque,
negociante, **saldo**, unidade, peso. **Não tem lote, pedido, nota fiscal nem cliente** (o
negociante é a própria Enterplak em todas as linhas).

**A pergunta que ainda decide a automação: cada linha da planilha é UM rolo físico?**
Há um forte indício de que sim: os dez itens repetidos estão quase sempre em posições
**vizinhas** (47 e 48, 53 e 54, 55 e 56), o que sugere "mesmo item em dois rolos, lado a
lado" e não erro de cadastro. **A confirmar na prateleira**, olhando esses pares. Se for um
rolo por linha, a automação é direta: uma etiqueta por linha da planilha.

**Qualidade do dado, para o gerador prever:** uma locação está fora do padrão
(`A1.C37`, sem o ponto — é o DIO705, provavelmente `A1.C.37`), e a unidade aparece de três
formas na mesma planilha (`PC - PEÇA`, `PÇ - PEÇA`, `UN - UNIDADE`). Linha malformada deve
ser **recusada com aviso**, nunca virar etiqueta torta.

**Atenção ao volume:** o arquivo está filtrado em `LOCAÇÃO: A1`. É uma amostra — o estoque
inteiro é bem maior, e o número total ainda não é conhecido.

## Central do cliente — a ACP é por projeto, mas o campo está solto

**Descoberta:** a ACP é o campo **Projeto** do Recebimento, e o padrão é
`ACP<número>/<ano> <sigla do cliente>` — ou seja, **por projeto, não por cliente**. O cliente
VMI aparece com ACP010/26, ACP013/26 e ACP014/26. Isso responde o cenário do usuário
("mesmo cliente com duas produções"): cada produção tem a sua ACP, e o material chega
separado.

**O problema é o campo ser texto livre.** Nos 24 valores distintos em produção:
- **a mesma ACP escrita de formas diferentes** — `ACP14/26` e `ACP014/26`; `ACP13 E 14` e
  `ACP013/26 E ACP014/26`;
- **um processo pertencendo a mais de uma ACP** (`ACP013/26 E ACP014/26`, 20 processos;
  `ACP13 E 14 VMI`, 85 processos) — a relação material ↔ projeto é **de muitos para muitos**,
  e isso é realidade (uma compra atende dois projetos), não erro;
- **valores que não são cliente**: `CONSUMO`, `RW`, `RW ESTOQUE`, `RW estoque seg`,
  `Amostra RW`, `Amostra Sensis`, `Pend. Malb`, e `Facial`/`FACIAL` (o mesmo em duas grafias).

**Recomendação antes de qualquer portal: a ACP virar campo de lista**, não texto livre — o
Recebimento já tem esse mecanismo (vários campos dele são listas configuráveis). Sem isso, o
cliente VMI veria sete grupos de material que na verdade são três projetos, e informação
errada num portal de cliente é pior do que não ter portal.

**Fica em aberto (decisão de negócio):** o que fazer quando um material serve duas produções
— escolher uma ACP principal ou permitir marcar mais de uma.

**A planilha do estoque não ajuda aqui:** ela não tem coluna de cliente.

**O usuário vai confirmar** com quem preenche: a pessoa sabe que a ACP identifica o projeto,
ou está usando o campo como observação?

## Compels — sem novidade, e uma decisão

Segue esperando o Valdeí. **Decisão do usuário:** as perguntas técnicas 1 a 10 **não foram
enviadas** ao fornecedor — a ideia é descobrir "na marra" primeiro, com acesso à tela e
ajuda de quem já integrou com essa API. **A metade do ShopFloor (o posto Almoxarifado) será
feita numa branch separada**, e pode ser refinada sem depender de ninguém.

**Dica combinada para quando ele tiver acesso à tela:** abrir o F12 na aba Rede e fazer o
Valdeí lançar uma entrada real — o próprio ERP mostra qual chamada ele faz, o que responde
de uma vez o endpoint oficial, os campos obrigatórios e a autenticação.

---

## 25/09 — Central do cliente: mock e a pergunta que sobrou

Mock em canvas (3 pranchas): **https://claude.ai/artifact/BaucxZY5XxjRxfYjVV11TL**
(privado — precisa ser compartilhado pelo menu Share para o comercial abrir).

### O que o mock fixou

**A tela** mostra um pedido por vez, com as três fases em cards na mesma ordem do processo
real — Embarque, Recebimento, Produção —, a lista das EMBs do pedido e as OPs desse pedido,
porque **um pedido pode ter duas PMOs em estados diferentes** (uma em produção, outra
aguardando). O progresso de cada fase é uma fração com o total do pedido, não um número solto.

**A régua do que sai**, em três grupos:

| Sai como está | Sai traduzido | Não sai |
|---|---|---|
| Fase atual · EMBs e onde cada uma está · recebido/total · % de produção por ordem · quantidade embalada · previsão | Reprovado no NQA → "em verificação de qualidade" · divergência de quantidade → "quantidade em conferência com o fornecedor" · `PMOM90/357` → "Lote 1 de 2" · postos → nomes de etapa | Taxa de aprovação/reprovação por posto · defeitos e reparos · nome do colaborador · tempo por posto · fornecedor e fabricante · número de série · qualquer dado de outro cliente |

Divergência de quantidade **sai** (traduzida) porque afeta o prazo do cliente — esconder isso
é esconder um atraso que ele vai descobrir sozinho.

**O filtro vem do login**, nunca de uma escolha na tela: o usuário do cliente está amarrado
aos pedidos dele. É a mesma lógica de permissão por módulo do ShopFloor com um escopo a mais.

### A ligação de cada fase com o pedido

| Fase | Chave | Situação |
|---|---|---|
| Embarque | ACP → pedido | existe (a planilha é quase a do Recebimento) |
| Recebimento | campo Projeto (ACP) | existe, mas é **texto livre e sujo** (ver a seção de 24/09) |
| Produção | — | **não existe**: a OP sabe o **cliente**, não o **pedido** |

### A pergunta que destrava o card

**Como a OP vai saber de qual pedido é?** Três caminhos, e a escolha é de negócio:

- **A — campo de ACP na OP.** Direto e barato, mas depende de alguém preencher toda vez;
  campo que depende de disciplina costuma vir vazio.
- **B — o ERP já sabe.** Se a ordem de produção do Compels aponta para o pedido de venda, a
  ligação existe lá e só precisa ser lida. **Ninguém perguntou isso ainda** — entra na lista
  do Valdeí.
- **C — portal por cliente, não por pedido.** Funciona com o que existe hoje e entrega valor
  já, mas não responde "e o meu segundo pedido?".

Enquanto a ligação não existir, o portal mostra a produção **do cliente**, não **do pedido** —
e para quem tem duas produções ao mesmo tempo os números aparecem misturados. É o que o mock
deixa escrito na terceira prancha, de propósito: é a decisão a levar para a reunião, não um
detalhe de implementação.
