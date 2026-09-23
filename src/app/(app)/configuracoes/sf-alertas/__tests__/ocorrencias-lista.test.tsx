import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { OcorrenciasLista } from '../ocorrencias-lista'

const listarOcorrenciasAction = vi.fn()
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  listarOcorrenciasAction: (...a: unknown[]) => listarOcorrenciasAction(...a),
  resolverOcorrenciaAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  listarOcorrenciasAction.mockResolvedValue({ ok: true, ocorrencias: [] })
})

const BASE: OcorrenciaLinha = {
  id: 'o1',
  regraId: 'g1',
  regraNome: 'Defeito 3x',
  regraTipo: 'defeito',
  posto: 'Teste',
  defeito: '2040 COMPONENTE FALTANDO',
  pmo: null,
  op: null,
  estado: 'aberta',
  taxaAbertura: null,
  taxaUltima: null,
  valorAbertura: 3,
  valorUltimo: 4,
  amostras: 4,
  aprovados: 0,
  reprovados: 0,
  abertaEm: '2026-09-18T12:00:00Z',
  resolvidaPorNome: '',
  resolvidaEm: null,
  normalizadaEm: null,
  reabertaEm: null,
  reaberturas: 0,
  enviosOk: 2,
  enviosFalha: 0,
}

describe('OcorrenciasLista', () => {
  it('mostra o defeito (código + descrição) e o valor medido na régua de cada tipo', () => {
    render(
      <OcorrenciasLista
        ocorrenciasIniciais={[
          BASE,
          { ...BASE, id: 'o2', regraNome: 'Lento', regraTipo: 'tempo', defeito: null, valorAbertura: 180, valorUltimo: 200 },
          {
            ...BASE,
            id: 'o3',
            regraNome: 'Taxa 90',
            regraTipo: 'aprovacao',
            defeito: null,
            taxaAbertura: 75,
            taxaUltima: 88.88,
            valorAbertura: 75,
            valorUltimo: 88.88,
          },
        ]}
        filtroInicial={{ de: '2026-09-12', ate: '2026-09-18', estado: '' }}
      />,
    )
    expect(screen.getByText('Defeito')).toBeInTheDocument()
    expect(screen.getByText('2040 (Componente Faltando)')).toBeInTheDocument()
    expect(screen.getByText('3 vezes')).toBeInTheDocument()
    expect(screen.getByText('4 vezes')).toBeInTheDocument()
    expect(screen.getByText('3:00/peça')).toBeInTheDocument()
    expect(screen.getByText('3:20/peça')).toBeInTheDocument()
    expect(screen.getByText('75,0%')).toBeInTheDocument()
    expect(screen.getByText('88,8%')).toBeInTheDocument()
  })

  it('ocorrência que voltou aparece como "Reaberta", com o encerramento antigo marcado', () => {
    render(
      <OcorrenciasLista
        ocorrenciasIniciais={[
          {
            ...BASE,
            estado: 'aberta',
            reaberturas: 2,
            resolvidaPorNome: 'Ana Gestora',
            resolvidaEm: '2026-09-18T13:00:00Z',
            reabertaEm: '2026-09-18T14:00:00Z',
          },
        ]}
        filtroInicial={{ de: '2026-09-12', ate: '2026-09-18', estado: '' }}
      />,
    )
    expect(screen.getByText('Reaberta 2x')).toBeInTheDocument()
    expect(screen.getByText(/reaberta 18\/09 11:00/)).toBeInTheDocument()
    // O botão continua: reabrir devolve a ocorrência para 'aberta'.
    expect(screen.getByRole('button', { name: 'Marcar resolvida' })).toBeInTheDocument()
  })
})

describe('OcorrenciasLista — recarga vinda de fora (depois de "Avaliar agora")', () => {
  const FILTRO = { de: '2026-09-12', ate: '2026-09-18', estado: '' as const }

  it('não busca nada no primeiro render (a lista já veio do servidor)', () => {
    render(<OcorrenciasLista ocorrenciasIniciais={[BASE]} filtroInicial={FILTRO} recarregar={0} />)
    expect(listarOcorrenciasAction).not.toHaveBeenCalled()
  })

  it('o contador mudando busca de novo e troca a lista', async () => {
    // Era "Resolvida"; depois da avaliação a ocorrência voltou reaberta.
    listarOcorrenciasAction.mockResolvedValue({
      ok: true,
      ocorrencias: [{ ...BASE, estado: 'aberta', reaberturas: 1 }],
    })
    const tela = render(
      <OcorrenciasLista
        ocorrenciasIniciais={[{ ...BASE, estado: 'resolvida' }]}
        filtroInicial={FILTRO}
        recarregar={0}
      />,
    )
    // Pela célula: "Resolvida" também é opção do filtro e cabeçalho de coluna.
    expect(screen.getByRole('cell', { name: 'Resolvida' })).toBeInTheDocument()

    tela.rerender(
      <OcorrenciasLista
        ocorrenciasIniciais={[{ ...BASE, estado: 'resolvida' }]}
        filtroInicial={FILTRO}
        recarregar={1}
      />,
    )
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledWith(FILTRO))
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Reaberta' })).toBeInTheDocument())
    expect(screen.queryByRole('cell', { name: 'Resolvida' })).not.toBeInTheDocument()
  })

  it('recarrega com o filtro que está na tela, não com o inicial', async () => {
    const tela = render(<OcorrenciasLista ocorrenciasIniciais={[BASE]} filtroInicial={FILTRO} recarregar={0} />)
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'aberta' } })
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledWith({ ...FILTRO, estado: 'aberta' }))
    listarOcorrenciasAction.mockClear()

    tela.rerender(<OcorrenciasLista ocorrenciasIniciais={[BASE]} filtroInicial={FILTRO} recarregar={1} />)
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledTimes(1))
    expect(listarOcorrenciasAction).toHaveBeenCalledWith({ ...FILTRO, estado: 'aberta' })
  })

  it('trocar o filtro busca UMA vez (a recarga de fora não duplica)', async () => {
    render(<OcorrenciasLista ocorrenciasIniciais={[BASE]} filtroInicial={FILTRO} recarregar={0} />)
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'normalizada' } })
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledTimes(1))
  })
})
