import QRCode from 'qrcode'

/** O QR como PNG (bytes), pronto para anexar. Margem de 2 módulos e 360 px: legível na tela do celular. */
export async function gerarQrPng(texto: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(texto, { type: 'png', margin: 2, width: 360, errorCorrectionLevel: 'M' })
  return new Uint8Array(buffer)
}

/**
 * O mesmo QR (margem 2, correção M) como `data:image/png;base64,…`, para ir embutido num `<img>` sem
 * requisição extra — é o que a página do tablet do Almoxarifado (/quiosque/fichas) usa.
 */
export async function gerarQrDataUrl(texto: string, largura = 300): Promise<string> {
  return QRCode.toDataURL(texto, { type: 'image/png', margin: 2, width: largura, errorCorrectionLevel: 'M' })
}
