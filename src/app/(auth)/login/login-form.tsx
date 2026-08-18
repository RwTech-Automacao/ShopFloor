'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { entrar } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ redefinida = false }: { redefinida?: boolean }) {
  const [state, formAction, pending] = useActionState(entrar, undefined)
  const [mostrarSenha, setMostrarSenha] = useState(false)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {redefinida && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>Senha redefinida! Entre com a nova senha.</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@enterplak.com.br"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="senha">Senha</Label>
        <div className="relative">
          <Input
            id="senha"
            name="senha"
            type={mostrarSenha ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Sua senha"
            required
            className="h-11 pr-10"
          />
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
          >
            {mostrarSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <div className="-mt-2 text-right">
        <Link href="/esqueci-senha" className="text-sm font-medium text-enterplak hover:underline">
          Esqueci minha senha?
        </Link>
      </div>

      {state?.erro && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{state.erro}</span>
        </div>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full text-base">
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}
