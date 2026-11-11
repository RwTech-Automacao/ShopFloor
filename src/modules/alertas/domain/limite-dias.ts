import { LIMITE_HORAS_MAX } from './regra'

/**
 * O limite do "Parado ou travado na produção" é DIGITADO EM DIAS, mas continua GRAVADO EM HORAS
 * (`alerta_regras.limite_horas`, dias × 24): o banco, o avaliador e a validação do servidor não
 * mudam. A conversão é só da tela.
 */
export const LIMITE_DIAS_MAX = LIMITE_HORAS_MAX / 24

/**
 * O que o campo em dias mostra ao abrir a regra. Um valor salvo que não fecha em dias (regra antiga,
 * digitada em horas) abre ARREDONDADO PARA CIMA — nunca avisa antes do que o gestor pediu — e
 * `horasArredondadas` traz as horas salvas, para a tela avisar que salvar muda o limite.
 */
export function diasIniciaisDoLimite(horas: number): { dias: string; horasArredondadas: number | null } {
  const dias = Math.max(1, Math.ceil(horas / 24))
  return { dias: String(dias), horasArredondadas: horas % 24 === 0 ? null : horas }
}

/** Dias digitados -> horas a gravar. null = não é inteiro de 1 a LIMITE_DIAS_MAX. */
export function horasDoLimiteEmDias(texto: string): number | null {
  const t = texto.trim()
  if (!/^\d+$/.test(t)) return null
  const dias = Number(t)
  if (dias < 1 || dias > LIMITE_DIAS_MAX) return null
  return dias * 24
}
