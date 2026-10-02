# Explicação ao resolver uma ocorrência — design

**Data:** 02/10/2026
**Onde:** Alertas do ShopFloor — a tela, o Discord e (depois) o Telegram

## O problema

Hoje, resolver uma ocorrência é um clique. Fica registrado **quem** resolveu e **quando** — nunca
**o que foi feito**. Quem recebeu o alerta vê a mensagem "✅ resolvido por fulano" e não sabe se
trocaram o feeder, se recalibraram a máquina ou se o número normalizou sozinho.

Pedido do usuário: ao resolver, a pessoa escreve uma explicação curta do que fez.

## As três portas, e por que isso é fácil

Resolver acontece por **três caminhos** — a tela do ShopFloor, o botão do Discord e o Telegram — e
os três caem na **mesma função do banco**, `alerta_resolver_interno` (0113:651), por dois
invólucros (`alerta_resolver` para o destinatário, `alerta_resolver_admin` para o gestor).

**A explicação entra como parâmetro dessa função.** Com isso ela é gravada igual, venha de onde
vier — não há porta que escape, e não há regra duplicada em três lugares.

## As decisões tomadas

**A explicação é OPCIONAL** (decisão do usuário, 02/10). A caixa abre e quem quiser confirma vazio.

Isso tem uma consequência boa: como é opcional, **o botão do Telegram pode continuar como está**
nesta primeira entrega. Resolver por lá sem texto não vira uma porta sem registro — vira o caso
opcional exercido. Não há buraco a tapar.

**Discord e tela primeiro; Telegram depois.** O Discord tem caixa de texto nativa (o *modal*), e a
estrutura que ela exige já existe: o projeto **não usa webhook**, usa uma aplicação de verdade, com
rota própria (`src/app/api/alertas/discord/route.ts`) e verificação de assinatura Ed25519. No
Telegram **não existe modal** — o bot teria de perguntar e esperar a próxima mensagem da pessoa,
guardando estado ("estou esperando a explicação de fulano") e decidindo o que fazer quando ela
some no meio. É outra mecânica, e fica para uma segunda entrega.

## O botão

Hoje, no Discord: **verde** (`style: 3`), `✅`, rótulo **"Resolvido"** — tem cara de conclusão,
quando na verdade é um pedido de ação.

Novo: rótulo **"Resolver"**, emoji **`⚠️`**, e **fora do verde**.

⚠️ **O Discord não tem botão amarelo.** Os estilos são azul (primary), cinza (secondary), verde
(success) e vermelho (danger) — não há amarelo, e isso não é configurável. O amarelo que o usuário
pediu é carregado pelo **emoji `⚠️`**; a cor vai para **cinza**, que é neutra e não sugere
conclusão. (Vermelho diria "perigo", que é outra coisa: a ocorrência é um aviso, não um erro de
quem vai clicar.)

**Na tela do ShopFloor o amarelo existe de verdade** — lá o botão fica como o usuário descreveu:
amarelo, com ponto de exclamação, escrito "Resolver".

## O fluxo, por porta

**Discord:** clique no botão → a rota responde com um **modal** (`type: 9`) com um campo de texto
curto → a pessoa escreve (ou deixa vazio) e envia → a rota recebe o envio do modal, resolve com a
explicação, e **edita a mensagem original** tirando o botão, como já faz hoje.

**Tela:** clique em "Resolver" → caixa de texto → confirma → resolve.

**Telegram:** inalterado nesta entrega.

## O que os outros passam a receber

A mensagem de "resolvido por" que vai para os demais destinatários **já existe** e passa a levar a
explicação junto. É provavelmente o maior ganho disto: quem recebeu o alerta fica sabendo **o que
foi feito**, não só que acabou.

Quando a explicação vier vazia, a mensagem sai como hoje — **sem rabo** ("resolvido por fulano:"
com nada depois).

## Onde a explicação é guardada

Na própria ocorrência (`alerta_ocorrencias`), ao lado de quem resolveu e quando. Coluna nova, texto
livre, vazia por padrão — porque é opcional e porque toda ocorrência já resolvida antes desta
mudança não tem explicação nenhuma.

## Fora de escopo

- O Telegram (segunda entrega).
- Tornar a explicação obrigatória (o usuário decidiu "por enquanto não").
- Qualquer tela nova para ler as explicações — elas aparecem na ocorrência e na mensagem de
  resolvido; não há relatório nesta entrega.

## Em aberto

Nenhum.
