import { serieDentroDaFaixa } from './serie'

export interface DefeitoCatalogo { codigo: string; tipo: number }
export type AcaoLancamento =
  | { tipo: 'aprovado' }
  | { tipo: 'reprovado'; codigo: string }
  | { tipo: 'invalido' }

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
