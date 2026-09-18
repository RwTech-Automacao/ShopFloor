import { CANAIS, NOME_CANAL, type Canal, type ResultadoEnvio, type ResultadoSimples } from '../domain/tipos'
import { textoDoEnvio } from '../domain/envio'
import type { PortasCanais, RepositorioEnvios } from './portas'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Tamanho do lote por rodada. A reserva no banco vale 15 min: 30 x até 20 s cabe com folga. */
export const LIMITE_LOTE = 30

export interface ResumoEnvio {
  enviados: number
  falhas: number
}

export interface ResumoAvaliacao extends ResumoEnvio {
  avaliadas: number
  enfileirados: number
  ocupado: boolean
}

/**
 * O ÚNICO caminho de entrega da fila: reserva um lote no banco (atômico — duas rodadas ao mesmo
 * tempo nunca pegam a mesma linha), monta o texto, envia e grava o resultado na própria linha.
 *
 * Um item que dá errado (texto que não monta, canal que lança, banco que não grava o resultado)
 * NÃO derruba a rodada: loga e segue. Se o erro foi antes/durante o envio, a linha é concluída
 * como falha e volta na próxima rodada (até 3 tentativas). Se foi só ao gravar o resultado, a
 * reserva vence em 15 min e a linha volta — entrega "pelo menos uma vez".
 */
export async function entregarPendentes(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  opcoes: { ocorrenciaId?: string | null; limite?: number } = {},
): Promise<ResumoEnvio> {
  const canais: Canal[] = CANAIS.filter((c) => portas[c])
  if (canais.length === 0) return { enviados: 0, falhas: 0 }

  const lote = await repo.reservarPendentes({
    canais,
    limite: opcoes.limite ?? LIMITE_LOTE,
    ocorrenciaId: opcoes.ocorrenciaId ?? null,
  })

  let enviados = 0
  let falhas = 0
  for (const envio of lote) {
    let texto = ''
    let resultado: ResultadoEnvio
    try {
      const porta = portas[envio.canal]
      if (!porta) throw new Error(`${NOME_CANAL[envio.canal]} não configurado`)
      texto = textoDoEnvio(envio.tipo, envio.dados)
      resultado = await porta.enviar(envio.externoId, texto, envio.comBotao ? envio.ocorrenciaId : null)
    } catch (e) {
      console.error(`[alertas] envio ${envio.id} falhou:`, mensagemDe(e))
      resultado = { ok: false, erro: `Erro interno: ${mensagemDe(e)}` }
    }

    if (resultado.ok) enviados += 1
    else falhas += 1

    try {
      await repo.concluirEnvio(envio, texto, resultado)
    } catch (e) {
      console.error(`[alertas] gravar resultado do envio ${envio.id} falhou:`, mensagemDe(e))
    }
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
 * O ciclo do cron (e do "Avaliar agora"): o banco decide E enfileira numa transação só; aqui só
 * se entrega a fila e se tiram os botões das ocorrências que encerraram.
 *
 * Depois que `avaliar` volta, a decisão já está gravada junto com as linhas pendentes: qualquer
 * tropeço daqui pra frente só atrasa a entrega para a próxima rodada — nada se perde.
 */
export async function avaliarEEnviar(portas: PortasCanais, repo: RepositorioEnvios): Promise<ResumoAvaliacao> {
  const avaliacao = await repo.avaliar()
  if (avaliacao.ocupado) {
    return { avaliadas: 0, enfileirados: 0, enviados: 0, falhas: 0, ocupado: true }
  }

  let resumo: ResumoEnvio = { enviados: 0, falhas: 0 }
  try {
    resumo = await entregarPendentes(portas, repo)
  } catch (e) {
    console.error('[alertas] entrega da fila falhou:', mensagemDe(e))
  }

  // Normalizou (ou a regra foi desativada/excluída): os alertas antigos não oferecem mais "Resolvido".
  for (const ocorrenciaId of avaliacao.normalizadas) {
    try {
      await removerBotoesDaOcorrencia(portas, repo, ocorrenciaId)
    } catch (e) {
      console.error('[alertas] remover botões falhou:', mensagemDe(e))
    }
  }

  return {
    avaliadas: avaliacao.avaliadas,
    enfileirados: avaliacao.enfileirados,
    enviados: resumo.enviados,
    falhas: resumo.falhas,
    ocupado: false,
  }
}

/**
 * Botão "Enviar teste" do Meu perfil: prova que a DM chega ANTES de existir um alerta de verdade.
 * Entrega DIRETA (fora da fila): a pessoa precisa ver o resultado na hora, e teste que falhou não
 * é reenviado. O resultado é gravado como linha já final em `alerta_envios`.
 */
export async function enviarTeste(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  p: { usuarioId: string; canal: Canal; nome: string },
): Promise<ResultadoSimples> {
  const porta = portas[p.canal]
  if (!porta) return { ok: false, erro: `${NOME_CANAL[p.canal]} não está configurado neste ambiente.` }
  const conta = await repo.contaDoUsuario(p.usuarioId, p.canal)
  if (!conta) return { ok: false, erro: `Vincule o ${NOME_CANAL[p.canal]} antes de enviar o teste.` }

  const dados = { nome: p.nome }
  const texto = textoDoEnvio('teste', dados)
  const resultado = await porta.enviar(conta.externoId, texto, null)
  await repo.registrarEnvioDireto({
    usuarioId: p.usuarioId,
    canal: p.canal,
    tipo: 'teste',
    texto,
    dados,
    resultado,
  })
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro }
}
