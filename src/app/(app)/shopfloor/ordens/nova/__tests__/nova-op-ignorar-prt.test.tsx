import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { OpEspelho } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acoes = vi.hoisted(() => ({ cadastrarOpAction: vi.fn(), ultimaOpDaPmoAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/cadastro-op-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({ criarOrdemAction: vi.fn(), editarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))

const { NovaOpCliente } = await import('../nova-op-cliente')

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: codigo === 'PMOC14' ? 'PLACA X' : 'PARTES', situacao: 'Em Processo', nivel,
  quantidade: 10, quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'CLIENTE COMPELS', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const POSTOS = ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Almoxarifado']
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never

beforeEach(() => {
  vi.clearAllMocks()
  acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
    op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
    postos: [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção AOI TOP', trechoCodigo: 'PRT410' },
      { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
    ],
    componentes: [], burnin: [],
  } })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
})

async function abrir() {
  render(<NovaOpCliente espelho={ESPELHO} postos={POSTOS} postosPerfil={PERFIS} clientesExistentes={['LINCE']} />)
  fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
  fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
  fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
  await screen.findByText('Postos copiados da OP 8476 — confira.')
}
const trecho = (titulo: string) => screen.getByRole('region', { name: titulo })
const titulos = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
function ignorar(titulo: string, escolha: 'Tirar os postos da rota' | 'Manter os postos na rota da OP') {
  fireEvent.click(within(trecho(titulo)).getByRole('button', { name: 'Ignorar esta PRT' }))
  fireEvent.click(within(trecho(titulo)).getByRole('button', { name: escolha }))
}

describe('Nova OP: ignorar PRT', () => {
  it('cada PRT tem "Ignorar esta PRT"; a PMO não', async () => {
    await abrir()
    expect(within(trecho('PRT410 (8500)')).getByRole('button', { name: 'Ignorar esta PRT' })).toBeTruthy()
    expect(within(trecho('PRT420 (8499)')).getByRole('button', { name: 'Ignorar esta PRT' })).toBeTruthy()
    expect(within(trecho('PMOC14 (8498)')).queryByRole('button', { name: 'Ignorar esta PRT' })).toBeNull()
  })

  it('"Tirar os postos da rota": a PRT some com os postos e fica riscada na lista, com o selo e a escolha', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Tirar os postos da rota')
    expect(titulos()).toEqual(['PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByTestId('resumo-rota').textContent).toBe('2 trechos · 3 postos')
    const item = within(screen.getByRole('list', { name: 'PRTs ignoradas' })).getByRole('listitem')
    expect(item.textContent).toContain('PRT410 (8500)')
    expect(item.textContent).toContain('Ignorada')
    expect(item.textContent).toContain('Tirar os postos da rota')
    expect(within(item).getByText('PRT410 (8500)').className).toContain('line-through')
  })

  it('"Manter os postos na rota da OP": os postos vão para o começo do trecho seguinte', async () => {
    await abrir()
    ignorar('PRT420 (8499)', 'Manter os postos na rota da OP')
    expect(titulos()).toEqual(['PRT410 (8500)', 'PMOC14 (8498)'])
    expect(trecho('PMOC14 (8498)').textContent).toMatch(/Inspeção PTH.*Teste.*Almoxarifado/)
  })

  it('Desfazer devolve a PRT com os postos que tinha', async () => {
    await abrir()
    ignorar('PRT420 (8499)', 'Manter os postos na rota da OP')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer: PRT420 (8499)' }))
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(trecho('PRT420 (8499)').textContent).toContain('Inspeção PTH')
    expect(trecho('PMOC14 (8498)').textContent).not.toContain('Inspeção PTH')
    expect(screen.queryByRole('list', { name: 'PRTs ignoradas' })).toBeNull()
  })

  it('salvar manda os trechos renumerados e as ignoradas com a escolha', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Manter os postos na rota da OP')
    fireEvent.change(screen.getByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    const enviado = acoes.cadastrarOpAction.mock.calls[0]![0]
    expect(enviado.trechos.map((t: { seq: number; codigo: string; postos: string[] }) => [t.seq, t.codigo, t.postos])).toEqual([
      [1, 'PRT420', ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH']], [2, 'PMOC14', ['Teste', 'Almoxarifado']],
    ])
    expect(enviado.ignoradas).toEqual([{ codigo: 'PRT410', compelsOp: '8500', modo: 'manter' }])
  })

  it('outra PMO na busca limpa as ignoradas', async () => {
    await abrir()
    ignorar('PRT410 (8500)', 'Tirar os postos da rota')
    fireEvent.click(screen.getByRole('button', { name: 'Trocar PMO' }))
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC1' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    expect(screen.queryByRole('list', { name: 'PRTs ignoradas' })).toBeNull()
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
  })

  it('mover à mão um posto herdado e depois Desfazer não desloca os postos', async () => {
    await abrir()
    ignorar('PRT420 (8499)', 'Manter os postos na rota da OP')
    fireEvent.click(within(trecho('PMOC14 (8498)')).getByRole('button', { name: 'Mover Inspeção PTH para o trecho anterior' }))
    expect(trecho('PRT410 (8500)').textContent).toContain('Inspeção PTH')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer: PRT420 (8499)' }))
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(trecho('PRT420 (8499)').textContent).toContain('Inspeção PTH')
    expect(trecho('PRT410 (8500)').textContent).not.toContain('Inspeção PTH')
    expect(trecho('PMOC14 (8498)').textContent).not.toContain('Inspeção PTH')
  })
})
