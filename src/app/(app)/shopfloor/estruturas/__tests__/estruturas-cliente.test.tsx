import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const acoes = vi.hoisted(() => ({
  salvarEstruturaAction: vi.fn(async () => ({ ok: true })),
  ativarEstruturaAction: vi.fn(async () => ({ ok: false, erro: 'PRT1: escolha o posto que conclui este trecho.' })),
  lerDoCompelsAction: vi.fn(async () => ({ ok: true, trechos: [{ seq: 1, codigo: 'PRT410', descricao: 'SMD', postoConclui: 'Inspeção AOI TOP', snModo: 'mesmo', estoque: 'EINTER' }] })),
  importarDoCompelsAction: vi.fn(async () => ({ ok: true, criadas: 3, semFilhas: 2, falhas: 0 })),
}))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => acoes)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { EstruturasCliente } from '../estruturas-cliente'

const ESTRUTURAS = [
  { pmo: 'PMOC14', situacao: 'rascunho' as const, origem: 'compels:8498', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: null, snModo: 'mesmo' as const, estoque: 'EINTER' as const }] },
  { pmo: 'PMOG14', situacao: 'ativa' as const, origem: 'manual', trechos: [] },
]

describe('EstruturasCliente', () => {
  it('lista as PMOs com a situação legível', () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP', 'Inspeção PTH']} />)
    expect(screen.getByText('PMOC14')).toBeTruthy()
    expect(screen.getByText('Rascunho — conferir postos')).toBeTruthy()
    expect(screen.getByText('Ativa')).toBeTruthy()
  })

  it('ativar mostra o motivo da recusa', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOC14' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(screen.getByText('PRT1: escolha o posto que conclui este trecho.')).toBeTruthy())
  })

  it('importar do Compels mostra o resumo', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Importar do Compels' }))
    await waitFor(() => expect(screen.getByText('3 estrutura(s) criada(s) em rascunho · 2 PMO(s) sem PRT no Compels · 0 falha(s)')).toBeTruthy())
  })

  it('PMO de estrutura nova é editável até salvar; depois trava', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nova estrutura' }))
    const pmo = screen.getByLabelText('PMO') as HTMLInputElement
    expect(pmo.disabled).toBe(false)
    fireEvent.change(pmo, { target: { value: 'pmox1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect((screen.getByLabelText('PMO') as HTMLInputElement).disabled).toBe(true))
  })

  it('estrutura existente abre com a PMO travada, mesmo sem trechos', () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOG14' }))
    expect((screen.getByLabelText('PMO') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText('Situação: Ativa').length).toBe(1)
  })

  it('editar um trecho desativa Ativar e avisa', () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOC14' }))
    expect((screen.getByRole('button', { name: 'Ativar' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Código do trecho 1'), { target: { value: 'prt2' } })
    expect((screen.getByRole('button', { name: 'Ativar' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Salve antes de ativar.')).toBeTruthy()
  })

  it('Ativar chama a ação com a PMO certa', async () => {
    acoes.ativarEstruturaAction.mockClear()
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOC14' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(acoes.ativarEstruturaAction).toHaveBeenCalledWith('PMOC14'))
  })

  it('Ler do Compels preenche as linhas', async () => {
    render(<EstruturasCliente estruturas={ESTRUTURAS} postos={['Inspeção AOI TOP']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar PMOG14' }))
    fireEvent.change(screen.getByPlaceholderText('ex.: 8498'), { target: { value: '8498' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ler do Compels' }))
    await waitFor(() => expect((screen.getByLabelText('Código do trecho 1') as HTMLInputElement).value).toBe('PRT410'))
  })
})
