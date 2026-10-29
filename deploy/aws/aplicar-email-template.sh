#!/usr/bin/env bash
# aplicar-email-template.sh — ativa o e-mail de recuperação de senha em PT-BR (GoTrue na Lightsail).
# Uso (na instância, DEPOIS do deploy.sh):  cd ~/ShopFloor && bash deploy/aws/aplicar-email-template.sh
#
# Idempotente: pode rodar de novo sem estragar nada. Só recria o container auth (fora ~5-15 s).
# Não pede senha e não mexe no banco.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DOCKER_DIR="$HOME/supabase/docker"
cd "$DOCKER_DIR"

SITE_URL="$(grep -E '^SITE_URL=' .env | cut -d= -f2- | tr -d '"')"
echo "==> SITE_URL do GoTrue: ${SITE_URL:-<vazio>}"
if [ "$SITE_URL" != "https://shopfloor.enterplak.com.br" ]; then
  echo "!! SITE_URL diferente de https://shopfloor.enterplak.com.br — o botão do e-mail sairia com o host errado. PARE e me avise."
  exit 1
fi

echo "==> copiando o template (do commit que está em $REPO)"
mkdir -p email-templates
cp "$REPO/deploy/aws/email-templates/recuperar-senha.html" email-templates/recuperar-senha.html
grep -q 'token_hash={{ .TokenHash }}' email-templates/recuperar-senha.html || { echo "!! template sem token_hash"; exit 1; }

cat > docker-compose.email.yml <<'YAML'
services:
  email-templates:
    image: nginx:alpine
    restart: unless-stopped
    volumes:
      - ./email-templates:/usr/share/nginx/html:ro
  auth:
    environment:
      GOTRUE_MAILER_TEMPLATES_RECOVERY: http://email-templates/recuperar-senha.html
      GOTRUE_MAILER_SUBJECTS_RECOVERY: Redefinir sua senha do ShopFloor
YAML

DC="docker compose -f docker-compose.yml"
[ -f docker-compose.override.yml ] && DC="$DC -f docker-compose.override.yml"
DC="$DC -f docker-compose.email.yml"

echo "==> subindo o servidor do template"
$DC up -d email-templates
echo "==> recriando só o auth"
$DC up -d --no-deps auth
sleep 5

echo "==> conferindo que o auth enxerga o template"
$DC exec -T auth wget -qO- http://email-templates/recuperar-senha.html | head -c 120 && echo
echo "==> auth: $(docker ps --filter name=supabase-auth --format '{{.Names}} {{.Status}}')"
echo "==> OK. Teste em https://shopfloor.enterplak.com.br/esqueci-senha com o seu e-mail."
