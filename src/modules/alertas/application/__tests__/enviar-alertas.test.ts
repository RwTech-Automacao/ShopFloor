import { describe, it, expect } from 'vitest'
import type { ContaDestino, ResultadoAvaliacaoRpc } from '../../domain/avaliacao'
import type { EnvioReservado } from '../../domain/envio'
import type { DestinoTipo, ResultadoEnvio } from '../../domain/tipos'
import type {
  FiltroReserva,
  MensagemComBotao,
  NovoEnvioDireto,
  PortaCanal,
  PortasCanais,
  RepositorioEnvios,
} from '../portas'
import {
  avaliarEEnviar,
  entregarPendentes,
  enviarTeste,
  removerBotoesDaOcorrencia,
} from '../enviar-alertas'

/** Porta de mentira: registra o que foi enviado e pode falhar (ou lançar) sob comando. */
function portaFalsa(opcoes: { falharPara?: string[]; lancarPara?: string[] } = {}) {
  const enviados: { externoId: string; destino: DestinoTipo; texto: string; botao: string | null }[] = []
  const removidos: string[] = []
  const porta: PortaCanal = {
    async enviar(destino, texto, ocorrenciaIdBotao) {
      const externoId = destino.externoId
      if (opcoes.lancarPara?.includes(externoId)) throw new Error('rede caiu')
      enviados.push({ externoId, destino: destino.tipo, texto, botao: ocorrenciaIdBotao })
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

const DADOS_ALERTA = {
  regra_nome: 'Teste abaixo de 90',
  posto: 'Teste',
  taxa: 75,
  taxa_minima: 90,
  aprovados: 15,
  reprovados: 5,
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: null,
  op: null,
  aberta_em: '2026-09-17T17:05:00Z',
  agora: '2026-09-17T17:05:00Z',
}

function linha(p: Partial<EnvioReservado> & { id: string }): EnvioReservado {
  return {
    ocorrenciaId: 'oc1',
    usuarioId: 'u1',
    destinoTipo: 'usuario',
    canal: 'telegram',
    externoId: '111',
    tipo: 'alerta',
    dados: DADOS_ALERTA,
    comBotao: true,
    tentativas: 1,
    ...p,
  }
}

/**
 * Repositório de mentira com uma FILA de verdade: `reservarPendentes` só devolve pendentes não
 * reservadas, na ordem do banco (novas antes de reenvios), e marca a reserva — como a 0113.
 */
function repoFalso(dados: {
  avaliacao?: ResultadoAvaliacaoRpc
  fila?: EnvioReservado[]
  mensagens?: MensagemComBotao[]
  conta?: ContaDestino | null
}) {
  const fila = (dados.fila ?? []).map((e) => ({ ...e, tentativas: e.tentativas - 1, reservada: false, ok: false }))
  const concluidos: { id: string; texto: string; resultado: ResultadoEnvio }[] = []
  const diretos: NovoEnvioDireto[] = []
  const reservas: FiltroReserva[] = []
  const semBotao: string[][] = []
  const repo: RepositorioEnvios = {
    async avaliar() {
      return dados.avaliacao ?? { ocupado: false, avaliadas: 0, enfileirados: 0, normalizadas: [] }
    },
    async reservarPendentes(f) {
      reservas.push(f)
      const lote = fila
        .filter((e) => !e.ok && !e.reservada && e.tentativas < 3 && f.canais.includes(e.canal))
        .filter((e) => f.ocorrenciaId === null || e.ocorrenciaId === f.ocorrenciaId)
        .sort((a, b) => Number(a.tentativas > 0) - Number(b.tentativas > 0))
        .slice(0, f.limite)
      for (const e of lote) {
        e.reservada = true
        e.tentativas += 1
      }
      return lote.map((e): EnvioReservado => ({
        id: e.id,
        ocorrenciaId: e.ocorrenciaId,
        usuarioId: e.usuarioId,
        destinoTipo: e.destinoTipo,
        canal: e.canal,
        externoId: e.externoId,
        tipo: e.tipo,
        dados: e.dados,
        comBotao: e.comBotao,
        tentativas: e.tentativas,
      }))
    },
    async concluirEnvio(envio, texto, resultado) {
      concluidos.push({ id: envio.id, texto, resultado })
      const e = fila.find((x) => x.id === envio.id)!
      e.reservada = false
      e.ok = resultado.ok
    },
    async registrarEnvioDireto(e) {
      diretos.push(e)
    },
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao(ids) {
      semBotao.push(ids)
    },
    async contaDoUsuario() {
      return dados.conta ?? null
    },
  }
  return { repo, concluidos, diretos, reservas, semBotao, fila }
}

describe('entregarPendentes', () => {
  describe('lotes', () => {
    const novas = (n: number) =>
      Array.from({ length: n }, (_, i) => linha({ id: `e${i}`, externoId: `X${i}` }))

    it('repete enquanto o lote vier cheio (30) e para no lote que não encheu', async () => {
      const tg = portaFalsa()
      const { repo, reservas, fila } = repoFalso({ fila: novas(65) })
      const r = await entregarPendentes({ telegram: tg.porta }, repo)
      expect(r).toEqual({ enviados: 65, falhas: 0 })
      expect(reservas).toHaveLength(3) // 30 + 30 + 5
      expect(fila.every((e) => e.ok)).toBe(true)
    })

    it('lote exatamente cheio faz mais uma reserva, que volta vazia', async () => {
      const tg = portaFalsa()
      const { repo, reservas } = repoFalso({ fila: novas(30) })
      expect(await entregarPendentes({ telegram: tg.porta }, repo)).toEqual({ enviados: 30, falhas: 0 })
      expect(reservas).toHaveLength(2)
    })

    it('não começa outro lote depois do orçamento de tempo', async () => {
      const tg = portaFalsa()
      const { repo, reservas } = repoFalso({ fila: novas(100) })
      let t = 0
      // cada leitura do relógio avança 25 s: início 0, fim do 1º lote 25 s (< 40), fim do 2º 50 s
      const r = await entregarPendentes({ telegram: tg.porta }, repo, {
        agora: () => {
          const v = t
          t += 25_000
          return v
        },
      })
      expect(reservas).toHaveLength(2)
      expect(r.enviados).toBe(60)
    })

    it('para quando o lote traz reenvio (as novas acabaram): não queima tentativas na mesma rodada', async () => {
      const bloqueados = Array.from({ length: 30 }, (_, i) => `X${i}`)
      const tg = portaFalsa({ falharPara: bloqueados })
      const fila = [...novas(29), linha({ id: 'reenvio', externoId: 'R', tentativas: 2 })]
      const { repo, reservas } = repoFalso({ fila })
      const r = await entregarPendentes({ telegram: tg.porta }, repo)
      expect(reservas).toHaveLength(1)
      expect(r).toEqual({ enviados: 1, falhas: 29 })
    })

    it('lote cheio em que NADA foi entregue (canal fora do ar) encerra a rodada', async () => {
      const tg = portaFalsa({ falharPara: Array.from({ length: 60 }, (_, i) => `X${i}`) })
      const { repo, reservas, fila } = repoFalso({ fila: novas(60) })
      expect(await entregarPendentes({ telegram: tg.porta }, repo)).toEqual({ enviados: 0, falhas: 30 })
      expect(reservas).toHaveLength(1)
      expect(Math.max(...fila.map((e) => e.tentativas))).toBe(1)
    })
  })

  it('entrega só o que a reserva devolveu e atualiza a PRÓPRIA linha', async () => {
    const tg = portaFalsa()
    const { repo, concluidos } = repoFalso({ fila: [linha({ id: 'e1' }), linha({ id: 'e2', externoId: '222', usuarioId: 'u2' })] })

    const r = await entregarPendentes({ telegram: tg.porta }, repo)

    expect(r).toEqual({ enviados: 2, falhas: 0 })
    expect(tg.enviados.map((e) => e.externoId)).toEqual(['111', '222'])
    expect(tg.enviados[0]!.texto).toContain('🔴 Teste abaixo da meta')
    expect(tg.enviados[0]!.botao).toBe('oc1')
    expect(concluidos).toEqual([
      { id: 'e1', texto: expect.stringContaining('🔴'), resultado: { ok: true, mensagemExternaId: '111:m1' } },
      { id: 'e2', texto: expect.stringContaining('🔴'), resultado: { ok: true, mensagemExternaId: '222:m2' } },
    ])
  })

  it('ordem: novas antes dos reenvios', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({
      fila: [
        linha({ id: 'reenvio', externoId: 'R', tentativas: 2 }),
        linha({ id: 'nova', externoId: 'N', tentativas: 1 }),
      ],
    })
    await entregarPendentes({ telegram: tg.porta }, repo)
    expect(tg.enviados.map((e) => e.externoId)).toEqual(['N', 'R'])
  })

  it('reserva só os canais configurados, com o limite do lote e sem filtro de ocorrência', async () => {
    const tg = portaFalsa()
    const { repo, reservas, concluidos } = repoFalso({
      fila: [linha({ id: 'e1' }), linha({ id: 'e2', canal: 'discord', externoId: 'D2' })],
    })
    await entregarPendentes({ telegram: tg.porta }, repo)
    expect(reservas).toEqual([{ canais: ['telegram'], limite: 30, ocorrenciaId: null }])
    expect(concluidos.map((c) => c.id)).toEqual(['e1'])
  })

  it('sem canal configurado não reserva nada', async () => {
    const { repo, reservas } = repoFalso({ fila: [linha({ id: 'e1' })] })
    expect(await entregarPendentes({}, repo)).toEqual({ enviados: 0, falhas: 0 })
    expect(reservas).toHaveLength(0)
  })

  it('filtra por ocorrência (webhook do Resolvido)', async () => {
    const tg = portaFalsa()
    const { repo, reservas } = repoFalso({
      fila: [
        linha({ id: 'e1', ocorrenciaId: 'oc1', tipo: 'resolvido', comBotao: false, dados: { posto: 'Teste', resolvida_por_nome: 'Bruno', resolvida_em: '2026-09-17T17:05:00Z' } }),
        linha({ id: 'e2', ocorrenciaId: 'oc2' }),
      ],
    })
    const r = await entregarPendentes({ telegram: tg.porta }, repo, { ocorrenciaId: 'oc1' })
    expect(reservas[0]!.ocorrenciaId).toBe('oc1')
    expect(r.enviados).toBe(1)
    expect(tg.enviados).toEqual([
      { externoId: '111', destino: 'usuario', texto: '✅ Teste: resolvido por Bruno às 14:05', botao: null },
    ])
  })

  it('falha do canal vira falha NA LINHA (que continua pendente pra próxima rodada)', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo, concluidos, fila } = repoFalso({ fila: [linha({ id: 'e1' })] })

    const r = await entregarPendentes({ telegram: tg.porta }, repo)

    expect(r).toEqual({ enviados: 0, falhas: 1 })
    expect(concluidos[0]!.resultado).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
    // próxima rodada pega de novo (tentativas 1 -> 2)
    const r2 = await entregarPendentes({ telegram: tg.porta }, repo)
    expect(r2.falhas).toBe(1)
    expect(fila[0]!.tentativas).toBe(2)
  })

  it('um item com erro (texto que não monta ou canal que lança) não derruba os outros', async () => {
    const tg = portaFalsa({ lancarPara: ['LANCA'] })
    const { repo, concluidos } = repoFalso({
      fila: [
        linha({ id: 'quebrado', dados: { ...DADOS_ALERTA, agora: 'lixo' } }),
        linha({ id: 'lanca', externoId: 'LANCA' }),
        linha({ id: 'bom', externoId: '333' }),
      ],
    })

    const r = await entregarPendentes({ telegram: tg.porta }, repo)

    expect(r).toEqual({ enviados: 1, falhas: 2 })
    expect(tg.enviados.map((e) => e.externoId)).toEqual(['333'])
    expect(concluidos.map((c) => [c.id, c.resultado.ok])).toEqual([
      ['quebrado', false],
      ['lanca', false],
      ['bom', true],
    ])
    expect(concluidos[0]!.resultado).toMatchObject({ erro: expect.stringContaining('DADOS_INVALIDOS') })
  })

  it('erro ao GRAVAR o resultado não derruba a rodada nem vira falha de envio', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ fila: [linha({ id: 'e1' }), linha({ id: 'e2', externoId: '222' })] })
    repo.concluirEnvio = async () => {
      throw new Error('alerta_envios: timeout')
    }
    const r = await entregarPendentes({ telegram: tg.porta }, repo)
    expect(r).toEqual({ enviados: 2, falhas: 0 })
    expect(tg.enviados).toHaveLength(2)
  })

  it('duas rodadas seguidas não entregam a mesma linha', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ fila: [linha({ id: 'e1' })] })
    repo.concluirEnvio = async () => {} // a 1ª rodada "ainda não gravou": a linha segue reservada
    await Promise.all([entregarPendentes({ telegram: tg.porta }, repo), entregarPendentes({ telegram: tg.porta }, repo)])
    expect(tg.enviados).toHaveLength(1)
  })
})

describe('avaliarEEnviar', () => {
  it('avalia (o banco enfileira) e entrega a fila', async () => {
    const tg = portaFalsa()
    const dc = portaFalsa()
    const portas: PortasCanais = { telegram: tg.porta, discord: dc.porta }
    const { repo } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 4, enfileirados: 2, normalizadas: [] },
      fila: [linha({ id: 'e1' }), linha({ id: 'e2', canal: 'discord', externoId: 'D2', usuarioId: 'u2' })],
    })

    const r = await avaliarEEnviar(portas, repo)

    expect(r).toEqual({ avaliadas: 4, enfileirados: 2, enviados: 2, falhas: 0, ocupado: false })
    expect(tg.enviados[0]).toMatchObject({ externoId: '111', botao: 'oc1' })
    expect(dc.enviados[0]).toMatchObject({ externoId: 'D2', botao: 'oc1' })
  })

  it('ocupado não entrega nada', async () => {
    const tg = portaFalsa()
    const { repo, reservas } = repoFalso({
      avaliacao: { ocupado: true, avaliadas: 0, enfileirados: 0, normalizadas: [] },
      fila: [linha({ id: 'e1' })],
    })

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toEqual({ avaliadas: 0, enfileirados: 0, enviados: 0, falhas: 0, ocupado: true })
    expect(reservas).toHaveLength(0)
    expect(tg.enviados).toHaveLength(0)
  })

  it('normalizadas: normalizou vai sem botão e os botões antigos saem', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, enfileirados: 1, normalizadas: ['oc1'] },
      fila: [linha({ id: 'e1', tipo: 'normalizou', comBotao: false })],
      mensagens: [{ envioId: 'e0', canal: 'telegram', mensagemExternaId: '111:9' }],
    })

    await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(tg.enviados[0]!.botao).toBeNull()
    expect(tg.enviados[0]!.texto).toContain('🟢 Teste normalizou')
    expect(tg.removidos).toEqual(['111:9'])
    expect(semBotao).toEqual([['e0']])
  })

  it('reserva que explode não derruba a rodada (a fila fica pra próxima)', async () => {
    const tg = portaFalsa()
    const { repo, semBotao } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 1, enfileirados: 1, normalizadas: ['oc9'] },
      mensagens: [{ envioId: 'e0', canal: 'telegram', mensagemExternaId: '111:9' }],
    })
    repo.reservarPendentes = async () => {
      throw new Error('alerta_reservar_envios: timeout')
    }

    const r = await avaliarEEnviar({ telegram: tg.porta }, repo)

    expect(r).toEqual({ avaliadas: 1, enfileirados: 1, enviados: 0, falhas: 0, ocupado: false })
    expect(semBotao).toEqual([['e0']])
  })

  it('limpeza de botões que explode não impede a próxima', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({
      avaliacao: { ocupado: false, avaliadas: 2, enfileirados: 0, normalizadas: ['oc1', 'oc2'] },
    })
    const vistas: string[] = []
    repo.mensagensComBotao = async (id) => {
      vistas.push(id)
      if (id === 'oc1') throw new Error('alerta_envios: timeout')
      return []
    }
    await avaliarEEnviar({ telegram: tg.porta }, repo)
    expect(vistas).toEqual(['oc1', 'oc2'])
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

describe('enviarTeste (entrega direta, fora da fila)', () => {
  it('manda a mensagem de teste pela conta vinculada e grava a linha já final', async () => {
    const tg = portaFalsa()
    const { repo, diretos, reservas } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })

    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana Gestora' })

    expect(r).toEqual({ ok: true })
    expect(tg.enviados[0]!.texto).toContain('Ana Gestora')
    expect(diretos[0]).toMatchObject({ tipo: 'teste', usuarioId: 'u1', dados: { nome: 'Ana Gestora' } })
    expect(reservas).toHaveLength(0)
  })

  it('canal não configurado avisa sem chamar a API', async () => {
    const { repo, diretos } = repoFalso({ conta: { usuarioId: 'u1', canal: 'discord', externoId: 'D1' } })
    const r = await enviarTeste({}, repo, { usuarioId: 'u1', canal: 'discord', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Discord não está configurado neste ambiente.' })
    expect(diretos).toHaveLength(0)
  })

  it('sem vínculo avisa pra vincular primeiro', async () => {
    const tg = portaFalsa()
    const { repo } = repoFalso({ conta: null })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Vincule o Telegram antes de enviar o teste.' })
  })

  it('falha do canal volta como erro', async () => {
    const tg = portaFalsa({ falharPara: ['111'] })
    const { repo, diretos } = repoFalso({ conta: { usuarioId: 'u1', canal: 'telegram', externoId: '111' } })
    const r = await enviarTeste({ telegram: tg.porta }, repo, { usuarioId: 'u1', canal: 'telegram', nome: 'Ana' })
    expect(r).toEqual({ ok: false, erro: 'Canal 403: bloqueado' })
    expect(diretos[0]!.resultado.ok).toBe(false)
  })
})
