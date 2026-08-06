import { serieDentroDaFaixa } from './serie'

export interface DefeitoCatalogo { codigo: string; tipo: number }
export type AcaoLancamento =
  | { tipo: 'aprovado' }
  | { tipo: 'reprovado'; codigo: string }
  | { tipo: 'invalido' }

export const DEFEITOS_SPI: DefeitoCatalogo[] = [
  { codigo: 'FALTA DE SOLDA', tipo: 1 },
  { codigo: 'INSUFICIÊNCIA DE SOLDA', tipo: 1 },
  { codigo: 'EXAGERO DE SOLDA', tipo: 1 },
  { codigo: 'CURTO', tipo: 1 },
]

export function defeitosDoPosto(perfilChave: string, catalogo: DefeitoCatalogo[]): DefeitoCatalogo[] {
  return perfilChave === 'spi' ? DEFEITOS_SPI : catalogo
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Decide o status pelo que foi bipado: defeito do catálogo → reprovado; SN na faixa → aprovado; senão inválido. */
export function classificarAcao(
  valor: string, defeitos: DefeitoCatalogo[], snIni: string, snFim: string,
): AcaoLancamento {
  const alvo = norm(valor)
  if (alvo === '') return { tipo: 'invalido' }
  const def = defeitos.find((d) => norm(d.codigo) === alvo)
  if (def) return { tipo: 'reprovado', codigo: def.codigo }
  if (snIni.trim() !== '' && snFim.trim() !== '' && serieDentroDaFaixa(snIni, snFim, valor)) {
    return { tipo: 'aprovado' }
  }
  return { tipo: 'invalido' }
}
