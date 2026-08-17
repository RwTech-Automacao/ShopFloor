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

## Segurança
- `.env` fica **só nesta máquina** (o `service_role` bypassa RLS; nunca no repo/Vercel).
- Usuário do repinmetro é **read-only** (`SELECT`), de preferência restrito a `localhost`.
