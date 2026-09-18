import { describe, it, expect } from 'vitest'
import type { TelegramClient } from '../../infra/telegram'
import type { EnvioReservado } from '../../domain/envio'
import type { FiltroReserva, MensagemComBotao, RepositorioEnvios, RepositorioVinculo } from '../portas'
import { tratarUpdateTelegram } from '../webhook-telegram'

function telegramFalso() {
  const enviadas: { chatId: string; texto: string; botao: string | null }[] = []
  const editadas: { id: string; texto: string }[] = []
  const semBotao: string[] = []
  const callbacks: { id: string; texto: string }[] = []
  const telegram: TelegramClient = {
    async enviarMensagem(chatId, texto, botao) {
      enviadas.push({ chatId, texto, botao })
      return { ok: true, mensagemExternaId: `${chatId}:1` }
    },
    async editarTexto(id, texto) {
      editadas.push({ id, texto })
      return { ok: true }
    },
    async removerBotoes(id) {
      semBotao.push(id)
      return { ok: true }
    },
    async responderCallback(id, texto) {
      callbacks.push({ id, texto })
      return { ok: true }
    },
  }
  return { telegram, enviadas, editadas, semBotao, callbacks }
}

function repoFalso(dados: {
  vinculo?: { ok: true; nome: string } | { ok: false; erro: string }
  usuario?: string | null
  resolver?: Awaited<ReturnType<RepositorioVinculo['resolver']>>
  mensagens?: MensagemComBotao[]
  /** O que o banco pôs na fila (o alerta_resolver enfileira o "resolvido por" dos OUTROS). */
  fila?: EnvioReservado[]
}) {
  const vinculos: { codigo: string; canal: string; externoId: string }[] = []
  const reservas: FiltroReserva[] = []
  const concluidos: { id: string; ok: boolean }[] = []
  let fila = dados.fila ?? []
  const repo: RepositorioEnvios & RepositorioVinculo = {
    async avaliar() {
      return { ocupado: false, avaliadas: 0, enfileirados: 0, normalizadas: [] }
    },
    async reservarPendentes(f) {
      reservas.push(f)
      const lote = fila.filter((e) => f.ocorrenciaId === null || e.ocorrenciaId === f.ocorrenciaId)
      fila = fila.filter((e) => !lote.includes(e))
      return lote
    },
    async concluirEnvio(envio, _texto, resultado) {
      concluidos.push({ id: envio.id, ok: resultado.ok })
    },
    async registrarEnvioDireto() {},
    async mensagensComBotao() {
      return dados.mensagens ?? []
    },
    async marcarSemBotao() {},
    async contaDoUsuario() {
      return null
    },
    async vincular(codigo, canal, externoId) {
      vinculos.push({ codigo, canal, externoId })
      return dados.vinculo ?? { ok: true, nome: 'Ana Gestora' }
    },
    async usuarioPorConta() {
      return dados.usuario ?? null
    },
    async resolver() {
      return (
        dados.resolver ?? {
          ok: true,
          resolucao: {
            ocorrenciaId: 'oc1',
            regraId: 'r1',
            posto: 'Teste',
            jaResolvida: false,
            resolvidaPorId: 'u2',
            resolvidaPorNome: 'Bruno Líder',
            resolvidaEm: new Date('2026-09-17T17:05:00Z'),
          },
        }
      )
    },
  }
  return { repo, vinculos, reservas, concluidos }
}

const OC = '11111111-2222-3333-4444-555555555555'

/** Linha "resolvido por" que o alerta_resolver deixou na fila para outro destinatário. */
function linhaResolvido(
  id: string,
  usuarioId: string,
  externoId: string,
  canal: 'telegram' | 'discord' = 'telegram',
): EnvioReservado {
  return {
    id,
    ocorrenciaId: OC,
    usuarioId,
    canal,
    externoId,
    tipo: 'resolvido',
    dados: { posto: 'Teste', resolvida_por_nome: 'Bruno Líder', resolvida_em: '2026-09-17T17:05:00Z' },
    comBotao: false,
    tentativas: 1,
  }
}

describe('tratarUpdateTelegram — mensagens', () => {
  it('mensagem com código vincula e confirma', async () => {
    const tg = telegramFalso()
    const { repo, vinculos } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: 'alerta-7k3m' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(vinculos).toEqual([{ codigo: 'ALERTA-7K3M', canal: 'telegram', externoId: '111' }])
    expect(tg.enviadas).toEqual([
      { chatId: '111', texto: '✅ Conta vinculada ao ShopFloor (Ana Gestora)', botao: null },
    ])
  })

  it('erro de vínculo volta em português', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ vinculo: { ok: false, erro: 'Código expirado. Gere um novo em Meu perfil.' } })
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: 'ALERTA-7K3M' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.enviadas[0]!.texto).toBe('Código expirado. Gere um novo em Meu perfil.')
  })

  it('/start sem código responde as instruções', async () => {
    const tg = telegramFalso()
    const { repo, vinculos } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: 111, type: 'private' }, text: '/start' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(vinculos).toHaveLength(0)
    expect(tg.enviadas[0]!.texto).toContain('Meu perfil')
  })

  it('mensagem de grupo é ignorada', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram(
      { message: { chat: { id: -55, type: 'group' }, text: 'ALERTA-7K3M' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.enviadas).toHaveLength(0)
  })

  it('update desconhecido não faz nada', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram({ edited_message: {} }, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.enviadas).toHaveLength(0)
  })
})

describe('tratarUpdateTelegram — botão Resolvido', () => {
  const callback = {
    callback_query: {
      id: 'cb1',
      from: { id: 222 },
      data: `r:${OC}`,
      message: { chat: { id: 222 }, message_id: 9, text: '🔴 Teste abaixo da meta' },
    },
  }

  it('resolve, edita a mensagem, tira os botões e avisa os outros', async () => {
    const tg = telegramFalso()
    const enviadosPorta: string[] = []
    // u2 resolveu: na fila só está o aviso do u1 (quem resolveu não recebe)
    const { repo, reservas, concluidos } = repoFalso({
      usuario: 'u2',
      mensagens: [{ envioId: 'e1', canal: 'telegram', mensagemExternaId: '111:5' }],
      fila: [linhaResolvido('res-u1', 'u1', '111')],
    })
    const portas = {
      telegram: {
        async enviar(externoId: string) {
          enviadosPorta.push(externoId)
          return { ok: true as const, mensagemExternaId: `${externoId}:2` }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }

    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas, repo })

    expect(tg.callbacks).toEqual([{ id: 'cb1', texto: 'Marcado como resolvido.' }])
    expect(tg.editadas[0]).toEqual({
      id: '222:9',
      texto: '🔴 Teste abaixo da meta\n\n✅ Teste: resolvido por Bruno Líder às 14:05',
    })
    // entrega o aviso que o banco enfileirou, só desta ocorrência
    expect(reservas).toEqual([{ canais: ['telegram'], limite: 30, ocorrenciaId: OC }])
    expect(enviadosPorta).toEqual(['111'])
    expect(concluidos).toEqual([{ id: 'res-u1', ok: true }])
  })

  it('conta não vinculada só responde o callback', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ usuario: null })
    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.callbacks[0]!.texto).toContain('não está vinculada')
    expect(tg.editadas).toHaveLength(0)
  })

  it('quem não é destinatário recebe a recusa', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({
      usuario: 'u3',
      resolver: { ok: false, codigo: 'NAO_DESTINATARIO', erro: 'Você não é destinatário desta regra ou não administra o ShopFloor.' },
    })
    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo })
    expect(tg.callbacks[0]!.texto).toBe('Você não é destinatário desta regra ou não administra o ShopFloor.')
    expect(tg.editadas).toHaveLength(0)
  })

  it('já resolvido antes não avisa de novo, mas confirma quem resolveu', async () => {
    const tg = telegramFalso()
    const enviadosPorta: string[] = []
    const { repo } = repoFalso({
      usuario: 'u1',
      resolver: {
        ok: true,
        resolucao: {
          ocorrenciaId: 'oc1',
          regraId: 'r1',
          posto: 'Teste',
          jaResolvida: true,
          resolvidaPorId: 'u2',
          resolvidaPorNome: 'Bruno Líder',
          resolvidaEm: new Date('2026-09-17T17:05:00Z'),
        },
      },
      fila: [linhaResolvido('res-u1', 'u1', '111')],
    })
    const portas = {
      telegram: {
        async enviar(externoId: string) {
          enviadosPorta.push(externoId)
          return { ok: true as const, mensagemExternaId: 'x:1' }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }

    await tratarUpdateTelegram(callback, { telegram: tg.telegram, portas, repo })

    expect(tg.callbacks[0]!.texto).toBe('Já resolvido por Bruno Líder.')
    expect(enviadosPorta).toHaveLength(0)
  })

  it('banco caiu ao resolver: o callback é respondido mesmo assim (o botão não fica girando)', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ usuario: 'u2' })
    repo.resolver = async () => {
      throw new Error('connection refused')
    }
    await expect(
      tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo }),
    ).rejects.toThrow('connection refused')
    expect(tg.callbacks).toEqual([{ id: 'cb1', texto: 'Não foi possível concluir agora.' }])
    expect(tg.editadas).toHaveLength(0)
  })

  it('banco caiu ao achar a conta: o callback também é respondido', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    repo.usuarioPorConta = async () => {
      throw new Error('alerta_contas: timeout')
    }
    await expect(
      tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo }),
    ).rejects.toThrow('timeout')
    expect(tg.callbacks).toEqual([{ id: 'cb1', texto: 'Não foi possível concluir agora.' }])
  })

  it('erro DEPOIS de responder não responde de novo', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({ usuario: 'u2' })
    tg.telegram.editarTexto = async () => {
      throw new Error('telegram fora')
    }
    await expect(
      tratarUpdateTelegram(callback, { telegram: tg.telegram, portas: {}, repo }),
    ).rejects.toThrow('telegram fora')
    expect(tg.callbacks).toEqual([{ id: 'cb1', texto: 'Marcado como resolvido.' }])
  })

  it('callback com data desconhecida avisa e para', async () => {
    const tg = telegramFalso()
    const { repo } = repoFalso({})
    await tratarUpdateTelegram(
      { callback_query: { id: 'cb1', from: { id: 222 }, data: 'x:1' } },
      { telegram: tg.telegram, portas: {}, repo },
    )
    expect(tg.callbacks[0]!.texto).toBe('Ação desconhecida.')
  })
})
