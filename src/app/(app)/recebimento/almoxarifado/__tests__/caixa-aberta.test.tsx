import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { registrarEntradaAlmoxarifado, detalharPendenciaAlmoxarifado } = vi.hoisted(() => ({
  registrarEntradaAlmoxarifado: vi.fn(),
  detalharPendenciaAlmoxarifado: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({
  registrarEntradaAlmoxarifado,
  detalharPendenciaAlmoxarifado,
}))

import { CaixaAberta } from '../caixa-aberta'
import { FRASE_CAIXA_ERRADA, type PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

/** Frase com um trecho em destaque (span): o texto inteiro do parágrafo vem dos dois. */
const porParagrafo = (texto: string) => (_c: string, el: Element | null) => el?.tagName === 'P' && el.textContent === texto


const ITEM: PendenciaAlmoxarifado = {
  pmo: 'PMO1', op: '100', tipo: 'caixa', codigo: 'CX[1][40]100-PMO1', pecas: 40, amostra: null, loteId: null,
  em: '2026-10-21T15:30:00Z',
}
const DETALHE = {
  tipo: 'caixa' as const, qtdOp: 200, recebidasOp: 80,
  postoAnterior: { posto: 'Embalagem', recurso: 'x', precisaAprovado: false },
  pecas: 40, sns: ['SN1', 'SN2'], em: '2026-10-21T15:30:00Z', fechadaPor: 'Ana',
  amostra: null, jaLancadas: 0,
}

function montar() {
  const props = { onResultado: vi.fn(), onConfirmado: vi.fn(), onVoltar: vi.fn() }
  render(<CaixaAberta item={ITEM} colaborador="Maria" posto="Almoxarifado" {...props} />)
  return props
}
async function campo() {
  return (await screen.findByPlaceholderText('Bipe o código da caixa')) as HTMLInputElement
}
async function bipar(valor: string) {
  const c = await campo()
  fireEvent.change(c, { target: { value: valor } })
  fireEvent.keyDown(c, { key: 'Enter' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T18:00:00Z'))
  vi.clearAllMocks()
  detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: DETALHE })
})

describe('CaixaAberta', () => {
  it('mostra código grande, SNs, posto anterior e andamento da OP', async () => {
    montar()
    const cod = await screen.findByText('CX[1][40]100-PMO1')
    expect(cod).toHaveClass('text-3xl', 'font-bold', 'font-mono')
    expect(screen.getByText('OP 100 · PMO1 · coletiva · fechada hoje 12:30 por Ana')).toBeInTheDocument()
    expect(screen.getByText(porParagrafo('Bipe este código para confirmar a entrada de 40 peças.'))).toBeInTheDocument()
    expect(screen.getByText('Dentro da caixa: SN1, SN2')).toBeInTheDocument()
    expect(screen.getByText('Posto anterior: Embalagem concluído')).toBeInTheDocument()
    expect(screen.getByText('OP 100: 80 de 200 peças já no Almoxarifado')).toBeInTheDocument()
    expect(detalharPendenciaAlmoxarifado).toHaveBeenCalledWith({
      pmo: 'PMO1', op: '100', tipo: 'caixa', codigo: 'CX[1][40]100-PMO1', loteId: null,
    })
  })

  it('bipe errado avisa e não chama a action nem limpa o campo', async () => {
    const p = montar()
    await bipar('OUTRA')
    expect(p.onResultado).toHaveBeenCalledWith({ tipo: 'aviso', titulo: FRASE_CAIXA_ERRADA })
    expect(registrarEntradaAlmoxarifado).not.toHaveBeenCalled()
    expect((await campo()).value).toBe('OUTRA')
  })

  it('Enter com campo vazio não faz nada', async () => {
    const p = montar()
    await bipar('   ')
    expect(p.onResultado).not.toHaveBeenCalled()
    expect(registrarEntradaAlmoxarifado).not.toHaveBeenCalled()
  })

  it('bipe certo (minúsculo, com espaços) chama a action e confirma', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 40, tipo: 'caixa' })
    const p = montar()
    await bipar('  cx[1][40]100-pmo1 ')
    await waitFor(() => expect(p.onConfirmado).toHaveBeenCalledWith({ quantidade: 40, codigo: 'CX[1][40]100-PMO1', divergencia: undefined }))
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledWith({
      pmo: 'PMO1', op: '100', posto: 'Almoxarifado', colaborador: 'Maria', bipe: 'CX[1][40]100-PMO1',
    })
  })

  it('divergência segue junto na confirmação', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 40, tipo: 'caixa', divergencia: 'Etiqueta 40, contagem 38' })
    const p = montar()
    await bipar('CX[1][40]100-PMO1')
    await waitFor(() => expect(p.onConfirmado).toHaveBeenCalledWith({
      quantidade: 40, codigo: 'CX[1][40]100-PMO1', divergencia: 'Etiqueta 40, contagem 38',
    }))
  })

  it('recusa do banco avisa e o cartão permanece', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Posto anterior não concluído.' })
    const p = montar()
    await bipar('CX[1][40]100-PMO1')
    await waitFor(() => expect(p.onResultado).toHaveBeenCalledWith({ tipo: 'aviso', titulo: 'Posto anterior não concluído.' }))
    expect(p.onConfirmado).not.toHaveBeenCalled()
    expect(screen.getByText('CX[1][40]100-PMO1')).toBeInTheDocument()
  })

  it('duplo Enter chama a action uma vez', async () => {
    let fim: (v: unknown) => void = () => {}
    registrarEntradaAlmoxarifado.mockReturnValue(new Promise((r) => { fim = r }))
    const p = montar()
    const c = await campo()
    fireEvent.change(c, { target: { value: 'CX[1][40]100-PMO1' } })
    fireEvent.keyDown(c, { key: 'Enter' })
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledTimes(1)
    fim({ ok: true, quantidade: 40, tipo: 'caixa' })
    await waitFor(() => expect(p.onConfirmado).toHaveBeenCalledTimes(1))
  })

  it('detalhe com erro mostra a frase e o Voltar', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Esta caixa ou lote não está mais esperando confirmação. Atualize a lista.' })
    const p = montar()
    expect(await screen.findByText(/não está mais esperando confirmação/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(p.onVoltar).toHaveBeenCalled()
  })

  it('item de outro dia mostra a data junto da hora', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, em: '2026-10-20T18:30:00Z' } })
    montar()
    expect(await screen.findByText('OP 100 · PMO1 · coletiva · fechada 20/10 15:30 por Ana')).toBeInTheDocument()
  })

  it('erro do detalhe é anunciado com role=alert', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Falhou ao ler.' })
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou ao ler.')
  })

  it('caixa de 1 peça usa o singular', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, pecas: 1, sns: ['SN1'] } })
    montar()
    expect(await screen.findByText(porParagrafo('Bipe este código para confirmar a entrada de 1 peça.'))).toBeInTheDocument()
  })

  it('posto anterior: com posto e sem posto, sem repetir', async () => {
    montar()
    expect(await screen.findByText('Posto anterior: Embalagem concluído')).toBeInTheDocument()
  })

  it('sem posto anterior mostra só "Sem posto anterior"', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...DETALHE, postoAnterior: null } })
    montar()
    expect(await screen.findByText('Sem posto anterior')).toBeInTheDocument()
    expect(screen.queryByText(/Posto anterior:/)).not.toBeInTheDocument()
  })
})
