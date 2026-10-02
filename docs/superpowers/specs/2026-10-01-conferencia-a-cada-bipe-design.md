# Conferência a cada bipe (troca de rolo do Abastecimento) — design

**Data:** 01/10/2026
**Tela:** `/setup/operar/abastecimento`, o modal passo a passo da troca de rolo

## O problema

Hoje o operador bipa os **seis passos** — Colaborador, Posição, Feeder, Rolo que sai, Rolo que
entra, SN Inicial — e só **no fim** o sistema responde se deu certo. Quando dá errado, ele já
devolveu o rolo à estante, já virou de costas, e a mensagem chega tarde: o item errado não está
mais na mão dele.

Pedido do usuário: **conferir a cada bipe**, parando no passo em que o erro nasce.

## O que muda, e o que não muda

**A ordem dos passos é a mesma.** Não há passo novo, nem passo a menos. O que muda é **quando** o
sistema reclama.

**As regras também são as mesmas.** O `st_trocar_rolo` (migração 0112) já confere tudo — ele
acumula uma lista de motivos e devolve no fim. Este trabalho **não escreve validação nova**: ele
faz cada regra ser alcançável no passo em que ela nasce.

## Onde a conferência roda — a decisão

**Decisão: o modal carrega o setup ao abrir e confere no cliente, a cada passo. O servidor
continua sendo a autoridade no envio final.**

A alternativa era perguntar ao servidor a cada bipe. São **cinco idas e voltas** por rolo trocado;
no tablet, no wifi do galpão, 300–900 ms cada. Numa troca de turno com 20 rolos é mais de um
minuto só olhando loading — e cada espera é uma janela para bipar por cima.

Com a conferência local, **o operador nunca espera entre os passos**. E o pedido original do
usuário ("tem que ter um loading pra não correr o risco de bipar outra coisa enquanto não terminou")
**quase desaparece**: não há ida ao servidor entre os passos, então não há janela. O loading fica
só no envio final, onde já existe hoje.

**O que se abre mão:** se alguém alterar aquele setup enquanto o modal está aberto, a cópia local
envelhece. O servidor pega isso no envio — recusa igual, só um pouco mais tarde. Na prática o modal
fica aberto por segundos.

## Qual regra em qual passo

As regras do `st_trocar_rolo` mapeiam uma a uma nos passos, sem sobra:

| Passo | O que já dá para conferir |
|---|---|
| 2 — Posição | a posição existe nesse setup |
| 3 — Feeder | o feeder existe nesse setup; **e** está naquela posição |
| 4 — Rolo que sai | é o rolo que está montado naquela posição (pela chave: `CAPJ41-1` = `CAPJ41-0001`) |
| 5 — Rolo que entra | é o **mesmo componente** que o que sai; **não** é o mesmo rolo; **não** está montado em outra posição |
| 6 — SN Inicial | pertence à faixa da OP |

O passo 1 (Colaborador) não tem regra de conferência — ele já vem preenchido com o último crachá.

## As mensagens: as que já existem, palavra por palavra

O servidor **já escreve frases boas, e por processo** — SMD fala em *posição* e *feeder*, PTH fala
em *posto* e *locação*, com o gênero certo:

- *"A posição %s não existe nesse setup."* / *"O posto %s não existe nesse setup."*
- *"O feeder %s não está na posição %s."* / *"A locação %s não está no posto %s."*
- *"O rolo montado na posição %s é %s, não %s."*
- *"Componente diferente: sai %s, entra %s."*
- *"O rolo que entra é o mesmo que sai."*
- *"O rolo %s já está montado na posição %s."*
- *"O SN %s não pertence à faixa da OP."*

**Requisito: reaproveitar essas frases exatamente**, inclusive a variação por processo. Duas fontes
de texto para a mesma regra divergem com o tempo, e aí a mensagem do passo diz uma coisa e a do
envio diz outra.

## O comportamento na recusa

Decidido com o usuário: **só aquele passo**.

- a mensagem aparece dizendo o que está errado;
- **o campo é limpo** e continua naquele passo, pronto para bipar de novo;
- **os passos anteriores são preservados** — ele não recomeça o item.

## ⚠️ A consequência que precisa de decisão: o registro das recusas

Hoje **toda** troca vira uma linha em `st_trocas`, com `resultado` (`APROVADO` / `REPROVADO`) e a
lista de `motivos` — **inclusive as reprovadas**. É o histórico de "alguém tentou pôr o rolo errado".

Com a conferência no cliente, uma tentativa barrada no passo 3 **nunca chega ao servidor** — e esse
registro deixa de existir. O número de reprovações vai cair não porque o chão melhorou, mas porque
a maioria passa a ser barrada antes.

Três saídas (decisão do usuário, ver "Em aberto"):

- **(a)** aceitar a perda e documentar: `st_trocas` passa a registrar só o que chegou ao envio;
- **(b)** registrar as recusas locais também, mandando-as ao servidor em segundo plano (sem travar
  o operador);
- **(c)** registrar a recusa só quando ele **desiste** da troca, não a cada bipe recusado.

## Fora de escopo

- Mudar a ordem ou a quantidade dos passos.
- Mudar qualquer regra de negócio do `st_trocar_rolo`.
- A validação do servidor no envio: **continua exatamente como está**, e é ela que vale.

## Em aberto

1. **O registro das recusas** (acima) — (a), (b) ou (c).
