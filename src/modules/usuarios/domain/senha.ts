/** Alfabeto sem caracteres ambíguos (0/O, 1/l/I) — a temporária é lida e digitada à mão. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** Senha temporária aleatória (crypto), tamanho fixo, alfabeto legível. */
export function gerarSenhaTemporaria(tamanho = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho))
  let saida = ''
  for (let i = 0; i < tamanho; i++) {
    saida += ALFABETO[bytes[i]! % ALFABETO.length]
  }
  return saida
}

/** Regra da senha escolhida pela pessoa: mínimo 8, sem outras exigências. */
export function validarForcaSenha(senha: string): { ok: boolean; erro?: string } {
  if (senha.length < 8) return { ok: false, erro: 'A senha deve ter ao menos 8 caracteres.' }
  return { ok: true }
}
