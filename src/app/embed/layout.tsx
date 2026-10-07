/**
 * Layout da área embutida no Dashboard Enterplak.
 *
 * ⚠️ `/embed/*` fica FORA do grupo `(app)` de propósito: o layout de lá redireciona pro `/login`
 * quando não há sessão, e um `/login` dentro do iframe não renderiza — o middleware deixa
 * `/embed/*` passar sem sessão justamente pra a tela poder avisar o pai por postMessage.
 *
 * Sem menu lateral e sem cabeçalho (nada do `app-shell`): a aba do dashboard já é o "menu".
 * A tela ocupa a viewport inteira do iframe e o que crescer rola aqui dentro.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh w-full overflow-auto bg-background">{children}</div>
}
