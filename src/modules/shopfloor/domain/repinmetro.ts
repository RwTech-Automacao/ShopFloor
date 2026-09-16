import { normalizarSerie } from './serie'

// Itens de teste do repinmetro (tela Teste Qualidade), na ordem da tela.
// `chave` = nome da coluna de origem (também a chave dentro de `resultados` jsonb do espelho).
export interface ItemRepinmetro {
  chave: string
  rotulo: string
}

export const ITENS_REPINMETRO: ItemRepinmetro[] = [
  { chave: 'statustesterfid', rotulo: 'RFID/Mifare' },
  { chave: 'statustestedigital', rotulo: 'Digital' },
  { chave: 'statustestebarras', rotulo: 'Barras' },
  { chave: 'statustestetecladomatricial', rotulo: 'Teclado' },
  { chave: 'statustesteusbfiscal', rotulo: 'USB Fiscal' },
  { chave: 'statustesteusbnaofiscal', rotulo: 'USB Não Fiscal' },
  { chave: 'statustesteimpressaorim', rotulo: 'Impressão RIM' },
  { chave: 'statustesteimpressaopapel', rotulo: 'Impressão Papel' },
  { chave: 'statustesteinspecaovisual', rotulo: 'Visual' },
  { chave: 'statusaudiorep', rotulo: 'Áudio do REP' },
  { chave: 'statusbloqueiorep', rotulo: 'REP Bloqueado' },
  { chave: 'statusmrp', rotulo: 'MRP' },
  { chave: 'statustestechavecriptografica', rotulo: 'Chave Criptográfica' },
  { chave: 'statuscomunicacao', rotulo: 'Comunicação' },
  { chave: 'statustesteproducao', rotulo: 'Teste Produção' },
]

export type ClasseResultado = 'aprovado' | 'reprovado' | 'na'

/** Classifica o valor bruto do resultado (APROVADO/REPROVADO/NA e variações) pra cor/exibição. */
export function classeResultado(valor: string | null | undefined): ClasseResultado {
  const s = (valor ?? '').trim().toUpperCase()
  if (s.startsWith('APROV')) return 'aprovado'
  if (s.startsWith('REPROV')) return 'reprovado'
  return 'na'
}

/**
 * Chave que liga um teste à revenda do REP: modelo + nº de série normalizado.
 * O serial completo da revenda (00043 + modelo + nº de série) já traz o modelo, então o mesmo SN em
 * modelos diferentes não se mistura. Sem modelo ou sem SN não casa com nada (null).
 */
export function chaveRevenda(modelo: string | null | undefined, numeroSerie: string | null | undefined): string | null {
  const m = (modelo ?? '').trim()
  const sn = normalizarSerie(numeroSerie ?? '')
  return m && sn ? `${m}|${sn}` : null
}
