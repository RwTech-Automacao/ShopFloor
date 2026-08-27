# Estudo de Escalabilidade — ShopFloor

> Iniciado em 2026-08-19, após incidente de lentidão em produção. Documento vivo:
> atualizar com novas medições (principalmente as capturadas em pico).

## 1. Contexto / problema

Em **2026-08-19 de manhã**, com muitos postos usando ao mesmo tempo, o ShopFloor
ficou **lento** (login travando em "Entrando…" e navegação/bipe lentos). O gestor
confirmou que **aumentaram os postos** (ontem à tarde e hoje) e que "praticamente
todos os postos estão simultâneos". Foi **normalizado encerrando as conexões abertas**
no banco (o pessoal rodou `pg_terminate` nas sessões de `pg_stat_activity`).

## 2. Diagnóstico (o que foi DESCARTADO, com evidência)

| Camada | Veredito | Evidência |
|---|---|---|
| Banco Supabase (CPU/IO) | ✅ saudável | Observability: **CPU 3%, Disk IO 1%, Mem 53%**, 99,7% sucesso, 0 erros |
| Rede local da fábrica | ✅ descartada | 4G = mesma lentidão do wifi |
| Config de ontem (SMTP/rate limit) | ✅ descartada | 0 erro no Auth; código não mergeado |
| Incidente de plataforma | ✅ descartado | status.supabase.com e vercel-status.com "operational" |
| Código do app (vazamento) | ✅ descartado | app é **só REST** (`@supabase/ssr`), **sem realtime, sem conexão direta**; `pg_stat_activity` baseline sem `idle in transaction` |
| **Capacidade (planos grátis)** | ❌ **CAUSA RAIZ** | Vercel Hobby + pool do PostgREST no free |

## 3. Custo por ação (medido no código)

### A "taxa dupla de auth" (amplifica tudo)
Cada **server action** paga **2 Auth + 2 DB fixos** antes de qualquer trabalho:
- **Middleware** (`src/shared/lib/supabase/middleware.ts`, roda em ~toda requisição via matcher): `auth.getUser()` (1 Auth) + query `usuarios` (1 DB).
- **`getSessao`** (`src/modules/auth/infra/usuario-repository.ts` `buscarUsuarioAutenticado`): `auth.getUser()` (1 Auth) + `usuarios + perfis + perfil_permissao` (1 DB, join 3 tabelas).
- `getSessao` é `cache()`-wrapped, mas **só deduplica dentro de 1 action** — NÃO compartilha com o middleware (requisição separada).

### Um bipe = 3 server actions = ~18-19 round-trips (~11 DB + 1 RPC + 6 Auth)
Fluxo cliente: `lancamento-form.tsx` → `verificarConserto` → `lancar` → `refreshTotalPosto`/`contarLancadosPosto`.

| Ação | Custo | Pesado? |
|---|---|---|
| `verificarConserto` (`lancar-action.ts`) | 2 Auth + 3-4 DB (`mapaPostoPerfil`, `buscarUltimaReprovaDoPosto`) | |
| `lancar` (`lancar-action.ts`) | 2 Auth + 5 DB + 1 RPC `sf_lancar`; só `Promise.all([mapaPostoPerfil, carregarOrdem])` é paralelo | |
| `contarLancadosPosto` (`lancamento-repository.ts` `contarLancadosNoPosto`) | 2 Auth + 3+ DB | ⚠️ **scan da `sf_registros` da OP INTEIRA** (páginas de 1000, dedup em memória) |

### Outras telas (custo + se seguram conexão)
| Tela | Custo | Pesado / polling? |
|---|---|---|
| `/home` | 2 Auth + 2 DB (só `getSessao`) | leve |
| **Fluxo da OP** (`fluxo-repository.ts` `carregarFluxoOp` → `contarPendentesPorPosto`) | 2 Auth + 3+ DB + 1 RPC, sequencial | ⚠️ **scan completo da OP** + **auto-refresh `setInterval` 15s** (`fluxo-form.tsx`) por aba aberta |
| **Pesquisa/Grade** (`pesquisa-repository.ts` `listarRegistrosDaOp`) | 2 Auth + 3+ DB | ⚠️ **scan completo da OP** (multi-segundos em OP 2000+) |
| **Dashboard** (`dashboard-repository.ts` `listarContagemDaOp`) | 2 Auth + 3+ DB | ⚠️ **scan completo da OP** |
| Lançamento (load da página) | 2 Auth + 3 DB paralelos (`listarOrdensParaLancamento` join 4 tabelas) | moderado, 1x no load |

**Sem Supabase Realtime** em nenhum lugar (`.channel(`/`.subscribe(` = 0 hits). Bom — sem websocket persistente.

## 4. Top ofensores de pressão no pool
1. **`contarLancadosNoPosto`** — scan completo da OP **a CADA bipe** (o contador "lançados"). Frequência máxima × pesado = **pior ofensor**.
2. **Taxa dupla de auth** — 4 round-trips fixos por action (~12 por bipe).
3. **Fluxo auto-refresh 15s** — scan completo + RPC por aba aberta (Modo TV deixado aberto = carga de fundo o dia todo).
4. **Pesquisa/Grade e Dashboard** — scans multi-segundos que seguram conexão.
5. **`contarPendentesPorPosto`** + scans lazy dos nós do Fluxo.

**Causa comum (1/3/4/5):** as telas de OP grande fazem **paginação no cliente sobre um scan completo da `sf_registros`** (páginas de 1000, agregação em memória) em vez de **agregar no banco** → cada uma segura uma conexão do pool durante o scan inteiro.

## 5. Tetos de capacidade
- **Vercel Hobby (free):** timeout de função **10s**; concorrência com *fair-use throttle* (sem número público); "não é pra uso comercial". Foi ele que **pendurou o `/home` no TTFB**.
- **Supabase free:** **~60 conexões diretas** no total (compartilhadas entre PostgREST, Auth, Realtime, Storage, cron, painel); **pool do PostgREST pequeno**.

## 6. Mecanismo da cascata (hipótese que encaixa tudo)
> rajada de carga → **query pesada** (Fluxo/Pesquisa/contador do bipe em OP grande) fica lenta → a função da **Vercel estoura 10s** → mas a **query no banco continua rodando "órfã"** segurando conexão → as órfãs **acumulam** → pool satura → **tudo pendura** → até **matar as sessões** (limpa as órfãs).

Explica: por que **matar conexões resolveu**, por que **liga com o Hobby** (timeout 10s), e por que o pool pode **saturar de repente** sem um exército de postos (basta rajada + scan pesado + timeout). **A confirmar em pico** (query D mostrando scans/órfãs).

## 7. Medições reais (curva de capacidade)
| Momento | Postos ativos | Conexões | `authenticator` | Queries pesadas | Estado |
|---|---|---|---|---|---|
| Baseline (calmo) | — | ~11 | 5 idle | 0 | saudável |
| 2026-08-19 ~11h25 | **~9-10 sessões** (5-6 bipando + 2 outras telas + 2 admin) | **16/60** | 4 idle | **0** (query D vazia) | **confortável** |
| **Pico manhã 19/08** | "todos os postos" (a confirmar quantos) | **saturou** (a medir) | ? | ? | **travou** |

**Insight da medição:** ~10 sessões ativas = só **~4 conexões `authenticator`** (o resto do 16 é interno do Supabase). O app multiplexa via PostgREST → pega POUCA conexão em carga normal. Pra saturar 60 **linearmente** precisaria de ~150 sessões → **improvável**. Logo, o travamento da manhã foi provavelmente a **cascata** (scan pesado + timeout 10s da Vercel → conexões órfãs acumulando), não o nº de postos puro. Reforça o fix: eliminar scans pesados + Vercel Pro (timeout maior).

**Falta:** capturar as queries **A + B + D no exato momento do travamento** (pico da manhã) + anotar o nº de postos → fecha o **ponto de quebra**.

### Queries de medição (rodar no SQL Editor do Prod, no pico)
```sql
-- A) quem segura conexões
select usename, application_name, state, count(*)
from pg_stat_activity where datname = current_database()
group by usename, application_name, state order by count(*) desc;
-- B) total x limite
select count(*) as conexoes, (select setting::int from pg_settings where name='max_connections') as limite
from pg_stat_activity;
-- D) queries pesadas/órfãs segurando conexão agora
select pid, usename, now() - query_start as rodando_ha, wait_event_type, wait_event, left(query,140) as query
from pg_stat_activity where state='active' and now() - query_start > interval '1 second'
order by rodando_ha desc;
```

## 8. Roadmap priorizado (alavancas)

**🥇 Maiores ganhos — código, grátis, baixo risco**
1. **Matar o scan por bipe (`contarLancadosNoPosto`)** — trocar por **+1 local** ou **`COUNT(distinct)` no banco (RPC indexada)**. Remove o pior ofensor. *(Já estava anotado como "otimização adiada" na v1.1.0.)*
2. **Cortar a taxa dupla de auth** — Nível 1: tirar a query do middleware (deixar `getSessao` ser a checagem única). Nível 2: `ativo`/perfil/permissões/`senha_provisoria` em **claims do JWT** (custom access token hook) + **validação local** (`getClaims`) → auth por requisição ≈ 0. *(Auth-sensível → brainstorm próprio; trade-off: claims ~1h "velhas" — decidir tratamento de desativação urgente.)*
3. **Menos actions por bipe** — fundir `verificarConserto` no `lancar` (ou a RPC devolver se precisa confirmar conserto).

**🥈 Ganhos médios — código, grátis**
4. **Fluxo 15s** — aumentar intervalo (30-60s) + **pausar quando a aba não está visível** (Page Visibility API) + trocar scan por agregado no banco.
5. **Scans → agregados no banco** — Pesquisa/Grade, Dashboard, Fluxo-pendentes: mover contagem/agregação pro Postgres (RPC `COUNT/GROUP BY`) → resultado minúsculo → segura conexão por **ms**, não segundos. *(Liga com backlog "grade OP>2000".)*

**🥉 Plano / config**
6. **Vercel Pro** (~US$20/mês) — concorrência + timeout 10s→60s+ (corta o gatilho da cascata). O teto mais claro.
7. **Supabase Pro** — pool/conexões/compute maiores (os itens 1-5 reduzem a necessidade).
8. **Sessão mais longa / manter logado** — menos re-login em massa (um dos picos).

## 9. Teste de carga + monitoramento
- **Teste de carga (antes de escalar nº de aparelhos):** simular N postos simultâneos fazendo o fluxo de bipe **contra o Dev** (nunca o Prod), em degraus 10→20→30→40; medir p95, taxa de erro/timeout, `authenticator` count, CPU. Acha o teto real e valida as otimizações (k6/Artillery).
- **Monitoramento:** Supabase Observability (CPU/conexões/slow queries) + query A no pico + Alerts; Vercel function duration/timeouts; olhar o **pico da manhã** (teste de carga natural de graça).

## 10. Recomendação / decisão
O sistema tem **ineficiências reais e corrigíveis** (scan da OP a cada bipe, auth duplicada, polling pesado de 15s) que o fazem **consumir muito mais capacidade do que precisa**. Corrigindo (de graça, no código), o **plano atual aguenta muito mais postos**, e o Pro fica ainda mais eficiente.

**Ordem sugerida:** (1) matar o scan por bipe + aliviar auth [maior ganho, baixo risco] → (2) scans viram agregados → (3) **Vercel Pro** [corta o gatilho da cascata] → medir de novo → Supabase Pro só se necessário.

**Observação de custo × esforço:** o Vercel Pro resolve o teto de concorrência **em minutos** por ~US$20/mês; o paliativo de código é **meio dia+** e parcial. O ideal é **os dois** (Pro estanca; código aumenta a lotação de qualquer plano).
