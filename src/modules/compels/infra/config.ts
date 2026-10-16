/**
 * Configuração da integração com o Compels, lida do ambiente (nunca do código).
 * Rota do token: login no ezpointweb → token do ezpointweb → token do Compels (spec 16/10/2026, §3.4).
 */
export interface ConfigCompels {
  ezpointUrl: string
  ezpointUsuario: string
  ezpointSenha: string
  /** Empresa pedida ao ezpointweb em `getCompelsToken`. */
  empresa: string
  apiUrl: string
}

export class ConfiguracaoIncompleta extends Error {
  constructor(faltam: string[]) {
    super(`Faltam variáveis de ambiente do Compels: ${faltam.join(', ')}.`)
    this.name = 'ConfiguracaoIncompleta'
  }
}

export function configDoAmbiente(env: Record<string, string | undefined> = process.env): ConfigCompels {
  const usuario = env.COMPELS_EZPOINT_USUARIO?.trim()
  const senha = env.COMPELS_EZPOINT_SENHA
  const faltam: string[] = []
  if (!usuario) faltam.push('COMPELS_EZPOINT_USUARIO')
  if (!senha) faltam.push('COMPELS_EZPOINT_SENHA')
  if (faltam.length > 0 || !usuario || !senha) throw new ConfiguracaoIncompleta(faltam)

  return {
    ezpointUrl: (env.COMPELS_EZPOINT_URL?.trim() || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, ''),
    ezpointUsuario: usuario,
    ezpointSenha: senha,
    empresa: env.COMPELS_EZPOINT_EMPRESA?.trim() || 'enterplak',
    apiUrl: (env.COMPELS_API_URL?.trim() || 'https://api.erpeasy.compels.net').replace(/\/$/, ''),
  }
}

/** Estoque e locação onde o apontamento dá entrada do produto acabado (estoque 217 `PA`, locação 5314 `Padrão`). */
export interface DestinoConfig {
  estoqueId: number
  locacaoId: number
}

function inteiroPositivo(valor: string | undefined, padrao: number, nome: string): number {
  const texto = valor?.trim()
  if (!texto) return padrao
  const n = Number(texto)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nome} precisa ser um número inteiro positivo.`)
  return n
}

export function destinoDoAmbiente(env: Record<string, string | undefined> = process.env): DestinoConfig {
  return {
    estoqueId: inteiroPositivo(env.COMPELS_ESTOQUE_ID, 217, 'COMPELS_ESTOQUE_ID'),
    locacaoId: inteiroPositivo(env.COMPELS_LOCACAO_ID, 5314, 'COMPELS_LOCACAO_ID'),
  }
}
