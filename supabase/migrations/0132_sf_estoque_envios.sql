-- =============================================================
-- Posto Almoxarifado, Fase 2 — A FILA DE ENVIO DE ESTOQUE AO COMPELS (outbox)
-- Plano: docs/superpowers/plans/2026-09-29-almoxarifado-fase-2.md (Task 1)
--
-- O bipe do Almoxarifado grava a entrada em sf_registros (0129) e, na MESMA transação, põe uma linha
-- nesta fila. Ele NÃO espera o ERP: grava, enfileira e libera o operador. Quem entrega é o servidor,
-- chamado pelo crontab da instância — reserva um lote (sf_estoque_reservar), manda um a um e atualiza
-- a própria linha. Se o processo cair entre a decisão e a entrega, a linha pendente continua aqui e a
-- próxima rodada entrega.
--
-- ⚠️ O ÚLTIMO METRO — a chamada que fala com o Compels — NÃO EXISTE AINDA: endpoint, autenticação e
-- formato dependem de uma resposta do fornecedor. Até ela chegar, ESTA FILA ACUMULA E NÃO ESVAZIA, e
-- isso é esperado (a tela de pendências diz isso com todas as letras). A fila existir antes é o que
-- faz o primeiro erro real ter onde aparecer.
--
-- O molde é a fila dos Alertas, que já roda em produção: alerta_envios (0113) e
-- alerta_reservar_envios (0115) — mesma forma (ok/erro/tentativas/reservado_em/enviado_em, reserva em
-- lote com `for update skip locked`, teto de tentativas e janela de reserva vencida). As TRÊS
-- diferenças de propósito estão explicadas abaixo, cada uma onde mora.
--
-- Convenções deste repositório:
--   - corpo de função com $func$ (o SQL Editor do Supabase não aceita dois cifrões, nem em comentário);
--   - policy com (select tem_permissao(...)) — padrão da 0096 (InitPlan, não uma chamada por linha);
--   - permissão pela função de DOIS argumentos: a de um argumento anula o RBAC (revisão de 21/09/2026);
--   - aditiva e idempotente (if not exists, create or replace, drop policy if exists);
--   - notify pgrst na última linha (recarrega o schema do PostgREST).
--
-- ---------------------------------------------------------------
-- DIFERENÇA 1 — A CHAVE DE IDEMPOTÊNCIA É OBRIGATÓRIA E ÚNICA (os Alertas não têm nada parecido).
--
-- É ela que impede a mesma entrada de virar DUAS no ERP: o mesmo `chave` mandado de novo é a mesma
-- movimentação, e o Compels descarta a repetição. Ela precisa ser estável entre tentativas da MESMA
-- linha (é o reenvio que cria o risco: a rede pode ter engolido a resposta de um envio que o ERP já
-- gravou) e diferente entre movimentações diferentes.
--
-- O que identifica um bipe sem ambiguidade é o que a própria RPC de entrada (0129) usa para travar e
-- para recusar duplicidade:
--
--     ALMOX / <pmo> / <op> / <posto> / <alvo> / <E|S><n>
--
--   - `alvo` = o código da caixa (bipe de caixa) ou a SÉRIE NORMALIZADA (bipe de peça). Normalizada,
--     e não o bipe cru, pelo mesmo motivo da trava da 0129: um zero à esquerda a mais no coletor, ou
--     minúsculas, dão bipes crus diferentes para a MESMA peça — pelo cru, a mesma peça geraria duas
--     chaves e entraria duas vezes no ERP. A coluna `alvo` é GERADA a partir de serie_norm/bipe para
--     que essa escolha não possa divergir do que foi gravado.
--   - `E` (entrada) ou `S` (estorno): o cancelamento de uma entrada JÁ ENVIADA vira uma saída no ERP
--     (Task 2). É outra movimentação, então é outra chave — senão o ERP descartaria o estorno como
--     repetição da entrada.
--   - `<n>` = quantas vezes ESTE bipe já teve ESTA operação, contado nesta tabela (sf_estoque_chave).
--     Sem ele, o caminho de volta que a 0131 documenta — cancelar a caixa inteira e bipar outra vez —
--     seria bloqueado pela chave da entrada de ontem, e a caixa nunca chegaria ao estoque. Com ele, a
--     segunda entrada do mesmo bipe é ALMOX/.../E2: movimentação nova, chave nova.
--
-- Por que não o id (uuid) da linha desta fila, que já é único: ele não diz nada sobre o que foi
-- bipado. A chave viaja para o ERP e é por ela que alguém investiga uma divergência de estoque no dia
-- seguinte — legível, ela responde "que bipe foi esse" sem consultar dois bancos.
--
-- O `unique` é a última linha de defesa, não o mecanismo: quem enfileira é a RPC do bipe, já
-- serializada pela trava da 0129 e já recusando rebipe por `ja_lancado`. Se dois caminhos ainda
-- assim tentarem enfileirar o mesmo bipe, um dos dois morre aqui — e é isso que se quer.
-- ---------------------------------------------------------------
-- =============================================================

-- ---------- A fila ----------
-- DIFERENÇA 2 — a linha guarda o que o ERP PRECISA SABER (PMO, OP, posto, o que foi bipado, quantas
-- peças), e NÃO a carga montada. Os Alertas congelam `dados` na criação de propósito (um reenvio sai
-- com o texto idêntico ao da primeira tentativa). Aqui é o contrário: o formato da carga do Compels
-- ainda vai mudar, e carga velha esperando numa fila é armadilha — no dia em que o formato mudar, as
-- linhas paradas iriam com o formato antigo, e ninguém lembraria de migrar uma coluna jsonb. Quem
-- monta a carga é o envio, na hora, a partir destas colunas.
--
-- Estados (sem coluna de estado; tudo sai de ok/tentativas/reservado_em/cancelado_em):
--   PENDENTE  = ok = false, cancelado_em nulo e tentativas < 5 (nova: tentativas = 0);
--   RESERVADA = pendente com reservado_em nos últimos 15 min (uma rodada está entregando);
--   ENVIADA   = ok = true (enviado_em preenchido);
--   DESISTIU  = ok = false e tentativas >= 5 (aparece na tela de pendências como falha, com o erro);
--   CANCELADA = cancelado_em preenchido — a entrada foi cancelada no ShopFloor ANTES de chegar ao
--               ERP, então o certo é cancelar o envio pendente, e não mandar uma entrada e uma saída
--               que nunca precisaram existir (Task 2). Cancelar o que JÁ FOI enviado é outra coisa:
--               é um estorno, uma linha nova com operacao = 'estorno' — daí o check abaixo.
create table if not exists public.sf_estoque_envios (
  id           uuid primary key default gen_random_uuid(),
  -- a chave que vai para o ERP; vem de sf_estoque_chave (ver DIFERENÇA 1 no cabeçalho)
  chave        text not null check (btrim(chave) <> ''),
  operacao     text not null default 'entrada' check (operacao in ('entrada', 'estorno')),
  pmo          text not null,
  op           text not null,
  posto        text not null,
  -- 'caixa' = o bipe valeu a caixa inteira; 'serie' = uma peça (OP de embalagem individual)
  tipo         text not null check (tipo in ('caixa', 'serie')),
  bipe         text not null check (btrim(bipe) <> ''),   -- como veio do coletor
  serie_norm   text not null default '',                  -- vazio no bipe de caixa
  -- Se tipo='serie', serie_norm DEVE estar preenchida: é o que fica em alvo (coluna gerada).
  -- Sem este check, um bug na RPC futura poderia deixar serie_norm vazio, e alvo cairia no bipe
  -- cru. Aí a mesma peça bipada duas vezes com formatos crus diferentes (zero à esquerda do
  -- coletor, minúsculas) geraria duas identidades e duas chaves, burlando a unicidade de `chave`.
  -- A coluna gerada só tira a divergência se serie_norm for garantidamente válida.
  check (tipo <> 'serie' or btrim(serie_norm) <> ''),
  -- a identidade do bipe, sempre derivada do que foi gravado (nunca passada por fora, pra não poder
  -- divergir): série normalizada quando existe, senão o código da caixa.
  alvo         text generated always as (coalesce(nullif(serie_norm, ''), bipe)) stored,
  -- peças que entraram (a contagem das linhas que a 0129 gravou), sempre positiva. O SINAL do
  -- estorno é assunto da carga, montada na hora do envio: guardar quantidade negativa aqui faria a
  -- tela de pendências e qualquer soma futura terem que saber disso também.
  quantidade   int not null check (quantidade > 0),
  ok           boolean not null default false,
  erro         text,
  tentativas   int not null default 0 check (tentativas >= 0),
  reservado_em timestamptz,
  enviado_em   timestamptz,
  cancelado_em timestamptz,
  criado_em    timestamptz not null default now(),
  check (ok = (enviado_em is not null)),
  -- o que já foi enviado não se cancela: desfazer isso no ERP é um estorno (linha nova)
  check (cancelado_em is null or not ok)
);
alter table public.sf_estoque_envios enable row level security;

-- Aplicar o CHECK em bases que já têm a tabela (idempotência). O check inline só vale na
-- primeira criação; se a tabela já existe e o constraint não está lá, add.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sf_estoque_envios')
    and not exists (
      select 1 from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'sf_estoque_envios'
        and constraint_name = 'sf_estoque_envios_tipo_serie_exige_serie_norm'
    )
  then
    alter table public.sf_estoque_envios
      add constraint sf_estoque_envios_tipo_serie_exige_serie_norm
      check (tipo <> 'serie' or btrim(serie_norm) <> '');
  end if;
end $$;

-- A chave de idempotência. Índice separado (e não `unique` na coluna) para a migração ser idempotente
-- de verdade: com a tabela já criada, um `unique` inline não seria aplicado nunca.
create unique index if not exists sf_estoque_envios_chave
  on public.sf_estoque_envios (chave);

-- A fila propriamente dita: o que o sf_estoque_reservar varre a cada rodada. O teto de tentativas
-- aparece no predicado de propósito — o índice tem que casar com o filtro da reserva; mexer no teto
-- é mexer nos dois.
create index if not exists sf_estoque_envios_pendentes
  on public.sf_estoque_envios (criado_em)
  where ok = false and cancelado_em is null and tentativas < 5;

-- (pmo, op, posto, alvo, operacao): o contador da chave (sf_estoque_chave) e o caminho da Task 2,
-- que precisa achar o envio pendente de uma entrada que está sendo cancelada.
create index if not exists sf_estoque_envios_alvo
  on public.sf_estoque_envios (pmo, op, posto, alvo, operacao);
-- a tela de pendências e a leitura por OP
create index if not exists sf_estoque_envios_op
  on public.sf_estoque_envios (op, criado_em desc);

-- Leitura para quem vê o ShopFloor (a tela de pendências mostra o que não chegou ao ERP). ESCRITA
-- não tem policy nenhuma, como em sf_registros_cancelados (0087): quem grava é a RPC do bipe e o
-- servidor do envio, as duas `security definer` — o navegador nunca escreve aqui.
drop policy if exists sf_estoque_envios_select on public.sf_estoque_envios;
create policy sf_estoque_envios_select on public.sf_estoque_envios
  for select using ((select tem_permissao('shopfloor', 'visualizar')));

revoke all on public.sf_estoque_envios from public, anon;
grant select on public.sf_estoque_envios to authenticated;
grant select, insert, update, delete on public.sf_estoque_envios to service_role;

-- ---------- sf_estoque_chave(): a chave de idempotência de um bipe ----------
-- Função INTERNA: quem chama é a RPC do bipe / do cancelamento, que já são `security definer` e
-- rodam como donas. Ninguém de fora tem razão pra chamá-la, então ela é revogada de TODOS (mais
-- restritivo que a regra padrão do repositório, como sf_sn_na_faixa na 0129) — e assim a chave nunca
-- é fabricada de fora do banco.
--
-- O contador é lido desta própria tabela, contando TODAS as linhas daquele bipe naquela operação —
-- inclusive as canceladas e as que falharam. Uma chave gasta nunca é reaproveitada: se a E1 foi
-- cancelada antes de sair, a entrada seguinte é a E2, porque não se sabe se o ERP viu a E1 (pode ter
-- sido cancelada justamente depois de um envio com resposta perdida).
--
-- Corrida: duas chamadas simultâneas para o MESMO bipe calculariam o mesmo `n` e as duas tentariam
-- gravar a mesma chave — a segunda morre no índice único, que é o comportamento certo (o bipe é um
-- só). Na prática elas não se cruzam: a trava da 0129 já serializa o mesmo bipe no mesmo posto.
create or replace function public.sf_estoque_chave(
  p_pmo text, p_op text, p_posto text, p_alvo text, p_operacao text
) returns text
language sql
volatile
security definer
set search_path = public
as $func$
  select 'ALMOX/' || p_pmo || '/' || p_op || '/' || p_posto || '/' || p_alvo || '/'
         || case p_operacao when 'estorno' then 'S' else 'E' end
         || (select count(*) + 1
               from public.sf_estoque_envios e
              where e.pmo = p_pmo and e.op = p_op and e.posto = p_posto
                and e.alvo = p_alvo and e.operacao = p_operacao)
$func$;

revoke all on function public.sf_estoque_chave(text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------- sf_estoque_reverter(): desfazer uma entrada — cancelar o pendente OU estornar ----------
-- Quem chama são as DUAS funções de cancelamento do Almoxarifado: a sf_cancelar_caixa_almoxarifado
-- (0131, a caixa inteira) e a sf_cancelar_lancamento (0133, uma linha avulsa). A regra é a mesma nas
-- duas e mora aqui porque é uma decisão só, e errá-la em um dos caminhos daria estoque errado no ERP
-- sem ninguém ver. Ela é `internal` como a sf_estoque_chave: as chamadoras são `security definer` e
-- rodam como donas, então a função é revogada de todos os papéis.
--
-- ⚠️ A DECISÃO: NÃO SE ESTORNA O QUE AINDA NÃO SAIU.
-- Se a entrada correspondente ainda está na fila, o certo é CANCELAR o envio pendente (cancelado_em),
-- e não enfileirar um estorno: senão manda-se ao ERP uma entrada e uma saída que nunca precisaram
-- existir, e alguém do outro lado gasta meia hora entendendo por que apareceu movimento de nada. Só
-- quando a entrada JÁ FOI entregue (ok = true) é que desfazer vira movimentação nova, de saída
-- (operacao = 'estorno', que a chave escreve como S) — o check da tabela diz a mesma coisa: o que já
-- foi enviado não se cancela.
--
-- O SINAL de "já saiu" é `ok`, e nada mais. Ele é o único registro de entrega que existe: a linha só
-- vira ok quando o envio confirmou. Fica uma janela conhecida e assumida — uma linha com tentativas >
-- 0 pode ter chegado ao ERP com a resposta perdida no caminho, e cancelá-la deixaria lá uma entrada
-- sem estorno. Assumida porque a alternativa (estornar "por garantia" o que talvez não tenha chegado)
-- é a que cria movimento de nada, e porque a linha cancelada FICA na tabela, com a chave, que é por
-- onde alguém reconcilia isso depois. Mesma janela vale pro envio em VOO: quem for escrever o laço de
-- envio (Task 3) deve marcar `ok` com `and cancelado_em is null` no filtro — senão o check
-- `cancelado_em is null or not ok` estoura na cara do servidor quando um cancelamento cai no meio.
--
-- p_quantidade = quantas peças estão sendo desfeitas, ou NULO para "o bipe inteiro":
--   • nulo (0131, a caixa inteira) — cancela a linha pendente de uma vez; se já foi enviada, estorna
--     o que o ERP recebeu (v_ent.quantidade), e não o que acabou de ser apagado aqui: o que conserta
--     o estoque de lá é reverter o que chegou lá;
--   • um número (0133, uma linha avulsa = 1 peça) — a linha pendente ainda descreve o que VAI ser
--     enviado, então ela é AJUSTADA (uma caixa de 3 vira 2). Mandar 3 e estornar 1 seriam duas
--     movimentações no ERP para um número que ainda podia ser corrigido aqui. Quando a última peça
--     cai (resta <= 0), a linha é cancelada.
-- Devolve o que fez ('cancelado' | 'ajustado' | 'estorno' | 'sem_fila' | 'nada') — os testes leem
-- isso, e um dia a tela de pendências também pode.
--
-- `sem_fila` NÃO é erro: toda entrada gravada antes desta fase não tem linha aqui, e cancelar uma
-- delas não pode inventar um estorno de algo que o ERP nunca recebeu.
create or replace function public.sf_estoque_reverter(
  p_pmo text, p_op text, p_posto text, p_alvo text, p_quantidade int default null
) returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v_ent   public.sf_estoque_envios;
  v_resta int;
begin
  -- Nada a desfazer: chamada defensiva (um cancelamento que não apagou linha nenhuma, um alvo vazio).
  if coalesce(p_alvo, '') = '' or coalesce(p_quantidade, 1) <= 0 then
    return 'nada';
  end if;

  -- A entrada VIGENTE daquele bipe: a mais recente que ainda não foi cancelada. O mesmo bipe pode ter
  -- várias no histórico (E1 cancelada, E2 depois do rebipe — ver o contador da chave acima), e é a
  -- última que descreve o que está no ShopFloor agora. `for update` porque dois cancelamentos da
  -- mesma caixa ajustariam a quantidade a partir da mesma leitura.
  select * into v_ent
    from public.sf_estoque_envios
   where pmo = p_pmo and op = p_op and posto = p_posto and alvo = p_alvo
     and operacao = 'entrada' and cancelado_em is null
   order by criado_em desc, id desc
   limit 1
   for update;
  if not found then
    return 'sem_fila';
  end if;

  if v_ent.ok then
    -- JÁ ESTÁ NO ERP: a única forma de desfazer é uma saída. tipo/bipe/serie_norm são COPIADOS da
    -- entrada de propósito — é o que garante que o `alvo` do estorno (coluna gerada) seja idêntico ao
    -- da entrada, e portanto que o contador da chave e a busca daqui olhem o mesmo bipe.
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade)
    values
      (public.sf_estoque_chave(p_pmo, p_op, p_posto, p_alvo, 'estorno'), 'estorno',
       v_ent.pmo, v_ent.op, v_ent.posto, v_ent.tipo, v_ent.bipe, v_ent.serie_norm,
       coalesce(p_quantidade, v_ent.quantidade));
    return 'estorno';
  end if;

  -- AINDA NÃO SAIU. O bipe inteiro (p_quantidade nulo) cancela a linha sem aritmética: a intenção é
  -- inequívoca, e a quantidade da linha pode não bater com o que foi apagado agora (um ajuste
  -- anterior já pode ter reduzido).
  if p_quantidade is null then
    update public.sf_estoque_envios set cancelado_em = now() where id = v_ent.id;
    return 'cancelado';
  end if;

  v_resta := v_ent.quantidade - p_quantidade;
  if v_resta <= 0 then
    update public.sf_estoque_envios set cancelado_em = now() where id = v_ent.id;
    return 'cancelado';
  end if;
  update public.sf_estoque_envios set quantidade = v_resta where id = v_ent.id;
  return 'ajustado';
end
$func$;

revoke all on function public.sf_estoque_reverter(text, text, text, text, int)
  from public, anon, authenticated, service_role;

-- ---------- sf_estoque_reservar(): pega um lote da fila, de forma ATÔMICA ----------
-- Só o servidor. Numa única instrução: escolhe as pendentes, trava com `for update skip locked`
-- (outra rodada simultânea PULA as que esta pegou, em vez de esperar), soma 1 em `tentativas` e marca
-- `reservado_em`. Uma rodada que chegue depois do commit também não as vê, porque a reserva vale 15
-- min. Resultado: duas rodadas (cron atrasado + um reenviar na tela) nunca mandam a mesma entrada ao
-- ERP.
--
-- Entram no lote as PENDENTES: ok = false, não canceladas, tentativas < 5 e sem reserva viva.
-- Ordem: NOVAS (tentativas = 0) antes dos reenvios; dentro de cada grupo, as mais antigas primeiro —
-- uma entrada que ficou para trás não fica esperando as de hoje.
--
-- A janela de reserva de 15 min cobre uma rodada inteira (lote de 30 x alguns segundos por chamada
-- ao ERP, no pior caso). Se o processo cair no meio, a linha volta a ser elegível depois disso: a
-- entrega é "pelo menos uma vez", e é a chave de idempotência que segura o "no máximo uma vez" do
-- lado do ERP.
--
-- TETO DE TENTATIVAS = 5 (os Alertas param em 3). Entrada de estoque não é aviso: ela precisa
-- chegar, então insiste mais. Mas não insiste para sempre — uma linha com defeito de dado giraria a
-- cada rodada, para sempre, escondendo as boas. Quem passa do teto sai da fila e aparece na tela de
-- pendências com o último erro, onde alguém aperta Reenviar. O mesmo 5 está no predicado do índice
-- sf_estoque_envios_pendentes: mudar um exige mudar o outro.
--
-- ⚠️ DIFERENÇA 3 — NÃO EXISTE TETO DE 24 HORAS AQUI, e isso NÃO é esquecimento.
-- A reserva dos Alertas ignora o que foi criado há mais de 24 h porque mensagem velha não interessa
-- mais: avisar hoje de uma taxa de ontem é pior que não avisar. Entrada de estoque é o contrário —
-- peça que foi embalada e não chegou ao ERP continua interessando semanas depois, e o estoque do
-- Compels fica errado até ela chegar. Um filtro de 24 h aqui faria a fila DESCARTAR estoque em
-- silêncio: a linha sumiria da fila sem nunca ter sido enviada e sem nunca ter falhado. Quem for
-- "padronizar com os Alertas" um dia: não copie essa parte (o teste 10 de
-- supabase/tests/estoque_envios_test.sql existe para estourar se alguém copiar).
create or replace function public.sf_estoque_reservar(p_limite int default 30)
returns table (id uuid, chave text, operacao text, pmo text, op text, posto text, tipo text,
               bipe text, serie_norm text, quantidade int, tentativas int, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  return query
    with alvo as (
      select e.id
        from public.sf_estoque_envios e
       where e.ok = false
         and e.cancelado_em is null
         and e.tentativas < 5
         and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
       order by (e.tentativas > 0), e.criado_em, e.id
       -- lote aparado: nulo cai no default, 0/negativo viram 1 e existe teto. Um lote gigante
       -- seguraria a reserva (e a rodada) por muito mais tempo do que a janela de 15 min cobre.
       limit least(greatest(coalesce(p_limite, 30), 1), 100)
       for update of e skip locked
    ),
    reservadas as (
      update public.sf_estoque_envios e
         set tentativas = e.tentativas + 1, reservado_em = now()
        from alvo
       where e.id = alvo.id
      returning e.id, e.chave, e.operacao, e.pmo, e.op, e.posto, e.tipo, e.bipe, e.serie_norm,
                e.quantidade, e.tentativas, e.criado_em
    )
    select r.id, r.chave, r.operacao, r.pmo, r.op, r.posto, r.tipo, r.bipe, r.serie_norm,
           r.quantidade, r.tentativas, r.criado_em
      from reservadas r
     order by (r.tentativas > 1), r.criado_em, r.id;
end
$func$;

-- Reservar CONTA tentativa e esconde a linha por 15 min. Aberta ao `authenticated`, qualquer aba
-- logada queimaria as tentativas das entradas de estoque e elas cairiam da fila sem nunca ter sido
-- enviadas — por isso o grant é só pro servidor, como em alerta_reservar_envios.
revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated;
grant execute on function public.sf_estoque_reservar(int) to service_role;

notify pgrst, 'reload schema';
