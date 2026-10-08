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
