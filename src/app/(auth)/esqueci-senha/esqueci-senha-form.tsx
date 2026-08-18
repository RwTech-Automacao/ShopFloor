'use client'

import { useState, useTransition } from 'react'
import { AlertCircle, MailCheck } from 'lucide-react'
import { createBrowserSupabase } from '@/shared/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EsqueciSenhaForm() {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    startTransition(async () => {
      const supabase = createBrowserSupabase()
      // Client-side: guarda a chave (PKCE) no navegador; a volta em /redefinir-senha estabelece a
      // sessão de recuperação sozinha (o Supabase detecta o token na URL). redirectTo precisa estar
      // nas Redirect URLs do Supabase.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      // Erro genérico só se for evidente (rate-limit) — não revela se o e-mail existe.
      if (error && error.status === 429) {
        setErro('Muitas tentativas. Aguarde alguns minutos e tente de novo.')
        return
      }
      setEnviado(true)
    })
  }

  if (enviado) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <MailCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Verifique
          sua caixa de entrada (e o spam).
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="voce@enterplak.com.br"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11"
        />
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full bg-enterplak text-base hover:bg-enterplak-700">
        {pending ? 'Enviando…' : 'Enviar link'}
      </Button>
    </form>
  )
}
