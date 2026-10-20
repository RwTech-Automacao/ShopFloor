'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { listarPendenciasAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; erro: string }
  | { tipo: 'ok'; itens: PendenciaAlmoxarifado[] }

const FALHA = 'Não foi possível carregar o que está esperando confirmação no Almoxarifado.'

function pecas(n: number) {
  return `${n} peça${n === 1 ? '' : 's'}`
}

/**
 * A lista do que espera confirmação no Almoxarifado, de todas as OPs, mostrada ANTES de qualquer bipe.
 * Escolher uma linha carrega a OP no cabeçalho; dali a pessoa bipa a caixa (ou abre o lote). A falha de
 * leitura é um estado próprio, nunca uma lista vazia.
 */
export function PendenciasAlmoxarifado({ onEscolher }: { onEscolher: (pmo: string, op: string) => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' })

  const carregar = useCallback(async () => {
    try {
      const r = await listarPendenciasAlmoxarifado()
      setEstado(r.ok ? { tipo: 'ok', itens: r.pendencias } : { tipo: 'erro', erro: r.erro })
    } catch {
      setEstado({ tipo: 'erro', erro: FALHA })
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const grupos = new Map<string, PendenciaAlmoxarifado[]>()
  if (estado.tipo === 'ok') {
    for (const p of estado.itens) {
      const k = `${p.pmo}/${p.op}`
      grupos.set(k, [...(grupos.get(k) ?? []), p])
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          Esperando confirmação
          {estado.tipo === 'ok' && estado.itens.length > 0 ? ` (${estado.itens.length})` : ''}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => { setEstado({ tipo: 'carregando' }); void carregar() }}>
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {estado.tipo === 'carregando' && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {estado.tipo === 'erro' && <p className="text-sm text-amber-700 dark:text-amber-400">{estado.erro}</p>}
        {estado.tipo === 'ok' && estado.itens.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada esperando confirmação no Almoxarifado agora.</p>
        )}
        {[...grupos.entries()].map(([chave, itens]) => (
          <div key={chave} className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-muted-foreground">OP {itens[0]?.op} · {itens[0]?.pmo}</p>
            <ul aria-label={`Pendências da OP ${chave}`} className="flex flex-col gap-0.5 text-sm">
              {itens.map((p) => (
                <li key={`${p.tipo}:${p.codigo}`}>
                  <button
                    type="button"
                    onClick={() => onEscolher(p.pmo, p.op)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-muted"
                  >
                    <span className="truncate font-mono">{p.codigo}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {pecas(p.pecas)}
                      {p.tipo === 'lote' && p.amostra && p.amostra > 0 ? ` · amostra ${p.amostra}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
