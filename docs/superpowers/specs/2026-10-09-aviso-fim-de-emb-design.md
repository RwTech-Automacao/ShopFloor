# Aviso de fim de EMB — desenho

## O problema

A justificativa de divergência entrou em produção hoje (09/10). Ela põe um selo **?** na linha com
divergência de quantidade e deixa quem administra o Recebimento escrever o porquê.

Mas a decisão — consciente — foi **não travar a finalização** por causa de uma divergência sem
explicação. O preço, escrito na própria spec daquela feature, é que *"o selo `?` pode ficar lá para
sempre e ninguém notar"*.

Os filtros rápidos (também de hoje) ajudam **quem vai procurar**. Isto aqui é o que faz **alguém
ir**: quando a EMB fecha, as divergências dela chegam até as pessoas em vez de esperarem ser
achadas.

## O que a feature faz

Quando **todos os processos de uma EMB** chegam ao fim do fluxo, sai uma mensagem listando as
divergências daquela EMB e, em cada uma, o que foi justificado — ou que ninguém justificou.

Vai por **e-mail**, **Discord** e **Telegram**.

---

## Onde isso mora: um tipo de regra nos Alertas

Não é tela nova. O módulo de Alertas já tem tudo o que este aviso precisa: tipos de regra, canais
de envio, responsáveis, fila, o cron de 5 minutos e o botão de testar. Construir um sistema de
notificação paralelo ao lado dele seria reinventar o que já funciona em produção.

Então o fim de EMB vira **mais um cartão** na escolha de tipo de regra, do lado de "Taxa de
aprovação", "Tempo médio por peça", "Defeito repetido" e "Resumo diário".

### A tela de Alertas passa a existir em dois lugares

**Decisão do usuário (09/10).** Duas rotas, uma para cada módulo:

```
Configurações > Ajustes ShopFloor  > Alertas   (só regras do Fluxo de Processos)
Configurações > Ajustes Recebimento > Alertas  (só regras do Recebimento)
```

**Não são duas telas.** É o mesmo componente montado em duas rotas, recebendo qual módulo está
servindo. Formulário, canais, responsáveis, ocorrências e teste são um código só.

Foi escolhido assim, e não uma tela única com duas abas, por causa do RBAC. Hoje o item do menu é
uma linha declarativa com `modulo` e `perm` ([app-shell.tsx:123](../../../src/shared/ui/app-shell.tsx#L123)):
o Recebimento ganha uma linha igual com `modulo: 'recebimento'`, e **a permissão sai de graça pelo
mecanismo que já existe**. Uma tela que atravessa os dois módulos exigiria regra nova ("vê Alertas
quem administra qualquer módulo") e esconder abas que não são da pessoa.

Efeito prático: quem cuida do Recebimento acha os alertas **dentro do Recebimento**, onde já
trabalha, e nunca vê uma aba de ShopFloor que não é dela.

⚠️ Isto **cancela** a etapa que eu havia proposto de tirar os Alertas de dentro de Ajustes do
ShopFloor. Eles ficam onde estão. Se um dia cinco módulos tiverem alertas, cinco entradas de menu
vão cansar — a migração para tela única será fácil, justamente porque o componente já é
compartilhado.

### A regra passa a ter módulo

`alerta_regras` ganha uma coluna `modulo`. As linhas existentes são todas do ShopFloor (o
preenchimento retroativo é esse), e cada tela lista só as regras do módulo dela.

Sem isso as duas rotas mostrariam a mesma lista, e quem administra só o Recebimento leria regras de
posto que não lhe dizem respeito.

---

## O gatilho

**Decisão do usuário (09/10):** a EMB avisa quando **todos os processos dela estiverem
finalizados**.

No domínio, um processo está no fim quando chega em **Almoxarifado** ou em **Reprovado na
Qualidade** — as duas saídas terminais do fluxo
([etapa-processo.ts](../../../src/modules/recebimento/domain/etapa-processo.ts)). Não é "saiu da
Qualidade": o item reprovado também terminou, só que pelo outro lado.

**Avaliado no cron de 5 minutos**, junto dos outros alertas. Não num gatilho a cada finalização de
item: o caminho de finalizar um processo é usado o dia inteiro, e não vale a pena pendurar envio de
e-mail nele.

**Uma marca de "já avisei"** impede repetir. É o mesmo mecanismo do resumo diário
(`resumo_enviado_em`, migração 0141): sem ela, o cron mandaria a mesma mensagem a cada 5 minutos
enquanto a EMB continuasse fechada.

⚠️ **Consequência de reabrir:** se um processo de uma EMB já avisada voltar atrás (a quantidade é
corrigida, o item volta pra Qualidade), a EMB deixa de estar fechada. Quando fechar de novo, **ela
não avisa de novo** — a marca já está lá. É de propósito: o aviso é "a EMB fechou", não "a EMB
mudou", e reavisar a cada ida e volta transformaria a caixa de entrada em ruído.

---

## O conteúdo

**Decisão do usuário (09/10): só as divergências e suas justificativas.**

A mensagem traz, para cada item divergente da EMB: o que é o item, qual a divergência, e o texto
da justificativa — ou a marca de que ninguém justificou, que é justamente a que precisa de ação.

⚠️ **CORRIGIDO EM 14/10/2026 — a decisão era o contrário e foi revertida pelo usuário.**

A primeira versão desta spec dizia: *"EMB que fecha sem nenhuma divergência não manda nada... o
preço é que ninguém é avisado de um fechamento limpo. Revisitar se alguém sentir falta."* Não
esperou nem a implementação: ao ser perguntado sobre a marca de "já avisei", o usuário respondeu
que **a EMB sem divergência deve avisar que terminou, dizendo que terminou sem divergência**.

**Toda EMB que fecha manda mensagem.** Com divergência, a mensagem lista as divergências e as
justificativas; sem divergência, ela diz que a EMB fechou limpa.

Isso **dissolve a pergunta da marca**: se toda EMB fechada recebe mensagem, toda EMB fechada recebe
a marca de "já avisei". Não existe mais o caso ambíguo de uma EMB que fecha, não manda nada, e
depois ganha uma divergência por edição de quantidade.

---

## Os canais

| canal | estado |
|---|---|
| **Discord** | já existe e funciona em produção |
| **Telegram** | já existe e funciona em produção |
| **E-mail** | **não existe** — é a maior parte do trabalho desta feature |

O módulo já abstrai canal (`Canal = 'telegram' | 'discord'`, com `infra/discord.ts`,
`infra/telegram.ts` e uma fábrica). Discord e Telegram saem praticamente de graça: é o mesmo
caminho do resumo diário.

O e-mail entra como um **terceiro canal**, e traz consigo o envio SMTP e a noção de endereço.

### De onde sai o endereço

**Decisão do usuário (09/10): o e-mail do login.**

Todo usuário já tem um em `usuarios.email` — é com ele que entra no sistema. Não há tela nova, não
há cadastro de endereço, não há confirmação.

⚠️ O que se aceita junto: **não dá para mandar aviso para quem não tem conta**, e não dá para a
pessoa receber num endereço diferente do de login. Se um dia for preciso avisar um comprador que
não usa o sistema, isso é feature nova.

### Qual SMTP

O mesmo que já está configurado no servidor para o GoTrue (o "esqueci a senha"). Não se levanta
servidor de e-mail novo.

⚠️ **A conferir antes de implementar:** o "esqueci a senha" está quebrado hoje por causa do
template e do `origin` atrás do nginx — mas o **envio em si funciona**. Esta feature depende só do
envio. Confirmar as credenciais no servidor antes de escrever o canal.

---

## Os destinatários

**Decisão do usuário (09/10):** igual às regras do ShopFloor — **escolhidos na própria regra**,
numa lista de usuários, podendo ser as pessoas responsáveis pelo Recebimento.

O modelo de responsáveis já existe (`destinatarios` em `EntradaRegra`) e já é o que permite
encerrar uma ocorrência. Nada novo aqui, além de a lista oferecer gente do Recebimento.

---

## O que muda no modelo de regra

Uma regra de fim de EMB **não tem posto e não tem janela**. As do ShopFloor têm os dois.

Isso não é problema novo: o **resumo diário** já abriu esse caminho. Ele ignora metade dos campos,
força `janelaTipo = 'intervalos'` mesmo que o formulário mande outra coisa, e a coluna "Janela" da
lista mostra uma frase própria em vez do valor cru
([regra.ts:228](../../../src/modules/alertas/domain/regra.ts#L228) e `resumoJanelaRegra`). O tipo
novo segue o mesmo padrão.

Resumindo as mudanças estruturais:

- `alerta_regras.modulo` — nova coluna, retroativa para `'shopfloor'`
- `TipoRegra` ganha o valor novo, com nome e descrição próprios no cartão de escolha
- `Canal` ganha `'email'`
- a marca de "já avisei" por EMB

---

## Fora de escopo, e por quê

**Não trava nada.** O aviso não impede fechar EMB, nem cobra justificativa. Mesma razão da feature
da justificativa: o fim do processo é onde menos se quer atrito.

**Não reenvia.** Ver a consequência de reabrir, acima.

**Não é por fornecedor nem por tipo de material.** A regra vale para todas as EMBs. Se um dia
precisar recortar, é campo novo na regra.

**Não mexe no "esqueci a senha".** Ele usa o SMTP do GoTrue e está quebrado por outro motivo
(template e `origin`); consertar isso é assunto próprio, mesmo que o SMTP seja o mesmo.

---

## Como saber que funcionou

1. EMB com três itens, dois ainda na Qualidade → **não manda nada**.
2. O último item chega ao Almoxarifado → na próxima rodada do cron **sai a mensagem**, com as
   divergências e as justificativas.
3. A mesma EMB, rodada seguinte → **nada sai**. É o teste da marca de "já avisei".
4. EMB que fecha **sem divergência** → **manda**, dizendo que fechou sem divergência.
5. EMB cujo último item foi **reprovado** na Qualidade → **manda**, porque reprovado também é fim.
6. A regra criada em Ajustes do Recebimento **não aparece** na tela de Alertas do ShopFloor, e
   vice-versa.
7. Quem administra **só** o Recebimento abre Ajustes do Recebimento > Alertas e **consegue usar**.
   Quem não administra nenhum dos dois não vê item nenhum.
8. Botão de testar da regra → chega nos três canais, sem depender de EMB nenhuma.
9. EMB fechada há **mais de 3 dias** → **não avisa e não é marcada**, mesmo que a regra seja mais antiga. *(Acrescentado em 15/10/2026: o piso "só EMB fechada depois da criação da regra" sozinho não cobria regra reativada depois de semanas nem regra sem ninguém alcançável por dias — tudo fechado desde a criação avisava de uma vez. Vale o mais tardio entre o piso e o teto de 3 dias.)*

O caso 3 é o que separa esta implementação de uma que inundaria a caixa de entrada, e o 7 é o
motivo de a tela existir em duas rotas.

---

## A ordem de entrega

Três pedaços, nesta ordem, porque cada um já vale sozinho:

1. **Alertas do Recebimento** — a coluna `modulo`, a rota nova e a tela servindo os dois módulos.
   Entregue isto e a tela existe, ainda sem tipo de regra próprio.
2. **Tipo de regra "Fim de EMB"** — o gatilho, o conteúdo e a marca. Com isto a feature **já
   funciona**, por Discord e Telegram.
3. **Canal de e-mail** — o SMTP e `usuarios.email` como destino.

O usuário pediu o e-mail como prioridade. A ordem acima entrega o e-mail por último **de propósito**:
ele é o pedaço mais caro e o único que não tem nada pronto embaixo. Os dois primeiros põem a
feature de pé por canais que já funcionam; o terceiro acrescenta o canal que ele quer. Se a
preferência for esperar e soltar tudo num deploy só, os três podem ir juntos — é decisão de
deploy, não de implementação.

## Decisões travadas com o usuário (09/10/2026)

1. Vira **tipo de regra nos Alertas**, não tela própria.
2. A tela existe em **duas rotas**, uma por módulo; os Alertas **não** saem de Ajustes do ShopFloor.
3. Dispara quando **todos os processos da EMB** estiverem finalizados.
4. Conteúdo: **só as divergências e suas justificativas**.
5. **Toda EMB que fecha manda mensagem** — sem divergência, dizendo que fechou limpa (corrigido em 14/10; a versão original dizia o contrário).
6. Destinatários **escolhidos na regra**, como no ShopFloor.
7. Endereço de e-mail: **o do login** (`usuarios.email`).
8. Canais: e-mail é a prioridade do usuário, com Discord junto; Telegram vem de graça.
