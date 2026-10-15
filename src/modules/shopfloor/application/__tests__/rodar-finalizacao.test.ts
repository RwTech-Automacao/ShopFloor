import { describe, it, expect, vi, afterEach } from 'vitest'
import { rodarFinalizacaoContida, LIMITE_FINALIZACAO_MS } from '../rodar-finalizacao'

afterEach(() => vi.useRealTimers())

describe('rodarFinalizacaoContida', () => {
  it('devolve o resumo quando a rotina funciona', async () => {
    const log = vi.fn()
    const sincronizar = vi.fn(async () => ({ finalizadas: 2, reabertas: 1 }))
    const r = await rodarFinalizacaoContida(sincronizar, { log })
    expect(sincronizar).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ ok: true, finalizadas: 2, reabertas: 1 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 finalizada'))
  })

  it('não loga ruído quando não há o que fazer', async () => {
    const log = vi.fn()
    const logErro = vi.fn()
    await rodarFinalizacaoContida(async () => ({ finalizadas: 0, reabertas: 0 }), { log, logErro })
    expect(log).not.toHaveBeenCalled()
    expect(logErro).not.toHaveBeenCalled()
  })

  it('rejeição vira resultado de erro, nunca exceção', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(async () => { throw new Error('connection refused') }, { logErro })
    expect(r).toEqual({ ok: false, erro: 'connection refused' })
    expect(logErro).toHaveBeenCalledTimes(1)
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })

  it('rejeição de promessa (não só throw dentro de async) é contida e registrada', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(() => Promise.reject(new Error('banco fora')), { logErro })
    expect(r).toEqual({ ok: false, erro: 'banco fora' })
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('banco fora'))
  })

  it('erro SÍNCRONO (ex.: env do banco ausente) também é contido e registrado', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente') }, { logErro })
    expect(r).toEqual({ ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' })
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY ausente'))
  })

  it('valor que não é Error também é contido e registrado', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(() => Promise.reject('texto solto'), { logErro })
    expect(r).toEqual({ ok: false, erro: 'texto solto' })
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('texto solto'))
  })

  it('objeto solto lançado também é contido', async () => {
    const logErro = vi.fn()
    const r = await rodarFinalizacaoContida(() => { throw { codigo: 42 } }, { logErro })
    expect(r.ok).toBe(false)
    expect(logErro).toHaveBeenCalledTimes(1)
  })

  it('se o próprio log lançar, ainda assim não lança', async () => {
    const logErro = vi.fn(() => { throw new Error('log quebrado') })
    const r = await rodarFinalizacaoContida(async () => { throw new Error('x') }, { logErro })
    expect(r).toEqual({ ok: false, erro: 'x' })
    expect(logErro).toHaveBeenCalledTimes(1)
  })

  it('se o log de sucesso lançar, o resultado segue ok', async () => {
    const log = vi.fn(() => { throw new Error('log quebrado') })
    const r = await rodarFinalizacaoContida(async () => ({ finalizadas: 1, reabertas: 0 }), { log })
    expect(r).toEqual({ ok: true, finalizadas: 1, reabertas: 0 })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('estoura o teto de tempo em vez de pendurar o cron', async () => {
    vi.useFakeTimers()
    const logErro = vi.fn()
    const pendente = rodarFinalizacaoContida(() => new Promise(() => {}), { logErro })
    await vi.advanceTimersByTimeAsync(LIMITE_FINALIZACAO_MS + 1)
    const r = await pendente
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('tempo') })
    expect(logErro).toHaveBeenCalledWith(expect.stringContaining('tempo'))
  })

  it('o teto é configurável', async () => {
    vi.useFakeTimers()
    const pendente = rodarFinalizacaoContida(() => new Promise(() => {}), { limiteMs: 50, logErro: vi.fn() })
    await vi.advanceTimersByTimeAsync(51)
    expect((await pendente).ok).toBe(false)
  })

  it('o teto padrão é 8 s e não dispara antes', async () => {
    expect(LIMITE_FINALIZACAO_MS).toBe(8_000)
    vi.useFakeTimers()
    let terminou = false
    const pendente = rodarFinalizacaoContida(() => new Promise(() => {}), { logErro: vi.fn() }).then((r) => { terminou = true; return r })
    await vi.advanceTimersByTimeAsync(LIMITE_FINALIZACAO_MS - 1)
    expect(terminou).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect((await pendente).ok).toBe(false)
  })

  it('não deixa timer pendurado quando termina rápido', async () => {
    vi.useFakeTimers()
    await rodarFinalizacaoContida(async () => ({ finalizadas: 0, reabertas: 0 }))
    expect(vi.getTimerCount()).toBe(0)
  })
})
