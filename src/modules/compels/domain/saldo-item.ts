import { listaDe, RespostaInesperada } from './leituras-erp'

/**
 * Saldo de estoque de um item (no nosso caso, a PMO) lido de `POST /itemMovimento/findFilter`
 * (tela Movimento de Item do Compels). Corpo: form com `filter` = JSON
 * `{ codigo, descricao, data, exibeItensComSaldoZerado }` mais `page`, `start`, `limit`.
 *
 * ⚠️ O filtro `codigo` não garante casamento exato (digitar `prt446` trouxe o item `PRT446`, mas um
 * código curto como `PMOC5` pode trazer `PMOC57`): por isso a busca confere o código EXATO, sem
 * diferenciar maiúsculas. E o pedido deve mandar `exibeItensComSaldoZerado: true`: com `false` o
 * Compels omite o item de saldo zero e "não existe" ficaria igual a "saldo zero".
 */
export interface SaldoItem {
  codigo: string
  descricao: string
  unidade: string
  /** Estoque próprio. É o que o Almoxarifado enxerga como "tem em estoque". */
  proprio: number
  /** Saldo em pendência (reservado/aguardando). */
  pendencia: number
  /** Em terceiros (nosso material em poder de terceiros). */
  emTerceiros: number
  /** De terceiros (material de terceiros em nosso poder). */
  deTerceiros: number
}

export function saldoDoItem(resposta: unknown, codigo: string): SaldoItem | null {
  const alvo = codigo.trim().toUpperCase()
  const linhas = listaDe(resposta, 'saldo do item')

  for (const linha of linhas) {
    const item = linha.item
    if (typeof item !== 'object' || item === null) throw new RespostaInesperada('saldo.item')
    const cadastro = item as Record<string, unknown>
    if (typeof cadastro.codigo !== 'string') throw new RespostaInesperada('saldo.item.codigo')
    if (cadastro.codigo.trim().toUpperCase() !== alvo) continue

    const numero = (campo: string): number => {
      const v = linha[campo]
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new RespostaInesperada(`saldo.${campo}`)
      return v
    }
    const unidade = (cadastro.unidade as { codigo?: unknown } | null | undefined)?.codigo

    return {
      codigo: cadastro.codigo,
      descricao: typeof cadastro.descricao === 'string' ? cadastro.descricao.trim() : '',
      unidade: typeof unidade === 'string' ? unidade : '',
      proprio: numero('saldoItemEstoqueProprio'),
      pendencia: numero('saldoItemPendencia'),
      emTerceiros: numero('saldoItemEstoqueEmTerceiros'),
      deTerceiros: numero('saldoItemEstoqueDeTerceiros'),
    }
  }
  return null
}
