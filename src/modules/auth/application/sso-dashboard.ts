import 'server-only'
import { jwtVerify, decodeJwt } from 'jose'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { RegistroJti } from '../domain/sso-token'
import {
  AUDIENCIA_DASHBOARD,
  EMISSOR_DASHBOARD,
  validarClaimsDashboard,
  validarNextEmbed,
} from '../domain/sso-dashboard'

/** Tolerância de relógio entre o dashboard e este servidor. Mesma do SSO do Portal. */
const TOLERANCIA_S = 30

/** Sobra além da tolerância, pra não depender de o `exp` e o relógio baterem no milissegundo. */
const MARGEM_RETENCAO_S = 30

/**
 * Teto de validade do token (spec A3: `exp` ≤ 60s).
 *
 * Isto é POR NOSSA CONTA: o `jwtVerify` confere que o token não expirou, mas não limita quanto
 * tempo ele pode valer. Sem este teto, o dashboard poderia emitir um token de um dia — e um token
 * longo que vaze (ele viaja na query string) vale o dia inteiro, não um minuto.
 */
const VALIDADE_MAX_S = 60

/**
 * Registro dos tokens já usados. Vive no processo — ver a nota em RegistroJti sobre múltiplas
 * instâncias. É um registro PRÓPRIO, separado do SSO do Portal: os `jti` vêm de emissores
 * diferentes e misturá-los só criaria colisão entre integrações independentes.
 *
 * A folga de retenção é DERIVADA da tolerância de relógio, como no sso-portal: o `jwtVerify`
 * aceita o token até `exp + TOLERANCIA_S`, então o jti precisa ser lembrado até depois disso. Se as
 * duas constantes vivessem separadas, aumentar a tolerância reabriria a janela de replay em
 * silêncio.
 */
const jtisUsados = new RegistroJti((TOLERANCIA_S + MARGEM_RETENCAO_S) * 1000)

export type ResultadoSsoDashboard =
  | { ok: true; next: string }
  | {
      ok: false
      status: 400 | 401 | 403 | 503
      erro: string
      /** Código para o `postMessage` do iframe (spec A6). `null` quando não é falha de acesso. */
      codigo: 'forbidden' | 'inactive' | null
    }

const falha = (
  status: 400 | 401 | 403 | 503,
  erro: string,
  codigo: 'forbidden' | 'inactive' | null = null,
): ResultadoSsoDashboard => ({ ok: false, status, erro, codigo })

/**
 * Entra no Shopfloor a partir de um token assinado pelo Dashboard Enterplak, para a tela do Fluxo
 * embutida num iframe. É o IRMÃO de `entrarPorSso` (SSO do Portal RwTech) — mesmo mecanismo,
 * outro emissor:
 *
 * - segredo `DASHBOARD_SSO_SECRET`, separado do do Portal;
 * - só a conta compartilhada (`DASHBOARD_SSO_EMAIL`) entra por aqui;
 * - o destino é o `next` validado, dentro de /embed/.
 *
 * A sessão em si nasce do mesmo jeito que a do login normal: quem emite é o GoTrue, e os cookies
 * são os que o `@supabase/ssr` grava — porque toda a segurança do banco (RLS, `auth.uid()`) sai
 * desse JWT. Como o GoTrue não expõe "emitir sessão para este usuário", o caminho é o link mágico:
 * com a service role a gente GERA o token (`generateLink` não envia e-mail, só devolve) e o resgata
 * com `verifyOtp`.
 *
 * ⚠️ A sessão cai no COOKIE DO EMBED (`sf-embed-auth`, Path=/embed) sem nada ser pedido aqui: esta
 * função roda dentro de `/embed/sso`, o middleware injeta a marca `x-sf-embed` em todo `/embed/*`,
 * e `createServerSupabase()` escolhe o `cookieOptions` por essa marca. Passar `cookieOptions` na
 * mão aqui seria uma segunda fonte da mesma decisão — exatamente o que `shared/lib/supabase/embed`
 * existe para evitar.
 */
export async function entrarPorSsoDashboard(
  token: string | null,
  next: string | null,
): Promise<ResultadoSsoDashboard> {
  if (!token || token.trim() === '') return falha(400, 'Token ausente.')

  // Lido aqui, não no env.ts: se o SSO do dashboard não estiver configurado, o que tem que falhar é
  // ESTE endpoint — não a aplicação inteira no boot.
  const segredo = process.env.DASHBOARD_SSO_SECRET ?? ''
  const emailAceito = process.env.DASHBOARD_SSO_EMAIL ?? ''
  if (segredo === '' || emailAceito === '') {
    return falha(503, 'SSO não configurado neste ambiente.')
  }

  // O destino é conferido ANTES da assinatura de propósito: é barato, não depende de nada, e evita
  // queimar um token de uso único num pedido que vai ser recusado de qualquer forma.
  const destino = validarNextEmbed(next)
  if (!destino.ok) return falha(400, destino.erro)

  let bruto: Record<string, unknown>
  try {
    // O segredo entra como os BYTES UTF-8 da string, que é como a biblioteca do emissor
    // (jose/jsonwebtoken com secret string) o trata. Decodificar base64url aqui daria outra chave
    // e nenhuma assinatura bateria.
    const { payload } = await jwtVerify(token, new TextEncoder().encode(segredo), {
      algorithms: ['HS256'],
      issuer: EMISSOR_DASHBOARD,
      audience: AUDIENCIA_DASHBOARD,
      clockTolerance: TOLERANCIA_S,
    })
    bruto = payload as Record<string, unknown>
  } catch (e) {
    // Assinatura, exp, iss e aud caem todos aqui. A RESPOSTA é única de propósito: dizer qual
    // falhou ajuda quem está tentando forjar mais do que ajuda quem está tentando entrar. O motivo
    // vai pro LOG DO SERVIDOR, onde quem configura a integração precisa dele.
    registrarFalha(e, token)
    return falha(401, 'Token inválido ou expirado.')
  }

  // O teto de validade. `exp` e `iat` são números porque a biblioteca já recusaria outra coisa em
  // `exp`; `iat` ela aceita ausente, então a conferência é nossa.
  const exp = bruto.exp
  const iat = bruto.iat
  if (typeof exp !== 'number') return falha(401, 'Token sem expiração (exp).')
  if (typeof iat !== 'number') return falha(401, 'Token sem emissão (iat).')
  if (exp - iat > VALIDADE_MAX_S) {
    return falha(401, `Token com validade acima de ${VALIDADE_MAX_S} segundos.`)
  }

  const v = validarClaimsDashboard(bruto, emailAceito)
  if (!v.ok) {
    // Token bem formado assinado pelo emissor certo, mas com OUTRA conta, é recusa de ACESSO (403),
    // não token inválido (401) — é o que a spec A3 pede, e é o que o dashboard precisa distinguir
    // para mostrar "sem permissão" em vez de "link expirado". A normalização repete a do domínio
    // de propósito: é só para escolher o status, a decisão de aceitar continua sendo de lá.
    const doToken = typeof bruto.email === 'string' ? bruto.email.trim().toLowerCase() : ''
    const outraConta = doToken !== '' && doToken !== emailAceito.trim().toLowerCase()
    return outraConta ? falha(403, v.erro, 'forbidden') : falha(401, v.erro)
  }
  const { email, jti } = v.claims

  if (!jtisUsados.registrar(jti, exp * 1000)) return falha(401, 'Token já utilizado.')

  // Busca com service role: o usuário ainda NÃO tem sessão, então nenhuma policy de RLS o alcança.
  const service = createServiceSupabase()
  const { data: usuario, error: erroBusca } = await service
    .from('usuarios')
    .select('id,ativo,perfil_id')
    .eq('email', email)
    .maybeSingle()
  if (erroBusca) return falha(503, 'Não foi possível validar o acesso agora.')

  // Não criamos a conta automaticamente: ela é provisionada pela migração do perfil só-leitura, e
  // um cadastro silencioso aqui viraria acesso indevido se o segredo vazasse.
  if (!usuario) {
    return falha(403, `Usuário ${email} não cadastrado no Shopfloor.`, 'forbidden')
  }
  if (usuario.ativo !== true || !usuario.perfil_id) {
    return falha(403, `Usuário ${email} está inativo ou sem perfil no Shopfloor.`, 'inactive')
  }

  const { data: link, error: erroLink } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (erroLink || !tokenHash) return falha(503, 'Não foi possível abrir a sessão agora.')

  const supabase = await createServerSupabase()
  const { error: erroSessao } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  if (erroSessao) return falha(503, 'Não foi possível abrir a sessão agora.')

  return { ok: true, next: destino.next }
}

/**
 * Log de diagnóstico da recusa. NUNCA imprime o token, a query string nem o segredo — o token é
 * credencial enquanto vive, e log de servidor costuma ser lido por mais gente do que se imagina.
 *
 * O `aud` recebido é lido SEM verificar assinatura (`decodeJwt`), e isso é seguro porque o valor
 * não é usado para nada: só vai pro log. É justamente o caso em que o payload não confiável ajuda,
 * porque a pergunta é "qual aud o dashboard está mandando?".
 */
function registrarFalha(e: unknown, token: string): void {
  const err = e as { code?: string; claim?: string; reason?: string }
  let detalhe = err?.code ?? 'erro desconhecido'
  if (err?.claim) detalhe += ` (claim ${err.claim}${err.reason ? `: ${err.reason}` : ''})`

  // Só no caso do `aud` vale a pena mostrar os dois lados — é o erro de configuração mais provável.
  if (err?.claim === 'aud') {
    let recebido = '?'
    try {
      recebido = String((decodeJwt(token) as { aud?: unknown }).aud ?? '?')
    } catch {
      /* token nem decodifica */
    }
    detalhe += ` esperado=${AUDIENCIA_DASHBOARD} recebido=${recebido}`
  }
  console.warn(`[sso-embed] token recusado: ${detalhe}`)
}
