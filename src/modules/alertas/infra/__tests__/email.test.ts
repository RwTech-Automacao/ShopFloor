import { describe, it, expect, vi } from 'vitest'
import { criarEmail, lerConfigEmail, separarAssunto } from '../email'

const CFG = {
  host: 'smtp.exemplo.com',
  porta: 587,
  usuario: 'alertas@enterplak.com.br',
  senha: 'x',
  remetente: 'ShopFloor <alertas@enterplak.com.br>',
  seguro: false,
}

describe('separarAssunto', () => {
  it('a primeira linha é o assunto e o resto é o corpo', () => {
    const r = separarAssunto('📦 EMB390 fechou — 2 divergências\n#1 CAP\n   ↳ sem justificativa')
    expect(r.assunto).toBe('📦 EMB390 fechou — 2 divergências')
    expect(r.corpo).toBe('#1 CAP\n   ↳ sem justificativa')
  })

  it('texto de uma linha vira assunto, e o corpo repete o assunto', () => {
    const r = separarAssunto('📦 EMB390 fechou — 1 divergência')
    expect(r.assunto).toBe('📦 EMB390 fechou — 1 divergência')
    // Corpo vazio faria um e-mail em branco, que muitos clientes marcam como suspeito.
    expect(r.corpo).toBe('📦 EMB390 fechou — 1 divergência')
  })

  it('apara o assunto e troca quebras por espaço (cabeçalho não aceita \\n)', () => {
    const r = separarAssunto('  assunto com espaço  \ncorpo')
    expect(r.assunto).toBe('assunto com espaço')
    expect(r.assunto).not.toContain('\n')
  })

  it('não parte um emoji na borda do teto (par substituto inteiro ou fora)', () => {
    // 199 letras + 📦 (2 unidades UTF-16) estoura o teto de 200 por 1: o emoji sai inteiro.
    const r = separarAssunto(`${'a'.repeat(199)}📦\ncorpo`)
    expect(r.assunto).toBe('a'.repeat(199))
    expect(r.assunto).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('com \\r\\n o corpo não começa com \\r solto', () => {
    const r = separarAssunto('Assunto\r\nCorpo\r\nlinha 2')
    expect(r.assunto).toBe('Assunto')
    expect(r.corpo).toBe('Corpo\r\nlinha 2')
  })

  it('corta assunto gigante (os servidores recusam cabeçalho longo)', () => {
    const r = separarAssunto(`${'a'.repeat(500)}\ncorpo`)
    expect(r.assunto.length).toBeLessThanOrEqual(200)
  })
})

describe('lerConfigEmail', () => {
  it('devolve null sem host (canal não configurado)', () => {
    expect(lerConfigEmail({} as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it('devolve null sem remetente — um e-mail sem From é recusado', () => {
    expect(lerConfigEmail({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it('porta padrão 587 e seguro=false (STARTTLS, o que o GoTrue usa)', () => {
    const c = lerConfigEmail({
      SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_REMETENTE: 'a@b',
    } as unknown as NodeJS.ProcessEnv)
    expect(c).toEqual({ host: 'h', porta: 587, usuario: 'u', senha: 'p', remetente: 'a@b', seguro: false })
  })

  const base = { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_REMETENTE: 'a@b' }
  const env = (extra: Record<string, string>) => ({ ...base, ...extra }) as unknown as NodeJS.ProcessEnv

  it('SMTP_SEGURO=true liga o TLS direto numa porta 587', () => {
    expect(lerConfigEmail(env({ SMTP_PORT: '587', SMTP_SEGURO: 'true' }))?.seguro).toBe(true)
  })

  it('SMTP_SEGURO aceita os apelidos 1, sim e yes como verdadeiro', () => {
    for (const v of ['1', 'sim', 'YES', ' Sim ']) {
      expect(lerConfigEmail(env({ SMTP_PORT: '587', SMTP_SEGURO: v }))?.seguro).toBe(true)
    }
  })

  it('SMTP_SEGURO=false é respeitado mesmo na porta 465', () => {
    expect(lerConfigEmail(env({ SMTP_PORT: '465', SMTP_SEGURO: 'false' }))?.seguro).toBe(false)
  })

  it('SMTP_PORT em branco ou não numérica cai em 587', () => {
    expect(lerConfigEmail(env({ SMTP_PORT: '   ' }))?.porta).toBe(587)
    expect(lerConfigEmail(env({ SMTP_PORT: 'abc' }))?.porta).toBe(587)
  })

  it('porta 465 liga o seguro sozinho', () => {
    const c = lerConfigEmail({
      SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_REMETENTE: 'a@b',
    } as unknown as NodeJS.ProcessEnv)
    expect(c?.porta).toBe(465)
    expect(c?.seguro).toBe(true)
  })
})

describe('criarEmail', () => {
  it('manda assunto, corpo, destinatário e remetente', async () => {
    const enviar = vi.fn().mockResolvedValue({ messageId: '<abc@exemplo>' })
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'Assunto\nCorpo')
    expect(r).toEqual({ ok: true, mensagemExternaId: '<abc@exemplo>' })
    expect(enviar).toHaveBeenCalledWith({
      from: CFG.remetente,
      to: 'beto@x',
      subject: 'Assunto',
      text: 'Corpo',
    })
  })

  it('erro do transporte volta como falha, sem derrubar nada', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('EAUTH'))
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'A\nB')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('EAUTH')
  })

  describe('NUNCA põe a senha no erro', () => {
    // A MESMA constante vai na mensagem do erro E na configuração: se só uma das pontas a tivesse,
    // o teste passaria mesmo sem a limpeza.
    const SEGREDO = 'segredo-muito-secreto'

    it('troca a senha por *** na mensagem', async () => {
      const enviar = vi.fn().mockRejectedValue(new Error(`535 falhou com ${SEGREDO}`))
      const cli = criarEmail({ ...CFG, senha: SEGREDO }, { enviar })
      const r = await cli.enviarMensagem('beto@x', 'A\nB')
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.erro).not.toContain(SEGREDO)
        expect(r.erro).toContain('***')
      }
    })

    it('troca TODAS as ocorrências (replaceAll, não replace)', async () => {
      const enviar = vi.fn().mockRejectedValue(new Error(`${SEGREDO} recusada; eco: ${SEGREDO}`))
      const cli = criarEmail({ ...CFG, senha: SEGREDO }, { enviar })
      const r = await cli.enviarMensagem('beto@x', 'A\nB')
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.erro).not.toContain(SEGREDO)
        expect(r.erro.match(/\*\*\*/g)).toHaveLength(2)
      }
    })

    it('senha vazia não vira *** em toda fronteira de caractere', async () => {
      const enviar = vi.fn().mockRejectedValue(new Error('EAUTH'))
      const cli = criarEmail({ ...CFG, senha: '' }, { enviar })
      const r = await cli.enviarMensagem('beto@x', 'A\nB')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.erro).toBe('E-mail: EAUTH')
    })
  })

  it('endereço em branco falha antes de abrir conexão', async () => {
    const enviar = vi.fn()
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('   ', 'A\nB')
    expect(r.ok).toBe(false)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('texto em branco falha antes de abrir conexão', async () => {
    const enviar = vi.fn()
    const cli = criarEmail(CFG, { enviar })
    for (const t of ['', '   ', '\n \r\n']) {
      const r = await cli.enviarMensagem('beto@x', t)
      expect(r).toEqual({ ok: false, erro: 'E-mail: mensagem em branco.' })
    }
    expect(enviar).not.toHaveBeenCalled()
  })

  it('transporte sem messageId ainda conta como enviado', async () => {
    const enviar = vi.fn().mockResolvedValue({})
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'A\nB')
    expect(r.ok).toBe(true)
  })
})
