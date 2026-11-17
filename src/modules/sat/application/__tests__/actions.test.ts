import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const repo = vi.hoisted(() => ({
  osPorNs: vi.fn(async () => []),
  consultarNoBanco: vi.fn(async () => ({ revendas: [], producao: [], shopfloor: [] })),
  registrarEntrada: vi.fn(async () => ({ id: 'e1', osNumero: '90001', motivos: ['Sem CFOP'] })),
  corrigirNf: vi.fn(async () => ({ ns: 'X', empresa: 'C', osNumero: '9', nfDe: '1', nfPara: '1', situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [] })),
  trocarNf: vi.fn(async () => ({ ns: 'X', empresa: 'C', osNumero: '9', nfDe: '1', nfPara: '2', situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [] })),
  ErroDoBanco: class ErroDoBanco extends Error {},
}))
vi.mock('../../infra/repository', () => repo)
const avisarSat = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../infra/discord', () => ({ avisarSat }))
vi.mock('../../infra/compels', () => ({ descricaoDoProduto: vi.fn(async () => null) }))

function sessao(sat: Record<string, boolean>, outros: Record<string, Record<string, boolean>> = {}) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'S', email: 's@x', perfil: { porModulo: { sat, ...outros }, permissoes: {} } }),
  }))
}

const entrada = {
  ns: '00043005620019177', osId: null, empresa: 'Cliente A', cnpj: '', produto: 'REP', nf: '4521', valor: '',
  frete: null, itensJunto: [], itensJuntoOutros: '', defeito: '', locacao: '', custo: '',
  situacao: 'reprovada' as const, motivos: ['00000000-0000-0000-0000-0000000000aa'],
}
const UUID = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('actions do SAT', () => {
  it('sem sat.registrar_entrada (só visualizar, ou admin de outro módulo): não busca nem grava', async () => {
    sessao({ visualizar: true }, { shopfloor: { administrar: true, lancar: true } })
    const { consultarNsAction, registrarEntradaAction } = await import('../actions')
    expect(await consultarNsAction('562-1')).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(await registrarEntradaAction(entrada)).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(repo.registrarEntrada).not.toHaveBeenCalled()
    expect(repo.osPorNs).not.toHaveBeenCalled()
    expect(avisarSat).not.toHaveBeenCalled()
  })

  it('registrar: valida antes do banco (reprovada sem motivo)', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { registrarEntradaAction } = await import('../actions')
    expect(await registrarEntradaAction({ ...entrada, motivos: [] })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(repo.registrarEntrada).not.toHaveBeenCalled()
  })

  it('registrar: grava e avisa no Discord com os motivos que o banco devolveu', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { registrarEntradaAction } = await import('../actions')
    expect(await registrarEntradaAction(entrada)).toEqual({ ok: true, valor: { id: 'e1' } })
    expect(repo.registrarEntrada).toHaveBeenCalledWith(expect.objectContaining({ modelo: '562', sequencia: '19177', motivos: entrada.motivos }))
    expect(avisarSat).toHaveBeenCalledWith('📦 Chegou no SAT: 00043005620019177 (Cliente A, OS 90001) — NF 4521 reprovada ❌ (Sem CFOP)')
  })

  it('registrar: Discord fora do ar não impede a gravação', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    avisarSat.mockRejectedValueOnce(new Error('discord caiu'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registrarEntradaAction } = await import('../actions')
    expect(await registrarEntradaAction(entrada)).toEqual({ ok: true, valor: { id: 'e1' } })
  })

  it('registrar: erro do banco vira mensagem da tela', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    repo.registrarEntrada.mockRejectedValueOnce(new repo.ErroDoBanco('MOTIVO_INVALIDO'))
    const { registrarEntradaAction } = await import('../actions')
    expect(await registrarEntradaAction(entrada)).toEqual({
      ok: false, erro: 'Um dos motivos não existe mais ou foi desativado. Recarregue a página.',
    })
    expect(avisarSat).not.toHaveBeenCalled()
  })

  it('corrigir/trocar NF exigem sat.aprovar_nf', async () => {
    sessao({ visualizar: true, registrar_entrada: true, administrar: true })
    const { corrigirNfAction, trocarNfAction } = await import('../actions')
    expect(await corrigirNfAction(UUID, 'aprovada', [])).toMatchObject({ ok: false })
    expect(await trocarNfAction(UUID, '2', 'aprovada', [])).toMatchObject({ ok: false })
    expect(repo.corrigirNf).not.toHaveBeenCalled()
    expect(repo.trocarNf).not.toHaveBeenCalled()
  })

  it('corrigir e trocar: gravam e avisam no Discord', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    const { corrigirNfAction, trocarNfAction } = await import('../actions')
    expect(await corrigirNfAction(UUID, 'aprovada', [])).toEqual({ ok: true, valor: null })
    expect(avisarSat).toHaveBeenLastCalledWith('🧾 NF do SAT corrigida: X (C, OS 9) — NF 1 reprovada → aprovada ✅')
    expect(await trocarNfAction(UUID, ' 2 ', 'aprovada', [])).toEqual({ ok: true, valor: null })
    expect(repo.trocarNf).toHaveBeenCalledWith(UUID, '2', 'aprovada', [])
    expect(avisarSat).toHaveBeenLastCalledWith('🧾 NF do SAT trocada: X (C, OS 9) — NF 1 (reprovada) substituída pela NF 2 aprovada ✅')
  })

  it('id de entrada inválido é recusado', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    const { corrigirNfAction } = await import('../actions')
    expect(await corrigirNfAction('x; drop', 'aprovada', [])).toMatchObject({ ok: false })
    expect(repo.corrigirNf).not.toHaveBeenCalled()
  })

})
