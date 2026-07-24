'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  carregarCamposFormulario,
  criarProcesso,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'
import { carregarItensPorLista } from '../infra/campo-comercial-repository'
import { prepararValoresProcesso } from './preparar-valores-processo'

export type ResultadoCriarProcesso = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Cria um processo manualmente a partir dos campos Comercial + Material,
 * seguindo as mesmas regras da importação: obrigatórios = `obrigatorioImportacao`,
 * calculados computados no servidor (nunca digitados). O processo nasce
 * 'aberto' com `numero` automático (ver `criarProcesso`). Gate: `editar`.
 */
export async function criarProcessoManual(
  valores: Record<string, unknown>,
): Promise<ResultadoCriarProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para criar processos.' }
  }

  const campos = await carregarCamposFormulario()

  const chavesLista = [
    ...new Set(
      campos
        .filter((c) => (c.grupo === 'comercial' || c.grupo === 'material') && !c.calculado && c.tipo === 'lista' && c.listaChave)
        .map((c) => c.listaChave as string),
    ),
  ]
  const [itensPorLista, fornecedoresCriticos, nqa] = await Promise.all([
    carregarItensPorLista(chavesLista),
    carregarCriticidade(),
    carregarTabelaNqa(),
  ])

  const prep = prepararValoresProcesso(campos, itensPorLista, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
  }, valores)
  if (!prep.ok) return { ok: false, erro: prep.erro }

  let novo: { id: string; numero: number }
  try {
    novo = await criarProcesso({
      ...(prep.valores as PatchProcesso),
      criado_por: sessao.usuarioId,
    })
  } catch {
    return { ok: false, erro: 'Não foi possível criar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: novo.id,
    acao: 'criar',
    descricao: `Processo #${novo.numero} criado manualmente`,
    dados: { numero: novo.numero, campos: prep.camposAlterados },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: novo.id }
}
