# Posto Almoxarifado — Fase 2 (a fila de envio ao Compels)

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`,
> tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** cada bipe do Almoxarifado entra numa fila de envio ao ERP, com chave de idempotência,
e o que não chegar lá fica visível numa tela onde alguém consegue reenviar.

**Arquitetura:** a fila copia o padrão que já roda em produção nos Alertas — tabela de envios com
tentativas e reserva, uma função `security definer` que reserva em lote com `for update skip
locked`, e uma rota chamada pelo crontab da instância. A diferença é o destino: em vez de Telegram e
Discord, o ERP.

**Pilha:** Next.js 16 (App Router) · TypeScript · Postgres/Supabase · Vitest.

## O que esta fase NÃO entrega, e por quê

**A chamada que fala com o Compels fica como uma função única, isolada e não implementada.** O
endpoint, a autenticação e o formato da carga dependem de uma resposta do fornecedor que ainda não
veio. Tudo o mais — a fila, a idempotência, as tentativas, a tela, o cron — não depende disso e é
construído agora.

**Consequência que precisa estar clara:** enquanto o último metro não existir, a fila **acumula e
não esvazia**. Isso é esperado, e a tela de pendências deve dizer isso com todas as letras, em vez
de parecer que tudo quebrou. O ganho de construir agora é que, no dia da resposta, falta um arquivo
em vez de uma semana — e o primeiro erro real já tem onde aparecer.

**Também fica de fora a métrica do estoque do Compels no card do Fluxo** (spec do posto, seção "As
métricas do posto"): ela depende do endpoint de leitura, que é a mesma conversa.

## Global Constraints

- **`AGENTS.md`:** esta versão do Next.js tem mudanças de API; leia `node_modules/next/dist/docs/`
  antes de escrever código de framework. Não confie na memória.
- Migração aditiva e idempotente: `if not exists`, `create or replace`, `drop policy if exists`.
- **Corpo de função com `$func$`, nunca `$$`** — o SQL Editor do Supabase recusa o de dois cifrões.
- Toda função nova: `revoke all ... from public, anon` e `grant execute ... to authenticated`; a
  migração termina com `notify pgrst, 'reload schema';`.
- Permissão é a função de **dois** argumentos. A de um argumento anula o RBAC.
- **A próxima migração livre é a 0132.** As 0128–0131 são da Fase 1 e ainda não foram aplicadas em
  banco nenhum; 0094, 0100, 0101 e 0113–0116 estão em produção e **não podem ser editadas**.
- Português do Brasil em tudo o que o usuário lê.
- Rodar teste só do que se toca, com `--exclude "**/.claude/**"`. **Nunca a suíte inteira** — a
  máquina do usuário tem 4 núcleos.
- `git add` com caminhos explícitos: há um `appscript/Rastreador-do-Pedido.pdf` solto que não é nosso.

---

### Task 1: a fila

**Arquivos:**
- Criar: `supabase/migrations/0132_sf_estoque_envios.sql`
- Criar: `supabase/tests/estoque_envios_test.sql` e `supabase/tests/rodar-estoque-envios-test.sh`

**Produz:** a tabela `sf_estoque_envios` e a função `sf_estoque_reservar(p_limite int)`.

O molde é `supabase/migrations/0113_alertas.sql` (a tabela `alerta_envios`) e a
`alerta_reservar_envios` em `0115_alertas_tipos.sql` — **leia as duas antes de escrever**, e siga a
mesma forma: `ok`, `erro`, `tentativas`, `reservado_em`, `enviado_em`, e a reserva com
`for update skip locked` mais o teto de tentativas e a janela de reserva vencida.

O que muda em relação ao molde dos Alertas, e por quê:

- **A chave de idempotência é obrigatória e única.** É o que impede a mesma entrada de virar duas no
  ERP quando alguém reenvia. Use o que identifica o bipe sem ambiguidade — decida e explique no
  cabeçalho.
- **A linha guarda o que o ERP precisa saber:** PMO, OP, o que foi bipado e a quantidade. Não guarde
  a carga montada: o formato dela ainda vai mudar, e carga velha numa fila é armadilha.
- **Sem teto de 24 horas.** Nos Alertas, mensagem velha não interessa mais; aqui, entrada que não
  chegou ao ERP continua interessando semanas depois. Não copie essa parte.

Os testes cobrem: reserva em lote respeitando o limite · duas reservas concorrentes não pegam a
mesma linha · linha reservada há muito tempo volta a ser reservável · teto de tentativas ·
idempotência da migração.

---

### Task 2: o bipe enfileira

**Arquivos:**
- Modificar: `supabase/migrations/0129_sf_almoxarifado_entrada.sql` (ainda não aplicada em lugar
  nenhum — pode ser editada no lugar)
- Modificar: `supabase/tests/almoxarifado_test.sql`

A RPC de entrada passa a **gravar na fila dentro da mesma transação** em que grava os registros. Na
mesma transação, e não depois, pelo motivo de sempre: se o `insert` dos registros vingar e o da fila
não, a peça está no ShopFloor e nunca vai para o ERP, sem ninguém saber.

**O cancelamento também entra na fila**, com sinal trocado — é o estorno. A `sf_cancelar_caixa_almoxarifado`
(0131) e o cancelamento de linha avulsa precisam enfileirar a reversão. ⚠️ Se a entrada
correspondente **ainda não foi enviada**, o certo não é enfileirar um estorno: é **cancelar o envio
pendente**, senão manda-se para o ERP uma entrada e uma saída que nunca precisaram existir. Trate os
dois casos e teste os dois.

---

### Task 3: o envio, com o último metro em aberto

**Arquivos:**
- Criar: `src/modules/shopfloor/application/enviar-estoque.ts`
- Criar: `src/modules/shopfloor/infra/estoque-envios-repository.ts`
- Criar: `src/modules/shopfloor/infra/compels.ts`

O laço: reserva um lote, envia um a um, marca cada um como enviado ou com erro. O molde é
`src/modules/alertas/application/enviar-alertas.ts`.

**`compels.ts` é o último metro.** Ele expõe uma função só — receber uma entrada e devolver sucesso
ou o motivo da falha — e **não está implementado**: devolve uma falha explicando que a integração
ainda não foi configurada. Deixe o arquivo com um cabeçalho dizendo exatamente o que falta saber
(endpoint, autenticação, formato, e se gravar saldo movimenta o estoque de verdade), para quem
assumir não precisar procurar.

O laço tem de tratar essa falha como **qualquer outra falha de envio** — conta tentativa, guarda o
motivo, e a linha fica na fila. Nada de caminho especial para "não configurado": no dia em que o
`compels.ts` for escrito, nada mais muda.

---

### Task 4: o cron

**Arquivos:**
- Criar: `src/app/api/shopfloor/estoque/route.ts`
- Modificar: `tools/` (o README do cron, junto do dos alertas)

Copie a forma de `src/app/api/alertas/avaliar/route.ts`, inclusive: `dynamic = 'force-dynamic'`, o
segredo em variável de ambiente, `Bearer` no cabeçalho comparado com a função de comparação
constante que já existe, **503 quando não configurado** e 503 quando o banco está fora — porque o
RDS é desligado fora do horário pelo plano de economia, e isso não é erro.

O segredo **nunca** vai no `argv`: o comando do crontab usa um arquivo de cabeçalho com permissão
600, como o dos alertas. Documente a linha do crontab.

---

### Task 5: a tela de pendências

**Arquivos:**
- Criar: `src/app/(app)/shopfloor/analisar/estoque-pendente/page.tsx` e o componente da lista
- Criar: a action de reenviar

Uma aba em Análise, no molde da tela de Cancelamentos (`shopfloor/analisar/cancelamentos`). Mostra
o que ainda não chegou ao ERP: quando foi bipado, qual OP, o que foi bipado, quantas peças, quantas
tentativas e **o motivo do último erro**.

**Tem botão de reenviar** — sem ele, quem vê o problema não tem o que fazer além de chamar o
desenvolvedor. O reenviar zera a reserva e deixa a linha elegível de novo; ele **não** chama o ERP
direto, para não ter dois caminhos de envio.

**Enquanto o último metro não existir, a tela tem de dizer isso na cara**, com uma frase fixa no
topo — algo como *"A integração com o Compels ainda não foi configurada: as entradas ficam
guardadas aqui até isso acontecer."* Sem esse aviso, a primeira pessoa que abrir vai achar que
quebrou tudo.

Gate: `shopfloor:visualizar` para ver, `shopfloor:administrar` para reenviar.

---

## Depois das cinco tarefas

1. Revisão da branch inteira com `superpowers:requesting-code-review`.
2. Aplicar a 0132 (e a 0129 alterada) no Dev, com o smoke da Fase 1 junto.
3. A conversa com o Valdeí fecha o `compels.ts` — e aí a fila esvazia sozinha.
