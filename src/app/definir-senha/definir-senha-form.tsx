'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { definirNovaSenha } from '@/modules/usuarios/application/actions'

export function DefinirSenhaForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
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
        <Input
          id="nova"
          type="password"
          placeholder="Mínimo 8 caracteres"
          minLength={8}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirma">Confirmar senha</Label>
        <Input
          id="confirma"
          type="password"
          minLength={8}
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
          required
        />
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Salvando...' : 'Definir senha e entrar'}
      </Button>
    </form>
  )
}
