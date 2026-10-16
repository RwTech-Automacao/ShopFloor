import { describe, expect, it } from 'vitest'
import type { ComponenteApontamento, ComponenteRequisicao } from '../../domain/corpos'
import type { LeiturasOp } from '../../domain/estado-op'
import { RespostaInesperada } from '../../domain/leituras-erp'
import type { ResultadoGravacao } from '../../domain/resposta-erp'
import type { DadosOp } from '../../infra/cliente'
import { enviarEntrada, ensaiarEntrada, type EntradaParaEnviar, type PortaErp } from '../enviar-entrada'

const OP: DadosOp = {
  id: 13027, numero: 8649, status: 'Empenhada', tipoPropriedade: 0, quantidade: 1000,
  produtoId: 22078, negocianteId: 1679, codigoItem: 'PRT446', unidade: 'UN',
}
const OK: ResultadoGravacao = { ok: true, mensagem: 'feito' }
const AGORA = new Date('2026-10-16T18:32:21Z') // 15:32:21 em São Paulo
const DESTINO = { estoqueId: 217, locacaoId: 5314 }
const ENTRADA: EntradaParaEnviar = { pmo: 'PRT446', op: '8649', quantidade: 55, acumuladoAnterior: 0 }

const linhaReq = (q: number, saldo = 1000): ComponenteRequisicao => ({
  itemId: 12225, codigo: 'RWCI57', rastreavel: false, precoCusto: 1.5, quantidadeRequisitar: q,
  quantidadeComposicao: q, quantidadeRequisitadaDisponivel: 0, itemOrdemProducaoId: 138103, itemFantasma: false, saldo,
})
const linhaDisp = (q: number, saldo = 1000): ComponenteApontamento => ({
  itemId: 12225, codigo: 'RWCI57', quantidadeUtilizada: q, quantidadeComposicao: 1,
  itemOrdemProducaoId: 138103, itemFantasma: false, saldoDisponivel: saldo,
})

function leituras(parcial: Partial<LeiturasOp> = {}): LeiturasOp {
  return {
    status: 'Empenhada', tipoPropriedade: 0, quantidadeOp: 1000,
    empenhos: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Empenhada' }],
    requisicoes: [], apontamentos: [], ...parcial,
  }
}

/** Compels de mentira: lembra o que foi chamado e aplica as gravações no estado, para a releitura bater. */
function fingir(inicial: Partial<LeiturasOp> = {}, desvios: Partial<PortaErp> = {}) {
  const chamadas: string[] = []
  const estado = leituras(inicial)
  const gravados: { requisitar?: Record<string, unknown>; apontar?: Record<string, unknown> } = {}
  const erp: PortaErp = {
    async buscarOp() { chamadas.push('buscarOp'); return OP },
    async lerOp() { chamadas.push('lerOp'); return structuredClone(estado) },
    async adquirirTrava() { chamadas.push('adquirirTrava'); return OK },
    async liberarTrava() { chamadas.push('liberarTrava') },
    async consultarRequisicao(_op, q) { chamadas.push('consultarRequisicao'); return [linhaReq(q)] },
    async consultarDisponibilidade(_op, q) { chamadas.push('consultarDisponibilidade'); return [linhaDisp(q)] },
    async requisitar(corpo) {
      chamadas.push('requisitar'); gravados.requisitar = corpo
      estado.requisicoes = [...estado.requisicoes, { quantidade: Number(corpo.quantidade), quantidadeEstornar: 0, situacao: 'Requisitada' }]
      return OK
    },
    async apontar(corpo) {
      chamadas.push('apontar'); gravados.apontar = corpo
      estado.apontamentos = [...estado.apontamentos, { quantidadeProduzida: Number(corpo.quantidadeProduzida), quantidadeCancelada: 0 }]
      return OK
    },
    ...desvios,
  }
  return { erp, chamadas, gravados }
}

const opcoes = { destino: DESTINO, agora: () => AGORA }

describe('enviarEntrada', () => {
  it('primeira entrada: confere, trava, lê, consulta, requisita, aponta, relê e libera a trava (nesta ordem)', async () => {
    const { erp, chamadas, gravados } = fingir()
    const r = await enviarEntrada(erp, { ...ENTRADA, marca: 'ShopFloor #1' }, opcoes)
    expect(r).toEqual({ ok: true, detalhe: 'Requisitado e apontado.' })
    expect(chamadas).toEqual([
      'buscarOp', 'adquirirTrava', 'lerOp', 'consultarRequisicao', 'consultarDisponibilidade',
      'requisitar', 'apontar', 'lerOp', 'liberarTrava',
    ])
    expect(gravados.requisitar?.quantidade).toBe(55)
    const ap = gravados.apontar as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ap.quantidadeProduzida).toBe(55)
    expect(ap.dataInicio).toBe('2026-10-16T00:00:00')
    expect(ap.dataFim).toBe('2026-10-16T15:32:21')
    expect(ap.observacao).toBe('ShopFloor #1')
    expect(ap.itemLote.itemLoteEstoque.estoque.id).toBe(217)
    expect(ap.itemLote.itemLoteEstoque.itemLoteEstoqueLocacao.locacao.id).toBe(5314)
  })

  it('o início do apontamento repete o do primeiro apontamento da OP', async () => {
    const { erp, gravados } = fingir({
      requisicoes: [{ quantidade: 10, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 10, quantidadeCancelada: 0, dataInicio: '2026-09-30T00:00:00.000-03:00' }],
    })
    const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 5, acumuladoAnterior: 10 }, opcoes)
    expect(r.ok).toBe(true)
    expect((gravados.apontar as Record<string, unknown>).dataInicio).toBe('2026-09-30T00:00:00')
  })

  it('já enviada: não grava nada e libera a trava', async () => {
    const { erp, chamadas } = fingir({
      requisicoes: [{ quantidade: 55, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 55, quantidadeCancelada: 0 }],
    })
    expect(await enviarEntrada(erp, ENTRADA, opcoes)).toEqual({ ok: true, detalhe: 'O Compels já tinha esta entrada.' })
    expect(chamadas).not.toContain('requisitar')
    expect(chamadas).not.toContain('apontar')
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('retomada: a requisição desta entrada já existe, então só aponta (sem requisitar de novo)', async () => {
    const { erp, chamadas } = fingir({ requisicoes: [{ quantidade: 55, quantidadeEstornar: 0, situacao: 'Requisitada' }] })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
    expect(chamadas).not.toContain('requisitar')
    expect(chamadas).toContain('apontar')
  })

  it('OP em uso: devolve a mensagem do ERP, tenta de novo e não consulta nem libera trava que não é nossa', async () => {
    const { erp, chamadas } = fingir({}, {
      adquirirTrava: async () => ({ ok: false, codigo: 'op_em_uso', mensagem: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true }),
    })
    expect(await enviarEntrada(erp, ENTRADA, opcoes)).toEqual({
      ok: false, erro: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true,
    })
    expect(chamadas).toEqual(['buscarOp'])
  })

  it('falta de saldo de componente no apontar: não grava, mostra o componente e libera a trava', async () => {
    const { erp, chamadas } = fingir({}, { consultarDisponibilidade: async (_o, q) => [linhaDisp(q, 40)] })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: true })
    expect(r.ok === false && r.erro).toContain('RWCI57 (precisa 55, tem 40)')
    expect(chamadas).not.toContain('requisitar')
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('falta de saldo na requisição: não grava', async () => {
    const { erp, chamadas } = fingir({}, { consultarRequisicao: async (_o, q) => [linhaReq(q, 10)] })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r.ok === false && r.erro).toContain('RWCI57 (precisa 55, tem 10)')
    expect(chamadas).not.toContain('apontar')
  })

  it('falha no Requisitar: não aponta e libera a trava', async () => {
    const { erp, chamadas } = fingir({}, {
      requisitar: async () => ({ ok: false, codigo: 'quantidade_acima', mensagem: 'Quantidade acima.', tentarDeNovo: false }),
    })
    expect(await enviarEntrada(erp, ENTRADA, opcoes)).toEqual({ ok: false, erro: 'Quantidade acima.', tentarDeNovo: false })
    expect(chamadas).not.toContain('apontar')
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('falha no Apontar depois de requisitar: avisa que a requisição já foi feita', async () => {
    const { erp } = fingir({}, {
      apontar: async () => ({ ok: false, codigo: 'indisponivel', mensagem: 'Compels fora do ar.', tentarDeNovo: true }),
    })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: true })
    expect(r.ok === false && r.erro).toContain('A requisição já foi feita; a próxima tentativa só aponta.')
  })

  it('o ERP aceita mas a releitura não mostra o acumulado novo: não marca como enviado', async () => {
    const { erp } = fingir({}, { apontar: async () => OK }) // aceita sem alterar o estado
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: false })
    expect(r.ok === false && r.erro).toContain('mostra 0 apontadas (esperado 55)')
  })

  it('exceção no meio vira falha legível, libera a trava e RespostaInesperada não tenta de novo', async () => {
    const { erp, chamadas } = fingir({}, { consultarDisponibilidade: async () => { throw new RespostaInesperada('x') } })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: false })
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('erro ao liberar a trava não esconde o resultado', async () => {
    const { erp } = fingir({}, { liberarTrava: async () => { throw new Error('rede') } })
    expect((await enviarEntrada(erp, ENTRADA, opcoes)).ok).toBe(true)
  })

  describe('conferências antes de tocar na OP', () => {
    it('OP com sufixo (PMOC50_) não é numérica: fica manual', async () => {
      const { erp, chamadas } = fingir()
      const r = await enviarEntrada(erp, { ...ENTRADA, op: 'PMOC50_' }, opcoes)
      expect(r.ok === false && r.erro).toContain('não é numérica')
      expect(chamadas).toEqual([])
    })

    it('OP inexistente no Compels', async () => {
      const { erp } = fingir({}, { buscarOp: async () => null })
      expect((await enviarEntrada(erp, ENTRADA, opcoes)).ok).toBe(false)
    })

    it('PMO diferente da do Compels', async () => {
      const { erp, chamadas } = fingir()
      const r = await enviarEntrada(erp, { ...ENTRADA, pmo: 'PMOC57' }, opcoes)
      expect(r.ok === false && r.erro).toContain('(PRT446) é diferente da PMO PMOC57')
      expect(chamadas).toEqual(['buscarOp'])
    })

    it('a comparação da PMO ignora maiúsculas', async () => {
      const { erp } = fingir()
      expect((await enviarEntrada(erp, { ...ENTRADA, pmo: 'prt446' }, opcoes)).ok).toBe(true)
    })

    it('unidade diferente de UN fica manual', async () => {
      const { erp, chamadas } = fingir({}, { buscarOp: async () => ({ ...OP, unidade: 'PÇ' }) })
      const r = await enviarEntrada(erp, ENTRADA, opcoes)
      expect(r.ok === false && r.erro).toContain('só atende UN')
      expect(chamadas).toEqual([])
    })
  })
})

describe('ensaiarEntrada (não grava e não pega a trava)', () => {
  it('devolve os corpos que seriam enviados', async () => {
    const { erp, chamadas } = fingir()
    const plano = await ensaiarEntrada(erp, ENTRADA, opcoes)
    expect(plano.tipo).toBe('enviar')
    if (plano.tipo !== 'enviar') return
    expect(plano.requisitar?.quantidade).toBe(55)
    expect(plano.apontar.quantidadeProduzida).toBe(55)
    expect(chamadas).not.toContain('adquirirTrava')
    expect(chamadas).not.toContain('requisitar')
    expect(chamadas).not.toContain('apontar')
  })

  it('devolve o motivo quando a entrada não pode ser enviada', async () => {
    const { erp } = fingir({}, { buscarOp: async () => ({ ...OP, unidade: 'KG' }) })
    expect((await ensaiarEntrada(erp, ENTRADA, opcoes)).tipo).toBe('erro')
  })
})
