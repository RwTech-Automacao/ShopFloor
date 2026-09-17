-- =============================================================
-- Módulo Setup — funções. Regras do spec 2026-09-16 (seção 5). Toda escrita de operação passa aqui:
-- checa a permissão do MÓDULO setup, trava o setup (pg_advisory_xact_lock) e devolve códigos de erro
-- que o app traduz (src/modules/setup/domain/mensagens.ts).
-- Corpo das funções com $func$: o SQL Editor do Supabase não aceita o delimitador de dois cifrões.
-- =============================================================

-- ---------- helpers puros ----------
create or replace function public.st_norm(p text) returns text
language sql immutable as $func$ select upper(btrim(coalesce(p, ''))) $func$;

create or replace function public.st_face(p text) returns text
language plpgsql immutable as $func$
declare v text := upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
begin
  if v in ('TOP', 'BOT') then return v; end if;
  if v in ('TOP E BOT', 'BOT E TOP') then return 'TOP E BOT'; end if;
  raise exception 'FACE_INVALIDA';
end $func$;

create or replace function public.st_faces_sobrepoem(a text, b text) returns boolean
language sql immutable as $func$ select a = b or a = 'TOP E BOT' or b = 'TOP E BOT' $func$;

-- Prefixo (componente) = até o 1º separador; sequencial = o resto. Espelha separarRolo (TS).
create or replace function public.st_rolo_prefixo(p text) returns text
language sql immutable as $func$ select coalesce(substring(public.st_norm(p) from '^([^-–—_:/ ]+)[-–—_:/ ]'), '') $func$;

create or replace function public.st_rolo_sequencial(p text) returns text
language sql immutable as $func$ select btrim(coalesce(substring(public.st_norm(p) from '^[^-–—_:/ ]+[-–—_:/ ](.*)$'), '')) $func$;

-- Chave canônica do rolo: prefixo + '-' + sequencial sem zeros à esquerda (CAPJ41-1 = CAPJ41-0001 = CAPJ41 1).
-- null quando o código é vazio ou inválido. É o que identifica o rolo em unicidade e comparações.
create or replace function public.st_rolo_chave(p text) returns text
language sql immutable as $func$
  select case when public.st_rolo_prefixo(p) = '' or public.st_rolo_sequencial(p) = '' then null
              else public.st_rolo_prefixo(p) || '-' || ltrim(public.st_rolo_sequencial(p), '0') end
$func$;

create or replace function public.st_limpar_sn(p text) returns text
language sql immutable as $func$ select regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g') $func$;

-- Espelha serieDentroDaFaixa (src/modules/shopfloor/domain/serie.ts). null = OP sem faixa.
create or replace function public.st_sn_na_faixa(p_ini text, p_fim text, p_sn text) returns boolean
language plpgsql immutable as $func$
declare
  a text := public.st_limpar_sn(p_ini); b text := public.st_limpar_sn(p_fim); x text := public.st_limpar_sn(p_sn);
  ma text[]; mb text[]; mx text[];
  lo text; hi text;
begin
  if a = '' or b = '' then return null; end if;
  ma := regexp_match(a, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mb := regexp_match(b, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mx := regexp_match(x, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  if ma is not null and mb is not null and mx is not null then
    if lower(ma[1]) <> lower(mb[1]) or lower(ma[3]) <> lower(mb[3]) then return false; end if;
    if lower(mx[1]) <> lower(ma[1]) or lower(mx[3]) <> lower(ma[3]) then return false; end if;
    return mx[2]::numeric between least(ma[2]::numeric, mb[2]::numeric) and greatest(ma[2]::numeric, mb[2]::numeric);
  end if;
  -- collate "C": mesma ordem por unidade de código do TS, independente da collation do banco.
  lo := least(a collate "C", b collate "C"); hi := greatest(a collate "C", b collate "C");
  return x collate "C" >= lo collate "C" and x collate "C" <= hi collate "C";
end $func$;

create or replace function public.st_nome_usuario() returns text
language sql stable security definer set search_path = public as $func$
  select coalesce((select nome from public.usuarios where id = auth.uid()), '')
$func$;

-- ---------- leitura das OPs do ShopFloor pra quem só tem o módulo Setup ----------
create or replace function public.st_listar_ordens()
returns table (pmo text, op text, cliente text, descricao text, status text, sn_ini text, sn_fim text)
language plpgsql stable security definer set search_path = public as $func$
begin
  if not tem_permissao('setup', 'visualizar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select o.pmo, o.op, o.cliente, o.descricao, o.status, o.sn_ini, o.sn_fim
    from public.sf_ordens o
    order by o.pmo, o.op;
end $func$;

-- ---------- abrir (criar ou reabrir) setup ----------
-- O equipamento cadastrado (st_equipamentos) é a identidade do setup: processo, linha, bloco e
-- máquina saem dele, não de texto vindo da tela.
create or replace function public.st_abrir_setup(
  p_pmo text, p_op text, p_equipamento_id uuid, p_face text,
  p_sn_abertura text, p_copiar_de uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_equip record;
  v_face text;
  v_sn text := public.st_limpar_sn(p_sn_abertura);
  v_ordem record;
  v_faixa boolean;
  v_id uuid;
  v_origem record;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  v_face := public.st_face(p_face);

  select pmo, op, sn_ini, sn_fim into v_ordem from public.sf_ordens
   where pmo = btrim(p_pmo) and op = btrim(p_op);
  if not found then raise exception 'OP_INEXISTENTE'; end if;

  select processo, linha, bloco, maquina into v_equip from public.st_equipamentos
   where id = p_equipamento_id and ativo;
  if not found then raise exception 'EQUIPAMENTO_INVALIDO'; end if;

  perform pg_advisory_xact_lock(hashtext('st/' || v_ordem.pmo || '/' || v_ordem.op)::bigint);

  -- Já existe setup dessa OP nesse equipamento e face: reabre (a cópia é ignorada).
  select id, sn_abertura into v_origem from public.st_setups
   where pmo = v_ordem.pmo and op = v_ordem.op and equipamento_id = p_equipamento_id and face = v_face;
  if found then
    return jsonb_build_object('setup_id', v_origem.id, 'criado', false,
      'sem_faixa', public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_origem.sn_abertura) is null);
  end if;

  if exists (select 1 from public.st_setups
              where pmo = v_ordem.pmo and op = v_ordem.op and equipamento_id = p_equipamento_id
                and public.st_faces_sobrepoem(face, v_face)) then
    raise exception 'FACE_SOBREPOSTA';
  end if;

  if v_sn = '' then raise exception 'SN_OBRIGATORIO'; end if;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then raise exception 'SN_FORA_DA_FAIXA'; end if;

  if p_copiar_de is not null then
    select * into v_origem from public.st_setups where id = p_copiar_de;
    if not found or v_origem.pmo <> v_ordem.pmo
       or v_origem.equipamento_id <> p_equipamento_id or v_origem.face <> v_face then
      raise exception 'COPIA_INCOMPATIVEL';
    end if;
  end if;

  insert into public.st_setups (pmo, op, processo, equipamento_id, face, sn_abertura, copiado_de, criado_por)
  values (v_ordem.pmo, v_ordem.op, v_equip.processo, p_equipamento_id, v_face, v_sn, p_copiar_de, auth.uid())
  returning id into v_id;

  if p_copiar_de is not null then
    insert into public.st_setup_itens (setup_id, processo, posicao, feeder, componente, rolo, rolo_chave, atualizado_por)
    select v_id, i.processo, i.posicao, i.feeder, i.componente, null, null, auth.uid()
    from public.st_setup_itens i where i.setup_id = p_copiar_de;
  end if;

  return jsonb_build_object('setup_id', v_id, 'criado', true, 'sem_faixa', v_faixa is null);
end $func$;

-- ---------- incluir item (bipe Posição → Feeder → Rolo) ----------
create or replace function public.st_incluir_item(p_setup_id uuid, p_posicao text, p_feeder text, p_rolo text)
returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record;
  v_pos text := public.st_norm(p_posicao);
  v_fee text := public.st_norm(p_feeder);
  v_rolo text := public.st_norm(p_rolo);
  v_prefixo text := public.st_rolo_prefixo(p_rolo);
  v_chave text := public.st_rolo_chave(p_rolo);
  v_proc_estrutura text;
  v_item record;
  v_id uuid;
begin
  -- Trava ANTES de ler o estado: quem decide (montagem × liberado) enxerga o que já foi confirmado.
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado = 'liberado' then
    if not tem_permissao('setup', 'administrar') then raise exception 'SETUP_LIBERADO'; end if;
  elsif not tem_permissao('setup', 'lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  if v_pos = '' or v_fee = '' or v_rolo = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  if v_chave is null then raise exception 'ROLO_INVALIDO'; end if;

  select processo into v_proc_estrutura from public.st_estrutura where pmo = v_setup.pmo and componente = v_prefixo;
  if not found then raise exception 'COMPONENTE_FORA_DA_ESTRUTURA'; end if;
  if v_proc_estrutura <> v_setup.processo then raise exception 'COMPONENTE_OUTRO_PROCESSO'; end if;

  if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and rolo_chave = v_chave) then
    raise exception 'ROLO_JA_MONTADO';
  end if;

  -- Mesmo par (posição, feeder): posição copiada sem rolo recebe o rolo; com rolo, recusa.
  select * into v_item from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos and feeder = v_fee;
  if found then
    if v_item.rolo is not null then raise exception 'POSICAO_JA_CADASTRADA'; end if;
    if v_item.componente <> v_prefixo then raise exception 'COMPONENTE_DIFERENTE_DA_POSICAO'; end if;
    update public.st_setup_itens set rolo = v_rolo, rolo_chave = v_chave, atualizado_por = auth.uid(), atualizado_em = now()
     where id = v_item.id;
    return jsonb_build_object('item_id', v_item.id, 'componente', v_prefixo, 'atualizou', true);
  end if;

  if v_setup.processo = 'SMD' then
    if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos) then
      raise exception 'POSICAO_COM_OUTRO_FEEDER';
    end if;
    if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and feeder = v_fee) then
      raise exception 'FEEDER_EM_OUTRA_POSICAO';
    end if;
  end if;

  insert into public.st_setup_itens (setup_id, processo, posicao, feeder, componente, rolo, rolo_chave, atualizado_por)
  values (p_setup_id, v_setup.processo, v_pos, v_fee, v_prefixo, v_rolo, v_chave, auth.uid())
  returning id into v_id;

  if v_setup.estado = 'liberado' then
    insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
    values (p_setup_id, v_id, 'inclusao', null,
            jsonb_build_object('posicao', v_pos, 'feeder', v_fee, 'componente', v_prefixo, 'rolo', v_rolo),
            auth.uid(), public.st_nome_usuario());
  end if;
  return jsonb_build_object('item_id', v_id, 'componente', v_prefixo, 'atualizou', false);
end $func$;

-- ---------- remover item ----------
create or replace function public.st_remover_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $func$
declare v_setup_id uuid; v_item record; v_setup record;
begin
  -- Só descobre o setup; nada é decidido antes da trava.
  select setup_id into v_setup_id from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || v_setup_id::text)::bigint);
  -- Relê depois da trava: se outro envio já removeu, não grava histórico duas vezes.
  select * into v_item from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  select * into v_setup from public.st_setups where id = v_item.setup_id;
  if v_setup.estado = 'liberado' then
    if not tem_permissao('setup', 'administrar') then raise exception 'SETUP_LIBERADO'; end if;
  elsif not tem_permissao('setup', 'lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  delete from public.st_setup_itens where id = p_item_id;
  if v_setup.estado = 'liberado' then
    insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
    values (v_item.setup_id, p_item_id, 'remocao', to_jsonb(v_item) - 'setup_id', null, auth.uid(), public.st_nome_usuario());
  end if;
end $func$;

-- ---------- editar item (admin): trocar feeder e/ou posição ----------
create or replace function public.st_editar_item(p_item_id uuid, p_posicao text, p_feeder text) returns void
language plpgsql security definer set search_path = public as $func$
declare
  v_setup_id uuid; v_item record; v_setup record;
  v_pos text := public.st_norm(p_posicao); v_fee text := public.st_norm(p_feeder);
  v_tipo text;
begin
  if not tem_permissao('setup', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  select setup_id into v_setup_id from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || v_setup_id::text)::bigint);
  -- Relê depois da trava: antes/tipo saem da linha atual.
  select * into v_item from public.st_setup_itens where id = p_item_id;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  select * into v_setup from public.st_setups where id = v_item.setup_id;
  if v_pos = '' or v_fee = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  if v_pos = v_item.posicao and v_fee = v_item.feeder then return; end if;

  if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and posicao = v_pos and feeder = v_fee) then
    raise exception 'POSICAO_JA_CADASTRADA';
  end if;
  if v_setup.processo = 'SMD' then
    if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and posicao = v_pos) then
      raise exception 'POSICAO_COM_OUTRO_FEEDER';
    end if;
    if exists (select 1 from public.st_setup_itens where setup_id = v_item.setup_id and id <> p_item_id and feeder = v_fee) then
      raise exception 'FEEDER_EM_OUTRA_POSICAO';
    end if;
  end if;

  v_tipo := case
    when v_pos = v_item.posicao then 'troca_feeder'
    when v_fee = v_item.feeder then 'troca_posicao'
    else 'correcao' end;

  update public.st_setup_itens set posicao = v_pos, feeder = v_fee, atualizado_por = auth.uid(), atualizado_em = now()
   where id = p_item_id;
  insert into public.st_alteracoes (setup_id, item_id, tipo, antes, depois, usuario, usuario_nome)
  values (v_item.setup_id, p_item_id, v_tipo,
          jsonb_build_object('posicao', v_item.posicao, 'feeder', v_item.feeder),
          jsonb_build_object('posicao', v_pos, 'feeder', v_fee),
          auth.uid(), public.st_nome_usuario());
end $func$;

-- ---------- liberar ----------
create or replace function public.st_liberar_setup(p_setup_id uuid) returns void
language plpgsql security definer set search_path = public as $func$
declare v_setup record;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado = 'liberado' then return; end if;
  if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id) then raise exception 'SETUP_VAZIO'; end if;
  if exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and rolo is null) then raise exception 'FALTA_ROLO'; end if;
  update public.st_setups set estado = 'liberado', liberado_por = auth.uid(), liberado_em = now() where id = p_setup_id;
end $func$;

-- ---------- trocar rolo (abastecimento) ----------
create or replace function public.st_trocar_rolo(
  p_setup_id uuid, p_posicao text, p_feeder text, p_rolo_saida text, p_rolo_entrada text, p_sn_inicial text
) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_setup record; v_ordem record; v_item record;
  v_pos text := public.st_norm(p_posicao); v_fee text := public.st_norm(p_feeder);
  v_saida text := public.st_norm(p_rolo_saida); v_entrada text := public.st_norm(p_rolo_entrada);
  v_chave_saida text := public.st_rolo_chave(p_rolo_saida); v_chave_entrada text := public.st_rolo_chave(p_rolo_entrada);
  v_pth boolean;
  v_sn text := public.st_limpar_sn(p_sn_inicial);
  v_motivos text[] := '{}';
  v_faixa boolean;
  v_outra text;
  v_resultado text;
  v_troca uuid;
begin
  if not tem_permissao('setup', 'lancar') then raise exception 'SEM_PERMISSAO'; end if;
  if v_pos = '' or v_fee = '' or v_saida = '' or v_entrada = '' or v_sn = '' then raise exception 'CAMPOS_OBRIGATORIOS'; end if;
  -- Trava ANTES de ler o setup e os itens.
  perform pg_advisory_xact_lock(hashtext('st-setup/' || p_setup_id::text)::bigint);
  select * into v_setup from public.st_setups where id = p_setup_id;
  if not found then raise exception 'SETUP_INEXISTENTE'; end if;
  if v_setup.estado <> 'liberado' then raise exception 'SETUP_NAO_LIBERADO'; end if;
  v_pth := v_setup.processo = 'PTH';

  -- 1. posição e feeder (PTH: posto e locação — frases escritas por processo, com o gênero certo)
  select * into v_item from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos and feeder = v_fee;
  if not found then
    if not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and posicao = v_pos) then
      v_motivos := v_motivos || case when v_pth then format('O posto %s não existe nesse setup.', v_pos)
                                     else format('A posição %s não existe nesse setup.', v_pos) end;
    elsif not exists (select 1 from public.st_setup_itens where setup_id = p_setup_id and feeder = v_fee) then
      v_motivos := v_motivos || case when v_pth then format('A locação %s não existe nesse setup.', v_fee)
                                     else format('O feeder %s não existe nesse setup.', v_fee) end;
    else
      v_motivos := v_motivos || case when v_pth then format('A locação %s não está no posto %s.', v_fee, v_pos)
                                     else format('O feeder %s não está na posição %s.', v_fee, v_pos) end;
    end if;
  else
    -- 2. rolo que sai = rolo montado (pela chave: CAPJ41-1 = CAPJ41-0001)
    if v_item.rolo_chave is null or v_item.rolo_chave is distinct from v_chave_saida then
      v_motivos := v_motivos || case when v_pth
        then format('O rolo montado no posto %s é %s, não %s.', v_pos, coalesce(v_item.rolo, '(nenhum)'), v_saida)
        else format('O rolo montado na posição %s é %s, não %s.', v_pos, coalesce(v_item.rolo, '(nenhum)'), v_saida) end;
    end if;
  end if;

  -- 3. mesmo componente / 4. outro rolo
  if v_chave_entrada is null then
    v_motivos := v_motivos || format('Código do rolo que entra inválido: %s.', v_entrada);
  elsif v_chave_saida is null then
    v_motivos := v_motivos || format('Código do rolo que sai inválido: %s.', v_saida);
  else
    if public.st_rolo_prefixo(v_entrada) <> public.st_rolo_prefixo(v_saida) then
      v_motivos := v_motivos || format('Componente diferente: sai %s, entra %s.', public.st_rolo_prefixo(v_saida), public.st_rolo_prefixo(v_entrada));
    elsif v_chave_entrada = v_chave_saida then
      v_motivos := v_motivos || 'O rolo que entra é o mesmo que sai.'::text;
    end if;
    select posicao into v_outra from public.st_setup_itens
     where setup_id = p_setup_id and rolo_chave = v_chave_entrada and (v_item.id is null or id <> v_item.id) limit 1;
    if found then
      v_motivos := v_motivos || case when v_pth
        then format('O rolo %s já está montado no posto %s.', v_entrada, v_outra)
        else format('O rolo %s já está montado na posição %s.', v_entrada, v_outra) end;
    end if;
  end if;

  -- 5. SN Inicial na faixa da OP
  select sn_ini, sn_fim into v_ordem from public.sf_ordens where pmo = v_setup.pmo and op = v_setup.op;
  v_faixa := public.st_sn_na_faixa(v_ordem.sn_ini, v_ordem.sn_fim, v_sn);
  if v_faixa = false then
    v_motivos := v_motivos || format('O SN %s não pertence à faixa da OP.', v_sn);
  end if;

  v_resultado := case when cardinality(v_motivos) = 0 then 'APROVADO' else 'REPROVADO' end;

  insert into public.st_trocas (setup_id, item_id, posicao, feeder, rolo_saida, rolo_entrada, sn_inicial,
                                resultado, motivos, operador, operador_nome)
  values (p_setup_id, v_item.id, v_pos, v_fee, v_saida, v_entrada, v_sn, v_resultado, v_motivos,
          auth.uid(), public.st_nome_usuario())
  returning id into v_troca;

  if v_resultado = 'APROVADO' then
    update public.st_setup_itens set rolo = v_entrada, rolo_chave = v_chave_entrada, atualizado_por = auth.uid(), atualizado_em = now()
     where id = v_item.id;
  end if;

  return jsonb_build_object('troca_id', v_troca, 'resultado', v_resultado, 'motivos', to_jsonb(v_motivos), 'sem_faixa', v_faixa is null);
end $func$;

-- ---------- importar estrutura ----------
create or replace function public.st_importar_estrutura(p_pmo text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_pmo text := btrim(coalesce(p_pmo, ''));
  v_novos int := 0; v_atual int := 0; v_iguais int := 0;
  r record;
  v_existente text;
begin
  if not tem_permissao('setup', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if not exists (select 1 from public.sf_ordens where pmo = v_pmo) then raise exception 'PMO_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext('st-estrutura/' || v_pmo)::bigint);
  -- Valida todas as linhas; depois deduplica por componente (a última ocorrência vale) antes de contar.
  if exists (select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
              where public.st_norm(e->>'componente') = '') then
    raise exception 'COMPONENTE_INVALIDO';
  end if;
  -- Código com separador (- – — _ : / ou espaço) nunca casa com o prefixo do rolo: recusa na importação.
  if exists (select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
              where public.st_norm(e->>'componente') ~ '[-_:/ –—]') then
    raise exception 'COMPONENTE_INVALIDO';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
              where public.st_norm(e->>'processo') not in ('SMD', 'PTH')) then
    raise exception 'PROCESSO_INVALIDO';
  end if;
  for r in select distinct on (x.componente) x.componente, x.processo
           from (select public.st_norm(e->>'componente') as componente, public.st_norm(e->>'processo') as processo, n
                   from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as t(e, n)) x
           order by x.componente, x.n desc loop
    select processo into v_existente from public.st_estrutura where pmo = v_pmo and componente = r.componente;
    if not found then
      insert into public.st_estrutura (pmo, componente, processo, origem, criado_por)
      values (v_pmo, r.componente, r.processo, 'importacao', auth.uid());
      v_novos := v_novos + 1;
    elsif v_existente <> r.processo then
      update public.st_estrutura set processo = r.processo where pmo = v_pmo and componente = r.componente;
      v_atual := v_atual + 1;
    else
      v_iguais := v_iguais + 1;
    end if;
  end loop;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'iguais', v_iguais);
end $func$;

-- ---------- contagem de componentes por PMO (listarPmosComEstrutura lia st_estrutura inteira, e o
-- PostgREST limita a 1000 linhas; agrega no banco em vez de trazer tudo pro app) ----------
create or replace function public.st_pmos_com_estrutura()
returns table (pmo text, total bigint)
language sql stable security invoker set search_path = public as $func$
  select pmo, count(*) from public.st_estrutura group by pmo order by pmo
$func$;

-- ---------- permissões ----------
grant execute on function public.st_listar_ordens() to authenticated;
grant execute on function public.st_abrir_setup(text, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.st_incluir_item(uuid, text, text, text) to authenticated;
grant execute on function public.st_remover_item(uuid) to authenticated;
grant execute on function public.st_editar_item(uuid, text, text) to authenticated;
grant execute on function public.st_liberar_setup(uuid) to authenticated;
grant execute on function public.st_trocar_rolo(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.st_importar_estrutura(text, jsonb) to authenticated;
grant execute on function public.st_pmos_com_estrutura() to authenticated;
revoke all on function public.st_nome_usuario() from public, anon, authenticated;

notify pgrst, 'reload schema';
