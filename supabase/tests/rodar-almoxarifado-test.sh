#!/usr/bin/env bash
# Testes SQL do posto Almoxarifado (0128/0129 na entrada, 0131 no cancelamento da caixa inteira)
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
docker cp supabase/tests/almoxarifado_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar as migrações duas
# vezes na mesma base não pode falhar nem mudar o resultado. O caso conhecido é a caixa 7, que o
# teste já deu entrada: reaplicar a 0129 não pode fazer o segundo bipe dela ser aceito.
# A 0130 e a 0131 entram na conta pelo mesmo motivo: `create or replace` + revoke/grant, reaplicar não
# muda nada. (A 0087 não entra: ela tem `create policy`, que não é idempotente — e não é editável,
# está em produção.)
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0128.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0129.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0130.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0131.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0133.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','shopfloor.lancar',false)" \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "begin;" \
  "select $(printf "$BIPE_A" Ana)->>'ok';" \
  "select pg_sleep(3);" \
  "commit;" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq >/dev/null &
A=$!
B=$(printf "%s\n" \
  "select set_config('teste.perms','shopfloor.lancar',false);" \
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
  "select set_config('teste.perms','shopfloor.lancar',false)" -c \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
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
  "select set_config('teste.perms','shopfloor.lancar',false);" \
  "select $BIPE4->>'quantidade';" \
  | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
SOBROU=$(docker exec "$NOME" psql -U postgres -tAq -c \
  "select (select count(*) from sf_registros
            where posto = 'Almoxarifado' and numero_caixa = 'CX[4][2]8502-PMOC19')
       || '/' || (select count(*) from sf_estoque_envios where bipe = 'CX[4][2]8502-PMOC19')")
[ "$ENTROU" = 2 ] && [ "$SOBROU" = 2/1 ] \
  && echo "controle positivo do lado do registro: ok" \
  || { echo "controle positivo do lado do registro FALHOU (quantidade=$ENTROU, registros/fila=$SOBROU)"; exit 1; }

# AS INVARIANTES DA FILA, DEPOIS DE TUDO — inclusive das etapas em bash acima. A mesma função que o
# teste 44(iv) chama dentro do almoxarifado_test.sql (uma definição, dois lugares de chamada): as
# etapas daqui também dão entrada, cancelam caixa e enfileiram, e elas rodam DEPOIS do arquivo SQL —
# sem esta chamada, ninguém olharia a fila que elas deixam. É a última coisa do runner de propósito:
# assim ela vale pro arquivo todo e pro bash todo, e não só pro trecho que vem antes dela.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c \
  "select public.teste_fila_invariantes('fim do runner, depois das etapas em bash')" >/dev/null \
  && echo "invariantes da fila depois das etapas em bash: ok" \
  || { echo "invariantes da fila FALHARAM depois das etapas em bash"; exit 1; }
