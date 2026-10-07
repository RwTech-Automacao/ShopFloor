// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { AUDIENCIA_DASHBOARD, EMISSOR_DASHBOARD } from '../../domain/sso-dashboard'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
//
// ⚠️ O CAMINHO DO MOCK é o que faz estes testes testarem algo. Se ele não casar com o import do
// módulo sob teste, o Supabase REAL entra em cena e os testes viram teatro (já aconteceu neste
// projeto: 7 testes não testavam nada). Os caminhos abaixo são os mesmos do import em
// `sso-dashboard.ts`, e o teste "os mocks pegam de verdade" prova que pegaram.
const mocks = vi.hoisted(() => ({
  criarServico: vi.fn(),
  criarServidor: vi.fn(),
  marca: { valor: '1' as string | null },
}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => (n === 'x-sf-embed' ? mocks.marca.valor : null) }),
}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: mocks.criarServico }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: mocks.criarServidor }))

import { entrarPorSsoDashboard } from '../sso-dashboard'

const SEGREDO = 'segredo-separado-do-portal'
const EMAIL = 'dashboard@enterplak.com.br'
const NEXT_OK = '/embed/fluxo/PMOC13/2340%2F26'

interface Cenario {
  /** `null` = usuário não cadastrado. Ausente = usuário ativo e com perfil. */
  usuario?: { id: string; ativo: boolean; perfil_id: string | null } | null
  erroBusca?: boolean
  hashedToken?: string | null
  erroLink?: boolean
  erroSessao?: boolean
}

/** O que os dublês registraram — é por aqui que se prova que o código chamou os mocks. */
interface Registro {
  servicosCriados: number
  servidoresCriados: number
  tabelas: string[]
  emailBuscado: string | null
  generateLink: unknown[]
  verifyOtp: unknown[]
}

function prepararSupabase(c: Cenario = {}): Registro {
  const r: Registro = {
    servicosCriados: 0,
    servidoresCriados: 0,
    tabelas: [],
    emailBuscado: null,
    generateLink: [],
    verifyOtp: [],
  }
  const usuario = c.usuario === undefined ? { id: 'u1', ativo: true, perfil_id: 'p1' } : c.usuario

  mocks.criarServico.mockImplementation(() => {
    r.servicosCriados++
    return {
      from: (tabela: string) => {
        r.tabelas.push(tabela)
        return {
          select: () => ({
            eq: (_coluna: string, valor: string) => {
              r.emailBuscado = valor
              return {
                maybeSingle: async () =>
                  c.erroBusca
                    ? { data: null, error: { message: 'banco fora do ar' } }
                    : { data: usuario, error: null },
              }
            },
          }),
        }
      },
      auth: {
        admin: {
          generateLink: async (args: unknown) => {
            r.generateLink.push(args)
            if (c.erroLink) return { data: null, error: { message: 'generateLink falhou' } }
            const hashed = c.hashedToken === undefined ? 'hash-abc' : c.hashedToken
            return { data: { properties: { hashed_token: hashed } }, error: null }
          },
        },
      },
    }
  })

  mocks.criarServidor.mockImplementation(async () => {
    r.servidoresCriados++
    return {
      auth: {
        verifyOtp: async (args: unknown) => {
          r.verifyOtp.push(args)
          return { error: c.erroSessao ? { message: 'otp inválido' } : null }
        },
      },
    }
  })

  return r
}

interface OpcoesToken {
  iss?: string
  aud?: string
  email?: unknown
  semEmail?: boolean
  jti?: string
  semJti?: boolean
  iat?: number
  semIat?: boolean
  exp?: number
  semExp?: boolean
  segredo?: string
}

/** Token do dashboard assinado de verdade (HS256) — nada de mockar a biblioteca de JWT. */
async function assinar(o: OpcoesToken = {}): Promise<string> {
  const agora = Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {}
  if (!o.semEmail) payload.email = o.email === undefined ? EMAIL : o.email
  if (!o.semJti) payload.jti = o.jti ?? randomUUID()

  let s = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(o.iss ?? EMISSOR_DASHBOARD)
    .setAudience(o.aud ?? AUDIENCIA_DASHBOARD)
  if (!o.semIat) s = s.setIssuedAt(o.iat ?? agora)
  if (!o.semExp) s = s.setExpirationTime(o.exp ?? agora + 60)
  return s.sign(new TextEncoder().encode(o.segredo ?? SEGREDO))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.marca.valor = '1'
  vi.stubEnv('DASHBOARD_SSO_SECRET', SEGREDO)
  vi.stubEnv('DASHBOARD_SSO_EMAIL', EMAIL)
  prepararSupabase()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('entrarPorSsoDashboard — caminho feliz', () => {
  it('abre a sessão e devolve o destino validado', async () => {
    const r = await entrarPorSsoDashboard(await assinar(), NEXT_OK)
    expect(r).toEqual({ ok: true, next: NEXT_OK })
  })

  it('aceita exp exatamente no teto de 60s', async () => {
    const agora = Math.floor(Date.now() / 1000)
    const r = await entrarPorSsoDashboard(await assinar({ iat: agora, exp: agora + 60 }), NEXT_OK)
    expect(r).toEqual({ ok: true, next: NEXT_OK })
  })

  it('normaliza o e-mail do token antes de comparar com o configurado', async () => {
    const reg = prepararSupabase()
    const r = await entrarPorSsoDashboard(await assinar({ email: '  DASHBOARD@Enterplak.COM.br ' }), NEXT_OK)
    expect(r).toEqual({ ok: true, next: NEXT_OK })
    expect(reg.emailBuscado).toBe(EMAIL)
  })
})

describe('entrarPorSsoDashboard — o `next` sai CRU', () => {
  // ⚠️ Estes três testes são o guarda-corpo do `Location`. A OP do ShopFloor tem `/` no nome
  // (2340/26), então ela chega percent-encoded e TEM que continuar escapada; e o caso de duplo
  // encoding só é inofensivo porque ninguém decodifica de novo. Passar o valor por `new URL`,
  // por `decodeURIComponent` ou por qualquer normalização quebra um dos dois.
  it('preserva o %2F da OP', async () => {
    const r = await entrarPorSsoDashboard(await assinar(), '/embed/fluxo/PMOC13/2340%2F26')
    expect(r).toEqual({ ok: true, next: '/embed/fluxo/PMOC13/2340%2F26' })
  })

  it('preserva a query string (que `new URL(...).pathname` jogaria fora)', async () => {
    const alvo = '/embed/fluxo/PMOC13/2340%2F26?modo=tv&dias=30'
    const r = await entrarPorSsoDashboard(await assinar(), alvo)
    expect(r).toEqual({ ok: true, next: alvo })
  })

  it('devolve o duplo encoding intacto: decodificar de novo viraria travessia de verdade', async () => {
    const r = await entrarPorSsoDashboard(await assinar(), '/embed/%252e%252e/home')
    expect(r).toEqual({ ok: true, next: '/embed/%252e%252e/home' })
  })

  it('preserva caracteres que o `new URL` reescreveria (espaço)', async () => {
    const r = await entrarPorSsoDashboard(await assinar(), '/embed/fluxo/PMO A/1')
    expect(r).toEqual({ ok: true, next: '/embed/fluxo/PMO A/1' })
  })
})

describe('entrarPorSsoDashboard — token recusado (401)', () => {
  const RECUSADO = { ok: false, status: 401, erro: 'Token inválido ou expirado.', codigo: null }

  it('emissor errado', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ iss: 'outro-portal' }), NEXT_OK)).toEqual(RECUSADO)
  })

  it('audiência errada', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ aud: 'outro-site' }), NEXT_OK)).toEqual(RECUSADO)
  })

  it('assinado com outro segredo (o do Portal, por exemplo)', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ segredo: 'segredo-do-portal' }), NEXT_OK)).toEqual(RECUSADO)
  })

  it('expirado além da tolerância de relógio', async () => {
    const agora = Math.floor(Date.now() / 1000)
    const token = await assinar({ iat: agora - 180, exp: agora - 120 })
    expect(await entrarPorSsoDashboard(token, NEXT_OK)).toEqual({ ...RECUSADO, codigo: 'expirado' })
  })

  it('não é nem um JWT', async () => {
    expect(await entrarPorSsoDashboard('isto-nao-e-token', NEXT_OK)).toEqual(RECUSADO)
  })

  it('sem e-mail', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ semEmail: true }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token sem e-mail.',
      codigo: null,
    })
  })

  it('sem jti: sem ele não existe anti-replay', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ semJti: true }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token sem identificador (jti).',
      codigo: null,
    })
  })

  it('RECUSA o mesmo token duas vezes (replay)', async () => {
    const token = await assinar()
    expect(await entrarPorSsoDashboard(token, NEXT_OK)).toEqual({ ok: true, next: NEXT_OK })
    expect(await entrarPorSsoDashboard(token, NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token já utilizado.',
      codigo: 'expirado',
    })
  })

  it('o replay é recusado ANTES de abrir qualquer sessão', async () => {
    const token = await assinar()
    await entrarPorSsoDashboard(token, NEXT_OK)
    const reg = prepararSupabase()
    await entrarPorSsoDashboard(token, NEXT_OK)
    expect(reg.generateLink).toEqual([])
    expect(reg.verifyOtp).toEqual([])
  })

  it('exp além de 60s do iat: o teto é nosso, o jwtVerify não limita validade', async () => {
    const agora = Math.floor(Date.now() / 1000)
    expect(await entrarPorSsoDashboard(await assinar({ iat: agora, exp: agora + 61 }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token com validade acima de 60 segundos.',
      codigo: null,
    })
  })

  it('iat no FUTURO com exp = iat + 60: o teto é de posição, não só de vão', async () => {
    const agora = Math.floor(Date.now() / 1000)
    const iat = agora + 3600
    expect(await entrarPorSsoDashboard(await assinar({ iat, exp: iat + 60 }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token com validade acima de 60 segundos.',
      codigo: null,
    })
  })

  it('iat dentro da tolerância de relógio (+10s) é aceito', async () => {
    const agora = Math.floor(Date.now() / 1000)
    const iat = agora + 10
    expect(await entrarPorSsoDashboard(await assinar({ iat, exp: iat + 60 }), NEXT_OK)).toEqual({
      ok: true,
      next: NEXT_OK,
    })
  })

  it('exp muito além de 60s (token eterno de um dia)', async () => {
    const agora = Math.floor(Date.now() / 1000)
    expect(await entrarPorSsoDashboard(await assinar({ iat: agora, exp: agora + 86400 }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token com validade acima de 60 segundos.',
      codigo: null,
    })
  })

  it('iat ausente: sem ele não há como medir a validade', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ semIat: true }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token sem emissão (iat).',
      codigo: null,
    })
  })

  it('exp ausente: token sem validade é token eterno', async () => {
    expect(await entrarPorSsoDashboard(await assinar({ semExp: true }), NEXT_OK)).toEqual({
      ok: false,
      status: 401,
      erro: 'Token sem expiração (exp).',
      codigo: null,
    })
  })
})

describe('entrarPorSsoDashboard — pedido malformado (400)', () => {
  const AUSENTE = { ok: false, status: 400, erro: 'Token ausente.', codigo: null }

  it('token nulo', async () => {
    expect(await entrarPorSsoDashboard(null, NEXT_OK)).toEqual(AUSENTE)
  })

  it('token só com espaços', async () => {
    expect(await entrarPorSsoDashboard('   ', NEXT_OK)).toEqual(AUSENTE)
  })

  const INVALIDO = { ok: false, status: 400, erro: 'Destino inválido.', codigo: null }

  it.each([
    ['nulo', null],
    ['vazio', ''],
    ['absoluto', 'https://evil.example/embed/fluxo'],
    ['protocolo relativo', '//evil.example/embed/fluxo'],
    ['fora do embed', '/home'],
    ['travessia', '/embed/../home'],
    ['travessia escapada', '/embed/..%2Fhome'],
  ])('next %s → 400', async (_nome, next) => {
    expect(await entrarPorSsoDashboard(await assinar(), next)).toEqual(INVALIDO)
  })

  it('o destino inválido é recusado SEM queimar o token', async () => {
    const token = await assinar()
    expect(await entrarPorSsoDashboard(token, '/home')).toEqual(INVALIDO)
    // o mesmo token, agora com destino bom, ainda vale: o jti não foi gasto num pedido recusado
    expect(await entrarPorSsoDashboard(token, NEXT_OK)).toEqual({ ok: true, next: NEXT_OK })
  })
})

describe('entrarPorSsoDashboard — acesso negado (403)', () => {
  it('e-mail diferente do configurado, mesmo sendo válido', async () => {
    const r = await entrarPorSsoDashboard(await assinar({ email: 'gestor@enterplak.com.br' }), NEXT_OK)
    expect(r).toEqual({
      ok: false,
      status: 403,
      erro: 'Este emissor só pode entrar com a conta do dashboard.',
      codigo: 'forbidden',
    })
  })

  it('o e-mail errado nem chega ao banco', async () => {
    const reg = prepararSupabase()
    await entrarPorSsoDashboard(await assinar({ email: 'gestor@enterplak.com.br' }), NEXT_OK)
    expect(reg.servicosCriados).toBe(0)
  })

  it('usuário inexistente', async () => {
    prepararSupabase({ usuario: null })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual({
      ok: false,
      status: 403,
      erro: 'Usuário dashboard@enterplak.com.br não cadastrado no Shopfloor.',
      codigo: 'forbidden',
    })
  })

  it('usuário inativo', async () => {
    prepararSupabase({ usuario: { id: 'u1', ativo: false, perfil_id: 'p1' } })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual({
      ok: false,
      status: 403,
      erro: 'Usuário dashboard@enterplak.com.br está inativo ou sem perfil no Shopfloor.',
      codigo: 'inactive',
    })
  })

  it('usuário sem perfil', async () => {
    prepararSupabase({ usuario: { id: 'u1', ativo: true, perfil_id: null } })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual({
      ok: false,
      status: 403,
      erro: 'Usuário dashboard@enterplak.com.br está inativo ou sem perfil no Shopfloor.',
      codigo: 'inactive',
    })
  })
})

describe('entrarPorSsoDashboard — indisponível (503)', () => {
  const CONFIG = { ok: false, status: 503, erro: 'SSO não configurado neste ambiente.', codigo: null }

  it('segredo não configurado', async () => {
    vi.stubEnv('DASHBOARD_SSO_SECRET', '')
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual(CONFIG)
  })

  it('e-mail aceito não configurado', async () => {
    vi.stubEnv('DASHBOARD_SSO_EMAIL', '')
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual(CONFIG)
  })

  it('erro ao consultar o usuário', async () => {
    prepararSupabase({ erroBusca: true })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual({
      ok: false,
      status: 503,
      erro: 'Não foi possível validar o acesso agora.',
      codigo: null,
    })
  })

  const SESSAO = { ok: false, status: 503, erro: 'Não foi possível abrir a sessão agora.', codigo: null }

  it('generateLink falhando', async () => {
    prepararSupabase({ erroLink: true })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual(SESSAO)
  })

  it('generateLink sem hashed_token', async () => {
    prepararSupabase({ hashedToken: null })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual(SESSAO)
  })

  it('verifyOtp falhando', async () => {
    prepararSupabase({ erroSessao: true })
    expect(await entrarPorSsoDashboard(await assinar(), NEXT_OK)).toEqual(SESSAO)
  })
})

describe('entrarPorSsoDashboard — fail-closed sem a marca de embed', () => {
  it('sem x-sf-embed: 503 e NENHUMA sessão aberta', async () => {
    mocks.marca.valor = null
    const reg = prepararSupabase()
    const r = await entrarPorSsoDashboard(await assinar(), NEXT_OK)
    expect(r).toMatchObject({ ok: false, status: 503 })
    expect(reg.generateLink).toHaveLength(0)
    expect(reg.verifyOtp).toHaveLength(0)
    expect(mocks.criarServidor).toHaveBeenCalledTimes(0)
  })
})

describe('entrarPorSsoDashboard — os mocks pegam de verdade', () => {
  // Se o caminho de `vi.mock` estiver errado, o Supabase real entra e NENHUM destes
  // encontra o que espera. É este bloco que separa "teste verde" de "teste que testa".
  it('usa o service role para achar o usuário e o client de servidor para a sessão', async () => {
    const reg = prepararSupabase()
    const r = await entrarPorSsoDashboard(await assinar(), NEXT_OK)

    expect(r.ok).toBe(true)
    expect(reg.servicosCriados).toBe(1)
    expect(reg.servidoresCriados).toBe(1)
    expect(reg.tabelas).toEqual(['usuarios'])
    expect(reg.emailBuscado).toBe(EMAIL)
    expect(reg.generateLink).toEqual([{ type: 'magiclink', email: EMAIL }])
    expect(reg.verifyOtp).toEqual([{ type: 'magiclink', token_hash: 'hash-abc' }])
    expect(mocks.criarServico).toHaveBeenCalledTimes(1)
    expect(mocks.criarServidor).toHaveBeenCalledTimes(1)
  })

  it('o mock devolvendo erro MUDA o resultado (prova de que é ele que está rodando)', async () => {
    prepararSupabase({ erroBusca: true })
    const comErro = await entrarPorSsoDashboard(await assinar(), NEXT_OK)
    prepararSupabase()
    const semErro = await entrarPorSsoDashboard(await assinar(), NEXT_OK)

    expect(comErro).toEqual({
      ok: false,
      status: 503,
      erro: 'Não foi possível validar o acesso agora.',
      codigo: null,
    })
    expect(semErro).toEqual({ ok: true, next: NEXT_OK })
  })
})

describe('entrarPorSsoDashboard — o log não vaza credencial', () => {
  it('o diagnóstico da recusa não imprime o token nem o segredo', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await assinar({ aud: 'outro-site' })

    await entrarPorSsoDashboard(token, NEXT_OK)

    expect(aviso).toHaveBeenCalled()
    const impresso = aviso.mock.calls.flat().map(String).join(' | ')
    expect(impresso).not.toContain(token)
    expect(impresso).not.toContain(SEGREDO)
    // o pedaço da assinatura também não pode aparecer
    expect(impresso).not.toContain(token.split('.')[2])
    // mas o diagnóstico TEM que dizer qual claim caiu, senão configurar a integração é adivinhação
    expect(impresso).toContain('aud')
    aviso.mockRestore()
  })
})
