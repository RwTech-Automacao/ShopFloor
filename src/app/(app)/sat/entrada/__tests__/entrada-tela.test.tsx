import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { consultarNsAction, registrarEntradaAction } from '@/modules/sat/application/actions'
import { EntradaTela } from '../entrada-tela'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/sat/application/actions', () => ({
  consultarNsAction: vi.fn(),
  registrarEntradaAction: vi.fn(async () => ({ ok: true, valor: { id: '00000000-0000-0000-0000-000000000009' } })),
}))

const os = (id: string, numero: string, data: string, solucao: string, cliente: string) => ({
  id, numero, data, tecnico: '', cliente, equipamento: 'REP X', garantia: '', primeiroRegistro: '', defeito: `defeito ${numero}`,
  observacao: '', solucao, vendedor: '', pecas: [],
})
const MOTIVO = { id: '00000000-0000-0000-0000-0000000000aa', texto: 'Sem CFOP de retorno', ativo: true }

describe('EntradaTela', () => {
  it('busca o NS, já escolhe a OS sugerida, exige motivo na reprovada e grava', async () => {
    vi.mocked(consultarNsAction).mockResolvedValue({ ok: true, valor: {
      ns: { escrito: '562-19177', modelo: '562', sequencia: '19177' },
      os: [os('b', '2', '2026-02-01', 'Troca', 'Cli B'), os('a', '1', '2026-01-01', 'Envio ao SAT', 'Cli A - 12.345.678/0001-90')],
      osSugeridaId: 'a',
      repinmetro: { revendas: [], producao: [] }, shopfloor: [], compels: [],
      sugestao: { empresa: 'Cli A', cnpj: '12.345.678/0001-90', produto: 'REP X', defeito: 'defeito 1' },
      nadaEncontrado: false,
    } })
    render(<EntradaTela motivos={[MOTIVO]} />)
    fireEvent.change(screen.getByPlaceholderText(/Bipe ou digite/), { target: { value: '562-19177' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    await screen.findByText('OS 1')
    // a OS sugerida (última "Envio ao SAT") já vem marcada; a mais recente (OS 2) não
    expect(screen.getByText('OS 1').closest('label')!.querySelector('input')).toBeChecked()
    expect(screen.getByText('OS 2').closest('label')!.querySelector('input')).not.toBeChecked()
    expect(screen.getByDisplayValue('Cli A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('defeito 1')).toBeInTheDocument()

    // sem NF não salva
    const salvar = screen.getByRole('button', { name: 'Salvar entrada' })
    expect(salvar).toBeDisabled()
    fireEvent.change(screen.getByLabelText('NF de entrada *'), { target: { value: '4521' } })
    fireEvent.click(screen.getByLabelText('NF reprovada'))
    expect(screen.getByText('Sem CFOP de retorno')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sem CFOP de retorno' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar entrada' }))

    await waitFor(() => expect(registrarEntradaAction).toHaveBeenCalledWith(expect.objectContaining({
      ns: '562-19177', osId: 'a', empresa: 'Cli A', cnpj: '12.345.678/0001-90', nf: '4521', situacao: 'reprovada',
      motivos: [MOTIVO.id],
    })))
    expect(await screen.findByText('Ver a ficha')).toHaveAttribute('href', '/sat/equipamentos/00000000-0000-0000-0000-000000000009')
  })

  it('nada encontrado: avisa e deixa preencher à mão', async () => {
    vi.mocked(consultarNsAction).mockResolvedValue({ ok: true, valor: {
      ns: { escrito: 'X', modelo: null, sequencia: null }, os: [], osSugeridaId: null,
      repinmetro: { revendas: [], producao: [] }, shopfloor: [], compels: [],
      sugestao: { empresa: '', cnpj: '', produto: '', defeito: '' }, nadaEncontrado: true,
    } })
    render(<EntradaTela motivos={[]} />)
    fireEvent.change(screen.getByPlaceholderText(/Bipe ou digite/), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText(/preencha a entrada manualmente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar entrada' })).toBeInTheDocument()
  })
})
