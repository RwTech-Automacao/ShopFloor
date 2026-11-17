import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const mudanca = {
  nfId: 'n1', numeroDe: '1', numeroPara: '1', empresa: 'EMPRESA', cnpj: '12.345.678/0001-90',
  situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [], ns: ['NS1', 'NS2'],
}
const repo = vi.hoisted(() => ({
  osPorNs: vi.fn(async () => []),
  consultarNoBanco: vi.fn(async () => ({ revendas: [], producao: [], shopfloor: [] })),
  registrarNf: vi.fn(async () => ({
    nfId: 'n1', motivos: ['Sem CFOP'],
    relogios: [{ id: 'e1', ns: '00043005620019177', osNumero: '90001' }, { id: 'e2', ns: '562-19178', osNumero: '' }],
  })),
  corrigirNf: vi.fn(),
  trocarNf: vi.fn(),
  associarOs: vi.fn(async () => ({ ns: 'NS1', osDe: '', osPara: '90001' })),
  ErroDoBanco: class ErroDoBanco extends Error {},
}))
vi.mock('../../infra/repository', () => repo)
const avisarSat = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../infra/discord', () => ({ avisarSat }))
const empresaDoCnpj = vi.hoisted(() => vi.fn(async () => ({ codigo: 'C0001', nome: 'CLIENTE FICTICIO' })))
vi.mock('../../infra/compels', () => ({ empresaDoCnpj }))

function sessao(sat: Record<string, boolean>, outros: Record<string, Record<string, boolean>> = {}) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'S', email: 's@x', perfil: { porModulo: { sat, ...outros }, permissoes: {} } }),
  }))
}

const MOTIVO = '00000000-0000-0000-0000-0000000000aa'
const relogio = { ns: '562-19178', produto: '', itensJunto: [], itensJuntoOutros: '', locacao: '' }
const nota = {
  cnpj: '12345678000190', empresa: 'EMPRESA', negocianteCodigo: 'C0001', numero: '4521', valor: '',
  situacao: 'reprovada' as const, motivos: [MOTIVO],
  relogios: [
    { ns: '00043005620019177', produto: 'PMOC31', itensJunto: [], itensJuntoOutros: '', locacao: '' },
    relogio,
  ],
}
const UUID = '00000000-0000-0000-0000-000000000001'
const OS = '00000000-0000-0000-0000-000000000002'
const SEM_PERMISSAO = { ok: false, erro: 'Você não tem permissão para esta ação.' }
const troca = {
  numero: ' 1240 ', cnpj: '12345678000190', empresa: ' EMPRESA ', negocianteCodigo: null, valor: '10,50',
  situacao: 'aprovada' as const, motivos: [],
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
  repo.corrigirNf.mockReset()
  repo.trocarNf.mockReset()
})

describe('actions do SAT — entrada', () => {
  it('sem sat.registrar_entrada (só visualizar, ou admin de outro módulo): não busca nem grava', async () => {
    sessao({ visualizar: true }, { shopfloor: { administrar: true, lancar: true } })
    const { consultarNsAction, registrarNfAction, buscarEmpresaAction } = await import('../actions')
    expect(await consultarNsAction('562-1')).toEqual(SEM_PERMISSAO)
    expect(await buscarEmpresaAction('12345678000190')).toEqual(SEM_PERMISSAO)
    expect(await registrarNfAction(nota)).toEqual(SEM_PERMISSAO)
    expect(repo.registrarNf).not.toHaveBeenCalled()
    expect(repo.osPorNs).not.toHaveBeenCalled()
    expect(empresaDoCnpj).not.toHaveBeenCalled()
    expect(avisarSat).not.toHaveBeenCalled()
  })

  it('buscar empresa também vale para quem troca a NF (aprovar_nf sem registrar_entrada)', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    const { buscarEmpresaAction, registrarNfAction } = await import('../actions')
    expect(await buscarEmpresaAction('12345678000190')).toEqual({ ok: true, valor: { codigo: 'C0001', nome: 'CLIENTE FICTICIO' } })
    expect(await registrarNfAction(nota)).toEqual(SEM_PERMISSAO)
  })

  it('registrar_entrada sem sat.visualizar também não passa', async () => {
    sessao({ registrar_entrada: true })
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction(nota)).toEqual(SEM_PERMISSAO)
  })

  it('buscar empresa: CNPJ inválido recusa sem ir ao Compels; válido devolve o negociante (ou null)', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { buscarEmpresaAction } = await import('../actions')
    expect(await buscarEmpresaAction('123')).toEqual({ ok: false, erro: 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).' })
    expect(empresaDoCnpj).not.toHaveBeenCalled()
    expect(await buscarEmpresaAction('12.345.678/0001-90')).toEqual({ ok: true, valor: { codigo: 'C0001', nome: 'CLIENTE FICTICIO' } })
    empresaDoCnpj.mockResolvedValueOnce(null as never)
    expect(await buscarEmpresaAction('12345678000190')).toEqual({ ok: true, valor: null })
  })

  it('registrar: valida antes do banco (reprovada sem motivo)', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction({ ...nota, motivos: [] })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(repo.registrarNf).not.toHaveBeenCalled()
  })

  it('registrar: entrada fora do formato recusa', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction(null as never)).toMatchObject({ ok: false })
    expect(await registrarNfAction({ ...nota, relogios: 'x' as never })).toMatchObject({ ok: false })
    expect(await registrarNfAction({ ...nota, motivos: ['x; drop'] })).toMatchObject({ ok: false })
    expect(await registrarNfAction({ ...nota, relogios: [{ ...relogio, ns: 1 as never }] })).toMatchObject({ ok: false })
    expect(await registrarNfAction({ ...nota, relogios: Array.from({ length: 201 }, (_, i) => ({ ...relogio, ns: `X${i}` })) }))
      .toMatchObject({ ok: false })
    expect(repo.registrarNf).not.toHaveBeenCalled()
  })

  it('registrar: grava a nota com os relógios e avisa UMA vez com todos os NS', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction(nota)).toEqual({ ok: true, valor: { nfId: 'n1', ids: ['e1', 'e2'] } })
    expect(repo.registrarNf).toHaveBeenCalledWith(expect.objectContaining({
      cnpj: '12.345.678/0001-90', motivos: [MOTIVO],
      relogios: [expect.objectContaining({ modelo: '562', sequencia: '19177' }), expect.objectContaining({ modelo: '562', sequencia: '19178' })],
    }))
    expect(avisarSat).toHaveBeenCalledTimes(1)
    expect(avisarSat).toHaveBeenCalledWith(
      '📦 Chegou no SAT: NF 4521 — EMPRESA (12.345.678/0001-90) — reprovada ❌ (Sem CFOP) — 2 relógios: 00043005620019177, 562-19178')
  })

  it('registrar: Discord fora do ar não impede a gravação', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    avisarSat.mockRejectedValueOnce(new Error('discord caiu'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction(nota)).toEqual({ ok: true, valor: { nfId: 'n1', ids: ['e1', 'e2'] } })
  })

  it('registrar: erro do banco vira mensagem da tela e não avisa', async () => {
    sessao({ visualizar: true, registrar_entrada: true })
    repo.registrarNf.mockRejectedValueOnce(new repo.ErroDoBanco('NS_REPETIDO'))
    const { registrarNfAction } = await import('../actions')
    expect(await registrarNfAction(nota)).toEqual({ ok: false, erro: 'Um número de série está duas vezes nesta nota.' })
    expect(avisarSat).not.toHaveBeenCalled()
  })
})

describe('actions do SAT — NF depois da entrada', () => {
  it('corrigir/trocar NF exigem sat.aprovar_nf', async () => {
    sessao({ visualizar: true, registrar_entrada: true, administrar: true, associar_os: true })
    const { corrigirNfAction, trocarNfAction } = await import('../actions')
    expect(await corrigirNfAction(UUID, 'aprovada', [])).toEqual(SEM_PERMISSAO)
    expect(await trocarNfAction(UUID, troca)).toEqual(SEM_PERMISSAO)
    expect(repo.corrigirNf).not.toHaveBeenCalled()
    expect(repo.trocarNf).not.toHaveBeenCalled()
  })

  it('corrigir: grava pela nota e avisa no Discord', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    repo.corrigirNf.mockResolvedValueOnce(mudanca)
    const { corrigirNfAction } = await import('../actions')
    expect(await corrigirNfAction(UUID, 'aprovada', [])).toEqual({ ok: true, valor: null })
    expect(repo.corrigirNf).toHaveBeenCalledWith(UUID, 'aprovada', [])
    expect(avisarSat).toHaveBeenLastCalledWith(
      '🧾 NF do SAT corrigida: NF 1 — EMPRESA (12.345.678/0001-90) — reprovada → aprovada ✅ — relógios: NS1, NS2')
  })

  it('trocar: valida e grava a nota nova (CNPJ com máscara, valor lido) e avisa', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    repo.trocarNf.mockResolvedValueOnce({ ...mudanca, numeroPara: '1240' })
    const { trocarNfAction } = await import('../actions')
    expect(await trocarNfAction(UUID, troca)).toEqual({ ok: true, valor: null })
    expect(repo.trocarNf).toHaveBeenCalledWith(UUID, {
      numero: '1240', cnpj: '12.345.678/0001-90', empresa: 'EMPRESA', negocianteCodigo: null, valor: 10.5,
      situacao: 'aprovada', motivos: [],
    })
    expect(avisarSat).toHaveBeenLastCalledWith(
      '🧾 NF do SAT trocada: NF 1 (reprovada) substituída pela NF 1240 — EMPRESA (12.345.678/0001-90) aprovada ✅ — relógios: NS1, NS2')
  })

  it('trocar: CNPJ inválido recusa antes do banco', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    const { trocarNfAction } = await import('../actions')
    expect(await trocarNfAction(UUID, { ...troca, cnpj: '1' })).toEqual({ ok: false, erro: 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).' })
    expect(repo.trocarNf).not.toHaveBeenCalled()
  })

  it('corrigir: Discord fora do ar não impede', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    repo.corrigirNf.mockResolvedValueOnce(mudanca)
    avisarSat.mockRejectedValueOnce(new Error('discord caiu'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { corrigirNfAction } = await import('../actions')
    expect(await corrigirNfAction(UUID, 'aprovada', [])).toEqual({ ok: true, valor: null })
  })

  it('id de nota inválido é recusado', async () => {
    sessao({ visualizar: true, aprovar_nf: true })
    const { corrigirNfAction, trocarNfAction } = await import('../actions')
    expect(await corrigirNfAction('x; drop', 'aprovada', [])).toMatchObject({ ok: false })
    expect(await trocarNfAction('x; drop', troca)).toMatchObject({ ok: false })
    expect(repo.corrigirNf).not.toHaveBeenCalled()
    expect(repo.trocarNf).not.toHaveBeenCalled()
  })
})

describe('actions do SAT — associar OS', () => {
  it('exige sat.associar_os (aprovar_nf e administrar não bastam)', async () => {
    sessao({ visualizar: true, registrar_entrada: true, aprovar_nf: true, administrar: true })
    const { associarOsAction } = await import('../actions')
    expect(await associarOsAction(UUID, OS)).toEqual(SEM_PERMISSAO)
    expect(repo.associarOs).not.toHaveBeenCalled()
  })

  it('grava (OS ou "sem OS") e NÃO avisa no Discord', async () => {
    sessao({ visualizar: true, associar_os: true })
    const { associarOsAction } = await import('../actions')
    expect(await associarOsAction(UUID, OS)).toEqual({ ok: true, valor: null })
    expect(repo.associarOs).toHaveBeenCalledWith(UUID, OS)
    expect(await associarOsAction(UUID, null)).toEqual({ ok: true, valor: null })
    expect(repo.associarOs).toHaveBeenLastCalledWith(UUID, null)
    expect(avisarSat).not.toHaveBeenCalled()
  })

  it('ids inválidos recusam; erro do banco vira mensagem', async () => {
    sessao({ visualizar: true, associar_os: true })
    const { associarOsAction } = await import('../actions')
    expect(await associarOsAction('x', OS)).toMatchObject({ ok: false })
    expect(await associarOsAction(UUID, 'y')).toMatchObject({ ok: false })
    expect(repo.associarOs).not.toHaveBeenCalled()
    repo.associarOs.mockRejectedValueOnce(new repo.ErroDoBanco('OS_EM_USO'))
    expect(await associarOsAction(UUID, OS)).toEqual({ ok: false, erro: 'Essa OS já está ligada a outro relógio.' })
  })
})
