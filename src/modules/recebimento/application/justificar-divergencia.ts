'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { cortarJustificativa } from '../domain/divergencia'

/**
 * Grava a justificativa de uma divergência de quantidade (texto vazio apaga). Exige
 * `recebimento.administrar`. O autor e o instante são gravados pela função do banco
 * (`rec_justificar_divergencia`, via auth.uid()) — a action não manda id de usuário.
 */
export async function salvarJustificativaDivergencia(
  id: string,
  texto: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para esta ação.' }
  }

  const limpo = cortarJustificativa(texto)

  let mensagemErro: string | null = null
  try {
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('rec_justificar_divergencia', { p_id: id, p_texto: limpo })
    if (error) mensagemErro = error.message ?? ''
  } catch {
    return { ok: false, erro: 'Não foi possível salvar a justificativa.' }
  }

  if (mensagemErro !== null) {
    if (mensagemErro.includes('SEM_PERMISSAO')) {
      return { ok: false, erro: 'Você não tem permissão para esta ação.' }
    }
    if (mensagemErro.includes('PROCESSO_NAO_ENCONTRADO')) {
      return { ok: false, erro: 'Processo não encontrado.' }
    }
    return { ok: false, erro: 'Não foi possível salvar a justificativa.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: limpo
      ? `Justificativa de divergência de quantidade: ${limpo}`
      : 'Justificativa de divergência de quantidade apagada',
    dados: { campo: 'divergencia_justificativa', valor: limpo },
  })

  revalidatePath(`/recebimento/processos/${id}`)
  revalidatePath('/recebimento/processos')
  return { ok: true }
}
