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
      // `new URL(caminho, base)` aceita `url` com ou sem barra final sem virar `//api/sincronizacao`
      // (o que a concatenação por template string faria).
      const alvo = new URL('/api/sincronizacao', url)
      const controlador = new AbortController()
      const tempoLimite = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS)
      try {
        const resposta = await fetch(alvo, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${segredo}`,
          },
          body: JSON.stringify(foto),
          // Nunca segue redirect: a Central não deveria redirecionar esta chamada, e seguir um
          // redirect às cegas poderia levar o segredo (no cabeçalho Authorization) pra outro host.
          redirect: 'error',
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
