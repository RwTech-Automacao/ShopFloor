# Fila de estoque (Compels) — o cron que entrega a fila

Cada bipe do posto Almoxarifado entra numa fila (`sf_estoque_envios`, migração 0132) para ser
mandado ao ERP **Compels**. Quem tira a fila de lá é a rota `POST /api/shopfloor/estoque`, chamada
pelo **crontab da instância Lightsail**. Este documento é o passo a passo de quem vai armar isso.

O molde é o cron dos Alertas (`tools/alertas/README.md`), e os dois têm a mesma forma: segredo em
variável de ambiente, `Authorization: Bearer` num arquivo de cabeçalho com permissão 600, e **503
quando o banco está fora** — que não é erro, é o RDS desligado pelo plano de economia.

---

## ⚠️ 0. QUANDO ARMAR ESTA LINHA

O último metro existe: `src/modules/shopfloor/infra/compels.ts` entrega cada linha da fila ao
**Compels** (Requisitar + Apontar, uma linha = um apontamento), usando o módulo
`src/modules/compels`. Spec: `docs/superpowers/specs/2026-10-16-integracao-compels-apontamento-design.md`.

**Só arme a linha depois de TODOS estes pontos:**

1. As migrações da fila estão no banco: **0132** (a fila), **0153** (a soma "já enviado por OP") e as
   da Fase 1 do posto (0128–0131, 0133), na ordem do cabeçalho de cada uma (a 0132 antes da 0129).
2. As variáveis da seção 1 estão no `.env.production` e o app foi reiniciado com `--update-env`.
3. A **autorização do Compels/Valdeí** para o usuário de serviço existe.
4. O **ensaio** (`tools/compels/ensaiar-entrada.mjs`) e a **primeira gravação real** (já feita com a OP
   8649) passaram no servidor.
5. `COMPELS_OPS_LIBERADAS` tem a(s) OP(s) que você quer ligar. **Vazia = nenhuma OP é enviada.**

**O que acontece com cada situação (importa para ler a tela de pendências):**

| Situação | O que a fila faz | Gasta tentativa? |
|---|---|---|
| OP não está em `COMPELS_OPS_LIBERADAS` | linha fica pendente com o motivo | **não** |
| OP aberta por alguém no Compels, sem empenho suficiente, pendência de material, falta de saldo de componente, Compels fora do ar (na leitura) | adia a linha ~5 min e tenta de novo sozinha | **não** |
| Estorno | fica pendente: "o estorno no Compels ainda é manual" | **não** |
| O Compels recusou a gravação, ou mostra um apontado diferente do que mandamos | falha, e a linha vai ao teto de 5 | **sim** |

Só as falhas **reais** chegam ao teto de **5** e saem da fila (botão **Reenviar** na tela de
pendências). Esperar empenho de um dia inteiro não derruba as linhas. Um lote de 30 só de linhas
"esperando" não trava as outras OPs: elas ganham ~5 min de espera e o laço segue para o lote seguinte.

**Ritmo:** cada linha faz ~12 chamadas ao Compels (≈ 2–4 s). A rodada anda até uns 40 s de
trabalho, então o fluxo é de dezenas de linhas por minuto: uma OP de 149 peças bipadas de uma vez
leva alguns minutos para chegar ao ERP. "Tempo real" aqui quer dizer **minutos**, não segundos.

---

## 1. Variável de ambiente

No `.env.production` da Lightsail (e, para testar, no `.env.local`):

```
ESTOQUE_CRON_SECRET=
COMPELS_EZPOINT_USUARIO=
COMPELS_EZPOINT_SENHA=
COMPELS_EZPOINT_EMPRESA=enterplak
COMPELS_ESTOQUE_ID=217
COMPELS_LOCACAO_ID=5314
COMPELS_OPS_LIBERADAS=
```

`COMPELS_EZPOINT_USUARIO` e `COMPELS_EZPOINT_SENHA` são o login do ezpointweb que gera o token do Compels
(**segredos: digite no servidor, nunca em chat nem no repositório**). `COMPELS_ESTOQUE_ID`/`COMPELS_LOCACAO_ID`
são o destino do produto acabado (estoque **PA**, locação **Padrão**). `COMPELS_OPS_LIBERADAS` é a lista de OPs
que a integração pode enviar, separadas por vírgula, ou `*` para todas; **vazia = nenhuma**.

Invente um segredo grande: `openssl rand -hex 24`. `SUPABASE_SERVICE_ROLE_KEY` já existe e é a
credencial com que a rota lê e escreve na fila (a `sf_estoque_reservar` é concedida **só** ao
`service_role`, porque reservar conta tentativa e esconde a linha por 15 minutos).

Depois de mudar variáveis: `pm2 restart shopfloor --update-env`. **Sem o `--update-env`** o processo
continua com o ambiente antigo e a rota responde **503 "Envio de estoque não configurado neste
ambiente."** como se a variável não existisse.

---

## 2. Antes de armar: a fila existe no banco?

A rota chama `sf_estoque_reservar` e escreve em `sf_estoque_envios`. Se as migrações da fila não
estiverem aplicadas no banco daquele ambiente, toda rodada responde **503** — o mesmo 503 do banco
fora, porque a resposta HTTP não muda. **No log do pm2 as duas se separam**: a função que falta não
parece falha de conexão, então a linha dela vem marcada `INESPERADO` (§5), e a do RDS desligado, não.

```sql
select to_regclass('public.sf_estoque_envios')      as tem_tabela,
       to_regprocedure('public.sf_estoque_reservar(integer)') as tem_funcao;
```

As duas colunas têm que vir preenchidas.

---

## 3. Crontab

O segredo **não** vai na linha do crontab **nem no argv do `curl`**: `-H "Authorization: Bearer
$(cat ...)"` expande o segredo na linha de comando, e **qualquer usuário da máquina vê com `ps`**.
Ele fica num **arquivo de cabeçalho** só do dono, com permissão **600**, que o `curl` lê com
`-H @arquivo`. O `umask 077` é o que garante que o arquivo **nasce** 600 — sem ele existe uma janela,
entre o `printf` e o `chmod`, em que o arquivo está legível para a máquina inteira:

```bash
# A sua shell NÃO tem o $ESTOQUE_CRON_SECRET: ele mora no .env.production, e quem carrega aquele
# arquivo é o pm2. Sem esta primeira linha o printf grava um Bearer VAZIO — e o erro só aparece na
# seção 4, como 401 no lugar do 200. (Alternativa: apague o `$ESTOQUE_CRON_SECRET` do printf e cole
# o valor à mão, entre aspas simples.)
set -a; . ~/ShopFloor/.env.production; set +a
umask 077
printf 'Authorization: Bearer %s\n' "$ESTOQUE_CRON_SECRET" > ~/.estoque-cron-header
chmod 600 ~/.estoque-cron-header
grep -c 'Bearer .' ~/.estoque-cron-header   # 1 = tem segredo; 0 = nasceu vazio, refaça
crontab -e
```

Linha a acrescentar — ela vem **comentada**; tire o `#` só depois de cumprir a seção 0:

```
# Fila de estoque do ShopFloor → Compels. O cron da Lightsail roda em UTC: aqui as rodadas vão de
# 09:00 a 21:59 UTC = 06:00–18:59 BRT, seg–sex — dentro do período em que o RDS fica ligado (plano
# de economia). Uma rodada por MINUTO, para a entrada chegar ao ERP em poucos minutos. O `flock -n`
# impede duas rodadas de se sobreporem na mesma máquina (a rodada pode passar de 60 s). Chama o app
# direto na própria máquina (127.0.0.1:3000), sem passar por DNS/nginx/TLS.
#* 9-21 * * 1-5 flock -n $HOME/.estoque-cron.lock curl -fsS -m 90 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/shopfloor/estoque >> $HOME/estoque.log 2>&1
```

Por que `-m 90` (e não os 60 dos Alertas): uma rodada reserva lotes de 30 enquanto o lote vier
cheio, e o orçamento de 40 s do laço decide apenas se ele **começa** outro lote — o lote já
começado termina. 90 s dá folga para isso sem deixar duas rodadas se sobrepondo (a reserva no banco
já impede duas rodadas de pegarem a mesma linha, mas rodada sobreposta gasta tentativa em dobro).

### Confira o fuso antes

A linha pressupõe que a máquina está em **UTC**:

```bash
date                              # mostra a hora e a sigla do fuso (UTC, -03, …)
timedatectl | grep 'Time zone'    # Time zone: Etc/UTC (UTC, +0000)
```

Se **não** estiver em UTC, ajuste as horas da linha para que a janela caia no expediente com o RDS
ligado. Em `America/Sao_Paulo` (UTC−3), `9-21` viraria `6-18`. Não troque o fuso da máquina só por
causa disto: a linha dos Alertas e o resto do que está agendado nela pressupõem o fuso atual.

Fora dessa janela (ou se o RDS estiver desligado por outro motivo) a rota responde **503** e não faz
nada além de registrar. **Isso é esperado, não é um alarme.**

---

## 4. Conferir

- `curl -i -X POST http://127.0.0.1:3000/api/shopfloor/estoque` → **401** (sem segredo).
- Com o cabeçalho → **200** com `{"enviados":N,"falhas":N}`:
  `curl -fsS -m 90 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/shopfloor/estoque`
  Enquanto o `compels.ts` não existir, o esperado é `{"enviados":0,"falhas":N}` — e **cada uma
  dessas N gastou uma tentativa** (veja a seção 0 antes de repetir o comando).
- Sem `ESTOQUE_CRON_SECRET` no ambiente → **503** `{"erro":"Envio de estoque não configurado neste
  ambiente."}`.
- Com o RDS desligado → **503** `{"erro":"Banco indisponível."}`.

---

## 5. Ler o log

São **dois** lugares, e eles se completam:

**`~/estoque.log`** (o que o `curl` do crontab escreveu) — uma linha por rodada, em ordem:

- `{"enviados":12,"falhas":0}` → a rodada entregou 12.
- `curl: (22) The requested URL returned error: 503 …` → a rodada **não aconteceu**: banco fora
  (esperado fora do horário) ou segredo não configurado. O `-f` faz o `curl` não imprimir o corpo do
  503, então é no log do pm2 que está qual dos dois foi.

**`pm2 logs shopfloor`** (o que a rota e o laço escreveram) — toda linha começa com `[estoque]` e
carrega a data, e é aqui que está o **motivo**:

- `[estoque] <data> rodada: 12 enviado(s), 0 falha(s)` — rodada limpa (vai para a saída normal).
- `[estoque] envio ALMOX/… falhou: <motivo>`, **uma por linha que não chegou ao ERP**, seguido de
  `[estoque] <data> rodada: 0 enviado(s), 12 falha(s) — cada falha escreveu o motivo dela acima` — a
  rodada com falha sai no **log de erro**, junto dos motivos, de propósito: quem abre o log de erro
  de manhã lê os motivos e, logo abaixo, de quantas rodadas eles são. Enquanto o `compels.ts` não
  existir, o motivo de todas é o mesmo: `Integração com o Compels ainda não configurada (faltam
  endpoint, autenticação e formato da carga)…`.
- `[estoque] linha da fila ilegível …` — linha com dado que o código não entende. **É o outro lugar
  de onde vem motivo** (quem a escreve é o repositório, não o laço): a linha é concluída como falha,
  conta na contagem da rodada e aparece na tela de pendências. É a única dessas que pede alguém
  olhando.
- `[estoque] <data> rodada não aconteceu: banco indisponível — ESPERADO fora do horário …` — é o
  RDS desligado. **Não é incidente.**
- `[estoque] <data> rodada não aconteceu: INESPERADO — a falha NÃO parece de conexão … Motivo: <…>` —
  a rodada morreu por algo que **não** é o RDS dormindo (um erro de código, uma migração que falta,
  uma credencial recusada). **Esta pede investigação**, e é por essa palavra que se filtra o log:

  ```bash
  pm2 logs shopfloor --err --lines 2000 --nostream | grep INESPERADO
  ```

  A rota não sabe o motivo de verdade — só tem o texto do erro —, então o rótulo é um palpite dela:
  mensagem com cara de conexão (`ECONNREFUSED`, `fetch failed`, `timeout`…) vira "esperado", o resto
  vira `INESPERADO`. A resposta HTTP é **503 nos dois casos**, de propósito: acordar alguém de
  madrugada é pior que uma rodada perdida, e quem decide se vale investigar é esta palavra no log.
- `[estoque] <data> rodada não aconteceu: ESTOQUE_CRON_SECRET não está no ambiente …` — faltou a
  variável (ou faltou o `pm2 restart --update-env`).

O que **não** está no log: a lista do que continua pendente. Isso é a tela de pendências
(**Análise → Estoque pendente**), que mostra linha por linha com o motivo da última tentativa.
