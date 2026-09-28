import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarTodosRegistros } from '@/modules/recebimento/infra/registros-repository'
import { carregarCamposFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { parsearFiltrosRegistros } from '@/modules/recebimento/domain/registros-filtros'
import { rotuloPassagem, type Passagem } from '@/modules/recebimento/domain/etapa-processo'
import type { RegistroRecebimento } from '@/modules/recebimento/infra/registros-repository'
import { campoCsv as campo } from '@/shared/lib/csv'

export const dynamic = 'force-dynamic'

// Data e hora saem em COLUNAS SEPARADAS: assim dá pra ordenar/filtrar por dia sem mexer no texto,
// e some a vírgula do formato pt-BR que quebrava a célula na importação.
const TZ = 'America/Sao_Paulo' // o servidor roda em UTC; sem isto sairia 3h à frente
const fmtDia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: TZ })
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: TZ })

function etapa(p: Passagem | null): string {
  return p ? rotuloPassagem(p) : ''
}

/**
 * Colunas do arquivo: [cabeçalho, como extrair da linha]. As mesmas da tela, mais o que mudou —
 * na tela isso abre ao clicar, e no arquivo cabe numa célula ("Quantidade recebida: — → 490; ...").
 * Os rótulos vêm de `configuracao_campos`, igual à tela.
 */
function colunas(rotulos: Record<string, string>): [string, (r: RegistroRecebimento) => string][] {
  return [
    ['Data', (r) => (r.dataHora ? fmtDia.format(new Date(r.dataHora)) : '')],
    ['Hora', (r) => (r.dataHora ? fmtHora.format(new Date(r.dataHora)) : '')],
    ['Colaborador', (r) => r.colaborador],
    ['Processo', (r) => String(r.numero)],
    ['EMB', (r) => r.emb],
    ['Item', (r) => r.item],
    ['Descrição', (r) => r.descricao],
    ['Fornecedor', (r) => r.fornecedor],
    ['Fabricante', (r) => r.fabricante],
    ['Part number', (r) => r.partNumber],
    ['Etapa', (r) => etapa(r.passagem)],
    [
      'Alterações',
      (r) =>
        r.alteracoes
          .map((a) => `${rotulos[a.campo] ?? a.campo}: ${a.de ?? ''} → ${a.para ?? ''}`)
          .join('; '),
    ],
  ]
}

/**
 * Exporta em CSV TODOS os registros que casam com os filtros da tela (mesmos parâmetros da URL).
 * Separador `;` e BOM UTF-8 — é o que o Excel em pt-BR abre direto, sem assistente de importação.
 */
export async function GET(req: Request) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')) {
    return new Response('Sem permissão para exportar os registros do Recebimento.', { status: 403 })
  }

  const url = new URL(req.url)
  const filtros = parsearFiltrosRegistros(Object.fromEntries(url.searchParams))
  const [{ linhas }, campos] = await Promise.all([
    listarTodosRegistros(filtros),
    carregarCamposFormulario(),
  ])

  const COLUNAS = colunas(Object.fromEntries(campos.map((c) => [c.campo, c.rotulo])))
  const linhasCsv = [
    COLUNAS.map(([titulo]) => campo(titulo)).join(';'),
    ...linhas.map((r) => COLUNAS.map(([, extrair]) => campo(extrair(r))).join(';')),
  ]
  const csv = '﻿' + linhasCsv.join('\r\n')

  const carimbo = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registros-recebimento-${carimbo}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
