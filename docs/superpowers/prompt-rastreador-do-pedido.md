# Prompt para começar o Rastreador do Pedido do zero

Copie tudo abaixo da linha para uma conversa nova.

---

Você vai construir comigo uma aplicação web nova, do zero. Leia tudo antes de escrever qualquer
código — no fim eu digo por onde começar.

## Contexto

A Enterplak é uma fábrica de eletrônicos que produz sob encomenda para outras empresas. Ela já tem
um sistema interno próprio, o **ShopFloor**, que controla o recebimento de material e a produção
no chão de fábrica. O ShopFloor é de uso interno e vai continuar existindo do jeito que está.

O que você vai construir é **outra aplicação**: um lugar onde o **cliente da Enterplak acompanha o
pedido dele**, da confirmação até a entrega. O modelo mental é o rastreamento dos Correios — o
cliente vê em que ponto o pedido está, o que já aconteceu e o que falta. Não é um painel de
métricas, não tem gráfico, não tem número de produtividade.

Sou desenvolvedor fullstack júnior, trabalho sozinho nisso, e falo português. Explique as decisões
que você tomar; prefiro entender a ir rápido.

## Pilha e restrições

- **Next.js (App Router) + TypeScript + Tailwind**, que é a mesma pilha do ShopFloor.
  ⚠️ Antes de escrever código de framework, **leia a documentação da versão instalada** em
  `node_modules/next/dist/docs/` — a versão em uso pode ter mudanças que contrariam o que você
  aprendeu; não confie na memória.
- **Postgres** como banco, **exclusivo desta aplicação**. Em produção ele vai rodar dentro do
  mesmo servidor da aplicação.
- **Nada de acesso ao banco do ShopFloor.** O dado de fábrica chega por **sincronização**, copiando
  só o que o cliente pode ver. Isso é decisão de segurança, não de comodidade: este app é acessado
  por clientes externos, e um erro de permissão aqui significaria um cliente vendo o pedido de
  outro. Se o dado da fábrica não está neste banco, essa classe inteira de erro deixa de existir.
- **Celular e computador.** A linha do tempo é horizontal no computador e vertical no celular.
- Português do Brasil em tudo o que o usuário lê. Datas em `dd/mm/aaaa`.

## Quem usa e o que enxerga

O cliente **entra logado**. Não existe campo de "digite seu código de rastreio".

O vínculo é **usuário → cliente → lista de ACPs**. ACP é o código interno de projeto da Enterplak
(formato `ACP017/26`, às vezes com a sigla do cliente junto: `ACP017/26 GM`). Cada pedido do
cliente corresponde a uma ACP. O cliente só enxerga os pedidos das ACPs amarradas a ele.

**O cliente nunca vê o código da ACP** — é vocabulário interno. Ele aparece só nas telas de
administração.

## As duas telas

### 1. Meus pedidos

Uma linha por pedido, com:
- nome do produto e quantidade;
- o mês do pedido ("pedido de junho/26");
- a etapa atual, com a data em que entrou nela;
- uma barra de progresso e "etapa 8 de 9";
- a previsão de entrega (ou a data de entrega, se já entregue).

Abas "Em andamento" e "Entregues". Clicar numa linha abre a tela 2.

### 2. A linha do tempo do pedido

- Cabeçalho com o produto, a quantidade, a previsão de entrega e a situação atual.
- **Linha do tempo com nove etapas em bolinhas**: verde com check nas concluídas, anel destacado
  com o miolo cheio na atual, cinza vazia nas futuras. Cada uma com rótulo e data embaixo.
- **Histórico vertical** abaixo: data e hora à esquerda, trilho com bolinha no meio, o que
  aconteceu à direita, do mais recente para o mais antigo.
- Um jeito de voltar para a lista.

## As nove etapas

Nesta ordem, e o nome é o que o cliente lê:

1. **Pedido confirmado**
2. **Aquisição de matéria-prima**
3. **Agendamento de booking**
4. **[TRÂMITE]** ← o nome desta etapa ainda não foi definido. Deixe um marcador visível, não
   invente um nome.
5. **Chegada no Brasil**
6. **Desembaraço aduaneiro RF/RE**
7. **Fábrica**
8. **Produção iniciada**
9. **Entrega**

### De onde vem cada uma

**Das etapas 2 a 6: da planilha de embarque** (detalhada abaixo). A 2 vem da compra do material; a
3, a 4, a 5 e a 6 vêm de colunas de data dessa planilha.

**Etapa 7 (Fábrica):** da sincronização com o ShopFloor — o material daquele projeto chegou na
fábrica e foi registrado no recebimento.

**Etapa 8 (Produção iniciada):** da sincronização — existe registro de produção numa ordem daquele
projeto.

**Etapa 1 (Pedido confirmado):** depende de uma integração com o ERP (Compels) **que ainda não
existe**. O nome e a quantidade do produto também virão de lá. Até existir, trate como fonte
ausente: a etapa aparece, não acende, e o produto precisa de um nome provisório.

**Etapa 9 (Entrega):** a previsão de entrega **ainda não tem fonte nem dono definidos**. Não
invente: deixe o campo existir no modelo, preenchível, e a tela lidar com ele vazio.

## As quatro regras que impedem a linha do tempo de mentir

Estas regras são o coração do produto. Implemente-as como domínio testado, separadas da tela.

**1. Toda data carrega a sua qualidade.** Existem duas naturezas de data: *do fato* (alguém
escreveu quando a coisa aconteceu) e *do registro* (o carimbo de quando o sistema soube). A
segunda é marcada com `*` na tela, com uma legenda única no rodapé: *as datas com \* são a data em
que a informação chegou ao sistema, não necessariamente a do acontecimento*.

**2. Coerência cronológica por herança.** Se uma etapa tiver data anterior à da etapa anterior, ela
**herda a data da anterior** e passa a valer como aproximada. Nunca invente data, nunca mostre
fora de ordem, nunca esconda a etapa. Registre a inconsistência num log **interno** — o cliente
não vê.

**3. Pior caso.** Um pedido (uma ACP) pode ter **várias planilhas de embarque e várias ordens de
produção**. A etapa atual do pedido é a da **parte mais atrasada**; a data de uma etapa concluída é
a da **última parte a concluí-la**.

**4. A bolinha não volta.** Etapa que ficou verde fica verde, mesmo que material novo entre no
projeto depois. Para congelar não virar esconder, material novo entrando vira **uma linha no
histórico** ("entrou material novo neste projeto em 02/10"), e a previsão de entrega se atualiza
no cabeçalho.

## A planilha de embarque

É um arquivo `.xlsx` exportado do ERP e completado à mão. Uma planilha por embarque (EMB). Cada
linha é um item de matéria-prima comprado. Colunas:

`Utilização · Tracking · Número (pedido de compra) · Nome (fornecedor) · Código · Descrição ·
Quantidade · Unidade · NCM · Preço em moeda estrangeira · Total do Item · Total Invoice · Invoice ·
Projetos (a ACP) · Data prevista para entrega do item · Data de entrega do item · Data prevista do
embarque · Booking · Carga em trânsito`

Detalhes que mordem:

- **Linhas de `Tarifa` e `Frete` vêm intercaladas** depois dos itens de cada pedido, com o rótulo
  numa coluna e o valor em outra. **Não são itens** e precisam ser reconhecidas e separadas.
- **A coluna Projetos pode conter mais de uma ACP** (`ACP013/26 E ACP014/26`). O filtro tem de
  entender isso: a linha pertence às duas.
- **A mesma ACP aparece escrita de formas diferentes** (`ACP14/26` e `ACP014/26`). Normalize para
  comparar, mas guarde o original.
- **Nem toda linha tem ACP**: aparecem valores como `RW`, `CONSUMO`, `Amostra`. Esses não são
  cliente e não devem virar pedido de ninguém.
- Duas colunas novas serão acrescentadas à planilha: **chegada no Brasil** e **desembaraço**.
  Prepare a leitura para elas.

### Como ela entra e se mantém atualizada

Ela é **importada nesta aplicação**, que passa a ser dona desses dados. Duas formas de manter:

1. **Editar dentro do sistema**, num grid que imita o Excel;
2. **Reimportar o arquivo**, sobrescrevendo.

Mais tarde haverá integração automática.

**Regra do conflito:** a reimportação **sobrescreve**, mas **mostra um resumo do que mudou** — "34
linhas atualizadas, 3 datas mudaram, 1 voltou ao valor anterior". Não pergunta, não trava, só
deixa visível. Quando a integração automática existir, ela **nunca sobrescreve célula editada à
mão**; anota a divergência numa lista para alguém olhar.

**Na entrada, descarte o que o cliente não pode ver:** preço, fornecedor, invoice e NCM **não
entram no banco**. É mais seguro não deixar o dado entrar do que confiar em filtrar na saída.

## A sincronização com o ShopFloor

Um processo separado copia do ShopFloor, periodicamente, só o necessário:

- **do recebimento**, por processo: a ACP do cliente, o número da EMB, a data de chegada do
  material na fábrica e a situação (aberto / em conferência / finalizado);
- **da produção**, por ordem: a ACP, a existência e a data do primeiro registro de produção, e se a
  ordem foi concluída.

Nada além disso. Nomes de colaborador, defeitos, reprovações, números de série e tempos por posto
**não são copiados** — não é filtragem na tela, é ausência no banco.

Não implemente essa sincronização antes de conversar comigo: ela depende de credenciais e de
detalhes do outro sistema.

## O que o cliente nunca pode ver

Taxa de aprovação ou reprovação · defeitos e reparos · nome de colaborador · tempo por posto ou
produtividade · fornecedor e fabricante · número de série · preço, invoice e NCM · qualquer dado de
outro cliente.

**Vocabulário traduzido:** "reprovado" vira **"em verificação de qualidade"**; divergência de
quantidade vira **"quantidade em conferência com o fornecedor"** (essa **aparece**, porque afeta o
prazo dele); códigos internos de ordem viram **"Lote 1 de 2"**; nomes de posto viram nomes de
etapa.

## Identidade visual

Para parecer da mesma família do ShopFloor:

- fonte **Geist** (e Geist Mono para códigos);
- fundo `#f5f6f8`, cartões `#ffffff`, texto `#171a1f`, texto secundário `#6a7180`, bordas
  `#e6e8ec`;
- cor da marca **`#8D2033`** (vinho), usada com parcimônia: etapa atual, ações principais;
- verde `#16a34a` para concluído, âmbar `#d97706` para atenção;
- cantos arredondados, sem sombras pesadas, sem gradiente.

## O que ainda não está decidido — não invente

- O **nome da etapa 4**.
- A **fonte e o dono da previsão de entrega**.
- A **integração com o Compels** (etapa 1 e o nome do produto).
- Se as datas de booking, trâmite, chegada no Brasil e desembaraço serão mesmo preenchidas por
  quem cuida da importação. **Se não forem, quatro das nove etapas nunca acendem.**

Onde faltar decisão, deixe marcador visível e me pergunte. Não preencha com dado inventado.

## Por onde começar

Não escreva código ainda. Comece assim:

1. Me faça as perguntas que faltam para você entender o problema — **uma de cada vez**.
2. Proponha o modelo de dados: como o pedido, o embarque, os itens, as etapas e o histórico se
   relacionam, e onde mora a qualidade de cada data.
3. Depois de eu aprovar o modelo, proponha a ordem de construção.

Minha preferência de ordem, para você discutir comigo: **o banco e a importação da planilha
primeiro** — é o dado que não existe em nenhum outro lugar —, depois o cálculo das etapas, depois
as duas telas com dado real, depois o login e o vínculo usuário → cliente → ACPs, e a
sincronização com o ShopFloor por último.
