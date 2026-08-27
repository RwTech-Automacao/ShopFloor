# Checklist do CORTE (Fase 7) — produção Vercel → AWS

> **Objetivo:** virar a produção do ShopFloor do Vercel (+ Supabase cloud) para a AWS
> (Lightsail + Supabase self-hosted + RDS), numa janela fora de expediente, com dado
> fresco e **plano de rollback**.

## ✅ DECISÃO TRAVADA (2026-08-27): Opção B — domínio real
- **App:** `shopfloor.enterplak.com.br` → Lightsail (Next.js, 127.0.0.1:3000)
- **API:** `api.shopfloor.enterplak.com.br` → Supabase self-host (Envoy, 127.0.0.1:8000)
- Exige: trocar DNS no Locaweb + `/etc/hosts` (hairpin) + nginx `server_name` + certbot + **rebuild** (a URL da API é baked) + rollback = DNS de volta pro Vercel.

## Valores concretos (preencher/conferir)
- **IP do Lightsail:** `35.168.119.35`
- **RDS host:** `shopfloor-prod-db.c4dc8qyyckst.us-east-1.rds.amazonaws.com` (porta 5432, user `postgres`, `sslmode=require`)
- **Cloud Prod (pooler, pro dump fresco):** `postgresql://postgres.ykwkacfviarhfmxeisqk@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`
- **Repo na instância:** `~/ShopFloor` · **Supabase docker:** `~/supabase/docker`
- **A ÚNICA env de app que muda:** `NEXT_PUBLIC_SUPABASE_URL=https://api.shopfloor.enterplak.com.br` (o app só lê essa + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `FOTOS_STORAGE` + `GOOGLE_*`). Sem SITE_URL/redirect.

## Fatos que já valem a favor (não refazer no corte)
- **Grant do schema `auth` JÁ aplicado no RDS** (fix `b1f32f2`) e **sobrevive** ao `drop schema public` (é no schema `auth`, não no `public`). Não precisa reaplicar. Mas o `bootstrap-rds.sql` corrigido é a fonte se algum dia recriar o RDS.
- **Chaves NÃO mudam** staging→corte: o stack self-host já usa as chaves definitivas (anon/service/JWT). O login do pessoal cai só porque saem do **cloud** (JWT do cloud ≠ self-host) → todos re-logam uma vez. Avisar.
- **Bootstrap de roles/schemas/extensões já feito** no RDS. O corte é só **dado fresco + domínio**.

---

## 1) Pré-corte (dias antes — sem downtime)
- [ ] Staging 100% aprovado (smoke completo: login, bipe, foto/câmera, fluxo, análise).
- [ ] `deploy.sh` testado (um deploy de teste rodou limpo).
- [ ] **Opção B:** criar subdomínios `shopfloor` (se ainda não) e `api.shopfloor` no Locaweb —
      **ainda apontando pro Vercel/atual**; só troca o A na hora do corte.
- [ ] Avisar o time: data/hora da janela + "vão precisar re-logar" (JWT secret novo).
- [ ] Confirmar acesso ao painel do Locaweb (DNS) e à instância (SSH).
- [ ] Ter à mão a senha master do RDS e a senha do cloud Prod (pro dump).

## 2) Na janela (fora de expediente)
1. [ ] Avisar/colocar aviso de manutenção.
2. [ ] **Congelar o Prod:** pausar o uso (idealmente ninguém bipando) — evita perder registros
       entre o dump e a virada.
3. [ ] **Dump FRESCO do cloud** (⚠️ ordem: auth ANTES de public por causa da FK do usuarios):
   ```bash
   cd ~/backups
   pg_dump "postgresql://postgres.ykwkacfviarhfmxeisqk@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" --data-only --no-owner -t auth.users -t auth.identities -f corte-auth.sql
   pg_dump "postgresql://postgres.ykwkacfviarhfmxeisqk@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" --no-owner --no-privileges -n public -f corte-public.sql
   ```
4. [ ] **Limpar o dado do ensaio no RDS** e restaurar o fresco:
   ```bash
   # zera o public do ensaio (mantém roles/schemas/extensões e o auth/storage do GoTrue)
   psql "host=<rds> user=postgres sslmode=require" -c "drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role;"
   psql "host=<rds> user=supabase_auth_admin sslmode=require" -c "truncate auth.identities, auth.users cascade;"
   # restaura auth PRIMEIRO, depois public
   psql "host=<rds> user=supabase_auth_admin sslmode=require" -v ON_ERROR_STOP=0 -f corte-auth.sql
   psql "host=<rds> user=postgres sslmode=require" -v ON_ERROR_STOP=0 -f corte-public.sql
   # re-grants no public (novas tabelas) + recarrega o PostgREST
   psql "host=<rds> user=postgres sslmode=require" -c "grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role; grant all on all routines in schema public to anon, authenticated, service_role; grant all on all sequences in schema public to anon, authenticated, service_role;"
   cd ~/supabase/docker && docker compose restart rest
   ```
   *(fotos NÃO precisam migrar — ficam no Google Drive.)*
5. [ ] **Opção B — domínios reais:**
   - [ ] Locaweb: mudar o **A** de `shopfloor` e `api.shopfloor` → **35.168.119.35**.
   - [ ] `/etc/hosts` da instância: adicionar `127.0.0.1 shopfloor.enterplak.com.br api.shopfloor.enterplak.com.br` (hairpin).
   - [ ] nginx: trocar `server_name` pros domínios reais (`sudo nano /etc/nginx/sites-available/shopfloor-aws`) → `sudo nginx -t && sudo systemctl reload nginx`.
   - [ ] certbot: `sudo certbot --nginx -d shopfloor.enterplak.com.br -d api.shopfloor.enterplak.com.br`.
   - [ ] `.env.production`: `NEXT_PUBLIC_SUPABASE_URL=https://api.shopfloor.enterplak.com.br` (e SITE_URL se o app usar).
   - [ ] **Rebuild** (URL é baked): `cd ~/ShopFloor && ./deploy.sh` (ou build+restart manual).
6. [ ] **Opção A:** nada de DNS/rebuild — já está no ar em `awsshopfloor`.

## 3) Verificação (smoke pós-corte, pelo domínio de produção)
- [ ] Login com usuário real.
- [ ] Ver ordens/processos (dado fresco).
- [ ] Um bipe (grava no RDS).
- [ ] Uma foto (Drive).
- [ ] Fluxo / Análise abrindo.

## 4) Plano de ROLLBACK (se quebrar)
- [ ] **DNS de volta pro Vercel:** reverter o A de `shopfloor`/`api.shopfloor` pro valor antigo.
      O Vercel + Supabase cloud continuam de pé → volta em minutos.
- [ ] Não desligar nada do Vercel/cloud até a AWS estar validada.

## 5) Pós-corte
- [ ] Só depois de validado: desligar/pausar Vercel e Supabase cloud (guardar o dump final).
- [ ] Fechar a porta **8000** do firewall do Lightsail (era só teste).
- [ ] Trocar o PAT no `.git/config` da instância por credential helper.
- [ ] Considerar Automatic Snapshots do Lightsail + backup do RDS (já ligado).
- [ ] Atualizar a versão em "Sobre" se aplicável.

## Gotchas (não esquecer)
- Ordem do restore: **auth ANTES de public** (FK usuarios_id_fkey → auth.users).
- Depois de restaurar/alterar tabela: **`docker compose restart rest`** (cache do PostgREST).
- **Hairpin:** os domínios de prod TÊM que estar no `/etc/hosts` da instância → 127.0.0.1.
- `NEXT_PUBLIC_*` é **baked no build** → trocar domínio da api = **rebuild**.
- Login cai pra todos (JWT secret do self-host ≠ do cloud) → avisar.
- **Server Action "x" not found:** depois de um rebuild, abas velhas dão esse erro até dar F5. No corte (rebuild da URL nova), avisar "atualizem a página (F5)". Some sozinho.
- **Reboot da instância:** há `*** System restart required ***` pendente (kernel). Reiniciar ANTES do corte, numa janela, e conferir que **pm2** (`pm2 list` → shopfloor online; startup já configurado) e **docker/Supabase** (`cd ~/supabase/docker && docker compose ps` → tudo up; restart policy) voltam sozinhos. Não deixar pro dia do corte.
