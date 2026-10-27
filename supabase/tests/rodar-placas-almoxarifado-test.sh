#!/usr/bin/env bash
# Teste SQL do Almoxarifado e da fila do Compels em placas (0165) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-almoxarifado-test.sh
# É a suíte inteira do almoxarifado (rodar-almoxarifado-test.sh) com PLACAS=1: a 0161 aplicada antes do
# primeiro insert, a 0165 depois de cada migração que recria uma das funções dela (e reaplicada no fim,
# duas vezes), o placas_almoxarifado_test.sql (N = 50) e a foto N = 1 das leituras (antes × depois).
# RED=1 pula a 0165 (roda contra as funções antigas: o teste tem de falhar).
set -euo pipefail
cd "$(dirname "$0")/../.."
PLACAS=1 exec bash supabase/tests/rodar-almoxarifado-test.sh
