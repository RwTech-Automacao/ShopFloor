import { converterValor } from '../domain/conversao'
import { calcularCamposCalculados, type CampoCalc, type FaixaNqa } from '../domain/calculos'
import type { CampoFormulario } from '../infra/processo-detalhe-repository'

export interface DepsCalculoProcesso {
  fornecedoresCriticos: string[]
  nqa: FaixaNqa[]
  usuarioAtual: string
}

export type ResultadoPreparar =
  | { ok: true; valores: Record<string, string | number | null>; camposAlterados: string[] }
  | { ok: false; erro: string }

const GRUPOS_BASE = new Set<CampoFormulario['grupo']>(['comercial', 'material'])

/**
 * Valida (obrigatórios + listas), converte e computa os campos calculados de um
 * processo a partir dos valores de Comercial + Material. Puro (sem I/O): recebe
 * os campos e as dependências já carregadas. Usado na criação individual e em
 * cada linha do lote coletivo — é a única fonte dessa regra (não duplicar).
 */
export function prepararValoresProcesso(
  campos: CampoFormulario[],
  itensPorLista: Record<string, string[]>,
  deps: DepsCalculoProcesso,
  valores: Record<string, unknown>,
): ResultadoPreparar {
  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []

  for (const campo of campos) {
    if (!GRUPOS_BASE.has(campo.grupo)) continue // recebimento/qualidade: em branco
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

  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))
  const calculados = calcularCamposCalculados(novosValores, camposCalculados, {
    fornecedoresCriticos: deps.fornecedoresCriticos,
    nqa: deps.nqa,
    usuarioAtual: deps.usuarioAtual,
    valoresAtuais: {}, // processo novo: sem valores anteriores
  })
  for (const [campo, valor] of Object.entries(calculados)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
  }

  return { ok: true, valores: novosValores, camposAlterados }
}
