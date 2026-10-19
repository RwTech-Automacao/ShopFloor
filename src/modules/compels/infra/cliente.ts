import {
  componentesDeApontamento,
  componentesDeRequisicao,
  consultaDisponibilidade,
  consultaRequisitada,
  type ComponenteApontamento,
  type ComponenteRequisicao,
} from '../domain/corpos'
import { leiturasDeRespostas, listaDe, RespostaInesperada } from '../domain/leituras-erp'
import { saldoDoItem, type SaldoItem } from '../domain/saldo-item'
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
  /** Id interno do produto da OP. */
  produtoId: number
  /** Id do negociante da OP (vai nas consultas de requisição). */
  negocianteId: number
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
    // O Compels responde 415 a GET sem `Content-Type` (a tela web sempre manda JSON): o padrão é JSON, e
    // os envios de formulário trazem o próprio `Content-Type`.
    const proprios = (init.headers as Record<string, string> | undefined) ?? {}
    const r = await this.buscar(`${this.config.apiUrl}${caminho}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...proprios, Authorization: `Bearer ${bearer}` },
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
    const negociante = (d.negociante as { id?: unknown } | undefined)?.id
    if (
      typeof d.status !== 'string' || typeof d.tipoPropriedade !== 'number' || typeof d.quantidade !== 'number' ||
      typeof item?.codigo !== 'string' || typeof item.id !== 'number' || typeof unidade !== 'string' ||
      typeof negociante !== 'number'
    ) {
      throw new RespostaInesperada('cadastro da OP')
    }
    return {
      id: achada.id, numero, status: d.status, tipoPropriedade: d.tipoPropriedade,
      quantidade: d.quantidade, produtoId: item.id, negocianteId: negociante, codigoItem: item.codigo, unidade,
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

  /** Consulta que a tela faz antes de requisitar: componentes, saldo e custo. Só leitura. */
  async consultarRequisicao(op: DadosOp, quantidade: number): Promise<ComponenteRequisicao[]> {
    const resposta = await this.json(
      '/requisicaoOrdemProducao/verificaQuantidadeRequisitada',
      this.formulario({
        jsonData: JSON.stringify(consultaRequisitada({
          opId: op.id, tipoPropriedade: op.tipoPropriedade, produtoId: op.produtoId,
          negocianteId: op.negocianteId, quantidade,
        })),
        page: '1', start: '0', limit: '50',
      }),
    )
    return componentesDeRequisicao(resposta)
  }

  /** Consulta que a tela faz antes de apontar: consumo e saldo de cada componente. Só leitura. */
  async consultarDisponibilidade(op: DadosOp, quantidade: number): Promise<ComponenteApontamento[]> {
    const resposta = await this.json(
      '/apontamentoOrdemProducao/verificaDisponibilidade',
      this.formulario(consultaDisponibilidade({ opId: op.id, quantidade, produtoId: op.produtoId })),
    )
    return componentesDeApontamento(resposta)
  }

  private async gravar(caminho: string, corpo: Record<string, unknown>): Promise<ResultadoGravacao> {
    const r = await this.enviar(caminho, this.formulario({ jsonData: JSON.stringify(corpo) }))
    let resposta: unknown = null
    try { resposta = await r.json() } catch { /* sem corpo JSON */ }
    return resultadoDaGravacao(r.status, resposta)
  }

  /** `requisicaoOrdemProducao/save`. GRAVA no Compels. */
  requisitar(corpo: Record<string, unknown>): Promise<ResultadoGravacao> {
    return this.gravar('/requisicaoOrdemProducao/save', corpo)
  }

  /** `apontamentoOrdemProducao/save`. GRAVA no Compels e dá entrada no estoque. */
  apontar(corpo: Record<string, unknown>): Promise<ResultadoGravacao> {
    return this.gravar('/apontamentoOrdemProducao/save', corpo)
  }

  /**
   * Saldo de estoque de UM item (a PMO) pela tela Movimento de Item. Só leitura. `null` = o item não veio
   * na resposta (código exato). Pede os itens de saldo zero também, senão "não existe" e "zero" se
   * confundiriam.
   */
  async consultarSaldoItem(codigo: string): Promise<SaldoItem | null> {
    const filtro = {
      codigo: codigo.trim(),
      descricao: '',
      data: dataIso(this.agora()),
      exibeItensComSaldoZerado: true,
    }
    const resposta = await this.json(
      '/itemMovimento/findFilter',
      this.formulario({ filter: JSON.stringify(filtro), page: '1', start: '0', limit: '50' }),
    )
    return saldoDoItem(resposta, codigo)
  }
}

