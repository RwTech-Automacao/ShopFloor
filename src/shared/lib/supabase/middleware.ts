import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cabecalhosComMarcaEmbed, ehCaminhoEmbed, opcoesCookieEmbed } from './embed'

/**
 * @param cabecalhos cabeçalhos da requisição já com a marca de embed resolvida pelo caminho
 *   (`cabecalhosComMarcaEmbed`, no middleware da raiz). Exigido de propósito: receber os
 *   cabeçalhos crus do cliente deixaria passar uma marca forjada.
 */
export async function updateSession(request: NextRequest, cabecalhos: Headers) {
  // /embed/* é a conta compartilhada só-leitura do Dashboard: sessão em cookie próprio, para não
  // sobrescrever a do supervisor logado em outra aba.
  const ehEmbed = ehCaminhoEmbed(request.nextUrl.pathname)

  let response = NextResponse.next({ request: { headers: cabecalhos } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: opcoesCookieEmbed(ehEmbed),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          // Os cookies renovados acima vivem no cabeçalho `cookie` da requisição, então a resposta
          // é remontada a partir dele — passando de novo pela marca de embed, que continua vindo
          // do caminho (nunca do cliente).
          response = NextResponse.next({
            request: {
              headers: cabecalhosComMarcaEmbed(request.headers, request.nextUrl.pathname),
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Um usuário autenticado no Supabase só é válido no app se existir em
  // public.usuarios, estiver ativo e tiver perfil. Sessões inativas/órfãs são
  // encerradas aqui para não prender o usuário em loop de redirecionamento
  // (o layout do app redireciona sessões inválidas para /login).
  let appUserValido = false
  let senhaProvisoria = false
  if (user) {
    const { data: appUser } = await supabase
      .from('usuarios')
      .select('ativo, perfil_id, senha_provisoria')
      .eq('id', user.id)
      .maybeSingle()
    appUserValido = appUser?.ativo === true && !!appUser?.perfil_id
    senhaProvisoria = appUser?.senha_provisoria === true
    if (!appUserValido) {
      await supabase.auth.signOut()
    }
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  const isDefinirSenha = request.nextUrl.pathname.startsWith('/definir-senha')
  // Fluxo público de "esqueci minha senha" (deslogado): solicitar, callback do link e definir a nova.
  const isReset =
    request.nextUrl.pathname.startsWith('/esqueci-senha') ||
    request.nextUrl.pathname.startsWith('/redefinir-senha') ||
    request.nextUrl.pathname.startsWith('/auth/redefinir')
  // SSO do Portal RwTech: a pessoa chega aqui JUSTAMENTE sem sessão — é o endpoint que vai criá-la.
  // Sem esta exceção o middleware a mandaria pro /login antes de o token sequer ser lido.
  const isSso = request.nextUrl.pathname.startsWith('/sso')

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const redirect = NextResponse.redirect(url)
    // preserva os cookies atualizados (incluindo a limpeza do signOut)
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }

  // ⚠️ /embed/* NUNCA redireciona: está dentro de um iframe do Dashboard. Sem sessão, /embed/sso
  // é quem a cria (como o /sso já faz) e as outras telas respondem "Conectando…" avisando o pai
  // por postMessage. Um redirect aqui travaria o dashboard sem explicação.
  if (!appUserValido && !isAuthRoute && !isReset && !isSso && !ehEmbed) return redirectTo('/login')
  if (appUserValido && isAuthRoute) return redirectTo('/home')
  // Conta com senha provisória fica presa em /definir-senha até trocar — menos no embed: a conta
  // compartilhada entra só por SSO, e /definir-senha dentro do iframe não teria como ser usada.
  if (appUserValido && senhaProvisoria && !isDefinirSenha && !ehEmbed)
    return redirectTo('/definir-senha')
  // Quem já trocou não deve mais ver a tela de definição.
  if (appUserValido && !senhaProvisoria && isDefinirSenha) return redirectTo('/home')

  return response
}
