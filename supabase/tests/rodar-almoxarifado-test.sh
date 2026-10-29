#!/usr/bin/env bash
# Testes SQL do posto Almoxarifado (0128/0129/0155/0156 na entrada, 0131 no cancelamento da caixa inteira,
# 0156 no lote do NQA individual)
# num Postgres descartável.
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
# A 0130 entra porque o colateral desta correção bate no NQA: o bipe de caixa gravando uma linha por
# peça tirou o `max(posto)` da sf_nqa_caixa do lugar (teste 23).
docker cp supabase/migrations/0130_sf_nqa_caixa_posto_da_caixa.sql "$NOME":/tmp/0130.sql
# Cancelar a caixa inteira (0131) roda contra as funções REAIS do cancelamento: a 0087 traz a tabela
# de auditoria (sf_registros_cancelados) e a 0106 o sf_cancelar_lancamento, que é como o teste produz
# o estado parcial (cancelar linha por linha e parar no meio). As duas estão em PRODUÇÃO e entram aqui
# como estão — nenhuma é editada.
docker cp supabase/migrations/0087_sf_registros_cancelados.sql "$NOME":/tmp/0087.sql
docker cp supabase/migrations/0106_cancelar_embalagem_reabre_caixa.sql "$NOME":/tmp/0106.sql
docker cp supabase/migrations/0131_sf_cancelar_caixa_almoxarifado.sql "$NOME":/tmp/0131.sql
# A fila de envio ao Compels (0132): desde a Fase 2 a entrada grava na fila na MESMA transação em que
# grava os registros, então a fila faz parte do que estes testes exercitam. A 0133 é a
# sf_cancelar_lancamento revertendo na fila quando a linha cancelada é uma entrada de Almoxarifado.
docker cp supabase/migrations/0132_sf_estoque_envios.sql "$NOME":/tmp/0132.sql
docker cp supabase/migrations/0133_cancelar_lancamento_estoque.sql "$NOME":/tmp/0133.sql
# O plano estável da sf_nqa_caixa (0160, incidente de 22/10/2026): entra DEPOIS da 0130 (o teste
# aplica a 0160 logo após a 0130 quando o runner passa -v com0160=1), pra o almoxarifado_test.sql
# inteiro valer contra a função NOVA. SEM_0160=1 roda o RED (função da 0130).
docker cp supabase/migrations/0160_sf_nqa_caixa_plano_estavel.sql "$NOME":/tmp/0160.sql
docker cp supabase/tests/nqa_caixa_plano_test.sql "$NOME":/tmp/teste_plano.sql
# A 0155 recria a entrada com a trava do POSTO ANTERIOR e cria a lista de necessidades. O arquivo
# antigo a aplica antes do primeiro bipe (todos os casos de lá rodam contra ela); os casos NOVOS ficam
# no almoxarifado_necessidade_test.sql, que roda depois, na mesma base.
docker cp supabase/migrations/0155_sf_almox_posto_anterior.sql "$NOME":/tmp/0155.sql
# A 0156 (fase 2): o lote do NQA individual vira necessidade, confirmação bipando todos os SNs, bipe avulso
# recusado nesse caso e cancelamento do lote inteiro. Entra no arquivo antigo logo depois da 0155 (e de
# novo depois da 0133, que recria a sf_cancelar_lancamento) e no começo do almoxarifado_lote_test.sql.
# A 0097 (sf_nqa_individual, em produção) entra porque os lotes da massa nascem pela função real.
docker cp supabase/migrations/0156_sf_almox_lote.sql "$NOME":/tmp/0156.sql
docker cp supabase/migrations/0097_sf_nqa_individual.sql "$NOME":/tmp/0097.sql
# A hora na lista de pendências (0158) e o detalhe do cartão (0159): leitura pura em cima da 0155/0156.
docker cp supabase/migrations/0158_sf_almox_pendencias.sql "$NOME":/tmp/0158.sql
docker cp supabase/migrations/0159_sf_almox_detalhe.sql "$NOME":/tmp/0159.sql
docker cp supabase/tests/almoxarifado_necessidade_test.sql "$NOME":/tmp/teste_necessidade.sql
docker cp supabase/tests/almoxarifado_lote_test.sql "$NOME":/tmp/teste_lote.sql
docker cp supabase/tests/almoxarifado_pendencias_test.sql "$NOME":/tmp/teste_pendencias.sql
docker cp supabase/tests/almoxarifado_pecas_avulsas_test.sql "$NOME":/tmp/teste_pecas_avulsas.sql
# Peças avulsas (OP individual sem NQA no posto anterior): roda por cima da 0158/0159 já aplicadas acima.
docker cp supabase/tests/almoxarifado_test.sql "$NOME":/tmp/teste.sql

# PLACAS=1 — placas por painel (0161 + 0165 + 0166). A suíte INTEIRA (arquivos SQL e etapas em bash) roda com a
# 0161 aplicada antes do primeiro insert (junto com a 0128) e com a 0165 aplicada logo depois de CADA
# migração que recria uma das funções dela (0131, 0133, 0156, 0158, 0159) — então todo caso antigo, com
# placas_por_painel = 1, roda contra as funções NOVAS: é a prova de que N = 1 não mudou nada. Por cima, o
# placas_almoxarifado_test.sql (N = 50) e a foto das leituras (antes × depois) no fim.
# PLACAS=1 RED=1 aplica a 0161 mas NÃO a 0165: o placas_almoxarifado_test.sql tem que FALHAR.
# Uso direto: supabase/tests/rodar-placas-almoxarifado-test.sh
if [ -n "${PLACAS:-}" ]; then
  TMPP=$(mktemp -d)
  trap 'rm -rf "$TMPP"; docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
  M=supabase/migrations
  cat $M/0161_placas_por_painel.sql $M/0128_sf_perfil_almoxarifado.sql > "$TMPP/0128.sql"
  docker cp "$TMPP/0128.sql" "$NOME":/tmp/0128.sql
  if [ -z "${RED:-}" ]; then
    for m in 0131_sf_cancelar_caixa_almoxarifado 0133_cancelar_lancamento_estoque 0156_sf_almox_lote \
             0158_sf_almox_pendencias 0159_sf_almox_detalhe; do
      cat "$M/$m.sql" $M/0165_placas_almoxarifado.sql > "$TMPP/${m%%_*}.sql"
      docker cp "$TMPP/${m%%_*}.sql" "$NOME":/tmp/"${m%%_*}".sql
      docker cp "$M/$m.sql" "$NOME":/tmp/raw_"${m%%_*}".sql
    done
    docker cp $M/0155_sf_almox_posto_anterior.sql "$NOME":/tmp/raw_0155.sql
    docker cp $M/0165_placas_almoxarifado.sql "$NOME":/tmp/0165.sql
    # A 0166 (NQA com o `total` em placas) recria a sf_nqa_caixa (0160) e a sf_nqa_individual (0097):
    # entra logo depois de cada uma, então todo caso de NQA da suíte (N = 1) roda contra ela.
    for m in 0160_sf_nqa_caixa_plano_estavel 0097_sf_nqa_individual; do
      cat "$M/$m.sql" $M/0166_placas_nqa.sql > "$TMPP/${m%%_*}.sql"
      docker cp "$TMPP/${m%%_*}.sql" "$NOME":/tmp/"${m%%_*}".sql
    done
  fi
  docker cp supabase/tests/placas_almoxarifado_test.sql "$NOME":/tmp/teste_placas.sql
  docker cp supabase/tests/placas_almoxarifado_foto.sql "$NOME":/tmp/foto.sql
fi

if [ -z "${SEM_0160:-}" ]; then COM0160="-v com0160=1"; else COM0160=""; fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q $COM0160 -f /tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_necessidade.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_lote.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_pendencias.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_pecas_avulsas.sql
if [ -n "${PLACAS:-}" ]; then
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_placas.sql
fi

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar as migrações duas
# vezes na mesma base não pode falhar nem mudar o resultado. O caso conhecido é a caixa 7, que o
# teste já deu entrada: reaplicar a 0129 não pode fazer o segundo bipe dela ser aceito.
# A 0130 e a 0131 entram na conta pelo mesmo motivo: `create or replace` + revoke/grant, reaplicar não
# muda nada. (A 0087 não entra: ela tem `create policy`, que não é idempotente — e não é editável,
# está em produção.)
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0128.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0129.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0130.sql
[ -n "${SEM_0160:-}" ] || docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0160.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0131.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0133.sql
# A 0155 por último (é ela que vale em cima da 0129 reaplicada), e DUAS vezes: reaplicar não pode
# falhar nem mudar o resultado.
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0155.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0155.sql
# E a 0156 por cima, também DUAS vezes (é ela que vale em cima da 0155 reaplicada).
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0156.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0156.sql
# A 0158 e a 0159 por cima, DUAS vezes cada (a 0158 tem drop function + create; reaplicar não pode falhar).
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0158.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0158.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0159.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0159.sql
# Idempotência da 0156: o lote já confirmado (L10 reconfirmou e cancelou; o L1 está livre) continua
# sendo necessidade UMA vez, e a peça de lote continua recusada avulsa.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar,shopfloor.visualizar',false)" \
  -c "select (select count(*) from sf_almox_lotes('PMOL01','9201') where pecas = 5)
          || '/' || (sf_almoxarifado_entrada('PMOL01','9201','Almoxarifado','Ana','7012','serie',1,'7012')->>'motivo')" \
  | tail -1 | grep -qx '1/serie_exige_lote' \
  && echo "idempotência da 0156: ok" \
  || { echo "idempotência da 0156 FALHOU"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false)" \
  -c "select sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','Ana','CX[7][14]8498-PMOC14','caixa',14,'')->>'motivo'" \
  | tail -1 | grep -qx ja_lancado \
  && echo "idempotência da 0128/0129: ok" \
  || { echo "idempotência da 0128/0129 FALHOU"; exit 1; }

# CORRIDA: dois operadores bipando a MESMA caixa ao mesmo tempo — o risco que a RPC existe pra
# resolver. A sessão A dá a entrada e segura a transação aberta; a B tem que ESPERAR na trava e,
# quando a A comitar, ver os registros dela e recusar por ja_lancado. Uma caixa, UM conjunto de
# linhas: 14 peças na caixa = 14 linhas no total, e não 28.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada)
   values ('PMOC14', '8498', 'Embalagem', 20, 14, 14, 'CX[20][14]8498-PMOC14', true)" -c \
  "insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
   select 'Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[20][14]8498-PMOC14',
          'SN-' || (8300 + i)::text, (8300 + i)::text from generate_series(1, 14) i"
BIPE="sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','%s','CX[20][14]8498-PMOC14','caixa',14,'')"
printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
# A B entra 1s depois (já com a A dentro da transação) e não pode passar na frente.
B=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$BIPE" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[20][14]8498-PMOC14'")
[ "$B" = ja_lancado ] && [ "$N" = 14 ] \
  && echo "corrida (dois bipes na mesma caixa): ok" \
  || { echo "corrida FALHOU (B=$B, linhas=$N)"; exit 1; }

# A mesma corrida na embalagem INDIVIDUAL: aqui não existe linha de caixa pra travar, então quem
# segura é a trava por bipe. Uma peça, uma linha.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm)
   values ('Marcos', 'Embalagem', 'PMOI01', '9000', 'Cliente Individual', '1077', 1, '1077', '1077')"
BIPE="sf_almoxarifado_entrada('PMOI01','9000','Almoxarifado','%s','1077','serie',1,'1077')"
printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$BIPE" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_serie_norm = '1077'")
[ "$B" = ja_lancado ] && [ "$N" = 1 ] \
  && echo "corrida (dois bipes na mesma peça): ok" \
  || { echo "corrida da peça FALHOU (B=$B, linhas=$N)"; exit 1; }

# CORRIDA, série com bipes CRUS DIFERENTES que normalizam para a MESMA série (achado da revisão:
# a trava travava pelo p_bipe cru, mas a checagem de duplicidade compara p_serie_norm — um zero à
# esquerda a mais no coletor, ou minúsculas, dão bipes diferentes com o mesmo p_serie_norm, e cada
# um pegava uma trava própria). Usa a OP sem faixa (PMOI02/9001) pra não depender de sf_sn_na_faixa
# aceitar o formato do bipe. Este teste tem que falhar contra o código de hoje (chave = p_bipe cru).
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, qtd_por_caixa, numero_serie, numero_serie_norm)
   values ('Marcos', 'Embalagem', 'PMOI02', '9001', 'Cliente Sem Faixa', '0015718', 1, '0015718', '430046200015718')"
BIPE_A="sf_almoxarifado_entrada('PMOI02','9001','Almoxarifado','%s','00043-00462-0015718','serie',1,'430046200015718')"
BIPE_B="sf_almoxarifado_entrada('PMOI02','9001','Almoxarifado','%s','000043-00462-0015718','serie',1,'430046200015718')"
printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE_A" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$BIPE_B" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_serie_norm = '430046200015718'")
[ "$B" = ja_lancado ] && [ "$N" = 1 ] \
  && echo "corrida (bipes crus diferentes, mesma série normalizada): ok" \
  || { echo "corrida da série normalizada FALHOU (B=$B, linhas=$N)"; exit 1; }

# CORRIDA entre o CANCELAMENTO DA CAIXA (0131) e o REBIPE dela. As duas funções pegam a MESMA chave de
# trava ('sf_almox/<pmo>/<op>/<posto>/<código>'), e é isso que este teste prova: a sessão A cancela e
# segura a transação; a B rebipa 1s depois e tem que ESPERAR — quando a A comitar, a B vê a caixa
# limpa e a entrada é ACEITA. Sem a trava compartilhada, a B leria as linhas de antes do delete (em
# READ COMMITTED cada statement vê o banco no instante em que começa), recusaria por ja_lancado, e a
# caixa ficaria fora do estoque justamente porque alguém a estava devolvendo ao fluxo.
QTD=$(docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c \
  "insert into sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada)
   values ('PMOC14', '8498', 'Embalagem', 21, 4, 4, 'CX[21][4]8498-PMOC14', true)" -c \
  "insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
   select 'Marcos', 'Embalagem', 'PMOC14', '8498', 'Cliente Coletiva', 'CX[21][4]8498-PMOC14',
          'SN-' || (8400 + i)::text, (8400 + i)::text from generate_series(1, 4) i" -c \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false)" -c \
  "select sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','Ana','CX[21][4]8498-PMOC14','caixa',4,'')->>'quantidade'" \
  | tail -1)
[ "$QTD" = 4 ] || { echo "corrida do cancelamento: a entrada de partida falhou (qtd=$QTD)"; exit 1; }
printf "%s\n" \
  "select set_config('teste.perms','shopfloor.administrar',false);" \
  "begin;" \
  "select sf_cancelar_caixa_almoxarifado((select id from sf_registros where posto='Almoxarifado' and numero_caixa='CX[21][4]8498-PMOC14' limit 1), 'corrida');" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select sf_almoxarifado_entrada('PMOC14','8498','Almoxarifado','Bruno','CX[21][4]8498-PMOC14','caixa',4,'')::text;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select count(*) from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[21][4]8498-PMOC14'")
echo "$B" | grep -q '"ok": true' && [ "$N" = 4 ] \
  && echo "corrida (cancelar a caixa × rebipe): ok" \
  || { echo "corrida do cancelamento FALHOU (B=$B, linhas=$N)"; exit 1; }

# ATOMICIDADE VISTA DE FORA: o registro e a fila vingam juntos, ou nenhum dos dois.
# O teste 35 prova que o erro PROPAGA, mas ele roda a RPC dentro de `begin ... exception`, uma
# SUBTRANSAÇÃO que desfaz os dois lados de qualquer jeito — contar linhas ali dentro não provaria nada
# (achado de revisão). Aqui a prova vem de fora: o gatilho é criado e COMITADO numa sessão, o bipe roda
# em OUTRA em autocommit (então o rollback é o de verdade, o mesmo que acontece via PostgREST) e a
# conferência vem numa terceira. Se a RPC gravasse um lado sem o outro — ou engolisse o erro da fila
# com um `exception when others` pra "não quebrar o bipe por causa do ERP" —, sobraria linha aqui.
# A caixa 3 da OP 8502 existe na massa do teste 35 só pra isto: nenhuma entrada foi dada nela.
BIPE3="sf_almoxarifado_entrada('PMOC19','8502','Almoxarifado','Ana','CX[3][2]8502-PMOC19','caixa',2,'')"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "create trigger teste_explode_fila_3 before insert on sf_estoque_envios
     for each row when (new.bipe = 'CX[3][2]8502-PMOC19') execute function public.teste_explode()"
set +e
ERRO=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select $BIPE3;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq 2>&1)
set -e
SOBROU=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros
            where posto = 'Almoxarifado' and numero_caixa = 'CX[3][2]8502-PMOC19')
       || '/' || (select count(*) from sf_estoque_envios where bipe = 'CX[3][2]8502-PMOC19')")
echo "$ERRO" | grep -q EXPLODIU && [ "$SOBROU" = 0/0 ] \
  && echo "atomicidade vista de fora (o bipe falhou e não sobrou meio gesto): ok" \
  || { echo "atomicidade vista de fora FALHOU (erro=$ERRO, registros/fila=$SOBROU)"; exit 1; }

# E o controle positivo, na mesma sessão de fora: sem o gatilho, o MESMO bipe grava os dois lados (2
# registros, 1 linha na fila). Sem ele, um 0/0 acima poderia ser a RPC recusando por outro motivo.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "drop trigger teste_explode_fila_3 on sf_estoque_envios"
ENTROU=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select $BIPE3->>'quantidade';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
SOBROU=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros
            where posto = 'Almoxarifado' and numero_caixa = 'CX[3][2]8502-PMOC19')
       || '/' || (select count(*) from sf_estoque_envios where bipe = 'CX[3][2]8502-PMOC19')")
[ "$ENTROU" = 2 ] && [ "$SOBROU" = 2/1 ] \
  && echo "controle positivo (sem gatilho, os dois lados gravam): ok" \
  || { echo "controle positivo FALHOU (quantidade=$ENTROU, registros/fila=$SOBROU)"; exit 1; }

# O OUTRO SENTIDO DA MESMA ATOMICIDADE, também visto de fora: o REGISTRO falha → não sobra linha na
# FILA. O bloco de cima quebra só o lado da fila (achado de revisão: este lado não tinha nenhuma
# asserção falseável em lugar nenhum). Hoje ele não pode acontecer por construção — o insert da fila
# vem DEPOIS do dos registros —, e é justamente por isso que ele merece rede: uma "melhoria" que
# enfileire num gatilho, ou num helper que comita por conta própria, passaria a deixar a linha da fila
# órfã (uma entrada no ERP de peça que não existe no ShopFloor) sem nada acusar. A caixa 4 da OP 8502
# existe na massa do teste 35 só pra isto.
BIPE4="sf_almoxarifado_entrada('PMOC19','8502','Almoxarifado','Ana','CX[4][2]8502-PMOC19','caixa',2,'')"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "create trigger teste_explode_registro_4 before insert on sf_registros
     for each row when (new.posto = 'Almoxarifado' and new.numero_caixa = 'CX[4][2]8502-PMOC19')
     execute function public.teste_explode()"
set +e
ERRO=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select $BIPE4;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq 2>&1)
set -e
SOBROU=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros
            where posto = 'Almoxarifado' and numero_caixa = 'CX[4][2]8502-PMOC19')
       || '/' || (select count(*) from sf_estoque_envios where bipe = 'CX[4][2]8502-PMOC19')")
echo "$ERRO" | grep -q EXPLODIU && [ "$SOBROU" = 0/0 ] \
  && echo "atomicidade vista de fora, lado do registro (nada sobrou na fila): ok" \
  || { echo "atomicidade do lado do registro FALHOU (erro=$ERRO, registros/fila=$SOBROU)"; exit 1; }

# Controle positivo do mesmo lado: sem o gatilho, o MESMO bipe grava os dois lados (2 registros, 1
# linha na fila). Sem ele, o 0/0 acima poderia ser a RPC recusando a caixa por outro motivo.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "drop trigger teste_explode_registro_4 on sf_registros"
ENTROU=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select $BIPE4->>'quantidade';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
SOBROU=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros
            where posto = 'Almoxarifado' and numero_caixa = 'CX[4][2]8502-PMOC19')
       || '/' || (select count(*) from sf_estoque_envios where bipe = 'CX[4][2]8502-PMOC19')")
[ "$ENTROU" = 2 ] && [ "$SOBROU" = 2/1 ] \
  && echo "controle positivo do lado do registro: ok" \
  || { echo "controle positivo do lado do registro FALHOU (quantidade=$ENTROU, registros/fila=$SOBROU)"; exit 1; }

# CORRIDA: duas confirmações do MESMO LOTE ao mesmo tempo (0156). A sessão A confirma e segura a
# transação; a B tem que ESPERAR na trava do lote e, quando a A comitar, recusar por ja_lancado. Um
# lote, UM envio e N linhas — e não 2 envios e 2N linhas.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar',false)" \
  -c "select teste_reg('PMOL01','9201','Embalagem',s::text,'',s::text) from generate_series(7040,7043) s" \
  -c "select teste_lote('PMOL01','9201',array['7040','7041','7042','7043'],'Aprovado')" >/dev/null
LOTE=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select distinct nqa_lote_id from sf_registros where numero_serie_norm = '7040' and nqa_lote_id is not null")
CONF="sf_almoxarifado_lote('PMOL01','9201','Almoxarifado','%s','$LOTE'::uuid,array['7040','7041','7042','7043'])"
printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$CONF" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','recebimento.lancar,shopfloor.lancar',false);" \
  "select pg_sleep(1);" \
  "select $(printf "$CONF" Bruno)->>'motivo';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
wait "$A"
N=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros where posto = 'Almoxarifado' and numero_serie_norm in ('7040','7041','7042','7043'))
       || '/' || (select count(*) from sf_estoque_envios where lote_id = '$LOTE'::uuid)")
[ "$B" = ja_lancado ] && [ "$N" = 4/1 ] \
  && echo "corrida (duas confirmações do mesmo lote): ok" \
  || { echo "corrida do lote FALHOU (B=$B, registros/envios=$N)"; exit 1; }

# AS INVARIANTES DA FILA, DEPOIS DE TUDO — inclusive das etapas em bash acima. A mesma função que o
# teste 44(iv) chama dentro do almoxarifado_test.sql (uma definição, dois lugares de chamada): as
# etapas daqui também dão entrada, cancelam caixa e enfileiram, e elas rodam DEPOIS do arquivo SQL —
# sem esta chamada, ninguém olharia a fila que elas deixam. É a última coisa do runner de propósito:
# assim ela vale pro arquivo todo e pro bash todo, e não só pro trecho que vem antes dela.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c \
  "select public.teste_fila_invariantes('fim do runner, depois das etapas em bash')" >/dev/null \
  && echo "invariantes da fila depois das etapas em bash: ok" \
  || { echo "invariantes da fila FALHARAM depois das etapas em bash"; exit 1; }

# PLACAS=1: A FOTO DAS LEITURAS, N = 1. Com a massa inteira da suíte (todas as OPs com placas_por_painel
# = 1), as leituras pela 0165 (foto_depois) têm que ser IDÊNTICAS às das definições antigas (foto_antes:
# reaplica 0155, 0156, 0131, 0158 e 0159 sem a 0165). A única diferença aceita é a chave NOVA `paineis`
# do detalhe das peças avulsas. Depois a 0165 volta, DUAS vezes (idempotência), e as invariantes da fila
# são conferidas de novo.
if [ -n "${PLACAS:-}" ] && [ -z "${RED:-}" ]; then
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v tabela=foto_depois -f /tmp/foto.sql >/dev/null
  for m in 0155 0156 0131 0158 0159; do
    docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/raw_$m.sql
  done
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v tabela=foto_antes -f /tmp/foto.sql >/dev/null
  DIF=$(docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c "
    with d as (select fonte, pmo, op, chave, case when fonte like 'detalhe%' then v - 'paineis' else v end as v
                 from foto_depois)
    select (select count(*) from foto_antes) || '/' ||
           (select count(*) from ((select * from d) except all (select * from foto_antes)) x) || '/' ||
           (select count(*) from ((select * from foto_antes) except all (select * from d)) y)")
  case "$DIF" in
    0/*) echo "foto N=1 FALHOU: foto vazia ($DIF)"; exit 1 ;;
    */0/0) echo "foto N=1 das leituras (necessidades, lotes, pendências, detalhe): idênticas ($DIF): ok" ;;
    *) echo "foto N=1 FALHOU (linhas/só-depois/só-antes = $DIF)"
       docker exec "$NOME" psql -U postgres -c "
         (select 'depois' as lado, * from foto_depois except all select 'depois', * from foto_antes)
         union all (select 'antes', * from foto_antes except all select 'antes', * from foto_depois) limit 20"
       exit 1 ;;
  esac
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0165.sql
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0165.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c \
    "select public.teste_fila_invariantes('PLACAS: depois de reaplicar a 0165')" >/dev/null \
    && echo "0165 reaplicada duas vezes, invariantes da fila: ok" \
    || { echo "invariantes da fila FALHARAM depois de reaplicar a 0165"; exit 1; }
  echo "PLACAS ALMOXARIFADO OK"

  # 0167 (alerta de parado): sf_almox_pendencias, sf_almox_necessidades e sf_almox_lotes viram cascas das
  # respectivas _base (sem gate, para o cron). Entra aqui,
  # por cima da 0165 reaplicada, porque é o corpo da 0165 que ela copia. Antes dela, guarda a saída da
  # pública ANTIGA (pend_antes, lida pelo teste) e a foto das leituras; depois, a foto de novo — com a
  # massa inteira da suíte, as duas fotos têm que ser IDÊNTICAS (a casca não muda contrato nenhum).
  # Esta base não tem o esquema dos alertas, e a 0167 também mexe em alerta_regras e recria o
  # alerta_avaliar (que declara variável do tipo alerta_ocorrencias): o stub abaixo tem só as colunas
  # que os checks da 0167 citam, para a migração INTEIRA aplicar aqui como aplica no RDS. O
  # comportamento dos alertas é medido no rodar-alertas-test.sh. Duas aplicações, cada uma com -1.
  docker cp supabase/migrations/0167_alerta_almox_parado.sql "$NOME":/tmp/0167.sql
  docker cp supabase/tests/almox_pendencias_base_test.sql "$NOME":/tmp/teste_pend_base.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
    -c "create table public.alerta_regras (
          id uuid primary key default gen_random_uuid(), tipo text not null, modulo text not null,
          postos text[] not null default '{}', pmos text[], janela_tipo text, janela_valor int,
          taxa_minima numeric, minimo_bipes int, limite_tempo_seg int, limite_ocorrencias int,
          pausa_max_min int, hora_resumo time, lembrete_min int)" \
    -c "create table public.alerta_ocorrencias (id uuid primary key default gen_random_uuid())"
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
    -c "select set_config('teste.perms', 'recebimento.lancar,shopfloor.visualizar', false)" \
    -c "create table pend_antes as select * from public.sf_almox_pendencias()"
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v tabela=foto_pre0167 -f /tmp/foto.sql >/dev/null
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0167.sql
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0167.sql   # de novo: idempotente
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v tabela=foto_pos0167 -f /tmp/foto.sql >/dev/null
  DIF=$(docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c "
    select (select count(*) from foto_pre0167) || '/' ||
           (select count(*) from ((select * from foto_pos0167) except all (select * from foto_pre0167)) x) || '/' ||
           (select count(*) from ((select * from foto_pre0167) except all (select * from foto_pos0167)) y)")
  case "$DIF" in
    0/*) echo "foto da 0167 FALHOU: foto vazia ($DIF)"; exit 1 ;;
    */0/0) echo "foto das leituras antes x depois da 0167: idênticas ($DIF): ok" ;;
    *) echo "foto da 0167 FALHOU (linhas/só-depois/só-antes = $DIF)"; exit 1 ;;
  esac
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_pend_base.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c \
    "select public.teste_fila_invariantes('PLACAS: depois da 0167')" >/dev/null \
    && echo "0167 (pendências base + casca): ok" \
    || { echo "invariantes da fila FALHARAM depois da 0167"; exit 1; }
fi

# O PLANO ESTÁVEL DA sf_nqa_caixa (0160): OP nova e grande, sem analyze, tem que passar em < 3 s e
# manter as recusas. Idempotência da 0160 já foi exercida acima (aplicada duas vezes, psql -1).
# É a última etapa de propósito: ela cria uma OP de 10 mil registros e não deve sujar as invariantes.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_plano.sql
echo "plano estável da sf_nqa_caixa (0160): ok"
