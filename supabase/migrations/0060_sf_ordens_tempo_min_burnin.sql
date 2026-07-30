-- Tempo mínimo de Burn-in por OP (minutos; 0 = sem mínimo). Só add column (não reescreve linhas).
alter table public.sf_ordens
  add column if not exists tempo_min_burnin int not null default 0;
comment on column public.sf_ordens.tempo_min_burnin is 'Tempo mínimo de Burn-in em minutos (0 = sem mínimo).';
