#!/usr/bin/env bash
# rollback-janela.sh: volta o ShopFloor para a versão que estava no ar ANTES da janela de 19/10/2026
# (Fim de EMB 0149–0151 + Almoxarifado/Compels 0128–0133 e 0153). Roda na instância Lightsail.
#
# Instalar (uma vez, sem colar texto longo):
#   cd ~/ShopFloor && git fetch origin main && git show origin/main:docs/operacao/rollback-janela.sh > ~/rollback-janela.sh
#
# Uso:
#   bash ~/rollback-janela.sh estado   só olha (commit atual × commit de antes, app, rest). Não muda nada.
#   bash ~/rollback-janela.sh app      o app volta ao commit de ~/antes-almox.txt (~3 min, sem senha).
#                                      Resolve quase tudo: o app velho funciona com o banco novo.
#   bash ~/rollback-janela.sh banco    DEPOIS do app: desfaz o Almoxarifado e depois o Fim de EMB no banco
#                                      (pede a senha do banco duas vezes) e reinicia o rest.
#   bash ~/rollback-janela.sh tudo     app e depois banco, em sequência (pede a senha duas vezes).
#
# O que NÃO é desfeito (de propósito): as variáveis do .env.production (COMPELS_*, ESTOQUE_CRON_SECRET,
# ALERTAS_RECEBIMENTO_LIBERADO_PARA) ficam: sem o app novo ninguém as lê. As tabelas de cópia
# (alerta_bkp_0149_0151_*, almox_bkp_*) ficam no banco. Estoque já enviado ao Compels não é desfeito aqui
# (hoje nenhuma OP está liberada em COMPELS_OPS_LIBERADAS, então nada foi enviado).
set -euo pipefail

TMP="${TMPDIR:-/tmp}"
ANTES_ARQ="$HOME/antes-almox.txt"
test -s "$ANTES_ARQ" || { echo "PARE: $ANTES_ARQ não existe ou está vazio (é o commit de antes da janela)."; exit 1; }
ANTES="$(cat "$ANTES_ARQ")"
cd "$HOME/ShopFloor"

modo="${1:-}"

estado() {
  echo "commit no disco : $(git rev-parse --short HEAD)"
  echo "commit de antes : ${ANTES:0:8}   ($([ "$(git rev-parse HEAD)" = "$ANTES" ] && echo 'o app JÁ está na versão de antes' || echo 'o app está numa versão mais nova'))"
  pm2 jlist 2>/dev/null | grep -o '"status":"[a-z]*"' | head -1 || true
  (cd "$HOME/supabase/docker" && docker compose ps rest 2>/dev/null | tail -n +2) || true
}

app() {
  echo "==> voltando o app para ${ANTES:0:8}"
  git reset --hard "$ANTES"
  NODE_OPTIONS="--max-old-space-size=4096" npm run build
  pm2 restart shopfloor --update-env
  pm2 save
  echo "==> APP REVERTIDO -> $(git rev-parse --short HEAD). O banco continua como está (compatível com o app velho)."
  echo "    Próximo deploy normal: bash deploy/aws/deploy.sh (o git pull avança de novo)."
}

banco() {
  if [ "$(git rev-parse HEAD)" != "$ANTES" ]; then
    echo "PARE: o app ainda não voltou. Rode antes:  bash ~/rollback-janela.sh app"
    exit 1
  fi
  HOST="$(grep -E '^POSTGRES_HOST=' "$HOME/supabase/docker/.env" | cut -d= -f2- | tr -d '"')"
  test -n "$HOST" || { echo "PARE: POSTGRES_HOST não encontrado."; exit 1; }
  [ -s "$TMP/almox-03.sql" ]  || git show origin/main:docs/operacao/almoxarifado-compels/03-rollback.sql > "$TMP/almox-03.sql"
  [ -s "$TMP/fimemb-03.sql" ] || git show origin/main:docs/operacao/fim-de-emb/03-rollback-0149-0151.sql > "$TMP/fimemb-03.sql"
  echo "==> 1/2 rollback do Almoxarifado (digite a senha do banco)"
  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' \
    psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f "$TMP/almox-03.sql"
  echo "==> 2/2 rollback do Fim de EMB (digite a senha do banco de novo)"
  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' \
    psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f "$TMP/fimemb-03.sql"
  (cd "$HOME/supabase/docker" && docker compose restart rest)
  echo "==> BANCO REVERTIDO. Confira os NOTICE: 'g) ... 2 iguais, 0 diferentes' e 'i) ... 35 iguais, 0 diferentes'."
  echo "    Se o Almoxarifado abortou dizendo que um posto usa o perfil almoxarifado: troque o perfil dele em Cadastrar Posto e rode 'banco' de novo."
}

case "$modo" in
  estado) estado ;;
  app)    app ;;
  banco)  banco ;;
  tudo)   app; banco ;;
  *)
    echo "Uso: bash ~/rollback-janela.sh estado | app | banco | tudo"
    exit 1
    ;;
esac
