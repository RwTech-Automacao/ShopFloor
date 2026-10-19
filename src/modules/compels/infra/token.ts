import { expiracaoDoJwt } from '../domain/jwt'
import type { ConfigCompels } from './config'

export type FetchFn = typeof fetch

/** Falha ao obter o token. Nunca carrega senha nem token na mensagem. */
export class ErroDeLogin extends Error {
  constructor(etapa: 'login' | 'token', status: number | null) {
    super(
      status === null
        ? `Sem conexão com o ezpointweb (${etapa}).`
        : `O ezpointweb recusou o ${etapa === 'login' ? 'login' : 'pedido do token do Compels'} (HTTP ${status}).`,
    )
    this.name = 'ErroDeLogin'
  }
}

const MARGEM_MS = 5 * 60 * 1000
const VALIDADE_PADRAO_MS = 30 * 60 * 1000

/** Guarda o token do Compels em memória e o renova antes de vencer, ou quando o ERP responde 401. */
export class GerenciadorToken {
  private token: string | null = null
  private venceEm = 0

  constructor(
    private readonly config: ConfigCompels,
    private readonly buscar: FetchFn = fetch,
    private readonly agora: () => number = Date.now,
  ) {}

  invalidar(): void {
    this.token = null
    this.venceEm = 0
  }

  async obter(): Promise<string> {
    if (this.token && this.agora() < this.venceEm - MARGEM_MS) return this.token

    const tokenEzpoint = await this.loginEzpoint()
    const tokenCompels = await this.tokenDoCompels(tokenEzpoint)
    this.token = tokenCompels
    this.venceEm = expiracaoDoJwt(tokenCompels) ?? this.agora() + VALIDADE_PADRAO_MS
    return tokenCompels
  }

  private async chamar(etapa: 'login' | 'token', url: string, init: RequestInit): Promise<unknown> {
    let r: Response
    try {
      r = await this.buscar(url, { ...init, signal: AbortSignal.timeout(30_000) })
    } catch {
      throw new ErroDeLogin(etapa, null)
    }
    if (!r.ok) throw new ErroDeLogin(etapa, r.status)
    try {
      return await r.json()
    } catch {
      throw new ErroDeLogin(etapa, r.status)
    }
  }

  private async loginEzpoint(): Promise<string> {
    const corpo = await this.chamar('login', `${this.config.ezpointUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: this.config.ezpointUsuario, senha: this.config.ezpointSenha }),
    })
    const token = (corpo as { token?: unknown } | null)?.token
    if (typeof token !== 'string' || token === '') throw new ErroDeLogin('login', 200)
    return token
  }

  private async tokenDoCompels(tokenEzpoint: string): Promise<string> {
    const corpo = await this.chamar(
      'token',
      `${this.config.ezpointUrl}/getCompelsToken?empresa=${encodeURIComponent(this.config.empresa)}`,
      { headers: { Authorization: `Bearer ${tokenEzpoint}` } },
    )
    const token = (corpo as { token?: unknown } | null)?.token
    if (typeof token !== 'string' || token === '') throw new ErroDeLogin('token', 200)
    return token
  }
}
