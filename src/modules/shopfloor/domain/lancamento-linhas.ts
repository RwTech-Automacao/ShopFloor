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
