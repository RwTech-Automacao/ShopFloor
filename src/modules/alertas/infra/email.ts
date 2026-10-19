import type { ResultadoEnvio } from '../domain/tipos'
import { cortarUtf16 } from '../domain/mensagens'

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
  // raro de um servidor com TLS direto em porta fora do padrão. Valores aceitos (sem diferenciar
  // maiúscula): true, 1, sim, yes = TLS direto; qualquer outro (false, 0, não...) = STARTTLS.
  const seguroBruto = (env.SMTP_SEGURO ?? '').trim().toLowerCase()
  const seguro = seguroBruto === '' ? porta === 465 : ['true', '1', 'sim', 'yes'].includes(seguroBruto)

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
  // `cortarUtf16` e não `slice`: um emoji na borda do teto não pode sair com meio caractere.
  const assunto = cortarUtf16(primeira.replace(/[\r\n]+/g, ' '), LIMITE_ASSUNTO).trimEnd()
  // O \r de um fim de linha \r\n pertence à primeira linha (já aparada), nunca ao começo do corpo.
  const corpo = i === -1 ? texto.trim() : texto.slice(i + 1).replace(/^\r+/, '')
  return { assunto, corpo }
}

async function criarTransporteNodemailer(cfg: ConfigEmail): Promise<TransporteEmail> {
  // Import dinâmico: o nodemailer é Node puro e não pode entrar no bundle do cliente. Também
  // mantém o custo fora dos ambientes sem SMTP configurado.
  const { createTransport } = await import('nodemailer')
  const t = createTransport({
    host: cfg.host,
    port: cfg.porta,
    secure: cfg.seguro,
    auth: { user: cfg.usuario, pass: cfg.senha },
    pool: false,
    connectionTimeout: TEMPO_LIMITE_MS,
    greetingTimeout: TEMPO_LIMITE_MS,
    socketTimeout: TEMPO_LIMITE_MS,
  })
  return { enviar: (m) => t.sendMail(m) }
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * O cliente de e-mail. `transporte` é injetado nos testes; em produção sai do nodemailer.
 *
 * Sem `pool`: `criarDependenciasAlertas()` monta um cliente NOVO a cada requisição/rodada, então um
 * pool nunca seria reaproveitado — e, como ninguém chama `close()` no transporte, ele deixaria
 * conexões ociosas abertas até o `socketTimeout`. Sem pool, cada transporte abre e fecha a própria
 * conexão. O transporte é criado uma vez por cliente (guardamos a Promise, não o transporte, para
 * dois envios simultâneos não criarem dois).
 */
export function criarEmail(cfg: ConfigEmail, transporte?: TransporteEmail): EmailClient {
  let atual: Promise<TransporteEmail> | null = transporte ? Promise.resolve(transporte) : null

  function obter(): Promise<TransporteEmail> {
    atual ??= criarTransporteNodemailer(cfg).catch((e) => {
      // Falha ao carregar/criar não pode ficar guardada para sempre: a próxima chamada tenta de novo.
      atual = null
      throw e
    })
    return atual
  }

  return {
    async enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio> {
      const para = endereco.trim()
      // A fila já filtra endereço em branco (0151), mas falhar aqui é barato e evita abrir conexão.
      if (para === '') return { ok: false, erro: 'E-mail: endereço do destinatário em branco.' }
      if (texto.trim() === '') return { ok: false, erro: 'E-mail: mensagem em branco.' }
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
