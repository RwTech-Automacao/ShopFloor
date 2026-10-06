-- =============================================================
-- ALERTAS — JANELA POR BLOCOS DE TURNO (esquema)
-- Spec: docs/superpowers/specs/2026-10-06-alerta-por-horario-design.md
--
-- Aplica POR CIMA da 0113/0115/0136/0137 (a 0113 NÃO é editada). Idempotente: rodar de novo não
-- quebra (create ... if not exists, drop ... if exists antes de recriar, add column if not exists).
--
-- O gestor cadastra os intervalos do turno (ex.: 07:00-12:00 e 13:30-17:30) e um passo. O APP
-- calcula qual bloco fechou (src/modules/alertas/domain/intervalos.ts) e manda os instantes
-- prontos; o banco NÃO faz aritmética de horário: só guarda os intervalos como time e conta bipes
-- entre dois instantes que recebe. A lógica (alerta_taxas / alerta_avaliar) vem na sequência
-- deste mesmo arquivo; aqui é só o esquema.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos.
-- =============================================================

-- ---------- janela_tipo aceita 'intervalos' ----------
-- O check de coluna da 0113 recebeu o nome automático alerta_regras_janela_tipo_check.
alter table public.alerta_regras drop constraint if exists alerta_regras_janela_tipo_check;
alter table public.alerta_regras
  add constraint alerta_regras_janela_tipo_check
  check (janela_tipo in ('tempo', 'bipes', 'op', 'intervalos'));

-- A janela por blocos é só da taxa de aprovação, e o janela_valor guarda o PASSO em minutos.
-- (O check da 0113 janela_valor > 0 para tipos diferentes de 'op' já cobre 'intervalos'.)
alter table public.alerta_regras drop constraint if exists alerta_regras_intervalos_check;
alter table public.alerta_regras
  add constraint alerta_regras_intervalos_check
  check (janela_tipo <> 'intervalos' or (tipo = 'aprovacao' and janela_valor >= 15));

-- ---------- os intervalos do turno ----------
create table if not exists public.alerta_regra_intervalos (
  id       uuid primary key default gen_random_uuid(),
  regra_id uuid not null references public.alerta_regras(id) on delete cascade,
  inicio   time not null,
  fim      time not null,
  constraint alerta_regra_intervalos_ordem check (fim > inicio),
  -- 15 minutos é o passo mínimo; intervalo menor que isso deixaria o passo sem valor válido.
  constraint alerta_regra_intervalos_minimo check (fim - inicio >= interval '15 minutes')
);

create index if not exists alerta_regra_intervalos_regra_idx
  on public.alerta_regra_intervalos (regra_id, inicio);

alter table public.alerta_regra_intervalos enable row level security;

-- Mesmo gate da tabela mãe (alerta_regras): shopfloor.administrar, com DOIS argumentos (permissão
-- do módulo, não a global) e dentro de (select ...) para o planner avaliar uma vez (padrão 0096).
-- Diferença da mãe, de propósito: aqui há policy de DELETE. A regra é excluída de forma lógica,
-- mas os intervalos dela são editáveis (o gestor remove/troca um intervalo ao ajustar o turno).
drop policy if exists alerta_regra_intervalos_select_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_select_admin on public.alerta_regra_intervalos
  for select using ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_insert_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_insert_admin on public.alerta_regra_intervalos
  for insert with check ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_update_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_update_admin on public.alerta_regra_intervalos
  for update using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));
drop policy if exists alerta_regra_intervalos_delete_admin on public.alerta_regra_intervalos;
create policy alerta_regra_intervalos_delete_admin on public.alerta_regra_intervalos
  for delete using ((select tem_permissao('shopfloor', 'administrar')));

revoke all on public.alerta_regra_intervalos from public, anon;
grant select, insert, update, delete on public.alerta_regra_intervalos to authenticated;
grant select, insert, update, delete on public.alerta_regra_intervalos to service_role;

-- ---------- o bloco já avisado ----------
-- Quem comanda a insistência nesta janela: a mensagem sai quando o bloco avaliado é MAIS NOVO que
-- este. Null = nenhum bloco avisado ainda. Não usa lembrete_min.
alter table public.alerta_ocorrencias
  add column if not exists bloco_reportado timestamptz;
