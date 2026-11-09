-- Testes SQL da 0178 (relatório de uma EMB). Rodar com supabase/tests/rodar-alertas-test.sh, depois da 0150
-- (as funções rec_* da 0124 e a rec_emb_divergencias de verdade) e da 0178 aplicada duas vezes.
--
--   E1  sem permissão é ERRO; EMB vazia/inexistente = ok:false; grants (authenticated sim, anon não);
--   E2  EMB aberta (item na Qualidade): fechada=false, fechada_em nulo; divergências = as da rec_emb_divergencias,
--       com o id do processo; cancelado fora; Nº da PO distintos (sem vazio e sem cancelado);
--   E3  EMB fechada sem divergência: fechada=true, fechada_em = a última finalização, lista vazia;
--   E4  maiúsculas/espaços na EMB pedida batem com a EMB gravada.

alter table public.processos_recebimento add column if not exists numero_pedido text;

-- Um item de EMB (o mesmo molde do teste_item_emb do alertas_emb_test.sql, que some no fim daquele arquivo).
create function public.teste_rel_item(
  p_emb text, p_item text, p_status text, p_pedido numeric, p_recebido numeric,
  p_justificativa text default '', p_quem text default ''
) returns bigint language sql as $f$
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     divergencia, status, resultado, divergencia_justificativa, divergencia_justificada_por_nome,
     divergencia_justificada_em, created_at, finalizado_em)
  values (p_emb, p_item, 'CAPACITOR ' || p_item, p_pedido, p_recebido, (p_recebido - p_pedido)::text,
          p_status, case when p_status in ('Aprovado', 'Reprovado') then p_status end,
          p_justificativa, p_quem, case when p_justificativa <> '' then now() end,
          now() - interval '2 days',
          case when p_status in ('Aprovado', 'Reprovado') then now() - interval '1 minute' end)
  returning numero
$f$;

do $t$
declare
  v_r jsonb; n1 bigint; n2 bigint; n3 bigint; n4 bigint;
begin
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform public.rec_emb_relatorio('EMB178A');
    raise exception 'E1 FALHOU: sem permissão não deu erro';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'recebimento.visualizar', false);
  if public.rec_emb_relatorio('  ')->>'motivo' is distinct from 'emb_inexistente'
     or public.rec_emb_relatorio('EMB-QUE-NAO-EXISTE')->>'motivo' is distinct from 'emb_inexistente' then
    raise exception 'E1 FALHOU: EMB vazia/inexistente';
  end if;
  if not has_function_privilege('authenticated', 'public.rec_emb_relatorio(text)', 'execute')
     or has_function_privilege('anon', 'public.rec_emb_relatorio(text)', 'execute')
     or has_function_privilege('authenticated', 'public.rec_emb_divergencias(text)', 'execute') then
    raise exception 'E1 FALHOU: grants';
  end if;
  raise notice 'E1 ok';

  -- E2: EMB178A com 4 itens: 2 divergentes (um justificado), 1 sem divergência ainda na Qualidade, 1 cancelado divergente.
  n1 := public.teste_rel_item('EMB178A', 'R1', 'Aprovado', 500, 490, 'faltou no fornecedor', 'Ana');
  n2 := public.teste_rel_item('EMB178A', 'R2', 'Aprovado', 100, 120);
  n3 := public.teste_rel_item('EMB178A', 'R3', 'em_conferencia', 10, 10);
  n4 := public.teste_rel_item('EMB178A', 'R4', 'cancelado', 10, 1);
  update public.processos_recebimento set numero_pedido = case numero when n1 then ' PO-1 ' when n2 then 'PO-2'
                                                                       when n3 then '' when n4 then 'PO-CANC' end
   where numero in (n1, n2, n3, n4);

  v_r := public.rec_emb_relatorio('EMB178A');
  if (v_r->>'ok')::boolean is not true or v_r->>'emb' <> 'EMB178A'
     or (v_r->>'fechada')::boolean is not false or v_r->'fechada_em' <> 'null'::jsonb
     or (v_r->>'processos')::int <> 3
     or v_r->'pedidos' <> '["PO-1", "PO-2"]'::jsonb then
    raise exception 'E2 FALHOU (cabeçalho): %', v_r;
  end if;
  if jsonb_array_length(v_r->'divergencias') <> 2
     or (v_r->'divergencias'->0->>'numero')::bigint <> n1
     or v_r->'divergencias'->0->>'id' <> (select id::text from public.processos_recebimento where numero = n1)
     or v_r->'divergencias'->0->>'justificativa' <> 'faltou no fornecedor'
     or v_r->'divergencias'->0->>'justificada_por_nome' <> 'Ana'
     or (v_r->'divergencias'->0->>'quantidade_recebida')::numeric <> 490
     or v_r->'divergencias'->1->>'item' <> 'R2'
     or v_r->'divergencias'->1->>'justificativa' <> '' then
    raise exception 'E2 FALHOU (divergências): %', v_r->'divergencias';
  end if;
  -- As mesmas linhas da rec_emb_divergencias (a fonte do alerta).
  if (select count(*) from public.rec_emb_divergencias('EMB178A')) <> jsonb_array_length(v_r->'divergencias') then
    raise exception 'E2 FALHOU: difere da rec_emb_divergencias';
  end if;
  raise notice 'E2 ok';

  -- E3: o último item termina; outra EMB limpa.
  update public.processos_recebimento set status = 'Aprovado', resultado = 'Aprovado', finalizado_em = now()
   where numero = n3;
  v_r := public.rec_emb_relatorio('EMB178A');
  if (v_r->>'fechada')::boolean is not true
     or (v_r->>'fechada_em')::timestamptz <> (select finalizado_em from public.processos_recebimento where numero = n3) then
    raise exception 'E3 FALHOU (fechou): %', v_r;
  end if;
  perform public.teste_rel_item('EMB178L', 'L1', 'Aprovado', 5, 5);
  v_r := public.rec_emb_relatorio('EMB178L');
  if (v_r->>'fechada')::boolean is not true or v_r->'divergencias' <> '[]'::jsonb or v_r->'pedidos' <> '[]'::jsonb then
    raise exception 'E3 FALHOU (limpa): %', v_r;
  end if;
  raise notice 'E3 ok';

  -- E4
  if public.rec_emb_relatorio(' emb178a ')->>'emb' <> 'EMB178A' then
    raise exception 'E4 FALHOU';
  end if;
  raise notice 'E4 ok';

  perform set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
  delete from public.processos_recebimento where upper(numero_emb) in ('EMB178A', 'EMB178L');
end $t$;

drop function public.teste_rel_item(text, text, text, numeric, numeric, text, text);

select 'rec_emb_relatorio_test ok' as resultado;
