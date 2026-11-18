import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpEspelho } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const acoes = vi.hoisted(() => ({ cadastrarOpAction: vi.fn(), ultimaOpDaPmoAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/cadastro-op-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({ criarOrdemAction: vi.fn(), editarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))

const { NovaOpCliente } = await import('../nova-op-cliente')

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: codigo === 'PMOC14' ? 'PLACA X' : 'PARTES', situacao: 'Em Processo', nivel,
  quantidade: 10, quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const POSTOS = ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Almoxarifado']
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never

const montar = () => render(<NovaOpCliente espelho={ESPELHO} postos={POSTOS} postosPerfil={PERFIS} clientesExistentes={['LINCE']} />)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.ultimaOpDaPmoAction.mockResolvedValue({
    op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
    postos: [{ posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null }],
    componentes: [], burnin: [],
  })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
})

describe('Nova OP', () => {
  it('PMO do espelho → OP → trechos na ordem da rota, com os postos copiados da última OP', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'pmoc' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await waitFor(() => expect(screen.getByText('Postos copiados da OP 8476 — confira.')).toBeTruthy())
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByText(/Última leitura do Compels/)).toBeTruthy()
  })

  it('PMO fora do espelho → cadastro manual na mesma tela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOZZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar PMOZZ (cadastro manual)' }))
    expect(screen.getByText('Não está no Compels — cadastro manual')).toBeTruthy()
    expect(await screen.findByLabelText('Nº OP *')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['PMOZZ'])
  })

  it('salvar manda o cadastro e volta para a lista', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    fireEvent.change(screen.getByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    const enviado = acoes.cadastrarOpAction.mock.calls[0]![0]
    expect(enviado).toMatchObject({ modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10 })
    expect(enviado.trechos.map((t: { postos: string[] }) => t.postos)).toEqual([['SPI'], ['Inspeção PTH'], ['Teste', 'Almoxarifado']])
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopfloor/ordens'))
  })

  it('erro de validação aparece sem chamar o servidor', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Preencha o início e o fim da faixa de SN.', expect.anything())
    expect(acoes.cadastrarOpAction).not.toHaveBeenCalled()
  })
  it('as setas entre trechos só aparecem nos postos da ponta (nunca no meio)', async () => {
    acoes.ultimaOpDaPmoAction.mockResolvedValue({
      op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
      postos: [
        { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção AOI TOP', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT410' },
        { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
      ],
      componentes: [], burnin: [],
    })
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    const seta = (nome: string) => screen.queryByRole('button', { name: nome })
    // PRT410 = [SPI, Inspeção AOI TOP, Inspeção PTH]: primeiro trecho, então ninguém volta; só o último avança.
    expect(seta('Mover SPI para o trecho anterior')).toBeNull()
    expect(seta('Mover SPI para o trecho seguinte')).toBeNull()
    expect(seta('Mover Inspeção AOI TOP para o trecho anterior')).toBeNull()
    expect(seta('Mover Inspeção AOI TOP para o trecho seguinte')).toBeNull()
    expect(seta('Mover Inspeção PTH para o trecho seguinte')).toBeTruthy()
    // PMO = [Teste, Almoxarifado]: último trecho, então ninguém avança; o Almoxarifado não se move.
    expect(seta('Mover Teste para o trecho anterior')).toBeTruthy()
    expect(seta('Mover Teste para o trecho seguinte')).toBeNull()
    expect(seta('Mover Almoxarifado para o trecho anterior')).toBeNull()

    fireEvent.click(seta('Mover Inspeção PTH para o trecho seguinte')!)
    const trecho = (titulo: string) => screen.getByRole('heading', { level: 3, name: titulo }).closest('div')!.parentElement!
    expect(trecho('PRT420 (8499)').textContent).toContain('Inspeção PTH')
    expect(trecho('PRT410 (8500)').textContent).not.toContain('Inspeção PTH')
    // Agora a ponta de PRT410 é a Inspeção AOI TOP, e a Inspeção PTH (sozinha em PRT420) pode ir e voltar.
    expect(seta('Mover Inspeção AOI TOP para o trecho seguinte')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho anterior')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho seguinte')).toBeTruthy()
  })
})
