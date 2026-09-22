import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { alertasDisponiveis } from '@/modules/alertas/application/liberacao'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import { listarMinhasContas } from '@/modules/alertas/infra/contas-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { CartaoAlertas } from './cartao-alertas'

/** Meu perfil: qualquer usuário logado. Por enquanto só o cartão de Alertas mora aqui — por isso o
 *  lançamento escondido dos Alertas (ALERTAS_LIBERADO_PARA) bloqueia a tela inteira. */
export default async function PerfilPage() {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')
  if (!alertasDisponiveis(sessao)) {
    return <SemPermissao />
  }

  const contas = await listarMinhasContas()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{sessao.nome || sessao.email}</h2>
        <p className="text-sm text-muted-foreground">
          {sessao.email} · {sessao.perfil.nome}
        </p>
      </div>

      <CartaoAlertas
        nome={sessao.nome || sessao.email}
        contas={contas}
        configurados={canaisConfigurados()}
        telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? ''}
        discordConvite={process.env.DISCORD_CONVITE_URL ?? ''}
      />
    </div>
  )
}
