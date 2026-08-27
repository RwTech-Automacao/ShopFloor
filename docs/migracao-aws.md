# Migração ShopFloor → AWS (runbook)

> **Objetivo:** tirar app + banco do Vercel/Supabase-cloud e rodar em infra própria na AWS.
> **Escopo desta primeira leva:** **só Produção**. Dev continua no Supabase cloud atual.
> **Decidido (2026-08-25):** app + Supabase self-hosted na **mesma instância Lightsail**; Postgres no **RDS**; Storage no **S3**.
> **Gatilho:** deploy do Vercel travado (repo mudou de dono no GitHub, acesso do Vercel App na org pendente).

## O que o app usa (levantado no código)
- **Auth (GoTrue)** — login. ✅ precisa.
- **PostgREST + RPCs** — coração do app. ✅ precisa.
- **Storage** — anexos do Recebimento. ✅ precisa (→ S3).
- **Realtime** — ❌ NÃO usa. Pula o container de realtime e **não precisa de logical replication** no RDS (simplifica muito).
- **Vault/pgsodium, pg_graphql, pg_cron, pg_net** — não usa. Pula (o cron do repinmetro é externo/systemd, não pg_cron).

## Arquitetura final
```
Internet
  ├─ shopfloor.enterplak.com.br   → Lightsail (nginx+TLS) → App Next.js (:3000)
  └─ api.shopfloor.enterplak.com.br → Lightsail (nginx+TLS) → Kong do Supabase (:8000)
        Supabase self-hosted (docker-compose) na MESMA instância:
          Kong · GoTrue · PostgREST · Storage(→S3) · Studio · postgres-meta
                          │
                          ▼
                    RDS PostgreSQL (banco)
        S3 bucket (arquivos do Storage)
```
> ⚠️ O `NEXT_PUBLIC_SUPABASE_URL` é usado **pelo navegador** (login/anon) → o Kong precisa estar **público via HTTPS** (subdomínio `api.shopfloor…`), não só localhost.

## Sizing recomendado
- **Lightsail:** Ubuntu 22.04, **8 GB RAM / 2 vCPU** (o build do Next usa `--max-old-space-size=6144`; app + ~6 containers do Supabase pesam). Alternativa: 4 GB + **swap** (build mais apertado). IP estático.
- **RDS:** PostgreSQL **15** (casar com o Supabase cloud atual), `db.t4g.small`, 20 GB gp3, backups automáticos ligados, **região us-east-1**.

---

## Fase 1 — RDS
1. Criar RDS PostgreSQL 15, us-east-1, `db.t4g.small`, 20 GB gp3, Multi-AZ off (Prod pequeno), backups automáticos.
2. **Parameter group:** `shared_preload_libraries = pg_stat_statements` (Realtime OFF → **NÃO** precisa `rds.logical_replication`).
3. **Rede (gotcha):** Lightsail e RDS ficam em redes diferentes por padrão.
   - Opção A (recomendada): **VPC peering do Lightsail** com a VPC default + RDS **não-público**, security group liberando a faixa do peering.
   - Opção B (mais simples, menos seguro): RDS **público** + security group liberando **só o IP estático** do Lightsail.
4. Guardar endpoint, porta, master user/senha (senha **fora do chat/commit**).

## Fase 2 — Instância Lightsail
1. Ubuntu 22.04, 8 GB, IP estático.
2. Instalar: `docker` + `docker compose`, `node 20`, `nginx`, `certbot`.
3. (Se Opção A) habilitar **VPC peering** no Lightsail; testar `psql` no RDS a partir da instância.
4. Firewall Lightsail: abrir 80/443 (o resto interno).

## Fase 3 — Bootstrap do RDS pro Supabase  ⚠️ (parte mais delicada)
O compose do Supabase normalmente inicializa roles/schemas/extensões no Postgres embutido. No RDS a gente faz **à mão** (e RDS **não tem superuser** — usa `rds_superuser`):
1. **Extensões:** `pgcrypto`, `uuid-ossp` (ou usar `gen_random_uuid` nativo), `pg_stat_statements`. *(pular `pgjwt`, `pgsodium`, `pg_graphql`, `vault` — indisponíveis/desnecessários; ver nota abaixo)*
2. **Roles:** `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user` (+ grants).
3. **Schemas:** `auth`, `storage`, `extensions` (o `public` já existe).
4. GoTrue e Storage rodam **as próprias migrações** ao subir (criam as tabelas em `auth`/`storage`).
> **Nota pgjwt:** o RDS não tem a extensão `pgjwt`. O PostgREST valida o JWT com o `JWT_SECRET` dele (config), não com pgjwt — então dá pra seguir sem. Só é preciso **podar** referências a pgjwt/pgsodium dos scripts de init do Supabase.
> **→ Eu preparo o `bootstrap-rds.sql`** (roles + schemas + extensões + grants, adaptado pra RDS sem superuser).

## Fase 4 — Supabase self-hosted (docker-compose)
1. `git clone` do `supabase/docker`.
2. `.env` apontando pro **RDS** (`POSTGRES_HOST=<endpoint RDS>`, `POSTGRES_PORT=5432`, `POSTGRES_DB`, `POSTGRES_PASSWORD`).
3. **Remover/`disable` o serviço `db`** (não usamos o Postgres embutido) e tirar os `depends_on: db`.
4. **Gerar chaves novas:** `JWT_SECRET` (novo), `ANON_KEY` e `SERVICE_ROLE_KEY` (gerados a partir do secret — o Supabase tem gerador). *(chaves/segredos **fora do chat/commit**)*
5. `SITE_URL=https://shopfloor.enterplak.com.br`, `API_EXTERNAL_URL=https://api.shopfloor.enterplak.com.br`.
6. **Storage → S3:** `STORAGE_BACKEND=s3`, `GLOBAL_S3_BUCKET`, região, credenciais IAM (bucket próprio + usuário IAM restrito).
7. Subir só o necessário: `kong`, `auth (gotrue)`, `rest (postgrest)`, `storage`, `meta`, `studio`. **Sem `realtime`.**
8. Conferir migrações do GoTrue/Storage aplicadas no RDS.
> **→ Eu preparo** o `.env` template + o `docker-compose.override.yml` (sem `db`/`realtime`, Storage no S3).

## Fase 5 — Migração de dados
1. Dump do Prod atual (já temos um base em `~/backups/`): schema `public` **+ dados**, `auth` (usuários), `storage` (metadados de objetos).
2. Restaurar no RDS (após o bootstrap da Fase 3). Reconciliar owners/roles.
3. **Arquivos do Storage:** copiar o conteúdo do bucket atual do Supabase → **S3**.
4. Conferir: contagem de linhas, `sf_ordens`/`sf_registros`, e `auth.users` (todo mundo consegue logar).
> **→ Eu preparo** o script de dump/restore (com as flags certas pra `auth`/`storage`).

## Fase 6 — App Next.js na instância
1. `git clone` do projeto (branch de produção) na instância.
2. `.env.production` com: `NEXT_PUBLIC_SUPABASE_URL=https://api.shopfloor.enterplak.com.br`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=<nova>`, `SUPABASE_SERVICE_ROLE_KEY=<nova>`, + as de storage/Drive se seguirem.
3. `NODE_OPTIONS="--max-old-space-size=6144" npm run build` → `npm run start` (via **pm2** ou container).
4. **nginx:** `shopfloor…` → app `:3000`; `api.shopfloor…` → Kong `:8000`. TLS com **certbot** nos dois.
> **→ Eu preparo** o `nginx.conf` (2 server blocks) + o `ecosystem.config` do pm2 (ou Dockerfile).

## Fase 7 — Corte (cutover)
1. Testar tudo pela instância (IP ou subdomínio de staging): login, bipe, fluxo, recebimento, anexos (S3).
2. Repontar o DNS `shopfloor.enterplak.com.br` → **IP estático do Lightsail**; criar `api.shopfloor…` → mesmo IP.
3. Emitir TLS (certbot).
4. **Avisar o time:** sessões atuais caem (JWT secret novo) → todo mundo loga de novo.

## Fase 8 — Pós-corte
1. Backups: RDS automático + (opcional) `pg_dump` cron pra S3.
2. Monitor básico (uptime, disco, RAM da instância).
3. Só **depois de validado**: desligar Vercel e o Supabase cloud Prod. **Guardar o dump final** antes.

---

## Gotchas (resumo pra não esquecer)
- **Lightsail ↔ RDS** não se enxergam por padrão → VPC peering (ou RDS público + SG travado no IP).
- **RDS sem superuser** → bootstrap manual de roles/schemas/extensões; podar pgjwt/pgsodium/vault.
- **Realtime não usado** → não sobe o container nem liga logical replication (ganho grande).
- **Chaves mudam** (JWT/anon/service) → login cai no corte; envs do app trocam.
- **`NEXT_PUBLIC_SUPABASE_URL`** tem que ser **HTTPS público** (subdomínio do Kong).
- **Storage → S3** → migrar arquivos + IAM restrito ao bucket.
- **Segredos** (senha RDS, service key, IAM) **nunca no chat/commit**.

## O que eu já posso preparar (é só pedir)
1. `bootstrap-rds.sql` — roles + schemas + extensões + grants (adaptado pra RDS).
2. `.env` template + `docker-compose.override.yml` do Supabase (sem db/realtime, Storage no S3).
3. Script de **dump/restore** (public + auth + storage) do Supabase cloud → RDS.
4. `nginx.conf` (app + api) + pm2/Dockerfile do Next.
5. Checklist de smoke pós-corte.

## Valores coletados (não-secretos) — preencher templates com estes
- **Região:** `us-east-1`
- **S3 bucket:** `shopfloor-storage-prod`
- **IAM user:** `shopfloor-storage` (chave guardada com o usuário — fora do repo)
- **Lightsail:** instância `shopfloor-prod` (Ubuntu 24.04, 4 GB) · **IP público estático `35.168.119.35`** · IP privado `172.26.12.119`
- **RDS:** endpoint `shopfloor-prod-db.c4dc8qyyckst.us-east-1.rds.amazonaws.com` · porta 5432 · master user `postgres` · DB `postgres` · PG 15.18 · **SSL exigido** (sslmode=require)
- **SG do RDS:** liberar 5432 só de `35.168.119.35/32`

## Progresso
- ✅ **Fase 1 (RDS)** criada (`shopfloor-prod-db`, PG 15.18, Available).
- ✅ **S3 + IAM** criados (`shopfloor-storage-prod`, user `shopfloor-storage`).
- ✅ **Lightsail** `shopfloor-prod` (4 GB) + IP estático `35.168.119.35`.
- ✅ **SG** `shopfloor-rds-sg` libera 5432 do IP do Lightsail; **conexão Lightsail→RDS testada OK (SSL)**.
- ✅ **Fase 3 (bootstrap-rds.sql)** rodado com sucesso (removido `replication` do supabase_admin — RDS não permite; sem Realtime não precisa).
- ⏳ **Fase 2 (Docker no Lightsail)** e **Fase 4 (Supabase self-host)** — próximas.
- Senha usada: a MESMA do master do RDS serve pros papéis do Supabase (vai como `POSTGRES_PASSWORD` no .env).

## Consertar o deploy (2 opções)

**Causa do deploy travado:** o repo foi transferido pra org `RwTech-Automacao` no GitHub; o Vercel App não tem acesso ao repo na org (erro "The provided GitHub repository can't be found") → o webhook de push está morto → nada deploya (nem branch, nem main).

### Opção A — consertar o Vercel (interino, rápido)
Serve pra colocar a main no ar enquanto a AWS não fica pronta.
1. **Um OWNER da org GitHub** libera o acesso do Vercel App ao repo:
   - GitHub → org **`RwTech-Automacao`** → Settings → **GitHub Apps** (Installed) → **Vercel** → **Configure** → em "Repository access" → **All repositories** (ou adicionar **ShopFloor**) → Save.
2. Vercel → projeto **`shop-floor`** → Settings → **Git** → **Disconnect** → **Connect Git Repository** → `RwTech-Automacao/ShopFloor` (recria o webhook).
3. Faz qualquer push (ou **Redeploy**) → deve deployar.
- **Sem esperar aprovação:** Vercel **CLI** — `npx vercel login` → `npx vercel link` (projeto shop-floor) → `npx vercel --prod` (produção) ou `npx vercel` (preview). Bypassa o webhook.
- ⚠️ Se deployar a **main** no Vercel (=produção), lembra: as branches `feat/shopfloor-ajustes` / `fluxo-load` ainda NÃO estão mergeadas e as migrações **0081/0083/0084** ainda não foram pro Prod.

### Opção B — deploy na AWS (destino final = Fase 6 do runbook)
Depende de terminar Fase 2+4+5 (Supabase self-host + migração de dados). Depois: app na instância Lightsail (git clone + `.env.production` com URL do self-host + keys + build + pm2 + nginx `shopfloor→app` / `api.shopfloor→Kong` + certbot). Detalhes na Fase 6 acima.

---

## RETOMAR (pausa 2026-08-27)

**Estado: APP NO AR NA AWS (staging).** `https://awsshopfloor.enterplak.com.br` funcionando — login OK, dados migrados, https. Deploy completo: pm2 (`shopfloor`) + nginx (app→:3000, api→:8000) + certbot TLS + `/etc/hosts` (hairpin) + firewall 443. Supabase self-hosted no RDS; ensaio de dados migrado (public 34 tbl / sf_registros 14124 / auth.users 11). Fotos = **Google Drive** (não migra pro S3).

**Deploy daqui pra frente:** `deploy/aws/deploy.sh` (na instância: `cd ~/ShopFloor && ./deploy/aws/deploy.sh`). Migração de banco é manual (psql no RDS + `docker compose restart rest`). Vercel = preview; AWS = prod real (deploy manual da main).

**PRÓXIMO (escolher):** (1) smoke completo no staging (bipe/foto/fluxo, vários aparelhos); (2) **CORTE** → seguir `deploy/aws/checklist-corte.md`; (3) voltar pras features.

**LIMPEZA:** restaurar `.env.local` do PC (`cp .env.local.bak .env.local` — hoje aponta pra AWS), fechar 8000 do firewall, trocar o PAT do `.git/config` da instância.

**Comando do smoke da API (caso precise repetir):**
```bash
cd ~/supabase/docker && docker compose restart rest && sleep 6
# depois:
SVC=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
curl -s "http://localhost:8000/rest/v1/sf_ordens?select=cliente,pmo,op&limit=3" -H "apikey: $SVC" -H "Authorization: Bearer $SVC"; echo
```
→ deve voltar 3 ordens em JSON = motor validado ponta a ponta.
> **Regra:** toda vez que restaurar/alterar tabelas, recarregar o PostgREST (`docker compose restart rest` ou `notify pgrst, 'reload schema'`).

**PRÓXIMOS PASSOS:**
1. ✅ Smoke da API (3 ordens) — feito. Retomar testando **WRITE (bipe) + foto nova (S3)** (ver "FALTA TESTAR" acima).
2. **Fase 5d — arquivos do Storage → S3** (dump do bucket cloud → `aws s3 sync` pro `shopfloor-storage-prod`).
3. **Fase 6 — subir o app Next no Lightsail:** git clone (precisa deploy key/PAT do repo `RwTech-Automacao/ShopFloor`) → `.env.production` (`NEXT_PUBLIC_SUPABASE_URL`, keys novas, storage) → `npm run build` (com swap) → `pm2` → **nginx** (`shopfloor→:3000`, `api.shopfloor→:8000`) → **certbot** (TLS).
4. **Para testar ANTES do domínio:** abrir a porta **8000** no firewall do Lightsail + `NEXT_PUBLIC_SUPABASE_URL=http://35.168.119.35:8000` num `.env` local, rodar o app local e logar (usuário real, senha do Prod).
5. **Fase 7 — corte real:** janela fora de expediente, Prod em leitura → dump fresco (**auth ANTES do public** por causa da FK do `usuarios`) → restaurar no RDS → `aws s3 sync` final → trocar DNS → todo mundo re-loga (JWT secret novo).

**Comandos/segredos:** `psql`/`pg_dump` **PERGUNTAM a senha** (não usar PGPASSWORD/read — o terminal do navegador embola). Rodar **uma linha por vez**. Senha do RDS = master; senha do cloud Prod = a **resetada hoje**; papéis do Supabase = mesma senha do master.
