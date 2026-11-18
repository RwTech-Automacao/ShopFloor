/**
 * Número de série do equipamento que chega no SAT (spec 2026-11-17-sat-entrada-design.md, decisão 2).
 *
 * O NS é guardado como foi escrito e normalizado em MODELO + SEQUÊNCIA (os dois sem zeros à esquerda), que é o
 * par usado na busca:
 *   - 17 dígitos, como o repinmetro: `00043` + modelo (5) + sequência (7) → `00043005620019177` = 562/19177;
 *   - o mesmo sem os zeros: `43` + modelo (5) + sequência → `430056219725` = 562/19725;
 *   - modelo e sequência pelo traço: `562 -19177`, `562-15382`;
 *   - só dígitos sem o prefixo 43: só a sequência (sem modelo);
 *   - ilegível (`-`, texto): sem par — a linha é guardada, só não é achada pela busca.
 */
export interface NsNormalizado {
  escrito: string
  modelo: string | null
  sequencia: string | null
}

const semZeros = (s: string) => s.replace(/^0+/, '')

export function normalizarNs(texto: string): NsNormalizado {
  const escrito = (texto ?? '').toString().trim()
  const vazio: NsNormalizado = { escrito, modelo: null, sequencia: null }

  // "562-19177", "562 -19177" — e também "562 19177" / "562.19177" (modelo de 3 dígitos separado por espaço ou
  // ponto, visto em ~9 células da planilha real em 17/11/2026).
  const traco =
    /^\D*?(\d+)\s*-\s*(\d+)\D*$/.exec(escrito) ?? /^\D*?(\d{3})(?:\s+|\s*\.\s*)(\d{3,7})\D*$/.exec(escrito)
  if (traco) {
    const modelo = semZeros(traco[1]!)
    const sequencia = semZeros(traco[2]!)
    if (modelo !== '' && sequencia !== '') return { escrito, modelo, sequencia }
  }

  const digitos = semZeros((escrito.match(/\d+/g) ?? []).join(''))
  if (digitos === '') return vazio
  if (digitos.startsWith('43')) {
    const resto = digitos.slice(2)
    if (resto.length >= 6 && resto.length <= 12) {
      const modelo = semZeros(resto.slice(0, 5))
      const sequencia = semZeros(resto.slice(5))
      if (modelo !== '' && sequencia !== '') return { escrito, modelo, sequencia }
    }
  }
  return { escrito, modelo: null, sequencia: digitos }
}

/**
 * Os NS de uma célula da planilha: separados por espaço, quebra de linha, vírgula, ponto e vírgula ou barra,
 * mantendo `562 -19177` junto. Rótulos sem dígito ("NS:", "e") saem quando a célula tem algum NS; célula só
 * com texto (ou `-`) vira um NS ilegível; célula vazia não tem NS.
 */
export function nsDaCelula(celula: string): string[] {
  const texto = (celula ?? '').toString().trim()
  if (texto === '') return []
  const pedacos = texto.match(/\d+\s*-\s*\d+|(?<!\d)\d{3}(?:\s+|\.)\d{3,7}(?!\d)|[^\s,;/]+/g) ?? []
  const comDigito = pedacos.filter((p) => /\d/.test(p))
  return comDigito.length > 0 ? comDigito : [texto]
}

/** Chave do NS para não gravar a mesma peça duas vezes: o par, a sequência sozinha ou o texto. */
export function chaveDoNs(ns: NsNormalizado): string {
  if (ns.modelo && ns.sequencia) return `${ns.modelo}/${ns.sequencia}`
  if (ns.sequencia) return `seq:${ns.sequencia}`
  return `txt:${ns.escrito.toLowerCase().replace(/\s+/g, ' ')}`
}
