import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import type { ComponenteApontamento, ComponenteRequisicao } from '@/modules/compels/domain/corpos'
import type { LeiturasOp } from '@/modules/compels/domain/estado-op'
import type { PortaErp } from '@/modules/compels/application/enviar-entrada'
import type { DadosOp } from '@/modules/compels/infra/cliente'
import type { EnvioEstoqueReservado } from '../../application/enviar-estoque'
import { criarPortaCompels } from '../compels'

const OP: DadosOp = {
  id: 13027, numero: 8649, status: 'Empenhada', tipoPropriedade: 0, quantidade: 1000,
  produtoId: 22078, negocianteId: 1679, codigoItem: 'PRT446', unidade: 'UN',
}
const OK = { ok: true as const, mensagem: 'feito' }
const AMBIENTE = {
  COMPELS_EZPOINT_USUARIO: 'u', COMPELS_EZPOINT_SENHA: 'p', COMPELS_OPS_LIBERADAS: '8649',
}

function linha(p: Partial<EnvioEstoqueReservado> = {}): EnvioEstoqueReservado {
  return {
    id: 'id-1', chave: 'ALMOX/PRT446/8649/Almoxarifado/SN1/E1', operacao: 'entrada', pmo: 'PRT446', op: '8649',
    posto: 'Almoxarifado', tipo: 'serie', bipe: 'SN1', serieNorm: 'SN1', quantidade: 1, tentativas: 1,
    criadoEm: '2026-10-19T10:00:00Z', ...p,
  }
}

/** ERP de mentira com o estado que o Compels teria depois de cada gravação. */
function erpFalso(estadoInicial: Partial<LeiturasOp> = {}, desvios: Partial<PortaErp> = {}) {
  const chamadas: string[] = []
  const estado: LeiturasOp = {
    status: 'Empenhada', tipoPropriedade: 0, quantidadeOp: 1000,
    empenhos: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Empenhada' }],
    requisicoes: [], apontamentos: [], ...estadoInicial,
  }
  const req = (q: number): ComponenteRequisicao => ({
    itemId: 1, codigo: 'C1', rastreavel: false, precoCusto: 1, quantidadeRequisitar: q, quantidadeComposicao: q,
    quantidadeRequisitadaDisponivel: 0, itemOrdemProducaoId: 9, itemFantasma: false, saldo: 100,
  })
  const disp = (q: number): ComponenteApontamento => ({
    itemId: 1, codigo: 'C1', quantidadeUtilizada: q, quantidadeComposicao: 1, itemOrdemProducaoId: 9,
    itemFantasma: false, saldoDisponivel: 0,
  })
  const erp: PortaErp = {
    async buscarOp() { chamadas.push('buscarOp'); return OP },
    async lerOp() { chamadas.push('lerOp'); return structuredClone(estado) },
    async adquirirTrava() { chamadas.push('trava'); return OK },
    async liberarTrava() { chamadas.push('libera') },
    async consultarRequisicao(_o, q) { chamadas.push('consultaReq'); return [req(q)] },
    async consultarDisponibilidade(_o, q) { chamadas.push('consultaDisp'); return [disp(q)] },
    async requisitar(c) {
      chamadas.push('requisitar')
      estado.requisicoes = [...estado.requisicoes, { quantidade: Number(c.quantidade), quantidadeEstornar: 0, situacao: 'Requisitada' }]
      return OK
    },
    async apontar(c) {
      chamadas.push('apontar')
      estado.apontamentos = [...estado.apontamentos, { quantidadeProduzida: Number(c.quantidadeProduzida), quantidadeCancelada: 0 }]
      return OK
    },
    ...desvios,
  }
  return { erp, chamadas }
}

describe('criarPortaCompels', () => {
  it('entrega uma linha: soma o já enviado, grava e devolve ok', async () => {
    const { erp, chamadas } = erpFalso()
    const soma = vi.fn(async () => 0)
    const porta = criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: soma })
    expect(await porta(linha())).toEqual({ ok: true })
    expect(soma).toHaveBeenCalledWith('PRT446', '8649', 'id-1')
    expect(chamadas).toContain('requisitar')
    expect(chamadas).toContain('apontar')
  })

  it('o acumulado vem do banco: a 2ª peça (acumulado 1) só pode ser enviada com o ERP mostrando 1', async () => {
    const { erp } = erpFalso({
      requisicoes: [{ quantidade: 1, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 1, quantidadeCancelada: 0 }],
    })
    const porta = criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 1 })
    expect(await porta(linha({ id: 'id-2' }))).toEqual({ ok: true })
  })

  it('ERP com apontado diferente do que mandamos: para, sem gravar e GASTA tentativa (precisa de gente)', async () => {
    // mandamos 2 antes; o ERP mostra 4 (alguém apontou à mão) e a entrada nova é de 5 (acumulado 7)
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 4, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 4, quantidadeCancelada: 0 }],
    })
    const r = await criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 2 })(linha({ quantidade: 5 }))
    expect(r).toMatchObject({ ok: false })
    expect(r.ok === false && r.erro).toContain('fora do esperado')
    expect(r.ok === false && r.aguardar).toBeUndefined()
    expect(chamadas).not.toContain('apontar')
  })

  it('ERP que JÁ cobre a entrada (ex.: resposta perdida num envio anterior): ok, sem gravar de novo', async () => {
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 5, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 5, quantidadeCancelada: 0 }],
    })
    expect(await criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 2 })(linha())).toEqual({ ok: true })
    expect(chamadas).not.toContain('apontar')
  })

  it('estorno: ainda manual, visível, e NÃO gasta tentativa', async () => {
    const { erp, chamadas } = erpFalso()
    const r = await criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 0 })(linha({ operacao: 'estorno' }))
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('estorno no Compels ainda é manual')
    expect(chamadas).toEqual([])
  })

  it('OP fora da lista liberada: espera, sem chamar o ERP nem o banco', async () => {
    const { erp, chamadas } = erpFalso()
    const soma = vi.fn(async () => 0)
    const r = await criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: '9999' }, erp, somaEnviada: soma })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('OP 8649 ainda não está liberada')
    expect(chamadas).toEqual([])
    expect(soma).not.toHaveBeenCalled()
  })

  it('lista de OPs liberadas vazia ou ausente = nenhuma OP é enviada', async () => {
    const { erp, chamadas } = erpFalso()
    for (const lista of [undefined, '']) {
      const r = await criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: lista }, erp, somaEnviada: async () => 0 })(linha())
      expect(r).toMatchObject({ ok: false, aguardar: true })
    }
    expect(chamadas).toEqual([])
  })

  it('sem as variáveis do ezpointweb: espera com mensagem clara (e não derruba a rodada)', async () => {
    const r = await criarPortaCompels({ env: { COMPELS_OPS_LIBERADAS: '*' }, somaEnviada: async () => 0 })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('não configurada neste ambiente')
    expect(r.ok === false && r.erro).toContain('COMPELS_EZPOINT_USUARIO')
  })

  it('erro do banco ao somar: espera, nada foi gravado no ERP', async () => {
    const { erp, chamadas } = erpFalso()
    const r = await criarPortaCompels({
      env: AMBIENTE, erp, somaEnviada: async () => { throw new Error('sf_estoque_enviado: connection refused') },
    })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(chamadas).toEqual([])
  })

  it('OP em uso: espera, e as OUTRAS linhas da mesma OP na rodada recebem a mesma resposta sem chamar o ERP', async () => {
    const trava = vi.fn(async () => ({ ok: false as const, codigo: 'op_em_uso' as const, mensagem: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true }))
    const { erp, chamadas } = erpFalso({}, { adquirirTrava: trava })
    const porta = criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 0 })

    const a = await porta(linha({ id: 'a' }))
    const antes = chamadas.length
    const b = await porta(linha({ id: 'b' }))
    const c = await porta(linha({ id: 'c' }))

    expect(a).toMatchObject({ ok: false, aguardar: true })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(trava).toHaveBeenCalledTimes(1)
    expect(chamadas.length).toBe(antes) // nenhuma chamada nova ao ERP
  })

  it('o cache de espera é por OP: outra OP segue o seu caminho', async () => {
    const { erp } = erpFalso({}, { adquirirTrava: async () => ({ ok: false, codigo: 'op_em_uso', mensagem: 'em uso', tentarDeNovo: true }) })
    const porta = criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: '8649,8650' }, erp, somaEnviada: async () => 0 })
    await porta(linha())
    const outra = await porta(linha({ op: '8650', id: 'x' }))
    // a 8650 também chamou o ERP (o `buscarOp` do falso devolve a mesma OP) e recebeu a sua própria resposta
    expect(outra).toMatchObject({ ok: false, aguardar: true })
  })

  it('a marca do apontamento carrega a chave da linha, em até 100 caracteres', async () => {
    let corpo: Record<string, unknown> = {}
    const { erp } = erpFalso({}, {
      apontar: async (c) => { corpo = c; return OK },
      // a releitura do falso não vê esta gravação: o resultado aqui não importa, só a marca
    })
    await criarPortaCompels({ env: AMBIENTE, erp, somaEnviada: async () => 0 })(linha({ chave: 'x'.repeat(300) }))
    expect(String(corpo.observacao).startsWith('ShopFloor xxx')).toBe(true)
    expect(String(corpo.observacao).length).toBeLessThanOrEqual(100)
  })
})
