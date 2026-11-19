import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { OpEspelho, TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acoes = vi.hoisted(() => ({
  editarOrdemAction: vi.fn(), criarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn(),
  cadastrarOpAction: vi.fn(), ultimaOpDaPmoAction: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({
  editarOrdemAction: acoes.editarOrdemAction, criarOrdemAction: acoes.criarOrdemAction, opTemRegistrosAction: acoes.opTemRegistrosAction,
}))
vi.mock('@/modules/shopfloor/application/cadastro-op-actions', () => ({
  cadastrarOpAction: acoes.cadastrarOpAction, ultimaOpDaPmoAction: acoes.ultimaOpDaPmoAction,
}))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => ({ confirmar: vi.fn(), dialog: null }) }))
// O Select do Base UI não abre em jsdom: vira um <select> nativo com o nome do gatilho.
vi.mock('@/components/ui/select', () => {
  const SelectTrigger = ({ children }: { children?: ReactNode; 'aria-label'?: string }) => (children ? null : null)
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: ReactNode }) => {
      const gatilho = Children.toArray(children).find((c) => isValidElement(c) && c.type === SelectTrigger) as ReactElement<{ 'aria-label'?: string }> | undefined
      return (
        <select aria-label={gatilho?.props['aria-label']} value={value} onChange={(e) => onValueChange?.(e.target.value)}>
          <option value="" />
          {children}
        </select>
      )
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => <option value={value}>{children}</option>,
  }
})

const { EditarOpCliente } = await import('../../ordens-nova/[id]/editar-op-cliente')
const { NovaOpCliente } = await import('../nova/nova-op-cliente')
const { toast } = await import('sonner')

// 0195: a receita da Integração oferece, além das PMOs, as PRTs desta OP com série própria
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' }, Integração: { recurso: 'integracao' } } as never
const CATALOGO = ['SPI', 'Montagem PTH', 'Integração', 'Teste', 'Almoxarifado']
const trecho = (t: Partial<TrechoCadastro> & Pick<TrechoCadastro, 'seq' | 'codigo' | 'tipo' | 'postos'>): TrechoCadastro => ({
  compelsOp: String(8500 - t.seq), descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', faixas: [], ...t,
})
const TRECHOS = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', postos: ['SPI'], snModo: 'proprio', faixas: [{ sn_ini: 'A001', sn_fim: 'A010' }] }),
  trecho({ seq: 2, codigo: 'PRT420', tipo: 'prt', postos: ['Montagem PTH'] }),
  trecho({ seq: 3, codigo: 'PMOC14', tipo: 'pmo', postos: ['Integração', 'Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] }),
]
const ORDEM = { id: 'u1', pmo: 'PMOC14', op: '8497', cliente: 'LINCE', qtd: 10, descricao: '', acp: '', status: 'ATIVA', embalagemIndividual: false, placasPorPainel: 1 }
const editar = (extra: Record<string, unknown> = {}) => render(
  <EditarOpCliente ordem={ORDEM} trechos={TRECHOS} resumo={[]} postos={CATALOGO} postosPerfil={PERFIS} clientesExistentes={[]}
    temRegistros={false} receita={{}} tempoBurnin={{}} pmosExistentes={['PMOC14', 'PMOX', 'PRT410']} {...extra} />,
)
const enviado = () => JSON.parse(String((acoes.editarOrdemAction.mock.calls[0]![1] as FormData).get('componentes')))
const opcoes = (nome: string) => within(screen.getByRole('combobox', { name: nome })).getAllByRole('option').map((o) => o.textContent).filter(Boolean)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.editarOrdemAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8497' })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u2', pmo: 'PMOC14', op: '8498' })
})

describe('edição de OP com trechos: PRTs desta OP na receita', () => {
  it('o grupo "PRTs desta OP" oferece só as PRTs de série própria, e elas não aparecem como PMO', () => {
    editar()
    expect(screen.getByRole('group', { name: 'PRTs desta OP · Integração' })).toBeTruthy()
    expect(opcoes('Adicionar PRT desta OP à receita de Integração')).toEqual(['PRT410'])
    expect(opcoes('Adicionar PMO à receita de Integração')).toEqual(['PMOX'])
  })

  it('a PRT escolhida vai no salvar e sai da lista do grupo', async () => {
    editar()
    fireEvent.change(screen.getByRole('combobox', { name: 'Adicionar PRT desta OP à receita de Integração' }), { target: { value: 'PRT410' } })
    expect(screen.getByRole('button', { name: 'Remover PRT410' })).toBeTruthy()
    // o grupo e a ajuda continuam na tela, sem a lista
    const grupo = screen.getByRole('group', { name: 'PRTs desta OP · Integração' })
    expect(within(grupo).getByText('Todas as PRTs desta OP já estão na receita.')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Adicionar PRT desta OP à receita de Integração' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Adicionar PMO à receita de Integração' }), { target: { value: 'PMOX' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toEqual({ Integração: ['PRT410', 'PMOX'] })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('a PRT que passa para a mesma série da PMO sai da receita ao salvar, com aviso', async () => {
    editar({ receita: { Integração: ['PRT410', 'PMOX'] }, pmosExistentes: ['PMOC14', 'PMOX'] })
    const prt = screen.getByRole('region', { name: 'PRT410 (8499)' })
    fireEvent.click(within(prt).getByLabelText('Mesma série da PMO'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toEqual({ Integração: ['PMOX'] })
    expect(toast.warning).toHaveBeenCalledWith(
      'PRT410 saiu da receita da Integração: ela não é mais uma PRT de série própria desta OP.', expect.anything())
    expect(screen.queryByRole('button', { name: 'Remover PRT410' })).toBeNull()
  })

  it('salvar recusado: a receita na tela não muda e não há aviso', async () => {
    acoes.editarOrdemAction.mockResolvedValue({ ok: false, erro: 'Não foi possível salvar a OP.' })
    editar({ receita: { Integração: ['PRT410', 'PMOX'] }, pmosExistentes: ['PMOC14', 'PMOX'] })
    fireEvent.click(within(screen.getByRole('region', { name: 'PRT410 (8499)' })).getByLabelText('Mesma série da PMO'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    // o servidor recebeu a receita limpa, mas a tela só muda quando o salvamento acontece
    expect(enviado()).toEqual({ Integração: ['PMOX'] })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.warning).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remover PRT410' })).toBeTruthy()
  })

  it('a PRT de mesma série que também é PMO de uma OP cadastrada fica na receita, sem aviso', async () => {
    editar({ receita: { Integração: ['PRT410'] } }) // PRT410 está em pmosExistentes (OP separada)
    fireEvent.click(within(screen.getByRole('region', { name: 'PRT410 (8499)' })).getByLabelText('Mesma série da PMO'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toEqual({ Integração: ['PRT410'] })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('OP só com PRTs de mesma série: o grupo mostra as PRTs apagadas, com a dica, sem lista para escolher', async () => {
    editar({ trechos: [{ ...TRECHOS[0]!, snModo: 'mesmo', faixas: [] }, TRECHOS[1]!, TRECHOS[2]!], receita: { Integração: ['PMOX'] } })
    const grupo = screen.getByRole('group', { name: 'PRTs desta OP · Integração' })
    const apagadas = within(grupo).getAllByRole('listitem')
    expect(apagadas.map((li) => li.getAttribute('data-apagada'))).toEqual(['true', 'true'])
    expect(apagadas.map((li) => li.textContent)).toEqual([
      'PRT410Para usar na receita, cadastre esta PRT com série própria.',
      'PRT420Para usar na receita, cadastre esta PRT com série própria.',
    ])
    expect(within(grupo).queryByRole('combobox')).toBeNull()
    expect(within(grupo).queryByRole('button')).toBeNull()
    expect(within(grupo).queryByText('Todas as PRTs desta OP já estão na receita.')).toBeNull()
    // sem PRT de série própria, o código continua oferecido como PMO (como antes)
    expect(opcoes('Adicionar PMO à receita de Integração')).toEqual(['PRT410'])
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toEqual({ Integração: ['PMOX'] })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('PRT de série própria e de mesma série juntas: só a de série própria é selecionável', () => {
    editar()
    const grupo = screen.getByRole('group', { name: 'PRTs desta OP · Integração' })
    expect(opcoes('Adicionar PRT desta OP à receita de Integração')).toEqual(['PRT410'])
    const apagadas = within(grupo).getAllByRole('listitem')
    expect(apagadas).toHaveLength(1)
    expect(apagadas[0]!.textContent).toBe('PRT420Para usar na receita, cadastre esta PRT com série própria.')
    expect(apagadas[0]!.getAttribute('data-apagada')).toBe('true')
  })

  it('sem PMO para adicionar: avisa em vez de sumir com a lista', () => {
    editar({ receita: { Integração: ['PMOX'] } }) // PMOX já está; PRT410 é PRT desta OP, não PMO
    expect(screen.queryByRole('combobox', { name: 'Adicionar PMO à receita de Integração' })).toBeNull()
    expect(screen.getByText('Nenhuma outra PMO cadastrada.')).toBeTruthy()
  })

  it('OP sem PRT nenhuma: sem o grupo', () => {
    editar({ trechos: [TRECHOS[2]!] })
    expect(screen.queryByRole('group', { name: /PRTs desta OP/ })).toBeNull()
  })
})

describe('ReceitaIntegracao no modal antigo (sem as props novas)', () => {
  it('sem PMO disponível a lista some, sem aviso nem grupo de PRTs (como antes)', async () => {
    const { ReceitaIntegracao } = await import('../editores-posto')
    render(<ReceitaIntegracao posto="Integração" receita={['PMOX']} setReceita={() => {}} pmosDisponiveis={[]} />)
    expect(screen.queryByText('Nenhuma outra PMO cadastrada.')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })
})

describe('Nova OP: PRT que saiu da estrutura sai da receita', () => {
  const ESPELHO: OpEspelho[] = [{
    numero: 8498, idCompels: 8498, codigo: 'PMOC14', descricao: 'PLACA X', situacao: 'Em Processo', nivel: 1, quantidade: 10,
    quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'CLIENTE', dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z',
  }]
  it('a PRT da receita da última OP que não está na OP nova sai no salvar, com aviso; as PMOs ficam', async () => {
    acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
      op: '8476', cliente: 'LINCE', descricao: '', placasPorPainel: 1, embalagemIndividual: false,
      postos: [{ posto: 'SPI', trechoCodigo: 'PRT999' }, { posto: 'Integração', trechoCodigo: 'PMOC14' }, { posto: 'Almoxarifado', trechoCodigo: 'PMOC14' }],
      componentes: [{ posto: 'Integração', pmo: 'PMOX' }, { posto: 'Integração', pmo: 'PRT999' }], burnin: [],
    } })
    render(<NovaOpCliente espelho={ESPELHO} postos={CATALOGO} postosPerfil={PERFIS} clientesExistentes={[]} pmosExistentes={['PMOC14', 'PMOX']} />)
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    fireEvent.change(await screen.findByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
    // a OP nova não tem PRT: o grupo não aparece
    expect(screen.queryByRole('group', { name: /PRTs desta OP/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    expect(acoes.cadastrarOpAction.mock.calls[0]![0].componentes).toEqual([{ posto: 'Integração', pmo: 'PMOX' }])
    expect(toast.warning).toHaveBeenCalledWith(
      'PRT999 saiu da receita da Integração: ela não é mais uma PRT de série própria desta OP.', expect.anything())
  })
})
