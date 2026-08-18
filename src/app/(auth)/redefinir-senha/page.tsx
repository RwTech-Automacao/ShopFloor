import Image from 'next/image'
import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { RedefinirSenhaForm } from './redefinir-senha-form'

export default async function RedefinirSenhaPage() {
  const sessao = await getSessao()

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
        {sessao ? (
          <>
            <p className="mt-1 mb-8 text-sm text-muted-foreground">
              Escolha uma senha só sua. Depois é só entrar com ela.
            </p>
            <RedefinirSenhaForm />
          </>
        ) : (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Link inválido ou expirado.{' '}
            <Link href="/esqueci-senha" className="font-medium underline">
              Solicite um novo link
            </Link>
            .
          </div>
        )}
      </div>
    </div>
  )
}
