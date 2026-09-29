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

  it('a Central responde mas com erro (409, foto vazia) -> ainda é etapa "central", com o status dela', async () => {
    const leitor = leitorFalso()
    const enviador: EnviadorFoto = { enviar: vi.fn(async () => ({ status: 409, corpo: { erro: 'Foto vazia' } })) }

    const r = await sincronizar(leitor, enviador, AGORA)

    expect(r).toEqual({ etapa: 'central', ok: true, status: 409, corpo: { erro: 'Foto vazia' } })
  })
})
