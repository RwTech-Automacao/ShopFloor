import { cn } from '@/lib/utils'
import { listarPerfisComGrants } from '@/modules/perfis/infra/perfil-repository'
import { MODULOS } from '@/modules/auth/domain/modulos'
import type { PerfilRow } from '@/modules/auth/domain/mapear-perfil'
import { PerfilForm, ExcluirPerfilButton } from './perfil-form'

/** Chips dos módulos que o perfil acessa; vinho = administra o módulo. Detalhe fica no Editar. */
function ModulosDoPerfil({ grants }: { grants: { modulo: string; permissao: string }[] }) {
  const chips = MODULOS.filter((m) => grants.some((g) => g.modulo === m.chave)).map((m) => ({
    rotulo: m.rotulo,
    administra: grants.some((g) => g.modulo === m.chave && g.permissao === 'administrar'),
  }))
  if (chips.length === 0) {
    return <span className="text-sm italic text-muted-foreground">Sem permissões</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span
          key={c.rotulo}
          className={cn(
            'whitespace-nowrap rounded-lg border px-2.5 py-0.5 text-sm',
            c.administra
              ? 'border-enterplak bg-enterplak font-medium text-white'
              : 'border-border text-foreground',
          )}
        >
          {c.rotulo}
        </span>
      ))}
    </div>
  )
}

export default async function PerfisPage() {
  const perfis = await listarPerfisComGrants()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Chip <span className="rounded bg-enterplak px-1.5 py-0.5 text-xs font-medium text-white">vinho</span> = administra o módulo · permissões detalhadas no Editar.
        </p>
        <PerfilForm />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {perfis.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum perfil encontrado.</p>
        )}
        {perfis.map((perfil: PerfilRow) => (
          <div
            key={perfil.id}
            className="flex flex-col gap-3 border-t border-border px-4 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="flex items-center gap-2 sm:w-56 sm:shrink-0">
              <span className="font-semibold">{perfil.nome}</span>
            </div>
            <div className="min-w-0 flex-1">
              <ModulosDoPerfil grants={perfil.perfil_permissao ?? []} />
            </div>
            <div className="flex shrink-0 justify-end gap-1">
              <PerfilForm perfil={perfil} grants={perfil.perfil_permissao} />
              <ExcluirPerfilButton id={perfil.id} nome={perfil.nome} sistema={perfil.sistema} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
