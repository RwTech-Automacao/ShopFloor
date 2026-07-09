-- Criticidade vira lista de fornecedores críticos (presença = crítico).
alter table public.criticidade_fornecedor drop column critico;
