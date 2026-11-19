import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdensLista } from '../ordens-lista'
import type { OrdemView } from '../ordem-form'

vi.mock('server-only', () => ({}))
vi.mock('../ordem-form', () => ({ OrdemForm: () => null }))
vi.mock('../excluir-ordem-botao', () => ({ ExcluirOrdemBotao: () => null }))
vi.mock('../fluxo-botao', () => ({ FluxoBotao: () => null }))

const view = (id: string, op: string, prts?: OrdemView['prts']): OrdemView => ({
  id, pmo: 'PMOC14', op, cliente: 'LINCE', qtd: 10, descricao: '', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  embalagem_individual: false, placas_por_painel: 1, postos: [], receitaPorPosto: {}, tempoBurninPorPosto: {}, temTrechos: !!prts, prts,
})
const cadeia = [{ codigo: 'PRT420', compelsOp: '8499' }, { codigo: 'PRT410', compelsOp: '8500' }]
const props = { chavesPostos: [], postosPerfil: {}, padroes: [], pmosExistentes: [], clientesExistentes: [], dadosPorPmo: {}, views: [view('a', '8498', cadeia), view('b', '8400')] }
const buscar = (v: string) => fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: v } })

describe('cadeia de PRTs na lista nova', () => {
  it('a busca por número da OP da PRT e por código acha a OP mãe', () => {
    render(<OrdensLista cadeiaPrt {...props} />)
    buscar('8500')
    expect(screen.getByText(/Mostrando 1 de 2/)).toBeTruthy()
    buscar('prt420')
    expect(screen.getByText(/Mostrando 1 de 2/)).toBeTruthy()
  })
  it('a lista antiga, sem a prop, não acha', () => {
    render(<OrdensLista {...props} />)
    buscar('8499')
    expect(screen.getByText(/Mostrando 0 de 2/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /PRTs da OP/ })).toBeNull()
  })
  it('recolhida por padrão, abre na seta, com ordem e recuo da cadeia', () => {
    render(<OrdensLista cadeiaPrt {...props} />)
    expect(screen.getByText('+2 PRTs')).toBeTruthy()
    expect(screen.queryAllByTestId('linha-prt')).toHaveLength(0)
    const seta = screen.getByRole('button', { name: 'Mostrar PRTs da OP 8498' })
    expect(seta.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(seta)
    const linhas = screen.getAllByTestId('linha-prt')
    expect(linhas.map((l) => l.textContent)).toEqual(['└ 8499  PRT420', '└ 8500  PRT410'])
    expect(linhas[0]!.style.paddingLeft).toBe('0.75rem')
    expect(linhas[1]!.style.paddingLeft).toBe('1.5rem')
    expect(screen.queryByText('+2 PRTs')).toBeNull()
    expect(screen.getByRole('button', { name: 'Esconder PRTs da OP 8498' }).getAttribute('aria-expanded')).toBe('true')
  })
  it('PRT sem OP no Compels mostra o aviso', () => {
    render(<OrdensLista cadeiaPrt {...{ ...props, views: [view('a', '8498', [{ codigo: 'PRT420', compelsOp: null }])] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar PRTs da OP 8498' }))
    expect(screen.getByText('sem OP no Compels')).toBeTruthy()
  })
  it('abre sozinha e destaca a PRT encontrada; escolha manual vale até a busca mudar', () => {
    render(<OrdensLista cadeiaPrt {...props} />)
    buscar('8500')
    const linhas = screen.getAllByTestId('linha-prt')
    expect(linhas[1]!.className).toContain('font-semibold')
    expect(linhas[0]!.className).not.toContain('font-semibold')
    fireEvent.click(screen.getByRole('button', { name: 'Esconder PRTs da OP 8498' }))
    expect(screen.queryAllByTestId('linha-prt')).toHaveLength(0)
    buscar('8499')
    expect(screen.getAllByTestId('linha-prt')).toHaveLength(2)
  })
  it('OP sem trechos não tem seta', () => {
    render(<OrdensLista cadeiaPrt {...props} />)
    expect(screen.getAllByRole('button', { name: /PRTs da OP/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /OP 8400/ })).toBeNull()
  })
})
