import { lerCsv } from './csv'
import { chaveDoNs, normalizarNs, nsDaCelula } from './numero-serie'

/**
 * Leitura da planilha "Peças em garantia" (spec 2026-11-17-sat-entrada-design.md, decisões 3 e 4). Cada aba é
 * baixada como CSV; o cabeçalho fica na linha 1 ou 2 e os nomes das colunas mudam de aba para aba, então as
 * colunas são achadas por apelido (sem acento, sem maiúscula). Uma linha da planilha = uma peça.
 */
export interface AbaPlanilha {
  gid: string
  nome: string
}

export interface LinhaPlanilha {
  aba: string
  /** Linha na planilha (1 = a primeira). */
  linha: number
  /** `aaaa-mm-dd`, ou null se a célula não é uma data. */
  data: string | null
  tecnico: string
  cliente: string
  equipamento: string
  /** A célula do NS como está (pode ter vários). */
  ns: string
  garantia: string
  primeiroRegistro: string
  defeito: string
  observacao: string
  quantidade: number | null
  codigoPeca: string
  peca: string
  os: string
  solucao: string
  vendedor: string
}

export class FormatoDaAbaInesperado extends Error {
  constructor(aba: string) {
    super(`A aba "${aba}" não tem o cabeçalho esperado (EQUIPAMENTO e PEÇA nas 3 primeiras linhas).`)
    this.name = 'FormatoDaAbaInesperado'
  }
}

type Campo = Exclude<keyof LinhaPlanilha, 'aba' | 'linha'>

/** Sem acento, maiúsculo, sem `?`, espaços e quebras de linha num espaço só. */
const nomeColuna = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\?/g, '').replace(/\s+/g, ' ').trim()

const COLUNAS: [Campo, (nome: string) => boolean][] = [
  ['data', (n) => n === 'DATA' || n === 'DATA DO ENVIO'],
  ['tecnico', (n) => n === 'TECNICO' || n === 'SOLICITANTE'],
  ['cliente', (n) => n === 'CLIENTE'],
  ['equipamento', (n) => n === 'EQUIPAMENTO'],
  ['ns', (n) => n === 'NS' || n === 'NUMERO DE SERIE'],
  ['garantia', (n) => n.startsWith('GARANTIA')],
  ['primeiroRegistro', (n) => n === 'PRIMEIRO REGISTRO'],
  ['defeito', (n) => n === 'DEFEITO'],
  ['observacao', (n) => n === 'ALGUMA OBSERVACAO' || n === 'OBSERVACAO'],
  ['quantidade', (n) => n === 'QTD'],
  ['codigoPeca', (n) => n === 'CODIGO DA PECA'],
  ['peca', (n) => n === 'PECA'],
  ['os', (n) => n === 'OS' || n.startsWith('NUMERO DO CHAMADO')],
  ['solucao', (n) => n === 'SOLUCAO'],
  ['vendedor', (n) => n === 'VENDEDOR' || n === 'VENDEDOR RESPONSAVEL'],
]

/** `d/m/aaaa[ hh:mm:ss]` (ou `aaaa-mm-dd`) → `aaaa-mm-dd`; o resto → null. */
export function dataDaCelula(celula: string): string | null {
  const t = celula.trim()
  let a: number, m: number, d: number
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s|$)/.exec(t)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (br) {
    d = Number(br[1]); m = Number(br[2]); a = Number(br[3]!.length === 2 ? `20${br[3]}` : br[3])
  } else if (iso) {
    a = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3])
  } else return null
  const dt = new Date(Date.UTC(a, m - 1, d))
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

function quantidadeDaCelula(celula: string): number | null {
  const t = celula.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function lerAba(csv: string, aba: AbaPlanilha): LinhaPlanilha[] {
  const linhas = lerCsv(csv)
  const iCab = linhas.slice(0, 3).findIndex((l) => {
    const nomes = l.map(nomeColuna)
    return nomes.includes('EQUIPAMENTO') && nomes.includes('PECA')
  })
  if (iCab < 0) throw new FormatoDaAbaInesperado(aba.nome)

  const indice = new Map<Campo, number>()
  linhas[iCab]!.forEach((cab, i) => {
    const n = nomeColuna(cab)
    const achado = COLUNAS.find(([campo, casa]) => !indice.has(campo) && casa(n))
    if (achado) indice.set(achado[0], i)
  })

  const saida: LinhaPlanilha[] = []
  for (let i = iCab + 1; i < linhas.length; i++) {
    const cel = (c: Campo) => {
      const j = indice.get(c)
      return j === undefined ? '' : (linhas[i]![j] ?? '').trim()
    }
    if (COLUNAS.every(([c]) => cel(c) === '')) continue
    saida.push({
      aba: aba.nome,
      linha: i + 1,
      data: dataDaCelula(cel('data')),
      tecnico: cel('tecnico'),
      cliente: cel('cliente'),
      equipamento: cel('equipamento'),
      ns: cel('ns'),
      garantia: cel('garantia').replace(/\s+/g, ' '),
      primeiroRegistro: cel('primeiroRegistro'),
      defeito: cel('defeito'),
      observacao: cel('observacao'),
      quantidade: quantidadeDaCelula(cel('quantidade')),
      codigoPeca: cel('codigoPeca'),
      peca: cel('peca'),
      os: cel('os'),
      solucao: cel('solucao'),
      vendedor: cel('vendedor'),
    })
  }
  return saida
}

export interface ItemOs {
  /** NS + peça + data: a mesma peça repetida em duas abas grava uma vez. */
  chave: string
  nsEscrito: string
  modelo: string | null
  sequencia: string | null
  codigoPeca: string
  peca: string
  quantidade: number | null
  data: string | null
}

export interface OsPlanilha {
  /** Nº da OS; sem número = `sem-os|data|cliente|equipamento`. */
  chave: string
  numero: string
  data: string | null
  tecnico: string
  cliente: string
  equipamento: string
  garantia: string
  primeiroRegistro: string
  defeito: string
  observacao: string
  solucao: string
  vendedor: string
  /** Aba e linha onde a OS apareceu primeiro (na ordem de prioridade). */
  aba: string
  linha: number
  itens: ItemOs[]
}

const CAMPOS_OS = ['tecnico', 'cliente', 'equipamento', 'garantia', 'primeiroRegistro', 'defeito', 'observacao',
  'solucao', 'vendedor'] as const

const espacos = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * Junta as linhas (já na ordem de prioridade das abas) em OS: os campos da OS vêm do primeiro valor não vazio;
 * a data é a mais antiga; os itens são um por NS × peça, sem repetir a mesma chave.
 */
export function montarOs(linhas: LinhaPlanilha[]): OsPlanilha[] {
  const porChave = new Map<string, OsPlanilha>()
  const chavesDosItens = new Map<string, Set<string>>()

  for (const l of linhas) {
    const numero = espacos(l.os)
    const chave = numero !== ''
      ? numero.toUpperCase()
      : `sem-os|${l.data ?? ''}|${espacos(l.cliente).toUpperCase()}|${espacos(l.equipamento).toUpperCase()}`
    let os = porChave.get(chave)
    if (!os) {
      os = {
        chave, numero, data: l.data, tecnico: l.tecnico, cliente: l.cliente, equipamento: l.equipamento,
        garantia: l.garantia, primeiroRegistro: l.primeiroRegistro, defeito: l.defeito, observacao: l.observacao,
        solucao: l.solucao, vendedor: l.vendedor, aba: l.aba, linha: l.linha, itens: [],
      }
      porChave.set(chave, os)
      chavesDosItens.set(chave, new Set())
    } else {
      for (const c of CAMPOS_OS) if (os[c] === '' && l[c] !== '') os[c] = l[c]
      if (l.data && (!os.data || l.data < os.data)) os.data = l.data
    }

    const vistos = chavesDosItens.get(chave)!
    const nss = nsDaCelula(l.ns)
    const peca = espacos(l.codigoPeca).toUpperCase() || `peca:${espacos(l.peca).toUpperCase()}`
    for (const escrito of nss.length > 0 ? nss : ['']) {
      const ns = normalizarNs(escrito)
      const chaveItem = `${chaveDoNs(ns)}|${peca}|${l.data ?? ''}`
      if (vistos.has(chaveItem)) continue
      vistos.add(chaveItem)
      os.itens.push({
        chave: chaveItem, nsEscrito: ns.escrito, modelo: ns.modelo, sequencia: ns.sequencia,
        codigoPeca: l.codigoPeca, peca: l.peca, quantidade: l.quantidade, data: l.data,
      })
    }
  }
  return [...porChave.values()]
}
