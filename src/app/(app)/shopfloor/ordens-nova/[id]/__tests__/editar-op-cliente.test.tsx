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
const confirmar = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => ({ confirmar, dialog: null }) }))

const { EditarOpCliente } = await import('../editar-op-cliente')

const trecho = (t: Partial<TrechoCadastro> & Pick<TrechoCadastro, 'seq' | 'codigo' | 'tipo' | 'compelsOp' | 'postos'>): TrechoCadastro => ({
  descricao: '', quantidade: 10, situacao: 'Em Processo', snModo: 'mesmo', faixas: [], ...t,
})
const TRECHOS: TrechoCadastro[] = [
  trecho({ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'Inspeção AOI TOP'], snModo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }] }),
  trecho({ seq: 2, codigo: 'PRT420', tipo: 'prt', compelsOp: '8499', postos: ['Inspeção PTH'] }),
  trecho({ seq: 3, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] }),
]
const ORDEM = {
  id: '00000000-0000-0000-0000-000000000001', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: 'PLACA X',
  acp: '', status: 'ATIVA', embalagemIndividual: false, placasPorPainel: 1,
}
const RESUMO = [
  { posto: 'Inspeção AOI TOP', codigo: 'PRT410', compelsOp: '8500', apontadas: 4, naFila: 2, motivo: 'Sem saldo do componente' },
  { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 1, naFila: 0, motivo: null },
]
const CATALOGO = ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Burn-in', 'Almoxarifado']
const PERFIS = { Almoxarifado: { recurso: 'almoxarifado' }, 'Burn-in': { recurso: 'burnin' } } as never

const montar = (extra: Partial<Parameters<typeof EditarOpCliente>[0]> = {}) => render(
  <EditarOpCliente ordem={ORDEM} trechos={TRECHOS} resumo={RESUMO} postos={CATALOGO} postosPerfil={PERFIS}
    clientesExistentes={['LINCE']} temRegistros={false} receita={{}} tempoBurnin={{}} {...extra} />,
)
const enviado = (i = 0) => Object.fromEntries((acoes.editarOrdemAction.mock.calls[i]![1] as FormData).entries())
const trechoRegiao = (titulo: string) => screen.getByRole('region', { name: titulo })
/** Os postos do trecho (a primeira lista da coluna; a segunda, quando há, é a das faixas só de leitura). */
const postosDo = (titulo: string) => within(within(trechoRegiao(titulo)).getAllByRole('list')[0]!).getAllByRole('listitem')

beforeEach(() => {
  vi.clearAllMocks()
  acoes.editarOrdemAction.mockResolvedValue({ ok: true, id: ORDEM.id, pmo: 'PMOC14', op: '8498' })
})

describe('Editar OP com trechos', () => {
  it('PMO e número travados, com o porquê; o resto editável', () => {
    montar()
    const pmo = screen.getByLabelText('PMO') as HTMLInputElement
    const op = screen.getByLabelText('Nº OP') as HTMLInputElement
    expect([pmo.value, pmo.disabled, op.value, op.disabled]).toEqual(['PMOC14', true, '8498', true])
    expect(screen.getByText(/OP com trechos não troca PMO nem número/)).toBeTruthy()
    expect((screen.getByLabelText('Cliente *') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('Placas por painel') as HTMLInputElement).disabled).toBe(false)
  })

  it('OP com registros: placas por painel bloqueadas e o valor gravado vai no salvar', async () => {
    montar({ temRegistros: true, ordem: { ...ORDEM, placasPorPainel: 2, qtd: 20 } })
    expect((screen.getByLabelText('Placas por painel') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Bloqueado: esta OP já tem registros.')).toBeTruthy()
    expect((screen.getByLabelText('Painéis') as HTMLInputElement).value).toBe('10')
  })

  it('a corrente mostra os trechos com os postos (numeração seguida), a série e a situação das PRTs', () => {
    montar()
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    const numeros = (titulo: string) => postosDo(titulo).map((li) => li.textContent!.match(/^\d+/)![0])
    expect(numeros('PRT410 (8500)')).toEqual(['1', '2'])
    expect(numeros('PRT420 (8499)')).toEqual(['3'])
    expect(numeros('PMOC14 (8498)')).toEqual(['4', '5'])
    const prt410 = within(trechoRegiao('PRT410 (8500)'))
    expect(prt410.getByText('No Compels: 4 apontadas · 2 na fila')).toBeTruthy()
    expect(prt410.getByText('Pendência: Sem saldo do componente')).toBeTruthy()
    // série e faixas editáveis em todo trecho (o banco recusa o que mudaria o histórico)
    expect((prt410.getByRole('radio', { name: 'Série própria' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('SN inicial *', { selector: '#t1_sn_ini' }) as HTMLInputElement).value).toBe('P001')
    expect(within(trechoRegiao('PRT420 (8499)')).getByText('No Compels: 1 apontada · 0 na fila')).toBeTruthy()
    expect((within(trechoRegiao('PRT420 (8499)')).getByRole('radio', { name: 'Mesma série da PMO' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('SN inicial *', { selector: '#sn_ini' }) as HTMLInputElement).value).toBe('1001')
    expect(screen.getByTestId('resumo-rota').textContent).toBe('3 trechos · 5 postos')
  })

  it('sem o resumo do Compels, avisa em vez de mostrar números', () => {
    montar({ resumo: null })
    expect(screen.getAllByText('Não foi possível ler a situação no Compels.')).toHaveLength(2)
  })

  it('as setas ← → só aparecem nas pontas dos trechos, e o Almoxarifado não se move', () => {
    montar()
    const seta = (nome: string) => screen.queryByRole('button', { name: nome })
    expect(seta('Mover SPI para o trecho anterior')).toBeNull()
    expect(seta('Mover SPI para o trecho seguinte')).toBeNull()
    expect(seta('Mover Inspeção AOI TOP para o trecho seguinte')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho anterior')).toBeTruthy()
    expect(seta('Mover Inspeção PTH para o trecho seguinte')).toBeTruthy()
    expect(seta('Mover Teste para o trecho anterior')).toBeTruthy()
    expect(seta('Mover Teste para o trecho seguinte')).toBeNull()
    expect(seta('Mover Almoxarifado para o trecho anterior')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover Almoxarifado' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Descer Teste' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('mover na ponta passa o posto para o vizinho, renumera e vai no salvar por trecho', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Mover Inspeção AOI TOP para o trecho seguinte' }))
    expect(postosDo('PRT410 (8500)').map((li) => li.textContent)).toEqual(['1SPI'])
    expect(postosDo('PRT420 (8499)').map((li) => li.textContent)).toEqual(['2Inspeção AOI TOP', '3Inspeção PTH'])
    fireEvent.click(screen.getByRole('button', { name: 'Mover Teste para o trecho anterior' }))
    expect(postosDo('PRT420 (8499)').map((li) => li.textContent)).toEqual(['2Inspeção AOI TOP', '3Inspeção PTH', '4Teste'])
    expect(postosDo('PMOC14 (8498)').map((li) => li.textContent)).toEqual(['5Almoxarifado'])
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(JSON.parse(enviado().trechos as string).map((t: { postos: string[] }) => t.postos)).toEqual([
      ['SPI'], ['Inspeção AOI TOP', 'Inspeção PTH', 'Teste'], ['Almoxarifado'],
    ])
  })

  it('PRT troca para série própria, preenche a faixa e ela vai no salvar', async () => {
    montar()
    fireEvent.click(within(trechoRegiao('PRT420 (8499)')).getByRole('radio', { name: 'Série própria' }))
    fireEvent.change(screen.getByLabelText('SN inicial *', { selector: '#t2_sn_ini' }), { target: { value: 'Q01' } })
    fireEvent.change(screen.getByLabelText('SN final *', { selector: '#t2_sn_fim' }), { target: { value: 'Q10' } })
    fireEvent.change(screen.getByLabelText('SN final *', { selector: '#t1_sn_fim' }), { target: { value: 'P020' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(JSON.parse(enviado().trechos as string)).toEqual([
      { seq: 1, postos: ['SPI', 'Inspeção AOI TOP'], sn_modo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P020' }] },
      { seq: 2, postos: ['Inspeção PTH'], sn_modo: 'proprio', faixas: [{ sn_ini: 'Q01', sn_fim: 'Q10' }] },
      { seq: 3, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })

  it('faixa de PRT sobreposta à da PMO é recusada na tela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('SN inicial *', { selector: '#t1_sn_ini' }), { target: { value: '1005' } })
    fireEvent.change(screen.getByLabelText('SN final *', { selector: '#t1_sn_fim' }), { target: { value: '1020' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/se sobrepõe/), expect.anything())
    expect(acoes.editarOrdemAction).not.toHaveBeenCalled()
  })

  it('adicionar: qualquer posto fora da rota em qualquer trecho', () => {
    montar()
    expect(screen.getByRole('combobox', { name: 'Adicionar posto em PRT410 (8500)' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Adicionar posto em PMOC14 (8498)' })).toBeTruthy()
  })

  it('salvar manda a rota inteira, as faixas da PMO e os dados; PMO/OP sempre os gravados', async () => {
    montar({ receita: { Teste: ['PMOX'] }, tempoBurnin: {} })
    fireEvent.change(screen.getByLabelText('Cliente *'), { target: { value: 'NOVO CLIENTE ' } })
    fireEvent.change(screen.getByLabelText('SN final *', { selector: '#sn_fim' }), { target: { value: '1010' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    const fd = enviado()
    expect(fd).toMatchObject({
      id: ORDEM.id, pmo: 'PMOC14', op: '8498', cliente: 'NOVO CLIENTE', qtd: '10', descricao: 'PLACA X', status: 'ATIVA',
      embalagem_individual: 'on', placas_por_painel: '1',
    })
    expect(JSON.parse(fd.fluxo as string)).toEqual(['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Almoxarifado'])
    expect(JSON.parse(fd.faixas as string)).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
    expect(JSON.parse(fd.componentes as string)).toEqual({ Teste: ['PMOX'] })
    expect(fd.confirmar_fora_faixa).toBeUndefined()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopfloor/ordens-nova'))
  })

  it('placas travadas: vai o N gravado, mesmo que o campo diga outra coisa', async () => {
    montar({ temRegistros: true, ordem: { ...ORDEM, placasPorPainel: 2, qtd: 20 }, trechos: TRECHOS.map((t) => (t.tipo === 'pmo' ? { ...t, faixas: [{ sn_ini: '1001', sn_fim: '1010' }] } : t)) })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1))
    expect(enviado().placas_por_painel).toBe('2')
  })

  it('SNs fora das faixas: pergunta e, confirmado, reenvia com a confirmação', async () => {
    acoes.editarOrdemAction
      .mockResolvedValueOnce({ ok: false, erro: '3 registros ficariam fora das faixas novas. Salvar mesmo assim?', confirmarForaDaFaixa: 3 })
      .mockResolvedValueOnce({ ok: true, id: ORDEM.id, pmo: 'PMOC14', op: '8498' })
    confirmar.mockResolvedValue(true)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(2))
    expect(confirmar).toHaveBeenCalledWith({ titulo: '3 registros ficariam fora das faixas novas. Salvar mesmo assim?', rotuloConfirmar: 'Salvar mesmo assim' })
    expect(enviado(1).confirmar_fora_faixa).toBe('1')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopfloor/ordens-nova'))
  })

  it('SNs fora das faixas: cancelou, nada é reenviado e a tela fica', async () => {
    acoes.editarOrdemAction.mockResolvedValueOnce({ ok: false, erro: 'fora', confirmarForaDaFaixa: 1 })
    confirmar.mockResolvedValue(false)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(confirmar).toHaveBeenCalled())
    expect(acoes.editarOrdemAction).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('trecho vazio é recusado na tela, sem chamar o servidor', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Remover Inspeção PTH' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('O trecho PRT420 (8499) está sem posto.', expect.anything())
    expect(acoes.editarOrdemAction).not.toHaveBeenCalled()
  })

  it('erro do servidor vira aviso e a tela fica', async () => {
    acoes.editarOrdemAction.mockResolvedValueOnce({ ok: false, erro: 'O trecho PRT420 ficaria sem posto.' })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O trecho PRT420 ficaria sem posto.', expect.anything()))
    expect(push).not.toHaveBeenCalled()
  })

  it('Cancelar volta para a lista', () => {
    montar()
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/shopfloor/ordens-nova')
  })
})
