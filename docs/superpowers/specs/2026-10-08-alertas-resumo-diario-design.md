# Resumo diário por posto: o relatório do dia, no fim do dia

**Data:** 08/10/2026
**Branch:** `feat/alertas-resumo-diario`

## O problema

Os alertas de hoje só falam quando algo dá errado. Isso é o certo para um alerta — mas deixa um
buraco: **ninguém tem a foto do dia**. Para saber como a Inspeção PTH foi hoje, alguém precisa abrir
o Dashboard e montar o filtro. Na prática, não abre.

O gestor quer uma linha por posto, uma vez por dia, no fim do dia.

## O que muda

Um **tipo de regra novo**: `resumo`. Na hora configurada, ele manda **uma linha por posto da
regra**, com a taxa de aprovação do dia.

```
Resumo do dia · 08/10

Inspeção PTH ....... 96,4%   (134 aprovados · 5 reprovados)
Inspeção SPI ....... 91,0%   (91 · 9)
Teste .............. 88,2%   (75 · 10)
```

## As decisões, e por quê

### Tipo de regra, não uma tela à parte

Foi **decisão do usuário**, contra a minha recomendação, e a razão dele é boa: a regra já carrega
tudo o que o relatório precisa — os postos, as PMOs, os destinatários, os canais. Uma tela nova
duplicaria as quatro coisas.

⚠️ **O preço, e ele é real:** este tipo não usa **metade** da máquina de alertas. Relatório não abre
ocorrência, ninguém aperta "Resolvido", não insiste e não normaliza. Tudo isso precisa ser
**desligado explicitamente** para ele — e cada um desses desligamentos é uma condição a mais numa
função que já é longa. A alternativa (uma aba "Relatórios" própria) foi considerada e descartada.

### O período vem dos intervalos, não do relógio

"O dia" é **o que está dentro dos intervalos cadastrados** na regra — a mesma tabela filha
`alerta_regra_intervalos` e o mesmo editor de tela que a janela por blocos (0139) já usa.

Diferença de uso: na janela por blocos os intervalos são **ladrilhados** pelo passo; aqui eles só
**delimitam** o que conta como "o dia". O passo não se aplica.

Isso mantém o relatório honesto em relação ao turno: hora extra fora do intervalo não entra, e o
almoço não conta como produção parada.

### A hora de envio é configurável, e travada entre 06:00 e 19:00

Campo novo na regra. **O teto não é zelo:** o RDS desliga às 19:00 em dias úteis
([plano-economia-aws.md](../../operacao/plano-economia-aws.md)), e um relatório configurado para as
20:00 **nunca sairia, sem erro em lugar nenhum**. O piso de 06:00 é o horário em que o banco sobe.

### Posto sem bipe sai da lista

Posto da regra que não teve nenhum bipe no dia **não aparece** no relatório — não vira uma linha com
"—" nem com 0%.

Se **nenhum** posto da regra tiver dado — fim de semana, feriado, linha parada —, **nenhum e-mail é
enviado**. Relatório vazio não é informação.

### Uma vez por dia, e o cron é quem garante

O cron roda de 5 em 5 minutos. O relatório sai na **primeira rodada depois da hora configurada**, e
não sai de novo no mesmo dia.

Quem garante isso é uma coluna nova na regra: a **data** do último envio. Mesma ideia do
`bloco_reportado` da 0139 — o estado mora no banco, não num relógio na memória, e a reavaliação é
idempotente por construção.

⚠️ **Guardar DATA, não instante.** Com um instante seria preciso comparar "passou 24 h?", e aí uma
rodada atrasada moveria a hora do relatório um pouco a cada dia. Com a data do dia a pergunta é
"já mandei hoje?", que não desgarra.

**Consequência aceita:** se o cron ficar parado da hora configurada até o fim do dia, o relatório
daquele dia **não sai** e não é recuperado no dia seguinte. Relatório de ontem chegando hoje confunde
mais do que ajuda.

## Comportamento, ponta a ponta

| | |
|---|---|
| Chegou a hora, há dados | manda o relatório e grava a data |
| Chegou a hora, nenhum posto com dado | **não manda**, e **não** grava a data (tenta de novo amanhã) |
| Já mandou hoje | não faz nada |
| Antes da hora | não faz nada |
| Posto sem bipe | sai da lista; os outros continuam |
| Fora dos intervalos | não entra na conta |

## Estrutura

| camada | o quê |
|---|---|
| **Domínio** | `horaDeEnviarResumo(horaConfigurada, ultimoEnvioEm, agora)` — função pura: chegou a hora e ainda não mandou hoje? Fuso de São Paulo, como tudo no módulo |
| **Domínio** | `TipoRegra` ganha `'resumo'`; `validarRegra` ganha as regras dele; o texto da mensagem |
| **Banco** | `alerta_regras` ganha `hora_resumo time` e `resumo_enviado_em date`; `alerta_avaliar` ganha o ramo |
| **Infra** | o app calcula se é hora (mesma razão da 0139: aritmética de horário com fuso fica no TS, testada) |
| **Tela** | o tipo novo no seletor, o campo da hora, o editor de intervalos reaproveitado, e esconder o que não se aplica |

**A aritmética de horário fica no TypeScript.** O banco recebe a decisão pronta, no mesmo padrão do
`p_canal_discord` e do `p_blocos`.

## O que esconder na tela

O tipo `resumo` **não usa**: taxa mínima, mínimo de bipes, lembrete, janela (tempo/bipes/OP), limite
de tempo, limite de ocorrências. Mostrar campo que não faz nada é pior que não mostrar.

**Usa:** nome, postos, PMOs, **intervalos**, **hora de envio**, destinatários, canais, ativa.

## Como se prova que funciona

- **Domínio:** antes da hora → não; depois da hora e não mandou hoje → sim; depois da hora e já
  mandou hoje → não; virada do dia; e o mesmo resultado com `TZ=UTC` (o servidor roda em UTC).
- **Banco:** a data é gravada **só** quando envia; dia sem dado não grava (tenta amanhã); as outras
  três regras não mudam de comportamento.
- **Tela:** o tipo novo aparece; os campos que não se aplicam somem; a hora recusa 05:00 e 20:00.
- **Harness SQL:** um arquivo próprio em `supabase/tests/`, no runner dos alertas.

## Fora de escopo, e por quê

**Não tem ocorrência, nem botão "Resolvido", nem histórico na tela de Ocorrências.** Um relatório não
é um problema a resolver. A tela de Ocorrências continua sendo só dos três tipos que abrem ocorrência.

**Não tem resumo por OP, nem por defeito, nem por colaborador.** O pedido é por posto.

**Não recupera dia perdido.** Ver a decisão acima.
