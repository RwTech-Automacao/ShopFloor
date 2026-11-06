/**
 * Configuração da integração com o Compels, lida do ambiente (nunca do código).
 * Rota do token: login no ezpointweb → token do ezpointweb → token do Compels (spec 16/10/2026, §3.4).
 */
import type { EstoqueDestino } from '../domain/estoque-destino'

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

/** O EINTER não tem valor padrão: sem as duas variáveis ele NÃO está disponível (a tela só oferece o PA). */
export class EstoqueNaoConfigurado extends Error {
  constructor(faltam: string[]) {
    super(
      faltam.length === 2
        ? 'O estoque EINTER ainda não está configurado neste ambiente (COMPELS_ESTOQUE_EINTER_ID e COMPELS_LOCACAO_EINTER_ID).'
        : `O estoque EINTER está configurado pela metade: falta ${faltam.join(', ')}.`,
    )
    this.name = 'EstoqueNaoConfigurado'
  }
}

/**
 * O destino do EINTER, ou `null` quando NENHUMA das duas variáveis foi posta (funcionalidade dormente).
 * Uma só das duas = erro (`EstoqueNaoConfigurado`): meio configurado gravaria no estoque errado do ERP.
 * Valor que não é inteiro positivo = erro, como no PA.
 */
function einterDoAmbiente(env: Record<string, string | undefined>): DestinoConfig | null {
  const estoque = env.COMPELS_ESTOQUE_EINTER_ID?.trim()
  const locacao = env.COMPELS_LOCACAO_EINTER_ID?.trim()
  if (!estoque && !locacao) return null
  const faltam: string[] = []
  if (!estoque) faltam.push('COMPELS_ESTOQUE_EINTER_ID')
  if (!locacao) faltam.push('COMPELS_LOCACAO_EINTER_ID')
  if (faltam.length > 0) throw new EstoqueNaoConfigurado(faltam)
  return {
    estoqueId: inteiroPositivo(estoque, 0, 'COMPELS_ESTOQUE_EINTER_ID'),
    locacaoId: inteiroPositivo(locacao, 0, 'COMPELS_LOCACAO_EINTER_ID'),
  }
}

/** O EINTER está pronto para uso neste ambiente? (Configuração incompleta ou inválida = não.) */
export function einterConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return einterDoAmbiente(env) !== null
  } catch {
    return false
  }
}

/**
 * Estoque e locação do ERP para o estoque escolhido. PA = o de sempre (`destinoDoAmbiente`, 217/5314 por
 * padrão). EINTER = só as variáveis próprias, sem padrão; sem elas, `EstoqueNaoConfigurado`.
 */
export function destinoDoEstoque(
  estoque: EstoqueDestino,
  env: Record<string, string | undefined> = process.env,
): DestinoConfig {
  if (estoque === 'PA') return destinoDoAmbiente(env)
  const einter = einterDoAmbiente(env)
  if (!einter) throw new EstoqueNaoConfigurado(['COMPELS_ESTOQUE_EINTER_ID', 'COMPELS_LOCACAO_EINTER_ID'])
  return einter
}
