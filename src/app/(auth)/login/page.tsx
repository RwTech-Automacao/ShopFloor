import Image from 'next/image'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden items-center justify-center bg-enterplak p-12 lg:flex">
        <div className="text-center">
          <Image src="/Logo_Docs.png" alt="Enterplak" width={320} height={110} priority
            style={{ height: 'auto' }} className="mx-auto brightness-0 invert" />
          <p className="mt-6 text-lg text-white/90">Sistema de Gestão Shop Floor</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Acesse sua conta</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Informe suas credenciais para entrar no sistema
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-xs text-muted-foreground">Versão 1.0.0</p>
        </div>
      </div>
    </div>
  )
}
