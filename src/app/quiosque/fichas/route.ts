import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { carregarFichasDoQuiosque, chaveDoQuiosqueConfere } from '@/modules/shopfloor/application/quiosque-fichas'
import { htmlQuiosqueFichas } from '@/modules/shopfloor/domain/quiosque-fichas'

/**
 * PÁGINA DO TABLET DO ALMOXARIFADO — `GET /quiosque/fichas?k=<FICHAS_TABLET_CHAVE>`.
 *
 * HTML escrito à mão, sem React, sem JavaScript e sem o layout do app: o tablet é Android 4.4 e não roda o app
 * normal (ver domain/quiosque-fichas.ts). Sem sessão — o middleware deixa passar — e quem autoriza é a chave do
 * link. Chave errada, ausente ou variável vazia = 404, igual a uma rota que não existe. Só leitura.
 *
 * ⚠️ A chave nunca vai para o log.
 */
export const dynamic = 'force-dynamic'

const CABECALHOS_BASE = {
  'Cache-Control': 'no-store',
  // A chave está na URL: nada de mandá-la adiante como Referer, nem de indexar.
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function naoEncontrado(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { ...CABECALHOS_BASE, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function html(corpo: string, status: number): Response {
  return new Response(corpo, {
    status,
    headers: { ...CABECALHOS_BASE, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const chave = new URL(request.url).searchParams.get('k')
  if (!chaveDoQuiosqueConfere(chave, process.env.FICHAS_TABLET_CHAVE)) return naoEncontrado()

  const agora = new Date()
  try {
    const { fichas, total } = await carregarFichasDoQuiosque(createServiceSupabase())
    return html(htmlQuiosqueFichas({ tipo: 'ok', fichas, total, agora }), 200)
  } catch (e) {
    console.error('[quiosque-fichas] falha ao ler a fila do Almoxarifado:', e instanceof Error ? e.message : String(e))
    // 503 com a página de erro: o meta refresh continua lá, e o tablet tenta de novo sozinho.
    return html(htmlQuiosqueFichas({ tipo: 'erro', agora }), 503)
  }
}
