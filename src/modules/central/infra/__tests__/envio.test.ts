import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { criarEnviadorHttp, TEMPO_LIMITE_MS } from '../envio'
import type { Foto } from '../../domain/foto'

const FOTO: Foto = {
  versao: 1,
  geradoEm: '2026-09-29T15:07:00.000Z',
  recebimentos: [{ id: 'r1', projetos: 'ACP017/26 GM', numeroEmb: 'EMB347EA', dataChegada: '2026-10-05', situacao: 'finalizado' }],
  ordens: [{ id: 'o1', projetos: 'ACP017/26', primeiroRegistro: '2026-10-08', concluida: false }],
}

describe('criarEnviadorHttp', () => {
  let fetchOriginal: typeof fetch
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchOriginal = global.fetch
    setTimeoutSpy = vi.spyOn(global, 'setTimeout')
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    setTimeoutSpy.mockRestore()
  })

  it('manda POST pra <url>/api/sincronizacao com Bearer, content-type e o corpo da foto', async () => {
    const fetchFalso = vi.fn(async (..._args: [string, RequestInit]) => new Response(JSON.stringify({ resumo: { ok: true } }), { status: 200 }))
    global.fetch = fetchFalso as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 'segredo-super-secreto')
    const r = await enviador.enviar(FOTO)

    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [url, opcoes] = fetchFalso.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:3100/api/sincronizacao')
    expect(opcoes.method).toBe('POST')
    expect(opcoes.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer segredo-super-secreto',
    })
    expect(JSON.parse(opcoes.body as string)).toEqual(FOTO)
    expect(r).toEqual({ status: 200, corpo: { resumo: { ok: true } } })
  })

  it('usa um AbortSignal com tempo limite de 60 s (TEMPO_LIMITE_MS)', async () => {
    expect(TEMPO_LIMITE_MS).toBe(60_000)
    const fetchFalso = vi.fn(async (..._args: [string, RequestInit]) => new Response('{}', { status: 200 }))
    global.fetch = fetchFalso as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 's')
    await enviador.enviar(FOTO)

    const opcoes = fetchFalso.mock.calls[0]![1]
    expect(opcoes.signal).toBeInstanceOf(AbortSignal)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), TEMPO_LIMITE_MS)
  })

  it('nunca inclui o segredo em nenhum outro lugar do pedido além do cabeçalho Authorization', async () => {
    const fetchFalso = vi.fn(async (..._args: [string, RequestInit]) => new Response('{}', { status: 200 }))
    global.fetch = fetchFalso as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 'segredo-nao-pode-vazar')
    await enviador.enviar(FOTO)

    const [url, opcoes] = fetchFalso.mock.calls[0]!
    expect(String(url)).not.toContain('segredo-nao-pode-vazar')
    expect(opcoes.body as string).not.toContain('segredo-nao-pode-vazar')
  })

  it('devolve o status e o corpo mesmo quando a Central responde erro (409, 500...)', async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ erro: 'Foto vazia' }), { status: 409 }))
    global.fetch = fetchFalso as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 's')
    const r = await enviador.enviar(FOTO)
    expect(r).toEqual({ status: 409, corpo: { erro: 'Foto vazia' } })
  })

  it('corpo que não é JSON válido vira null em vez de lançar', async () => {
    const fetchFalso = vi.fn(async () => new Response('<html>502</html>', { status: 502 }))
    global.fetch = fetchFalso as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 's')
    const r = await enviador.enviar(FOTO)
    expect(r).toEqual({ status: 502, corpo: null })
  })

  it('fetch que rejeita (Central fora do ar) propaga o erro pra quem chama', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch

    const enviador = criarEnviadorHttp('http://127.0.0.1:3100', 's')
    await expect(enviador.enviar(FOTO)).rejects.toThrow('fetch failed')
  })
})
