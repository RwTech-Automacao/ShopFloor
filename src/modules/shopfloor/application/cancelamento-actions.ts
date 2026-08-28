'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { postoCancelavel } from '../domain/cancelamento'
import { lerRegistroParaCancelar, ehUltimoBipe, chamarSfCancelar } from '../infra/cancelamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

const SEM_PERMISSAO = 'Você não tem permissão para cancelar.'

/** Checagem pro botão (UX): dá pra cancelar este bipe? Fail-closed. */
export async function cancelavelInfo(id: string): Promise<{ podeCancelar: boolean; motivo?: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { podeCancelar: false, motivo: 'Sem permissão para cancelar.' }
  }
  try {
    const reg = await lerRegistroParaCancelar(id)
    if (!reg) return { podeCancelar: false, motivo: 'Registro não encontrado.' }
    const perfil = (await mapaPostoPerfil())[reg.posto]
    if (!postoCancelavel(perfil?.recurso)) {
      return { podeCancelar: false, motivo: 'Este posto não pode ser cancelado por aqui.' }
    }
    if (!(await ehUltimoBipe(reg.pmo, reg.op, reg.numeroSerieNorm, id))) {
      return { podeCancelar: false, motivo: 'Só o bipe mais recente deste SN pode ser cancelado — cancele o mais recente primeiro.' }
    }
    return { podeCancelar: true }
  } catch {
    return { podeCancelar: false, motivo: 'Não foi possível verificar.' }
  }
}

/** Executa o cancelamento (gestor). Motivo obrigatório. */
export async function cancelarLancamento(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (motivo.trim() === '') return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  const r = await chamarSfCancelar(id, motivo.trim())
  if (r.ok) return { ok: true }
  const msg = r.erro
  if (msg.includes('NAO_E_ULTIMO')) return { ok: false, erro: 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.' }
  if (msg.includes('POSTO_NAO_CANCELAVEL')) return { ok: false, erro: 'Este posto não pode ser cancelado por aqui.' }
  if (msg.includes('MOTIVO_OBRIGATORIO')) return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  if (msg.includes('SEM_PERMISSAO')) return { ok: false, erro: SEM_PERMISSAO }
  if (msg.includes('NAO_ENCONTRADO')) return { ok: false, erro: 'Registro não encontrado (talvez já cancelado).' }
  return { ok: false, erro: 'Não foi possível cancelar o lançamento.' }
}
