import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// vi.mock é içado para o topo: o mock precisa nascer num vi.hoisted (molde: fluxo-form.test.tsx).
const { registrarEntradaAlmoxarifado, listarNecessidadesAlmoxarifado } = vi.hoisted(() => ({
  registrarEntradaAlmoxarifado: vi.fn(),
  // A lista de necessidades (0155) mora no mesmo módulo: o painel a carrega ao abrir a OP.
  listarNecessidadesAlmoxarifado: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({
  registrarEntradaAlmoxarifado,
  listarNecessidadesAlmoxarifado,
}))

import { AlmoxarifadoPanel } from '../almoxarifado-panel'

const PROPS = { colaborador: 'Maria', pmo: 'PMO1', op: '12345', posto: 'Almoxarifado' }

function campo() {
  return screen.getByPlaceholderText('Bipe o Nº de Série ou o código da caixa') as HTMLInputElement
}

function bipar(valor: string) {
  fireEvent.change(campo(), { target: { value: valor } })
  fireEvent.keyDown(campo(), { key: 'Enter' })
}

/**
 * O PainelResultado grande (não o rastro dos últimos bipes, que repete a mesma quantidade e
 * ambiguaria um `findByText` global). `tipo: 'ok'` usa role="status" — `findByRole` reconsulta o
 * DOM vivo a cada tentativa, então continua esperando mesmo que um role="alert" antigo já exista.
 */
async function aguardarPainelOk() {
  return within(await screen.findByRole('status'))
}

beforeEach(() => {
  vi.clearAllMocks()
  listarNecessidadesAlmoxarifado.mockResolvedValue({ ok: true, necessidades: [] })
})

describe('AlmoxarifadoPanel', () => {
  it('bipar uma série chama a action com o texto bipado e mostra "1 peça"', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie' })
    render(<AlmoxarifadoPanel {...PROPS} />)

    bipar('SN00123')

    await waitFor(() =>
      expect(registrarEntradaAlmoxarifado).toHaveBeenCalledWith({
        pmo: 'PMO1',
        op: '12345',
        posto: 'Almoxarifado',
        colaborador: 'Maria',
        bipe: 'SN00123',
      }),
    )
    const p = await aguardarPainelOk()
    expect(p.getByText('1 peça')).toBeInTheDocument()
  })

  it('bipar um código de caixa numa OP coletiva mostra "10 peças"', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 10, tipo: 'caixa' })
    render(<AlmoxarifadoPanel {...PROPS} />)

    bipar('CX[3][10]12345-PMO1')

    const p = await aguardarPainelOk()
    expect(p.getByText('10 peças')).toBeInTheDocument()
  })

  it('recusa devolvida pela action aparece na tela com a frase inteira, e o campo continua focado', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({
      ok: false,
      erro: 'Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.',
    })
    render(<AlmoxarifadoPanel {...PROPS} />)

    bipar('CX[3]')

    expect(
      await screen.findByText('Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(campo()).toHaveFocus())
  })

  it('o campo é limpo depois do bipe aceito — e não depois do recusado', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValueOnce({ ok: false, erro: 'Peça já lançada em 28/09/2026 14:20 por João.' })
    render(<AlmoxarifadoPanel {...PROPS} />)

    bipar('SN00999')
    await screen.findByText('Peça já lançada em 28/09/2026 14:20 por João.')
    // Recusado: o texto bipado continua no campo, para o operador ver o que bipou.
    expect(campo().value).toBe('SN00999')

    registrarEntradaAlmoxarifado.mockResolvedValueOnce({ ok: true, quantidade: 1, tipo: 'serie' })
    bipar('SN00999')
    const p = await aguardarPainelOk()
    expect(p.getByText('1 peça')).toBeInTheDocument()
    // Aceito: o campo esvazia.
    await waitFor(() => expect(campo().value).toBe(''))
  })

  it('um bipe que chega com o anterior ainda em voo não reenvia e não apaga o campo', async () => {
    let resolver: (r: unknown) => void = () => {}
    registrarEntradaAlmoxarifado.mockReturnValue(new Promise((r) => { resolver = r }))
    render(<AlmoxarifadoPanel {...PROPS} />)

    bipar('SN00001')
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledTimes(1)

    // O operador bipa de novo antes da resposta chegar — não pode disparar outra chamada nem sumir
    // com o texto (a fresta que engoliu bipe no Abastecimento, commit 2565526).
    bipar('SN00002')
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledTimes(1)
    expect(campo().value).not.toBe('')

    resolver({ ok: true, quantidade: 1, tipo: 'serie' })
    const p = await aguardarPainelOk()
    expect(p.getByText('1 peça')).toBeInTheDocument()
  })
})

describe('AlmoxarifadoPanel — caixas esperando confirmação (0155)', () => {
  const CX1 = { codigo: 'CX[1][3]12345-PMO1', seq: 1, pecas: 3, fechadaEm: null }
  const CX2 = { codigo: 'CX[2][1]12345-PMO1', seq: 2, pecas: 1, fechadaEm: null }

  it('lista as caixas com o código e o nº de peças, carregadas pela OP do painel', async () => {
    listarNecessidadesAlmoxarifado.mockResolvedValue({ ok: true, necessidades: [CX1, CX2] })
    render(<AlmoxarifadoPanel {...PROPS} />)

    const lista = within(await screen.findByRole('list', { name: 'Caixas esperando confirmação' }))
    expect(lista.getByText('CX[1][3]12345-PMO1')).toBeInTheDocument()
    expect(lista.getByText('3 peças')).toBeInTheDocument()
    expect(lista.getByText('CX[2][1]12345-PMO1')).toBeInTheDocument()
    expect(lista.getByText('1 peça')).toBeInTheDocument()
    expect(listarNecessidadesAlmoxarifado).toHaveBeenCalledWith('PMO1', '12345')
  })

  it('a caixa confirmada pelo bipe some da lista (recarrega depois do bipe aceito)', async () => {
    listarNecessidadesAlmoxarifado.mockResolvedValueOnce({ ok: true, necessidades: [CX1, CX2] })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await screen.findByRole('list', { name: 'Caixas esperando confirmação' })

    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 3, tipo: 'caixa' })
    listarNecessidadesAlmoxarifado.mockResolvedValueOnce({ ok: true, necessidades: [CX2] })
    bipar('CX[1][3]12345-PMO1')

    await waitFor(() => expect(listarNecessidadesAlmoxarifado).toHaveBeenCalledTimes(2))
    const lista = within(screen.getByRole('list', { name: 'Caixas esperando confirmação' }))
    await waitFor(() => expect(lista.queryByText('CX[1][3]12345-PMO1')).not.toBeInTheDocument())
    expect(lista.getByText('CX[2][1]12345-PMO1')).toBeInTheDocument()
  })

  it('sem caixa esperando: texto claro de estado vazio', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    expect(await screen.findByText('Nenhuma caixa esperando confirmação nesta OP.')).toBeInTheDocument()
  })

  it('falha ao carregar mostra o erro, e não o estado vazio', async () => {
    listarNecessidadesAlmoxarifado.mockResolvedValue({
      ok: false, erro: 'Não foi possível carregar as caixas esperando confirmação.',
    })
    render(<AlmoxarifadoPanel {...PROPS} />)
    expect(await screen.findByText('Não foi possível carregar as caixas esperando confirmação.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma caixa esperando confirmação nesta OP.')).not.toBeInTheDocument()
  })

  it('sem OP no cabeçalho ainda: não consulta e não mostra a lista', async () => {
    render(<AlmoxarifadoPanel {...PROPS} pmo="" op="" />)
    expect(campo()).toBeInTheDocument()
    expect(listarNecessidadesAlmoxarifado).not.toHaveBeenCalled()
    expect(screen.queryByText('Caixas esperando confirmação')).not.toBeInTheDocument()
  })

  it('o bipe continua funcionando como hoje com a lista na tela', async () => {
    listarNecessidadesAlmoxarifado.mockResolvedValue({ ok: true, necessidades: [CX1] })
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await screen.findByRole('list', { name: 'Caixas esperando confirmação' })

    bipar('SN00123')
    const p = await aguardarPainelOk()
    expect(p.getByText('1 peça')).toBeInTheDocument()
    await waitFor(() => expect(campo().value).toBe(''))
  })
})

describe('AlmoxarifadoPanel: OP individual', () => {
  it('não mostra a lista de caixas nem a consulta (a unidade é a peça)', async () => {
    render(<AlmoxarifadoPanel {...PROPS} individual />)
    // Dá tempo de um efeito indevido disparar a consulta.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/Caixas esperando confirmação/)).toBeNull()
    expect(screen.queryByText(/Nenhuma caixa esperando/)).toBeNull()
    expect(listarNecessidadesAlmoxarifado).not.toHaveBeenCalled()
  })

  it('o bipe da peça continua funcionando', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie' })
    render(<AlmoxarifadoPanel {...PROPS} individual />)
    bipar('SN00123')
    await waitFor(() => expect(registrarEntradaAlmoxarifado).toHaveBeenCalled())
  })

  it('OP coletiva (padrão) continua listando as caixas', async () => {
    render(<AlmoxarifadoPanel {...PROPS} />)
    expect(await screen.findByText(/Nenhuma caixa esperando/)).toBeTruthy()
    expect(listarNecessidadesAlmoxarifado).toHaveBeenCalledWith('PMO1', '12345')
  })
})
