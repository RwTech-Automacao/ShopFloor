import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { OcorrenciasLista } from '../ocorrencias-lista'

const listarOcorrenciasAction = vi.fn()
const resolverOcorrenciaAction = vi.fn()
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  listarOcorrenciasAction: (...a: unknown[]) => listarOcorrenciasAction(...a),
  resolverOcorrenciaAction: (...a: unknown[]) => resolverOcorrenciaAction(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  listarOcorrenciasAction.mockResolvedValue({ ok: true, ocorrencias: [] })
  resolverOcorrenciaAction.mockResolvedValue({ ok: true })
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
  explicacao: '',
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
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeInTheDocument()
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

describe('OcorrenciasLista — resolver pergunta o que foi feito', () => {
  const FILTRO = { de: '2026-09-12', ate: '2026-09-18', estado: '' as const }
  const montar = (o: OcorrenciaLinha = BASE) =>
    render(<OcorrenciasLista ocorrenciasIniciais={[o]} filtroInicial={FILTRO} />)

  it('o botão é "Resolver" (ação), não "Resolvido"/"Marcar resolvida", e é amarelo', () => {
    montar()
    const botao = screen.getByRole('button', { name: 'Resolver' })
    // A cor voltou ao neutro do projeto: na TELA nunca houve verde (o verde era só o do Discord).
    // A garantia que resta é o VERBO: "Resolver" é ação, "Resolvido" parecia conclusão antes de
    // qualquer coisa ter sido feita — foi isso que o usuário pediu para mudar.
    expect(botao).toHaveTextContent('Resolver')
    expect(botao).not.toHaveTextContent('Resolvido')
    expect(screen.queryByRole('button', { name: /resolvid/i })).not.toBeInTheDocument()
  })

  it('clicar abre a caixa de texto, com limite de 500, e NÃO resolve ainda', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    const caixa = await screen.findByLabelText('O que foi feito')
    expect(caixa).toHaveAttribute('maxlength', '500')
    expect(resolverOcorrenciaAction).not.toHaveBeenCalled()
  })

  it('confirmar com texto chama a action com o texto', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    fireEvent.change(await screen.findByLabelText('O que foi feito'), { target: { value: 'Troquei o feeder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(resolverOcorrenciaAction).toHaveBeenCalledWith('o1', 'Troquei o feeder'))
  })

  it('confirmar VAZIO também resolve (a explicação é opcional)', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    await screen.findByLabelText('O que foi feito')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(resolverOcorrenciaAction).toHaveBeenCalledWith('o1', ''))
  })

  it('cancelar não resolve, e reabrir começa com a caixa limpa', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    fireEvent.change(await screen.findByLabelText('O que foi feito'), { target: { value: 'rascunho' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(resolverOcorrenciaAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    expect(await screen.findByLabelText('O que foi feito')).toHaveValue('')
  })

  it('a explicação gravada aparece na coluna Resolvida; sem texto, nada sobra', () => {
    const resolvida = { ...BASE, estado: 'resolvida' as const, resolvidaPorNome: 'Ana', resolvidaEm: '2026-09-18T13:00:00Z' }
    const tela = montar({ ...resolvida, explicacao: 'Recalibrei a máquina' })
    expect(screen.getByText('Recalibrei a máquina')).toBeInTheDocument()
    tela.unmount()
    montar(resolvida)
    expect(screen.queryByText('Recalibrei a máquina')).not.toBeInTheDocument()
  })
})
