'use client'

import { LockIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { cn } from '@/lib/utils'

// Sentinela para "nenhum valor selecionado": o Select (base-ui) não aceita
// string vazia como value de item, então usamos um marcador único que nunca
// colide com um valor real de lista.
const SEM_VALOR = '__sem_valor__'

export interface CampoControleProps {
  campo: CampoFormulario
  valor: string
  /** Valor recalculado ao vivo (só usado quando `campo.calculado`); `undefined` se a fórmula não gerou saída. */
  valorCalculado: string | number | null | undefined
  itens: string[]
  somenteLeitura: boolean
  /** Exibe o marcador `*` ao lado do rótulo. O chamador decide o critério
   *  (detalhe: obrigatório para finalizar; criação: obrigatório na criação). */
  obrigatorio: boolean
  onChange: (valor: string) => void
}

export function CampoControle({
  campo,
  valor,
  valorCalculado,
  itens,
  somenteLeitura,
  obrigatorio,
  onChange,
}: CampoControleProps) {
  const inputId = `campo-${campo.campo}`

  if (campo.calculado) {
    return <CampoCalculadoControle campo={campo} valor={valorCalculado} />
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>
        {campo.rotulo}
        {obrigatorio && <span className="text-red-600"> *</span>}
      </Label>

      {campo.tipo === 'lista' ? (
        <Select
          value={valor === '' ? SEM_VALOR : valor}
          onValueChange={(novoValor) => onChange(novoValor === SEM_VALOR ? '' : (novoValor ?? ''))}
          disabled={somenteLeitura}
        >
          <SelectTrigger id={inputId} className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VALOR}>—</SelectItem>
            {/* Preserva o valor atual mesmo que não esteja mais entre os itens
                ativos da lista (ex.: item desativado depois de atribuído). */}
            {valor !== '' && !itens.includes(valor) && <SelectItem value={valor}>{valor}</SelectItem>}
            {itens.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={inputId}
          type={campo.tipo === 'numero' ? 'number' : campo.tipo === 'data' ? 'date' : 'text'}
          step={campo.tipo === 'numero' ? 'any' : undefined}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          disabled={somenteLeitura}
        />
      )}
    </div>
  )
}

interface CampoCalculadoControleProps {
  campo: CampoFormulario
  valor: string | number | null | undefined
}

/**
 * Renderização somente-leitura de um campo `calculado=true` (atraso,
 * divergencia, critico, amostral): nunca vira input/select editável. Fundo
 * mutado + cadeado sinalizam que o valor é automático.
 */
function CampoCalculadoControle({ campo, valor }: CampoCalculadoControleProps) {
  const inputId = `campo-${campo.campo}`
  const vazio = valor === null || valor === undefined || String(valor).trim() === ''
  const textoExibido = vazio ? '—' : String(valor)

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-center gap-1 text-muted-foreground">
        {campo.rotulo}
      </Label>
      <div
        id={inputId}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-input/30 px-2.5 py-1 text-base text-foreground md:text-sm',
          vazio && 'italic text-muted-foreground',
        )}
      >
        <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{textoExibido}</span>
      </div>
    </div>
  )
}
