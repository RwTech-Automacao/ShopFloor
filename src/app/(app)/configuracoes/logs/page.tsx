import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { consultarLogs, type LogRow } from '@/modules/logs/infra/consulta-log-repository'
import { LogsFiltros } from './logs-filtros'

const TAMANHO_PAGINA = 25

const ROTULOS_ENTIDADE: Record<string, string> = {
  usuario: 'Usuário',
  perfil: 'Perfil',
  lista: 'Lista',
  campo: 'Campo',
}

const ROTULOS_ACAO: Record<string, string> = {
  criar: 'Criar',
  importar: 'Importar',
  alterar_campo: 'Alterar campo',
  mudar_status: 'Mudar status',
  gerar_etiqueta: 'Gerar etiqueta',
  excluir: 'Excluir',
  login: 'Login',
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

function formatarValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não'
  return String(valor)
}

// `dados` de um log 'alterar_campo' é um array de diffs `{ campo, de, para }`
// (ver `calcularDiff`, usado pelas actions de Perfis/Listas/Campos/Usuários).
// Resumimos aqui apenas para exibição — tela é somente-leitura.
function resumoAlteracao(dados: unknown): string | null {
  if (!Array.isArray(dados) || dados.length === 0) return null
  const partes = dados
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const campo = 'campo' in item ? String(item.campo) : '?'
      return `${campo}: ${formatarValor(item.de)} → ${formatarValor(item.para)}`
    })
  return partes.length > 0 ? partes.join('; ') : null
}

function DescricaoLog({ log }: { log: LogRow }) {
  const resumo = log.acao === 'alterar_campo' ? resumoAlteracao(log.dados) : null
  return (
    <div className="flex flex-col gap-0.5">
      <span>{log.descricao}</span>
      {resumo && <span className="text-xs text-muted-foreground">{resumo}</span>}
    </div>
  )
}

interface LogsPageProps {
  searchParams: Promise<{
    entidade?: string
    acao?: string
    de?: string
    ate?: string
    pagina?: string
  }>
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const sp = await searchParams
  const paginaSolicitada = Number.parseInt(sp.pagina ?? '0', 10)
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 0

  // `ate` vem de um <input type="date"> (apenas a data); estendemos até o
  // fim do dia para não excluir os registros daquele dia por causa da hora.
  const ateFimDoDia = sp.ate ? `${sp.ate}T23:59:59.999` : undefined

  const { linhas, total } = await consultarLogs({
    entidade: sp.entidade || undefined,
    acao: sp.acao || undefined,
    de: sp.de || undefined,
    ate: ateFimDoDia,
    pagina,
    tamanho: TAMANHO_PAGINA,
  })

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))
  const temAnterior = pagina > 0
  const temProxima = pagina + 1 < totalPaginas

  function hrefPagina(novaPagina: number): string {
    const params = new URLSearchParams()
    if (sp.entidade) params.set('entidade', sp.entidade)
    if (sp.acao) params.set('acao', sp.acao)
    if (sp.de) params.set('de', sp.de)
    if (sp.ate) params.set('ate', sp.ate)
    if (novaPagina > 0) params.set('pagina', String(novaPagina))
    const query = params.toString()
    return query ? `/configuracoes/logs?${query}` : '/configuracoes/logs'
  }

  const mensagemVazio = 'Nenhum log encontrado para os filtros selecionados.'

  return (
    <div className="flex flex-col gap-4">
      <LogsFiltros />

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Descrição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {mensagemVazio}
                </TableCell>
              </TableRow>
            )}
            {linhas.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatadorData.format(new Date(log.created_at))}
                </TableCell>
                <TableCell>{log.usuario_nome || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ROTULOS_ENTIDADE[log.entidade] ?? log.entidade}</Badge>
                </TableCell>
                <TableCell>{ROTULOS_ACAO[log.acao] ?? log.acao}</TableCell>
                <TableCell>
                  <DescricaoLog log={log} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {linhas.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagemVazio}
          </p>
        )}
        {linhas.map((log) => (
          <div key={log.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{ROTULOS_ACAO[log.acao] ?? log.acao}</span>
              <Badge variant="outline">{ROTULOS_ENTIDADE[log.entidade] ?? log.entidade}</Badge>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Data/hora</dt>
                <dd className="min-w-0 flex-1 text-muted-foreground">
                  {formatadorData.format(new Date(log.created_at))}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Usuário</dt>
                <dd className="min-w-0 flex-1">{log.usuario_nome || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Descrição</dt>
                <dd className="min-w-0 flex-1">
                  <DescricaoLog log={log} />
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Página {pagina + 1} de {totalPaginas} — {total} registro{total === 1 ? '' : 's'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Página anterior"
            disabled={!temAnterior}
            render={<Link href={hrefPagina(pagina - 1)} />}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Próxima página"
            disabled={!temProxima}
            render={<Link href={hrefPagina(pagina + 1)} />}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
