#!/usr/bin/env bash
# Testes SQL da entrada do posto Almoxarifado (0128/0129) num Postgres descartável.
# Uso: supabase/tests/rodar-almoxarifado-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-almoxarifado-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0128_sf_perfil_almoxarifado.sql "$NOME":/tmp/0128.sql
docker cp supabase/migrations/0129_sf_almoxarifado_entrada.sql "$NOME":/tmp/0129.sql
docker cp supabase/tests/almoxarifado_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar as migrações duas
# vezes na mesma base não pode falhar nem mudar o resultado. O caso conhecido é a caixa 7, que o
# teste já deu entrada: reaplicar a 0129 não pode fazer o segundo bipe dela ser aceito.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0128.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0129.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','shopfloor.lancar',false)" \
  -c "select sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','Ana','CX[7][14]8498-PMOC14','caixa',14,'')->>'motivo'" \
  | tail -1 | grep -qx ja_lancado \
  && echo "idempotência da 0128/0129: ok" \
  || { echo "idempotência da 0128/0129 FALHOU"; exit 1; }

# CORRIDA: dois operadores bipando a MESMA caixa ao mesmo tempo — o risco que a RPC existe pra
# resolver. A sessão A dá a entrada e segura a transação aberta; a B tem que ESPERAR na trava e,
# quando a A comitar, ver o registro dela e recusar por ja_lancado. Uma caixa, uma linha.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada)
   values ('PMOC14', '8498', 'Embalagem', 20, 14, 14, 'CX[20][14]8498-PMOC14', true)"
BIPE="sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','%s','CX[20][14]8498-PMOC14','caixa',14,'')"
printf "%s\n" \
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
# A B entra 1s depois (já com a A dentro da transação) e não pode passar na frente.
B=$(printf "%s\n" \
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$BIPE" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[20][14]8498-PMOC14'")
[ "$B" = ja_lancado ] && [ "$N" = 1 ] \
  && echo "corrida (dois bipes na mesma caixa): ok" \
  || { echo "corrida FALHOU (B=$B, linhas=$N)"; exit 1; }

# A mesma corrida na embalagem INDIVIDUAL: aqui não existe linha de caixa pra travar, então quem
# segura é a trava por bipe. Uma peça, uma linha.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm)
   values ('Marcos', 'Embalagem', 'PMOI01', '9000', 'Cliente Individual', '1077', 1, '1077', '1077')"
BIPE="sf_almoxarifado_entrada('PMOI01','9000','Almoxarifado','%s','1077','serie',1,'1077')"
printf "%s\n" \
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$BIPE" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_serie_norm = '1077'")
[ "$B" = ja_lancado ] && [ "$N" = 1 ] \
  && echo "corrida (dois bipes na mesma peça): ok" \
  || { echo "corrida da peça FALHOU (B=$B, linhas=$N)"; exit 1; }
