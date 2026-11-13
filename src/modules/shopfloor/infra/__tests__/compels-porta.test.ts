import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import type { ComponenteApontamento } from '@/modules/compels/domain/corpos'
import type { LeiturasOp } from '@/modules/compels/domain/estado-op'
import type { PortaErp } from '@/modules/compels/application/enviar-entrada'
import type { DadosOp } from '@/modules/compels/infra/cliente'
import type { EnvioEstoqueReservado } from '../../application/enviar-estoque'
import { criarPortaCompels } from '../compels'

/** Sem ponto de partida guardado: o comportamento de uma OP que a integração ainda não tocou. */
const SEM_BASE = { ler: async () => null, guardar: async () => {} }

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
  const disp = (q: number): ComponenteApontamento => ({
    itemId: 1, codigo: 'C1', quantidadeUtilizada: q, quantidadeComposicao: 1, itemOrdemProducaoId: 9,
    itemFantasma: false, saldoDisponivel: 100,
  })
  const erp: PortaErp = {
    async buscarOp() { chamadas.push('buscarOp'); return OP },
    async lerOp() { chamadas.push('lerOp'); return structuredClone(estado) },
    async adquirirTrava() { chamadas.push('trava'); return OK },
    async liberarTrava() { chamadas.push('libera') },
    async consultarDisponibilidade(_o, q) { chamadas.push('consultaDisp'); return [disp(q)] },
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
    const porta = criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: soma })
    expect(await porta(linha())).toMatchObject({ ok: true })
    expect(soma).toHaveBeenCalledWith('PRT446', '8649', 'id-1')
    expect(chamadas).toContain('apontar')
    expect(chamadas).toContain('apontar')
  })

  it('OP com sufixo (8649_F): libera por 8649, grava na OP 8649 e soma também o já enviado pela OP sem sufixo', async () => {
    const { erp, chamadas } = erpFalso()
    const soma = vi.fn(async () => 0)
    const porta = criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: soma })
    expect(await porta(linha({ op: '8649_F', pmo: 'PRT446_F' }))).toMatchObject({ ok: true })
    expect(soma).toHaveBeenCalledWith('PRT446_F', '8649_F', 'id-1')
    expect(soma).toHaveBeenCalledWith('PRT446', '8649', 'id-1')
    expect(chamadas).toContain('apontar')
  })

  it('OP com sufixo: o acumulado é a soma das duas, e o ERP tem que mostrar essa soma', async () => {
    const { erp } = erpFalso({
      requisicoes: [{ quantidade: 3, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 3, quantidadeCancelada: 0 }],
    })
    const soma = vi.fn(async (_pmo: string, op: string) => (op === '8649' ? 2 : 1))
    const r = await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: soma })(linha({ op: '8649_F', pmo: 'PRT446_F' }))
    expect(r).toMatchObject({ ok: true })
  })

  it('o acumulado vem do banco: a 2ª peça (acumulado 1) só pode ser enviada com o ERP mostrando 1', async () => {
    const { erp } = erpFalso({
      requisicoes: [{ quantidade: 1, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 1, quantidadeCancelada: 0 }],
    })
    const porta = criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 1 })
    expect(await porta(linha({ id: 'id-2' }))).toMatchObject({ ok: true })
  })

  it('ERP com apontado diferente do que mandamos: GRAVA e devolve o aviso de quantidade inesperada', async () => {
    // mandamos 2 antes; o ERP mostra 4 (alguém apontou à mão) e a entrada nova é de 5 (acumulado 7)
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 40, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 4, quantidadeCancelada: 0 }],
    })
    const r = await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 2 })(linha({ quantidade: 5 }))
    expect(r).toMatchObject({ ok: true })
    expect(r.ok && r.aviso).toContain('quantidade inesperada no Compels')
    expect(r.ok && r.aviso).toContain('mostra 4 apontadas, esperado 2')
    expect(chamadas).toContain('apontar')
  })

  it('ERP que JÁ cobre a entrada (ex.: resposta perdida num envio anterior): ok, sem gravar de novo', async () => {
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 3, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 3, quantidadeCancelada: 0 }],
    })
    // Acumulado anterior 2 + esta entrada (1) = 3: o ERP está EXATAMENTE nele.
    expect(await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 2 })(linha())).toMatchObject({ ok: true })
    expect(chamadas).not.toContain('apontar')
  })

  it('OP com 22 apontadas de fora e nada enviado por nós: guarda 22 como ponto de partida (chave = OP do Compels) e grava', async () => {
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 22, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 22, quantidadeCancelada: 0 }],
    })
    const guardadas: [string, number][] = []
    const base = { ler: async () => null, guardar: async (op: string, valor: number) => { guardadas.push([op, valor]) } }
    const r = await criarPortaCompels({ env: AMBIENTE, erp, base, somaEnviada: async () => 0 })(linha())
    expect(r).toMatchObject({ ok: true })
    expect(guardadas).toEqual([['8649', 22]])
    expect(chamadas).toContain('apontar')
  })

  it('ponto de partida já guardado (22) e o ERP em 25: apontamento de fora depois dele, grava e avisa os 3 a mais', async () => {
    const { erp, chamadas } = erpFalso({
      requisicoes: [{ quantidade: 25, quantidadeEstornar: 0, situacao: 'Requisitada' }],
      apontamentos: [{ quantidadeProduzida: 25, quantidadeCancelada: 0 }],
    })
    const base = { ler: async () => 22, guardar: async () => {} }
    const r = await criarPortaCompels({ env: AMBIENTE, erp, base, somaEnviada: async () => 0 })(linha())
    expect(r.ok).toBe(true)
    expect(r.ok && r.aviso).toContain('a mais: 3')
    expect(chamadas).toContain('apontar')
  })

  describe('estoque de destino (0175)', () => {
    const EINTER = { COMPELS_ESTOQUE_EINTER_ID: '301', COMPELS_LOCACAO_EINTER_ID: '7001' }

    /** O que o apontamento levou como estoque e locação (campos do corpo que o ERP recebeu). */
    function destinoGravado() {
      const corpos: Record<string, unknown>[] = []
      const { erp, chamadas } = erpFalso()
      const apontar = erp.apontar.bind(erp)
      erp.apontar = async (c) => {
        corpos.push(c as unknown as Record<string, unknown>)
        return apontar(c)
      }
      return { erp, chamadas, corpos }
    }
    it('linha PA (e linha sem o campo, como as de antes) grava no destino de sempre: 217/5314', async () => {
      for (const estoque of [undefined, 'PA' as const]) {
        const { erp, corpos } = destinoGravado()
        const r = await criarPortaCompels({ env: { ...AMBIENTE, ...EINTER }, erp, base: SEM_BASE, somaEnviada: async () => 0 })(
          linha({ estoque }),
        )
        expect(r).toMatchObject({ ok: true }) // pode vir com `aviso` (empenho/requisição do cenário)
        expect(corpos).toHaveLength(1)
        expect(JSON.stringify(corpos[0])).toContain('217')
        expect(JSON.stringify(corpos[0])).not.toContain('301')
      }
    })

    it('linha EINTER grava no estoque e na locação do EINTER, nunca no PA', async () => {
      const { erp, corpos } = destinoGravado()
      const r = await criarPortaCompels({ env: { ...AMBIENTE, ...EINTER }, erp, base: SEM_BASE, somaEnviada: async () => 0 })(
        linha({ estoque: 'EINTER' }),
      )
      expect(r).toMatchObject({ ok: true }) // pode vir com `aviso` (empenho/requisição do cenário)
      const texto = JSON.stringify(corpos[0])
      expect(texto).toContain('301')
      expect(texto).toContain('7001')
      expect(texto).not.toContain('217')
      expect(texto).not.toContain('5314')
    })

    it('linha EINTER SEM as variáveis: espera com mensagem de configuração, sem chamar o ERP nem o banco', async () => {
      const { erp, chamadas } = destinoGravado()
      const soma = vi.fn(async () => 0)
      const r = await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: soma })(linha({ estoque: 'EINTER' }))
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(r.ok === false && r.erro).toContain('EINTER ainda não está configurado')
      expect(chamadas).toEqual([])
      expect(soma).not.toHaveBeenCalled()
    })

    it('uma linha PA na mesma rodada não é afetada por uma EINTER que esperou', async () => {
      const { erp, corpos } = destinoGravado()
      const porta = criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 0 })
      expect(await porta(linha({ id: 'a', estoque: 'EINTER' }))).toMatchObject({ ok: false, aguardar: true })
      expect(await porta(linha({ id: 'b', op: '8650', estoque: 'PA' }))).toMatchObject({ ok: false }) // OP 8650 não liberada
      expect(await porta(linha({ id: 'c', estoque: 'PA' }))).toMatchObject({ ok: true })
      expect(corpos).toHaveLength(1)
    })

    it('o estorno de uma entrada EINTER segue manual (não grava nada) e sem gastar tentativa', async () => {
      const { erp, chamadas } = destinoGravado()
      const r = await criarPortaCompels({ env: { ...AMBIENTE, ...EINTER }, erp, base: SEM_BASE, somaEnviada: async () => 0 })(
        linha({ operacao: 'estorno', estoque: 'EINTER' }),
      )
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(chamadas).toEqual([])
    })
  })

  it('estorno: ainda manual, visível, e NÃO gasta tentativa', async () => {
    const { erp, chamadas } = erpFalso()
    const r = await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 0 })(linha({ operacao: 'estorno' }))
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('estorno no Compels ainda é manual')
    // ESPERADO: o alerta de problemas do Compels não conta isto (0170, erro_esperado)
    expect(r).toMatchObject({ esperado: true })
    expect(chamadas).toEqual([])
  })

  it('OP fora da lista liberada: espera, sem chamar o ERP nem o banco', async () => {
    const { erp, chamadas } = erpFalso()
    const soma = vi.fn(async () => 0)
    const r = await criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: '9999' }, erp, base: SEM_BASE, somaEnviada: soma, opIntegrada: async () => false })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('OP 8649 ainda não está liberada')
    expect(r).toMatchObject({ esperado: true })
    expect(chamadas).toEqual([])
    expect(soma).not.toHaveBeenCalled()
  })

  describe('OP criada a partir de 09/11/2026 (sf_ordens.integrar_compels, 0176)', () => {
    const FORA_DA_LISTA = { ...AMBIENTE, COMPELS_OPS_LIBERADAS: '9999' }

    it('OP nova (true) fora da lista: fica liberada e envia, consultando a OP pelo pmo e op da linha', async () => {
      const { erp, chamadas } = erpFalso()
      const consulta = vi.fn(async () => true)
      const r = await criarPortaCompels({ env: FORA_DA_LISTA, erp, base: SEM_BASE, somaEnviada: async () => 0, opIntegrada: consulta })(linha())
      expect(r).toMatchObject({ ok: true })
      expect(consulta).toHaveBeenCalledWith('PRT446', '8649')
      expect(chamadas).toContain('apontar')
    })

    it('OP antiga (false) fora da lista: continua esperando, como esperada', async () => {
      const { erp, chamadas } = erpFalso()
      const r = await criarPortaCompels({ env: FORA_DA_LISTA, erp, base: SEM_BASE, somaEnviada: async () => 0, opIntegrada: async () => false })(linha())
      expect(r).toMatchObject({ ok: false, aguardar: true, esperado: true })
      expect(r.ok === false && r.erro).toContain('OP 8649 ainda não está liberada')
      expect(chamadas).toEqual([])
    })

    it('OP na lista: libera sem consultar o banco', async () => {
      const { erp } = erpFalso()
      const consulta = vi.fn(async () => false)
      const r = await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 0, opIntegrada: consulta })(linha())
      expect(r).toMatchObject({ ok: true })
      expect(consulta).not.toHaveBeenCalled()
    })

    it('erro ao ler a OP no banco: espera (aguardar), sem chamar o ERP e sem marcar como esperado', async () => {
      const { erp, chamadas } = erpFalso()
      const r = await criarPortaCompels({
        env: FORA_DA_LISTA, erp, base: SEM_BASE, somaEnviada: async () => 0,
        opIntegrada: async () => { throw new Error('sf_ordens (integrar_compels): conexão recusada') },
      })(linha())
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(r).not.toHaveProperty('esperado')
      expect(r.ok === false && r.erro).toContain('conexão recusada')
      expect(chamadas).toEqual([])
    })
  })

  it('lista de OPs liberadas vazia ou ausente = nenhuma OP é enviada', async () => {
    const { erp, chamadas } = erpFalso()
    for (const lista of [undefined, '']) {
      const r = await criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: lista }, erp, base: SEM_BASE, somaEnviada: async () => 0, opIntegrada: async () => false })(linha())
      expect(r).toMatchObject({ ok: false, aguardar: true, esperado: true })
    }
    expect(chamadas).toEqual([])
  })

  it('sem as variáveis do ezpointweb: espera com mensagem clara (e não derruba a rodada)', async () => {
    const r = await criarPortaCompels({ env: { COMPELS_OPS_LIBERADAS: '*' }, base: SEM_BASE, somaEnviada: async () => 0 })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect(r.ok === false && r.erro).toContain('não configurada neste ambiente')
    expect(r.ok === false && r.erro).toContain('COMPELS_EZPOINT_USUARIO')
    expect(r).toMatchObject({ esperado: true })
  })

  it('erro do banco ao somar: espera, nada foi gravado no ERP', async () => {
    const { erp, chamadas } = erpFalso()
    const r = await criarPortaCompels({
      env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => { throw new Error('sf_estoque_enviado: connection refused') },
    })(linha())
    expect(r).toMatchObject({ ok: false, aguardar: true })
    // este É problema a alertar (banco fora): nunca marcado como esperado
    expect(r).not.toHaveProperty('esperado')
    expect(chamadas).toEqual([])
  })

  it('OP em uso: espera, e as OUTRAS linhas da mesma OP na rodada recebem a mesma resposta sem chamar o ERP', async () => {
    const trava = vi.fn(async () => ({ ok: false as const, codigo: 'op_em_uso' as const, mensagem: 'Este registro está sendo acessado pelo usuário fulano !', tentarDeNovo: true }))
    const { erp, chamadas } = erpFalso({}, { adquirirTrava: trava })
    const porta = criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 0 })

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
    const porta = criarPortaCompels({ env: { ...AMBIENTE, COMPELS_OPS_LIBERADAS: '8649,8650' }, erp, base: SEM_BASE, somaEnviada: async () => 0 })
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
    await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: async () => 0 })(linha({ chave: 'x'.repeat(300) }))
    expect(String(corpo.observacao).startsWith('ShopFloor xxx')).toBe(true)
    expect(String(corpo.observacao).length).toBeLessThanOrEqual(100)
  })
})

// O backfill da 0170 marca as linhas que JÁ estão na fila pelas frases que o app gravava até hoje. Se alguém
// reescrever uma dessas frases em compels.ts sem mexer na migração, a linha antiga deixaria de ser reconhecida
// (e o alerta inundaria o responsável) — este teste prende as duas pontas.
describe('frases da espera esperada × backfill da 0170', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/0170_alerta_problemas_compels.sql'),
    'utf8',
  )
  const padroes = [...sql.matchAll(/erro like '([^']+)'/g)].map((m) => m[1]!)
  const regex = (like: string) =>
    new RegExp('^' + like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.'))

  it('a migração tem os três padrões', () => {
    expect(padroes).toHaveLength(3)
  })

  it('cada espera esperada que a porta devolve casa com algum padrão do backfill', async () => {
    const { erp } = erpFalso()
    const porta = (env: Record<string, string | undefined>) =>
      criarPortaCompels({ env, erp, base: SEM_BASE, somaEnviada: async () => 0, opIntegrada: async () => false })
    const esperas = [
      await porta(AMBIENTE)(linha({ operacao: 'estorno' })),
      await porta({ ...AMBIENTE, COMPELS_OPS_LIBERADAS: '9999' })(linha()),
      await criarPortaCompels({ env: { COMPELS_OPS_LIBERADAS: '*' }, base: SEM_BASE, somaEnviada: async () => 0 })(linha()),
    ]
    for (const r of esperas) {
      expect(r).toMatchObject({ ok: false, esperado: true })
      const erro = r.ok === false ? r.erro : ''
      expect(padroes.some((p) => regex(p).test(erro)), erro).toBe(true)
    }
  })

  describe('pagar pendência só a partir da 2ª tentativa', () => {
    // Falta saldo requisitado e o empenho/requisição estão Pendentes; pagar a requisição resolve.
    function erpComPendencia() {
      let pago = false
      const { erp, chamadas } = erpFalso({
        empenhos: [{ id: 1, quantidade: 1000, quantidadeEstornar: 0, situacao: 'Empenhada' }],
        requisicoes: [{ id: 18510, quantidade: 1000, quantidadeEstornar: 0, situacao: 'Pendente' }],
      }, {
        async consultarDisponibilidade(_o, q) {
          chamadas.push('consultaDisp')
          return [{ itemId: 1, codigo: 'C1', quantidadeUtilizada: q, quantidadeComposicao: 1, itemOrdemProducaoId: 9, itemFantasma: false, saldoDisponivel: pago ? 100 : 0 }]
        },
        async lerEmpenho() { return {} },
        async lerRequisicao() {
          chamadas.push('lerRequisicao')
          return {
            id: 18510, numero: 2, quantidade: 1000,
            ordemProducao: { id: 13027, numero: 8649, tipoPropriedade: 0, negociante: { id: 1679 }, composicaoProduto: { item: { id: 22078 } } },
            itemRequisicaOrdemProducaoList: [{
              id: 2, itemOrdemProducaoId: 9, item: { id: 1, codigo: 'C1' }, quantidade: 0, quantidadeComposicaoCalculada: 1000, quantidadePendente: 1000,
            }],
          }
        },
        async pagarPendenciaEmpenho() { return OK },
        async pagarPendenciaRequisicao() { chamadas.push('pagarRequisicao'); pago = true; return OK },
      })
      return { erp, chamadas }
    }
    const LIGADO = { ...AMBIENTE, COMPELS_PAGAR_PENDENCIA: '1' }
    const soma = async () => 0

    it('1ª vez que falta saldo (linha sem erro anterior): só espera, não paga', async () => {
      const { erp, chamadas } = erpComPendencia()
      const r = await criarPortaCompels({ env: LIGADO, erp, base: SEM_BASE, somaEnviada: soma, erroAnterior: async () => null })(linha())
      expect(r).toMatchObject({ ok: false, aguardar: true })
      expect(chamadas).not.toContain('pagarRequisicao')
    })

    it('2ª tentativa depois de "Aguardando requisição": paga a pendência e aponta', async () => {
      const { erp, chamadas } = erpComPendencia()
      const anterior = async () => 'Aguardando requisição no Compels: C1 (precisa 1, requisitado disponível 0).'
      const r = await criarPortaCompels({ env: LIGADO, erp, base: SEM_BASE, somaEnviada: soma, erroAnterior: anterior })(linha())
      expect(r).toMatchObject({ ok: true })
      expect(r.ok && r.aviso).toContain('pendência paga automaticamente')
      expect(chamadas).toContain('pagarRequisicao')
      expect(chamadas).toContain('apontar')
    }, 20_000)

    it('erro anterior de OUTRO tipo (OP em uso): não paga', async () => {
      const { erp, chamadas } = erpComPendencia()
      const anterior = async () => 'Este registro está sendo acessado pelo usuário X!'
      await criarPortaCompels({ env: LIGADO, erp, base: SEM_BASE, somaEnviada: soma, erroAnterior: anterior })(linha())
      expect(chamadas).not.toContain('pagarRequisicao')
    })

    it('chave desligada: nem consulta o erro anterior, e não paga', async () => {
      const { erp, chamadas } = erpComPendencia()
      const anterior = vi.fn(async () => 'Aguardando requisição no Compels: C1.')
      await criarPortaCompels({ env: AMBIENTE, erp, base: SEM_BASE, somaEnviada: soma, erroAnterior: anterior })(linha())
      expect(anterior).not.toHaveBeenCalled()
      expect(chamadas).not.toContain('pagarRequisicao')
    })
  })
})

describe('linhas de PRT (estrutura da OP)', () => {
  const linhaPrt = linha({ pmo: 'PRT420', op: '8499', ordemId: 'ord-1' })

  it('chave COMPELS_PRT_LIGADO ausente → espera, com motivo próprio', async () => {
    const porta = criarPortaCompels({ env: { COMPELS_OPS_LIBERADAS: '*' }, ordemDaLinha: async () => ({ op: '8498', integrar: true }) })
    expect(await porta(linhaPrt)).toEqual({
      ok: false, aguardar: true, esperado: true,
      erro: 'Apontamento das PRTs ainda desligado: a linha fica esperando até a chave COMPELS_PRT_LIGADO ser ligada.',
    })
  })

  it('chave ligada, OP-pai não liberada → espera com o número da OP do ShopFloor', async () => {
    const porta = criarPortaCompels({ env: { COMPELS_PRT_LIGADO: '1' }, ordemDaLinha: async () => ({ op: '8498', integrar: false }) })
    const r = await porta(linhaPrt)
    expect(r).toMatchObject({ ok: false, aguardar: true, esperado: true })
    expect((r as { erro: string }).erro).toBe('OP 8498 ainda não está liberada para a integração com o Compels (PRT420 da OP 8499). Faça a entrada à mão no ERP, ou libere a OP.')
  })

  const FILHA_NAO_ACHADA = {
    ok: false, aguardar: true, esperado: true,
    erro: 'PRT420 não tem OP filha no Compels: confira a estrutura e salve a OP 8498 de novo para procurar.',
  }

  it('OP filha não encontrada no trecho (null ou vazia) → espera com orientação, mesmo com op antiga na linha', async () => {
    for (const filha of [null, '', '  ']) {
      const { erp, chamadas } = erpFalso()
      const porta = criarPortaCompels({
        env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' }, erp,
        ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual: async () => filha,
      })
      expect(await porta(linhaPrt)).toEqual(FILHA_NAO_ACHADA)
      expect(chamadas).toEqual([])
    }
  })

  it('a filha é lida do trecho da OP pelo código da PRT', async () => {
    const filhaAtual = vi.fn(async () => null)
    const porta = criarPortaCompels({
      env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' },
      ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual,
    })
    await porta(linhaPrt)
    expect(filhaAtual).toHaveBeenCalledWith('ord-1', 'PRT420')
  })

  it('falha ao ler a filha → espera (nada foi gravado)', async () => {
    const { erp, chamadas } = erpFalso()
    const porta = criarPortaCompels({
      env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' }, erp,
      ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual: async () => { throw new Error('rede') },
    })
    expect(await porta(linhaPrt)).toMatchObject({ ok: false, aguardar: true })
    expect(chamadas).toEqual([])
  })

  it('ordemDaLinha falha → espera, sem chamar o ERP', async () => {
    const { erp, chamadas } = erpFalso()
    const porta = criarPortaCompels({
      env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' }, erp,
      ordemDaLinha: async () => { throw new Error('rede') }, filhaAtual: async () => '8499',
    })
    const r = await porta(linhaPrt)
    expect(r).toMatchObject({ ok: false, aguardar: true })
    expect((r as { erro: string }).erro).toContain('Não foi possível conferir a OP da PRT PRT420')
    expect(chamadas).toEqual([])
  })

  it('OP-pai não existe mais (null) → espera, sem chamar o ERP', async () => {
    const { erp, chamadas } = erpFalso()
    const porta = criarPortaCompels({
      env: { COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '*' }, erp,
      ordemDaLinha: async () => null, filhaAtual: async () => '8499',
    })
    expect(await porta(linhaPrt)).toMatchObject({ ok: false, aguardar: true, esperado: true })
    expect(chamadas).toEqual([])
  })

  describe('caminho feliz', () => {
    const EINTER = { COMPELS_ESTOQUE_EINTER_ID: '301', COMPELS_LOCACAO_EINTER_ID: '7001' }
    const ENV = { ...AMBIENTE, ...EINTER, COMPELS_PRT_LIGADO: '1', COMPELS_OPS_LIBERADAS: '' }
    // A OP do erpFalso é a 8649 com o código PRT446: a linha da PRT446 com a filha 8649.
    const linhaFeliz = linha({ pmo: 'PRT446', op: '8649', ordemId: 'ord-1', estoque: 'EINTER' })

    function erpQueRegistra() {
      const { erp, chamadas } = erpFalso()
      const buscadas: number[] = []
      const corpos: string[] = []
      const buscarOp = erp.buscarOp.bind(erp)
      const apontar = erp.apontar.bind(erp)
      erp.buscarOp = async (n) => { buscadas.push(n); return buscarOp(n) }
      erp.apontar = async (c) => { corpos.push(JSON.stringify(c)); return apontar(c) }
      return { erp, chamadas, buscadas, corpos }
    }

    it('OP-pai liberada pela coluna: aponta na filha, no EINTER, e soma pela PRT + filha', async () => {
      const { erp, buscadas, corpos } = erpQueRegistra()
      const soma = vi.fn(async () => 0)
      const trocarOpDaLinha = vi.fn(async () => {})
      const porta = criarPortaCompels({
        env: ENV, erp, base: SEM_BASE, somaEnviada: soma, trocarOpDaLinha,
        ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual: async () => '8649',
      })
      expect(await porta(linhaFeliz)).toMatchObject({ ok: true })
      expect(buscadas).toEqual([8649])
      expect(corpos).toHaveLength(1)
      expect(corpos[0]).toContain('301')
      expect(corpos[0]).toContain('7001')
      expect(corpos[0]).not.toContain('217')
      expect(soma).toHaveBeenCalledWith('PRT446', '8649', 'id-1')
      expect(trocarOpDaLinha).not.toHaveBeenCalled()
    })

    it('op ANTIGA na linha: envia para a filha atual do trecho e regrava a op da linha', async () => {
      const { erp, buscadas } = erpQueRegistra()
      const soma = vi.fn(async () => 0)
      const trocarOpDaLinha = vi.fn(async () => {})
      const porta = criarPortaCompels({
        env: ENV, erp, base: SEM_BASE, somaEnviada: soma, trocarOpDaLinha,
        ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual: async () => '8649',
      })
      expect(await porta({ ...linhaFeliz, op: '8000' })).toMatchObject({ ok: true })
      expect(buscadas).toEqual([8649])
      expect(soma).toHaveBeenCalledWith('PRT446', '8649', 'id-1')
      expect(trocarOpDaLinha).toHaveBeenCalledWith('id-1', '8649')
    })

    it('regravar a op da linha falha: o envio segue para a filha atual (melhor esforço)', async () => {
      const { erp, buscadas } = erpQueRegistra()
      const porta = criarPortaCompels({
        env: ENV, erp, base: SEM_BASE, somaEnviada: async () => 0,
        trocarOpDaLinha: async () => { throw new Error('rede') },
        ordemDaLinha: async () => ({ op: '8498', integrar: true }), filhaAtual: async () => '8649',
      })
      expect(await porta({ ...linhaFeliz, op: '' })).toMatchObject({ ok: true })
      expect(buscadas).toEqual([8649])
    })
  })
})
