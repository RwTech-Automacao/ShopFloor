# Recebimento: Fluxo e Registros — design

**Card:** Replicar a tela de Fluxo e de Registros no módulo Recebimento — Sprint 23/09/2026 [4h]
**Data:** 24/09/2026
**Rotas novas:** `/recebimento/fluxo` e `/recebimento/registros`

## Objetivo

Dar ao Recebimento as duas telas que o ShopFloor tem e que hoje não existem ali: **onde cada
item está** (Fluxo) e **o que aconteceu com ele** (Registros).

Hoje o módulo mostra o **estado atual** de cada processo, numa lista. Não mostra movimento,
não mostra tempo, e o histórico — que existe e é completo — só é visível em
Configurações › Logs, para quem administra o **sistema**. Quem confere material não
consegue responder "quem mexeu nisso, quando, e de quanto para quanto".

## O mapa

| ShopFloor | Recebimento |
|---|---|
| OP | **EMB** |
| Número de série (a peça que anda) | **O processo** — identificado pelo **Item**, não pelo número |
| Postos | **Recebimento** → **Qualidade** |
| Concluído | **Almoxarifado** |
| Manutenção (ramo de onde se volta) | **não existe equivalente** |

```
Recebimento ──► Qualidade ──► Almoxarifado
                    │
                    └──► Reprovado na Qualidade   (fim de linha)

Divergência de Quantidade = marca que viaja com o item, não é uma caixa
```

Diferente da Manutenção do ShopFloor, aqui **não há ramo de onde se volta**: só uma saída
lateral definitiva (Reprovado) e uma bandeira que acompanha o item (Divergência).

## As regras de etapa

Cada regra é um **evento com hora**, o que permite medir tempo por etapa.

| Transição | O que a dispara |
|---|---|
| (nasce) → **Recebimento** | o processo é criado — importação de planilha ou cadastro manual |
| **Recebimento** → **Qualidade** | alguém salva a **seção Recebimento** do processo |
| **Qualidade** → **Almoxarifado** | **Finalizar** com resultado **diferente de Reprovado** |
| **Qualidade** → **Reprovado na Qualidade** | **Finalizar** com resultado **Reprovado** — fim de linha |

**Sobre a lista de resultados.** Os valores de "Resultado" são configuráveis em
Configurações › Listas (hoje: Aprovado, Aprovado sob concessão, Reprovado). A regra é
**"Reprovado é a única saída lateral; qualquer outro resultado conta como Almoxarifado"**.
Decisão consciente: um valor novo de aprovação (ex.: "Aprovado com ressalva") entra no fluxo
sozinho, sem ninguém mexer em código. O risco aceito é o contrário — se criarem "Reprovado
parcial", ele cairia no Almoxarifado indevidamente. Se isso acontecer, a correção é listar
explicitamente quais resultados são aprovação.

**Divergência de Quantidade.** O campo `divergencia` é **calculado** pelo sistema
(`quantidade_recebida − quantidade_pedido`) e guardado como texto. A regra:

- **vazio** → ainda não conferido, **não é divergência**;
- **número igual a zero** → sem divergência;
- **qualquer outro número**, positivo ou negativo → **tem divergência**;
- texto que não é número → tratar como sem divergência (não inventar significado).

O item com divergência **continua o fluxo normalmente** — a marca não o tira de lugar
nenhum. A correção é feita dentro do próprio processo, e quando a quantidade é corrigida a
marca some sozinha, porque o campo é recalculado.

## Tela 1 — Fluxo do Recebimento (`/recebimento/fluxo`)

Escolhe-se uma **EMB** e vê-se onde estão os itens dela.

A régua desta tela é **o Fluxo do ShopFloor**: não é "parecido com", é a mesma tela aplicada
ao Recebimento. Decidido nos smokes de 24/09 ("o fluxo deve ter o mesmo desenho reactflow do
outro fluxo" e, depois, "não tem modo tv, ao clicar no posto não abre um tipo de histórico,
não consigo arrastar o card e acho que o design está um pouco diferente"). Onde houver
diferença de comportamento entre as duas telas, a de lá manda.

- **Canvas React Flow** com a mesma configuração: `fitView`, zoom de 10% a 400%, fundo
  pontilhado, altura `70vh` e a barra de controles própria (enquadrar · − · % · +) no canto
  inferior esquerdo — a mesma barra, compartilhada em `src/shared/ui/fluxo/`.
- **Quatro nós**: Recebimento → Qualidade → Almoxarifado, e o Reprovado na Qualidade como
  **ramo que desce da Qualidade** — desenhado como o ramo da Manutenção do ShopFloor
  (tracejado vinho), com a diferença de que dele **não se volta**. A cadeia fica vinho quando
  a caixa de destino tem item e cinza fina quando está vazia.
- **Cards arrastáveis**, com as linhas-guia de alinhamento de lá. O arranjo é guardado **por
  EMB** no localStorage da máquina (`rec:fluxo:pos:{emb}`) e o botão **Reorganizar** volta
  tudo pra posição padrão — mesmo comportamento do arranjo por OP do ShopFloor.
- **Modo TV** (tela cheia do canvas, Fullscreen API): cabeçalho com a EMB, o relógio ao vivo,
  o **% concluído** e "Sair (Esc)". No ShopFloor o número grande é o progresso dos postos;
  aqui é **itens que já saíram da conferência (Almoxarifado + Reprovado) ÷ itens da EMB** —
  mesmo lugar, mesma leitura, conta adaptada ao módulo.
- Cada nó mostra **quantos itens estão nele agora**, o tempo médio e o mais antigo.
- **Divergência** aparece como contador à parte, não como caixa: no nó onde os itens estão e
  no rodapé com o total da EMB.
- **Clicar num nó abre o painel lateral** (o mesmo `aside` do ShopFloor), com duas divisões:
  - **Itens nesta etapa** — quem está ali **agora**, com há quanto tempo e a marca de
    divergência (acordeon aberto, revela +100 conforme rola);
  - **Histórico da etapa** — quem **passou** por ela e quando, uma linha por passagem, mais
    recente primeiro (acordeon fechado; ao abrir busca 100 do banco e +100 conforme rola).
    "Passou pela etapa" = evento cuja passagem **envolve** aquela caixa: entrou nela,
    trabalhou nela ou saiu dela. É a mesma trilha que alimenta a tela de Registros.
- **Tempo por etapa**: com as horas dos eventos, a tela mostra há quanto tempo cada item
  está parado e qual o tempo médio da EMB em cada etapa. É o que responde "essa EMB está
  travada em quê".

O seletor de EMB segue o padrão do combobox de OP do Fluxo do ShopFloor.

**Recursos do Fluxo do ShopFloor que NÃO vieram** (ficam à espera de decisão, não são
omissão): Apresentação (playlist de OPs/telas), atualização automática a cada 15s, alternância
de linha 90°, filtro de período, painel de Defeitos, gráfico de produção, busca por número de
série e o diálogo de histórico do SN. A barra de progresso dentro do card também não veio: ela
mede "aprovadas ÷ devem passar", e uma caixa do Recebimento não tem meta.

## Tela 2 — Registros (`/recebimento/registros`)

Lista das **passagens de etapa**, uma linha por movimento, e o detalhe das alterações ao
clicar — decisão tomada no refinamento (opção C).

**Colunas:** Data e hora · Colaborador · Item · Descrição · Fornecedor · Fabricante ·
Part number · Etapa.

Exemplo de duas linhas:

```
24/09 09:30  João  CAPJ91  CAPACITOR 100uF  Panasonic  ECA1HM101  Recebimento → Qualidade
24/09 14:06  Ana   CAPJ91  CAPACITOR 100uF  Panasonic  ECA1HM101  Qualidade → Almoxarifado (Aprovado)
```

**Ao clicar numa linha**, abre o que mudou naquele momento, campo a campo:

```
Quantidade recebida:  —  →  490
Volumes:              —  →  2
Divergência:          —  →  -10
```

É esse detalhe que resolve o buraco de hoje: ninguém no Recebimento consegue ver o histórico
do próprio processo.

**Filtros:** EMB · Item · Fornecedor · Etapa · Período (de/até) · Colaborador.

**Exportar CSV** com os mesmos filtros da tela, no padrão do ShopFloor: route handler
próprio, separador `;` com BOM UTF-8, datas em America/Sao_Paulo, e `campoCsv()` para
proteger contra fórmula em planilha. O Recebimento não exporta dados hoje — só etiquetas e
fotos.

## De onde vem o dado

**Duas fontes, juntas:** a trilha `logs` (entidade `'processo'`) e a linha do processo em
`processos_recebimento`.

O log já guarda o necessário:
- `created_at` — a hora do evento
- `usuario_nome` — o colaborador
- `acao` — `criar`, `alterar_campo`, `mudar_status`
- `descricao` — inclui a seção salva ("Processo #123 — seção recebimento salva")
- `dados` — o diff campo a campo (`{campo, de, para}`)

**Como identificar a etapa de um evento:** pelo **grupo dos campos alterados**. Cada campo
tem um grupo em `configuracao_campos` (comercial, material, recebimento, qualidade). Um
evento cujo diff toca algum campo do grupo `recebimento` é "salvou Recebimento". Esse
caminho funciona **para o histórico antigo também**, e é preferível a interpretar o texto da
descrição.

**Ponto a verificar na implementação:** salvar uma seção sem alterar nada pode gerar um log
com diff vazio. Nesse caso, e só nesse, usar a seção nomeada na descrição. O implementador
deve confirmar o comportamento real antes de escolher.

As colunas Item, Descrição, Fornecedor, Fabricante e Part number vêm do **processo**, não do
log — são o "quem é esse item", e devem refletir o estado atual da linha.

**Agregação no banco.** As duas telas devem ser alimentadas por funções SQL (migração
**0124**), no padrão das `sf_*` do ShopFloor, e não por consultas montadas no cliente. Dois
motivos: a derivação da etapa é regra de negócio e deve viver num lugar só; e `logs` é uma
tabela global que cresce — filtrar e agrupar no banco evita trazer milhares de linhas para
somar no navegador.

## Limites honestos

- **Processo sem histórico.** Item criado antes de o módulo registrar log, ou cujo log não
  permita derivar a etapa, aparece **na caixa onde está hoje** (pelo status), **sem tempo**.
  A tela deve mostrar "—" no tempo, não zero, nem inventar.
- **Mesmo item duas vezes na mesma EMB.** Como a identidade na tela é o Item (e não o número
  do processo, que é único), duas linhas do mesmo código aparecem iguais. Mostrar a
  quantidade ao lado e o número do processo em letra menor resolve a ambiguidade sem poluir.
- **O tempo medido é do sistema, não do galpão.** Se a pessoa confere o material de manhã e
  só registra à tarde, o tempo da etapa reflete o registro. Vale dizer isso a quem for usar
  o número para cobrar prazo.
- **Reabrir um processo** existe (botão Reabrir, com permissão). Um item finalizado que é
  reaberto volta para a Qualidade; o Fluxo deve refletir o estado atual, e o Registros deve
  mostrar a reabertura como um evento — não apagar o anterior.

## Permissões e menu

- As duas telas exigem **`recebimento: visualizar`**, como o resto do módulo. **Nenhuma
  permissão nova.** A exportação reusa a mesma permissão, como o ShopFloor faz.
- O gate se repete em toda server action e no route handler da exportação (403), seguindo
  `shopfloor/registros/exportar/route.ts`.
- No menu lateral, dentro do bloco Recebimento: **Fluxo** e **Registros**.

## Impacto técnico

**Migrações 0124 e 0125** — funções de leitura, `security definer` com `search_path = public`,
corpo em `$func$`, `revoke`/`grant` explícitos e `notify pgrst, 'reload schema'`:
- 0124: etapas e contagens por EMB (alimenta o Fluxo), os itens de uma caixa, e a lista de
  eventos com filtros e paginação (alimenta o Registros)
- 0125: o histórico de uma etapa, paginado (alimenta o painel do nó do Fluxo) — precisou da
  etapa de ORIGEM do evento, que a 0124 não calculava

**Arquivos novos**, seguindo a arquitetura do projeto (`domain` / `application` / `infra`):
- `src/modules/recebimento/domain/` — as regras de etapa e de divergência, puras e testáveis
  sem banco
- `src/modules/recebimento/infra/` — as chamadas às funções novas
- `src/app/(app)/recebimento/fluxo/` e `src/app/(app)/recebimento/registros/` (+ a rota de
  exportação)

O card do canvas é **próprio do Recebimento** (`fluxo/fluxo-node.tsx`), com a mesma anatomia
do card do ShopFloor: o de lá carrega dados que aqui não existem (WIP, "devem passar",
aprovados de primeira, barra de %).

O que as duas telas têm igual virou **código compartilhado** em `src/shared/ui/fluxo/`, movido
sem mudar comportamento: `ancoras-aresta.ts` (a geometria das arestas flutuantes, que é o que
mantém o traçado certo depois de arrastar), `helper-lines.tsx` (as guias de alinhamento) e
`controles-canvas.tsx` (a barra de zoom). A classe `.fluxo-canvas` do `globals.css` já era
compartilhada — é ela que esconde os pontos de conexão e deixa o canvas ocupar a tela no
Modo TV. O Fluxo do ShopFloor passou a importar desses três arquivos e **nada mais mudou lá**.

**Sem mudança** nas telas que já existem, no grid de Processos, nas importações ou em
qualquer regra de gravação. As duas telas são **somente leitura**.

## Testes

Domínio (sem banco):
1. Divergência: vazio → não; `0` → não; `-10` e `10` → sim; texto não numérico → não.
2. Etapa por resultado: Reprovado → saída lateral; Aprovado, Aprovado sob concessão e um
   valor novo qualquer → Almoxarifado.
3. Derivação da etapa pelo grupo dos campos do diff, incluindo diff que toca dois grupos.
4. Processo sem histórico cai na caixa do status atual, com tempo "—".

Banco (Postgres descartável, no modelo de `supabase/tests/`):
5. Contagem por etapa numa EMB com itens em todas as caixas, incluindo reprovado e
   divergente.
6. Os filtros do Registros (EMB, item, fornecedor, etapa, período, colaborador), combinados.
7. Reabertura: o item volta para a Qualidade e o evento anterior continua na lista.
8. Histórico de cada etapa: o que envolve aquela caixa (entrou, trabalhou, saiu), a paginação
   e a etapa de origem de cada tipo de evento.

Tela:
9. A exportação usa **os mesmos filtros** da tela e escapa fórmula de planilha.
10. Sem `recebimento: visualizar`, as duas telas e a exportação recusam.
11. O Fluxo: os quatro nós na posição padrão, a cadeia e o ramo ligados nos nós certos, cards
    arrastáveis, Modo TV e Reorganizar, e o painel do nó (resumo + itens de agora + histórico
    em acordeon que só busca ao abrir).

O canvas do Fluxo é testado com um **dublê do React Flow**: o canvas de verdade só desenha
depois de medir o container, e no jsdom todo elemento tem 0×0. O dublê renderiza cada nó com
o `nodeTypes` de verdade (o card é exercitado como está em produção), expõe as arestas e o
clique chama o `onNodeClick`. Fica fora do teste o que só o navegador mostra: o traçado das
arestas, o arraste em si, o zoom e a tela cheia de verdade.

## Fora de escopo

- Qualquer alteração de dado: as telas são de leitura.
- Gráficos e indicadores (não foi pedido; o card é Fluxo e Registros).
- Histórico dentro da tela de detalhe do processo — é uma boa ideia que apareceu no
  levantamento, mas não faz parte deste card.
- Permissão nova para exportar.

## Riscos

- **A qualidade do tempo depende do hábito de registrar.** Se o pessoal salva tudo no fim do
  dia, o Fluxo vai mostrar o galpão parado e depois um pico. O número não estará errado — o
  registro é que não acompanha o trabalho. Vale olhar isso nos primeiros dias antes de tirar
  conclusão sobre gargalo.
- **`logs` é global e cresce.** Se a consulta do Registros ficar lenta com o tempo, o caminho
  é índice, não mudança de tela. Medir antes de otimizar.
- **Processos antigos sem histórico** podem ser muitos, e aí o Fluxo mostra caixas cheias sem
  tempo nenhum. Vale conferir o tamanho disso no Dev antes de prometer a tela de tempo.
