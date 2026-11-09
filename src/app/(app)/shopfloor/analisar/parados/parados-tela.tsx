'use client'

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { classeChipTrigger } from '@/lib/chip-trigger'
import type { Intervalo } from '@/modules/alertas/domain/intervalos'
import { formatarLimiteParado, tituloParado } from '@/modules/alertas/domain/parados-texto'
import {
  ROTULOS_AGRUPAR, ROTULOS_ORDEM, ROTULOS_SITUACAO, ROTULOS_TIPO,
  agruparPorOp, agruparPorPosto, filtrarPecas, opcoesDeHoras, ordenarLinhas, postosComPecas, queryDosFiltros,
  type FiltrosParados, type SnParadoTela,
} from '@/modules/alertas/domain/parados-filtros'
import { ParadosRelatorio } from './parados-relatorio'
import { ParadosPorPosto } from './parados-por-posto'

const chaves = <T extends string>(r: Record<T, string>) => Object.keys(r) as T[]

/**
 * Os filtros e a lista. Tempo e situação da OP mudam a consulta (navega, o servidor relê); posto, tipo,
 * agrupar e ordem são aplicados aqui, sobre a mesma resposta, e só atualizam a URL (o link continua valendo).
 */
export function ParadosTela({ sns, turnos, agora, filtros, regraId }: {
  sns: SnParadoTela[]
  turnos: Intervalo[]
  agora: Date
  filtros: FiltrosParados
  regraId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [carregando, startTransition] = useTransition()
  const [f, setF] = useState(filtros)
  const expediente = turnos.length > 0

  function navegar(novo: FiltrosParados) {
    startTransition(() => router.push(`${pathname}?${queryDosFiltros(novo, regraId)}`))
  }
  function local(novo: FiltrosParados) {
    setF(novo)
    window.history.replaceState(null, '', `${pathname}?${queryDosFiltros(novo, regraId)}`)
  }
  function alternarPosto(posto: string) {
    const tem = f.postos.includes(posto)
    local({ ...f, postos: tem ? f.postos.filter((p) => p !== posto) : [...f.postos, posto] })
  }

  const doTipo = useMemo(() => filtrarPecas(sns, { postos: [], tipo: f.tipo }), [sns, f.tipo])
  const postos = useMemo(() => {
    const lista = postosComPecas(doTipo)
    for (const p of f.postos) if (!lista.some((l) => l.posto === p)) lista.push({ posto: p, pecas: 0 })
    return lista.sort((a, b) => a.posto.localeCompare(b.posto, 'pt-BR'))
  }, [doTipo, f.postos])
  const filtradas = useMemo(() => filtrarPecas(doTipo, { postos: f.postos, tipo: 'todos' }), [doTipo, f.postos])
  const ops = useMemo(() => agruparPorOp(filtradas, turnos, agora, f.ordem), [filtradas, turnos, agora, f.ordem])
  const porPosto = useMemo(
    () => (f.agrupar === 'posto' ? ordenarLinhas(agruparPorPosto(filtradas, turnos, agora), f.ordem, (p) => p.posto) : []),
    [f.agrupar, filtradas, turnos, agora, f.ordem],
  )
  const total = ops.reduce((t, o) => t + o.pecas, 0)

  return (
    <div className="flex flex-col gap-4" aria-busy={carregando}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Parada há mais de">
          <Select
            value={String(f.horas)}
            onValueChange={(v) => v && Number(v) !== f.horas && navegar({ ...f, horas: Number(v) })}
          >
            <SelectTrigger className="w-full" disabled={carregando}>
              <SelectValue>{(v: string | null) => formatarLimiteParado(Number(v), expediente)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {opcoesDeHoras(f.horas).map((h) => (
                <SelectItem key={h} value={String(h)}>{formatarLimiteParado(h, expediente)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="OPs">
          <Select
            value={f.situacao}
            onValueChange={(v) => v && v !== f.situacao && navegar({ ...f, situacao: v as FiltrosParados['situacao'] })}
          >
            <SelectTrigger className="w-full" disabled={carregando}>
              <SelectValue>{(v: string | null) => ROTULOS_SITUACAO[v as FiltrosParados['situacao']] ?? ''}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {chaves(ROTULOS_SITUACAO).map((s) => <SelectItem key={s} value={s}>{ROTULOS_SITUACAO[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Tipo de parada">
          <Select value={f.tipo} onValueChange={(v) => v && local({ ...f, tipo: v as FiltrosParados['tipo'] })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => ROTULOS_TIPO[v as FiltrosParados['tipo']] ?? ''}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {chaves(ROTULOS_TIPO).map((t) => <SelectItem key={t} value={t}>{ROTULOS_TIPO[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Ordenar por">
          <Select value={f.ordem} onValueChange={(v) => v && local({ ...f, ordem: v as FiltrosParados['ordem'] })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => ROTULOS_ORDEM[v as FiltrosParados['ordem']] ?? ''}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {chaves(ROTULOS_ORDEM).map((o) => <SelectItem key={o} value={o}>{ROTULOS_ORDEM[o]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Posto</Label>
        <div role="group" aria-label="Filtrar por posto" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={f.postos.length === 0}
            className={classeChipTrigger(f.postos.length === 0, false)}
            onClick={() => local({ ...f, postos: [] })}
          >
            Todos
          </button>
          {postos.map((p) => (
            <button
              key={p.posto}
              type="button"
              aria-pressed={f.postos.includes(p.posto)}
              className={classeChipTrigger(f.postos.includes(p.posto), false)}
              onClick={() => alternarPosto(p.posto)}
            >
              {p.posto} ({p.pecas})
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-medium text-tinta">
          {carregando
            ? 'Carregando…'
            : ops.length === 0
              ? 'Nenhuma peça parada com esses filtros.'
              : tituloParado(total, ops.length, f.horas, expediente)}
        </p>
        <div role="group" aria-label="Agrupar" className="flex items-center gap-2">
          {chaves(ROTULOS_AGRUPAR).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={f.agrupar === a}
              className={classeChipTrigger(f.agrupar === a, false)}
              onClick={() => local({ ...f, agrupar: a })}
            >
              {ROTULOS_AGRUPAR[a]}
            </button>
          ))}
        </div>
      </div>

      {f.agrupar === 'op'
        ? <ParadosRelatorio ops={ops} expediente={expediente} />
        : <ParadosPorPosto postos={porPosto} expediente={expediente} />}
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{rotulo}</Label>
      {children}
    </div>
  )
}
