import 'server-only'
import type { Foto } from '../domain/foto'
import type { EnviadorFoto, RespostaCentral } from '../application/portas'

/** A Central pode estar ocupada gravando (trava com a importação da planilha) — dá folga. */
export const TEMPO_LIMITE_MS = 60_000

/**
 * Client HTTP do envio: `POST ${url}/api/sincronizacao` com o segredo compartilhado
 * (`CENTRAL_SYNC_SECRET` aqui == `SINCRONIZACAO_SECRET` na Central). NUNCA loga o segredo — nem em
 * sucesso, nem em erro — e devolve o status/corpo da Central sem reinterpretar (a rota decide).
 */
export function criarEnviadorHttp(url: string, segredo: string): EnviadorFoto {
  return {
    async enviar(foto: Foto): Promise<RespostaCentral> {
      const controlador = new AbortController()
      const tempoLimite = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS)
      try {
        const resposta = await fetch(`${url}/api/sincronizacao`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${segredo}`,
          },
          body: JSON.stringify(foto),
          signal: controlador.signal,
        })
        const corpo = await resposta.json().catch(() => null)
        return { status: resposta.status, corpo }
      } finally {
        clearTimeout(tempoLimite)
      }
    },
  }
}
