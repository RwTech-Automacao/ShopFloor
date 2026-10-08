import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import type { PostoRegra } from '@/modules/alertas/domain/postos-regra'
import type { TipoRegra } from '@/modules/alertas/domain/tipos'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) },
}))

const POSTOS: PostoRegra[] = [
  { chave: 'Teste', temStatus: true, coletaDefeito: true },
  { chave: 'Embalagem', temStatus: false, coletaDefeito: false },
]
const DESTINATARIOS = [{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true }]

function montar(o: { tipo?: TipoRegra; regra?: RegraAlerta | null } = {}) {
  render(
    <RegraForm
      tipo={o.tipo ?? 'resumo'}
      regra={o.regra ?? null}
      postos={POSTOS}
      pmosDisponiveis={['PMOA']}
      destinatarios={DESTINATARIOS}
      configurados={{ telegram: true, discord: true }}
      canalConfigurado
      onSalvo={vi.fn()}
      onCancelar={vi.fn()}
    />,
  )
}

/** O que foi mandado ao servidor na primeira chamada de salvar. */
const enviado = () => (salvarRegraAction.mock.calls[0] as unknown[])[1] as Record<string, unknown>
/** A mensagem do primeiro toast de erro. */
const erroMostrado = () => String((toastErro.mock.calls[0] as unknown[])[0])

/** Prova que o formulário do resumo MONTOU: as negativas só valem depois disto. */
function provarQueMontou() {
  expect(screen.getByLabelText('Hora do resumo')).toBeInTheDocument()
  expect(screen.getByLabelText('Início do intervalo 1')).toBeInTheDocument()
  expect(screen.getByLabelText('Nome')).toBeInTheDocument()
  expect(screen.getByLabelText('Teste')).toBeInTheDocument()
  expect(screen.getByLabelText('Telegram')).toBeInTheDocument()
  expect(screen.getByLabelText('Ana Gestora')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
}

function preencher(hora?: string) {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Resumo do dia' } })
  fireEvent.click(screen.getByLabelText('Teste'))
  fireEvent.click(screen.getByLabelText('Telegram'))
  fireEvent.click(screen.getByLabelText('Ana Gestora'))
  fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: '07:00' } })
  fireEvent.change(screen.getByLabelText('Fim do intervalo 1'), { target: { value: '17:00' } })
  if (hora !== undefined) fireEvent.change(screen.getByLabelText('Hora do resumo'), { target: { value: hora } })
}

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
})

describe('RegraForm — resumo diário: o que a tela mostra', () => {
  it('traz a hora (padrão 18:00) e o editor de intervalos', () => {
    montar()
    provarQueMontou()
    expect(screen.getByLabelText('Hora do resumo')).toHaveValue('18:00')
    expect(screen.getByLabelText('Hora do resumo')).toHaveAttribute('type', 'time')
  })

  it('esconde os campos que o resumo não usa', () => {
    montar()
    provarQueMontou()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mínimo de bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tempo máximo por peça (mm:ss)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ignorar pausas acima de (min)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Repetições para alertar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Passo do bloco (min)')).not.toBeInTheDocument()
  })

  it('não tem o grupo de rádios da janela', () => {
    montar()
    provarQueMontou()
    expect(screen.queryByLabelText('Janela por tempo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Janela por bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('OP em andamento')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Por blocos de turno')).not.toBeInTheDocument()
  })

  it('não oferece a prévia', () => {
    montar()
    provarQueMontou()
    expect(screen.queryByRole('button', { name: 'Ver prévia' })).not.toBeInTheDocument()
  })

  it('contraste: a taxa de aprovação continua com prévia, taxa e rádios', () => {
    montar({ tipo: 'aprovacao' })
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Taxa mínima de aprovação (%)')).toBeInTheDocument()
    expect(screen.getByLabelText('Janela por tempo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Hora do resumo')).not.toBeInTheDocument()
  })

  it('mantém nome, postos, responsáveis e canais', () => {
    montar()
    provarQueMontou()
    expect(screen.getByLabelText('Conversa privada do responsável')).toBeInTheDocument()
    expect(screen.getByLabelText('No canal do Discord')).toBeInTheDocument()
  })

  it('editar uma regra salva mostra a hora dela e os intervalos dela', () => {
    montar({
      regra: {
        id: 'r1',
        atualizadoEm: '2026-10-08T12:00:00Z',
        tipo: 'resumo',
        nome: 'Resumo',
        postos: ['Teste'],
        taxaMinima: null,
        janelaTipo: 'intervalos',
        janelaValor: null,
        minimoBipes: null,
        limiteTempoSeg: null,
        limiteOcorrencias: null,
        pausaMaxMin: null,
        lembreteMin: null,
        intervalos: [{ inicio: '07:00', fim: '12:00' }],
        horaResumo: '17:30',
        canais: ['telegram'],
        avisarPessoas: true,
        avisarCanal: false,
        destinatarios: ['u1'],
        pmos: [],
        ativa: true,
      },
    })
    expect(screen.getByLabelText('Hora do resumo')).toHaveValue('17:30')
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('07:00')
    expect(screen.getByLabelText('Fim do intervalo 1')).toHaveValue('12:00')
  })
})

describe('RegraForm — resumo diário: o que sai ao salvar', () => {
  it('manda janela por intervalos, sem passo, e nenhum campo que o resumo recusa', async () => {
    montar()
    provarQueMontou()
    preencher()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    const dados = enviado()
    expect(dados).toMatchObject({
      tipo: 'resumo',
      horaResumo: '18:00',
      janelaTipo: 'intervalos',
      janelaValor: null,
      taxaMinima: '',
      minimoBipes: '',
      lembreteMin: '',
      limiteTempo: '',
      limiteOcorrencias: '',
      pausaMaxMin: '',
      intervalos: [{ inicio: '07:00', fim: '17:00' }],
    })
    expect(toastErro).not.toHaveBeenCalled()
  })

  it('aceita as bordas 06:00 e 19:00', async () => {
    for (const hora of ['06:00', '19:00']) {
      salvarRegraAction.mockClear()
      const { unmount } = render(
        <RegraForm
          tipo="resumo"
          regra={null}
          postos={POSTOS}
          pmosDisponiveis={[]}
          destinatarios={DESTINATARIOS}
          configurados={{ telegram: true, discord: true }}
          canalConfigurado
          onSalvo={vi.fn()}
          onCancelar={vi.fn()}
        />,
      )
      preencher(hora)
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
      expect(enviado()).toMatchObject({ horaResumo: hora })
      unmount()
    }
  })

  it.each(['05:59', '19:01'])('recusa a hora %s com a mensagem da faixa, sem ir ao servidor', async (hora) => {
    montar()
    provarQueMontou()
    preencher(hora)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledTimes(1))
    expect(erroMostrado()).toContain('entre 06:00 e 19:00')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('hora vazia: pede a hora, sem ir ao servidor', async () => {
    montar()
    provarQueMontou()
    preencher('')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledTimes(1))
    expect(erroMostrado()).toContain('hora do resumo')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('nunca chama a prévia', () => {
    montar()
    provarQueMontou()
    expect(previaRegraAction).not.toHaveBeenCalled()
  })
})
