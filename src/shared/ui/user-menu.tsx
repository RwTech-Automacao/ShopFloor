'use client'

import { sair } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'

export function UserMenu({ nome, perfil }: { nome: string; perfil: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium">{nome}</p>
        <p className="text-xs text-muted-foreground">{perfil}</p>
      </div>
      <form action={sair}>
        <Button variant="ghost" size="sm" type="submit">Sair</Button>
      </form>
    </div>
  )
}
