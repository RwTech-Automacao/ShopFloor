-- =============================================================
-- ALERTAS — TIPOS DE REGRA, DESTINATÁRIOS DO SHOPFLOOR E FILTRO DE PMO
-- Spec: docs/superpowers/specs/2026-09-18-alertas-tipos-de-regra-design.md
--
-- Aplica POR CIMA da 0113/0114 (já em produção — a 0113 NÃO é editada). Idempotente: rodar de
-- novo não quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql
--
-- O que muda:
--   A. alerta_regras ganha tipo ('aprovacao' | 'tempo' | 'defeito') + os campos de cada tipo +
--      pmos; a ocorrência ganha defeito e valores genéricos; usuario_tem_permissao; alerta_pmos.
--   B. alerta_avaliar decide os 3 tipos (alerta_taxas com PMO, alerta_tempos, alerta_defeitos);
--      alerta_previa e alerta_listar_ocorrencias novas.
--   C. Destinatário = usuário ativo com shopfloor.administrar no PERFIL DELE: na lista da tela, na
--      fila, na reserva e no botão Resolvido.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A1. Regras: tipo, campos de cada tipo e PMOs ----------
alter table public.alerta_regras
  add column if not exists tipo               text   not null default 'aprovacao',
  add column if not exists limite_tempo_seg   int,
  add column if not exists limite_ocorrencias int,
  add column if not exists pausa_max_min      int,
  add column if not exists pmos               text[] not null default '{}'::text[];

-- Cada tipo usa só os seus campos: taxa_minima e minimo_bipes deixam de ser obrigatórios. (O
-- default 20 de minimo_bipes fica — quem grava regra de defeito manda null explícito.)
alter table public.alerta_regras alter column taxa_minima  drop not null;
alter table public.alerta_regras alter column minimo_bipes drop not null;

alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito'));

-- coalesce(..., false): sem ele, um campo NULO faria a expressão dar NULL — e check com NULL PASSA.
alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_campos_por_tipo check (coalesce(
  case tipo
    when 'aprovacao' then
          taxa_minima is not null and minimo_bipes is not null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'tempo' then
          janela_tipo in ('tempo', 'op')
      and limite_tempo_seg between 1 and 3600
      and minimo_bipes is not null
      and pausa_max_min between 1 and 240
      and taxa_minima is null and limite_ocorrencias is null
    when 'defeito' then
          janela_tipo = 'tempo'
      and limite_ocorrencias >= 2
      and taxa_minima is null and minimo_bipes is null
      and limite_tempo_seg is null and pausa_max_min is null
  end, false));

alter table public.alerta_regras drop constraint if exists alerta_regras_pmos_sem_nulo;
alter table public.alerta_regras add constraint alerta_regras_pmos_sem_nulo
  check (array_position(pmos, null) is null);

-- O tipo não muda depois de criado (spec §1, decisão 2). Trigger, não policy: a policy de update não
-- enxerga a linha antiga.
create or replace function public.alerta_regras_tipo_fixo()
returns trigger
language plpgsql
as $func$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'TIPO_FIXO';
  end if;
  return new;
end
$func$;

drop trigger if exists alerta_regras_tipo_fixo on public.alerta_regras;
create trigger alerta_regras_tipo_fixo
  before update on public.alerta_regras
  for each row execute function public.alerta_regras_tipo_fixo();

-- ---------- A2. Ocorrências: defeito + valores genéricos ----------
-- valor_* = o que foi medido na régua do tipo: aprovação = taxa (%), tempo = média (segundos),
-- defeito = contagem. amostras = bipes com resultado (aprovação), peças (tempo) ou vezes (defeito).
-- taxa_abertura/taxa_ultima continuam (só aprovação) para não quebrar nada que já lê essas colunas.
alter table public.alerta_ocorrencias
  add column if not exists defeito        text,
  add column if not exists valor_abertura numeric(12,2),
  add column if not exists valor_ultimo   numeric(12,2),
  add column if not exists amostras       int;
alter table public.alerta_ocorrencias alter column taxa_abertura drop not null;
alter table public.alerta_ocorrencias alter column taxa_ultima   drop not null;

-- Ocorrências de antes da 0115 (todas de aprovação): copia a taxa para os valores genéricos.
update public.alerta_ocorrencias
   set valor_abertura = taxa_abertura,
       valor_ultimo   = taxa_ultima,
       amostras       = aprovados + reprovados
 where valor_abertura is null and taxa_abertura is not null;

-- Uma ocorrência viva por regra x posto x DEFEITO (tipos sem defeito: ''). Cada defeito que passa do
-- limite abre a SUA ocorrência. O índice antigo (regra x posto) impediria isso — sai.
drop index if exists public.alerta_ocorrencias_viva;
create unique index if not exists alerta_ocorrencias_viva_defeito
  on public.alerta_ocorrencias (regra_id, posto, coalesce(defeito, ''))
  where estado in ('aberta', 'resolvida');

-- ---------- A3. usuario_tem_permissao(): a permissão de UM USUÁRIO (não de quem chama) ----------
-- Mesma régua da tem_permissao(text, text) da 0043 (perfil_permissao pelo usuarios.perfil_id, só
-- usuário ativo), mas para o usuário informado: é assim que a fila sabe se o DESTINATÁRIO ainda
-- administra o ShopFloor. Só o servidor chama direto; as funções de alerta (security definer)
-- chamam como dono.
create or replace function public.usuario_tem_permissao(p_usuario uuid, p_modulo text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1
      from public.usuarios u
      join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
     where u.id = p_usuario
       and u.ativo
       and pp.modulo = p_modulo
       and pp.permissao = p_perm
  )
$func$;

revoke all on function public.usuario_tem_permissao(uuid, text, text) from public, anon, authenticated;
grant execute on function public.usuario_tem_permissao(uuid, text, text) to service_role;

-- ---------- A4. alerta_pmos(): as PMOs que o formulário oferece ----------
-- Um array só (não uma linha por PMO): o PostgREST corta resultado em 1000 linhas, e um valor único
-- não é cortado.
create or replace function public.alerta_pmos()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return (
    select coalesce(array_agg(x.pmo order by x.pmo), '{}'::text[])
      from (select distinct btrim(o.pmo) as pmo from public.sf_ordens o where btrim(o.pmo) <> '') x
  );
end
$func$;

revoke all on function public.alerta_pmos() from public, anon;
grant execute on function public.alerta_pmos() to authenticated, service_role;

notify pgrst, 'reload schema';
