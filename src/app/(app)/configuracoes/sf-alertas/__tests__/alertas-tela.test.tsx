import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { AlertasTela } from '../alertas-tela'

const avaliarAgoraAction = vi.fn()
const listarOcorrenciasAction = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  avaliarAgoraAction: (...a: unknown[]) => avaliarAgoraAction(...a),
  listarOcorrenciasAction: (...a: unknown[]) => listarOcorrenciasAction(...a),
  resolverOcorrenciaAction: vi.fn(),
  alternarRegraAtivaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) },
}))

const RESOLVIDA: OcorrenciaLinha = {
  id: 'o1',
  regraId: 'g1',
  regraNome: 'Teste abaixo de 90',
  regraTipo: 'aprovacao',
  posto: 'Teste',
  defeito: null,
  pmo: null,
  op: null,
  estado: 'resolvida',
  taxaAbertura: 75,
  taxaUltima: 75,
  valorAbertura: 75,
  valorUltimo: 75,
  amostras: 20,
  aprovados: 15,
  reprovados: 5,
  abertaEm: '2026-09-23T12:00:00Z',
  resolvidaPorNome: 'Ana Gestora',
  resolvidaEm: '2026-09-23T13:00:00Z',
  normalizadaEm: null,
  reabertaEm: null,
  reaberturas: 0,
  enviosOk: 2,
  enviosFalha: 0,
}

const FILTRO = { de: '2026-09-17', ate: '2026-09-23', estado: '' as const }

function montar(ocorrencias: OcorrenciaLinha[] = [RESOLVIDA]) {
  render(
    <AlertasTela
      regras={[]}
      postos={['Teste']}
      pmos={[]}
      destinatarios={[]}
      configurados={{ telegram: true, discord: true }}
      canalConfigurado
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={FILTRO}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  avaliarAgoraAction.mockResolvedValue({
    ok: true,
    resumo: { avaliadas: 2, enfileirados: 4, enviados: 0, falhas: 0, ocupado: false },
  })
  listarOcorrenciasAction.mockResolvedValue({ ok: true, ocorrencias: [] })
})

describe('AlertasTela — "Avaliar agora"', () => {
  it('mostra o resumo da avaliação', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/ }))
    await waitFor(() => expect(avaliarAgoraAction).toHaveBeenCalled())
    await waitFor(() =>
      expect(toastSucesso).toHaveBeenCalledWith('2 combinações avaliadas · 0 enviados', {
        position: 'bottom-center',
      }),
    )
  })

  it('a ocorrência REABERTA aparece na hora, sem F5 (o achado do smoke)', async () => {
    // No banco a ocorrência voltou para aberta com reaberturas = 1; a tela mostrava "Resolvida"
    // até o F5, e o gestor concluía que o alerta não tinha funcionado.
    listarOcorrenciasAction.mockResolvedValue({
      ok: true,
      ocorrencias: [{ ...RESOLVIDA, estado: 'aberta', reaberturas: 1, reabertaEm: '2026-09-23T14:00:00Z' }],
    })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    expect(screen.getByRole('cell', { name: 'Resolvida' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/ }))
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Reaberta' })).toBeInTheDocument())
    expect(screen.queryByRole('cell', { name: 'Resolvida' })).not.toBeInTheDocument()
    // A lista foi buscada de novo com o filtro da tela.
    expect(listarOcorrenciasAction).toHaveBeenCalledWith(FILTRO)
  })

  it('renova também o que vem do servidor (mesmo par do setup-estrutura)', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('avaliação ocupada avisa e ainda assim recarrega (a outra rodada está mexendo agora)', async () => {
    avaliarAgoraAction.mockResolvedValue({
      ok: true,
      resumo: { avaliadas: 0, enfileirados: 0, enviados: 0, falhas: 0, ocupado: true },
    })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/ }))
    await waitFor(() =>
      expect(toastSucesso).toHaveBeenCalledWith('Uma avaliação já estava rodando — tente de novo em instantes.', {
        position: 'bottom-center',
      }),
    )
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledWith(FILTRO))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('avaliação que falhou não recarrega nada', async () => {
    avaliarAgoraAction.mockResolvedValue({ ok: false, erro: 'Não foi possível avaliar agora (banco indisponível?).' })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    fireEvent.click(screen.getByRole('button', { name: /Avaliar agora/ }))
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith('Não foi possível avaliar agora (banco indisponível?).', {
        position: 'bottom-center',
      }),
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(listarOcorrenciasAction).not.toHaveBeenCalled()
  })

  it('não busca ocorrências só por abrir a aba (a lista já vem do servidor)', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    expect(listarOcorrenciasAction).not.toHaveBeenCalled()
  })
})
