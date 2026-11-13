import 'server-only'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { casarTrechos, type NoArvore } from '../domain/estrutura'
import { copiarParaOp, gravarFilhas, trechosDaOp } from '../infra/estrutura-repository'

export const numeroDaOp = (op: string) => Number(/^(\d+)/.exec(op.trim())?.[1] ?? NaN)

/** Descendentes da OP no Compels (a OP com sufixo _F consulta o número sem sufixo). Aceita um cliente já criado. */
export async function descendentes(op: string, cliente?: ClienteCompels): Promise<NoArvore[]> {
  const n = numeroDaOp(op)
  if (!Number.isInteger(n)) return []
  const c = cliente ?? new ClienteCompels(configDoAmbiente())
  return (await c.lerDescendentes(n)).map(({ numero, codigo, descricao, nivel, mae }) => ({ numero, codigo, descricao, nivel, mae }))
}

const avisoFaltando = (faltando: string[], op: string) =>
  faltando.length === 1
    ? `${faltando[0]} não foi encontrada no Compels abaixo da OP ${numeroDaOp(op)}: esse trecho não será apontado até a OP ser salva de novo.`
    : `${faltando.join(', ')} não foram encontradas no Compels abaixo da OP ${numeroDaOp(op)}: esses trechos não serão apontados até a OP ser salva de novo.`

/**
 * Receita da PMO na OP. A OP guarda a CÓPIA da receita desde a criação (D5): editar a receita ou a OP não troca os
 * trechos de uma OP em andamento.
 * - OP sem trechos (criação): copia a receita ATIVA e casa as OPs filhas do Compels.
 * - OP com trechos (edição): não copia nem apaga nada; só procura de novo a filha dos trechos que ainda não têm.
 * Nunca derruba o salvamento da OP: devolve um aviso em texto (ou null). Chamado só pelo servidor (ordens-actions).
 */
export async function aplicarEstruturaNaOp(ordemId: string, pmo: string, op: string, rota: string[]): Promise<string | null> {
  let alvo: { seq: number; codigo: string }[]
  try {
    const existentes = await trechosDaOp(ordemId)
    alvo = existentes.length > 0
      ? existentes.filter((t) => t.compelsOp === null).map(({ seq, codigo }) => ({ seq, codigo }))
      : await copiarParaOp(ordemId, pmo, rota)
  } catch {
    return 'Não foi possível aplicar a estrutura da PMO nesta OP.'
  }
  if (alvo.length === 0) return null
  let nos: NoArvore[]
  try {
    nos = await descendentes(op)
  } catch {
    return 'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.'
  }
  const filhas = casarTrechos(alvo, nos)
  try {
    await gravarFilhas(ordemId, filhas)
  } catch {
    return 'Não foi possível gravar as OPs filhas do Compels nesta OP.'
  }
  const faltando = alvo.filter((t) => filhas.get(t.seq) === null).map((t) => t.codigo)
  return faltando.length ? avisoFaltando(faltando, op) : null
}
