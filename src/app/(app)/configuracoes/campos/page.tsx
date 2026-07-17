import { CheckIcon, MinusIcon, LockIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  listarCampos,
  type GrupoCampo,
} from '@/modules/configuracao-campos/infra/campo-repository'
import { listarListas } from '@/modules/listas/infra/lista-repository'
import { CampoForm } from './campo-form'

const GRUPOS: { chave: GrupoCampo; rotulo: string }[] = [
  { chave: 'comercial', rotulo: 'Comercial' },
  { chave: 'material', rotulo: 'Material' },
  { chave: 'recebimento', rotulo: 'Recebimento' },
  { chave: 'qualidade', rotulo: 'Qualidade' },
]

const ROTULOS_TIPO: Record<string, string> = {
  texto: 'Texto',
  lista: 'Lista',
  numero: 'Número',
  data: 'Data',
}

function FlagCell({ marcado }: { marcado: boolean }) {
  return (
    <TableCell className="text-center">
      {marcado ? (
        <CheckIcon className="mx-auto size-4 text-enterplak" />
      ) : (
        <MinusIcon className="mx-auto size-4 text-muted-foreground" />
      )}
    </TableCell>
  )
}

function Flag({ marcado }: { marcado: boolean }) {
  return marcado ? (
    <CheckIcon className="size-4 text-enterplak" />
  ) : (
    <MinusIcon className="size-4 text-muted-foreground" />
  )
}

export default async function CamposPage() {
  const [campos, listas] = await Promise.all([listarCampos(), listarListas()])

  return (
    <div className="flex flex-col gap-6">
      {GRUPOS.map((grupo) => {
        const camposDoGrupo = campos.filter((campo) => campo.grupo === grupo.chave)
        if (camposDoGrupo.length === 0) return null

        return (
          <div key={grupo.chave} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{grupo.rotulo}</h2>

            {/* Desktop: tabela */}
            <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rótulo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-center">Obrig. Importação</TableHead>
                    <TableHead className="text-center">Obrig. Finalização</TableHead>
                    <TableHead className="text-center">Ativo</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {camposDoGrupo.map((campo) => (
                    <TableRow key={campo.id}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {campo.rotulo}
                          {campo.calculado && (
                            <Badge variant="secondary" className="font-normal">Calculado</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ROTULOS_TIPO[campo.tipo] ?? campo.tipo}
                      </TableCell>
                      <FlagCell marcado={campo.obrigatorio_importacao} />
                      <FlagCell marcado={campo.obrigatorio_finalizacao} />
                      <FlagCell marcado={campo.ativo} />
                      <TableCell className="text-right">
                        {campo.calculado ? (
                          <LockIcon
                            className="ml-auto size-4 text-muted-foreground"
                            aria-label="Campo automático (não editável)"
                          />
                        ) : (
                          <CampoForm campo={campo} listas={listas} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {camposDoGrupo.map((campo) => (
                <div key={campo.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      {campo.rotulo}
                      {campo.calculado && (
                        <Badge variant="secondary" className="font-normal">Calculado</Badge>
                      )}
                    </span>
                    {campo.calculado ? (
                      <LockIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label="Campo automático (não editável)"
                      />
                    ) : (
                      <CampoForm campo={campo} listas={listas} />
                    )}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-muted-foreground">Tipo</dt>
                      <dd className="min-w-0 flex-1">{ROTULOS_TIPO[campo.tipo] ?? campo.tipo}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-muted-foreground">Obrig. Importação</dt>
                      <dd className="min-w-0 flex-1">
                        <Flag marcado={campo.obrigatorio_importacao} />
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-muted-foreground">Obrig. Finalização</dt>
                      <dd className="min-w-0 flex-1">
                        <Flag marcado={campo.obrigatorio_finalizacao} />
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-muted-foreground">Ativo</dt>
                      <dd className="min-w-0 flex-1">
                        <Flag marcado={campo.ativo} />
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
