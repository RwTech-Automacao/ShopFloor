'use client'

import { useState } from 'react'
import { Eye, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** Ícone na linha da OP que abre o fluxo de postos em texto + setas. */
export function FluxoBotao({ pmo, op, postos }: { pmo: string; op: string; postos: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Ver fluxo de ${pmo}/${op}`}>
            <Eye className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fluxo de postos · {pmo}/{op}</DialogTitle>
        </DialogHeader>
        {postos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum posto no fluxo desta OP.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-y-2">
            {postos.map((p, i) => (
              <span key={p} className="flex items-center">
                <span className="rounded-lg border border-border bg-accent px-2.5 py-1 text-sm">
                  <span className="mr-1 text-xs font-medium text-enterplak">{i + 1}</span>
                  {p}
                </span>
                {i < postos.length - 1 && <ArrowRight className="mx-1 size-4 shrink-0 text-muted-foreground" />}
              </span>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
