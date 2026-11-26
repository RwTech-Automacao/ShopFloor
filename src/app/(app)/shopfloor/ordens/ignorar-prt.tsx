'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ESCOLHA_IGNORAR, rotuloTrecho, type ModoIgnorar, type PrtIgnorada, type TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'

/**
 * PRT ignorada (spec 2026-11-26): a PRT da cadeia do Compels que não vira trecho. Na Nova OP, "Ignorar esta PRT" no
 * cabeçalho de cada PRT abre a escolha (tirar os postos × mantê-los na rota) e a lista das ignoradas tem o Desfazer.
 * Na edição, as PRTs da cadeia que ficaram de fora podem ser incluídas de novo.
 */

/** "Ignorar esta PRT" no cabeçalho do trecho PRT (na PMO não aparece) e a escolha, em dois botões. */
export function IgnorarPrt({ t, aoIgnorar }: { t: TrechoCadastro; aoIgnorar: (seq: number, modo: ModoIgnorar) => void }) {
  const [aberto, setAberto] = useState(false)
  if (t.tipo !== 'prt') return null
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="ghost" size="sm" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        Ignorar esta PRT
      </Button>
      {aberto && (
        <div role="group" aria-label={`Ignorar ${rotuloTrecho(t)}`} className="flex flex-wrap gap-1">
          {(['tirar', 'manter'] as ModoIgnorar[]).map((modo) => (
            <Button key={modo} type="button" variant="outline" size="sm" onClick={() => aoIgnorar(t.seq, modo)}>
              {ESCOLHA_IGNORAR[modo]}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** As PRTs ignoradas antes de salvar: riscadas, com o selo "Ignorada", a escolha feita e o Desfazer. */
export function PrtsIgnoradas({ ignoradas, aoDesfazer }: { ignoradas: PrtIgnorada[]; aoDesfazer: (ig: PrtIgnorada) => void }) {
  if (ignoradas.length === 0) return null
  return (
    <ul aria-label="PRTs ignoradas" className="flex flex-col gap-1">
      {ignoradas.map((ig) => (
        <li key={ig.trecho.seq} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm">
          <span className="font-medium text-muted-foreground line-through">{rotuloTrecho(ig.trecho)}</span>
          <Badge variant="outline">Ignorada</Badge>
          <span className="text-xs text-muted-foreground">{ESCOLHA_IGNORAR[ig.modo]}</span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-label={`Desfazer: ${rotuloTrecho(ig.trecho)}`}
            onClick={() => aoDesfazer(ig)}>
            Desfazer
          </Button>
        </li>
      ))}
    </ul>
  )
}
