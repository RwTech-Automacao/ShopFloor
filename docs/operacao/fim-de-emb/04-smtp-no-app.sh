#!/usr/bin/env bash
# =============================================================
# FIM DE EMB — SMTP do APP (canal de e-mail dos Alertas)
#
# Copia as credenciais de SMTP que o GoTrue (o "esqueci a senha" do Supabase) JÁ usa para o
# arquivo de ambiente do app, sem imprimir nenhum valor. O app lê SMTP_HOST, SMTP_PORT, SMTP_USER,
# SMTP_PASS e SMTP_REMETENTE (src/modules/alertas/infra/email.ts, lerConfigEmail); SMTP_SEGURO é
# opcional e NÃO é mexido (sem ele: porta 465 = TLS direto, qualquer outra = STARTTLS).
#
# Uso (na instância):
#   bash /tmp/fimemb-04.sh            grava (ou regrava) as 5 variáveis e confere
#   bash /tmp/fimemb-04.sh conferir   só confere: imprime NOMES e TAMANHOS, nunca valores
#
# De onde vem cada valor (nesta ordem):
#   1. do container do GoTrue em execução (docker compose exec auth printenv GOTRUE_SMTP_*): é o
#      valor EFETIVO, o que já manda e-mail hoje — com aspas e cifrões já resolvidos pelo compose;
#   2. se o container não responder, de ~/supabase/docker/.env (SMTP_*), tirando um par de aspas
#      em volta, se houver.
#   SMTP_REMETENTE = "SMTP_SENDER_NAME <SMTP_ADMIN_EMAIL>" (ou só o e-mail, se não houver nome).
#
# Como grava (o Next lê o .env.production com dotenv + dotenv-expand, conferido no @next/env do
# Next 16): cada valor vai entre ASPAS SIMPLES — sem elas, um "#" corta o valor e espaço nas pontas
# some — e cada "$" vira "\$", porque o dotenv-expand do Next expande $NOME ATÉ dentro de aspas
# simples (uma senha "ab$cd" viraria "ab"). Valor com aspa simples ou quebra de linha: o script
# PARA sem gravar (não há como escrever isso com segurança nesse formato).
#
# Idempotente: tira do arquivo as linhas antigas dessas 5 variáveis (com ou sem "export") e
# escreve as novas no fim — rodar duas vezes deixa UMA linha de cada. Antes da primeira gravação,
# guarda uma cópia do arquivo em .env.production.antes-fim-de-emb (só a primeira; as seguintes não
# sobrescrevem). Permissão do arquivo: a mesma de antes.
#
# Depois de gravar, é preciso reiniciar o app (o deploy.sh faz isso: pm2 restart --update-env).
# =============================================================
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$HOME/ShopFloor}"
SUPA_DIR="${SUPA_DIR:-$HOME/supabase/docker}"
ARQ="$APP_DIR/.env.production"
NOMES=(SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_REMETENTE)

[ -f "$ARQ" ] || { echo "PARE: não achei $ARQ"; exit 1; }

conferir() {
  # Lê o arquivo do jeito que o Next lê (o mesmo @next/env do app) e mostra só nome e tamanho.
  # Se receber os valores esperados pelo ambiente (ESPERADO_*), diz também se cada um bate.
  ( cd "$APP_DIR" && node -e '
    const { loadEnvConfig } = require("@next/env");
    const nomes = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_REMETENTE", "SMTP_SEGURO"];
    const esperado = {};
    for (const n of nomes) { esperado[n] = process.env["ESPERADO_" + n]; delete process.env[n]; }
    loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    let falta = 0, diferente = 0;
    for (const n of nomes) {
      const v = process.env[n];
      const opcional = n === "SMTP_SEGURO";
      let linha = n.padEnd(15) + (v === undefined || v === "" ? (opcional ? "(não definida — normal)" : "FALTANDO") : "definida, " + v.length + " caracteres");
      if ((v === undefined || v === "") && !opcional) falta++;
      if (esperado[n] !== undefined) {
        const ok = v === esperado[n];
        if (!ok) diferente++;
        linha += ok ? "  (igual à origem)" : "  (DIFERENTE da origem!)";
      }
      console.log("  " + linha);
    }
    if (falta || diferente) { console.log("PROBLEMA: " + falta + " faltando, " + diferente + " diferente(s)"); process.exit(1); }
    console.log("OK: as variáveis de SMTP estão no " + ".env.production e o Next as lê inteiras.");
  ' )
}

if [ "${1:-}" = "conferir" ]; then conferir; exit $?; fi

# ---------- ler a origem, sem imprimir ----------
do_container() { ( cd "$SUPA_DIR" && docker compose exec -T auth printenv "$1" ) 2>/dev/null | tr -d '\r' || true; }
do_arquivo() {
  local v
  v="$(grep -E "^[[:space:]]*$1=" "$SUPA_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ "$v" =~ ^\'(.*)\'$ ]] || [[ "$v" =~ ^\"(.*)\"$ ]]; then v="${BASH_REMATCH[1]}"; fi
  printf '%s' "$v"
}

ORIGEM="container auth"
S_HOST="$(do_container GOTRUE_SMTP_HOST)"
S_PORT="$(do_container GOTRUE_SMTP_PORT)"
S_USER="$(do_container GOTRUE_SMTP_USER)"
S_PASS="$(do_container GOTRUE_SMTP_PASS)"
S_MAIL="$(do_container GOTRUE_SMTP_ADMIN_EMAIL)"
S_NOME="$(do_container GOTRUE_SMTP_SENDER_NAME)"
if [ -z "$S_HOST" ] || [ -z "$S_PASS" ]; then
  ORIGEM="$SUPA_DIR/.env"
  S_HOST="$(do_arquivo SMTP_HOST)"
  S_PORT="$(do_arquivo SMTP_PORT)"
  S_USER="$(do_arquivo SMTP_USER)"
  S_PASS="$(do_arquivo SMTP_PASS)"
  S_MAIL="$(do_arquivo SMTP_ADMIN_EMAIL)"
  S_NOME="$(do_arquivo SMTP_SENDER_NAME)"
fi
echo "origem das credenciais: $ORIGEM"

for par in "SMTP_HOST:$S_HOST" "SMTP_PORT:$S_PORT" "SMTP_USER:$S_USER" "SMTP_PASS:$S_PASS" "SMTP_ADMIN_EMAIL:$S_MAIL"; do
  [ -n "${par#*:}" ] || { echo "PARE: ${par%%:*} vazio na origem — nada foi gravado"; exit 1; }
done
if [ -n "$S_NOME" ]; then S_REM="$S_NOME <$S_MAIL>"; else S_REM="$S_MAIL"; fi

VALORES=("$S_HOST" "$S_PORT" "$S_USER" "$S_PASS" "$S_REM")
for i in "${!NOMES[@]}"; do
  case "${VALORES[$i]}" in
    *"'"*|*$'\n'*) echo "PARE: ${NOMES[$i]} tem aspa simples ou quebra de linha — nada foi gravado"; exit 1 ;;
  esac
done

# ---------- gravar ----------
[ -e "$ARQ.antes-fim-de-emb" ] || cp -p "$ARQ" "$ARQ.antes-fim-de-emb"
TMP="$(mktemp "$APP_DIR/.env.production.tmp.XXXXXX")"
grep -vE '^[[:space:]]*(export[[:space:]]+)?SMTP_(HOST|PORT|USER|PASS|REMETENTE)[[:space:]]*=|^# SMTP do canal de e-mail dos Alertas' "$ARQ" > "$TMP" || true
# o arquivo antigo pode não terminar em quebra de linha
[ -s "$TMP" ] && [ -n "$(tail -c1 "$TMP")" ] && echo >> "$TMP"
{
  echo "# SMTP do canal de e-mail dos Alertas (mesmas credenciais do GoTrue) — fimemb-04.sh"
  for i in "${!NOMES[@]}"; do
    printf "%s='%s'\n" "${NOMES[$i]}" "${VALORES[$i]//\$/\\\$}"
  done
} >> "$TMP"
chmod --reference="$ARQ" "$TMP"
mv "$TMP" "$ARQ"
echo "gravado em $ARQ (cópia do original: $ARQ.antes-fim-de-emb)"

# ---------- conferir, comparando com a origem (sem imprimir valores) ----------
ESPERADO_SMTP_HOST="$S_HOST" ESPERADO_SMTP_PORT="$S_PORT" ESPERADO_SMTP_USER="$S_USER" \
ESPERADO_SMTP_PASS="$S_PASS" ESPERADO_SMTP_REMETENTE="$S_REM" conferir
