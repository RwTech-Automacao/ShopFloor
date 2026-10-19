import { describe, expect, it, vi } from 'vitest'
import { configDoAmbiente, ConfiguracaoIncompleta } from '../config'
import { ErroDeLogin, GerenciadorToken } from '../token'

const jwtCom = (expSeg: number) => `x.${Buffer.from(JSON.stringify({ exp: expSeg })).toString('base64url')}.y`
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

const config = configDoAmbiente({ COMPELS_EZPOINT_USUARIO: 'u', COMPELS_EZPOINT_SENHA: 'p' })

describe('configDoAmbiente', () => {
  it('usa os padrões e exige usuário e senha', () => {
    expect(config).toMatchObject({ empresa: 'enterplak', apiUrl: 'https://api.erpeasy.compels.net' })
    expect(() => configDoAmbiente({})).toThrow(ConfiguracaoIncompleta)
  })
})

describe('GerenciadorToken', () => {
  it('faz login em JSON, pede o token do Compels com https e guarda em memória', async () => {
    const agora = 1_000_000_000_000
    const buscar = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/login')) return resposta({ token: 'EZ' })
      return resposta({ token: jwtCom(agora / 1000 + 7200) })
    }) as unknown as typeof fetch
    const g = new GerenciadorToken(config, buscar, () => agora)

    const t1 = await g.obter()
    const t2 = await g.obter()
    expect(t2).toBe(t1)
    expect(buscar).toHaveBeenCalledTimes(2) // login + token, uma vez só

    const chamadas = (buscar as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][]
    expect(chamadas[0]?.[0]).toBe('https://admin.ezpointweb.com.br/admin-ws/login')
    expect(chamadas[0]?.[1].headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(String(chamadas[1]?.[0])).toBe('https://admin.ezpointweb.com.br/admin-ws/getCompelsToken?empresa=enterplak')
    expect(chamadas[1]?.[1].headers).toMatchObject({ Authorization: 'Bearer EZ' })
  })

  it('renova quando falta menos de 5 minutos para vencer', async () => {
    let agora = 1_000_000_000_000
    const buscar = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/login') ? resposta({ token: 'EZ' }) : resposta({ token: jwtCom(agora / 1000 + 600) }),
    ) as unknown as typeof fetch
    const g = new GerenciadorToken(config, buscar, () => agora)
    await g.obter()
    agora += 6 * 60 * 1000 // restam 4 min
    await g.obter()
    expect(buscar).toHaveBeenCalledTimes(4)
  })

  it('invalidar força novo login', async () => {
    const buscar = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/login') ? resposta({ token: 'EZ' }) : resposta({ token: jwtCom(9_999_999_999) }),
    ) as unknown as typeof fetch
    const g = new GerenciadorToken(config, buscar)
    await g.obter()
    g.invalidar()
    await g.obter()
    expect(buscar).toHaveBeenCalledTimes(4)
  })

  it('login recusado vira ErroDeLogin sem vazar senha', async () => {
    const buscar = (async () => resposta({}, 401)) as unknown as typeof fetch
    const comSenhaDistinta = configDoAmbiente({ COMPELS_EZPOINT_USUARIO: 'usuario-x', COMPELS_EZPOINT_SENHA: 'SENHA-SECRETA-123' })
    const erro = await new GerenciadorToken(comSenhaDistinta, buscar).obter().catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroDeLogin)
    expect((erro as Error).message).toContain('HTTP 401')
    expect((erro as Error).message).not.toContain('SENHA-SECRETA-123')
    expect((erro as Error).message).not.toContain('usuario-x')
  })

  it('sem conexão vira ErroDeLogin', async () => {
    const buscar = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect(new GerenciadorToken(config, buscar).obter()).rejects.toThrow('Sem conexão')
  })

  it('resposta sem token vira ErroDeLogin', async () => {
    const buscar = (async () => resposta({ outra: 1 })) as unknown as typeof fetch
    await expect(new GerenciadorToken(config, buscar).obter()).rejects.toBeInstanceOf(ErroDeLogin)
  })
})
