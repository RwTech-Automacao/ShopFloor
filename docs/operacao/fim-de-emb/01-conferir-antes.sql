-- =============================================================
-- FIM DE EMB (0149 + 0150 + 0151) — CONFERÊNCIA ANTES DO DEPLOY (SOMENTE LEITURA)
--
-- Não grava nada: a sessão fica em modo somente leitura logo na primeira linha. Qualquer escrita
-- daria erro "cannot execute ... in a read-only transaction".
--
-- Como rodar (na instância Lightsail, UMA linha, a senha vai no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/fimemb-01.sql
-- (sem -1: cada consulta roda sozinha; o modo somente leitura vale para todas.)
--
-- Cada bloco começa com uma linha "== N." que diz o que é e o que a resposta significa.
-- Resumo do que PARA o deploy: qualquer "f" nos blocos 1, 2 e 6; qualquer número diferente de 0
-- no bloco 4; qualquer "t" em ja_existe_* no bloco 5.
-- =============================================================

set default_transaction_read_only = on;   -- vale para as próximas transações (rodando sem -1)
set transaction_read_only = on;           -- vale para a transação atual (caso rodem com -1)

\echo
\echo '== 1. As 5 funções que a 0149–0151 SUBSTITUEM estão exatamente na versão esperada?'
\echo '      igual_ao_esperado = t: o corpo vivo é byte a byte o da migração que o definiu por último'
\echo '      (0141 / 0137 / 0123 / 0115 / 0137) — é ESSE corpo que o 03-rollback devolve.'
\echo '      Algum f = produção tem uma versão diferente (hotfix?): PARE e mande a saída deste bloco.'
\echo '      existe = f: a função não está lá com essa assinatura: PARE.'
select v.assinatura,
       to_regprocedure(v.assinatura) is not null                                        as existe,
       coalesce((select md5(p.prosrc) = v.md5_esperado
                   from pg_proc p where p.oid = to_regprocedure(v.assinatura)), false)  as igual_ao_esperado,
       v.versao
  from (values
    ('public.alerta_avaliar(text,jsonb,jsonb)',                             '79274bef23e32cca865a39df36a1c5a8', '0141'),
    ('public.alerta_resolver_interno(uuid,uuid,boolean,text)',              '095fef212ad817150d4ee82c55ebb27d', '0137'),
    ('public.alerta_reservar_envios(text[],integer,uuid)',                  'b519ce9fae09446637b58b30e0b17a29', '0123'),
    ('public.alerta_destinatarios()',                                       '5b846b4f6d2532391648b1376556ed9c', '0115'),
    ('public.alerta_listar_ocorrencias(timestamptz,timestamptz,text)',      '6193e7506c083bfbac6d49d78f9c4d8d', '0137')
  ) v(assinatura, md5_esperado, versao)
 order by v.assinatura;

\echo
\echo '   Quantas versões (sobrecargas) de cada nome existem hoje. O normal é 1 em cada linha.'
\echo '   (alerta_regras_modulo_fixo, rec_embs_fechadas e rec_emb_divergencias: o normal é 0 — são da 0149/0150.)'
select n.nome, count(p.oid) as versoes
  from (values ('alerta_avaliar'), ('alerta_resolver_interno'), ('alerta_reservar_envios'),
               ('alerta_destinatarios'), ('alerta_listar_ocorrencias'), ('alerta_regras_modulo_fixo'),
               ('rec_embs_fechadas'), ('rec_emb_divergencias')) n(nome)
  left join pg_proc p on p.proname = n.nome and p.pronamespace = 'public'::regnamespace
 group by n.nome
 order by n.nome;

\echo
\echo '== 2. As policies que a 0149 SUBSTITUI (alerta_regras) e as que ela NÃO mexe (envios/ocorrências).'
\echo '      igual_ao_esperado = t: é a policy da 0113 — é ela que o 03-rollback recria.'
\echo '      f = a policy em produção é outra: PARE e mande a saída deste bloco.'
select p.tablename, p.policyname, p.cmd,
       coalesce(p.qual, '')       = coalesce(e.qual, '')
   and coalesce(p.with_check, '') = coalesce(e.with_check, '')  as igual_ao_esperado
  from (values
    ('alerta_regras',      'alerta_regras_select_admin',      '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)', null),
    ('alerta_regras',      'alerta_regras_insert_admin',      null, '(( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao) AND (excluida_em IS NULL))'),
    ('alerta_regras',      'alerta_regras_update_admin',      '(( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao) AND (excluida_em IS NULL))',
                                                              '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)'),
    ('alerta_envios',      'alerta_envios_select_admin',      '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)', null),
    ('alerta_ocorrencias', 'alerta_ocorrencias_select_admin', '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)', null),
    ('alerta_ocorrencias', 'alerta_ocorrencias_update_admin', '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)',
                                                              '( SELECT tem_permissao(''shopfloor''::text, ''administrar''::text) AS tem_permissao)')
  ) e(tablename, policyname, qual, with_check)
  left join pg_policies p on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
 order by e.tablename, e.policyname;

\echo '   Todas as policies das três tabelas, como estão (para comparar se algum f aparecer acima).'
\echo '   O normal são exatamente as 6 linhas acima, nenhuma a mais.'
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('alerta_regras', 'alerta_envios', 'alerta_ocorrencias')
 order by tablename, policyname;

\echo
\echo '== 3. Os CHECKs de alerta_regras / alerta_envios que a 0150/0151 trocam ou derrubam.'
\echo '      igual_ao_esperado = t em todas as 6 linhas: o 03-rollback recria cada um com este nome e esta definição.'
\echo '      Algum f (nome diferente ou definição diferente): PARE e mande a saída deste bloco.'
select e.tabela, e.nome,
       coalesce(pg_get_constraintdef(c.oid) = e.def, false) as igual_ao_esperado
  from (values
    ('alerta_regras', 'alerta_regras_tipo_valido',  'CHECK ((tipo = ANY (ARRAY[''aprovacao''::text, ''tempo''::text, ''defeito''::text, ''resumo''::text])))'),
    ('alerta_regras', 'alerta_regras_postos_check', 'CHECK ((cardinality(postos) > 0))'),
    ('alerta_regras', 'alerta_regras_canais_check', 'CHECK (((cardinality(canais) > 0) AND (canais <@ ARRAY[''telegram''::text, ''discord''::text])))'),
    ('alerta_regras', 'alerta_regras_campos_por_tipo', null),
    ('alerta_envios', 'alerta_envios_tipo_check',   'CHECK ((tipo = ANY (ARRAY[''alerta''::text, ''lembrete''::text, ''resolvido''::text, ''normalizou''::text, ''teste''::text, ''resumo''::text])))'),
    ('alerta_envios', 'alerta_envios_canal_check',  'CHECK ((canal = ANY (ARRAY[''telegram''::text, ''discord''::text])))')
  ) e(tabela, nome, def)
  left join pg_constraint c on c.conrelid = ('public.' || e.tabela)::regclass and c.conname = e.nome
 where e.def is not null
union all
-- o campos_por_tipo é longo: compara o md5 da definição (a da 0141)
select 'alerta_regras', 'alerta_regras_campos_por_tipo',
       coalesce((select md5(pg_get_constraintdef(c.oid)) = 'e27a2fc851099f9502f432e59c80a716'
                   from pg_constraint c
                  where c.conrelid = 'public.alerta_regras'::regclass
                    and c.conname = 'alerta_regras_campos_por_tipo'), false)
 order by 1, 2;

\echo
\echo '== 4. Linhas que VIOLARIAM os CHECKs novos da 0149–0151 (o add constraint valida o que já existe).'
\echo '      Cada número é a quantidade de linhas que fariam a migração FALHAR. Tudo 0 = seguro.'
\echo '      Qualquer número > 0: PARE (com -1 a migração voltaria inteira, mas é para olhar a linha antes).'
\echo '      As linhas de hoje ainda não têm a coluna modulo: ela nasce com o default shopfloor, que é o'
\echo '      que estas expressões supõem. São as expressões exatas dos checks das migrações.'
select
  -- 0149/0150 alerta_regras_modulo_tipo, com modulo = 'shopfloor'
  count(*) filter (where (coalesce(tipo in ('aprovacao', 'tempo', 'defeito', 'resumo'), false)) is false)
                                                                                   as regras_viola_modulo_tipo,
  -- 0150 alerta_regras_tipo_valido
  count(*) filter (where (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo', 'emb')) is false)
                                                                                   as regras_viola_tipo_valido,
  -- 0150 alerta_regras_campos_por_tipo (o ramo emb é o único acréscimo; os 4 antigos são os da 0141)
  count(*) filter (where (coalesce(
      case tipo
        when 'aprovacao' then
              taxa_minima is not null and minimo_bipes is not null
          and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
        when 'tempo' then
              janela_tipo in ('tempo', 'op')
          and limite_tempo_seg between 1 and 3600
          and minimo_bipes is not null
          and (pausa_max_min is null or pausa_max_min between 1 and 240)
          and (pausa_max_min is null or limite_tempo_seg < pausa_max_min * 60)
          and taxa_minima is null and limite_ocorrencias is null
        when 'defeito' then
              janela_tipo = 'tempo'
          and limite_ocorrencias >= 2
          and taxa_minima is null and minimo_bipes is null
          and limite_tempo_seg is null and pausa_max_min is null
        when 'resumo' then
              janela_tipo = 'intervalos'
          and janela_valor is null
          and taxa_minima is null and minimo_bipes is null and lembrete_min is null
          and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
        when 'emb' then
              janela_tipo = 'op'
          and janela_valor is null
          and cardinality(postos) = 0
          and coalesce(cardinality(pmos), 0) = 0
          and taxa_minima is null and minimo_bipes is null and lembrete_min is null
          and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
          and hora_resumo is null
      end, false)) is false)                                                       as regras_viola_campos_por_tipo,
  -- 0150 alerta_regras_postos_por_tipo
  count(*) filter (where ((tipo = 'emb' and cardinality(postos) = 0)
                          or (tipo <> 'emb' and cardinality(postos) > 0)) is false) as regras_viola_postos_por_tipo,
  -- 0151 alerta_regras_canais_validos
  count(*) filter (where (cardinality(canais) > 0
                          and canais <@ array['telegram', 'discord', 'email']) is false) as regras_viola_canais_validos
  from public.alerta_regras;

select
  -- 0150 alerta_envios_tipo_check
  count(*) filter (where (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo', 'emb')) is false)
                                                                                   as envios_viola_tipo_check,
  -- 0151 alerta_envios_canal_valido
  count(*) filter (where (canal in ('telegram', 'discord', 'email')) is false)     as envios_viola_canal_valido,
  -- 0151 alerta_envios_email_so_pessoa
  count(*) filter (where (canal <> 'email' or destino_tipo = 'usuario') is false)  as envios_viola_email_so_pessoa
  from public.alerta_envios;

\echo '   As linhas que violariam (o normal é NENHUMA linha abaixo; se aparecer, mande esta saída):'
select 'alerta_regras' as tabela, id::text, tipo as detalhe_1, array_to_string(canais, ',') as detalhe_2
  from public.alerta_regras
 where (coalesce(tipo in ('aprovacao', 'tempo', 'defeito', 'resumo'), false)) is false
    or ((tipo = 'emb' and cardinality(postos) = 0) or (tipo <> 'emb' and cardinality(postos) > 0)) is false
    or (cardinality(canais) > 0 and canais <@ array['telegram', 'discord', 'email']) is false
union all
select 'alerta_envios', id::text, tipo, canal || '/' || destino_tipo
  from public.alerta_envios
 where (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo', 'emb')) is false
    or (canal in ('telegram', 'discord', 'email')) is false
    or (canal <> 'email' or destino_tipo = 'usuario') is false
 order by 1, 2;

\echo
\echo '== 4b. O que existe hoje nas três tabelas (só informação; anote para comparar depois).'
\echo '      Regras por tipo (ativas = não excluídas e ligadas):'
select tipo, count(*) as regras, count(*) filter (where ativa and excluida_em is null) as ativas
  from public.alerta_regras group by tipo order by tipo;
\echo '      Regras por conjunto de canais:'
select array_to_string(canais, ',') as canais, count(*) as regras
  from public.alerta_regras group by 1 order by 1;
\echo '      Fila (alerta_envios) por canal e tipo; pendentes = ainda podem sair (não ok, < 3 tentativas, < 24 h):'
select canal, tipo, destino_tipo, count(*) as linhas,
       count(*) filter (where ok)                                                  as enviadas,
       count(*) filter (where not ok and tentativas < 3
                          and criado_em >= now() - interval '24 hours')            as pendentes
  from public.alerta_envios group by canal, tipo, destino_tipo order by 1, 2, 3;
select (select count(*) from public.alerta_regras)                                       as total_regras,
       (select count(*) from public.alerta_ocorrencias)                                  as total_ocorrencias,
       (select count(*) from public.alerta_ocorrencias where estado in ('aberta', 'resolvida')) as ocorrencias_vivas,
       (select count(*) from public.alerta_envios)                                       as total_envios,
       (select count(*) from public.alerta_envios
         where not ok and tentativas < 3 and criado_em >= now() - interval '24 hours')   as envios_pendentes_agora;

\echo
\echo '== 5. O que a 0149–0151 CRIA não pode existir ainda (o normal é f em tudo).'
\echo '      t em ja_existe_coluna_* / ja_existe_rec_* / ja_existe_alerta_emb_avisada = alguém já aplicou parte'
\echo '      das migrações: PARE e mande a saída (a 0149 NÃO pode ser reaplicada por cima da 0151).'
\echo '      ja_existe_copia_bkp = o 02 já rodou antes (t é normal se você está repetindo o passo).'
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'alerta_regras' and column_name = 'modulo') as ja_existe_coluna_modulo_regras,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'alerta_envios' and column_name = 'modulo') as ja_existe_coluna_modulo_envios,
       to_regprocedure('public.rec_embs_fechadas(timestamptz)') is not null                             as ja_existe_rec_embs_fechadas,
       to_regprocedure('public.rec_emb_divergencias(text)') is not null                                 as ja_existe_rec_emb_divergencias,
       to_regclass('public.alerta_emb_avisada') is not null                                             as ja_existe_alerta_emb_avisada,
       to_regprocedure('public.alerta_destinatarios(text)') is not null                                 as ja_existe_destinatarios_novo,
       to_regclass('public.alerta_bkp_0149_0151_objetos') is not null                                   as ja_existe_copia_bkp;

\echo
\echo '== 6. Pré-requisitos que a 0149–0151 usam (tudo tem que dar t, senão NÃO aplique).'
select to_regprocedure('public.rec_divergente(text)') is not null                    as tem_rec_divergente,
       to_regprocedure('public.rec_etapa_por_status(text)') is not null              as tem_rec_etapa_por_status,
       to_regprocedure('public.tem_permissao(text,text)') is not null                as tem_tem_permissao_2_args,
       to_regprocedure('public.usuario_tem_permissao(uuid,text,text)') is not null   as tem_usuario_tem_permissao,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'usuarios'
                  and column_name = 'email')                                         as tem_usuarios_email,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'processos_recebimento'
                  and column_name = 'finalizado_em')                                 as tem_finalizado_em,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'processos_recebimento'
                  and column_name = 'divergencia_justificada_por_nome')              as tem_justificada_por_nome,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'alerta_envios'
                  and column_name = 'destino_tipo')                                  as tem_destino_tipo_0123,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'alerta_regras'
                  and column_name = 'hora_resumo')                                   as tem_hora_resumo_0141;

\echo
\echo '== 7. Quem administra o Recebimento (são os únicos que podem ser responsáveis numa regra de Fim de EMB).'
\echo '      Só informação: quem aparecer aqui E estiver em ALERTAS_LIBERADO_PARA vai ver a tela nova.'
select coalesce(nullif(btrim(u.nome), ''), u.email) as usuario, u.email, u.ativo
  from public.usuarios u
 where u.ativo and public.usuario_tem_permissao(u.id, 'recebimento', 'administrar')
 order by 1;
