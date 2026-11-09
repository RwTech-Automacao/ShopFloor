// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { criarDiscord } from '../discord'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

/** `fetch` de mentira que guarda o corpo CRU (string ou FormData) e os cabeçalhos de cada chamada. */
function fetchFalso(respostas: unknown[]) {
  const chamadas: { url: string; corpo: unknown; cabecalhos: Record<string, string> }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      corpo: init?.body,
      cabecalhos: (init?.headers ?? {}) as Record<string, string>,
    })
    return new Response(JSON.stringify(respostas[chamadas.length - 1] ?? {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('Discord com anexo', () => {
  it('canal: manda multipart com payload_json e files[0], sem fixar o Content-Type', async () => {
    const { fn, chamadas } = fetchFalso([{ id: 'M1' }])
    const dc = criarDiscord({ token: 'T', fetch: fn })
    const r = await dc.enviarCanal('C9', 'ficha', null, [{ nome: 'qr.png', tipo: 'image/png', bytes: PNG }])
    expect(r).toEqual({ ok: true, mensagemExternaId: 'C9:M1' })

    const c = chamadas[0]!
    expect(c.url).toBe('https://discord.com/api/v10/channels/C9/messages')
    expect(c.corpo).toBeInstanceOf(FormData)
    // Sem Content-Type: quem põe é o fetch, com o boundary do multipart.
    expect(Object.keys(c.cabecalhos).map((k) => k.toLowerCase())).not.toContain('content-type')
    expect(c.cabecalhos.Authorization).toBe('Bot T')

    const form = c.corpo as FormData
    const payload = JSON.parse(String(form.get('payload_json')))
    expect(payload.content).toBe('ficha')
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(payload.attachments).toEqual([{ id: 0, filename: 'qr.png' }])
    const arquivo = form.get('files[0]') as File
    expect(arquivo.name).toBe('qr.png')
    expect(arquivo.type).toBe('image/png')
    expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(PNG)
  })

  it('DM: abre o canal em JSON e só a mensagem vai em multipart', async () => {
    const { fn, chamadas } = fetchFalso([{ id: 'C5' }, { id: 'M2' }])
    const dc = criarDiscord({ token: 'T', fetch: fn })
    await dc.enviarDm('U1', 'ficha', null, [{ nome: 'qr.png', tipo: 'image/png', bytes: PNG }])
    expect(typeof chamadas[0]!.corpo).toBe('string')
    expect(chamadas[0]!.cabecalhos['Content-Type']).toBe('application/json')
    expect(chamadas[1]!.corpo).toBeInstanceOf(FormData)
  })

  it('sem anexo (ou lista vazia) continua em JSON, como sempre', async () => {
    const { fn, chamadas } = fetchFalso([{ id: 'M1' }, { id: 'M2' }])
    const dc = criarDiscord({ token: 'T', fetch: fn })
    await dc.enviarCanal('C9', 'oi', null)
    await dc.enviarCanal('C9', 'oi', null, [])
    for (const c of chamadas) {
      expect(typeof c.corpo).toBe('string')
      expect(c.cabecalhos['Content-Type']).toBe('application/json')
    }
  })

  it('erro do Discord com anexo volta como falha legível', async () => {
    const fn = (async () =>
      new Response(JSON.stringify({ message: 'Missing Permissions' }), { status: 403 })) as unknown as typeof fetch
    const dc = criarDiscord({ token: 'T', fetch: fn })
    const r = await dc.enviarCanal('C9', 'ficha', null, [{ nome: 'qr.png', tipo: 'image/png', bytes: PNG }])
    expect(r).toEqual({ ok: false, erro: 'Discord 403: Missing Permissions' })
  })
})
