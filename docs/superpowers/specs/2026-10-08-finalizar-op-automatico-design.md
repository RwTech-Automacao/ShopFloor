# Finalização automática de OP — desenho

**Problema.** Nada no ShopFloor marca uma OP como terminada. O campo existe na tela de Cadastro de
OP, mas é manual e, até 08/10/2026, **nunca tinha sido usado**: as 25 OPs do Prod estavam todas
ativas. Como o Dashboard Enterplak monta uma aba por OP ativa, a lista só cresce — e ninguém tem
motivo para lembrar de encerrar nada.

Em 08/10 encerramos 7 à mão (as que estavam a 100%), e o Prod ficou em 18 ativas. Isso resolveu
hoje; não resolve amanhã.

**O que esta feature faz.** Uma rotina periódica mantém o `status` da OP em sincronia com a
porcentagem de conclusão que o sistema já calcula, sem tirar do gestor o poder de encerrar na mão.

---

## A regra

Uma OP está concluída quando **`pct_conclusao >= 100`**.

A conta **já existe** e não vai ser reinventada: `public.sf_ops_com_bipes(null, null)`, da migração
`0121`. Ela é peças distintas aprovadas **no último posto da rota** (`sf_ordem_postos`, maior
`ordem`), com `status <> 'reprovado'`, dividido por `sf_ordens.qtd`.

Três consequências dessa definição, todas intencionais:

- **`>=`, não `=`.** A porcentagem passa de 100 quando se produz mais peças do que a quantidade
  cadastrada. Em 08/10 isso não ocorria em nenhuma OP, mas é possível.
- **`qtd` nulo ou zero ⇒ `pct` nulo ⇒ nunca finaliza.** Correto: sem denominador não há conclusão.
- **A conta é por número de série distinto.** Rebipar uma peça já contada **não** muda a
  porcentagem. Esse detalhe decide a regra de reabertura, abaixo.

## Quando roda

Dentro do cron que já existe: o `crontab` da Lightsail chama `POST /api/alertas/avaliar` a cada 5
minutos.

**Não num gatilho a cada bipe.** O caminho do bipe é o mais sensível do sistema — é onde o operador
espera, e já foi alvo de otimização (eram 18 idas ao banco). O Dashboard não precisa de frescor de
segundos.

⚠️ **A finalização NÃO pode ser capaz de derrubar os alertas.** Os alertas são críticos; a
finalização não é. Ela roda **depois** do envio dos alertas, com o erro contido: qualquer falha é
registrada e a resposta do cron continua sendo a dos alertas. Um defeito aqui pode atrasar o
encerramento de uma OP; não pode calar um alerta de taxa de aprovação.

Herda, sem esforço, o plano de economia: com o RDS desligado à noite o cron responde 503, e a
rotina simplesmente não roda.

## Quem encerrou: a coluna que faz a feature funcionar

A rotina **não pode** mexer no que uma pessoa encerrou. Sem isso, o caso mais comum vira um
pingue-pongue: o gestor encerra uma OP parada em 80% que nunca vai chegar a 100, e cinco minutos
depois a rotina a reabre. Para sempre.

Em 08/10 havia **seis OPs entre 97% e 99%** no Prod (`8553`, `8504`, `8495`, `8507`, `8495_`,
`8546`). Elas estão a uma ou duas peças do fim e **a regra automática nunca vai fechá-las**. Esse
grupo é o motivo de a coluna existir, não uma hipótese.

Então a OP finalizada carrega **quem a finalizou**:

| valor | significa | a rotina pode reabrir? |
|---|---|---|
| `rotina` | a regra dos 100% fechou | **sim**, se a conta cair |
| `manual` | uma pessoa fechou pela tela | **nunca** |
| nulo, com status FINALIZADA | não dá para saber (as 7 de 08/10, ou qualquer edição antiga) | **não** — na dúvida, não mexe |

A última linha é a regra de ouro: **a rotina só reabre o que ela consegue provar que fechou.**

## Reabertura

A rotina reabre quando **a porcentagem cai abaixo de 100%** — não quando entra um bipe qualquer.

Essa distinção foi discutida e decidida com o usuário em 08/10. O raciocínio:

- *"Entrou bipe"* e *"a conta mudou"* **não são a mesma coisa.** Como a conta é por número de série
  distinto, rebipar uma peça que já contava mantém a porcentagem em 100%.
- Com a regra "qualquer bipe reabre", um retrabalho faria a OP **piscar**: reabre, e na rodada
  seguinte a rotina a finaliza de novo, porque a conta nunca saiu de 100%. A OP apareceria e sumiria
  do Dashboard sem que nada tivesse mudado.
- O caso que o usuário queria proteger continua protegido: se a quantidade foi cadastrada errada
  (149 quando o certo era 160), alguém corrige e a conta vira 93% — **a OP volta sozinha**.

## O que muda na tela

A tela de Cadastro de OP continua com o seletor ATIVA/FINALIZADA. O que muda é que, ao salvar por
ali, a OP passa a ser marcada como **`manual`** — é isso que a protege da rotina.

Nenhuma tela nova. Nenhum botão novo.

## O que esta feature NÃO faz

- **Não bloqueia nada.** `FINALIZADA` continua sendo só um rótulo: não impede bipe, lançamento nem
  embalagem. Foi conferido em todo o código e em todas as migrações — nada recusa por causa dele.
  Isso é o que torna a automação segura: ela não consegue travar um operador.
- **Não mexe nas seis de 97–99%.** Elas continuam ativas até alguém decidir no chão.
- **Não cria trilha de auditoria por enquanto.** A rotina escreve direto no banco, como o cron dos
  alertas já faz. Se um dia for preciso saber *quando* cada OP foi encerrada, uma coluna de data
  resolve — mas não foi pedido.

## Como saber que funcionou

O teste que importa não é "a função roda": é **o estado convergir e ficar estável**. Rodar a rotina
duas vezes seguidas, sem nada ter mudado no meio, tem de deixar o banco igual na segunda vez.

Casos que o teste precisa cobrir, no mínimo:

1. OP a 100% e ativa → fecha, marcada como `rotina`.
2. A mesma OP, segunda rodada → **nada muda** (não reabre, não reescreve).
3. OP fechada pela `rotina` cuja `qtd` sobe → **reabre**.
4. OP fechada `manual` abaixo de 100% → **continua fechada**, rodada após rodada.
5. OP FINALIZADA sem marcação (as 7 de 08/10) → **a rotina não encosta**.
6. OP com `qtd` nulo ou zero → nunca fecha.
7. Rebipar peça já contada numa OP fechada → a conta continua 100% e **a OP não pisca**.
8. Um erro dentro da rotina **não** impede os alertas de sair.

O caso 7 é o que distingue este desenho do que foi descartado, e o 8 é o que protege o que já está
em produção.

## Decisões travadas com o usuário (08/10/2026)

1. A OP fecha sozinha quando chega a 100%.
2. A rotina roda **junto do cron de 5 minutos**, não a cada bipe.
3. **Marcar quem encerrou**, para a rotina não desfazer decisão de pessoa.
4. Reabrir quando **a conta cai abaixo de 100%**, não a qualquer bipe.

Ver [[../../../docs/operacao/]] para o cron, e a migração `0121` para a conta de conclusão.

---

# Adendo de 09/10/2026 — o bipe em OP finalizada

Este adendo nasceu de um erro meu na versão original desta spec, e é bom que ele fique escrito.

## O que a spec afirmava, e estava errado

A primeira versão dizia que `FINALIZADA` era **só um rótulo**, sem efeito operacional, e que isso
tinha sido *"conferido em todo o código e em todas as migrações"*. Não tinha.

`src/modules/shopfloor/infra/lancamento-repository.ts` trazia quatro `.neq('status','FINALIZADA')`,
e o das OPs do Lançamento (`listarOrdensParaLancamento`) cortava a lista de onde o **cabeçalho por
bipe** resolve a OP (`resolverOpPorSn`). OP finalizada = SN não encontrado.

Como o erro passou: procurei pela **forma** que eu esperava (comparações `status === 'FINALIZADA'`)
em vez de procurar pela **palavra**. Um `grep FINALIZADA` teria achado os quatro.

O custo não foi na branch. Em 08/10 o gestor fechou 7 OPs à mão, confiando na afirmação, e elas
ficaram **sem aceitar bipe em produção** até a correção.

## Os três casos, separados

Medidos em produção em 09/10 com a consulta de faixas sobrepostas:

| | situação | hoje | depois |
|---|---|---|---|
| **1** | SN cai numa finalizada **e** numa ativa | puxa a ativa, calado | puxa a ativa, calado (igual) |
| **2** | SN cai **só** numa finalizada | "SN não encontrado" | avisa que a OP está finalizada |
| **3** | SN cai em **duas ativas** | "SN cai em mais de uma OP" | igual |

O caso 1 só existe com **faixa cadastrada errada** e é raro. O caso 3 já acontece hoje (as OPs 8235
e 8480 têm faixa idêntica). **A raiz dos dois é o cadastro da OP, não o bipe** — tratar isso lá é
assunto próprio, e fica para depois (decisão do usuário, 09/10).

O caso 2 **não depende de erro nenhum**: é só uma peça que volta depois que a OP fechou. Hoje é
raro porque só 7 OPs estão finalizadas; com a finalização automática, toda OP que bate 100% fecha
sozinha e o caso 2 vira rotina.

## A busca em duas etapas

**Decisão do usuário (09/10).** O cabeçalho procura o SN:

1. **só nas OPs ativas**, exatamente como hoje. Achou uma → carrega, fim.
2. **não achou → procura nas finalizadas.** Achou → **bloqueia**, com a mensagem de que a OP está
   finalizada e precisa ser reativada no cadastro da OP.

Duas propriedades que caem de graça desse desenho:

- **O caso 1 não muda de comportamento.** Como a etapa 1 acha a ativa e para ali, a finalizada nunca
  entra na conta — não aparece ambiguidade nova. Era o preço que eu havia previsto, e ele some.
- **Não custa nada no caminho normal.** A segunda busca só roda quando a primeira falha.

## Reativar tira a OP do automático

Sem isto, o fluxo acima se morde: o gestor reativa a OP, ela continua em 100%, e **a rotina a fecha
de novo em até 5 minutos** — às vezes antes de o operador conseguir bipar.

A rotina já sabe respeitar "uma pessoa **fechou** isto" (`finalizada_por = 'manual'`). Falta saber
respeitar "uma pessoa **reabriu** isto".

**Decisão do usuário (09/10): nunca mais sozinha.** Reativar na mão passa a OP para controle
manual em definitivo; a partir daí só fecha quem reabriu.

⚠️ **O preço, aceito:** cada peça atrasada tira aquela OP do controle automático para sempre, e ela
volta a aparecer no Dashboard até alguém fechá-la na mão. Com o tempo isso reconstrói parte do
problema que a feature veio resolver. Foi escolhido assim por ser o comportamento que **nunca
surpreende** quem usa; revisitar se incomodar na prática.

## Uma premissa que se mostrou falsa (e ajuda)

Na conversa supôs-se que uma OP em 100% não aceitaria bipe nem reaberta. **Não existe trava de
quantidade no lançamento**: `0031_sf_lancar.sql` só limita a **caixa** (`qtd_por_caixa`) na
Embalagem; o que se confere é a faixa de SN, não a `qtd` da OP.

Então a OP reativada aceita a peça atrasada normalmente. E como a conclusão conta **séries
distintas não-reprovadas no último posto**, relançar uma peça já contada não move a porcentagem: a
OP fica em 100%, sem passar disso.

É por isso que a alternativa "volta a fechar quando a conta passar de 100 de novo" foi descartada —
para peça de reparo ela seria letra morta.

## Como saber que funcionou

1. SN de uma OP **ativa** → carrega como sempre. Nada mudou no caminho normal.
2. SN de uma OP **finalizada**, sem ativa que o contenha → mensagem de OP finalizada, e **não**
   carrega o cabeçalho.
3. SN que cai numa finalizada **e** numa ativa → carrega a **ativa**, sem mensagem de ambiguidade.
4. SN que cai em **duas ativas** → continua "SN cai em mais de uma OP".
5. Gestor reativa uma OP em 100% → **a rotina não a fecha de novo**, nem na rodada seguinte nem em
   nenhuma depois.
6. As 7 OPs de 08/10 (`finalizada_por` nulo) continuam fora do alcance da rotina.

O caso 3 é o que prova que a busca em duas etapas protege o caminho normal, e o 5 é o que prova que
a reativação não é desfeita pelas costas de quem a fez.
