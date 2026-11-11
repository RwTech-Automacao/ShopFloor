#!/usr/bin/env bash
# Prova que a 0181 só mudou o que devia nas três funções que recriou: extrai cada uma da migração vigente
# antes dela (0175 para a entrada do Almoxarifado, 0112 para as duas do Setup) e da 0181, e compara o `diff`
# com faixas_sn_diff.esperado (versionado: qualquer linha a mais ou a menos mudada na cópia faz isto falhar).
# Uso: supabase/tests/faixas_sn_diff.sh        (ATUALIZAR=1 regrava o esperado, para revisão no git)
set -euo pipefail
cd "$(dirname "$0")/../.."
extrair() { # arquivo função
  awk -v f="create or replace function public.$2(" '
    index($0, f) == 1 { dentro = 1 }
    dentro { print }
    dentro && $0 == "end $func$;" { exit }' "$1"
}
SAIDA=""
for par in 0175_estoque_destino_almoxarifado:sf_almoxarifado_entrada 0112_setup_funcoes:st_liberar_setup 0112_setup_funcoes:st_trocar_rolo; do
  arq=${par%%:*}; fn=${par##*:}
  A=$(mktemp); B=$(mktemp)
  extrair "supabase/migrations/$arq.sql" "$fn" > "$A"
  extrair supabase/migrations/0181_sf_ordem_faixas.sql "$fn" > "$B"
  [ -s "$A" ] && [ -s "$B" ] || { echo "função $fn não encontrada"; exit 1; }
  SAIDA+="### $fn"$'\n'"$(diff "$A" "$B" | grep '^[<>]' || true)"$'\n'
  rm -f "$A" "$B"
done
if [ -n "${ATUALIZAR:-}" ]; then printf '%s' "$SAIDA" > supabase/tests/faixas_sn_diff.esperado; fi
if [ "$SAIDA" == "$(cat supabase/tests/faixas_sn_diff.esperado)"$'\n' ] || [ "$SAIDA" == "$(cat supabase/tests/faixas_sn_diff.esperado)" ]; then
  echo "diff 0175/0112 x 0181 (entrada, liberar, trocar rolo): só as linhas esperadas mudaram: ok"
else
  echo "diff 0175/0112 x 0181 FALHOU: mudou mais (ou menos) do que o esperado"
  diff <(printf '%s' "$SAIDA") supabase/tests/faixas_sn_diff.esperado || true
  exit 1
fi
