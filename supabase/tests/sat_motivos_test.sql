-- Testes da 0190 (SAT: motivos de reprovação da NF, lista fixa + "Outro" com texto). Roda DEPOIS do sat_nf_test.sql,
-- na mesma base (o motivo de teste que ele criou tem que ficar desativado). Dados SINTÉTICOS.
-- Runner: supabase/tests/rodar-sat-test.sh

\i /tmp/0190.sql
grant all on all tables in schema public to anon, authenticated;

-- 1. A lista: os 6 motivos ativos, na ordem; só o "Outro" exige texto; o motivo antigo de teste foi desativado.
do $t$
declare v text[];
begin
  select array_agg(texto order by ordem) into v from sat_motivos_nf where ativo;
  if v <> array['Sem nota fiscal (só declaração dos Correios)', 'CFOP errado', 'Natureza de operação errada',
                'Descrição errada', 'CNPJ da RW errado na nota', 'Outro'] then
    raise exception 'FALHOU: lista de motivos %', v;
  end if;
  if (select array_agg(ordem order by ordem) from sat_motivos_nf where ativo) <> array[1, 2, 3, 4, 5, 6] then
    raise exception 'FALHOU: ordem dos motivos';
  end if;
  if (select array_agg(texto) from sat_motivos_nf where exige_texto) <> array['Outro'] then
    raise exception 'FALHOU: só o Outro exige texto';
  end if;
  if exists (select 1 from sat_motivos_nf where texto = 'Sem CFOP de remessa' and ativo) then
    raise exception 'FALHOU: motivo fora da lista continuou ativo';
  end if;
  if to_regprocedure('public.sat__motivos(text,uuid[])') is not null
     or to_regprocedure('public.sat_corrigir_nf(uuid,text,uuid[])') is not null then
    raise exception 'FALHOU: sobrou a assinatura antiga';
  end if;
  raise notice 'lista dos 6 motivos: ok';
end $t$;

-- 2. Registrar / corrigir / trocar com os motivos novos.
do $t$
declare r jsonb; v_nf uuid;
  v_cfop  uuid := (select id from sat_motivos_nf where texto = 'CFOP errado');
  v_sem   uuid := (select id from sat_motivos_nf where texto = 'Sem nota fiscal (só declaração dos Correios)');
  v_outro uuid := (select id from sat_motivos_nf where texto = 'Outro');
  v_velho uuid := (select id from sat_motivos_nf where texto = 'Sem CFOP de remessa');
  v_base  jsonb := jsonb_build_object('cnpj', '12345678000190', 'empresa', 'Empresa Teste', 'situacao', 'reprovada',
    'relogios', jsonb_build_array(jsonb_build_object('ns', 'MOT-1')));
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada,sat.aprovar_nf', false);

  -- reprovada com "CFOP errado" guarda o texto
  r := sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M1', 'motivos', jsonb_build_array(v_cfop),
         'motivo_outro', 'ignorado'));
  if not exists (select 1 from sat_nfs where numero = 'NF-M1' and motivos = '{CFOP errado}') then
    raise exception 'FALHOU: reprovada com CFOP errado (texto do Outro não podia entrar) %', r;
  end if;

  -- reprovada com Outro + texto: 'Outro: <texto>', na ordem da lista (Outro por último)
  r := sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M2', 'motivos', jsonb_build_array(v_outro, v_sem),
         'motivo_outro', '  nota   rasurada  '));
  if r->'motivos' <> '["Sem nota fiscal (só declaração dos Correios)", "Outro: nota rasurada"]'::jsonb then
    raise exception 'FALHOU: retorno com Outro %', r;
  end if;
  if not exists (select 1 from sat_nfs where numero = 'NF-M2'
                   and motivos = array['Sem nota fiscal (só declaração dos Correios)', 'Outro: nota rasurada']) then
    raise exception 'FALHOU: nota com Outro gravada errada';
  end if;
  if not exists (select 1 from sat_historico h join sat_nfs n on n.id = h.nf_id
                  where n.numero = 'NF-M2' and h.tipo = 'entrada' and 'Outro: nota rasurada' = any (h.motivos)) then
    raise exception 'FALHOU: histórico sem o texto do Outro';
  end if;

  -- Outro sem texto / só espaço / texto longo demais
  begin perform sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M3', 'motivos', jsonb_build_array(v_outro)));
    raise exception 'FALHOU: Outro sem texto passou';
  exception when raise_exception then if sqlerrm <> 'OUTRO_SEM_TEXTO' then raise; end if; end;
  begin perform sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M3', 'motivos', jsonb_build_array(v_outro),
          'motivo_outro', '   '));
    raise exception 'FALHOU: Outro só com espaço passou';
  exception when raise_exception then if sqlerrm <> 'OUTRO_SEM_TEXTO' then raise; end if; end;
  begin perform sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M3', 'motivos', jsonb_build_array(v_outro),
          'motivo_outro', repeat('x', 201)));
    raise exception 'FALHOU: Outro com 201 caracteres passou';
  exception when raise_exception then if sqlerrm <> 'OUTRO_TEXTO_LONGO' then raise; end if; end;
  -- motivo desativado não vale mais
  begin perform sat_registrar_nf(v_base || jsonb_build_object('numero', 'NF-M3', 'motivos', jsonb_build_array(v_velho)));
    raise exception 'FALHOU: motivo desativado passou';
  exception when raise_exception then if sqlerrm <> 'MOTIVO_INVALIDO' then raise; end if; end;
  if exists (select 1 from sat_nfs where numero = 'NF-M3') then raise exception 'FALHOU: erro deixou nota gravada'; end if;

  -- corrigir com Outro: sem texto falha; com texto grava; mudar só o texto do Outro também é mudança
  v_nf := (select id from sat_nfs where numero = 'NF-M1');
  begin perform sat_corrigir_nf(v_nf, 'reprovada', array[v_outro]); raise exception 'FALHOU: corrigiu Outro sem texto';
  exception when raise_exception then if sqlerrm <> 'OUTRO_SEM_TEXTO' then raise; end if; end;
  r := sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop, v_outro], 'falta o pedido');
  if r->'motivos' <> '["CFOP errado", "Outro: falta o pedido"]'::jsonb then raise exception 'FALHOU: corrigir com Outro %', r; end if;
  begin perform sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop, v_outro], ' falta o pedido ');
    raise exception 'FALHOU: correção igual passou';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  r := sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop, v_outro], 'outro texto');
  if not exists (select 1 from sat_nfs where id = v_nf and motivos = '{CFOP errado,"Outro: outro texto"}') then
    raise exception 'FALHOU: trocar só o texto do Outro';
  end if;
  -- aprovada ignora o texto
  r := sat_corrigir_nf(v_nf, 'aprovada', null, 'ignorado');
  if not exists (select 1 from sat_nfs where id = v_nf and situacao = 'aprovada' and motivos = '{}') then
    raise exception 'FALHOU: aprovar com texto do Outro';
  end if;

  -- trocar com Outro
  r := sat_trocar_nf(v_nf, jsonb_build_object('numero', 'NF-M1B', 'cnpj', '12345678000190', 'situacao', 'reprovada',
         'motivos', jsonb_build_array(v_outro), 'motivo_outro', 'sem destaque do ICMS'));
  if not exists (select 1 from sat_nfs where id = v_nf and numero = 'NF-M1B' and motivos = '{"Outro: sem destaque do ICMS"}') then
    raise exception 'FALHOU: trocar com Outro %', r;
  end if;
  begin perform sat_trocar_nf(v_nf, jsonb_build_object('numero', 'NF-M1C', 'cnpj', '12345678000190',
          'situacao', 'reprovada', 'motivos', jsonb_build_array(v_outro)));
    raise exception 'FALHOU: trocou com Outro sem texto';
  exception when raise_exception then if sqlerrm <> 'OUTRO_SEM_TEXTO' then raise; end if; end;

  -- função interna continua fechada
  begin perform sat__motivos('reprovada', array[v_cfop], null); raise exception 'FALHOU: authenticated chamou sat__motivos';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'registrar/corrigir/trocar com os motivos novos: ok';
end $t$;
