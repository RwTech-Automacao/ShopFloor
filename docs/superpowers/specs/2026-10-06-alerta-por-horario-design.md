# Alerta por horário: medir de bloco em bloco, dentro do turno

**Data:** 06/10/2026
**Branch:** `feat/alertas-por-horario`

## O problema

A regra de **taxa de aprovação** (0113) mede uma janela **corrediça**: "os últimos 60 minutos",
contados do instante em que o cron roda. Isso traz três incômodos:

1. **O número não é conferível.** "88% nos últimos 60 minutos às 08:23" não dá pra comparar com
   nada depois — nem com o Dashboard, nem com a mensagem da semana passada.
2. **A janela atravessa a parada.** Às 13:00, "os últimos 60 minutos" são quase todos almoço: 4
   peças e uma taxa sem significado.
3. **A insistência desgarra do relógio.** `lembrete_min = 60` conta 60 minutos **desde o último
   envio**: primeiro aviso às 07:12 → lembrete às 08:12 → 09:12. Vai andando pelo dia.

## O que muda

Uma **janela nova**. O gestor cadastra os **intervalos** do turno e o **passo**:

```
Intervalos: 07:00–12:00 · 13:30–17:30          Passo: 01:00

07:00─08:00  08:00─09:00  09:00─10:00  10:00─11:00  11:00─12:00  [parada]  13:30─14:30  14:30─15:30 …
      ↑            ↑                                      ↑                      ↑
   avalia e     avalia e                                avalia                 avalia
   avisa às     avisa às                                às 12:00               às 14:30
     08:00        09:00
```

Os blocos **ladrilham a partir do início de cada intervalo**, não do relógio cheio — por isso o
turno da tarde mede 13:30–14:30, e não 13:30–14:00. Quando um bloco fecha, ele é medido; se ficou
abaixo da meta, avisa.

**Quando a mensagem chega:** o cron roda de 5 em 5 minutos, então ela sai no primeiro tique depois
do bloco fechar — entre 08:00 e 08:05. Não vale apertar o cron por causa de 5 minutos num
relatório de hora em hora.

## As decisões, e por quê

### Janela nova, não tipo de regra novo

O eixo **tipo** responde *o que* é medido (`aprovacao` · `tempo` · `defeito`); o eixo **janela**
responde *em que trecho* (`tempo` · `bipes` · `op`). Bloco de turno é um **trecho**, e o que se mede
continua sendo a taxa de aprovação com a mesma meta.

Virar tipo de regra duplicaria `taxa_minima`, `minimo_bipes` e as mensagens inteiras. Como janela,
a máquina de abrir/insistir/normalizar, a fila, o botão "Resolvido", o Telegram e o Discord **não
mudam uma linha**.

### Fala quando está abaixo, insiste a cada bloco, avisa quando volta

Não é um relatório de hora em hora com o número sempre: **cala enquanto está bom**. O comportamento
é o que a 0113 já faz, só com o relógio no lugar dos minutos decorridos:

| evento | mensagem |
|---|---|
| bloco abaixo da meta, sem ocorrência aberta | `alerta` — abre a ocorrência |
| bloco seguinte ainda abaixo | `lembrete` — insiste, **um por bloco** |
| primeiro bloco que volta à meta | `normalizou` — fecha a ocorrência |

**Sem folga de histerese** (decisão do usuário): qualquer cruzada da meta avisa. Com meta de 95%,
94,9% → 95,1% → 94,8% em três blocos manda três mensagens. Foi pesado contra o barulho e escolhido
assim porque a insistência já manda uma mensagem por bloco de qualquer jeito — a folga protegia
pouco e acrescentava um campo pra entender. A saída pro posto de volume baixo é a própria meta, que
é configurável por regra.

### O bloco reportado, não os minutos decorridos

A insistência **não** usa `lembrete_min`. A ocorrência ganha uma coluna `bloco_reportado` (o
instante de início do último bloco já avisado), e a mensagem sai quando o bloco que está sendo
avaliado é **mais novo** que ela.

Três coisas saem de graça:

- **Não desgarra.** O aviso prega no fechamento do bloco, sempre.
- **É idempotente.** O cron roda de 5 em 5 minutos e vai reavaliar o mesmo bloco fechado várias
  vezes; da segunda em diante, não é mais novo que `bloco_reportado` e nada é enviado.
- **O bloco sem peça não conta.** Ele não mexe no `bloco_reportado`, então o bloco seguinte ainda
  é "mais novo" e avisa normalmente.

### Só o bloco que fechou HOJE

O candidato é o bloco mais recente que fechou **hoje** (em São Paulo). Antes do primeiro bloco do
dia fechar, não há nada a avaliar.

Isto resolve dois casos de uma vez. **Segunda, 06:10:** sem essa regra, o bloco mais recente que
fechou é o de sexta às 17:30 — uma regra criada no fim de semana abriria uma ocorrência sobre
sexta. **Cron parado das 08:00 às 11:00:** às 11:05 o candidato é 10:00–11:00; os blocos de
08:00–09:00 e 09:00–10:00 **não são recuperados**, e isso é de propósito — alerta de bloco de três
horas atrás não serve pra nada, e o bloco atual conta a verdade sobre agora.

### Dia parado não precisa de calendário — e não deve ter

`blocoCandidato` **não** sabe se hoje é dia de expediente: num domingo às 18:00 ela devolve o
último bloco daquele domingo. Parece um buraco, e **não é**: o bloco de domingo tem zero bipe, e o
mínimo de bipes já faz a regra não decidir nada
([0113_alertas.sql:454](../../../supabase/migrations/0113_alertas.sql) — *"Abaixo do mínimo de bipes
a regra não decide NADA (nem abre, nem normaliza)"*). Nenhum alerta nasce, nada normaliza, e o
`bloco_reportado` não se move — então o primeiro bloco de segunda ainda fala.

⚠️ **Não acrescente uma checagem de seg–sex aqui.** Ela seria pior que a ausência: no sábado de hora
extra — que já tem procedimento próprio de ligar o banco — tem gente trabalhando, e a regra **deve**
avisar. Quem decide se o dia conta é a produção, não o calendário.

### Os intervalos são de cada regra

Não há cadastro reaproveitável de turnos. A regra já escolhe os postos; os intervalos ficam com ela.

O preço aparece no dia em que o turno muda: com 3 regras, são 3 edições, e esquecer uma deixa aquela
regra medindo fora do turno **em silêncio**. Foi aceito contra o preço do caminho oposto — um
"Turno administrativo" compartilhado que o gestor edita pensando num posto e **muda em três sem
perceber**. Com o número de regras que o ShopFloor tem hoje, consertar 3 vezes é mais barato que
manter uma tela nova. Se um dia passar de ~10 regras, a conta inverte.

### A sobra é medida, e o formulário avisa

Intervalo 13:30–17:30 com passo de 3 horas dá um bloco cheio (13:30–16:30) e uma **sobra**
(16:30–17:30). A sobra **é medida** e a mensagem diz a faixa real ("das 16:30 às 17:30"), então o
número menor não engana ninguém.

Ignorar a sobra deixaria a **última hora do dia nunca conferida** — justo quando o pessoal está
cansado e correndo pra fechar o turno.

Sobra curta se resolve sozinha: 07:00–12:00 com passo de 1h30 sobra 11:30–12:00, meia hora, que num
posto de 10 peças/hora são 5 peças — abaixo do mínimo de bipes, o sistema **pula em silêncio**
(comportamento que já existe). A sobra curta não gera barulho; a sobra grande é conferida.

**O formulário avisa** quando a configuração deixa sobra, com a faixa calculada:

> O passo não fecha com o intervalo: o último bloco de 13:30–17:30 vai de **16:30 às 17:30** (1 h em
> vez de 3 h). Ele será medido e avisado com a faixa real.

É aviso, não erro: a configuração é válida e o gestor pode querer exatamente isso.

### A ocorrência fica aberta de um dia pro outro

Sexta, 17:30: o bloco 16:30–17:30 deu 88% e o alerta sai. Ninguém aperta "Resolvido" — todo mundo
foi embora. Às 19:00 o RDS desliga e nada roda até segunda 05:45. Segunda, 08:00, o primeiro bloco
dá 97% e chega o "voltou ao normal" — sobre um problema de sexta.

Fica assim de propósito. Durante o fim de semana o alerta ficou aberto com o botão, que é a verdade:
ninguém respondeu. E a ocorrência mostra "aberta desde sexta 17:30", que é informação boa.

**Fechar sozinho no fim do turno briga com o último bloco:** ele fecha às 17:30, que é exatamente o
fim do intervalo. O alerta sairia e a ocorrência se fecharia no mesmo instante — mensagem com botão
que já não vale, nenhum "voltou ao normal", e segunda abrindo ocorrência nova como se nada tivesse
acontecido.

### Turno que passa da meia-noite é recusado

A validação recusa `fim <= inicio`, com erro claro:

> O horário final precisa ser maior que o inicial. Turno que passa da meia-noite não é suportado.

Não é só o custo de programar o atravessamento de dia: **a infraestrutura não comporta turno da
noite**. O RDS fica ligado 06:00–19:00 em dias úteis
([plano-economia-aws.md:304](../../operacao/plano-economia-aws.md), confirmado em 15/09: produção
07:00–17:30). Num turno 22:00–06:00, os blocos da noite não teriam quem os avaliasse.

### Horário é São Paulo, sempre

Os intervalos são **hora do dia** (`time`), e os blocos são calculados no fuso
`America/Sao_Paulo` — o mesmo `FUSO` que `domain/mensagens.ts` já fixa, e pelo mesmo motivo: o
servidor roda em UTC, e um bloco calculado no fuso do processo sairia 3 horas deslocado do relógio
da fábrica.

No banco isso significa nunca derivar o início do dia de `now()::date` direto, e sim de
`(now() at time zone 'America/Sao_Paulo')::date`, voltando pra `timestamptz` com
`at time zone 'America/Sao_Paulo'`.

## Estrutura

| camada | o quê |
|---|---|
| **Domínio** | `blocoCandidato(intervalos, passoMin, agora)` — função pura: qual bloco fechou por último hoje? Devolve `{ inicio, fim }` ou nulo. É aqui que a sobra e o "só hoje" são decididos, e é o que os testes atacam. |
| **Domínio** | `validarIntervalos(lista)` — fim > início, sem sobreposição, pelo menos 1, passo entre 15 min e o tamanho do menor intervalo |
| **Domínio** | `textoJanela` ganha o caso `intervalos`: "das 07:00 às 08:00" |
| **Banco** | `alerta_regra_intervalos` (regra_id, inicio time, fim time) — tabela filha, pros `check` do banco segurarem horário invertido; `alerta_ocorrencias.bloco_reportado timestamptz` |
| **Banco** | `alerta_taxas` ganha o ramo `intervalos`: conta os bipes entre o início e o fim do bloco |
| **Banco** | `alerta_avaliar` compara o bloco com `bloco_reportado` em vez de olhar `lembrete_min` |
| **Tela** | mais um rádio na Janela + o editor de intervalos (lista de horário início/fim, com adicionar e remover) + o campo do passo + o aviso da sobra |

**O passo reaproveita `janela_valor`** (minutos), que já existe e já é `int`. `janela_tipo` passa a
aceitar `'intervalos'`.

**Mínimo do passo: 15 minutos.** Abaixo disso o bloco quase nunca alcança o mínimo de bipes, e o
cron de 5 minutos não acompanha. **Máximo:** o tamanho do menor intervalo cadastrado — passo maior
que o intervalo não produziria bloco nenhum.

Por consequência, **cada intervalo precisa ter no mínimo 15 minutos**, e a validação recusa isso
direto, no intervalo. Sem essa recusa, um intervalo de 10 minutos deixaria o passo sem nenhum valor
válido (mínimo 15, máximo 10) e o formulário recusaria tudo sem dizer qual campo está errado.

## Comportamento, ponta a ponta

| | |
|---|---|
| **Bloco abaixo da meta** | abre a ocorrência e manda `alerta` |
| **Bloco seguinte ainda abaixo** | manda `lembrete` — um por bloco, no fechamento |
| **Bloco que volta à meta** | manda `normalizou` e fecha a ocorrência |
| **Bloco sem bipe nenhum** | não decide nada (nem abre, nem normaliza); `bloco_reportado` não muda |
| **Bloco abaixo do mínimo de bipes** | igual ao de cima — é o `continue` que a 0113 já faz |
| **Fora dos intervalos** (almoço, noite, fim de semana) | nada é avaliado |
| **Cron reavaliando o mesmo bloco** | nada é enviado (não é mais novo que `bloco_reportado`) |
| **Blocos perdidos** (cron parado) | não são recuperados |
| **Regra sem intervalo nenhum** | a validação recusa |

## Como se prova que funciona

- **`blocoCandidato`:** 09:30 com 07:00–12:00/1h → 08:00–09:00. 07:30 → 07:00 ainda não fechou,
  nulo. 13:00 (almoço) → o último que fechou hoje é 11:00–12:00. 06:10 de segunda → nulo (nada
  fechou **hoje**). Sobra: 13:30–17:30/3h às 17:35 → 16:30–17:30. Dois intervalos: às 14:40 →
  13:30–14:30, não um bloco do turno da manhã.
- **`validarIntervalos`:** 22:00–06:00 recusa. 07:00–12:00 com 11:00–15:00 recusa (sobreposição).
  Passo de 10 min recusa. Passo de 6 h com intervalo de 5 h recusa. Lista vazia recusa.
- **Fuso:** `blocoCandidato` recebe o instante e devolve blocos em São Paulo mesmo com o processo
  em UTC — o teste roda com `TZ=UTC` e confere a fronteira das 00:00 e das 03:00.
- **`alerta_avaliar`:** bloco abaixo abre e grava `bloco_reportado`; a mesma avaliação de novo não
  enfileira nada; o bloco seguinte abaixo enfileira `lembrete`; o que volta enfileira `normalizou`;
  bloco sem bipe não mexe no `bloco_reportado` e o seguinte ainda avisa.
- **Formulário:** o aviso da sobra aparece com a faixa certa; some quando o passo fecha; os
  intervalos salvos voltam na edição.

## Fora de escopo, e por quê

**A janela `intervalos` vale só pro tipo `aprovacao`.** Conceitualmente serviria pro tempo médio e
pro defeito repetido, mas o pedido é da taxa de aprovação e nenhum dos outros dois foi discutido
nesses termos. `JANELAS` em `regra-form.tsx` já é o lugar onde isso se liga, quando for pedido.

**Nenhum cadastro de turnos.** Ver a decisão acima.

**O aviso de usar duas regras no mesmo posto.** O gestor pode criar uma regra `aprovacao`/`tempo`
corrediça **e** uma `aprovacao`/`intervalos` nos mesmos postos: as duas medem a mesma coisa e
avisariam em dobro. Vale um aviso no formulário, mas depende de consultar as outras regras ativas
enquanto se edita — é trabalho próprio e não entra aqui. Fica anotado.

**O `lembrete_min` continua existindo** pros outros tipos de janela. Na janela `intervalos` ele é
ignorado, e o formulário esconde o campo em vez de mostrar um campo que não faz nada.
