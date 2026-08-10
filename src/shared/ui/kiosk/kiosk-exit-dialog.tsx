'use client'

import { useState, useTransition } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { validarSupervisorKiosk } from '@/modules/auth/application/kiosk-actions'
import { useKiosk } from './kiosk-context'

export function KioskExitDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { sair } = useKiosk()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [erro, setErro] = useState('')
  const [validando, start] = useTransition()

  function confirmar() {
    if (validando) return
    setErro('')
    start(async () => {
      const r = await validarSupervisorKiosk(email, senha)
      if (r.ok) {
        setEmail(''); setSenha(''); onFechar(); sair()
      } else {
        setErro(r.erro)
      }
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { setErro(''); setSenha(''); onFechar() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Sair do modo quiosque</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Um supervisor precisa autorizar a saída.</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="k-email">E-mail do supervisor</Label>
            <Input id="k-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="k-senha">Senha</Label>
            <div className="relative">
              <Input
                id="k-senha"
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar() } }}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {mostrarSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={validando} className="bg-enterplak hover:bg-enterplak-700">
            {validando ? 'Verificando…' : 'Sair'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
