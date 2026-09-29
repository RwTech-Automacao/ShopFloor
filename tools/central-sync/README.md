# Sincronização com a Central do Cliente — configurar e operar

De hora em hora (minuto 7, seg-sex, só no horário em que o RDS fica ligado), o ShopFloor manda pra
**Central do Cliente** uma "foto" mínima — só o que o cliente pode ver — dos processos de
recebimento e das ordens que têm ACP. O contrato inteiro (versão 1) está definido no plano
`docs/superpowers/plans/2026-09-29-central-do-cliente-5-sincronizacao.md` do repositório
Central-Do-Cliente. Nunca vão colaborador, defeito, número de série, fornecedor, NF, comprador ou
quantidade de reprovação — essas colunas nem existem nas linhas que a 0134 seleciona.

## 0. O contrato do envio (versão 1)

`POST /api/sincronizacao` da Central espera exatamente este corpo (nenhuma chave além destas;
`dataChegada`/`primeiroRegistro` são `aaaa-mm-dd` ou `null`):

```json
{
  "versao": 1,
  "geradoEm": "2026-09-29T15:07:00.000Z",
  "recebimentos": [{ "id": "uuid", "projetos": "ACP017/26 GM", "numeroEmb": "EMB347EA", "dataChegada": "2026-10-05", "situacao": "finalizado" }],
  "ordens": [{ "id": "uuid", "projetos": "ACP017/26", "primeiroRegistro": "2026-10-08", "concluida": false }]
}
```

## 1. As três variáveis

Server-only, nenhuma delas pode ir pro repositório. Sem qualquer uma das três, a rota
`POST /api/central/sincronizar` responde **503** e o resto do ShopFloor segue normal.

```
CENTRAL_SYNC_CRON_SECRET=
CENTRAL_SYNC_SECRET=
CENTRAL_SYNC_URL=
```

- **`CENTRAL_SYNC_CRON_SECRET`**: do crontab da Lightsail pra rota do ShopFloor. Só o ShopFloor
  precisa conhecer este valor.
- **`CENTRAL_SYNC_SECRET`**: do ShopFloor pra Central — vai no cabeçalho `Authorization: Bearer` do
  `POST /api/sincronizacao` dela. **Na Central este mesmo valor mora em `SINCRONIZACAO_SECRET`** —
  os dois lados têm que ter EXATAMENTE o mesmo segredo, ou toda sincronização vira 401.
- **`CENTRAL_SYNC_URL`**: a base da Central, sem barra no final — `http://127.0.0.1:3100` pra
  testar local (a Central rodando com `npm run dev -- --port 3100`, por exemplo) ou
  `https://central.enterplak.com.br` em produção. A Central precisa estar na raiz do domínio: um
  caminho na URL (ex.: `https://host/central`) é ignorado.

## 2. Gerar os segredos

Dois segredos aleatórios, sem relação um com o outro:

```bash
openssl rand -hex 32   # CENTRAL_SYNC_CRON_SECRET
openssl rand -hex 32   # CENTRAL_SYNC_SECRET (== SINCRONIZACAO_SECRET na Central — copie o mesmo valor pros dois lados)
```

No `.env.production` da Lightsail do ShopFloor (e, para testar, no `.env.local` ou no Preview da
Vercel) e no `.env` da Central, ambiente correspondente. Depois de mudar variáveis no ShopFloor:
`pm2 restart shopfloor --update-env`.

## 3. Arquivo de cabeçalho do cron (permissão 600)

Mesma regra dos Alertas (`tools/alertas/README.md` §5): o segredo **não** vai na linha do crontab
nem no argv do `curl` (`ps` de qualquer usuário da máquina veria). Ele mora num arquivo só do dono:

```bash
umask 077
printf 'Authorization: Bearer %s\n' "$CENTRAL_SYNC_CRON_SECRET" > ~/.central-sync-cron-header
chmod 600 ~/.central-sync-cron-header
```

## 4. Crontab

```bash
crontab -e
```

Linha a acrescentar (pronta):

```
# Sincronização com a Central do Cliente, de hora em hora no minuto 7, seg-sex — só no horário em
# que o RDS fica ligado (plano de economia). Chama o app direto na própria máquina (127.0.0.1:3000).
7 9-21 * * 1-5 curl -fsS -m 120 -X POST -H @$HOME/.central-sync-cron-header http://127.0.0.1:3000/api/central/sincronizar >> $HOME/central-sync.log 2>&1
```

**Confira o fuso antes** (`date` e `timedatectl | grep 'Time zone'`): a linha acima pressupõe a
Lightsail em **UTC** — `9-21 UTC` = `06:07–18:07` no horário de Brasília (sem horário de verão no
Brasil hoje). Se a máquina **não** estiver em UTC, ajuste as horas. Fora desse horário (ou com o
RDS desligado por outro motivo) a rota responde **503** e o log registra — não é um alarme.

## 5. Migração 0134 — aplicar no Dev e depois no Prod

Cria o índice `sf_registros_pmo_op_data_hora` e as funções `central_recebimentos_para_sincronizar`
/ `central_ordens_para_sincronizar` (`grant execute` só pra `service_role`).

⚠️ **Numeração**: a `main` deste repositório vai até a 0127; a branch `feat/posto-almoxarifado`
(não mergeada) já tem 0128-0133 commitados localmente. A 0134 usa `max(main, 0133) + 1`. **Se essa
branch ganhar uma 0134 própria antes do merge, uma das duas migrações precisa ser renumerada.**

### Dev

Duas formas — escolha uma:

- **SQL Editor do Supabase:** cole o conteúdo de `supabase/migrations/0134_central_sincronizacao.sql`
  e **remova a palavra `concurrently`** da linha do `create index` antes de rodar (o SQL Editor roda
  dentro de uma transação implícita, e `create index concurrently` não roda em transação — mesmo
  caso da 0091/0095/0114).
- **`psql -f`** (sem `-1`, igual ao Prod abaixo), apontando pro Postgres do Dev — nesse caso o
  arquivo **não** precisa ser editado: `psql -f` (sem `-1`/`--single-transaction`) não abre uma
  transação envolvendo tudo, então `create index concurrently` roda como fora de transação.

### Prod (RDS, via `psql` na instância Lightsail)

**Separada e SEM `-1`** — `create index concurrently` não roda dentro de transação:

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W \
  "host=shopfloor-prod-db... user=postgres sslmode=require" \
  -v ON_ERROR_STOP=1 -f supabase/migrations/0134_central_sincronizacao.sql

cd ~/supabase/docker && docker compose restart rest   # recarrega o schema do PostgREST (a própria
                                                        # migração já manda `notify pgrst, 'reload schema'`)
```

Depois de qualquer um dos dois ambientes, confira que o índice não ficou **inválido** (mesmo risco
de qualquer `create index concurrently` que falha no meio — ver `tools/alertas/README.md` §6):

```sql
select indisvalid from pg_index where indexrelid = 'sf_registros_pmo_op_data_hora'::regclass;
```

Tem que dar `true`. Se der `false`, o índice ficou pela metade — apague e recrie:

```sql
drop index concurrently if exists public.sf_registros_pmo_op_data_hora;
```

E rode a 0134 de novo (mesma forma usada da primeira vez: SQL Editor sem `concurrently`, ou `psql -f`).

Teste local da migração (Postgres descartável, nada aplicado em banco nenhum):
`supabase/tests/rodar-central-test.sh`.

## 6. Primeira sincronização manual

Com as três variáveis já configuradas no ambiente e a migração 0134 já aplicada. **Sem `-f`** —
diferente da linha do crontab (§4): com `-f` o curl engole o corpo em qualquer erro HTTP, e é
exatamente o `{erro: "..."}` que interessa ver na primeira vez:

```bash
curl -i -sS -m 120 -X POST -H @$HOME/.central-sync-cron-header http://127.0.0.1:3000/api/central/sincronizar
```

## 7. O que cada resposta significa

- **503** — `CENTRAL_SYNC_CRON_SECRET`, `CENTRAL_SYNC_SECRET` ou `CENTRAL_SYNC_URL` vazia neste
  ambiente, OU o banco do ShopFloor não respondeu (RDS desligado, fora do horário do cron — ver
  §4). Log `[central] ...` com o motivo. Nada foi enviado.
- **401** — o cabeçalho `Authorization` não bate com `CENTRAL_SYNC_CRON_SECRET`. Confira o arquivo
  `~/.central-sync-cron-header` (regenerado? variável trocada sem atualizar o arquivo?).
- **502** — a Central não respondeu (fora do ar, DNS, timeout de 60s no envio) OU respondeu algo
  diferente de 200 (por exemplo 401 dela — `CENTRAL_SYNC_SECRET` diferente do `SINCRONIZACAO_SECRET`
  da Central). O status dela vai pro log `[central] Central respondeu <status>`.
- **409 da Central** (dentro de um 502 aqui, já que não é 200) — a foto saiu **vazia** (zero
  recebimentos e zero ordens) e a Central já tem dados: ela recusa de propósito, pra um bug no
  ShopFloor não apagar tudo lá. Investigue por que a 0134 não achou nenhuma linha com ACP antes de
  insistir.
- **500** — a foto não pôde ser montada (uma linha veio com algo fora do contrato — por exemplo uma
  `situacao` que a 0134 não deveria ter deixado passar) ou uma falha inesperada estourou na rota.
  Nada foi enviado pra Central. Log `[central] ...` com o detalhe; investigue o banco/a 0134 antes
  de insistir.
- **200** — sucesso. O corpo é o resumo que a própria Central devolveu (novos/atualizados/removidos
  de recebimentos e ordens).
