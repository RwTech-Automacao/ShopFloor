'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, EyeIcon, EyeOffIcon } from 'lucide-react'
import { redefinirSenha } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RedefinirSenhaForm() {
  const router = useRouter()
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [mostrarConfirma, setMostrarConfirma] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (nova !== confirma) {
      setErro('As senhas não coincidem.')
      return
    }
    startTransition(async () => {
      const r = await redefinirSenha(nova)
      if ('erro' in r) setErro(r.erro)
      else {
        // Sessão de recuperação encerrada no servidor → volta pro login com a nova senha.
        router.push('/login?redefinida=1')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nova">Nova senha</Label>
        <div className="relative">
          <Input
            id="nova"
            type={mostrarNova ? 'text' : 'password'}
            placeholder="Mínimo 8 caracteres"
            minLength={8}
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className="h-11 pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setMostrarNova((v) => !v)}
            aria-label={mostrarNova ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-enterplak"
          >
            {mostrarNova ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirma">Confirmar senha</Label>
        <div className="relative">
          <Input
            id="confirma"
            type={mostrarConfirma ? 'text' : 'password'}
            minLength={8}
            value={confirma}
            onChange={(e) => setConfirma(e.target.value)}
            className="h-11 pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setMostrarConfirma((v) => !v)}
            aria-label={mostrarConfirma ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-enterplak"
          >
            {mostrarConfirma ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full bg-enterplak text-base hover:bg-enterplak-700">
        {pending ? 'Salvando…' : 'Salvar nova senha'}
      </Button>
    </form>
  )
}
