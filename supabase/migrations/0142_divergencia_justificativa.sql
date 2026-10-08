-- Justificativa de divergencia de quantidade no Recebimento: quem clica no selo "?" escreve o porque
-- e o que foi alinhado, e o selo vira "ok". Idempotente (pode reaplicar).
-- Sem policy nova: a escrita segue a processos_update (0051), que ja exige recebimento.editar.

alter table public.processos_recebimento
  add column if not exists divergencia_justificativa text not null default '',
  add column if not exists divergencia_justificada_por uuid references public.usuarios(id),
  add column if not exists divergencia_justificada_em timestamptz;

comment on column public.processos_recebimento.divergencia_justificativa is
  'Texto livre: o porque da divergencia de quantidade e o que foi alinhado. Vazio = ninguem justificou. SOBREVIVE ao sumico da divergencia: se a quantidade for corrigida depois, o texto fica guardado como historico.';
comment on column public.processos_recebimento.divergencia_justificada_por is
  'Usuario que gravou a justificativa da divergencia (auditoria).';
comment on column public.processos_recebimento.divergencia_justificada_em is
  'Quando a justificativa da divergencia foi gravada pela ultima vez.';

notify pgrst, 'reload schema';
