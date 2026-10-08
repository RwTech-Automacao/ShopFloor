-- Grava a justificativa de divergencia de quantidade no Recebimento. Idempotente (pode reaplicar).
-- Por que funcao e nao update direto: a policy processos_update (0051) exige recebimento.editar e,
-- fora de aberto/em_conferencia, tambem editar_finalizado. Quem justifica e o administrador do modulo
-- (recebimento.administrar), que e outro flag; um update direto atualizaria 0 linhas em silencio.
-- Policy nao restringe colunas, entao afrouxa-la abriria a edicao de todas as colunas de um processo
-- finalizado. Esta funcao security definer escreve SO os campos da justificativa.
-- O nome do autor e gravado junto (denormalizado, como logs.usuario_nome): a policy de leitura de
-- public.usuarios nao deixa quem so administra o Recebimento ler o nome dos outros. Como esta funcao
-- e security definer, ela le usuarios e grava o nome na propria linha. Usuario nao encontrado grava ''.
-- O autor vem de auth.uid(), nunca de parametro. O limite de tamanho do texto e aparado na aplicacao.

create or replace function public.rec_justificar_divergencia(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_nome text;
begin
  if not tem_permissao('recebimento', 'administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- Nome de exibicao igual ao resto do app (registrarLog): nome, e o e-mail se o nome estiver vazio.
  select coalesce(nullif(btrim(u.nome), ''), u.email, '') into v_nome
    from public.usuarios u where u.id = auth.uid();

  update public.processos_recebimento
     set divergencia_justificativa = coalesce(p_texto, ''),
         divergencia_justificada_por = auth.uid(),
         divergencia_justificada_em = now(),
         divergencia_justificada_por_nome = coalesce(v_nome, '')
   where id = p_id;

  if not found then
    raise exception 'PROCESSO_NAO_ENCONTRADO';
  end if;
end;
$func$;

grant execute on function public.rec_justificar_divergencia(uuid, text) to authenticated;

notify pgrst, 'reload schema';
