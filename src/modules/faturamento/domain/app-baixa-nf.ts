import type { MetadataRoute } from 'next'

/**
 * A tela de Baixa de NF instalável como app ("Instalar este site como aplicativo" do Edge/Chrome). O Chromium não
 * exige mais service worker para instalar (desde o Chrome 108): basta o manifesto com nome, ícones 192 e 512,
 * `start_url` e `display` standalone — e o site em HTTPS (ou localhost).
 *
 * O navegador busca o manifesto SEM o cookie de sessão, então o caminho dele sai do `middleware.ts` (que mandaria
 * para o /login). Rota EXATA: nada mais sob /faturamento fica sem sessão. Os ícones são .png, que o matcher do
 * middleware já não intercepta.
 */
export const ROTA_MANIFESTO_BAIXA_NF = '/faturamento/manifest.webmanifest'

export function ehRotaDoManifestoDaBaixaNf(pathname: string): boolean {
  return pathname === ROTA_MANIFESTO_BAIXA_NF
}

export function manifestoDaBaixaNf(): MetadataRoute.Manifest {
  return {
    id: '/faturamento/baixa-nf',
    name: 'Baixa de NF — ShopFloor',
    short_name: 'Baixa de NF',
    description: 'Baixa de NF de saída no Compels, com fila de prioridade.',
    start_url: '/faturamento/baixa-nf',
    scope: '/faturamento/',
    display: 'standalone',
    lang: 'pt-BR',
    // tokens do globals.css: --primary (vinho Enterplak) e --background (névoa)
    theme_color: '#8d2033',
    background_color: '#f5f6f8',
    icons: [
      { src: '/faturamento/app-baixa-nf-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/faturamento/app-baixa-nf-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
