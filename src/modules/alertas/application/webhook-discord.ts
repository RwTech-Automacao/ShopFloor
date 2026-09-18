import { extrairCodigoVinculo, lerCallbackResolver } from '../domain/codigos'
import { textoResolvido, textoVinculado } from '../domain/mensagens'
import { entregarPendentes, removerBotoesDaOcorrencia } from './enviar-alertas'
import type { DependenciasWebhook } from './portas'

/** Tipos de interação e de resposta do Discord (API v10). */
const INTERACAO_PING = 1
const INTERACAO_COMANDO = 2
const INTERACAO_COMPONENTE = 3
const RESPOSTA_PONG = 1
const RESPOSTA_MENSAGEM = 4
const RESPOSTA_ATUALIZA_MENSAGEM = 7
const FLAG_EFEMERA = 64

interface InteracaoDiscord {
  type?: number
  member?: { user?: { id?: string } }
  user?: { id?: string }
  data?: { name?: string; custom_id?: string; options?: { name?: string; value?: unknown }[] }
  message?: { content?: string }
}

export interface RespostaDiscord {
  /** Corpo JSON da resposta imediata (o Discord exige resposta em 3 s). */
  corpo: Record<string, unknown>
  /** Trabalho que pode terminar depois da resposta (a rota agenda com `after`). */
  depois: (() => Promise<void>) | null
}

function efemera(texto: string): RespostaDiscord {
  return { corpo: { type: RESPOSTA_MENSAGEM, data: { content: texto, flags: FLAG_EFEMERA } }, depois: null }
}

export async function tratarInteracaoDiscord(
  interacao: unknown,
  deps: DependenciasWebhook,
): Promise<RespostaDiscord> {
  const i = (interacao ?? {}) as InteracaoDiscord
  // No servidor o autor vem em member.user; na DM vem em user.
  const externoId = i.member?.user?.id ?? i.user?.id

  if (i.type === INTERACAO_PING) return { corpo: { type: RESPOSTA_PONG }, depois: null }

  if (i.type === INTERACAO_COMANDO) {
    if (i.data?.name !== 'vincular' || !externoId) return efemera('Comando desconhecido.')
    const valor = String(i.data.options?.find((o) => o.name === 'codigo')?.value ?? '')
    const codigo = extrairCodigoVinculo(valor)
    if (!codigo) return efemera('Informe o código gerado em Meu perfil (ex.: ALERTA-7K3M).')
    const r = await deps.repo.vincular(codigo, 'discord', externoId)
    return efemera(r.ok ? textoVinculado(r.nome) : r.erro)
  }

  if (i.type === INTERACAO_COMPONENTE) {
    const ocorrenciaId = lerCallbackResolver(i.data?.custom_id)
    if (!ocorrenciaId || !externoId) return efemera('Ação desconhecida.')

    const usuarioId = await deps.repo.usuarioPorConta('discord', externoId)
    if (!usuarioId) return efemera('Sua conta do Discord não está vinculada ao ShopFloor.')

    const r = await deps.repo.resolver(ocorrenciaId, usuarioId)
    if (!r.ok) {
      const resposta = efemera(r.erro)
      if (r.codigo === 'OCORRENCIA_ENCERRADA') {
        resposta.depois = () => removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
      }
      return resposta
    }

    const res = r.resolucao
    const linha = textoResolvido({ posto: res.posto, nome: res.resolvidaPorNome, em: res.resolvidaEm })
    return {
      // type 7 edita a MENSAGEM CLICADA: acrescenta quem resolveu e apaga o botão.
      corpo: {
        type: RESPOSTA_ATUALIZA_MENSAGEM,
        data: { content: `${i.message?.content ?? ''}\n\n${linha}`.trim(), components: [] },
      },
      depois: async () => {
        await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
        // O aviso aos outros já está na fila (alerta_resolver): só adianta a entrega.
        if (!res.jaResolvida) {
          await entregarPendentes(deps.portas, deps.repo, { ocorrenciaId })
        }
      },
    }
  }

  return efemera('Interação não suportada.')
}
