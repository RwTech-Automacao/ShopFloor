import { describe, it, expect } from 'vitest'
import type { AcaoAvaliacao, ContaDestino, ResultadoAvaliacaoRpc } from '../../domain/avaliacao'
import type {
  EnvioPendente,
  MensagemComBotao,
  NovoEnvio,
  PortaCanal,
  PortasCanais,
  RepositorioEnvios,
} from '../portas'
import {
  avaliarEEnviar,
  avisarResolvido,
  enviarTeste,
  reenviarFalhas,
  removerBotoesDaOcorrencia,
} from '../enviar-alertas'

/** Porta de mentira: registra o que foi enviado e pode falhar sob comando. */
function portaFalsa(opcoes: { falharPara?: string[] } = {}) {
  const enviados: { externoId: string; texto: string; botao: string | null }[] = []
  const removidos: string[] = []
  const porta: PortaCanal = {
    async enviar(externoId, texto, ocorrenciaIdBotao) {
      enviados.push({ externoId, texto, botao: ocorrenciaIdBotao })
      if (opcoes.falharPara?.includes(externoId)) return { ok: false, erro: 'Canal 403: bloqueado' }
      return { ok: true, mensagemExternaId: `${externoId}:m${enviados.length}` }
    },
    async removerBotoes(mensagemExternaId) {
      removidos.push(mensagemExternaId)
      return { ok: true }
    },
  }
  return { porta, enviados, removidos }
}

function repoFalso(dados: {
  avaliacao?: ResultadoAvaliacaoRpc
  pendentes?: EnvioPendente[]
  mensagens?: MensagemComBotao[]
  contas?: ContaDestino[]
  conta?: ContaDestino | null
}) {
  const gravados: NovoEnvio[] = []
  const reenviados: { envio: EnvioPendente; ok: boolean }[] = []
  const semBotao: string[][] = []
  const repo: RepositorioEnvios = {
    async avaliar() {
      return dados.avaliacao ?? { ocupado: false, avaliadas: 0, acoes: [] }
    },
    async registrarEnvio(e) {
      gravados.push(e)
    },
    async envioParaReenviar() {
      return dados.pendentes ?? []
    },
    async registrarReenvio(envio, resultado) {
      reenviados.push({ envio, ok: resultado.ok })
    },
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao(ids) {
      semBotao.push(ids)
    },
    async contasDaOcorrencia() {
      return dados.contas ?? []
    },
    async contaDoUsuario() {
      return dados.conta ?? null
    },
  }
  return { repo, gravados, reenviados, semBotao }
}

const ACAO: AcaoAvaliacao = {
  ocorrenciaId: 'oc1',
  tipo: 'alerta',
  regraId: 'r1',
  regraNome: 'Teste abaixo de 90',
  posto: 'Teste',
  taxa: 75,
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janelaTipo: 'tempo',
  janelaValor: 60,
  pmo: null,
  op: null,
  abertaEm: '2026-09-17T17:05:00Z',
  agora: '2026-09-17T17:05:00Z',
  contas: [
    { usuarioId: 'u1', canal: 'telegram', externoId: '111' },
    { usuarioId: 'u2', canal: 'discord', externoId: 'D2' },
  ],
}

describe('avaliarEEnviar', () => {
  it('envia a ação para cada conta, com botão, e grava os envios', async () => {
    const tg = portaFalsa()
    const dc = portaFalsa()
    const portas: PortasCanais = { telegram: tg.porta, discord: dc.porta }
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 4, acoes: [ACAO] } })

    const r = await avaliarEEnviar(portas, repo)

    expect(r).toEqual({ avaliadas: 4, enviados: 2, falhas: 0, ocupado: false })
    expect(tg.enviados).toEqual([
      { externoId: '111', texto: expect.stringContaining('🔴 Teste abaixo da meta'), botao: 'oc1' },
    ])
    expect(dc.enviados[0]!.botao).toBe('oc1')
    expect(gravados).toHaveLength(2)
    expect(gravados[0]).toMatchObject({ ocorrenciaId: 'oc1', usuarioId: 'u1', canal: 'telegram', tipo: 'alerta', comBotao: true })
  })

  it('canal sem token configurado é pulado (nem envio, nem registro)', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 1, acoes: [ACAO] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r.enviados).toBe(1)
    expect(gravados).toHaveLength(1)
    expect(gravados[0]!.canal).toBe('telegram')
  })

  it('falha de envio entra no resumo e é gravada como falha', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 1, acoes: [ACAO] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toMatchObject({ enviados: 0, falhas: 1 })
    expect(gravados[0]!.resultado).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
  })

  it('ocupado não envia nada', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ avaliacao: { ocupado: true, avaliadas: 0, acoes: [] } })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toEqual({ avaliadas: 0, enviados: 0, falhas: 0, ocupado: true })
    expect(tg.enviados).toHaveLength(0)
    expect(gravados).toHaveLength(0)
  })

  it('ação de normalizou vai sem botão e limpa os botões das mensagens antigas', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, acoes: [{ ...ACAO, tipo: 'normalizou' }] },
      mensagens: [{ envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:9' }],
    })

    await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(tg.enviados[0]!.botao).toBeNull()
    expect(tg.removidos).toEqual(['111:9'])
    expect(semBotao).toEqual([['e1']])
  })

  it('reenvia as falhas anteriores antes das ações novas', async () => {
    const tg = portaFalsa()
    const { repo, reenviados } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, acoes: [] },
      pendentes: [
        { id: 'e9', ocorrenciaId: 'oc9', canal: 'telegram', externoId: '111', texto: 'antigo', comBotao: true, tentativas: 1 },
      ],
    })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(tg.enviados).toEqual([{ externoId: '111', texto: 'antigo', botao: 'oc9' }])
    expect(reenviados).toEqual([{ envio: expect.objectContaining({ id: 'e9' }), ok: true }])
    expect(r.enviados).toBe(1)
  })
})

describe('avaliarEEnviar — tropeços depois da avaliação gravada', () => {
  it('reenvio que explode não impede as ações desta rodada', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ avaliacao: { ocupado: false, avaliadas: 1, acoes: [ACAO] } })
    repo.envioParaReenviar = async () => {
      throw new Error('alerta_envios: timeout')
    }

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toMatchObject({ enviados: 1, falhas: 0 })
    expect(tg.enviados).toHaveLength(1)
  })

  it('limpeza de botões que explode não impede a próxima ação', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({
      avaliacao: {
        ocupado: false,
        avaliadas: 2,
        acoes: [{ ...ACAO, tipo: 'normalizou' }, { ...ACAO, ocorrenciaId: 'oc2' }],
      },
    })
    repo.mensagensComBotao = async () => {
      throw new Error('alerta_envios: timeout')
    }

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r.enviados).toBe(2)
    expect(tg.enviados.map((e) => e.botao)).toEqual([null, 'oc2'])
  })
})

describe('reenviarFalhas', () => {
  it('pula pendência de canal não configurado', async () => {
    const { repo, reenviados } = repoFalso({
      pendentes: [
        { id: 'e1', ocorrenciaId: 'oc1', canal: 'discord', externoId: 'D2', texto: 'x', comBotao: false, tentativas: 2 },
      ],
    })
    const r = await reenviarFalhas({}, repo)
    expect(r).toEqual({ enviados: 0, falhas: 0 })
    expect(reenviados).toHaveLength(0)
  })
})

describe('removerBotoesDaOcorrencia', () => {
  it('só marca como sem botão o que o canal conseguiu editar', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      mensagens: [
        { envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:9' },
        { envioId: 'e2', canal: 'discord', mensagemExternaId: 'C9:M7' },
      ],
    })
    await removerBotoesDaOcorrencia({ telegram: tg.porta }, repo, 'oc1')
    expect(tg.removidos).toEqual(['111:9'])
    expect(semBotao).toEqual([['e1']])
  })
})

describe('avisarResolvido', () => {
  it('avisa todos os destinatários MENOS quem resolveu', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({
      contas: [
        { usuarioId: 'u1', canal: 'telegram', externoId: '111' },
        { usuarioId: 'u2', canal: 'telegram', externoId: '222' },
      ],
    })

    const r = await avisarResolvido({ telegram: tg.porta }, repo, {
      ocorrenciaId: 'oc1',
      posto: 'Teste',
      resolvidoPorId: 'u2',
      resolvidoPorNome: 'Bruno Líder',
      resolvidaEm: new Date('2026-09-17T17:05:00Z'),
    })

    expect(r).toEqual({ enviados: 1, falhas: 0 })
    expect(tg.enviados).toEqual([
      { externoId: '111', texto: '✅ Teste: resolvido por Bruno Líder às 14:05', botao: null },
    ])
    expect(gravados[0]).toMatchObject({ tipo: 'resolvido', comBotao: false })
  })
})

describe('enviarTeste', () => {
  it('manda a mensagem de teste pela conta vinculada', async () => {
    const tg = portaFalsa()
    const { repo, gravados } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })

    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana Gestora' })

    expect(r).toEqual({ ok: true })
    expect(tg.enviados[0]!.texto).toContain('Ana Gestora')
    expect(gravados[0]).toMatchObject({ tipo: 'teste', ocorrenciaId: null, comBotao: false })
  })

  it('canal não configurado avisa sem chamar a API', async () => {
    const { repo, gravados } = repoFalso({ conta: { usuarioId: 'u1', canal: 'discord', externoId: 'D1' } })
    const r = await enviarTeste({}, repo, { usuarioId: 'u1', canal: 'discord', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Discord não está configurado neste ambiente.' })
    expect(gravados).toHaveLength(0)
  })

  it('sem vínculo avisa pra vincular primeiro', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ conta: null })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Vincule o Telegram antes de enviar o teste.' })
  })

  it('falha do canal volta como erro', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
  })
})
