import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrdensLista } from '../ordens-lista'
import type { OrdemView } from '../ordem-form'

vi.mock('server-only', () => ({}))
vi.mock('../ordem-form', () => ({ OrdemForm: ({ ordem }: { ordem?: { op: string } }) => <button type="button">{`Modal ${ordem?.op ?? 'nova'}`}</button> }))
vi.mock('../excluir-ordem-botao', () => ({ ExcluirOrdemBotao: () => null }))
vi.mock('../fluxo-botao', () => ({ FluxoBotao: () => null }))

const view = (id: string, op: string, temTrechos: boolean): OrdemView => ({
  id, pmo: 'PMOC14', op, cliente: 'LINCE', qtd: 10, descricao: '', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  embalagem_individual: false, placas_por_painel: 1, postos: [], receitaPorPosto: {}, tempoBurninPorPosto: {}, temTrechos,
})
const props = { chavesPostos: [], postosPerfil: {}, padroes: [], pmosExistentes: [], clientesExistentes: [], dadosPorPmo: {}, views: [view('a', '8498', true), view('b', '8400', false)] }

describe('editar OP na lista', () => {
  it('na lista nova, OP com trechos abre a página própria; sem trechos segue no modal', () => {
    render(<OrdensLista editarTrechosBase="/shopfloor/ordens-nova" {...props} />)
    expect(screen.getByRole('link', { name: 'Editar OP' }).getAttribute('href')).toBe('/shopfloor/ordens-nova/a')
    expect(screen.getByText('Modal 8400')).toBeTruthy()
    expect(screen.queryByText('Modal 8498')).toBeNull()
  })
  it('na lista antiga, toda OP edita no modal', () => {
    render(<OrdensLista {...props} />)
    expect(screen.queryByRole('link', { name: 'Editar OP' })).toBeNull()
    expect(screen.getByText('Modal 8498')).toBeTruthy()
  })
})
