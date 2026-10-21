import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const { registrarEntradaAlmoxarifado, listarNecessidadesAlmoxarifado, listarLotesAlmoxarifado, confirmarLoteAlmoxarifado } =
  vi.hoisted(() => ({
    registrarEntradaAlmoxarifado: vi.fn(),
    listarNecessidadesAlmoxarifado: vi.fn(),
    listarLotesAlmoxarifado: vi.fn(),
    confirmarLoteAlmoxarifado: vi.fn(),
  }))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({
  registrarEntradaAlmoxarifado,
  listarNecessidadesAlmoxarifado,
  listarLotesAlmoxarifado,
  confirmarLoteAlmoxarifado,
}))

import { AlmoxarifadoPanel } from '../almoxarifado-panel'

const PROPS = { colaborador: 'Maria', pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', individual: true, loteNqa: true }

const L1 = {
  loteId: 'l1', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: 5,
  sns: ['7001', '7002', '7003', '7004', '7005'], jaLancadas: 0, aprovadoEm: null,
}
const L2 = { ...L1, loteId: 'l2', rotulo: 'LOTE[ffff0000][3]', pecas: 3, amostra: 3, sns: ['7011', '7012', '7013'] }

function campo() {
  return screen.getByRole('textbox') as HTMLInputElement
}
function bipar(valor: string) {
  fireEvent.change(campo(), { target: { value: valor } })
  fireEvent.keyDown(campo(), { key: 'Enter' })
}
async function abrirLote(rotulo: string) {
  const lista = within(await screen.findByRole('list', { name: 'Lotes esperando confirmação' }))
  fireEvent.click(lista.getByRole('button', { name: new RegExp(rotulo.replace(/[[\]]/g, '\\$&')) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  listarNecessidadesAlmoxarifado.mockResolvedValue({ ok: true, necessidades: [] })
  listarLotesAlmoxarifado.mockResolvedValue({ ok: true, lotes: [L1, L2] })
})

describe('AlmoxarifadoPanel — lotes do NQA individual (0156)', () => {
  it('lista os lotes da OP (e não consulta caixas)', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    const lista = within(await screen.findByRole('list', { name: 'Lotes esperando confirmação' }))
    expect(lista.getByText('LOTE[abcd1234][5]')).toBeInTheDocument()
    expect(lista.getByText('LOTE[ffff0000][3]')).toBeInTheDocument()
    expect(listarLotesAlmoxarifado).toHaveBeenCalledWith('PMOL01', '9201')
    expect(listarNecessidadesAlmoxarifado).not.toHaveBeenCalled()
  })

  it('abrir um lote mostra TODOS os SNs dele e quantas a bipar (todas)', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    await abrirLote('LOTE[abcd1234][5]')
    const sns = within(screen.getByRole('list', { name: 'SNs do lote' }))
    for (const sn of L1.sns) expect(sns.getByText(sn)).toBeInTheDocument()
    expect(screen.getByText('Bipadas: 0 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeDisabled()
  })

  it('aceita só SN do lote, repetido não conta, e só habilita Confirmar com TODOS', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    await abrirLote('LOTE[abcd1234][5]')

    bipar('7099')
    expect(await screen.findByText('A peça 7099 não é deste lote.')).toBeInTheDocument()
    expect(screen.getByText('Bipadas: 0 de 5')).toBeInTheDocument()

    bipar('7001')
    expect(await screen.findByText('Bipadas: 1 de 5')).toBeInTheDocument()
    bipar('7001')
    expect(await screen.findByText('A peça 7001 já foi bipada neste lote.')).toBeInTheDocument()
    expect(screen.getByText('Bipadas: 1 de 5')).toBeInTheDocument()

    for (const [i, sn] of ['7002', '7003', '7004'].entries()) {
      bipar(sn)
      expect(await screen.findByText(`Bipadas: ${i + 2} de 5`)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeDisabled()
    }
    bipar('7005')
    expect(await screen.findByText('Bipadas: 5 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeEnabled()
    // Nenhum bipe do lote foi ao banco como entrada avulsa.
    expect(registrarEntradaAlmoxarifado).not.toHaveBeenCalled()
  })

  it('Confirmar lote manda todos os SNs, mostra as peças e recarrega a lista', async () => {
    confirmarLoteAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 5, lote: 'LOTE[abcd1234][5]' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await abrirLote('LOTE[abcd1234][5]')
    for (const [i, sn] of L1.sns.entries()) {
      bipar(sn)
      await screen.findByText(`Bipadas: ${i + 1} de 5`)
    }

    listarLotesAlmoxarifado.mockResolvedValue({ ok: true, lotes: [L2] })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))

    await waitFor(() =>
      expect(confirmarLoteAlmoxarifado).toHaveBeenCalledWith({
        pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', colaborador: 'Maria', loteId: 'l1', amostra: L1.sns,
      }),
    )
    expect(within(await screen.findByRole('status')).getByText('5 peças')).toBeInTheDocument()
    await waitFor(() => expect(listarLotesAlmoxarifado).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'SNs do lote' })).toBeNull())
    const lista = within(screen.getByRole('list', { name: 'Lotes esperando confirmação' }))
    await waitFor(() => expect(lista.queryByText('LOTE[abcd1234][5]')).toBeNull())
  })

  it('recusa da confirmação aparece e o lote continua aberto com os bipados', async () => {
    confirmarLoteAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Lote já confirmado em 20/10/2026 09:00 por Ana.' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await abrirLote('LOTE[abcd1234][5]')
    for (const [i, sn] of L1.sns.entries()) {
      bipar(sn)
      await screen.findByText(`Bipadas: ${i + 1} de 5`)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))
    expect(await screen.findByText('Lote já confirmado em 20/10/2026 09:00 por Ana.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'SNs do lote' })).toBeInTheDocument()
  })

  it('a Tabela NQA não entra: amostra nula do banco não bloqueia, vale o total de SNs do lote', async () => {
    listarLotesAlmoxarifado.mockResolvedValue({ ok: true, lotes: [{ ...L1, amostra: null }] })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await abrirLote('LOTE[abcd1234][5]')
    expect(screen.queryByText(/Tabela NQA/)).toBeNull()
    expect(screen.getByText('Bipadas: 0 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeDisabled()
    for (const sn of L1.sns) bipar(sn)
    await screen.findByText('Bipadas: 5 de 5')
    expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeEnabled()
  })

  it('a lista diz "bipar todas" (sem amostra K)', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    const lista = within(await screen.findByRole('list', { name: 'Lotes esperando confirmação' }))
    expect(lista.getByText('5 peças · bipar todas')).toBeInTheDocument()
    expect(screen.queryByText(/amostra/i)).toBeNull()
  })

  it('sem lote aberto, o bipe avulso vai à entrada e mostra a frase do serie_exige_lote', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({
      ok: false, erro: 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.',
    })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await screen.findByRole('list', { name: 'Lotes esperando confirmação' })
    bipar('7012')
    expect(await screen.findByText('Esta peça faz parte de um lote do NQA: confirme o lote inteiro.')).toBeInTheDocument()
  })

  it('sem lote esperando: estado vazio claro; falha: erro, e não o vazio', async () => {
    listarLotesAlmoxarifado.mockResolvedValue({ ok: true, lotes: [] })
    const { unmount } = render(<AlmoxarifadoPanel {...PROPS} />)
    expect(await screen.findByText('Nenhum lote esperando confirmação nesta OP.')).toBeInTheDocument()
    unmount()
    listarLotesAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Não foi possível carregar os lotes esperando confirmação.' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    expect(await screen.findByText('Não foi possível carregar os lotes esperando confirmação.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lote esperando confirmação nesta OP.')).toBeNull()
  })

  it('individual SEM NQA no anterior: nada de lote (bipe a bipe como hoje)', async () => {
    render(<AlmoxarifadoPanel {...PROPS} loteNqa={false} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/Lotes esperando confirmação/)).toBeNull()
    expect(listarLotesAlmoxarifado).not.toHaveBeenCalled()
  })
})
