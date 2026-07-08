import { getSessao } from '@/modules/auth/application/get-sessao'

export default async function HomePage() {
  const sessao = await getSessao()
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Bem-vindo, {sessao?.nome || sessao?.email} 👋
      </h1>
      <p className="mt-2 text-muted-foreground">Selecione uma opção para começar</p>
    </div>
  )
}
