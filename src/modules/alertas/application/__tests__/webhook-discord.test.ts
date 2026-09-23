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
  return { repo, vinculos, reservas, concluidos, removidos }
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

  it('botão resolve: atualiza a mensagem (type 7, sem componentes) e agenda o resto', async () => {
    const { repo, concluidos } = repoFalso({
      usuario: 'u2',
      fila: [linhaResolvido('res-u1', 'u1', 'D1', 'discord')],
    })
    const enviados: string[] = []
    const portas = {
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

    const r = await tratarInteracaoDiscord(
      {
        type: 3,
        user: { id: 'D2' },
        data: { custom_id: `r:${OC}` },
        message: { content: '🔴 Teste abaixo da meta' },
      },
      { portas, repo },
    )

    expect(r.corpo).toEqual({
      type: 7,
      data: {
        content: '🔴 Teste abaixo da meta\n\n✅ Teste: resolvido por Bruno Líder às 14:05',
        components: [],
      },
    })
    expect(r.depois).not.toBeNull()

    await r.depois!()
    expect(enviados).toEqual(['D1'])
    expect(concluidos).toEqual([{ id: 'res-u1', ok: true }])
  })

  it('botão de quem não vinculou responde efêmero', async () => {
    const { repo } = repoFalso({ usuario: null })
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` } },
      { portas: {}, repo },
    )
    expect(String((r.corpo.data as { content: string }).content)).toContain('não está vinculada')
    expect(r.depois).toBeNull()
  })

  it('ocorrência já normalizada avisa e agenda a limpeza dos botões', async () => {
    const { repo } = repoFalso({
      usuario: 'u2',
      resolver: { ok: false, codigo: 'OCORRENCIA_ENCERRADA', erro: 'Esta ocorrência já normalizou.' },
      mensagens: [{ envioId: 'e1', canal: 'discord', mensagemExternaId: 'C9:M7' }],
    })
    const portas = {
      discord: {
        async enviar() {
          return { ok: true as const, mensagemExternaId: 'x:1' }
        },
        async removerBotoes() {
          return { ok: true as const }
        },
      },
    }
    const r = await tratarInteracaoDiscord(
      { type: 3, user: { id: 'D2' }, data: { custom_id: `r:${OC}` } },
      { portas, repo },
    )
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
