import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { normalizarNs, type NsNormalizado } from '../domain/numero-serie'
import { ordenarOs, osSugerida } from '../domain/entrada'

/**
 * O que se sabe de um número de série na hora da entrada (spec 2026-11-17-sat-entrada-por-nf-design.md, decisões 4
 * e 7): a planilha (OS mais recente primeiro; prevista a última que volta para a fábrica — "Envio ao SAT" ou "Troca
 * do Relógio" — e que não está ligada a outra entrada), o repinmetro (revenda, saída da expedição, teste de produção
 * e os seriais das peças internas) e o ShopFloor (OP/produto, se passou pela produção acompanhada). O produto
 * sugerido é o código da OP do ShopFloor (ex.: PMOC31), nunca o EQUIPAMENTO da planilha. Nada encontrado = manual.
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
  /** A OS já está ligada a alguma entrada (uma OS liga no máximo um relógio). */
  emUso: boolean
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
}

export interface ResultadoConsultaNs {
  ns: NsNormalizado
  os: OsDoNs[]
  osSugeridaId: string | null
  repinmetro: { revendas: RevendaDoNs[]; producao: ProducaoDoNs[] }
  shopfloor: ShopfloorDoNs[]
  sugestao: { produto: string }
  nadaEncontrado: boolean
}

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

  const ordem = ordenarOs(os)
  const sugerida = osSugerida(ordem, new Set(os.filter((o) => o.emUso).map((o) => o.id)))

  return {
    ns,
    os: ordem,
    osSugeridaId: sugerida?.id ?? null,
    repinmetro: { revendas: banco.revendas, producao: banco.producao },
    shopfloor: banco.shopfloor,
    sugestao: { produto: banco.shopfloor[0]?.pmo ?? '' },
    nadaEncontrado: os.length === 0 && banco.revendas.length === 0 && banco.producao.length === 0 &&
      banco.shopfloor.length === 0,
  }
}
