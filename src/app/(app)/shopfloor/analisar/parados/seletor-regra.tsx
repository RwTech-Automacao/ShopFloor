'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Troca a regra do relatório: muda o `?regra=` da URL (o link continua compartilhável). */
export function SeletorRegra({ opcoes, atual }: { opcoes: { id: string; rotulo: string }[]; atual: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [carregando, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-1.5 sm:max-w-md">
      <Label>Regra</Label>
      <Select
        value={atual}
        onValueChange={(v) => {
          if (!v || v === atual) return
          startTransition(() => router.push(`${pathname}?regra=${encodeURIComponent(v)}`))
        }}
      >
        <SelectTrigger className="w-full" disabled={carregando}>
          <SelectValue>
            {(valor: string | null) => opcoes.find((o) => o.id === valor)?.rotulo ?? 'Selecione a regra'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.rotulo}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
