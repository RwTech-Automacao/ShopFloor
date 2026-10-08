# Justificativa de divergência: por que faltou, e o que foi combinado

**Data:** 08/10/2026
**Branch:** `feat/recebimento-justificativa-divergencia`

## O problema

Quando um item chega com quantidade diferente da pedida, o sistema mostra a diferença — `-42`, em
vermelho, na coluna Divergência. E para por aí.

**O número não conta a história.** Faltaram 42 porque o fornecedor errou? Porque o pedido foi
dividido em duas entregas? Porque alguém contou errado? E, mais importante: **o que foi combinado**
com o fornecedor? Isso hoje vive no WhatsApp de quem recebeu, e some.

## O que muda

Na linha com divergência aparece um **selo**:

| selo | quer dizer |
|---|---|
| **?** | tem divergência e **ninguém explicou** |
| **✅** | tem divergência e **alguém explicou** |

Clicando no selo abre uma caixa de texto. A pessoa escreve o porquê e o que foi alinhado, salva, e o
selo vira ✅. Clicando de novo, o texto volta para edição, com o nome de **quem escreveu** por
último.

O mesmo selo aparece em **dois lugares**: na grade de Processos, ao lado da divergência; e na tela
de Fluxo, dentro do card "Divergência de quantidade", à **esquerda** de cada item.

## As decisões, e por quê

### Só informa — não trava a finalização

**Decisão do usuário.** Uma divergência sem justificativa **não impede** finalizar o processo.

A alternativa (travar) garantiria que a história sempre existe, mas prenderia gente no fim do
processo por causa de um campo de texto — e o fim do processo é onde menos se quer atrito.

⚠️ O preço: o selo **?** pode ficar lá para sempre e ninguém notar. É o que os **filtros rápidos**
(branch irmã) amenizam, ao deixar listar só as divergências.

### Uma caixa de texto, não duas

**Decisão do usuário.** O porquê e o combinado moram no mesmo texto livre.

Descartada a versão com dois campos ("causa" e "alinhamento"), que cobraria as duas respostas. Em
texto livre a pessoa escreve do jeito que pensa, e cobrar campo costuma produzir campo preenchido
com ponto.

### A justificativa sobrevive à divergência

⚠️ **A divergência é uma marca que pode SUMIR.** O próprio código diz
(`domain/etapa-processo.ts:14`): *"o item divergente continua o fluxo normalmente e a marca some
sozinha quando a quantidade é corrigida (o campo é recalculado)"*.

Então: quando a quantidade é corrigida e a divergência zera, **o selo some da tela** — mas o texto
**continua guardado**. Se a divergência voltar, a justificativa antiga reaparece, com a data e o
nome de quem escreveu.

Apagar o texto junto com a marca perderia a única explicação que existe daquilo, e é exatamente a
situação em que alguém vai querer saber o que houve.

### Quem escreveu vem do usuário logado, e fica

Grava o id do usuário e o instante. A tela mostra o **nome** e **quando**. Editar **sobrescreve** o
texto e atualiza os dois — não há histórico de versões do texto.

Guardar versões seria mais completo e é escopo que ninguém pediu; o log de auditoria do sistema já
registra que houve uma alteração.

## Estrutura

| camada | o quê |
|---|---|
| **Banco** | `processos_recebimento` ganha `divergencia_justificativa text`, `divergencia_justificada_por uuid`, `divergencia_justificada_em timestamptz` |
| **Domínio** | `estadoDaDivergencia(divergencia, justificativa)` — função pura: `'sem'` · `'pendente'` · `'justificada'`. É ela que decide qual selo (ou nenhum) |
| **Aplicação** | `salvarJustificativaDivergencia(id, texto)` — permissão de **editar** do Recebimento, grava os três campos |
| **Tela** | o selo + o diálogo na grade de Processos; o selo no card do Fluxo |

**Por que os três campos na própria tabela, e não numa tabela à parte:** a justificativa é 1-para-1
com o processo, nasce e morre com ele, e não tem histórico. Uma tabela filha só faria sentido para
guardar versões — que a decisão acima descartou.

### Os três estados, numa função só

A regra "qual selo mostrar" é a mesma nas duas telas. Mora **numa função pura** e as duas chamam.

⚠️ Duas telas decidindo o mesmo estado por caminhos diferentes é a família de defeito que já custou
seis correções neste projeto. A grade e o Fluxo **têm** que concordar sobre o que é "justificada".

## Comportamento, ponta a ponta

| | |
|---|---|
| Sem divergência | **nenhum selo** — nem ?, nem ✅ |
| Divergência, sem texto | **?** · clicar abre a caixa vazia |
| Divergência, com texto | **✅** · clicar abre a caixa com o texto e o nome de quem escreveu |
| Salvar texto vazio | volta a **?** (apagar a justificativa é permitido) |
| Divergência corrigida para zero | selo some; **o texto continua guardado** |
| Sem permissão de editar | o selo **mostra** o estado, mas a caixa é **só leitura** |

## Como se prova que funciona

- **Domínio:** os três estados, nas fronteiras — divergência `'0'`, `''`, `'-42'`, `'1,5'` (vírgula
  decimal, que o campo aceita), texto vazio × texto com espaços.
- **Aplicação:** grava os três campos juntos; sem permissão recusa; o id vem da sessão, não do
  cliente.
- **Tela:** o selo certo em cada estado; sem divergência não aparece selo; editar mostra o texto
  anterior; salvar vazio volta para `?`; sem permissão a caixa é só leitura.
- **As duas telas concordam:** o mesmo processo mostra o mesmo selo na grade e no Fluxo.

## Fora de escopo, e por quê

**Não trava a finalização.** Ver a decisão acima.

**Não tem histórico de versões do texto.** Editar sobrescreve.

**Não notifica ninguém** quando uma justificativa é escrita. O e-mail de fim de EMB (branch irmã)
vai levar as justificativas junto, e isso basta.

**Os filtros rápidos** (Divergências · positivas · negativas) são **branch própria**, ainda que na
mesma tela: são independentes desta e saem sozinhos.
