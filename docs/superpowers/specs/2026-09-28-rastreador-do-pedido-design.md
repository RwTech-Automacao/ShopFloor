# Rastreador do Pedido — design

**Card:** Central do cliente — Sprint 23/09/2026 [10h]
**Data:** 28/09/2026
**Estado:** desenho fechado, implementação não começou

## O que é

Uma aplicação separada onde o **cliente da Enterplak acompanha o pedido dele de ponta a ponta** —
da confirmação do pedido até a entrega — no espírito do rastreamento dos Correios: uma linha do
tempo com etapas concluídas, a etapa atual e o que falta, mais um histórico com data e hora.

## O que ele NÃO é

A ideia original era um portal com três telas, painéis e métricas por posto. **Foi reduzida de
propósito.** A diferença não é de tamanho, é de natureza: um painel precisa de números confiáveis
por posto e por ordem; um rastreador precisa saber **em que ponto a coisa está**. "Produção
iniciada" vira uma bolinha, não um gráfico.

Isso destravou o card. O desenho antigo dependia de ligar cada ordem de produção ao projeto do
cliente para poder contar peças; o rastreador só precisa saber que a produção começou.

## Quem usa

O cliente entra **logado** — não existe campo de "digite seu código". O cadastro amarra
**usuário → cliente → lista de ACPs**, e o cliente enxerga apenas os pedidos dessas ACPs. É
controle explícito: ninguém vê nada por acidente, e dá para conferir na tela quem enxerga o quê.

A ACP (o projeto) é o que amarra as três fases — embarque, recebimento e produção —, mas **o
cliente nunca vê esse código**: é vocabulário de dentro de casa.

## As duas telas

**1. Meus pedidos.** Uma linha por pedido, com o nome do produto, a quantidade e o mês do pedido.
À direita, a etapa atual, uma barra de quanto andou ("etapa 8 de 9") e a previsão de entrega.
Pedidos entregues aparecem com data de entrega. Abas "Em andamento" e "Entregues".

**2. A linha do tempo.** O pedido escolhido, com:

- **linha do tempo horizontal em bolinhas** — verde com check nas concluídas, anel destacado com
  miolo cheio na atual, cinza vazia nas futuras, cada uma com rótulo e data embaixo;
- **histórico vertical** logo abaixo — data e hora à esquerda, trilho com bolinha no meio, o que
  aconteceu à direita, do mais recente para o mais antigo.

As duas funcionam em **celular e computador**. No celular a linha do tempo vira vertical.

## As nove etapas e de onde vem cada uma

| # | Etapa | O que a conclui | Fonte | Qualidade da data |
|---|---|---|---|---|
| 1 | Pedido confirmado | a confirmação do pedido de venda | **Compels (integração que ainda não existe)** | — |
| 2 | Aquisição de matéria-prima | **a data de entrega do item** ao agente de carga, no pior caso | planilha de embarque | exata |
| 3 | Agendamento de booking | coluna **Booking** preenchida | planilha de embarque | exata |
| 4 | **[TRÂMITE — nome a confirmar]** | provavelmente **Carga em trânsito** | planilha de embarque | aproximada |
| 5 | Chegada no Brasil | coluna nova na planilha | planilha de embarque | exata |
| 6 | Desembaraço aduaneiro RF/RE | coluna nova na planilha | planilha de embarque | exata |
| 7 | Fábrica | a data de chegada do material na fábrica | ShopFloor — Recebimento | exata |
| 8 | Produção iniciada | o primeiro registro numa ordem com aquela ACP | ShopFloor — produção | exata |
| 9 | Entrega | **previsão** de entrega | **em aberto** | prevista |

**Decisão de 28/09 sobre a etapa 2.** Ela conclui pela coluna **Data de entrega do item**, não pela
data da compra. Três razões: é a coluna que existe de fato nas planilhas (data da compra não existe
na EMB347EA, e usar a data da importação deixaria a segunda bolinha quase sempre aproximada); faz a
etapa significar algo verificável — *o material está em mãos* — em vez de apenas *alguém comprou*; e
mantém visível o item que falta. Aplicando o pior caso: a etapa só conclui quando **todos** os itens
do projeto naquela EMB tiverem data de entrega, e a data da etapa é a da **última**.

⚠️ **Item preso tem de ser visível por dentro.** Segurar a etapa só é uma boa regra se alguém da
Enterplak enxergar o que está segurando — "este projeto está parado há 12 dias esperando o CON985".
Se isso viver só na tela do cliente, ninguém aqui descobre. Exemplo real: na EMB347EA, 17 dos 18
itens do ACP017/26 têm data de entrega; o `CON985` (505 conectores microfit) não tem, e segura a
etapa sozinho.

**A leitura que importa:** as etapas 3 a 6 são **o mesmo problema com a mesma solução** — quatro
datas que quem cuida da importação já sabe e que hoje não têm onde ser gravadas. Duas colunas já
existem na planilha e vêm em branco; duas precisam ser criadas. Nenhuma delas exige tela nova nem
que ninguém aprenda sistema novo.

Com isso, **sete das nove etapas acendem**. Sobram a 1, que depende do Compels, e a 9, que precisa
de dono.

## As quatro regras que impedem a linha do tempo de mentir

**1. Toda data carrega a sua qualidade.** Existem duas naturezas: *data do fato* (alguém escreveu
quando a coisa aconteceu) e *data do registro* (o carimbo de quando o sistema soube). A segunda é
marcada com `*` na tela, e o rodapé explica uma vez só: *as datas com \* são a data em que a
informação chegou ao sistema, não necessariamente a do acontecimento*.

**2. Coerência cronológica por herança.** Se uma etapa tem data anterior à da etapa anterior, ela
**herda a data da anterior** e passa a valer como aproximada. Nunca inventa data, nunca mostra
fora de ordem, nunca esconde a etapa. A inconsistência vai para um registro **interno** — o
cliente não vê.

**3. Pior caso.** Uma ACP tem **várias EMBs e várias ordens de produção**. A etapa atual do pedido
é a da **parte mais atrasada**; a data de uma etapa concluída é a da **última parte a concluí-la**.

**4. A bolinha não volta.** Etapa que ficou verde fica verde, mesmo que material novo entre no
projeto depois. Para congelar não virar esconder, **material novo vira uma linha no histórico**
("entrou material novo neste projeto em 02/10"), que é append-only por natureza, e a previsão de
entrega se atualiza no cabeçalho.

## A planilha de embarque

Ela é **importada no rastreador**, que passa a ser dono desses dados. O Recebimento do ShopFloor
continua importando a própria cópia para o que ele já faz — a duplicação é aceita
conscientemente.

Como a planilha muda o tempo todo, há **duas formas de mantê-la atualizada**:

1. **Editar dentro do sistema**, num grid que imita o Excel;
2. **Reimportar o arquivo**, sobrescrevendo.

E, no futuro, uma **integração** que puxe sozinha, sem ninguém subir arquivo.

**A regra do conflito entre as duas formas.** Alguém corrige uma data na tela e depois sobe um
arquivo mais velho, sem aquela correção. Como as duas formas são a mesma pessoa fazendo a mesma
coisa, o arquivo novo manda: **a reimportação sobrescreve**. Mas ela **mostra um resumo do que
mudou** — "34 linhas atualizadas, 3 datas mudaram, 1 voltou ao valor anterior". Não pergunta nada,
não trava nada, só deixa visível: é a diferença entre descobrir na hora que subiu o arquivo errado
e descobrir uma semana depois pelo cliente.

A integração automática herda a regra com um ajuste: como não há ninguém na frente da tela,
**puxada automática nunca sobrescreve célula editada à mão** — anota a divergência numa lista.

**Na entrada, descartar o que o cliente não pode ver:** a planilha carrega **preço, fornecedor,
invoice e NCM**. É mais seguro não deixar esse dado entrar do que confiar em filtrar na saída.

## Arquitetura

**Aplicação separada, com banco próprio.** Quando for para produção, o Postgres fica **dentro do
próprio Lightsail**, que já roda 24/7 — o RDS não serve porque desliga fora do horário da fábrica,
e o cliente olha pedido à noite e no fim de semana.

**Por que banco próprio, e não o mesmo do ShopFloor:** este é um app voltado para fora, acessado
por clientes. Num app de fábrica, um erro de permissão é um incômodo interno; num portal de
cliente, é o cliente A vendo o pedido do cliente B. A revisão de segurança de 21/09 encontrou uma
`tem_permissao` de um argumento que anulava o RBAC inteiro — se aquilo estivesse num portal, um
cliente teria visto a fábrica toda. Banco separado torna a classe inteira de erro **impossível**,
porque o dado da fábrica simplesmente não está lá.

**Como o dado da fábrica chega:** por **sincronização** a partir do ShopFloor, copiando só o que o
cliente pode ver. É o mesmo padrão do conector do repinmetro, que já roda em produção.

**Backup:** a maior parte do banco é reconstruível, porque vem da sincronização — **menos a
planilha editada**, que nasce ali e não existe em mais lugar nenhum. Dump diário, custo de
centavos.

## O que o cliente nunca vê

Taxa de aprovação ou reprovação por posto · defeitos e reparos · nome de colaborador · tempo por
posto e produtividade · fornecedor e fabricante · número de série · preço, invoice e NCM · e
qualquer dado de outro cliente.

**Traduzido antes de sair:** reprovado no NQA → "em verificação de qualidade" · divergência de
quantidade → "quantidade em conferência com o fornecedor" (essa **sai**, porque afeta o prazo
dele) · `PMOM90/357` → "Lote 1 de 2" · nomes de posto → nomes de etapa.

## O que ficou em aberto

- **A previsão de entrega ao cliente não existe em campo nenhum.** O `data_prevista` do Recebimento
  é a previsão de chegada do *material*, outra coisa. É a informação que o cliente mais olha, e
  precisa de fonte e de dono.
- **O nome da etapa 4.**
- **A etapa 1** depende da integração com o Compels.
- **A ACP no cadastro de OP** deve virar obrigatória, mas isso trava as OPs internas (cliente RW,
  sem projeto) e as OPs antigas estão todas em branco. Decidido deixar como está por enquanto.
- **Confirmar com quem cuida da importação** que booking, trâmite, chegada no Brasil e desembaraço
  são datas que ele tem na mão. **Se a resposta for não, quatro das nove bolinhas nunca acendem** —
  vale perguntar antes de escrever código.

## Riscos

- **O filtro por ACP precisa entender campo com duas ACPs.** Em produção existem 105 processos com
  `ACP013/26 E ACP014/26` no campo Projeto. Se essa EMB atrasa, as duas linhas do tempo atrasam —
  o que está correto —, mas o filtro tem de saber ler o formato.
- **A ACP é texto livre** e a mesma aparece escrita de formas diferentes (`ACP14/26` e `ACP014/26`).
  Antes do portal ir para clientes de verdade, ela precisa virar lista.
- **Quatro das nove etapas dependem de alguém preencher a planilha.** Campo que depende de
  disciplina costuma vir vazio; se vier, as bolinhas ficam cinzas e o produto entrega menos do que
  promete.
- **O mesmo arquivo importado em dois lugares** (Recebimento e rastreador) pode divergir. Aceito
  conscientemente, mas é o primeiro lugar a olhar quando alguém disser que o número está errado.
