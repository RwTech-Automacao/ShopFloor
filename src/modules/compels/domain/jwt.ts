/** Instante de expiração (ms) de um JWT, lido do campo `exp`. Não valida assinatura: só serve para renovar o token a tempo. */
export function expiracaoDoJwt(jwt: string): number | null {
  try {
    const carga = jwt.split('.')[1]
    if (!carga) return null
    const dados = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof dados.exp === 'number' && Number.isFinite(dados.exp) ? dados.exp * 1000 : null
  } catch {
    return null
  }
}
