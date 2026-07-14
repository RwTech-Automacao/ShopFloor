// Validação pura de arquivos de imagem para anexo (sem I/O). Usada
// autoritativamente pela Server Action de upload.

const MIME_EXTENSAO: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Extensão de arquivo para um mime de imagem suportado, ou null se não suportado. */
export function extensaoDoMime(mime: string): 'jpg' | 'png' | 'webp' | null {
  return MIME_EXTENSAO[mime] ?? null
}

/** Teto defensivo de tamanho no servidor (o cliente já comprime para ~1 MB). */
export const TAMANHO_MAX_ANEXO = 5 * 1024 * 1024 // 5 MB

export type ResultadoValidacaoArquivo = { ok: true } | { ok: false; erro: string }

/** Valida tipo (imagem suportada) e tamanho de um arquivo de anexo. */
export function validarArquivoImagem(mime: string, tamanho: number): ResultadoValidacaoArquivo {
  if (extensaoDoMime(mime) === null) {
    return { ok: false, erro: 'Formato não suportado (use JPEG, PNG ou WebP).' }
  }
  if (tamanho <= 0) {
    return { ok: false, erro: 'Arquivo vazio.' }
  }
  if (tamanho > TAMANHO_MAX_ANEXO) {
    return { ok: false, erro: 'Arquivo muito grande (máx. 5 MB).' }
  }
  return { ok: true }
}

/** Sanitiza um trecho para uso em nome de arquivo: sem acentos, sem caracteres
 *  inválidos, espaços/símbolos viram '-', sem '-' repetido nem nas pontas. */
function sanitizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (acentos)
    .replace(/[\/\\:*?"<>|\s]+/g, '-') // caracteres inválidos de arquivo + espaços → '-'
    .replace(/-+/g, '-') // colapsa '-' repetidos
    .replace(/^-+|-+$/g, '') // apara '-' das pontas
}

/**
 * Nome do arquivo de uma foto no ZIP de export:
 * `{pedido}-{item}-p{numero}-{indice}.{ext}`. Usa `p{numero}` como fallback
 * quando `pedido` ou `item` fica vazio após sanitizar. A unicidade é garantida
 * pelo `numero` do processo + `indice`.
 */
export function nomeArquivoFoto(
  pedido: string,
  item: string,
  numero: number,
  indice: number,
  ext: string,
): string {
  const pedidoSan = sanitizarNome(pedido) || `p${numero}`
  const itemSan = sanitizarNome(item) || `p${numero}`
  return `${pedidoSan}-${itemSan}-p${numero}-${indice}.${ext}`
}
