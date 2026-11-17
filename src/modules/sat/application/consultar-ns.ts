import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { normalizarNs, type NsNormalizado } from '../domain/numero-serie'
import { cnpjDoCliente, ordenarOs, osSugerida } from '../domain/entrada'

/**
 * O que se sabe de um número de série na hora da entrada (spec 2026-11-17-sat-entrada-design.md, decisão 5):
 * a planilha (OS mais recente primeiro, já escolhida a última "Envio ao SAT"), o repinmetro (revenda, saída da
 * expedição, teste de produção e os seriais das peças internas), o ShopFloor (OP/produto, se passou pela
 * produção acompanhada) e o Compels (descrição do produto pelo código). Nada encontrado = entrada manual.
 */
export interface PecaDaOs {
  nsEscrito: string
  codigoPeca: string
  peca: string
  quantidade: number | null
}

export interface OsDoNs {
  id: string
  numero: string
  data: string | null
  tecnico: string
  cliente: string
  equipamento: string
  garantia: string
  primeiroRegistro: string
  defeito: string
  observacao: string
  solucao: string
  vendedor: string
  /** As peças DESTE NS na OS. */
  pecas: PecaDaOs[]
}

export interface RevendaDoNs {
  numeroSerieCompleto: string
  revenda: string | null
  gravadaEm: string | null
  saidaEm: string | null
}

export interface ProducaoDoNs {
  numeroSerie: string
  modelo: string | null
  dataInicio: string | null
  dataFim: string | null
  status: string | null
  seriais: Record<string, string | null>
}

export interface ShopfloorDoNs {
  pmo: string
  op: string
  cliente: string
  descricao: string
  ultimoPosto: string
  ultimoEm: string
}

export interface DadosDoBanco {
  revendas: RevendaDoNs[]
  producao: ProducaoDoNs[]
  shopfloor: ShopfloorDoNs[]
}

export interface PortasConsultaNs {
  osPorNs(ns: { modelo: string | null; sequencia: string }): Promise<OsDoNs[]>
  consultarBanco(modelo: string | null, sequencia: string | null, snsNorm: string[]): Promise<DadosDoBanco>
  /** Descrição do item no Compels; `null` = não achou ou o Compels não está configurado. */
  descricaoProduto(codigo: string): Promise<string | null>
}

export interface ResultadoConsultaNs {
  ns: NsNormalizado
  os: OsDoNs[]
  osSugeridaId: string | null
  repinmetro: { revendas: RevendaDoNs[]; producao: ProducaoDoNs[] }
  shopfloor: ShopfloorDoNs[]
  compels: { codigo: string; descricao: string }[]
  sugestao: { empresa: string; cnpj: string; produto: string; defeito: string }
  nadaEncontrado: boolean
}

/** Máximo de códigos de produto consultados no Compels por busca. */
const MAX_CODIGOS_COMPELS = 3

/** Como o NS pode ter sido bipado no ShopFloor (normalizado como lá: sem separador nem zero à esquerda). */
export function formasDoBipe(ns: NsNormalizado): string[] {
  const formas = [normalizarSerie(ns.escrito)]
  if (ns.modelo && ns.sequencia) {
    formas.push(`43${ns.modelo.padStart(5, '0')}${ns.sequencia.padStart(7, '0')}`)
    formas.push(`43${ns.modelo.padStart(5, '0')}${ns.sequencia}`)
  }
  return [...new Set(formas.filter((f) => f !== ''))]
}

export async function consultarNs(texto: string, portas: PortasConsultaNs): Promise<ResultadoConsultaNs> {
  const ns = normalizarNs(texto)
  const formas = formasDoBipe(ns)
  const vazio = { revendas: [], producao: [], shopfloor: [] }

  const [os, banco] = await Promise.all([
    ns.sequencia ? portas.osPorNs({ modelo: ns.modelo, sequencia: ns.sequencia }) : Promise.resolve([]),
    ns.sequencia || formas.length > 0 ? portas.consultarBanco(ns.modelo, ns.sequencia, formas) : Promise.resolve(vazio),
  ])

  const codigos = [...new Set(banco.shopfloor.map((s) => s.pmo).filter(Boolean))].slice(0, MAX_CODIGOS_COMPELS)
  const compels = (await Promise.all(codigos.map(async (codigo) => {
    try {
      const descricao = await portas.descricaoProduto(codigo)
      return descricao ? { codigo, descricao } : null
    } catch {
      return null
    }
  }))).filter((c): c is { codigo: string; descricao: string } => c !== null)

  const ordem = ordenarOs(os)
  const sugerida = osSugerida(ordem)
  const cliente = cnpjDoCliente(sugerida?.cliente ?? '')
  const produto = compels[0]?.descricao || banco.shopfloor[0]?.descricao || sugerida?.equipamento || ''

  return {
    ns,
    os: ordem,
    osSugeridaId: sugerida?.id ?? null,
    repinmetro: { revendas: banco.revendas, producao: banco.producao },
    shopfloor: banco.shopfloor,
    compels,
    sugestao: { empresa: cliente.nome, cnpj: cliente.cnpj, produto, defeito: sugerida?.defeito ?? '' },
    nadaEncontrado: os.length === 0 && banco.revendas.length === 0 && banco.producao.length === 0 &&
      banco.shopfloor.length === 0,
  }
}
