// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Perfil } from '@/modules/auth/domain/perfil'

vi.mock('server-only', () => ({}))

const { getSessao, registrarLog, revalidatePath, lerLinhaParaReenvio, liberarParaReenvio } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  registrarLog: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  lerLinhaParaReenvio: vi.fn(),
  liberarParaReenvio: vi.fn(async () => true),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/modules/shopfloor/infra/estoque-pendente-repository', () => ({
  lerLinhaParaReenvio,
  liberarParaReenvio,
}))

import { reenviarEstoqueAction } from '../estoque-pendente-actions'
import { TETO_TENTATIVAS, TENTATIVAS_APOS_REENVIO } from '../../domain/estoque-pendente'
import type { LinhaParaReenvio } from '../../infra/estoque-pendente-repository'

function perfil(porModulo: Partial<Record<string, Record<string, boolean>>>): Perfil {
  return {
    id: 'p1',
    nome: 'Teste',
    permissoes: {} as Perfil['permissoes'],
    porModulo: porModulo as Perfil['porModulo'],
    sistema: false,
  }
}

function sessao(perm: Record<string, boolean>) {
  return { usuarioId: 'u1', nome: 'Gestor', email: 'g@x', perfil: perfil({ shopfloor: perm }) }
}

/** Linha típica desta tela: gastou o teto e está fora da fila. */
function linhaTravada(over: Partial<LinhaParaReenvio> = {}): LinhaParaReenvio {
  return {
    id: 'l1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/E1',
    operacao: 'entrada',
    pmo: 'PMOA01',
    op: '9100',
    ok: false,
    canceladoEm: null,
    tentativas: TETO_TENTATIVAS,
    reservadoEm: null,
    quantidade: 3,
    estornado: 0,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  liberarParaReenvio.mockResolvedValue(true)
  lerLinhaParaReenvio.mockResolvedValue(linhaTravada())
  getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
})

describe('gate do Reenviar', () => {
  it('sem sessão, recusa e não toca na fila', async () => {
    getSessao.mockResolvedValue(null)
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para reenviar movimentações de estoque.' })
    expect(lerLinhaParaReenvio).not.toHaveBeenCalled()
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('com visualizar mas SEM administrar, recusa e não toca na fila', async () => {
    // Quem VÊ a tela não necessariamente pode agir nela: o botão nem é renderizado, mas a Server
    // Action é um POST público — o gate que vale é este.
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    const r = await reenviarEstoqueAction('l1')
    expect(r.ok).toBe(false)
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('administrar de OUTRO módulo não vale (a permissão é por módulo)', async () => {
    getSessao.mockResolvedValue({
      usuarioId: 'u1', nome: 'G', email: 'g@x',
      perfil: perfil({ recebimento: { administrar: true } }),
    })
    const r = await reenviarEstoqueAction('l1')
    expect(r.ok).toBe(false)
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('com administrar no shopfloor, reenvia', async () => {
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: true, chave: linhaTravada().chave })
    expect(liberarParaReenvio).toHaveBeenCalledWith('l1')
  })
})

/**
 * ⚠️ A DECISÃO DO ITEM 4: O REENVIAR NÃO ZERA `tentativas` — ele volta para 1.
 *
 * `tentativas > 0` é a marca de "linha tocada" que a `sf_estoque_reverter` (0132) usa para ESTORNAR
 * em vez de ajustar/cancelar. Zerar reabriria o caminho do ajuste numa linha que pode já ter chegado
 * ao ERP: com `estornado > 0` o ajuste reduz a `quantidade` e estoura o CHECK
 * `estornado <= quantidade`; com `estornado = 0` ele cancela uma entrada que o Compels talvez já
 * tenha recebido, em silêncio. 1 devolve a linha à fila (1 < 5) SEM apagar a marca.
 */
describe('o Reenviar não apaga a marca de "linha tocada"', () => {
  it('o valor de volta é 1, e nunca 0', () => {
    expect(TENTATIVAS_APOS_REENVIO).toBe(1)
    // as duas exigências ao mesmo tempo: volta pra fila E continua "tocada"
    expect(TENTATIVAS_APOS_REENVIO).toBeLessThan(TETO_TENTATIVAS)
    expect(TENTATIVAS_APOS_REENVIO).toBeGreaterThan(0)
  })

  it('linha PARCIALMENTE REVERTIDA (estornado > 0) é reenviada sem mexer no estornado nem na quantidade', async () => {
    lerLinhaParaReenvio.mockResolvedValue(linhaTravada({ quantidade: 3, estornado: 2 }))
    const r = await reenviarEstoqueAction('l1')
    expect(r.ok).toBe(true)
    // a ação não manda número nenhum: quem escreve o 1 é o repositório, a partir da constante
    expect(liberarParaReenvio).toHaveBeenCalledWith('l1')
    // e o log guarda o de→para, que é justamente o que a tela deixa de mostrar depois do reenvio
    expect(registrarLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entidade: 'sf_estoque_envios',
        entidadeId: 'l1',
        dados: { tentativas_antes: TETO_TENTATIVAS, tentativas_depois: 1, estornado: 2 },
      }),
    )
  })
})

describe('o Reenviar recusa o que não é dele, e diz por quê', () => {
  it('linha que já chegou ao ERP', async () => {
    lerLinhaParaReenvio.mockResolvedValue(linhaTravada({ ok: true }))
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('já chegou ao Compels') })
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('linha cancelada antes de ir ao ERP', async () => {
    lerLinhaParaReenvio.mockResolvedValue(linhaTravada({ canceladoEm: '2026-09-29T10:00:00Z' }))
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('cancelada') })
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('linha com RESERVA VIVA: soltar a reserva deixaria duas rodadas mandarem a mesma movimentação', async () => {
    lerLinhaParaReenvio.mockResolvedValue(
      linhaTravada({ reservadoEm: new Date(Date.now() - 60_000).toISOString() }),
    )
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('entregando esta linha agora') })
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('reserva VENCIDA não impede o reenvio', async () => {
    lerLinhaParaReenvio.mockResolvedValue(
      linhaTravada({ reservadoEm: new Date(Date.now() - 20 * 60_000).toISOString() }),
    )
    const r = await reenviarEstoqueAction('l1')
    expect(r.ok).toBe(true)
  })

  it('linha que AINDA está na fila: a próxima rodada tenta sozinha', async () => {
    lerLinhaParaReenvio.mockResolvedValue(linhaTravada({ tentativas: 2 }))
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('ainda está na fila') })
    expect(liberarParaReenvio).not.toHaveBeenCalled()
  })

  it('linha que não existe', async () => {
    lerLinhaParaReenvio.mockResolvedValue(null)
    const r = await reenviarEstoqueAction('sumiu')
    expect(r).toEqual({ ok: false, erro: 'Movimentação não encontrada na fila de estoque.' })
  })

  it('id vazio não vira leitura no banco', async () => {
    const r = await reenviarEstoqueAction('   ')
    expect(r).toEqual({ ok: false, erro: 'Movimentação não informada.' })
    expect(lerLinhaParaReenvio).not.toHaveBeenCalled()
  })

  it('a cerca do update não casou (a linha mudou no meio): manda conferir, não insiste', async () => {
    liberarParaReenvio.mockResolvedValue(false)
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('Atualize a página') })
    expect(registrarLog).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('erro de banco na escrita não vaza detalhe técnico para a tela', async () => {
    liberarParaReenvio.mockRejectedValue(new Error('connection refused at 10.0.0.1'))
    const r = await reenviarEstoqueAction('l1')
    expect(r).toEqual({ ok: false, erro: 'Não foi possível reenviar. Tente de novo.' })
  })
})

describe('depois de reenviar', () => {
  it('a lista é revalidada, para a linha reaparecer já com o estado novo', async () => {
    await reenviarEstoqueAction('l1')
    expect(revalidatePath).toHaveBeenCalledWith('/shopfloor/analisar/estoque-pendente')
  })
})
