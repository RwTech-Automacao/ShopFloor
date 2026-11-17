/** CSV (RFC 4180) como o Google Sheets exporta: aspas, aspas dobradas, quebra de linha dentro de aspas, CRLF. */
export function lerCsv(texto: string): string[][] {
  const s = (texto ?? '').replace(/^﻿/, '')
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += c
      continue
    }
    if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      linha.push(campo); linhas.push(linha); linha = []; campo = ''
    } else campo += c
  }
  if (campo !== '' || linha.length > 0) { linha.push(campo); linhas.push(linha) }
  return linhas
}
