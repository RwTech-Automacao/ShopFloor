'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

function norm(s: string) {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function AprovarModal({
  aberto,
  sn,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean
  sn: string
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Começa SEMPRE vazio ao abrir OU quando o SN esperado muda (evita valor em cache do bipe anterior).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValor('')
    setErro('')
    if (!aberto) return
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [aberto, sn])

  function confirmar() {
    if (norm(valor) === norm(sn)) {
      onConfirmar()
      return
    }
    setErro('SN diferente — bipe a mesma peça')
    setValor('') // bipe errado → limpa o campo pra bipar de novo
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onCancelar()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirmar aprovação</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            SN esperado: <span className="font-mono">{sn}</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aprovar-sn">Bipe o SN de novo para confirmar</Label>
            <Input
              id="aprovar-sn"
              ref={inputRef}
              autoFocus
              value={valor}
              onChange={(e) => {
                setValor(e.target.value)
                if (erro) setErro('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmar()
                }
              }}
              aria-invalid={erro !== '' || undefined}
            />
            {erro && <p className="text-sm text-red-600">{erro}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={confirmar} className="bg-enterplak hover:bg-enterplak-700">
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
