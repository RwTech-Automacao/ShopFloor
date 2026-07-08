import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
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
  if (user) {
    const { data: appUser } = await supabase
      .from('usuarios')
      .select('ativo, perfil_id')
      .eq('id', user.id)
      .maybeSingle()
    appUserValido = appUser?.ativo === true && !!appUser?.perfil_id
    if (!appUserValido) {
      await supabase.auth.signOut()
    }
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const redirect = NextResponse.redirect(url)
    // preserva os cookies atualizados (incluindo a limpeza do signOut)
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }

  if (!appUserValido && !isAuthRoute) return redirectTo('/login')
  if (appUserValido && isAuthRoute) return redirectTo('/home')

  return response
}
