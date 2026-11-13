import { ENTRADA } from '@/modules/shopfloor/domain/fluxo-op'

interface OpSel { pmo?: string; op?: string; descricao?: string }

/**
 * PMO/OP que cada nó leva. Todos levam PMO e OP (o card do posto consulta as PRTs da OP; a Saída consulta o
 * estoque e a fila do Compels). Só a Entrada leva também a descrição da OP. Os cards de Entrada/Saída
 * decidem o que mostrar por `ehEntrada`/`ehSaida`, não pela presença de `pmo`.
 */
export function dadosPmoOpDoNo(id: string, opSel: OpSel | null | undefined): { pmo?: string; op?: string; descricao?: string } {
  const base = { pmo: opSel?.pmo, op: opSel?.op }
  return id === ENTRADA ? { ...base, descricao: opSel?.descricao } : base
}
