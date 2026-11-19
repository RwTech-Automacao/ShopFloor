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

const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' }, Integração: { recurso: 'integracao' }, 'Burn-in': { recurso: 'burnin' } } as never
const CATALOGO = ['SPI', 'Integração', 'Burn-in', 'Teste', 'Almoxarifado']
const trecho = (t: Partial<TrechoCadastro> & Pick<TrechoCadastro, 'seq' | 'codigo' | 'tipo' | 'postos'>): TrechoCadastro => ({
  compelsOp: String(8500 - t.seq), descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', faixas: [], ...t,
})
const TRECHOS = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', postos: ['SPI'] }),
  trecho({ seq: 2, codigo: 'PMOC14', tipo: 'pmo', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] }),
]
const ORDEM = { id: 'u1', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: '', acp: '', status: 'ATIVA', embalagemIndividual: false, placasPorPainel: 1 }
const editar = (extra: Record<string, unknown> = {}) => render(
  <EditarOpCliente ordem={ORDEM} trechos={TRECHOS} resumo={[]} postos={CATALOGO} postosPerfil={PERFIS} clientesExistentes={[]}
    temRegistros={false} receita={{}} tempoBurnin={{}} pmosExistentes={['PMOC14', 'PMOX', 'PMOY']} {...extra} />,
)
const pmoRegiao = () => screen.getByRole('region', { name: 'PMOC14 (8498)' })
const adicionarPosto = (posto: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Adicionar posto em PMOC14 (8498)' }), { target: { value: posto } })
const enviado = () => Object.fromEntries((acoes.editarOrdemAction.mock.calls[0]![1] as FormData).entries())

beforeEach(() => {
  vi.clearAllMocks()
  acoes.editarOrdemAction.mockResolvedValue({ ok: true, id: 'u1', pmo: 'PMOC14', op: '8498' })
  acoes.cadastrarOpAction.mockResolvedValue({ ok: true, id: 'u2', pmo: 'PMOC14', op: '8498' })
})

describe('edição de OP com trechos: receita da Integração e tempo de Burn-in', () => {
  it('incluir um posto de Integração abre a receita dele; as PMOs escolhidas vão no salvar', async () => {
    editar()
    expect(screen.queryByText(/Receita · Integração/)).toBeNull()
    adicionarPosto('Integração')
    expect(within(pmoRegiao()).getByText(/Receita · Integração/)).toBeTruthy()
    expect(screen.getByText('Sem receita: a Integração aceita placas de qualquer PMO.')).toBeTruthy()
    const pmos = screen.getByRole('combobox', { name: 'Adicionar PMO à receita de Integração' })
    // a PMO da própria OP não se oferece
    expect(within(pmos).queryByRole('option', { name: 'PMOC14' })).toBeNull()
    fireEvent.change(pmos, { target: { value: 'PMOY' } })
    expect(screen.getByRole('button', { name: 'Remover PMOY' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(JSON.parse(enviado().componentes as string)).toEqual({ Integração: ['PMOY'] })
  })

  it('a receita gravada aparece e sai do salvar quando o posto sai da rota', async () => {
    const trechos = [TRECHOS[0]!, { ...TRECHOS[1]!, postos: ['Integração', 'Teste', 'Almoxarifado'] }]
    editar({ trechos, receita: { Integração: ['PMOX'] } })
    expect(screen.getByRole('button', { name: 'Remover PMOX' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remover Integração' }))
    expect(screen.queryByText(/Receita · Integração/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(JSON.parse(enviado().componentes as string)).toEqual({})
  })

  it('posto de Burn-in novo entra com 6:00; o tempo editado vai no salvar', async () => {
    editar()
    adicionarPosto('Burn-in')
    const tempo = screen.getByLabelText('Tempo mínimo de Burn-in em Burn-in') as HTMLInputElement
    expect(tempo.value).toBe('6:00')
    fireEvent.change(tempo, { target: { value: '7:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(JSON.parse(enviado().tempo_burnin as string)).toEqual({ 'Burn-in': '7:30' })
  })

  it('o tempo gravado aparece em hhh:mm; tempo inválido é recusado na tela', async () => {
    const trechos = [TRECHOS[0]!, { ...TRECHOS[1]!, postos: ['Burn-in', 'Teste', 'Almoxarifado'] }]
    editar({ trechos, tempoBurnin: { 'Burn-in': 125 } })
    const tempo = screen.getByLabelText('Tempo mínimo de Burn-in em Burn-in') as HTMLInputElement
    expect(tempo.value).toBe('2:05')
    fireEvent.change(tempo, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Tempo mínimo de Burn-in inválido no posto Burn-in (use hhh:mm).', expect.anything())
    expect(acoes.editarOrdemAction).not.toHaveBeenCalled()
  })
})

describe('Nova OP: receita da Integração e tempo de Burn-in', () => {
  const ESPELHO: OpEspelho[] = [{
    numero: 8498, idCompels: 8498, codigo: 'PMOC14', descricao: 'PLACA X', situacao: 'Em Processo', nivel: 1, quantidade: 10,
    quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'CLIENTE', dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z',
  }]
  const abrir = async () => {
    render(<NovaOpCliente espelho={ESPELHO} postos={CATALOGO} postosPerfil={PERFIS} clientesExistentes={[]} pmosExistentes={['PMOC14', 'PMOX', 'PMOY']} />)
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOC14' } })
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 — PLACA X · 1 OP aberta' }))
    fireEvent.click(await screen.findByRole('button', { name: /^OP 8498/ }))
    await screen.findByText('Postos copiados da OP 8476 — confira.')
    fireEvent.change(screen.getByLabelText('SN inicial *'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('SN final *'), { target: { value: '1010' } })
  }
  beforeEach(() => {
    acoes.ultimaOpDaPmoAction.mockResolvedValue({ ok: true, ultima: {
      op: '8476', cliente: 'LINCE', descricao: '', placasPorPainel: 1, embalagemIndividual: false,
      postos: [{ posto: 'Integração', trechoCodigo: null }, { posto: 'Burn-in', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null }],
      componentes: [{ posto: 'Integração', pmo: 'PMOX' }], burnin: [{ posto: 'Burn-in', tempo_min: 360 }],
    } })
  })

  it('receita e tempo vêm da última OP, se editam na rota e vão no cadastro', async () => {
    await abrir()
    expect(screen.getByRole('button', { name: 'Remover PMOX' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Adicionar PMO à receita de Integração' }), { target: { value: 'PMOY' } })
    fireEvent.change(screen.getByLabelText('Tempo mínimo de Burn-in em Burn-in'), { target: { value: '8:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    const c = acoes.cadastrarOpAction.mock.calls[0]![0]
    expect(c.componentes).toEqual([{ posto: 'Integração', pmo: 'PMOX' }, { posto: 'Integração', pmo: 'PMOY' }])
    expect(c.burnin).toEqual([{ posto: 'Burn-in', tempo_min: 495 }])
  })

  it('tempo de Burn-in inválido é recusado sem chamar o servidor', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Tempo mínimo de Burn-in em Burn-in'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Tempo mínimo de Burn-in inválido no posto Burn-in (use hhh:mm).', expect.anything())
    expect(acoes.cadastrarOpAction).not.toHaveBeenCalled()
  })

  it('tirar o posto de Integração tira a receita do cadastro', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Remover Integração' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar OP' }))
    await waitFor(() => expect(acoes.cadastrarOpAction).toHaveBeenCalledTimes(1))
    expect(acoes.cadastrarOpAction.mock.calls[0]![0].componentes).toEqual([])
  })
})
