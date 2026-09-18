# Alertas de taxa de aprovação por posto (Telegram/Discord) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gestor recebe no Telegram e/ou Discord um aviso quando a taxa de aprovação de um posto cai abaixo do limite configurado, com lembrete, botão "Resolvido" na própria mensagem e aviso quando normaliza.

**Architecture:** A DECISÃO fica no banco (`alerta_avaliar()`, atômica com um índice único parcial de "ocorrência viva" e uma trava `pg_try_advisory_xact_lock`), que **na mesma transação** põe na **fila de saída** (`alerta_envios` pendentes, com os dados da mensagem em jsonb) uma linha por destinatário × canal vinculado; o app tem **um único caminho de entrega** (`entregarPendentes`): reserva um lote de forma atômica (`alerta_reservar_envios`), monta o texto a partir dos dados, entrega via `fetch` (clients finos de Telegram/Discord, com `fetch` injetável) e atualiza a própria linha. Uma rota `POST /api/alertas/avaliar` protegida por segredo é chamada pelo crontab da Lightsail a cada 5 min; dois webhooks (`/api/alertas/telegram`, `/api/alertas/discord`) fazem o vínculo por código e o "Resolvido" pelo botão. Duas telas: **Meu perfil** (vincular/testar/desvincular, qualquer usuário) e **Configurações › Ajustes ShopFloor › Alertas** (regras + ocorrências, `shopfloor.administrar`).

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions, Route Handlers), React 19.2.4, TypeScript strict, Supabase (`@supabase/ssr` + `supabase-js`), Postgres com RLS/RBAC por módulo, Tailwind v4 + componentes de `src/components/ui`, vitest 4, testes SQL em Postgres descartável via Docker. `fetch` e `node:crypto` — **zero dependência npm nova**.

> **Revisão de 2026-09-18 — fila de envio (outbox) + exclusão lógica de regra.** Aplicada depois das Tasks 1–5 (commits `ad3de55` e `6a6ff25`, relatório em `.superpowers/sdd/outbox-report.md`). As Tasks 1–5 abaixo ficam como registro histórico do que foi feito antes da revisão; **o código atual da branch é a referência**. O que mudou:
> - **Banco (0113):** `alerta_avaliar()` enfileira em `alerta_envios` (colunas novas `dados jsonb`, `reservado_em`, `enviado_em`; check `ok = (enviado_em is not null)`) e devolve `{ ocupado, avaliadas, enfileirados, normalizadas }` — não devolve mais `acoes`. Função nova `alerta_reservar_envios(p_canais, p_limite, p_ocorrencia_id)` (só `service_role`; `for update skip locked` + `tentativas + 1` + reserva de 15 min; novas antes de reenvios; teto 3; 24 h; pula `teste`; alerta/lembrete só com ocorrência `aberta`). `alerta_resolver_interno` enfileira o "✅ resolvido por" para os outros destinatários na mesma transação. `alerta_regras.excluida_em` (exclusão lógica; sem policy de DELETE; regra excluída não é editável), FK `alerta_ocorrencias.regra_id` `on delete restrict`, `alerta_listar_ocorrencias` mostra "(excluída)" no nome e conta como falha só envio que tentou e errou.
> - **App:** `entregarPendentes(portas, repo, { ocorrenciaId? })` é o único caminho de entrega; `avaliarEEnviar` = avaliar + entregar + tirar botões das `normalizadas`. Saíram `enviarItens`, `reenviarFalhas`, `avisarResolvido`, `AcaoAvaliacao`/`textoDaAcao`/`acaoTemBotao`, e do repositório `registrarEnvio`/`envioParaReenviar`/`registrarReenvio`/`contasDaOcorrencia`. Entraram `domain/envio.ts` (`EnvioReservado`, `lerEnvioReservado`, `textoDoEnvio`, `DadosEnvioInvalidos`) e, no repositório, `reservarPendentes`/`concluirEnvio`/`registrarEnvioDireto`. "Enviar teste" continua **direto** (fora da fila) e grava a linha já final.
> - **Tasks 6, 7, 9 e 10** abaixo já estão escritas no formato novo.

## Global Constraints

- Worktree de trabalho: `/home/rwtech/Área de trabalho/ShopFloor-alertas`, branch `feat/shopfloor-alertas` (já existe, limpa). **Todos os caminhos deste plano são relativos a essa raiz.**
- O worktree **não tem `node_modules`**: rodar `npm ci` antes do primeiro teste (Task 1, Step 1).
- Idioma: textos de UI, mensagens de erro, comentários e mensagens de commit em **PT-BR**.
- Mensagens de commit terminam com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Não ler `.env*`**. **Não commitar** `*.txt`/`*.xlsx` da raiz do projeto (há arquivos não rastreados lá; use sempre `git add` com caminhos explícitos).
- Arquivos `'use server'` exportam **somente funções async** (tipos podem ser exportados). Retorno das actions: `{ ok: true, ... } | { ok: false, erro: string }`.
- Erros do Postgres vêm como `raise exception 'CODIGO'` e são traduzidos para PT-BR por `mensagemErroAlerta` (Task 1).
- Componentes de UI: **só** os de `src/components/ui`. Nenhuma dependência npm nova.
- Feedback das telas de cadastro/gestão: `toast(..., { position: 'bottom-center' })` (padrão do projeto).
- Permissões: configurar regras e ver ocorrências = `shopfloor.administrar` (via `podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')`); vincular Telegram/Discord = qualquer usuário logado.
- Migração `supabase/migrations/0113_alertas.sql`: corpo de função sempre com `$func$` (o SQL Editor do Supabase não aceita `$$`, **nem dentro de comentário**); policies no formato `(select tem_permissao('shopfloor','administrar'))` (padrão da 0096, função 2-arg da 0043); `grant` explícito a `authenticated` e `service_role` em toda tabela e função (funções de servidor: `revoke` de `public, anon, authenticated` + `grant execute ... to service_role`); `notify pgrst, 'reload schema';` na última linha. A 0110–0112 são da branch Setup — por isso esta começa em 0113.
- Índice `(posto, data_hora desc)` de `sf_registros` em **arquivo próprio** `supabase/migrations/0114_sf_registros_posto_data_idx.sql` com `create index concurrently if not exists` (precedente da 0095: `concurrently` não roda dentro de transação).
- Taxa de aprovação: conta **bipes** de `sf_registros` com `lower(status) = 'aprovado'` / `'reprovado'` (régua da 0101); outros status ficam fora da conta e do mínimo de bipes. `taxa = aprovados ÷ (aprovados + reprovados) × 100`, exibida com **1 casa decimal truncada** (régua do Dashboard).
- Janela `op`: OP do último bipe do posto; se esse bipe tem **mais de 2 horas**, o posto não é avaliado.
- Comparação: **abaixo** = `taxa < taxa_minima`; **normalizou** = `taxa >= taxa_minima` com o mínimo de bipes atingido.
- Padrões: janela `tempo` = 60 min, janela `bipes` = 50, `minimo_bipes` = 20, `lembrete_min` vazio = sem lembrete.
- Vínculo por código: `ALERTA-XXXX`, vale **15 min**, **uso único**.
- Avaliação a cada **5 minutos** pelo crontab da Lightsail (`ALERTAS_CRON_SECRET` lido de arquivo com modo **600**).
- Variáveis novas (sem valores) no `.env.example`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `ALERTAS_CRON_SECRET`.
- Fora do escopo: resumo por turno, outras métricas, grupo/canal como destino, horário de silêncio, webhook genérico.
- Testes TS em `src/modules/alertas/**/__tests__/` (vitest). Testes SQL em `supabase/tests/`. Testes que usam `node:crypto`/`Response` levam `// @vitest-environment node` na primeira linha.

---

## Mapa de arquivos

**Banco**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0113_alertas.sql` | Criar (Task 2) as 5 tabelas (`alerta_contas`, `alerta_codigos`, `alerta_regras`, `alerta_ocorrencias`, `alerta_envios`), RLS, grants, `alerta_gerar_codigo`, `alerta_vincular`; **acrescentar** (Task 3) `alerta_taxas`, `alerta_avaliar`, `alerta_previa`, `alerta_resolver`/`alerta_resolver_admin`, `alerta_destinatarios`, `alerta_listar_ocorrencias` e o `notify pgrst`. |
| `supabase/migrations/0114_sf_registros_posto_data_idx.sql` | Índice `(posto, data_hora desc)` em `sf_registros` com `create index concurrently` (arquivo separado). |
| `supabase/tests/rodar-alertas-test.sh` | Sobe Postgres descartável via Docker, aplica 0113 + 0114 sobre um stub mínimo e roda os testes SQL + o caso de concorrência da trava. |
| `supabase/tests/alertas_test.sql` | Stub (`auth.uid`, `tem_permissao`, papéis, `usuarios`, `sf_registros`) + asserções: códigos/vínculo, RLS/grants, as 3 janelas, mínimo de bipes, transições, índice único, resolver, prévia, listagens, **fila de envio** (mesma transação, reserva atômica, ordem, teto) e **exclusão lógica de regra**. O runner também testa a reserva concorrente. |

**Domínio (puro, sem I/O)**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/domain/tipos.ts` | `Canal`, `JanelaTipo`, `TipoEnvio`, `EstadoOcorrencia`, `ResultadoEnvio`, `ResultadoSimples`, `NOME_CANAL`, `CANAIS`. |
| `src/modules/alertas/domain/taxa.ts` | `taxaAprovacao`, `formatarTaxa` (1 casa truncada), `formatarMeta`. |
| `src/modules/alertas/domain/janela.ts` | `textoJanela` ("na última hora", "nos últimos 50 bipes", "na OP PMOA/1001"), `resumoJanela` (coluna da tabela). |
| `src/modules/alertas/domain/mensagens.ts` | Textos de alerta/lembrete/resolvido/normalizou/teste/instruções + `formatarDataHoraCurta`, `formatarHora`, `formatarDuracao`. |
| `src/modules/alertas/domain/codigos.ts` | `extrairCodigoVinculo`, `montarCallbackResolver`, `lerCallbackResolver`. |
| `src/modules/alertas/domain/erros.ts` | `codigoErroAlerta`, `mensagemErroAlerta` (códigos do Postgres → PT-BR). |
| `src/modules/alertas/domain/avaliacao.ts` | Tipos `ContaDestino`/`ResultadoAvaliacaoRpc` (`ocupado`, `avaliadas`, `enfileirados`, `normalizadas`), `lerResultadoAvaliacao`. |
| `src/modules/alertas/domain/envio.ts` | `EnvioReservado`, `lerEnvioReservado` (linha do `alerta_reservar_envios`), `textoDoEnvio(tipo, dados)` (texto a partir do jsonb da fila), `DadosEnvioInvalidos`. |
| `src/modules/alertas/domain/resolucao.ts` | `ResolucaoOcorrencia`, `lerResolucao` (jsonb do `alerta_resolver` → objeto). |
| `src/modules/alertas/domain/regra.ts` | `EntradaRegra`/`RegraValida`/`RegraAlerta`/`DestinatarioDisponivel`, `PADROES_REGRA`, `validarRegra`, `destinatariosSemCanal`. |
| `src/modules/alertas/domain/ocorrencia.ts` | `PreviaPosto`, `FiltroOcorrencias`, `OcorrenciaLinha`, `periodoOcorrencias`. |

**Aplicação**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/application/portas.ts` | Interfaces de I/O: `PortaCanal`/`PortasCanais`, `RepositorioEnvios`, `RepositorioVinculo` e seus DTOs. Nada de implementação. |
| `src/modules/alertas/application/enviar-alertas.ts` | Orquestra: `entregarPendentes` (único caminho de entrega da fila), `avaliarEEnviar`, `removerBotoesDaOcorrencia`, `enviarTeste` (direto). |
| `src/modules/alertas/application/webhook-telegram.ts` | `tratarUpdateTelegram` (vincular, instruções, callback do botão). |
| `src/modules/alertas/application/webhook-discord.ts` | `tratarInteracaoDiscord` (PING, `/vincular`, botão) devolvendo `{ corpo, depois }`. |
| `src/modules/alertas/application/alertas-actions.ts` | `'use server'` — CRUD de regras, prévia, ocorrências, resolver pela tela, avaliar agora. |
| `src/modules/alertas/application/perfil-alertas-actions.ts` | `'use server'` — gerar código, consultar vínculos, desvincular, enviar teste. |

**Infra**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/infra/telegram.ts` | Client fino do Telegram (`enviarMensagem`, `editarTexto`, `removerBotoes`, `responderCallback`) + `payloadMensagemTelegram`. |
| `src/modules/alertas/infra/discord.ts` | Client fino do Discord (`enviarDm` abrindo DM, `removerBotoes`) + `payloadMensagemDiscord`. |
| `src/modules/alertas/infra/assinatura.ts` | `verificarAssinaturaDiscord` (Ed25519 via `node:crypto`) e `segredoConfere` (comparação em tempo constante). |
| `src/modules/alertas/infra/canais.ts` | `canaisConfigurados` e `criarPortasCanais` (lê env, monta as portas). |
| `src/modules/alertas/infra/repositorio-servico.ts` | `'server-only'` — implementa `RepositorioEnvios` + `RepositorioVinculo` com o client **service role**. |
| `src/modules/alertas/infra/fabrica.ts` | `'server-only'` — `criarDependenciasAlertas()` = `{ portas, repo }` para rotas e actions. |
| `src/modules/alertas/infra/regras-repository.ts` | `'server-only'` — regras/prévia/destinatários/ocorrências pelo client da **sessão** (RLS). |
| `src/modules/alertas/infra/contas-repository.ts` | `'server-only'` — código de vínculo, contas do usuário, desvincular (client da sessão). |

**Telas e rotas**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/api/alertas/avaliar/route.ts` | `POST` do cron: segredo → `avaliarEEnviar` → `{ avaliadas, enviados, falhas, ocupado }`; 503 se o banco cair. |
| `src/app/api/alertas/telegram/route.ts` | Webhook do Telegram (`X-Telegram-Bot-Api-Secret-Token`), responde sempre 200 após autorizar. |
| `src/app/api/alertas/discord/route.ts` | Webhook do Discord (assinatura Ed25519), resposta imediata + trabalho pesado em `after()`. |
| `middleware.ts` | **Modificar**: `/api/alertas/*` passa sem sessão (autenticam por segredo/assinatura). |
| `src/app/(app)/perfil/page.tsx` + `cartao-alertas.tsx` | Tela **Meu perfil** com o cartão Alertas (vincular/testar/desvincular). |
| `src/shared/ui/app-shell.tsx` | **Modificar**: link "Meu perfil" no cabeçalho e no rodapé do menu + item `Alertas` em `CONFIG_SHOPFLOOR`. |
| `src/app/(app)/configuracoes/sf-alertas/page.tsx` | Guard de permissão + carga inicial (regras, postos, destinatários, canais, ocorrências). |
| `src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx` | Abas Regras / Ocorrências + botão "Avaliar agora". |
| `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx` | Tabela de regras (desktop) / cards (mobile), interruptor Ativa, editar, excluir. |
| `src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx` | Diálogo da regra (postos, taxa, janela, mínimo, lembrete, canais, destinatários, prévia). |
| `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx` | Filtros período/estado + tabela de ocorrências + "Marcar resolvida". |

**Operação**

| Arquivo | Responsabilidade |
|---|---|
| `tools/alertas/configurar-bots.mjs` | `setWebhook` do Telegram (com `secret_token`) e registro do comando `/vincular` no guild do Discord. Nunca imprime tokens. |
| `tools/alertas/README.md` | Passo a passo: criar bot no @BotFather, app/bot no Discord Developer Portal, convidar ao servidor, variáveis, rodar o script, linha do crontab. |
| `.env.example` | **Modificar**: variáveis novas, sem valores. |
| `docs/superpowers/plans/2026-09-17-alertas-smoke.md` | Roteiro de smoke real (vincular, alerta, lembrete, resolvido, normalizou). |

---

### Task 1: Domínio puro — taxa, janela, textos, códigos e erros

**Files:**
- Create: `src/modules/alertas/domain/tipos.ts`
- Create: `src/modules/alertas/domain/taxa.ts`
- Create: `src/modules/alertas/domain/janela.ts`
- Create: `src/modules/alertas/domain/mensagens.ts`
- Create: `src/modules/alertas/domain/codigos.ts`
- Create: `src/modules/alertas/domain/erros.ts`
- Test: `src/modules/alertas/domain/__tests__/taxa-janela.test.ts`
- Test: `src/modules/alertas/domain/__tests__/mensagens.test.ts`
- Test: `src/modules/alertas/domain/__tests__/codigos-erros.test.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `type Canal = 'telegram' | 'discord'`; `const CANAIS: readonly Canal[]`; `const NOME_CANAL: Record<Canal, string>`
  - `type JanelaTipo = 'tempo' | 'bipes' | 'op'`; `type TipoEnvio = 'alerta' | 'lembrete' | 'resolvido' | 'normalizou' | 'teste'`; `type EstadoOcorrencia = 'aberta' | 'resolvida' | 'normalizada'`
  - `type ResultadoEnvio = { ok: true; mensagemExternaId: string } | { ok: false; erro: string }`
  - `type ResultadoSimples = { ok: true } | { ok: false; erro: string }`
  - `taxaAprovacao(aprovados: number, reprovados: number): number | null`
  - `formatarTaxa(aprovados: number, reprovados: number): string`
  - `formatarMeta(taxaMinima: number): string`
  - `interface Janela { tipo: JanelaTipo; valor: number | null; pmo?: string | null; op?: string | null }`
  - `textoJanela(j: Janela): string`; `resumoJanela(j: { tipo: JanelaTipo; valor: number | null }): string`
  - `interface DadosMensagem { posto: string; regraNome: string; taxaMinima: number; aprovados: number; reprovados: number; janela: Janela; em: Date }`
  - `textoAlerta(d: DadosMensagem): string`; `textoLembrete(d: DadosMensagem & { abertaEm: Date }): string`
  - `textoResolvido(d: { posto: string; nome: string; em: Date }): string`
  - `textoNormalizou(d: { posto: string; aprovados: number; reprovados: number; abertaEm: Date; em: Date }): string`
  - `textoTeste(nome: string): string`; `const TEXTO_INSTRUCOES_TELEGRAM: string`; `textoVinculado(nome: string): string`
  - `formatarDataHoraCurta(d: Date): string`; `formatarHora(d: Date): string`; `formatarDuracao(ms: number): string`
  - `extrairCodigoVinculo(texto: string | null | undefined): string | null`
  - `montarCallbackResolver(ocorrenciaId: string): string`; `lerCallbackResolver(dado: string | null | undefined): string | null`
  - `codigoErroAlerta(mensagem: string | null | undefined): string`; `mensagemErroAlerta(mensagem: string | null | undefined): string`

- [ ] **Step 1: Instalar as dependências no worktree**

O worktree não tem `node_modules` (é um worktree novo do repositório).

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npm ci
```
Expected: termina com `added NNNN packages` e sem `ERR!`.

- [ ] **Step 2: Escrever os testes de taxa e janela (falhando)**

Criar `src/modules/alertas/domain/__tests__/taxa-janela.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { taxaAprovacao, formatarTaxa, formatarMeta } from '../taxa'
import { textoJanela, resumoJanela } from '../janela'

describe('taxaAprovacao', () => {
  it('calcula o percentual exato de aprovação', () => {
    expect(taxaAprovacao(15, 5)).toBe(75)
  })
  it('devolve null quando não houve bipe aprovado nem reprovado', () => {
    expect(taxaAprovacao(0, 0)).toBeNull()
  })
  it('100% quando não houve reprova', () => {
    expect(taxaAprovacao(7, 0)).toBe(100)
  })
})

describe('formatarTaxa', () => {
  it('trunca na primeira casa decimal (não arredonda)', () => {
    // 236/270 = 87,407...% -> 87,4 ; 8/9 = 88,888...% -> 88,8 (arredondar daria 88,9)
    expect(formatarTaxa(236, 34)).toBe('87,4')
    expect(formatarTaxa(8, 1)).toBe('88,8')
  })
  it('mostra sempre uma casa decimal', () => {
    expect(formatarTaxa(1, 0)).toBe('100,0')
    expect(formatarTaxa(3, 1)).toBe('75,0')
  })
  it('sem bipes vira travessão', () => {
    expect(formatarTaxa(0, 0)).toBe('—')
  })
})

describe('formatarMeta', () => {
  it('inteiro sai sem casas', () => {
    expect(formatarMeta(90)).toBe('90')
  })
  it('decimal sai com vírgula e até 2 casas', () => {
    expect(formatarMeta(92.5)).toBe('92,5')
    expect(formatarMeta(99.95)).toBe('99,95')
  })
})

describe('textoJanela', () => {
  it('60 minutos vira "na última hora"', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 60 })).toBe('na última hora')
  })
  it('outros minutos saem no plural', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 90 })).toBe('nos últimos 90 minutos')
  })
  it('1 minuto sai no singular', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 1 })).toBe('no último minuto')
  })
  it('bipes', () => {
    expect(textoJanela({ tipo: 'bipes', valor: 50 })).toBe('nos últimos 50 bipes')
  })
  it('op com PMO/OP conhecidos', () => {
    expect(textoJanela({ tipo: 'op', valor: null, pmo: 'PMOA', op: '1001' })).toBe('na OP PMOA/1001')
  })
  it('op sem PMO/OP cai no genérico', () => {
    expect(textoJanela({ tipo: 'op', valor: null, pmo: null, op: null })).toBe('na OP em andamento')
  })
})

describe('resumoJanela', () => {
  it('resume cada tipo para a coluna da tabela', () => {
    expect(resumoJanela({ tipo: 'tempo', valor: 60 })).toBe('Últimos 60 min')
    expect(resumoJanela({ tipo: 'bipes', valor: 50 })).toBe('Últimos 50 bipes')
    expect(resumoJanela({ tipo: 'op', valor: null })).toBe('OP em andamento')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/taxa-janela.test.ts
```
Expected: FAIL com `Failed to load url ../taxa` (ou `Cannot find module`).

- [ ] **Step 4: Implementar tipos, taxa e janela**

Criar `src/modules/alertas/domain/tipos.ts`:

```ts
/** Canais de envio suportados nesta versão. */
export type Canal = 'telegram' | 'discord'
export const CANAIS: readonly Canal[] = ['telegram', 'discord']
export const NOME_CANAL: Record<Canal, string> = { telegram: 'Telegram', discord: 'Discord' }

/** Como a janela de avaliação é medida (ver seção 3 da spec). */
export type JanelaTipo = 'tempo' | 'bipes' | 'op'

/** Tipos de mensagem gravados em `alerta_envios.tipo`. */
export type TipoEnvio = 'alerta' | 'lembrete' | 'resolvido' | 'normalizou' | 'teste'

/** Estados de uma ocorrência (`alerta_ocorrencias.estado`). */
export type EstadoOcorrencia = 'aberta' | 'resolvida' | 'normalizada'

/**
 * Resultado de um envio. O `mensagemExternaId` é `"<chat|canal>:<id da mensagem>"` — guardamos os
 * dois pedaços porque tanto o Telegram quanto o Discord exigem o par para EDITAR a mensagem depois
 * (tirar o botão quando a ocorrência é resolvida).
 */
export type ResultadoEnvio = { ok: true; mensagemExternaId: string } | { ok: false; erro: string }

export type ResultadoSimples = { ok: true } | { ok: false; erro: string }

/** É um canal conhecido? (entrada vinda de formulário/banco) */
export function ehCanal(valor: unknown): valor is Canal {
  return valor === 'telegram' || valor === 'discord'
}

/** É um tipo de janela conhecido? */
export function ehJanelaTipo(valor: unknown): valor is JanelaTipo {
  return valor === 'tempo' || valor === 'bipes' || valor === 'op'
}
```

Criar `src/modules/alertas/domain/taxa.ts`:

```ts
/**
 * Taxa de aprovação EXATA (sem formatação). Só bipes aprovados/reprovados entram na conta — a
 * régua é a mesma do Dashboard (0101). Sem nenhum dos dois, não há taxa (null), e a regra não
 * decide nada.
 */
export function taxaAprovacao(aprovados: number, reprovados: number): number | null {
  const total = aprovados + reprovados
  if (total <= 0) return null
  return (aprovados * 100) / total
}

/**
 * Taxa com 1 casa decimal TRUNCADA (mesma régua do Dashboard: 88,88% mostra 88,8, não 88,9).
 * A conta é feita em décimos INTEIROS (`aprovados * 1000 / total`) para não depender do
 * arredondamento binário de `toFixed`.
 */
export function formatarTaxa(aprovados: number, reprovados: number): string {
  const total = aprovados + reprovados
  if (total <= 0) return '—'
  const decimos = Math.floor((aprovados * 1000) / total)
  return (decimos / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Meta da regra (`taxa_minima`) como o gestor digitou: '90', '92,5', '99,95'. */
export function formatarMeta(taxaMinima: number): string {
  return taxaMinima.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
```

Criar `src/modules/alertas/domain/janela.ts`:

```ts
import type { JanelaTipo } from './tipos'

export interface Janela {
  tipo: JanelaTipo
  /** Minutos (tipo `tempo`) ou quantidade de bipes (tipo `bipes`). Null no tipo `op`. */
  valor: number | null
  /** Só no tipo `op`: a OP em que a taxa foi medida. */
  pmo?: string | null
  op?: string | null
}

/** Trecho da mensagem: "Taxa: 75,0% **na última hora** (mínimo 90%)". */
export function textoJanela(j: Janela): string {
  switch (j.tipo) {
    case 'tempo': {
      const min = j.valor ?? 60
      if (min === 60) return 'na última hora'
      if (min === 1) return 'no último minuto'
      return `nos últimos ${min} minutos`
    }
    case 'bipes': {
      const n = j.valor ?? 50
      return n === 1 ? 'no último bipe' : `nos últimos ${n} bipes`
    }
    case 'op':
      return j.pmo && j.op ? `na OP ${j.pmo}/${j.op}` : 'na OP em andamento'
  }
}

/** Versão curta para a coluna "Janela" da tabela de regras. */
export function resumoJanela(j: { tipo: JanelaTipo; valor: number | null }): string {
  if (j.tipo === 'tempo') return `Últimos ${j.valor ?? 60} min`
  if (j.tipo === 'bipes') return `Últimos ${j.valor ?? 50} bipes`
  return 'OP em andamento'
}
```

- [ ] **Step 5: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/taxa-janela.test.ts
```
Expected: PASS — `Test Files 1 passed`, `Tests 15 passed`.

- [ ] **Step 6: Escrever os testes das mensagens (falhando)**

Criar `src/modules/alertas/domain/__tests__/mensagens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  formatarDataHoraCurta, formatarHora, formatarDuracao,
  textoAlerta, textoLembrete, textoResolvido, textoNormalizou, textoTeste, textoVinculado,
  TEXTO_INSTRUCOES_TELEGRAM,
} from '../mensagens'

// 17/09/2026 14:05 em São Paulo (UTC-3, sem horário de verão desde 2019).
const EM = new Date('2026-09-17T17:05:00Z')

describe('formatação de data e hora (fuso de São Paulo)', () => {
  it('data e hora curtas', () => {
    expect(formatarDataHoraCurta(EM)).toBe('17/09 14:05')
  })
  it('só a hora', () => {
    expect(formatarHora(EM)).toBe('14:05')
  })
})

describe('formatarDuracao', () => {
  it('menos de 1 minuto', () => {
    expect(formatarDuracao(30_000)).toBe('menos de 1 min')
  })
  it('minutos', () => {
    expect(formatarDuracao(35 * 60_000)).toBe('35 min')
  })
  it('horas redondas', () => {
    expect(formatarDuracao(2 * 60 * 60_000)).toBe('2 h')
  })
  it('horas e minutos', () => {
    expect(formatarDuracao(80 * 60_000)).toBe('1 h 20 min')
  })
})

const DADOS = {
  posto: 'Teste',
  regraNome: 'Teste abaixo de 90',
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janela: { tipo: 'tempo' as const, valor: 60, pmo: null, op: null },
  em: EM,
}

describe('textoAlerta', () => {
  it('monta as três linhas do alerta', () => {
    expect(textoAlerta(DADOS)).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('usa o texto da janela de OP quando é o caso', () => {
    const t = textoAlerta({ ...DADOS, janela: { tipo: 'op', valor: null, pmo: 'PMOA', op: '1001' } })
    expect(t).toContain('na OP PMOA/1001')
  })
})

describe('textoLembrete', () => {
  it('acrescenta o cabeçalho com o tempo desde a abertura', () => {
    const t = textoLembrete({ ...DADOS, abertaEm: new Date('2026-09-17T16:35:00Z') })
    expect(t.split('\n')[0]).toBe('⏰ Lembrete — continua abaixo há 30 min')
    expect(t).toContain('🔴 Teste abaixo da meta')
    expect(t).toContain('Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados')
  })
})

describe('textoResolvido', () => {
  it('diz quem resolveu e quando', () => {
    expect(textoResolvido({ posto: 'Teste', nome: 'Ana Gestora', em: EM })).toBe(
      '✅ Teste: resolvido por Ana Gestora às 14:05',
    )
  })
})

describe('textoNormalizou', () => {
  it('mostra a taxa que normalizou e quanto tempo ficou abaixo', () => {
    expect(
      textoNormalizou({
        posto: 'Teste',
        aprovados: 95,
        reprovados: 5,
        abertaEm: new Date('2026-09-17T15:45:00Z'),
        em: EM,
      }),
    ).toBe('🟢 Teste normalizou: 95,0% (ficou 1 h 20 min abaixo)')
  })
})

describe('textos de vínculo', () => {
  it('teste nomeia quem pediu', () => {
    expect(textoTeste('Ana Gestora')).toContain('Ana Gestora')
  })
  it('confirmação de vínculo', () => {
    expect(textoVinculado('Ana Gestora')).toBe('✅ Conta vinculada ao ShopFloor (Ana Gestora)')
  })
  it('instruções citam Meu perfil e o formato do código', () => {
    expect(TEXTO_INSTRUCOES_TELEGRAM).toContain('Meu perfil')
    expect(TEXTO_INSTRUCOES_TELEGRAM).toContain('ALERTA-')
  })
})
```

- [ ] **Step 7: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/mensagens.test.ts
```
Expected: FAIL com `Failed to load url ../mensagens`.

- [ ] **Step 8: Implementar as mensagens**

Criar `src/modules/alertas/domain/mensagens.ts`:

```ts
import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'

/**
 * Fuso FIXO de São Paulo. O servidor da Lightsail roda em UTC; se a hora da mensagem saísse no
 * fuso do processo, o alerta chegaria com 3 horas de diferença do relógio da fábrica.
 */
const FUSO = 'America/Sao_Paulo'

function partes(d: Date, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes }).formatToParts(d)) {
    saida[p.type] = p.value
  }
  return saida
}

/** '17/09 14:05' */
export function formatarDataHoraCurta(d: Date): string {
  const p = partes(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

/** '14:05' */
export function formatarHora(d: Date): string {
  const p = partes(d, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.hour}:${p.minute}`
}

/** 'menos de 1 min' | '35 min' | '2 h' | '1 h 20 min' */
export function formatarDuracao(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  if (totalMin < 1) return 'menos de 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

export interface DadosMensagem {
  posto: string
  regraNome: string
  taxaMinima: number
  aprovados: number
  reprovados: number
  janela: Janela
  em: Date
}

/** Corpo comum do alerta e do lembrete (duas linhas). */
function corpo(d: DadosMensagem): string {
  return (
    `Taxa: ${formatarTaxa(d.aprovados, d.reprovados)}% ${textoJanela(d.janela)} ` +
    `(mínimo ${formatarMeta(d.taxaMinima)}%) · ${d.aprovados} aprovados, ${d.reprovados} reprovados\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoAlerta(d: DadosMensagem): string {
  return `🔴 ${d.posto} abaixo da meta\n${corpo(d)}`
}

/** Lembrete = cabeçalho com o tempo desde a abertura + o MESMO corpo do alerta. */
export function textoLembrete(d: DadosMensagem & { abertaEm: Date }): string {
  const min = Math.max(0, Math.floor((d.em.getTime() - d.abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua abaixo há ${min} min\n${textoAlerta(d)}`
}

export function textoResolvido(d: { posto: string; nome: string; em: Date }): string {
  return `✅ ${d.posto}: resolvido por ${d.nome} às ${formatarHora(d.em)}`
}

export function textoNormalizou(d: {
  posto: string
  aprovados: number
  reprovados: number
  abertaEm: Date
  em: Date
}): string {
  const duracao = formatarDuracao(d.em.getTime() - d.abertaEm.getTime())
  return `🟢 ${d.posto} normalizou: ${formatarTaxa(d.aprovados, d.reprovados)}% (ficou ${duracao} abaixo)`
}

export function textoTeste(nome: string): string {
  return `🔔 Teste do ShopFloor — ${nome}, os alertas de taxa de aprovação vão chegar aqui.`
}

export function textoVinculado(nome: string): string {
  return `✅ Conta vinculada ao ShopFloor (${nome})`
}

export const TEXTO_INSTRUCOES_TELEGRAM =
  'Para receber os alertas do ShopFloor, abra "Meu perfil" no sistema, clique em Vincular no ' +
  'Telegram e me envie o código aqui (ex.: ALERTA-7K3M). O código vale 15 minutos.'
```

- [ ] **Step 9: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/mensagens.test.ts
```
Expected: PASS — `Tests 14 passed`.

- [ ] **Step 10: Escrever os testes de códigos e erros (falhando)**

Criar `src/modules/alertas/domain/__tests__/codigos-erros.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extrairCodigoVinculo, montarCallbackResolver, lerCallbackResolver } from '../codigos'
import { codigoErroAlerta, mensagemErroAlerta } from '../erros'

describe('extrairCodigoVinculo', () => {
  it('acha o código no meio de uma frase e normaliza a caixa', () => {
    expect(extrairCodigoVinculo('oi, meu codigo é alerta-7k3m obrigado')).toBe('ALERTA-7K3M')
  })
  it('aceita o código puro', () => {
    expect(extrairCodigoVinculo('ALERTA-AB29')).toBe('ALERTA-AB29')
  })
  it('recusa texto sem código', () => {
    expect(extrairCodigoVinculo('/start')).toBeNull()
    expect(extrairCodigoVinculo('')).toBeNull()
    expect(extrairCodigoVinculo(null)).toBeNull()
  })
  it('recusa código com tamanho errado', () => {
    expect(extrairCodigoVinculo('ALERTA-7K3')).toBeNull()
    expect(extrairCodigoVinculo('ALERTA-7K3MX')).toBeNull()
  })
})

describe('callback do botão Resolvido', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('monta o payload curto (cabe nos 64 bytes do Telegram)', () => {
    expect(montarCallbackResolver(id)).toBe(`r:${id}`)
    expect(montarCallbackResolver(id).length).toBeLessThanOrEqual(64)
  })
  it('lê de volta o id da ocorrência', () => {
    expect(lerCallbackResolver(`r:${id}`)).toBe(id)
  })
  it('recusa prefixo desconhecido ou id que não é uuid', () => {
    expect(lerCallbackResolver('x:1')).toBeNull()
    expect(lerCallbackResolver('r:nao-e-uuid')).toBeNull()
    expect(lerCallbackResolver(null)).toBeNull()
  })
})

describe('erros do banco', () => {
  it('extrai o código da mensagem do Postgres', () => {
    expect(codigoErroAlerta('CODIGO_EXPIRADO')).toBe('CODIGO_EXPIRADO')
    expect(codigoErroAlerta('erro ao executar: NAO_DESTINATARIO')).toBe('NAO_DESTINATARIO')
    expect(codigoErroAlerta('deu ruim')).toBe('')
  })
  it('traduz cada código para PT-BR', () => {
    expect(mensagemErroAlerta('CODIGO_INVALIDO')).toBe('Código inválido ou já usado. Gere um novo em Meu perfil.')
    expect(mensagemErroAlerta('CODIGO_EXPIRADO')).toBe('Código expirado. Gere um novo em Meu perfil.')
    expect(mensagemErroAlerta('CONTA_JA_VINCULADA')).toBe('Esta conta já está vinculada a outro usuário do ShopFloor.')
    expect(mensagemErroAlerta('NAO_DESTINATARIO')).toBe('Você não é destinatário desta regra.')
    expect(mensagemErroAlerta('OCORRENCIA_ENCERRADA')).toBe('Esta ocorrência já normalizou.')
    expect(mensagemErroAlerta('OCORRENCIA_INEXISTENTE')).toBe('Ocorrência não encontrada.')
    expect(mensagemErroAlerta('SEM_PERMISSAO')).toBe('Você não tem permissão para configurar alertas.')
  })
  it('mensagem desconhecida vira texto genérico', () => {
    expect(mensagemErroAlerta('connection refused')).toBe('Não foi possível concluir agora. Tente de novo.')
    expect(mensagemErroAlerta(null)).toBe('Não foi possível concluir agora. Tente de novo.')
  })
})
```

- [ ] **Step 11: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/codigos-erros.test.ts
```
Expected: FAIL com `Failed to load url ../codigos`.

- [ ] **Step 12: Implementar códigos e erros**

Criar `src/modules/alertas/domain/codigos.ts`:

```ts
/**
 * Código de vínculo: `ALERTA-XXXX`. A pessoa gera em "Meu perfil" e manda pro bot; aceitamos o
 * código no meio de qualquer frase porque é assim que as pessoas escrevem no chat.
 * O alfabeto do banco evita I/O/0/1, mas aqui aceitamos qualquer letra/dígito e deixamos o banco
 * decidir (CODIGO_INVALIDO) — errar a letra não pode virar "não entendi".
 */
const RE_CODIGO = /ALERTA-([A-Z0-9]{4})(?![A-Z0-9])/i

export function extrairCodigoVinculo(texto: string | null | undefined): string | null {
  const m = RE_CODIGO.exec(texto ?? '')
  return m ? `ALERTA-${m[1]!.toUpperCase()}` : null
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Payload do botão. Curto de propósito: `callback_data` do Telegram tem limite de 64 bytes. */
export function montarCallbackResolver(ocorrenciaId: string): string {
  return `r:${ocorrenciaId}`
}

export function lerCallbackResolver(dado: string | null | undefined): string | null {
  if (!dado || !dado.startsWith('r:')) return null
  const id = dado.slice(2)
  return RE_UUID.test(id) ? id.toLowerCase() : null
}
```

Criar `src/modules/alertas/domain/erros.ts`:

```ts
/**
 * As funções do banco sinalizam regra de negócio com `raise exception 'CODIGO'`. O client do
 * Supabase entrega isso em `error.message`, às vezes com prefixo. Aqui a gente extrai o código e
 * traduz — a tela e o bot nunca mostram texto de Postgres.
 */
const MENSAGENS: Record<string, string> = {
  CODIGO_INVALIDO: 'Código inválido ou já usado. Gere um novo em Meu perfil.',
  CODIGO_EXPIRADO: 'Código expirado. Gere um novo em Meu perfil.',
  CANAL_INVALIDO: 'Canal inválido.',
  CONTA_JA_VINCULADA: 'Esta conta já está vinculada a outro usuário do ShopFloor.',
  NAO_DESTINATARIO: 'Você não é destinatário desta regra.',
  OCORRENCIA_ENCERRADA: 'Esta ocorrência já normalizou.',
  OCORRENCIA_INEXISTENTE: 'Ocorrência não encontrada.',
  SEM_PERMISSAO: 'Você não tem permissão para configurar alertas.',
  SEM_USUARIO: 'Sessão inválida. Entre de novo no sistema.',
  JANELA_INVALIDA: 'Janela de avaliação inválida.',
}

const GENERICA = 'Não foi possível concluir agora. Tente de novo.'

export function codigoErroAlerta(mensagem: string | null | undefined): string {
  const texto = mensagem ?? ''
  for (const codigo of Object.keys(MENSAGENS)) {
    if (texto.includes(codigo)) return codigo
  }
  return ''
}

export function mensagemErroAlerta(mensagem: string | null | undefined): string {
  const codigo = codigoErroAlerta(mensagem)
  return codigo ? MENSAGENS[codigo]! : GENERICA
}
```

- [ ] **Step 13: Rodar todos os testes do domínio e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas
```
Expected: PASS — `Test Files 3 passed`.

- [ ] **Step 14: Checar tipos e lint**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx tsc --noEmit && npm run lint
```
Expected: `tsc` sem saída e lint com `✔ No ESLint warnings or errors`.

- [ ] **Step 15: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add src/modules/alertas
git commit -m "$(cat <<'MSG'
feat(alertas): domínio de taxa, janela, textos, códigos e erros

Base pura dos alertas de taxa de aprovação: taxa truncada na régua do
Dashboard, texto da janela, textos das mensagens (alerta/lembrete/resolvido/
normalizou), parse do código ALERTA-XXXX e do callback r:<id>, e tradução dos
códigos de erro do Postgres.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Migração 0113 — tabelas, RLS, grants, código e vínculo (+ índice 0114 e o runner dos testes SQL)

**Files:**
- Create: `supabase/migrations/0113_alertas.sql` (tabelas + RLS + grants + `alerta_gerar_codigo` + `alerta_vincular`; as demais funções entram na Task 3)
- Create: `supabase/migrations/0114_sf_registros_posto_data_idx.sql`
- Create: `supabase/tests/rodar-alertas-test.sh`
- Test: `supabase/tests/alertas_test.sql`

**Interfaces:**
- Consumes: nada do TypeScript. Do banco existente: `public.usuarios(id, nome, email, ativo)`, `public.sf_registros(posto, data_hora, pmo, op, status)`, `public.tem_permissao(text, text)` (0043), `auth.uid()`.
- Produces (usado pelas Tasks 3, 5, 6 e 7):
  - Tabelas `public.alerta_contas(id, usuario_id, canal, externo_id, vinculado_em)`, `public.alerta_codigos(codigo, usuario_id, expira_em, usado_em, criado_em)`, `public.alerta_regras(id, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais, destinatarios, ativa, criado_por, criado_em, atualizado_em)`, `public.alerta_ocorrencias(id, regra_id, posto, pmo, op, estado, taxa_abertura, taxa_ultima, aprovados, reprovados, aberta_em, resolvida_por, resolvida_em, normalizada_em, ultimo_envio_em)`, `public.alerta_envios(id, ocorrencia_id, usuario_id, canal, tipo, texto, com_botao, mensagem_externa_id, ok, erro, tentativas, criado_em)`
  - Índice único parcial `alerta_ocorrencias_viva` em `(regra_id, posto) where estado in ('aberta','resolvida')`
  - `public.alerta_gerar_codigo() returns jsonb` → `{"codigo":"ALERTA-XXXX","expira_em":"..."}` (papel `authenticated`)
  - `public.alerta_vincular(p_codigo text, p_canal text, p_externo_id text) returns text` (nome do usuário; só `service_role`)
  - Índice `sf_registros_posto_data_hora` em `sf_registros (posto, data_hora desc)`
  - `supabase/tests/rodar-alertas-test.sh` — runner dos testes SQL

- [ ] **Step 1: Escrever o teste SQL das tabelas, RLS e vínculo (falhando)**

Criar `supabase/tests/alertas_test.sql`:

```sql
-- Testes SQL dos alertas de taxa de aprovação. Rodar com supabase/tests/rodar-alertas-test.sh
-- (Postgres descartável em Docker). Tudo que o banco real já tem é STUBADO aqui — só o mínimo.

-- ---------- Stubs do Supabase / ShopFloor ----------
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  posto text not null,
  pmo text not null default '',
  op text not null default '',
  status text not null default ''
);

grant select on public.usuarios, public.sf_registros to anon, authenticated, service_role;

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

insert into public.usuarios (id, nome, email) values
  ('00000000-0000-0000-0000-000000000001', 'Ana Gestora',     'ana@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000002', 'Bruno Líder',     'bruno@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000003', 'Carla Operadora', 'carla@enterplak.com.br');

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

\i /tmp/0113.sql
\i /tmp/0114.sql

-- Ajuda dos testes: gera bipes de um posto numa OP, N minutos atrás.
create function public.teste_bipes(
  p_posto text, p_pmo text, p_op text, p_aprovados int, p_reprovados int, p_minutos_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, p_op, 'Aprovado'
    from generate_series(1, p_aprovados) g;
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, p_op, 'REPROVADO'
    from generate_series(1, p_reprovados) g;
$f$;

-- 1. Código de vínculo: formato, invalidação do anterior, uso único, expiração, id já usado.
do $t$
declare r1 jsonb; r2 jsonb; n text;
begin
  r1 := alerta_gerar_codigo();
  if (r1->>'codigo') !~ '^ALERTA-[A-Z2-9]{4}$' then
    raise exception 'FALHOU: formato do código %', r1;
  end if;
  if (r1->>'expira_em')::timestamptz <= now() then raise exception 'FALHOU: expiração no passado'; end if;

  r2 := alerta_gerar_codigo();
  if (r1->>'codigo') <> (r2->>'codigo')
     and exists (select 1 from alerta_codigos where codigo = r1->>'codigo') then
    raise exception 'FALHOU: código anterior não invalidado';
  end if;

  -- caixa baixa é aceita (a pessoa digita como quiser)
  n := alerta_vincular(lower(r2->>'codigo'), 'telegram', '111');
  if n <> 'Ana Gestora' then raise exception 'FALHOU: nome do vínculo %', n; end if;
  if not exists (select 1 from alerta_contas
                  where usuario_id = '00000000-0000-0000-0000-000000000001'
                    and canal = 'telegram' and externo_id = '111') then
    raise exception 'FALHOU: conta não gravada';
  end if;

  begin
    perform alerta_vincular(r2->>'codigo', 'telegram', '111');
    raise exception 'FALHOU: código usado duas vezes';
  exception when others then
    if sqlerrm not like '%CODIGO_INVALIDO%' then raise; end if;
  end;

  -- expirado
  r1 := alerta_gerar_codigo();
  update alerta_codigos set expira_em = now() - interval '1 minute' where codigo = r1->>'codigo';
  begin
    perform alerta_vincular(r1->>'codigo', 'telegram', '111');
    raise exception 'FALHOU: código expirado aceito';
  exception when others then
    if sqlerrm not like '%CODIGO_EXPIRADO%' then raise; end if;
  end;

  -- canal inválido
  r1 := alerta_gerar_codigo();
  begin
    perform alerta_vincular(r1->>'codigo', 'whatsapp', '999');
    raise exception 'FALHOU: canal inválido aceito';
  exception when others then
    if sqlerrm not like '%CANAL_INVALIDO%' then raise; end if;
  end;

  -- mesmo usuário troca de chat: atualiza a linha (sem duplicar)
  r1 := alerta_gerar_codigo();
  perform alerta_vincular(r1->>'codigo', 'telegram', '112');
  if (select count(*) from alerta_contas
       where usuario_id = '00000000-0000-0000-0000-000000000001' and canal = 'telegram') <> 1 then
    raise exception 'FALHOU: vínculo duplicado no mesmo canal';
  end if;
  if (select externo_id from alerta_contas
       where usuario_id = '00000000-0000-0000-0000-000000000001' and canal = 'telegram') <> '112' then
    raise exception 'FALHOU: externo_id não atualizou';
  end if;

  -- discord da Ana
  r1 := alerta_gerar_codigo();
  perform alerta_vincular(r1->>'codigo', 'discord', 'D1');
end $t$;

-- Bruno: telegram 222 + discord D2. Carla: nada (fica sem canal, de propósito).
select set_config('teste.uid', '00000000-0000-0000-0000-000000000002', false);
do $t$
declare r jsonb;
begin
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'telegram', '222');
  r := alerta_gerar_codigo();
  perform alerta_vincular(r->>'codigo', 'discord', 'D2');

  -- id externo de OUTRO usuário não pode ser roubado
  r := alerta_gerar_codigo();
  begin
    perform alerta_vincular(r->>'codigo', 'telegram', '112');
    raise exception 'FALHOU: externo_id de outro usuário aceito';
  exception when others then
    if sqlerrm not like '%CONTA_JA_VINCULADA%' then raise; end if;
  end;
end $t$;

-- 2. Grants: alerta_vincular é só do servidor (service_role).
set role authenticated;
do $t$
begin
  begin
    perform alerta_vincular('ALERTA-AAAA', 'telegram', '999');
    raise exception 'FALHOU: authenticated executou alerta_vincular';
  exception when insufficient_privilege then
    null;
  end;
end $t$;

-- 3. RLS de alerta_contas: cada um vê e apaga só a própria linha.
do $t$
declare n int;
begin
  select count(*) into n from alerta_contas;   -- teste.uid = Bruno
  if n <> 2 then raise exception 'FALHOU: RLS de contas mostrou % linhas', n; end if;
  delete from alerta_contas where canal = 'discord';
  if exists (select 1 from alerta_contas where canal = 'discord') then
    raise exception 'FALHOU: delete da própria conta';
  end if;
end $t$;
reset role;

-- devolve o discord do Bruno pro resto dos testes
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000002', 'discord', 'D2');

-- 4. RLS de alerta_regras: precisa de shopfloor.administrar.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  lembrete_min, canais, destinatarios, criado_por)
values ('Regra RLS', array['Teste'], 90, 'tempo', 60, 20, null, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');

set role authenticated;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  if exists (select 1 from alerta_regras) then raise exception 'FALHOU: regra visível sem administrar'; end if;
  begin
    insert into alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, canais, destinatarios)
    values ('Intrusa', array['Teste'], 90, 'tempo', 60, array['telegram'],
            array['00000000-0000-0000-0000-000000000001']::uuid[]);
    raise exception 'FALHOU: insert de regra sem administrar';
  exception when insufficient_privilege then
    null;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
do $t$
begin
  if not exists (select 1 from alerta_regras where nome = 'Regra RLS') then
    raise exception 'FALHOU: admin não vê a regra';
  end if;
end $t$;
reset role;
delete from public.alerta_regras where nome = 'Regra RLS';

-- 5. Índice do sf_registros criado pela 0114.
do $t$
begin
  if not exists (select 1 from pg_indexes where indexname = 'sf_registros_posto_data_hora') then
    raise exception 'FALHOU: índice (posto, data_hora desc) não existe';
  end if;
end $t$;

\echo 'ALERTAS: TABELAS/RLS/VINCULO OK'
```

- [ ] **Step 2: Escrever o runner dos testes SQL**

Criar `supabase/tests/rodar-alertas-test.sh`:

```bash
#!/usr/bin/env bash
# Testes SQL dos alertas num Postgres descartável (Docker). Uso: supabase/tests/rodar-alertas-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-alertas-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0113_alertas.sql "$NOME":/tmp/0113.sql
docker cp supabase/migrations/0114_sf_registros_posto_data_idx.sql "$NOME":/tmp/0114.sql
docker cp supabase/tests/alertas_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "ALERTAS SQL OK"
```

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && chmod +x supabase/tests/rodar-alertas-test.sh && ./supabase/tests/rodar-alertas-test.sh
```
Expected: FAIL com `psql:/tmp/teste.sql: ... /tmp/0113.sql: No such file or directory` (ainda não existe a migração) — na verdade o `docker cp` falha antes: `lstat .../0113_alertas.sql: no such file or directory`.

- [ ] **Step 3: Escrever a migração 0113 (tabelas, RLS, grants, código e vínculo)**

Criar `supabase/migrations/0113_alertas.sql`:

```sql
-- =============================================================
-- ALERTAS DE TAXA DE APROVAÇÃO POR POSTO (Telegram/Discord)
--
-- O gestor cria REGRAS (postos, taxa mínima, janela, mínimo de bipes, lembrete, canais,
-- destinatários). Uma checagem a cada 5 min (crontab -> rota do app -> alerta_avaliar) decide
-- ABRIR / LEMBRAR / NORMALIZAR e devolve a lista de envios; o app só entrega as mensagens.
--
-- Convenções deste repositório:
--   - corpo de função com $func$ (o SQL Editor do Supabase não aceita dois cifrões);
--   - policies com (select tem_permissao(...)) — padrão da 0096 (InitPlan, não por linha);
--   - GRANT explícito a authenticated e service_role; funções de servidor são REVOGADAS de
--     anon/authenticated (as default privileges do Supabase dão execute a todos);
--   - notify pgrst no fim (recarrega o schema do PostgREST).
-- =============================================================

-- ---------- Contas vinculadas (Telegram / Discord) ----------
create table if not exists public.alerta_contas (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  canal        text not null check (canal in ('telegram', 'discord')),
  externo_id   text not null check (btrim(externo_id) <> ''),
  vinculado_em timestamptz not null default now(),
  unique (usuario_id, canal),
  unique (canal, externo_id)
);
alter table public.alerta_contas enable row level security;

-- O usuário lê e apaga SÓ a própria linha. Quem grava é o servidor (alerta_vincular).
create policy alerta_contas_select_propria on public.alerta_contas
  for select using (usuario_id = (select auth.uid()));
create policy alerta_contas_delete_propria on public.alerta_contas
  for delete using (usuario_id = (select auth.uid()));

grant select, delete on public.alerta_contas to authenticated;
grant select, insert, update, delete on public.alerta_contas to service_role;

-- ---------- Códigos de vínculo (ALERTA-XXXX, 15 min, uso único) ----------
create table if not exists public.alerta_codigos (
  codigo     text primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  expira_em  timestamptz not null default now() + interval '15 minutes',
  usado_em   timestamptz,
  criado_em  timestamptz not null default now()
);
alter table public.alerta_codigos enable row level security;

create policy alerta_codigos_select_proprio on public.alerta_codigos
  for select using (usuario_id = (select auth.uid()));

grant select on public.alerta_codigos to authenticated;
grant select, insert, update, delete on public.alerta_codigos to service_role;

-- ---------- Regras ----------
create table if not exists public.alerta_regras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (btrim(nome) <> ''),
  postos        text[] not null check (cardinality(postos) > 0),
  taxa_minima   numeric(5,2) not null check (taxa_minima >= 0 and taxa_minima <= 100),
  janela_tipo   text not null check (janela_tipo in ('tempo', 'bipes', 'op')),
  -- minutos (tempo) ou quantidade de bipes (bipes); no tipo 'op' não existe valor
  janela_valor  int check (
                  (janela_tipo = 'op' and janela_valor is null)
                  or (janela_tipo <> 'op' and janela_valor > 0)
                ),
  minimo_bipes  int not null default 20 check (minimo_bipes > 0),
  lembrete_min  int check (lembrete_min is null or lembrete_min > 0),
  canais        text[] not null check (cardinality(canais) > 0 and canais <@ array['telegram', 'discord']),
  destinatarios uuid[] not null check (cardinality(destinatarios) > 0),
  ativa         boolean not null default true,
  criado_por    uuid references public.usuarios(id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.alerta_regras enable row level security;

create policy alerta_regras_admin on public.alerta_regras
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

grant select, insert, update, delete on public.alerta_regras to authenticated, service_role;

-- ---------- Ocorrências (uma por regra x posto enquanto viva) ----------
create table if not exists public.alerta_ocorrencias (
  id              uuid primary key default gen_random_uuid(),
  regra_id        uuid not null references public.alerta_regras(id) on delete cascade,
  posto           text not null,
  pmo             text,
  op              text,
  estado          text not null default 'aberta' check (estado in ('aberta', 'resolvida', 'normalizada')),
  taxa_abertura   numeric(5,2) not null,
  taxa_ultima     numeric(5,2) not null,
  aprovados       int not null default 0,
  reprovados      int not null default 0,
  aberta_em       timestamptz not null default now(),
  resolvida_por   uuid references public.usuarios(id) on delete set null,
  resolvida_em    timestamptz,
  normalizada_em  timestamptz,
  ultimo_envio_em timestamptz not null default now()
);
alter table public.alerta_ocorrencias enable row level security;

-- É ESTE índice que garante "no máximo uma ocorrência viva por regra x posto", mesmo se duas
-- avaliações se cruzarem.
create unique index if not exists alerta_ocorrencias_viva
  on public.alerta_ocorrencias (regra_id, posto)
  where estado in ('aberta', 'resolvida');
create index if not exists alerta_ocorrencias_aberta_em
  on public.alerta_ocorrencias (aberta_em desc);

create policy alerta_ocorrencias_select_admin on public.alerta_ocorrencias
  for select using ((select tem_permissao('shopfloor', 'administrar')));
create policy alerta_ocorrencias_update_admin on public.alerta_ocorrencias
  for update using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

grant select, update on public.alerta_ocorrencias to authenticated;
grant select, insert, update, delete on public.alerta_ocorrencias to service_role;

-- ---------- Envios (auditoria + reenvio de falha) ----------
-- `texto` e `com_botao` ficam guardados para o REENVIO sair idêntico ao que falhou, sem ter que
-- remontar a mensagem a partir de um estado que já mudou.
create table if not exists public.alerta_envios (
  id                  uuid primary key default gen_random_uuid(),
  ocorrencia_id       uuid references public.alerta_ocorrencias(id) on delete cascade,
  usuario_id          uuid not null references public.usuarios(id) on delete cascade,
  canal               text not null check (canal in ('telegram', 'discord')),
  tipo                text not null check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste')),
  texto               text not null default '',
  com_botao           boolean not null default false,
  mensagem_externa_id text,
  ok                  boolean not null default false,
  erro                text,
  tentativas          int not null default 0,
  criado_em           timestamptz not null default now()
);
alter table public.alerta_envios enable row level security;

create index if not exists alerta_envios_ocorrencia on public.alerta_envios (ocorrencia_id);
create index if not exists alerta_envios_pendentes on public.alerta_envios (criado_em)
  where ok = false and tentativas < 3;

create policy alerta_envios_select_admin on public.alerta_envios
  for select using ((select tem_permissao('shopfloor', 'administrar')));

grant select on public.alerta_envios to authenticated;
grant select, insert, update, delete on public.alerta_envios to service_role;

-- ---------- alerta_gerar_codigo(): código de vínculo do usuário logado ----------
create or replace function public.alerta_gerar_codigo()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  -- alfabeto sem I, O, 0 e 1: o código é LIDO na tela e DIGITADO no celular
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_uid    uuid := auth.uid();
  v_codigo text;
  v_expira timestamptz;
  i        int;
begin
  if v_uid is null or not exists (select 1 from usuarios where id = v_uid and ativo) then
    raise exception 'SEM_USUARIO';
  end if;

  -- higiene: códigos velhos de qualquer um (liberam o espaço de nomes) e os meus ainda não usados
  delete from alerta_codigos where expira_em < now() - interval '1 day';
  delete from alerta_codigos where usuario_id = v_uid and usado_em is null;

  loop
    v_codigo := 'ALERTA-';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    begin
      insert into alerta_codigos (codigo, usuario_id) values (v_codigo, v_uid)
      returning expira_em into v_expira;
      exit;
    exception when unique_violation then
      -- colisão com um código ainda vivo: sorteia outro
    end;
  end loop;

  return jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
end
$func$;

revoke all on function public.alerta_gerar_codigo() from public, anon;
grant execute on function public.alerta_gerar_codigo() to authenticated, service_role;

-- ---------- alerta_vincular(): consome o código e grava a conta (SÓ o servidor) ----------
create or replace function public.alerta_vincular(p_codigo text, p_canal text, p_externo_id text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v        alerta_codigos;
  v_nome   text;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_ext    text := btrim(coalesce(p_externo_id, ''));
begin
  if p_canal not in ('telegram', 'discord') then raise exception 'CANAL_INVALIDO'; end if;
  if v_ext = '' then raise exception 'CANAL_INVALIDO'; end if;

  select * into v from alerta_codigos where codigo = v_codigo for update;
  if not found or v.usado_em is not null then raise exception 'CODIGO_INVALIDO'; end if;
  if v.expira_em < now() then raise exception 'CODIGO_EXPIRADO'; end if;

  if exists (select 1 from alerta_contas
              where canal = p_canal and externo_id = v_ext and usuario_id <> v.usuario_id) then
    raise exception 'CONTA_JA_VINCULADA';
  end if;

  insert into alerta_contas (usuario_id, canal, externo_id)
  values (v.usuario_id, p_canal, v_ext)
  on conflict (usuario_id, canal)
    do update set externo_id = excluded.externo_id, vinculado_em = now();

  update alerta_codigos set usado_em = now() where codigo = v.codigo;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = v.usuario_id;
  return coalesce(v_nome, '');
end
$func$;

revoke all on function public.alerta_vincular(text, text, text) from public, anon, authenticated;
grant execute on function public.alerta_vincular(text, text, text) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Escrever a migração 0114 (índice do `sf_registros`)**

Criar `supabase/migrations/0114_sf_registros_posto_data_idx.sql`:

```sql
-- Índice das janelas de alerta: as janelas `tempo` e `bipes` leem os bipes de UM POSTO em TODAS as
-- OPs, e os índices existentes começam por (pmo, op) — ou seja, não servem. Com este índice a
-- contagem da janela sai direto do índice, ordenada por data_hora desc.
--
-- ⚠️ CONCURRENTLY não roda dentro de transação (mesmo caso da 0095):
--    - Dev (SQL Editor do Supabase): REMOVA a palavra "concurrently" da linha abaixo.
--    - Prod/RDS: psql -f supabase/migrations/0114_sf_registros_posto_data_idx.sql  (SEM -1)
create index concurrently if not exists sf_registros_posto_data_hora
  on public.sf_registros (posto, data_hora desc);
```

- [ ] **Step 5: Rodar os testes SQL e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && ./supabase/tests/rodar-alertas-test.sh
```
Expected: `ALERTAS: TABELAS/RLS/VINCULO OK` seguido de `ALERTAS SQL OK`.

- [ ] **Step 6: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add supabase/migrations/0113_alertas.sql supabase/migrations/0114_sf_registros_posto_data_idx.sql supabase/tests/rodar-alertas-test.sh supabase/tests/alertas_test.sql
git commit -m "$(cat <<'MSG'
feat(alertas): 0113 com tabelas, RLS, grants e vínculo por código (+0114 e testes SQL)

Tabelas alerta_contas/codigos/regras/ocorrencias/envios com RLS e grants
explícitos, índice único da ocorrência viva, alerta_gerar_codigo e
alerta_vincular. Índice (posto, data_hora desc) do sf_registros em arquivo
próprio (concurrently). Runner Docker + testes SQL do vínculo e da RLS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Migração 0113 — avaliação, prévia, resolver e listagens (+ testes SQL das janelas e transições)

**Files:**
- Modify: `supabase/migrations/0113_alertas.sql` (acrescentar as funções ANTES da linha `notify pgrst, 'reload schema';`, que passa a ser a última linha do arquivo)
- Modify: `supabase/tests/alertas_test.sql` (acrescentar as seções 6 a 13, antes do `\echo` final)
- Modify: `supabase/tests/rodar-alertas-test.sh` (acrescentar o caso de concorrência da trava)

**Interfaces:**
- Consumes (da Task 2): tabelas `alerta_regras`, `alerta_ocorrencias`, `alerta_envios`, `alerta_contas`, índice único `alerta_ocorrencias_viva`; stub de `sf_registros`, `usuarios`, `tem_permissao`, `auth.uid()`; helper de teste `public.teste_bipes(posto, pmo, op, aprovados, reprovados, minutos_atras)`.
- Produces (usado pelas Tasks 5, 6 e 7):
  - `public.alerta_taxas(p_postos text[], p_janela_tipo text, p_janela_valor int) returns table (posto text, aprovados int, reprovados int, pmo text, op text)` — interna (sem grants)
  - `public.alerta_avaliar() returns jsonb` (só `service_role`) →
    `{"ocupado":false,"avaliadas":3,"acoes":[{"ocorrencia_id":uuid,"tipo":"alerta|lembrete|normalizou","regra_id":uuid,"regra_nome":text,"posto":text,"taxa":numeric,"taxa_minima":numeric,"aprovados":int,"reprovados":int,"janela_tipo":text,"janela_valor":int|null,"pmo":text|null,"op":text|null,"aberta_em":timestamptz,"agora":timestamptz,"contas":[{"usuario_id":uuid,"canal":"telegram|discord","externo_id":text}]}]}`
  - `public.alerta_resolver(p_ocorrencia_id uuid, p_usuario_id uuid) returns jsonb` (só `service_role`) →
    `{"ocorrencia_id":uuid,"regra_id":uuid,"posto":text,"ja_resolvida":bool,"resolvida_por":uuid,"resolvida_por_nome":text,"resolvida_em":timestamptz}`
  - `public.alerta_resolver_admin(p_ocorrencia_id uuid) returns jsonb` (mesmo formato; `authenticated` com `shopfloor.administrar`)
  - `public.alerta_previa(p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int) returns table (posto text, aprovados int, reprovados int, taxa numeric, avaliavel boolean, pmo text, op text)`
  - `public.alerta_destinatarios() returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)`
  - `public.alerta_listar_ocorrencias(p_de timestamptz, p_ate timestamptz, p_estado text) returns table (id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text, taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int, aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz, normalizada_em timestamptz, envios_ok int, envios_falha int)`

- [ ] **Step 1: Escrever os testes SQL das janelas, transições, prévia e listagens (falhando)**

Em `supabase/tests/alertas_test.sql`, **substituir** a última linha (`\echo 'ALERTAS: TABELAS/RLS/VINCULO OK'`) por:

```sql
-- 6. Janela `tempo`: só bipes aprovado/reprovado da última hora contam.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  lembrete_min, canais, destinatarios, criado_por)
values ('Teste abaixo de 90', array['Teste'], 90, 'tempo', 60, 20, 10,
        array['telegram', 'discord'],
        array['00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000002']::uuid[],
        '00000000-0000-0000-0000-000000000001');

select public.teste_bipes('Teste', 'PMOA', '1001', 15, 5, 10);    -- 75% na janela
select public.teste_bipes('Teste', 'PMOA', '1001', 100, 0, 180);  -- fora da janela (3 h atrás)
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select now(), 'Teste', 'PMOA', '1001', 'Registrado' from generate_series(1, 30);  -- sem status de aprovação

create function public.teste_acao(p_r jsonb, p_regra text, p_posto text) returns jsonb language sql as $f$
  select x from jsonb_array_elements(p_r->'acoes') x
   where x->>'regra_nome' = p_regra and x->>'posto' = p_posto
   limit 1
$f$;

set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  if (r->>'ocupado')::boolean is not false then raise exception 'FALHOU: trava presa %', r; end if;
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null then raise exception 'FALHOU: sem ação de alerta %', r; end if;
  if a->>'tipo' <> 'alerta' then raise exception 'FALHOU: tipo % ', a; end if;
  if (a->>'aprovados')::int <> 15 or (a->>'reprovados')::int <> 5 then
    raise exception 'FALHOU: contagem da janela tempo %', a;
  end if;
  if (a->>'taxa')::numeric <> 75.00 then raise exception 'FALHOU: taxa %', a; end if;
  -- 2 destinatários x 2 canais, todos vinculados
  if jsonb_array_length(a->'contas') <> 4 then raise exception 'FALHOU: contas %', a->'contas'; end if;
  if (select count(*) from alerta_ocorrencias where estado = 'aberta' and posto = 'Teste') <> 1 then
    raise exception 'FALHOU: ocorrência não abriu';
  end if;
end $t$;

-- 7. Reavaliação: nada de novo antes do lembrete; depois do intervalo, lembrete.
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Teste abaixo de 90', 'Teste') is not null then
    raise exception 'FALHOU: lembrete antes da hora %', r;
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '11 minutes',
                                     aberta_em = now() - interval '11 minutes'
 where posto = 'Teste' and estado = 'aberta';
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'lembrete' then raise exception 'FALHOU: lembrete %', r; end if;
end $t$;

-- 8. Índice único: não dá pra abrir uma segunda ocorrência viva na mesma regra x posto.
reset role;
do $t$
declare g uuid;
begin
  select regra_id into g from alerta_ocorrencias where posto = 'Teste' and estado = 'aberta';
  begin
    insert into alerta_ocorrencias (regra_id, posto, taxa_abertura, taxa_ultima) values (g, 'Teste', 10, 10);
    raise exception 'FALHOU: duas ocorrências vivas na mesma regra x posto';
  exception when unique_violation then
    null;
  end;
end $t$;

-- 9. Resolver: só destinatário, idempotente, e não manda mais lembrete.
set role service_role;
do $t$
declare oc uuid; r jsonb;
begin
  select id into oc from alerta_ocorrencias where posto = 'Teste' and estado = 'aberta';

  begin
    perform alerta_resolver(oc, '00000000-0000-0000-0000-000000000003');
    raise exception 'FALHOU: quem não é destinatário resolveu';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;

  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000002');
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: primeira resolução %', r; end if;
  if r->>'resolvida_por_nome' <> 'Bruno Líder' then raise exception 'FALHOU: nome de quem resolveu %', r; end if;
  if r->>'posto' <> 'Teste' then raise exception 'FALHOU: posto na resolução %', r; end if;

  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000001');
  if (r->>'ja_resolvida')::boolean is not true then raise exception 'FALHOU: idempotência %', r; end if;
  if r->>'resolvida_por_nome' <> 'Bruno Líder' then raise exception 'FALHOU: idempotência trocou o autor %', r; end if;

  if (select estado from alerta_ocorrencias where id = oc) <> 'resolvida' then
    raise exception 'FALHOU: estado após resolver';
  end if;
end $t$;
reset role;
update public.alerta_ocorrencias set ultimo_envio_em = now() - interval '30 minutes'
 where posto = 'Teste' and estado = 'resolvida';
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Teste abaixo de 90', 'Teste') is not null then
    raise exception 'FALHOU: ocorrência resolvida ainda manda lembrete %', r;
  end if;
end $t$;

-- 10. Normalizou: taxa volta pra meta -> normalizada + envio; se cair de novo, ocorrência NOVA.
reset role;
select public.teste_bipes('Teste', 'PMOA', '1001', 400, 0, 1);
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: normalizou %', r; end if;
  if (select count(*) from alerta_ocorrencias where posto = 'Teste' and estado in ('aberta', 'resolvida')) <> 0 then
    raise exception 'FALHOU: ocorrência continuou viva';
  end if;
end $t$;
reset role;
select public.teste_bipes('Teste', 'PMOA', '1001', 0, 600, 0);
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Teste abaixo de 90', 'Teste');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: nova ocorrência depois de normalizar %', r; end if;
  if (select count(*) from alerta_ocorrencias where posto = 'Teste') <> 2 then
    raise exception 'FALHOU: deveria haver 2 ocorrências no histórico do posto Teste';
  end if;
end $t$;
reset role;
-- desliga a regra do posto Teste pra ela não poluir as seções seguintes
update public.alerta_regras set ativa = false where nome = 'Teste abaixo de 90';

-- 11. Mínimo de bipes: 19 bipes não decidem nada.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Mínimo', array['Inspeção'], 90, 'tempo', 60, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Inspeção', 'PMOA', '1001', 9, 10, 5);   -- 19 bipes, 47%
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Mínimo', 'Inspeção') is not null then raise exception 'FALHOU: avaliou sem o mínimo %', r; end if;
  if exists (select 1 from alerta_ocorrencias where posto = 'Inspeção') then
    raise exception 'FALHOU: abriu ocorrência sem o mínimo';
  end if;
end $t$;
reset role;
select public.teste_bipes('Inspeção', 'PMOA', '1001', 1, 0, 5);    -- 20º bipe
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Mínimo', 'Inspeção');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: 20 bipes deveriam avaliar %', r; end if;
  if (a->>'aprovados')::int <> 10 or (a->>'reprovados')::int <> 10 then
    raise exception 'FALHOU: contagem no mínimo %', a;
  end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'Mínimo';

-- 12. Janela `bipes`: só os N últimos bipes com status contam.
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('Bipes', array['Montagem'], 80, 'bipes', 50, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Montagem', 'PMOA', '1001', 0, 60, 300);  -- antigos, fora dos 50 últimos
select public.teste_bipes('Montagem', 'PMOA', '1001', 50, 0, 5);    -- os 50 últimos: 100%
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Bipes', 'Montagem') is not null then
    raise exception 'FALHOU: janela de bipes olhou além dos 50 %', r;
  end if;
end $t$;
reset role;
select public.teste_bipes('Montagem', 'PMOB', '2001', 0, 30, 0);    -- 30 reprovas mais recentes
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'Bipes', 'Montagem');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: janela de bipes %', r; end if;
  if (a->>'aprovados')::int <> 20 or (a->>'reprovados')::int <> 30 then
    raise exception 'FALHOU: os 50 últimos deveriam ser 20 aprovados / 30 reprovados %', a;
  end if;
end $t$;

-- 13. Regra desativada e posto removido: ocorrência viva vira normalizada SEM envio.
reset role;
update public.alerta_regras set ativa = false where nome = 'Bipes';
set role service_role;
do $t$
declare r jsonb;
begin
  r := alerta_avaliar();
  if teste_acao(r, 'Bipes', 'Montagem') is not null then raise exception 'FALHOU: regra desativada avisou %', r; end if;
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Bipes' and oc.estado in ('aberta', 'resolvida')) then
    raise exception 'FALHOU: ocorrência de regra desativada continuou viva';
  end if;
end $t$;

-- 14. Janela `op`: OP do último bipe; bipe com mais de 2 h não avalia; OP nova normaliza.
reset role;
insert into public.alerta_regras (nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
                                  canais, destinatarios, criado_por)
values ('OP', array['Embalagem', 'Inspeção Final'], 95, 'op', null, 20, array['telegram'],
        array['00000000-0000-0000-0000-000000000001']::uuid[],
        '00000000-0000-0000-0000-000000000001');
select public.teste_bipes('Embalagem', 'PMOB', '2001', 0, 50, 200);      -- OP antiga
select public.teste_bipes('Embalagem', 'PMOB', '2002', 18, 2, 30);       -- OP em andamento: 90%
select public.teste_bipes('Inspeção Final', 'PMOB', '2001', 0, 30, 150); -- último bipe com 2h30
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'OP', 'Embalagem');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: janela op %', r; end if;
  if a->>'op' <> '2002' or a->>'pmo' <> 'PMOB' then raise exception 'FALHOU: OP da janela %', a; end if;
  if (a->>'aprovados')::int <> 18 or (a->>'reprovados')::int <> 2 then
    raise exception 'FALHOU: contagem da OP %', a;
  end if;
  if teste_acao(r, 'OP', 'Inspeção Final') is not null then
    raise exception 'FALHOU: posto com último bipe de 2h30 foi avaliado %', r;
  end if;
  if (select op from alerta_ocorrencias where posto = 'Embalagem' and estado = 'aberta') <> '2002' then
    raise exception 'FALHOU: OP não gravada na ocorrência';
  end if;
end $t$;
reset role;
select public.teste_bipes('Embalagem', 'PMOB', '2003', 25, 0, 0);        -- OP nova, dentro da meta
set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_acao(r, 'OP', 'Embalagem');
  if a is null or a->>'tipo' <> 'normalizou' then raise exception 'FALHOU: OP nova deveria normalizar %', r; end if;
end $t$;
reset role;
update public.alerta_regras set ativa = false where nome = 'OP';

-- 15. alerta_previa: taxa atual sem gravar nada + gate de permissão.
set role authenticated;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
do $t$
declare n int; p record;
begin
  select count(*) into n from alerta_ocorrencias;
  select * into p from alerta_previa(array['Montagem', 'Posto Sem Bipe'], 'bipes', 50, 20)
   where posto = 'Montagem';
  if p.aprovados <> 20 or p.reprovados <> 30 then raise exception 'FALHOU: prévia %', p; end if;
  if p.taxa <> 40.00 or p.avaliavel is not true then raise exception 'FALHOU: taxa da prévia %', p; end if;
  select * into p from alerta_previa(array['Montagem', 'Posto Sem Bipe'], 'bipes', 50, 20)
   where posto = 'Posto Sem Bipe';
  if p.aprovados <> 0 or p.taxa is not null or p.avaliavel is not false then
    raise exception 'FALHOU: prévia de posto sem bipe %', p;
  end if;
  if (select count(*) from alerta_ocorrencias) <> n then raise exception 'FALHOU: prévia gravou ocorrência'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform * from alerta_previa(array['Montagem'], 'tempo', 60, 20);
    raise exception 'FALHOU: prévia sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- 16. alerta_destinatarios: usuários ativos + quais canais cada um tem.
do $t$
declare d record;
begin
  if (select count(*) from alerta_destinatarios()) <> 3 then raise exception 'FALHOU: destinatários'; end if;
  select * into d from alerta_destinatarios() where usuario_id = '00000000-0000-0000-0000-000000000001';
  if d.telegram is not true or d.discord is not true then raise exception 'FALHOU: canais da Ana %', d; end if;
  select * into d from alerta_destinatarios() where usuario_id = '00000000-0000-0000-0000-000000000003';
  if d.telegram is not false or d.discord is not false then raise exception 'FALHOU: Carla sem canais %', d; end if;
end $t$;

-- 17. alerta_resolver_admin + alerta_listar_ocorrencias (com contagem de envios).
-- As avaliações das seções 12-14 encerraram a ocorrência da seção 11 (regra 'Mínimo' desativada):
-- reativa a regra e avalia de novo para ter uma ocorrência ABERTA de verdade aqui.
reset role;
update public.alerta_regras set ativa = true where nome = 'Mínimo';
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;

insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, texto, ok, tentativas)
select id, '00000000-0000-0000-0000-000000000001', 'telegram', 'alerta', 'x', true, 1
  from public.alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';
insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, texto, ok, erro, tentativas)
select id, '00000000-0000-0000-0000-000000000002', 'discord', 'alerta', 'x', false, 'Discord 403', 1
  from public.alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';

set role authenticated;
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
do $t$
declare l record; oc uuid; r jsonb;
begin
  select * into l from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'aberta')
   where posto = 'Inspeção';
  if l.regra_nome <> 'Mínimo' then raise exception 'FALHOU: nome da regra na listagem %', l; end if;
  if l.envios_ok <> 1 or l.envios_falha <> 1 then raise exception 'FALHOU: contagem de envios %', l; end if;

  if exists (select 1 from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'normalizada')
              where estado <> 'normalizada') then
    raise exception 'FALHOU: filtro de estado';
  end if;

  select id into oc from alerta_ocorrencias where posto = 'Inspeção' and estado = 'aberta';
  r := alerta_resolver_admin(oc);
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: resolver pela tela %', r; end if;
  if r->>'resolvida_por_nome' <> 'Ana Gestora' then raise exception 'FALHOU: autor pela tela %', r; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
declare oc uuid;
begin
  begin
    perform alerta_listar_ocorrencias(now() - interval '1 day', now(), '');
    raise exception 'FALHOU: listagem sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
reset role;

\echo 'ALERTAS: SQL OK'
```

- [ ] **Step 2: Acrescentar o caso de concorrência ao runner**

Em `supabase/tests/rodar-alertas-test.sh`, **substituir** a última linha (`echo "ALERTAS SQL OK"`) por:

```bash
# ---------- Concorrência: a trava do alerta_avaliar ----------
# A sessão 1 roda alerta_avaliar dentro de uma transação e segura com pg_sleep; a sessão 2 começa
# ~1 s depois. Sem pg_try_advisory_xact_lock as duas avaliariam ao mesmo tempo e o mesmo posto
# viraria dois alertas (ou um erro de índice único).
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

set +e
sessao >"$TMPD/s1.out" 2>"$TMPD/s1.err" <<'SQL' &
set role service_role;
begin;
select alerta_avaliar()->>'ocupado';
select pg_sleep(3);
commit;
SQL
P1=$!
sleep 1
OCUPADO=$(sessao 2>"$TMPD/s2.err" <<'SQL'
set role service_role;
select alerta_avaliar()->>'ocupado';
SQL
)
wait "$P1"
set -e

if [ "$(tr -d '[:space:]' <<<"$OCUPADO")" = "true" ]; then
  echo "trava do alerta_avaliar: ok"
else
  echo "trava do alerta_avaliar FALHOU: ocupado='$OCUPADO'"
  cat "$TMPD/s1.err" "$TMPD/s2.err"
  exit 1
fi

echo "ALERTAS SQL OK"
```

- [ ] **Step 3: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && ./supabase/tests/rodar-alertas-test.sh
```
Expected: FAIL com `ERROR:  function alerta_avaliar() does not exist`.

- [ ] **Step 4: Acrescentar as funções à migração 0113**

Em `supabase/migrations/0113_alertas.sql`, **inserir o bloco abaixo imediatamente antes** da linha `notify pgrst, 'reload schema';` (que continua sendo a última linha do arquivo):

```sql
-- ---------- alerta_taxas(): a conta de aprovados/reprovados por posto em cada janela ----------
-- Função INTERNA (sem grant): é chamada por alerta_avaliar e alerta_previa, que já fazem o gate.
-- As três janelas convivem num único SELECT para o avaliar fazer uma passada só no banco.
create or replace function public.alerta_taxas(p_postos text[], p_janela_tipo text, p_janela_valor int)
returns table (posto text, aprovados int, reprovados int, pmo text, op text)
language sql
stable
security definer
set search_path = public
as $func$
  select p.posto,
         coalesce(c.aprovados, 0)::int,
         coalesce(c.reprovados, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    -- janela 'op': a OP do ÚLTIMO bipe do posto, e só se esse bipe tem menos de 2 horas
    left join lateral (
      select r.pmo, r.op
        from sf_registros r
       where p_janela_tipo = 'op'
         and r.posto = p.posto
         and r.data_hora >= now() - interval '2 hours'
       order by r.data_hora desc
       limit 1
    ) u on true
    left join lateral (
      select count(*) filter (where lower(x.status) = 'aprovado')  as aprovados,
             count(*) filter (where lower(x.status) = 'reprovado') as reprovados
        from (
          -- janela 'tempo': todos os bipes do posto nos últimos N minutos, de todas as OPs
          select r.status
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and lower(r.status) in ('aprovado', 'reprovado')
          union all
          -- janela 'bipes': os N últimos bipes COM status do posto, sem limite de tempo
          (select r.status
             from sf_registros r
            where p_janela_tipo = 'bipes'
              and r.posto = p.posto
              and lower(r.status) in ('aprovado', 'reprovado')
            order by r.data_hora desc
            limit p_janela_valor)
          union all
          -- janela 'op': todos os bipes do posto naquela OP
          select r.status
            from sf_registros r
           where p_janela_tipo = 'op'
             and r.posto = p.posto
             and r.pmo = u.pmo and r.op = u.op
             and lower(r.status) in ('aprovado', 'reprovado')
        ) x
    ) c on true
$func$;

revoke all on function public.alerta_taxas(text[], text, int) from public, anon, authenticated, service_role;

-- ---------- alerta_avaliar(): decide tudo e devolve a lista de envios ----------
create or replace function public.alerta_avaliar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_agora     timestamptz := now();
  v_acoes     jsonb := '[]'::jsonb;
  v_avaliadas int := 0;
  v_total     int;
  v_taxa      numeric(5,2);
  v_tipo      text;
  v_contas    jsonb;
  t           record;
  o           public.alerta_ocorrencias;
begin
  -- Duas avaliações ao mesmo tempo (cron atrasado + "Avaliar agora") abririam a MESMA ocorrência
  -- duas vezes. A segunda simplesmente vai embora avisando que está ocupado.
  if not pg_try_advisory_xact_lock(hashtext('alerta_avaliar')) then
    return jsonb_build_object('ocupado', true, 'avaliadas', 0, 'acoes', '[]'::jsonb);
  end if;

  -- Regra desativada ou posto tirado da regra: a ocorrência viva encerra SEM envio.
  update public.alerta_ocorrencias oc
     set estado = 'normalizada', normalizada_em = v_agora
    from public.alerta_regras rg
   where rg.id = oc.regra_id
     and oc.estado in ('aberta', 'resolvida')
     and (rg.ativa is false or not (oc.posto = any (rg.postos)));

  for t in
    select rg.id as regra_id, rg.nome, rg.taxa_minima, rg.janela_tipo, rg.janela_valor,
           rg.minimo_bipes, rg.lembrete_min, rg.canais, rg.destinatarios,
           tx.posto, tx.aprovados, tx.reprovados, tx.pmo, tx.op
      from public.alerta_regras rg
      cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor) tx
     where rg.ativa
     order by rg.criado_em, tx.posto
  loop
    v_avaliadas := v_avaliadas + 1;
    v_total := t.aprovados + t.reprovados;
    -- Abaixo do mínimo de bipes a regra não decide NADA (nem abre, nem normaliza).
    if v_total < t.minimo_bipes then
      continue;
    end if;
    v_taxa := trunc((t.aprovados * 100.0) / v_total, 2);
    v_tipo := null;

    select * into o
      from public.alerta_ocorrencias
     where regra_id = t.regra_id and posto = t.posto and estado in ('aberta', 'resolvida')
     for update;

    if not found then
      if v_taxa < t.taxa_minima then
        insert into public.alerta_ocorrencias
          (regra_id, posto, pmo, op, taxa_abertura, taxa_ultima, aprovados, reprovados,
           aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto,
                case when t.janela_tipo = 'op' then t.pmo end,
                case when t.janela_tipo = 'op' then t.op end,
                v_taxa, v_taxa, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif v_taxa >= t.taxa_minima then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             taxa_ultima = v_taxa, aprovados = t.aprovados, reprovados = t.reprovados
       where id = o.id
      returning * into o;
      v_tipo := 'normalizou';

    else
      -- Continua abaixo: atualiza a foto da taxa e, se for hora, marca o lembrete.
      update public.alerta_ocorrencias
         set taxa_ultima = v_taxa, aprovados = t.aprovados, reprovados = t.reprovados,
             ultimo_envio_em = case
               when o.estado = 'aberta' and t.lembrete_min is not null
                    and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min)
                 then v_agora
               else o.ultimo_envio_em
             end
       where id = o.id
      returning * into o;
      if o.estado = 'aberta' and t.lembrete_min is not null and o.ultimo_envio_em = v_agora then
        v_tipo := 'lembrete';
      end if;
    end if;

    if v_tipo is not null then
      -- Um envio por destinatário x canal da regra QUE TENHA vínculo. Sem vínculo, é pulado aqui.
      v_contas := coalesce((
        select jsonb_agg(jsonb_build_object('usuario_id', c.usuario_id, 'canal', c.canal,
                                            'externo_id', c.externo_id)
                         order by c.usuario_id, c.canal)
          from alerta_contas c
         where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
      ), '[]'::jsonb);

      v_acoes := v_acoes || jsonb_build_array(jsonb_build_object(
        'ocorrencia_id', o.id,
        'tipo',          v_tipo,
        'regra_id',      t.regra_id,
        'regra_nome',    t.nome,
        'posto',         t.posto,
        'taxa',          v_taxa,
        'taxa_minima',   t.taxa_minima,
        'aprovados',     t.aprovados,
        'reprovados',    t.reprovados,
        'janela_tipo',   t.janela_tipo,
        'janela_valor',  t.janela_valor,
        'pmo',           t.pmo,
        'op',            t.op,
        'aberta_em',     o.aberta_em,
        'agora',         v_agora,
        'contas',        v_contas
      ));
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas, 'acoes', v_acoes);
end
$func$;

revoke all on function public.alerta_avaliar() from public, anon, authenticated;
grant execute on function public.alerta_avaliar() to service_role;

-- ---------- alerta_previa(): a taxa de agora, sem gravar nada (prévia do formulário) ----------
create or replace function public.alerta_previa(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int
)
returns table (posto text, aprovados int, reprovados int, taxa numeric, avaliavel boolean,
               pmo text, op text)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_janela_tipo not in ('tempo', 'bipes', 'op') then raise exception 'JANELA_INVALIDA'; end if;

  return query
    select t.posto, t.aprovados, t.reprovados,
           case when t.aprovados + t.reprovados > 0
                then trunc((t.aprovados * 100.0) / (t.aprovados + t.reprovados), 2)
           end,
           (t.aprovados + t.reprovados) >= greatest(coalesce(p_minimo, 1), 1),
           t.pmo, t.op
      from public.alerta_taxas(p_postos, p_janela_tipo, p_janela_valor) t;
end
$func$;

revoke all on function public.alerta_previa(text[], text, int, int) from public, anon;
grant execute on function public.alerta_previa(text[], text, int, int) to authenticated, service_role;

-- ---------- Resolver ----------
-- O núcleo é interno; as duas portas mudam só QUEM pode chamar e se exige ser destinatário:
--   alerta_resolver       -> webhook (service_role), exige ser destinatário da regra;
--   alerta_resolver_admin -> tela (authenticated + shopfloor.administrar).
create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  o     public.alerta_ocorrencias;
  r     public.alerta_regras;
  v_ja  boolean := true;
  v_nome text;
begin
  select * into o from alerta_ocorrencias where id = p_ocorrencia_id for update;
  if not found then raise exception 'OCORRENCIA_INEXISTENTE'; end if;
  select * into r from alerta_regras where id = o.regra_id;
  if p_exigir_destinatario and not (p_usuario_id = any (r.destinatarios)) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  if o.estado = 'normalizada' then raise exception 'OCORRENCIA_ENCERRADA'; end if;

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now()
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  return jsonb_build_object(
    'ocorrencia_id',      o.id,
    'regra_id',           o.regra_id,
    'posto',              o.posto,
    'ja_resolvida',       v_ja,
    'resolvida_por',      o.resolvida_por,
    'resolvida_por_nome', coalesce(v_nome, ''),
    'resolvida_em',       o.resolvida_em
  );
end
$func$;

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.alerta_resolver(p_ocorrencia_id uuid, p_usuario_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $func$
  select public.alerta_resolver_interno(p_ocorrencia_id, p_usuario_id, true)
$func$;

revoke all on function public.alerta_resolver(uuid, uuid) from public, anon, authenticated;
grant execute on function public.alerta_resolver(uuid, uuid) to service_role;

create or replace function public.alerta_resolver_admin(p_ocorrencia_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return public.alerta_resolver_interno(p_ocorrencia_id, auth.uid(), false);
end
$func$;

revoke all on function public.alerta_resolver_admin(uuid) from public, anon;
grant execute on function public.alerta_resolver_admin(uuid) to authenticated, service_role;

-- ---------- alerta_destinatarios(): quem pode receber, e por quais canais ----------
-- Devolve o VÍNCULO como booleano (nunca o externo_id) — a tela só precisa saber se existe.
create or replace function public.alerta_destinatarios()
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord')
      from usuarios u
     where u.ativo
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios() from public, anon;
grant execute on function public.alerta_destinatarios() to authenticated, service_role;

-- ---------- alerta_listar_ocorrencias(): aba Ocorrências ----------
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select oc.id, oc.regra_id, rg.nome, oc.posto, oc.pmo, oc.op, oc.estado,
           oc.taxa_abertura, oc.taxa_ultima, oc.aprovados, oc.reprovados, oc.aberta_em,
           coalesce(nullif(btrim(u.nome), ''), u.email, ''),
           oc.resolvida_em, oc.normalizada_em,
           coalesce(e.ok_qtd, 0)::int, coalesce(e.falha_qtd, 0)::int
      from alerta_ocorrencias oc
      join alerta_regras rg on rg.id = oc.regra_id
      left join usuarios u on u.id = oc.resolvida_por
      left join lateral (
        select count(*) filter (where ev.ok)     as ok_qtd,
               count(*) filter (where not ev.ok) as falha_qtd
          from alerta_envios ev
         where ev.ocorrencia_id = oc.id
      ) e on true
     where oc.aberta_em >= p_de
       and oc.aberta_em <= p_ate
       and (coalesce(p_estado, '') = '' or oc.estado = p_estado)
     order by oc.aberta_em desc
     limit 500;
end
$func$;

revoke all on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text)
  to authenticated, service_role;
```

- [ ] **Step 5: Rodar os testes SQL e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && ./supabase/tests/rodar-alertas-test.sh
```
Expected: `ALERTAS: SQL OK`, `trava do alerta_avaliar: ok`, `ALERTAS SQL OK`.

- [ ] **Step 6: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add supabase/migrations/0113_alertas.sql supabase/tests/alertas_test.sql supabase/tests/rodar-alertas-test.sh
git commit -m "$(cat <<'MSG'
feat(alertas): avaliação, prévia, resolver e listagens na 0113

alerta_taxas cobre as três janelas (tempo/bipes/OP com corte de 2 h),
alerta_avaliar aplica as transições sob trava e devolve as ações de envio,
alerta_previa mostra a taxa de agora sem gravar, alerta_resolver (webhook,
só destinatário, idempotente) e alerta_resolver_admin (tela), mais
alerta_destinatarios e alerta_listar_ocorrencias. Testes SQL das 3 janelas,
mínimo de bipes, transições, índice único e da trava.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Clients de Telegram e Discord + verificação de assinatura

**Files:**
- Create: `src/modules/alertas/infra/telegram.ts`
- Create: `src/modules/alertas/infra/discord.ts`
- Create: `src/modules/alertas/infra/assinatura.ts`
- Test: `src/modules/alertas/infra/__tests__/telegram.test.ts`
- Test: `src/modules/alertas/infra/__tests__/discord.test.ts`
- Test: `src/modules/alertas/infra/__tests__/assinatura.test.ts`

**Interfaces:**
- Consumes (Task 1): `montarCallbackResolver(ocorrenciaId: string): string` de `../domain/codigos`; `ResultadoEnvio`, `ResultadoSimples` de `../domain/tipos`.
- Produces:
  - `interface TelegramClient { enviarMensagem(chatId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>; editarTexto(mensagemExternaId: string, texto: string): Promise<ResultadoSimples>; removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>; responderCallback(callbackQueryId: string, texto: string): Promise<ResultadoSimples> }`
  - `criarTelegram(cfg: { token: string; fetch?: typeof fetch }): TelegramClient`
  - `payloadMensagemTelegram(chatId: string, texto: string, ocorrenciaIdBotao: string | null): Record<string, unknown>`
  - `montarIdMensagemTelegram(chatId: string | number, messageId: string | number): string`
  - `interface DiscordClient { enviarDm(usuarioExternoId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>; removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples> }`
  - `criarDiscord(cfg: { token: string; fetch?: typeof fetch }): DiscordClient`
  - `payloadMensagemDiscord(texto: string, ocorrenciaIdBotao: string | null): Record<string, unknown>`
  - `verificarAssinaturaDiscord(chavePublicaHex: string, assinaturaHex: string | null, timestamp: string | null, corpo: string): boolean`
  - `segredoConfere(recebido: string | null | undefined, esperado: string): boolean`
  - Formato do `mensagemExternaId`: `"<chat id>:<message id>"` (Telegram) e `"<channel id>:<message id>"` (Discord).

- [ ] **Step 1: Escrever o teste do client do Telegram (falhando)**

Criar `src/modules/alertas/infra/__tests__/telegram.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { criarTelegram, payloadMensagemTelegram, montarIdMensagemTelegram } from '../telegram'

/** fetch de mentira: guarda as chamadas e devolve as respostas na ordem. */
function fetchFalso(respostas: { corpo: unknown; status?: number }[]) {
  const chamadas: { url: string; corpo: unknown }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) })
    const r = respostas[chamadas.length - 1] ?? { corpo: { ok: true, result: {} } }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('payloadMensagemTelegram', () => {
  it('sem ocorrência não manda teclado', () => {
    expect(payloadMensagemTelegram('123', 'oi', null)).toEqual({
      chat_id: '123',
      text: 'oi',
      disable_web_page_preview: true,
    })
  })
  it('com ocorrência manda o botão Resolvido com o callback curto', () => {
    const p = payloadMensagemTelegram('123', 'oi', '11111111-2222-3333-4444-555555555555')
    expect(p.reply_markup).toEqual({
      inline_keyboard: [[{ text: '✅ Resolvido', callback_data: 'r:11111111-2222-3333-4444-555555555555' }]],
    })
  })
})

describe('montarIdMensagemTelegram', () => {
  it('junta chat e mensagem', () => {
    expect(montarIdMensagemTelegram(123, 456)).toBe('123:456')
  })
})

describe('criarTelegram', () => {
  it('envia a mensagem e devolve chat:message', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: { message_id: 456 } } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r).toEqual({ ok: true, mensagemExternaId: '123:456' })
    expect(chamadas[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage')
  })

  it('erro da API vira { ok: false } sem vazar o token', async () => {
    const { fn } = fetchFalso([{ corpo: { ok: false, description: 'chat not found' }, status: 400 }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro).toBe('Telegram 400: chat not found')
      expect(r.erro).not.toContain('TOKEN')
    }
  })

  it('resposta sem message_id é falha', async () => {
    const { fn } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r.ok).toBe(false)
  })

  it('editarTexto usa editMessageText e não reenvia teclado', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.editarTexto('123:456', 'novo texto')
    expect(r).toEqual({ ok: true })
    expect(chamadas[0]!.url).toContain('/editMessageText')
    expect(chamadas[0]!.corpo).toMatchObject({ chat_id: '123', message_id: 456, text: 'novo texto' })
    expect(chamadas[0]!.corpo).not.toHaveProperty('reply_markup')
  })

  it('removerBotoes manda teclado vazio', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    await tg.removerBotoes('123:456')
    expect(chamadas[0]!.url).toContain('/editMessageReplyMarkup')
    expect(chamadas[0]!.corpo).toMatchObject({ reply_markup: { inline_keyboard: [] } })
  })

  it('"message is not modified" conta como sucesso (o botão já estava fora)', async () => {
    const { fn } = fetchFalso([
      { corpo: { ok: false, description: 'Bad Request: message is not modified' }, status: 400 },
    ])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    expect(await tg.removerBotoes('123:456')).toEqual({ ok: true })
  })

  it('id de mensagem inválido não chega a chamar a API', async () => {
    const { fn, chamadas } = fetchFalso([])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.removerBotoes('sem-message-id')
    expect(r.ok).toBe(false)
    expect(chamadas).toHaveLength(0)
  })

  it('responderCallback usa answerCallbackQuery', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: true } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    await tg.responderCallback('cb1', 'Marcado como resolvido.')
    expect(chamadas[0]!.url).toContain('/answerCallbackQuery')
    expect(chamadas[0]!.corpo).toEqual({ callback_query_id: 'cb1', text: 'Marcado como resolvido.' })
  })

  it('falha de rede vira { ok: false } com a mensagem do erro', async () => {
    const fn = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r).toEqual({ ok: false, erro: 'Telegram: fetch failed' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/infra/__tests__/telegram.test.ts
```
Expected: FAIL com `Failed to load url ../telegram`.

- [ ] **Step 3: Implementar o client do Telegram**

Criar `src/modules/alertas/infra/telegram.ts`:

```ts
import { montarCallbackResolver } from '../domain/codigos'
import type { ResultadoEnvio, ResultadoSimples } from '../domain/tipos'

const TEMPO_LIMITE_MS = 10_000

export interface TelegramClient {
  enviarMensagem(chatId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>
  editarTexto(mensagemExternaId: string, texto: string): Promise<ResultadoSimples>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
  responderCallback(callbackQueryId: string, texto: string): Promise<ResultadoSimples>
}

export function payloadMensagemTelegram(
  chatId: string,
  texto: string,
  ocorrenciaIdBotao: string | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = { chat_id: chatId, text: texto, disable_web_page_preview: true }
  if (!ocorrenciaIdBotao) return base
  return {
    ...base,
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Resolvido', callback_data: montarCallbackResolver(ocorrenciaIdBotao) }]],
    },
  }
}

/** '<chat id>:<message id>' — é o par que o Telegram exige para EDITAR a mensagem depois. */
export function montarIdMensagemTelegram(chatId: string | number, messageId: string | number): string {
  return `${chatId}:${messageId}`
}

function separarId(id: string): { chatId: string; messageId: number } | null {
  const i = id.lastIndexOf(':')
  if (i <= 0) return null
  const messageId = Number(id.slice(i + 1))
  if (!Number.isInteger(messageId)) return null
  return { chatId: id.slice(0, i), messageId }
}

export function criarTelegram(cfg: { token: string; fetch?: typeof fetch }): TelegramClient {
  async function chamar(
    metodo: string,
    corpo: Record<string, unknown>,
  ): Promise<{ ok: true; resultado: Record<string, unknown> } | { ok: false; erro: string }> {
    const f = cfg.fetch ?? fetch
    try {
      const res = await f(`https://api.telegram.org/bot${cfg.token}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: unknown; description?: string }
        | null
      if (!res.ok || json?.ok !== true) {
        const descricao = json?.description ?? 'sem descrição'
        // Editar uma mensagem que já está sem botão devolve erro, mas o resultado desejado já está lá.
        if (descricao.includes('message is not modified')) return { ok: true, resultado: {} }
        return { ok: false, erro: `Telegram ${res.status}: ${descricao}` }
      }
      const resultado = json.result
      return { ok: true, resultado: typeof resultado === 'object' && resultado !== null ? (resultado as Record<string, unknown>) : {} }
    } catch (e) {
      // NUNCA embutir a URL no erro: ela carrega o token do bot, e o erro vai pro banco/tela.
      return { ok: false, erro: `Telegram: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  return {
    async enviarMensagem(chatId, texto, ocorrenciaIdBotao) {
      const r = await chamar('sendMessage', payloadMensagemTelegram(chatId, texto, ocorrenciaIdBotao))
      if (!r.ok) return r
      const messageId = r.resultado.message_id
      if (typeof messageId !== 'number') return { ok: false, erro: 'Telegram: resposta sem message_id' }
      return { ok: true, mensagemExternaId: montarIdMensagemTelegram(chatId, messageId) }
    },

    async editarTexto(mensagemExternaId, texto) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Telegram: id de mensagem inválido' }
      // Sem `reply_markup` na edição, o Telegram remove o teclado — é o que a gente quer.
      const r = await chamar('editMessageText', {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: texto,
        disable_web_page_preview: true,
      })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },

    async removerBotoes(mensagemExternaId) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Telegram: id de mensagem inválido' }
      const r = await chamar('editMessageReplyMarkup', {
        chat_id: p.chatId,
        message_id: p.messageId,
        reply_markup: { inline_keyboard: [] },
      })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },

    async responderCallback(callbackQueryId, texto) {
      const r = await chamar('answerCallbackQuery', { callback_query_id: callbackQueryId, text: texto })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/infra/__tests__/telegram.test.ts
```
Expected: PASS — `Tests 12 passed`.

- [ ] **Step 5: Escrever o teste do client do Discord (falhando)**

Criar `src/modules/alertas/infra/__tests__/discord.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { criarDiscord, payloadMensagemDiscord } from '../discord'

function fetchFalso(respostas: { corpo: unknown; status?: number }[]) {
  const chamadas: { url: string; metodo: string; corpo: unknown; autorizacao: string }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const cabecalhos = (init?.headers ?? {}) as Record<string, string>
    chamadas.push({
      url: String(url),
      metodo: String(init?.method ?? 'GET'),
      corpo: JSON.parse(String(init?.body ?? '{}')),
      autorizacao: cabecalhos.Authorization ?? '',
    })
    const r = respostas[chamadas.length - 1] ?? { corpo: {} }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('payloadMensagemDiscord', () => {
  it('sem ocorrência vai só o conteúdo (sem menções)', () => {
    expect(payloadMensagemDiscord('oi', null)).toEqual({ content: 'oi', allowed_mentions: { parse: [] } })
  })
  it('com ocorrência inclui o botão com custom_id', () => {
    const p = payloadMensagemDiscord('oi', '11111111-2222-3333-4444-555555555555')
    expect(p.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Resolvido',
            emoji: { name: '✅' },
            custom_id: 'r:11111111-2222-3333-4444-555555555555',
          },
        ],
      },
    ])
  })
})

describe('criarDiscord', () => {
  it('abre a DM e envia, devolvendo canal:mensagem', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { id: 'C9' } }, { corpo: { id: 'M7' } }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    const r = await dc.enviarDm('U1', 'oi', null)
    expect(r).toEqual({ ok: true, mensagemExternaId: 'C9:M7' })
    expect(chamadas[0]).toMatchObject({
      url: 'https://discord.com/api/v10/users/@me/channels',
      metodo: 'POST',
      corpo: { recipient_id: 'U1' },
      autorizacao: 'Bot BOTTOKEN',
    })
    expect(chamadas[1]!.url).toBe('https://discord.com/api/v10/channels/C9/messages')
  })

  it('DM bloqueada (403) vira falha com a mensagem do Discord', async () => {
    const { fn } = fetchFalso([{ corpo: { message: 'Cannot send messages to this user' }, status: 403 }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    const r = await dc.enviarDm('U1', 'oi', null)
    expect(r).toEqual({ ok: false, erro: 'Discord 403: Cannot send messages to this user' })
  })

  it('removerBotoes faz PATCH na mensagem com components vazio', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: {} }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    expect(await dc.removerBotoes('C9:M7')).toEqual({ ok: true })
    expect(chamadas[0]).toMatchObject({
      url: 'https://discord.com/api/v10/channels/C9/messages/M7',
      metodo: 'PATCH',
      corpo: { components: [] },
    })
  })

  it('id de mensagem inválido não chama a API', async () => {
    const { fn, chamadas } = fetchFalso([])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    expect((await dc.removerBotoes('semcanal')).ok).toBe(false)
    expect(chamadas).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/infra/__tests__/discord.test.ts
```
Expected: FAIL com `Failed to load url ../discord`.

- [ ] **Step 7: Implementar o client do Discord**

Criar `src/modules/alertas/infra/discord.ts`:

```ts
import { montarCallbackResolver } from '../domain/codigos'
import type { ResultadoEnvio, ResultadoSimples } from '../domain/tipos'

const API = 'https://discord.com/api/v10'
const TEMPO_LIMITE_MS = 10_000

export interface DiscordClient {
  /** Abre (ou reaproveita) a DM com a pessoa e manda a mensagem. */
  enviarDm(usuarioExternoId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
}

export function payloadMensagemDiscord(
  texto: string,
  ocorrenciaIdBotao: string | null,
): Record<string, unknown> {
  // allowed_mentions vazio: a mensagem nunca vira notificação de @menção pra ninguém.
  const base: Record<string, unknown> = { content: texto, allowed_mentions: { parse: [] } }
  if (!ocorrenciaIdBotao) return base
  return {
    ...base,
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2, // button
            style: 3, // success (verde)
            label: 'Resolvido',
            emoji: { name: '✅' },
            custom_id: montarCallbackResolver(ocorrenciaIdBotao),
          },
        ],
      },
    ],
  }
}

/** '<channel id>:<message id>' — o Discord edita por canal + mensagem. */
export function montarIdMensagemDiscord(canalId: string, mensagemId: string): string {
  return `${canalId}:${mensagemId}`
}

function separarId(id: string): { canalId: string; mensagemId: string } | null {
  const i = id.lastIndexOf(':')
  if (i <= 0 || i === id.length - 1) return null
  return { canalId: id.slice(0, i), mensagemId: id.slice(i + 1) }
}

export function criarDiscord(cfg: { token: string; fetch?: typeof fetch }): DiscordClient {
  async function chamar(
    metodo: 'POST' | 'PATCH',
    caminho: string,
    corpo: Record<string, unknown>,
  ): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; erro: string }> {
    const f = cfg.fetch ?? fetch
    try {
      const res = await f(`${API}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bot ${cfg.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ShopFloor (https://shopfloor.enterplak.com.br, 1.0)',
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        const mensagem = typeof json?.message === 'string' ? json.message : 'sem descrição'
        return { ok: false, erro: `Discord ${res.status}: ${mensagem}` }
      }
      return { ok: true, json: json ?? {} }
    } catch (e) {
      return { ok: false, erro: `Discord: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  return {
    async enviarDm(usuarioExternoId, texto, ocorrenciaIdBotao) {
      const canal = await chamar('POST', '/users/@me/channels', { recipient_id: usuarioExternoId })
      if (!canal.ok) return canal
      const canalId = canal.json.id
      if (typeof canalId !== 'string') return { ok: false, erro: 'Discord: resposta sem id do canal' }

      const msg = await chamar('POST', `/channels/${canalId}/messages`, payloadMensagemDiscord(texto, ocorrenciaIdBotao))
      if (!msg.ok) return msg
      const mensagemId = msg.json.id
      if (typeof mensagemId !== 'string') return { ok: false, erro: 'Discord: resposta sem id da mensagem' }
      return { ok: true, mensagemExternaId: montarIdMensagemDiscord(canalId, mensagemId) }
    },

    async removerBotoes(mensagemExternaId) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Discord: id de mensagem inválido' }
      const r = await chamar('PATCH', `/channels/${p.canalId}/messages/${p.mensagemId}`, { components: [] })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },
  }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/infra/__tests__/discord.test.ts
```
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 9: Escrever o teste da assinatura e do segredo (falhando)**

Criar `src/modules/alertas/infra/__tests__/assinatura.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verificarAssinaturaDiscord, segredoConfere } from '../assinatura'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
const CHAVE_HEX = der.subarray(12).toString('hex') // é isso que o Discord mostra no portal
const assinar = (timestamp: string, corpo: string) =>
  sign(null, Buffer.from(timestamp + corpo), privateKey).toString('hex')

describe('verificarAssinaturaDiscord', () => {
  it('a chave do portal são os 32 bytes crus depois do prefixo SPKI de Ed25519', () => {
    expect(der.subarray(0, 12).toString('hex')).toBe('302a300506032b6570032100')
    expect(CHAVE_HEX).toHaveLength(64)
  })

  it('aceita a assinatura de timestamp + corpo', () => {
    const corpo = JSON.stringify({ type: 1 })
    const ts = '1789000000'
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinar(ts, corpo), ts, corpo)).toBe(true)
  })

  it('recusa quando o corpo muda', () => {
    const ts = '1789000000'
    const assinatura = assinar(ts, JSON.stringify({ type: 1 }))
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, ts, JSON.stringify({ type: 3 }))).toBe(false)
  })

  it('recusa quando o timestamp muda', () => {
    const corpo = JSON.stringify({ type: 1 })
    const assinatura = assinar('1789000000', corpo)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, '1789000001', corpo)).toBe(false)
  })

  it('recusa assinatura de outra chave', () => {
    const outro = generateKeyPairSync('ed25519')
    const corpo = JSON.stringify({ type: 1 })
    const ts = '1789000000'
    const assinatura = sign(null, Buffer.from(ts + corpo), outro.privateKey).toString('hex')
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, ts, corpo)).toBe(false)
  })

  it('recusa entradas ausentes ou com formato errado', () => {
    const corpo = '{}'
    expect(verificarAssinaturaDiscord(CHAVE_HEX, null, '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'aa', '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord('', 'aa'.repeat(64), '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'zz'.repeat(64), '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'aa'.repeat(64), null, corpo)).toBe(false)
  })
})

describe('segredoConfere', () => {
  it('aceita o segredo igual', () => {
    expect(segredoConfere('abc123', 'abc123')).toBe(true)
  })
  it('recusa diferente, vazio ou ausente', () => {
    expect(segredoConfere('abc124', 'abc123')).toBe(false)
    expect(segredoConfere('abc', 'abc123')).toBe(false)
    expect(segredoConfere(null, 'abc123')).toBe(false)
    expect(segredoConfere('abc123', '')).toBe(false)
  })
})
```

- [ ] **Step 10: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/infra/__tests__/assinatura.test.ts
```
Expected: FAIL com `Failed to load url ../assinatura`.

- [ ] **Step 11: Implementar a verificação de assinatura e do segredo**

Criar `src/modules/alertas/infra/assinatura.ts`:

```ts
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto'

/**
 * O Discord publica a chave pública do app como 32 bytes crus em hexadecimal. O `node:crypto` só
 * importa chave estruturada, então a gente prefixa o cabeçalho SPKI de Ed25519 (12 bytes fixos) e
 * entrega o DER pronto — sem biblioteca nenhuma.
 */
const PREFIXO_SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

const RE_HEX_32 = /^[0-9a-f]{64}$/i
const RE_HEX_64 = /^[0-9a-f]{128}$/i

/** A assinatura cobre `timestamp + corpo cru` — por isso a rota lê o corpo como texto. */
export function verificarAssinaturaDiscord(
  chavePublicaHex: string,
  assinaturaHex: string | null,
  timestamp: string | null,
  corpo: string,
): boolean {
  if (!assinaturaHex || !timestamp) return false
  if (!RE_HEX_32.test(chavePublicaHex) || !RE_HEX_64.test(assinaturaHex)) return false
  try {
    const chave = createPublicKey({
      key: Buffer.concat([PREFIXO_SPKI_ED25519, Buffer.from(chavePublicaHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(timestamp + corpo), chave, Buffer.from(assinaturaHex, 'hex'))
  } catch {
    return false
  }
}

/** Compara segredos em tempo constante (cron e webhook do Telegram). */
export function segredoConfere(recebido: string | null | undefined, esperado: string): boolean {
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 12: Rodar todos os testes de infra, tipos e lint**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas && npx tsc --noEmit && npm run lint
```
Expected: `Test Files 6 passed`; `tsc` sem saída; lint sem avisos.

- [ ] **Step 13: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add src/modules/alertas/infra
git commit -m "$(cat <<'MSG'
feat(alertas): clients de Telegram e Discord + assinatura Ed25519

Clients finos com fetch injetável (payloads testados sem rede), id externo no
formato chat/canal:mensagem pra editar a mensagem depois, e verificação da
assinatura do Discord com node:crypto (prefixo SPKI + chave hex do portal),
mais comparação de segredo em tempo constante.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Serviço de avaliação e envio + rota `POST /api/alertas/avaliar`

**Files:**
- Create: `src/modules/alertas/domain/avaliacao.ts`
- Create: `src/modules/alertas/domain/rotas.ts`
- Create: `src/modules/alertas/application/portas.ts`
- Create: `src/modules/alertas/application/enviar-alertas.ts`
- Create: `src/modules/alertas/infra/canais.ts`
- Create: `src/modules/alertas/infra/repositorio-servico.ts`
- Create: `src/modules/alertas/infra/fabrica.ts`
- Create: `src/app/api/alertas/avaliar/route.ts`
- Modify: `middleware.ts` (deixar `/api/alertas/*` passar sem sessão)
- Test: `src/modules/alertas/domain/__tests__/avaliacao.test.ts`
- Test: `src/modules/alertas/application/__tests__/enviar-alertas.test.ts`
- Test: `src/modules/alertas/application/__tests__/rota-avaliar.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `Canal`, `CANAIS`, `NOME_CANAL`, `JanelaTipo`, `TipoEnvio`, `ResultadoEnvio`, `ResultadoSimples`, `ehCanal`, `ehJanelaTipo` (`../domain/tipos`); `textoAlerta`, `textoLembrete`, `textoNormalizou`, `textoResolvido`, `textoTeste` (`../domain/mensagens`).
  - Task 3 (banco): RPC `alerta_avaliar()` com o jsonb `{ ocupado, avaliadas, acoes: [...] }`.
  - Task 4: `criarTelegram`, `TelegramClient`, `criarDiscord`, `DiscordClient`, `segredoConfere`.
  - Projeto: `createServiceSupabase()` de `@/shared/lib/supabase/service`; `updateSession` de `@/shared/lib/supabase/middleware`.
- Produces:
  - `interface ContaDestino { usuarioId: string; canal: Canal; externoId: string }`
  - `type TipoAcao = 'alerta' | 'lembrete' | 'normalizou'`
  - `interface AcaoAvaliacao { ocorrenciaId: string; tipo: TipoAcao; regraId: string; regraNome: string; posto: string; taxa: number; taxaMinima: number; aprovados: number; reprovados: number; janelaTipo: JanelaTipo; janelaValor: number | null; pmo: string | null; op: string | null; abertaEm: string; agora: string; contas: ContaDestino[] }`
  - `interface ResultadoAvaliacaoRpc { ocupado: boolean; avaliadas: number; acoes: AcaoAvaliacao[] }`
  - `lerResultadoAvaliacao(json: unknown): ResultadoAvaliacaoRpc`; `textoDaAcao(a: AcaoAvaliacao): string`; `acaoTemBotao(a: AcaoAvaliacao): boolean`
  - `ehRotaPublicaDeAlertas(pathname: string): boolean`
  - `interface PortaCanal { enviar(externoId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>; removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples> }`; `type PortasCanais = Partial<Record<Canal, PortaCanal>>`
  - `interface NovoEnvio { ocorrenciaId: string | null; usuarioId: string; canal: Canal; tipo: TipoEnvio; texto: string; comBotao: boolean; resultado: ResultadoEnvio }`
  - `interface EnvioPendente { id: string; ocorrenciaId: string | null; canal: Canal; externoId: string; texto: string; comBotao: boolean; tentativas: number }`
  - `interface MensagemComBotao { envioId: string; canal: Canal; mensagemExternaId: string }`
  - `interface RepositorioEnvios { avaliar(): Promise<ResultadoAvaliacaoRpc>; registrarEnvio(e: NovoEnvio): Promise<void>; envioParaReenviar(): Promise<EnvioPendente[]>; registrarReenvio(envio: EnvioPendente, resultado: ResultadoEnvio): Promise<void>; mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]>; marcarSemBotao(envioIds: string[]): Promise<void>; contasDaOcorrencia(ocorrenciaId: string): Promise<ContaDestino[]>; contaDoUsuario(usuarioId: string, canal: Canal): Promise<ContaDestino | null> }`
  - `interface ItemEnvio { conta: ContaDestino; tipo: TipoEnvio; texto: string; ocorrenciaId: string | null; comBotao: boolean }`
  - `interface ResumoEnvio { enviados: number; falhas: number }`; `interface ResumoAvaliacao extends ResumoEnvio { avaliadas: number; ocupado: boolean }`
  - `enviarItens(portas: PortasCanais, repo: RepositorioEnvios, itens: ItemEnvio[]): Promise<ResumoEnvio>`
  - `reenviarFalhas(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoEnvio>`
  - `avaliarEEnviar(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoAvaliacao>`
  - `removerBotoesDaOcorrencia(portas: PortasCanais, repo: RepositorioEnvios, ocorrenciaId: string): Promise<void>`
  - `avisarResolvido(portas: PortasCanais, repo: RepositorioEnvios, r: { ocorrenciaId: string; posto: string; resolvidoPorId: string; resolvidoPorNome: string; resolvidaEm: Date }): Promise<ResumoEnvio>`
  - `enviarTeste(portas: PortasCanais, repo: RepositorioEnvios, p: { usuarioId: string; canal: Canal; nome: string }): Promise<ResultadoSimples>`
  - `canaisConfigurados(env?: NodeJS.ProcessEnv): Record<Canal, boolean>`; `criarPortasCanais(env?: NodeJS.ProcessEnv): PortasCanais`
  - `criarRepositorioServico(sb?: SupabaseClient): RepositorioEnvios` (em `infra/repositorio-servico.ts`)
  - `criarDependenciasAlertas(): { portas: PortasCanais; repo: RepositorioEnvios }` (em `infra/fabrica.ts`)
  - Rota `POST /api/alertas/avaliar` → `200 { avaliadas, enviados, falhas, ocupado }` | `401 { erro }` | `503 { erro }`

- [ ] **Step 1: Escrever o teste do parse da avaliação e da rota pública (falhando)**

Criar `src/modules/alertas/domain/__tests__/avaliacao.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lerResultadoAvaliacao, textoDaAcao, acaoTemBotao, type AcaoAvaliacao } from '../avaliacao'
import { ehRotaPublicaDeAlertas } from '../rotas'

const JSON_RPC = {
  ocupado: false,
  avaliadas: 3,
  acoes: [
    {
      ocorrencia_id: '11111111-2222-3333-4444-555555555555',
      tipo: 'alerta',
      regra_id: '99999999-2222-3333-4444-555555555555',
      regra_nome: 'Teste abaixo de 90',
      posto: 'Teste',
      taxa: 75.0,
      taxa_minima: 90.0,
      aprovados: 15,
      reprovados: 5,
      janela_tipo: 'tempo',
      janela_valor: 60,
      pmo: null,
      op: null,
      aberta_em: '2026-09-17T17:05:00+00:00',
      agora: '2026-09-17T17:05:00+00:00',
      contas: [
        { usuario_id: 'u1', canal: 'telegram', externo_id: '111' },
        { usuario_id: 'u1', canal: 'whatsapp', externo_id: '111' },
        { usuario_id: 'u2', canal: 'discord', externo_id: '' },
      ],
    },
    { tipo: 'coisa-nova', posto: 'X' },
  ],
}

describe('lerResultadoAvaliacao', () => {
  it('lê o resumo e converte a ação', () => {
    const r = lerResultadoAvaliacao(JSON_RPC)
    expect(r.ocupado).toBe(false)
    expect(r.avaliadas).toBe(3)
    expect(r.acoes).toHaveLength(1)
    const a = r.acoes[0]!
    expect(a.ocorrenciaId).toBe('11111111-2222-3333-4444-555555555555')
    expect(a.tipo).toBe('alerta')
    expect(a.regraNome).toBe('Teste abaixo de 90')
    expect(a.taxa).toBe(75)
    expect(a.janelaTipo).toBe('tempo')
    expect(a.janelaValor).toBe(60)
    expect(a.pmo).toBeNull()
  })
  it('descarta canal desconhecido e conta sem id externo', () => {
    const a = lerResultadoAvaliacao(JSON_RPC).acoes[0]!
    expect(a.contas).toEqual([{ usuarioId: 'u1', canal: 'telegram', externoId: '111' }])
  })
  it('ocupado devolve lista vazia', () => {
    expect(lerResultadoAvaliacao({ ocupado: true, avaliadas: 0, acoes: [] })).toEqual({
      ocupado: true,
      avaliadas: 0,
      acoes: [],
    })
  })
  it('entrada inesperada não explode', () => {
    expect(lerResultadoAvaliacao(null)).toEqual({ ocupado: false, avaliadas: 0, acoes: [] })
  })
})

const BASE: AcaoAvaliacao = {
  ocorrenciaId: 'oc1',
  tipo: 'alerta',
  regraId: 'r1',
  regraNome: 'Teste abaixo de 90',
  posto: 'Teste',
  taxa: 75,
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janelaTipo: 'tempo',
  janelaValor: 60,
  pmo: null,
  op: null,
  abertaEm: '2026-09-17T16:35:00Z',
  agora: '2026-09-17T17:05:00Z',
  contas: [],
}

describe('textoDaAcao', () => {
  it('alerta', () => {
    expect(textoDaAcao(BASE).startsWith('🔴 Teste abaixo da meta')).toBe(true)
  })
  it('lembrete usa o tempo desde a abertura', () => {
    expect(textoDaAcao({ ...BASE, tipo: 'lembrete' })).toContain('⏰ Lembrete — continua abaixo há 30 min')
  })
  it('normalizou', () => {
    const t = textoDaAcao({ ...BASE, tipo: 'normalizou', aprovados: 95, reprovados: 5 })
    expect(t).toBe('🟢 Teste normalizou: 95,0% (ficou 30 min abaixo)')
  })
})

describe('acaoTemBotao', () => {
  it('alerta e lembrete levam botão; normalizou não', () => {
    expect(acaoTemBotao(BASE)).toBe(true)
    expect(acaoTemBotao({ ...BASE, tipo: 'lembrete' })).toBe(true)
    expect(acaoTemBotao({ ...BASE, tipo: 'normalizou' })).toBe(false)
  })
})

describe('ehRotaPublicaDeAlertas', () => {
  it('as rotas de alertas passam sem sessão', () => {
    expect(ehRotaPublicaDeAlertas('/api/alertas/avaliar')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/telegram')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/discord')).toBe(true)
  })
  it('o resto continua passando pela sessão', () => {
    expect(ehRotaPublicaDeAlertas('/shopfloor/operar')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/anexos/x')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/alertasfalso')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/avaliacao.test.ts
```
Expected: FAIL com `Failed to load url ../avaliacao`.

- [ ] **Step 3: Implementar o domínio da avaliação e das rotas**

Criar `src/modules/alertas/domain/avaliacao.ts`:

```ts
import { ehCanal, ehJanelaTipo, type Canal, type JanelaTipo } from './tipos'
import { textoAlerta, textoLembrete, textoNormalizou } from './mensagens'

/** Um destino concreto: a conta vinculada de um destinatário num canal. */
export interface ContaDestino {
  usuarioId: string
  canal: Canal
  externoId: string
}

export type TipoAcao = 'alerta' | 'lembrete' | 'normalizou'

/** Uma decisão tomada pelo banco, pronta para virar mensagem. */
export interface AcaoAvaliacao {
  ocorrenciaId: string
  tipo: TipoAcao
  regraId: string
  regraNome: string
  posto: string
  taxa: number
  taxaMinima: number
  aprovados: number
  reprovados: number
  janelaTipo: JanelaTipo
  janelaValor: number | null
  pmo: string | null
  op: string | null
  abertaEm: string
  agora: string
  contas: ContaDestino[]
}

export interface ResultadoAvaliacaoRpc {
  ocupado: boolean
  avaliadas: number
  acoes: AcaoAvaliacao[]
}

function lerContas(bruto: unknown): ContaDestino[] {
  if (!Array.isArray(bruto)) return []
  const contas: ContaDestino[] = []
  for (const item of bruto) {
    const c = (item ?? {}) as Record<string, unknown>
    if (!ehCanal(c.canal)) continue
    const externoId = String(c.externo_id ?? '')
    if (externoId === '') continue
    contas.push({ usuarioId: String(c.usuario_id ?? ''), canal: c.canal, externoId })
  }
  return contas
}

/**
 * Converte o jsonb do `alerta_avaliar()`. Tudo que não reconhece é DESCARTADO em vez de virar
 * exceção: um tipo de ação novo no banco (deploy fora de ordem) não pode derrubar a rota do cron.
 */
export function lerResultadoAvaliacao(json: unknown): ResultadoAvaliacaoRpc {
  const raiz = (json ?? {}) as Record<string, unknown>
  const brutas = Array.isArray(raiz.acoes) ? raiz.acoes : []
  const acoes: AcaoAvaliacao[] = []
  for (const bruta of brutas) {
    const a = (bruta ?? {}) as Record<string, unknown>
    const tipo = a.tipo
    if (tipo !== 'alerta' && tipo !== 'lembrete' && tipo !== 'normalizou') continue
    if (!ehJanelaTipo(a.janela_tipo)) continue
    acoes.push({
      ocorrenciaId: String(a.ocorrencia_id ?? ''),
      tipo,
      regraId: String(a.regra_id ?? ''),
      regraNome: String(a.regra_nome ?? ''),
      posto: String(a.posto ?? ''),
      taxa: Number(a.taxa ?? 0),
      taxaMinima: Number(a.taxa_minima ?? 0),
      aprovados: Number(a.aprovados ?? 0),
      reprovados: Number(a.reprovados ?? 0),
      janelaTipo: a.janela_tipo,
      janelaValor: a.janela_valor === null || a.janela_valor === undefined ? null : Number(a.janela_valor),
      pmo: a.pmo === null || a.pmo === undefined ? null : String(a.pmo),
      op: a.op === null || a.op === undefined ? null : String(a.op),
      abertaEm: String(a.aberta_em ?? ''),
      agora: String(a.agora ?? ''),
      contas: lerContas(a.contas),
    })
  }
  return { ocupado: raiz.ocupado === true, avaliadas: Number(raiz.avaliadas ?? 0), acoes }
}

/** Alerta e lembrete levam o botão "Resolvido"; o aviso de normalizou não tem o que resolver. */
export function acaoTemBotao(a: AcaoAvaliacao): boolean {
  return a.tipo !== 'normalizou'
}

export function textoDaAcao(a: AcaoAvaliacao): string {
  const base = {
    posto: a.posto,
    regraNome: a.regraNome,
    taxaMinima: a.taxaMinima,
    aprovados: a.aprovados,
    reprovados: a.reprovados,
    janela: { tipo: a.janelaTipo, valor: a.janelaValor, pmo: a.pmo, op: a.op },
    em: new Date(a.agora),
  }
  if (a.tipo === 'alerta') return textoAlerta(base)
  if (a.tipo === 'lembrete') return textoLembrete({ ...base, abertaEm: new Date(a.abertaEm) })
  return textoNormalizou({
    posto: a.posto,
    aprovados: a.aprovados,
    reprovados: a.reprovados,
    abertaEm: new Date(a.abertaEm),
    em: new Date(a.agora),
  })
}
```

Criar `src/modules/alertas/domain/rotas.ts`:

```ts
/**
 * Rotas dos alertas que NÃO passam pela sessão do app: o cron autentica por segredo e os webhooks
 * por segredo (Telegram) / assinatura Ed25519 (Discord). Sem esta exceção o middleware devolveria
 * um redirect pro /login — e o Telegram interpretaria isso como entrega feita.
 */
export function ehRotaPublicaDeAlertas(pathname: string): boolean {
  return pathname === '/api/alertas' || pathname.startsWith('/api/alertas/')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/avaliacao.test.ts
```
Expected: PASS — `Tests 10 passed`.

- [ ] **Step 5: Escrever o teste do serviço de envio (falhando)**

Criar `src/modules/alertas/application/__tests__/enviar-alertas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { AcaoAvaliacao, ContaDestino, ResultadoAvaliacaoRpc } from '../../domain/avaliacao'
import type {
  EnvioPendente,
  MensagemComBotao,
  NovoEnvio,
  PortaCanal,
  PortasCanais,
  RepositorioEnvios,
} from '../portas'
import {
  avaliarEEnviar,
  avisarResolvido,
  enviarTeste,
  reenviarFalhas,
  removerBotoesDaOcorrencia,
} from '../enviar-alertas'

/** Porta de mentira: registra o que foi enviado e pode falhar sob comando. */
function portaFalsa(opcoes: { falharPara?: string[] } = {}) {
  const enviados: { externoId: string; texto: string; botao: string | null }[] = []
  const removidos: string[] = []
  const porta: PortaCanal = {
    async enviar(externoId, texto, ocorrenciaIdBotao) {
      enviados.push({ externoId, texto, botao: ocorrenciaIdBotao })
      if (opcoes.falharPara?.includes(externoId)) return { ok: false, erro: 'Canal 403: bloqueado' }
      return { ok: true, mensagemExternaId: `${externoId}:m${enviados.length}` }
    },
    async removerBotoes(mensagemExternaId) {
      removidos.push(mensagemExternaId)
      return { ok: true }
    },
  }
  return { porta, enviados, removidos }
}

function repoFalso(dados: {
  avaliacao?: ResultadoAvaliacaoRpc
  pendentes?: EnvioPendente[]
  mensagens?: MensagemComBotao[]
  contas?: ContaDestino[]
  conta?: ContaDestino | null
}) {
  const gravados: NovoEnvio[] = []
  const reenviados: { envio: EnvioPendente; ok: boolean }[] = []
  const semBotao: string[][] = []
  const repo: RepositorioEnvios = {
    async avaliar() {
      return dados.avaliacao ?? { ocupado: false, avaliadas: 0, acoes: [] }
    },
    async registrarEnvio(e) {
      gravados.push(e)
    },
    async envioParaReenviar() {
      return dados.pendentes ?? []
    },
    async registrarReenvio(envio, resultado) {
      reenviados.push({ envio, ok: resultado.ok })
    },
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao(ids) {
      semBotao.push(ids)
    },
    async contasDaOcorrencia() {
      return dados.contas ?? []
    },
    async contaDoUsuario() {
      return dados.conta ?? null
    },
  }
  return { repo, gravados, reenviados, semBotao }
}

const ACAO: AcaoAvaliacao = {
  ocorrenciaId: 'oc1',
  tipo: 'alerta',
  regraId: 'r1',
  regraNome: 'Teste abaixo de 90',
  posto: 'Teste',
  taxa: 75,
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janelaTipo: 'tempo',
  janelaValor: 60,
  pmo: null,
  op: null,
  abertaEm: '2026-09-17T17:05:00Z',
  agora: '2026-09-17T17:05:00Z',
  contas: [
    { usuarioId: 'u1', canal: 'telegram', externoId: '111' },
    { usuarioId: 'u2', canal: 'discord', externoId: 'D2' },
  ],
}

describe('avaliarEEnviar', () => {
  it('envia a ação para cada conta, com botão, e grava os envios', async () => {
    const tg = portaFalsa()
    const dc = portaFalsa()
    const portas: PortasCanais = { telegram: tg.porta, discord: dc.porta }
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 4, acoes: [ACAO] } })

    const r = await avaliarEEnviar(portas, repo)

    expect(r).toEqual({ avaliadas: 4, enviados: 2, falhas: 0, ocupado: false })
    expect(tg.enviados).toEqual([
      { externoId: '111', texto: expect.stringContaining('🔴 Teste abaixo da meta'), botao: 'oc1' },
    ])
    expect(dc.enviados[0]!.botao).toBe('oc1')
    expect(gravados).toHaveLength(2)
    expect(gravados[0]).toMatchObject({ ocorrenciaId: 'oc1', usuarioId: 'u1', canal: 'telegram', tipo: 'alerta', comBotao: true })
  })

  it('canal sem token configurado é pulado (nem envio, nem registro)', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 1, acoes: [ACAO] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r.enviados).toBe(1)
    expect(gravados).toHaveLength(1)
    expect(gravados[0]!.canal).toBe('telegram')
  })

  it('falha de envio entra no resumo e é gravada como falha', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 1, acoes: [ACAO] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toMatchObject({ enviados: 0, falhas: 1 })
    expect(gravados[0]!.resultado).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
  })

  it('ocupado não envia nada', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: true, avaliadas: 0, acoes: [] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toEqual({ avaliadas: 0, enviados: 0, falhas: 0, ocupado: true })
    expect(tg.enviados).toHaveLength(0)
    expect(gravados).toHaveLength(0)
  })

  it('ação de normalizou vai sem botão e limpa os botões das mensagens antigas', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, acoes: [{ ...ACAO, tipo: 'normalizou' }] },
      mensagens: [{ envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:9' }],
    })

    await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(tg.enviados[0]!.botao).toBeNull()
    expect(tg.removidos).toEqual(['111:9'])
    expect(semBotao).toEqual([['e1']])
  })

  it('reenvia as falhas anteriores antes das ações novas', async () => {
    const tg = portaFalsa()
    const { repo, reenviados } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, acoes: [] },
      pendentes: [
        { id: 'e9', ocorrenciaId: 'oc9', canal: 'telegram', externoId: '111', texto: 'antigo', comBotao: true, tentativas: 1 },
      ],
    })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(tg.enviados).toEqual([{ externoId: '111', texto: 'antigo', botao: 'oc9' }])
    expect(reenviados).toEqual([{ envio: expect.objectContaining({ id: 'e9' }), ok: true }])
    expect(r.enviados).toBe(1)
  })
})

describe('reenviarFalhas', () => {
  it('pula pendência de canal não configurado', async () => {
    const { repo, reenviados } = repoFalso({
      pendentes: [
        { id: 'e1', ocorrenciaId: 'oc1', canal: 'discord', externoId: 'D2', texto: 'x', comBotao: false, tentativas: 2 },
      ],
    })
    const r = await reenviarFalhas({}, repo)
    expect(r).toEqual({ enviados: 0, falhas: 0 })
    expect(reenviados).toHaveLength(0)
  })
})

describe('removerBotoesDaOcorrencia', () => {
  it('só marca como sem botão o que o canal conseguiu editar', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      mensagens: [
        { envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:9' },
        { envioId: 'e2', canal: 'discord', mensagemExternaId: 'C9:M7' },
      ],
    })
    await removerBotoesDaOcorrencia({ telegram: tg.porta }, repo, 'oc1')
    expect(tg.removidos).toEqual(['111:9'])
    expect(semBotao).toEqual([['e1']])
  })
})

describe('avisarResolvido', () => {
  it('avisa todos os destinatários MENOS quem resolveu', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({
      contas: [
        { usuarioId: 'u1', canal: 'telegram', externoId: '111' },
        { usuarioId: 'u2', canal: 'telegram', externoId: '222' },
      ],
    })

    const r = await avisarResolvido({ telegram: tg.porta }, repo, {
      ocorrenciaId: 'oc1',
      posto: 'Teste',
      resolvidoPorId: 'u2',
      resolvidoPorNome: 'Bruno Líder',
      resolvidaEm: new Date('2026-09-17T17:05:00Z'),
    })

    expect(r).toEqual({ enviados: 1, falhas: 0 })
    expect(tg.enviados).toEqual([
      { externoId: '111', texto: '✅ Teste: resolvido por Bruno Líder às 14:05', botao: null },
    ])
    expect(gravados[0]).toMatchObject({ tipo: 'resolvido', comBotao: false })
  })
})

describe('enviarTeste', () => {
  it('manda a mensagem de teste pela conta vinculada', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })

    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana Gestora' })

    expect(r).toEqual({ ok: true })
    expect(tg.enviados[0]!.texto).toContain('Ana Gestora')
    expect(gravados[0]).toMatchObject({ tipo: 'teste', ocorrenciaId: null, comBotao: false })
  })

  it('canal não configurado avisa sem chamar a API', async () => {
    const { repo, gravados } = repoFalso({ conta: { usuarioId: 'u1', canal: 'discord', externoId: 'D1' } })
    const r = await enviarTeste({}, repo, { usuarioId: 'u1', canal: 'discord', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Discord não está configurado neste ambiente.' })
    expect(gravados).toHaveLength(0)
  })

  it('sem vínculo avisa pra vincular primeiro', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ conta: null })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Vincule o Telegram antes de enviar o teste.' })
  })

  it('falha do canal volta como erro', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/enviar-alertas.test.ts
```
Expected: FAIL com `Failed to load url ../portas`.

- [ ] **Step 7: Implementar as portas e o serviço de envio**

Criar `src/modules/alertas/application/portas.ts`:

```ts
import type { Canal, ResultadoEnvio, ResultadoSimples, TipoEnvio } from '../domain/tipos'
import type { ContaDestino, ResultadoAvaliacaoRpc } from '../domain/avaliacao'

/**
 * Tudo que o serviço precisa de um canal. Quem implementa é `infra/canais.ts` (Telegram/Discord);
 * nos testes entra uma porta de mentira — por isso aqui não há nem `fetch`, nem token.
 */
export interface PortaCanal {
  enviar(externoId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
}

/** Canal ausente = sem token configurado neste ambiente. */
export type PortasCanais = Partial<Record<Canal, PortaCanal>>

export interface NovoEnvio {
  ocorrenciaId: string | null
  usuarioId: string
  canal: Canal
  tipo: TipoEnvio
  texto: string
  comBotao: boolean
  resultado: ResultadoEnvio
}

/** Envio que falhou e ainda vale tentar de novo (texto guardado no banco). */
export interface EnvioPendente {
  id: string
  ocorrenciaId: string | null
  canal: Canal
  externoId: string
  texto: string
  comBotao: boolean
  tentativas: number
}

export interface MensagemComBotao {
  envioId: string
  canal: Canal
  mensagemExternaId: string
}

export interface RepositorioEnvios {
  avaliar(): Promise<ResultadoAvaliacaoRpc>
  registrarEnvio(e: NovoEnvio): Promise<void>
  envioParaReenviar(): Promise<EnvioPendente[]>
  registrarReenvio(envio: EnvioPendente, resultado: ResultadoEnvio): Promise<void>
  mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]>
  marcarSemBotao(envioIds: string[]): Promise<void>
  /** Destinatários x canais da regra da ocorrência que TÊM vínculo. */
  contasDaOcorrencia(ocorrenciaId: string): Promise<ContaDestino[]>
  contaDoUsuario(usuarioId: string, canal: Canal): Promise<ContaDestino | null>
}
```

Criar `src/modules/alertas/application/enviar-alertas.ts`:

```ts
import { NOME_CANAL, type Canal, type ResultadoSimples, type TipoEnvio } from '../domain/tipos'
import { acaoTemBotao, textoDaAcao, type ContaDestino } from '../domain/avaliacao'
import { textoResolvido, textoTeste } from '../domain/mensagens'
import type { PortasCanais, RepositorioEnvios } from './portas'

export interface ItemEnvio {
  conta: ContaDestino
  tipo: TipoEnvio
  texto: string
  ocorrenciaId: string | null
  comBotao: boolean
}

export interface ResumoEnvio {
  enviados: number
  falhas: number
}

export interface ResumoAvaliacao extends ResumoEnvio {
  avaliadas: number
  ocupado: boolean
}

/** Um envio por item. Canal sem token é PULADO: não envia e não gera linha de falha. */
export async function enviarItens(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  itens: ItemEnvio[],
): Promise<ResumoEnvio> {
  let enviados = 0
  let falhas = 0
  for (const item of itens) {
    const porta = portas[item.conta.canal]
    if (!porta) continue
    const resultado = await porta.enviar(
      item.conta.externoId,
      item.texto,
      item.comBotao ? item.ocorrenciaId : null,
    )
    await repo.registrarEnvio({
      ocorrenciaId: item.ocorrenciaId,
      usuarioId: item.conta.usuarioId,
      canal: item.conta.canal,
      tipo: item.tipo,
      texto: item.texto,
      comBotao: item.comBotao,
      resultado,
    })
    if (resultado.ok) enviados += 1
    else falhas += 1
  }
  return { enviados, falhas }
}

/** Tenta de novo o que falhou em rodadas ANTERIORES (o repositório já filtra tentativas < 3). */
export async function reenviarFalhas(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoEnvio> {
  let enviados = 0
  let falhas = 0
  for (const pendente of await repo.envioParaReenviar()) {
    const porta = portas[pendente.canal]
    if (!porta) continue
    const resultado = await porta.enviar(
      pendente.externoId,
      pendente.texto,
      pendente.comBotao ? pendente.ocorrenciaId : null,
    )
    await repo.registrarReenvio(pendente, resultado)
    if (resultado.ok) enviados += 1
    else falhas += 1
  }
  return { enviados, falhas }
}

/** Tira o botão "Resolvido" de todas as mensagens vivas da ocorrência. */
export async function removerBotoesDaOcorrencia(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  ocorrenciaId: string,
): Promise<void> {
  const mensagens = await repo.mensagensComBotao(ocorrenciaId)
  const feitos: string[] = []
  for (const m of mensagens) {
    const porta = portas[m.canal]
    if (!porta) continue
    const r = await porta.removerBotoes(m.mensagemExternaId)
    if (r.ok) feitos.push(m.envioId)
  }
  if (feitos.length > 0) await repo.marcarSemBotao(feitos)
}

/**
 * O ciclo do cron: avalia no banco (decisão atômica lá) e entrega o que ele mandou entregar.
 * A ORDEM importa: `avaliar` primeiro (se estiver ocupado, sai sem mexer em nada) e só depois os
 * reenvios — que são lidos ANTES de gravar os envios desta rodada, então nunca se reenvia o que
 * acabou de falhar aqui.
 */
export async function avaliarEEnviar(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoAvaliacao> {
  const avaliacao = await repo.avaliar()
  if (avaliacao.ocupado) return { avaliadas: 0, enviados: 0, falhas: 0, ocupado: true }

  const reenvio = await reenviarFalhas(portas, repo)
  let enviados = reenvio.enviados
  let falhas = reenvio.falhas

  for (const acao of avaliacao.acoes) {
    const texto = textoDaAcao(acao)
    const comBotao = acaoTemBotao(acao)
    const r = await enviarItens(
      portas,
      repo,
      acao.contas.map((conta) => ({ conta, tipo: acao.tipo, texto, ocorrenciaId: acao.ocorrenciaId, comBotao })),
    )
    enviados += r.enviados
    falhas += r.falhas
    // Normalizou: os alertas antigos não devem mais oferecer "Resolvido".
    if (acao.tipo === 'normalizou') await removerBotoesDaOcorrencia(portas, repo, acao.ocorrenciaId)
  }

  return { avaliadas: avaliacao.avaliadas, enviados, falhas, ocupado: false }
}

/** "✅ resolvido por X" para os OUTROS destinatários (quem apertou já sabe). */
export async function avisarResolvido(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  r: {
    ocorrenciaId: string
    posto: string
    resolvidoPorId: string
    resolvidoPorNome: string
    resolvidaEm: Date
  },
): Promise<ResumoEnvio> {
  const contas = (await repo.contasDaOcorrencia(r.ocorrenciaId)).filter(
    (c) => c.usuarioId !== r.resolvidoPorId,
  )
  const texto = textoResolvido({ posto: r.posto, nome: r.resolvidoPorNome, em: r.resolvidaEm })
  return enviarItens(
    portas,
    repo,
    contas.map((conta) => ({ conta, tipo: 'resolvido' as TipoEnvio, texto, ocorrenciaId: r.ocorrenciaId, comBotao: false })),
  )
}

/** Botão "Enviar teste" do Meu perfil: prova que a DM chega ANTES de existir um alerta de verdade. */
export async function enviarTeste(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  p: { usuarioId: string; canal: Canal; nome: string },
): Promise<ResultadoSimples> {
  const porta = portas[p.canal]
  if (!porta) return { ok: false, erro: `${NOME_CANAL[p.canal]} não está configurado neste ambiente.` }
  const conta = await repo.contaDoUsuario(p.usuarioId, p.canal)
  if (!conta) return { ok: false, erro: `Vincule o ${NOME_CANAL[p.canal]} antes de enviar o teste.` }

  const texto = textoTeste(p.nome)
  const resultado = await porta.enviar(conta.externoId, texto, null)
  await repo.registrarEnvio({
    ocorrenciaId: null,
    usuarioId: p.usuarioId,
    canal: p.canal,
    tipo: 'teste',
    texto,
    comBotao: false,
    resultado,
  })
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/enviar-alertas.test.ts
```
Expected: PASS — `Tests 13 passed`.

- [ ] **Step 9: Escrever o teste da rota do cron (falhando)**

Criar `src/modules/alertas/application/__tests__/rota-avaliar.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const criarDependenciasAlertas = vi.fn(() => ({ portas: {}, repo: {} }))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))

const avaliarEEnviar = vi.fn(async () => ({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false }))
vi.mock('@/modules/alertas/application/enviar-alertas', () => ({ avaliarEEnviar }))

import { POST } from '@/app/api/alertas/avaliar/route'

function pedido(cabecalhos: Record<string, string> = {}) {
  return new Request('https://shopfloor.enterplak.com.br/api/alertas/avaliar', {
    method: 'POST',
    headers: cabecalhos,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  avaliarEEnviar.mockResolvedValue({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
  vi.stubEnv('ALERTAS_CRON_SECRET', 'segredo-do-cron')
})

describe('POST /api/alertas/avaliar', () => {
  it('sem cabeçalho de autorização devolve 401 e não avalia', async () => {
    const res = await POST(pedido())
    expect(res.status).toBe(401)
    expect(avaliarEEnviar).not.toHaveBeenCalled()
  })

  it('segredo errado devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro' }))
    expect(res.status).toBe(401)
  })

  it('segredo certo avalia e devolve o resumo', async () => {
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    expect(avaliarEEnviar).toHaveBeenCalledTimes(1)
  })

  it('banco indisponível devolve 503 em vez de estourar', async () => {
    avaliarEEnviar.mockRejectedValueOnce(new Error('connection refused'))
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ erro: 'Banco indisponível.' })
  })

  it('sem segredo configurado no ambiente devolve 503', async () => {
    vi.stubEnv('ALERTAS_CRON_SECRET', '')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 10: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/rota-avaliar.test.ts
```
Expected: FAIL com `Failed to load url @/app/api/alertas/avaliar/route`.

- [ ] **Step 11: Implementar canais, repositório de serviço, fábrica, rota e middleware**

Criar `src/modules/alertas/infra/canais.ts`:

```ts
import { CANAIS, type Canal } from '../domain/tipos'
import type { PortaCanal, PortasCanais } from '../application/portas'
import { criarTelegram } from './telegram'
import { criarDiscord } from './discord'

/** Quais canais este ambiente consegue usar (a tela mostra "não configurado" nos outros). */
export function canaisConfigurados(env: NodeJS.ProcessEnv = process.env): Record<Canal, boolean> {
  return {
    telegram: !!env.TELEGRAM_BOT_TOKEN,
    discord: !!env.DISCORD_BOT_TOKEN,
  }
}

/** Monta as portas dos canais configurados. Canal ausente = o serviço simplesmente pula. */
export function criarPortasCanais(env: NodeJS.ProcessEnv = process.env): PortasCanais {
  const portas: PortasCanais = {}

  const tokenTelegram = env.TELEGRAM_BOT_TOKEN
  if (tokenTelegram) {
    const tg = criarTelegram({ token: tokenTelegram })
    const porta: PortaCanal = {
      enviar: (externoId, texto, botao) => tg.enviarMensagem(externoId, texto, botao),
      removerBotoes: (id) => tg.removerBotoes(id),
    }
    portas.telegram = porta
  }

  const tokenDiscord = env.DISCORD_BOT_TOKEN
  if (tokenDiscord) {
    const dc = criarDiscord({ token: tokenDiscord })
    const porta: PortaCanal = {
      enviar: (externoId, texto, botao) => dc.enviarDm(externoId, texto, botao),
      removerBotoes: (id) => dc.removerBotoes(id),
    }
    portas.discord = porta
  }

  return portas
}

/** Nome dos canais configurados, para a mensagem da tela. */
export function listaCanaisConfigurados(env: NodeJS.ProcessEnv = process.env): Canal[] {
  const mapa = canaisConfigurados(env)
  return CANAIS.filter((c) => mapa[c])
}
```

Criar `src/modules/alertas/infra/repositorio-servico.ts`:

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { ehCanal, type Canal, type ResultadoEnvio } from '../domain/tipos'
import { lerResultadoAvaliacao, type ContaDestino } from '../domain/avaliacao'
import type {
  EnvioPendente,
  MensagemComBotao,
  NovoEnvio,
  RepositorioEnvios,
} from '../application/portas'

const LIMITE_ERRO = 500
const JANELA_REENVIO_MS = 24 * 60 * 60 * 1000

interface LinhaConta {
  usuario_id: string
  canal: string
  externo_id: string
}

interface LinhaPendente {
  id: string
  ocorrencia_id: string | null
  usuario_id: string
  canal: string
  tipo: string
  texto: string
  com_botao: boolean
  tentativas: number
  alerta_ocorrencias: { estado: string } | null
}

/**
 * Repositório dos alertas com o client de SERVICE ROLE: ele ignora RLS de propósito — quem chama é
 * o cron e os webhooks, que não têm sessão de usuário nenhuma.
 */
export function criarRepositorioServico(
  sb: SupabaseClient = createServiceSupabase(),
): RepositorioEnvios {
  async function contas(usuarioIds: string[], canais: Canal[]): Promise<ContaDestino[]> {
    if (usuarioIds.length === 0 || canais.length === 0) return []
    const { data, error } = await sb
      .from('alerta_contas')
      .select('usuario_id, canal, externo_id')
      .in('usuario_id', usuarioIds)
      .in('canal', canais)
    if (error) throw new Error(`alerta_contas: ${error.message}`)
    const saida: ContaDestino[] = []
    for (const linha of (data ?? []) as LinhaConta[]) {
      if (!ehCanal(linha.canal)) continue
      saida.push({ usuarioId: linha.usuario_id, canal: linha.canal, externoId: linha.externo_id })
    }
    return saida
  }

  return {
    async avaliar() {
      const { data, error } = await sb.rpc('alerta_avaliar')
      if (error) throw new Error(`alerta_avaliar: ${error.message}`)
      return lerResultadoAvaliacao(data)
    },

    async registrarEnvio(e: NovoEnvio) {
      const { error } = await sb.from('alerta_envios').insert({
        ocorrencia_id: e.ocorrenciaId,
        usuario_id: e.usuarioId,
        canal: e.canal,
        tipo: e.tipo,
        texto: e.texto,
        com_botao: e.comBotao,
        mensagem_externa_id: e.resultado.ok ? e.resultado.mensagemExternaId : null,
        ok: e.resultado.ok,
        erro: e.resultado.ok ? null : e.resultado.erro.slice(0, LIMITE_ERRO),
        tentativas: 1,
      })
      // Não derruba a rodada: a mensagem já foi entregue; o que falhou foi a auditoria.
      if (error) console.error('[alertas] gravar envio falhou:', error.message)
    },

    async envioParaReenviar() {
      const desde = new Date(Date.now() - JANELA_REENVIO_MS).toISOString()
      const { data, error } = await sb
        .from('alerta_envios')
        .select('id, ocorrencia_id, usuario_id, canal, tipo, texto, com_botao, tentativas, alerta_ocorrencias(estado)')
        .eq('ok', false)
        .lt('tentativas', 3)
        .neq('tipo', 'teste')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: true })
        .limit(100)
      if (error) throw new Error(`alerta_envios: ${error.message}`)

      const linhas = (data ?? []) as unknown as LinhaPendente[]
      const uteis = linhas.filter((l) => {
        if (!ehCanal(l.canal)) return false
        // Alerta/lembrete de ocorrência que já foi resolvida ou normalizou virou notícia velha.
        if (l.tipo === 'alerta' || l.tipo === 'lembrete') return l.alerta_ocorrencias?.estado === 'aberta'
        return true
      })
      if (uteis.length === 0) return []

      const canaisUsados = [...new Set(uteis.map((l) => l.canal))].filter(ehCanal)
      const mapa = new Map<string, string>()
      for (const c of await contas([...new Set(uteis.map((l) => l.usuario_id))], canaisUsados)) {
        mapa.set(`${c.usuarioId}|${c.canal}`, c.externoId)
      }

      const pendentes: EnvioPendente[] = []
      for (const l of uteis) {
        const externoId = mapa.get(`${l.usuario_id}|${l.canal}`)
        if (!externoId || !ehCanal(l.canal)) continue // desvinculou no meio: não há pra onde reenviar
        pendentes.push({
          id: l.id,
          ocorrenciaId: l.ocorrencia_id,
          canal: l.canal,
          externoId,
          texto: l.texto,
          comBotao: l.com_botao,
          tentativas: l.tentativas,
        })
      }
      return pendentes
    },

    async registrarReenvio(envio: EnvioPendente, resultado: ResultadoEnvio) {
      const { error } = await sb
        .from('alerta_envios')
        .update({
          ok: resultado.ok,
          erro: resultado.ok ? null : resultado.erro.slice(0, LIMITE_ERRO),
          mensagem_externa_id: resultado.ok ? resultado.mensagemExternaId : null,
          tentativas: envio.tentativas + 1,
        })
        .eq('id', envio.id)
      if (error) console.error('[alertas] atualizar reenvio falhou:', error.message)
    },

    async mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]> {
      const { data, error } = await sb
        .from('alerta_envios')
        .select('id, canal, mensagem_externa_id')
        .eq('ocorrencia_id', ocorrenciaId)
        .eq('com_botao', true)
        .eq('ok', true)
        .not('mensagem_externa_id', 'is', null)
      if (error) throw new Error(`alerta_envios: ${error.message}`)
      const saida: MensagemComBotao[] = []
      for (const l of (data ?? []) as { id: string; canal: string; mensagem_externa_id: string }[]) {
        if (!ehCanal(l.canal)) continue
        saida.push({ envioId: l.id, canal: l.canal, mensagemExternaId: l.mensagem_externa_id })
      }
      return saida
    },

    async marcarSemBotao(envioIds: string[]) {
      if (envioIds.length === 0) return
      const { error } = await sb.from('alerta_envios').update({ com_botao: false }).in('id', envioIds)
      if (error) console.error('[alertas] marcar sem botão falhou:', error.message)
    },

    async contasDaOcorrencia(ocorrenciaId: string) {
      const { data, error } = await sb
        .from('alerta_ocorrencias')
        .select('alerta_regras(destinatarios, canais)')
        .eq('id', ocorrenciaId)
        .maybeSingle()
      if (error) throw new Error(`alerta_ocorrencias: ${error.message}`)
      const regra = (data as { alerta_regras: { destinatarios: string[]; canais: string[] } | null } | null)
        ?.alerta_regras
      if (!regra) return []
      return contas(regra.destinatarios ?? [], (regra.canais ?? []).filter(ehCanal))
    },

    async contaDoUsuario(usuarioId: string, canal: Canal) {
      const lista = await contas([usuarioId], [canal])
      return lista[0] ?? null
    },
  }
}
```

Criar `src/modules/alertas/infra/fabrica.ts`:

```ts
import 'server-only'
import type { PortasCanais, RepositorioEnvios } from '../application/portas'
import { criarPortasCanais } from './canais'
import { criarRepositorioServico } from './repositorio-servico'

/** Dependências prontas para as rotas e as actions de servidor. */
export function criarDependenciasAlertas(): { portas: PortasCanais; repo: RepositorioEnvios } {
  return { portas: criarPortasCanais(), repo: criarRepositorioServico() }
}
```

Criar `src/app/api/alertas/avaliar/route.ts`:

```ts
import { avaliarEEnviar } from '@/modules/alertas/application/enviar-alertas'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e escreve no banco: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/**
 * Chamada pelo crontab da Lightsail a cada 5 minutos:
 *   curl -fsS -m 60 -X POST -H "Authorization: Bearer $ALERTAS_CRON_SECRET" .../api/alertas/avaliar
 * Com o RDS desligado (plano de economia), responde 503 e registra no log — nada mais.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ALERTAS_CRON_SECRET ?? ''
  if (esperado === '') {
    return Response.json({ erro: 'Alertas não configurados neste ambiente.' }, { status: 503 })
  }

  const recebido = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!segredoConfere(recebido, esperado)) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resumo = await avaliarEEnviar(portas, repo)
    return Response.json(resumo)
  } catch (e) {
    console.error('[alertas] avaliar falhou:', e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }
}
```

**Modificar** `middleware.ts` — substituir o conteúdo inteiro por:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'

export async function middleware(request: NextRequest) {
  // Cron e webhooks dos alertas não têm sessão: quem autoriza é o segredo (cron/Telegram) ou a
  // assinatura Ed25519 (Discord), dentro da própria rota. Sem esta saída o middleware responderia
  // um redirect pro /login — e o Telegram trataria isso como entrega bem-sucedida.
  if (ehRotaPublicaDeAlertas(request.nextUrl.pathname)) return NextResponse.next()
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
```

- [ ] **Step 12: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas && npx tsc --noEmit && npm run lint
```
Expected: `Test Files 9 passed`; `tsc` sem saída; lint sem avisos.

- [ ] **Step 13: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add src/modules/alertas src/app/api/alertas middleware.ts
git commit -m "$(cat <<'MSG'
feat(alertas): serviço de avaliação e envio + rota do cron

Parse das ações do alerta_avaliar, serviço que envia por destinatário x canal,
grava alerta_envios, reenvia falhas anteriores (tentativas < 3) e tira o botão
quando normaliza; repositório com service role, portas dos canais por env e
rota POST /api/alertas/avaliar protegida por segredo (503 com banco fora).
O middleware passa a liberar /api/alertas/*.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Webhooks do Telegram e do Discord (vincular + resolver + avisar os outros)

**Files:**
- Create: `src/modules/alertas/domain/resolucao.ts`
- Modify: `src/modules/alertas/application/portas.ts` (acrescentar `RepositorioVinculo` e seus DTOs)
- Modify: `src/modules/alertas/infra/repositorio-servico.ts` (implementar os 3 métodos novos e mudar o tipo de retorno)
- Modify: `src/modules/alertas/infra/fabrica.ts` (tipo de retorno passa a `RepositorioEnvios & RepositorioVinculo`)
- Create: `src/modules/alertas/application/webhook-telegram.ts`
- Create: `src/modules/alertas/application/webhook-discord.ts`
- Create: `src/app/api/alertas/telegram/route.ts`
- Create: `src/app/api/alertas/discord/route.ts`
- Test: `src/modules/alertas/domain/__tests__/resolucao.test.ts`
- Test: `src/modules/alertas/application/__tests__/webhook-telegram.test.ts`
- Test: `src/modules/alertas/application/__tests__/webhook-discord.test.ts`
- Test: `src/modules/alertas/application/__tests__/rotas-webhooks.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `extrairCodigoVinculo`, `lerCallbackResolver` (`../domain/codigos`); `textoResolvido`, `textoVinculado`, `TEXTO_INSTRUCOES_TELEGRAM` (`../domain/mensagens`); `mensagemErroAlerta`, `codigoErroAlerta` (`../domain/erros`); `Canal` (`../domain/tipos`).
  - Task 4: `TelegramClient`, `criarTelegram`; `verificarAssinaturaDiscord`, `segredoConfere`.
  - Task 5 (+ revisão da fila): `PortasCanais`, `RepositorioEnvios`, `FiltroReserva`, `removerBotoesDaOcorrencia`, `entregarPendentes`, `criarDependenciasAlertas`; `EnvioReservado` (`../domain/envio`).
  - Task 3 (banco): `alerta_vincular(p_codigo, p_canal, p_externo_id)`, `alerta_resolver(p_ocorrencia_id, p_usuario_id)` — que **já enfileira** o "✅ resolvido por" para os outros destinatários na mesma transação da resolução. O webhook só adianta a entrega com `entregarPendentes(..., { ocorrenciaId })`; se o processo cair antes, o cron entrega na próxima rodada.
- Produces:
  - `interface ResolucaoOcorrencia { ocorrenciaId: string; regraId: string; posto: string; jaResolvida: boolean; resolvidaPorId: string; resolvidaPorNome: string; resolvidaEm: Date }`
  - `lerResolucao(json: unknown): ResolucaoOcorrencia`
  - `type ResultadoVinculo = { ok: true; nome: string } | { ok: false; erro: string }`
  - `type ResultadoResolver = { ok: true; resolucao: ResolucaoOcorrencia } | { ok: false; codigo: string; erro: string }`
  - `interface RepositorioVinculo { vincular(codigo: string, canal: Canal, externoId: string): Promise<ResultadoVinculo>; usuarioPorConta(canal: Canal, externoId: string): Promise<string | null>; resolver(ocorrenciaId: string, usuarioId: string): Promise<ResultadoResolver> }`
  - `interface DependenciasWebhook { portas: PortasCanais; repo: RepositorioEnvios & RepositorioVinculo }`
  - `tratarUpdateTelegram(update: unknown, deps: DependenciasWebhook & { telegram: TelegramClient }): Promise<void>`
  - `interface RespostaDiscord { corpo: Record<string, unknown>; depois: (() => Promise<void>) | null }`
  - `tratarInteracaoDiscord(interacao: unknown, deps: DependenciasWebhook): Promise<RespostaDiscord>`
  - Rotas `POST /api/alertas/telegram` (401 sem segredo; 200 sempre depois disso) e `POST /api/alertas/discord` (401 com assinatura inválida).

- [ ] **Step 1: Escrever o teste do parse da resolução (falhando)**

Criar `src/modules/alertas/domain/__tests__/resolucao.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lerResolucao } from '../resolucao'

describe('lerResolucao', () => {
  it('converte o jsonb do alerta_resolver', () => {
    const r = lerResolucao({
      ocorrencia_id: 'oc1',
      regra_id: 'r1',
      posto: 'Teste',
      ja_resolvida: false,
      resolvida_por: 'u2',
      resolvida_por_nome: 'Bruno Líder',
      resolvida_em: '2026-09-17T17:05:00+00:00',
    })
    expect(r.ocorrenciaId).toBe('oc1')
    expect(r.regraId).toBe('r1')
    expect(r.posto).toBe('Teste')
    expect(r.jaResolvida).toBe(false)
    expect(r.resolvidaPorId).toBe('u2')
    expect(r.resolvidaPorNome).toBe('Bruno Líder')
    expect(r.resolvidaEm.toISOString()).toBe('2026-09-17T17:05:00.000Z')
  })

  it('idempotente: ja_resolvida true', () => {
    expect(lerResolucao({ ja_resolvida: true }).jaResolvida).toBe(true)
  })

  it('sem data usa o agora (nunca devolve Invalid Date)', () => {
    const r = lerResolucao({ ocorrencia_id: 'oc1' })
    expect(Number.isNaN(r.resolvidaEm.getTime())).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/resolucao.test.ts
```
Expected: FAIL com `Failed to load url ../resolucao`.

- [ ] **Step 3: Implementar o parse da resolução**

Criar `src/modules/alertas/domain/resolucao.ts`:

```ts
export interface ResolucaoOcorrencia {
  ocorrenciaId: string
  regraId: string
  posto: string
  /** true = alguém já tinha resolvido antes (o botão foi apertado duas vezes). */
  jaResolvida: boolean
  resolvidaPorId: string
  resolvidaPorNome: string
  resolvidaEm: Date
}

export function lerResolucao(json: unknown): ResolucaoOcorrencia {
  const r = (json ?? {}) as Record<string, unknown>
  const em = r.resolvida_em === null || r.resolvida_em === undefined ? null : new Date(String(r.resolvida_em))
  return {
    ocorrenciaId: String(r.ocorrencia_id ?? ''),
    regraId: String(r.regra_id ?? ''),
    posto: String(r.posto ?? ''),
    jaResolvida: r.ja_resolvida === true,
    resolvidaPorId: r.resolvida_por === null || r.resolvida_por === undefined ? '' : String(r.resolvida_por),
    resolvidaPorNome: String(r.resolvida_por_nome ?? ''),
    // Sem data (caso degenerado) o texto ainda precisa de uma hora válida pra mostrar.
    resolvidaEm: em && !Number.isNaN(em.getTime()) ? em : new Date(),
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/resolucao.test.ts
```
Expected: PASS — `Tests 3 passed`.

- [ ] **Step 5: Escrever o teste do webhook do Telegram (falhando)**

Criar `src/modules/alertas/application/__tests__/webhook-telegram.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TelegramClient } from '../../infra/telegram'
import type { EnvioReservado } from '../../domain/envio'
import type { FiltroReserva, MensagemComBotao, RepositorioEnvios, RepositorioVinculo } from '../portas'
import { tratarUpdateTelegram } from '../webhook-telegram'

function telegramFalso() {
  const enviadas: { chatId: string; texto: string; botao: string | null }[] = []
  const editadas: { id: string; texto: string }[] = []
  const semBotao: string[] = []
  const callbacks: { id: string; texto: string }[] = []
  const telegram: TelegramClient = {
    async enviarMensagem(chatId, texto, botao) {
      enviadas.push({ chatId, texto, botao })
      return { ok: true, mensagemExternaId: `${chatId}:1` }
    },
    async editarTexto(id, texto) {
      editadas.push({ id, texto })
      return { ok: true }
    },
    async removerBotoes(id) {
      semBotao.push(id)
      return { ok: true }
    },
    async responderCallback(id, texto) {
      callbacks.push({ id, texto })
      return { ok: true }
    },
  }
  return { telegram, enviadas, editadas, semBotao, callbacks }
}

function repoFalso(dados: {
  vinculo?: { ok: true; nome: string } | { ok: false; erro: string }
  usuario?: string | null
  resolver?: Awaited<ReturnType<RepositorioVinculo['resolver']>>
  mensagens?: MensagemComBotao[]
  /** O que o banco pôs na fila (o alerta_resolver enfileira o "resolvido por" dos OUTROS). */
  fila?: EnvioReservado[]
}) {
  const vinculos: { codigo: string; canal: string; externoId: string }[] = []
  const reservas: FiltroReserva[] = []
  const concluidos: { id: string; ok: boolean }[] = []
  let fila = dados.fila ?? []
  const repo: RepositorioEnvios & RepositorioVinculo = {
    async avaliar() {
      return { ocupado: false, avaliadas: 0, enfileirados: 0, normalizadas: [] }
    },
    async reservarPendentes(f) {
      reservas.push(f)
      const lote = fila.filter((e) => f.ocorrenciaId === null || e.ocorrenciaId === f.ocorrenciaId)
      fila = fila.filter((e) => !lote.includes(e))
      return lote
    },
    async concluirEnvio(envio, _texto, resultado) {
      concluidos.push({ id: envio.id, ok: resultado.ok })
    },
    async registrarEnvioDireto() {},
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao() {},
    async contaDoUsuario() {
      return null
    },
    async vincular(codigo, canal, externoId) {
      vinculos.push({ codigo, canal, externoId })
      return dados.vinculo ?? { ok: true, nome: 'Ana Gestora' }
    },
    async usuarioPorConta() {
      return dados.usuario ?? null
    },
    async resolver() {
      return (
        dados.resolver ?? {
          ok: true,
          resolucao: {
            ocorrenciaId: 'oc1',
            regraId: 'r1',
            posto: 'Teste',
            jaResolvida: false,
            resolvidaPorId: 'u2',
            resolvidaPorNome: 'Bruno Líder',
            resolvidaEm: new Date('2026-09-17T17:05:00Z'),
          },
        }
      )
    },
  }
  return { repo, vinculos, reservas, concluidos }
}

const OC = '11111111-2222-3333-4444-555555555555'

/** Linha "resolvido por" que o alerta_resolver deixou na fila para outro destinatário. */
function linhaResolvido(
  id: string,
  usuarioId: string,
  externoId: string,
  canal: 'telegram' | 'discord' = 'telegram',
): EnvioReservado {
  return {
    id,
    ocorrenciaId: OC,
    usuarioId,
    canal,
    externoId,
    tipo: 'resolvido',
    dados: { posto: 'Teste', resolvida_por_nome: 'Bruno Líder', resolvida_em: '2026-09-17T17:05:00Z' },
    comBotao: false,
    tentativas: 1,
  }
}

describe('tratarUpdateTelegram — mensagens', () => {
  it('mensagem com código vincula e confirma', async () => {
    const tg = telegramFalso()
    const { repo, vinculos } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: 'alerta-7k3m' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(vinculos).toEqual([{ codigo: 'ALERTA-7K3M', canal: 'telegram', externoId: '111' }])
    expect(tg.enviadas).toEqual([
      { chatId: '111', texto: '✅ Conta vinculada ao ShopFloor (Ana Gestora)', botao: null },
    ])
  })

  it('erro de vínculo volta em português', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ vinculo: { ok: false, erro: 'Código expirado. Gere um novo em Meu perfil.' } })
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: 'ALERTA-7K3M' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.enviadas[0]!.texto).toBe('Código expirado. Gere um novo em Meu perfil.')
  })

  it('/start sem código responde as instruções', async () => {
    const tg = telegramFalso()
    const { repo, vinculos } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: '/start' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(vinculos).toHaveLength(0)
    expect(tg.enviadas[0]!.texto).toContain('Meu perfil')
  })

  it('mensagem de grupo é ignorada', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: -55, type: 'group' }, text: 'ALERTA-7K3M' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.enviadas).toHaveLength(0)
  })

  it('update desconhecido não faz nada', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram({ edited_message: {} }, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.enviadas).toHaveLength(0)
  })
})

describe('tratarUpdateTelegram — botão Resolvido', () => {
  const callback = {
    callback_query: {
      id: 'cb1',
      from: { id: 222 },
      data: `r:${OC}`,
      message: { chat: { id: 222 }, message_id: 9, text: '🔴 Teste abaixo da meta' },
    },
  }

  it('resolve, edita a mensagem, tira os botões e avisa os outros', async () => {
    const tg = telegramFalso()
    const enviadosPorta: string[] = []
    // u2 resolveu: na fila só está o aviso do u1 (quem resolveu não recebe)
    const { repo, reservas, concluidos } = repoFalso({
      usuario: 'u2',
      mensagens: [{ envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:5' }],
      fila: [linhaResolvido('res-u1', 'u1', '111')],
    })
    const portas = {
      telegram: {
        async enviar(externoId: string) {
          enviadosPorta.push(externoId)
          return { ok: true as const, mensagemExternaId: `${externoId}:2` }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }

    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas, repo })

    expect(tg.callbacks).toEqual([{ id: 'cb1', texto: 'Marcado como resolvido.' }])
    expect(tg.editadas[0]).toEqual({
      id: '222:9',
      texto: '🔴 Teste abaixo da meta\n\n✅ Teste: resolvido por Bruno Líder às 14:05',
    })
    // entrega o aviso que o banco enfileirou, só desta ocorrência
    expect(reservas).toEqual([{ canais: ['telegram'], limite: 30, ocorrenciaId: OC }])
    expect(enviadosPorta).toEqual(['111'])
    expect(concluidos).toEqual([{ id: 'res-u1', ok: true }])
  })

  it('conta não vinculada só responde o callback', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ usuario: null })
    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.callbacks[0]!.texto).toContain('não está vinculada')
    expect(tg.editadas).toHaveLength(0)
  })

  it('quem não é destinatário recebe a recusa', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({
      usuario: 'u3',
      resolver: { ok: false, codigo: 'NAO_DESTINATARIO', erro: 'Você não é destinatário desta regra.' },
    })
    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.callbacks[0]!.texto).toBe('Você não é destinatário desta regra.')
    expect(tg.editadas).toHaveLength(0)
  })

  it('já resolvido antes não avisa de novo, mas confirma quem resolveu', async () => {
    const tg = telegramFalso()
    const enviadosPorta: string[] = []
    const { repo } = repoFalso({
      usuario: 'u1',
      resolver: {
        ok: true,
        resolucao: {
          ocorrenciaId: 'oc1',
          regraId: 'r1',
          posto: 'Teste',
          jaResolvida: true,
          resolvidaPorId: 'u2',
          resolvidaPorNome: 'Bruno Líder',
          resolvidaEm: new Date('2026-09-17T17:05:00Z'),
        },
      },
      fila: [linhaResolvido('res-u1', 'u1', '111')],
    })
    const portas = {
      telegram: {
        async enviar(externoId: string) {
          enviadosPorta.push(externoId)
          return { ok: true as const, mensagemExternaId: 'x:1' }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }

    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas, repo })

    expect(tg.callbacks[0]!.texto).toBe('Já resolvido por Bruno Líder.')
    expect(enviadosPorta).toHaveLength(0)
  })

  it('callback com data desconhecida avisa e para', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram(
      { callback_query: { id: 'cb1', from: { id: 222 }, data: 'x:1' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.callbacks[0]!.texto).toBe('Ação desconhecida.')
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/webhook-telegram.test.ts
```
Expected: FAIL com `Failed to load url ../webhook-telegram`.

- [ ] **Step 7: Acrescentar `RepositorioVinculo` às portas e implementar o webhook do Telegram**

Em `src/modules/alertas/application/portas.ts`, **acrescentar esta linha ao bloco de imports do topo**
(imports ficam todos no começo do arquivo):

```ts
import type { ResolucaoOcorrencia } from '../domain/resolucao'
```

e **acrescentar ao final do arquivo**:

```ts
export type ResultadoVinculo = { ok: true; nome: string } | { ok: false; erro: string }

/** `codigo` é o código do Postgres (ex.: 'NAO_DESTINATARIO'), pra decidir o que fazer no webhook. */
export type ResultadoResolver =
  | { ok: true; resolucao: ResolucaoOcorrencia }
  | { ok: false; codigo: string; erro: string }

export interface RepositorioVinculo {
  vincular(codigo: string, canal: Canal, externoId: string): Promise<ResultadoVinculo>
  /** Dono da conta externa (chat do Telegram / usuário do Discord), ou null se não vinculada. */
  usuarioPorConta(canal: Canal, externoId: string): Promise<string | null>
  resolver(ocorrenciaId: string, usuarioId: string): Promise<ResultadoResolver>
}

export interface DependenciasWebhook {
  portas: PortasCanais
  repo: RepositorioEnvios & RepositorioVinculo
}
```

Criar `src/modules/alertas/application/webhook-telegram.ts`:

```ts
import type { TelegramClient } from '../infra/telegram'
import { extrairCodigoVinculo, lerCallbackResolver } from '../domain/codigos'
import { TEXTO_INSTRUCOES_TELEGRAM, textoResolvido, textoVinculado } from '../domain/mensagens'
import { montarIdMensagemTelegram } from '../infra/telegram'
import { entregarPendentes, removerBotoesDaOcorrencia } from './enviar-alertas'
import type { DependenciasWebhook } from './portas'

interface MensagemTelegram {
  chat?: { id?: number | string; type?: string }
  text?: string
}

interface CallbackTelegram {
  id?: string
  from?: { id?: number | string }
  data?: string
  message?: { chat?: { id?: number | string }; message_id?: number; text?: string }
}

interface UpdateTelegram {
  message?: MensagemTelegram
  callback_query?: CallbackTelegram
}

type Deps = DependenciasWebhook & { telegram: TelegramClient }

/**
 * Trata um update do Telegram. Nunca lança: a rota responde 200 de qualquer jeito (o Telegram
 * reenvia o update em erro, e um update repetido geraria mensagem repetida).
 */
export async function tratarUpdateTelegram(update: unknown, deps: Deps): Promise<void> {
  const u = (update ?? {}) as UpdateTelegram
  if (u.message) return tratarMensagem(u.message, deps)
  if (u.callback_query) return tratarCallback(u.callback_query, deps)
}

async function tratarMensagem(m: MensagemTelegram, deps: Deps): Promise<void> {
  // Só conversa privada: o vínculo é pessoal, e em grupo o chat id não é de ninguém.
  if (m.chat?.type !== 'private' || m.chat.id === undefined) return
  const chatId = String(m.chat.id)

  const codigo = extrairCodigoVinculo(m.text)
  if (!codigo) {
    await deps.telegram.enviarMensagem(chatId, TEXTO_INSTRUCOES_TELEGRAM, null)
    return
  }

  const r = await deps.repo.vincular(codigo, 'telegram', chatId)
  await deps.telegram.enviarMensagem(chatId, r.ok ? textoVinculado(r.nome) : r.erro, null)
}

async function tratarCallback(q: CallbackTelegram, deps: Deps): Promise<void> {
  if (!q.id) return
  const ocorrenciaId = lerCallbackResolver(q.data)
  if (!ocorrenciaId || q.from?.id === undefined) {
    await deps.telegram.responderCallback(q.id, 'Ação desconhecida.')
    return
  }

  const usuarioId = await deps.repo.usuarioPorConta('telegram', String(q.from.id))
  if (!usuarioId) {
    await deps.telegram.responderCallback(q.id, 'Sua conta do Telegram não está vinculada ao ShopFloor.')
    return
  }

  const r = await deps.repo.resolver(ocorrenciaId, usuarioId)
  if (!r.ok) {
    await deps.telegram.responderCallback(q.id, r.erro)
    // Já normalizou: o botão não serve mais pra nada, então sai de todas as mensagens.
    if (r.codigo === 'OCORRENCIA_ENCERRADA') {
      await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
    }
    return
  }

  const res = r.resolucao
  const linha = textoResolvido({ posto: res.posto, nome: res.resolvidaPorNome, em: res.resolvidaEm })
  await deps.telegram.responderCallback(
    q.id,
    res.jaResolvida ? `Já resolvido por ${res.resolvidaPorNome}.` : 'Marcado como resolvido.',
  )

  if (q.message?.chat?.id !== undefined && q.message.message_id !== undefined) {
    const id = montarIdMensagemTelegram(q.message.chat.id, q.message.message_id)
    await deps.telegram.editarTexto(id, `${q.message.text ?? ''}\n\n${linha}`.trim())
  }

  await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)

  // O "resolvido por" dos outros destinatários JÁ ESTÁ NA FILA: o alerta_resolver enfileirou na
  // mesma transação da resolução. Aqui só se adianta a entrega (só desta ocorrência — a reserva é
  // atômica, então o cron nunca manda de novo). Se o processo cair antes, o cron entrega depois.
  if (!res.jaResolvida) {
    await entregarPendentes(deps.portas, deps.repo, { ocorrenciaId })
  }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/webhook-telegram.test.ts
```
Expected: PASS — `Tests 10 passed`.

- [ ] **Step 9: Escrever o teste do webhook do Discord (falhando)**

Criar `src/modules/alertas/application/__tests__/webhook-discord.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { EnvioReservado } from '../../domain/envio'
import type { FiltroReserva, MensagemComBotao, RepositorioEnvios, RepositorioVinculo } from '../portas'
import { tratarInteracaoDiscord } from '../webhook-discord'

function repoFalso(dados: {
  vinculo?: { ok: true; nome: string } | { ok: false; erro: string }
  usuario?: string | null
  resolver?: Awaited<ReturnType<RepositorioVinculo['resolver']>>
  mensagens?: MensagemComBotao[]
  /** O que o banco pôs na fila (o alerta_resolver enfileira o "resolvido por" dos OUTROS). */
  fila?: EnvioReservado[]
}) {
  const vinculos: { codigo: string; canal: string; externoId: string }[] = []
  const reservas: FiltroReserva[] = []
  const concluidos: { id: string; ok: boolean }[] = []
  const removidos: string[] = []
  let fila = dados.fila ?? []
  const repo: RepositorioEnvios & RepositorioVinculo = {
    async avaliar() {
      return { ocupado: false, avaliadas: 0, enfileirados: 0, normalizadas: [] }
    },
    async reservarPendentes(f) {
      reservas.push(f)
      const lote = fila.filter((e) => f.ocorrenciaId === null || e.ocorrenciaId === f.ocorrenciaId)
      fila = fila.filter((e) => !lote.includes(e))
      return lote
    },
    async concluirEnvio(envio, _texto, resultado) {
      concluidos.push({ id: envio.id, ok: resultado.ok })
    },
    async registrarEnvioDireto() {},
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao(ids) {
      removidos.push(...ids)
    },
    async contaDoUsuario() {
      return null
    },
    async vincular(codigo, canal, externoId) {
      vinculos.push({ codigo, canal, externoId })
      return dados.vinculo ?? { ok: true, nome: 'Ana Gestora' }
    },
    async usuarioPorConta() {
      return dados.usuario ?? null
    },
    async resolver() {
      return (
        dados.resolver ?? {
          ok: true,
          resolucao: {
            ocorrenciaId: 'oc1',
            regraId: 'r1',
            posto: 'Teste',
            jaResolvida: false,
            resolvidaPorId: 'u2',
            resolvidaPorNome: 'Bruno Líder',
            resolvidaEm: new Date('2026-09-17T17:05:00Z'),
          },
        }
      )
    },
  }
  return { repo, vinculos, reservas, concluidos, removidos }
}

const OC = '11111111-2222-3333-4444-555555555555'

/** Linha "resolvido por" que o alerta_resolver deixou na fila para outro destinatário. */
function linhaResolvido(
  id: string,
  usuarioId: string,
  externoId: string,
  canal: 'telegram' | 'discord' = 'telegram',
): EnvioReservado {
  return {
    id,
    ocorrenciaId: OC,
    usuarioId,
    canal,
    externoId,
    tipo: 'resolvido',
    dados: { posto: 'Teste', resolvida_por_nome: 'Bruno Líder', resolvida_em: '2026-09-17T17:05:00Z' },
    comBotao: false,
    tentativas: 1,
  }
}

describe('tratarInteracaoDiscord', () => {
  it('PING responde PONG sem tocar no banco', async () => {
    const { repo } = repoFalso({})
    const r = await tratarInteracaoDiscord({ type: 1 }, { portas: {}, repo })
    expect(r.corpo).toEqual({ type: 1 })
    expect(r.depois).toBeNull()
  })

  it('/vincular no servidor usa member.user.id e responde efêmero', async () => {
    const { repo, vinculos } = repoFalso({})
    const r = await tratarInteracaoDiscord(
      {
        type: 2,
        member: { user: { id: 'D9' } },
        data: { name: 'vincular', options: [{ name: 'codigo', value: 'alerta-7k3m' }] },
      },
      { portas: {}, repo },
    )
    expect(vinculos).toEqual([{ codigo: 'ALERTA-7K3M', canal: 'discord', externoId: 'D9' }])
    expect(r.corpo).toEqual({
      type: 4,
      data: { content: '✅ Conta vinculada ao ShopFloor (Ana Gestora)', flags: 64 },
    })
  })

  it('/vincular sem código válido explica o formato', async () => {
    const { repo, vinculos } = repoFalso({})
    const r = await tratarInteracaoDiscord(
      { type: 2, user: { id: 'D9' }, data: { name: 'vincular', options: [{ name: 'codigo', value: 'oi' }] } },
      { portas: {}, repo },
    )
    expect(vinculos).toHaveLength(0)
    expect(String((r.corpo.data as { content: string }).content)).toContain('ALERTA-')
  })

  it('botão resolve: atualiza a mensagem (type 7, sem componentes) e agenda o resto', async () => {
    const { repo, concluidos } = repoFalso({
      usuario: 'u2',
      fila: [linhaResolvido('res-u1', 'u1', 'D1', 'discord')],
    })
    const enviados: string[] = []
    const portas = {
      discord: {
        async enviar(externoId: string) {
          enviados.push(externoId)
          return { ok: true as const, mensagemExternaId: `${externoId}:1` }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }

    const r = await tratarInteracaoDiscord(
      {
        type: 3,
        user: { id: 'D2' },
        data: { custom_id: `r:${OC}` },
        message: { content: '🔴 Teste abaixo da meta' },
      },
      { portas, repo },
    )

    expect(r.corpo).toEqual({
      type: 7,
      data: {
        content: '🔴 Teste abaixo da meta\n\n✅ Teste: resolvido por Bruno Líder às 14:05',
        components: [],
      },
    })
    expect(r.depois).not.toBeNull()

    await r.depois!()
    expect(enviados).toEqual(['D1'])
    expect(concluidos).toEqual([{ id: 'res-u1', ok: true }])
  })

  it('botão de quem não vinculou responde efêmero', async () => {
    const { repo } = repoFalso({ usuario: null })
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` } },
      { portas: {}, repo },
    )
    expect(String((r.corpo.data as { content: string }).content)).toContain('não está vinculada')
    expect(r.depois).toBeNull()
  })

  it('ocorrência já normalizada avisa e agenda a limpeza dos botões', async () => {
    const { repo } = repoFalso({
      usuario: 'u2',
      resolver: { ok: false, codigo: 'OCORRENCIA_ENCERRADA', erro: 'Esta ocorrência já normalizou.' },
      mensagens: [{ envioId: 'e1', canal: 'discord', mensagemExternaId: 'C9:M7' }],
    })
    const portas = {
      discord: {
        async enviar() {
          return { ok: true as const, mensagemExternaId: 'x:1' }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` } },
      { portas, repo },
    )
    expect((r.corpo.data as { content: string }).content).toBe('Esta ocorrência já normalizou.')
    expect(r.depois).not.toBeNull()
    await r.depois!()
  })

  it('tipo de interação desconhecido responde efêmero', async () => {
    const { repo } = repoFalso({})
    const r = await tratarInteracaoDiscord({ type: 99 }, { portas: {}, repo })
    expect(r.corpo).toMatchObject({ type: 4 })
  })
})
```

- [ ] **Step 10: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/webhook-discord.test.ts
```
Expected: FAIL com `Failed to load url ../webhook-discord`.

- [ ] **Step 11: Implementar o webhook do Discord**

Criar `src/modules/alertas/application/webhook-discord.ts`:

```ts
import { extrairCodigoVinculo, lerCallbackResolver } from '../domain/codigos'
import { textoResolvido, textoVinculado } from '../domain/mensagens'
import { entregarPendentes, removerBotoesDaOcorrencia } from './enviar-alertas'
import type { DependenciasWebhook } from './portas'

/** Tipos de interação e de resposta do Discord (API v10). */
const INTERACAO_PING = 1
const INTERACAO_COMANDO = 2
const INTERACAO_COMPONENTE = 3
const RESPOSTA_PONG = 1
const RESPOSTA_MENSAGEM = 4
const RESPOSTA_ATUALIZA_MENSAGEM = 7
const FLAG_EFEMERA = 64

interface InteracaoDiscord {
  type?: number
  member?: { user?: { id?: string } }
  user?: { id?: string }
  data?: { name?: string; custom_id?: string; options?: { name?: string; value?: unknown }[] }
  message?: { content?: string }
}

export interface RespostaDiscord {
  /** Corpo JSON da resposta imediata (o Discord exige resposta em 3 s). */
  corpo: Record<string, unknown>
  /** Trabalho que pode terminar depois da resposta (a rota agenda com `after`). */
  depois: (() => Promise<void>) | null
}

function efemera(texto: string): RespostaDiscord {
  return { corpo: { type: RESPOSTA_MENSAGEM, data: { content: texto, flags: FLAG_EFEMERA } }, depois: null }
}

export async function tratarInteracaoDiscord(
  interacao: unknown,
  deps: DependenciasWebhook,
): Promise<RespostaDiscord> {
  const i = (interacao ?? {}) as InteracaoDiscord
  // No servidor o autor vem em member.user; na DM vem em user.
  const externoId = i.member?.user?.id ?? i.user?.id

  if (i.type === INTERACAO_PING) return { corpo: { type: RESPOSTA_PONG }, depois: null }

  if (i.type === INTERACAO_COMANDO) {
    if (i.data?.name !== 'vincular' || !externoId) return efemera('Comando desconhecido.')
    const valor = String(i.data.options?.find((o) => o.name === 'codigo')?.value ?? '')
    const codigo = extrairCodigoVinculo(valor)
    if (!codigo) return efemera('Informe o código gerado em Meu perfil (ex.: ALERTA-7K3M).')
    const r = await deps.repo.vincular(codigo, 'discord', externoId)
    return efemera(r.ok ? textoVinculado(r.nome) : r.erro)
  }

  if (i.type === INTERACAO_COMPONENTE) {
    const ocorrenciaId = lerCallbackResolver(i.data?.custom_id)
    if (!ocorrenciaId || !externoId) return efemera('Ação desconhecida.')

    const usuarioId = await deps.repo.usuarioPorConta('discord', externoId)
    if (!usuarioId) return efemera('Sua conta do Discord não está vinculada ao ShopFloor.')

    const r = await deps.repo.resolver(ocorrenciaId, usuarioId)
    if (!r.ok) {
      const resposta = efemera(r.erro)
      if (r.codigo === 'OCORRENCIA_ENCERRADA') {
        resposta.depois = () => removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
      }
      return resposta
    }

    const res = r.resolucao
    const linha = textoResolvido({ posto: res.posto, nome: res.resolvidaPorNome, em: res.resolvidaEm })
    return {
      // type 7 edita a MENSAGEM CLICADA: acrescenta quem resolveu e apaga o botão.
      corpo: {
        type: RESPOSTA_ATUALIZA_MENSAGEM,
        data: { content: `${i.message?.content ?? ''}\n\n${linha}`.trim(), components: [] },
      },
      depois: async () => {
        await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
        // O aviso aos outros já está na fila (alerta_resolver): só adianta a entrega.
        if (!res.jaResolvida) {
          await entregarPendentes(deps.portas, deps.repo, { ocorrenciaId })
        }
      },
    }
  }

  return efemera('Interação não suportada.')
}
```

- [ ] **Step 12: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/webhook-discord.test.ts
```
Expected: PASS — `Tests 7 passed`.

- [ ] **Step 13: Escrever o teste das rotas dos webhooks (falhando)**

Criar `src/modules/alertas/application/__tests__/rotas-webhooks.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'

vi.mock('server-only', () => ({}))

const criarDependenciasAlertas = vi.fn(() => ({ portas: {}, repo: {} }))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))

const tratarUpdateTelegram = vi.fn(async () => {})
vi.mock('@/modules/alertas/application/webhook-telegram', () => ({ tratarUpdateTelegram }))

const tratarInteracaoDiscord = vi.fn(async () => ({ corpo: { type: 1 }, depois: null }))
vi.mock('@/modules/alertas/application/webhook-discord', () => ({ tratarInteracaoDiscord }))

// `after` fora do ciclo de requisição do Next não roda; aqui executa na hora.
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => void fn() }))

import { POST as POST_TELEGRAM } from '@/app/api/alertas/telegram/route'
import { POST as POST_DISCORD } from '@/app/api/alertas/discord/route'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const CHAVE_HEX = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'TOKEN')
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'segredo-webhook')
  vi.stubEnv('DISCORD_PUBLIC_KEY', CHAVE_HEX)
})

describe('POST /api/alertas/telegram', () => {
  function pedido(cabecalhos: Record<string, string>, corpo: unknown = { message: {} }) {
    return new Request('https://shopfloor.enterplak.com.br/api/alertas/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabecalhos },
      body: JSON.stringify(corpo),
    })
  }

  it('sem o secret token devolve 401 e não trata nada', async () => {
    const res = await POST_TELEGRAM(pedido({}))
    expect(res.status).toBe(401)
    expect(tratarUpdateTelegram).not.toHaveBeenCalled()
  })

  it('secret token errado devolve 401', async () => {
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'outro' }))
    expect(res.status).toBe(401)
  })

  it('secret token certo trata o update e responde 200', async () => {
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'segredo-webhook' }))
    expect(res.status).toBe(200)
    expect(tratarUpdateTelegram).toHaveBeenCalledTimes(1)
  })

  it('erro no tratamento continua respondendo 200 (o Telegram não deve reenviar)', async () => {
    tratarUpdateTelegram.mockRejectedValueOnce(new Error('banco fora'))
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'segredo-webhook' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/alertas/discord', () => {
  function pedido(corpo: unknown, opcoes: { assinar?: boolean } = { assinar: true }) {
    const texto = JSON.stringify(corpo)
    const ts = '1789000000'
    const assinatura = opcoes.assinar
      ? sign(null, Buffer.from(ts + texto), privateKey).toString('hex')
      : 'aa'.repeat(64)
    return new Request('https://shopfloor.enterplak.com.br/api/alertas/discord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': assinatura,
        'x-signature-timestamp': ts,
      },
      body: texto,
    })
  }

  it('assinatura inválida devolve 401', async () => {
    const res = await POST_DISCORD(pedido({ type: 1 }, { assinar: false }))
    expect(res.status).toBe(401)
    expect(tratarInteracaoDiscord).not.toHaveBeenCalled()
  })

  it('assinatura válida responde o corpo devolvido pelo handler', async () => {
    const res = await POST_DISCORD(pedido({ type: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 1 })
    expect(tratarInteracaoDiscord).toHaveBeenCalledTimes(1)
  })

  it('agenda o trabalho de depois', async () => {
    const depois = vi.fn(async () => {})
    tratarInteracaoDiscord.mockResolvedValueOnce({ corpo: { type: 7 }, depois })
    await POST_DISCORD(pedido({ type: 3 }))
    expect(depois).toHaveBeenCalledTimes(1)
  })

  it('erro no handler responde mensagem efêmera em vez de estourar', async () => {
    tratarInteracaoDiscord.mockRejectedValueOnce(new Error('banco fora'))
    const res = await POST_DISCORD(pedido({ type: 3 }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { content: string; flags: number } }
    expect(json.data.flags).toBe(64)
  })
})
```

- [ ] **Step 14: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/application/__tests__/rotas-webhooks.test.ts
```
Expected: FAIL com `Failed to load url @/app/api/alertas/telegram/route`.

- [ ] **Step 15: Implementar as rotas dos webhooks e completar o repositório**

Em `src/modules/alertas/infra/repositorio-servico.ts`:

1. **Trocar** o bloco de imports de tipos por:

```ts
import { ehCanal, type Canal, type ResultadoEnvio } from '../domain/tipos'
import { lerResultadoAvaliacao, type ContaDestino } from '../domain/avaliacao'
import { lerEnvioReservado, type EnvioReservado } from '../domain/envio'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type {
  FiltroReserva,
  MensagemComBotao,
  NovoEnvioDireto,
  RepositorioEnvios,
  RepositorioVinculo,
} from '../application/portas'
```

2. **Trocar** a assinatura da função por:

```ts
export function criarRepositorioServico(
  sb: SupabaseClient = createServiceSupabase(),
): RepositorioEnvios & RepositorioVinculo {
```

3. **Acrescentar** os três métodos ao objeto devolvido (depois de `contaDoUsuario`):

```ts
    async vincular(codigo: string, canal: Canal, externoId: string) {
      const { data, error } = await sb.rpc('alerta_vincular', {
        p_codigo: codigo,
        p_canal: canal,
        p_externo_id: externoId,
      })
      // Revisão da Task 2: alerta_vincular NUNCA levanta exceção de regra de negócio (senão a
      // proteção contra força bruta perderia o registro da tentativa — o raise desfaz a
      // transação inteira da chamada). Ela sempre devolve jsonb:
      //   sucesso: {"ok": true, "nome": "..."}
      //   falha:   {"ok": false, "erro": "CANAL_INVALIDO" | "CODIGO_INVALIDO"
      //                                  | "CONTA_JA_VINCULADA" | "MUITAS_TENTATIVAS"}
      // `error` aqui só acontece em falha de sistema (conexão, etc.), não em erro de regra.
      if (error) return { ok: false as const, erro: mensagemErroAlerta(error.message) }
      const r = data as { ok: boolean; nome?: string; erro?: string }
      if (!r.ok) return { ok: false as const, erro: mensagemErroAlerta(r.erro) }
      return { ok: true as const, nome: r.nome ?? '' }
    },

    async usuarioPorConta(canal: Canal, externoId: string) {
      const { data, error } = await sb
        .from('alerta_contas')
        .select('usuario_id')
        .eq('canal', canal)
        .eq('externo_id', externoId)
        .maybeSingle()
      if (error) throw new Error(`alerta_contas: ${error.message}`)
      return (data as { usuario_id: string } | null)?.usuario_id ?? null
    },

    async resolver(ocorrenciaId: string, usuarioId: string) {
      const { data, error } = await sb.rpc('alerta_resolver', {
        p_ocorrencia_id: ocorrenciaId,
        p_usuario_id: usuarioId,
      })
      if (error) {
        return {
          ok: false as const,
          codigo: codigoErroAlerta(error.message),
          erro: mensagemErroAlerta(error.message),
        }
      }
      return { ok: true as const, resolucao: lerResolucao(data) }
    },
```

Em `src/modules/alertas/infra/fabrica.ts`, **trocar** o conteúdo por:

```ts
import 'server-only'
import type { PortasCanais, RepositorioEnvios, RepositorioVinculo } from '../application/portas'
import { criarPortasCanais } from './canais'
import { criarRepositorioServico } from './repositorio-servico'

/** Dependências prontas para as rotas (cron e webhooks) e para as actions de servidor. */
export function criarDependenciasAlertas(): {
  portas: PortasCanais
  repo: RepositorioEnvios & RepositorioVinculo
} {
  return { portas: criarPortasCanais(), repo: criarRepositorioServico() }
}
```

Criar `src/app/api/alertas/telegram/route.ts`:

```ts
import { tratarUpdateTelegram } from '@/modules/alertas/application/webhook-telegram'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'
import { criarTelegram } from '@/modules/alertas/infra/telegram'

export const dynamic = 'force-dynamic'

/**
 * Webhook do Telegram. O `secret_token` foi registrado no setWebhook (tools/alertas), e o Telegram
 * o devolve neste cabeçalho — é o que separa um update de verdade de qualquer POST da internet.
 *
 * Depois de autorizado, responde SEMPRE 200: em erro o Telegram reenvia o mesmo update, e o efeito
 * seria mensagem repetida na conversa da pessoa.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  if (
    esperado === '' ||
    token === '' ||
    !segredoConfere(request.headers.get('x-telegram-bot-api-secret-token'), esperado)
  ) {
    return new Response('Não autorizado', { status: 401 })
  }

  let update: unknown = null
  try {
    update = await request.json()
  } catch {
    return new Response('ok')
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    await tratarUpdateTelegram(update, { telegram: criarTelegram({ token }), portas, repo })
  } catch (e) {
    console.error('[alertas] webhook telegram:', e instanceof Error ? e.message : e)
  }
  return new Response('ok')
}
```

Criar `src/app/api/alertas/discord/route.ts`:

```ts
import { after } from 'next/server'
import { tratarInteracaoDiscord } from '@/modules/alertas/application/webhook-discord'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { verificarAssinaturaDiscord } from '@/modules/alertas/infra/assinatura'

export const dynamic = 'force-dynamic'

/**
 * Webhook de interações do Discord. A assinatura cobre `timestamp + CORPO CRU`, então o corpo é
 * lido como TEXTO antes de qualquer parse. O Discord espera resposta em 3 s — o que sobra
 * (avisar os outros destinatários, limpar botões) vai para `after`.
 */
export async function POST(request: Request): Promise<Response> {
  const chave = process.env.DISCORD_PUBLIC_KEY ?? ''
  const corpo = await request.text()
  const assinaturaOk = verificarAssinaturaDiscord(
    chave,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    corpo,
  )
  if (!assinaturaOk) return new Response('Assinatura inválida', { status: 401 })

  let interacao: unknown
  try {
    interacao = JSON.parse(corpo)
  } catch {
    return new Response('JSON inválido', { status: 400 })
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resposta = await tratarInteracaoDiscord(interacao, { portas, repo })
    if (resposta.depois) {
      const tarefa = resposta.depois
      after(async () => {
        try {
          await tarefa()
        } catch (e) {
          console.error('[alertas] pós-resposta do discord:', e instanceof Error ? e.message : e)
        }
      })
    }
    return Response.json(resposta.corpo)
  } catch (e) {
    console.error('[alertas] webhook discord:', e instanceof Error ? e.message : e)
    return Response.json({
      type: 4,
      data: { content: 'Não foi possível concluir agora. Tente de novo em instantes.', flags: 64 },
    })
  }
}
```

- [ ] **Step 16: Rodar tudo e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas && npx tsc --noEmit && npm run lint
```
Expected: `Test Files 14 passed`; `tsc` sem saída; lint sem avisos.

- [ ] **Step 17: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add src/modules/alertas src/app/api/alertas
git commit -m "$(cat <<'MSG'
feat(alertas): webhooks do Telegram e do Discord

Vínculo por código (mensagem no Telegram, /vincular no Discord) e botão
Resolvido: identifica a pessoa pela conta vinculada, chama alerta_resolver,
edita a mensagem clicada (sem botão), limpa os botões das outras e adianta a
entrega do "resolvido por" que o banco já enfileirou para os outros
destinatários (entregarPendentes só desta ocorrência). Telegram responde sempre 200 após o secret token;
Discord confere a assinatura Ed25519 e usa after() para o pós-resposta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Regras e ocorrências — validação, repositórios e server actions

**Files:**
- Create: `src/modules/alertas/domain/regra.ts`
- Create: `src/modules/alertas/domain/ocorrencia.ts`
- Modify: `src/modules/alertas/domain/tipos.ts` (acrescentar `ContaVinculada`)
- Create: `src/modules/alertas/infra/regras-repository.ts`
- Create: `src/modules/alertas/infra/contas-repository.ts`
- Create: `src/modules/alertas/application/alertas-actions.ts`
- Create: `src/modules/alertas/application/perfil-alertas-actions.ts`
- Test: `src/modules/alertas/domain/__tests__/regra.test.ts`
- Test: `src/modules/alertas/domain/__tests__/ocorrencia.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `Canal`, `CANAIS`, `NOME_CANAL`, `ehCanal`, `ehJanelaTipo`, `JanelaTipo`, `EstadoOcorrencia` (`../domain/tipos`); `mensagemErroAlerta`, `codigoErroAlerta` (`../domain/erros`).
  - Task 3 (banco): RPCs `alerta_previa`, `alerta_destinatarios`, `alerta_listar_ocorrencias`, `alerta_resolver_admin`, `alerta_gerar_codigo`; tabelas `alerta_regras`, `alerta_contas`.
  - Task 5/6 (+ revisão da fila): `criarDependenciasAlertas` (`../infra/fabrica`), `avaliarEEnviar`, `entregarPendentes`, `removerBotoesDaOcorrencia`, `enviarTeste` (`./enviar-alertas`), `ResumoAvaliacao`, `ResultadoResolver` (`./portas`), `lerResolucao` (`../domain/resolucao`).
  - Projeto: `getSessao`, `podeNoModulo`, `createServerSupabase`, `registrarLog`, `revalidatePath`.
- Produces (consumido pelas Tasks 8 e 9):
  - `interface ContaVinculada { canal: Canal; vinculadoEm: string }` (em `domain/tipos.ts`)
  - `interface EntradaRegra { nome: string; postos: string[]; taxaMinima: string | number; janelaTipo: string; janelaValor: string | number | null; minimoBipes: string | number; lembreteMin: string | number | null; canais: string[]; destinatarios: string[]; ativa: boolean }`
  - `interface RegraValida { nome: string; postos: string[]; taxaMinima: number; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number; lembreteMin: number | null; canais: Canal[]; destinatarios: string[]; ativa: boolean }`
  - `interface RegraAlerta extends RegraValida { id: string; atualizadoEm: string }`
  - `interface DestinatarioDisponivel { usuarioId: string; nome: string; email: string; telegram: boolean; discord: boolean }`
  - `const PADROES_REGRA = { taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 }`
  - `validarRegra(e: EntradaRegra): { ok: true; valor: RegraValida } | { ok: false; erro: string }`
  - `validarPrevia(e: { postos: string[]; janelaTipo: string; janelaValor: string | number | null; minimoBipes: string | number }): { ok: true; valor: { postos: string[]; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number } } | { ok: false; erro: string }`
  - `destinatariosSemCanal(disponiveis: DestinatarioDisponivel[], selecionados: string[], canais: Canal[]): string[]`
  - `interface PreviaPosto { posto: string; aprovados: number; reprovados: number; taxa: number | null; avaliavel: boolean; pmo: string | null; op: string | null }`
  - `interface FiltroOcorrencias { de: string; ate: string; estado: '' | EstadoOcorrencia }`
  - `interface OcorrenciaLinha { id: string; regraId: string; regraNome: string; posto: string; pmo: string | null; op: string | null; estado: EstadoOcorrencia; taxaAbertura: number; taxaUltima: number; aprovados: number; reprovados: number; abertaEm: string; resolvidaPorNome: string; resolvidaEm: string | null; normalizadaEm: string | null; enviosOk: number; enviosFalha: number }`
  - `periodoOcorrencias(de: string, ate: string): { de: string; ate: string } | null`; `dataIsoSaoPaulo(d: Date): string`; `filtroOcorrenciasPadrao(hoje: Date): FiltroOcorrencias`
  - Actions (`alertas-actions.ts`): `salvarRegraAction(id: string | null, entrada: EntradaRegra): Promise<{ ok: true; id: string } | { ok: false; erro: string }>`; `excluirRegraAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }>` (**exclusão lógica**: `excluida_em = now()` + `ativa = false`; o histórico continua); `alternarRegraAtivaAction(id: string, ativa: boolean): Promise<{ ok: true } | { ok: false; erro: string }>`; `previaRegraAction(entrada: { postos: string[]; janelaTipo: string; janelaValor: string | number | null; minimoBipes: string | number }): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }>`; `listarOcorrenciasAction(filtro: FiltroOcorrencias): Promise<{ ok: true; ocorrencias: OcorrenciaLinha[] } | { ok: false; erro: string }>`; `resolverOcorrenciaAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }>`; `avaliarAgoraAction(): Promise<{ ok: true; resumo: ResumoAvaliacao } | { ok: false; erro: string }>`
  - Actions (`perfil-alertas-actions.ts`): `gerarCodigoAction(): Promise<{ ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }>`; `minhasContasAction(): Promise<{ ok: true; contas: ContaVinculada[] } | { ok: false; erro: string }>`; `desvincularAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }>`; `enviarTesteAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }>`
  - Repositórios: `listarRegras()` (**só as não excluídas**), `inserirRegra(r)`, `atualizarRegra(id, r)`, `excluirRegra(id)` (**update** de `excluida_em`/`ativa`, nunca `delete`), `definirRegraAtiva(id, ativa)`, `previaRegra(p)`, `listarDestinatarios()`, `listarOcorrencias(f)`, `resolverOcorrenciaComoAdmin(id)`, `gerarCodigoVinculo()`, `listarMinhasContas()`, `desvincularConta(canal)`

- [ ] **Step 1: Escrever o teste da validação da regra (falhando)**

Criar `src/modules/alertas/domain/__tests__/regra.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarRegra, validarPrevia, destinatariosSemCanal, PADROES_REGRA, type EntradaRegra } from '../regra'

const BASE: EntradaRegra = {
  nome: '  Teste   abaixo de 90 ',
  postos: ['Teste', 'Teste', ' '],
  taxaMinima: '92,5',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: '',
  canais: ['telegram', 'telegram'],
  destinatarios: ['u1', 'u1', 'u2'],
  ativa: true,
}

describe('validarRegra', () => {
  it('normaliza nome, postos, canais e destinatários e aceita vírgula na taxa', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toEqual({
      nome: 'Teste abaixo de 90',
      postos: ['Teste'],
      taxaMinima: 92.5,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: 20,
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1', 'u2'],
      ativa: true,
    })
  })

  it('janela op não tem valor', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'op', janelaValor: '60' })
    expect(r.ok && r.valor.janelaValor).toBeNull()
  })

  it('lembrete em minutos', () => {
    const r = validarRegra({ ...BASE, lembreteMin: '15' })
    expect(r.ok && r.valor.lembreteMin).toBe(15)
  })

  it('exige nome', () => {
    expect(validarRegra({ ...BASE, nome: '   ' })).toEqual({ ok: false, erro: 'Informe o nome da regra.' })
  })

  it('exige pelo menos 1 posto, 1 canal e 1 destinatário', () => {
    expect(validarRegra({ ...BASE, postos: [] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 posto.' })
    expect(validarRegra({ ...BASE, canais: [] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 canal.' })
    expect(validarRegra({ ...BASE, destinatarios: [] })).toEqual({
      ok: false,
      erro: 'Escolha pelo menos 1 destinatário.',
    })
  })

  it('recusa canal desconhecido', () => {
    expect(validarRegra({ ...BASE, canais: ['whatsapp'] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 canal.' })
  })

  it('taxa mínima entre 0 e 100, com até 2 casas', () => {
    expect(validarRegra({ ...BASE, taxaMinima: '101' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
    expect(validarRegra({ ...BASE, taxaMinima: '' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
    expect(validarRegra({ ...BASE, taxaMinima: '90,125' })).toEqual({
      ok: false,
      erro: 'A taxa mínima aceita até 2 casas decimais.',
    })
  })

  it('janela e mínimo precisam ser inteiros positivos', () => {
    expect(validarRegra({ ...BASE, janelaValor: '0' })).toEqual({
      ok: false,
      erro: 'Informe quantos minutos a janela olha.',
    })
    expect(validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '1,5' })).toEqual({
      ok: false,
      erro: 'Informe quantos bipes a janela olha.',
    })
    expect(validarRegra({ ...BASE, minimoBipes: '0' })).toEqual({
      ok: false,
      erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.',
    })
    expect(validarRegra({ ...BASE, lembreteMin: '-3' })).toEqual({
      ok: false,
      erro: 'O lembrete deve ser um número inteiro de minutos (ou vazio).',
    })
  })

  it('janela de bipes menor que o mínimo nunca avaliaria', () => {
    expect(validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '10', minimoBipes: '20' })).toEqual({
      ok: false,
      erro: 'A janela de bipes precisa ser maior ou igual ao mínimo de bipes.',
    })
  })

  it('recusa janela desconhecida', () => {
    expect(validarRegra({ ...BASE, janelaTipo: 'lua' })).toEqual({ ok: false, erro: 'Escolha a janela da regra.' })
  })

  it('os padrões da spec', () => {
    expect(PADROES_REGRA).toEqual({ taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 })
  })
})

describe('validarPrevia', () => {
  it('aceita só o que a prévia precisa', () => {
    const r = validarPrevia({ postos: ['Teste'], janelaTipo: 'op', janelaValor: null, minimoBipes: '20' })
    expect(r).toEqual({ ok: true, valor: { postos: ['Teste'], janelaTipo: 'op', janelaValor: null, minimoBipes: 20 } })
  })
  it('sem posto não há prévia', () => {
    expect(validarPrevia({ postos: [], janelaTipo: 'tempo', janelaValor: 60, minimoBipes: 20 })).toEqual({
      ok: false,
      erro: 'Escolha pelo menos 1 posto.',
    })
  })
})

describe('destinatariosSemCanal', () => {
  const disponiveis = [
    { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
    { usuarioId: 'u2', nome: 'Bruno Líder', email: 'bruno@x', telegram: true, discord: false },
    { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
  ]
  it('lista quem não recebe pelos canais escolhidos', () => {
    expect(destinatariosSemCanal(disponiveis, ['u1', 'u2', 'u3'], ['telegram', 'discord'])).toEqual([
      'Bruno Líder sem Discord',
      'Carla Operadora sem Telegram',
      'Carla Operadora sem Discord',
    ])
  })
  it('ninguém faltando, lista vazia', () => {
    expect(destinatariosSemCanal(disponiveis, ['u1'], ['telegram', 'discord'])).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/regra.test.ts
```
Expected: FAIL com `Failed to load url ../regra`.

- [ ] **Step 3: Implementar a validação da regra**

Criar `src/modules/alertas/domain/regra.ts`:

```ts
import { CANAIS, NOME_CANAL, ehCanal, ehJanelaTipo, type Canal, type JanelaTipo } from './tipos'

/** O que vem do formulário (tudo pode chegar como texto). */
export interface EntradaRegra {
  nome: string
  postos: string[]
  taxaMinima: string | number
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
  lembreteMin: string | number | null
  canais: string[]
  destinatarios: string[]
  ativa: boolean
}

/** A regra já conferida, pronta para o banco. */
export interface RegraValida {
  nome: string
  postos: string[]
  taxaMinima: number
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number
  lembreteMin: number | null
  canais: Canal[]
  destinatarios: string[]
  ativa: boolean
}

export interface RegraAlerta extends RegraValida {
  id: string
  atualizadoEm: string
}

export interface DestinatarioDisponivel {
  usuarioId: string
  nome: string
  email: string
  telegram: boolean
  discord: boolean
}

/** Padrões da spec (seção 2). */
export const PADROES_REGRA = { taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 }

const RE_DECIMAL = /^\d{1,3}([.,]\d{1,2})?$/

function textoLimpo(v: string | number | null | undefined): string {
  return String(v ?? '').trim()
}

/** Número inteiro ou null (vazio). NaN quando o texto não é número. */
function inteiro(v: string | number | null | undefined): number | null {
  const s = textoLimpo(v).replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isInteger(n) ? n : Number.NaN
}

function unicos(lista: string[]): string[] {
  return [...new Set(lista.map((x) => x.trim()).filter((x) => x !== ''))]
}

export function validarRegra(e: EntradaRegra): { ok: true; valor: RegraValida } | { ok: false; erro: string } {
  const nome = textoLimpo(e.nome).replace(/\s+/g, ' ')
  if (nome === '') return { ok: false, erro: 'Informe o nome da regra.' }

  const postos = unicos(e.postos)
  if (postos.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 posto.' }

  const taxaTexto = textoLimpo(e.taxaMinima)
  const taxa = Number(taxaTexto.replace(',', '.'))
  if (taxaTexto === '' || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
    return { ok: false, erro: 'A taxa mínima deve ficar entre 0 e 100.' }
  }
  // Conferido no TEXTO: em ponto flutuante 90,125 "arredonda" e passaria escondido.
  if (!RE_DECIMAL.test(taxaTexto)) return { ok: false, erro: 'A taxa mínima aceita até 2 casas decimais.' }

  if (!ehJanelaTipo(e.janelaTipo)) return { ok: false, erro: 'Escolha a janela da regra.' }
  const janelaTipo: JanelaTipo = e.janelaTipo

  let janelaValor: number | null = null
  if (janelaTipo !== 'op') {
    const v = inteiro(e.janelaValor)
    if (v === null || Number.isNaN(v) || v <= 0) {
      return {
        ok: false,
        erro: janelaTipo === 'tempo' ? 'Informe quantos minutos a janela olha.' : 'Informe quantos bipes a janela olha.',
      }
    }
    janelaValor = v
  }

  const minimoBipes = inteiro(e.minimoBipes)
  if (minimoBipes === null || Number.isNaN(minimoBipes) || minimoBipes <= 0) {
    return { ok: false, erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.' }
  }
  // Janela de 10 bipes com mínimo de 20 NUNCA decidiria nada — melhor recusar do que ficar muda.
  if (janelaTipo === 'bipes' && janelaValor !== null && janelaValor < minimoBipes) {
    return { ok: false, erro: 'A janela de bipes precisa ser maior ou igual ao mínimo de bipes.' }
  }

  const lembrete = inteiro(e.lembreteMin)
  if (lembrete !== null && (Number.isNaN(lembrete) || lembrete <= 0)) {
    return { ok: false, erro: 'O lembrete deve ser um número inteiro de minutos (ou vazio).' }
  }

  const canais = CANAIS.filter((c) => e.canais.includes(c))
  if (canais.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 canal.' }

  const destinatarios = unicos(e.destinatarios)
  if (destinatarios.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 destinatário.' }

  return {
    ok: true,
    valor: {
      nome,
      postos,
      taxaMinima: taxa,
      janelaTipo,
      janelaValor,
      minimoBipes,
      lembreteMin: lembrete,
      canais: [...canais],
      destinatarios,
      ativa: e.ativa,
    },
  }
}

/** A prévia só precisa de postos + janela + mínimo (nome/canais/destinatários ainda podem faltar). */
export function validarPrevia(e: {
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
}):
  | { ok: true; valor: { postos: string[]; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number } }
  | { ok: false; erro: string } {
  const r = validarRegra({
    nome: 'previa',
    postos: e.postos,
    taxaMinima: 100,
    janelaTipo: e.janelaTipo,
    janelaValor: e.janelaValor,
    minimoBipes: e.minimoBipes,
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['previa'],
    ativa: true,
  })
  if (!r.ok) return r
  return {
    ok: true,
    valor: {
      postos: r.valor.postos,
      janelaTipo: r.valor.janelaTipo,
      janelaValor: r.valor.janelaValor,
      minimoBipes: r.valor.minimoBipes,
    },
  }
}

/** Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado. */
export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !d[c]).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/regra.test.ts
```
Expected: PASS — `Tests 15 passed`.

- [ ] **Step 5: Escrever o teste do período das ocorrências (falhando)**

Criar `src/modules/alertas/domain/__tests__/ocorrencia.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dataIsoSaoPaulo, filtroOcorrenciasPadrao, periodoOcorrencias } from '../ocorrencia'

describe('dataIsoSaoPaulo', () => {
  it('usa o dia do fuso de São Paulo, não o do UTC', () => {
    // 02:00Z de 18/09 ainda é 23:00 de 17/09 em São Paulo
    expect(dataIsoSaoPaulo(new Date('2026-09-18T02:00:00Z'))).toBe('2026-09-17')
  })
})

describe('periodoOcorrencias', () => {
  it('abre o dia inicial e fecha o dia final no fuso de São Paulo', () => {
    expect(periodoOcorrencias('2026-09-11', '2026-09-17')).toEqual({
      de: '2026-09-11T00:00:00-03:00',
      ate: '2026-09-17T23:59:59.999-03:00',
    })
  })
  it('recusa data fora de formato ou período invertido', () => {
    expect(periodoOcorrencias('11/09/2026', '2026-09-17')).toBeNull()
    expect(periodoOcorrencias('2026-09-17', '2026-09-11')).toBeNull()
  })
})

describe('filtroOcorrenciasPadrao', () => {
  it('últimos 7 dias, todos os estados', () => {
    expect(filtroOcorrenciasPadrao(new Date('2026-09-17T12:00:00Z'))).toEqual({
      de: '2026-09-11',
      ate: '2026-09-17',
      estado: '',
    })
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/ocorrencia.test.ts
```
Expected: FAIL com `Failed to load url ../ocorrencia`.

- [ ] **Step 7: Implementar o domínio das ocorrências e o tipo `ContaVinculada`**

Criar `src/modules/alertas/domain/ocorrencia.ts`:

```ts
import type { EstadoOcorrencia } from './tipos'

/** Uma linha da prévia do formulário (taxa de agora, sem gravar nada). */
export interface PreviaPosto {
  posto: string
  aprovados: number
  reprovados: number
  taxa: number | null
  avaliavel: boolean
  pmo: string | null
  op: string | null
}

export interface FiltroOcorrencias {
  /** 'YYYY-MM-DD' */
  de: string
  /** 'YYYY-MM-DD' */
  ate: string
  /** '' = todos os estados */
  estado: '' | EstadoOcorrencia
}

export interface OcorrenciaLinha {
  id: string
  regraId: string
  regraNome: string
  posto: string
  pmo: string | null
  op: string | null
  estado: EstadoOcorrencia
  taxaAbertura: number
  taxaUltima: number
  aprovados: number
  reprovados: number
  abertaEm: string
  resolvidaPorNome: string
  resolvidaEm: string | null
  normalizadaEm: string | null
  enviosOk: number
  enviosFalha: number
}

const FUSO = 'America/Sao_Paulo'
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** Dia 'YYYY-MM-DD' no fuso da fábrica (o servidor roda em UTC). */
export function dataIsoSaoPaulo(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

/**
 * Converte os dois dias do filtro no intervalo que o banco recebe. O deslocamento é fixo em -03:00:
 * o Brasil não tem horário de verão desde 2019.
 */
export function periodoOcorrencias(de: string, ate: string): { de: string; ate: string } | null {
  if (!RE_DIA.test(de) || !RE_DIA.test(ate) || de > ate) return null
  return { de: `${de}T00:00:00-03:00`, ate: `${ate}T23:59:59.999-03:00` }
}

/** Filtro inicial da aba Ocorrências: os últimos 7 dias. */
export function filtroOcorrenciasPadrao(hoje: Date): FiltroOcorrencias {
  const seteDias = new Date(hoje.getTime() - 6 * 24 * 60 * 60 * 1000)
  return { de: dataIsoSaoPaulo(seteDias), ate: dataIsoSaoPaulo(hoje), estado: '' }
}
```

Em `src/modules/alertas/domain/tipos.ts`, **acrescentar ao final**:

```ts
/** Vínculo do usuário logado num canal (o que a tela Meu perfil mostra). */
export interface ContaVinculada {
  canal: Canal
  vinculadoEm: string
}
```

- [ ] **Step 8: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas/domain/__tests__/ocorrencia.test.ts
```
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 9: Implementar os repositórios**

Criar `src/modules/alertas/infra/regras-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, ehJanelaTipo, type EstadoOcorrencia } from '../domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta, RegraValida } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { periodoOcorrencias } from '../domain/ocorrencia'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type { ResultadoResolver } from '../application/portas'

const CAMPOS_REGRA =
  'id, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais, destinatarios, ativa, atualizado_em'

interface LinhaRegra {
  id: string
  nome: string
  postos: string[] | null
  taxa_minima: number | string
  janela_tipo: string
  janela_valor: number | null
  minimo_bipes: number
  lembrete_min: number | null
  canais: string[] | null
  destinatarios: string[] | null
  ativa: boolean
  atualizado_em: string
}

/** RLS nega em vez de esconder em algumas operações; 42501 é justamente "sem permissão". */
function erroDeBanco(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Você não tem permissão para configurar alertas.'
  return mensagemErroAlerta(error.message)
}

function paraRegra(l: LinhaRegra): RegraAlerta {
  return {
    id: l.id,
    nome: l.nome,
    postos: l.postos ?? [],
    taxaMinima: Number(l.taxa_minima),
    janelaTipo: ehJanelaTipo(l.janela_tipo) ? l.janela_tipo : 'tempo',
    janelaValor: l.janela_valor,
    minimoBipes: l.minimo_bipes,
    lembreteMin: l.lembrete_min,
    canais: (l.canais ?? []).filter(ehCanal),
    destinatarios: l.destinatarios ?? [],
    ativa: l.ativa,
    atualizadoEm: l.atualizado_em,
  }
}

function paraLinha(r: RegraValida): Record<string, unknown> {
  return {
    nome: r.nome,
    postos: r.postos,
    taxa_minima: r.taxaMinima,
    janela_tipo: r.janelaTipo,
    janela_valor: r.janelaValor,
    minimo_bipes: r.minimoBipes,
    lembrete_min: r.lembreteMin,
    canais: r.canais,
    destinatarios: r.destinatarios,
    ativa: r.ativa,
  }
}

export async function listarRegras(): Promise<RegraAlerta[]> {
  const sb = await createServerSupabase()
  // Regra excluída (exclusão lógica) some da lista; as ocorrências dela continuam na aba Ocorrências.
  const { data, error } = await sb
    .from('alerta_regras')
    .select(CAMPOS_REGRA)
    .is('excluida_em', null)
    .order('nome')
  if (error) throw error
  return ((data ?? []) as unknown as LinhaRegra[]).map(paraRegra)
}

export async function inserirRegra(r: RegraValida): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_regras').insert(paraLinha(r)).select('id').single()
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true, id: (data as { id: string }).id }
}

export async function atualizarRegra(
  id: string,
  r: RegraValida,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { error } = await sb
    .from('alerta_regras')
    .update({ ...paraLinha(r), atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true }
}

/**
 * Exclusão LÓGICA: a regra some da lista e para de alertar, mas o histórico (ocorrências e envios)
 * continua. Não existe delete físico — a 0113 nem tem policy de DELETE, e a FK das ocorrências é
 * `restrict`. As ocorrências vivas dessa regra são encerradas SEM envio na próxima avaliação (o
 * mesmo caminho de "desativar"), que também tira o botão "Resolvido" das mensagens delas.
 */
export async function excluirRegra(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const agora = new Date().toISOString()
  const { error } = await sb
    .from('alerta_regras')
    .update({ excluida_em: agora, ativa: false, atualizado_em: agora })
    .eq('id', id)
    .is('excluida_em', null)
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true }
}

export async function definirRegraAtiva(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { error } = await sb
    .from('alerta_regras')
    .update({ ativa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true }
}

export async function previaRegra(p: {
  postos: string[]
  janelaTipo: string
  janelaValor: number | null
  minimoBipes: number
}): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_previa', {
    p_postos: p.postos,
    p_janela_tipo: p.janelaTipo,
    p_janela_valor: p.janelaValor,
    p_minimo: p.minimoBipes,
  })
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const linhas = (data ?? []) as {
    posto: string
    aprovados: number
    reprovados: number
    taxa: number | string | null
    avaliavel: boolean
    pmo: string | null
    op: string | null
  }[]
  return {
    ok: true,
    postos: linhas.map((l) => ({
      posto: l.posto,
      aprovados: l.aprovados,
      reprovados: l.reprovados,
      taxa: l.taxa === null ? null : Number(l.taxa),
      avaliavel: l.avaliavel,
      pmo: l.pmo,
      op: l.op,
    })),
  }
}

export async function listarDestinatarios(): Promise<DestinatarioDisponivel[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_destinatarios')
  if (error) throw error
  return ((data ?? []) as {
    usuario_id: string
    nome: string
    email: string
    telegram: boolean
    discord: boolean
  }[]).map((l) => ({
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    telegram: l.telegram,
    discord: l.discord,
  }))
}

export async function listarOcorrencias(f: FiltroOcorrencias): Promise<OcorrenciaLinha[]> {
  const periodo = periodoOcorrencias(f.de, f.ate)
  if (!periodo) return []
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_listar_ocorrencias', {
    p_de: periodo.de,
    p_ate: periodo.ate,
    p_estado: f.estado,
  })
  if (error) throw error
  return ((data ?? []) as {
    id: string
    regra_id: string
    regra_nome: string
    posto: string
    pmo: string | null
    op: string | null
    estado: string
    taxa_abertura: number | string
    taxa_ultima: number | string
    aprovados: number
    reprovados: number
    aberta_em: string
    resolvida_por_nome: string | null
    resolvida_em: string | null
    normalizada_em: string | null
    envios_ok: number
    envios_falha: number
  }[]).map((l) => ({
    id: l.id,
    regraId: l.regra_id,
    regraNome: l.regra_nome,
    posto: l.posto,
    pmo: l.pmo,
    op: l.op,
    estado: (l.estado === 'resolvida' || l.estado === 'normalizada' ? l.estado : 'aberta') as EstadoOcorrencia,
    taxaAbertura: Number(l.taxa_abertura),
    taxaUltima: Number(l.taxa_ultima),
    aprovados: l.aprovados,
    reprovados: l.reprovados,
    abertaEm: l.aberta_em,
    resolvidaPorNome: l.resolvida_por_nome ?? '',
    resolvidaEm: l.resolvida_em,
    normalizadaEm: l.normalizada_em,
    enviosOk: l.envios_ok,
    enviosFalha: l.envios_falha,
  }))
}

/** Resolver pela TELA (gestor). Quem resolve pelo botão da mensagem passa por alerta_resolver. */
export async function resolverOcorrenciaComoAdmin(id: string): Promise<ResultadoResolver> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_resolver_admin', { p_ocorrencia_id: id })
  if (error) {
    return { ok: false, codigo: codigoErroAlerta(error.message), erro: mensagemErroAlerta(error.message) }
  }
  return { ok: true, resolucao: lerResolucao(data) }
}
```

Criar `src/modules/alertas/infra/contas-repository.ts`:

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, type Canal, type ContaVinculada } from '../domain/tipos'
import { mensagemErroAlerta } from '../domain/erros'

/** Código de vínculo do usuário logado (a função invalida os anteriores não usados). */
export async function gerarCodigoVinculo(): Promise<
  { ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }
> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_gerar_codigo')
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const r = (data ?? {}) as { codigo?: string; expira_em?: string }
  if (!r.codigo || !r.expira_em) return { ok: false, erro: mensagemErroAlerta(null) }
  return { ok: true, codigo: r.codigo, expiraEm: r.expira_em }
}

/** A RLS já limita às linhas do próprio usuário. */
export async function listarMinhasContas(): Promise<ContaVinculada[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_contas').select('canal, vinculado_em').order('canal')
  if (error) throw error
  const saida: ContaVinculada[] = []
  for (const l of (data ?? []) as { canal: string; vinculado_em: string }[]) {
    if (!ehCanal(l.canal)) continue
    saida.push({ canal: l.canal, vinculadoEm: l.vinculado_em })
  }
  return saida
}

export async function desvincularConta(canal: Canal): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('alerta_contas').delete().eq('canal', canal)
  if (error) throw error
}
```

- [ ] **Step 10: Implementar as server actions**

Criar `src/modules/alertas/application/alertas-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarPrevia, validarRegra, type EntradaRegra } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { resumoJanela } from '../domain/janela'
import {
  atualizarRegra,
  definirRegraAtiva,
  excluirRegra,
  inserirRegra,
  listarOcorrencias,
  previaRegra,
  resolverOcorrenciaComoAdmin,
} from '../infra/regras-repository'
import { criarDependenciasAlertas } from '../infra/fabrica'
import { avaliarEEnviar, entregarPendentes, removerBotoesDaOcorrencia, type ResumoAvaliacao } from './enviar-alertas'

const SEM_PERMISSAO = 'Você não tem permissão para configurar alertas.'
const ROTA = '/configuracoes/sf-alertas'

async function gestor(): Promise<{ usuarioId: string } | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return null
  return { usuarioId: sessao.usuarioId }
}

export async function salvarRegraAction(
  id: string | null,
  entrada: EntradaRegra,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }

  const v = validarRegra(entrada)
  if (!v.ok) return { ok: false, erro: v.erro }

  if (id) {
    const r = await atualizarRegra(id, v.valor)
    if (!r.ok) return { ok: false, erro: r.erro }
    await registrarLog({
      entidade: 'alerta_regra',
      entidadeId: id,
      acao: 'alterar_campo',
      descricao: `Regra de alerta "${v.valor.nome}" alterada`,
      dados: v.valor,
    })
    revalidatePath(ROTA)
    return { ok: true, id }
  }

  const r = await inserirRegra(v.valor)
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarLog({
    entidade: 'alerta_regra',
    entidadeId: r.id,
    acao: 'criar',
    descricao: `Regra de alerta "${v.valor.nome}" criada (${v.valor.postos.join(', ')}, ${resumoJanela(v.valor)})`,
    dados: v.valor,
  })
  revalidatePath(ROTA)
  return { ok: true, id: r.id }
}

export async function excluirRegraAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }
  const r = await excluirRegra(id)
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarLog({
    entidade: 'alerta_regra',
    entidadeId: id,
    acao: 'excluir',
    descricao: 'Regra de alerta excluída (exclusão lógica — o histórico de ocorrências continua)',
  })
  revalidatePath(ROTA)
  return { ok: true }
}

export async function alternarRegraAtivaAction(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }
  const r = await definirRegraAtiva(id, ativa)
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarLog({
    entidade: 'alerta_regra',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Regra de alerta ${ativa ? 'ativada' : 'desativada'}`,
    dados: { ativa },
  })
  revalidatePath(ROTA)
  return { ok: true }
}

export async function previaRegraAction(entrada: {
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
}): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }
  const v = validarPrevia(entrada)
  if (!v.ok) return { ok: false, erro: v.erro }
  return previaRegra(v.valor)
}

export async function listarOcorrenciasAction(
  filtro: FiltroOcorrencias,
): Promise<{ ok: true; ocorrencias: OcorrenciaLinha[] } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, ocorrencias: await listarOcorrencias(filtro) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as ocorrências agora.' }
  }
}

export async function resolverOcorrenciaAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }

  // alerta_resolver_admin resolve E enfileira o "✅ resolvido por" para os destinatários (menos
  // quem resolveu), na mesma transação.
  const r = await resolverOcorrenciaComoAdmin(id)
  if (!r.ok) return { ok: false, erro: r.erro }

  // Tira o botão das mensagens já entregues e adianta a entrega do aviso que está na fila. Falha
  // aqui NÃO desfaz a resolução e não perde o aviso: o cron entrega na próxima rodada.
  try {
    const { portas, repo } = criarDependenciasAlertas()
    await removerBotoesDaOcorrencia(portas, repo, id)
    if (!r.resolucao.jaResolvida) await entregarPendentes(portas, repo, { ocorrenciaId: id })
  } catch (e) {
    console.error('[alertas] avisar resolução pela tela:', e instanceof Error ? e.message : e)
  }

  await registrarLog({
    entidade: 'alerta_ocorrencia',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Ocorrência de alerta (${r.resolucao.posto}) marcada como resolvida`,
  })
  revalidatePath(ROTA)
  return { ok: true }
}

/**
 * "Avaliar agora": a mesma lógica do cron, para testar sem esperar os 5 minutos.
 * Rodar junto com o cron é seguro: a avaliação tem trava (a segunda volta `ocupado`) e a ENTREGA
 * sai da fila por reserva atômica (`alerta_reservar_envios`, `for update skip locked` + reserva de
 * 15 min) — duas rodadas nunca pegam a mesma linha, então não há envio em dobro.
 */
export async function avaliarAgoraAction(): Promise<
  { ok: true; resumo: ResumoAvaliacao } | { ok: false; erro: string }
> {
  if (!(await gestor())) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resumo = await avaliarEEnviar(portas, repo)
    revalidatePath(ROTA)
    return { ok: true, resumo }
  } catch (e) {
    console.error('[alertas] avaliar agora:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível avaliar agora (banco indisponível?).' }
  }
}
```

Criar `src/modules/alertas/application/perfil-alertas-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { ehCanal, type ContaVinculada } from '../domain/tipos'
import { gerarCodigoVinculo, listarMinhasContas, desvincularConta } from '../infra/contas-repository'
import { criarDependenciasAlertas } from '../infra/fabrica'
import { enviarTeste } from './enviar-alertas'

const SEM_SESSAO = 'Sessão inválida. Entre de novo no sistema.'
const ROTA = '/perfil'

export async function gerarCodigoAction(): Promise<
  { ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  return gerarCodigoVinculo()
}

/** A tela consulta isso a cada 3 s enquanto o código está aberto. */
export async function minhasContasAction(): Promise<
  { ok: true; contas: ContaVinculada[] } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  try {
    return { ok: true, contas: await listarMinhasContas() }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar os vínculos agora.' }
  }
}

export async function desvincularAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  if (!ehCanal(canal)) return { ok: false, erro: 'Canal inválido.' }
  try {
    await desvincularConta(canal)
  } catch {
    return { ok: false, erro: 'Não foi possível desvincular agora.' }
  }
  revalidatePath(ROTA)
  return { ok: true }
}

/**
 * Entrega DIRETA, fora da fila: a pessoa precisa ver o resultado na hora, e teste que falhou não é
 * reenviado. `enviarTeste` grava a linha já final em alerta_envios (tipo 'teste', tentativas 1).
 */
export async function enviarTesteAction(canal: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao) return { ok: false, erro: SEM_SESSAO }
  if (!ehCanal(canal)) return { ok: false, erro: 'Canal inválido.' }
  try {
    const { portas, repo } = criarDependenciasAlertas()
    return await enviarTeste(portas, repo, {
      usuarioId: sessao.usuarioId,
      canal,
      nome: sessao.nome || sessao.email,
    })
  } catch (e) {
    console.error('[alertas] enviar teste:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível enviar o teste agora.' }
  }
}
```

- [ ] **Step 11: Rodar tudo, tipos e lint**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run src/modules/alertas && npx tsc --noEmit && npm run lint
```
Expected: `Test Files 16 passed`; `tsc` sem saída; lint sem avisos.

- [ ] **Step 12: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add src/modules/alertas
git commit -m "$(cat <<'MSG'
feat(alertas): validação da regra, repositórios e server actions

validarRegra/validarPrevia (padrões 90% · 60 min · 50 bipes · mínimo 20),
aviso de destinatário sem canal, filtro de ocorrências no fuso da fábrica,
repositórios pela sessão (RLS) e actions de regras (excluir = exclusão
lógica), prévia, ocorrências, resolver pela tela (entrega o aviso da fila),
avaliar agora, código de vínculo, desvincular e teste (entrega direta).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Tela "Meu perfil" com o cartão Alertas + link no cabeçalho

**Files:**
- Create: `src/app/(app)/perfil/page.tsx`
- Create: `src/app/(app)/perfil/cartao-alertas.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (link "Meu perfil" no cabeçalho e no rodapé do menu; título da página)
- Test: `src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1/7: `CANAIS`, `NOME_CANAL`, `Canal`, `ContaVinculada` (`@/modules/alertas/domain/tipos`).
  - Task 7: `gerarCodigoAction`, `minhasContasAction`, `desvincularAction`, `enviarTesteAction` (`@/modules/alertas/application/perfil-alertas-actions`).
  - Task 5: `canaisConfigurados` (`@/modules/alertas/infra/canais`); Task 7: `listarMinhasContas` (`@/modules/alertas/infra/contas-repository`).
  - Projeto: `getSessao`, `Button`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `useConfirmacao`, `toast` do `sonner`.
- Produces:
  - Rota `/perfil` (qualquer usuário logado).
  - `CartaoAlertas(props: { nome: string; contas: ContaVinculada[]; configurados: Record<Canal, boolean>; telegramBot: string })` — client component.
  - Item de navegação: `PERFIL` no `app-shell` (`href: '/perfil'`, rótulo `Meu perfil`).

- [ ] **Step 1: Escrever o teste do cartão (falhando)**

Criar `src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CartaoAlertas } from '../cartao-alertas'

const gerarCodigoAction = vi.fn()
const minhasContasAction = vi.fn()
const desvincularAction = vi.fn()
const enviarTesteAction = vi.fn()

vi.mock('@/modules/alertas/application/perfil-alertas-actions', () => ({
  gerarCodigoAction: (...a: unknown[]) => gerarCodigoAction(...a),
  minhasContasAction: (...a: unknown[]) => minhasContasAction(...a),
  desvincularAction: (...a: unknown[]) => desvincularAction(...a),
  enviarTesteAction: (...a: unknown[]) => enviarTesteAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) } }))

beforeEach(() => {
  vi.clearAllMocks()
  minhasContasAction.mockResolvedValue({ ok: true, contas: [] })
  gerarCodigoAction.mockResolvedValue({
    ok: true,
    codigo: 'ALERTA-7K3M',
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
  })
  enviarTesteAction.mockResolvedValue({ ok: true })
})

const TODOS_CONFIGURADOS = { telegram: true, discord: true }

describe('CartaoAlertas', () => {
  it('canal sem token aparece como não configurado', () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[]}
        configurados={{ telegram: true, discord: false }}
        telegramBot="shopfloor_bot"
      />,
    )
    expect(screen.getByText('Não configurado neste ambiente')).toBeInTheDocument()
    const botoes = screen.getAllByRole('button', { name: 'Vincular' })
    expect(botoes).toHaveLength(2) // Telegram e Discord
    expect(botoes[1]).toBeDisabled() // Discord sem token
  })

  it('canal vinculado mostra a data e as ações', () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[{ canal: 'telegram', vinculadoEm: '2026-09-16T12:00:00Z' }]}
        configurados={TODOS_CONFIGURADOS}
        telegramBot="shopfloor_bot"
      />,
    )
    expect(screen.getByText('Vinculado em 16/09')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar teste' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desvincular' })).toBeInTheDocument()
  })

  it('Vincular mostra o código e a instrução do bot', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByText(/t\.me\/shopfloor_bot/)).toBeInTheDocument()
  })

  it('Vincular no Discord instrui o comando /vincular', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    expect(await screen.findByText(/\/vincular ALERTA-7K3M/)).toBeInTheDocument()
  })

  it('Enviar teste avisa sucesso', async () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[{ canal: 'telegram', vinculadoEm: '2026-09-16T12:00:00Z' }]}
        configurados={TODOS_CONFIGURADOS}
        telegramBot="shopfloor_bot"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enviar teste' }))
    await waitFor(() => expect(enviarTesteAction).toHaveBeenCalledWith('telegram'))
    await waitFor(() => expect(toastSucesso).toHaveBeenCalled())
  })

  it('erro ao gerar o código vira toast de erro', async () => {
    gerarCodigoAction.mockResolvedValueOnce({ ok: false, erro: 'Sessão inválida. Entre de novo no sistema.' })
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Sessão inválida. Entre de novo no sistema.', {
      position: 'bottom-center',
    }))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run "src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx"
```
Expected: FAIL com `Failed to load url ../cartao-alertas`.

- [ ] **Step 3: Implementar o cartão Alertas**

Criar `src/app/(app)/perfil/cartao-alertas.tsx`:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { BellRing, RefreshCw, Send, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { CANAIS, NOME_CANAL, type Canal, type ContaVinculada } from '@/modules/alertas/domain/tipos'
import {
  desvincularAction,
  enviarTesteAction,
  gerarCodigoAction,
  minhasContasAction,
} from '@/modules/alertas/application/perfil-alertas-actions'

const INTERVALO_CONSULTA_MS = 3000
const TOAST = { position: 'bottom-center' } as const

function dataCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}

function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface CodigoAberto {
  canal: Canal
  codigo: string
  expiraEm: string
}

export function CartaoAlertas({
  nome,
  contas,
  configurados,
  telegramBot,
}: {
  nome: string
  contas: ContaVinculada[]
  configurados: Record<Canal, boolean>
  telegramBot: string
}) {
  const [lista, setLista] = useState<ContaVinculada[]>(contas)
  const [codigo, setCodigo] = useState<CodigoAberto | null>(null)
  const [restante, setRestante] = useState(0)
  const [pendente, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  // Enquanto o código está na tela: conta o tempo e pergunta ao servidor se o vínculo chegou.
  useEffect(() => {
    if (!codigo) return
    const alvo = new Date(codigo.expiraEm).getTime()
    const faltam = () => Math.max(0, Math.round((alvo - Date.now()) / 1000))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestante(faltam())
    const tique = setInterval(() => setRestante(faltam()), 1000)
    const consulta = setInterval(async () => {
      const r = await minhasContasAction()
      if (!r.ok) return
      setLista(r.contas)
      if (r.contas.some((c) => c.canal === codigo.canal)) {
        setCodigo(null)
        toast.success(`✅ ${NOME_CANAL[codigo.canal]} vinculado`, TOAST)
      }
    }, INTERVALO_CONSULTA_MS)
    return () => {
      clearInterval(tique)
      clearInterval(consulta)
    }
  }, [codigo])

  function vincular(canal: Canal) {
    startTransition(async () => {
      const r = await gerarCodigoAction()
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setCodigo({ canal, codigo: r.codigo, expiraEm: r.expiraEm })
    })
  }

  function testar(canal: Canal) {
    startTransition(async () => {
      const r = await enviarTesteAction(canal)
      if (r.ok) toast.success(`Mensagem de teste enviada no ${NOME_CANAL[canal]}`, TOAST)
      else toast.error(r.erro, TOAST)
    })
  }

  async function desvincular(canal: Canal) {
    const ok = await confirmar({
      titulo: `Desvincular o ${NOME_CANAL[canal]}?`,
      descricao: 'Você deixa de receber os alertas por esse canal até vincular de novo.',
      rotuloConfirmar: 'Desvincular',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await desvincularAction(canal)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setLista((atual) => atual.filter((c) => c.canal !== canal))
      toast.success(`${NOME_CANAL[canal]} desvinculado`, TOAST)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-[18px]" /> Alertas
        </CardTitle>
        <CardDescription>
          Vincule seu Telegram e/ou Discord para receber os alertas de taxa de aprovação dos postos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {CANAIS.map((canal) => {
          const conta = lista.find((c) => c.canal === canal) ?? null
          const aberto = codigo?.canal === canal ? codigo : null
          return (
            <div key={canal} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">{NOME_CANAL[canal]}</span>
                  {!configurados[canal] && (
                    <span className="text-xs text-muted-foreground">Não configurado neste ambiente</span>
                  )}
                  {configurados[canal] && conta && (
                    <span className="text-xs text-muted-foreground">Vinculado em {dataCurta(conta.vinculadoEm)}</span>
                  )}
                  {configurados[canal] && !conta && (
                    <span className="text-xs text-muted-foreground">Não vinculado</span>
                  )}
                </div>

                <div className="flex gap-2">
                  {conta ? (
                    <>
                      <Button variant="outline" size="sm" disabled={pendente || !configurados[canal]} onClick={() => testar(canal)}>
                        <Send /> Enviar teste
                      </Button>
                      <Button variant="destructive" size="sm" disabled={pendente} onClick={() => desvincular(canal)}>
                        <Unlink /> Desvincular
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pendente || !configurados[canal]}
                      onClick={() => vincular(canal)}
                    >
                      {aberto ? <RefreshCw /> : null} Vincular
                    </Button>
                  )}
                </div>
              </div>

              {aberto && (
                <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                  <p className="text-center font-mono text-2xl font-semibold tracking-widest">{aberto.codigo}</p>
                  <p className="text-center text-xs text-muted-foreground">
                    {restante > 0 ? `Vale por ${relogio(restante)}` : 'Código expirado — gere outro'}
                  </p>
                  {canal === 'telegram' ? (
                    <p className="text-sm text-muted-foreground">
                      Abra <span className="font-medium">t.me/{telegramBot || 'seu_bot'}</span>, toque em Iniciar e
                      envie o código acima.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No servidor da Enterplak, digite{' '}
                      <span className="font-medium">/vincular {aberto.codigo}</span>.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {nome}, esta tela confirma sozinha quando o vínculo chegar.
                  </p>
                </div>
              )}
            </div>
          )
        })}
        {dialog}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run "src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx"
```
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Criar a página `/perfil`**

Criar `src/app/(app)/perfil/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import { listarMinhasContas } from '@/modules/alertas/infra/contas-repository'
import { CartaoAlertas } from './cartao-alertas'

/** Meu perfil: qualquer usuário logado. Por enquanto só o cartão de Alertas mora aqui. */
export default async function PerfilPage() {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  const contas = await listarMinhasContas()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{sessao.nome || sessao.email}</h2>
        <p className="text-sm text-muted-foreground">
          {sessao.email} · {sessao.perfil.nome}
        </p>
      </div>

      <CartaoAlertas
        nome={sessao.nome || sessao.email}
        contas={contas}
        configurados={canaisConfigurados()}
        telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? ''}
      />
    </div>
  )
}
```

- [ ] **Step 6: Pôr o link "Meu perfil" no cabeçalho e no rodapé do menu**

Em `src/shared/ui/app-shell.tsx`:

1. No import de `lucide-react`, **acrescentar** `UserRound,` na lista de ícones (por exemplo depois de `Users,`).

2. Depois da constante `AJUDA`, **acrescentar**:

```ts
// Meu perfil não entra no menu lateral: o acesso é pelo nome do usuário (cabeçalho e rodapé do
// menu). Fica aqui só para o cabeçalho da página achar o rótulo.
const PERFIL: Folha = { chave: 'perfil', rotulo: 'Meu perfil', href: '/perfil', icone: UserRound, perm: 'visualizar' }
```

3. **Trocar** o cálculo do título:

```ts
  const tituloPagina =
    [HOME, ...RECEBIMENTO, ...SHOPFLOOR, ...CONFIG_TODOS, AJUDA]
```

por:

```ts
  const tituloPagina =
    [HOME, ...RECEBIMENTO, ...SHOPFLOOR, ...CONFIG_TODOS, AJUDA, PERFIL]
```

4. No rodapé do menu, **trocar**:

```tsx
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {iniciais(nome || email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{nome || email}</p>
            <p className="truncate text-xs text-muted-foreground">{perfilNome}</p>
          </div>
          <form action={sair}>
```

por:

```tsx
        <div className="flex items-center gap-3 px-1 py-1">
          <Link
            href={PERFIL.href}
            onClick={fechaMobile}
            title="Meu perfil"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 transition-colors hover:bg-accent"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {iniciais(nome || email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{nome || email}</p>
              <p className="truncate text-xs text-muted-foreground">{perfilNome}</p>
            </div>
          </Link>
          <form action={sair}>
```

5. No cabeçalho, **trocar**:

```tsx
          <h1 className="text-[15px] font-semibold text-foreground">{tituloPagina}</h1>
          {kioskLigado && (
```

por:

```tsx
          <h1 className="text-[15px] font-semibold text-foreground">{tituloPagina}</h1>
          {!kioskLigado && (
            <Link
              href={PERFIL.href}
              title="Meu perfil"
              className="ml-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                {iniciais(nome || email)}
              </div>
              <span className="hidden max-w-40 truncate sm:inline">{nome || email}</span>
            </Link>
          )}
          {kioskLigado && (
```

- [ ] **Step 7: Rodar tudo, tipos e lint**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: todos os testes do projeto passando (incluindo os 16 arquivos de alertas); `tsc` sem saída; lint sem avisos.

- [ ] **Step 8: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add "src/app/(app)/perfil" src/shared/ui/app-shell.tsx
git commit -m "$(cat <<'MSG'
feat(alertas): tela Meu perfil com vínculo de Telegram e Discord

Cartão Alertas: gera o código ALERTA-XXXX com contador de 15 min, confere o
vínculo a cada 3 s, mostra "Vinculado em dd/mm" com Enviar teste e Desvincular,
e desabilita o canal sem token no ambiente. Acesso pelo nome do usuário no
cabeçalho e no rodapé do menu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Tela Configurações › Ajustes ShopFloor › Alertas (Regras + Ocorrências)

**Files:**
- Create: `src/app/(app)/configuracoes/sf-alertas/page.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx`
- Modify: `src/shared/ui/app-shell.tsx` (item `Alertas` em `CONFIG_SHOPFLOOR`)
- Test: `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `salvarRegraAction`, `excluirRegraAction`, `alternarRegraAtivaAction`, `previaRegraAction`, `listarOcorrenciasAction`, `resolverOcorrenciaAction`, `avaliarAgoraAction` (`@/modules/alertas/application/alertas-actions`); `RegraAlerta`, `DestinatarioDisponivel`, `PADROES_REGRA`, `destinatariosSemCanal` (`@/modules/alertas/domain/regra`); `FiltroOcorrencias`, `OcorrenciaLinha`, `PreviaPosto`, `filtroOcorrenciasPadrao` (`@/modules/alertas/domain/ocorrencia`); `listarRegras`, `listarDestinatarios`, `listarOcorrencias` (`@/modules/alertas/infra/regras-repository`).
  - Task 1: `formatarTaxa`, `formatarMeta` (`@/modules/alertas/domain/taxa`); `resumoJanela` (`@/modules/alertas/domain/janela`); `CANAIS`, `NOME_CANAL`, `Canal` (`@/modules/alertas/domain/tipos`).
  - Task 5: `canaisConfigurados` (`@/modules/alertas/infra/canais`).
  - Projeto: `getSessao`, `podeNoModulo`, `SemPermissao` (`@/shared/ui/sem-permissao`), `listarPostos` (`@/modules/shopfloor/infra/postos-repository`), componentes de `@/components/ui` (`Button`, `Input`, `Label`, `Switch`, `Table*`, `Dialog*`, `Badge`, `useConfirmacao`), `toast` do `sonner`.
- Produces:
  - Rota `/configuracoes/sf-alertas` (`shopfloor.administrar`).
  - `RegraForm(props: { regra: RegraAlerta | null; postos: string[]; destinatarios: DestinatarioDisponivel[]; configurados: Record<Canal, boolean>; onSalvo: () => void; onCancelar: () => void })`
  - `RegraDialog(props: { aberto: boolean; regra: RegraAlerta | null; postos: string[]; destinatarios: DestinatarioDisponivel[]; configurados: Record<Canal, boolean>; onFechar: () => void })`
  - `RegrasLista`, `OcorrenciasLista`, `AlertasTela`
  - Item de menu `sf-alertas` em `CONFIG_SHOPFLOOR`.

- [ ] **Step 1: Escrever o teste do formulário da regra (falhando)**

Criar `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) },
}))

const POSTOS = ['Teste', 'Embalagem']
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
  { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
]
const CONFIGURADOS = { telegram: true, discord: true }

function montar(onSalvo = vi.fn()) {
  render(
    <RegraForm
      regra={null}
      postos={POSTOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
      onSalvo={onSalvo}
      onCancelar={vi.fn()}
    />,
  )
  return { onSalvo }
}

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
  previaRegraAction.mockResolvedValue({
    ok: true,
    postos: [{ posto: 'Teste', aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true, pmo: null, op: null }],
  })
})

describe('RegraForm', () => {
  it('começa com os padrões da spec', () => {
    montar()
    expect(screen.getByLabelText('Taxa mínima (%)')).toHaveValue('90')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('20')
  })

  it('salvar sem posto avisa e não chama a action', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Escolha pelo menos 1 posto.', { position: 'bottom-center' }))
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('avisa quem não recebe pelo canal escolhido', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Carla Operadora'))
    expect(screen.getByText('Carla Operadora sem Telegram')).toBeInTheDocument()
  })

  it('salva a regra com os valores digitados', async () => {
    const { onSalvo } = montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.change(screen.getByLabelText('Taxa mínima (%)'), { target: { value: '92,5' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction).toHaveBeenCalledWith(null, {
      nome: 'Teste 90',
      postos: ['Teste'],
      taxaMinima: '92,5',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      lembreteMin: '10',
      canais: ['telegram'],
      destinatarios: ['u1'],
      ativa: true,
    })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('janela por OP não manda valor de janela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'OP' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ janelaTipo: 'op', janelaValor: null })
  })

  it('prévia mostra a taxa de agora de cada posto', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    await waitFor(() => expect(previaRegraAction).toHaveBeenCalled())
    expect(await screen.findByText('Teste: 75,0% (15 aprovados, 5 reprovados)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run "src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx"
```
Expected: FAIL com `Failed to load url ../regra-form`.

- [ ] **Step 3: Implementar o formulário da regra**

Criar `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatarTaxa } from '@/modules/alertas/domain/taxa'
import { CANAIS, NOME_CANAL, type Canal } from '@/modules/alertas/domain/tipos'
import {
  PADROES_REGRA,
  destinatariosSemCanal,
  type DestinatarioDisponivel,
  type EntradaRegra,
  type RegraAlerta,
} from '@/modules/alertas/domain/regra'
import type { PreviaPosto } from '@/modules/alertas/domain/ocorrencia'
import { previaRegraAction, salvarRegraAction } from '@/modules/alertas/application/alertas-actions'

const TOAST = { position: 'bottom-center' } as const

function alterna<T>(lista: T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]
}

export function RegraForm({
  regra,
  postos,
  destinatarios,
  configurados,
  onSalvo,
  onCancelar,
}: {
  regra: RegraAlerta | null
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onSalvo: () => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(regra?.nome ?? '')
  const [postosSel, setPostosSel] = useState<string[]>(regra?.postos ?? [])
  const [taxa, setTaxa] = useState(String(regra?.taxaMinima ?? PADROES_REGRA.taxaMinima).replace('.', ','))
  const [janelaTipo, setJanelaTipo] = useState<'tempo' | 'bipes' | 'op'>(regra?.janelaTipo ?? 'tempo')
  const [minutos, setMinutos] = useState(
    String(
      regra?.janelaTipo === 'tempo' ? (regra.janelaValor ?? PADROES_REGRA.janelaTempo) : PADROES_REGRA.janelaTempo,
    ),
  )
  const [bipes, setBipes] = useState(
    String(
      regra?.janelaTipo === 'bipes' ? (regra.janelaValor ?? PADROES_REGRA.janelaBipes) : PADROES_REGRA.janelaBipes,
    ),
  )
  const [minimo, setMinimo] = useState(String(regra?.minimoBipes ?? PADROES_REGRA.minimoBipes))
  const [lembrete, setLembrete] = useState(regra?.lembreteMin === null || regra === null ? '' : String(regra.lembreteMin))
  const [canaisSel, setCanaisSel] = useState<Canal[]>(regra?.canais ?? [])
  const [destSel, setDestSel] = useState<string[]>(regra?.destinatarios ?? [])
  const [previa, setPrevia] = useState<PreviaPosto[] | null>(null)
  const [pendente, startTransition] = useTransition()

  const avisos = destinatariosSemCanal(destinatarios, destSel, canaisSel)

  function entrada(): EntradaRegra {
    return {
      nome,
      postos: postosSel,
      taxaMinima: taxa,
      janelaTipo,
      janelaValor: janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null,
      minimoBipes: minimo,
      lembreteMin: lembrete,
      canais: canaisSel,
      destinatarios: destSel,
      ativa: regra?.ativa ?? true,
    }
  }

  function salvar() {
    startTransition(async () => {
      const r = await salvarRegraAction(regra?.id ?? null, entrada())
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      toast.success(regra ? 'Regra alterada' : 'Regra criada', TOAST)
      onSalvo()
    })
  }

  function verPrevia() {
    startTransition(async () => {
      const r = await previaRegraAction({
        postos: postosSel,
        janelaTipo,
        janelaValor: janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null,
        minimoBipes: minimo,
      })
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      setPrevia(r.postos)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Teste abaixo de 90" autoComplete="off" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Postos</legend>
        <div className="flex flex-wrap gap-3">
          {postos.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`posto-${p}`}
                aria-label={p}
                checked={postosSel.includes(p)}
                onChange={() => setPostosSel((atual) => alterna(atual, p))}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="taxa">Taxa mínima (%)</Label>
          <Input id="taxa" value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="minimo">Mínimo de bipes</Label>
          <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Janela</legend>
        {/* Rádio e campo ficam FORA de um <label> comum de propósito: um label envolvendo dois
            controles deixa "Últimos minutos" ambíguo (para o leitor de tela e para o teste). */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="Janela por tempo"
            checked={janelaTipo === 'tempo'}
            onChange={() => setJanelaTipo('tempo')}
          />
          <span>Últimos</span>
          <Input
            aria-label="Últimos minutos"
            className="w-20"
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
            inputMode="numeric"
            disabled={janelaTipo !== 'tempo'}
          />
          <span>minutos</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="Janela por bipes"
            checked={janelaTipo === 'bipes'}
            onChange={() => setJanelaTipo('bipes')}
          />
          <span>Últimos</span>
          <Input
            aria-label="Quantidade de bipes"
            className="w-20"
            value={bipes}
            onChange={(e) => setBipes(e.target.value)}
            inputMode="numeric"
            disabled={janelaTipo !== 'bipes'}
          />
          <span>bipes</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="janela"
            aria-label="OP em andamento"
            checked={janelaTipo === 'op'}
            onChange={() => setJanelaTipo('op')}
          />
          OP em andamento
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="lembrete">Lembrar a cada (min)</Label>
        <Input
          id="lembrete"
          value={lembrete}
          onChange={(e) => setLembrete(e.target.value)}
          inputMode="numeric"
          placeholder="vazio = sem lembrete"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Canais</legend>
        <div className="flex gap-4">
          {CANAIS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={NOME_CANAL[c]}
                checked={canaisSel.includes(c)}
                onChange={() => setCanaisSel((atual) => alterna(atual, c))}
              />
              {NOME_CANAL[c]}
              {!configurados[c] && <span className="text-xs text-muted-foreground">(não configurado)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Destinatários</legend>
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {destinatarios.map((d) => (
            <label key={d.usuarioId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={d.nome}
                checked={destSel.includes(d.usuarioId)}
                onChange={() => setDestSel((atual) => alterna(atual, d.usuarioId))}
              />
              {d.nome}
              <span className="text-xs text-muted-foreground">
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'}
              </span>
            </label>
          ))}
        </div>
        {avisos.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </fieldset>

      {previa && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">Taxa de agora</span>
          {previa.map((p) => (
            <span key={p.posto} className="text-muted-foreground">
              {p.avaliavel
                ? `${p.posto}: ${formatarTaxa(p.aprovados, p.reprovados)}% (${p.aprovados} aprovados, ${p.reprovados} reprovados)`
                : `${p.posto}: bipes insuficientes na janela (${p.aprovados + p.reprovados})`}
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancelar} disabled={pendente}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={verPrevia} disabled={pendente}>
          Ver prévia
        </Button>
        <Button onClick={salvar} disabled={pendente} className="bg-enterplak hover:bg-enterplak-700">
          {pendente ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run "src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx"
```
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Implementar o diálogo, a lista de regras, as ocorrências e a tela**

Criar `src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx`:

```tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Canal } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from './regra-form'

export function RegraDialog({
  aberto,
  regra,
  postos,
  destinatarios,
  configurados,
  onFechar,
}: {
  aberto: boolean
  regra: RegraAlerta | null
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onFechar: () => void
}) {
  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{regra ? 'Editar regra' : 'Nova regra'}</DialogTitle>
        </DialogHeader>
        <RegraForm
          regra={regra}
          postos={postos}
          destinatarios={destinatarios}
          configurados={configurados}
          onSalvo={onFechar}
          onCancelar={onFechar}
        />
      </DialogContent>
    </Dialog>
  )
}
```

Criar `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { formatarMeta } from '@/modules/alertas/domain/taxa'
import { resumoJanela } from '@/modules/alertas/domain/janela'
import { NOME_CANAL, type Canal } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { alternarRegraAtivaAction, excluirRegraAction } from '@/modules/alertas/application/alertas-actions'
import { RegraDialog } from './regra-dialog'

const TOAST = { position: 'bottom-center' } as const

export function RegrasLista({
  regras,
  postos,
  destinatarios,
  configurados,
}: {
  regras: RegraAlerta[]
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
}) {
  const [dialogo, setDialogo] = useState<{ aberto: boolean; regra: RegraAlerta | null }>({ aberto: false, regra: null })
  const [pendente, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  const nomes = new Map(destinatarios.map((d) => [d.usuarioId, d.nome]))

  function alternar(regra: RegraAlerta, ativa: boolean) {
    startTransition(async () => {
      const r = await alternarRegraAtivaAction(regra.id, ativa)
      if (!r.ok) toast.error(r.erro, TOAST)
      else toast.success(ativa ? 'Regra ativada' : 'Regra desativada', TOAST)
    })
  }

  async function excluir(regra: RegraAlerta) {
    const ok = await confirmar({
      titulo: `Excluir "${regra.nome}"?`,
      descricao: 'A regra sai da lista e para de alertar; o histórico de ocorrências continua disponível.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirRegraAction(regra.id)
      if (!r.ok) toast.error(r.erro, TOAST)
      else toast.success('Regra excluída', TOAST)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          onClick={() => setDialogo({ aberto: true, regra: null })}
        >
          <PlusIcon /> Nova regra
        </Button>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Postos</TableHead>
              <TableHead>Taxa mínima</TableHead>
              <TableHead>Janela</TableHead>
              <TableHead>Destinatários</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regras.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Nenhuma regra de alerta cadastrada.
                </TableCell>
              </TableRow>
            )}
            {regras.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell>{r.postos.join(', ')}</TableCell>
                <TableCell>{formatarMeta(r.taxaMinima)}%</TableCell>
                <TableCell>{resumoJanela(r)}</TableCell>
                <TableCell>{r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}</TableCell>
                <TableCell>{r.canais.map((c) => NOME_CANAL[c]).join(', ')}</TableCell>
                <TableCell>
                  <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Editar regra"
                      onClick={() => setDialogo({ aberto: true, regra: r })}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Excluir regra"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={pendente}
                      onClick={() => excluir(r)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {regras.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma regra de alerta cadastrada.
          </p>
        )}
        {regras.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.nome}</span>
              <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
            </div>
            <span className="text-sm text-muted-foreground">
              {r.postos.join(', ')} · mínimo {formatarMeta(r.taxaMinima)}% · {resumoJanela(r)}
            </span>
            <span className="text-xs text-muted-foreground">
              {r.canais.map((c) => NOME_CANAL[c]).join(', ')} ·{' '}
              {r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}
            </span>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Editar regra" onClick={() => setDialogo({ aberto: true, regra: r })}>
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Excluir regra"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={pendente}
                onClick={() => excluir(r)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <RegraDialog
        aberto={dialogo.aberto}
        regra={dialogo.regra}
        postos={postos}
        destinatarios={destinatarios}
        configurados={configurados}
        onFechar={() => setDialogo({ aberto: false, regra: null })}
      />
      {dialog}
    </div>
  )
}
```

Criar `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarTaxa } from '@/modules/alertas/domain/taxa'
import { formatarDataHoraCurta } from '@/modules/alertas/domain/mensagens'
import type { EstadoOcorrencia } from '@/modules/alertas/domain/tipos'
import type { FiltroOcorrencias, OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { listarOcorrenciasAction, resolverOcorrenciaAction } from '@/modules/alertas/application/alertas-actions'

const TOAST = { position: 'bottom-center' } as const

function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatarDataHoraCurta(d)
}

function Estado({ estado }: { estado: EstadoOcorrencia }) {
  if (estado === 'aberta') return <Badge variant="destructive">Aberta</Badge>
  if (estado === 'resolvida') return <Badge variant="secondary">Resolvida</Badge>
  return <Badge variant="outline">Normalizada</Badge>
}

export function OcorrenciasLista({
  ocorrenciasIniciais,
  filtroInicial,
}: {
  ocorrenciasIniciais: OcorrenciaLinha[]
  filtroInicial: FiltroOcorrencias
}) {
  const [filtro, setFiltro] = useState<FiltroOcorrencias>(filtroInicial)
  const [lista, setLista] = useState<OcorrenciaLinha[]>(ocorrenciasIniciais)
  const [pendente, startTransition] = useTransition()

  function buscar(novo: FiltroOcorrencias) {
    setFiltro(novo)
    startTransition(async () => {
      const r = await listarOcorrenciasAction(novo)
      if (!r.ok) toast.error(r.erro, TOAST)
      else setLista(r.ocorrencias)
    })
  }

  function resolver(o: OcorrenciaLinha) {
    startTransition(async () => {
      const r = await resolverOcorrenciaAction(o.id)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      toast.success(`${o.posto}: marcada como resolvida`, TOAST)
      const atualizada = await listarOcorrenciasAction(filtro)
      if (atualizada.ok) setLista(atualizada.ocorrencias)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="de">De</Label>
          <Input id="de" type="date" value={filtro.de} onChange={(e) => buscar({ ...filtro, de: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" type="date" value={filtro.ate} onChange={(e) => buscar({ ...filtro, ate: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="estado">Estado</Label>
          <select
            id="estado"
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={filtro.estado}
            onChange={(e) => buscar({ ...filtro, estado: e.target.value as FiltroOcorrencias['estado'] })}
          >
            <option value="">Todos</option>
            <option value="aberta">Aberta</option>
            <option value="resolvida">Resolvida</option>
            <option value="normalizada">Normalizada</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regra</TableHead>
              <TableHead>Posto (OP)</TableHead>
              <TableHead>Ao abrir</TableHead>
              <TableHead>Última</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Aberta em</TableHead>
              <TableHead>Resolvida</TableHead>
              <TableHead>Normalizada</TableHead>
              <TableHead>Envios</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  Nenhuma ocorrência no período.
                </TableCell>
              </TableRow>
            )}
            {lista.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.regraNome}</TableCell>
                <TableCell>
                  {o.posto}
                  {o.pmo && o.op ? ` (${o.pmo}/${o.op})` : ''}
                </TableCell>
                <TableCell>{o.taxaAbertura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</TableCell>
                <TableCell>{formatarTaxa(o.aprovados, o.reprovados)}%</TableCell>
                <TableCell>
                  <Estado estado={o.estado} />
                </TableCell>
                <TableCell>{quando(o.abertaEm)}</TableCell>
                <TableCell>{o.resolvidaEm ? `${o.resolvidaPorNome} · ${quando(o.resolvidaEm)}` : '—'}</TableCell>
                <TableCell>{quando(o.normalizadaEm)}</TableCell>
                <TableCell>
                  {o.enviosOk} ok{o.enviosFalha > 0 ? ` · ${o.enviosFalha} falha` : ''}
                </TableCell>
                <TableCell className="text-right">
                  {o.estado === 'aberta' && (
                    <Button variant="outline" size="sm" disabled={pendente} onClick={() => resolver(o)}>
                      Marcar resolvida
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

Criar `src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOME_CANAL, CANAIS, type Canal } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { avaliarAgoraAction } from '@/modules/alertas/application/alertas-actions'
import { RegrasLista } from './regras-lista'
import { OcorrenciasLista } from './ocorrencias-lista'

const TOAST = { position: 'bottom-center' } as const

export function AlertasTela({
  regras,
  postos,
  destinatarios,
  configurados,
  ocorrenciasIniciais,
  filtroInicial,
}: {
  regras: RegraAlerta[]
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  ocorrenciasIniciais: OcorrenciaLinha[]
  filtroInicial: FiltroOcorrencias
}) {
  const [aba, setAba] = useState<'regras' | 'ocorrencias'>('regras')
  const [pendente, startTransition] = useTransition()

  const semCanal = CANAIS.filter((c) => !configurados[c])

  function avaliarAgora() {
    startTransition(async () => {
      const r = await avaliarAgoraAction()
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      const { avaliadas, enviados, falhas, ocupado } = r.resumo
      toast.success(
        ocupado
          ? 'Uma avaliação já estava rodando — tente de novo em instantes.'
          : `${avaliadas} combinações avaliadas · ${enviados} enviados${falhas > 0 ? ` · ${falhas} falhas` : ''}`,
        TOAST,
      )
    })
  }

  const botaoAba = (chave: 'regras' | 'ocorrencias', rotulo: string) => (
    <button
      key={chave}
      type="button"
      onClick={() => setAba(chave)}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        aba === chave ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {rotulo}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {botaoAba('regras', 'Regras')}
          {botaoAba('ocorrencias', 'Ocorrências')}
        </div>
        <Button variant="outline" disabled={pendente} onClick={avaliarAgora}>
          <Play /> Avaliar agora
        </Button>
      </div>

      {semCanal.length > 0 && (
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          {semCanal.map((c) => `${NOME_CANAL[c]} não configurado`).join(' · ')} neste ambiente — regras com esse canal
          não enviam nada.
        </p>
      )}

      {aba === 'regras' ? (
        <RegrasLista regras={regras} postos={postos} destinatarios={destinatarios} configurados={configurados} />
      ) : (
        <OcorrenciasLista ocorrenciasIniciais={ocorrenciasIniciais} filtroInicial={filtroInicial} />
      )}
    </div>
  )
}
```

Criar `src/app/(app)/configuracoes/sf-alertas/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/postos-repository'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import { listarDestinatarios, listarOcorrencias, listarRegras } from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from './alertas-tela'

export default async function AlertasPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras(),
    listarPostos(),
    listarDestinatarios(),
    listarOcorrencias(filtro),
  ])

  return (
    <AlertasTela
      regras={regras}
      postos={postos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
```

- [ ] **Step 6: Pôr o item Alertas no menu**

Em `src/shared/ui/app-shell.tsx`:

1. No import de `lucide-react`, **acrescentar** `BellRing,`.

2. **Trocar** o array `CONFIG_SHOPFLOOR` por:

```ts
const CONFIG_SHOPFLOOR: FolhaModular[] = [
  { chave: 'sf-postos', rotulo: 'Postos', href: '/configuracoes/sf-postos', icone: Waypoints, modulo: 'shopfloor', perm: 'administrar' },
  { chave: 'sf-defeitos', rotulo: 'Defeitos', href: '/configuracoes/sf-defeitos', icone: Bug, modulo: 'shopfloor', perm: 'administrar' },
  { chave: 'sf-consertos', rotulo: 'Consertos', href: '/configuracoes/sf-consertos', icone: Wrench, modulo: 'shopfloor', perm: 'administrar' },
  { chave: 'sf-alertas', rotulo: 'Alertas', href: '/configuracoes/sf-alertas', icone: BellRing, modulo: 'shopfloor', perm: 'administrar' },
]
```

- [ ] **Step 7: Rodar tudo, tipos e lint**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: todos os testes passando; `tsc` sem saída; lint sem avisos.

- [ ] **Step 8: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add "src/app/(app)/configuracoes/sf-alertas" src/shared/ui/app-shell.tsx
git commit -m "$(cat <<'MSG'
feat(alertas): tela de Alertas em Ajustes ShopFloor (regras + ocorrências)

Aba Regras com tabela/cards, interruptor Ativa, diálogo da regra (postos,
taxa, janela tempo/bipes/OP, mínimo, lembrete, canais, destinatários com aviso
de quem não tem o canal e prévia da taxa de agora) e botão Avaliar agora; aba
Ocorrências com filtros de período/estado, contagem de envios e Marcar
resolvida. Item Alertas no menu de Ajustes ShopFloor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Operação (script dos bots, README, `.env.example`), verificação final e roteiro de smoke

**Files:**
- Create: `tools/alertas/configurar-bots.mjs`
- Create: `tools/alertas/README.md`
- Modify: `.env.example`
- Create: `docs/superpowers/plans/2026-09-17-alertas-smoke.md`

**Interfaces:**
- Consumes: variáveis de ambiente `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `ALERTAS_CRON_SECRET`, `ALERTAS_BASE_URL`; as rotas `/api/alertas/telegram` e `/api/alertas/discord` (Task 6).
- Produces: `node tools/alertas/configurar-bots.mjs` (registra o webhook do Telegram e o comando `/vincular` no guild do Discord), README de operação, variáveis no `.env.example` e o roteiro de smoke.

- [ ] **Step 1: Escrever o script de configuração dos bots**

Criar `tools/alertas/configurar-bots.mjs`:

```js
#!/usr/bin/env node
// Configura os bots dos alertas: webhook do Telegram + comando /vincular no servidor do Discord.
// Uso (na máquina que tem as variáveis do ambiente):
//   node tools/alertas/configurar-bots.mjs
//   node tools/alertas/configurar-bots.mjs --so-telegram
//   node tools/alertas/configurar-bots.mjs --so-discord
//
// NUNCA imprime token nem segredo: só diz o que deu certo e o que falhou.

const args = new Set(process.argv.slice(2))
const soTelegram = args.has('--so-telegram')
const soDiscord = args.has('--so-discord')

const env = process.env
const BASE = (env.ALERTAS_BASE_URL ?? 'https://shopfloor.enterplak.com.br').replace(/\/+$/, '')

function exigir(nomes) {
  const faltando = nomes.filter((n) => !env[n])
  if (faltando.length > 0) {
    console.error(`Variáveis ausentes: ${faltando.join(', ')}`)
    return false
  }
  return true
}

async function configurarTelegram() {
  if (!exigir(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'])) return false
  const url = `${BASE}/api/alertas/telegram`
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok !== true) {
    console.error(`Telegram setWebhook falhou (${res.status}): ${json?.description ?? 'sem descrição'}`)
    return false
  }
  console.log(`Telegram: webhook apontado para ${url}`)
  if (env.TELEGRAM_BOT_USERNAME) console.log(`Telegram: bot https://t.me/${env.TELEGRAM_BOT_USERNAME}`)
  return true
}

async function configurarDiscord() {
  if (!exigir(['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID', 'DISCORD_GUILD_ID'])) return false
  const comandos = [
    {
      name: 'vincular',
      description: 'Vincula seu Discord ao ShopFloor para receber os alertas',
      type: 1,
      options: [
        {
          name: 'codigo',
          description: 'O código gerado em Meu perfil (ex.: ALERTA-7K3M)',
          type: 3,
          required: true,
        },
      ],
    },
  ]
  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(comandos),
    },
  )
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    console.error(`Discord: registro do /vincular falhou (${res.status}): ${json?.message ?? 'sem descrição'}`)
    return false
  }
  console.log('Discord: comando /vincular registrado no servidor')
  console.log(`Discord: confira no portal se o Interactions Endpoint URL é ${BASE}/api/alertas/discord`)
  return true
}

const tarefas = []
if (!soDiscord) tarefas.push(configurarTelegram())
if (!soTelegram) tarefas.push(configurarDiscord())
const resultados = await Promise.all(tarefas)
process.exit(resultados.every(Boolean) ? 0 : 1)
```

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && node --check tools/alertas/configurar-bots.mjs && echo "sintaxe ok"
```
Expected: `sintaxe ok`.

- [ ] **Step 2: Escrever o README de operação**

Criar `tools/alertas/README.md`:

```markdown
# Alertas de taxa de aprovação — criar os bots e ligar tudo

O ShopFloor manda os alertas direto pelo **bot do Telegram** e pelo **bot do Discord** da empresa
(sem n8n). Este documento é o passo a passo de quem configura pela primeira vez.

## 1. Bot do Telegram

1. No Telegram, fale com o **@BotFather** → `/newbot`.
2. Nome sugerido: `Enterplak ShopFloor`; usuário: algo terminando em `bot` (ex.: `enterplak_shopfloor_bot`).
3. O BotFather devolve o **token**. Guarde em `TELEGRAM_BOT_TOKEN` (nunca no repositório).
4. Guarde o usuário do bot (sem o `@`) em `TELEGRAM_BOT_USERNAME` — é o link que aparece na tela Meu perfil.
5. Invente um segredo grande para `TELEGRAM_WEBHOOK_SECRET` (ex.: `openssl rand -hex 24`).

## 2. Bot do Discord

1. Abra o **Discord Developer Portal** → **New Application** (nome: `Enterplak ShopFloor`).
2. Em **General Information**, copie o **Application ID** → `DISCORD_APP_ID` e a
   **Public Key** → `DISCORD_PUBLIC_KEY`.
3. Em **Bot**, clique em **Reset Token** e guarde o token → `DISCORD_BOT_TOKEN`.
4. Em **OAuth2 → URL Generator**, marque os escopos `bot` e `applications.commands`
   (permissão de bot: nenhuma além do padrão — as mensagens são DMs). Abra a URL gerada e
   **convide o bot** para o servidor da Enterplak.
5. Pegue o ID do servidor (Discord → Configurações → Avançado → Modo desenvolvedor; clique com o
   botão direito no servidor → Copiar ID do servidor) → `DISCORD_GUILD_ID`.
6. Em **General Information → Interactions Endpoint URL**, coloque
   `https://shopfloor.enterplak.com.br/api/alertas/discord` e salve. O Discord manda um PING
   assinado na hora: se a URL estiver no ar com a `DISCORD_PUBLIC_KEY` certa, ele aceita.
7. **Importante:** cada pessoa precisa estar no servidor e aceitar DM de membros do servidor,
   senão o Discord recusa a mensagem privada. O botão **Enviar teste** em *Meu perfil* mostra isso
   na hora.

## 3. Variáveis do ambiente

No `.env.production` da Lightsail (e, para testar, no `.env.local` ou no Preview da Vercel):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
DISCORD_PUBLIC_KEY=
DISCORD_GUILD_ID=
ALERTAS_CRON_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` já existe e é usada pelas rotas de cron/webhook.

Depois de mudar variáveis: `pm2 restart shopfloor --update-env`.

## 4. Registrar webhook e comando

```bash
cd ~/ShopFloor
node tools/alertas/configurar-bots.mjs            # Telegram + Discord
node tools/alertas/configurar-bots.mjs --so-telegram
node tools/alertas/configurar-bots.mjs --so-discord
```

O script lê as variáveis do ambiente e **nunca imprime token**. Em outro domínio (preview), use
`ALERTAS_BASE_URL=https://meu-preview.vercel.app node tools/alertas/configurar-bots.mjs`.

## 5. Crontab (avaliação a cada 5 minutos)

O segredo **não** vai escrito na linha do crontab: fica num arquivo só do dono.

```bash
umask 077
printf '%s\n' "$ALERTAS_CRON_SECRET" > ~/.alertas-cron-secret
chmod 600 ~/.alertas-cron-secret
crontab -e
```

Linha a acrescentar:

```
*/5 * * * * curl -fsS -m 60 -X POST -H "Authorization: Bearer $(cat ~/.alertas-cron-secret)" https://shopfloor.enterplak.com.br/api/alertas/avaliar >> ~/alertas.log 2>&1
```

Com o **RDS desligado** (19:00–06:00 do plano de economia) a rota responde **503** e o log registra
— nada mais acontece.

## 6. Migrações

```bash
psql "host=... user=postgres sslmode=require" -f supabase/migrations/0113_alertas.sql
psql "host=... user=postgres sslmode=require" -f supabase/migrations/0114_sf_registros_posto_data_idx.sql   # SEM -1
cd ~/supabase/docker && docker compose restart rest
```

No **Dev** (SQL Editor do Supabase), a 0114 precisa rodar **sem a palavra `concurrently`**.

## 7. Conferir

- `curl -i -X POST https://shopfloor.enterplak.com.br/api/alertas/avaliar` → **401** (sem segredo).
- Com o segredo → `{"avaliadas":N,"enviados":0,"falhas":0,"ocupado":false}`.
- `https://api.telegram.org/bot<token>/getWebhookInfo` → a URL e `has_custom_certificate:false`
  (rode no seu terminal, não em log compartilhado).
- Tela **Meu perfil** → Vincular → o bot responde.
```

- [ ] **Step 3: Acrescentar as variáveis ao `.env.example`**

**Acrescentar ao final** de `.env.example` (sem valores):

```
# Alertas de taxa de aprovação (Telegram/Discord) — server-only.
# Sem os tokens, o canal aparece como "não configurado" e nada é enviado.
# Passo a passo de criação dos bots: tools/alertas/README.md
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
DISCORD_PUBLIC_KEY=
DISCORD_GUILD_ID=
# Segredo do crontab que chama POST /api/alertas/avaliar a cada 5 minutos
ALERTAS_CRON_SECRET=
```

- [ ] **Step 4: Escrever o roteiro de smoke**

Criar `docs/superpowers/plans/2026-09-17-alertas-smoke.md`:

```markdown
# Smoke — Alertas de taxa de aprovação (Telegram/Discord)

Pré-requisitos: bots criados (`tools/alertas/README.md`), variáveis no ambiente, `0113` e `0114`
aplicadas no banco do ambiente testado, app reiniciado (`pm2 restart shopfloor --update-env`).

## 1. Vínculo
- [ ] Entrar no sistema → clicar no **nome no cabeçalho** → abre **Meu perfil** com o cartão Alertas.
- [ ] Canal sem token configurado aparece como **"Não configurado neste ambiente"** e desabilitado.
- [ ] **Telegram → Vincular**: aparece `ALERTA-XXXX` com contador de 15 min; enviar o código ao bot
      → o bot responde "✅ Conta vinculada ao ShopFloor (seu nome)" e a tela troca sozinha para
      **"Vinculado em dd/mm"** (em até 3 s).
- [ ] **Discord → Vincular**: no servidor da Enterplak, `/vincular ALERTA-XXXX` → resposta efêmera
      de confirmação; a tela atualiza.
- [ ] **Enviar teste** nos dois canais: a mensagem chega na DM.
- [ ] Código **expirado** (esperar 15 min ou usar um código velho) → o bot responde
      "Código expirado. Gere um novo em Meu perfil." Código **reusado** → "Código inválido ou já usado".

## 2. Regra e alerta
- [ ] Configurações › Ajustes ShopFloor › **Alertas** → **Nova regra**: posto com bipes de hoje,
      **taxa mínima 99,99%** (para garantir o disparo), janela **últimos 1440 minutos**,
      mínimo de bipes **1**, lembrete **1** min, os dois canais, você como destinatário.
- [ ] **Ver prévia** mostra a taxa atual do posto antes de salvar.
- [ ] Escolher alguém sem Telegram → aparece o aviso "Nome sem Telegram".
- [ ] **Avaliar agora** → alerta chega nos dois canais com o botão **✅ Resolvido**; a aba
      **Ocorrências** mostra a linha `Aberta` com `2 ok`.

## 3. Lembrete
- [ ] Esperar 1 minuto → **Avaliar agora** → chega o **⏰ Lembrete — continua abaixo há N min**.
- [ ] **Avaliar agora** de novo na mesma hora → **não** chega lembrete repetido.

## 4. Resolvido
- [ ] Apertar **✅ Resolvido** no Telegram → o botão sai da mensagem, ela ganha a linha
      "✅ posto: resolvido por Nome às HH:MM", e o **Discord** recebe "✅ ... resolvido por ...".
- [ ] A ocorrência fica **Resolvida** na tela; **Avaliar agora** não manda mais lembrete.
- [ ] Apertar o botão de uma ocorrência já resolvida → responde "Já resolvido por Nome".
- [ ] Repetir pelo **Discord** (botão da DM) numa nova ocorrência: a mensagem é atualizada sem botão.
- [ ] **Marcar resolvida** pela tela numa ocorrência aberta → os destinatários recebem o aviso e os
      botões saem das mensagens.

## 5. Normalizou
- [ ] Editar a regra para **taxa mínima 1%** → **Avaliar agora** → chega
      **🟢 posto normalizou: X% (ficou N min abaixo)**; a ocorrência fica **Normalizada** e os
      botões antigos desaparecem.
- [ ] Voltar a meta para 99,99% → **Avaliar agora** → abre uma ocorrência **nova** (não a antiga).

## 6. Regra desligada / posto removido
- [ ] Com ocorrência aberta, desligar o interruptor **Ativa** → **Avaliar agora** → a ocorrência
      vira **Normalizada** e **nada** é enviado.
- [ ] Tirar o posto da regra → mesmo comportamento.
- [ ] **Excluir** uma regra com ocorrência (confirmação: "A regra sai da lista e para de alertar; o
      histórico de ocorrências continua disponível.") → some da aba Regras; na aba **Ocorrências**
      as linhas dela continuam, com o nome "Regra (excluída)"; **Avaliar agora** não alerta mais
      por ela e a ocorrência viva vira **Normalizada** sem envio (os botões saem).

## 6b. Fila de envio
- [ ] Com o **Discord sem token** (ou com um destinatário que bloqueou DMs), **Avaliar agora** →
      a aba Ocorrências mostra a falha; nas rodadas seguintes a linha é tentada de novo até 3 vezes.
- [ ] Clicar **Avaliar agora** duas vezes seguidas (ou junto com o cron) → cada destinatário recebe
      a mensagem **uma vez só**.

## 7. Cron e segurança
- [ ] `curl -i -X POST .../api/alertas/avaliar` → **401**.
- [ ] Com `Authorization: Bearer <segredo>` → **200** com o resumo.
- [ ] `curl -i -X POST .../api/alertas/telegram` (sem cabeçalho) → **401**.
- [ ] `curl -i -X POST .../api/alertas/discord -d '{}'` (sem assinatura) → **401**.
- [ ] Esperar o crontab (5 min) e conferir `~/alertas.log`.
- [ ] Permissão: usuário **sem** `shopfloor.administrar` não vê o item **Alertas** no menu e
      `/configuracoes/sf-alertas` mostra "sem permissão"; mas **Meu perfil** funciona normal.

## 8. Desvincular
- [ ] **Desvincular** o Telegram (com confirmação) → **Avaliar agora** com nova ocorrência: chega só
      no Discord.
```

- [ ] **Step 5: Verificação final completa**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && npx tsc --noEmit && npm run lint && npx vitest run && ./supabase/tests/rodar-alertas-test.sh
```
Expected: `tsc` sem saída; `✔ No ESLint warnings or errors`; vitest com todos os arquivos passando; `ALERTAS: SQL OK` + `trava do alerta_avaliar: ok` + `ALERTAS SQL OK`.

Run (build; as variáveis abaixo são fictícias, só para o `env.ts` não barrar o build — **não** ler `.env*`):
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && NEXT_PUBLIC_SUPABASE_URL=https://exemplo.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-de-build SUPABASE_SERVICE_ROLE_KEY=service-de-build npm run build
```
Expected: `✓ Compiled successfully` e a lista de rotas incluindo `/perfil`, `/configuracoes/sf-alertas`, `/api/alertas/avaliar`, `/api/alertas/telegram`, `/api/alertas/discord`.

- [ ] **Step 6: Conferir que nada indevido entrou no commit**

Run:
```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas" && git status --short
```
Expected: só os arquivos desta task como não rastreados/modificados (`tools/alertas/`, `.env.example`, `docs/superpowers/plans/2026-09-17-alertas-smoke.md`). **Nenhum** `.env*`, `*.txt` ou `*.xlsx` deve aparecer na lista do `git add` do próximo passo.

- [ ] **Step 7: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas"
git add tools/alertas .env.example docs/superpowers/plans/2026-09-17-alertas-smoke.md
git commit -m "$(cat <<'MSG'
feat(alertas): script dos bots, README de operação, .env.example e smoke

configurar-bots.mjs registra o webhook do Telegram (com secret_token) e o
comando /vincular no servidor do Discord sem nunca imprimir token; README com
o passo a passo dos dois bots, variáveis, crontab lendo o segredo de arquivo
600 e migrações; variáveis novas no .env.example; roteiro de smoke real.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Auto-revisão (feita ao escrever o plano)

**Cobertura da spec**

| Seção da spec | Onde é implementada |
|---|---|
| 2.1 Canais Telegram + Discord, envio direto | Task 4 (clients), Task 5 (portas por env) |
| 2.2 Várias regras com todos os campos | Task 2 (`alerta_regras`), Task 7 (validação/actions), Task 9 (diálogo) |
| 2.3 Janela `tempo`/`bipes`/`op` com padrões | Task 3 (`alerta_taxas`), Task 7 (`PADROES_REGRA`), Task 9 (rádios) |
| 2.4 Mínimo de bipes (padrão 20) | Task 3 (`alerta_avaliar`), testes SQL seção 11 |
| 2.5 Destinatários entre quem tem vínculo | Task 3 (`alerta_destinatarios`), Task 9 (aviso de quem não tem canal) |
| 2.6 Vínculo por código de 15 min, uso único | Task 2 (`alerta_gerar_codigo`/`alerta_vincular`), Task 8 (tela) |
| 2.7 Alerta + lembrete + normalizou | Task 3 (transições), Task 1 (textos), Task 5 (envio) |
| 2.8 Resolvido pelo botão e pela tela, idempotente | Task 3 (`alerta_resolver`/`_admin`), Task 6 (webhooks), Task 7 (action) |
| 2.9 Permissões (`shopfloor.administrar` × qualquer usuário) | Task 2/3 (RLS + gates), Task 7 (actions), Tasks 8/9 (telas) |
| 2.10 Checagem a cada 5 min pelo crontab | Task 5 (rota), Task 10 (crontab no README) |
| 3 Taxa de aprovação e régua de status | Task 1 (`formatarTaxa`), Task 3 (`alerta_taxas`) |
| 4 Tabelas, índices, funções, grants, `notify pgrst` | Tasks 2 e 3 |
| 4 Índice `(posto, data_hora desc)` | Task 2 (arquivo 0114 separado) |
| 5 Tabela de transições (todas as linhas) | Task 3 (`alerta_avaliar`) + testes SQL 6–14 |
| 6 Envio, botões, `mensagem_externa_id`, falha/reenvio, canal sem token | Tasks 4, 5 |
| 6 Textos exatos das mensagens | Task 1 (`mensagens.ts`) |
| 7 Rotas avaliar/telegram/discord + Avaliar agora | Tasks 5, 6, 7, 9 |
| 8.1 Tela Meu perfil | Task 8 |
| 8.2 Tela Alertas (Regras + Ocorrências) | Task 9 |
| 9 Operação (variáveis, script, crontab, RDS desligado) | Tasks 5 (503) e 10 |
| 10 Testes (domínio, banco, rotas, smoke) | Tasks 1–9 (vitest/SQL) e 10 (smoke) |
| 11 Riscos (DM do Discord, Telegram, carga) | Task 8 (Enviar teste), Task 10 (README), Task 2 (índice) |

**Placeholders:** nenhuma ocorrência de "TBD", "similar à Task N", teste sem código ou passo sem comando — cada step de código traz o arquivo inteiro (ou o trecho exato a trocar) e cada step de teste traz o comando e a saída esperada.

**Consistência de nomes e tipos (conferida entre tasks, atualizada na revisão da fila):** `ResultadoEnvio.mensagemExternaId`, `PortaCanal.enviar/removerBotoes`, `RepositorioEnvios.avaliar/reservarPendentes/concluirEnvio/registrarEnvioDireto/mensagensComBotao/marcarSemBotao/contaDoUsuario`, `FiltroReserva.canais/limite/ocorrenciaId`, `EnvioReservado` + `textoDoEnvio(tipo, dados)` (camelCase no TS × snake_case no jsonb), `ResultadoAvaliacaoRpc.ocupado/avaliadas/enfileirados/normalizadas`, `RepositorioVinculo.vincular/usuarioPorConta/resolver`, `ResolucaoOcorrencia.jaResolvida/resolvidaPorId/resolvidaPorNome/resolvidaEm`, `RegraValida`/`RegraAlerta`, `DestinatarioDisponivel.usuarioId`, `FiltroOcorrencias.de/ate/estado`, `PreviaPosto.avaliavel`, `ContaVinculada.vinculadoEm`, `canaisConfigurados`/`criarPortasCanais`/`criarDependenciasAlertas`, `ehRotaPublicaDeAlertas`. Nomes do banco batem com as chamadas RPC: `alerta_gerar_codigo`, `alerta_vincular(p_codigo,p_canal,p_externo_id)`, `alerta_avaliar`, `alerta_reservar_envios(p_canais,p_limite,p_ocorrencia_id)`, `alerta_previa(p_postos,p_janela_tipo,p_janela_valor,p_minimo)`, `alerta_resolver(p_ocorrencia_id,p_usuario_id)`, `alerta_resolver_admin(p_ocorrencia_id)`, `alerta_destinatarios`, `alerta_listar_ocorrencias(p_de,p_ate,p_estado)`.

**Decisões tomadas aqui que a spec não fixava** (registradas para o revisor):
1. **"Meu perfil"** entra pelo nome do usuário **no cabeçalho** (link novo à direita) **e** pelo bloco do nome no rodapé do menu — o cabeçalho hoje não tinha menu de usuário.
2. **Índice do `sf_registros` em arquivo próprio** `0114_sf_registros_posto_data_idx.sql` (`create index concurrently`), com instrução de remover `concurrently` no SQL Editor do Dev e rodar no RDS com `psql -f` sem `-1`.
3. **Funções "só service_role"** ganham `revoke all ... from public, anon, authenticated` + `grant execute ... to service_role` (é o próprio GRANT que faz o gate); `alerta_resolver_interno` é revogado de todos e chamado só pelas duas portas.
4. **`alerta_envios` é a fila de saída** (revisão de 2026-09-18): o banco cria a linha pendente com `dados jsonb` (o texto é montado no TS na hora de entregar e gravado em `texto` para auditoria), `com_botao`, `reservado_em`, `enviado_em`; a entrega **atualiza a mesma linha** (`tentativas + 1` feito pela reserva) em vez de inserir outra.
5. **`mensagem_externa_id` no formato `"<chat|canal>:<mensagem>"`** — os dois provedores exigem o par para editar a mensagem.
6. **`alerta_avaliar` atualiza `taxa_ultima`/contagens em toda avaliação** (inclusive em ocorrência `resolvida`), sem envio — a tela de Ocorrências mostra a foto atual.
7. **`alerta_resolver_admin(p_ocorrencia_id)`** como função separada da versão do webhook (permissão e regra de destinatário diferentes).
8. **`alerta_destinatarios()`** devolve só booleanos de vínculo (nunca o `externo_id`), e **`alerta_listar_ocorrencias()`** já traz nome da regra, quem resolveu e a contagem de envios — evita expor tabelas extras via RLS.
9. **Middleware libera `/api/alertas/*`** (senão o Telegram receberia o redirect do `/login`), com o teste no helper puro `ehRotaPublicaDeAlertas`.
10. **Validações extras** no formulário: taxa conferida no texto (até 2 casas) e janela de bipes ≥ mínimo de bipes (senão a regra nunca decidiria nada).
11. **Entrega da fila** só de linhas das últimas 24 h, no máximo 30 por rodada (reserva de 15 min), novas antes de reenvios, até 3 tentativas, pulando `teste` e pulando alerta/lembrete de ocorrência que já saiu de `aberta`.
15. **Exclusão lógica de regra** (`excluida_em`), FK `restrict` e nenhuma policy de DELETE: excluir nunca apaga histórico.
16. **"Enviar teste" fora da fila** (entrega direta + linha já final); **"resolvido por" dentro da fila** (enfileirado pelo `alerta_resolver_interno`, entregue na hora pelo webhook/tela e, se falhar, pelo cron).
12. **Discord**: resposta imediata (`type 7`/efêmera) e o resto (`avisar os outros`, limpar botões) em `after()`; o `mensagem_externa_id` do Discord também é limpo em `normalizou`.
13. **Tabs da tela de Alertas** são botões simples (o projeto não tem componente de Tabs) e os checkboxes/rádios do diálogo são inputs nativos (mesmo padrão do formulário de Defeitos).
14. **Build da verificação final** roda com variáveis fictícias na linha de comando, porque o worktree não tem `.env.local` e o plano proíbe ler `.env*`.
