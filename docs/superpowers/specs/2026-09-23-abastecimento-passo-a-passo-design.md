# Abastecimento passo a passo — design

**Card:** Abastecimento do setup — Sprint 23/09/2026 [4h]
**Data:** 23/09/2026
**Tela:** `/setup/operar/abastecimento`

## Problema

A tela de Abastecimento mostra os 6 campos de bipe empilhados (Colaborador, Posição,
Feeder, Rolo que sai, Rolo que entra, SN Inicial). No tablet do chão de fábrica isso
**não cabe na tela**: o operador precisa rolar a página no meio de uma troca, com o leitor
de código na mão.

Compactar a tela atual (duas colunas, campos mais baixos, quadro recolhível) foi proposto
ao time e **recusado**. A decisão é resolver com um **modal passo a passo**, que nunca rola
porque mostra um campo por vez.

## Objetivo

Registrar uma troca de rolo no tablet **sem nenhum scroll**, mantendo exatamente o mesmo
fluxo, os mesmos campos e as mesmas validações de hoje.

### Critérios de sucesso

1. Nenhuma etapa da troca exige rolar a tela no tablet (retrato ou paisagem), **inclusive
   com o teclado virtual aberto**.
2. Uma troca completa continua sendo feita **só com o leitor**, sem tocar na tela: cada
   bipe termina em Enter e avança sozinho.
3. O registro gravado em `st_trocas` é idêntico ao de hoje para os mesmos dados.

## O que NÃO muda

- Os **6 campos**, na mesma ordem.
- A função do banco: `st_trocar_rolo(p_setup_id, p_posicao, p_feeder, p_rolo_saida,
  p_rolo_entrada, p_sn_inicial, p_colaborador)` e suas 5 verificações.
- A mecânica de bipe: `Enter` avança (`preventDefault` + foco no próximo), `onFocus` dá
  `select()` para o leitor sobrescrever em vez de concatenar, trava contra bipe duplo
  (`enviandoRef`), campo vazio no envio não envia.
- A **seleção do setup** no topo (OP → Processo → Linha → Bloco → Máquina → Face), que
  continua fora do modal, na página.
- O quadro **"Últimas trocas"** (as 10 últimas do setup) continua na página.
- **Nenhuma migração, nenhuma ação de servidor nova, nenhuma consulta nova.** O card é
  reorganização do formulário que já existe.

## Desenho

### 1. Abertura e fechamento do modal

O modal abre sozinho **uma vez por setup localizado** — no mesmo momento em que hoje os
campos de bipe aparecem. Depois de fechado, só reabre por ação do operador (botão grande
**"Abastecer"** na página) ou quando ele localizar outro setup; nunca reabre sozinho.
Fechar descarta o que estava digitado, como hoje ao trocar de setup.

Fechar (Esc ou botão de fechar) é o caminho para chegar à seleção e ao quadro de Últimas
trocas, que continuam na página, atrás do modal.

Se o setup estiver **em montagem**, o modal não abre — continua valendo o aviso âmbar
atual com o link para Montar Setup.

### 2. Os seis passos

Um campo por vez, contador no topo: **1/6 … 6/6**.

| Passo | Campo | Observação |
|---|---|---|
| 1/6 | Colaborador | **Confirmado em toda troca**, já preenchido com o último usado |
| 2/6 | Posição (SMD) / Posto (PTH) | Rótulo por processo, como hoje |
| 3/6 | Feeder (SMD) / Locação (PTH) | Rótulo por processo, como hoje |
| 4/6 | Rolo que sai | |
| 5/6 | Rolo que entra | |
| 6/6 | SN Inicial | Enter aqui envia |

**Mudança de comportamento deliberada:** hoje o Colaborador é preenchido uma vez e
**some** das trocas seguintes. Passa a ser **confirmado em toda troca**: o passo 1/6 sempre
aparece, já preenchido com o último crachá usado, e `Enter` confirma. Bipar o leitor
sobrescreve (o campo dá `select()` ao ganhar foco), e dá para digitar por cima.

Por que assim: o crachá é o **único** dos seis campos que pode ser digitado à mão — todos os
outros vêm do leitor. Pedir vazio em toda troca abriria o teclado virtual uma vez por
troca, que é justamente o atrito que este card quer eliminar. Pré-preenchido, a troca
continua passando pelo campo (ninguém lança no nome de quem já saiu do turno) sem custo de
digitação quando é a mesma pessoa a manhã toda.

Navegação: `Enter` avança; botão **Voltar** volta um passo mantendo o que foi digitado;
avançar exige o campo preenchido (o passo não passa em branco).

### 3. O rastro dos campos já preenchidos

Acima do campo atual ficam os campos já respondidos, **em letra menor**, um por linha,
acumulando conforme ele avança. Rótulo em cinza com **dois-pontos** e o valor colado em
seguida ("Colaborador: Matheus"), sem vão entre os dois — ajuste pedido no smoke de 23/09:

```
┌─ Abastecimento ──────────────── 4/6 ─┐
│  Colaborador: 1234                    │
│  Posição: L1-A-12                     │
│  Feeder: FD-0034                      │
│                                       │
│  Rolo que sai                         │
│  [_______________________]            │
└───────────────────────────────────────┘
```

É só o que ele mesmo bipou nesta troca — **não há consulta a lugar nenhum**. Serve para ele
conferir o que já informou sem precisar voltar.

O rastro tem no máximo 5 linhas (os 5 campos anteriores ao último passo), uma linha curta
cada. Junto com o contador e o campo atual, é o conteúdo inteiro do modal.

### 4. Resultado

O resultado aparece **dentro do modal**, no mesmo padrão visual de hoje (`PainelResultado`):

- **Aprovado:** chips com Posição, Feeder, Saiu, Entrou, SN Inicial. O modal volta ao
  **passo 1/6**, com o Colaborador já preenchido com o último usado e os outros cinco
  campos vazios, pronto para a próxima troca.
- **Reprovado:** motivos listados, `tocarErro()`, os valores digitados são mantidos e o
  modal volta ao **passo 2/6 (Posição)**. A tela de hoje volta no Rolo que sai, mas o smoke
  de 23/09 mostrou que a reprova costuma ser de posição/feeder ("o feeder F03 não está na
  posição 01") — voltando na posição o operador passa de novo pelos quatro campos que a
  verificação usa, e não só pelos rolos.
- **Falha de rede:** mesma mensagem de hoje (`FALHA_CONEXAO_TROCA` — "Confira em Últimas
  trocas se a troca foi registrada antes de reenviar") e o modal fecha, para o operador
  conseguir olhar o quadro atrás.

Em qualquer um dos três casos o quadro "Últimas trocas" da página é recarregado, como hoje.

### 5. Teclado virtual

O tablet é um mini PC Windows com teclado de toque, e o projeto já lida com isso: o
`teclado-provider` rola o campo focado para o centro ao receber foco, e o `Dialog` usa
`--kb-inset`. Como o modal tem **um campo só**, o campo precisa ficar acima da área do
teclado sem depender desse scroll. Isso é requisito de layout, não detalhe: se o teclado
cobrir o campo, o problema do scroll volta por outra porta.

Se o rastro não couber com o teclado aberto, **quem cede é o rastro** (ele encolhe ou
mostra só os últimos), nunca o campo atual.

## Fora de escopo

- Mudar a seleção do setup, o quadro de Últimas trocas ou as Consultas.
- Mudar qualquer regra de validação (todas continuam em `st_trocar_rolo`).
- Mostrar o componente montado na posição, histórico do rolo, quantidade ou SN final.
- Rascunho salvo: fechar o modal descarta o que foi digitado.

## Impacto técnico

**Arquivos:**
- `src/app/(app)/setup/operar/abastecimento/abastecimento.tsx` — hoje 323 linhas com a
  tela inteira. O bloco de bipes sai daqui e vira o modal; a página fica com seleção,
  cabeçalho, botão "Abastecer" e o quadro de Últimas trocas.
- Arquivo novo `src/app/(app)/setup/operar/abastecimento/modal-abastecimento.tsx` — o
  passo a passo. Separado porque o arquivo atual já está grande e as duas coisas têm
  responsabilidades diferentes (a página escolhe o setup; o modal registra a troca).
- Sem mudança em `setup-actions.ts`, `setup-repository.ts` ou no banco.

**Reaproveitamento:** `Dialog` (`src/components/ui/dialog.tsx`), `PainelResultado`
(`src/components/ui/painel-resultado.tsx`), `tocarErro` (`src/shared/lib/som-erro.ts`).

**Stepper:** existe um contador de etapas no projeto, mas é local e não exportado
(`src/app/(app)/recebimento/importar/wizard-importacao.tsx`, componente `Stepper`). Como
aqui o contador é só "N/6" com o nome do campo, é mais simples escrever o desse modal do
que extrair e generalizar aquele. Não criar componente compartilhado agora.

## Testes

Não existe teste de UI para o Abastecimento hoje; os testes de `sf-alertas` servem de
modelo (jsdom + `@testing-library/react`).

1. Sequência completa: bipar os 6 campos com Enter chama `trocarRolo` com exatamente os
   valores bipados, na ordem certa.
2. Contador: começa em 1/6 e chega a 6/6; Voltar volta um passo sem perder o valor.
3. Rastro: no passo 4/6 estão visíveis os três valores já bipados, e nenhum a mais.
4. Depois de uma troca aprovada o modal volta ao passo 1/6 com o Colaborador preenchido
   com o último usado, e os outros cinco campos vazios.
5. No passo 1/6 pré-preenchido, `Enter` confirma e avança sem alterar o valor; bipar outro
   crachá substitui o valor inteiro (não concatena).
6. Reprovado volta ao passo 2/6 mantendo os valores e toca o som de erro.

## Riscos

- **Mais toques por troca.** Seis passos com um campo cada só é mais rápido que a tela de
  hoje se o Enter do leitor avançar sem falha. Todo campo que for **digitado à mão** em vez
  de bipado abre e fecha o teclado virtual uma vez por passo, e nesse caso o passo a passo
  pode ficar mais lento do que a tela atual. Precisa ser verificado no smoke, com o leitor
  real e no tablet real, antes do merge.
- **Colaborador a cada troca** é um Enter a mais por troca. Foi decisão explícita e o
  pré-preenchimento reduz o custo ao mínimo, mas ainda é um passo que não existe hoje —
  vale combinar com quem opera antes de subir.
- **Sem rascunho:** fechar o modal no meio perde o que foi digitado. Aceitável porque a
  troca é curta, mas é diferente do NQA, que salva progresso.
