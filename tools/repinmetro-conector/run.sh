#!/usr/bin/env bash
# Sync incremental do repinmetro -> Supabase (Prod). Chamado pelo systemd timer (de 6 em 6h).
# Roda SEM REPINMETRO_SINCE => a marca d'água (MAX origem_id no Supabase) pega só os testes
# novos desde a última rodada. Idempotente: rodar 2x não duplica.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
exec node --env-file=.env.prod conector.mjs
