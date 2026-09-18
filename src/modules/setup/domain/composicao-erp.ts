import { contemSeparador, normalizarTexto } from './codigo-rolo'
import type { Processo } from './tipos'

export interface ComponenteLido { componente: string; processo: Processo; linha: number }
export interface IgnoradoLido { linha: number; codigo: string; motivo: string }
export interface ResultadoComposicao {
  pmo: string | null
  componentes: ComponenteLido[]
  ignorados: IgnoradoLido[]
  duplicados: string[]
  erro: string | null
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const chave = (v: unknown) => semAcento(String(v ?? '')).trim().toUpperCase()

/**
 * Lê a composição de produto do ERP (linhas brutas da planilha, `header: 1`).
 * PMO = código do nível 1; entram só linhas com LOCALIZAÇÃO; processo = subconjunto pai
 * "PARTES PTH"/"PARTES SMD" (ancestral mais próximo com nível menor). `linha` é 1-based como no Excel.
 */
export function lerComposicao(linhas: unknown[][]): ResultadoComposicao {
  const vazio: ResultadoComposicao = { pmo: null, componentes: [], ignorados: [], duplicados: [], erro: null }
  const iCab = linhas.findIndex((l) => Array.isArray(l) && l.some((c) => chave(c) === 'NIVEL') && l.some((c) => chave(c) === 'CODIGO ITEM'))
  if (iCab < 0) return { ...vazio, erro: 'Cabeçalho não encontrado (colunas NÍVEL e CÓDIGO ITEM).' }
  const cab = linhas[iCab]!.map(chave)
  const col = { nivel: cab.indexOf('NIVEL'), codigo: cab.indexOf('CODIGO ITEM'), descricao: cab.indexOf('DESCRICAO ITEM'), localizacao: cab.indexOf('LOCALIZACAO') }
  if (col.localizacao < 0) return { ...vazio, erro: 'Coluna LOCALIZAÇÃO não encontrada.' }

  const r: ResultadoComposicao = { ...vazio }
  // pilha de ancestrais: { nivel, processo? }
  const pilha: { nivel: number; processo: Processo | null }[] = []
  const vistos = new Set<string>()

  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i] ?? []
    const nivel = Number(l[col.nivel])
    const codigo = normalizarTexto(String(l[col.codigo] ?? ''))
    if (!Number.isFinite(nivel) || codigo === '') continue
    const descricao = chave(col.descricao >= 0 ? l[col.descricao] : '')
    const localizacao = String(l[col.localizacao] ?? '').trim()
    const numeroLinha = i + 1

    while (pilha.length > 0 && pilha[pilha.length - 1]!.nivel >= nivel) pilha.pop()
    const processoPai = [...pilha].reverse().find((p) => p.processo !== null)?.processo ?? null
    const processoProprio: Processo | null = descricao.startsWith('PARTES PTH') ? 'PTH' : descricao.startsWith('PARTES SMD') ? 'SMD' : null
    pilha.push({ nivel, processo: processoProprio })

    if (nivel === 1) {
      if (r.pmo === null) r.pmo = codigo
      continue
    }
    if (localizacao === '') {
      r.ignorados.push({ linha: numeroLinha, codigo, motivo: 'Sem localização (não é componente de montagem).' })
      continue
    }
    if (processoPai === null) {
      r.ignorados.push({ linha: numeroLinha, codigo, motivo: 'Processo indefinido (fora de PARTES SMD/PTH).' })
      continue
    }
    if (contemSeparador(codigo)) {
      r.ignorados.push({ linha: numeroLinha, codigo, motivo: 'código com separador' })
      continue
    }
    if (vistos.has(codigo)) {
      if (!r.duplicados.includes(codigo)) r.duplicados.push(codigo)
      continue
    }
    vistos.add(codigo)
    r.componentes.push({ componente: codigo, processo: processoPai, linha: numeroLinha })
  }
  if (r.pmo === null) return { ...vazio, erro: 'Não encontrei a PMO (linha de nível 1).' }
  return r
}
