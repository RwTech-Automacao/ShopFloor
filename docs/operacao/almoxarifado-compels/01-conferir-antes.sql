-- =============================================================
-- ALMOXARIFADO + FILA DO COMPELS (0128, 0129, 0130, 0131, 0132, 0133, 0153) — CONFERÊNCIA ANTES DO DEPLOY
-- SOMENTE LEITURA
--
-- Não grava nada: a sessão fica em modo somente leitura logo na primeira linha. Qualquer escrita
-- daria erro "cannot execute ... in a read-only transaction".
--
-- Como rodar (na instância Lightsail, UMA linha, a senha vai no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/almox-01.sql
-- (sem -1: cada consulta roda sozinha; o modo somente leitura vale para todas.)
--
-- Cada bloco começa com uma linha "== N." que diz o que é e o que a resposta significa.
-- O QUE PARA O DEPLOY:
--   bloco 1: qualquer "f" em existe / igual_ao_esperado;
--   bloco 2: qualquer "t" (alguma das migrações já foi aplicada, no todo ou em parte);
--   bloco 3: perfil_almoxarifado_ja_existe = t, ou algum posto com esse perfil;
--   bloco 4: qualquer "f";
--   bloco 5: qualquer "f" em fim_de_emb_aplicado (o pacote do Fim de EMB tem que ter entrado antes).
-- O bloco 6 é só informação (anote os números); o 7 mostra sessões que podem atrapalhar o DDL; o 8 é o
-- VEREDITO em uma linha (PRONTO PARA APLICAR / JÁ APLICADO / PARE).
-- =============================================================

set default_transaction_read_only = on;   -- vale para as próximas transações (rodando sem -1)
set transaction_read_only = on;           -- vale para a transação atual (caso rodem com -1)

\echo
\echo '== 0. Onde estou (confirme que é o banco de PRODUÇÃO e que está em modo somente leitura).'
select current_database() as banco, current_user as usuario,
       current_setting('server_version') as versao_postgres,
       current_setting('transaction_read_only') as somente_leitura,
       now() as agora;

\echo
\echo '== 1. As 2 funções que as migrações SUBSTITUEM estão exatamente na versão esperada?'
\echo '      igual_ao_esperado = t: o corpo vivo é byte a byte o da migração que o definiu por último'
\echo '      (sf_nqa_caixa = 0100, sf_cancelar_lancamento = 0106) — é ESSE corpo que o 03-rollback devolve.'
\echo '      Algum f = produção tem uma versão diferente (hotfix?): PARE e mande a saída deste bloco.'
\echo '      existe = f: a função não está lá com essa assinatura: PARE.'
select v.assinatura,
       to_regprocedure(v.assinatura) is not null                                        as existe,
       coalesce((select md5(p.prosrc) = v.md5_esperado
                   from pg_proc p where p.oid = to_regprocedure(v.assinatura)), false)  as igual_ao_esperado,
       v.versao
  from (values
    ('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)', '83966057af3dd2643558b3bb213342a7', '0100'),
    ('public.sf_cancelar_lancamento(uuid,text)',                       'd7d065ebb018cc1825fff09b734a68ab', '0106')
  ) v(assinatura, md5_esperado, versao)
 order by v.assinatura;

\echo '   Dono, security definer, search_path e ACL (permissões) das duas, como estão HOJE.'
\echo '   O rollback devolve só o corpo: `create or replace` não mexe na ACL. O 02 guarda esta ACL e o'
\echo '   rollback confere no fim que ela continua igual. Só para olhar (o normal é a mesma ACL nas duas).'
select p.oid::regprocedure::text as funcao, pg_get_userbyid(p.proowner) as dono,
       p.prosecdef as security_definer, p.proconfig as config, p.proacl::text as acl
  from pg_proc p
 where p.oid in (to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)'),
                 to_regprocedure('public.sf_cancelar_lancamento(uuid,text)'))
 order by 1;

\echo
\echo '   Quantas versões (sobrecargas) de cada nome existem hoje. O normal é 1 nas duas primeiras'
\echo '   e 0 nas outras (são as funções novas).'
select n.nome, count(p.oid) as versoes
  from (values ('sf_nqa_caixa'), ('sf_cancelar_lancamento'),
               ('sf_sn_na_faixa'), ('sf_almoxarifado_entrada'), ('sf_cancelar_caixa_almoxarifado'),
               ('sf_estoque_chave'), ('sf_estoque_reverter'), ('sf_estoque_reservar'), ('sf_estoque_enviado')) n(nome)
  left join pg_proc p on p.proname = n.nome and p.pronamespace = 'public'::regnamespace
 group by n.nome
 order by n.nome;

\echo
\echo '== 2. O que as migrações CRIAM não pode existir ainda (o normal é f em TUDO).'
\echo '      Qualquer t = alguém já aplicou parte delas: PARE e mande a saída (a ordem importa).'
\echo '      ja_existe_copia_bkp / ja_existe_copia_fila = o 02 / o 03 já rodaram antes (t é normal se você'
\echo '      está repetindo o passo).'
select to_regclass('public.sf_estoque_envios') is not null                                     as ja_existe_tabela_fila,
       exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sf_estoque_envios') as ja_existe_indice_da_fila,
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sf_estoque_envios') as ja_existe_policy_da_fila,
       to_regprocedure('public.sf_sn_na_faixa(text,text,text)') is not null                    as ja_existe_sn_na_faixa,
       to_regprocedure('public.sf_almoxarifado_entrada(text,text,text,text,text,text,integer,text)') is not null as ja_existe_entrada,
       to_regprocedure('public.sf_cancelar_caixa_almoxarifado(uuid,text)') is not null         as ja_existe_cancelar_caixa,
       to_regprocedure('public.sf_estoque_chave(text,text,text,text,text)') is not null        as ja_existe_chave,
       to_regprocedure('public.sf_estoque_reverter(text,text,text,text,integer)') is not null  as ja_existe_reverter,
       to_regprocedure('public.sf_estoque_reservar(integer)') is not null                      as ja_existe_reservar,
       to_regprocedure('public.sf_estoque_enviado(text,text,uuid)') is not null                as ja_existe_enviado,
       to_regclass('public.almox_bkp_objetos') is not null                                     as ja_existe_copia_bkp,
       to_regclass('public.almox_bkp_estoque_envios') is not null                              as ja_existe_copia_fila;

\echo
\echo '== 3. O perfil "almoxarifado" (0128) não pode existir, e nenhum posto pode usá-lo.'
\echo '      perfil_almoxarifado_ja_existe = t ou postos_com_perfil_almoxarifado > 0: PARE e mande a saída.'
select exists (select 1 from public.sf_posto_perfis where chave = 'almoxarifado')              as perfil_almoxarifado_ja_existe,
       (select count(*) from public.sf_postos where perfil = 'almoxarifado')                   as postos_com_perfil_almoxarifado;
\echo '   Os perfis que existem hoje (a 0128 acrescenta mais UM, "almoxarifado"; os outros não mudam):'
select chave, nome, tem_status, reprova, gate, exige_manutencao, recurso
  from public.sf_posto_perfis
 order by chave;

\echo
\echo '== 4. Pré-requisitos que as migrações usam (tudo tem que dar t, senão NÃO aplique).'
select to_regclass('public.sf_registros') is not null                       as tem_sf_registros,
       to_regclass('public.sf_ordens') is not null                          as tem_sf_ordens,
       to_regclass('public.sf_postos') is not null                          as tem_sf_postos,
       to_regclass('public.sf_posto_perfis') is not null                    as tem_sf_posto_perfis,
       to_regclass('public.sf_caixas') is not null                          as tem_sf_caixas,
       to_regclass('public.sf_ordem_postos') is not null                    as tem_sf_ordem_postos,
       to_regclass('public.sf_registros_cancelados') is not null            as tem_sf_registros_cancelados,
       to_regprocedure('public.tem_permissao(text,text)') is not null       as tem_tem_permissao_2_args,
       to_regprocedure('public.sf_aposentar_caixa(text,text,text,text)') is not null as tem_sf_aposentar_caixa;
select (select count(*) = 3 from information_schema.columns
         where table_schema = 'public' and table_name = 'sf_registros'
           and column_name in ('numero_caixa', 'numero_serie_norm', 'pmo'))              as sf_registros_colunas,
       (select count(*) = 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'sf_caixas' and column_name = 'revisao') as sf_caixas_revisao_0100,
       (select count(*) = 3 from information_schema.columns
         where table_schema = 'public' and table_name = 'sf_ordens'
           and column_name in ('embalagem_individual', 'sn_ini', 'sn_fim'))              as sf_ordens_colunas,
       (select count(*) = 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'sf_postos' and column_name = 'perfil') as sf_postos_perfil,
       (select count(*) = 7 from information_schema.columns
         where table_schema = 'public' and table_name = 'sf_posto_perfis'
           and column_name in ('chave', 'nome', 'tem_status', 'reprova', 'gate', 'exige_manutencao', 'recurso')) as sf_posto_perfis_colunas;

\echo
\echo '== 5. O pacote do Fim de EMB (0149–0151) e a 0152 já estão em produção? (têm de estar: este deploy vem DEPOIS)'
\echo '      fim_de_emb_aplicado = f: PARE, aplique primeiro o pacote do Fim de EMB.'
\echo '      Estas migrações não dependem delas no banco; a ordem existe porque o app que sobe junto precisa das duas.'
select to_regclass('public.alerta_emb_avisada') is not null                                  as fim_de_emb_aplicado,
       to_regprocedure('public.rec_embs_fechadas(timestamptz)') is not null                   as tem_rec_embs_fechadas,
       to_regprocedure('public.rec_dashboard_opcoes()') is not null                           as tem_0152_rec_dashboard,
       to_regprocedure('public.alerta_destinatarios(text)') is not null                       as tem_0149_destinatarios;

\echo
\echo '== 6. O que existe hoje (só informação; anote para comparar depois).'
\echo '      Postos cadastrados (o posto Almoxarifado será criado À MÃO pela tela, depois do deploy):'
select p.chave, p.perfil, p.coletivo
  from public.sf_postos p
 order by p.ordem, p.chave;
select (select count(*) from public.sf_registros)                      as total_sf_registros,
       (select count(*) from public.sf_ordens)                         as total_sf_ordens,
       (select count(*) from public.sf_caixas)                         as total_sf_caixas,
       (select count(*) from public.sf_registros_cancelados)           as total_cancelados;

\echo
\echo '== 7. Sessões abertas há mais de 1 minuto "idle in transaction" (seguram lock e fazem a migração esperar).'
\echo '      O normal é NENHUMA linha. Se aparecer alguma, anote o pid e a consulta (não encerre sem avisar).'
select pid, usename, application_name, state, now() - xact_start as transacao_aberta_ha,
       left(query, 80) as ultima_consulta
  from pg_stat_activity
 where state = 'idle in transaction'
   and xact_start < now() - interval '1 minute'
   and pid <> pg_backend_pid()
 order by xact_start;

\echo
\echo '== 8. VEREDITO (resume só os blocos 1, 2 e 3; os blocos 4 e 5 você lê à parte).'
\echo '      PRONTO PARA APLICAR = as 2 funções são as antigas (0100/0106) e NADA do que as migrações criam existe.'
\echo '      JÁ APLICADO         = as 2 funções são as novas (0130/0133) e os 8 objetos novos + o perfil existem.'
\echo '      QUALQUER OUTRA COISA = estado parcial ou diferente do esperado: PARE e mande a saída inteira.'
select case
         when antigas_ok and novos = 0 and not perfil then 'PRONTO PARA APLICAR'
         when novas_ok and novos = 8 and perfil then 'JÁ APLICADO (as 7 migrações estão no banco)'
         else 'ESTADO PARCIAL OU DIFERENTE — PARE'
       end as veredito,
       antigas_ok as funcoes_antigas_0100_0106, novas_ok as funcoes_novas_0130_0133,
       novos as objetos_novos_existentes_de_8, perfil as perfil_almoxarifado_existe
  from (
    select coalesce((select md5(prosrc) = '83966057af3dd2643558b3bb213342a7'
                       from pg_proc where oid = to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)')), false)
       and coalesce((select md5(prosrc) = 'd7d065ebb018cc1825fff09b734a68ab'
                       from pg_proc where oid = to_regprocedure('public.sf_cancelar_lancamento(uuid,text)')), false) as antigas_ok,
           coalesce((select md5(prosrc) = '8fa7cb1d3fcf7000b6fa62c1d592c573'
                       from pg_proc where oid = to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)')), false)
       and coalesce((select md5(prosrc) = 'fb4741ea04c6f20be804b76b11f8ce08'
                       from pg_proc where oid = to_regprocedure('public.sf_cancelar_lancamento(uuid,text)')), false) as novas_ok,
           (select count(*) from (values
              (to_regclass('public.sf_estoque_envios')::oid),
              (to_regprocedure('public.sf_sn_na_faixa(text,text,text)')::oid),
              (to_regprocedure('public.sf_almoxarifado_entrada(text,text,text,text,text,text,integer,text)')::oid),
              (to_regprocedure('public.sf_cancelar_caixa_almoxarifado(uuid,text)')::oid),
              (to_regprocedure('public.sf_estoque_chave(text,text,text,text,text)')::oid),
              (to_regprocedure('public.sf_estoque_reverter(text,text,text,text,integer)')::oid),
              (to_regprocedure('public.sf_estoque_reservar(integer)')::oid),
              (to_regprocedure('public.sf_estoque_enviado(text,text,uuid)')::oid)) t(o) where o is not null) as novos,
           exists (select 1 from public.sf_posto_perfis where chave = 'almoxarifado') as perfil
  ) v;
