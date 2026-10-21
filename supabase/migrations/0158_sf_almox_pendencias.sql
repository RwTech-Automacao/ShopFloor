-- =============================================================
-- Almoxarifado: a lista de PENDÊNCIAS de todas as OPs, antes de qualquer bipe.
-- A tela do Almoxarifado abre mostrando o que está esperando confirmação (caixas das OPs coletivas,
-- lotes do NQA das OPs individuais) e a pessoa escolhe qual quer bipar primeiro. Antes (0155/0156) a
-- lista só existia DEPOIS que a OP era carregada pelo primeiro bipe.
--
-- sf_almox_pendencias(): consulta, sem tabela. Para cada OP que NÃO está finalizada e tem posto
-- Almoxarifado na rota (pelo PERFIL, nunca pelo nome), devolve o que a sf_almox_necessidades (caixa) ou
-- a sf_almox_lotes (lote) devolveriam — as mesmas regras, o mesmo posto anterior, nada duplicado aqui.
-- Sem permissão é ERRO (SEM_PERMISSAO), nunca lista vazia.
-- `em` = desde quando o item espera: o fechada_em da caixa (tipo caixa) ou o aprovado_em do lote (tipo
-- lote), pra tela ordenar e mostrar a idade do cartão. Como o tipo de retorno ganhou a coluna e a 0158
-- ainda não estava em produção, a função é recriada (drop + create), o que também a deixa idempotente.
--
-- Corpo com $func$ (o SQL Editor não aceita dois cifrões). Aditiva e idempotente. Depende da 0155 e 0156.
-- =============================================================
drop function if exists public.sf_almox_pendencias();
create or replace function public.sf_almox_pendencias()
returns table (pmo text, op text, tipo text, codigo text, seq int, pecas int,
               lote_id uuid, amostra int, ja_lancadas int, em timestamptz)
language plpgsql stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  for v_o in
    select so.pmo as o_pmo, so.op as o_op, coalesce(so.embalagem_individual, false) as individual
      from sf_ordens so
     where upper(coalesce(so.status, '')) <> 'FINALIZADA'
       and exists (
         select 1 from sf_ordem_postos opp
           join sf_postos po       on po.chave = opp.posto
           join sf_posto_perfis pe on pe.chave = po.perfil
          where opp.ordem_id = so.id and pe.recurso = 'almoxarifado')
     order by so.pmo, so.op
  loop
    if v_o.individual then
      return query
      select v_o.o_pmo, v_o.o_op, 'lote'::text, l.rotulo, null::int, l.pecas,
             l.lote_id, l.amostra, l.ja_lancadas, l.aprovado_em
        from sf_almox_lotes(v_o.o_pmo, v_o.o_op) l;
    else
      return query
      select v_o.o_pmo, v_o.o_op, 'caixa'::text, n.codigo, n.seq, n.pecas,
             null::uuid, null::int, 0, n.fechada_em
        from sf_almox_necessidades(v_o.o_pmo, v_o.o_op) n;
    end if;
  end loop;
end;
$func$;

revoke all on function public.sf_almox_pendencias() from public, anon;
grant execute on function public.sf_almox_pendencias() to authenticated;

notify pgrst, 'reload schema';
