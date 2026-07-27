/** Postos que gravam status aprovado/reprovado (inspeções e testes). */
export const POSTOS_COM_STATUS = [
  'Inspeção SPI',
  'Inspeção SMD',
  'Inspeção PTH',
  'Teste',
  'Burn-in',
  'Teste Final',
  'Inspeção Final',
  'Inspeção NQA',
] as const

export function postoTemStatus(posto: string): boolean {
  return POSTOS_COM_STATUS.some((p) => p.toLowerCase() === posto.toLowerCase())
}

/** Postos onde o gate de sequência basta estar REGISTRADO (não exige aprovado). */
export const POSTOS_SO_REGISTRADO = ['inicial', 'montagem pth', 'integração', 'integracao', 'embalagem', 'extra máquina']

/** Modo do gate de sequência: false = basta registrado; true = exige aprovado. */
export function precisaAprovado(posto: string): boolean {
  return !POSTOS_SO_REGISTRADO.includes(posto.toLowerCase())
}

/** Postos cuja reprova exige passar pela Manutenção antes do re-lançamento. */
export const POSTOS_REPARO_VIA_MANUTENCAO = ['teste', 'burn-in', 'teste final']

export function exigeManutencao(posto: string): boolean {
  return POSTOS_REPARO_VIA_MANUTENCAO.includes(posto.toLowerCase())
}

export interface LinhaDefeito {
  codigo_defeito: string
  posicao: string
  tipo_defeito: string
}

export interface DadosLinhas {
  status?: string
  defeitos?: { codigo: string; posicao: string; tipo: string }[]
  posicoes?: string[]
}

/** Expande o lançamento em linhas: 1 por defeito; SPI reprovado → 1 por posição; senão vazio (1 linha base). */
export function montarLinhas(posto: string, dados: DadosLinhas): LinhaDefeito[] {
  const reprovado = (dados.status ?? '').toLowerCase() === 'reprovado'
  if (!reprovado) return []
  if (posto.toLowerCase() === 'inspeção spi') {
    return (dados.posicoes ?? [])
      .filter((p) => p.trim() !== '')
      .map((posicao) => ({ codigo_defeito: '', posicao, tipo_defeito: '' }))
  }
  return (dados.defeitos ?? [])
    .filter((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
    .map((d) => ({ codigo_defeito: d.codigo, posicao: d.posicao, tipo_defeito: d.tipo }))
}
