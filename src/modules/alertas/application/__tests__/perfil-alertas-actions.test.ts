import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))


// Lançamento escondido: sem a variável ninguém é liberado. Aqui liberamos todos por padrão;
// o teste de recusa troca a lista dentro do próprio caso.
beforeEach(() => { vi.stubEnv('ALERTAS_LIBERADO_PARA', '*') })
afterEach(() => { vi.unstubAllEnvs() })

const ADMIN_SHOPFLOOR = { porModulo: { shopfloor: { administrar: true } }, permissoes: {} }

describe('actions de Meu perfil — erro ao consultar a sessão vira mensagem amigável', () => {
  it('gerarCodigoAction: getSessao lançando não estoura, vira ok:false', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => {
        throw new Error('cookies indisponível fora do contexto de requisição')
      },
    }))
    const { gerarCodigoAction } = await import('../perfil-alertas-actions')
    const r = await gerarCodigoAction()
    expect(r).toEqual({ ok: false, erro: 'Não foi possível gerar o código agora.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.resetModules()
  })

  it('desvincularAction: canal inválido (payload malformado) recusa sem exceção', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    const { desvincularAction } = await import('../perfil-alertas-actions')
    const r = await desvincularAction('whatsapp')
    expect(r).toEqual({ ok: false, erro: 'Canal inválido.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.resetModules()
  })

  it('desvincularAction recusa e-mail: não tem vínculo para remover', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    const { desvincularAction } = await import('../perfil-alertas-actions')
    expect(await desvincularAction('email')).toEqual({ ok: false, erro: 'Canal inválido.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.resetModules()
  })

  it('enviarTesteAction aceita e-mail e manda para o endereço de LOGIN da sessão', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    const enviados: { externoId: string }[] = []
    const diretos: unknown[] = []
    vi.doMock('../../infra/fabrica', () => ({
      criarDependenciasAlertas: () => ({
        portas: {
          email: {
            enviar: async (destino: { externoId: string }) => {
              enviados.push(destino)
              return { ok: true, mensagemExternaId: 'm1' }
            },
            removerBotoes: async () => ({ ok: true }),
          },
        },
        repo: { registrarEnvioDireto: async (d: unknown) => void diretos.push(d) },
      }),
    }))
    const { enviarTesteAction } = await import('../perfil-alertas-actions')
    expect(await enviarTesteAction('email')).toEqual({ ok: true })
    expect(enviados).toEqual([{ tipo: 'usuario', externoId: 'ana@x' }])
    expect(diretos).toHaveLength(1)
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.doUnmock('../../infra/fabrica')
    vi.resetModules()
  })

  it('enviarTesteAction ainda recusa canal que não existe', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    const { enviarTesteAction } = await import('../perfil-alertas-actions')
    expect(await enviarTesteAction('whatsapp')).toEqual({ ok: false, erro: 'Canal inválido.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.resetModules()
  })

  it('CANAIS_COM_VINCULO é telegram e discord (e-mail usa o login)', async () => {
    const { CANAIS_COM_VINCULO } = await import('../../domain/tipos')
    expect([...CANAIS_COM_VINCULO]).toEqual(['telegram', 'discord'])
  })

  it('enviarTesteAction: erro ao montar as dependências (client) vira ok:false amigável', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    vi.doMock('../../infra/fabrica', () => ({
      criarDependenciasAlertas: () => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
      },
    }))
    const { enviarTesteAction } = await import('../perfil-alertas-actions')
    const r = await enviarTesteAction('telegram')
    expect(r).toEqual({ ok: false, erro: 'Não foi possível enviar o teste agora.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.doUnmock('../../infra/fabrica')
    vi.resetModules()
  })

  it('lançamento escondido: usuário fora de ALERTAS_LIBERADO_PARA é recusado', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: ADMIN_SHOPFLOOR }),
    }))
    vi.stubEnv('ALERTAS_LIBERADO_PARA', 'outra@rwtech.com.br')
    vi.resetModules()
    const { desvincularAction } = await import('../perfil-alertas-actions')
    const r = await desvincularAction('telegram')
    expect(r).toEqual({ ok: false, erro: 'Recurso indisponível.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('sem administrar no ShopFloor, Meu perfil fica fechado mesmo liberado', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: { porModulo: { shopfloor: { visualizar: true } }, permissoes: {} } }),
    }))
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '*')
    vi.resetModules()
    const { desvincularAction } = await import('../perfil-alertas-actions')
    const r = await desvincularAction('telegram')
    expect(r).toEqual({ ok: false, erro: 'Recurso indisponível.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
