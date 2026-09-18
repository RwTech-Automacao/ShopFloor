# Alertas de taxa de aprovação por posto — design

**Card:** Tela para configurar alertas (Sprint 14/09/2026).
**Branch:** `feat/shopfloor-alertas`. **Migração:** `0113_alertas.sql` (0110–0112 são do módulo Setup).

## 1. Objetivo

O gestor recebe no **Telegram** e/ou no **Discord** um aviso quando a taxa de aprovação de um posto cai abaixo de um limite que ele configurou. A pessoa marca o alerta como **Resolvido** pelo próprio botão da mensagem.

## 2. Decisões

| # | Decisão |
|---|---|
| 1 | Canais: **Telegram e Discord**, os dois bots criados do zero pela empresa. Envio **direto** (mensagem privada do bot), sem n8n. |
| 2 | O gestor cria **várias regras**. Cada regra: nome, postos, taxa mínima (%), janela, mínimo de bipes, lembrete, canais, destinatários, ativa. |
| 3 | **Janela configurável por regra:** `tempo` (últimos X minutos, padrão 60, no máximo 7 dias = 10080 min) · `bipes` (últimos N bipes do posto, olhando no máximo 30 dias, padrão 50) · `op` (acumulado da OP em andamento no posto). |
| 4 | **Mínimo de bipes** na janela antes de avaliar (padrão 20). Abaixo disso a regra não decide nada. |
| 5 | **Destinatários escolhidos na regra**, entre usuários com Telegram/Discord vinculado. |
| 6 | **Vínculo por código:** a pessoa gera `ALERTA-XXXX` em "Meu perfil" e envia ao bot (Telegram: mensagem; Discord: `/vincular`). Vale 15 min, uso único. |
| 7 | **Repetição:** um alerta quando cai + lembrete a cada X min (opcional, vazio = sem lembrete) + aviso quando normaliza. |
| 8 | **Resolvido:** botão na mensagem, qualquer destinatário da regra aperta. Para os lembretes **até a taxa voltar ao normal**; se cair de novo depois disso, abre ocorrência nova. Também dá pra resolver pela tela. |
| 9 | **Quem configura regras:** permissão `shopfloor.administrar` (a mesma de Postos/Defeitos). Vincular Telegram/Discord: **qualquer usuário**. |
| 10 | **Avaliação por checagem a cada 5 minutos**, disparada pelo **crontab da Lightsail** chamando uma rota do app. Alerta chega em até 5 min. |
| 11 | **Fila de envio no banco (outbox):** a avaliação grava a decisão E as mensagens pendentes (uma por destinatário × canal vinculado) na **mesma transação**. O app só entrega o que está na fila, reservando lotes de forma atômica. Nada se perde se o processo cair entre decidir e enviar, e duas rodadas simultâneas nunca mandam a mesma mensagem. |
| 12 | **Excluir regra é exclusão lógica** (`excluida_em`): a regra some da lista e para de alertar; o histórico de ocorrências e envios continua, com o nome da regra marcado "(excluída)". Nenhum caminho apaga regra fisicamente. |
| 13 | Fora do escopo desta versão: resumo por turno, outras métricas (tempo parado, fila), grupo/canal da equipe como destino, horário de silêncio, webhook genérico. |

## 3. Taxa de aprovação

- Conta **bipes** (registros de `sf_registros`) do posto dentro da janela.
- `taxa = aprovados ÷ (aprovados + reprovados) × 100`, com `lower(status) = 'aprovado'` / `'reprovado'` (mesma régua de status do Dashboard, 0101). Bipes sem esses status (ex.: "Registrado") ficam fora da conta e do mínimo de bipes.
- **Janela `tempo`:** bipes do posto com `data_hora >= now() - X min`, de todas as OPs. Teto de **7 dias** (10080 min), no `validarRegra` e num check da 0113.
- **Janela `bipes`:** últimos N bipes, olhando no máximo 30 dias — os N bipes mais recentes com status aprovado/reprovado do posto, de todas as OPs, dentro dos últimos 30 dias.
- **Janela `op`:** OP do último bipe do posto; se esse bipe tem mais de 2 horas, o posto não é avaliado. Taxa = todos os bipes daquele posto nessa OP. A ocorrência continua sendo por regra × posto e guarda a PMO/OP em que abriu; se a OP em andamento mudar, a avaliação segue pela OP nova (normaliza quando a OP nova estiver dentro da meta).
- Comparação: **abaixo** = `taxa < taxa_minima`. **Normalizou** = `taxa >= taxa_minima` com o mínimo de bipes.

## 4. Dados (migração 0113)

Convenções: `$func$`, `(select tem_permissao(...))` nas policies, GRANT explícito a `authenticated` e `service_role`, `notify pgrst, 'reload schema'` no fim.

- **`alerta_contas`** — `usuario_id` (FK usuarios), `canal` (`telegram`|`discord`), `externo_id` (chat id / user id), `vinculado_em`. Único `(usuario_id, canal)` e `(canal, externo_id)`.
  RLS: o usuário lê e apaga só a própria linha; insert só pelo servidor.
- **`alerta_codigos`** — `codigo` (PK), `usuario_id`, `expira_em` (now + 15 min), `usado_em`. RLS: o usuário lê os próprios; insert só por função.
- **`alerta_regras`** — `id`, `nome`, `postos text[]`, `taxa_minima numeric(5,2)` (0–100), `janela_tipo` (`tempo`|`bipes`|`op`), `janela_valor int` (null no tipo `op`), `minimo_bipes int` (padrão 20), `lembrete_min int` (null = sem lembrete), `canais text[]`, `destinatarios uuid[]`, `ativa bool`, **`excluida_em timestamptz`** (exclusão lógica; check `excluida_em is null or not ativa`), `criado_por`, `criado_em`, `atualizado_em`.
  RLS: select/insert/update com `shopfloor.administrar`; update só em regra **não excluída** (excluída não volta nem é editada); **sem policy de DELETE** (e `delete` revogado de `authenticated`). "Excluir" = `update set excluida_em = now(), ativa = false`.
- **`alerta_ocorrencias`** — `id`, `regra_id` (FK, **`on delete restrict`** — histórico nunca some por cascata), `posto`, `pmo`, `op` (só janela `op`), `estado` (`aberta`|`resolvida`|`normalizada`), `taxa_abertura`, `taxa_ultima`, `aprovados`, `reprovados`, `aberta_em`, `resolvida_por`, `resolvida_em`, `normalizada_em`, `ultimo_envio_em`.
  **Índice único parcial** `(regra_id, posto) where estado in ('aberta','resolvida')` — no máximo uma ocorrência viva por regra × posto.
  RLS: select/update com `shopfloor.administrar`.
- **`alerta_envios`** — **fila de saída + auditoria**. `id`, `ocorrencia_id`, `usuario_id`, `canal`, `tipo` (`alerta`|`lembrete`|`resolvido`|`normalizou`|`teste`), `dados jsonb` (o que o app precisa para montar o texto: regra, posto, taxa, meta, contagens, janela, PMO/OP, datas; no `resolvido`: posto, quem resolveu e quando), `texto` (preenchido ao entregar), `com_botao`, `mensagem_externa_id`, `ok bool`, `erro text`, `tentativas int`, `reservado_em`, `enviado_em` (check `ok = (enviado_em is not null)`), `criado_em`. RLS: select com `shopfloor.administrar`.
  Estados: **pendente** = `ok = false e tentativas < 3` (nova com `tentativas = 0`); **reservada** = pendente com `reservado_em` nos últimos 15 min; **entregue** = `ok`; **desistiu** = `ok = false e tentativas >= 3`.
- **Índice novo em `sf_registros`:** `(posto, data_hora desc)` — as janelas `tempo`/`bipes` leem por posto em todas as OPs (o índice atual começa por pmo/op). Criado com `create index concurrently if not exists` em arquivo próprio se o SQL Editor exigir (ver 0095).

**Funções:**
- `alerta_gerar_codigo()` — `security definer`, gera código para `auth.uid()`, invalida os anteriores não usados.
- `alerta_vincular(p_codigo, p_canal, p_externo_id)` — só `service_role`; valida código (existe,
  não usado, não expirado — as três coisas viram o mesmo erro `CODIGO_INVALIDO`, pra não indicar
  a quem tenta adivinhar que chegou perto), grava/atualiza `alerta_contas`, marca o código usado.
  Tem proteção contra força bruta: 5+ falhas do mesmo `(canal, externo_id)` em 15 min bloqueiam
  (`alerta_tentativas`, sem RLS/grant nenhum pra `authenticated`/`anon`). **Nunca levanta exceção
  de regra de negócio** — retorna sempre `jsonb`: sucesso `{"ok": true, "nome": "<nome>"}`, falha
  `{"ok": false, "erro": "CANAL_INVALIDO" | "CODIGO_INVALIDO" | "CONTA_JA_VINCULADA" |
  "MUITAS_TENTATIVAS"}`. (Motivo: a proteção contra força bruta precisa gravar a tentativa falha
  ANTES de sinalizar o erro, e um `raise exception` sem tratamento desfaz a transação inteira da
  chamada — inclusive esse insert.)
- `alerta_avaliar()` — só `service_role`; pega `pg_try_advisory_xact_lock`; se não conseguir retorna `{ ocupado: true }`. Calcula as taxas de todas as regras ativas **e não excluídas** × postos numa consulta, aplica as transições (abrir / lembrar / normalizar) e, **na mesma transação**, insere em `alerta_envios` uma linha **pendente** (`ok=false`, `tentativas=0`, `dados`, `com_botao` = alerta/lembrete) por destinatário × canal da regra que tenha conta vinculada **naquele momento**. Retorna `{ ocupado, avaliadas, enfileirados, normalizadas: [ocorrência] }` — `normalizadas` inclui as encerradas sem envio (regra desativada/excluída, posto removido), para o app tirar os botões. A decisão fica no banco para ser atômica com o índice único.
- `alerta_reservar_envios(p_canais, p_limite = 30, p_ocorrencia_id = null)` — só `service_role`. Numa instrução: escolhe pendentes das últimas 24 h, dos canais configurados no app, de quem ainda tem conta vinculada (devolve o `externo_id` atual), nunca `teste`, alerta/lembrete só com ocorrência `aberta`, sem reserva viva (15 min); ordena **novas (tentativas = 0) antes de reenvios**; trava com `for update skip locked`, soma 1 em `tentativas` e grava `reservado_em`. Duas rodadas simultâneas nunca pegam a mesma linha.
- `alerta_resolver(p_ocorrencia_id, p_usuario_id)` — só `service_role` (webhook) ou via app com `shopfloor.administrar` (`alerta_resolver_admin`); só resolve se o usuário for destinatário da regra (ou admin pela tela) e a ocorrência estiver `aberta`. Idempotente (`resolvida` → retorna sem erro, com quem resolveu). Na primeira resolução, **enfileira na mesma transação** o "✅ resolvido por" para os outros destinatários com conta vinculada.
- `alerta_listar_ocorrencias(p_de, p_ate, p_estado)` — `shopfloor.administrar`; o nome da regra excluída vem com o sufixo " (excluída)"; `envios_falha` conta só envio que tentou e errou (pendente ainda não tentado não é falha).
- `alerta_previa(p_postos, p_janela_tipo, p_janela_valor, p_minimo)` — `shopfloor.administrar`; devolve a taxa atual de cada posto sem gravar nada (prévia no formulário).

## 5. Transições (por regra × posto, a cada avaliação)

| Estado atual | Condição | Ação | Envio |
|---|---|---|---|
| sem ocorrência viva | abaixo e com mínimo | cria `aberta` | `alerta` |
| `aberta` | abaixo e `lembrete_min` preenchido e `now() - ultimo_envio_em >= lembrete_min` | atualiza `taxa_ultima`, `ultimo_envio_em` | `lembrete` |
| `aberta` ou `resolvida` | normal (≥ meta) e com mínimo | `normalizada` | `normalizou` |
| `resolvida` | abaixo | nada (sem lembrete) | — |
| qualquer | sem o mínimo de bipes | nada | — |
| regra desativada/excluída ou posto removido da regra | — | ocorrência viva vira `normalizada` sem envio (entra em `normalizadas`: o app tira os botões) | — |

Regra excluída (`excluida_em` preenchido) não é avaliada: não abre, não lembra, não normaliza com aviso. "Envio" nesta tabela = linha pendente criada na fila, na mesma transação da transição.

## 6. Envio

- **Fila (outbox):** o banco cria as linhas pendentes (seção 4); o app tem **um único caminho de entrega**: `alerta_reservar_envios` → monta o texto a partir de `dados` (formatação só no TS: fuso de São Paulo, taxa truncada) → envia → atualiza **a própria linha** (`ok`, `erro`, `mensagem_externa_id`, `texto`, `enviado_em`; solta a reserva). Um erro num item (inclusive montar o texto) não derruba a rodada: a linha é concluída como falha e volta na próxima. Lote de 30 por rodada.
- Um envio por destinatário × canal da regra que tenha conta vinculada **no momento da avaliação**; na entrega usa o `externo_id` da conta de agora (quem desvinculou não recebe). Destinatário sem vínculo no canal: pulado (a tela já avisa). **Usuário desativado** não recebe nada (nem alerta/lembrete/normalizou, nem "resolvido"), mesmo que continue no array `destinatarios`; se ele for desativado depois de a linha ser enfileirada, a reserva não a pega — ela fica pendente e vence em 24 h sem contar como falha. No diálogo da regra, destinatário salvo que ficou inativo (ou foi removido) sai da seleção ao abrir, com o aviso "N destinatário(s) inativo(s) removido(s) da regra — salve para confirmar".
- **"Enviar teste"** (Meu perfil) **não passa pela fila**: entrega na hora (a pessoa precisa do resultado) e grava a linha já final (`tentativas = 1`); teste que falhou não é reenviado.
- **"Resolvido por"**: enfileirado pelo `alerta_resolver`; o webhook (ou a ação da tela) adianta a entrega só daquela ocorrência. Se falhar, o cron entrega.
- **Telegram:** `sendMessage` com `inline_keyboard` [✅ Resolvido] (`callback_data = r:<ocorrencia_id>`), em alerta e lembrete.
- **Discord:** abre DM (`POST /users/@me/channels`) e envia com componente botão (`custom_id = r:<ocorrencia_id>`).
- Guarda `mensagem_externa_id` para editar a mensagem depois (tirar o botão).
- **Falha:** grava `ok=false`, `erro` na própria linha; a próxima rodada tenta de novo enquanto `tentativas < 3` (reenvios depois das mensagens novas). Depois disso fica visível na aba Ocorrências. Processo que cai no meio de uma entrega: a reserva vence em 15 min e a linha volta (entrega "pelo menos uma vez").
- Sem token de um canal: as linhas daquele canal não são reservadas e expiram depois de 24 h.
- Sem token configurado para um canal: não envia por ele e a tela mostra "Telegram não configurado" / "Discord não configurado".

**Textos:**
- Alerta: `🔴 {posto} abaixo da meta` / `Taxa: {taxa}% {janela} (mínimo {meta}%) · {aprovados} aprovados, {reprovados} reprovados` / `Regra: {nome} · {dd/mm HH:mm}`. Janela: "na última hora" / "nos últimos 90 minutos" / "nos últimos 50 bipes" / "na OP {pmo}/{op}".
- Lembrete: `⏰ Lembrete — continua abaixo há {min} min` + mesmo corpo.
- Resolvido (para os outros destinatários): `✅ {posto}: resolvido por {nome} às {HH:mm}`.
- Normalizou: `🟢 {posto} normalizou: {taxa}% (ficou {duração} abaixo)`.
- Taxa com 1 casa decimal, truncada (mesma regra do Dashboard).

## 7. Rotas (App Router, `src/app/api/alertas/`)

- `POST /api/alertas/avaliar` — exige cabeçalho `Authorization: Bearer $ALERTAS_CRON_SECRET`; chama `alerta_avaliar()` com a service key (decide e enfileira), entrega a fila (novas e reenvios) e tira os botões das ocorrências normalizadas. Responde `{ avaliadas, enfileirados, enviados, falhas, ocupado }`. Banco indisponível → 503 e log, sem exceção não tratada.
- `POST /api/alertas/telegram` — exige `X-Telegram-Bot-Api-Secret-Token = $TELEGRAM_WEBHOOK_SECRET`.
  - mensagem de texto com `ALERTA-XXXX` → `alerta_vincular` → responde "✅ Conta vinculada ao ShopFloor ({nome})" ou o erro em texto;
  - `/start` sem código → instrução de como vincular;
  - `callback_query` `r:<id>` → identifica o usuário pela conta vinculada → `alerta_resolver` → `answerCallbackQuery`, edita a mensagem (sem botão) e envia "resolvido por" aos outros destinatários.
  - Sempre responde 200 (o Telegram reenvia em erro).
- `POST /api/alertas/discord` — verifica assinatura Ed25519 (`X-Signature-Ed25519`, `X-Signature-Timestamp`) com `DISCORD_PUBLIC_KEY` via `crypto` do Node; inválida → 401.
  - `PING` → `PONG`;
  - comando `/vincular codigo:<texto>` → `alerta_vincular` → resposta efêmera;
  - botão `r:<id>` → `alerta_resolver` → atualiza a mensagem (sem botão) e avisa os outros.
- **Botão "Avaliar agora"** na tela de alertas (admin): server action que chama a mesma lógica da rota `avaliar` (para o preview da Vercel, que não tem crontab). Rodar junto com o cron não duplica mensagem: a avaliação tem trava e a entrega sai da fila por reserva atômica.

Nenhuma dependência nova: `fetch` e `node:crypto`.

## 8. Telas

### 8.1 Meu perfil (`/perfil`, qualquer usuário logado)
Acesso pelo nome do usuário no cabeçalho → "Meu perfil". Cartão **Alertas** com uma linha por canal:
- **Não vinculado:** botão **Vincular** → mostra o código, contador de 15 min e as instruções (Telegram: link `https://t.me/<bot>` + "envie o código"; Discord: "no servidor da Enterplak, digite `/vincular <código>`"). A tela consulta o vínculo a cada 3 s enquanto o código está aberto e mostra "✅ Vinculado".
- **Vinculado:** "Vinculado em dd/mm" + **Enviar teste** + **Desvincular** (com confirmação).
- Canal sem token configurado: linha desabilitada com "Não configurado neste ambiente".

### 8.2 Configurações › Ajustes ShopFloor › Alertas (`/configuracoes/sf-alertas`, `shopfloor.administrar`)
- **Aba Regras:** tabela (nome, postos, taxa mínima, janela, destinatários, canais, interruptor Ativa) + **Nova regra**, editar, excluir (confirmação: "A regra sai da lista e para de alertar; o histórico de ocorrências continua disponível."). Regras excluídas não aparecem. Botão **Avaliar agora**.
- **Diálogo da regra:** nome; postos (multisseleção de `sf_postos`); taxa mínima (0–100, até 2 casas); janela (rádio: últimos [60] minutos / últimos [50] bipes / OP em andamento); mínimo de bipes [20]; lembrar a cada [ ] min; canais (Telegram, Discord); destinatários (multisseleção de usuários ativos, com "Telegram ✓ · Discord —"; aviso se alguém não tem o canal escolhido); **prévia** com a taxa atual de cada posto (`alerta_previa`). Validação: pelo menos 1 posto, 1 canal e 1 destinatário.
- **Aba Ocorrências:** filtros período e estado; colunas regra, posto (OP), taxa ao abrir, última taxa, estado, aberta em, resolvida por/em, normalizada em, envios (ok/falha). Ação **Marcar resolvida** em ocorrência aberta.

Feedback das telas de cadastro: toast embaixo (padrão do projeto).

## 9. Operação

- **Variáveis** (só no `.env.production` da Lightsail e, para testar, no `.env.local`/Vercel Preview): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `ALERTAS_CRON_SECRET`, e `SUPABASE_SERVICE_ROLE_KEY` (já existe).
- **Script** `tools/alertas/configurar-bots.mjs`: registra o webhook do Telegram (`setWebhook` com `secret_token`) e o comando `/vincular` no servidor do Discord. Lê as variáveis do ambiente; nunca imprime tokens.
- **Crontab** (Lightsail): `*/5 * * * * curl -fsS -m 60 -X POST -H "Authorization: Bearer $ALERTAS_CRON_SECRET" https://shopfloor.enterplak.com.br/api/alertas/avaliar >> ~/alertas.log 2>&1` (o segredo lido de um arquivo com permissão 600, não escrito na linha).
- **Com o RDS desligado** (Plano A, 19:00–06:00): a rota responde 503 e o log registra; nada mais.
- **Passo a passo de criação dos bots** vai no README da pasta `tools/alertas/`.

## 10. Testes

- **Domínio (vitest):** cálculo e formatação da taxa (truncada); textos das mensagens e da janela; parse de `ALERTA-XXXX` e de `r:<id>`; verificação de assinatura Discord (vetor conhecido); montagem dos payloads Telegram/Discord.
- **Banco (Postgres descartável via Docker, como `supabase/tests/rodar-setup-test.sh`):** as três janelas; mínimo de bipes; transições da seção 5; índice único impede duas ocorrências vivas; código expira e é de uso único; `alerta_resolver` só para destinatário e idempotente; trava do `alerta_avaliar`; fila (linhas pendentes na mesma transação, reserva atômica e concorrente, novas antes de reenvios, teto de 3); exclusão lógica de regra (histórico mantido, regra excluída não avalia).
- **Rotas:** avaliar sem segredo → 401; Telegram sem secret → 401/ignorado; Discord com assinatura inválida → 401.
- **Smoke real:** criar os bots, vincular a própria conta, regra com meta alta para disparar, "Avaliar agora": alerta, lembrete, Resolvido (mensagem perde o botão), normalizou (regra com meta baixa).

## 11. Riscos

- **Mensagem privada no Discord** só funciona se o usuário estiver no servidor da empresa e aceitar DMs de membros do servidor; o `Enviar teste` do perfil expõe o problema cedo.
- **Telegram** só entrega a quem apertou Iniciar — garantido pelo vínculo por código.
- **Carga:** `alerta_avaliar` a cada 5 min com o índice `(posto, data_hora)`; regras × postos são poucas dezenas.
- **Perda de alerta entre decidir e enviar — resolvido pela fila.** Antes, o banco gravava a ocorrência e o app montava e enviava depois; se o processo caísse no meio (ou a gravação da falha falhasse), o alerta sumia sem registro. Agora a mensagem nasce pendente na mesma transação da decisão, e só sai da fila quando uma entrega grava o resultado.
- **Envio em dobro** (cron atrasado + "Avaliar agora", ou webhook + cron) — **resolvido pela reserva atômica**. Resta o caso raro de o processo cair **depois** de enviar e **antes** de gravar o resultado: a reserva vence e a mensagem sai de novo (entrega "pelo menos uma vez").
- **Botão velho:** um alerta reservado antes de a ocorrência normalizar pode ser entregue logo depois, ainda com o botão. Apertar dá "Esta ocorrência já normalizou" e remove os botões (Task 6).
