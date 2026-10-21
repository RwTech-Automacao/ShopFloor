'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  chaveDaOp,
  filtrarPorOp,
  horaCurta,
  opsComPendencia,
  type PendenciaAlmoxarifado,
} from '@/modules/shopfloor/domain/almoxarifado'

export type EstadoLista =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; erro: string }
  | { tipo: 'ok'; itens: PendenciaAlmoxarifado[] }

const pecas = (n: number) => (n === 1 ? '1 peça' : `${n} peças`)

/** A lista de pendências do Almoxarifado: um cartão por caixa (OP coletiva) ou lote do NQA (OP individual). */
export function ListaCartoes({
  estado,
  onEscolher,
  onAtualizar,
}: {
  estado: EstadoLista
  onEscolher: (item: PendenciaAlmoxarifado) => void
  onAtualizar: () => void
}) {
  const [filtro, setFiltro] = useState('') // '' = todas as OPs
  const itens = estado.tipo === 'ok' ? estado.itens : []
  const ops = opsComPendencia(itens)
  // Filtro de uma OP que já não tem pendência (depois do Atualizar): cai no "nesta OP", sem esconder o filtro.
  const visiveis = filtrarPorOp(itens, filtro === '' ? null : filtro)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Esperando confirmação{estado.tipo === 'ok' ? ` (${visiveis.length})` : ''}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filtrar por OP"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">Todas as OPs</option>
            {ops.map((o) => (
              <option key={o.chave} value={o.chave}>{o.chave}</option>
            ))}
            {filtro !== '' && !ops.some((o) => o.chave === filtro) && <option value={filtro}>{filtro}</option>}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={onAtualizar}>Atualizar</Button>
        </div>
      </div>

      {estado.tipo === 'carregando' && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {estado.tipo === 'erro' && <p className="text-sm text-amber-700 dark:text-amber-400">{estado.erro}</p>}
      {estado.tipo === 'ok' && visiveis.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filtro === '' ? 'Nada esperando confirmação no Almoxarifado agora.' : 'Nada esperando confirmação nesta OP.'}
        </p>
      )}
      {estado.tipo === 'ok' && visiveis.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {visiveis.map((i) => {
            const hora = horaCurta(i.em)
            const caixa = i.tipo === 'caixa'
            const partes = [pecas(i.pecas)]
            if (!caixa && i.amostra !== null && i.amostra > 0) partes.push(`bipar ${i.amostra}`)
            if (hora) partes.push(`${caixa ? 'fechada' : 'aprovado'} ${hora}`)
            return (
              <button
                key={`${i.tipo}-${chaveDaOp(i)}-${i.codigo}`}
                type="button"
                onClick={() => onEscolher(i)}
                className="flex min-w-[15rem] flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {caixa ? 'CAIXA' : 'LOTE'} · OP {i.op} · {i.pmo}
                </span>
                <span className="break-all font-mono text-base font-bold">{i.codigo}</span>
                <span className="text-xs text-muted-foreground">{partes.join(' · ')}</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
