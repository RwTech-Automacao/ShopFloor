'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { definirNovaSenha } from '@/modules/usuarios/application/actions'

export function DefinirSenhaForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [mostrarConfirma, setMostrarConfirma] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (nova !== confirma) {
      setErro('As senhas não coincidem.')
      return
    }
    startTransition(async () => {
      const resultado = await definirNovaSenha(nova)
      if ('erro' in resultado) {
        setErro(resultado.erro)
      } else {
        router.push('/home')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nova">Nova senha</Label>
        <div className="relative">
          <Input
            id="nova"
            type={mostrarNova ? 'text' : 'password'}
            placeholder="Mínimo 8 caracteres"
            minLength={8}
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setMostrarNova((v) => !v)}
            aria-label={mostrarNova ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={mostrarNova}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-enterplak"
          >
            {mostrarNova ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirma">Confirmar senha</Label>
        <div className="relative">
          <Input
            id="confirma"
            type={mostrarConfirma ? 'text' : 'password'}
            minLength={8}
            value={confirma}
            onChange={(e) => setConfirma(e.target.value)}
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setMostrarConfirma((v) => !v)}
            aria-label={mostrarConfirma ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={mostrarConfirma}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-enterplak"
          >
            {mostrarConfirma ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Salvando...' : 'Definir senha e entrar'}
      </Button>
    </form>
  )
}
