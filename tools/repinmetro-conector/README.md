# Conector repinmetro → ShopFloor

Espelha os logs de teste do **repinmetro** (Postgres na intranet) para a tabela
`repinmetro_logs` do **Supabase** do ShopFloor. Roda **na própria máquina do banco**
(lê por `localhost`, com usuário só-leitura) e só faz **saída HTTPS** pro Supabase.

## Como funciona
- **Watermark** = `MAX(origem_id)` já espelhado no Supabase → puxa só `teste.id > watermark`,
  em lotes, com **upsert idempotente** (rodar 2x não duplica; se um dia não rodar, o próximo
  recupera o atraso).
- **1ª vez** (tabela vazia): baseline no `MAX(teste.id)` atual (não traz histórico), **exceto**
  se `REPINMETRO_SINCE` estiver setado.

## Instalar (na máquina da intranet)
```bash
cd tools/repinmetro-conector
npm install
cp .env.example .env    # preencha as credenciais (Supabase + usuário read-only do repinmetro)
```

## Rodar na mão
```bash
node conector.mjs
```

## Teste A (validar o encanamento sem esperar produção)
Aponte o `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE` para o **Dev** e, com a tabela ainda vazia,
puxe algumas linhas já existentes:
```bash
REPINMETRO_SINCE=0 node conector.mjs   # traz o histórico; confira na tela Análise → Repinmetro
```
(Depois, pra valer, deixe `REPINMETRO_SINCE` em branco e aponte pro Prod.)

## Agendar (cron, 1x/hora)
```bash
crontab -e
# adicione (ajuste o caminho):
0 * * * * cd /caminho/para/tools/repinmetro-conector && /usr/bin/node conector.mjs >> conector.log 2>&1
```

## Produção na AWS (desde o corte de 28/08/2026)
Os arquivos de ambiente têm papéis fixos:
- **`.env.prod`** → **produção**. É o que o `run.sh` (cron da `10.0.0.210`) usa.
- **`.env`** → testes manuais (Dev).
- **`.env.example`** → modelo sem valores (o único que vai pro git).

No `.env.prod`:
- `SUPABASE_URL=https://apiawsshopfloor.enterplak.com.br`
- `SUPABASE_SERVICE_ROLE=` é o `SERVICE_ROLE_KEY` de `~/supabase/docker/.env` na Lightsail.

Até 14/09/2026 o cron ainda apontava pro Supabase na nuvem, então **nada chegou na AWS depois de 27/08**. Depois de trocar o `.env.prod`, basta rodar
`./run.sh` (ou `node --env-file=.env.prod conector.mjs`). A marca d'água é o `MAX(origem_id)` que já está no destino, então ele recupera todo o atraso sozinho e sem duplicar.

Pra conferir se a chave foi copiada inteira, compare o tamanho dela com o da Lightsail, sem mostrar o valor:
`grep '^SERVICE_ROLE_KEY=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '\n' | wc -c`

## Revenda de cada REP (opcional)
Com `REPINMETRO_REVENDA=1`, cada rodada também recarrega a **revenda** de todos os REPs na tabela
`repinmetro_revendas` (migração 0107). A tela Análise → Repinmetro mostra a revenda no card do teste.

- **Origem:** `chavecriptografica` × `revenda`, lendo só `numeroserierep`, `datahora`, `datahorasaidaexpedicao` e
  `razaosocial`. A chave criptográfica **nunca** é lida. O ideal é o usuário do conector ter leitura só dessas colunas:
  ```sql
  GRANT SELECT (id, numeroserierep, revenda_id, datahora, datahorasaidaexpedicao) ON chavecriptografica TO <usuário>;
  GRANT SELECT (id, razaosocial) ON revenda TO <usuário>;
  ```
  Alternativa: uma view com essas 4 colunas, informada em `REPINMETRO_REVENDA_VIEW`.
- **Casamento com o teste:** o serial completo é `00043` + modelo (5 dígitos) + nº de série (7 dígitos). O conector
  separa modelo e nº de série, e a tela casa por modelo + nº de série normalizado. Serial fora desse padrão é
  espelhado, mas não casa com nenhum teste (a rodada informa quantos).
- **Recarga completa:** a origem não tem data de alteração e a revenda pode ser associada depois do teste. Então
  tudo é regravado a cada rodada e o que foi excluído na origem é apagado. Se a view vier vazia, nada é apagado.

## Integração do REP (opcional)
Com `REPINMETRO_PRODUCAO=1`, cada rodada também espelha os **testes de produção** (`teste` × `testeproducao`)
na tabela `repinmetro_producao` (migração 0108): o REP, o status e os seriais das peças montadas (impressora,
MRP, módulo biométrico, RFID, fonte, leitor de barras). A tela Análise → Repinmetro → **Integração** busca pelo
nº de série do REP ou pelo serial de uma peça.

- **1ª vez:** com a tabela vazia, traz o histórico inteiro (~55 mil testes, poucos segundos).
- **Depois:** só os ids novos, e relê os testes dos últimos `REPINMETRO_PRODUCAO_RELER_DIAS` dias (default 3),
  porque um teste gravado como INICIADO é concluído na mesma linha.
- **Busca por peça:** os seriais são normalizados (sem traços, zeros à esquerda e maiúsculas) em `seriais_norm`,
  então `123-4567-8901` acha `0123-4567-8901`.

## Segurança
- `.env` fica **só nesta máquina** (o `service_role` bypassa RLS; nunca no repo/Vercel).
- Usuário do repinmetro é **read-only** (`SELECT`), de preferência restrito a `localhost`.
