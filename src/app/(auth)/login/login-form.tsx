'use client'

import { useActionState } from 'react'
import { entrar } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(entrar, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Usuário</Label>
        <Input id="email" name="email" type="email" placeholder="Digite seu usuário" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" name="senha" type="password" placeholder="Digite sua senha" required />
      </div>
      {state?.erro && <p className="text-sm text-red-600">{state.erro}</p>}
      <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  )
}
