import { describe, expect, it } from 'vitest'
import type { ComponenteApontamento } from '../../domain/corpos'
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

const linhaDisp = (q: number, saldo = 1000): ComponenteApontamento => ({
  itemId: 12225, codigo: 'RWCI57', quantidadeUtilizada: q, quantidadeComposicao: 1,
  itemOrdemProducaoId: 138103, itemFantasma: false, saldoDisponivel: saldo,
})

function leituras(parcial: Partial<LeiturasOp> = {}): LeiturasOp {
  return {
    status: 'Empenhada', tipoPropriedade: 0, quantidadeOp: 1000,
    empenhos: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Empenhada' }],
    requisicoes: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Requisitada' }], apontamentos: [], ...parcial,
  }
}

/** Compels de mentira: lembra o que foi chamado e aplica as gravações no estado, para a releitura bater. */
function fingir(inicial: Partial<LeiturasOp> = {}, desvios: Partial<PortaErp> = {}) {
  const chamadas: string[] = []
  const estado = leituras(inicial)
  const gravados: { apontar?: Record<string, unknown> } = {}
  const erp: PortaErp = {
    async buscarOp() { chamadas.push('buscarOp'); return OP },
    async lerOp() { chamadas.push('lerOp'); return structuredClone(estado) },
    async adquirirTrava() { chamadas.push('adquirirTrava'); return OK },
    async liberarTrava() { chamadas.push('liberarTrava') },
    async consultarDisponibilidade(_op, q) { chamadas.push('consultarDisponibilidade'); return [linhaDisp(q)] },
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
const leituras0 = () => leituras()

describe('enviarEntrada', () => {
  it('primeira entrada: confere, trava, lê, consulta o saldo, aponta, relê e libera a trava (nesta ordem); NUNCA requisita', async () => {
    const { erp, chamadas, gravados } = fingir()
    const r = await enviarEntrada(erp, { ...ENTRADA, marca: 'ShopFloor #1' }, opcoes)
    expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
    expect(chamadas).toEqual(['buscarOp', 'adquirirTrava', 'lerOp', 'consultarDisponibilidade', 'apontar', 'lerOp', 'liberarTrava'])
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
    // `base: 0` = o ponto de partida já foi guardado na tentativa que gravou (retomada).
    expect(await enviarEntrada(erp, { ...ENTRADA, base: 0 }, opcoes)).toEqual({ ok: true, detalhe: 'O Compels já tinha esta entrada.' })
    expect(chamadas).not.toContain('apontar')
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  describe('ponto de partida (apontado que a OP já tinha no Compels antes da integração)', () => {
    const COM_22 = {
      requisicoes: [{ quantidade: 28, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 22, quantidadeCancelada: 0 }],
      empenhos: [{ quantidade: 28, quantidadeEstornar: 0, situacao: 'Empenhada' }],
    }

    it('primeira entrada numa OP com 22 apontadas: guarda 22 ANTES de gravar e aponta só as 6', async () => {
      const { erp, chamadas, gravados } = fingir(COM_22)
      const guardadas: number[] = []
      const guardarBase = async (b: number) => { chamadas.push('guardarBase'); guardadas.push(b) }
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, guardarBase }, opcoes)
      expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
      expect(guardadas).toEqual([22])
      expect(chamadas.indexOf('guardarBase')).toBeLessThan(chamadas.indexOf('apontar'))
      expect((gravados.apontar as Record<string, unknown>).quantidadeProduzida).toBe(6)
    })

    it('com o ponto já guardado (22), a segunda entrada soma por cima e não guarda de novo', async () => {
      const { erp } = fingir({
        requisicoes: [{ quantidade: 28, quantidadeEstornar: 0, situacao: 'Requisitada' }],
        apontamentos: [{ quantidadeProduzida: 28, quantidadeCancelada: 0 }],
        empenhos: [{ quantidade: 30, quantidadeEstornar: 0, situacao: 'Empenhada' }],
      })
      let chamadasGuardar = 0
      const r = await enviarEntrada(
        erp,
        { ...ENTRADA, quantidade: 2, acumuladoAnterior: 6, base: 22, guardarBase: async () => { chamadasGuardar += 1 } },
        opcoes,
      )
      expect(r.ok).toBe(true)
      expect(chamadasGuardar).toBe(0)
    })

    it('retomada com o ponto guardado: o ERP já está em 28 = 22 + 6, então a entrada já tinha sido gravada', async () => {
      const { erp, chamadas } = fingir({
        requisicoes: [{ quantidade: 28, quantidadeEstornar: 0, situacao: 'Requisitada' }],
        apontamentos: [{ quantidadeProduzida: 28, quantidadeCancelada: 0 }],
        empenhos: [{ quantidade: 28, quantidadeEstornar: 0, situacao: 'Empenhada' }],
      })
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, base: 22 }, opcoes)
      expect(r).toEqual({ ok: true, detalhe: 'O Compels já tinha esta entrada.' })
      expect(chamadas).not.toContain('apontar')
    })

    it('alguém apontou à mão depois do ponto guardado: ERP em 25 com ponto 22 e nada enviado → grava as 6 e avisa os 3 a mais', async () => {
      const { erp, chamadas } = fingir({
        ...COM_22,
        requisicoes: [{ quantidade: 25, quantidadeEstornar: 0, situacao: 'Requisitada' }],
        apontamentos: [{ quantidadeProduzida: 25, quantidadeCancelada: 0 }],
      })
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, base: 22 }, opcoes)
      expect(r.ok).toBe(true)
      expect(chamadas).toContain('apontar')
      expect(r.ok && r.aviso).toContain('mostra 25 apontadas, esperado 22')
      expect(r.ok && r.aviso).toContain('a mais: 3')
    })

    it('empenho insuficiente (22 de 28) NÃO bloqueia: aponta e só avisa, dizendo quanto falta', async () => {
      const { erp, chamadas } = fingir({ ...COM_22, empenhos: [{ quantidade: 22, quantidadeEstornar: 0, situacao: 'Empenhada' }] })
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, guardarBase: async () => {} }, opcoes)
      expect(r.ok).toBe(true)
      expect(r.ok && r.detalhe).toBe('Apontado. Aviso: empenho insuficiente no Compels: empenhado 22, precisa de 28 (faltam 6).')
      expect(chamadas).toContain('apontar')
    })

    it('OP que já tem envios nossos e nenhum ponto guardado (anterior à mudança): ponto 0, como sempre foi', async () => {
      const { erp } = fingir({
        requisicoes: [{ quantidade: 4, quantidadeEstornar: 0, situacao: 'Requisitada' }],
        apontamentos: [{ quantidadeProduzida: 4, quantidadeCancelada: 0 }],
      })
      let guardou = false
      const r = await enviarEntrada(
        erp,
        { ...ENTRADA, quantidade: 1, acumuladoAnterior: 4, guardarBase: async () => { guardou = true } },
        opcoes,
      )
      expect(r.ok).toBe(true)
      expect(guardou).toBe(false)
    })

    it('falha ao guardar o ponto de partida: não grava nada no Compels e espera', async () => {
      const { erp, chamadas } = fingir(COM_22)
      const r = await enviarEntrada(
        erp,
        { ...ENTRADA, quantidade: 6, guardarBase: async () => { throw new Error('banco fora') } },
        opcoes,
      )
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(r.ok === false && r.erro).toContain('nada foi gravado no Compels')
        expect(chamadas).not.toContain('apontar')
      expect(chamadas.at(-1)).toBe('liberarTrava')
    })
  })

  it('requisição maior que o necessário serve: não precisa ser exata, só suficiente', async () => {
    const { erp, chamadas } = fingir({ requisicoes: [{ quantidade: 100, quantidadeEstornar: 0, situacao: 'Requisitada' }] })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
    expect(chamadas).toContain('apontar')
  })

  it('OP em uso: devolve a mensagem do ERP, tenta de novo e não consulta nem libera trava que não é nossa', async () => {
    const { erp, chamadas } = fingir({}, {
      adquirirTrava: async () => ({ ok: false, codigo: 'op_em_uso', mensagem: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true }),
    })
    expect(await enviarEntrada(erp, ENTRADA, opcoes)).toEqual({
      ok: false, erro: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true, aguardar: true,
    })
    expect(chamadas).toEqual(['buscarOp'])
  })

  describe('sem material requisitado suficiente (a requisição é feita no Compels, não aqui)', () => {
    const SEM_REQUISICAO = { consultarDisponibilidade: async (_o: unknown, q: number) => [linhaDisp(q, 0)] }

    it('não grava, espera sem gastar tentativa e diz o que falta, com o aviso de requisição insuficiente', async () => {
      const { erp, chamadas } = fingir({ requisicoes: [] }, SEM_REQUISICAO)
      const r = await enviarEntrada(erp, ENTRADA, opcoes)
      expect(r).toMatchObject({ ok: false, tentarDeNovo: true, aguardar: true })
      expect(r.ok === false && r.erro).toContain('Aguardando requisição no Compels: RWCI57 (precisa 55, requisitado disponível 0).')
      expect(r.ok === false && r.erro).toContain('requisição insuficiente no Compels: requisitado 0, precisa de 55 (faltam 55)')
      expect(chamadas).not.toContain('apontar')
      expect(chamadas.at(-1)).toBe('liberarTrava')
    })

    it('requisição Pendente (componente sem saldo) também espera', async () => {
      const { erp, chamadas } = fingir({ requisicoes: [{ quantidade: 55, quantidadeEstornar: 0, situacao: 'Pendente' }] }, SEM_REQUISICAO)
      const r = await enviarEntrada(erp, { ...ENTRADA, base: 0 }, opcoes)
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(r.ok === false && r.erro).toContain('Aguardando requisição no Compels')
      expect(chamadas).not.toContain('apontar')
    })

    it('alguém requisitou e pagou a pendência: aponta sozinho na rodada seguinte', async () => {
      const { erp, chamadas } = fingir({ requisicoes: [{ quantidade: 55, quantidadeEstornar: 0, situacao: 'Requisitada' }] })
      const r = await enviarEntrada(erp, { ...ENTRADA, base: 0 }, opcoes)
      expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
      expect(chamadas).toContain('apontar')
    })

    it('não guarda o ponto de partida enquanto só está esperando', async () => {
      const { erp } = fingir({}, SEM_REQUISICAO)
      let guardou = false
      await enviarEntrada(erp, { ...ENTRADA, guardarBase: async () => { guardou = true } }, opcoes)
      expect(guardou).toBe(false)
    })
  })

  it('erro de rede na leitura (antes de gravar) é só esperar; depois de gravar não é', async () => {
    const antes = fingir({}, { lerOp: async () => { throw new Error('ECONNRESET') } })
    expect(await enviarEntrada(antes.erp, ENTRADA, opcoes)).toMatchObject({ ok: false, tentarDeNovo: true, aguardar: true })
    // cai só na releitura, depois do Apontar
    let leituras = 0
    const depois = fingir({}, { lerOp: async () => { if (++leituras >= 2) throw new Error('ECONNRESET'); return leituras0() } })
    expect(await enviarEntrada(depois.erp, ENTRADA, opcoes)).toMatchObject({ ok: false, tentarDeNovo: true, aguardar: false })
  })

  it('falha no Apontar: devolve a mensagem do ERP e NÃO é "só esperar" (o ERP pode ter recebido algo)', async () => {
    const { erp } = fingir({}, {
      apontar: async () => ({ ok: false, codigo: 'indisponivel', mensagem: 'Compels fora do ar.', tentarDeNovo: true }),
    })
    expect(await enviarEntrada(erp, ENTRADA, opcoes)).toEqual({ ok: false, erro: 'Compels fora do ar.', tentarDeNovo: true, aguardar: false })
  })

  it('o ERP aceita mas a releitura não mostra o acumulado novo: não marca como enviado', async () => {
    const { erp } = fingir({}, { apontar: async () => OK }) // aceita sem alterar o estado
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: false, aguardar: false })
    expect(r.ok === false && r.erro).toContain('mostra 0 apontadas (esperado 55)')
  })

  describe('quantidade inesperada no Compels (06/11/2026): grava e avisa, não para', () => {
    // O ERP mostra 22 apontadas que o ShopFloor não enviou (apontamento antecipado/manual) e a base já está guardada em 0.
    const COM_22_DE_FORA = {
      requisicoes: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 22, quantidadeCancelada: 0 }],
    }

    it('apontado a mais do que o esperado: aponta a entrada mesmo assim e devolve o aviso', async () => {
      const { erp, chamadas, gravados } = fingir(COM_22_DE_FORA)
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, base: 0 }, opcoes)
      expect(chamadas).toContain('apontar')
      expect((gravados.apontar as Record<string, unknown>).quantidadeProduzida).toBe(6)
      expect(r.ok).toBe(true)
      const aviso = r.ok ? r.aviso : undefined
      expect(aviso).toContain('quantidade inesperada no Compels')
      expect(aviso).toContain('mostra 22 apontadas, esperado 0')
      expect(r.ok && r.detalhe).toContain('Aviso: quantidade inesperada')
    })

    it('a conferência final espera "o apontado de antes + esta entrada" (28), não o acumulado teórico (6)', async () => {
      const { erp } = fingir(COM_22_DE_FORA, { apontar: async () => OK }) // aceita sem alterar o estado
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6, base: 0 }, opcoes)
      expect(r).toMatchObject({ ok: false, tentarDeNovo: false, aguardar: false })
      expect(r.ok === false && r.erro).toContain('mostra 22 apontadas (esperado 28)')
    })

    it('sem diferença nenhuma não há aviso, e o resultado é o de sempre', async () => {
      const { erp } = fingir()
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6 }, opcoes)
      expect(r).toEqual({ ok: true, detalhe: 'Apontado.' })
      expect(r.ok && 'aviso' in r).toBe(false)
    })

    it('aviso de empenho/requisição insuficientes também vai no campo aviso', async () => {
      const { erp } = fingir({ empenhos: [{ quantidade: 2, quantidadeEstornar: 0, situacao: 'Empenhada' }] })
      const r = await enviarEntrada(erp, { ...ENTRADA, quantidade: 6 }, opcoes)
      expect(r.ok && r.aviso).toContain('empenho insuficiente')
    })
  })

  it('exceção no meio vira falha legível, libera a trava e RespostaInesperada não tenta de novo', async () => {
    const { erp, chamadas } = fingir({}, { consultarDisponibilidade: async () => { throw new RespostaInesperada('x') } })
    const r = await enviarEntrada(erp, ENTRADA, opcoes)
    expect(r).toMatchObject({ ok: false, tentarDeNovo: false, aguardar: false })
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('erro ao liberar a trava não esconde o resultado', async () => {
    const { erp } = fingir({}, { liberarTrava: async () => { throw new Error('rede') } })
    expect((await enviarEntrada(erp, ENTRADA, opcoes)).ok).toBe(true)
  })

  describe('conferências antes de tocar na OP', () => {
    it('OP com sufixo (8649_F) vira a OP 8649 do Compels e a PMO PRT446_F vira PRT446', async () => {
      const { erp, chamadas } = fingir()
      const r = await enviarEntrada(erp, { ...ENTRADA, op: '8649_F', pmo: 'PRT446_F' }, opcoes)
      expect(r.ok).toBe(true)
      expect(chamadas).toContain('apontar')
    })

    it('a PMO sem sufixo continua tendo que bater com o produto do Compels', async () => {
      const { erp } = fingir()
      const r = await enviarEntrada(erp, { ...ENTRADA, op: '8649_F', pmo: 'PMOC57_F' }, opcoes)
      expect(r.ok === false && r.erro).toContain('(PRT446) é diferente da PMO PMOC57_F')
    })

    it('OP que sem o sufixo não é número (PMOC50_) não é numérica: fica manual', async () => {
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
    expect(plano.apontar.quantidadeProduzida).toBe(55)
    expect(chamadas).not.toContain('adquirirTrava')
    expect(chamadas).not.toContain('apontar')
  })

  it('devolve o motivo quando a entrada não pode ser enviada', async () => {
    const { erp } = fingir({}, { buscarOp: async () => ({ ...OP, unidade: 'KG' }) })
    expect((await ensaiarEntrada(erp, ENTRADA, opcoes)).tipo).toBe('erro')
  })
})

describe('enviarEntrada — pagar pendência (a partir da 2ª tentativa por falta de saldo)', () => {
  // Detalhes mínimos no formato de `empenho/findById` e `requisicaoOrdemProducao/findById` (HAR de 06/11/2026).
  const OP_EMB = {
    id: 13027, numero: 8649, tipoPropriedade: 0, operacaoMista: false, negociante: { id: 1679 },
    composicaoProduto: { item: { id: 22078 } },
  }
  const detalheEmpenho = (pendente: number, rastreavel = false) => ({
    id: 7241, numero: 2, quantidade: 1000, quantidadeEmpenhada: 1000, quantidadeEstornar: 0, quantidadeRequisitada: 1000,
    ordemProducao: OP_EMB,
    itemEmpenhoOrdemProducaoList: [{
      id: 1, itemOrdemProducaoId: 138103, itemFantasma: false, item: { id: 12225, codigo: 'RWCI57', rastreavel },
      quantidadeEmpenhada: 1000 - pendente, quantidadeComposicao: 1000, quantidadePendente: pendente, ordemProducaoFilha: null,
    }],
  })
  const detalheRequisicao = (pendente: number, rastreavel = false) => ({
    data: {
      id: 18510, numero: 2, quantidade: 1000, ordemProducao: OP_EMB,
      itemRequisicaOrdemProducaoList: [{
        id: 2, itemOrdemProducaoId: 138103, itemFantasma: false, item: { id: 12225, codigo: 'RWCI57', rastreavel },
        quantidade: 1000 - pendente, quantidadeComposicaoCalculada: 1000, quantidadePendente: pendente, ordemProducaoFilha: null,
      }],
    },
  })
  const pendentes: Partial<LeiturasOp> = {
    empenhos: [{ id: 7241, quantidade: 1000, quantidadeEstornar: 0, situacao: 'Pendente' }],
    requisicoes: [{ id: 18510, quantidade: 1000, quantidadeEstornar: 0, situacao: 'Pendente' }],
  }
  const semEspera = { ...opcoes, esperar: async () => {} }

  /** Compels em que o saldo requisitado só aparece depois de pagar a pendência da REQUISIÇÃO (como no HAR). */
  function comPendencia(o: { inicial?: Partial<LeiturasOp>; processaEm?: number; desvios?: Partial<PortaErp>; rastreavel?: boolean } = {}) {
    let pagouRequisicao = false
    let consultasDepois = 0
    const base = fingir(o.inicial ?? pendentes)
    const erp: PortaErp = {
      ...base.erp,
      async consultarDisponibilidade(_op, q) {
        base.chamadas.push('consultarDisponibilidade')
        if (pagouRequisicao) consultasDepois++
        const processou = pagouRequisicao && consultasDepois >= (o.processaEm ?? 1)
        return [linhaDisp(q, processou ? 1000 : 0)]
      },
      async lerEmpenho() { base.chamadas.push('lerEmpenho'); return detalheEmpenho(178, o.rastreavel) },
      async lerRequisicao() { base.chamadas.push('lerRequisicao'); return detalheRequisicao(498, o.rastreavel) },
      async pagarPendenciaEmpenho() { base.chamadas.push('pagarPendenciaEmpenho'); return OK },
      async pagarPendenciaRequisicao() { base.chamadas.push('pagarPendenciaRequisicao'); pagouRequisicao = true; return OK },
      ...o.desvios,
    }
    return { erp, chamadas: base.chamadas }
  }

  it('1ª tentativa (pagarPendencia desligado): só espera, NÃO paga nada', async () => {
    const { erp, chamadas } = comPendencia()
    const r = await enviarEntrada(erp, ENTRADA, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('Aguardando requisição no Compels')
    expect(chamadas).not.toContain('pagarPendenciaEmpenho')
    expect(chamadas).not.toContain('pagarPendenciaRequisicao')
    expect(chamadas).not.toContain('apontar')
  })

  it('2ª tentativa: paga empenho e depois requisição, relê, aponta e avisa o que pagou', async () => {
    const { erp, chamadas } = comPendencia()
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r.ok).toBe(true)
    expect(r.ok && r.aviso).toContain('pendência paga automaticamente no Compels (empenho nº 2: RWCI57 +178; requisição nº 2: RWCI57 +498)')
    expect(chamadas).toEqual([
      'buscarOp', 'adquirirTrava', 'lerOp', 'consultarDisponibilidade',
      'lerOp', 'lerEmpenho', 'pagarPendenciaEmpenho', 'lerRequisicao', 'pagarPendenciaRequisicao',
      'lerOp', 'consultarDisponibilidade', 'apontar', 'lerOp', 'liberarTrava',
    ])
  })

  it('o Compels demora a processar: relê até 4 vezes com pausa; se resolver na 3ª, aponta', async () => {
    const pausas: number[] = []
    const { erp, chamadas } = comPendencia({ processaEm: 3 })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, { ...opcoes, esperar: async (ms) => { pausas.push(ms) } })
    expect(r.ok).toBe(true)
    expect(pausas).toEqual([3000, 3000, 3000])
    expect(chamadas.filter((c) => c === 'apontar')).toHaveLength(1)
  })

  it('pagou mas o Compels não processou nas 4 releituras: espera (sem gastar tentativa) e diz que pagou', async () => {
    const { erp, chamadas } = comPendencia({ processaEm: 99 })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true, tentarDeNovo: true })
    expect(r.ok === false && r.erro).toContain('Pendência paga no Compels (empenho nº 2: RWCI57 +178; requisição nº 2: RWCI57 +498)')
    expect(chamadas).not.toContain('apontar')
    expect(chamadas.at(-1)).toBe('liberarTrava')
  })

  it('falta saldo mas nada está Pendente (requisição menor que o preciso): não paga nada, só espera', async () => {
    const { erp, chamadas } = comPendencia({ inicial: {} })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).not.toContain('Pendência paga')
    expect(chamadas).not.toContain('pagarPendenciaEmpenho')
    expect(chamadas).not.toContain('pagarPendenciaRequisicao')
  })

  it('o Compels recusa o pagamento: não aponta e devolve a mensagem dele', async () => {
    const { erp, chamadas } = comPendencia({
      desvios: { pagarPendenciaRequisicao: async () => ({ ok: false, codigo: 'sem_saldo', mensagem: 'Saldo insuficiente do item PRT706', tentarDeNovo: true }) },
    })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('Não consegui pagar a pendência no Compels (requisição nº 2: RWCI57 +498): Saldo insuficiente do item PRT706')
    expect(chamadas).not.toContain('apontar')
  })

  it('componente rastreável pendente: não paga a requisição, espera e manda pagar à mão', async () => {
    const { erp, chamadas } = comPendencia({ rastreavel: true })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('rastreável')
    expect(chamadas).not.toContain('pagarPendenciaRequisicao')
    expect(chamadas).not.toContain('apontar')
  })

  it('porta sem os métodos de pendência (ERP antigo/teste): segue como antes, só espera', async () => {
    const { erp, chamadas } = fingir(pendentes, { consultarDisponibilidade: async (_op, q) => [linhaDisp(q, 0)] })
    const r = await enviarEntrada(erp, { ...ENTRADA, pagarPendencia: true }, semEspera)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(chamadas).not.toContain('apontar')
  })
})
