import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { buscarEmpresaAction, consultarNsAction, registrarNfAction } from '@/modules/sat/application/actions'
import type { ResultadoConsultaNs } from '@/modules/sat/application/consultar-ns'
import { EntradaTela } from '../entrada-tela'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/sat/application/actions', () => ({
  consultarNsAction: vi.fn(),
  buscarEmpresaAction: vi.fn(async () => ({ ok: true, valor: { codigo: 'C0001', nome: 'CLIENTE FICTICIO' } })),
  registrarNfAction: vi.fn(async () => ({
    ok: true, valor: { nfId: 'n1', ids: ['00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010'] },
  })),
}))

const os = (id: string, numero: string, solucao: string) => ({
  id, numero, data: '2026-01-01', tecnico: '', cliente: '', equipamento: 'REP X', garantia: 'SEM GARANTIA',
  primeiroRegistro: '', defeito: `defeito ${numero}`, observacao: '', solucao, vendedor: '', pecas: [], emUso: false,
})

function consulta(escrito: string, modelo: string | null, sequencia: string | null, extra: Partial<ResultadoConsultaNs> = {}): ResultadoConsultaNs {
  return {
    ns: { escrito, modelo, sequencia }, os: [], osSugeridaId: null, repinmetro: { revendas: [], producao: [] },
    shopfloor: [], sugestao: { produto: '' }, nadaEncontrado: true, ...extra,
  }
}

function bipar(ns: string) {
  const campo = screen.getByPlaceholderText(/Bipe ou digite/)
  fireEvent.change(campo, { target: { value: ns } })
  fireEvent.keyDown(campo, { key: 'Enter' })
}

beforeEach(() => vi.clearAllMocks())

describe('EntradaTela', () => {
  it('CNPJ: ao sair do campo busca no Compels e preenche a empresa', async () => {
    render(<EntradaTela motivos={[]} />)
    const cnpj = screen.getByPlaceholderText('CNPJ ou CPF')
    fireEvent.change(cnpj, { target: { value: '123' } })
    fireEvent.blur(cnpj)
    expect(buscarEmpresaAction).not.toHaveBeenCalled()

    fireEvent.change(cnpj, { target: { value: '12345678000190' } })
    fireEvent.blur(cnpj)
    expect(await screen.findByDisplayValue('CLIENTE FICTICIO')).toBeInTheDocument()
    expect(buscarEmpresaAction).toHaveBeenCalledWith('12345678000190')
    expect(screen.getByText('do cadastro do Compels')).toBeInTheDocument()
    expect(screen.getByDisplayValue('12.345.678/0001-90')).toBeInTheDocument()
  })

  it('CNPJ não achado: avisa para digitar a empresa', async () => {
    vi.mocked(buscarEmpresaAction).mockResolvedValueOnce({ ok: true, valor: null })
    render(<EntradaTela motivos={[]} />)
    const cnpj = screen.getByPlaceholderText('CNPJ ou CPF')
    fireEvent.change(cnpj, { target: { value: '12345678901' } })
    fireEvent.keyDown(cnpj, { key: 'Enter' })
    expect(await screen.findByText(/Não achamos no Compels/)).toBeInTheDocument()
  })

  it('bipe adiciona um cartão com o produto sugerido e a OS prevista; o mesmo NS duas vezes é recusado', async () => {
    vi.mocked(consultarNsAction).mockResolvedValue({ ok: true, valor: consulta('562-19177', '562', '19177', {
      os: [os('b', '2', 'Envio de Peça'), os('a', '1', 'Envio ao SAT')], osSugeridaId: 'a',
      sugestao: { produto: 'PMOC31' }, nadaEncontrado: false,
      repinmetro: {
        revendas: [{ numeroSerieCompleto: '00043005620019177', revenda: 'REVENDA X', gravadaEm: null, saidaEm: null }],
        producao: [{ numeroSerie: '19177', modelo: '562', dataInicio: null, dataFim: null, status: 'APROVADO', seriais: { serial_mrp: 'M1' } }],
      },
    }) })
    render(<EntradaTela motivos={[]} />)
    expect(screen.getByRole('button', { name: 'Registrar entrada (0 relógios)' })).toBeDisabled()

    bipar('562-19177')
    expect(await screen.findByDisplayValue('PMOC31')).toBeInTheDocument()
    expect(screen.getAllByTestId('cartao-relogio')).toHaveLength(1)
    expect(screen.getByText('OS prevista: OS 1 · SEM GARANTIA · Defeito: defeito 1')).toBeInTheDocument()
    expect(screen.getByText(/Revenda: REVENDA X/)).toBeInTheDocument()
    expect(screen.getByText('Teste de produção').closest('details')).not.toHaveAttribute('open')

    // o mesmo relógio escrito de outro jeito (17 dígitos) = mesmo modelo/sequência
    bipar('00043005620019177')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('já está nesta nota'))
    expect(consultarNsAction).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('cartao-relogio')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Registrar entrada (1 relógio)' })).toBeEnabled()
  })

  it('registrar manda a nota com todos os relógios e limpa a tela', async () => {
    vi.mocked(consultarNsAction)
      .mockResolvedValueOnce({ ok: true, valor: consulta('562-19177', '562', '19177', { sugestao: { produto: 'PMOC31' } }) })
      .mockResolvedValueOnce({ ok: true, valor: consulta('562-19178', '562', '19178') })
    const MOTIVO = { id: '00000000-0000-0000-0000-0000000000aa', texto: 'Sem CFOP de retorno', ativo: true }
    render(<EntradaTela motivos={[MOTIVO]} />)

    const cnpj = screen.getByPlaceholderText('CNPJ ou CPF')
    fireEvent.change(cnpj, { target: { value: '12345678000190' } })
    fireEvent.blur(cnpj)
    await screen.findByDisplayValue('CLIENTE FICTICIO')
    fireEvent.change(screen.getByLabelText('Número da NF'), { target: { value: '4521' } })
    fireEvent.change(screen.getByLabelText('Valor da nota (R$)'), { target: { value: '10,50' } })
    fireEvent.click(screen.getByLabelText('NF reprovada'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sem CFOP de retorno' }))

    bipar('562-19177')
    await screen.findByDisplayValue('PMOC31')
    bipar('562-19178')
    await waitFor(() => expect(screen.getAllByTestId('cartao-relogio')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('Locação')[1]!, { target: { value: 'P1' } })
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Bobina' })[0]!)

    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada (2 relógios)' }))
    await waitFor(() => expect(registrarNfAction).toHaveBeenCalledWith({
      cnpj: '12.345.678/0001-90', empresa: 'CLIENTE FICTICIO', negocianteCodigo: 'C0001', numero: '4521', valor: '10,50',
      situacao: 'reprovada', motivos: [MOTIVO.id],
      relogios: [
        { ns: '562-19177', produto: 'PMOC31', itensJunto: ['bobina'], itensJuntoOutros: '', locacao: '' },
        { ns: '562-19178', produto: '', itensJunto: [], itensJuntoOutros: '', locacao: 'P1' },
      ],
    }))
    expect(await screen.findByText(/Entrada da NF 4521 registrada \(2 relógios\)/)).toBeInTheDocument()
    expect(screen.getByText('Ver a ficha')).toHaveAttribute('href', '/sat/equipamentos/00000000-0000-0000-0000-000000000009')
    expect(screen.queryAllByTestId('cartao-relogio')).toHaveLength(0)
    expect(await screen.findByRole('button', { name: 'Registrar entrada (0 relógios)' })).toBeDisabled()
  })

  it('registrar fica desabilitado enquanto uma busca de NS está pendente', async () => {
    vi.mocked(consultarNsAction).mockResolvedValueOnce({ ok: true, valor: consulta('562-19177', '562', '19177') })
    let resolver!: (v: Awaited<ReturnType<typeof consultarNsAction>>) => void
    vi.mocked(consultarNsAction).mockReturnValueOnce(new Promise((r) => { resolver = r }))
    render(<EntradaTela motivos={[]} />)
    bipar('562-19177')
    await waitFor(() => expect(screen.getAllByTestId('cartao-relogio')).toHaveLength(1))
    bipar('562-19178')
    expect(screen.getByRole('button', { name: /Registrar entrada/ })).toBeDisabled()
    resolver({ ok: true, valor: consulta('562-19178', '562', '19178') })
    await waitFor(() => expect(screen.getAllByTestId('cartao-relogio')).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar entrada (2 relógios)' })).toBeEnabled())
  })

  it('consultarNsAction que lança: avisa e o mesmo NS pode ser bipado de novo', async () => {
    vi.mocked(consultarNsAction)
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ ok: true, valor: consulta('562-19177', '562', '19177', { sugestao: { produto: 'PMOC31' } }) })
    render(<EntradaTela motivos={[]} />)
    bipar('562-19177')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Não foi possível buscar o número de série. Tente de novo.'))
    bipar('562-19177')
    expect(await screen.findByDisplayValue('PMOC31')).toBeInTheDocument()
    expect(consultarNsAction).toHaveBeenCalledTimes(2)
  })
})
