'use client'

import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Wrench, Package, GitMerge, ThermometerSun, ShieldCheck, ClipboardCheck, CircleDot, Check, Inbox, PackageCheck, AlertTriangle,
} from 'lucide-react'
import type { FluxoNodeData } from '@/modules/shopfloor/domain/fluxo-op'
import { formatarQuantidade, type EstoqueCompels } from '@/modules/shopfloor/domain/estoque-compels'
import { lerEstoqueCompelsAction } from '@/modules/shopfloor/application/estoque-compels-actions'

export interface FluxoNodePayload extends FluxoNodeData {
  selecionado: boolean
  emRota?: boolean // busca de SN: este posto está na rota da peça (contorno vinho fixo)
  atualRota?: boolean // busca de SN: posição ATUAL da peça (anel mais forte)
  animarRota?: boolean // este card acabou de ser revelado → faz o giro 1× (senão fica só o contorno fixo)
  foraRota?: boolean // busca de SN ativa e este posto NÃO está na rota (esmaece)
  mostrarPeriodo?: boolean // Onda 3: contagens do card vêm do período (não do total)
  periodoAprovadas?: number // aprovadas na janela do filtro (posto com status)
  periodoReprovadas?: number // reprovadas na janela do filtro (posto com status)
  periodoRegistros?: number // bipes na janela do filtro (posto de passagem usa isto)
}

/** Ícone por tipo de posto (recurso do perfil; teste/inspeção caem no ClipboardCheck via temStatus).
 *  Exportado pra reuso (ex.: tela de Defeitos usa o ícone do posto onde o defeito foi registrado). */
export function iconePorRecurso(recurso: string, temStatus: boolean, className = 'size-5') {
  switch (recurso) {
    case 'manutencao': return <Wrench className={className} />
    case 'caixa': return <Package className={className} />
    case 'integracao': return <GitMerge className={className} />
    case 'burnin': return <ThermometerSun className={className} strokeWidth={2.25} />
    case 'nqa': return <ShieldCheck className={className} />
    // Mesmo ícone do card "Concluído" (a caixa de Saída): diz "entrou no estoque".
    case 'almoxarifado': return <PackageCheck className={className} />
    default: return temStatus ? <ClipboardCheck className={className} /> : <CircleDot className={className} />
  }
}


/** Cache do navegador (1 min por PMO): o nó re-renderiza e remonta com frequência (zoom, arrasto, modo TV). */
const CACHE_ESTOQUE_MS = 60_000
const cacheEstoque = new Map<string, { ate: number; resultado: EstoqueCompels }>()

/**
 * Estoque do Compels, ABAIXO do card Concluído (solto, sem aumentar o nó: as arestas continuam apontando para o
 * card). Consulta na hora, uma vez por PMO por minuto. É o estoque PRÓPRIO do item em TODOS os estoques do
 * Compels: contexto, não a conferência do que esta OP deu entrada. Sem o login do Compels neste ambiente, não
 * mostra nada.
 */
export function EstoqueCompelsCard({ pmo }: { pmo: string }) {
  const [estado, setEstado] = useState<EstoqueCompels | 'carregando'>(() => {
    const guardado = cacheEstoque.get(pmo)
    return guardado && guardado.ate > Date.now() ? guardado.resultado : 'carregando'
  })

  useEffect(() => {
    const guardado = cacheEstoque.get(pmo)
    if (guardado && guardado.ate > Date.now()) return
    let vivo = true
    lerEstoqueCompelsAction(pmo)
      .then((r) => {
        cacheEstoque.set(pmo, { ate: Date.now() + (r.tipo === 'indisponivel' ? 15_000 : CACHE_ESTOQUE_MS), resultado: r })
        if (vivo) setEstado(r)
      })
      .catch(() => { if (vivo) setEstado({ tipo: 'indisponivel' }) })
    return () => { vivo = false }
  }, [pmo])

  if (estado !== 'carregando' && estado.tipo === 'nao_configurado') return null

  let corpo: React.ReactNode
  let dica = ''
  if (estado === 'carregando') {
    corpo = <span className="text-muted-foreground">consultando…</span>
  } else if (estado.tipo === 'ok') {
    corpo = (
      <span className="font-semibold tabular-nums text-foreground">
        {formatarQuantidade(estado.proprio)} {estado.unidade}
      </span>
    )
    dica = `Estoque próprio de ${pmo} no Compels, somando todos os estoques. Em pendência: ${formatarQuantidade(estado.pendencia)} · em terceiros: ${formatarQuantidade(estado.emTerceiros)} · de terceiros: ${formatarQuantidade(estado.deTerceiros)}. Consultado agora há pouco; não é só o que esta OP deu entrada.`
  } else if (estado.tipo === 'nao_encontrado') {
    corpo = <span className="text-muted-foreground">item não encontrado</span>
  } else {
    corpo = <span className="text-amber-600">indisponível</span>
    dica = 'Não foi possível consultar o Compels agora. Tente de novo em instantes.'
  }

  return (
    <div
      title={dica || undefined}
      className="absolute left-0 top-full mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
    >
      <span className="truncate">Estoque no Compels · {pmo}</span>
      {corpo}
    </div>
  )
}

function iconeDo(d: FluxoNodePayload) {
  return iconePorRecurso(d.recurso, d.temStatus, 'size-5')
}

function FluxoNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoNodePayload

  // Realce da busca de SN (estilo n8n): contorno VINHO GIRANDO em volta do card (overlay .fluxo-borda-rota);
  // posição atual ganha um anel extra; fora da rota esmaece.
  const naRota = d.emRota === true || d.atualRota === true
  // Contorno FIXO (ring) do card na rota; o giro (bordaRota) passa 1× por cima e some. Atual = anel mais grosso.
  const realceRota = naRota ? (d.atualRota ? 'ring-[3px] ring-enterplak' : 'ring-2 ring-enterplak') : ''
  const transRota = (d.emRota || d.atualRota || d.foraRota) ? 'transition-opacity duration-300' : ''
  const atenuaRota = d.foraRota ? 'opacity-30' : ''
  // Giro do contorno: SÓ no card recém-revelado (passa 1× e some). Já revelados ficam só com o anel fixo
  // (realceRota) → nada reinicia em re-render.
  const bordaRota = d.animarRota ? <span aria-hidden className="fluxo-borda-rota pointer-events-none absolute inset-0 z-10 rounded-xl" /> : null

  // Caixas de Entrada/Saída: bloco em vinho predominante, só com a contagem (sem detalhe ao clicar).
  if (d.ehEntrada || d.ehSaida) {
    const descCurta = d.descricao ? (d.descricao.length > 20 ? d.descricao.slice(0, 20) + '…' : d.descricao) : ''
    // Entrada: principal = PMO · OP, subtítulo = descrição. Saída: "Concluído" · "finalizadas".
    const principal = d.ehEntrada ? ([d.pmo, d.op].filter(Boolean).join(' · ') || 'Entrada') : 'Concluído'
    const sub = d.ehEntrada ? descCurta : 'finalizadas'
    return (
      <div className={`relative w-[240px] rounded-xl border-2 border-enterplak bg-enterplak text-white shadow-sm ${realceRota || (d.selecionado ? 'ring-2 ring-enterplak/40' : '')} ${atenuaRota} ${transRota}`}>
        {bordaRota}
        {d.ehSaida && <Handle type="target" position={Position.Left} />}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
            {d.ehEntrada ? <Inbox className="size-5" /> : <PackageCheck className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap text-sm font-semibold" title={d.ehEntrada ? `PMO ${d.pmo ?? '—'} · OP ${d.op ?? '—'}` : undefined}>{principal}</p>
            {sub && <p className="truncate text-xs text-white/80" title={d.ehEntrada ? d.descricao : undefined}>{sub}</p>}
          </div>
          <span
            className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold"
            title={d.ehEntrada ? `Peças não iniciadas: ${d.wip}` : `Peças finalizadas: ${d.wip}`}
          >
            {d.wip}
          </span>
        </div>
        {d.ehEntrada && <Handle type="source" position={Position.Right} />}
        {d.ehSaida && d.pmo && <EstoqueCompelsCard pmo={d.pmo} />}
      </div>
    )
  }

  // Card do posto: UM card com SUBDIVISÃO interna (cabeçalho em cima + barra/métricas embaixo, separados
  // por border-t): contagem/barra por APROVADAS (reprovados fora); nome à esquerda (alinhado ao mini-card);
  // "aprovados de primeira" vira % (aprovadosPrimeira ÷ o-que-passou) com CHECK; reprovados = número com
  // "!"; sem anel ao concluir. Tooltips (title) explicam o significado E a conta.
  // Onda 3: com filtro de período, as contagens do card viram as da JANELA (não do total).
  // Posto de passagem (sem status) usa REGISTROS (bipes); posto com status usa APROVADAS.
  const mostrarP = d.mostrarPeriodo === true
  const aprovDisp = mostrarP
    ? (d.temStatus ? (d.periodoAprovadas ?? 0) : (d.periodoRegistros ?? 0))
    : d.passou // d.passou = aprovadas (com status) ou registros (passagem) — corrige passagem mostrando 0
  const reprovDisp = mostrarP ? (d.periodoReprovadas ?? 0) : d.reprovadosSemReteste
  const pctRaw = d.devemPassar && d.devemPassar > 0 ? (aprovDisp / d.devemPassar) * 100 : 0
  const pctB = Math.min(100, pctRaw) // largura da barra (aceita decimal)
  // A % acompanha a borda direita do verde (preta, no trilho) enquanto há espaço; perto de 100% entra pra
  // dentro do verde (branca, pra ler). Mesmo comportamento do card antigo.
  const pctDentroB = pctB >= 85
  // Rótulo da %: "100%" SÓ quando de fato completou (passou ≥ devem passar). Senão, até 2 casas decimais
  // TRUNCADAS (floor) — pra 99,55% NÃO virar 100% (parecia concluído sem estar). Inteiros ficam sem casas.
  const completoPct = d.devemPassar != null && d.devemPassar > 0 && aprovDisp >= d.devemPassar
  const pctLabel = completoPct ? '100' : (Math.floor(pctRaw * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  // Denominador do % de 1ª = TOTAL de peças distintas que tiveram veredito no posto = passou (distinto) +
  // reprovados sem reteste (distinto). Antes usava `aprovadas` (bipe-count) → inflava e subestimava o %.
  const basePassou = d.passou + d.reprovadosSemReteste
  const fpPct = basePassou > 0 ? Math.round((d.aprovadosPrimeira / basePassou) * 100) : 0
  const rotuloQtd = d.temStatus ? 'Aprovadas' : 'Passaram'
  // O ALMOXARIFADO é o único posto cujo trabalho continua DEPOIS do bipe, e por isso o único com
  // métricas próprias: a fila na porta ("Disponível Produção"), as caixas (a unidade em que o
  // operador conta numa OP coletiva) e um denominador que é o que CHEGOU EMBALADO — não a qtd da OP.
  // Todo o resto do card (e todos os outros postos) continua exatamente como antes.
  const ehAlmox = d.recurso === 'almoxarifado'
  // Caixa só existe em OP COLETIVA; na individual o dado nem vem e a linha não aparece. No filtro de
  // período a linha some também: caixa bipada é acumulado da OP e misturar com a contagem da janela
  // faria o card mentir (mesmo motivo de esconder o % de 1ª ali).
  const temCaixas = ehAlmox && !mostrarP && d.caixasBipadas != null && d.caixasFechadas != null
  const tipAprovAlmox = mostrarP
    ? `Entradas no estoque no período: ${aprovDisp} (de ${d.devemPassar ?? '—'} que chegaram embaladas — total da OP)`
    : `Deram entrada no estoque ÷ o que chegou embalado: ${aprovDisp} de ${d.devemPassar ?? '—'}. O denominador é o que chegou embalado (entradas + Disponível Produção), NÃO a quantidade da OP: peça sucateada ou em manutenção nunca chega aqui.`
  const tipDisponivel = `Disponível Produção: ${d.wip} peça(s) que passaram por todos os postos menos este — prontas, embaladas, esperando dar entrada no estoque. Cada bipe tira uma daqui.`
  const tipCaixas = `Caixas bipadas ÷ caixas fechadas da OP: ${d.caixasBipadas} de ${d.caixasFechadas} (total). Na OP coletiva o bipe é por caixa: uma caixa vale todas as peças dela.`
  const tipAprov = ehAlmox
    ? tipAprovAlmox
    : mostrarP
    ? `${rotuloQtd} no período: ${aprovDisp} (de ${d.devemPassar ?? '—'} da OP)`
    : `${rotuloQtd} ÷ devem passar: ${aprovDisp} de ${d.devemPassar ?? '—'}`
  const tipFp = `Aprovados de primeira: ${d.aprovadosPrimeira} de ${basePassou} que passaram = ${fpPct}% (total)`
  const tipRep = mostrarP
    ? `Reprovadas no período: ${reprovDisp}`
    : `Reprovados sem reteste: ${reprovDisp} peça(s) com o último registro reprovado`
  const temSub = !d.ehManutencao && d.devemPassar != null
  // Concluído/Manutenção realçam SÓ o cabeçalho (parte branca): a borda vinho fica no topo e
  // a subdivisão de baixo mantém a borda cinza. Selecionado realça o card inteiro (anel).
  const bordaTopo = d.concluido || d.ehManutencao ? 'border-enterplak' : 'border-border'
  return (
    <div className={`relative w-[220px] ${atenuaRota} ${transRota}`}>
      {bordaRota}
      <Handle type="target" position={Position.Left} />

      {/* WIP mini-card — centrado no CABEÇALHO (top 28px = metade do h-14). */}
      <div
        title={ehAlmox ? tipDisponivel : `Em processo neste posto (WIP): ${d.wip}`}
        className={`absolute left-0 top-7 z-10 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 cursor-help items-center justify-center rounded-[10px] border-2 px-1.5 text-sm font-bold shadow-sm ${
          d.wip > 0 ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-muted text-muted-foreground'
        }`}
      >
        {d.wip}
      </div>

      {/* overflow-hidden + anel dão o clip dos cantos e o realce de seleção do card inteiro. */}
      <div className={`overflow-hidden rounded-xl shadow-sm ${realceRota || (d.selecionado ? 'ring-2 ring-enterplak/40' : '')} ${transRota}`}>
        {/* Cabeçalho (parte branca): borda de destaque (vinho quando concluído) no topo, laterais E na
            base — essa base vira a linha divisória, então o vinho também "cruza o meio". */}
        <div className={`flex h-14 items-center gap-2 border-2 bg-card pl-6 pr-3 transition-colors ${bordaTopo} ${temSub ? (d.concluido || d.ehManutencao ? 'rounded-xl' : 'rounded-t-xl') : 'rounded-xl'}`}>
          <div className="min-w-0 flex-1 text-left">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{d.posto}</p>
            <p className="text-xs text-muted-foreground">
              {d.ehManutencao ? 'em manutenção' : d.temStatus ? 'teste/inspeção' : 'passagem'}
            </p>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {iconeDo(d)}
          </div>
        </div>

        {/* Subdivisão — laterais e base SEMPRE cinza; o topo é a borda de baixo do cabeçalho (a divisória vinho). */}
        {temSub && (
          <div className="flex flex-col gap-1.5 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-2">
            <div className="relative h-5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10" title={tipAprov}>
              <div className="absolute inset-y-0 left-0 rounded-full bg-green-600" style={{ width: `${pctB}%` }} />
              <span
                className={`absolute top-1/2 -translate-y-1/2 text-[11px] font-bold leading-none tabular-nums ${pctDentroB ? 'text-white' : 'text-foreground'}`}
                style={pctDentroB ? { right: `calc(${100 - pctB}% + 6px)` } : { left: `calc(${pctB}% + 6px)` }}
              >
                {pctLabel}%
              </span>
            </div>
            {ehAlmox ? (
              <>
                {/* Peças E caixas: numa OP coletiva o operador está olhando pra dez caixas empilhadas,
                    não pra 140 peças. Sem caixa (OP individual) fica só a linha das peças. */}
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold leading-none tabular-nums">
                  <span className="cursor-help" title={tipAprov}>
                    <span className="text-green-700">{aprovDisp}</span>
                    <span className="text-muted-foreground">/{d.devemPassar} peças</span>
                  </span>
                  {temCaixas && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="cursor-help" title={tipCaixas}>
                        <span className="text-foreground">{d.caixasBipadas}</span>
                        <span className="text-muted-foreground">/{d.caixasFechadas} caixas</span>
                      </span>
                    </>
                  )}
                </div>
                {/* A fila na porta do almoxarifado. O número já existia (é o WIP do mini-card); aqui
                    ele ganha NOME, porque neste posto ele responde "o que tem pra dar entrada agora". */}
                <div className="flex cursor-help items-center justify-center gap-1 text-[10px] leading-none" title={tipDisponivel}>
                  <span className="text-muted-foreground">Disponível Produção</span>
                  <span className="font-bold tabular-nums text-foreground">{d.wip}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center gap-3 text-[11px] font-semibold leading-none tabular-nums">
                <span title={tipAprov}><span className="text-green-700">{aprovDisp}</span> <span className="text-muted-foreground">/ {d.devemPassar}</span></span>
                {d.temStatus && (
                  <>
                    {!mostrarP && (
                      <span className="inline-flex cursor-help items-center gap-1 text-green-700" title={tipFp}>
                        <Check className="size-3.5" />{fpPct}%
                      </span>
                    )}
                    <span className="inline-flex cursor-help items-center gap-1 text-amber-600" title={tipRep}>
                      <AlertTriangle className="size-3.5" />{reprovDisp}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!d.ehManutencao && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

export const FluxoNode = memo(FluxoNodeBase)
