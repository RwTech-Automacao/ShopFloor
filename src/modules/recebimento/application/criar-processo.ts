'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { converterValor } from '../domain/conversao'
import { calcularCamposCalculados, type CampoCalc } from '../domain/calculos'
import {
  carregarCamposFormulario,
  criarProcesso,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'
import { carregarItensPorLista } from '../infra/campo-comercial-repository'

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
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para criar processos.' }
  }

  const campos = await carregarCamposFormulario()
  const gruposBase = new Set(['comercial', 'material'])

  // Itens das listas usadas pelos campos base — para validar campos do tipo
  // `lista` contra os valores permitidos (mesma regra da importação; ver
  // `validacao-linha.ts`). Sem isso, um valor fora da lista passaria no servidor.
  const chavesLista = [
    ...new Set(
      campos
        .filter((c) => gruposBase.has(c.grupo) && !c.calculado && c.tipo === 'lista' && c.listaChave)
        .map((c) => c.listaChave as string),
    ),
  ]
  const itensPorLista = await carregarItensPorLista(chavesLista)

  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []
  for (const campo of campos) {
    if (!gruposBase.has(campo.grupo)) continue // recebimento/qualidade: em branco
    if (campo.calculado) continue // calculado nunca vem do cliente
    const bruto = valores[campo.campo]
    const vazio = bruto === null || bruto === undefined || String(bruto).trim() === ''
    if (campo.obrigatorioImportacao && vazio) {
      return { ok: false, erro: `Campo obrigatório: ${campo.rotulo}.` }
    }
    const itens = campo.listaChave ? itensPorLista[campo.listaChave] : undefined
    const r = converterValor(bruto, campo.tipo, itens)
    if (!r.ok) return { ok: false, erro: `${campo.rotulo}: ${r.erro}` }
    novosValores[campo.campo] = r.valor
    camposAlterados.push(campo.campo)
  }

  // Campos calculados (critico, atraso, divergencia, amostral) computados
  // autoritativamente no servidor a partir dos valores informados. Sem
  // valores anteriores (processo novo) → valoresAtuais: {}.
  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))
  const [fornecedoresCriticos, nqa] = await Promise.all([
    carregarCriticidade(),
    carregarTabelaNqa(),
  ])
  const calculados = calcularCamposCalculados(novosValores, camposCalculados, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
    valoresAtuais: {},
  })
  for (const [campo, valor] of Object.entries(calculados)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
  }

  let novo: { id: string; numero: number }
  try {
    novo = await criarProcesso({
      ...(novosValores as PatchProcesso),
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
    dados: { numero: novo.numero, campos: camposAlterados },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: novo.id }
}
