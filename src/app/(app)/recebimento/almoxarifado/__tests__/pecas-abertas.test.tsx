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

import { PecasAbertas } from '../pecas-abertas'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

const ITEM: PendenciaAlmoxarifado = {
  pmo: 'PMO3', op: '300', tipo: 'peca', codigo: 'AVULSAS', pecas: 3, amostra: null, loteId: null,
  em: '2026-10-21T13:05:00Z',
}
const detalhe = (pecas: number, recebidasOp = 2) => ({
  tipo: 'peca' as const, qtdOp: 12, recebidasOp, postoAnterior: { posto: 'Embalagem', recurso: 'caixa', precisaAprovado: false },
  pecas, sns: [], em: '2026-10-21T13:05:00Z', fechadaPor: null, amostra: null, jaLancadas: 0,
})
const porParagrafo = (texto: string) => (_c: string, el: Element | null) => el?.tagName === 'P' && el.textContent === texto

function montar() {
  const props = { onResultado: vi.fn(), onConfirmado: vi.fn(), onVoltar: vi.fn() }
  render(<PecasAbertas item={ITEM} colaborador="Maria" posto="Almoxarifado" {...props} />)
  return props
}
async function campo() {
  return (await screen.findByPlaceholderText('Bipe o número de série da peça')) as HTMLInputElement
}
async function bipar(v: string) {
  const c = await campo()
  fireEvent.change(c, { target: { value: v } })
  fireEvent.keyDown(c, { key: 'Enter' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T18:00:00Z'))
  vi.clearAllMocks()
  detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: detalhe(3) })
})

describe('PecasAbertas', () => {
  it('mostra contexto, título com N em vinho, instrução, andamento da OP e posto anterior', async () => {
    montar()
    expect(await screen.findByText('OP 300 · PMO3 · individual · sem NQA no posto anterior')).toBeInTheDocument()
    expect(screen.getByText(porParagrafo('Peças avulsas · 3 peças esperando'))).toBeInTheDocument()
    expect(screen.getByText('3 peças')).toHaveClass('text-primary')
    expect(screen.getByText('Bipe o número de série de cada peça que chegou.')).toBeInTheDocument()
    expect(screen.getByText('OP 300: 2 de 12 peças já no Almoxarifado')).toBeInTheDocument()
    expect(screen.getByText('Posto anterior: Embalagem concluído')).toBeInTheDocument()
    expect(await campo()).toHaveFocus()
    expect(detalharPendenciaAlmoxarifado).toHaveBeenCalledWith({ pmo: 'PMO3', op: '300', tipo: 'peca', codigo: 'AVULSAS', loteId: null })
  })

  it('sem qtd da OP omite "de N"; sem posto anterior diz isso', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: { ...detalhe(3), qtdOp: null, postoAnterior: null } })
    montar()
    expect(await screen.findByText('OP 300: 2 peças já no Almoxarifado')).toBeInTheDocument()
    expect(screen.getByText('Sem posto anterior')).toBeInTheDocument()
  })

  it('sucesso: chama a action com o SN, limpa o campo, recarrega o detalhe, lista o bipe e avisa', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie' })
    const p = montar()
    await bipar('SN-1')
    await waitFor(() => expect(p.onResultado).toHaveBeenCalled())
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledWith({
      pmo: 'PMO3', op: '300', posto: 'Almoxarifado', colaborador: 'Maria', bipe: 'SN-1',
    })
    expect(p.onResultado).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'ok', titulo: '1 peça', chips: [{ rotulo: 'Nº Série', valor: 'SN-1', mono: true }],
    }))
    await waitFor(() => expect(detalharPendenciaAlmoxarifado).toHaveBeenCalledTimes(2))
    await waitFor(async () => expect(await campo()).toHaveValue(''))
    const lista = await screen.findByRole('list', { name: 'Últimos bipes aceitos' })
    expect(lista).toHaveTextContent('SN-1')
    expect(await campo()).toHaveFocus()
  })

  it('só os 10 últimos bipes aceitos ficam na lista, o mais novo primeiro', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie' })
    montar()
    for (let i = 1; i <= 12; i++) {
      await bipar(`S${i}`)
      await waitFor(() => expect(registrarEntradaAlmoxarifado).toHaveBeenCalledTimes(i))
      await waitFor(async () => expect(await campo()).toHaveValue(''))
    }
    const itens = (await screen.findByRole('list', { name: 'Últimos bipes aceitos' })).querySelectorAll('li')
    expect(itens).toHaveLength(10)
    expect(itens[0]).toHaveTextContent('S12')
    expect(itens[9]).toHaveTextContent('S3')
  })

  it('recusa: avisa com a frase da action, mantém o texto e não lista', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Esta peça já foi lançada.' })
    const p = montar()
    await bipar('SN-9')
    await waitFor(() => expect(p.onResultado).toHaveBeenCalledWith({ tipo: 'aviso', titulo: 'Esta peça já foi lançada.' }))
    expect(await campo()).toHaveValue('SN-9')
    expect(screen.queryByRole('list', { name: 'Últimos bipes aceitos' })).not.toBeInTheDocument()
    expect(detalharPendenciaAlmoxarifado).toHaveBeenCalledTimes(1)
  })

  it('duplo Enter chama a action uma vez só', async () => {
    let fim: (v: unknown) => void = () => {}
    registrarEntradaAlmoxarifado.mockReturnValue(new Promise((r) => { fim = r }))
    montar()
    const c = await campo()
    fireEvent.change(c, { target: { value: 'SN-2' } })
    fireEvent.keyDown(c, { key: 'Enter' })
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(registrarEntradaAlmoxarifado).toHaveBeenCalledTimes(1)
    fim({ ok: false, erro: 'x' })
    await waitFor(() => expect(c).not.toBeDisabled())
  })

  it('campo vazio não chama a action', async () => {
    montar()
    await bipar('   ')
    expect(registrarEntradaAlmoxarifado).not.toHaveBeenCalled()
  })

  it('0 esperando: frase final e voltar à lista; sem campo de bipe', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: detalhe(0, 12) })
    const p = montar()
    expect(await screen.findByText('Todas as peças desta OP já deram entrada.')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Bipe o número de série da peça')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Voltar à lista/ }))
    expect(p.onVoltar).toHaveBeenCalled()
  })

  it('erro do detalhe aparece como alerta, com voltar', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Não foi possível carregar os detalhes.' })
    const p = montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os detalhes.')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(p.onVoltar).toHaveBeenCalled()
  })
})
