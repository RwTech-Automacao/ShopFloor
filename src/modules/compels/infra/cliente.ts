import { leiturasDeRespostas, listaDe, RespostaInesperada } from '../domain/leituras-erp'
import type { LeiturasOp } from '../domain/estado-op'
import { resultadoDaGravacao, type ResultadoGravacao } from '../domain/resposta-erp'
import type { ConfigCompels } from './config'
import { GerenciadorToken, type FetchFn } from './token'

/** Dados da OP que a integração confere antes de gravar. */
export interface DadosOp {
  /** Id interno (≠ do número da OP). */
  id: number
  numero: number
  status: string
  tipoPropriedade: number
  quantidade: number
  /** Código do produto (a nossa PMO). */
  codigoItem: string
  /** Unidade do produto; a integração só atende `UN` no começo. */
  unidade: string
}

const TRES_ANOS_MS = 3 * 365 * 24 * 60 * 60 * 1000

function dataIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10) + 'T00:00:00'
}

/**
 * Cliente da API interna da tela do Compels (spec 16/10/2026). Autentica com o token do ezpointweb,
 * renova sozinho e tenta de novo UMA vez se o ERP responder 401. Por ora só leituras e a trava;
 * Requisitar/Apontar entram na etapa seguinte.
 */
export class ClienteCompels {
  constructor(
    private readonly config: ConfigCompels,
    private readonly token: GerenciadorToken = new GerenciadorToken(config),
    private readonly buscar: FetchFn = fetch,
    private readonly agora: () => number = Date.now,
  ) {}

  private async enviar(caminho: string, init: RequestInit = {}, tentouRenovar = false): Promise<Response> {
    const bearer = await this.token.obter()
    const r = await this.buscar(`${this.config.apiUrl}${caminho}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (r.status === 401 && !tentouRenovar) {
      this.token.invalidar()
      return this.enviar(caminho, init, true)
    }
    return r
  }

  private async json(caminho: string, init?: RequestInit): Promise<unknown> {
    const r = await this.enviar(caminho, init)
    if (!r.ok) throw new RespostaInesperada(`${caminho} (HTTP ${r.status})`)
    try {
      return await r.json()
    } catch {
      throw new RespostaInesperada(caminho)
    }
  }

  private formulario(campos: Record<string, string>): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(campos),
    }
  }

  /** Acha a OP pelo NÚMERO (o que o ShopFloor conhece) e lê o cadastro dela. `null` se não existir. */
  async buscarOp(numero: number): Promise<DadosOp | null> {
    const filtro = {
      numero: String(numero), codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null,
      clientePedido: '', item: '', linha: '', tipoPropriedade: null, statusList: null,
      selecionarPor: 'Data Documento',
      dataInicial: dataIso(this.agora() - TRES_ANOS_MS), dataFinal: dataIso(this.agora()),
      numeroPedido: '', centroCusto: '', listarPendentes: false, prototipo: false, etapa: '',
      selecionarOPPor: 'op', observacao: '', nivel: '', responsavelCriacao: '', responsavelAlteracao: '',
      situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
    }
    const busca = await this.json(
      '/ordemProducaoSimples/findAllFilter',
      this.formulario({ sortFilter: 'null', filtro: JSON.stringify(filtro), page: '1', start: '0', limit: '25' }),
    )
    // A busca por número pode trazer mais de uma OP: conferir o número EXATO.
    const achada = listaDe(busca, 'busca de OP').find((o) => o.numero === numero)
    if (!achada || typeof achada.id !== 'number') return null

    const detalhe = await this.json(
      '/ordemProducaoSimples/findById',
      this.formulario({ id: String(achada.id), page: '1', start: '0', limit: '25' }),
    )
    const d = ((detalhe as { data?: unknown } | null)?.data ?? detalhe) as Record<string, unknown>
    const item = (d.composicaoProduto as { item?: Record<string, unknown> } | undefined)?.item
    const unidade = (item?.unidade as { codigo?: unknown } | undefined)?.codigo
    if (
      typeof d.status !== 'string' || typeof d.tipoPropriedade !== 'number' || typeof d.quantidade !== 'number' ||
      typeof item?.codigo !== 'string' || typeof unidade !== 'string'
    ) {
      throw new RespostaInesperada('cadastro da OP')
    }
    return {
      id: achada.id, numero, status: d.status, tipoPropriedade: d.tipoPropriedade,
      quantidade: d.quantidade, codigoItem: item.codigo, unidade,
    }
  }

  /** Estado completo da OP (empenhos, requisições e apontamentos), pelas LISTAS. */
  async lerOp(op: DadosOp): Promise<LeiturasOp> {
    const id = String(op.id)
    const [empenhos, requisicoes, apontamentos] = await Promise.all([
      this.json(`/empenho/findByOrdemProducaoId?idOrdemProducao=${id}&page=1&start=0&limit=50`),
      this.json('/requisicaoOrdemProducao/findByOrdemProducaoId', this.formulario({ id, page: '1', start: '0', limit: '50' })),
      this.json('/apontamentoOrdemProducao/findByOrdemProducaoId', this.formulario({ id, page: '1', start: '0', limit: '50' })),
    ])
    return leiturasDeRespostas({
      op: { status: op.status, tipoPropriedade: op.tipoPropriedade, quantidade: op.quantidade },
      empenhos, requisicoes, apontamentos,
    })
  }

  /** Trava de edição da OP: 201 = é nossa; 400 = outra pessoa está com a OP aberta. */
  async adquirirTrava(idOp: number): Promise<ResultadoGravacao> {
    const r = await this.enviar(`/lock/eng.ordemproducaosimples/${idOp}`, { method: 'POST' })
    let corpo: unknown = null
    try { corpo = await r.json() } catch { /* 201 vem sem corpo */ }
    return resultadoDaGravacao(r.status, corpo)
  }

  async liberarTrava(idOp: number): Promise<void> {
    await this.enviar(`/lock/release/eng.ordemproducaosimples/${idOp}`, { method: 'DELETE' })
  }
}
