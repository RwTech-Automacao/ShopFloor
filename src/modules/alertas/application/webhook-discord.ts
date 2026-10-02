import { extrairCodigoVinculo, lerCallbackResolver, montarCallbackResolver } from '../domain/codigos'
import { LIMITE_EXPLICACAO, anexarLinha, cortarExplicacao, textoResolvido, textoVinculado } from '../domain/mensagens'
import { entregarPendentes, removerBotoesDaOcorrencia } from './enviar-alertas'
import type { DependenciasWebhook } from './portas'

/** Tipos de interação e de resposta do Discord (API v10). */
const INTERACAO_PING = 1
const INTERACAO_COMANDO = 2
const INTERACAO_COMPONENTE = 3
const INTERACAO_MODAL = 5
const RESPOSTA_PONG = 1
const RESPOSTA_MENSAGEM = 4
const RESPOSTA_ATUALIZA_MENSAGEM = 7
const RESPOSTA_MODAL = 9
const CAMPO_EXPLICACAO = 'explicacao'
const FLAG_EFEMERA = 64

interface InteracaoDiscord {
  type?: number
  member?: { user?: { id?: string } }
  user?: { id?: string }
  data?: {
    name?: string
    custom_id?: string
    options?: { name?: string; value?: unknown }[]
    /** Só no envio do modal: linhas de ação, cada uma com o campo de texto dentro. */
    components?: { components?: { custom_id?: string; value?: unknown }[] }[]
  }
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

/** O modal que o clique abre. O `custom_id` carrega o id da ocorrência até o envio. */
function modalExplicacao(ocorrenciaId: string): RespostaDiscord {
  return {
    corpo: {
      type: RESPOSTA_MODAL,
      data: {
        custom_id: montarCallbackResolver(ocorrenciaId),
        title: 'Resolver alerta',
        components: [
          {
            type: 1, // action row
            components: [
              {
                type: 4, // text input
                custom_id: CAMPO_EXPLICACAO,
                label: 'O que foi feito? (opcional)',
                style: 2, // parágrafo
                required: false,
                max_length: LIMITE_EXPLICACAO,
                placeholder: 'Ex.: trocamos o feeder da posição 3',
              },
            ],
          },
        ],
      },
    },
    depois: null,
  }
}

/** Texto digitado no modal, ou '' (campo vazio, ausente ou só espaços). */
function lerExplicacao(i: InteracaoDiscord): string {
  const campos = (i.data?.components ?? []).flatMap((linha) => linha.components ?? [])
  const valor = campos.find((c) => c.custom_id === CAMPO_EXPLICACAO)?.value
  return cortarExplicacao(valor)
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

  // Resolver são DUAS interações: o clique no botão abre a caixa de texto (nada é resolvido ainda) e
  // o envio dela resolve. Em ambas, conta não vinculada recusa antes de qualquer coisa.
  if (i.type === INTERACAO_COMPONENTE || i.type === INTERACAO_MODAL) {
    const ocorrenciaId = lerCallbackResolver(i.data?.custom_id)
    if (!ocorrenciaId || !externoId) return efemera('Ação desconhecida.')

    const usuarioId = await deps.repo.usuarioPorConta('discord', externoId)
    if (!usuarioId) return efemera('Sua conta do Discord não está vinculada ao ShopFloor.')

    if (i.type === INTERACAO_COMPONENTE) return modalExplicacao(ocorrenciaId)

    const explicacao = lerExplicacao(i)
    const r = await deps.repo.resolver(ocorrenciaId, usuarioId, explicacao)
    if (!r.ok) {
      const resposta = efemera(r.erro)
      if (r.codigo === 'OCORRENCIA_ENCERRADA') {
        resposta.depois = () => removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
      }
      return resposta
    }

    const res = r.resolucao
    // Já resolvida por outra pessoa: o banco manteve a explicação DELA e não devolve qual é, então
    // o texto digitado aqui é descartado. Avisa (como o Telegram) em vez de sumir com ele em silêncio;
    // o botão sai das mensagens do mesmo jeito.
    if (res.jaResolvida) {
      const aviso = efemera(`Já resolvido por ${res.resolvidaPorNome}. O que você escreveu não foi guardado.`)
      aviso.depois = () => removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
      return aviso
    }
    const linha = textoResolvido({
      posto: res.posto,
      nome: res.resolvidaPorNome,
      em: res.resolvidaEm,
      explicacao,
    })
    // Sem `message` no payload (o modal pode nascer sem componente de mensagem), NÃO se manda `content`:
    // o type 7 SUBSTITUI o texto, e mandar só a linha apagaria o corpo do alerta. Omitido, o Discord
    // preserva o que está lá e `components: []` ainda tira o botão.
    const original = i.message?.content
    return {
      // type 7 edita a MENSAGEM CLICADA: acrescenta quem resolveu e apaga o botão.
      corpo: {
        type: RESPOSTA_ATUALIZA_MENSAGEM,
        data: {
          ...(original === undefined ? {} : { content: anexarLinha(original, linha) }),
          components: [],
          // A linha agora leva o que a pessoa digitou: sem isto, um @everyone na explicação
          // notificaria o servidor inteiro. Mesma forma do envio normal (infra/discord.ts).
          allowed_mentions: { parse: [] },
        },
      },
      depois: async () => {
        await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
        // O aviso aos outros já está na fila (alerta_resolver): só adianta a entrega.
        await entregarPendentes(deps.portas, deps.repo, { ocorrenciaId })
      },
    }
  }

  return efemera('Interação não suportada.')
}
