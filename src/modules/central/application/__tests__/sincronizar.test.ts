import { describe, it, expect, vi } from 'vitest'
import { sincronizar } from '../sincronizar'
import type { EnviadorFoto, LeitorFoto } from '../portas'
import type { LinhaOrdem, LinhaRecebimento } from '../../domain/foto'

const AGORA = () => new Date('2026-09-29T15:07:00.000Z')

function leitorFalso(recebimentos: LinhaRecebimento[] = [], ordens: LinhaOrdem[] = []): LeitorFoto {
  return {
    lerRecebimentos: vi.fn(async () => recebimentos),
    lerOrdens: vi.fn(async () => ordens),
  }
}

describe('sincronizar', () => {
  it('lê, monta a foto e envia — devolve etapa "central" com o status/corpo da Central', async () => {
    const leitor = leitorFalso(
      [{ id: 'r1', projetos: 'ACP017/26 GM', numero_emb: 'EMB347EA', data_chegada: '2026-10-05', situacao: 'finalizado' }],
      [{ id: 'o1', projetos: 'ACP017/26', primeiro_registro: '2026-10-08', concluida: false }],
    )
    let fotoRecebida: unknown
    const enviador: EnviadorFoto = {
      enviar: vi.fn(async (foto) => {
        fotoRecebida = foto
        return { status: 200, corpo: { resumo: { recebimentos: { novos: 1, atualizados: 0, removidos: 0 } } } }
      }),
    }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({
      etapa: 'central',
      ok: true,
      status: 200,
      corpo: { resumo: { recebimentos: { novos: 1, atualizados: 0, removidos: 0 } } },
    })
    expect(fotoRecebida).toEqual({
      versao: 1,
      geradoEm: '2026-09-29T15:07:00.000Z',
      recebimentos: [{ id: 'r1', projetos: 'ACP017/26 GM', numeroEmb: 'EMB347EA', dataChegada: '2026-10-05', situacao: 'finalizado' }],
      ordens: [{ id: 'o1', projetos: 'ACP017/26', primeiroRegistro: '2026-10-08', concluida: false }],
    })
  })

  it('lê as duas fontes em paralelo (Promise.all), não uma depois da outra', async () => {
    const ordem: string[] = []
    const leitor: LeitorFoto = {
      lerRecebimentos: vi.fn(async () => {
        ordem.push('inicio-recebimentos')
        await new Promise((r) => setTimeout(r, 5))
        ordem.push('fim-recebimentos')
        return []
      }),
      lerOrdens: vi.fn(async () => {
        ordem.push('inicio-ordens')
        return []
      }),
    }
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 200, corpo: {} })) }
    await sincronizar(leitor, enviador, AGORA)
    // Se fosse sequencial, "inicio-ordens" só apareceria depois de "fim-recebimentos".
    expect(ordem.indexOf('inicio-ordens')).toBeLessThan(ordem.indexOf('fim-recebimentos'))
  })

  it('leitura falha -> etapa "leitura", nunca chama o enviador', async () => {
    const leitor: LeitorFoto = {
      lerRecebimentos: vi.fn(async () => {
        throw new Error('connection refused')
      }),
      lerOrdens: vi.fn(async () => []),
    }
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 200, corpo: {} })) }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'leitura', ok: false, erro: 'connection refused' })
    expect(enviador.enviar).not.toHaveBeenCalled()
  })

  it('envio falha (Central fora do ar) -> etapa "envio"', async () => {
    const leitor = leitorFalso()
    const enviador: EnviadorFoto = {
      enviar: vi.fn(async () => {
        throw new Error('fetch failed')
      }),
    }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'envio', ok: false, erro: 'fetch failed' })
  })

  it('a Central responde mas com erro (409, foto vazia) -> ainda é etapa "central", com o status dela, ok: false', async () => {
    const leitor = leitorFalso()
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 409, corpo: { erro: 'Foto vazia' } })) }

    const r = await sincronizar(leitor, enviador, AGORA)

    // ok: true aqui seria enganoso — a Central RECUSOU a sincronização (409 não é sucesso).
    expect(r).toEqual({ etapa: 'central', ok: false, status: 409, corpo: { erro: 'Foto vazia' } })
  })

  it('etapa "central" com status 500 também vem com ok: false', async () => {
    const leitor = leitorFalso()
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 500, corpo: { erro: 'boom' } })) }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'central', ok: false, status: 500, corpo: { erro: 'boom' } })
  })

  it('envio falha por AbortError (timeout) -> mensagem "tempo esgotado", não o texto genérico do DOMException', async () => {
    const leitor = leitorFalso()
    const erroAbort = new DOMException('This operation was aborted', 'AbortError')
    const enviador: EnviadorFoto = {
      enviar: vi.fn(async () => {
        throw erroAbort
      }),
    }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'envio', ok: false, erro: 'tempo esgotado' })
  })

  it('envio falha com causa de rede (ECONNREFUSED) -> a mensagem inclui o código da causa', async () => {
    const leitor = leitorFalso()
    const causa = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), { code: 'ECONNREFUSED' })
    const erroFetch = new Error('fetch failed', { cause: causa })
    const enviador: EnviadorFoto = {
      enviar: vi.fn(async () => {
        throw erroFetch
      }),
    }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r.etapa).toBe('envio')
    expect((r as { erro: string }).erro).toContain('ECONNREFUSED')
  })

  it('montarFoto lança (situação fora do contrato) -> etapa "montagem", nunca chama o enviador', async () => {
    const leitor = leitorFalso([
      { id: 'r1', projetos: 'ACP017/26', numero_emb: 'EMB1', data_chegada: null, situacao: 'cancelado' },
    ])
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 200, corpo: {} })) }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'montagem', ok: false, erro: expect.stringMatching(/situação fora do contrato/) })
    expect(enviador.enviar).not.toHaveBeenCalled()
  })
})
