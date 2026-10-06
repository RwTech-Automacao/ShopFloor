# Confirmar os consertos da Manutenção no posto de reteste

**Data:** 05/10/2026
**Branch:** `feat/confirmar-conserto-manutencao`

## O problema

Uma peça reprova no Teste, vai para a Manutenção, é reparada, e repassa pela **Inspeção PTH** antes de
voltar — é a rota de reteste, configurada em *"Depois da Manutenção, passar por"* (migrações 0102/0103).

Hoje o inspetor aprova ou reprova **sem ver o que a Manutenção fez**. Ele não tem, na tela, a lista
dos consertos que acabaram de ser registrados naquela peça — e é justamente o trabalho dele conferir
se aquilo resolveu.

Existe um modal parecido no sistema, mas **ele nunca dispara aqui**: o de hoje só aparece em postos
que consertam no próprio lugar (`reprova ≠ nenhum && !exigeManutencao`), e o posto da rota manda a
peça de volta para a Manutenção quando reprova — então não se encaixa na regra.

## O que muda

Ao **aprovar** no posto da rota de reteste, se a peça acabou de sair da Manutenção, abre um diálogo
listando os **consertos** registrados lá. Confirmando, grava o Aprovado e uma trilha de quem conferiu.

## As decisões, e por quê

### O gatilho: "acabou de sair da Manutenção"

Olha o **último registro da peça** (em qualquer posto). Se for um reparo, pergunta.

Descartada a alternativa "reparo pendente de conferência", que esperaria a confirmação mesmo que a
peça passasse por outros postos antes. O usuário escolheu o gatilho simples: se ela não veio direto
da Manutenção, a pergunta não aparece.

⚠️ Isto difere do modal de hoje, que olha o último registro **naquele mesmo posto**. Aqui não serve:
a peça pode estar passando pela Inspeção **pela primeira vez**, e o evento aconteceu em outro posto.

### Só no posto da rota

O campo *"Depois da Manutenção, passar por"* é **opcional**. Quando não está configurado, a peça
reparada volta direto ao posto de origem — e **lá o modal não aparece**.

Descartada a alternativa "no primeiro posto que receber a peça depois da Manutenção", que cobriria
também quem não configurou a rota. O usuário preferiu o comportamento previsível: só onde foi pedido.

### Reconhecer a Manutenção pelo PERFIL, não pelo nome

A `sf_manutencao_registrar` (0033) grava o registro com `posto = 'Manutenção'`, **texto literal**.

Comparar com esse texto funcionaria hoje e quebraria no dia em que alguém renomear o posto — **sem
erro, apenas parando de perguntar**, que é a pior forma de falhar. O projeto já migrou quase tudo
para perfil (0062/0063), e a Manutenção tem perfil próprio.

Então: pega o posto do registro, resolve o perfil dele pelo mapa que a tela já carrega, e pergunta se
**o perfil** é o de Manutenção.

### Mostra só os consertos

A Manutenção registra três coisas: o **defeito relatado** pelo Teste, os **defeitos constatados** pelo
técnico (`reparo_constatado`, 0061) e os **consertos** feitos (`reparo_conserto` + `reparo_posicao`).

O modal mostra **só os consertos**. Foi decisão do usuário; a alternativa considerada era acrescentar
os defeitos constatados, para o inspetor saber onde olhar.

### A trilha fica na tabela que já existe

`sf_conserto_confirmado` (0072) guarda uma linha por **defeito** confirmado. Passa a guardar também
uma linha por **conserto** confirmado, com duas colunas novas:

| coluna | para quê |
|---|---|
| `origem` | `'posto'` (o que existe hoje) ou `'manutencao'` (o novo) |
| `conserto` | a descrição do conserto confirmado; vazia quando `origem = 'posto'` |

A `origem` nasce com `'posto'` em tudo que já está lá, então o histórico continua válido e nenhuma
consulta de hoje muda de resultado. Sem a coluna, as duas confirmações se misturariam e quem
consultasse depois não saberia distinguir *"quem atestou o defeito?"* de *"quem conferiu o reparo?"*.

Descartada uma tabela separada: a pergunta é a mesma (quem confirmou o quê, quando, em que posto), e
duas tabelas com as mesmas cinco colunas de identificação seriam duplicação sem ganho.

## Comportamento, ponta a ponta

| | |
|---|---|
| **Confirmar** | grava o Aprovado normal **+** uma linha de trilha por conserto |
| **Cancelar** | limpa a peça e não grava nada — igual ao modal de hoje; a peça fica de lado |
| **Erro na consulta** | **não pergunta e deixa passar** — igual ao de hoje |
| **Reprovar** | não pergunta nada; o modal é só no caminho do Aprovado |
| **Sem consertos no reparo** | não pergunta (não há o que confirmar) |

O **fail-open** é deliberado e já é a regra do modal irmão: uma falha de consulta não pode travar o
operador que está de pé na bancada com a peça na mão. O custo é perder uma confirmação; o custo do
contrário é parar a linha.

## Estrutura

| camada | o quê |
|---|---|
| **Domínio** | `postoEhDestinoDeRota(posto, postos)` — função pura: algum posto aponta para este em `retorno_pos_manutencao`? |
| **Infra** | `buscarUltimoReparo(pmo, op, snNorm)` — o último registro da peça é um reparo? devolve os consertos daquele evento |

**O que é "o último registro" e o que é "aquele evento":** a peça pode ter dezenas de linhas. Ordena
por `data_hora` desc (desempate por `id` desc, como a consulta irmã já faz), olha a **primeira**; se o
posto dela não tiver perfil de Manutenção, devolve nulo. Se tiver, o evento são **todas as linhas com
o mesmo `data_hora`** — porque a `sf_manutencao_registrar` grava **uma linha por conserto**, todas no
mesmo instante. Dessas, entram as que têm `reparo_conserto` preenchido.
| **Aplicação** | `verificarConsertoManutencao(...)`, irmã de `verificarConserto`, no mesmo arquivo e com o mesmo contrato (devolve a lista ou `null`) |
| **Tela** | o mesmo `confirmar()` que o modal de hoje usa, com outro texto |
| **Banco** | migração com as duas colunas |

A tela precisa saber quais postos são destino de rota. O `retorno_pos_manutencao` **já é lido** pelo
`ordem-repository` (0102); falta levá-lo até o formulário, ao lado do mapa de perfis que já chega lá.

## Como se prova que funciona

- **Domínio:** o posto é destino de rota? Com rota configurada, sem rota, e com o posto apontando
  para si mesmo.
- **Infra:** o último registro é reparo → devolve os consertos daquele evento; é outra coisa →
  devolve nulo; reparo sem conserto → nulo.
- **Aplicação:** posto que não é destino de rota não pergunta; erro na consulta devolve nulo
  (fail-open); sem permissão de lançar devolve nulo.
- **Tela:** confirmar grava a trilha com `origem = 'manutencao'`; cancelar limpa a peça e não grava;
  reprovar não abre o modal.
- **Banco:** a migração é idempotente; `origem` nasce `'posto'` nas linhas existentes; as políticas de
  acesso continuam como estão.

## Fora de escopo, e por quê

**As regras de acesso da `sf_conserto_confirmado` usam `tem_permissao` de UM argumento** — a forma que
checa a permissão **global** em vez da do módulo ShopFloor. Quem tem "visualizar" de qualquer módulo
passa pela regra de leitura.

Isto **já existe** desde a 0072 (agosto) e foi marcado pela revisão de segurança de 21/09 como padrão
a corrigir. Medido agora: **69 ocorrências em 56 arquivos de migração**.

Não entra nesta branch, por decisão do usuário: mudança de segurança não se mistura com funcionalidade,
e 56 arquivos são uma varredura própria, não um remendo de passagem.

⚠️ **O que esta branch acrescenta ao problema:** as colunas novas herdam as mesmas regras, então os
consertos confirmados ficam legíveis por quem tem "visualizar" global sem ter ShopFloor. É pouco — a
informação já está em `sf_registros` —, mas não é zero.

**Antes de decidir o tamanho do conserto, vale medir:** uma consulta aos perfis reais diz se as
permissões globais estão ligadas em alguém. Se não estiverem, o problema é teórico.
