import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'

vi.mock('server-only', () => ({}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acoes = vi.hoisted(() => ({ editarOrdemAction: vi.fn(), criarOrdemAction: vi.fn(), opTemRegistrosAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => acoes)
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({ salvarPadraoAction: vi.fn(), excluirPadraoAction: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => ({ confirmar: vi.fn(), dialog: null }) }))

const { EditarOpCliente } = await import('../editar-op-cliente')

const trecho = (t: Partial<TrechoCadastro> & Pick<TrechoCadastro, 'seq' | 'codigo' | 'tipo' | 'compelsOp' | 'postos'>): TrechoCadastro => ({
  descricao: '', quantidade: 10, situacao: 'Em Processo', snModo: 'mesmo', faixas: [], ...t,
})
// gravada sem a PRT420; a cadeia do Compels tem as três
const GRAVADA: TrechoCadastro[] = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI'] }),
  trecho({ seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Inspeção PTH', 'Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] }),
]
const CADEIA: TrechoCadastro[] = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: [] }),
  trecho({ seq: 2, codigo: 'PRT420', tipo: 'prt', compelsOp: '8499', postos: [] }),
  trecho({ seq: 3, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: [], faixas: [{ sn_ini: '', sn_fim: '' }] }),
]
const ORDEM = {
  id: '00000000-0000-0000-0000-000000000001', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: 'PLACA X',
  acp: '', status: 'ATIVA', embalagemIndividual: false, placasPorPainel: 1,
}
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' } } as never
const montar = (cadeia: TrechoCadastro[] = CADEIA) => render(
  <EditarOpCliente ordem={ORDEM} trechos={GRAVADA} resumo={[]} postos={['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado']}
    postosPerfil={PERFIS} clientesExistentes={['LINCE']} temRegistros={false} receita={{}} tempoBurnin={{}} cadeia={cadeia} />,
)
const titulos = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.editarOrdemAction.mockResolvedValue({ ok: true, id: ORDEM.id, pmo: 'PMOC14', op: '8498' })
})

describe('Editar OP: incluir de novo a PRT ignorada', () => {
  it('lista só as PRTs da cadeia fora da OP', () => {
    montar()
    const lista = screen.getByRole('list', { name: 'PRTs fora desta OP' })
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('PRT420 (8499)')])
  })
  it('sem cadeia (OP fora do espelho), nada aparece', () => {
    montar([])
    expect(screen.queryByRole('list', { name: 'PRTs fora desta OP' })).toBeNull()
  })
  it('"Incluir de novo" põe a PRT no lugar dela, vazia; salvar sem posto é barrado na tela', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Incluir PRT420 (8499) de novo' }))
    expect(titulos()).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.queryByRole('list', { name: 'PRTs fora desta OP' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('O trecho PRT420 (8499) está sem posto.', expect.anything())
    expect(acoes.editarOrdemAction).not.toHaveBeenCalled()
  })
  it('com o posto trazido da PMO (←), salva a incluída sem seq, na ordem da tela', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Incluir PRT420 (8499) de novo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mover Inspeção PTH para o trecho anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    const fd = acoes.editarOrdemAction.mock.calls[0]![1] as FormData
    expect(JSON.parse(String(fd.get('trechos')))).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })
})
