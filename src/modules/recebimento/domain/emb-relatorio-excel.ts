import type { RelatorioEmb } from './emb-relatorio'

/**
 * A divergência como número. O banco guarda texto ('-10', '5' e, de digitação antiga, '-2,5'):
 * vírgula decimal vira ponto, igual ao `temDivergencia`. Vazio ou texto que não é número: null.
 */
export function valorDaDivergencia(texto: string): number | null {
  const t = texto.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Recebeu MENOS que o pedido (divergência negativa): a tela pinta de vermelho. */
export function divergenciaNegativa(texto: string): boolean {
  const n = valorDaDivergencia(texto)
  return n !== null && n < 0
}

export type CelulaPlanilha = string | number | null

export interface PlanilhaDivergencias {
  nomeArquivo: string
  nomeAba: string
  linhas: CelulaPlanilha[][]
}

export const CABECALHO_DIVERGENCIAS = [
  'Processo', 'Item', 'Descrição', 'Qtd pedido', 'Qtd recebida', 'Divergência', 'Justificativa', 'Justificado por',
] as const

// Caracteres que o Windows não aceita em nome de arquivo e o Excel não aceita em nome de aba.
const PROIBIDOS_ARQUIVO = /[\\/:*?"<>|]/g
const PROIBIDOS_ABA = /[\\/:*?[\]]/g

/**
 * A planilha das divergências do relatório de uma EMB: duas linhas de identificação (EMB e Nº da PO),
 * uma em branco, o cabeçalho e uma linha por divergência, na ordem da tela. Quantidades e divergência
 * saem como NÚMERO (não texto formatado), para o Excel somar e filtrar; o que falta sai como célula vazia.
 * Divergência que não é número sai como o texto do banco.
 */
export function planilhaDivergencias(r: RelatorioEmb): PlanilhaDivergencias {
  const emb = r.emb.trim()
  const base = emb.replace(PROIBIDOS_ARQUIVO, '-') || 'EMB'
  const aba = emb.replace(PROIBIDOS_ABA, '-').slice(0, 31) || 'Divergências'
  return {
    nomeArquivo: `${base}-divergencias.xlsx`,
    nomeAba: aba,
    linhas: [
      ['EMB', emb],
      ['Nº da PO', r.pedidos.join(', ')],
      [],
      [...CABECALHO_DIVERGENCIAS],
      ...r.divergencias.map((d) => [
        d.numero,
        d.item,
        d.descricao,
        d.quantidadePedido,
        d.quantidadeRecebida,
        valorDaDivergencia(d.divergencia) ?? (d.divergencia.trim() || null),
        d.justificativa.trim(),
        d.justificativa.trim() === '' ? '' : d.justificadaPorNome,
      ]),
    ],
  }
}
