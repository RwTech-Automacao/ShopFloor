-- =============================================================
-- ALMOXARIFADO + FILA DO COMPELS (0128, 0129, 0130, 0131, 0132, 0133, 0153) — ROLLBACK
-- Só se algo der errado DEPOIS de as migrações terem sido aplicadas.
--
-- ⚠️ PRIMEIRO O APP, DEPOIS ESTE ARQUIVO. Volte o app para o commit de antes (DEPLOY-ALMOXARIFADO-COMPELS.md,
-- "Se algo der errado", passo 1) ANTES de rodar isto. O app novo chama sf_almoxarifado_entrada,
-- sf_cancelar_caixa_almoxarifado, sf_estoque_reservar e sf_estoque_enviado, lê e grava sf_estoque_envios
-- e conta com o perfil "almoxarifado" — tudo o que este arquivo apaga. O app VELHO funciona com o banco
-- novo (as migrações só acrescentam objetos; as duas funções recriadas mantêm a assinatura), então a
-- ordem "app primeiro" não deixa janela quebrada; a ordem contrária deixaria: a tela do Almoxarifado e o
-- cron do estoque dariam erro de "function does not exist" até o app voltar.
--
-- Devolve o banco ao estado de ANTES da 0128, numa transação só (tudo ou nada):
--   a) TRAVA: se algum posto (sf_postos.perfil) usa o perfil "almoxarifado", ABORTA com mensagem clara,
--      sem mudar nada. O posto cadastrado com esse perfil aponta para a linha de sf_posto_perfis que
--      o rollback apaga (chave estrangeira); desatribuir o perfil é decisão de quem administra o posto,
--      não deste arquivo. Ver a mensagem para o que fazer;
--   b) copia TODAS as linhas da fila sf_estoque_envios para public.almox_bkp_estoque_envios (RLS ligada,
--      fechada para o app; uma linha por entrada da fila, inteira em jsonb) e imprime a contagem —
--      linhas já enviadas ao Compels (ok), pendentes (entradas ou estornos), estornos e canceladas. ⚠️ O que já foi ENVIADO ao
--      ERP continua lá: apagar a fila daqui NÃO desfaz estoque no Compels; a cópia é o registro do que foi;
--   c) as 2 funções que as migrações substituíram voltam ao corpo de antes, COPIADO BYTE A BYTE das
--      migrações que as definiram por último antes da 0128 — sf_nqa_caixa (0100) e
--      sf_cancelar_lancamento (0106) —, com as mesmas ACLs (`create or replace` não mexe nelas);
--   d) saem as 7 funções novas, com as assinaturas exatas: sf_estoque_enviado, sf_estoque_reservar,
--      sf_estoque_reverter, sf_estoque_chave, sf_cancelar_caixa_almoxarifado, sf_almoxarifado_entrada,
--      sf_sn_na_faixa;
--   e) sai a tabela sf_estoque_envios (e com ela os índices e a policy);
--   f) sai a linha 'almoxarifado' de sf_posto_perfis;
--   g) CONFERE o resultado contra a cópia public.almox_bkp_objetos (feita pelo 02-copiar-antes.sql):
--      avisa se o corpo ou a ACL devolvidos não forem iguais ao que estava em produção antes. Sem a cópia,
--      só avisa e segue (e compara com o md5 esperado das migrações 0100/0106);
--   h) avisa o PostgREST (notify pgrst).
--
-- O que o rollback NÃO desfaz (e por quê): as linhas de sf_registros que o Almoxarifado gravou (são dados
-- de produção da linha, com a peça/caixa, e ficam para quem as consulta) e as de sf_registros_cancelados.
-- Sem o perfil, o posto onde elas foram gravadas já não existe como Almoxarifado (a trava do passo a só
-- deixa o rollback correr com o posto reatribuído a outro perfil), mas as linhas continuam no histórico.
--
-- Idempotente: rodar de novo recria os mesmos corpos, os drops são "if exists", e a cópia da fila usa
-- on conflict (a segunda rodada não acha a tabela e não copia nada). As tabelas de cópia NÃO são
-- apagadas (ficam como registro; apagar à mão depois).
--
-- Como rodar (UMA linha, senha no prompt do -W):
--   PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/almox-03.sql
-- Depois: cd ~/supabase/docker && docker compose restart rest
-- =============================================================

begin;

-- ---------- a) TRAVA: nenhum posto pode estar usando o perfil "almoxarifado" ----------
do $func$
declare
  v_postos text;
begin
  select string_agg(p.chave, ', ' order by p.chave) into v_postos
    from public.sf_postos p
   where p.perfil = 'almoxarifado';
  if v_postos is not null then
    raise exception
      'ROLLBACK ABORTADO (nada foi alterado): estes postos usam o perfil almoxarifado: %. '
      'Apagar o perfil quebraria esses postos. Primeiro troque o perfil de cada um (Cadastrar Posto) '
      'ou exclua o posto, e rode este arquivo de novo.', v_postos
      using errcode = 'P0001';
  end if;
  raise notice 'a) trava ok: nenhum posto usa o perfil almoxarifado';
end
$func$;

-- ---------- b) a fila inteira vai para a cópia ANTES de a tabela ser apagada ----------
create table if not exists public.almox_bkp_estoque_envios (
  id_linha      uuid primary key,          -- sf_estoque_envios.id
  linha         jsonb not null,            -- a linha inteira (to_jsonb), inclusive a coluna gerada alvo
  copiado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.almox_bkp_estoque_envios is
  'Linhas da fila sf_estoque_envios (Almoxarifado/Compels) copiadas pelo 03-rollback.sql antes de a tabela ser apagada. Entradas ok=true JÁ foram para o ERP: este é o registro. Apagar só depois de conferido.';

alter table public.almox_bkp_estoque_envios enable row level security;
revoke all on table public.almox_bkp_estoque_envios from public, anon, authenticated;

do $func$
declare
  v_copiadas  bigint := 0;
  v_total     bigint := 0;
  v_enviadas  bigint := 0;
  v_pendentes bigint := 0;
  v_estornos  bigint := 0;
  v_canceladas bigint := 0;
begin
  if to_regclass('public.sf_estoque_envios') is null then
    raise notice 'b) a tabela sf_estoque_envios já não existe (rollback repetido): nada a copiar';
    return;
  end if;
  execute 'insert into public.almox_bkp_estoque_envios (id_linha, linha) '
          'select e.id, to_jsonb(e) from public.sf_estoque_envios e '
          'on conflict (id_linha) do update set linha = excluded.linha, atualizado_em = now()';
  get diagnostics v_copiadas = row_count;
  execute 'select count(*), count(*) filter (where ok), '
          'count(*) filter (where not ok and cancelado_em is null), '
          'count(*) filter (where operacao = ''estorno''), '
          'count(*) filter (where cancelado_em is not null) from public.sf_estoque_envios'
     into v_total, v_enviadas, v_pendentes, v_estornos, v_canceladas;
  raise notice 'b) fila copiada para almox_bkp_estoque_envios: % linhas (total na fila: %) | ja enviadas ao Compels (ok): % | nao enviadas e nao canceladas (pendentes, entradas ou estornos): % | estornos (no total): % | canceladas: %',
    v_copiadas, v_total, v_enviadas, v_pendentes, v_estornos, v_canceladas;
  if v_enviadas > 0 then
    raise notice 'b) ATENCAO: % entrada(s) JA FORAM ao Compels. Apagar a fila nao desfaz estoque no ERP; a copia e o registro.', v_enviadas;
  end if;
  if v_pendentes > 0 then
    raise notice 'b) ATENCAO: % linha(s) estavam PENDENTES (entradas ou estornos) e nunca irao ao Compels por esta fila (estao na copia).', v_pendentes;
  end if;
end
$func$;

-- ---------- c) as 2 funções substituídas voltam ao corpo de antes ----------

-- sf_nqa_caixa — corpo da migração 0100 (copiado byte a byte; o delimitador de dois cifrões da 0100
-- virou o delimitador $func$ por regra do repositório, o que não muda o corpo gravado no catálogo).
create or replace function public.sf_nqa_caixa(
  p_pmo           text,
  p_op            text,
  p_posto         text,
  p_colaborador   text,
  p_numero_caixa  text,
  p_resultado     text,
  p_posto_retorno text,
  p_amostras      jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $func$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
  v_cliente text;
  v_amostra_req numeric;
  v_posto_caixa text;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  select count(distinct numero_serie_norm), max(cliente), max(posto)
    into v_total, v_cliente, v_posto_caixa
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- (a) toda amostra tem que ser DESTA caixa.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where (el.v->>'sn_norm') not in (
      select numero_serie_norm from sf_registros
      where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
    )
  ) then
    raise exception 'AMOSTRA_FORA_DA_CAIXA';
  end if;

  -- (b) SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (pela qtd da caixa).
  if lower(p_resultado) = 'aprovado' then
    select tamanho_amostra into v_amostra_req
    from tabela_nqa
    where quantidade_min <= v_total and (quantidade_max is null or v_total <= quantidade_max)
    order by ordem
    limit 1;
    if v_amostra_req is null or v_amostra_req <= 0 then
      raise exception 'AMOSTRA_NQA_INVALIDA';
    end if;
    if coalesce(jsonb_array_length(p_amostras), 0) < v_amostra_req then
      raise exception 'AMOSTRAS_INSUFICIENTES';
    end if;
  end if;

  -- (c) 'Aprovado' não pode ter amostra reprovada.
  if lower(p_resultado) = 'aprovado' and exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'APROVADO_COM_REPROVA';
  end if;

  -- (d) 'Reprovado' exige ao menos uma amostra reprovada (Visual ou Funcional).
  if lower(p_resultado) = 'reprovado' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'REPROVADO_SEM_REPROVA';
  end if;

  -- Bloqueia se a caixa está NO NQA agora (último registro da peça = posto NQA).
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op
        and r.numero_serie_norm in (
          select numero_serie_norm from sf_registros
          where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
        )
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where ult.posto = p_posto
  ) then
    raise exception 'CAIXA_JA_INSPECIONADA';
  end if;

  -- 1 registro NQA por SN da caixa.
  for v_sn in
    select distinct numero_serie, numero_serie_norm from sf_registros
    where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
  loop
    select el.v into v_amostra
    from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where el.v->>'sn_norm' = v_sn.numero_serie_norm
    limit 1;

    insert into sf_registros (colaborador, posto, pmo, op, cliente, status,
      numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao, posto_retorno)
    values (p_colaborador, p_posto, p_pmo, p_op, coalesce(v_cliente, ''), p_resultado,
      v_sn.numero_serie, v_sn.numero_serie_norm,
      coalesce(v_amostra->>'visual', ''), coalesce(v_amostra->>'funcional', ''),
      case when v_amostra is not null then coalesce(v_amostra->>'observacao', '')
           else 'Por amostragem' end,
      nullif(p_posto_retorno, ''));
  end loop;

  -- Aposenta a montagem DEPOIS do loop: o loop acha as peças pelo numero_caixa, que a aposentadoria
  -- renomeia. Os registros do NQA nascem sem numero_caixa, então a renomeação não os alcança.
  if lower(p_resultado) = 'reprovado'
     and coalesce(v_posto_caixa, '') <> ''
     and v_posto_caixa = any(string_to_array(coalesce(p_posto_retorno, ''), ','))
  then
    perform sf_aposentar_caixa(p_pmo, p_op, v_posto_caixa, p_numero_caixa);
  end if;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$func$;

grant execute on function public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb) to authenticated;

-- sf_cancelar_lancamento — corpo da migração 0106 (copiado byte a byte).
create or replace function public.sf_cancelar_lancamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pmo text; v_op text; v_snnorm text; v_posto text; v_numero_caixa text;
  v_recurso text; v_ultimo uuid;
  v_cx record;
begin
  -- Gate por MÓDULO (2-arg), igual ao podeNoModulo('shopfloor','administrar') da UI/action —
  -- assim quem vê o botão passa na RPC (o 1-arg global divergia do gate da tela).
  if not tem_permissao('shopfloor', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, numero_serie_norm, posto, coalesce(numero_caixa, '')
    into v_pmo, v_op, v_snnorm, v_posto, v_numero_caixa
  from public.sf_registros
  where id = p_id;
  if not found then
    raise exception 'NAO_ENCONTRADO';
  end if;

  -- Serializa com o lançamento da mesma OP (o "último bipe" não muda no meio da checagem).
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Escopo: bloqueia postos com efeito colateral em outra tabela (recurso nulo = permitido).
  -- 'caixa' saiu da lista: o efeito colateral em sf_caixas é desfeito aqui embaixo.
  select p.recurso into v_recurso
  from public.sf_postos po
  join public.sf_posto_perfis p on p.chave = po.perfil
  where po.chave = v_posto;
  if v_recurso in ('nqa', 'integracao') then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- Burn-in (sf_burnin, 0069) e embalagem (sf_fechar_caixa, 0070) usam lock POR POSTO; o lock
  -- por-OP acima não serializa com eles. Pega também o lock por-posto pra o cancelamento não correr
  -- junto com um bipe de entrada/saída do burn-in nem com um fechamento de caixa (que reescreveria
  -- os numero_caixa embaixo da gente). Ordem OP→posto sempre (nenhuma função pega posto→OP), então
  -- não há deadlock.
  if v_recurso in ('burnin', 'caixa') then
    perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op || '/' || v_posto)::bigint);
  end if;

  -- LIFO: só o bipe mais recente do SN nesta OP.
  select id into v_ultimo
  from public.sf_registros
  where pmo = v_pmo and op = v_op and numero_serie_norm = v_snnorm
  order by data_hora desc, id desc
  limit 1;
  if v_ultimo is distinct from p_id then
    raise exception 'NAO_E_ULTIMO';
  end if;

  -- Move: guarda a linha inteira na auditoria e apaga da tabela viva.
  -- A auditoria é gravada ANTES da reabertura de propósito: o `dados` guarda o numero_caixa que a
  -- peça REALMENTE tinha no momento do cancelamento (o código final, se a caixa estava fechada).
  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select id, pmo, op, numero_serie_norm, posto, to_jsonb(r), p_motivo, auth.uid()
  from public.sf_registros r
  where id = p_id;

  delete from public.sf_registros where id = p_id;

  -- Embalagem: se a caixa da peça já estava FECHADA, reabre (inverso do sf_fechar_caixa).
  if v_recurso = 'caixa' and v_numero_caixa <> '' then
    -- Acha a caixa pelo código final (fechada) ou pelo marcador (aberta). O `<> ''` acima é o que
    -- impede casar com o codigo='' das caixas abertas.
    select c.id, c.seq, c.codigo, c.fechada into v_cx
    from public.sf_caixas c
    where c.pmo = v_pmo and c.op = v_op and c.posto = v_posto
      and c.revisao = 0
      and (c.codigo = v_numero_caixa or 'CX[' || c.seq || ']' = v_numero_caixa)
    limit 1;

    if found and v_cx.fechada then
      -- Volta as peças que sobraram pro marcador (o fechamento conta por ele).
      update public.sf_registros
         set numero_caixa = 'CX[' || v_cx.seq || ']'
       where pmo = v_pmo and op = v_op and posto = v_posto and numero_caixa = v_cx.codigo;
      -- ultima=false: se era a última da OP, o operador reconfere o "Última caixa" ao fechar de novo
      -- (senão a OP continuaria "concluída" com uma caixa aberta pendente).
      update public.sf_caixas
         set fechada = false, codigo = '', qtd = 0, ultima = false, fechada_em = null
       where id = v_cx.id;
    end if;
    -- Peça de uma montagem APOSENTADA (código com R) não chega aqui: depois da reprova o último bipe
    -- dela é o do NQA, e o LIFO já barrou com NAO_E_ULTIMO. Se chegasse, o filtro de revisao acima não
    -- acharia caixa e nada seria reaberto — o histórico fica como está.
  end if;
end
$func$;

-- ---------- d) saem as funções novas (assinaturas exatas) ----------
-- Primeiro a que lê a tabela (linguagem sql, depende dela), depois as outras.
drop function if exists public.sf_estoque_enviado(text, text, uuid);
drop function if exists public.sf_estoque_reservar(integer);
drop function if exists public.sf_estoque_reverter(text, text, text, text, integer);
drop function if exists public.sf_estoque_chave(text, text, text, text, text);
drop function if exists public.sf_cancelar_caixa_almoxarifado(uuid, text);
drop function if exists public.sf_almoxarifado_entrada(text, text, text, text, text, text, integer, text);
drop function if exists public.sf_sn_na_faixa(text, text, text);

-- ---------- e) sai a fila (índices e policy vão junto; sem CASCADE de propósito) ----------
drop table if exists public.sf_estoque_envios;

-- ---------- f) sai o perfil (a trava do passo a garante que nenhum posto o usa) ----------
delete from public.sf_posto_perfis where chave = 'almoxarifado';

-- ---------- g) conferência contra a cópia do 02 ----------
do $func$
declare
  r record;
  v_ok int := 0;
  v_dif int := 0;
  v_falta int := 0;
  v_md5 text;
  v_acl text;
  v_oid oid;
  v_sobrou text;
begin
  if to_regclass('public.almox_bkp_objetos') is null then
    raise warning 'g) a cópia public.almox_bkp_objetos NÃO existe (o 02 não rodou): sem ela só dá para comparar com o md5 esperado das migrações 0100/0106';
  else
    for r in select * from public.almox_bkp_objetos where tipo = 'funcao' order by nome loop
      v_oid := to_regprocedure('public.' || r.nome);
      if v_oid is null then
        v_falta := v_falta + 1;
        raise warning 'g) FALTANDO: % (estava na cópia e não existe depois do rollback)', r.nome;
        continue;
      end if;
      select md5(p.prosrc), p.proacl::text into v_md5, v_acl from pg_proc p where p.oid = v_oid;
      if v_md5 = r.md5_corpo and coalesce(v_acl, '') = coalesce(r.acl, '') then
        v_ok := v_ok + 1;
      else
        v_dif := v_dif + 1;
        raise warning 'g) DIFERENTE: % | corpo igual: % | ACL igual: %', r.nome, (v_md5 = r.md5_corpo),
          (coalesce(v_acl, '') = coalesce(r.acl, ''));
      end if;
    end loop;
    raise notice 'g) conferência com a cópia do 02: % iguais, % diferentes, % faltando', v_ok, v_dif, v_falta;
  end if;

  -- âncora independente da cópia: o md5 do corpo das migrações 0100 e 0106
  raise notice 'g) sf_nqa_caixa igual à 0100: %', coalesce((select md5(p.prosrc) = '83966057af3dd2643558b3bb213342a7'
    from pg_proc p where p.oid = to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)')), false);
  raise notice 'g) sf_cancelar_lancamento igual à 0106: %', coalesce((select md5(p.prosrc) = 'd7d065ebb018cc1825fff09b734a68ab'
    from pg_proc p where p.oid = to_regprocedure('public.sf_cancelar_lancamento(uuid,text)')), false);

  -- nada do que o rollback tinha de remover pode ter sobrado
  select string_agg(x.o, ', ') into v_sobrou
    from (
      select 'tabela sf_estoque_envios' as o where to_regclass('public.sf_estoque_envios') is not null
      union all select 'perfil almoxarifado' where exists (select 1 from public.sf_posto_perfis where chave = 'almoxarifado')
      union all select p.oid::regprocedure::text from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('sf_sn_na_faixa', 'sf_almoxarifado_entrada', 'sf_cancelar_caixa_almoxarifado',
                                     'sf_estoque_chave', 'sf_estoque_reverter', 'sf_estoque_reservar', 'sf_estoque_enviado')
    ) x;
  if v_sobrou is null then
    raise notice 'g) nenhum objeto novo sobrou';
  else
    raise warning 'g) SOBROU: %', v_sobrou;
  end if;
end
$func$;

-- ---------- h) PostgREST ----------
notify pgrst, 'reload schema';

commit;
