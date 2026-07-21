'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  carregarCamposFormulario,
  criarProcessosLote,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'
import { carregarItensPorLista } from '../infra/campo-comercial-repository'
import { prepararValoresProcesso } from './preparar-valores-processo'

export type ResultadoColetivo =
  | { ok: true; id: string; total: number }
  | { ok: false; erro: string }

/**
 * Cria vários processos de uma vez: o Comercial (compartilhado) + cada linha de
 * Material vira um processo. Cada linha exige "Item Recebido" (codigo_material).
 * Calculados computados por linha. Criação atômica. Retorna o id do processo de
 * menor numero (o 1º), para onde a tela redireciona. Gate: `editar`.
 */
export async function criarProcessosColetivo(
  comercial: Record<string, unknown>,
  materiais: Array<Record<string, unknown>>,
): Promise<ResultadoColetivo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para criar processos.' }
  }
  if (materiais.length === 0) {
    return { ok: false, erro: 'Adicione ao menos uma linha de material.' }
  }
  if (materiais.length > 200) {
    return { ok: false, erro: 'Máximo de 200 processos por lote.' }
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
  const deps = { fornecedoresCriticos, nqa, usuarioAtual: sessao.nome || sessao.email }

  const rows: Array<PatchProcesso & { criado_por: string }> = []
  for (let i = 0; i < materiais.length; i++) {
    const linha = materiais[i]!
    const itemRecebido = linha['codigo_material']
    if (itemRecebido === null || itemRecebido === undefined || String(itemRecebido).trim() === '') {
      return { ok: false, erro: `Linha ${i + 1}: Item Recebido é obrigatório.` }
    }
    const prep = prepararValoresProcesso(campos, itensPorLista, deps, { ...comercial, ...linha })
    if (!prep.ok) return { ok: false, erro: `Linha ${i + 1}: ${prep.erro}` }
    rows.push({ ...(prep.valores as PatchProcesso), criado_por: sessao.usuarioId })
  }

  let criados: Array<{ id: string; numero: number }>
  try {
    criados = await criarProcessosLote(rows)
  } catch {
    return { ok: false, erro: 'Não foi possível criar os processos.' }
  }
  if (criados.length === 0) return { ok: false, erro: 'Não foi possível criar os processos.' }

  const ordenados = [...criados].sort((a, b) => a.numero - b.numero)
  const primeiro = ordenados[0]!
  await registrarLog({
    entidade: 'processo',
    entidadeId: primeiro.id,
    acao: 'criar',
    descricao: `${criados.length} processos criados em lote (${ordenados.map((p) => `#${p.numero}`).join(', ')})`,
    dados: { total: criados.length, numeros: ordenados.map((p) => p.numero) },
  })

  revalidatePath('/recebimento/processos')
  return { ok: true, id: primeiro.id, total: criados.length }
}
