import 'server-only'
import { clienteCompelsDoFaturamento } from '@/modules/faturamento/infra/compels'

/**
 * Descrição do produto no Compels pelo código (a mesma consulta só-leitura do saldo do item). `null` = o item não
 * veio, ou o login do Compels não está neste ambiente — a tela de entrada segue sem a descrição.
 */
export async function descricaoDoProduto(codigo: string): Promise<string | null> {
  const cliente = clienteCompelsDoFaturamento()
  if (!cliente || codigo.trim() === '') return null
  const item = await cliente.consultarSaldoItem(codigo)
  return item?.descricao || null
}
