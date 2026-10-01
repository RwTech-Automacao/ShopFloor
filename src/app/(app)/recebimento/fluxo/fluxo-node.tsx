'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Ban, ClipboardCheck, Inbox, PackageCheck, Truck } from 'lucide-react'
import {
  CAIXA_DIVERGENCIA,
  ROTULO_CAIXA,
  type CaixaFluxoId,
} from '@/modules/recebimento/domain/etapa-processo'

/**
 * Card de uma caixa do fluxo do Recebimento, no canvas do React Flow.
 *
 * Segue a MESMA anatomia do card do Fluxo do ShopFloor (`shopfloor/fluxo/fluxo-node.tsx`): mini-card
 * com a contagem grudado na borda esquerda, cabeçalho branco com o nome + o que a etapa é e o ícone
 * à direita, e uma subdivisão cinza embaixo com os números. O card é PRÓPRIO porque o do ShopFloor
 * carrega dados que aqui não existem (WIP, devem passar, aprovados de primeira, barra de %).
 */
export interface FluxoRecebimentoNodeData {
  etapa: CaixaFluxoId
  /** O que a etapa é, em uma linha (o subtítulo "teste/inspeção · passagem" do card do ShopFloor). */
  subtitulo: string
  /** Quantos itens estão na caixa agora. */
  itens: number
  /** Quantos deles carregam a marca de divergência. */
  divergentes: number
  /**
   * Quantos itens da EMB já chegaram a esta etapa — os que estão aqui mais os que já seguiram.
   * É o equivalente ao "aprovadas" do card do ShopFloor, e sai das contagens: o fluxo é linear,
   * então quem está no Almoxarifado já passou pela Qualidade. `null` no ramo Reprovado, que não é
   * etapa da fila e por isso não tem barra.
   */
  passaram: number | null
  /** Total de itens da EMB — o denominador da barra. */
  total: number
  selecionado: boolean
}

function icone(etapa: CaixaFluxoId) {
  switch (etapa) {
    case 'recebimento': return <Inbox className="size-5" />
    case 'qualidade': return <ClipboardCheck className="size-5" />
    case 'almoxarifado': return <PackageCheck className="size-5" />
    case 'reprovado': return <Ban className="size-5" />
    case CAIXA_DIVERGENCIA: return <AlertTriangle className="size-5" />
  }
}

function FluxoRecebimentoNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoRecebimentoNodeData

  // O Almoxarifado é o fim do caminho bom: card CHEIO em vinho, igual ao "Concluído" do Fluxo do
  // ShopFloor — mesmo peso visual, contagem no selo claro e sem subdivisão.
  if (d.etapa === 'almoxarifado') {
    return (
      <div className="relative w-[240px] rounded-xl border-2 border-enterplak bg-enterplak text-white shadow-sm">
        <Handle type="target" position={Position.Left} />
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <PackageCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap text-sm font-semibold">{ROTULO_CAIXA[d.etapa]}</p>
            <p className="truncate text-xs text-white/80">
              {d.subtitulo}
              {d.divergentes > 0 && ` · ${d.divergentes} com divergência`}
            </p>
          </div>
          <span
            className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold"
            title={`Itens liberados para produção: ${d.itens}`}
          >
            {d.itens}
          </span>
        </div>
      </div>
    )
  }

  // Os dois ramos — Reprovado e Divergência de quantidade — são desenhados como a Manutenção do
  // Fluxo do ShopFloor: borda vinho e só a contagem, sem barra. "Quantos já passaram" não quer
  // dizer nada num fim de linha nem numa caixa de sinalização.
  const ehRamo = d.etapa === 'reprovado' || d.etapa === CAIXA_DIVERGENCIA
  const passaram = d.passaram ?? 0
  const temBarra = !ehRamo && d.passaram !== null && d.total > 0
  const pct = temBarra ? Math.min(100, (passaram / d.total) * 100) : 0
  const pctDentro = pct >= 85
  // "100%" só quando de fato completou — 99,6% não pode virar 100 e parecer concluído.
  const pctLabel = temBarra && passaram >= d.total
    ? '100'
    : (Math.floor(pct * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

  return (
    <div className="relative w-[220px]">
      {/* Um handle de cada tipo, como no card do ShopFloor: a aresta é FLUTUANTE (ela calcula o
          ponto na borda que aponta pro outro card), então o lado do handle não manda no traçado.
          Os pontos ficam invisíveis por CSS (`.fluxo-canvas`). */}
      <Handle type="target" position={Position.Left} />

      {/* Mini-card da contagem — centrado no cabeçalho (top 28px = metade do h-14), como o WIP. */}
      <div
        title={`Itens nesta etapa agora: ${d.itens}`}
        className={`absolute left-0 top-7 z-10 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 cursor-help items-center justify-center rounded-[10px] border-2 px-1.5 text-sm font-bold shadow-sm ${
          d.itens > 0 ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-muted text-muted-foreground'
        }`}
      >
        {d.itens}
      </div>

      {/* overflow-hidden + anel dão o clip dos cantos e o realce de seleção do card inteiro. */}
      <div className={`overflow-hidden rounded-xl shadow-sm ${d.selecionado ? 'ring-2 ring-enterplak/40' : ''}`}>
        {/* Cabeçalho (a parte branca). Quando a borda é vinho, ela fecha ARREDONDADA nos quatro
            cantos — mesmo tratamento do card Concluído/Manutenção do Fluxo do ShopFloor. */}
        {/* `min-h-14` e não `h-14`: nome comprido (a Divergência de quantidade ocupa duas linhas) com
            subtítulo de duas linhas estourava a altura fixa e vazava por baixo da borda. Os cards de
            nome curto continuam com os mesmos 56 px, então a fileira segue alinhada. */}
        <div className={`flex min-h-14 items-center gap-2 border-2 bg-card py-2 pl-6 pr-3 transition-colors ${ehRamo ? 'border-enterplak' : 'border-border'} ${temBarra ? 'rounded-t-xl' : 'rounded-xl'}`}>
          <div className="min-w-0 flex-1 text-left">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
              {ROTULO_CAIXA[d.etapa]}
            </p>
            <p className="text-xs leading-tight text-muted-foreground">{d.subtitulo}</p>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {icone(d.etapa)}
          </div>
        </div>

        {/* Subdivisão: quantos da EMB já chegaram a esta etapa, na mesma barra verde do card do
            ShopFloor. Substituiu o par de relógios (média e mais antigo), que o usuário tirou. */}
        {temBarra && (
          <div className="flex flex-col gap-1.5 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-2">
            <div
              className="relative h-5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
              title={`Itens que já chegaram a esta etapa: ${d.passaram} de ${d.total}`}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
              <span
                className={`absolute top-1/2 -translate-y-1/2 text-[11px] font-bold leading-none tabular-nums ${pctDentro ? 'text-white' : 'text-foreground'}`}
                style={pctDentro ? { right: `calc(${100 - pct}% + 6px)` } : { left: `calc(${pct}% + 6px)` }}
              >
                {pctLabel}%
              </span>
            </div>
            <div className="flex items-center justify-center gap-3 text-[11px] font-semibold leading-none tabular-nums">
              <span title={`Itens que já chegaram a esta etapa: ${d.passaram} de ${d.total}`}>
                <span className="text-green-700">{d.passaram}</span>
                <span className="text-muted-foreground"> / {d.total}</span>
              </span>
              {d.divergentes > 0 && (
                <span
                  className="inline-flex cursor-help items-center gap-1 text-amber-600"
                  title={`${d.divergentes} ${d.divergentes === 1 ? 'item com divergência' : 'itens com divergência'} de quantidade nesta etapa`}
                >
                  <AlertTriangle className="size-3.5" />
                  {d.divergentes}
                </span>
              )}
            </div>
          </div>
        )}

        {/* O Reprovado não tem subdivisão, então a divergência dele vira um selo solto embaixo.
            A caixa de Divergência não repete o selo: ela INTEIRA já é a divergência. */}
        {ehRamo && d.etapa !== CAIXA_DIVERGENCIA && d.divergentes > 0 && (
          <div className="flex items-center justify-center gap-1 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-1.5 text-[11px] font-semibold leading-none tabular-nums text-amber-600">
            <AlertTriangle className="size-3.5" />
            {d.divergentes}
          </div>
        )}
      </div>

      {/* O Reprovado é fim de linha: dele não sai aresta nenhuma (como a Manutenção do ShopFloor,
          que também não tem handle de saída). */}
      {!ehRamo && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

export const FluxoRecebimentoNode = memo(FluxoRecebimentoNodeBase)

/**
 * Card de INÍCIO do fluxo: a EMB em si, antes do Recebimento.
 *
 * É o irmão da caixa de **Entrada** do Fluxo do ShopFloor (`shopfloor/fluxo/fluxo-node.tsx`, ramo
 * `ehEntrada`): o mesmo bloco vinho de 240 px, ícone num quadrado claro à esquerda, duas linhas de
 * texto no meio (lá PMO · OP + descrição da OP; aqui a EMB + a data de chegada) e a contagem no
 * selo claro à direita. Como lá, não abre painel ao clicar — ele não é etapa, é de onde a carga vem.
 *
 * Componente SEPARADO do card das etapas (o ShopFloor resolve com um `if` dentro do mesmo
 * componente) porque lá os dois casos compartilham o `FluxoNodeData` e aqui não: a EMB não tem
 * etapa, nem divergentes, nem barra. Virando `nodeType` próprio, o card que já está em produção
 * fica intocado.
 */
export interface FluxoEmbNodeData {
  emb: string
  /** Data de chegada da EMB (`aaaa-mm-dd`). `null` = nenhum item da EMB tem data preenchida. */
  dataChegada: string | null
  /** Itens que ainda não começaram a conferência (ver a conta na tela). */
  naoIniciados: number
  /** Total de itens da EMB — o de-onde-saiu da subtração, no tooltip. */
  total: number
}

/**
 * `aaaa-mm-dd` → `dd/mm/aaaa`, na mão.
 *
 * `data_chegada` é coluna DATE: não tem hora nem fuso. Passar por `new Date()` a lê como meia-noite
 * em UTC, e meia-noite em UTC é a VÉSPERA em Brasília — 02/09 apareceria como 01/09. Texto que não
 * casa o formato volta intacto, em vez de virar "Invalid Date".
 */
function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function FluxoEmbNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoEmbNodeData
  return (
    <div className="relative w-[240px] rounded-xl border-2 border-enterplak bg-enterplak text-white shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Truck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={`EMB ${d.emb}`}>EMB {d.emb}</p>
          <p className="truncate text-xs text-white/80">
            {d.dataChegada ? `chegou em ${dataBr(d.dataChegada)}` : 'sem data de chegada'}
          </p>
        </div>
        <span
          className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold"
          title={`Itens que ainda não começaram a conferência: ${d.naoIniciados} de ${d.total} da EMB`}
        >
          {d.naoIniciados}
        </span>
      </div>
      {/* Só saída: a carga entra no fluxo por aqui, nada chega nela de volta. */}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const FluxoEmbNode = memo(FluxoEmbNodeBase)

