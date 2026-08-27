import Image from 'next/image'
import Link from 'next/link'
import { EsqueciSenhaForm } from './esqueci-senha-form'

export default function EsqueciSenhaPage() {
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
        <h2 className="text-2xl font-bold tracking-tight">Esqueci minha senha</h2>
        <p className="mt-1 mb-8 text-sm text-muted-foreground">
          Informe seu e-mail e enviaremos um link para você criar uma nova senha.
        </p>
        <EsqueciSenhaForm />
        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-enterplak hover:underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </div>
  )
}
