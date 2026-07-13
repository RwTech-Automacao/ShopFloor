-- #7 + #3a: seções Recebimento/Qualidade + status dinâmico.

-- 1) Status: remove a constraint fixa (os terminais agora são dinâmicos =
--    valores da lista "Resultado"). Normaliza dados de teste antigos.
alter table public.processos_recebimento drop constraint if exists processos_recebimento_status_check;
update public.processos_recebimento set status = 'em_conferencia'
  where status in ('finalizado', 'cancelado');

-- 2) Responsáveis por seção (último que salvou); remove o responsável de contagem.
alter table public.processos_recebimento
  add column responsavel_recebimento uuid references public.usuarios(id),
  add column responsavel_qualidade  uuid references public.usuarios(id),
  drop column if exists responsavel_contagem;

-- 3) Config de campos: PN recebido vai para Qualidade (1º item); remove o
--    responsável de contagem; obrigatório na finalização passa a ser só o resultado.
update public.configuracao_campos set grupo = 'qualidade', ordem = 235 where campo = 'part_number_recebido';
delete from public.configuracao_campos where campo = 'responsavel_contagem';
update public.configuracao_campos set obrigatorio_finalizacao = (campo = 'resultado');

-- 4) Lista "Resultado" ganha os status terminais iniciais (Admin pode adicionar mais).
insert into public.lista_itens (lista_id, valor, ativo, ordem)
  select l.id, v.valor, true, v.ordem
  from public.listas l
  cross join (values ('Aprovado', 1), ('Reprovado', 2)) as v(valor, ordem)
  where l.chave = 'resultado'
  on conflict do nothing;

-- 5) RLS: "concluído" deixa de ser = 'finalizado' e passa a ser "não é
--    aberto/em_conferencia" (cobre qualquer terminal dinâmico). Remove o cancelado.
drop policy processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status in ('aberto', 'em_conferencia') or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status in ('aberto', 'em_conferencia')
         or public.tem_permissao('finalizar')
         or public.tem_permissao('editar_finalizado'))
  );
