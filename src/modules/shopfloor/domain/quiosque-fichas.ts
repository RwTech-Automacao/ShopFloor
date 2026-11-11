import { camposFicha, type DadosFicha } from '@/modules/alertas/domain/ficha-texto'

/**
 * PÁGINA DO TABLET DO ALMOXARIFADO (`GET /quiosque/fichas?k=<chave>`).
 *
 * O tablet do Almoxarifado é um Samsung com Android 4.4.4 (KitKat): o app normal não carrega nele (o Tailwind
 * v4 pede Chrome 111+ e o React não sobe). Esta página é o mínimo que ele roda: HTML escrito à mão, sem
 * JavaScript, CSS de navegador antigo, um QR grande por caixa/lote esperando confirmação, para o leitor do
 * Almoxarifado bipar da tela. Recarrega sozinha a cada 30 s (meta refresh). Só leitura.
 *
 * ⚠️ Sem sessão: quem autoriza é a chave `FICHAS_TABLET_CHAVE`, conferida dentro da rota (ver
 * domain/rotas-quiosque.ts e o middleware.ts).
 */

/** Quantas fichas a página mostra no máximo (cada uma leva um PNG embutido). */
export const LIMITE_FICHAS_QUIOSQUE = 60

/** Segundos entre um recarregamento e outro. */
export const RECARGA_QUIOSQUE_SEG = 30

/** Uma caixa ou um lote esperando confirmação, como vem de `sf_almox_pendencias_base` (0167). */
export interface PendenciaFicha {
  pmo: string
  op: string
  tipo: 'caixa' | 'lote'
  codigo: string
  pecas: number
  loteId: string | null
  /** Quando a caixa fechou ou o lote foi aprovado (ISO). */
  em: string | null
}

/**
 * Das linhas da fila do Almoxarifado, só as que têm ficha: caixa e lote (peça avulsa não gera ficha, como no
 * alerta). Mais nova primeiro; sem data vai pro fim. Linha malformada é descartada.
 */
export function pendenciasComFicha(linhas: unknown): PendenciaFicha[] {
  if (!Array.isArray(linhas)) return []
  const saida: PendenciaFicha[] = []
  for (const l of linhas as Record<string, unknown>[]) {
    if (!l || typeof l !== 'object') continue
    if (l.tipo !== 'caixa' && l.tipo !== 'lote') continue
    if (typeof l.pmo !== 'string' || typeof l.op !== 'string' || typeof l.codigo !== 'string') continue
    saida.push({
      pmo: l.pmo,
      op: l.op,
      tipo: l.tipo,
      codigo: l.codigo,
      pecas: Number(l.pecas ?? 0),
      loteId: typeof l.lote_id === 'string' ? l.lote_id : null,
      em: typeof l.em === 'string' ? l.em : null,
    })
  }
  const t = (p: PendenciaFicha) => (p.em ? Date.parse(p.em) : Number.NaN)
  return saida.sort((a, b) => {
    const x = t(a)
    const y = t(b)
    if (Number.isNaN(x) && Number.isNaN(y)) return 0
    if (Number.isNaN(x)) return 1
    if (Number.isNaN(y)) return -1
    return y - x
  })
}

/** A chave de `alerta_ficha_responsavel` (0173): o código da caixa, ou o lote_id. Lote sem id = não há como perguntar. */
export function chaveDoResponsavel(p: PendenciaFicha): string | null {
  return p.tipo === 'lote' ? p.loteId : p.codigo
}

/** A ficha de uma pendência, no mesmo formato da mensagem do alerta. */
export function fichaDaPendencia(
  p: PendenciaFicha,
  ordem: { descricao: string | null; qtd: number | null } | null,
  responsavel: string | null,
): DadosFicha {
  const em = p.em ? new Date(p.em) : null
  return {
    unidade: p.tipo,
    codigo: p.codigo,
    dataProducao: em && !Number.isNaN(em.getTime()) ? em : null,
    produto: ordem?.descricao ?? '',
    quantidadeOp: ordem?.qtd === null || ordem?.qtd === undefined ? null : Number(ordem.qtd),
    pmo: p.pmo,
    op: p.op,
    quantidadeApontada: p.pecas,
    responsavel: responsavel ?? '',
  }
}

export function escaparHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** '09/11/2026 14:05:30', no relógio da fábrica. */
function horario(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

/**
 * CSS para o Chrome ~33 / navegador do Android 4.4: nada de variáveis, grid, `gap` de flex, `clamp` ou seletor
 * moderno. Cartões em inline-block (dois por linha no tablet deitado, um no estreito).
 */
const ESTILO = `
body{margin:0;padding:12px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.35}
h1{font-size:28px;margin:0 0 4px 0}
.topo{margin:0 0 12px 0;padding:0 0 8px 0;border-bottom:2px solid #333333}
.hora{font-size:18px;color:#444444;margin:0}
.aviso{font-size:20px;font-weight:bold;color:#8a4b00;margin:6px 0 0 0}
.erro{font-size:24px;font-weight:bold;color:#a40000;margin:24px 0}
.vazio{font-size:28px;margin:40px 0 12px 0}
.ficha{display:inline-block;vertical-align:top;width:46%;margin:0 1% 16px 1%;padding:12px;border:2px solid #333333;background:#ffffff}
.tipo{font-size:22px;font-weight:bold;margin:0 0 6px 0}
.qr{text-align:center;margin:0 0 6px 0}
.qr img{width:300px;height:300px;border:0}
.codigo{font-family:"Courier New",Courier,monospace;font-size:22px;font-weight:bold;text-align:center;margin:0 0 10px 0;word-wrap:break-word}
table{border-collapse:collapse;width:100%}
td{padding:4px 6px;border-top:1px solid #cccccc;vertical-align:top}
td.r{color:#444444;width:45%}
td.v{font-weight:bold;word-wrap:break-word}
@media (max-width:760px){.ficha{display:block;width:auto;margin:0 0 16px 0}}
`

export interface FichaComQr {
  dados: DadosFicha
  /** `data:image/png;base64,…` do código. */
  qr: string
}

export type ConteudoQuiosque =
  | { tipo: 'ok'; fichas: FichaComQr[]; total: number; agora: Date }
  | { tipo: 'erro'; agora: Date }

function cartao(f: FichaComQr): string {
  const rotulo = f.dados.unidade === 'lote' ? 'Lote' : 'Caixa'
  const linhas = camposFicha(f.dados)
    .map((c) => `<tr><td class="r">${escaparHtml(c.rotulo)}</td><td class="v">${escaparHtml(c.valor)}</td></tr>`)
    .join('')
  return (
    `<div class="ficha">` +
    `<p class="tipo">${rotulo}</p>` +
    `<div class="qr"><img src="${escaparHtml(f.qr)}" alt="QR ${escaparHtml(f.dados.codigo)}" width="300" height="300"></div>` +
    `<p class="codigo">${escaparHtml(f.dados.codigo)}</p>` +
    `<table>${linhas}</table>` +
    `</div>`
  )
}

/** A página inteira, pronta para responder. Todo valor vindo do banco passa por `escaparHtml`. */
export function htmlQuiosqueFichas(c: ConteudoQuiosque): string {
  const hora = `<p class="hora">Atualizado em ${escaparHtml(horario(c.agora))} · recarrega a cada ${RECARGA_QUIOSQUE_SEG} s</p>`
  let corpo: string
  if (c.tipo === 'erro') {
    corpo =
      `<div class="topo"><h1>Fichas do Almoxarifado</h1>${hora}</div>` +
      `<p class="erro">Não foi possível carregar a lista agora. Tentando de novo em ${RECARGA_QUIOSQUE_SEG} segundos.</p>`
  } else if (c.total === 0) {
    corpo =
      `<div class="topo"><h1>Fichas do Almoxarifado</h1>${hora}</div>` +
      `<p class="vazio">Nenhuma caixa ou lote esperando confirmação.</p>`
  } else {
    const aviso =
      c.fichas.length < c.total ? `<p class="aviso">Mostrando ${c.fichas.length} de ${c.total}.</p>` : ''
    corpo =
      `<div class="topo"><h1>Esperando confirmação (${c.total})</h1>${hora}${aviso}</div>` +
      c.fichas.map(cartao).join('')
  }
  return (
    `<!DOCTYPE html>` +
    `<html lang="pt-BR"><head>` +
    `<meta charset="utf-8">` +
    `<meta http-equiv="refresh" content="${RECARGA_QUIOSQUE_SEG}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow">` +
    `<title>Fichas do Almoxarifado</title>` +
    `<style>${ESTILO}</style>` +
    `</head><body>${corpo}</body></html>`
  )
}
