import type { AnexoEnvio } from '../domain/anexos'
import { montarCallbackResolver } from '../domain/codigos'
import type { ResultadoEnvio, ResultadoSimples } from '../domain/tipos'

const API = 'https://discord.com/api/v10'
const TEMPO_LIMITE_MS = 10_000

export interface DiscordClient {
  /** Abre (ou reaproveita) a DM com a pessoa e manda a mensagem. */
  enviarDm(
    usuarioExternoId: string,
    texto: string,
    ocorrenciaIdBotao: string | null,
    anexos?: AnexoEnvio[],
  ): Promise<ResultadoEnvio>
  /**
   * Posta direto num canal do servidor (0123). É o MESMO endpoint da DM
   * (`POST /channels/{id}/messages`) — o que a conversa privada tem de específico é só o
   * `POST /users/@me/channels` que cria o canal de DM antes.
   *
   * O bot precisa de "Ver canal" e "Enviar mensagens" naquele canal; sem isso o envio falha e a
   * fila tenta 3 vezes antes de desistir.
   */
  enviarCanal(
    canalId: string,
    texto: string,
    ocorrenciaIdBotao: string | null,
    anexos?: AnexoEnvio[],
  ): Promise<ResultadoEnvio>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
}

export function payloadMensagemDiscord(
  texto: string,
  ocorrenciaIdBotao: string | null,
): Record<string, unknown> {
  // allowed_mentions vazio: a mensagem nunca vira notificação de @menção pra ninguém.
  const base: Record<string, unknown> = { content: texto, allowed_mentions: { parse: [] } }
  if (!ocorrenciaIdBotao) return base
  return {
    ...base,
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2, // button
            // Cinza: o Discord só tem azul, cinza, verde e vermelho — o amarelo é do emoji. Verde
            // dizia "resolvido" antes de qualquer coisa ter sido feita.
            style: 2, // secondary (cinza)
            label: 'Resolver',
            emoji: { name: '⚠️' },
            custom_id: montarCallbackResolver(ocorrenciaIdBotao),
          },
        ],
      },
    ],
  }
}

/** '<channel id>:<message id>' — o Discord edita por canal + mensagem. */
export function montarIdMensagemDiscord(canalId: string, mensagemId: string): string {
  return `${canalId}:${mensagemId}`
}

function separarId(id: string): { canalId: string; mensagemId: string } | null {
  const i = id.lastIndexOf(':')
  if (i <= 0 || i === id.length - 1) return null
  return { canalId: id.slice(0, i), mensagemId: id.slice(i + 1) }
}

/**
 * Mensagem com arquivos: multipart com o JSON da mensagem em `payload_json` (mais a lista `attachments`, que
 * liga cada `files[N]` ao seu nome) e os arquivos em `files[0]`, `files[1]`… (documentação do Discord).
 */
function corpoMultipart(payload: Record<string, unknown>, anexos: AnexoEnvio[]): FormData {
  const form = new FormData()
  form.append(
    'payload_json',
    JSON.stringify({ ...payload, attachments: anexos.map((a, id) => ({ id, filename: a.nome })) }),
  )
  anexos.forEach((a, i) => {
    // `new Uint8Array(...)` copia para um buffer próprio: o Blob não pode compartilhar o do chamador.
    form.append(`files[${i}]`, new Blob([new Uint8Array(a.bytes)], { type: a.tipo }), a.nome)
  })
  return form
}

export function criarDiscord(cfg: { token: string; fetch?: typeof fetch }): DiscordClient {
  async function chamar(
    metodo: 'POST' | 'PATCH',
    caminho: string,
    corpo: Record<string, unknown> | FormData,
  ): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; erro: string }> {
    const f = cfg.fetch ?? fetch
    // Com anexo o corpo é multipart (FormData): NÃO se fixa o Content-Type, quem põe é o fetch, com o boundary.
    const multipart = corpo instanceof FormData
    try {
      const res = await f(`${API}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bot ${cfg.token}`,
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          'User-Agent': 'ShopFloor (https://shopfloor.enterplak.com.br, 1.0)',
        },
        body: multipart ? corpo : JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        const mensagem = typeof json?.message === 'string' ? json.message : 'sem descrição'
        return { ok: false, erro: `Discord ${res.status}: ${mensagem}` }
      }
      return { ok: true, json: json ?? {} }
    } catch (e) {
      return { ok: false, erro: `Discord: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** Postar num canal é a parte comum: a DM só acrescenta a criação do canal antes. */
  async function postar(
    canalId: string,
    texto: string,
    ocorrenciaIdBotao: string | null,
    anexos: AnexoEnvio[] = [],
  ): Promise<ResultadoEnvio> {
    const payload = payloadMensagemDiscord(texto, ocorrenciaIdBotao)
    const msg = await chamar('POST', `/channels/${canalId}/messages`, anexos.length > 0 ? corpoMultipart(payload, anexos) : payload)
    if (!msg.ok) return msg
    const mensagemId = msg.json.id
    if (typeof mensagemId !== 'string') return { ok: false, erro: 'Discord: resposta sem id da mensagem' }
    return { ok: true, mensagemExternaId: montarIdMensagemDiscord(canalId, mensagemId) }
  }

  return {
    async enviarDm(usuarioExternoId, texto, ocorrenciaIdBotao, anexos) {
      const canal = await chamar('POST', '/users/@me/channels', { recipient_id: usuarioExternoId })
      if (!canal.ok) return canal
      const canalId = canal.json.id
      if (typeof canalId !== 'string') return { ok: false, erro: 'Discord: resposta sem id do canal' }
      return postar(canalId, texto, ocorrenciaIdBotao, anexos)
    },

    async enviarCanal(canalId, texto, ocorrenciaIdBotao, anexos) {
      return postar(canalId, texto, ocorrenciaIdBotao, anexos)
    },

    async removerBotoes(mensagemExternaId) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Discord: id de mensagem inválido' }
      const r = await chamar('PATCH', `/channels/${p.canalId}/messages/${p.mensagemId}`, { components: [] })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },
  }
}
