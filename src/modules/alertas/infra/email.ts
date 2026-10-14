import type { ResultadoEnvio } from '../domain/tipos'

const TEMPO_LIMITE_MS = 20_000
/** Teto do assunto. Servidor SMTP recusa cabeçalho muito longo, e cliente corta na exibição. */
const LIMITE_ASSUNTO = 200

/**
 * O que o cliente de e-mail precisa do transporte. Existe para o TESTE poder injetar um transporte
 * de mentira — é o mesmo papel do `fetch` injetável nos clientes de Telegram e Discord: nenhum
 * teste abre socket.
 */
export interface TransporteEmail {
  enviar(mensagem: {
    from: string
    to: string
    subject: string
    text: string
  }): Promise<{ messageId?: string }>
}

export interface ConfigEmail {
  host: string
  porta: number
  usuario: string
  senha: string
  /** O `From`. Pode ser 'Nome <endereço>' ou só o endereço. */
  remetente: string
  /** true = TLS direto (porta 465); false = STARTTLS (porta 587, o que o GoTrue usa). */
  seguro: boolean
}

export interface EmailClient {
  enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio>
}

/**
 * A configuração de SMTP deste ambiente, ou null (canal não configurado — a tela mostra
 * "não configurado" e nenhuma regra manda e-mail).
 *
 * ⚠️ São as MESMAS credenciais que o GoTrue já usa para o "esqueci a senha" (decisão da spec: não
 * se levanta servidor de e-mail novo). O "esqueci a senha" está quebrado por outro motivo
 * (template e `origin` atrás do nginx) — o ENVIO funciona, e é só dele que isto depende.
 *
 * `SMTP_REMETENTE` é obrigatória: e-mail sem `From` é recusado por qualquer servidor, e deixá-la
 * cair num valor inventado faria o alerta falhar só na primeira tentativa real, em produção.
 */
export function lerConfigEmail(env: NodeJS.ProcessEnv = process.env): ConfigEmail | null {
  const host = (env.SMTP_HOST ?? '').trim()
  const usuario = (env.SMTP_USER ?? '').trim()
  const senha = env.SMTP_PASS ?? ''
  const remetente = (env.SMTP_REMETENTE ?? '').trim()
  if (host === '' || usuario === '' || senha === '' || remetente === '') return null

  const portaBruta = Number.parseInt((env.SMTP_PORT ?? '').trim(), 10)
  const porta = Number.isInteger(portaBruta) && portaBruta > 0 ? portaBruta : 587
  // 465 é TLS direto; todo o resto (587, 25, 2525) é STARTTLS. SMTP_SEGURO sobrepõe, para o caso
  // raro de um servidor com TLS direto em porta fora do padrão.
  const seguroBruto = (env.SMTP_SEGURO ?? '').trim().toLowerCase()
  const seguro = seguroBruto === '' ? porta === 465 : seguroBruto === 'true' || seguroBruto === '1'

  return { host, porta, usuario, senha, remetente, seguro }
}

/**
 * Parte o texto do alerta em assunto e corpo: a PRIMEIRA LINHA é o assunto.
 *
 * ⚠️ POR QUE ASSIM, E NÃO UM TEXTO PRÓPRIO DE E-MAIL: `PortaCanal.enviar` entrega um texto só, e o
 * texto é o MESMO nos três canais (decisão da 0123 — quem lê no e-mail precisa da mesma informação
 * de quem lê no Discord). Toda mensagem do módulo já começa por uma linha de cabeçalho que diz
 * sozinha do que se trata (`📦 EMB390 fechou — 2 divergências de quantidade · Fim de EMB`), então
 * ela é um assunto pronto. Mexer na ordem das linhas de uma mensagem muda o assunto do e-mail —
 * está escrito também em `domain/emb.ts`.
 *
 * Texto de uma linha: o corpo REPETE o assunto, em vez de ir vazio (e-mail sem corpo é marcado como
 * suspeito por vários filtros).
 */
export function separarAssunto(texto: string): { assunto: string; corpo: string } {
  const i = texto.indexOf('\n')
  const primeira = (i === -1 ? texto : texto.slice(0, i)).trim()
  // Cabeçalho de e-mail não aceita quebra de linha: um \r sozinho na primeira linha viraria
  // injeção de cabeçalho. Troca por espaço antes de cortar.
  const assunto = primeira.replace(/[\r\n]+/g, ' ').slice(0, LIMITE_ASSUNTO)
  const corpo = i === -1 ? texto.trim() : texto.slice(i + 1)
  return { assunto, corpo }
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * O cliente de e-mail. `transporte` é injetado nos testes; em produção sai do nodemailer, criado
 * UMA vez por cliente (o pool de conexões dele é o que evita um handshake TLS por mensagem).
 */
export function criarEmail(cfg: ConfigEmail, transporte?: TransporteEmail): EmailClient {
  let atual = transporte ?? null

  async function obter(): Promise<TransporteEmail> {
    if (atual) return atual
    // Import dinâmico: o nodemailer é Node puro e não pode entrar no bundle do cliente. Também
    // mantém o custo fora dos ambientes sem SMTP configurado.
    const { createTransport } = await import('nodemailer')
    const t = createTransport({
      host: cfg.host,
      port: cfg.porta,
      secure: cfg.seguro,
      auth: { user: cfg.usuario, pass: cfg.senha },
      pool: true,
      maxConnections: 2,
      connectionTimeout: TEMPO_LIMITE_MS,
      greetingTimeout: TEMPO_LIMITE_MS,
      socketTimeout: TEMPO_LIMITE_MS,
    })
    atual = { enviar: (m) => t.sendMail(m) }
    return atual
  }

  return {
    async enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio> {
      const para = endereco.trim()
      // A fila já filtra endereço em branco (0151), mas falhar aqui é barato e evita abrir conexão.
      if (para === '') return { ok: false, erro: 'E-mail: endereço do destinatário em branco.' }
      const { assunto, corpo } = separarAssunto(texto)
      try {
        const t = await obter()
        const r = await t.enviar({ from: cfg.remetente, to: para, subject: assunto, text: corpo })
        // Sem messageId o e-mail saiu de qualquer forma: o servidor aceitou. Guardar string vazia
        // é melhor que marcar falha e reenviar uma mensagem já entregue.
        return { ok: true, mensagemExternaId: r.messageId ?? '' }
      } catch (e) {
        // ⚠️ NUNCA deixar a senha chegar aqui: o erro vai para `alerta_envios.erro` e para a tela.
        // `replaceAll` cobre o servidor que ecoa a credencial na mensagem de EAUTH.
        const cru = mensagemDe(e)
        const limpo = cfg.senha === '' ? cru : cru.replaceAll(cfg.senha, '***')
        return { ok: false, erro: `E-mail: ${limpo}` }
      }
    },
  }
}
