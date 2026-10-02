-- =============================================================
-- ALERTAS — QUEM RESOLVE DIZ O QUE FEZ
--
-- ⚠️ NUMERAÇÃO: a main para na 0127, mas 0128–0136 já estão commitadas em branches abertas
-- (feat/posto-almoxarifado 0128–0133, feat/sincronizacao-central 0134,
-- feat/etiquetas-inventario-rotativo 0135, esta mesma branch 0136). A 0137 era a próxima livre
-- quando este arquivo nasceu. A ordem de merge entre as branches ainda pode mudar: CONFIRA A
-- NUMERAÇÃO ANTES DE APLICAR.
--
-- Aplica POR CIMA da 0113/0115/0122/0123/0136 (nenhuma delas é editada). Idempotente: rodar de novo
-- não quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0137_alertas_explicacao.sql
--
-- O PROBLEMA: a ocorrência resolvida guarda QUEM resolveu e QUANDO, nunca O QUE FOI FEITO. Quem
-- recebeu o alerta no celular lê "✅ resolvido por Ana" e não sabe se trocaram o feeder, se
-- recalibraram a máquina ou se o número normalizou sozinho — e, sem isso, o alerta seguinte do mesmo
-- posto começa do zero.
--
-- A DECISÃO DE PRODUTO: a explicação é OPCIONAL. Resolver sem escrever nada continua resolvendo, e o
-- aviso aos OUTROS responsáveis sai sem rabo — nada de "resolvido por Ana:" com nada depois. É por
-- isso que a chave 'explicacao' só entra no `dados` quando há texto, em vez de entrar sempre vazia.
--
-- POR QUE O PARÂMETRO ENTRA NA `_interno`: resolver acontece por TRÊS portas — a tela do ShopFloor,
-- o botão do Discord e o do Telegram — e as três caem na MESMA função por dois invólucros
-- (alerta_resolver para o destinatário, alerta_resolver_admin para o gestor). No núcleo, nenhuma
-- porta escapa e não há regra duplicada em três lugares.
--
-- ONDE A FORMATAÇÃO MORA: aqui só sai o texto cru que a pessoa escreveu (aparado nas pontas).
-- Montar "✅ resolvido por Ana: trocamos o feeder", cortar no limite de 2000 caracteres do Discord e
-- escapar o que for preciso é src/modules/alertas/domain/mensagens.ts. Mesma divisão da 0113/0136.
--
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÕES EM PRODUÇÃO QUE ESTA MIGRAÇÃO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- Os corpos foram extraídos da 0136 (a versão viva — a 0136 recriou a `_interno` para acrescentar
-- PMO/OP e as posições ao aviso; recriar por cima da 0113 DESFARIA aquilo) e transformados ponto a
-- ponto. O `diff -u` entre a versão da 0136 e a daqui tem SÓ estas diferenças (mais os dois blocos
-- de COMENTÁRIO que explicam os itens 3 e 5). Quem revisar pode conferir do mesmo jeito.
--
-- public.alerta_resolver_interno(uuid, uuid, boolean, text) — 5 diferenças:
--   1. a assinatura ganha `p_explicacao text default ''` ao fim (o default é o que deixa o app de
--      hoje, que ainda não manda o campo, continuar chamando sem quebrar);
--   2. o `declare` ganha `v_expl text`;
--   3. uma linha nova antes do `if o.estado = 'aberta'`: v_expl := btrim(coalesce(p_explicacao, ''));
--   4. o `update` que marca a ocorrência como resolvida grava `explicacao = v_expl`;
--   5. o `dados` do envio 'resolvido' ganha a chave 'explicacao', por um `||` condicional — só
--      quando há texto.
--   NADA MAIS muda: as três exceções (NAO_DESTINATARIO, OCORRENCIA_ENCERRADA, o
--   usuario_tem_permissao do DESTINATÁRIO), o `for update`, o `if o.estado = 'aberta'` que faz a
--   segunda resolução não mexer em nada, o fan-out por (responsável x canal) com avisar_pessoas, e o
--   jsonb de retorno ficam iguais.
--
-- public.alerta_resolver(uuid, uuid, text) e public.alerta_resolver_admin(uuid, text) — 2
--   diferenças cada, as mesmas: a assinatura ganha `p_explicacao text default ''` e o repasse para a
--   `_interno` leva o parâmetro. O `tem_permissao('shopfloor', 'administrar')` de DOIS argumentos do
--   admin fica como está (a versão de um argumento anula o RBAC).
--
-- NÃO É RECRIADO, de propósito: alerta_avaliar. Quem abre, lembra, reabre e normaliza ocorrência
-- não tem nada a ver com explicação — ela só existe quando alguém resolve à mão. A 0136 continua
-- sendo a versão viva daquela função.
--
-- ---------------------------------------------------------------------------------------------
-- ⚠️ O `drop function` DAS ASSINATURAS ANTIGAS NÃO É OPCIONAL
--
-- Como o parâmetro novo é o ÚLTIMO e tem default, a assinatura nova atende quem chama sem ele. Mas
-- `create or replace` não substitui função de assinatura diferente: sem o drop, a velha e a nova
-- COEXISTIRIAM, e uma chamada que não passe o parâmetro (o app de hoje, o webhook, o PostgREST por
-- nome de argumento) cairia na VELHA, que não grava nada. A explicação sumiria em silêncio — a pior
-- forma de falhar. Por isso o drop vem antes, e o teste da 0137 conta as assinaturas.
-- =============================================================

-- ---------- A. A coluna ----------
-- Vazio é o default porque a explicação é OPCIONAL e porque TODA ocorrência resolvida antes desta
-- migração não tem explicação nenhuma: `not null default ''` deixa o histórico válido sem backfill
-- e sem um terceiro estado ("nulo" x "vazio") para a tela e as mensagens tratarem. Quem escreve
-- lê `explicacao = ''` como "não disse" e pronto.
alter table public.alerta_ocorrencias
  add column if not exists explicacao text not null default '';

comment on column public.alerta_ocorrencias.explicacao is
  'O que foi feito para resolver, escrito por quem resolveu (opcional). Vazio = não disse — é o '
  'default e é o valor de todo o histórico anterior à 0137. Só a primeira resolução grava: resolver '
  'de novo não sobrescreve.';

-- ---------- B. alerta_resolver_interno(): a explicação entra no núcleo ----------
-- Recriada da 0136 com as 5 diferenças declaradas no cabeçalho, e só elas.
drop function if exists public.alerta_resolver_interno(uuid, uuid, boolean);

create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean,
  p_explicacao text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  o     public.alerta_ocorrencias;
  r     public.alerta_regras;
  v_ja  boolean := true;
  v_nome text;
  v_expl text;
begin
  select * into o from alerta_ocorrencias where id = p_ocorrencia_id for update;
  if not found then raise exception 'OCORRENCIA_INEXISTENTE'; end if;
  select * into r from alerta_regras where id = o.regra_id;
  -- `p_usuario_id is null` explícito: falha FECHADA (null = any(...) dá NULL, não false).
  if p_exigir_destinatario and (p_usuario_id is null or not (p_usuario_id = any (r.destinatarios))) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  -- Usuário inexistente, desativado OU sem shopfloor.administrar nunca é responsável válido, mesmo
  -- que o uuid ainda esteja no array `destinatarios` da regra (usuario_tem_permissao já exige ativo).
  if p_exigir_destinatario
     and not public.usuario_tem_permissao(p_usuario_id, 'shopfloor', 'administrar') then
    raise exception 'NAO_DESTINATARIO';
  end if;
  if o.estado = 'normalizada' then raise exception 'OCORRENCIA_ENCERRADA'; end if;

  -- Aparar as pontas e tratar nulo como vazio: quem digita só espaços não escreveu nada, e um
  -- `dados.explicacao` de espaços viraria "resolvido por Ana:" com nada depois na mensagem.
  v_expl := btrim(coalesce(p_explicacao, ''));

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now(),
           explicacao = v_expl
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  -- FILA: "✅ resolvido por X" para os OUTROS responsáveis ativos que administram o ShopFloor, na
  -- mesma transação da resolução. Só na primeira resolução — apertar o botão de novo não avisa.
  -- `defeito` (nulo nos outros tipos) vai junto: numa regra de defeito com 2 códigos abertos no
  -- mesmo posto, sem ele o texto não diria QUAL dos dois foi resolvido.
  -- A explicação entra por `||` CONDICIONAL, e não como chave fixa: sem texto, a chave não existe, e
  -- o TS não precisa distinguir "não disse" de "disse nada" para não imprimir o rabo do "por X:".
  -- `o.explicacao` (e não v_expl) é o valor que REALMENTE ficou gravado na ocorrência.
  if not v_ja and r.avisar_pessoas then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao, destino_tipo)
    select o.id, c.usuario_id, c.canal, 'resolvido',
           jsonb_build_object('posto', o.posto, 'defeito', o.defeito, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em,
                              'pmo', o.pmo, 'op', o.op, 'ops', coalesce(o.ops, '[]'::jsonb))
           || case when coalesce(o.explicacao, '') <> ''
                   then jsonb_build_object('explicacao', o.explicacao)
                   else '{}'::jsonb
              end,
           false, 'usuario'
      from alerta_contas c
      join usuarios u on u.id = c.usuario_id and u.ativo
     where c.usuario_id = any (r.destinatarios)
       and c.canal = any (r.canais)
       and c.usuario_id is distinct from p_usuario_id
       and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
     order by c.usuario_id, c.canal;
  end if;

  return jsonb_build_object(
    'ocorrencia_id',      o.id,
    'regra_id',           o.regra_id,
    'posto',              o.posto,
    'ja_resolvida',       v_ja,
    'resolvida_por',      o.resolvida_por,
    'resolvida_por_nome', coalesce(v_nome, ''),
    'resolvida_em',       o.resolvida_em
  );
end
$func$;

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

-- ---------- C. Os dois invólucros, repassando ----------
-- Recriados da 0113 (nem a 0115, nem a 0123, nem a 0136 os tocaram) com as 2 diferenças declaradas.
drop function if exists public.alerta_resolver(uuid, uuid);

create or replace function public.alerta_resolver(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_explicacao text default ''
)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $func$
  select public.alerta_resolver_interno(p_ocorrencia_id, p_usuario_id, true, p_explicacao)
$func$;

revoke all on function public.alerta_resolver(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.alerta_resolver(uuid, uuid, text) to service_role;

drop function if exists public.alerta_resolver_admin(uuid);

create or replace function public.alerta_resolver_admin(
  p_ocorrencia_id uuid, p_explicacao text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return public.alerta_resolver_interno(p_ocorrencia_id, auth.uid(), false, p_explicacao);
end
$func$;

revoke all on function public.alerta_resolver_admin(uuid, text) from public, anon;
grant execute on function public.alerta_resolver_admin(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
