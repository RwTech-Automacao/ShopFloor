/**
 * Anexo de uma mensagem de alerta. Hoje só o Discord anexa (o QR da ficha de apontamento); os outros
 * canais ignoram a lista e mandam só o texto.
 */
export interface AnexoEnvio {
  /** Nome do arquivo como o Discord o mostra. */
  nome: string
  /** Tipo MIME, ex.: `image/png`. */
  tipo: string
  bytes: Uint8Array
}

/**
 * O texto que vira QR, ou null. Um envio pede o QR guardando `qr` nos `dados` (o código que o
 * Almoxarifado bipa: `CX[…]` da caixa ou `LOTE[…][N]` do lote). Vazio, só espaços ou tipo errado = sem QR.
 */
export function qrDoEnvio(dados: Record<string, unknown>): string | null {
  const v = dados.qr
  if (typeof v !== 'string') return null
  const texto = v.trim()
  return texto === '' ? null : texto
}

/** Nome de arquivo seguro para o QR: só letras, números, `_` e `-`; o resto vira hífen. */
export function nomeDoQr(texto: string): string {
  const base = texto.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return base === '' ? 'qr.png' : `qr-${base}.png`
}
