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

### Os controles de operação

> ⚠️ **Esta seção dizia "os três controles" em todo lugar. Desde 09/10 (tarde) são TRÊS na tela
> normal e DOIS no embed** — Defeitos saiu do embed. Ver o [adendo de 09/10](#adendo--0910-tarde-o-embed-enquadra-sozinho-e-defeitos-sai-dele).

Confirmados por print, com as posições reais (a descrição inicial estava espelhada):

| Controle | Canto | Existe no embed? |
|---|---|---|
| Filtro (botão vermelho) | superior **direito** | sim |
| Zoom (`− 100 +`) | inferior **esquerdo** | sim |
| Defeitos | inferior **direito** | **não** (desde 09/10, tarde) |

Eles passam a aparecer **só no hover**, e isso vale **em todo o embed** (com ou sem `?modo=tv`) **e
no Modo TV** da tela normal — decisão do usuário, confirmada em 09/10 quando eu apontei que a minha
própria lista de verificação se contradizia.

**A regra, nas três situações:**

| Onde | Quais controles | Visibilidade |
|---|---|---|
| Embed, **com ou sem** `?modo=tv` | Filtro + Zoom (Defeitos não existe lá) | **só no hover** |
| Tela normal em Modo TV (tela cheia do navegador) | Filtro + Zoom + Defeitos | **só no hover** |
| Tela normal fora do Modo TV | Filtro + Zoom + Defeitos | **sempre visíveis** |

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

1. Abrir o embed **sem** o parâmetro: layout normal (não apresentação), mas os botões do embed
   (Filtro e Zoom — Defeitos não existe lá) **já escondidos**, aparecendo no hover. ⚠️ A primeira
   versão desta spec dizia "botões visíveis" aqui, contradizendo a decisão do usuário — corrigido
   em 09/10.
2. Abrir **com** `?modo=tv`: layout de apresentação ocupando o iframe, Filtro e Zoom escondidos,
   reaparecendo no hover.
3. **Com `?modo=tv`, o navegador não entra em tela cheia.** É o teste que prova que o conflito
   morreu — e o único que o sintoma original denunciava.
4. Na tela normal `/shopfloor/fluxo`, fora do Modo TV, os três botões (Filtro, Zoom e Defeitos)
   continuam visíveis **sem** hover. É o que protege o tablet.
5. O `sf-embed:ready` continua saindo nos dois casos.

O caso 3 é o que distingue este desenho do que existe, e o caso 4 é o que garante que a mudança não
vazou para quem não devia.

## Decisões travadas com o usuário

1. O embed abre em Modo TV pelo parâmetro `?modo=tv` (08–09/10).
2. Os controles viram hover **no embed e no Modo TV**; a tela normal fica intacta (08/10).
   ⚠️ No embed são só dois desde 09/10 (tarde): Defeitos saiu de lá — ver o adendo.
3. O ShopFloor **não** chama a tela cheia do navegador dentro do embed (09/10, depois de medido).
4. **No tablet, em Modo TV, os três controles ficam inalcançáveis — e isso está ACEITO** (09/10,
   depois que a revisão final mediu o CSS gerado). O `@media (hover:hover)` não casa em dispositivo
   de toque, e o `pointer-events-none` impede o toque que daria o foco. A saída é o botão
   **"Sair (Esc)"**, que não recebe o esconder e continua visível — ninguém fica preso.
   O Modo TV no tablet serve para **mostrar** a tela, não para trabalhar nela. Se um dia for preciso
   operar em Modo TV no tablet, isso é feature nova, não ajuste.

---

## Adendo — 09/10 (tarde): o embed enquadra sozinho e Defeitos sai dele

O Modo TV no embed subiu pra produção na manhã de 09/10. Olhando a TV de verdade, o usuário pediu
três mudanças — **todas só no embed**; a tela normal `/shopfloor/fluxo` não muda em nada.

### 1. O embed ignora a posição salva na máquina

`chaveLayout(pmo, op)` = `sf:fluxo:pos:<PMO>:<OP>` no `localStorage`. **No embed a tela não lê e
não grava**: ler deixaria o arranjo que alguém arrastou naquele aparelho valer na TV; gravar faria
um arrasto acidental virar o novo padrão dali pra sempre. O embed usa sempre o arranjo **padrão do
domínio** (serpentina) e conta com o enquadramento automático.

Palavras do usuário, que decidem o desenho: *"se vier na melhor visualização possível não precisa
ser o mesmo em todas as máquinas"*. O objetivo é **caber bem**, não igualdade entre telas — nada é
sincronizado entre aparelhos.

A tela normal continua lendo e gravando como antes: lá a pessoa posiciona de propósito.

### 2. O embed se enquadra sozinho — e o enquadramento reserva a barra do Modo TV

Antes, nada re-enquadrava depois da primeira montagem (a prop `fitView` do `<ReactFlow>` só vale
ali). No embed, o iframe acerta o tamanho **depois** do primeiro desenho, então o enquadramento
feito antes virava sobra ou corte. Agora, **só no embed**:

- re-enquadra quando o **conjunto de nós** muda (os cards chegaram, a OP trocou, a OP ganhou um
  posto). A chave é a lista de ids: o refresh de 20s muda os números dos cards, e re-enquadrar a
  cada 20s faria o fluxo pular na TV sem motivo;
- re-enquadra quando o **canvas muda de tamanho** (`ResizeObserver` no canvas, com debounce).

⚠️ **Só no embed.** Na tela normal, re-enquadrar sozinho desfaria o posicionamento da pessoa na
frente dela.

**A causa do "cortado" não era só isso.** Medido na tela pelo usuário: clicando no ⤢ "Enquadrar", o
fluxo cabe. O problema é que a **barra do Modo TV** (PMO/OP + relógio + progresso) é um **overlay**
`absolute top-0` por cima do canvas — o `fitView` enquadra o canvas inteiro, inclusive o pedaço que
a barra tapa, e a primeira fileira de cards vai parar atrás dela. Por isso re-enquadrar, sozinho,
não resolveria.

**Correção:** com a barra visível, toda chamada de `fitView` passa
`padding: { top: '<altura da barra + 8>px', x: 0.1, y: 0.1 }` — o `FitViewOptions.padding` do
`@xyflow/react` 12.11.2 aceita valor **por lado**, em px ou %. Os lados que a barra não ocupa
mantêm o padrão do React Flow (`0.1`), senão os cards colariam nas bordas. **Fora do Modo TV não há
barra e não há margem extra** — senão o Fluxo da tela normal passaria a sobrar espaço no topo sem
motivo.

### A altura da barra é MEDIDA, não constante

> ⚠️ A primeira versão desta correção fixou **4rem (64px)**, com o argumento de que o layout já
> tratava a barra como 4rem. **O usuário testou na TV e ficou curto**: a fileira de cima aparecia
> sem a borda de cima. Trocado por medição no mesmo dia. A frase "a altura da barra tem um único
> lugar, a constante `BARRA_TV`" **não vale mais** — está substituída pelo que vem abaixo.

A conta explica o erro: `py-3` (24px) + `text-3xl leading-none` (30px) sobre `text-xs` (12px) + a
borda ≈ **67–70px**, não 64. Mas o motivo forte não é o número: **a altura real varia por
aparelho** — resolução da TV, zoom do navegador, fonte do sistema — e por conteúdo (o PMO/OP
quebrando em tela estreita, a % saindo de `—` pra um número). Qualquer constante estaria errada em
alguma tela, e a próxima TV não é a tela onde medimos.

Como ficou:

- `ref` na `<div>` da barra (marcada com a classe `barra-modo-tv`), altura lida com
  `getBoundingClientRect().height`, guardada em estado e **observada por `ResizeObserver`** — a
  barra muda de altura sozinha.
- A reserva do `fitView` é `max(altura medida, 64px) + 8px`. Os 8px são a folga explícita pra o
  card não **encostar** na barra.
- Os 64px viraram **piso**, não valor: antes da primeira medição (e numa medição estranha — barra
  escondida, meio de transição) o enquadramento nunca reserva 0, que é o próprio sintoma.
- No embed, **a medida chegar re-enquadra**: o primeiro desenho usa o piso, e o fit de verdade sai
  quando a barra foi medida.

**O que NÃO pode ser medido continua constante, e isso é intencional.** Os três literais de
Tailwind (`top-16 h-[calc(100%-4rem)]` no painel lateral, `top-[4.75rem]` nos controles) são CSS e
não têm como ler a medição — e não precisam: eles só empurram painel e botões pra baixo da barra, e
um fio de folga a mais ou a menos não **esconde** nada. **A única medida que precisa ser exata é a
do enquadramento**, porque é ela que decide se o card fica visível. Registro do estado de hoje:
esses literais **já discordam entre si** — o painel usa 4rem e os controles 4.75rem.

### 3. Defeitos sai do embed

No Dashboard o embutido é **tela de Fluxo e mais nada**. No embed, **nem o botão nem o painel são
renderizados**, e o **atalho de teclado → não abre nada** (esconder não bastava). Na tela normal e
no Modo TV dela, Defeitos continua existindo — é onde o supervisor usa.

**Consequência nesta spec:** onde se lia "os três controles aparecem só no hover no embed", agora
são **dois** (Filtro e Zoom). As seções acima estão corrigidas no lugar.

### O que NÃO entrou

- **A faixa vermelha à direita em telas largas.** Medido: em Modo TV o canvas é `fixed inset-0` e
  ocupa o iframe inteiro — a faixa é largura do iframe, do lado do Dashboard.
- **Dispor os postos pelo formato da tela** (quantos por linha). É algoritmo de layout novo, com
  spec própria. Este adendo só **enquadra** o que já existe.
