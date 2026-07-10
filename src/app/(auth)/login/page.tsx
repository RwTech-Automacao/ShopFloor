import Image from 'next/image'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Painel de marca (vinho) — visível a partir de lg */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-[#7a1b2c] via-[#8d2033] to-[#5e1522]" />
        {/* formas suaves */}
        <div className="absolute -top-24 -right-24 size-[30rem] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-32 -left-20 size-[26rem] rounded-full bg-white/[0.05]" />
        {/* corte diagonal — assinatura Enterplak */}
        <div className="absolute top-0 -right-1/4 h-full w-1/2 -skew-x-12 bg-white/[0.04]" />

        <div className="relative flex h-full flex-col justify-between p-12">
          <Image
            src="/Logo_Docs.png"
            alt="Enterplak"
            width={200}
            height={68}
            priority
            style={{ height: 'auto' }}
            className="brightness-0 invert"
          />
          <div className="max-w-md">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white">
              Todo o chão de fábrica em um só sistema.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-white/80">
              Controle, registre e rastreie cada operação produtiva — com visibilidade e
              padronização.
            </p>
          </div>
          <p className="text-sm text-white/50">© 2026 Enterplak · ShopFloor</p>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-card p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <Image
            src="/Logo_Docs.png"
            alt="Enterplak"
            width={150}
            height={51}
            priority
            style={{ height: 'auto' }}
            className="mb-10 lg:hidden"
          />
          <h2 className="text-2xl font-bold tracking-tight">Entrar</h2>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">
            Acesse sua conta para continuar.
          </p>
          <LoginForm />
          <p className="mt-10 text-center text-xs text-muted-foreground">Versão 1.0.0</p>
        </div>
      </div>
    </div>
  )
}
