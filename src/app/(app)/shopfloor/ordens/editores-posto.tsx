'use client'

import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mascararTempoFiltro } from '@/modules/shopfloor/domain/tempo-burnin'

/**
 * Os editores por posto da OP, divididos entre o cadastro antigo (OrdemForm), a Nova OP e a edição de OP com trechos:
 * a receita de um posto de Integração (as PMOs de placa que ele integra e, na OP com trechos, as PRTs de série própria
 * dela, 0195) e o tempo mínimo de um posto de Burn-in.
 */

/** Tempo mínimo de Burn-in de um posto (hhh:mm, com a máscara do campo). */
export function TempoBurninCampo({ valor, setValor, rotulo }: { valor: string; setValor: (v: string) => void; rotulo?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">mín.</span>
      <Input
        value={valor}
        onChange={(e) => setValor(mascararTempoFiltro(e.target.value))}
        inputMode="numeric"
        placeholder="hhh:mm"
        className="h-7 w-20 text-sm"
        autoComplete="off"
        aria-label={rotulo}
      />
    </span>
  )
}

export function ReceitaIntegracao({
  posto,
  receita,
  setReceita,
  pmosDisponiveis,
  prtsDisponiveis = [],
  temPrts = prtsDisponiveis.length > 0,
}: {
  posto: string
  receita: string[]
  setReceita: (r: string[]) => void
  pmosDisponiveis: string[]
  /** PRTs desta OP (série própria) que ainda não estão na receita (0195). */
  prtsDisponiveis?: string[]
  /** A OP tem PRT de série própria: o grupo "PRTs desta OP" (com a ajuda) fica visível mesmo com todas já na receita. */
  temPrts?: boolean
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        Receita · {posto}{' '}
        <span className="font-normal text-muted-foreground">· PMOs de placa que compõem este produto</span>
      </p>
      {receita.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {receita.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-xs">
              {c}
              <button type="button" aria-label={`Remover ${c}`} onClick={() => setReceita(receita.filter((x) => x !== c))} className="text-muted-foreground hover:text-red-600">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">Sem receita: a Integração aceita placas de qualquer PMO.</p>
      )}
      {pmosDisponiveis.length > 0 && (
        <Select value="" onValueChange={(p) => p && setReceita([...receita, p])}>
          <SelectTrigger className="h-9" aria-label={`Adicionar PMO à receita de ${posto}`}>
            <SelectValue placeholder="+ Adicionar PMO à receita" />
          </SelectTrigger>
          <SelectContent>
            {pmosDisponiveis.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {temPrts && (
        <div role="group" aria-label={`PRTs desta OP · ${posto}`} className="mt-2 flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            PRTs desta OP <span className="font-normal">· a placa entra quando terminou o trecho da PRT</span>
          </p>
          {prtsDisponiveis.length === 0 ? (
            <p className="text-xs text-muted-foreground">Todas as PRTs desta OP já estão na receita.</p>
          ) : (
            <Select value="" onValueChange={(p) => p && setReceita([...receita, p])}>
              <SelectTrigger className="h-9" aria-label={`Adicionar PRT desta OP à receita de ${posto}`}>
                <SelectValue placeholder="+ Adicionar PRT desta OP" />
              </SelectTrigger>
              <SelectContent>
                {prtsDisponiveis.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}

const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()

/** As receitas dos postos de Integração de uma lista de postos (um bloco por posto, na ordem da rota). */
export function ReceitasDosPostos({ postos, ehIntegracao, receita, setReceita, pmosExistentes, pmoDaOp, prtsDaOp = [] }: {
  postos: string[]
  ehIntegracao: (posto: string) => boolean
  receita: Record<string, string[]>
  setReceita: (f: (r: Record<string, string[]>) => Record<string, string[]>) => void
  pmosExistentes: string[]
  /** A PMO da própria OP não entra na receita dela. */
  pmoDaOp: string
  /** As PRTs desta OP com série própria (0195): o grupo "PRTs desta OP". Elas não se oferecem como PMO. */
  prtsDaOp?: string[]
}) {
  const integracao = postos.filter(ehIntegracao)
  if (integracao.length === 0) return null
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {integracao.map((posto) => {
        const atual = receita[posto] ?? []
        return (
          <ReceitaIntegracao
            key={posto}
            posto={posto}
            receita={atual}
            setReceita={(lista) => setReceita((prev) => ({ ...prev, [posto]: lista }))}
            pmosDisponiveis={pmosExistentes.filter((p) => p !== pmoDaOp && !atual.includes(p) && !prtsDaOp.some((x) => mesmo(x, p)))}
            prtsDisponiveis={prtsDaOp.filter((p) => !atual.some((x) => mesmo(x, p)))}
            temPrts={prtsDaOp.length > 0}
          />
        )
      })}
    </div>
  )
}
