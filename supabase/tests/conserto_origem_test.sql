-- Prova a 0138. Roda depois dela, num banco que já tem a 0072.
\set ON_ERROR_STOP on

do $func$
declare
  v_origem_default text;
  v_conserto_default text;
  v_origem_null text;
  v_conserto_null text;
  v_tem_check boolean;
  v_erro text;
begin
  -- 1. as colunas existem, NOT NULL, com o default certo (comparado por igualdade, não por "contém")
  select column_default, is_nullable into v_origem_default, v_origem_null
    from information_schema.columns
   where table_schema='public' and table_name='sf_conserto_confirmado' and column_name='origem';
  if v_origem_default is distinct from '''posto''::text' then
    raise exception 'FALHOU: origem com default errado (achei %, esperava ''posto''::text)', coalesce(v_origem_default, '<ausente>');
  end if;
  if v_origem_null is distinct from 'NO' then
    raise exception 'FALHOU: origem deveria ser NOT NULL (is_nullable=%)', coalesce(v_origem_null, '<coluna ausente>');
  end if;

  select column_default, is_nullable into v_conserto_default, v_conserto_null
    from information_schema.columns
   where table_schema='public' and table_name='sf_conserto_confirmado' and column_name='conserto';
  if v_conserto_null is null then
    raise exception 'FALHOU: coluna conserto ausente';
  end if;
  if v_conserto_default is distinct from '''''::text' then
    raise exception 'FALHOU: conserto com default errado (achei %, esperava vazio ''''::text)', coalesce(v_conserto_default, '<sem default>');
  end if;
  if v_conserto_null is distinct from 'NO' then
    raise exception 'FALHOU: conserto deveria ser NOT NULL (is_nullable=%)', v_conserto_null;
  end if;

  -- 2. o check existe
  select exists (
    select 1 from pg_constraint
     where conrelid='public.sf_conserto_confirmado'::regclass
       and conname='sf_conserto_confirmado_origem_check'
  ) into v_tem_check;
  if not v_tem_check then raise exception 'FALHOU: check de origem ausente'; end if;

  -- 3. inserir SEM origem nasce 'posto' (é o que garante que o histórico não muda)
  insert into public.sf_conserto_confirmado (pmo, op, posto, codigo_defeito)
  values ('ZZTESTE', '0001', 'Posto Teste', 'D01');
  if (select origem from public.sf_conserto_confirmado where pmo='ZZTESTE' limit 1) <> 'posto' then
    raise exception 'FALHOU: insert sem origem não nasceu ''posto''';
  end if;

  -- 4. inserir com origem inválida é RECUSADO
  begin
    insert into public.sf_conserto_confirmado (pmo, op, posto, origem)
    values ('ZZTESTE2', '0001', 'Posto Teste', 'qualquer');
    raise exception 'FALHOU: origem inválida foi aceita';
  exception when check_violation then
    null; -- esperado
  end;

  -- 5. inserir com origem 'manutencao' e conserto preenchido funciona
  insert into public.sf_conserto_confirmado (pmo, op, posto, origem, conserto, posicao)
  values ('ZZTESTE3', '0001', 'Inspeção PTH', 'manutencao', 'Ressolda', 'R12');
  if (select conserto from public.sf_conserto_confirmado where pmo='ZZTESTE3') <> 'Ressolda' then
    raise exception 'FALHOU: conserto não gravou';
  end if;

  delete from public.sf_conserto_confirmado where pmo in ('ZZTESTE','ZZTESTE2','ZZTESTE3');
end
$func$;

select 'conserto origem: ok' as resultado;
