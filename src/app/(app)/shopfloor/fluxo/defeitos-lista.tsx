'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { carregarDefeitosDaOp, carregarResumoDefeitos } from '@/modules/shopfloor/application/pesquisa-actions'
import type { DefeitoDaOp, ResumoDefeito } from '@/modules/shopfloor/infra/pesquisa-repository'
import { capitalizarDescricaoDefeito, formatarTituloDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import { iconePorRecurso } from './fluxo-node'

// Data/hora do "card de notificação" (dd/MM HH:mm:ss); título mostra a completa.
const fmtCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' })
const fmtLongo = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })

/** Quantos defeitos recentes a tela mostra. O histórico completo continua na Pesquisa/Registros —
 *  aqui é painel de acompanhamento: o que acabou de acontecer + o ranking ao lado. */
const ULTIMOS = 6
/** Polling: mesmo padrão do canvas do Fluxo (intervalo curto + pausa com a aba escondida). */
const INTERVALO_MS = 15_000

export interface PostoInfo { recurso: string; temStatus: boolean }

/** Lista dos ÚLTIMOS defeitos de UMA OP (por pmo/op) + ranking do total ao lado (70/30).
 *  Cada card mostra quantas vezes AQUELE mesmo defeito ocorreu na última hora; o campeão da hora
 *  fica vermelho. Atualiza sozinha (polling). Reusada: painel de Defeitos do Fluxo + modo apresentação. */
export function DefeitosLista({
  pmo,
  op,
  postos,
  postoInfo,
}: {
  pmo: string
  op: string
  postos?: string[]
  postoInfo?: Record<string, PostoInfo>
}) {
  const [linhas, setLinhas] = useState<DefeitoDaOp[]>([])
  const [resumo, setResumo] = useState<ResumoDefeito[]>([])
  const [buscou, setBuscou] = useState(false)
  const [postoFiltro, setPostoFiltro] = useState('') // '' = todos
  const [carregando, startCarregar] = useTransition()

  useEffect(() => {
    if (!pmo || !op) return
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ao trocar de OP/posto antes de recarregar
    setLinhas([]); setResumo([]); setBuscou(false)

    // Lista e ranking vêm juntos: são a mesma foto do mesmo instante (senão o "campeão da hora"
    // pisca em cima de uma lista de outro momento).
    const atualizar = async (primeira: boolean) => {
      const [rLista, rResumo] = await Promise.all([
        carregarDefeitosDaOp(pmo, op, 0, postoFiltro, ULTIMOS),
        carregarResumoDefeitos(pmo, op, postoFiltro),
      ])
      if (!vivo) return
      // Erro só incomoda na 1ª carga: no polling (a cada 15s) um toast por falha viraria spam na TV.
      if (rLista.ok) { setLinhas(rLista.linhas); setBuscou(true) } else if (primeira) toast.error(rLista.erro)
      if (rResumo.ok) setResumo(rResumo.resumo)
    }

    startCarregar(async () => { await atualizar(true) })
    // Defeito novo aparece sozinho. PERF: pula o tick com a aba escondida (Page Visibility) — igual
    // ao canvas do Fluxo, pra painel em 2º plano não martelar o banco; ao voltar, atualiza na hora.
    const t = setInterval(() => { if (!document.hidden) void atualizar(false) }, INTERVALO_MS)
    const onVis = () => { if (!document.hidden) void atualizar(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [pmo, op, postoFiltro])

  // codigo → contagens (o card lê a sua); o ranking já vem ordenado por total desc do banco.
  const porCodigo = useMemo(() => new Map(resumo.map((r) => [r.codigo, r])), [resumo])
  const totalGeral = useMemo(() => resumo.reduce((s, r) => s + r.total, 0), [resumo])
  const maiorTotal = resumo[0]?.total ?? 0
  // Maior ocorrência DA ÚLTIMA HORA — é o que pinta de vermelho. Empate pinta todos os empatados
  // (esconder um deles seria mentir sobre qual é o pior problema do momento).
  const maiorHora = useMemo(() => resumo.reduce((m, r) => Math.max(m, r.ultimaHora), 0), [resumo])

  // Ícone do posto onde o defeito foi registrado (recurso do perfil); cai na exclamação se desconhecido.
  function iconeDoPosto(posto: string, cls: string) {
    const info = postoInfo?.[posto]
    if (!info) return <AlertTriangle className={cls} />
    return iconePorRecurso(info.recurso, info.temStatus, cls)
  }

  // O filtro por posto fica ESCONDIDO até o mouse passar pelo cabeçalho (pedido do usuário: a tela é
  // de acompanhamento, o filtro só atrapalha a leitura). `invisible` (e não `hidden`) reserva o
  // espaço → o cabeçalho não pula de altura, e a área continua sendo alvo do hover. Com filtro
  // aplicado ele fica visível pra ninguém ficar sem entender por que a lista está curta.
  const filtroVisivel = postoFiltro !== '' ? '' : 'invisible group-hover:visible group-focus-within:visible'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="group flex shrink-0 flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {/* Total vem do ranking (agregado); sem ele — RPC indisponível — melhor não mostrar número. */}
          Defeitos {buscou && resumo.length > 0 && <>({totalGeral})</>}
        </p>
        {/* Filtro por posto (server-side) — some até o mouse chegar perto. */}
        {postos && postos.length > 0 && (
          <div className={`flex flex-wrap items-center gap-1 text-xs ${filtroVisivel}`}>
            <button
              type="button"
              onClick={() => setPostoFiltro('')}
              className={`rounded-full border px-2.5 py-1 font-medium ${postoFiltro === '' ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}
            >
              Todos
            </button>
            {postos.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPostoFiltro(p)}
                className={`rounded-full border px-2.5 py-1 font-medium ${postoFiltro === p ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {carregando && !buscou && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {buscou && linhas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum defeito {postoFiltro ? `no posto ${postoFiltro}` : 'registrado nesta OP'}.</p>
      )}

      {linhas.length > 0 && (
        // 70% lista / 30% ranking no desktop e na TV; empilhado no retrato do tablet (onde 30% de
        // largura não caberia). min-h-0 nos dois lados pra cada coluna rolar por dentro.
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[7fr_3fr]">
          <div className="min-h-0 overflow-y-auto">
            {/* Pilha de "notificações" GRANDES — os 6 últimos ocupam a tela, legíveis de longe. */}
            <ul className="flex w-full flex-col gap-3 p-1">
              {linhas.map((l, i) => {
                const dt = l.dataHora ? new Date(l.dataHora) : null
                // Posto onde foi REPROVADO: usa posto_origem (ex.: reparo na Manutenção guarda o posto do teste).
                const postoReprova = l.postoOrigem || l.posto
                // Sigla P/T vem do CATÁLOGO; o texto do registro é livre ('SMD', 'Funcional'…) e só
                // serve de reserva quando o código saiu do catálogo.
                const titulo = formatarTituloDefeito({ codigo: l.codigo, posicao: l.posicao, tipo: l.tipo })
                const cont = porCodigo.get(l.codigo)
                const naHora = cont?.ultimaHora ?? 0
                const campeao = naHora > 0 && naHora === maiorHora
                return (
                  <li
                    // Chave estável entre os ticks do polling: mesmo defeito = mesmo card (sem piscar).
                    key={`${l.dataHora}|${l.sn}|${l.codigo}|${l.posicao}|${i}`}
                    className={`flex min-h-[7.5rem] items-center gap-5 rounded-3xl border px-6 py-5 shadow-sm backdrop-blur ${campeao ? 'border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-950/40' : 'border-border bg-card/95'}`}
                  >
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                      {iconeDoPosto(postoReprova, 'size-9')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-2xl font-bold text-foreground">{titulo.texto}</p>
                      <p className="mt-1 truncate text-xl font-medium text-foreground/80">{postoReprova}</p>
                      <p className="truncate text-lg text-muted-foreground">
                        {[`SN ${l.sn}`, l.colaborador ? `por ${l.colaborador}` : ''].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {/* Data/hora do defeito e, abaixo, quantos defeitos SEMELHANTES (mesmo código)
                        houve na última hora — o campeão em vermelho. */}
                    <div className="flex shrink-0 flex-col items-center gap-2">
                      <span className="whitespace-nowrap text-lg text-muted-foreground" title={dt ? fmtLongo.format(dt) : ''}>
                        {dt ? fmtCurto.format(dt) : '—'}
                      </span>
                      {naHora > 0 && (
                        <div
                          className={`flex flex-col items-center justify-center rounded-2xl border px-4 py-2 ${campeao ? 'border-red-500 bg-red-600 text-white' : 'border-border bg-muted text-foreground'}`}
                          title={`${naHora} ocorrência(s) deste mesmo defeito na última hora`}
                        >
                          <span className="text-3xl font-bold leading-none tabular-nums">{naHora}</span>
                          <span className={`text-xs font-medium ${campeao ? 'text-white' : 'text-muted-foreground'}`}>na última hora</span>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* RANKING (30%): total por defeito na OP inteira (respeita o filtro de posto). */}
          <aside className="flex min-h-0 flex-col rounded-3xl border border-border bg-card/95 p-3">
            <div className="flex shrink-0 items-baseline justify-between gap-2 px-1 pb-2">
              <p className="text-base font-semibold text-foreground">Ranking</p>
              <p className="text-sm text-muted-foreground">{totalGeral} no total</p>
            </div>
            <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {resumo.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Sem dados de ranking.</li>}
              {resumo.map((r, i) => {
                const { numero, descricao } = separarCodigoDefeito(r.codigo)
                // Barra proporcional ao 1º colocado — comparação visual sem precisar ler os números.
                const pct = maiorTotal > 0 ? Math.max(4, Math.round((r.total / maiorTotal) * 100)) : 0
                return (
                  <li key={r.codigo || i} className="relative overflow-hidden rounded-xl px-2 py-1.5">
                    {/* Fundo sólido (sem opacity: texto com opacity vira imagem na impressão/PDF). */}
                    <div className="absolute inset-y-0 left-0 rounded-xl bg-red-100 dark:bg-red-950/60" style={{ width: `${pct}%` }} aria-hidden />
                    <div className="relative flex items-center gap-2">
                      <span className="w-6 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{i + 1}º</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={r.codigo}>
                        {capitalizarDescricaoDefeito(descricao) || numero || 'Sem código'}
                        {numero && descricao && <span className="ml-1 text-xs text-muted-foreground">Cod.: {numero}</span>}
                      </span>
                      {r.ultimaHora > 0 && (
                        <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums" title="na última hora">
                          +{r.ultimaHora}
                        </span>
                      )}
                      <span className="w-10 shrink-0 text-right text-base font-bold tabular-nums text-foreground">{r.total}</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </aside>
        </div>
      )}
    </div>
  )
}
