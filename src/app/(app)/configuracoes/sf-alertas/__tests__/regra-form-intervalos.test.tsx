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
const PMOS = ['PMOA', 'PMOB']
const DESTINATARIOS = [{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true }]
const CONFIGURADOS = { telegram: true, discord: true }
const TOAST = { position: 'bottom-center' }

function regraSalva(extra: Partial<RegraAlerta>): RegraAlerta {
  return {
    id: 'r1',
    atualizadoEm: '2026-09-17T12:00:00Z',
    tipo: 'aprovacao',
    nome: 'Teste 90',
    postos: ['Teste'],
    taxaMinima: 90,
    janelaTipo: 'tempo',
    janelaValor: 60,
    minimoBipes: 20,
    limiteTempoSeg: null,
    limiteOcorrencias: null,
    pausaMaxMin: null,
    lembreteMin: null,
    intervalos: [],
    horaResumo: null,
    canais: ['telegram'],
    avisarPessoas: true,
    avisarCanal: false,
    destinatarios: ['u1'],
    pmos: [],
    ativa: true,
    ...extra,
  }
}

function montar(o: { tipo?: TipoRegra; regra?: RegraAlerta | null } = {}) {
  const onSalvo = vi.fn()
  render(
    <RegraForm
      tipo={o.tipo ?? 'aprovacao'}
      regra={o.regra ?? null}
      postos={POSTOS}
      pmosDisponiveis={PMOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
      canalConfigurado
      onSalvo={onSalvo}
      onCancelar={vi.fn()}
    />,
  )
  return { onSalvo }
}

function preencherObrigatorios(nome: string) {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: nome } })
  fireEvent.click(screen.getByLabelText('Teste'))
  fireEvent.click(screen.getByLabelText('Telegram'))
  fireEvent.click(screen.getByLabelText('Ana Gestora'))
}

/** Marca a janela por blocos e preenche a linha 1 com o intervalo pedido. */
function escolherBlocos(inicio: string, fim: string) {
  fireEvent.click(screen.getByLabelText('Por blocos de turno'))
  fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: inicio } })
  fireEvent.change(screen.getByLabelText('Fim do intervalo 1'), { target: { value: fim } })
}

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
})

describe('RegraForm — janela por blocos de turno: onde ela aparece', () => {
  it('a taxa de aprovação oferece o rádio', () => {
    montar({ tipo: 'aprovacao' })
    expect(screen.getByLabelText('Por blocos de turno')).toBeInTheDocument()
  })

  it('tempo médio não oferece o rádio', () => {
    montar({ tipo: 'tempo' })
    expect(screen.queryByLabelText('Por blocos de turno')).not.toBeInTheDocument()
  })

  it('defeito repetido não oferece o rádio', () => {
    montar({ tipo: 'defeito' })
    expect(screen.queryByLabelText('Por blocos de turno')).not.toBeInTheDocument()
  })

  it('o passo e o editor só aparecem com o rádio marcado', () => {
    montar()
    expect(screen.queryByLabelText('Passo do bloco (min)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Início do intervalo 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    expect(screen.getByLabelText('Passo do bloco (min)')).toHaveValue('60')
    expect(screen.getByLabelText('Início do intervalo 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Fim do intervalo 1')).toBeInTheDocument()
  })

  it('o editor começa com uma linha só, e vazia', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('')
    expect(screen.getByLabelText('Fim do intervalo 1')).toHaveValue('')
    expect(screen.queryByLabelText('Início do intervalo 2')).not.toBeInTheDocument()
  })
})

describe('RegraForm — janela por blocos: o que sai e o que fica da tela', () => {
  it('o lembrete desaparece nessa janela (a validação o ignora) e volta ao sair dela', () => {
    montar()
    expect(screen.getByLabelText('Lembrar a cada (min)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Janela por tempo'))
    expect(screen.getByLabelText('Lembrar a cada (min)')).toBeInTheDocument()
  })

  it('o mínimo de bipes CONTINUA pedido: a validação não o dispensa', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('20')
  })

  it('a prévia desaparece nessa janela (alerta_previa não conhece o bloco) e volta ao sair dela', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    expect(screen.queryByRole('button', { name: 'Ver prévia' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeInTheDocument()
  })
})

describe('RegraForm — o editor de intervalos', () => {
  it('"Adicionar intervalo" acrescenta uma linha', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    expect(screen.getByLabelText('Início do intervalo 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Início do intervalo 3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    expect(screen.getByLabelText('Início do intervalo 3')).toBeInTheDocument()
  })

  it('"Remover" tira a linha DO MEIO, não a primeira', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 1'), { target: { value: '12:00' } })
    fireEvent.change(screen.getByLabelText('Início do intervalo 2'), { target: { value: '13:30' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 2'), { target: { value: '17:30' } })
    fireEvent.change(screen.getByLabelText('Início do intervalo 3'), { target: { value: '19:00' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 3'), { target: { value: '22:00' } })

    fireEvent.click(screen.getByLabelText('Remover intervalo 2'))

    expect(screen.queryByLabelText('Início do intervalo 3')).not.toBeInTheDocument()
    // Sobraram a 1ª e a 3ª, nessa ordem — a do meio é que saiu.
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('07:00')
    expect(screen.getByLabelText('Fim do intervalo 1')).toHaveValue('12:00')
    expect(screen.getByLabelText('Início do intervalo 2')).toHaveValue('19:00')
    expect(screen.getByLabelText('Fim do intervalo 2')).toHaveValue('22:00')
  })

  it('cada linha tem o seu Remover', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    expect(screen.getByLabelText('Remover intervalo 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Remover intervalo 2')).toBeInTheDocument()
  })

  it('"Remover" na linha certa também quando o texto do botão é o mesmo em todas', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Início do intervalo 2'), { target: { value: '13:30' } })
    fireEvent.click(screen.getByLabelText('Remover intervalo 1'))
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('13:30')
    expect(screen.queryByLabelText('Início do intervalo 2')).not.toBeInTheDocument()
  })
})

describe('RegraForm — o aviso da sobra', () => {
  it('07:00–12:00 com passo 90: avisa que o último bloco vai de 11:30 às 12:00', () => {
    montar()
    escolherBlocos('07:00', '12:00')
    fireEvent.change(screen.getByLabelText('Passo do bloco (min)'), { target: { value: '90' } })
    expect(screen.getByRole('status')).toHaveTextContent(
      'O passo não fecha com o intervalo: o último bloco de 07:00–12:00 vai de 11:30 às 12:00 ' +
        '(30 min em vez de 1 h 30 min). Ele será medido e avisado com a faixa real.',
    )
  })

  it('07:00–12:00 com passo 60: nenhum aviso', () => {
    montar()
    escolherBlocos('07:00', '12:00')
    expect(screen.getByLabelText('Passo do bloco (min)')).toHaveValue('60')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('o aviso é por intervalo: só o que sobra aparece', () => {
    montar()
    escolherBlocos('07:00', '12:00')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.change(screen.getByLabelText('Início do intervalo 2'), { target: { value: '13:30' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 2'), { target: { value: '17:30' } })
    fireEvent.change(screen.getByLabelText('Passo do bloco (min)'), { target: { value: '180' } })
    // 07:00–12:00 (5 h) fecha com 3 h? Não: sobram 2 h. 13:30–17:30 (4 h) deixa 1 h.
    const avisos = screen.getAllByRole('status')
    expect(avisos).toHaveLength(2)
    expect(avisos[0]).toHaveTextContent('o último bloco de 07:00–12:00 vai de 10:00 às 12:00 (2 h em vez de 3 h)')
    expect(avisos[1]).toHaveTextContent('o último bloco de 13:30–17:30 vai de 16:30 às 17:30 (1 h em vez de 3 h)')
  })

  it('intervalo incompleto não inventa aviso', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: '07:00' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('o aviso NÃO impede de salvar: a configuração é válida', async () => {
    montar()
    preencherObrigatorios('Blocos de 90')
    escolherBlocos('07:00', '12:00')
    fireEvent.change(screen.getByLabelText('Passo do bloco (min)'), { target: { value: '90' } })
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(toastErro).not.toHaveBeenCalled()
  })
})

describe('RegraForm — salvar na janela por blocos', () => {
  it('manda a janela, o passo e os intervalos preenchidos', async () => {
    const { onSalvo } = montar()
    preencherObrigatorios('Turno em blocos')
    escolherBlocos('07:00', '12:00')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.change(screen.getByLabelText('Início do intervalo 2'), { target: { value: '13:30' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 2'), { target: { value: '17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction).toHaveBeenCalledWith(null, {
      tipo: 'aprovacao',
      nome: 'Turno em blocos',
      postos: ['Teste'],
      taxaMinima: '90',
      janelaTipo: 'intervalos',
      janelaValor: '60',
      minimoBipes: '20',
      limiteTempo: '',
      pausaMaxMin: '',
      limiteOcorrencias: '',
      lembreteMin: '',
      canais: ['telegram'],
      avisarPessoas: true,
      avisarCanal: false,
      destinatarios: ['u1'],
      pmos: [],
      intervalos: [
        { inicio: '07:00', fim: '12:00' },
        { inicio: '13:30', fim: '17:30' },
      ],
      ativa: true,
    })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('o erro da validação dos horários aparece na tela e não vai ao banco', async () => {
    montar()
    preencherObrigatorios('Turno da meia-noite')
    escolherBlocos('22:00', '02:00')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith(
        'O horário final precisa ser maior que o inicial. Turno que passa da meia-noite não é suportado.',
        TOAST,
      ),
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('sem nenhum intervalo cadastrado, o erro é o da validação', async () => {
    montar()
    preencherObrigatorios('Sem horário')
    fireEvent.click(screen.getByLabelText('Por blocos de turno'))
    fireEvent.click(screen.getByLabelText('Remover intervalo 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith('Cadastre pelo menos 1 intervalo de horário.', TOAST),
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })
})

describe('RegraForm — abrir uma regra salva na janela por blocos', () => {
  it('traz o rádio marcado, o passo salvo e os intervalos nos campos', () => {
    montar({
      regra: regraSalva({
        janelaTipo: 'intervalos',
        janelaValor: 90,
        intervalos: [
          { inicio: '07:00', fim: '12:00' },
          { inicio: '13:30', fim: '17:30' },
        ],
      }),
    })
    expect(screen.getByLabelText('Por blocos de turno')).toBeChecked()
    expect(screen.getByLabelText('Passo do bloco (min)')).toHaveValue('90')
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('07:00')
    expect(screen.getByLabelText('Fim do intervalo 1')).toHaveValue('12:00')
    expect(screen.getByLabelText('Início do intervalo 2')).toHaveValue('13:30')
    expect(screen.getByLabelText('Fim do intervalo 2')).toHaveValue('17:30')
  })

  it('a regra salva volta ao banco com os intervalos que tinha', async () => {
    montar({
      regra: regraSalva({
        janelaTipo: 'intervalos',
        janelaValor: 90,
        intervalos: [{ inicio: '07:00', fim: '12:00' }],
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      janelaTipo: 'intervalos',
      janelaValor: '90',
      intervalos: [{ inicio: '07:00', fim: '12:00' }],
    })
  })
})
