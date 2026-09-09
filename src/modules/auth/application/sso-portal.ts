import 'server-only'
import { jwtVerify } from 'jose'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { validarClaimsSso, RegistroJti } from '../domain/sso-token'

/** Emissor esperado. Fixo de propósito: só o Portal RwTech assina token pra cá. */
const EMISSOR = 'rwtech-portal'
/** Tolerância de relógio entre o portal e este servidor. Além disso é problema de NTP, não de janela. */
const TOLERANCIA_S = 30

/** Registro de tokens já usados. Vive no processo — ver a nota em RegistroJti sobre múltiplas instâncias. */
const jtisUsados = new RegistroJti()

export type ResultadoSso =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 503; erro: string }

/**
 * Entra no Shopfloor a partir de um token assinado pelo Portal RwTech.
 *
 * O SSO substitui APENAS a conferência de senha. A sessão em si nasce do mesmo jeito que a do login
 * normal: quem emite é o GoTrue, e os cookies são os que o `@supabase/ssr` grava — porque toda a
 * segurança do banco (RLS, `auth.uid()`) sai desse JWT. Forjar um cookie aqui daria uma sessão que
 * o app aceita e o banco recusa.
 *
 * Como o GoTrue não expõe "emitir sessão para este usuário", o caminho é o link mágico: com a
 * service role a gente GERA o token (`generateLink` não envia e-mail, só devolve) e o resgata com
 * `verifyOtp` — o mesmo mecanismo que a rota /auth/redefinir já usa pra estabelecer sessão.
 */
export async function entrarPorSso(token: string | null): Promise<ResultadoSso> {
  if (!token || token.trim() === '') {
    return { ok: false, status: 400, erro: 'Token ausente.' }
  }

  // Lido aqui, não no env.ts: se o SSO não estiver configurado, o que tem que falhar é ESTE
  // endpoint — não a aplicação inteira no boot.
  const segredo = process.env.RWTECH_SSO_SECRET ?? ''
  const siteId = process.env.RWTECH_SITE_ID ?? ''
  if (segredo === '' || siteId === '') {
    return { ok: false, status: 503, erro: 'SSO não configurado neste ambiente.' }
  }

  let bruto: Record<string, unknown>
  try {
    // O segredo entra como os BYTES UTF-8 da string, que é como a biblioteca do portal
    // (jsonwebtoken, com secret string) o trata. Decodificar o base64url aqui daria outra
    // chave e nenhuma assinatura bateria.
    const { payload } = await jwtVerify(token, new TextEncoder().encode(segredo), {
      algorithms: ['HS256'],
      issuer: EMISSOR,
      audience: siteId,
      clockTolerance: TOLERANCIA_S,
    })
    bruto = payload as Record<string, unknown>
  } catch {
    // Assinatura, exp, iss e aud caem todos aqui. A mensagem é única de propósito: dizer QUAL
    // falhou ajuda quem está tentando forjar mais do que ajuda quem está tentando entrar.
    return { ok: false, status: 401, erro: 'Token inválido ou expirado.' }
  }

  const v = validarClaimsSso(bruto)
  if (!v.ok) return { ok: false, status: 401, erro: v.erro }
  const { email, jti } = v.claims

  const expiraEmMs = typeof bruto.exp === 'number' ? bruto.exp * 1000 : Date.now() + 60_000
  if (!jtisUsados.registrar(jti, expiraEmMs)) {
    return { ok: false, status: 401, erro: 'Token já utilizado.' }
  }

  // Busca com service role: o usuário ainda NÃO tem sessão, então nenhuma policy de RLS o alcança.
  const service = createServiceSupabase()
  const { data: usuario, error: erroBusca } = await service
    .from('usuarios')
    .select('id,ativo,perfil_id')
    .eq('email', email)
    .maybeSingle()
  if (erroBusca) return { ok: false, status: 503, erro: 'Não foi possível validar o acesso agora.' }

  // Não criamos usuário automaticamente: quem está no portal não está necessariamente autorizado
  // no chão de fábrica, e um cadastro silencioso viraria acesso indevido.
  if (!usuario) {
    return { ok: false, status: 403, erro: `Usuário ${email} não cadastrado no Shopfloor.` }
  }
  if (usuario.ativo !== true || !usuario.perfil_id) {
    return { ok: false, status: 403, erro: `Usuário ${email} está inativo ou sem perfil no Shopfloor.` }
  }

  const { data: link, error: erroLink } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (erroLink || !tokenHash) {
    return { ok: false, status: 503, erro: 'Não foi possível abrir a sessão agora.' }
  }

  const supabase = await createServerSupabase()
  const { error: erroSessao } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (erroSessao) return { ok: false, status: 503, erro: 'Não foi possível abrir a sessão agora.' }

  return { ok: true }
}
