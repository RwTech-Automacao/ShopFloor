#!/usr/bin/env bash
# Testes SQL das etiquetas do estoque legado (0126 + 0135) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-etiquetas-legado-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-etiquetas-legado-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0126_etiquetas_legado.sql "$NOME":/tmp/0126.sql
docker cp supabase/migrations/0135_etiquetas_pedido_impressao.sql "$NOME":/tmp/0135.sql
docker cp supabase/tests/etiquetas_legado_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar a migração duas
# vezes na mesma base não pode falhar nem mudar o que já foi emitido.
#
# Só a 0135 é reaplicada. Depois dela, a 0126 NÃO é mais reaplicável: a 0135 troca as colunas de
# saída de `etq_legado_emitir` (ganha o `pedido`), e o `create or replace` da 0126 recusa voltar a
# assinatura antiga ("cannot change return type of existing function"). Reaplicar à mão, portanto,
# começa na 0135 — que é a versão vigente das duas funções e recria tudo o que a 0126 criou.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0135.sql
# 9 = as 7 linhas dos testes da 0126 + as 3 do item PEDX01 e 1 do REMX01 nos testes da 0135, MENOS
# as 2 removidas (PEDX01-123425L0002 e a única do REMX01). As removidas continuam na tabela como
# registro do número QUEIMADO — é o que impede o sequencial de voltar —, mas não são etiquetas: o
# resumo conta o progresso do mutirão, e um rolo descartado antes de imprimir não é progresso.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.gerar_etiqueta',false)" \
  -c "select total_etiquetas from etq_legado_resumo()" | tail -1 | grep -qx 9 \
  && echo "idempotência da 0135: ok" \
  || { echo "idempotência da 0135 FALHOU"; exit 1; }

# Dente do backfill: reaplicar a 0135 NÃO pode marcar como impressas as pendentes que a tela do
# inventário criou DEPOIS dela. No fim dos testes sobra 1 pendente (PEDX01-L0003, emitida e nunca
# baixada). Se o backfill rodasse solto — `update ... where impressa_em is null` fora do `if` que
# cria a coluna — a reaplicação a varreria e aqui daria 0: o rolo na prateleira nunca receberia
# etiqueta, justamente por alguém reaplicar a migração "na dúvida".
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select count(*) from etiquetas_legado where impressa_em is null and removida_em is null" \
  | tail -1 | grep -qx 1 \
  && echo "backfill não varreu as pendentes novas: ok" \
  || { echo "o backfill da 0135 reaplicada VARREU as pendentes novas"; exit 1; }
