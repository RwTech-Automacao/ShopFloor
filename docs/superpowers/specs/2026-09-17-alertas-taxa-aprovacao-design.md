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
| 3 | **Janela configurável por regra:** `tempo` (últimos X minutos, padrão 60) · `bipes` (últimos N bipes do posto, padrão 50) · `op` (acumulado da OP em andamento no posto). |
| 4 | **Mínimo de bipes** na janela antes de avaliar (padrão 20). Abaixo disso a regra não decide nada. |
| 5 | **Destinatários escolhidos na regra**, entre usuários com Telegram/Discord vinculado. |
| 6 | **Vínculo por código:** a pessoa gera `ALERTA-XXXX` em "Meu perfil" e envia ao bot (Telegram: mensagem; Discord: `/vincular`). Vale 15 min, uso único. |
| 7 | **Repetição:** um alerta quando cai + lembrete a cada X min (opcional, vazio = sem lembrete) + aviso quando normaliza. |
| 8 | **Resolvido:** botão na mensagem, qualquer destinatário da regra aperta. Para os lembretes **até a taxa voltar ao normal**; se cair de novo depois disso, abre ocorrência nova. Também dá pra resolver pela tela. |
| 9 | **Quem configura regras:** permissão `shopfloor.administrar` (a mesma de Postos/Defeitos). Vincular Telegram/Discord: **qualquer usuário**. |
| 10 | **Avaliação por checagem a cada 5 minutos**, disparada pelo **crontab da Lightsail** chamando uma rota do app. Alerta chega em até 5 min. |
| 11 | Fora do escopo desta versão: resumo por turno, outras métricas (tempo parado, fila), grupo/canal da equipe como destino, horário de silêncio, webhook genérico. |

## 3. Taxa de aprovação

- Conta **bipes** (registros de `sf_registros`) do posto dentro da janela.
- `taxa = aprovados ÷ (aprovados + reprovados) × 100`, com `lower(status) = 'aprovado'` / `'reprovado'` (mesma régua de status do Dashboard, 0101). Bipes sem esses status (ex.: "Registrado") ficam fora da conta e do mínimo de bipes.
- **Janela `tempo`:** bipes do posto com `data_hora >= now() - X min`, de todas as OPs.
- **Janela `bipes`:** os últimos N bipes com status aprovado/reprovado do posto, de todas as OPs, sem limite de tempo.
- **Janela `op`:** OP do último bipe do posto; se esse bipe tem mais de 2 horas, o posto não é avaliado. Taxa = todos os bipes daquele posto nessa OP. A ocorrência continua sendo por regra × posto e guarda a PMO/OP em que abriu; se a OP em andamento mudar, a avaliação segue pela OP nova (normaliza quando a OP nova estiver dentro da meta).
- Comparação: **abaixo** = `taxa < taxa_minima`. **Normalizou** = `taxa >= taxa_minima` com o mínimo de bipes.

## 4. Dados (migração 0113)

Convenções: `$func$`, `(select tem_permissao(...))` nas policies, GRANT explícito a `authenticated` e `service_role`, `notify pgrst, 'reload schema'` no fim.

- **`alerta_contas`** — `usuario_id` (FK usuarios), `canal` (`telegram`|`discord`), `externo_id` (chat id / user id), `vinculado_em`. Único `(usuario_id, canal)` e `(canal, externo_id)`.
  RLS: o usuário lê e apaga só a própria linha; insert só pelo servidor.
- **`alerta_codigos`** — `codigo` (PK), `usuario_id`, `expira_em` (now + 15 min), `usado_em`. RLS: o usuário lê os próprios; insert só por função.
- **`alerta_regras`** — `id`, `nome`, `postos text[]`, `taxa_minima numeric(5,2)` (0–100), `janela_tipo` (`tempo`|`bipes`|`op`), `janela_valor int` (null no tipo `op`), `minimo_bipes int` (padrão 20), `lembrete_min int` (null = sem lembrete), `canais text[]`, `destinatarios uuid[]`, `ativa bool`, `criado_por`, `criado_em`, `atualizado_em`.
  RLS: select/insert/update/delete com `shopfloor.administrar`.
- **`alerta_ocorrencias`** — `id`, `regra_id` (FK, cascade), `posto`, `pmo`, `op` (só janela `op`), `estado` (`aberta`|`resolvida`|`normalizada`), `taxa_abertura`, `taxa_ultima`, `aprovados`, `reprovados`, `aberta_em`, `resolvida_por`, `resolvida_em`, `normalizada_em`, `ultimo_envio_em`.
  **Índice único parcial** `(regra_id, posto) where estado in ('aberta','resolvida')` — no máximo uma ocorrência viva por regra × posto.
  RLS: select/update com `shopfloor.administrar`.
- **`alerta_envios`** — `id`, `ocorrencia_id`, `usuario_id`, `canal`, `tipo` (`alerta`|`lembrete`|`resolvido`|`normalizou`|`teste`), `mensagem_externa_id`, `ok bool`, `erro text`, `tentativas int`, `criado_em`. RLS: select com `shopfloor.administrar`.
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
- `alerta_avaliar()` — só `service_role`; pega `pg_try_advisory_xact_lock`; se não conseguir retorna `{ ocupado: true }`. Calcula as taxas de todas as regras ativas × postos numa consulta, aplica as transições (abrir / lembrar / normalizar) e retorna a lista de **ações de envio** (ocorrência, tipo, posto, taxas, contagens, regra, destinatários, canais). A decisão fica no banco para ser atômica com o índice único.
- `alerta_resolver(p_ocorrencia_id, p_usuario_id)` — só `service_role` (webhook) ou via app com `shopfloor.administrar`; só resolve se o usuário for destinatário da regra (ou admin pela tela) e a ocorrência estiver `aberta`. Idempotente (`resolvida` → retorna sem erro, com quem resolveu).
- `alerta_previa(p_postos, p_janela_tipo, p_janela_valor, p_minimo)` — `shopfloor.administrar`; devolve a taxa atual de cada posto sem gravar nada (prévia no formulário).

## 5. Transições (por regra × posto, a cada avaliação)

| Estado atual | Condição | Ação | Envio |
|---|---|---|---|
| sem ocorrência viva | abaixo e com mínimo | cria `aberta` | `alerta` |
| `aberta` | abaixo e `lembrete_min` preenchido e `now() - ultimo_envio_em >= lembrete_min` | atualiza `taxa_ultima`, `ultimo_envio_em` | `lembrete` |
| `aberta` ou `resolvida` | normal (≥ meta) e com mínimo | `normalizada` | `normalizou` |
| `resolvida` | abaixo | nada (sem lembrete) | — |
| qualquer | sem o mínimo de bipes | nada | — |
| regra desativada/excluída ou posto removido da regra | — | ocorrência viva vira `normalizada` sem envio | — |

## 6. Envio

- Um envio por destinatário × canal da regra que tenha conta vinculada. Destinatário sem vínculo no canal: pulado (a tela já avisa).
- **Telegram:** `sendMessage` com `inline_keyboard` [✅ Resolvido] (`callback_data = r:<ocorrencia_id>`), em alerta e lembrete.
- **Discord:** abre DM (`POST /users/@me/channels`) e envia com componente botão (`custom_id = r:<ocorrencia_id>`).
- Guarda `mensagem_externa_id` para editar a mensagem depois (tirar o botão).
- **Falha:** grava `ok=false`, `erro`; a próxima avaliação reenvia envios com `ok=false` e `tentativas < 3`. Depois disso fica visível na aba Ocorrências.
- Sem token configurado para um canal: não envia por ele e a tela mostra "Telegram não configurado" / "Discord não configurado".

**Textos:**
- Alerta: `🔴 {posto} abaixo da meta` / `Taxa: {taxa}% {janela} (mínimo {meta}%) · {aprovados} aprovados, {reprovados} reprovados` / `Regra: {nome} · {dd/mm HH:mm}`. Janela: "na última hora" / "nos últimos 90 minutos" / "nos últimos 50 bipes" / "na OP {pmo}/{op}".
- Lembrete: `⏰ Lembrete — continua abaixo há {min} min` + mesmo corpo.
- Resolvido (para os outros destinatários): `✅ {posto}: resolvido por {nome} às {HH:mm}`.
- Normalizou: `🟢 {posto} normalizou: {taxa}% (ficou {duração} abaixo)`.
- Taxa com 1 casa decimal, truncada (mesma regra do Dashboard).

## 7. Rotas (App Router, `src/app/api/alertas/`)

- `POST /api/alertas/avaliar` — exige cabeçalho `Authorization: Bearer $ALERTAS_CRON_SECRET`; chama `alerta_avaliar()` com a service key, envia, grava `alerta_envios`, reenvia falhas. Responde `{ avaliadas, enviados, falhas, ocupado }`. Banco indisponível → 503 e log, sem exceção não tratada.
- `POST /api/alertas/telegram` — exige `X-Telegram-Bot-Api-Secret-Token = $TELEGRAM_WEBHOOK_SECRET`.
  - mensagem de texto com `ALERTA-XXXX` → `alerta_vincular` → responde "✅ Conta vinculada ao ShopFloor ({nome})" ou o erro em texto;
  - `/start` sem código → instrução de como vincular;
  - `callback_query` `r:<id>` → identifica o usuário pela conta vinculada → `alerta_resolver` → `answerCallbackQuery`, edita a mensagem (sem botão) e envia "resolvido por" aos outros destinatários.
  - Sempre responde 200 (o Telegram reenvia em erro).
- `POST /api/alertas/discord` — verifica assinatura Ed25519 (`X-Signature-Ed25519`, `X-Signature-Timestamp`) com `DISCORD_PUBLIC_KEY` via `crypto` do Node; inválida → 401.
  - `PING` → `PONG`;
  - comando `/vincular codigo:<texto>` → `alerta_vincular` → resposta efêmera;
  - botão `r:<id>` → `alerta_resolver` → atualiza a mensagem (sem botão) e avisa os outros.
- **Botão "Avaliar agora"** na tela de alertas (admin): server action que chama a mesma lógica da rota `avaliar` (para o preview da Vercel, que não tem crontab).

Nenhuma dependência nova: `fetch` e `node:crypto`.

## 8. Telas

### 8.1 Meu perfil (`/perfil`, qualquer usuário logado)
Acesso pelo nome do usuário no cabeçalho → "Meu perfil". Cartão **Alertas** com uma linha por canal:
- **Não vinculado:** botão **Vincular** → mostra o código, contador de 15 min e as instruções (Telegram: link `https://t.me/<bot>` + "envie o código"; Discord: "no servidor da Enterplak, digite `/vincular <código>`"). A tela consulta o vínculo a cada 3 s enquanto o código está aberto e mostra "✅ Vinculado".
- **Vinculado:** "Vinculado em dd/mm" + **Enviar teste** + **Desvincular** (com confirmação).
- Canal sem token configurado: linha desabilitada com "Não configurado neste ambiente".

### 8.2 Configurações › Ajustes ShopFloor › Alertas (`/configuracoes/sf-alertas`, `shopfloor.administrar`)
- **Aba Regras:** tabela (nome, postos, taxa mínima, janela, destinatários, canais, interruptor Ativa) + **Nova regra**, editar, excluir (confirmação). Botão **Avaliar agora**.
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
- **Banco (Postgres descartável via Docker, como `supabase/tests/rodar-setup-test.sh`):** as três janelas; mínimo de bipes; transições da seção 5; índice único impede duas ocorrências vivas; código expira e é de uso único; `alerta_resolver` só para destinatário e idempotente; trava do `alerta_avaliar`.
- **Rotas:** avaliar sem segredo → 401; Telegram sem secret → 401/ignorado; Discord com assinatura inválida → 401.
- **Smoke real:** criar os bots, vincular a própria conta, regra com meta alta para disparar, "Avaliar agora": alerta, lembrete, Resolvido (mensagem perde o botão), normalizou (regra com meta baixa).

## 11. Riscos

- **Mensagem privada no Discord** só funciona se o usuário estiver no servidor da empresa e aceitar DMs de membros do servidor; o `Enviar teste` do perfil expõe o problema cedo.
- **Telegram** só entrega a quem apertou Iniciar — garantido pelo vínculo por código.
- **Carga:** `alerta_avaliar` a cada 5 min com o índice `(posto, data_hora)`; regras × postos são poucas dezenas.
