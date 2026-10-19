-- =============================================================
-- 0152 — CONFERÊNCIA ANTES DO DEPLOY (SOMENTE LEITURA)
--
-- Não grava nada: a sessão fica em modo somente leitura logo na primeira linha. Qualquer escrita
-- daria erro "cannot execute ... in a read-only transaction".
--
-- Como rodar (na instância Lightsail, UMA linha, a senha vai no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/0152-01.sql
-- (sem -1: cada consulta roda sozinha; o modo somente leitura vale para todas.)
--
-- Cada bloco abaixo começa com uma linha "== N." que diz o que é e o que a resposta significa.
-- Se o bloco 6 disser que falta coluna, os blocos 2 a 5 também dão erro: PARE e não aplique a 0152.
-- =============================================================

set default_transaction_read_only = on;   -- vale para as próximas transações (rodando sem -1)
set transaction_read_only = on;           -- vale para a transação atual (caso rodem com -1)

\echo
\echo '== 1. Processos por status (cancelado fica FORA de todos os números do dashboard).'
\echo '      Serve de referência: o total da tabela antes e depois da 0152 tem que ser o mesmo.'
select status, count(*) as processos
  from public.processos_recebimento
 group by status
 order by count(*) desc, status;

select count(*) as total_de_processos from public.processos_recebimento;

\echo
\echo '== 2. Fornecedor / comprador com espaço em branco nas pontas.'
\echo '      *_com_branco_na_ponta = qualquer branco (espaço, tab, quebra de linha, NBSP) no começo ou no fim.'
\echo '      *_que_btrim_nao_pega  = destes, os que o btrim antigo NÃO aparava (tab, quebra de linha, NBSP).'
\echo '      Com a 0152 todos eles se juntam ao nome limpo no dashboard (ex.: "ACME<tab>" conta como "ACME").'
\echo '      Zero nos quatro = nada muda na lista de fornecedores/compradores por causa disso.'
select count(*) filter (where fornecedor ~ '^[\s ]|[\s ]$')                                  as fornecedor_com_branco_na_ponta,
       count(*) filter (where fornecedor ~ '^[\s ]|[\s ]$' and btrim(fornecedor) = fornecedor) as fornecedor_que_btrim_nao_pega,
       count(*) filter (where comprador  ~ '^[\s ]|[\s ]$')                                  as comprador_com_branco_na_ponta,
       count(*) filter (where comprador  ~ '^[\s ]|[\s ]$' and btrim(comprador) = comprador)   as comprador_que_btrim_nao_pega
  from public.processos_recebimento;

\echo
\echo '== 3. Datas de chegada.'
\echo '      fora_de_2000_a_2100 = datas sujas (ex.: 1899 do Excel, ano digitado errado). Entram nos totais,'
\echo '      mas esticam o gráfico semanal (que tem teto de 520 semanas).'
\echo '      mais_de_52_semanas_no_futuro = o gráfico as ignora quando a tela não tem "Até" (os totais contam).'
\echo '      Zero nos dois = o gráfico mostra exatamente o período dos dados.'
select min(data_chegada)                                                              as primeira_chegada,
       max(data_chegada)                                                              as ultima_chegada,
       count(*) filter (where data_chegada is null)                                   as sem_data_chegada,
       count(*) filter (where data_chegada < date '2000-01-01'
                           or data_chegada > date '2100-12-31')                       as fora_de_2000_a_2100,
       count(*) filter (where data_chegada > current_date + 52 * 7)                   as mais_de_52_semanas_no_futuro
  from public.processos_recebimento;

\echo
\echo '== 4. Justificativas feitas só de branco.'
\echo '      so_espacos = texto não vazio feito SÓ de espaços: a 0152 vai deixá-las vazias ('''').'
\echo '      so_tab_quebra_ou_nbsp = feitas só de tab / quebra de linha / NBSP (podem ter espaço junto):'
\echo '      a 0152 NÃO mexe nelas (o btrim só tira espaço). Só informação: o app apara antes de gravar,'
\echo '      então elas só existem se alguém escreveu direto no banco.'
select count(*) filter (where divergencia_justificativa <> ''
                          and btrim(divergencia_justificativa) = '')                                as so_espacos,
       count(*) filter (where btrim(divergencia_justificativa) <> ''
                          and regexp_replace(divergencia_justificativa, '[\s ]', '', 'g') = '') as so_tab_quebra_ou_nbsp
  from public.processos_recebimento;

\echo
\echo '== 5. O que o UPDATE da 0152 vai tocar (mesmo WHERE da migração).'
\echo '      linhas_que_o_update_muda = quantas o UPDATE da 0152 vai mudar (= so_espacos do bloco 4).'
\echo '      destas_com_divergencia   = destas, as que têm divergência (divergencia_num <> 0).'
\echo '      destas_que_viram_pendente_no_dashboard = com divergência e não canceladas: passam de'
\echo '      "justificada" para "sem justificativa" no SQL (a tela de Processos já as mostrava como pendentes).'
\echo '      Zero = o UPDATE não muda nada e o passo 02 (cópia) não copia nada.'
select count(*)                                                               as linhas_que_o_update_muda,
       count(*) filter (where divergencia_num <> 0)                           as destas_com_divergencia,
       count(*) filter (where divergencia_num <> 0 and status <> 'cancelado') as destas_que_viram_pendente_no_dashboard
  from public.processos_recebimento
 where divergencia_justificativa <> ''
   and btrim(divergencia_justificativa) = '';

\echo
\echo '== 6. Pré-requisitos da 0152 (tudo tem que dar t, senão NÃO aplique).'
\echo '      ja_tem_* = a 0152 já foi aplicada antes (t não impede: ela é idempotente, só avisa).'
\echo '      ja_tem_copia_bkp_0152 = o passo 02 já rodou antes (t é normal se você está repetindo).'
select to_regprocedure('public.rec_justificar_divergencia(uuid,text)') is not null             as tem_rec_justificar_divergencia,
       to_regprocedure('public.tem_permissao(text,text)') is not null                          as tem_tem_permissao_2_args,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'processos_recebimento'
                  and column_name = 'divergencia_num')                                         as tem_coluna_divergencia_num,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'processos_recebimento'
                  and column_name = 'divergencia_justificativa')                               as tem_coluna_divergencia_justificativa;

select to_regprocedure('public.rec_norm_texto(text)') is not null                              as ja_tem_rec_norm_texto,
       to_regprocedure('public.rec_dashboard(text,text,text,text,date,date,text)') is not null as ja_tem_rec_dashboard,
       to_regprocedure('public.rec_dashboard_opcoes()') is not null                            as ja_tem_rec_dashboard_opcoes,
       to_regclass('public.processos_recebimento_bkp_0152') is not null                        as ja_tem_copia_bkp_0152;
