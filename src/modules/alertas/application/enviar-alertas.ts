import { NOME_CANAL, type Canal, type ResultadoSimples, type TipoEnvio } from '../domain/tipos'
import { acaoTemBotao, textoDaAcao, type ContaDestino } from '../domain/avaliacao'
import { textoResolvido, textoTeste } from '../domain/mensagens'
import type { PortasCanais, RepositorioEnvios } from './portas'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface ItemEnvio {
  conta: ContaDestino
  tipo: TipoEnvio
  texto: string
  ocorrenciaId: string | null
  comBotao: boolean
}

export interface ResumoEnvio {
  enviados: number
  falhas: number
}

export interface ResumoAvaliacao extends ResumoEnvio {
  avaliadas: number
  ocupado: boolean
}

/** Um envio por item. Canal sem token é PULADO: não envia e não gera linha de falha. */
export async function enviarItens(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  itens: ItemEnvio[],
): Promise<ResumoEnvio> {
  let enviados = 0
  let falhas = 0
  for (const item of itens) {
    const porta = portas[item.conta.canal]
    if (!porta) continue
    const resultado = await porta.enviar(
      item.conta.externoId,
      item.texto,
      item.comBotao ? item.ocorrenciaId : null,
    )
    await repo.registrarEnvio({
      ocorrenciaId: item.ocorrenciaId,
      usuarioId: item.conta.usuarioId,
      canal: item.conta.canal,
      tipo: item.tipo,
      texto: item.texto,
      comBotao: item.comBotao,
      resultado,
    })
    if (resultado.ok) enviados += 1
    else falhas += 1
  }
  return { enviados, falhas }
}

/** Tenta de novo o que falhou em rodadas ANTERIORES (o repositório já filtra tentativas < 3). */
export async function reenviarFalhas(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoEnvio> {
  let enviados = 0
  let falhas = 0
  for (const pendente of await repo.envioParaReenviar()) {
    const porta = portas[pendente.canal]
    if (!porta) continue
    const resultado = await porta.enviar(
      pendente.externoId,
      pendente.texto,
      pendente.comBotao ? pendente.ocorrenciaId : null,
    )
    await repo.registrarReenvio(pendente, resultado)
    if (resultado.ok) enviados += 1
    else falhas += 1
  }
  return { enviados, falhas }
}

/** Tira o botão "Resolvido" de todas as mensagens vivas da ocorrência. */
export async function removerBotoesDaOcorrencia(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  ocorrenciaId: string,
): Promise<void> {
  const mensagens = await repo.mensagensComBotao(ocorrenciaId)
  const feitos: string[] = []
  for (const m of mensagens) {
    const porta = portas[m.canal]
    if (!porta) continue
    const r = await porta.removerBotoes(m.mensagemExternaId)
    if (r.ok) feitos.push(m.envioId)
  }
  if (feitos.length > 0) await repo.marcarSemBotao(feitos)
}

/**
 * O ciclo do cron: avalia no banco (decisão atômica lá) e entrega o que ele mandou entregar.
 * A ORDEM importa: `avaliar` primeiro (se estiver ocupado, sai sem mexer em nada) e só depois os
 * reenvios — que são lidos ANTES de gravar os envios desta rodada, então nunca se reenvia o que
 * acabou de falhar aqui.
 */
export async function avaliarEEnviar(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoAvaliacao> {
  const avaliacao = await repo.avaliar()
  if (avaliacao.ocupado) return { avaliadas: 0, enviados: 0, falhas: 0, ocupado: true }

  // Daqui pra baixo a avaliação JÁ foi gravada (ocorrência aberta, lembrete marcado): um tropeço
  // no reenvio ou na limpeza de botões não pode fazer as ações desta rodada se perderem.
  let enviados = 0
  let falhas = 0
  try {
    const reenvio = await reenviarFalhas(portas, repo)
    enviados += reenvio.enviados
    falhas += reenvio.falhas
  } catch (e) {
    console.error('[alertas] reenvio de falhas falhou:', mensagemDe(e))
  }

  for (const acao of avaliacao.acoes) {
    const texto = textoDaAcao(acao)
    const comBotao = acaoTemBotao(acao)
    const r = await enviarItens(
      portas,
      repo,
      acao.contas.map((conta) => ({ conta, tipo: acao.tipo, texto, ocorrenciaId: acao.ocorrenciaId, comBotao })),
    )
    enviados += r.enviados
    falhas += r.falhas
    // Normalizou: os alertas antigos não devem mais oferecer "Resolvido".
    if (acao.tipo === 'normalizou') {
      try {
        await removerBotoesDaOcorrencia(portas, repo, acao.ocorrenciaId)
      } catch (e) {
        console.error('[alertas] remover botões falhou:', mensagemDe(e))
      }
    }
  }

  return { avaliadas: avaliacao.avaliadas, enviados, falhas, ocupado: false }
}

/** "✅ resolvido por X" para os OUTROS destinatários (quem apertou já sabe). */
export async function avisarResolvido(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  r: {
    ocorrenciaId: string
    posto: string
    resolvidoPorId: string
    resolvidoPorNome: string
    resolvidaEm: Date
  },
): Promise<ResumoEnvio> {
  const contas = (await repo.contasDaOcorrencia(r.ocorrenciaId)).filter(
    (c) => c.usuarioId !== r.resolvidoPorId,
  )
  const texto = textoResolvido({ posto: r.posto, nome: r.resolvidoPorNome, em: r.resolvidaEm })
  return enviarItens(
    portas,
    repo,
    contas.map((conta) => ({ conta, tipo: 'resolvido' as TipoEnvio, texto, ocorrenciaId: r.ocorrenciaId, comBotao: false })),
  )
}

/** Botão "Enviar teste" do Meu perfil: prova que a DM chega ANTES de existir um alerta de verdade. */
export async function enviarTeste(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  p: { usuarioId: string; canal: Canal; nome: string },
): Promise<ResultadoSimples> {
  const porta = portas[p.canal]
  if (!porta) return { ok: false, erro: `${NOME_CANAL[p.canal]} não está configurado neste ambiente.` }
  const conta = await repo.contaDoUsuario(p.usuarioId, p.canal)
  if (!conta) return { ok: false, erro: `Vincule o ${NOME_CANAL[p.canal]} antes de enviar o teste.` }

  const texto = textoTeste(p.nome)
  const resultado = await porta.enviar(conta.externoId, texto, null)
  await repo.registrarEnvio({
    ocorrenciaId: null,
    usuarioId: p.usuarioId,
    canal: p.canal,
    tipo: 'teste',
    texto,
    comBotao: false,
    resultado,
  })
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro }
}
