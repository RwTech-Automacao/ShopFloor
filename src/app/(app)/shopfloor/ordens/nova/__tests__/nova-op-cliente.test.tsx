import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
    op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
    postos: [{ posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null }],
    componentes: [], burnin: [],
  } })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
})

describe('Nova OP', () => {
  it('PMO do espelho → OP → trechos na ordem da rota, com os postos copiados da última OP', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'pmoc' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await waitFor(() => expect(screen.getByText('Postos copiados da OP 8476 — confira.')).toBeTruthy())
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByText(/Última leitura do Compels/)).toBeTruthy()
  })

  it('PMO fora do espelho → cadastro manual na mesma tela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOZZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar PMOZZ (cadastro manual)' }))
    expect(screen.getByText('Não está no Compels — cadastro manual')).toBeTruthy()
    expect(await screen.findByLabelText('Nº OP *')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['PMOZZ'])
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
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopfloor/ordens-nova'))
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
    acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
      op: '8476', cliente: 'LINCE', descricao: 'PLACA X', placasPorPainel: 1, embalagemIndividual: false,
      postos: [
        { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção AOI TOP', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT410' },
        { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
      ],
      componentes: [], burnin: [],
    } })
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
    const trecho = (titulo: string) => screen.getByRole('region', { name: titulo })
    expect(trecho('PRT420 (8499)').textContent).toContain('Inspeção PTH')
    expect(trecho('PRT410 (8500)').textContent).not.toContain('Inspeção PTH')
    // Agora a ponta de PRT410 é a Inspeção AOI TOP, e a Inspeção PTH (sozinha em PRT420) pode ir e voltar.
    expect(seta('Mover Inspeção AOI TOP para o trecho seguinte')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho anterior')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho seguinte')).toBeTruthy()
  })

  const abrir = async () => {
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
  }

  it('sufixo da OP: dica, erro inline e Salvar travado', async () => {
    montar()
    await abrir()
    expect(screen.getByText('Pode acrescentar sufixo: 8498_F')).toBeTruthy()
    const salvar = screen.getByRole('button', { name: 'Salvar OP' }) as HTMLButtonElement
    expect(salvar.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Nº OP *'), { target: { value: '8498_F' } })
    expect(salvar.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Nº OP *'), { target: { value: '8499' } })
    expect(screen.getByText(/ou ele com sufixo \(ex\.: 8498_F\)/)).toBeTruthy()
    expect(salvar.disabled).toBe(true)
  })

  it('depois de escolher a PMO some a sugestão; digitar outra coisa limpa trechos; clicar de novo não apaga edições', async () => {
    montar()
    await abrir()
    expect(screen.queryByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Cliente *'), { target: { value: 'EDITADO' } })
    // a PMO escolhida vira resumo; Trocar reabre a busca, e clicar a mesma PMO de novo mantém o que foi editado
    fireEvent.click(screen.getByRole('button', { name: 'Trocar PMO' }))
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    expect((screen.getByLabelText('Cliente *') as HTMLInputElement).value).toBe('EDITADO')
    fireEvent.click(screen.getByRole('button', { name: 'Trocar PMO' }))
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC1' } })
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' })).toBeTruthy()
  })

  it('falha ao ler a última OP não diz "Primeira OP"', async () => {
    acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: false, erro: 'x' })
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    expect(await screen.findByText('Não foi possível ler a última OP desta PMO — monte os postos.')).toBeTruthy()
    expect(screen.queryByText(/Primeira OP/)).toBeNull()
  })

  it('mostra Carregando… enquanto a última OP não chega', async () => {
    let resolver: (v: unknown) => void = () => {}
    acoes.ultimaOpDaPmoAction.mockReturnValue(new Promise((r) => { resolver = r }))
    montar()
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    expect(screen.getByText('Carregando…')).toBeTruthy()
    resolver({ ok: true, ultima: null })
    await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull())
  })

  it('Descer fica desabilitado no último posto e antes do Almoxarifado', async () => {
    montar()
    await abrir()
    expect((screen.getByRole('button', { name: 'Descer Teste' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Descer SPI' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cada trecho é uma região nomeada e o select de adicionar posto tem nome', async () => {
    montar()
    await abrir()
    expect(screen.getByRole('region', { name: 'PRT410 (8500)' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Adicionar posto em PMOC14 (8498)' })).toBeTruthy()
  })

  it('escolher a OP fecha a lista num resumo com Trocar; Trocar reabre e outra escolha refaz os trechos', async () => {
    const espelho = [...ESPELHO, { ...op(8510, 'PMOC14', 1, null), quantidade: 900 }]
    render(<NovaOpCliente espelho={espelho} postos={POSTOS} postosPerfil={PERFIS} clientesExistentes={[]} />)
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 2 OPs abertas' }))
    expect(screen.queryByLabelText('PMO *')).toBeNull()
    expect(screen.getByText('PMOC14 — PLACA X')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    expect(screen.queryByRole('button', { name: /^OP 8510/ })).toBeNull()
    expect(screen.getByText('OP 8498 · 10 un · Em Processo')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Trocar OP' }))
    expect(screen.getByRole('button', { name: /^OP 8510/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^OP 8498/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^OP 8510/ }))
    expect(screen.queryByRole('button', { name: /^OP 8498/ })).toBeNull()
    expect(screen.getByText('OP 8510 · 900 un · Em Processo')).toBeTruthy()
    expect((screen.getByLabelText('Nº OP *') as HTMLInputElement).value).toBe('8510')
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['PMOC14 (8510)'])
  })

  it('a numeração dos postos continua de um trecho para o outro e a barra fixa resume a rota', async () => {
    montar()
    expect(screen.getByTestId('resumo-rota').textContent).toBe('Escolha a PMO e a OP para montar a rota.')
    expect((screen.getByRole('button', { name: 'Salvar OP' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/shopfloor/ordens-nova')
    await abrir()
    const numeros = (titulo: string) => within(screen.getByRole('region', { name: titulo })).getAllByRole('listitem')
      .map((li) => li.textContent!.match(/^\d+/)![0])
    expect(numeros('PRT410 (8500)')).toEqual(['1'])
    expect(numeros('PRT420 (8499)')).toEqual(['2'])
    expect(numeros('PMOC14 (8498)')).toEqual(['3', '4'])
    expect(screen.getByTestId('resumo-rota').textContent).toBe('3 trechos · 4 postos')
    fireEvent.click(screen.getByRole('button', { name: 'Remover SPI' }))
    expect(screen.getByTestId('resumo-rota').textContent).toBe('3 trechos · 3 postos')
    expect(within(screen.getByRole('region', { name: 'PRT410 (8500)' })).getByText('Nenhum posto neste trecho. Traga postos com ← → ou adicione um.')).toBeTruthy()
    expect(numeros('PRT420 (8499)')).toEqual(['1'])
  })
})
