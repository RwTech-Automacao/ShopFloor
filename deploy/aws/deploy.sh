#!/usr/bin/env bash
# deploy.sh — deploy do ShopFloor na instância AWS (Lightsail) em 1 comando.
# Uso (na instância):  cd ~/ShopFloor && ./deploy.sh
#
# O que faz: git pull da main -> npm ci (só se deps mudaram) -> build -> pm2 restart.
# set -e: se qualquer passo falhar (ex.: build), o script PARA antes do restart,
# então o app NÃO reinicia com código quebrado.
#
# ⚠️ MIGRAÇÕES DE BANCO são MANUAIS (sensível) — este script NÃO aplica migração.
#    Se a versão tiver migração nova, ANTES de rodar o deploy:
#      psql "host=shopfloor-prod-db... user=postgres sslmode=require" -f supabase/migrations/00XX_*.sql
#      cd ~/supabase/docker && docker compose restart rest   # se mexeu em tabela

set -euo pipefail
cd "$(dirname "$0")/../.."   # raiz do repo (deploy/aws/ -> repo)

echo "==> git pull (main)"
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "== Nada novo na main. Deploy não necessário."
  exit 0
fi

# instala dependências só se o package-lock mudou (mais rápido)
if git diff --name-only "$BEFORE" "$AFTER" | grep -q '^package-lock.json$'; then
  echo "==> dependências mudaram -> npm ci"
  npm ci
else
  echo "== deps inalteradas (pulando npm ci)"
fi

echo "==> build"
NODE_OPTIONS="--max-old-space-size=4096" npm run build

echo "==> pm2 restart"
pm2 restart shopfloor --update-env
pm2 save

echo "==> deploy OK -> $(git rev-parse --short HEAD)"
