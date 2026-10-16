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
