# Repinmetro — espelho dos logs de teste (v1: consulta por SN)

## Contexto
O **repinmetro** (webapp Java em `10.0.0.210:8443`, banco **Postgres** na mesma máquina Linux)
grava os resultados da tela **Teste Qualidade** (`testeQualidade.do`) em duas tabelas
(`teste` + `testequalidade`, ligadas por `teste.id = testequalidade.id`). A Enterplak quer esses
resultados **visíveis no ShopFloor** (nuvem/Vercel). Ligação pelo **Nº de Série do produto final**
(`numeroserierep`).

## Arquitetura (mão única, outbound) — já decidida no brainstorm
`repinmetro (Postgres intranet)` → **conector Node** (na própria máquina, `localhost`, user
read-only) → **upsert** em `repinmetro_logs` (Supabase) → ShopFloor **só lê**. Nada da intranet
exposto pra fora (só saída HTTPS). Chave = SN do produto final. `teste.id` é **sequencial +1** →
watermark.

## Peças
1. **Migração `0077_repinmetro_logs`** — tabela-espelho + RLS (`select` = `tem_permissao('visualizar')`;
   escrita só service_role, que bypassa RLS) + índice por `numero_serie`.
2. **Conector** (`tools/repinmetro-conector/`) — Node `pg` (lê) + `@supabase/supabase-js` (escreve
   com service_role). Watermark = `MAX(origem_id)` no Supabase; se vazio, baseline = `REPINMETRO_SINCE`
   (teste) ou `MAX(teste.id)` (sem backfill, "só daqui pra frente"). Puxa `t.id > since` em lotes de
   1000, **upsert idempotente** por `origem_id`. Roda no **cron** (1x/dia ou hora).
3. **Tela "Repinmetro"** (aba em Análise) — bipa/digita o SN → lista os testes daquela peça
   (cabeçalho: data, modelo, status geral; + os 15 itens coloridos Aprovado/Reprovado/NA).

## Mapa de colunas (fonte → espelho)
`id`→`origem_id` (PK/watermark) · `numeroserierep`→`numero_serie` · `serialmodelorep`→`modelo` ·
`datahorainicio`→`data_inicio` · `datahorafim`→`data_fim` · `status`→`status` · `observacao`,
`remanufaturado`, `lacre` · `codigoop`→`op_codigo`, `anoop`→`op_ano`, `numeroplacaop`→`placa_op`
(bônus p/ v2: ligar à placa do ShopFloor). **15 resultados** (`statusteste*`/`status*`) →
`resultados` **jsonb** (chave = nome da coluna de origem). **`foto` NÃO é espelhada** (imagem
pesada).

## Fora do escopo (v1)
- Ligar o teste à placa rastreada no ShopFloor (v2, usa `op_codigo`/`placa_op`).
- Espelhar `foto`.
- Normalização de SN com zero à esquerda (consulta é match exato por enquanto).

## Pendente pra testar (Teste A)
Credenciais do **usuário read-only** (db + user + senha). Migração aplicada no **Dev** primeiro.
Com `REPINMETRO_SINCE=0` o conector puxa linhas já existentes pra validar o encanamento sem
depender de produção.
