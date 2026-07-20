import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { DefinirSenhaForm } from './definir-senha-form'

export default async function DefinirSenhaPage() {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Defina sua senha</h1>
        <p className="text-sm text-muted-foreground">
          Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.
        </p>
      </div>
      <DefinirSenhaForm />
    </main>
  )
}
