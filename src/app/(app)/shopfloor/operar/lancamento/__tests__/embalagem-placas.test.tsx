import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// OP com 50 placas por painel, limite 500: o contador soma o `pecas` devolvido pelo bipe e o 11º painel
// é recusado pelo servidor com a mensagem do limite em placas.
const mocks = vi.hoisted(() => ({
  carregarEmbalagem: vi.fn(),
  embalarPeca: vi.fn(),
  fecharCaixa: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/embalagem-actions', () => ({
  carregarEmbalagem: (...a: unknown[]) => mocks.carregarEmbalagem(...a),
  embalarPeca: (...a: unknown[]) => mocks.embalarPeca(...a),
  fecharCaixa: (...a: unknown[]) => mocks.fecharCaixa(...a),
}))
vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { EmbalagemPanel } from '../embalagem-panel'

const ESTADO = {
  seq: 1, limite: 500, qtdNaCaixa: 0, totalEmbaladas: 0, snsNaCaixa: [], concluida: false,
  remontagem: null, caixasAbertas: [{ seq: 1, tipo: 'daVez', limite: 500, qtd: 0 }],
}

function montar() {
  return render(<EmbalagemPanel colaborador="Ana" pmo="PMO1" op="OP1" posto="Embalagem" qtdOP={5000} />)
}

async function bipar(sn: string) {
  const campo = await screen.findByLabelText(/série|serie/i)
  fireEvent.change(campo, { target: { value: sn } })
  fireEvent.keyDown(campo, { key: 'Enter' })
}

describe('EmbalagemPanel com placas por painel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.carregarEmbalagem.mockResolvedValue({ ok: true, estado: ESTADO })
  })

  it('soma as placas do painel (50) no contador e mostra o chip +50', async () => {
    mocks.embalarPeca.mockResolvedValue({ ok: true, seq: 1, pecas: 50, caixaCount: 50 })
    montar()
    await bipar('SN1')
    await waitFor(() => expect(screen.getByText('50 / 500 nesta caixa')).toBeTruthy())
    expect(screen.getByText('+50')).toBeTruthy()
    expect(screen.getByText('CX1 · 50/500')).toBeTruthy()
  })

  it('OP sem painel (pecas ausente/1): soma 1 e não mostra o chip +N', async () => {
    mocks.embalarPeca.mockResolvedValue({ ok: true, seq: 1, pecas: 1, caixaCount: 1 })
    montar()
    await bipar('SN1')
    await waitFor(() => expect(screen.getByText('1 / 500 nesta caixa')).toBeTruthy())
    expect(screen.queryByText('+1')).toBeNull()
  })

  it('o 11º painel mostra a mensagem do limite e não mexe no contador', async () => {
    mocks.carregarEmbalagem.mockResolvedValue({ ok: true, estado: { ...ESTADO, qtdNaCaixa: 500, totalEmbaladas: 500 } })
    mocks.embalarPeca.mockResolvedValue({
      ok: false, seq: 1,
      erro: 'Este painel (50 placas) ultrapassa o limite da caixa (500/500).',
    })
    montar()
    await bipar('SN11')
    await waitFor(() => expect(screen.getByText('Este painel (50 placas) ultrapassa o limite da caixa (500/500).')).toBeTruthy())
    expect(screen.getByText('500 / 500 nesta caixa')).toBeTruthy()
  })
})
