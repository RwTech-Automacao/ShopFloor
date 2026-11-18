import {
  avaliarNota, itensDaNota, situacaoDaNota,
  type ItemDaNota, type NotaPendente, type SituacaoNota,
} from '@/modules/compels/domain/baixa-nf'

/**
 * O que a tela de Baixa de NF do Faturamento mostra de cada nota pendente (spec
 * 2026-11-17-faturamento-baixa-nf-design.md). Puro: a leitura do Compels e da fila fica na aplicação.
 */
export interface NotaDaTela {
  id: number
  numero: number
  emissao: string
  clienteCodigo: string
  clienteNome: string
  valor: number | null
  pedidoVenda: string
  natureza: string
  /** `estoquePa` = saldo atual do item no PA (`null` = não deu para consultar). */
  itens: (ItemDaNota & { estoquePa: number | null })[]
  situacao: SituacaoNota
  /** Posição na fila (1 = a próxima), ou `null` se a nota não está aguardando. */
  posicaoNaFila: number | null
}

export function montarNotaDaTela(
  nota: NotaPendente,
  itensCompels: { proprias: unknown[]; emTerceiros: unknown[]; deTerceiros: unknown[] },
  estoquePa: Map<string, number | null>,
  /** `nota_id` das notas aguardando, em ordem de fila. */
  filaNotaIds: number[],
): NotaDaTela {
  const itens = itensDaNota(itensCompels.proprias)
  // O usuário só entra no corpo da baixa, que a tela não usa.
  const decisao = avaliarNota({ nota, ...itensCompels, usuario: '' })
  const i = filaNotaIds.indexOf(nota.id)
  return {
    id: nota.id, numero: nota.numero, emissao: nota.emissao,
    clienteCodigo: nota.clienteCodigo, clienteNome: nota.clienteNome, valor: nota.valor,
    pedidoVenda: nota.pedidoVenda, natureza: nota.natureza,
    itens: itens.map((it) => ({ ...it, estoquePa: estoquePa.get(it.codigo) ?? null })),
    situacao: situacaoDaNota(decisao, itens, estoquePa),
    posicaoNaFila: i >= 0 ? i + 1 : null,
  }
}

export interface FiltroNotas {
  numero: string
  /** Código ou razão social. */
  cliente: string
  /** Código ou descrição de um item. */
  item: string
  /** `aaaa-mm-dd` (inclusive); vazio = sem limite. */
  de: string
  ate: string
  soPodeBaixar: boolean
}

export const FILTRO_VAZIO: FiltroNotas = { numero: '', cliente: '', item: '', de: '', ate: '', soPodeBaixar: false }

const contem = (texto: string, busca: string) => texto.toLocaleLowerCase('pt-BR').includes(busca)

/** Os filtros da tela, no navegador, sobre a lista já lida. */
export function filtrarNotas(notas: NotaDaTela[], f: FiltroNotas): NotaDaTela[] {
  const numero = f.numero.trim()
  const cliente = f.cliente.trim().toLocaleLowerCase('pt-BR')
  const item = f.item.trim().toLocaleLowerCase('pt-BR')
  return notas.filter((n) =>
    (!numero || String(n.numero).includes(numero)) &&
    (!cliente || contem(n.clienteCodigo, cliente) || contem(n.clienteNome, cliente)) &&
    (!item || n.itens.some((i) => contem(i.codigo, item) || contem(i.descricao, item))) &&
    (!f.de || n.emissao >= f.de) &&
    (!f.ate || n.emissao <= f.ate) &&
    (!f.soPodeBaixar || n.situacao.tipo === 'pode_baixar'),
  )
}
