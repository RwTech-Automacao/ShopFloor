// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Base = { pmo: string; op: string; status: string; placas_por_painel: number; sn_ini: string; sn_fim: string; faixas: { sn_ini: string; sn_fim: string }[]; faixasPrt?: { sn_ini: string; sn_fim: string }[] }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  ordemTemTrechos: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  contarSnsForaDasFaixas: vi.fn<(pmo: string, op: string, f: unknown) => Promise<number>>(async () => 0),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
  listarRotaGravada: vi.fn(async () => []),
  contarSnsForaDasFaixas: m.contarSnsForaDasFaixas,
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: m.ordemTemTrechos }))

import { editarOrdemAction } from '../ordens-actions'

function formulario(pmo: string, op: string): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1'); fd.set('pmo', pmo); fd.set('op', op); fd.set('cliente', 'Cliente'); fd.set('qtd', '10')
  fd.set('status', 'ATIVA'); fd.set('sn_ini', 'SN0001'); fd.set('sn_fim', 'SN0010'); fd.set('placas_por_painel', '1')
  return fd
}
const BASE: Base = { pmo: 'PMOC14', op: '8498', status: 'ATIVA', placas_por_painel: 1, sn_ini: 'SN0001', sn_fim: 'SN0010', faixas: [{ sn_ini: 'SN0001', sn_fim: 'SN0010' }] }
const RECUSA = 'Esta OP tem trechos do Compels: não é possível trocar a PMO nem o número da OP.'

beforeEach(() => { vi.clearAllMocks(); m.buscarOrdemBase.mockResolvedValue(BASE); m.ordemTemTrechos.mockResolvedValue(true) })

describe('edição de OP com trechos', () => {
  it('recusa trocar a PMO', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOX', '8498'))).toEqual({ ok: false, erro: RECUSA })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
  it('recusa trocar o número da OP', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498_F'))).toEqual({ ok: false, erro: RECUSA })
  })
  it('sem trocar PMO/OP salva', async () => {
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toMatchObject({ ok: true })
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
  })
  it('OP sem trechos pode trocar o número', async () => {
    m.ordemTemTrechos.mockResolvedValue(false)
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8499'))).toMatchObject({ ok: true })
  })
  it('trecho que ficaria sem posto vira mensagem', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'TRECHO_SEM_POSTO:PRT410' })
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toEqual({ ok: false, erro: 'O trecho PRT410 ficaria sem posto.' })
  })
  // Revisão da Task 2: com trechos, apagar a faixa da PMO faria o trigger da 0181 apagar TODAS as faixas (as próprias
  // das PRTs juntas). A validação do formulário já exige a faixa; a action ainda confere de novo antes de gravar.
  it('com trechos, a PMO sem faixa de SN é recusada antes de gravar qualquer coisa', async () => {
    const fd = formulario('PMOC14', '8498'); fd.set('sn_ini', ''); fd.set('sn_fim', '')
    expect(await editarOrdemAction(undefined, fd)).toMatchObject({ ok: false })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
  it('trecho que ficaria sem faixa vira mensagem', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'TRECHO_SEM_FAIXA:PRT410' })
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toEqual({ ok: false, erro: 'O trecho PRT410 ficaria sem faixa de SN.' })
  })
  it('posto repetido entre trechos vira mensagem', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'POSTO_REPETIDO:Teste' })
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toEqual({ ok: false, erro: 'O posto "Teste" está em mais de um trecho.' })
  })
  it('o aviso de SNs fora das faixas conta também as faixas próprias das PRTs', async () => {
    m.buscarOrdemBase.mockResolvedValue({ ...BASE, faixasPrt: [{ sn_ini: 'A1', sn_fim: 'A5' }] })
    const fd = formulario('PMOC14', '8498'); fd.set('sn_ini', 'SN0011'); fd.set('sn_fim', 'SN0020')
    await editarOrdemAction(undefined, fd)
    expect(m.contarSnsForaDasFaixas).toHaveBeenCalledWith('PMOC14', '8498', [{ sn_ini: 'SN0011', sn_fim: 'SN0020' }, { sn_ini: 'A1', sn_fim: 'A5' }])
  })
  it('erro ao ler os trechos trava a edição', async () => {
    m.ordemTemTrechos.mockRejectedValue(new Error('x'))
    expect(await editarOrdemAction(undefined, formulario('PMOC14', '8498'))).toEqual({ ok: false, erro: 'Não foi possível salvar a OP.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
})
