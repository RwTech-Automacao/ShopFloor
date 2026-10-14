import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { AlertasTela } from '../alertas-tela'

const avaliarAgoraAction = vi.fn()
const alternarRegraAtivaAction = vi.fn()
const listarOcorrenciasAction = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  avaliarAgoraAction: (...a: unknown[]) => avaliarAgoraAction(...a),
  alternarRegraAtivaAction: (...a: unknown[]) => alternarRegraAtivaAction(...a),
  listarOcorrenciasAction: (...a: unknown[]) => listarOcorrenciasAction(...a),
  resolverOcorrenciaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FILTRO = { de: '2026-10-01', ate: '2026-10-09', estado: '' as const }

function regra(o: Partial<RegraAlerta>): RegraAlerta {
  return {
    id: 'g1', modulo: 'shopfloor', tipo: 'aprovacao', nome: 'Teste abaixo de 90',
    postos: ['Teste'], taxaMinima: 90, janelaTipo: 'tempo', janelaValor: 60, minimoBipes: 20,
    limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null, lembreteMin: null,
    intervalos: [], horaResumo: null, canais: ['telegram'], destinatarios: ['u1'],
    avisarPessoas: true, avisarCanal: false, pmos: [], ativa: true,
    atualizadoEm: '2026-10-09T12:00:00Z', ...o,
  }
}

function montar(modulo: 'shopfloor' | 'recebimento', regras: RegraAlerta[]) {
  render(
    <AlertasTela
      modulo={modulo}
      regras={regras}
      postos={modulo === 'shopfloor' ? [{ chave: 'Teste', temStatus: true, coletaDefeito: true }] : []}
      pmos={[]}
      destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true }]}
      configurados={{ telegram: true, discord: true, email: true }}
      canalConfigurado
      ocorrenciasIniciais={[]}
      filtroInicial={FILTRO}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('a tela de Alertas servindo dois módulos', () => {
  it('mostra as regras que recebeu, e só elas (caso 6)', () => {
    montar('recebimento', [regra({ id: 'g2', modulo: 'recebimento', nome: 'Fim de EMB' })])
    expect(screen.getAllByText('Fim de EMB').length).toBeGreaterThan(0)
    expect(screen.queryByText('Teste abaixo de 90')).not.toBeInTheDocument()
  })

  it('leva o módulo da tela em toda action', async () => {
    alternarRegraAtivaAction.mockResolvedValue({ ok: true })
    avaliarAgoraAction.mockResolvedValue({ ok: true, resumo: { avaliadas: 0, enfileirados: 0, enviados: 0, falhas: 0, ocupado: false } })
    montar('recebimento', [regra({ id: 'g2', modulo: 'recebimento', nome: 'Fim de EMB' })])

    fireEvent.click(screen.getByRole('button', { name: /avaliar agora/i }))
    await waitFor(() => expect(avaliarAgoraAction).toHaveBeenCalledWith('recebimento'))

    fireEvent.click(screen.getAllByRole('switch')[0]!)
    await waitFor(() => expect(alternarRegraAtivaAction).toHaveBeenCalledWith('recebimento', 'g2', false))
  })

  it('carrega as ocorrências do módulo da tela', async () => {
    listarOcorrenciasAction.mockResolvedValue({ ok: true, ocorrencias: [] })
    montar('recebimento', [])
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    // ⚠️ Abrir a aba NÃO busca nada de propósito (a lista inicial já vem do servidor, e há dois
    // testes de `ocorrencias-lista` e um de `alertas-tela` que cobram esse silêncio). Quem dispara
    // a busca é o filtro — é ele que prova que o módulo da TELA chega na action.
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-05' } })
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledWith('recebimento', expect.anything()))
  })

  // ⚠️ Este teste media o estado TEMPORÁRIO do Pedaço 1: o Recebimento existia sem nenhum tipo de
  // regra, e "Nova regra" abriria um diálogo com zero cartões. Com o fim de EMB (0150) o Recebimento
  // tem um tipo, e o beco sem saída desapareceu. O `semTipos` de regras-lista.tsx continua no lugar
  // como defesa do módulo que venha a ser criado sem tipo, mas hoje nenhum módulo cai nele.
  it('no Recebimento, Nova regra abre a escolha com o cartão de Fim de EMB', async () => {
    montar('recebimento', [])
    const botao = screen.getByRole('button', { name: /nova regra/i })
    expect(botao).not.toBeDisabled()
    expect(screen.queryByText(/nenhum tipo de regra/i)).not.toBeInTheDocument()
    fireEvent.click(botao)
    expect(await screen.findByRole('button', { name: /Fim de EMB/ })).toBeInTheDocument()
    // E só ele: os tipos do ShopFloor não aparecem aqui (caso 6 da spec, do lado do cartão).
    expect(screen.queryByText('Taxa de aprovação')).not.toBeInTheDocument()
    expect(screen.queryByText('Resumo diário')).not.toBeInTheDocument()
  })

  it('no ShopFloor, Nova regra continua disponível', () => {
    montar('shopfloor', [])
    expect(screen.getByRole('button', { name: /nova regra/i })).not.toBeDisabled()
  })
})
