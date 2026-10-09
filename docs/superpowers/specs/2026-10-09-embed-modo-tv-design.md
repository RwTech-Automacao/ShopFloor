# Modo TV no embed (`?modo=tv`) — desenho

**O pedido.** O Fluxo da OP embutido no Dashboard Enterplak deve abrir **já em Modo TV**, sem
ninguém clicar em cada aba, e sem os controles de operação aparecendo na TV.

## O problema de verdade, medido em produção (09/10)

O Matheus testou o embed no domínio próprio e viu três sintomas:

1. Ao trocar de OP, a nova **não** vem em Modo TV.
2. Ao sair do Modo TV do Fluxo, **o Dashboard sai da tela cheia junto**.
3. Os botões de operação continuam visíveis.

**A causa dos dois primeiros é a mesma, e não é bug de nenhum dos lados.** O "Modo TV" do Fluxo é
a **API de tela cheia do navegador**: `fluxo-form.tsx` chama `canvasRef.current.requestFullscreen()`
e o estado `telaCheia` é *derivado* do evento `fullscreenchange`.

Só existe **uma** tela cheia por aba. Quando o Fluxo entra, ele toma a que o Dashboard estava
usando; quando sai (Esc, ou a rotação trocando de OP), o `exitFullscreen` derruba a do Dashboard
junto. **Dois donos disputando um recurso do navegador.**

Isso também explica por que "abrir já em Modo TV" não poderia ser feito chamando o que existe: o
navegador exige gesto do usuário para entrar em tela cheia, e dentro de um iframe exige ainda
permissão do pai. No load, nunca funcionaria.

## O desenho

**Separar a aparência da API.** O layout de apresentação passa a poder ser ligado por fora, sem
`requestFullscreen`. Fora do embed nada muda: o botão "Modo TV" da tela normal continua usando a
tela cheia do navegador, como hoje.

1. `FluxoForm` ganha uma prop que **força** o layout de apresentação. O `telaCheia` interno passa a
   ser `telaCheia || forçado`. É o mesmo padrão que o embed já usa com `opFixa` e `ocultarSeletor` —
   **a mesma tela, por prop**, sem cópia: melhoria no Fluxo continua chegando ao Dashboard sozinha.
2. A página `/embed/fluxo/[pmo]/[op]` lê `?modo=tv` da query e passa a prop.
3. Com o modo ligado, **nada chama `requestFullscreen` nem `exitFullscreen`**. A tela cheia fica do
   Dashboard, sozinha.

### Os três controles

Confirmados por print, com as posições reais (a descrição inicial estava espelhada):

| Controle | Canto |
|---|---|
| Filtro (botão vermelho) | superior **direito** |
| Zoom (`− 100 +`) | inferior **esquerdo** |
| Defeitos | inferior **direito** |

Eles passam a aparecer **só no hover**, e isso vale **em todo o embed** (com ou sem `?modo=tv`) **e
no Modo TV** da tela normal — decisão do usuário, confirmada em 09/10 quando eu apontei que a minha
própria lista de verificação se contradizia.

**A regra, nas três situações:**

| Onde | Os três controles |
|---|---|
| Embed, **com ou sem** `?modo=tv` | **só no hover** |
| Tela normal em Modo TV (tela cheia do navegador) | **só no hover** |
| Tela normal fora do Modo TV | **sempre visíveis** |

⚠️ **Fora do Modo TV a tela normal não muda.** O Fluxo é usado em **tablet** pelos supervisores, e
tablet não tem hover: esconder em todo lugar deixaria filtro, defeitos e zoom **inalcançáveis** para
eles. Essa é a razão do recorte, não preferência estética.

Na TV também não há hover — então lá eles somem de vez, que é exatamente o objetivo.

## O contrato com o Dashboard

Acertado na Central (card #6, mensagens #30 e #36):

- O Dashboard manda `?modo=tv` quando **ele** está em tela cheia; fora dela, sem o parâmetro.
- O `next` do SSO leva o parâmetro junto.
- Com `?modo=tv`, o ShopFloor: abre no layout de apresentação ocupando o iframe todo; **não** chama
  a tela cheia do navegador; **não** usa playlist própria (quem troca de OP é a rotação do
  Dashboard); e continua mandando o `sf-embed:ready`.

**Pergunta em aberto com eles** (não bloqueia o miolo): se conseguem recarregar o iframe ao
entrar/sair da tela cheia, basta trocar o `src`. Se preferirem não recarregar, entra também um
`postMessage` para ligar e desligar o modo sem reload. O item 1 do desenho serve aos dois casos —
é só quem chama que muda.

## O que NÃO muda

- **A tela normal `/shopfloor/fluxo`**, fora do Modo TV. Nenhum botão some lá.
- **O botão "Modo TV" da tela normal** continua usando a tela cheia do navegador.
- **Nada de cópia de tela.** É a mesma `FluxoForm`, por prop.

## Como saber que funcionou

1. Abrir o embed **sem** o parâmetro: layout normal (não apresentação), mas os três botões **já
   escondidos**, aparecendo no hover. ⚠️ A primeira versão desta spec dizia "botões visíveis" aqui,
   contradizendo a decisão do usuário — corrigido em 09/10.
2. Abrir **com** `?modo=tv`: layout de apresentação ocupando o iframe, três botões escondidos,
   reaparecendo no hover.
3. **Com `?modo=tv`, o navegador não entra em tela cheia.** É o teste que prova que o conflito
   morreu — e o único que o sintoma original denunciava.
4. Na tela normal `/shopfloor/fluxo`, fora do Modo TV, os três botões continuam visíveis **sem**
   hover. É o que protege o tablet.
5. O `sf-embed:ready` continua saindo nos dois casos.

O caso 3 é o que distingue este desenho do que existe, e o caso 4 é o que garante que a mudança não
vazou para quem não devia.

## Decisões travadas com o usuário

1. O embed abre em Modo TV pelo parâmetro `?modo=tv` (08–09/10).
2. Os três controles viram hover **no embed e no Modo TV**; a tela normal fica intacta (08/10).
3. O ShopFloor **não** chama a tela cheia do navegador dentro do embed (09/10, depois de medido).
