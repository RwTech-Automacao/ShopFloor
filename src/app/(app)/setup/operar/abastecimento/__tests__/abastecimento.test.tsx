import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Abastecimento } from '../abastecimento'

const trocarRolo = vi.fn()
const localizarSetup = vi.fn()
const carregarSetupAction = vi.fn()
const ultimasTrocas = vi.fn()
vi.mock('@/modules/setup/application/setup-actions', () => ({
  trocarRolo: (...a: unknown[]) => trocarRolo(...a),
  localizarSetup: (...a: unknown[]) => localizarSetup(...a),
  carregarSetupAction: (...a: unknown[]) => carregarSetupAction(...a),
  ultimasTrocas: (...a: unknown[]) => ultimasTrocas(...a),
}))
vi.mock('@/shared/lib/som-erro', () => ({ tocarErro: vi.fn() }))

// A seleção em si não é o assunto: um botão entrega uma seleção completa.
vi.mock('../../../selecao-setup', () => ({
  SELECAO_VAZIA: {},
  selecaoCompleta: (v: { pmo?: string }) => v.pmo === 'P',
  chaveDaSelecao: () => ({ pmo: 'P', op: '1', equipamentoId: 'e1', face: 'TOP' }),
  SelecaoSetup: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button onClick={() => onChange({ pmo: 'P', processo: 'SMD' })}>escolher</button>
  ),
}))

const SETUP = {
  id: 's1', pmo: 'P', op: '1', processo: 'SMD', equipamentoId: 'e1', linha: '1', bloco: 'A', maquina: 'MG5',
  face: 'TOP', estado: 'liberado', totalItens: 1, semRolo: 0,
}
const itensCom = (rolo: string) => ({
  ok: true, setup: SETUP,
  itens: [{ id: 'i1', posicao: 'P1', feeder: 'F1', componente: 'CAPJ41', rolo, colaborador: '', atualizadoEm: '' }],
})
const APROVADA = { ok: true, resultado: 'APROVADO', motivos: [], semFaixa: false }

const campo = () => screen.getByRole('textbox')
function bipar(v: string) {
  fireEvent.change(campo(), { target: { value: v } })
  fireEvent.keyDown(campo(), { key: 'Enter' })
}

beforeEach(() => {
  vi.clearAllMocks()
  localizarSetup.mockResolvedValue({ ok: true, setup: SETUP })
  ultimasTrocas.mockResolvedValue({ ok: true, trocas: [] })
})

describe('Abastecimento: a lista de itens acompanha o servidor', () => {
  it('duas trocas seguidas na mesma posição: a segunda parte do rolo que a primeira montou', async () => {
    // Antes da 1ª troca o montado é A; depois dela, o servidor passa a ter B.
    carregarSetupAction.mockResolvedValueOnce(itensCom('CAPJ41-A')).mockResolvedValue(itensCom('CAPJ41-B'))
    trocarRolo.mockResolvedValue(APROVADA)
    render(<Abastecimento ordens={[]} equipamentos={[]} />)
    fireEvent.click(screen.getByText('escolher'))
    await screen.findByText('1/6')

    for (const v of ['1234', 'P1', 'F1', 'CAPJ41-A', 'CAPJ41-B', 'SN-1']) bipar(v)
    await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(carregarSetupAction).toHaveBeenCalledTimes(2))
    await screen.findByText('1/6')
    // deixa a carga assentar (itens deixa de ser null)
    await new Promise((r) => { setTimeout(r, 20) })

    for (const v of ['1234', 'P1', 'F1', 'CAPJ41-B']) bipar(v)
    expect(screen.queryByText(/não CAPJ41-B/)).not.toBeInTheDocument()
    expect(await screen.findByText('5/6')).toBeInTheDocument()
    for (const v of ['CAPJ41-C', 'SN-2']) bipar(v)
    await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(2))
  })

  it('duas recargas em voo: a resposta velha, chegando por último, não sobrepõe a mais nova', async () => {
    const adiada = () => {
      let resolver!: (v: unknown) => void
      const promessa = new Promise((r) => { resolver = r })
      return { promessa, resolver }
    }
    const r1 = adiada()
    const r2 = adiada()
    // 1ª carga (ao abrir): A. Recarga da troca 1: adiada (r1). Recarga da troca 2: adiada (r2).
    carregarSetupAction
      .mockResolvedValueOnce(itensCom('CAPJ41-A'))
      .mockReturnValueOnce(r1.promessa)
      .mockReturnValueOnce(r2.promessa)
    trocarRolo.mockResolvedValue(APROVADA)
    render(<Abastecimento ordens={[]} equipamentos={[]} />)
    fireEvent.click(screen.getByText('escolher'))
    await screen.findByText('1/6')

    for (const v of ['1234', 'P1', 'F1', 'CAPJ41-A', 'CAPJ41-B', 'SN-1']) bipar(v)
    await waitFor(() => expect(carregarSetupAction).toHaveBeenCalledTimes(2))
    await screen.findByText('1/6')
    // Com a lista zerada (null) a conferência está desligada: a 2ª troca passa sem ela.
    for (const v of ['1234', 'P1', 'F1', 'CAPJ41-B', 'CAPJ41-C', 'SN-2']) bipar(v)
    await waitFor(() => expect(carregarSetupAction).toHaveBeenCalledTimes(3))

    // A resposta da recarga 2 (rolo C, o mais novo) chega primeiro; a da recarga 1 (B, velha) depois.
    r2.resolver(itensCom('CAPJ41-C'))
    await new Promise((r) => { setTimeout(r, 20) })
    r1.resolver(itensCom('CAPJ41-B'))
    await new Promise((r) => { setTimeout(r, 20) })

    // Conferência ligada com a lista da 2ª recarga: o rolo montado é C. Se a velha vencesse, seria B.
    for (const v of ['1234', 'P1', 'F1', 'CAPJ41-C']) bipar(v)
    expect(screen.queryByText(/não CAPJ41-C/)).not.toBeInTheDocument()
    expect(await screen.findByText('5/6')).toBeInTheDocument()
  })
})
