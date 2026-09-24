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
    avisarPessoas: true,
    avisarCanal: false,
    destinatarios: ['u1'],
    pmos: [],
    ativa: true,
    ...extra,
  }
}

function montar(
  o: { tipo?: TipoRegra; regra?: RegraAlerta | null; onSalvo?: () => void; canalConfigurado?: boolean } = {},
) {
  const onSalvo = o.onSalvo ?? vi.fn()
  render(
    <RegraForm
      tipo={o.tipo ?? 'aprovacao'}
      regra={o.regra ?? null}
      postos={POSTOS}
      pmosDisponiveis={PMOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
      canalConfigurado={o.canalConfigurado ?? true}
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
      avisarPessoas: true,
    avisarCanal: false,
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

  it('responsável salvo que ficou inativo ou sem permissão sai da regra, com aviso', async () => {
    const onSalvo = vi.fn()
    montar({ regra: regraSalva({ destinatarios: ['u1', 'u-inativo', 'u-sem-permissao'] }), onSalvo })
    expect(
      screen.getByText(
        '2 responsável(is) inativo(s) ou sem permissão de administrar o ShopFloor removido(s) da regra — salve para confirmar.',
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
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('10')
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
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('8')
    expect(screen.getByLabelText('OP em andamento')).toBeChecked()
  })

  it('editar regra de tempo sem pausa mostra o campo vazio (padrão só na regra NOVA)', () => {
    montar({
      tipo: 'tempo',
      regra: regraSalva({
        tipo: 'tempo',
        taxaMinima: null,
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: 10,
        limiteTempoSeg: 120,
        pausaMaxMin: null,
      }),
    })
    expect(screen.getByLabelText('Ignorar pausas acima de (min)')).toHaveValue('')
  })

  it('salva com a pausa vazia (conta todas as pausas)', async () => {
    montar({ tipo: 'tempo' })
    preencherObrigatorios('Teste lento')
    fireEvent.change(screen.getByLabelText('Ignorar pausas acima de (min)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ tipo: 'tempo', pausaMaxMin: '' })
  })

  it('prévia mostra o tempo médio de cada posto', async () => {
    previaRegraAction.mockResolvedValueOnce({
      ok: true,
      postos: [{ ...LINHA, mediaSeg: 68.33, intervalos: 29, pecas: 30, avaliavel: true }],
    })
    montar({ tipo: 'tempo' })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    expect(await screen.findByText('Teste: 1:09 por peça (29 intervalos, 30 peças)')).toBeInTheDocument()
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

describe('RegraForm — como avisar', () => {
  it('regra nova nasce na conversa privada, sem canal, com os canais dela à mostra', () => {
    montar()
    expect(screen.getByLabelText('Conversa privada do responsável')).toBeChecked()
    expect(screen.getByLabelText('No canal do Discord')).not.toBeChecked()
    // Telegram/Discord são sub-opções da conversa privada, e ela começa marcada.
    expect(screen.getByLabelText('Telegram')).toBeInTheDocument()
    expect(screen.getByLabelText('Discord')).toBeInTheDocument()
  })

  it('não existe mais um bloco "Canais" separado', () => {
    montar()
    expect(screen.queryByText('Canais')).not.toBeInTheDocument()
    expect(screen.getByText('Como avisar')).toBeInTheDocument()
  })

  it('desmarcar a conversa privada esconde Telegram e Discord', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Conversa privada do responsável'))
    expect(screen.queryByLabelText('Telegram')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Discord')).not.toBeInTheDocument()
    // O aviso em canal continua lá: é irmão da conversa privada, não sub-opção dela.
    expect(screen.getByLabelText('No canal do Discord')).toBeInTheDocument()
  })

  it('grava as duas formas de avisar', async () => {
    montar()
    preencherObrigatorios('Com canal')
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      avisarPessoas: true,
      avisarCanal: true,
      // Privado só no Telegram: o aviso em canal NÃO acrescenta Discord ao fan-out de pessoa.
      canais: ['telegram'],
    })
  })

  it('"só no canal": desmarca a conversa privada e salva sem exigir canal dela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'So canal' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByLabelText('Conversa privada do responsável'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ avisarPessoas: false, avisarCanal: true })
    expect(toastErro).not.toHaveBeenCalled()
  })

  it('lê o que está salvo na regra', () => {
    montar({ regra: regraSalva({ canais: ['discord'], avisarPessoas: false, avisarCanal: true }) })
    expect(screen.getByLabelText('Conversa privada do responsável')).not.toBeChecked()
    expect(screen.getByLabelText('No canal do Discord')).toBeChecked()
    expect(screen.queryByLabelText('Telegram')).not.toBeInTheDocument()
  })

  it('conversa privada marcada sem nenhum canal dela é recusada', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Sem canal' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(toastErro).toHaveBeenCalledWith(
      'Marque pelo menos 1 canal da conversa privada: Telegram ou Discord.',
      TOAST,
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('as duas formas desligadas é recusado', () => {
    montar()
    preencherObrigatorios('Muda')
    fireEvent.click(screen.getByLabelText('Conversa privada do responsável'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(toastErro).toHaveBeenCalledWith(
      'Escolha avisar na conversa privada, no canal do Discord, ou os dois.',
      TOAST,
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('"Fulano sem Telegram" só aparece quando a regra avisa no privado', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Carla Operadora'))
    expect(screen.getByText('Carla Operadora sem Telegram')).toBeInTheDocument()
    // Só no canal: quem vê no canal não precisa de conta vinculada nenhuma.
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByLabelText('Conversa privada do responsável'))
    expect(screen.queryByText('Carla Operadora sem Telegram')).not.toBeInTheDocument()
  })
})

const ERRO_SEM_CANAL =
  'O canal do Discord não está configurado neste ambiente: marque também a conversa privada do responsável, ou peça ao TI para configurar o canal.'

describe('RegraForm — canal do Discord não configurado', () => {
  /** A `<label>` inteira da opção: é nela que o "(não configurado)" aparece. */
  function opcao(nome: string) {
    return screen.getByLabelText(nome).closest('label')!
  }

  it('a opção do canal avisa "(não configurado)" quando falta o DISCORD_CANAL_ID', () => {
    montar({ canalConfigurado: false })
    expect(opcao('No canal do Discord')).toHaveTextContent('(não configurado)')
    // O Discord da conversa privada só precisa do token, que existe: ele continua configurado.
    expect(opcao('Discord')).not.toHaveTextContent('(não configurado)')
  })

  it('com o canal configurado, nenhuma opção fica marcada como não configurada', () => {
    montar()
    expect(opcao('No canal do Discord')).not.toHaveTextContent('(não configurado)')
  })

  it('"só no canal" é recusado: ninguém seria avisado e nem o lembrete salvaria', () => {
    montar({ canalConfigurado: false })
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'So canal' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByLabelText('Conversa privada do responsável'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(toastErro).toHaveBeenCalledWith(ERRO_SEM_CANAL, TOAST)
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('canal MAIS conversa privada continua salvando: as pessoas ainda são avisadas', async () => {
    montar({ canalConfigurado: false })
    preencherObrigatorios('Canal e pessoas')
    fireEvent.click(screen.getByLabelText('No canal do Discord'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ avisarPessoas: true, avisarCanal: true })
    expect(toastErro).not.toHaveBeenCalled()
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
