import QRCode from 'qrcode'

/** O QR como PNG (bytes), pronto para anexar. Margem de 2 módulos e 360 px: legível na tela do celular. */
export async function gerarQrPng(texto: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(texto, { type: 'png', margin: 2, width: 360, errorCorrectionLevel: 'M' })
  return new Uint8Array(buffer)
}
