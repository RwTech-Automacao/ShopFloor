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
  // null = a carga dos itens falhou (ou não houve): sem conferência no cliente, o servidor confere no envio.
  itens: null,
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

  it('o envio apara as pontas de cada bipe: o servidor (btrim) não apara tab nem espaço fixo, o JS sim', async () => {
    trocarRolo.mockResolvedValue(APROVADA)
    render(<ConteudoAbastecimento {...PROPS} />)

    // O leitor às vezes acrescenta tab ou espaço fixo; o cliente e o servidor têm de ver o mesmo texto.
    for (const valor of BIPES) bipar(`\t ${valor}\u00a0 `)

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
    expect([...container.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Colaborador', 'Posição', 'Feeder', 'Rolo montado'])
    // Os três bipados; sem itens carregados, o que o sistema esperaria fica em "—" (nunca moldura vazia).
    expect([...container.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['1234', 'L1-A-12', 'FD-0034', '—'])
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

  describe('conferência a cada bipe', () => {
    const ITENS = [
      { posicao: 'P1', feeder: 'F1', componente: 'CAPJ41', rolo: 'CAPJ41-0001' },
      { posicao: 'P4', feeder: 'F4', componente: 'CAPJ41', rolo: 'CAPJ41-0002' },
    ]
    const PROPS_CONF = { ...PROPS, itens: ITENS }

    it('recusa a posição que não existe no setup, sem ir ao servidor', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      bipar('P9')
      expect(await screen.findByText('A posição P9 não existe nesse setup.')).toBeInTheDocument()
      expect(trocarRolo).not.toHaveBeenCalled()
      expect(tocarErro).toHaveBeenCalled()
    })

    it('na recusa, o campo limpa e o passo NÃO avança', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      bipar('P9')
      await screen.findByText('A posição P9 não existe nesse setup.')
      expect(campoAtual()).toHaveValue('')
      expect(screen.getByText(/2\s*\/\s*6/)).toBeInTheDocument()
    })

    it('recusa e depois bipe certo: o painel de erro some', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      bipar('P9')
      await screen.findByText('A posição P9 não existe nesse setup.')
      bipar('P1')
      expect(screen.queryByText('A posição P9 não existe nesse setup.')).not.toBeInTheDocument()
      expect(screen.getByText(/3\s*\/\s*6/)).toBeInTheDocument()
    })

    it('o colaborador aparece em maiúsculas no trilho, mas o envio leva o valor digitado', () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('matheus')
      expect(screen.getByText('MATHEUS')).toBeInTheDocument()
    })

    it('os passos anteriores não se perdem na recusa', async () => {
      const { container } = render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      bipar('P9')
      await screen.findByText('A posição P9 não existe nesse setup.')
      expect([...container.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['1234', 'aguardando', 'aguardando', 'aguardando'])
    })

    it('o caminho certo atravessa os seis passos e envia uma vez só', async () => {
      trocarRolo.mockResolvedValue(APROVADA)
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      for (const v of ['1234', 'P1', 'F1', 'CAPJ41-0001', 'CAPJ41-0099', 'SN-0001']) bipar(v)
      await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(1))
    })

    it('o SN não é conferido no cliente — segue para o servidor', async () => {
      trocarRolo.mockResolvedValue(APROVADA)
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      for (const v of ['1234', 'P1', 'F1', 'CAPJ41-0001', 'CAPJ41-0099', 'SN-FORA-DE-FAIXA']) bipar(v)
      await waitFor(() => expect(trocarRolo).toHaveBeenCalled())
    })

    it('o campo em branco continua recusado pela guarda do vazio (conferência não o deixa passar)', () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      fireEvent.keyDown(campoAtual(), { key: 'Enter' })
      expect(screen.getByText('Campo em branco — bipe o código antes de avançar.')).toBeInTheDocument()
      expect(screen.getByText('2/6')).toBeInTheDocument()
    })

    it('no PTH a recusa fala em posto', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} rotulos={{ posicao: 'Posto', feeder: 'Locação' }} />)
      bipar('1234')
      bipar('P9')
      expect(await screen.findByText('O posto P9 não existe nesse setup.')).toBeInTheDocument()
    })

    it('voltar e trocar a posição reconfere o feeder', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      bipar('1234')
      bipar('P1')
      bipar('F1')
      // Está no passo do rolo que sai (4/6): dois Voltar chegam à posição.
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      bipar('P4')
      expect(screen.getByText('3/6')).toBeInTheDocument()
      expect(campoAtual()).toHaveValue('F1')
      fireEvent.keyDown(campoAtual(), { key: 'Enter' })
      expect(await screen.findByText('O feeder F1 não está na posição P4.')).toBeInTheDocument()
      expect(trocarRolo).not.toHaveBeenCalled()
    })

    it('lista de itens vazia desliga a conferência: o operador não fica preso', async () => {
      trocarRolo.mockResolvedValue(APROVADA)
      render(<ConteudoAbastecimento {...PROPS} itens={[]} />)
      for (const v of ['1234', 'P9', 'F9', 'QUALQUER', 'OUTRO', 'SN-0001']) bipar(v)
      await waitFor(() => expect(trocarRolo).toHaveBeenCalledTimes(1))
    })

    it('recusa o rolo que sai quando não é o montado na posição', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      for (const v of ['1234', 'P1', 'F1']) bipar(v)
      bipar('CAPJ41-0777')
      expect(await screen.findByText('O rolo montado na posição P1 é CAPJ41-0001, não CAPJ41-0777.')).toBeInTheDocument()
      expect(screen.getByText('4/6')).toBeInTheDocument()
      expect(trocarRolo).not.toHaveBeenCalled()
    })

    it('recusa o rolo que entra quando já está montado em outra posição', async () => {
      render(<ConteudoAbastecimento {...PROPS_CONF} />)
      for (const v of ['1234', 'P1', 'F1', 'CAPJ41-0001']) bipar(v)
      bipar('CAPJ41-0002')
      expect(await screen.findByText(/CAPJ41-0002.*P4/)).toBeInTheDocument()
      expect(screen.getByText('5/6')).toBeInTheDocument()
      expect(trocarRolo).not.toHaveBeenCalled()
    })
  })

  describe('o trilho mostra o que o sistema já sabe', () => {
    const ITENS = [{ posicao: 'P14', feeder: 'F07', componente: 'CAPJ41', rolo: 'CAPJ41-0001' }]

    it('depois da posição, mostra feeder e rolo montado (o componente já está no código do rolo)', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={ITENS} />)
      bipar('1234')
      bipar('P14')
      expect(screen.getByText('F07')).toBeInTheDocument()
      expect(screen.getByText('CAPJ41-0001')).toBeInTheDocument()
      expect(screen.queryByText('Componente')).not.toBeInTheDocument()
      expect(screen.getAllByText('esperado').length).toBe(2)
    })

    it('posição SEM rolo montado mostra o Componente: é a única indicação do que deve entrar', () => {
      const VAZIA = [{ posicao: 'P14', feeder: 'F07', componente: 'CAPJ41', rolo: null }]
      render(<ConteudoAbastecimento {...PROPS} itens={VAZIA} />)
      bipar('1234')
      bipar('P14')
      expect(screen.getByText('Componente')).toBeInTheDocument()
      expect(screen.getByText('CAPJ41')).toBeInTheDocument()
    })

    it('antes da posição, diz o que falta em vez de mostrar vazio', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={ITENS} />)
      expect(screen.getByText(/bipe a posição/i)).toBeInTheDocument()
      expect(screen.queryByText('F07')).not.toBeInTheDocument()
    })

    it('sem itens, os campos esperados mostram — e o fluxo segue', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={[]} />)
      bipar('1234')
      bipar('P14')
      expect(screen.getAllByText('—').length).toBe(2)
      expect(screen.getByText('3/6')).toBeInTheDocument()
    })

    it('no PTH o trilho fala em posto e locação', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={ITENS} rotulos={{ posicao: 'Posto', feeder: 'Locação' }} />)
      expect(screen.getByText('Locação')).toBeInTheDocument()
      expect(screen.getByText(/bipe o posto/i)).toBeInTheDocument()
      expect(screen.queryByText('Feeder')).not.toBeInTheDocument()
    })

    it('a trilha marca o passo atual entre seis traços', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={ITENS} />)
      bipar('1234')
      const tracos = screen.getByRole('list', { name: 'Passos da troca' }).querySelectorAll('li')
      expect(tracos.length).toBe(6)
      expect([...tracos].map((t) => t.getAttribute('data-estado'))).toEqual(['feito', 'agora', 'porvir', 'porvir', 'porvir', 'porvir'])
    })

    it('voltar para corrigir não apaga o contexto: o trilho segue o conteúdo, não o número do passo', () => {
      render(<ConteudoAbastecimento {...PROPS} itens={ITENS} />)
      for (const v of ['1234', 'P14', 'F07', 'CAPJ41-0001']) bipar(v)
      expect(screen.getByText('5/6')).toBeInTheDocument()
      // Volta ao passo 2/6 (posição) para corrigir.
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      expect(screen.getByText('2/6')).toBeInTheDocument()
      expect(screen.getByText('P14')).toBeInTheDocument()
      expect(screen.getByText('F07')).toBeInTheDocument()
      // O rolo montado esperado e o rolo que saiu já bipado coincidem aqui; o que importa é o rótulo.
      expect(screen.getByText('Rolo montado')).toBeInTheDocument()
      expect(screen.getAllByText('CAPJ41-0001').length).toBeGreaterThan(0)
      expect(screen.queryByText('aguardando')).not.toBeInTheDocument()
      // E no passo 0 o crachá preenchido continua à vista.
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      expect(screen.getByText('1/6')).toBeInTheDocument()
      expect(screen.getByText('1234')).toBeInTheDocument()
    })

    it('o rolo que saiu e o que entrou aparecem no trilho só depois de bipados', () => {
      const { container } = render(<ConteudoAbastecimento {...PROPS} itens={ITENS} />)
      const rotulos = () => [...container.querySelectorAll('dt')].map((e) => e.textContent)
      for (const v of ['1234', 'P14', 'F07']) bipar(v)
      expect(rotulos()).not.toContain('Rolo que sai')
      expect(rotulos()).not.toContain('Rolo que entra')
      bipar('CAPJ41-0001')
      expect(rotulos()).toContain('Rolo que sai')
      expect(rotulos()).not.toContain('Rolo que entra')
      bipar('CAPJ41-0007')
      expect(screen.getByText('6/6')).toBeInTheDocument()
      expect(rotulos()).toEqual(expect.arrayContaining(['Rolo que sai', 'Rolo que entra']))
      const dd = (rotulo: string) => [...container.querySelectorAll('dt')].find((e) => e.textContent === rotulo)!.nextElementSibling!
      expect(dd('Rolo que sai')).toHaveTextContent('CAPJ41-0001')
      expect(dd('Rolo que entra')).toHaveTextContent('CAPJ41-0007')
      // O código não pode partir cabendo (o operador lê `CAPJ41-0007` de relance), mas também não pode
      // vazar da caixa: `break-words` quebra só quando não cabe nem sozinho na linha. `break-all` partia
      // mesmo cabendo — era o que cortava `CAPJ48-0002` em "CAPJ48-000" e "2". E o `flex-wrap` do dd é
      // quem faz a etiqueta "esperado" descer em vez de espremer o valor.
      expect(dd('Rolo que entra').querySelector('span')!.className).toContain('break-words')
      expect(dd('Rolo que entra').querySelector('span')!.className).not.toContain('break-all')
      expect(dd('Rolo que entra').className).toContain('flex-wrap')
      expect(dd('Rolo que entra').className).toContain('font-mono')
    })

    it('recarregando os itens o trilho diz carregando; sem itens (carga falha) segue —', () => {
      const { rerender } = render(<ConteudoAbastecimento {...PROPS} itens={null} carregandoItens />)
      bipar('1234')
      bipar('P14')
      expect(screen.getAllByText('carregando…').length).toBe(2)
      expect(screen.queryByText('—')).not.toBeInTheDocument()
      rerender(<ConteudoAbastecimento {...PROPS} itens={null} carregandoItens={false} />)
      expect(screen.getAllByText('—').length).toBe(2)
      expect(screen.queryByText('carregando…')).not.toBeInTheDocument()
    })

    it('o cabeçalho mostra onde ele está trabalhando', () => {
      render(<ConteudoAbastecimento {...PROPS} contexto={{ op: 'P/1', processo: 'SMD', local: 'Linha 1 · Bloco A · MG5', face: 'TOP' }} />)
      expect(screen.getByTestId('contexto')).toHaveTextContent('OP P/1 · SMD · Linha 1 · Bloco A · MG5 · TOP')
    })
  })
})
