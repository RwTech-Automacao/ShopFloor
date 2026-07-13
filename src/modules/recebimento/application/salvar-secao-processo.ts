'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { ehTerminal, podePromoverParaConferencia, STATUS_EM_CONFERENCIA } from '../domain/ciclo-vida'
import { calcularCamposCalculados, type CampoCalc } from '../domain/calculos'
import { converterValor } from '../domain/conversao'
import {
  atualizarProcesso,
  buscarProcesso,
  carregarCamposFormulario,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'

export type Secao = 'recebimento' | 'qualidade'
export type ResultadoSalvarProcesso = { ok: true } | { ok: false; erro: string }

/**
 * Salva uma seção de conferência (recebimento OU qualidade). Ambas gravam
 * também os campos base (comercial + material). Carimba o responsável da seção
 * = usuário que salvou (último). 1º save promove aberto → em_conferencia.
 */
export async function salvarSecaoProcesso(
  id: string,
  secao: Secao,
  valores: Record<string, unknown>,
): Promise<ResultadoSalvarProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para editar processos.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status) && !podeFazer(sessao.perfil, 'editar_finalizado')) {
    return { ok: false, erro: 'Você não tem permissão para editar um processo concluído.' }
  }

  const campos = await carregarCamposFormulario()
  const gruposAceitos = new Set(['comercial', 'material', secao])
  const camposPorNome = new Map(campos.map((c) => [c.campo, c]))
  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))

  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []
  for (const [campo, bruto] of Object.entries(valores)) {
    const config = camposPorNome.get(campo)
    if (!config) continue
    if (!gruposAceitos.has(config.grupo)) continue // campo de outra seção → ignora
    if (config.calculado) continue
    const r = converterValor(bruto, config.tipo)
    if (!r.ok) return { ok: false, erro: `${config.rotulo}: ${r.erro}` }
    novosValores[campo] = r.valor
    camposAlterados.push(campo)
  }

  const valoresAtuais = processo as unknown as Record<string, unknown>
  const valoresParaCalculo: Record<string, unknown> = { ...valoresAtuais, ...novosValores }
  const [fornecedoresCriticos, nqa] = await Promise.all([carregarCriticidade(), carregarTabelaNqa()])
  const resultadoCalculo = calcularCamposCalculados(valoresParaCalculo, camposCalculados, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
    valoresAtuais,
  })
  const camposCalculadosAlterados: string[] = []
  for (const [campo, valor] of Object.entries(resultadoCalculo)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
    camposCalculadosAlterados.push(campo)
  }

  const diff = calcularDiff(
    processo as unknown as Record<string, unknown>,
    novosValores,
    [...camposAlterados, ...camposCalculadosAlterados],
  )

  const patch: PatchProcesso = { ...(novosValores as PatchProcesso), atualizado_por: sessao.usuarioId }
  if (secao === 'recebimento') patch.responsavel_recebimento = sessao.usuarioId
  else patch.responsavel_qualidade = sessao.usuarioId
  const promove = podePromoverParaConferencia(processo.status)
  if (promove) patch.status = STATUS_EM_CONFERENCIA

  try {
    await atualizarProcesso(id, patch)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Processo #${processo.numero} — seção ${secao} salva`,
    dados: diff,
  })
  if (promove) {
    await registrarLog({
      entidade: 'processo',
      entidadeId: id,
      acao: 'mudar_status',
      descricao: `Processo #${processo.numero}: aberto → em_conferencia`,
      dados: { de: 'aberto', para: 'em_conferencia' },
    })
  }

  revalidatePath(`/recebimento/processos/${id}`)
  return { ok: true }
}
