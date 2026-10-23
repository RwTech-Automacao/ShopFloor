import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { confirmarLoteAlmoxarifado, detalharPendenciaAlmoxarifado } = vi.hoisted(() => ({
  confirmarLoteAlmoxarifado: vi.fn(),
  detalharPendenciaAlmoxarifado: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({
  confirmarLoteAlmoxarifado,
  detalharPendenciaAlmoxarifado,
}))

import { LoteAberto } from '../lote-aberto'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

const ITEM: PendenciaAlmoxarifado = {
  pmo: 'PMO2', op: '200', tipo: 'lote', codigo: 'LOTE[ab12cd34][5]', pecas: 5, amostra: 5, loteId: 'l1',
  em: '2026-10-21T13:05:00Z',
}
const DETALHE = {
  tipo: 'lote' as const, qtdOp: 50, recebidasOp: 0, postoAnterior: null, pecas: 5,
  sns: ['a1', 'a2', 'a3', 'a4', 'a5'], em: '2026-10-21T13:05:00Z', fechadaPor: null, amostra: 5, jaLancadas: 0,
}

function montar(item = ITEM) {
  const props = { onResultado: vi.fn(), onConfirmado: vi.fn(), onVoltar: vi.fn() }
  render(<LoteAberto item={item} colaborador="Maria" posto="Almoxarifado" {...props} />)
  return props
}
async function campo() {
  return (await screen.findByPlaceholderText('Bipe um número de série do lote')) as HTMLInputElement
}
async function bipar(v: string) {
  const c = await campo()
  fireEvent.change(c, { target: { value: v } })
  fireEvent.keyDown(c, { key: 'Enter' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T18:00:00Z'))
  vi.clearAllMocks()
  detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: DETALHE })
})

describe('LoteAberto', () => {
  it('mostra contexto, instrução com N, progresso 0 de 5 e Confirmar desabilitado', async () => {
    montar()
    expect(await screen.findByText('OP 200 · PMO2 · individual · aprovado hoje 10:05')).toBeInTheDocument()
    expect(screen.getByText((_c, el) => el?.tagName === 'P' && el.textContent === 'Lote LOTE[ab12cd34][5] · 5 peças')).toBeInTheDocument()
    // só o número de peças fica em vinho
    expect(screen.getByText('5 peças')).toHaveClass('text-primary')
    expect(screen.getByText('Bipe os 5 números de série do lote:')).toBeInTheDocument()
    expect(screen.getByText('Bipadas: 0 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeDisabled()
  })

  it('progresso, recusa fora do lote e repetido, confirma só com TODOS (5 de 5)', async () => {
    const p = montar()
    await bipar('a1')
    await bipar('A2')
    expect(screen.getByText('Bipadas: 2 de 5')).toBeInTheDocument()
    await bipar('ZZ')
    expect(p.onResultado).toHaveBeenLastCalledWith({ tipo: 'aviso', titulo: 'A peça zz não é deste lote.' })
    await bipar('A1')
    expect(p.onResultado).toHaveBeenLastCalledWith({ tipo: 'aviso', titulo: 'A peça a1 já foi bipada neste lote.' })
    await bipar('A3')
    await bipar('A4')
    expect(screen.getByText('Bipadas: 4 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeDisabled()
    await bipar('A5')
    expect(screen.getByText('Bipadas: 5 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeEnabled()
  })

  it('confirma com todos os SNs bipados', async () => {
    confirmarLoteAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 5, lote: 'LOTE[ab12cd34][5]' })
    const p = montar()
    for (const s of ['A1', 'A2', 'A3', 'A4', 'A5']) await bipar(s)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))
    await waitFor(() => expect(p.onConfirmado).toHaveBeenCalledWith({ quantidade: 5, codigo: 'LOTE[ab12cd34][5]' }))
    expect(confirmarLoteAlmoxarifado).toHaveBeenCalledWith({
      pmo: 'PMO2', op: '200', posto: 'Almoxarifado', colaborador: 'Maria', loteId: 'l1', amostra: ['a1', 'a2', 'a3', 'a4', 'a5'],
    })
  })

  it('recusa do banco avisa e o cartão permanece', async () => {
    confirmarLoteAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Já lançadas.' })
    const p = montar()
    for (const s of ['A1', 'A2', 'A3', 'A4', 'A5']) await bipar(s)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))
    await waitFor(() => expect(p.onResultado).toHaveBeenLastCalledWith({ tipo: 'aviso', titulo: 'Já lançadas.' }))
    expect(p.onConfirmado).not.toHaveBeenCalled()
    expect(screen.getByText('Bipadas: 5 de 5')).toBeInTheDocument()
  })

  it('com 20 SNs mostra TODOS (sem "+N"), numa lista com rolagem interna; as bipadas levam ✔', async () => {
    const sns = Array.from({ length: 20 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`)
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, pecas: 20, amostra: 20, sns } })
    montar({ ...ITEM, pecas: 20 })
    await bipar('S20')
    const lista = await screen.findByRole('list', { name: 'Números de série do lote' })
    expect(lista.querySelectorAll('li')).toHaveLength(20)
    expect(screen.queryByText(/… \+/)).toBeNull()
    expect(screen.getByText('✔ s20', { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByText('s01', { selector: 'li' })).toBeInTheDocument()
    expect(lista).toHaveClass('overflow-y-auto')
    expect(screen.getByText('Bipe os 20 números de série do lote:')).toBeInTheDocument()
    expect(screen.getByText('Bipadas: 1 de 20')).toBeInTheDocument()
  })

  it('a Tabela NQA não entra: amostra nula no detalhe não bloqueia, vale o total de SNs', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, amostra: null } })
    montar({ ...ITEM, amostra: null })
    expect(await screen.findByText('Bipe os 5 números de série do lote:')).toBeInTheDocument()
    expect(screen.queryByText(/Tabela NQA/)).toBeNull()
    expect(await campo()).toBeEnabled()
    await bipar('A1')
    expect(screen.getByText('Bipadas: 1 de 5')).toBeInTheDocument()
  })

  it('item de outro dia mostra a data junto da hora', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, em: '2026-10-20T18:30:00Z' } })
    montar()
    expect(await screen.findByText('OP 200 · PMO2 · individual · aprovado 20/10 15:30')).toBeInTheDocument()
  })

  it('erro do detalhe é anunciado com role=alert', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Falhou ao ler.' })
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou ao ler.')
  })

  it('detalhe com erro mostra a frase e o Voltar', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Falhou.' })
    const p = montar()
    expect(await screen.findByText('Falhou.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(p.onVoltar).toHaveBeenCalled()
  })

  it('lote de 1 peça usa o singular', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, pecas: 1, sns: ['a1'], amostra: 1 } })
    montar({ ...ITEM, pecas: 1, amostra: 1 })
    expect(await screen.findByText('Lote LOTE[ab12cd34][5] · 1 peça')).toBeInTheDocument()
  })

  it('Enter durante o envio chama o confirmar uma única vez', async () => {
    let liberar: (v: unknown) => void = () => {}
    confirmarLoteAlmoxarifado.mockReturnValue(new Promise((r) => { liberar = r }))
    const p = montar()
    for (const s of ['A1', 'A2', 'A3', 'A4', 'A5']) await bipar(s)
    const botao = screen.getByRole('button', { name: 'Confirmar lote' })
    fireEvent.click(botao)
    fireEvent.click(botao)
    const c = await campo()
    fireEvent.keyDown(c, { key: 'Enter' })
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(confirmarLoteAlmoxarifado).toHaveBeenCalledTimes(1)
    liberar({ ok: true, quantidade: 5, lote: 'LOTE[ab12cd34][5]' })
    await waitFor(() => expect(p.onConfirmado).toHaveBeenCalledTimes(1))
  })
})
