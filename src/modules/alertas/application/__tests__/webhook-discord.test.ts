import { describe, it, expect } from 'vitest'
import type { EnvioReservado } from '../../domain/envio'
import type { DestinoEnvio } from '../../domain/tipos'
import type { FiltroReserva, MensagemComBotao, RepositorioEnvios, RepositorioVinculo } from '../portas'
import { tratarInteracaoDiscord } from '../webhook-discord'

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
  const removidos: string[] = []
  const resolucoes: { ocorrenciaId: string; usuarioId: string; explicacao: string | undefined }[] = []
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
    async marcarSemBotao(ids) {
      removidos.push(...ids)
    },
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
    async resolver(ocorrenciaId, usuarioId, explicacao) {
      resolucoes.push({ ocorrenciaId, usuarioId, explicacao })
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
  return { repo, vinculos, reservas, concluidos, removidos, resolucoes }
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
    destinoTipo: 'usuario',
    canal,
    externoId,
    tipo: 'resolvido',
    dados: { posto: 'Teste', resolvida_por_nome: 'Bruno Líder', resolvida_em: '2026-09-17T17:05:00Z' },
    comBotao: false,
    tentativas: 1,
  }
}

describe('tratarInteracaoDiscord', () => {
  it('PING responde PONG sem tocar no banco', async () => {
    const { repo } = repoFalso({})
    const r = await tratarInteracaoDiscord({ type: 1 }, { portas: {}, repo })
    expect(r.corpo).toEqual({ type: 1 })
    expect(r.depois).toBeNull()
  })

  it('/vincular no servidor usa member.user.id e responde efêmero', async () => {
    const { repo, vinculos } = repoFalso({})
    const r = await tratarInteracaoDiscord(
      {
        type: 2,
        member: { user: { id: 'D9' } },
        data: { name: 'vincular', options: [{ name: 'codigo', value: 'alerta-7k3m' }] },
      },
      { portas: {}, repo },
    )
    expect(vinculos).toEqual([{ codigo: 'ALERTA-7K3M', canal: 'discord', externoId: 'D9' }])
    expect(r.corpo).toEqual({
      type: 4,
      data: { content: '✅ Conta vinculada ao ShopFloor (Ana Gestora)', flags: 64 },
    })
  })

  it('/vincular sem código válido explica o formato', async () => {
    const { repo, vinculos } = repoFalso({})
    const r = await tratarInteracaoDiscord(
      { type: 2, user: { id: 'D9' }, data: { name: 'vincular', options: [{ name: 'codigo', value: 'oi' }] } },
      { portas: {}, repo },
    )
    expect(vinculos).toHaveLength(0)
    expect(String((r.corpo.data as { content: string }).content)).toContain('ALERTA-')
  })

  it('clique no botão abre o modal (type 9) e NÃO resolve nada ainda', async () => {
    const { repo, resolucoes } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` }, message: { content: '🔴 Teste' } },
      { portas: {}, repo },
    )
    expect(resolucoes).toHaveLength(0)
    expect(r.depois).toBeNull()
    expect(r.corpo.type).toBe(9)
    // o modal não aceita flags nem conteúdo — só custom_id, title e components
    expect(Object.keys(r.corpo.data as object).sort()).toEqual(['components', 'custom_id', 'title'])
    const data = r.corpo.data as {
      custom_id: string
      title: string
      components: { type: number; components: Record<string, unknown>[] }[]
    }
    // o id da ocorrência atravessa pelo custom_id do modal
    expect(data.custom_id).toBe(`r:${OC}`)
    expect(data.title.length).toBeLessThanOrEqual(45)
    const campo = data.components[0]!.components[0]!
    expect(campo).toMatchObject({ type: 4, style: 2, required: false, max_length: 500 })
    expect(String(campo.label).length).toBeLessThanOrEqual(45)
  })

  function envioModal(valor: unknown, extra: Record<string, unknown> = {}) {
    return {
      type: 5,
      user: { id: 'D2' },
      data: {
        custom_id: `r:${OC}`,
        components: [{ type: 1, components: [{ type: 4, custom_id: 'explicacao', value: valor }] }],
      },
      message: { content: '🔴 Teste abaixo da meta' },
      ...extra,
    }
  }

  function portasDiscord(enviados: string[]) {
    return {
      discord: {
        async enviar(destino: DestinoEnvio) {
          enviados.push(destino.externoId)
          return { ok: true as const, mensagemExternaId: `${destino.externoId}:1` }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }
  }

  it('envio do modal resolve COM o texto digitado, edita a mensagem (type 7) e agenda o resto', async () => {
    const { repo, concluidos, resolucoes } = repoFalso({
      usuario: 'u2',
      fila: [linhaResolvido('res-u1', 'u1', 'D1', 'discord')],
    })
    const enviados: string[] = []
    const r = await tratarInteracaoDiscord(envioModal('Trocamos o feeder'), {
      portas: portasDiscord(enviados),
      repo,
    })

    expect(resolucoes).toEqual([{ ocorrenciaId: OC, usuarioId: 'u2', explicacao: 'Trocamos o feeder' }])
    expect(r.corpo).toEqual({
      type: 7,
      data: {
        content:
          '🔴 Teste abaixo da meta\n\n✅ Teste: resolvido por Bruno Líder às 14:05\nO que foi feito: Trocamos o feeder',
        components: [],
        allowed_mentions: { parse: [] },
      },
    })
    expect(r.depois).not.toBeNull()

    await r.depois!()
    expect(enviados).toEqual(['D1'])
    expect(concluidos).toEqual([{ id: 'res-u1', ok: true }])
  })

  it('envio do modal VAZIO (ou só espaços) resolve igual: a explicação é opcional', async () => {
    for (const valor of ['', '   ', undefined]) {
      const { repo, resolucoes } = repoFalso({ usuario: 'u2' })
      const r = await tratarInteracaoDiscord(envioModal(valor), { portas: {}, repo })
      expect(resolucoes).toHaveLength(1)
      // vazio chega como vazio — nunca como "texto"
      expect(resolucoes[0]!.explicacao ?? '').toBe('')
      expect(r.corpo.type).toBe(7)
    }
  })

  it('a edição (tipo 7) não notifica ninguém: allowed_mentions vazio, mesmo com @everyone na explicação', async () => {
    const { repo } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(envioModal('@everyone <@123> trocou o feeder'), { portas: {}, repo })
    expect(r.corpo.type).toBe(7)
    expect((r.corpo as { data: Record<string, unknown> }).data.allowed_mentions).toEqual({ parse: [] })
  })

  it('envio do modal sem o campo no payload também resolve', async () => {
    const { repo, resolucoes } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(
      { type: 5, user: { id: 'D2' }, data: { custom_id: `r:${OC}`, components: [] } },
      { portas: {}, repo },
    )
    expect(resolucoes).toHaveLength(1)
    expect(r.corpo.type).toBe(7)
  })

  it('explicação passando do limite é cortada no servidor (defesa além do max_length do modal)', async () => {
    const { repo, resolucoes } = repoFalso({ usuario: 'u2' })
    await tratarInteracaoDiscord(envioModal('x'.repeat(5000)), { portas: {}, repo })
    expect(resolucoes[0]!.explicacao).toHaveLength(500)
  })

  it('a mensagem editada nunca passa de 2000 caracteres, e a linha "resolvido por" sobrevive', async () => {
    const { repo } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(
      envioModal('ok', { message: { content: 'A'.repeat(1990) } }),
      { portas: {}, repo },
    )
    const content = String((r.corpo.data as { content: string }).content)
    expect(content.length).toBeLessThanOrEqual(2000)
    expect(content).toContain('resolvido por Bruno Líder')
  })

  it('com 500 caracteres de explicação e mensagem original grande, a edição cabe e a explicação sobrevive', async () => {
    const { repo } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(
      envioModal('y'.repeat(500), { message: { content: 'A'.repeat(1990) } }),
      { portas: {}, repo },
    )
    const content = String((r.corpo.data as { content: string }).content)
    expect(content.length).toBeLessThanOrEqual(2000)
    expect(content.endsWith('y'.repeat(500))).toBe(true)
  })

  it('sem explicação a mensagem editada não tem rabo ("O que foi feito" não aparece)', async () => {
    const { repo } = repoFalso({ usuario: 'u2' })
    const r = await tratarInteracaoDiscord(envioModal('  '), { portas: {}, repo })
    const content = String((r.corpo.data as { content: string }).content)
    expect(content).not.toContain('O que foi feito')
  })

  it('já resolvida por outra pessoa: não atribui a ela o texto digitado agora', async () => {
    const { repo } = repoFalso({
      usuario: 'u2',
      resolver: {
        ok: true,
        resolucao: {
          ocorrenciaId: 'oc1', regraId: 'r1', posto: 'Teste', jaResolvida: true,
          resolvidaPorId: 'u9', resolvidaPorNome: 'Carla', resolvidaEm: new Date('2026-09-17T17:05:00Z'),
        },
      },
    })
    const r = await tratarInteracaoDiscord(envioModal('meu texto'), { portas: {}, repo })
    const content = String((r.corpo.data as { content: string }).content)
    expect(content).toContain('resolvido por Carla')
    expect(content).not.toContain('meu texto')
  })

  it('botão de quem não vinculou responde efêmero e NÃO abre o modal', async () => {
    const { repo, resolucoes } = repoFalso({ usuario: null })
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` } },
      { portas: {}, repo },
    )
    expect(r.corpo.type).toBe(4)
    expect(String((r.corpo.data as { content: string }).content)).toContain('não está vinculada')
    expect(r.depois).toBeNull()
    expect(resolucoes).toHaveLength(0)
  })

  it('envio do modal de quem não vinculou responde efêmero e não resolve', async () => {
    const { repo, resolucoes } = repoFalso({ usuario: null })
    const r = await tratarInteracaoDiscord(envioModal('texto'), { portas: {}, repo })
    expect(r.corpo.type).toBe(4)
    expect(String((r.corpo.data as { content: string }).content)).toContain('não está vinculada')
    expect(r.depois).toBeNull()
    expect(resolucoes).toHaveLength(0)
  })

  it('ocorrência já normalizada (no envio do modal) avisa e agenda a limpeza dos botões', async () => {
    const { repo } = repoFalso({
      usuario: 'u2',
      resolver: { ok: false, codigo: 'OCORRENCIA_ENCERRADA', erro: 'Esta ocorrência já normalizou.' },
      mensagens: [{ envioId: 'e1', canal: 'discord', mensagemExternaId: 'C9:M7' }],
    })
    const r = await tratarInteracaoDiscord(envioModal('texto'), { portas: portasDiscord([]), repo })
    expect((r.corpo.data as { content: string }).content).toBe('Esta ocorrência já normalizou.')
    expect(r.depois).not.toBeNull()
    await r.depois!()
  })

  it('tipo de interação desconhecido responde efêmero', async () => {
    const { repo } = repoFalso({})
    const r = await tratarInteracaoDiscord({ type: 99 }, { portas: {}, repo })
    expect(r.corpo).toMatchObject({ type: 4 })
  })
})
