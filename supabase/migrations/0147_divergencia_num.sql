-- Divergencia de quantidade em NUMERO, para os filtros rapidos do grid de Processos
-- (Divergencias / positivas / negativas). Idempotente (pode reaplicar).
--
-- Por que existe: processos_recebimento.divergencia e TEXT (campo livre que vem da importacao e ja
-- recebeu valor digitado a mao, inclusive com virgula decimal). O grid filtra NO BANCO -- de
-- proposito, para filtrar na pagina 1 achar o que estaria na pagina 10 -- e em coluna text o
-- Postgres compara como TEXTO: '9' > '10' e '-5' > '0'. Filtrar o sinal direto na coluna sairia
-- silenciosamente errado, e os botoes discordariam dos selos da mesma tela.
--
-- A regra e a MESMA de temDivergencia(), em src/modules/recebimento/domain/etapa-processo.ts:
--   vazio                                 -> nulo (ainda nao conferido, NAO e divergencia)
--   texto que nao e numero                -> nulo (nao inventa significado)
--   zero                                  -> 0 (sem divergencia)
--   qualquer outro numero, + ou -         -> o numero (tem divergencia)
-- Mudou la, muda aqui: as duas decidem a mesma coisa e tem que decidir igual.

create or replace function public.rec_divergencia_num(p_valor text)
returns numeric
language plpgsql
immutable
as $func$
declare
  v_texto text;
  v_num   numeric;
begin
  if p_valor is null then
    return null;
  end if;
  v_texto := btrim(p_valor);
  if v_texto = '' then
    return null;
  end if;
  -- Virgula decimal: o campo e texto livre e ja recebeu '1,5' digitado por gente.
  begin
    v_num := replace(v_texto, ',', '.')::numeric;
  exception when others then
    return null;  -- nao e numero: sem significado, igual a temDivergencia()
  end;
  -- 'NaN', 'Infinity' e '-Infinity' SAO numeric validos no Postgres 14+, mas Number.isFinite() os
  -- rejeita no dominio. Sem este corte, uma celula com 'Infinity' entraria na lista filtrada por
  -- divergencia e apareceria SEM selo na linha -- a tela discordando de si mesma.
  if v_num = 'NaN'::numeric
     or v_num = 'Infinity'::numeric
     or v_num = '-Infinity'::numeric then
    return null;
  end if;
  return v_num;
end $func$;

comment on function public.rec_divergencia_num(text) is
  'Divergencia de quantidade como numero, ou nulo quando nao ha numero com significado (vazio, texto, NaN, infinito). Espelha temDivergencia() do dominio: nulo e zero NAO sao divergencia.';

alter table public.processos_recebimento
  add column if not exists divergencia_num numeric
    generated always as (public.rec_divergencia_num(divergencia)) stored;

comment on column public.processos_recebimento.divergencia_num is
  'Coluna GERADA: divergencia em numero, pelos olhos de rec_divergencia_num. Existe so para o banco poder filtrar e ordenar pelo SINAL da divergencia (a coluna divergencia e text e compara como texto). Nunca se escreve nela.';

-- Parcial: so as linhas divergentes entram, o que deixa o indice pequeno. Serve aos tres filtros --
-- o planejador prova que "> 0" e "< 0" implicam "<> 0".
create index if not exists processos_recebimento_divergencia_num_idx
  on public.processos_recebimento (divergencia_num)
  where divergencia_num <> 0;

notify pgrst, 'reload schema';
