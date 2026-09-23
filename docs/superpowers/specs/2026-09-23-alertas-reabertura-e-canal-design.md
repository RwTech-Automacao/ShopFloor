# Alertas: reabertura e aviso em canal do Discord — design

**Card:** Ajustes Alertas — Sprint 23/09/2026 [2h]
**Data:** 23/09/2026

O card tem quatro itens. Dois são operacionais e não entram aqui (criar os usuários das
lideranças e cada uma vincular o Discord em Meu perfil). Os outros dois são código e estão
neste documento:

- **Parte 1 — Reabertura:** um alerta marcado como "Resolvido" que não foi resolvido de
  verdade volta a avisar.
- **Parte 2 — Canal:** a regra pode avisar num canal do Discord, e não só na conversa
  privada de cada pessoa.

**As duas partes são independentes e podem subir separadas.** A Parte 1 corrige um defeito
que está em produção hoje e é a mais barata; a Parte 2 mexe no modelo de destino, na fila
de envio e na tela de regras. **As 2 horas do card não cobrem as duas.**

---

# Parte 1 — Reabrir ocorrência resolvida

## O defeito atual

Ao apertar **Resolvido**, a ocorrência passa para o estado `resolvida`. A partir daí, com o
problema continuando:

- não manda mais alerta nem lembrete (o lembrete exige `estado = 'aberta'`);
- **não abre uma ocorrência nova**, porque a avaliação procura ocorrência `aberta` **ou**
  `resolvida` antes de abrir outra, e o índice único
  `alerta_ocorrencias_viva_defeito` cobre os dois estados;
- a entrega também filtra `oc.estado = 'aberta'` para alerta/lembrete.

Resultado: **apertar Resolvido silencia aquele problema até ele normalizar sozinho.** Quem
aperta sem querer (ou por otimismo) desliga o alerta e ninguém percebe.

## Desenho

Se a ocorrência está `resolvida`, a condição **continua ruim** e já passou a carência, ela
**volta para `aberta`** e avisa de novo.

### Carência: quanto tempo esperar depois do "Resolvido"

A carência sai da **janela da própria regra**, e o motivo é técnico, não de gosto: a janela
é o tempo que o problema leva para sair da conta. Numa regra de 60 minutos, uma correção
feita agora só aparece por completo daqui a 60 minutos — os bipes ruins continuam dentro
da janela. Reabrir antes disso reabriria **mesmo quando o problema foi resolvido de
verdade**, e alarme falso destrói a confiança no alerta.

| Janela da regra | Carência |
|---|---|
| Últimos N **minutos** | o próprio N |
| Últimos N **bipes** | **60 minutos** (não dá para converter bipes em tempo: depende do ritmo da produção) |
| **OP em andamento** | **60 minutos** (a janela nunca "passa": é a OP inteira) |

Com piso e teto, porque a janela aceita extremos:

- **Piso 15 minutos.** Uma regra de janela 5 min reabriria a cada 5 min — vira spam e a
  pessoa desliga a regra.
- **Teto 2 horas.** A janela pode ser de até 7 dias; carência de 7 dias é o defeito de hoje
  de volta.

**Não ler o campo de janela desabilitado.** Quando "OP em andamento" está marcado, o número
de minutos que aparece na tela é resto do que estava antes ou o padrão do formulário — a
pessoa nunca escolheu aquilo. Por isso os tipos `bipes` e `op` usam o valor fixo.

### O que acontece na reabertura

- `estado` volta para `'aberta'` e `ultimo_envio_em` é renovado (o ciclo de lembrete
  recomeça do zero).
- Sai um envio do tipo `'alerta'` para os mesmos destinos da regra, com o texto marcando
  que é **reabertura**: além do conteúdo normal do alerta, diz que foi dado como resolvido
  por Fulano há X minutos e **continua fora do limite**. Sem isso, quem recebe acha que é
  um problema novo.
- `resolvida_por` e `resolvida_em` **são preservados** — são o que o texto da reabertura
  usa e o que mantém a auditoria honesta. A tela de ocorrências mostra "reaberta" quando
  houver reabertura, para a lista não dizer "resolvida às 10:00" numa ocorrência que voltou.
- O botão **Resolvido** volta a valer, porque a ocorrência está `aberta` de novo.

### Sem teto de reaberturas

Um limite de "no máximo N reaberturas" traria de volta exatamente o defeito que estamos
corrigindo: depois da última, silêncio. Se um problema fica 6 horas fora do limite, é certo
que ele avise 6 vezes. Guardamos a **contagem** (para aparecer na tela e para sabermos se
isso vira incômodo), mas ela não corta o aviso.

### Onde mexe

Migração **0122**:
- `alerta_ocorrencias`: colunas novas `reaberta_em timestamptz` e
  `reaberturas int not null default 0`.
- `alerta_avaliar`: no ramo em que a condição continua ruim e já existe ocorrência viva,
  **antes** do cálculo do lembrete, entra o sub-ramo de reabertura.
- Nada muda no índice único (`aberta` e `resolvida` já estavam os dois cobertos) nem na
  reserva de envios (o filtro `oc.estado = 'aberta'` volta a valer sozinho quando a
  ocorrência reabre).

Código:
- `src/modules/alertas/domain/envio.ts` — texto da reabertura.
- `src/modules/alertas/domain/ocorrencia.ts` e a lista de ocorrências — mostrar "reaberta"
  e a contagem.

---

# Parte 2 — Avisar num canal do Discord

## Decisões tomadas

1. **A regra escolhe o destino:** pessoas, canal, ou os dois.
2. **Canal único do sistema**, configurado no servidor (`DISCORD_CANAL_ID`), como foi feito
   com o convite. Se um dia existir mais de um grupo, vira campo na regra — o que for feito
   agora não precisa ser desfeito.
3. **Sem menção** (`@here`/cargo) por enquanto. Trocar depois é mudança pequena, mas fica
   registrado o efeito: **mensagem de canal sem menção é silenciosa** para quem não está
   com o Discord aberto. Se as lideranças não ligarem a notificação do canal na mão, o
   aviso pode passar despercebido.

## O conceito que precisa se separar

Hoje `alerta_regras.destinatarios` significa **duas coisas ao mesmo tempo**:

- quem **recebe** a mensagem, e
- quem tem **direito de encerrar** a ocorrência (`alerta_resolver_interno` recusa com
  `NAO_DESTINATARIO` quem não está na lista ou não administra o ShopFloor).

Com o canal entrando, isso precisa separar. Senão, uma regra que avisa **só no canal**
ficaria com o botão Resolvido visível para todos e **sem ninguém** que consiga apertar.

**Desenho:** `destinatarios` passa a significar **os responsáveis** — quem responde por
aquele alerta e pode encerrá-lo. Continua obrigatório ter pelo menos um. **Como** eles são
avisados passa a ser outra coisa:

- `avisar_pessoas boolean not null default true` — manda na conversa privada de cada
  responsável (é o comportamento de hoje).
- `avisar_canal boolean not null default false` — manda no canal do Discord.

"Só no canal" = `avisar_pessoas = false` e `avisar_canal = true`: ninguém recebe no
privado, todos veem no canal, e os responsáveis continuam podendo encerrar pelo botão.

**Validação:** `avisar_canal` só faz sentido com `'discord'` em `canais` (o canal é do
Discord; o Telegram continua só pessoal). E pelo menos um dos dois tem de estar ligado,
senão a regra não avisa ninguém.

## Fila de envio

A fila (`alerta_envios`) hoje exige `usuario_id not null`. Um envio para canal não tem
usuário. Migração **0123**:

- `usuario_id` deixa de ser obrigatório;
- colunas `destino_tipo text not null default 'usuario' check (destino_tipo in
  ('usuario','canal'))` e `destino_externo_id text` (o id do canal, resolvido no
  enfileiramento);
- `alerta_avaliar`: além do fan-out por pessoa que já existe, quando `avisar_canal`,
  enfileira **uma** linha por ocorrência com `destino_tipo = 'canal'` — uma, não uma por
  responsável, senão viram N mensagens iguais no mesmo canal;
- `alerta_reservar_envios`: hoje o `join` com `alerta_contas` é o que resolve o endereço, e
  é **inner** — uma linha de canal nunca seria reservada e ficaria pendente até expirar em
  24 h. A reserva passa a tratar os dois tipos, e os filtros de usuário
  (`usuarios.ativo`, `usuario_tem_permissao`) valem só para `destino_tipo = 'usuario'`.

## Envio no Discord

O endpoint é **o mesmo** já usado: `POST /channels/{id}/messages`. A única parte específica
de conversa privada é o `POST /users/@me/channels` que cria o canal de DM antes.

- `src/modules/alertas/infra/discord.ts` — método novo que manda direto no canal, sem a
  criação de DM. O id da mensagem (`"<canal>:<mensagem>"`) e a remoção do botão
  (`PATCH .../messages/{id}` com `components: []`) funcionam sem alteração, porque já são
  por canal + mensagem.
- `src/modules/alertas/application/portas.ts` e `infra/canais.ts` — a porta de canal hoje
  recebe só um `externoId` de pessoa; passa a receber o destino já resolvido pela fila.
- **Permissão do bot no Discord:** precisa de *Ver canal* e *Enviar mensagens* no canal
  escolhido. Conversa privada não precisava disso; se faltar, o envio falha e a fila
  tenta 3 vezes antes de desistir.

## Botão Resolvido no canal

Funciona sem mudança de código: o tratamento do clique já lê o autor tanto de conversa
privada quanto de servidor.

**Consequência de produto, não bug:** no canal, **todo mundo vê o botão**. Quem não é
responsável (ou não administra o ShopFloor) recebe um aviso de recusa que só ele enxerga.
Aceitável — mas é preciso saber que vai acontecer.

---

## O que NÃO muda em nenhuma das partes

- Os tipos de regra, as janelas, o mínimo de bipes e o cálculo de cada métrica.
- O Telegram: continua só na conversa privada.
- O fluxo de vínculo em Meu perfil.
- Quem pode encerrar uma ocorrência: responsável da regra **e** administrador do ShopFloor.

## Testes

**Parte 1** (SQL, no banco descartável, no modelo de `supabase/tests/`):
1. Ocorrência resolvida com condição ainda ruim **antes** da carência: continua
   `resolvida`, nenhum envio.
2. Mesma situação **depois** da carência: volta para `aberta`, `reaberturas = 1`, sai um
   envio de alerta.
3. Ocorrência resolvida cuja condição **normalizou**: vira `normalizada` e **não** reabre.
4. Carência por tipo de janela: `tempo` usa o valor da janela; `bipes` e `op` usam 60 min.
5. Piso e teto: janela de 5 min espera 15; janela de 7 dias espera 2 h.
6. Reabertura renova o ciclo de lembrete (o lembrete seguinte conta a partir dela).

**Parte 2:**
7. Regra com `avisar_canal` enfileira **uma** linha de canal por ocorrência, qualquer que
   seja o número de responsáveis.
8. Regra com os dois ligados enfileira as duas coisas; com `avisar_pessoas = false`,
   nenhuma linha de pessoa.
9. A reserva devolve linhas de canal (não são descartadas pela falta de conta vinculada).
10. Validação: `avisar_canal` sem `'discord'` nos canais é recusado; os dois desligados
    também.
11. Front: a tela de regras grava e lê as duas opções.

## Riscos

- **Parte 1 — alarme falso.** Toda a defesa contra isso é a carência sair da janela. Se
  alguém criar uma regra de janela curtíssima, o piso de 15 min segura; fora isso, é
  esperado que um problema não resolvido avise várias vezes — é o objetivo.
- **Parte 1 — incômodo.** Reabrir sem teto pode encher o canal quando um posto fica ruim a
  manhã inteira. A contagem de reaberturas existe justamente para medirmos isso depois de
  algumas semanas.
- **Parte 2 — aviso silencioso.** Sem menção, o alerta no canal só é visto por quem olha.
  É a decisão de hoje, mas se na prática alguém perder um alerta, a primeira coisa a mexer
  é isso.
- **Parte 2 — mexe na fila que está em produção.** `alerta_envios` é a tabela por onde
  passa todo alerta que funciona hoje. A migração precisa ser aditiva e a função de reserva
  precisa continuar entregando os envios de pessoa exatamente como entrega hoje.
