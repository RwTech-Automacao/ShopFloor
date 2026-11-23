// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Faixa = { sn_ini: string; sn_fim: string }
type Base = { pmo: string; op: string; status: string; placas_por_painel: number; sn_ini: string; sn_fim: string; faixas: Faixa[]; faixasPrt?: Faixa[] }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  ordemTemTrechos: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  contarSnsForaDasFaixas: vi.fn<(pmo: string, op: string, f: unknown) => Promise<number>>(async () => 0),
  listarRotaGravada: vi.fn<(id: string) => Promise<string[]>>(async () => ['SPI', 'Teste', 'Almoxarifado']),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ email: 'gestor@x', perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => ['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'].map((chave) => ({ chave }))),
  listarRotaGravada: m.listarRotaGravada,
  contarSnsForaDasFaixas: m.contarSnsForaDasFaixas,
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: m.ordemTemTrechos }))

import { editarOrdemAction } from '../ordens-actions'

const BASE: Base = {
  pmo: 'PMOC14', op: '8498', status: 'ATIVA', placas_por_painel: 1, sn_ini: '1001', sn_fim: '1010',
  faixas: [{ sn_ini: '1001', sn_fim: '1010' }], faixasPrt: [{ sn_ini: 'P001', sn_fim: 'P010' }],
}
const TRECHOS = [
  { seq: 1, postos: ['SPI'], sn_modo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }] },
  { seq: 2, postos: ['Inspeção PTH', 'Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
]
function formulario(trechos: unknown = TRECHOS): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1'); fd.set('pmo', 'PMOC14'); fd.set('op', '8498'); fd.set('cliente', 'Cliente'); fd.set('qtd', '10')
  fd.set('status', 'ATIVA'); fd.set('placas_por_painel', '1')
  // o `faixas` antigo é ignorado na edição por trecho: as da PMO vêm do último trecho
  fd.set('faixas', JSON.stringify([{ sn_ini: 'X1', sn_fim: 'X9' }]))
  fd.set('trechos', JSON.stringify(trechos))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.buscarOrdemBase.mockResolvedValue(BASE)
  m.ordemTemTrechos.mockResolvedValue(true)
  m.listarRotaGravada.mockResolvedValue(['SPI', 'Teste', 'Almoxarifado'])
})

describe('editarOrdemAction com a edição por trecho (0194)', () => {
  it('manda os trechos para o atualizarOrdem; a rota é a dos trechos e a faixa 1 da OP é a primeira da PMO', async () => {
    expect(await editarOrdemAction(undefined, formulario())).toMatchObject({ ok: true })
    const [id, dados, postos, , , faixas, trechos] = m.atualizarOrdem.mock.calls[0]!
    expect(id).toBe('id-1')
    expect(dados).toMatchObject({ sn_ini: '1001', sn_fim: '1010' })
    expect(postos).toEqual(['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'])
    expect(faixas).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
    expect(trechos).toEqual(TRECHOS)
    // nada mudou nas faixas: não pergunta dos SNs
    expect(m.contarSnsForaDasFaixas).not.toHaveBeenCalled()
  })

  it('mudar a faixa de uma PRT também passa pelo aviso de SNs fora, com as faixas novas de todos', async () => {
    m.contarSnsForaDasFaixas.mockResolvedValueOnce(2)
    const trechos = [{ ...TRECHOS[0], faixas: [{ sn_ini: 'P005', sn_fim: 'P010' }] }, TRECHOS[1]]
    const r = await editarOrdemAction(undefined, formulario(trechos))
    expect(r).toEqual({ ok: false, erro: '2 registros ficariam fora das faixas novas. Salvar mesmo assim?', confirmarForaDaFaixa: 2 })
    expect(m.contarSnsForaDasFaixas).toHaveBeenCalledWith('PMOC14', '8498', [{ sn_ini: '1001', sn_fim: '1010' }, { sn_ini: 'P005', sn_fim: 'P010' }])
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
    const fd = formulario(trechos); fd.set('confirmar_fora_faixa', '1')
    expect(await editarOrdemAction(undefined, fd)).toMatchObject({ ok: true })
  })

  it('PRT que vira "mesma série" sai da conta das faixas', async () => {
    const trechos = [{ ...TRECHOS[0], sn_modo: 'mesmo', faixas: [] }, TRECHOS[1]]
    await editarOrdemAction(undefined, formulario(trechos))
    expect(m.contarSnsForaDasFaixas).toHaveBeenCalledWith('PMOC14', '8498', [{ sn_ini: '1001', sn_fim: '1010' }])
  })

  it('a recusa do histórico vira mensagem em PT-BR', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'POSTO_COM_REGISTROS:Teste' })
    expect(await editarOrdemAction(undefined, formulario())).toEqual({ ok: false, erro: 'O posto "Teste" já tem registros nesta OP e não pode trocar de trecho.' })
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'PRT_COM_HISTORICO:PRT410' })
    expect(await editarOrdemAction(undefined, formulario())).toMatchObject({ ok: false, erro: expect.stringMatching(/^PRT410 já tem peças/) })
  })

  it('posto fora do catálogo e JSON inválido são recusados antes de gravar', async () => {
    expect(await editarOrdemAction(undefined, formulario([{ seq: 1, postos: ['Fantasma'], sn_modo: 'mesmo' }]))).toEqual({ ok: false, erro: 'Posto desconhecido: Fantasma.' })
    const fd = formulario(); fd.set('trechos', '{x')
    expect(await editarOrdemAction(undefined, fd)).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(await editarOrdemAction(undefined, formulario([]))).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('o Almoxarifado gravado não pode sair da rota', async () => {
    const trechos = [TRECHOS[0], { ...TRECHOS[1], postos: ['Inspeção PTH', 'Teste'] }]
    expect(await editarOrdemAction(undefined, formulario(trechos))).toMatchObject({ ok: false })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('a edição por trecho exige só shopfloor.administrar, sem olhar o e-mail', async () => {
    const r = await editarOrdemAction(undefined, formulario())
    expect(r).not.toEqual({ ok: false, erro: 'Você não tem permissão para gerenciar ordens de produção.' })
  })

  it('série ausente ou inválida é recusada (nunca vira "mesma série" calada)', async () => {
    const sem = [{ seq: 1, postos: ['SPI'], faixas: [] }, TRECHOS[1]]
    expect(await editarOrdemAction(undefined, formulario(sem))).toEqual({ ok: false, erro: 'Série inválida no trecho 1: escolha "mesma série da PMO" ou "série própria".' })
    const outra = [{ ...TRECHOS[0], sn_modo: 'outra' }, TRECHOS[1]]
    expect(await editarOrdemAction(undefined, formulario(outra))).toMatchObject({ ok: false, erro: expect.stringMatching(/^Série inválida no trecho 1/) })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('OP sem trechos não aceita a edição por trecho', async () => {
    m.ordemTemTrechos.mockResolvedValue(false)
    expect(await editarOrdemAction(undefined, formulario())).toEqual({ ok: false, erro: 'Esta OP não tem trechos do Compels.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('a PMO sem faixa é recusada antes de gravar', async () => {
    const trechos = [TRECHOS[0], { ...TRECHOS[1], faixas: [] }]
    expect(await editarOrdemAction(undefined, formulario(trechos))).toMatchObject({ ok: false })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
})
