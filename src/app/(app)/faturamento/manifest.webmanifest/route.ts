import { manifestoDaBaixaNf } from '@/modules/faturamento/domain/app-baixa-nf'

/** Manifesto do app "Baixa de NF". Público (sem sessão) — ver `ehRotaDoManifestoDaBaixaNf` no middleware. */
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(JSON.stringify(manifestoDaBaixaNf()), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  })
}
