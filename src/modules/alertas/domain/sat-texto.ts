import { mensagemMudancaNf, mensagemNota } from '@/modules/sat/domain/mensagens'
import type { SituacaoNf } from '@/modules/sat/domain/entrada'

/** A frase da coluna "Janela" da lista de regras. A regra de entrada no SAT não tem janela: tem um gatilho. */
export const JANELA_SAT = 'Quando uma NF entra ou muda no SAT'

/** A frase da coluna "Limite". */
export const LIMITE_SAT = 'Um aviso por NF registrada, corrigida ou trocada'

/** O que vem de um evento do histórico da nota (`alerta_sat_eventos`, 0192), já lido do `dados` da fila. */
export interface EventoSat {
  evento: 'entrada' | 'correcao' | 'troca'
  numeroDe: string
  numeroPara: string
  empresa: string
  cnpj: string
  situacaoDe: SituacaoNf | null
  situacaoPara: SituacaoNf
  motivos: string[]
  ns: string[]
}

/**
 * O texto do aviso de entrada no SAT. É EXATAMENTE o de antes (o aviso direto no Discord, decisão 3 da spec de
 * 2026-11-18): a NF registrada sai como `mensagemNota`; a correção e a troca, como `mensagemMudancaNf`. O texto
 * mora no módulo do SAT — aqui só se escolhe qual dos dois.
 */
export function textoSat(e: EventoSat): string {
  if (e.evento === 'entrada') {
    return mensagemNota({
      numero: e.numeroPara, empresa: e.empresa, cnpj: e.cnpj, situacao: e.situacaoPara, motivos: e.motivos, ns: e.ns,
    })
  }
  return mensagemMudancaNf({
    tipo: e.evento, numeroDe: e.numeroDe, numeroPara: e.numeroPara, empresa: e.empresa, cnpj: e.cnpj,
    // A correção e a troca sempre têm o "de" (o histórico grava); sem ele, o texto mostra a mesma situação.
    situacaoDe: e.situacaoDe ?? e.situacaoPara, situacaoPara: e.situacaoPara, motivos: e.motivos, ns: e.ns,
  })
}
