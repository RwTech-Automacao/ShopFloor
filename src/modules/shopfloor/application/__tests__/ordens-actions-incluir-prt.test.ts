// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Faixa = { sn_ini: string; sn_fim: string }
type Base = { pmo: string; op: string; status: string; placas_por_painel: number; sn_ini: string; sn_fim: string; faixas: Faixa[]; faixasPrt?: Faixa[] }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  registrarLog: vi.fn(async () => undefined),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ email: 'gestor@x', perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: m.registrarLog }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => ['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'].map((chave) => ({ chave }))),
  listarRotaGravada: vi.fn(async () => ['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado']),
  contarSnsForaDasFaixas: vi.fn(async () => 0),
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: vi.fn(async () => true) }))

import { editarOrdemAction } from '../ordens-actions'

const BASE: Base = {
  pmo: 'PMOC14', op: '8498', status: 'ATIVA', placas_por_painel: 1, sn_ini: '1001', sn_fim: '1010',
  faixas: [{ sn_ini: '1001', sn_fim: '1010' }], faixasPrt: [],
}
// a OP gravada: PRT410 (seq 1) e PMOC14 (seq 2); a PRT420 volta entre as duas
const COM_INCLUIDA = [
  { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
  { seq: null, codigo: ' PRT420 ', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
  { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
]
function formulario(trechos: unknown): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1'); fd.set('pmo', 'PMOC14'); fd.set('op', '8498'); fd.set('cliente', 'Cliente'); fd.set('qtd', '10')
  fd.set('status', 'ATIVA'); fd.set('placas_por_painel', '1')
  fd.set('trechos', JSON.stringify(trechos))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.buscarOrdemBase.mockResolvedValue(BASE)
})

describe('editarOrdemAction: PRT incluída de novo (0199)', () => {
  it('manda a lista na ordem da tela, com a incluída sem seq (código aparado), e registra no log', async () => {
    expect(await editarOrdemAction(undefined, formulario(COM_INCLUIDA))).toMatchObject({ ok: true })
    const [, , postos, , , faixas, trechos] = m.atualizarOrdem.mock.calls[0]!
    expect(trechos).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'mesmo', faixas: [] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Teste', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
    expect(postos).toEqual(['SPI', 'Inspeção PTH', 'Teste', 'Almoxarifado'])
    expect(faixas).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'alterar_campo',
      descricao: 'OP PMOC14/8498 editada · PRT incluída de novo: PRT420 (8499)',
      dados: expect.objectContaining({ prtsIncluidas: [{ codigo: 'PRT420', compelsOp: '8499' }] }),
    }))
  })

  it('sem incluída, a lista continua ordenada por seq e o log como sempre', async () => {
    const semIncluida = [COM_INCLUIDA[2], COM_INCLUIDA[0]]
    expect(await editarOrdemAction(undefined, formulario(semIncluida))).toMatchObject({ ok: true })
    expect((m.atualizarOrdem.mock.calls[0]![6] as { seq: number }[]).map((t) => t.seq)).toEqual([1, 2])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'OP PMOC14/8498 editada' }))
  })

  it('incluída sem código ou sem OP do Compels: trechos inválidos', async () => {
    const semCodigo = [COM_INCLUIDA[0], { ...COM_INCLUIDA[1], codigo: '' }, COM_INCLUIDA[2]]
    const semOp = [COM_INCLUIDA[0], { ...COM_INCLUIDA[1], compels_op: undefined }, COM_INCLUIDA[2]]
    expect(await editarOrdemAction(undefined, formulario(semCodigo))).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(await editarOrdemAction(undefined, formulario(semOp))).toEqual({ ok: false, erro: 'Trechos inválidos.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('a recusa do banco vira mensagem em PT-BR', async () => {
    m.atualizarOrdem.mockRejectedValueOnce({ message: 'PRT_INCLUIDA_COM_REGISTROS:PRT420' })
    expect(await editarOrdemAction(undefined, formulario(COM_INCLUIDA)))
      .toEqual({ ok: false, erro: 'PRT420 não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP.' })
  })
})
