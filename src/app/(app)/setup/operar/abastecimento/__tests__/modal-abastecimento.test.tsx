import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConteudoAbastecimento } from '../modal-abastecimento'

const trocarRolo = vi.fn()
vi.mock('@/modules/setup/application/setup-actions', () => ({
  trocarRolo: (...a: unknown[]) => trocarRolo(...a),
}))

const tocarErro = vi.fn()
vi.mock('@/shared/lib/som-erro', () => ({ tocarErro: () => tocarErro() }))

const PROPS = {
  setupId: 's1',
  rotulos: { posicao: 'Posição', feeder: 'Feeder' },
  colaboradorInicial: '',
  onColaboradorUsado: vi.fn(),
  onTrocaRegistrada: vi.fn(),
  onFalhaConexao: vi.fn(),
}

const APROVADA = { ok: true, resultado: 'APROVADO', motivos: [], semFaixa: false }
const BIPES = ['1234', 'L1-A-12', 'FD-0034', 'ROLO-SAI', 'ROLO-ENT', 'SN-0001']

/** Só existe um campo na tela por vez — o do passo atual. */
function campoAtual(): HTMLInputElement {
  return screen.getByRole('textbox')
}

/** Um bipe do leitor: escreve no campo atual e termina em Enter. */
function bipar(valor: string) {
  const campo = campoAtual()
  fireEvent.change(campo, { target: { value: valor } })
  fireEvent.keyDown(campo, { key: 'Enter' })
}

/** Uma volta do laço de eventos: no navegador cada evento do leitor chega em sua própria tarefa. */
const tarefa = () => new Promise((r) => { setTimeout(r, 0) })

/** O bipe do leitor com o tempo do navegador: o valor e o Enter caem em tarefas separadas. */
async function biparRealista(valor: string) {
  fireEvent.change(campoAtual(), { target: { value: valor } })
  await tarefa()
  fireEvent.keyDown(campoAtual(), { key: 'Enter' })
  await tarefa()
}

/** Digitar à mão, sem Enter: é assim que o tablet só de toque chega ao botão do rodapé. */
function digitar(valor: string) {
  fireEvent.change(campoAtual(), { target: { value: valor } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConteudoAbastecimento', () => {
  it('bipar os seis campos em sequência chama trocarRolo com os valores bipados', async () => {
    trocarRolo.mockResolvedValue(APROVADA)
    render(<ConteudoAbastecimento {...PROPS} />)

    for (const valor of BIPES) bipar(valor)

    await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(1))
    expect(trocarRolo).toHaveBeenCalledWith({
      setupId: 's1',
      posicao: 'L1-A-12',
      feeder: 'FD-0034',
      roloSaida: 'ROLO-SAI',
      roloEntrada: 'ROLO-ENT',
      snInicial: 'SN-0001',
      colaborador: '1234',
    })
  })

  it('contador vai de 1/6 a 6/6 e Voltar volta um passo sem perder o valor', () => {
    render(<ConteudoAbastecimento {...PROPS} />)
    expect(screen.getByText('1/6')).toBeInTheDocument()

    bipar('1234')
    expect(screen.getByText('2/6')).toBeInTheDocument()
    bipar('L1-A-12')
    bipar('FD-0034')
    bipar('ROLO-SAI')
    bipar('ROLO-ENT')
    expect(screen.getByText('6/6')).toBeInTheDocument()
    expect(screen.getByLabelText('SN Inicial')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByText('5/6')).toBeInTheDocument()
    expect(campoAtual().value).toBe('ROLO-ENT')
  })

  it('campo vazio não avança: o Enter em branco mantém o operador no mesmo passo', () => {
    render(<ConteudoAbastecimento {...PROPS} />)
    fireEvent.keyDown(campoAtual(), { key: 'Enter' })
    expect(screen.getByText('1/6')).toBeInTheDocument()
  })

  it('no passo 4/6 o rastro mostra os três valores já bipados e nenhum a mais', () => {
    const { container } = render(<ConteudoAbastecimento {...PROPS} />)
    bipar('1234')
    bipar('L1-A-12')
    bipar('FD-0034')

    expect(screen.getByText('4/6')).toBeInTheDocument()
    expect([...container.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Colaborador:', 'Posição:', 'Feeder:'])
    expect([...container.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['1234', 'L1-A-12', 'FD-0034'])
  })

  it('depois de uma troca aprovada volta ao 1/6 com o crachá preenchido e os outros cinco vazios', async () => {
    trocarRolo.mockResolvedValue(APROVADA)
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES) bipar(valor)

    expect(await screen.findByText('Troca aprovada — pode seguir')).toBeInTheDocument()
    expect(screen.getByText('1/6')).toBeInTheDocument()
    expect(campoAtual().value).toBe('1234')

    // Confirma o crachá e passa pelos cinco bipes: todos recomeçam vazios.
    fireEvent.keyDown(campoAtual(), { key: 'Enter' })
    for (const valor of ['P2', 'F2', 'S2', 'E2']) {
      expect(campoAtual().value).toBe('')
      bipar(valor)
    }
    expect(screen.getByText('6/6')).toBeInTheDocument()
    expect(campoAtual().value).toBe('')
  })

  it('no 1/6 pré-preenchido o Enter confirma o crachá sem alterar, e focar seleciona para o leitor sobrescrever', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    render(<ConteudoAbastecimento {...PROPS} colaboradorInicial="1234" />)

    expect(campoAtual().value).toBe('1234')
    // O foco do passo já selecionou o conteúdo: o bipe substitui em vez de concatenar.
    expect(select).toHaveBeenCalled()

    fireEvent.keyDown(campoAtual(), { key: 'Enter' })
    expect(screen.getByText('2/6')).toBeInTheDocument()
    expect(screen.getByText('1234')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    const campo = campoAtual()
    select.mockClear()
    fireEvent.focus(campo)
    expect(select).toHaveBeenCalled()
    fireEvent.change(campo, { target: { value: '5678' } })
    expect(campo.value).toBe('5678')

    select.mockRestore()
  })

  it('o botão do rodapé avança o passo, igual ao Enter', () => {
    render(<ConteudoAbastecimento {...PROPS} />)
    digitar('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }))
    expect(screen.getByText('2/6')).toBeInTheDocument()
    expect(screen.getByLabelText('Posição')).toBeInTheDocument()
  })

  it('no 6/6 o botão registra a troca', async () => {
    trocarRolo.mockResolvedValue(APROVADA)
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES.slice(0, 5)) bipar(valor)
    digitar('SN-0001')

    fireEvent.click(screen.getByRole('button', { name: 'Registrar troca' }))

    await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(1))
    expect(trocarRolo).toHaveBeenCalledWith({
      setupId: 's1',
      posicao: 'L1-A-12',
      feeder: 'FD-0034',
      roloSaida: 'ROLO-SAI',
      roloEntrada: 'ROLO-ENT',
      snInicial: 'SN-0001',
      colaborador: '1234',
    })
  })

  it('com o campo em branco o botão não avança nem registra', () => {
    trocarRolo.mockResolvedValue(APROVADA)
    render(<ConteudoAbastecimento {...PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }))
    expect(screen.getByText('1/6')).toBeInTheDocument()

    for (const valor of BIPES.slice(0, 5)) bipar(valor)
    expect(screen.getByText('6/6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar troca' }))
    expect(trocarRolo).not.toHaveBeenCalled()
  })

  it('troca reprovada volta ao 2/6 com os cinco bipes vazios e toca o som de erro', async () => {
    trocarRolo.mockResolvedValue({ ok: true, resultado: 'REPROVADO', motivos: ['O feeder F03 não está na posição 01.'], semFaixa: false })
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES) bipar(valor)

    expect(await screen.findByText('Troca reprovada — confira o componente')).toBeInTheDocument()
    expect(screen.getByText('O feeder F03 não está na posição 01.')).toBeInTheDocument()
    expect(tocarErro).toHaveBeenCalled()
    // Volta na posição: a reprova costuma ser de posição/feeder, não do rolo.
    expect(screen.getByText('2/6')).toBeInTheDocument()

    // Os cinco bipes vêm vazios — não dá para reenviar a mesma troca errada só apertando Enter.
    for (const valor of ['P2', 'F2', 'S2', 'E2']) {
      expect(campoAtual().value).toBe('')
      bipar(valor)
    }
    expect(screen.getByText('6/6')).toBeInTheDocument()
    expect(campoAtual().value).toBe('')
    // O crachá segue preenchido: só os campos bipados zeram.
    expect(screen.getByText('1234')).toBeInTheDocument()
  })

  /**
   * A corrida que engolia bipe: enquanto o envio não terminava de assentar, o reset dos campos
   * apagava por cima o que o operador tinha acabado de bipar, e o Enter caía na regra do campo
   * vazio — sem som, sem aviso, sem mexer no contador. Estes três testes fixam o tempo do
   * servidor na mão, então não dependem de sorte nem de carga da máquina.
   */
  it('bipe com a troca anterior em voo é recusado com som e aviso, sem reenviar nada', async () => {
    let responder: (r: unknown) => void = () => {}
    trocarRolo.mockReturnValue(new Promise((r) => { responder = r }))
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES) bipar(valor)
    expect(screen.getByText('6/6')).toBeInTheDocument()

    // O operador não olha a tela: já bipou a posição do componente seguinte.
    await biparRealista('P2')

    // Não passou — mas ele fica sabendo, e o servidor não foi chamado de novo.
    expect(tocarErro).toHaveBeenCalled()
    expect(screen.getByText('Registrando a troca anterior — esse bipe não contou. Bipe de novo.')).toBeInTheDocument()
    expect(screen.getByText('6/6')).toBeInTheDocument()
    expect(trocarRolo).toHaveBeenCalledTimes(1)

    // E a troca que estava em voo termina normalmente.
    responder(APROVADA)
    expect(await screen.findByText('Troca aprovada — pode seguir')).toBeInTheDocument()
    expect(screen.getByText('1/6')).toBeInTheDocument()
  })

  it('bipe que cai na virada da resposta do servidor não desaparece calado', async () => {
    let responder: (r: unknown) => void = () => {}
    trocarRolo.mockReturnValue(new Promise((r) => { responder = r }))
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES) bipar(valor)

    // A resposta chega e o componente começa a se reorganizar — o bipe do operador cai justo aí.
    responder({ ok: true, resultado: 'REPROVADO', motivos: ['O feeder F03 não está na posição 01.'], semFaixa: false })
    await Promise.resolve()
    await Promise.resolve()
    tocarErro.mockClear() // o som da própria reprova não conta; só o que este bipe causar

    await biparRealista('P2')

    // Ou o bipe vale (o valor ficou, o passo andou), ou o operador é avisado. Sumir calado, não.
    const naoSumiu = campoAtual().value !== '' || screen.queryByText('3/6') !== null
    const avisou = tocarErro.mock.calls.length > 0
    expect(naoSumiu || avisou).toBe(true)
  })

  it('quando a tela mostra o passo novo, o componente já aceita bipe', async () => {
    trocarRolo.mockResolvedValue({ ok: true, resultado: 'REPROVADO', motivos: ['O feeder F03 não está na posição 01.'], semFaixa: false })
    render(<ConteudoAbastecimento {...PROPS} />)
    for (const valor of BIPES) bipar(valor)

    // No mesmo desenho em que aparece o 2/6 os botões já têm de estar liberados: tela dizendo
    // "pode bipar" com o componente ainda travado é exatamente o que engolia bipe.
    expect(await screen.findByText('2/6')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar' })).not.toBeDisabled()

    // E aceitar de verdade, não só parecer liberado.
    tocarErro.mockClear()
    await biparRealista('P2')
    expect(screen.getByText('3/6')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(tocarErro).not.toHaveBeenCalled()
  })
})
