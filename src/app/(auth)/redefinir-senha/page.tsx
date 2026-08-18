'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { AlertCircle, EyeIcon, EyeOffIcon } from 'lucide-react'
import { createBrowserSupabase } from '@/shared/lib/supabase/browser'
import { validarForcaSenha } from '@/modules/usuarios/domain/senha'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function RedefinirSenhaPage() {
  const router = useRouter()
  const supabase = useMemo(() => createBrowserSupabase(), [])
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'invalido'>('carregando')
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [mostrarConfirma, setMostrarConfirma] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // O Supabase (detectSessionInUrl) processa o token da URL (code/hash) ao carregar. Escutamos o
  // evento e checamos a sessão; se não vier em alguns segundos, o link é inválido/expirado.
  useEffect(() => {
    let vivo = true
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (vivo && session) setEstado('pronto')
    })
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      if (data.session) setEstado('pronto')
      else setTimeout(() => { if (vivo) setEstado((s) => (s === 'carregando' ? 'invalido' : s)) }, 2500)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [supabase])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (nova !== confirma) { setErro('As senhas não coincidem.'); return }
    const forca = validarForcaSenha(nova)
    if (!forca.ok) { setErro(forca.erro!); return }
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: nova })
    if (error) { setErro('Não foi possível redefinir a senha. Tente novamente.'); setSalvando(false); return }
    await supabase.auth.signOut() // encerra a sessão de recuperação → login com a nova senha
    router.push('/login?redefinida=1')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-card p-6">
      <div className="w-full max-w-sm">
        <Image
          src="/Logo_Docs.png"
          alt="Enterplak"
          width={150}
          height={51}
          priority
          style={{ height: 'auto' }}
          className="mb-8"
        />
        <h2 className="text-2xl font-bold tracking-tight">Criar nova senha</h2>

        {estado === 'carregando' && (
          <p className="mt-4 text-sm text-muted-foreground">Validando o link…</p>
        )}

        {estado === 'invalido' && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Link inválido ou expirado.{' '}
            <Link href="/esqueci-senha" className="font-medium underline">
              Solicite um novo link
            </Link>
            .
          </div>
        )}

        {estado === 'pronto' && (
          <>
            <p className="mt-1 mb-8 text-sm text-muted-foreground">
              Escolha uma senha só sua. Depois é só entrar com ela.
            </p>
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

              <Button type="submit" disabled={salvando} className="h-11 w-full bg-enterplak text-base hover:bg-enterplak-700">
                {salvando ? 'Salvando…' : 'Salvar nova senha'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
