'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarDashboardGeral } from '@/modules/shopfloor/application/dashboard-actions'
import {
  FILTRO_PADRAO, alternarFiltro, type CliqueDashboard, type DadosDashboard, type FiltroDashboard,
} from '@/modules/shopfloor/domain/dashboard'
import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'
import { PainelDashboard } from './dashboard-painel'

const TODOS = '__todos__'
const ROTULO_STATUS: Record<string, string> = { aberta: 'Em aberto', finalizada: 'Finalizadas', [TODOS]: 'Todas' }

/**
 * Dashboard geral — substitui o relatório do Looker Studio, que lia da planilha do ShopFloor legado.
 * As MÉTRICAS são as do legado (cada gráfico conferido na configuração de lá); os números não batem
 * porque a fonte é outra. Tudo agregado no banco (0101) — o PostgREST corta em 1000 linhas.
 */
export function DashboardGeral({ ordens, postos, colaboradores }: {
  ordens: OrdemPesquisa[]; postos: string[]; colaboradores: string[]
}) {
  const [filtro, setFiltro] = useState<FiltroDashboard>(FILTRO_PADRAO)
  // O Nº de série só vira filtro no Enter ou ao sair do campo: consultar a cada tecla faria uma
  // rodada de agregações por dígito digitado.
  const [snDigitado, setSnDigitado] = useState('')
  const [pagina, setPagina] = useState(0)
  const [dados, setDados] = useState<DadosDashboard | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, start] = useTransition()

  // Recarrega a cada mudança de filtro ou de página. O filtro entra na dependência como JSON porque é
  // um objeto novo a cada render — comparar por referência recarregaria sempre.
  const chave = JSON.stringify(filtro)
  useEffect(() => {
    start(async () => {
      const r = await carregarDashboardGeral(filtro, pagina)
      if (r.ok) { setDados(r.dados); setErro(null) }
      else { setDados(null); setErro(r.erro); toast.error(r.erro) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `chave` já representa o filtro inteiro
  }, [chave, pagina])

  // As listas dos filtros saem das OPs cadastradas — não do resultado, senão o filtro sumiria
  // justamente quando o recorte não tem dado, e a pessoa ficaria sem como voltar atrás.
  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))].sort(), [ordens])
  const pmos = useMemo(() => {
    const base = filtro.cliente ? ordens.filter((o) => o.cliente === filtro.cliente) : ordens
    return [...new Set(base.map((o) => o.pmo))].sort()
  }, [ordens, filtro.cliente])
  const ops = useMemo(() => {
    const base = ordens.filter((o) => (!filtro.cliente || o.cliente === filtro.cliente) && (!filtro.pmo || o.pmo === filtro.pmo))
    return [...new Set(base.map((o) => o.op))].sort()
  }, [ordens, filtro.cliente, filtro.pmo])

  // Trocar um filtro volta pra primeira página: manter a página 3 num recorte que só tem 1 é mostrar
  // tela vazia sem explicar por quê.
  function mudar(patch: Partial<FiltroDashboard>) {
    setPagina(0)
    setFiltro((f) => ({ ...f, ...patch }))
  }
  function aplicarSn() {
    if (snDigitado.trim() !== filtro.sn) mudar({ sn: snDigitado.trim() })
  }
  // Clique num gráfico: filtra a tela inteira, ou desfaz se o item já é o filtro ativo (como no legado).
  function clicar(clique: CliqueDashboard) {
    setPagina(0)
    setFiltro((f) => alternarFiltro(f, clique))
  }
  function limpar() {
    setSnDigitado('')
    setPagina(0)
    setFiltro(FILTRO_PADRAO)
  }

  const alterado = chave !== JSON.stringify(FILTRO_PADRAO)

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Filtros: uma faixa acima de tudo, e tudo abaixo responde a ela ---------- */}
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <CampoSelect rotulo="Cliente" valor={filtro.cliente} opcoes={clientes}
            onChange={(v) => mudar({ cliente: v, pmo: '', op: '' })} />
          <CampoSelect rotulo="PMO" valor={filtro.pmo} opcoes={pmos} onChange={(v) => mudar({ pmo: v, op: '' })} />
          <CampoSelect rotulo="OP" valor={filtro.op} opcoes={ops} onChange={(v) => mudar({ op: v })} />
          <div className="flex flex-col gap-1.5">
            <Label>Status da OP</Label>
            <Select value={filtro.statusOp === '' ? TODOS : filtro.statusOp}
              onValueChange={(v) => mudar({ statusOp: !v || v === TODOS ? '' : (v as 'aberta' | 'finalizada') })}>
              <SelectTrigger className="h-9">
                <SelectValue>
                  {(v: string | null) => ROTULO_STATUS[String(v ?? TODOS)] ?? 'Todas'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aberta">Em aberto</SelectItem>
                <SelectItem value="finalizada">Finalizadas</SelectItem>
                <SelectItem value={TODOS}>Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CampoSelect rotulo="Posto" valor={filtro.posto} opcoes={postos} onChange={(v) => mudar({ posto: v })} />
          <CampoSelect rotulo="Colaborador" valor={filtro.colaborador} opcoes={colaboradores}
            onChange={(v) => mudar({ colaborador: v })} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-sn">Nº de série</Label>
            <Input id="dash-sn" value={snDigitado} className="h-9" placeholder="Enter para buscar"
              onChange={(e) => setSnDigitado(e.target.value)}
              onBlur={aplicarSn}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicarSn() }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-de">De</Label>
            <Input id="dash-de" type="date" value={filtro.de} className="h-9" onChange={(e) => mudar({ de: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-ate">Até</Label>
            <Input id="dash-ate" type="date" value={filtro.ate} className="h-9" onChange={(e) => mudar({ ate: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="h-9 w-full" disabled={!alterado && snDigitado === ''} onClick={limpar}>
              Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filtros que só existem pelo clique não têm campo na faixa de cima: sem estas etiquetas a tela
          ficaria filtrada sem dizer por quê. OP e posto aparecem nos próprios campos. */}
      <FiltrosDoClique filtro={filtro} onTirar={(campo) => mudar({ [campo]: '' })} />

      {erro && !carregando && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">{erro}</p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Se este ambiente é novo, confira se a migração <span className="font-mono">0101</span> foi aplicada.
          </p>
        </div>
      )}
      {carregando && !dados && !erro && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {dados && (
        <PainelDashboard dados={dados} carregando={carregando} pagina={pagina}
          onPagina={(p) => setPagina(p)} filtro={filtro} onClique={clicar} />
      )}
    </div>
  )
}

const ROTULO_CLIQUE = { status: 'Status', tipo: 'Tipo do defeito', defeito: 'Defeito', posicao: 'Posição' } as const
type CampoClique = keyof typeof ROTULO_CLIQUE

/** Etiquetas dos filtros aplicados pelo clique, cada uma com ✕ pra tirar. Some quando não há nenhum. */
function FiltrosDoClique({ filtro, onTirar }: { filtro: FiltroDashboard; onTirar: (campo: CampoClique) => void }) {
  const ativos = (Object.keys(ROTULO_CLIQUE) as CampoClique[]).filter((c) => filtro[c] !== '')
  if (ativos.length === 0) {
    return (
      <p className="-mt-1 text-xs text-muted-foreground">
        Dica: clique numa OP, num posto, em Aprovado/Reprovado, num tipo, defeito ou posição pra filtrar a tela inteira.
      </p>
    )
  }
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">Filtrado por clique:</span>
      {ativos.map((c) => {
        const valor = c === 'defeito' ? rotuloDefeito(filtro.defeito) : filtro[c]
        return (
          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-enterplak/10 py-0.5 pl-3 pr-1 text-foreground dark:bg-enterplak/25">
            <span className="text-muted-foreground">{ROTULO_CLIQUE[c]}:</span>
            <span className="font-medium">{valor}</span>
            <button type="button" onClick={() => onTirar(c)} aria-label={`Tirar o filtro ${ROTULO_CLIQUE[c]}`}
              className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <X className="size-3.5" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

function rotuloDefeito(codigo: string): string {
  const { numero, descricao } = separarCodigoDefeito(codigo)
  const texto = capitalizarDescricaoDefeito(descricao) || codigo
  return numero ? `${numero} · ${texto}` : texto
}

/** Select de filtro com a opção "todos" — repetido em Cliente/PMO/OP/Posto/Colaborador. */
function CampoSelect({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: string; opcoes: string[]; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{rotulo}</Label>
      <Select value={valor === '' ? TODOS : valor} onValueChange={(v) => onChange(!v || v === TODOS ? '' : v)}>
        <SelectTrigger className="h-9">
          {/* O Select do projeto (Base UI) mostra o VALOR cru sem uma função de renderização —
              apareceria "__todos__" na tela. Mesmo padrão dos filtros de Registros. */}
          <SelectValue placeholder="Todos">
            {(v: string | null) => (!v || v === TODOS ? 'Todos' : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
