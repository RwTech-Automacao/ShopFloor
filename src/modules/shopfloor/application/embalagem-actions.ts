'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { carregarEstadoEmbalagem, garantirCaixa, chamarFecharCaixa, carregarCaixasDaOp, resolverAlvoDoBipe, outrasCaixasDoSn, type EstadoEmbalagem, type CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'
import QRCode from 'qrcode'
import { lancar } from './lancar-action'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

/** Como a caixa é chamada nas mensagens pro operador. */
function rotuloCaixa(seq: number): string {
  return `CX[${seq}]`
}

export async function carregarEmbalagem(
  pmo: string, op: string, posto: string, seqEmFoco?: number,
): Promise<{ ok: true; estado: EstadoEmbalagem } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, estado: await carregarEstadoEmbalagem(pmo.trim(), op.trim(), posto.trim(), seqEmFoco) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o estado da caixa.' }
  }
}

/** Resultado do bipe. `confirmar` não é erro: é a peça que não era da caixa original numa
 *  remontagem — o painel mostra o motivo e um botão pra incluir mesmo assim. */
export type ResultadoEmbalar =
  | { ok: true; caixaCount?: number; seq: number }
  | { ok: false; erro: string; confirmar?: { motivo: string; seq: number } }

/** Garante a caixa (seq,limite) e lança a peça nela (reusa sf_lancar via lancar).
 *  `ultima`: a caixa foi marcada como ÚLTIMA → aceita passar do limite (as peças que sobram
 *  vão nela em vez de abrir caixa nova). Continua mandando o qtd_por_caixa (a validação exige),
 *  mas via `permitirExtraCaixa` o lancar passa qtd=null pro RPC → pula a checagem de CAIXA_CHEIA.
 *  (O limite canônico da caixa continua em sf_caixas.limite.)
 *
 *  REMONTAGEM: se a peça bipada veio de uma caixa reprovada no NQA que ainda não foi refeita, ela
 *  não vai pra caixa da tela — vai pra caixa DELA, e a resposta devolve o `seq` usado pro painel
 *  se ajustar. É por isso que a decisão mora aqui e não no cliente: o painel pode estar com um
 *  estado de segundos atrás, e a reprova do NQA acontece em outra tela, em outro posto. */
export async function embalarPeca(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; seq: number; limite: number; numeroSerie: string
  ultima?: boolean
  /** o operador já viu o aviso e mandou incluir a peça fora da caixa original */
  confirmarForaDaCaixa?: boolean
}): Promise<ResultadoEmbalar> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  // Trim consistente: garantirCaixa (sf_caixas) e lancar (sf_registros) precisam da MESMA chave,
  // senão as contagens/fechamento (que trimam) não casam com os registros.
  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const posto = entrada.posto.trim()
  const snNorm = normalizarSerie(entrada.numeroSerie)

  let seq = entrada.seq
  let limite = entrada.limite
  let ultima = entrada.ultima
  let anterior: Awaited<ReturnType<typeof resolverAlvoDoBipe>>['anterior'] = null
  try {
    const alvo = await resolverAlvoDoBipe(pmo, op, posto, snNorm, entrada.seq)
    seq = alvo.seq
    anterior = alvo.anterior
    if (alvo.limite !== null) {
      limite = alvo.limite
      // A remontagem tem tamanho conhecido (o da montagem reprovada); "última caixa" é uma decisão
      // do fim da OP e não se aplica aqui — deixar passar liberaria o limite sem querer.
      ultima = false
    }
  } catch {
    return { ok: false, erro: 'Não foi possível verificar a caixa desta peça.' }
  }

  // Valida o limite ANTES de criar a caixa: como garantirCaixa é idempotente (não sobrescreve),
  // um limite inválido gravaria a caixa com limite ruim de forma permanente.
  if (!Number.isInteger(limite) || limite <= 0) {
    return { ok: false, erro: 'Limite da caixa inválido.' }
  }

  // Remontagem: peça que não estava na caixa original entra, mas não em silêncio.
  if (anterior && !entrada.confirmarForaDaCaixa && !anterior.snsOriginaisNorm.includes(snNorm)) {
    let motivo = `${entrada.numeroSerie.trim()} não estava na ${rotuloCaixa(seq)} original.`
    try {
      const outras = await outrasCaixasDoSn(pmo, op, posto, snNorm, [anterior.codigo, marcadorCaixaAberta(seq)])
      if (outras.length > 0) motivo += ` Já está em ${outras.join(', ')}.`
    } catch {
      // o motivo extra é enfeite; sem ele o aviso principal continua de pé
    }
    return { ok: false, erro: motivo, confirmar: { motivo, seq } }
  }

  try {
    await garantirCaixa(pmo, op, posto, seq, limite)
  } catch {
    return { ok: false, erro: 'Não foi possível abrir a caixa.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto,
    pmo,
    op,
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: marcadorCaixaAberta(seq),
    qtdPorCaixa: String(limite),
    permitirExtraCaixa: ultima, // última caixa aceita passar do limite
  })
  if (!r.ok) return { ok: false, erro: r.erro }
  return { ok: true, caixaCount: r.caixaCount, seq }
}

/** Embalagem INDIVIDUAL (1 produto por caixa): confere se o SN da caixa == SN do produto e, se
 *  bater, registra a peça com numero_caixa = o próprio SN (qtd_por_caixa = 1, sem CX coletiva). */
export async function embalarIndividual(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; numeroSerie: string; numeroSerieCaixa: string
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  if (normalizarSerie(entrada.numeroSerie) !== normalizarSerie(entrada.numeroSerieCaixa)) {
    return { ok: false, erro: 'O Nº de Série da caixa não confere com o do produto.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto: entrada.posto.trim(),
    pmo: entrada.pmo.trim(),
    op: entrada.op.trim(),
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: entrada.numeroSerieCaixa.trim(), // a caixa individual = o próprio SN
    qtdPorCaixa: '1',
  })
  if (!r.ok) return { ok: false, erro: r.erro }
  return { ok: true }
}

export async function fecharCaixa(
  pmo: string, op: string, posto: string, seq: number, ultima: boolean,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const r = await chamarFecharCaixa(pmo.trim(), op.trim(), posto.trim(), seq, ultima)
  if (!r.ok) return { ok: false, erro: r.erro === 'CAIXA_VAZIA' ? 'A caixa está vazia.' : 'Não foi possível fechar a caixa.' }
  return { ok: true, codigo: r.codigo! }
}

export async function caixasDaOp(
  pmo: string, op: string,
): Promise<{ ok: true; caixas: CaixaConsulta[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, caixas: await carregarCaixasDaOp(pmo.trim(), op.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as caixas.' }
  }
}

/**
 * QR Code da caixa para a folha impressa. O conteúdo é a LISTA DE SNs, um por linha — é o que o
 * leitor de celular mostra hoje na planilha que a fábrica usa. Gerado no servidor (SVG, imprime
 * nítido em qualquer tamanho) para não carregar a biblioteca no navegador do chão de fábrica.
 *
 * O QR tem teto de dados: com correção de erro M cabem ~230 SNs. Caixa maior que isso não gera —
 * devolve o erro em vez de imprimir um QR truncado, que seria pior que nenhum.
 */
export async function qrDaCaixa(
  pmo: string, op: string, posto: string, seq: number,
): Promise<{ ok: true; svg: string; conteudo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const caixas = await carregarCaixasDaOp(pmo.trim(), op.trim())
    const caixa = caixas.find((c) => c.posto === posto && c.seq === seq)
    if (!caixa) return { ok: false, erro: 'Caixa não encontrada.' }
    if (caixa.sns.length === 0) return { ok: false, erro: 'Esta caixa não tem peças.' }

    const conteudo = caixa.sns.join('\n')
    const svg = await QRCode.toString(conteudo, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
    })
    return { ok: true, svg, conteudo }
  } catch {
    return {
      ok: false,
      erro: `Não foi possível gerar o QR Code — a caixa pode ter peças demais para um QR (teto ~230).`,
    }
  }
}
