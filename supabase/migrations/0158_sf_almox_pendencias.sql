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
-- `amostra` (lote) = quantidade a bipar = TODAS as peças do lote (decisão de 21/10; antes era o K da Tabela NQA).
-- `em` = desde quando o item espera: o fechada_em da caixa (tipo caixa) ou o aprovado_em do lote (tipo
-- lote), pra tela ordenar e mostrar a idade do cartão. Como o tipo de retorno ganhou a coluna e a 0158
-- ainda não estava em produção, a função é recriada (drop + create), o que também a deixa idempotente.
--
-- PEÇAS AVULSAS (OP individual cujo posto anterior NÃO é de recurso 'nqa'): a entrada é peça por peça, bipando
-- o número de série de cada uma. A OP vira UMA linha `tipo = 'peca'`, codigo 'AVULSAS', `pecas` = SNs que
-- cumprem o gate do posto anterior e ainda não têm registro no Almoxarifado, `em` = a conclusão mais recente
-- no posto anterior. Sem posto anterior (Almoxarifado em primeiro lugar) ou com pecas = 0: sem linha. A leitura
-- é de forma ESTÁVEL (incidente de 22/10): UMA consulta por OP, group by no posto anterior pelo índice
-- sf_registros_posto_data e anti-join por igualdade contra o conjunto distinto do Almoxarifado — nada
-- correlacionado por peça, nada que dependa de estatística do planejador.
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
  v_o record; v_almox text; v_prev record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  for v_o in
    select so.id as o_id, so.pmo as o_pmo, so.op as o_op, coalesce(so.embalagem_individual, false) as individual
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

      -- Peças avulsas: o posto Almoxarifado DA ROTA (pelo perfil, o mesmo select do detalhe) e o anterior a ele.
      select opp.posto into v_almox
        from sf_ordem_postos opp
        join sf_postos po       on po.chave = opp.posto
        join sf_posto_perfis pe on pe.chave = po.perfil
       where opp.ordem_id = v_o.o_id and pe.recurso = 'almoxarifado'
       order by opp.ordem, opp.posto
       limit 1;
      select * into v_prev from sf_almox_posto_anterior(v_o.o_id, v_almox);
      if v_prev.posto is not null and v_prev.recurso <> 'nqa' then
        return query
        with ja as (
          select distinct a.numero_serie_norm as sn
            from sf_registros a
           where a.pmo = v_o.o_pmo and a.op = v_o.o_op and a.posto = v_almox and a.numero_serie_norm <> ''
        ), esp as (
          select r.numero_serie_norm as sn, max(r.data_hora) as conc
            from sf_registros r
           where r.pmo = v_o.o_pmo and r.op = v_o.o_op and r.posto = v_prev.posto
             and r.numero_serie_norm <> ''
             and (not v_prev.precisa_aprovado or lower(r.status) = 'aprovado')
           group by r.numero_serie_norm
        )
        select v_o.o_pmo, v_o.o_op, 'peca'::text, 'AVULSAS'::text, null::int, count(*)::int,
               null::uuid, null::int, 0, max(e.conc)
          from esp e
         where not exists (select 1 from ja where ja.sn = e.sn)
        having count(*) > 0;
      end if;
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
