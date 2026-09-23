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
fluxo e as mesmas validações de hoje, e aproveitando o espaço livre para mostrar duas
informações que o operador não tem hoje: **qual componente está naquela posição** e
**onde o rolo bipado já apareceu antes**.

### Critérios de sucesso

1. Nenhuma etapa da troca exige rolar a tela no tablet (retrato ou paisagem).
2. Uma troca completa continua sendo feita **só com o leitor**, sem tocar na tela: cada
   bipe termina em Enter e avança sozinho.
3. O registro gravado em `st_trocas` é idêntico ao de hoje para os mesmos dados.

## O que NÃO muda

- Os **6 campos**, na mesma ordem.
- A função do banco: `st_trocar_rolo(p_setup_id, p_posicao, p_feeder, p_rolo_saida,
  p_rolo_entrada, p_sn_inicial, p_colaborador)` e suas 5 verificações.
- A mecânica de bipe: `Enter` avança (`preventDefault` + foco no próximo), `onFocus` dá
  `select()` para o leitor sobrescrever em vez de concatenar, trava contra bipe duplo
  (`enviandoRef`), campo vazio no envio foca o primeiro vazio e não envia.
- A **seleção do setup** no topo (OP → Processo → Linha → Bloco → Máquina → Face), que
  continua fora do modal, na página.
- O quadro **"Últimas trocas"** (as 10 últimas do setup) continua na página.
- **Nenhuma migração.** As duas informações novas vêm de ações que já existem.

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
| 1/6 | Colaborador | **Pedido em toda troca**, sempre vazio |
| 2/6 | Posição (SMD) / Posto (PTH) | Rótulo por processo, como hoje |
| 3/6 | Feeder (SMD) / Locação (PTH) | Rótulo por processo, como hoje |
| 4/6 | Rolo que sai | |
| 5/6 | Rolo que entra | |
| 6/6 | SN Inicial | Enter aqui envia |

**Mudança de comportamento deliberada:** hoje o Colaborador é preenchido uma vez e
**persiste** entre as trocas. Passa a ser pedido em toda troca. Custo: um bipe de crachá a
mais por troca. Ganho: nenhuma troca fica registrada no nome de quem já saiu do turno.

Navegação: `Enter` avança; botão **Voltar** volta um passo mantendo o que foi digitado;
avançar exige o campo preenchido (o passo não passa em branco).

### 3. Contexto sempre visível

A partir do passo 3 concluído, o topo do modal mostra, fixos e juntos:

```
Posição L1-A-12 · Feeder FD-0034 · Componente CAPJ91
```

O **componente** é informação nova na tela: hoje o Abastecimento não mostra componente
nenhum. Ele sai dos itens do setup, já carregados por `carregarSetupAction(setupId)`
(`{ setup, itens: ItemSetup[] }`, onde `ItemSetup` tem `posicao`, `feeder`, `componente`,
`rolo`). A busca é feita no cliente, por `posicao` + `feeder`, sem ida ao servidor.

Se a combinação posição+feeder não existir no setup, o modal mostra
**"Posição não cadastrada neste setup"** no lugar do componente, mas **não bloqueia**: quem
decide continua sendo `st_trocar_rolo`, que já devolve o erro correto com os motivos.

### 4. Histórico do rolo bipado

Ao concluir o passo 5 (Rolo que entra), o modal mostra as **5 últimas trocas** em que aquele
rolo apareceu — em qualquer setup, entrando ou saindo — com data/hora, OP, posição e
resultado.

Fonte: `consultarTrocas({ rolo }, 0, 5)`, que já existe e já procura em `rolo_saida` **e**
`rolo_entrada` (`setup-repository.ts`, filtro `f.rolo`). Sem consulta nova, sem migração.

**Limite honesto desta informação:** o histórico cobre **trocas**, não a montagem inicial.
Um rolo que foi montado em Montar Setup e nunca trocado não aparece. Ele é informativo,
não uma trava — as travas de rolo repetido já existem no banco (`ROLO_JA_MONTADO` na
inclusão, e a verificação de rolo que entra já montado em outra posição na troca).
Sem histórico, o modal mostra "Primeira vez que este rolo aparece".

A consulta é disparada em segundo plano e **nunca atrasa o bipe**: se demorar ou falhar, o
operador segue para o passo 6 normalmente e o bloco some.

### 5. Resultado

O resultado aparece **dentro do modal**, no mesmo padrão visual de hoje (`PainelResultado`):

- **Aprovado:** chips com Posição, Feeder, Saiu, Entrou, SN Inicial. O modal volta ao
  **passo 1/6** com todos os campos vazios, pronto para a próxima troca.
- **Reprovado:** motivos listados, `tocarErro()`, os valores digitados são mantidos e o
  modal volta ao **passo 4/6 (Rolo que sai)**, como a tela faz hoje.
- **Falha de rede:** mesma mensagem de hoje (`FALHA_CONEXAO_TROCA` — "Confira em Últimas
  trocas se a troca foi registrada antes de reenviar") e o modal fecha, para o operador
  conseguir olhar o quadro atrás.

Em qualquer um dos três casos o quadro "Últimas trocas" da página é recarregado, como hoje.

### 6. Teclado virtual

O tablet é um mini PC Windows com teclado de toque, e o projeto já lida com isso: o
`teclado-provider` rola o campo focado para o centro ao receber foco, e o `Dialog` usa
`--kb-inset`. Como o modal tem **um campo só**, o campo precisa ficar acima da área do
teclado sem depender desse scroll. Isso é requisito de layout, não detalhe: se o teclado
cobrir o campo, o problema do scroll volta por outra porta.

## Fora de escopo

- Mudar a seleção do setup, o quadro de Últimas trocas ou as Consultas.
- Mudar qualquer regra de validação (todas continuam em `st_trocar_rolo`).
- Campo de componente editável, quantidade, SN final.
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
3. Colaborador é pedido de novo depois de uma troca aprovada (campo vazio no passo 1/6).
4. Contexto: com posição+feeder que existem no setup, mostra o componente; com uma
   combinação que não existe, mostra "Posição não cadastrada neste setup" e continua
   deixando enviar.
5. Aprovado volta ao passo 1/6 com tudo vazio; reprovado volta ao passo 4/6 mantendo os
   valores e toca o som de erro.
6. Histórico: falha na consulta do histórico não impede chegar ao passo 6 nem enviar.

## Riscos

- **Mais toques por troca.** Seis passos com um campo cada só é mais rápido que a tela de
  hoje se o Enter do leitor avançar sem falha. Se algum passo exigir toque na tela, a
  troca fica mais lenta do que era. Isso precisa ser verificado no smoke, com o leitor
  real, antes do merge.
- **Colaborador a cada troca** é uma bipada a mais. Foi decisão explícita, mas é a primeira
  coisa que o operador vai reclamar — vale combinar com quem opera antes de subir.
- **Sem rascunho:** fechar o modal no meio perde o que foi digitado. Aceitável porque a
  troca é curta, mas é diferente do NQA, que salva progresso.
