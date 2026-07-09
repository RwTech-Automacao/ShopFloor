import { Lock } from 'lucide-react'

/** Mensagem padrão exibida quando o usuário acessa uma tela/ação sem permissão. */
export function SemPermissao({
  descricao = 'Você não tem permissão para acessar esta funcionalidade.',
}: {
  descricao?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-white p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-enterplak-50 text-enterplak">
        <Lock className="size-6" />
      </div>
      <h2 className="text-lg font-semibold">Acesso restrito</h2>
      <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>
      <p className="text-xs text-muted-foreground">
        Se precisar deste acesso, fale com um administrador.
      </p>
    </div>
  )
}
