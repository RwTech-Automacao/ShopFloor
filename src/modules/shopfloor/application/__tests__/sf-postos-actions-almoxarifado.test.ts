import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const PERFIS = [
  { chave: 'passagem', nome: 'Passagem', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum' },
  { chave: 'embalagem', nome: 'Embalagem', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'caixa' },
  { chave: 'almoxarifado', nome: 'Almoxarifado', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'almoxarifado' },
]

function mocks(postos: { chave: string; ordem: number; perfil: string | null }[]) {
  const criarPosto = vi.fn(async () => {})
  const atualizarPosto = vi.fn(async () => {})
  vi.doMock('next/cache', () => ({ revalidatePath: () => {} }))
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({
      usuarioId: 'u1', nome: 'Gestor', email: 'g@x',
      perfil: { porModulo: { shopfloor: { administrar: true } }, permissoes: {} },
    }),
  }))
  vi.doMock('@/modules/logs/application/registrar-log', () => ({ registrarLog: async () => {} }))
  vi.doMock('@/modules/shopfloor/infra/postos-repository', () => ({
    criarPosto,
    atualizarPosto,
    excluirPosto: async () => {},
    postoEmUsoEmOrdem: async () => false,
    listarPerfis: async () => PERFIS,
  }))
  vi.doMock('@/modules/shopfloor/infra/ordem-repository', () => ({
    listarPostos: async () => postos.map((p) => ({ ...p, coletivo: false, retorno_pos_manutencao: '' })),
  }))
  return { criarPosto, atualizarPosto }
}

function form(campos: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

afterEach(() => {
  for (const m of [
    'next/cache',
    '@/modules/auth/application/get-sessao',
    '@/modules/logs/application/registrar-log',
    '@/modules/shopfloor/infra/postos-repository',
    '@/modules/shopfloor/infra/ordem-repository',
  ]) vi.doUnmock(m)
  vi.resetModules()
})

const UM_SO = 'Já existe um posto Almoxarifado; só pode haver um.'

describe('Cadastrar Posto — um posto Almoxarifado só', () => {
  it('criar um segundo posto com perfil Almoxarifado é recusado', async () => {
    const { criarPosto } = mocks([
      { chave: 'Embalagem', ordem: 1, perfil: 'embalagem' },
      { chave: 'Almoxarifado', ordem: 2, perfil: 'almoxarifado' },
    ])
    const { cadastrarPostoAction } = await import('../sf-postos-actions')

    const r = await cadastrarPostoAction(undefined, form({ chave: 'Estoque', perfil: 'almoxarifado' }))

    expect(r).toEqual({ erro: UM_SO })
    expect(criarPosto).not.toHaveBeenCalled()
  })

  it('criar o PRIMEIRO posto Almoxarifado continua permitido', async () => {
    const { criarPosto } = mocks([{ chave: 'Embalagem', ordem: 1, perfil: 'embalagem' }])
    const { cadastrarPostoAction } = await import('../sf-postos-actions')

    const r = await cadastrarPostoAction(undefined, form({ chave: 'Almoxarifado', perfil: 'almoxarifado' }))

    expect(r).toEqual({ ok: true, nome: 'Almoxarifado' })
    expect(criarPosto).toHaveBeenCalledTimes(1)
  })

  it('outros perfis não são afetados, mesmo com um Almoxarifado já cadastrado', async () => {
    const { criarPosto } = mocks([{ chave: 'Almoxarifado', ordem: 1, perfil: 'almoxarifado' }])
    const { cadastrarPostoAction } = await import('../sf-postos-actions')

    const r = await cadastrarPostoAction(undefined, form({ chave: 'Inspeção Final', perfil: 'passagem' }))

    expect(r).toEqual({ ok: true, nome: 'Inspeção Final' })
    expect(criarPosto).toHaveBeenCalledTimes(1)
  })

  it('trocar o perfil de outro posto para Almoxarifado é recusado', async () => {
    const { atualizarPosto } = mocks([
      { chave: 'Estoque', ordem: 1, perfil: 'passagem' },
      { chave: 'Almoxarifado', ordem: 2, perfil: 'almoxarifado' },
    ])
    const { atualizarPostoAction } = await import('../sf-postos-actions')

    const r = await atualizarPostoAction('Estoque', { perfil: 'almoxarifado' })

    expect(r).toEqual({ erro: UM_SO })
    expect(atualizarPosto).not.toHaveBeenCalled()
  })

  it('editar o próprio posto Almoxarifado sem mudar o perfil continua permitido', async () => {
    const { atualizarPosto } = mocks([
      { chave: 'Embalagem', ordem: 1, perfil: 'embalagem' },
      { chave: 'Almoxarifado', ordem: 2, perfil: 'almoxarifado' },
    ])
    const { atualizarPostoAction } = await import('../sf-postos-actions')

    const r = await atualizarPostoAction('Almoxarifado', { perfil: 'almoxarifado' })

    expect(r).toEqual({ ok: true, nome: 'Almoxarifado' })
    expect(atualizarPosto).toHaveBeenCalledTimes(1)
  })

  it('editar outro posto num perfil que não é Almoxarifado continua permitido', async () => {
    const { atualizarPosto } = mocks([
      { chave: 'Inspeção Final', ordem: 1, perfil: 'passagem' },
      { chave: 'Almoxarifado', ordem: 2, perfil: 'almoxarifado' },
    ])
    const { atualizarPostoAction } = await import('../sf-postos-actions')

    const r = await atualizarPostoAction('Inspeção Final', { perfil: 'embalagem' })

    expect(r).toEqual({ ok: true, nome: 'Inspeção Final' })
    expect(atualizarPosto).toHaveBeenCalledTimes(1)
  })
})
