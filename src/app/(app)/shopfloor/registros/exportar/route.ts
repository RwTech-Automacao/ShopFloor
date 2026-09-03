import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarTodosRegistros } from '@/modules/shopfloor/infra/registros-repository'
import { parsearFiltrosRegistros } from '@/modules/shopfloor/domain/registros-filtros'

export const dynamic = 'force-dynamic'

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo', // o servidor roda em UTC; sem isto sairia 3h à frente
})

/** Colunas do arquivo: [cabeçalho, como extrair da linha]. */
const COLUNAS: [string, (r: Record<string, unknown>) => string][] = [
  // `dateStyle+timeStyle` em pt-BR devolve "02/09/2026, 09:25:19" — a vírgula fazia o Excel/Calc
  // (que costuma vir com vírgula E ponto-e-vírgula marcados) quebrar a data em duas colunas.
  ['Data/Hora', (r) => (r.data_hora ? fmtData.format(new Date(String(r.data_hora))).replace(', ', ' ') : '')],
  ['Cliente', (r) => String(r.cliente ?? '')],
  ['PMO', (r) => String(r.pmo ?? '')],
  ['OP', (r) => String(r.op ?? '')],
  ['Posto', (r) => String(r.posto ?? '')],
  ['Nº Série', (r) => String(r.numero_serie ?? '')],
  ['Status', (r) => String(r.status ?? '')],
  ['Colaborador', (r) => String(r.colaborador ?? '')],
  ['Nº caixa', (r) => String(r.numero_caixa ?? '')],
  ['Código defeito', (r) => String(r.codigo_defeito ?? '')],
  ['Posição', (r) => String(r.posicao ?? '')],
  ['Tipo defeito', (r) => String(r.tipo_defeito ?? '')],
  ['NQA visual', (r) => String(r.nqa_visual ?? '')],
  ['NQA funcional', (r) => String(r.nqa_funcional ?? '')],
  ['ID Integração', (r) => String(r.id_integracao ?? '')],
  ['Reparo (conserto)', (r) => String(r.reparo_conserto ?? '')],
  ['Reparo (posição)', (r) => String(r.reparo_posicao ?? '')],
  ['Posto de origem', (r) => String(r.posto_origem ?? '')],
  ['Rota de reteste', (r) => String(r.posto_retorno ?? '')],
]

/**
 * Escapa um campo de CSV: duplica aspas e envolve o valor quando ele tem separador, aspas ou quebra
 * de linha. A VÍRGULA entra na lista de propósito: o separador do arquivo é `;`, mas o Excel/Calc
 * costuma importar com vírgula marcada também — sem as aspas, um campo com vírgula vira duas colunas.
 */
function campo(v: string): string {
  return /[;,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Exporta em CSV TODOS os registros que casam com os filtros da tela (mesmos parâmetros da URL).
 * Separador `;` e BOM UTF-8 — é o que o Excel em pt-BR abre direto, sem assistente de importação.
 */
export async function GET(req: Request) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return new Response('Sem permissão para exportar os registros.', { status: 403 })
  }

  const url = new URL(req.url)
  const filtros = parsearFiltrosRegistros(Object.fromEntries(url.searchParams))
  const { linhas } = await listarTodosRegistros(filtros)

  const linhasCsv = [
    COLUNAS.map(([titulo]) => campo(titulo)).join(';'),
    ...linhas.map((r) => COLUNAS.map(([, extrair]) => campo(extrair(r as unknown as Record<string, unknown>))).join(';')),
  ]
  const csv = '﻿' + linhasCsv.join('\r\n')

  const carimbo = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registros-${carimbo}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
