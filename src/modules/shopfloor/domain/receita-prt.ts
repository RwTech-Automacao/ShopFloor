/**
 * RECEITA DA INTEGRAÇÃO COM PRT DA ESTRUTURA (0195). A receita de um posto de Integração pode citar, além das PMOs, as
 * PRTs da própria OP cadastradas com série própria (trecho 'prt', sn_modo 'proprio'). O bipe aceita a placa da própria
 * OP que já terminou o trecho daquela PRT; quem confere é a sf_integrar.
 */
import type { TrechoCadastro } from './cadastro-op'

const norm = (s: string) => s.trim().toUpperCase()

type TrechoReceita = Pick<TrechoCadastro, 'tipo' | 'codigo' | 'snModo'>

/** Os códigos das PRTs da OP que podem entrar na receita: só as de série própria, na ordem dos trechos, sem repetir. */
export function prtsDeSeriePropria(trechos: TrechoReceita[]): string[] {
  const out: string[] = []
  for (const t of trechos) {
    if (t.tipo !== 'prt' || t.snModo !== 'proprio') continue
    const c = t.codigo.trim()
    if (c !== '' && !out.some((x) => norm(x) === norm(c))) out.push(c)
  }
  return out
}

/** Os códigos de todas as PRTs dos trechos (qualquer série). */
export function codigosPrt(trechos: TrechoReceita[]): string[] {
  return trechos.filter((t) => t.tipo === 'prt').map((t) => t.codigo.trim()).filter((c) => c !== '')
}

/**
 * Tira da receita as PRTs que não podem mais estar nela (a gravação as recusaria, RECEITA_PRT_INVALIDA):
 * - a PRT da OP que agora tem a mesma série da PMO;
 * - a PRT que saiu da estrutura: um código de `conhecidas` (PRTs que a tela já viu nesta OP) que não é mais PRT de
 *   série própria dela.
 * Nunca sai um código que é também a PMO de uma OP cadastrada (`pmosValidas`): ele segue valendo como PMO (a OP
 * separada da PRT), no banco e no bipe. O resto da receita não muda. `removidas`: os códigos tirados, sem repetir.
 */
export function limparReceitaPrt(
  receita: Record<string, string[]>,
  trechos: TrechoReceita[],
  conhecidas: string[] = [],
  pmosValidas: string[] = [],
): { receita: Record<string, string[]>; removidas: string[] } {
  const validas = new Set(prtsDeSeriePropria(trechos).map(norm))
  const prtsDaOp = new Set(codigosPrt(trechos).map(norm))
  const vistas = new Set(conhecidas.map(norm))
  const pmos = new Set(pmosValidas.map(norm))
  const sai = (c: string) => {
    const k = norm(c)
    if (validas.has(k) || pmos.has(k)) return false
    return prtsDaOp.has(k) || vistas.has(k)
  }
  const removidas: string[] = []
  const out: Record<string, string[]> = {}
  for (const [posto, lista] of Object.entries(receita)) {
    out[posto] = lista.filter((c) => {
      if (!sai(c)) return true
      if (!removidas.some((x) => norm(x) === norm(c))) removidas.push(c.trim())
      return false
    })
  }
  return { receita: removidas.length > 0 ? out : receita, removidas }
}

/** O aviso na tela quando o salvar tirou PRTs da receita. */
export function avisoReceitaPrtLimpa(removidas: string[]): string | null {
  if (removidas.length === 0) return null
  const lista = removidas.join(', ')
  return removidas.length === 1
    ? `${lista} saiu da receita da Integração: ela não é mais uma PRT de série própria desta OP.`
    : `${lista} saíram da receita da Integração: elas não são mais PRTs de série própria desta OP.`
}

/** A recusa do bipe da Integração (PLACA_PRT_INCOMPLETA, 0195): a placa ainda não terminou o trecho da PRT. */
export function mensagemPlacaPrtIncompleta(sn: string, prt: string, posto: string): string {
  return `A placa ${sn} ainda não terminou a ${prt} (falta o posto ${posto}).`
}
