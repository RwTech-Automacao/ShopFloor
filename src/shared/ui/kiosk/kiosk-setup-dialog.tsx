'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ABAS_KIOSK } from './abas'
import { useKiosk } from './kiosk-context'

export function KioskSetupDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { ativar } = useKiosk()
  const [sel, setSel] = useState<string[]>(['/shopfloor/operar/lancamento'])

  function toggle(href: string) {
    setSel((s) => (s.includes(href) ? s.filter((x) => x !== href) : [...s, href]))
  }
  function ativarKiosk() {
    if (sel.length === 0) return
    ativar(sel)
    onFechar()
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Ativar modo quiosque neste terminal</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Escolha as abas que o operador poderá acessar. Para sair, será preciso a senha de um supervisor.
          A configuração fica só neste equipamento.
        </p>
        <div className="flex flex-col gap-4">
          {ABAS_KIOSK.map((g) => (
            <div key={g.secao} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.secao}</p>
              {g.abas.map((a) => (
                <label key={a.href} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sel.includes(a.href)} onChange={() => toggle(a.href)} />
                  {a.rotulo}
                </label>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={ativarKiosk} disabled={sel.length === 0} className="bg-enterplak hover:bg-enterplak-700">
            Ativar quiosque
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
