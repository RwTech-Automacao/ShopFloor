-- ATENÇÃO: confira a numeração antes de aplicar. A 0138 era a próxima livre quando foi escrita,
-- mas a ordem de merge das branches abertas pode mudar; renumere se outra migração tomou o 0138.
--
-- =============================================================
-- Confirmação de conserto: de ONDE veio a confirmação, e O QUE foi confirmado.
--
-- A tabela (0072) guardava uma linha por DEFEITO confirmado, no posto que conserta no próprio
-- lugar. Passa a guardar também uma linha por CONSERTO confirmado, quando a peça volta da
-- Manutenção e alguém confere o reparo no posto da rota de reteste (0102/0103).
--
-- Sem a coluna `origem` as duas confirmações se misturariam e quem consultasse depois não saberia
-- distinguir "quem atestou o defeito?" de "quem conferiu o reparo?" — as colunas de defeito ficam
-- vazias na confirmação de reparo, e isso sozinho não é sinal confiável (defeito pode ter código
-- vazio e só posição).
--
-- `origem` nasce 'posto' em tudo o que já existe: o histórico continua válido e NENHUMA consulta
-- de hoje muda de resultado.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGPASSFILE=/dev/null PGCLIENTENCODING=UTF8 psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0138_conserto_confirmado_origem.sql
--
-- Aditiva: não recria função nenhuma, não toca política nenhuma. Idempotente.
-- =============================================================

alter table public.sf_conserto_confirmado
  add column if not exists origem   text not null default 'posto',
  add column if not exists conserto text not null default '';

comment on column public.sf_conserto_confirmado.origem is
  'De onde veio a confirmação: ''posto'' = o operador confirmou o DEFEITO no posto que conserta no '
  'próprio lugar (comportamento da 0072); ''manutencao'' = alguém conferiu o CONSERTO registrado '
  'pela Manutenção, no posto da rota de reteste. Default ''posto'': é o valor de todo o histórico '
  'anterior a esta migração.';

comment on column public.sf_conserto_confirmado.conserto is
  'A descrição do conserto confirmado (o `reparo_conserto` da linha da Manutenção). Vazia quando '
  'origem = ''posto'' — lá o que se confirma é o defeito, e ele mora em codigo_defeito/posicao/tipo.';

-- O check entra DEPOIS do backfill implícito do default: toda linha existente já é 'posto'.
-- `not valid` + `validate` seria necessário só numa tabela grande; esta tem poucas centenas.
do $func$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sf_conserto_confirmado'::regclass
       and conname = 'sf_conserto_confirmado_origem_check'
  ) then
    alter table public.sf_conserto_confirmado
      add constraint sf_conserto_confirmado_origem_check
      check (origem in ('posto', 'manutencao'));
  end if;
end
$func$;

notify pgrst, 'reload schema';
