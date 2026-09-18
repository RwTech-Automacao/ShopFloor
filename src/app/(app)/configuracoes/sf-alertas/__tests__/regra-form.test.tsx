import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import type { TipoRegra } from '@/modules/alertas/domain/tipos'
import { RegraForm, separarDestinatarios } from '../regra-form'

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

const POSTOS = ['Teste', 'Embalagem']
const PMOS = ['PMOA', 'PMOB', 'PMOG13']
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
  { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
]
const CONFIGURADOS = { telegram: true, discord: true }
const TOAST = { position: 'bottom-center' }

const LINHA = {
  posto: 'Teste',
  defeito: null,
  aprovados: 0,
  reprovados: 0,
  taxa: null,
  mediaSeg: null,
  intervalos: 0,
  pecas: 0,
  ocorrencias: 0,
  avaliavel: false,
  pmo: null,
  op: null,
}

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
    canais: ['telegram'],
    destinatarios: ['u1'],
    pmos: [],
    ativa: true,
    ...extra,
  }
}

function montar(o: { tipo?: TipoRegra; regra?: RegraAlerta | null; onSalvo?: () => void } = {}) {
  const onSalvo = o.onSalvo ?? vi.fn()
  render(
    <RegraForm
      tipo={o.tipo ?? 'aprovacao'}
      regra={o.regra ?? null}
      postos={POSTOS}
      pmosDisponiveis={PMOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
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

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
  previaRegraAction.mockResolvedValue({
    ok: true,
    postos: [{ ...LINHA, aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true }],
  })
})

describe('RegraForm — taxa de aprovação', () => {
  it('começa com os padrões da spec', () => {
    montar()
    expect(screen.getByLabelText('Taxa mínima de aprovação (%)')).toHaveValue('90')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('20')
    expect(screen.getByLabelText('Janela por bipes')).toBeInTheDocument()
  })

  it('salvar sem posto avisa e não chama a action', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Escolha pelo menos 1 posto.', TOAST))
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('avisa quem não recebe pelo canal escolhido', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Carla Operadora'))
    expect(screen.getByText('Carla Operadora sem Telegram')).toBeInTheDocument()
  })

  it('salva a regra com os valores digitados', async () => {
    const { onSalvo } = montar()
    preencherObrigatorios('Teste 90')
    fireEvent.change(screen.getByLabelText('Taxa mínima de aprovação (%)'), { target: { value: '92,5' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction).toHaveBeenCalledWith(null, {
      tipo: 'aprovacao',
      nome: 'Teste 90',
      postos: ['Teste'],
      taxaMinima: '92,5',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      limiteTempo: '',
      pausaMaxMin: '',
      limiteOcorrencias: '',
      lembreteMin: '10',
      canais: ['telegram'],
      destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('janela por OP não manda valor de janela', async () => {
    montar()
    preencherObrigatorios('OP')
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ janelaTipo: 'op', janelaValor: null })
  })

  it('prévia mostra a taxa de agora de cada posto', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    await waitFor(() => expect(previaRegraAction).toHaveBeenCalled())
    expect(await screen.findByText('Teste: 75,0% (15 aprovados, 5 reprovados)')).toBeInTheDocument()
    expect(screen.getByText('Taxa de agora')).toBeInTheDocument()
  })

  it('destinatário salvo que ficou inativo ou sem permissão sai da regra, com aviso', async () => {
    const onSalvo = vi.fn()
    montar({ regra: regraSalva({ destinatarios: ['u1', 'u-inativo', 'u-sem-permissao'] }), onSalvo })
    expect(
      screen.getByText(
        '2 destinatário(s) inativo(s) ou sem permissão de administrar o ShopFloor removido(s) da regra — salve para confirmar.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Ana Gestora')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction.mock.calls[0]![0]).toBe('r1')
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ tipo: 'aprovacao', destinatarios: ['u1'] })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('regra sem destinatário removido não mostra o aviso', () => {
    montar()
    expect(screen.queryByText(/removido\(s\) da regra/)).not.toBeInTheDocument()
  })
})

describe('RegraForm — tempo médio por peça', () => {
  it('mostra só os campos do tipo, com os padrões', () => {
    montar({ tipo: 'tempo' })
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toHaveValue('2:00')
    expect(screen.getByLabelText('Mínimo de intervalos')).toHaveValue('10')
    expect(screen.getByLabelText('Ignorar pausas acima de (min)')).toHaveValue('30')
    expect(screen.getByLabelText('OP em andamento')).toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Janela por bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Repetições para alertar')).not.toBeInTheDocument()
  })

  it('salva o limite em mm:ss e a pausa', async () => {
    montar({ tipo: 'tempo' })
    preencherObrigatorios('Teste lento')
    fireEvent.change(screen.getByLabelText('Tempo máximo por peça (mm:ss)'), { target: { value: '2:30' } })
    fireEvent.change(screen.getByLabelText('Ignorar pausas acima de (min)'), { target: { value: '45' } })
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      tipo: 'tempo',
      limiteTempo: '2:30',
      pausaMaxMin: '45',
      minimoBipes: '10',
      janelaTipo: 'op',
      janelaValor: null,
      taxaMinima: '',
      limiteOcorrencias: '',
    })
  })

  it('mm:ss inválido avisa e não salva', async () => {
    montar({ tipo: 'tempo' })
    preencherObrigatorios('Teste lento')
    fireEvent.change(screen.getByLabelText('Tempo máximo por peça (mm:ss)'), { target: { value: '2:75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith('Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).', TOAST),
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('editar mostra o limite salvo em mm:ss e a janela da regra', () => {
    montar({
      tipo: 'tempo',
      regra: regraSalva({
        tipo: 'tempo',
        taxaMinima: null,
        janelaTipo: 'op',
        janelaValor: null,
        minimoBipes: 8,
        limiteTempoSeg: 150,
        pausaMaxMin: 45,
      }),
    })
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toHaveValue('2:30')
    expect(screen.getByLabelText('Ignorar pausas acima de (min)')).toHaveValue('45')
    expect(screen.getByLabelText('Mínimo de intervalos')).toHaveValue('8')
    expect(screen.getByLabelText('OP em andamento')).toBeChecked()
  })

  it('prévia mostra o tempo médio de cada posto', async () => {
    previaRegraAction.mockResolvedValueOnce({
      ok: true,
      postos: [{ ...LINHA, mediaSeg: 68.33, intervalos: 29, pecas: 30, avaliavel: true }],
    })
    montar({ tipo: 'tempo' })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    expect(await screen.findByText('Teste: 1:08 por peça (29 intervalos, 30 peças)')).toBeInTheDocument()
    expect(previaRegraAction.mock.calls[0]![0]).toMatchObject({ tipo: 'tempo', pausaMaxMin: '30', minimoBipes: '10' })
  })
})

describe('RegraForm — defeito repetido', () => {
  it('mostra só as repetições e a janela por minutos', () => {
    montar({ tipo: 'defeito' })
    expect(screen.getByLabelText('Repetições para alertar')).toHaveValue('5')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.queryByLabelText('Mínimo de bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Janela por tempo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('OP em andamento')).not.toBeInTheDocument()
  })

  it('salva com janela por minutos e sem mínimo de bipes', async () => {
    montar({ tipo: 'defeito' })
    preencherObrigatorios('Defeito 3x')
    fireEvent.change(screen.getByLabelText('Repetições para alertar'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      tipo: 'defeito',
      janelaTipo: 'tempo',
      janelaValor: '60',
      limiteOcorrencias: '3',
      minimoBipes: '',
      taxaMinima: '',
    })
  })

  it('prévia lista os defeitos que chegam ao limite, por posto', async () => {
    previaRegraAction.mockResolvedValueOnce({
      ok: true,
      postos: [
        { ...LINHA, defeito: '2040 COMPONENTE FALTANDO', ocorrencias: 6, avaliavel: true },
        { ...LINHA, posto: 'Embalagem', avaliavel: true },
      ],
    })
    montar({ tipo: 'defeito' })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    expect(await screen.findByText('Teste: 2040 (Componente Faltando) — 6 vezes')).toBeInTheDocument()
    expect(screen.getByText('Embalagem: nenhum defeito repetido 5 vezes ou mais')).toBeInTheDocument()
    expect(screen.getByText('Defeitos repetidos agora')).toBeInTheDocument()
    expect(previaRegraAction.mock.calls[0]![0]).toMatchObject({
      tipo: 'defeito',
      janelaTipo: 'tempo',
      janelaValor: '60',
      limiteOcorrencias: '5',
    })
  })
})

describe('RegraForm — PMOs', () => {
  it('nenhuma marcada = todas; a busca filtra e a marcada vai no salvar', async () => {
    montar()
    expect(screen.getByText('Nenhuma marcada = todas as PMOs.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar PMO'), { target: { value: 'g1' } })
    expect(screen.queryByLabelText('PMO PMOA')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('PMO PMOG13'))
    preencherObrigatorios('Só a G13')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ pmos: ['PMOG13'] })
  })

  it('PMO salva que sumiu da lista continua aparecendo marcada', () => {
    montar({ regra: regraSalva({ pmos: ['PMOZ'] }) })
    expect(screen.getByLabelText('PMO PMOZ')).toBeChecked()
    expect(screen.getByLabelText('PMO PMOA')).not.toBeChecked()
  })
})

describe('separarDestinatarios', () => {
  it('descarta quem não está entre os disponíveis', () => {
    expect(separarDestinatarios(['u1', 'x', 'u3'], DESTINATARIOS)).toEqual({ validos: ['u1', 'u3'], descartados: 1 })
  })

  it('lista de disponíveis vazia (nada carregou) não descarta ninguém', () => {
    expect(separarDestinatarios(['u1', 'x'], [])).toEqual({ validos: ['u1', 'x'], descartados: 0 })
  })
})
