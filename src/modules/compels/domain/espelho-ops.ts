/**
 * ESPELHO DAS OPs ATIVAS DO COMPELS (spec 2026-11-18-cadastro-op-compels-design.md). A lista da tela de OPs
 * (`ordemProducaoSimples/findAllFilter`, HAR 18/11) já traz o código/descrição do produto e a árvore (mãe,
 * principal, nível): o cron grava cada linha em `sf_compels_ops` e o cadastro de OP só lê o espelho.
 */
export const SITUACOES_ATIVAS = ['Aberta', 'Planejada', 'Empenhada', 'Em Processo'] as const

export interface OpEspelhoLida {
  numero: number
  idCompels: number
  codigo: string
  descricao: string
  situacao: string
  nivel: number
  quantidade: number
  quantidadeProduzida: number
  maeNumero: number | null
  principalNumero: number | null
  /** `negociante.codigo` do Compels. */
  cliente: string
  /** AAAA-MM-DD, ou null. */
  dataDocumento: string | null
}

/** Uma OP do espelho como a tela lê de `sf_compels_ops`: + se ainda está na lista de ativas e a hora da leitura. */
export type OpEspelho = OpEspelhoLida & { ativa: boolean; lidoEm: string }

const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000
const dataIso = (ms: number) => new Date(ms).toISOString().slice(0, 10) + 'T00:00:00'
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** O filtro da busca de OP (o mesmo de `ClienteCompels.buscarOp`) sem número, só as situações ativas, último ano. */
export function filtroOpsAtivas(agoraMs: number): Record<string, unknown> {
  return {
    numero: '', codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null,
    clientePedido: '', item: '', linha: '', tipoPropriedade: null, statusList: [...SITUACOES_ATIVAS],
    selecionarPor: 'Data Documento', dataInicial: dataIso(agoraMs - UM_ANO_MS), dataFinal: dataIso(agoraMs),
    numeroPedido: '', centroCusto: '', listarPendentes: false, prototipo: false, etapa: '',
    selecionarOPPor: 'op', observacao: '', nivel: '', responsavelCriacao: '', responsavelAlteracao: '',
    situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
  }
}

function data(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 10)
  return null
}

/** Uma linha da lista → OP do espelho. Sem número, id ou código do produto = null (nunca inventa). */
export function opDaLinhaLista(linha: unknown): OpEspelhoLida | null {
  const l = (linha ?? {}) as Record<string, unknown>
  const item = ((l.composicaoProduto as { item?: Record<string, unknown> } | undefined)?.item ?? {}) as Record<string, unknown>
  const numero = num(l.numero)
  const id = num(l.id)
  const codigo = texto(item.codigo)
  if (numero === null || id === null || codigo === '') return null
  return {
    numero,
    idCompels: id,
    codigo,
    descricao: texto(item.descricao),
    situacao: texto(l.status),
    nivel: num(l.nivel) ?? 1,
    quantidade: num(l.quantidade) ?? 0,
    quantidadeProduzida: num(l.quantidadeProduzida) ?? 0,
    maeNumero: num(l.ordemProducaoMaeNumero),
    principalNumero: num(l.ordemProducaoPrincipalNumero),
    cliente: texto((l.negociante as { codigo?: unknown } | undefined)?.codigo),
    dataDocumento: data(l.dataDocumento),
  }
}
