-- Caixa e embalagem em placas (0163). Roda numa única conexão (a permissão vem de `teste.perms`).
set teste.perms = 'shopfloor.lancar';

-- OP A: N=50 (PMOT01/1) · OP B: N=1 (PMOT02/2, default)
insert into sf_ordens (pmo, op, qtd) values ('PMOT01','1', 5000), ('PMOT02','2', 1000);
update sf_ordens set placas_por_painel = 50 where pmo = 'PMOT01';

-- bipe de Embalagem: devolve o jsonb do sf_lancar
create function pg_temp.bipar(p_pmo text, p_op text, p_sn text, p_limite int, p_caixa text default 'CX[1]')
returns jsonb language sql as $f$
  select public.sf_lancar(p_pmo, p_op, 'Cli', 'Embalagem', 'Fulano', p_sn, p_sn, '', false,
    p_caixa, p_limite, null, null, '', false, '[]'::jsonb, false, '')
$f$;

do $$
declare r jsonb; i int; v_cod text;
begin
  -- ---------- N=50, limite 500: 10 painéis cabem, o 11º dá CAIXA_CHEIA ----------
  for i in 1..10 loop
    r := pg_temp.bipar('PMOT01','1','P'||i, 500);
    assert (r->>'ok')::boolean, 'painel '||i||' deveria caber: '||r::text;
    assert (r->>'caixa_count')::int = 50*i, 'caixa_count '||i||' = '||(r->>'caixa_count');
    assert (r->>'pecas')::int = 50, 'pecas do bipe = 50';
  end loop;
  r := pg_temp.bipar('PMOT01','1','P11', 500);
  assert not (r->>'ok')::boolean and r->>'erro' = 'CAIXA_CHEIA', '11º painel deveria dar CAIXA_CHEIA: '||r::text;
  assert (r->>'pecas')::int = 50 and (r->>'count')::int = 500 and (r->>'limite')::int = 500, 'dados da recusa: '||r::text;
  assert not exists (select 1 from sf_registros where numero_serie_norm = 'P11'), 'recusado não grava';

  -- uma 2ª LINHA do mesmo SN (retorno/reteste) não soma de novo: a caixa continua com 500 placas
  insert into sf_registros (pmo, op, posto, numero_caixa, numero_serie, numero_serie_norm)
    values ('PMOT01','1','Embalagem','CX[1]','P3','P3');

  -- fechar: qtd=500 (SN repetido contado uma vez) e código CX[1][500]OP-PMO
  insert into sf_caixas (pmo, op, posto, seq, limite) values ('PMOT01','1','Embalagem',1,500);
  r := public.sf_fechar_caixa('PMOT01','1','Embalagem',1,false);
  assert (r->>'ok')::boolean, 'fechar: '||r::text;
  assert r->>'codigo' = 'CX[1][500]1-PMOT01', 'código: '||(r->>'codigo');
  assert (select qtd from sf_caixas where pmo='PMOT01' and seq=1) = 500, 'sf_caixas.qtd = 500';

  -- ---------- N=50, limite 520 (não múltiplo): o 11º painel (550) é recusado ----------
  for i in 1..10 loop
    r := pg_temp.bipar('PMOT01','1','Q'||i, 520, 'CX[2]');
    assert (r->>'ok')::boolean, 'Q'||i||' deveria caber';
  end loop;
  r := pg_temp.bipar('PMOT01','1','Q11', 520, 'CX[2]');
  assert r->>'erro' = 'CAIXA_CHEIA' and (r->>'count')::int = 500 and (r->>'limite')::int = 520, '520: '||r::text;
  insert into sf_caixas (pmo, op, posto, seq, limite) values ('PMOT01','1','Embalagem',2,520);
  r := public.sf_fechar_caixa('PMOT01','1','Embalagem',2,true);
  assert r->>'codigo' = 'CX[2][500]1-PMOT01', 'fecha com 500 de 520: '||(r->>'codigo');

  -- limite nulo (última caixa): sem checagem, mas o retorno traz o peso do bipe
  r := public.sf_lancar('PMOT01','1','Cli','Embalagem','Fulano','U1','U1','',false,'CX[3]',null,null,null,'',false,'[]'::jsonb,false,'');
  assert (r->>'ok')::boolean and (r->>'pecas')::int = 50 and not r ? 'caixa_count', 'última caixa: '||r::text;

  -- ---------- N=1: idêntico ao comportamento antigo ----------
  for i in 1..3 loop
    r := pg_temp.bipar('PMOT02','2','S'||i, 3);
    assert (r->>'ok')::boolean and (r->>'caixa_count')::int = i, 'N=1 caixa_count '||i;
    assert (r->>'pecas')::int = 1, 'N=1 pecas=1';
  end loop;
  r := pg_temp.bipar('PMOT02','2','S4', 3);
  assert r->>'erro' = 'CAIXA_CHEIA', 'N=1: 4º recusado';
  insert into sf_registros (pmo, op, posto, numero_caixa, numero_serie, numero_serie_norm)
    values ('PMOT02','2','Embalagem','CX[1]','S2','S2');   -- 2ª linha do mesmo SN: continua 3
  insert into sf_caixas (pmo, op, posto, seq, limite) values ('PMOT02','2','Embalagem',1,3);
  r := public.sf_fechar_caixa('PMOT02','2','Embalagem',1,false);
  assert r->>'codigo' = 'CX[1][3]2-PMOT02', 'N=1 código: '||(r->>'codigo');

  -- caixa vazia continua recusada
  r := public.sf_fechar_caixa('PMOT02','2','Embalagem',9,false);
  assert r->>'erro' = 'CAIXA_VAZIA', 'vazia';

  -- sem permissão
  set teste.perms = '';
  r := pg_temp.bipar('PMOT02','2','S9', 3);
  assert r->>'erro' = 'SEM_PERMISSAO', 'sem permissão';
end $$;
