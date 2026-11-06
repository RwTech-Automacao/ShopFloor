#!/usr/bin/env bash
# Prova que a 0175 só mudou o que devia nas duas funções que recriou: extrai sf_almoxarifado_entrada e
# sf_almoxarifado_lote da 0165 (vigente antes) e da 0175 e compara o `diff` com estoque_destino_diff.esperado
# (versionado: qualquer linha a mais ou a menos mudada na cópia faz isto falhar).
# Uso: supabase/tests/estoque_destino_diff.sh        (ATUALIZAR=1 regrava o esperado, para revisão no git)
set -euo pipefail
cd "$(dirname "$0")/../.."
extrair() { # arquivo função
  awk -v f="create or replace function public.$2(" '
    index($0, f) == 1 { dentro = 1 }
    dentro { print }
    dentro && $0 == "end $func$;" { exit }' "$1"
}
SAIDA=""
for fn in sf_almoxarifado_entrada sf_almoxarifado_lote; do
  A=$(mktemp); B=$(mktemp)
  extrair supabase/migrations/0165_placas_almoxarifado.sql "$fn" > "$A"
  extrair supabase/migrations/0175_estoque_destino_almoxarifado.sql "$fn" > "$B"
  [ -s "$A" ] && [ -s "$B" ] || { echo "função $fn não encontrada"; exit 1; }
  SAIDA+="### $fn"$'\n'"$(diff "$A" "$B" | grep '^[<>]' || true)"$'\n'
  rm -f "$A" "$B"
done
if [ -n "${ATUALIZAR:-}" ]; then printf '%s' "$SAIDA" > supabase/tests/estoque_destino_diff.esperado; fi
if [ "$SAIDA" == "$(cat supabase/tests/estoque_destino_diff.esperado)"$'\n' ] || [ "$SAIDA" == "$(cat supabase/tests/estoque_destino_diff.esperado)" ]; then
  echo "diff 0165 x 0175 (entrada e lote): só as linhas esperadas mudaram: ok"
else
  echo "diff 0165 x 0175 FALHOU: mudou mais (ou menos) do que o esperado"
  diff <(printf '%s' "$SAIDA") supabase/tests/estoque_destino_diff.esperado || true
  exit 1
fi
