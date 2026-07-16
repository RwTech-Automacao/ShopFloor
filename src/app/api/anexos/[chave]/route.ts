import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { modoStorageFotos } from '@/modules/recebimento/infra/armazenamento'
import { baixarFotoDrive } from '@/modules/recebimento/infra/armazenamento/drive'

/** Serve a foto do Drive só para quem está logado e tem `visualizar`. O Drive não
 *  tem URL assinada — esta rota é o proxy autenticado (só no modo drive). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ chave: string }> },
): Promise<Response> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return new Response('Não autorizado', { status: 403 })
  }
  if (modoStorageFotos() !== 'drive') {
    return new Response('Indisponível', { status: 404 })
  }
  // O Next já entrega o param de rota decodificado; não decodificar de novo
  // (double-decode quebraria chaves com '%', como já mordeu no grid).
  const { chave } = await ctx.params
  try {
    const { dados, mime } = await baixarFotoDrive(chave)
    return new Response(dados, {
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' },
    })
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
}
