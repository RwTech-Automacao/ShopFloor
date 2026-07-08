import { CheckIcon, MinusIcon } from 'lucide-react'
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

export default async function CamposPage() {
  const [campos, listas] = await Promise.all([listarCampos(), listarListas()])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Campos</h1>

      {GRUPOS.map((grupo) => {
        const camposDoGrupo = campos.filter((campo) => campo.grupo === grupo.chave)
        if (camposDoGrupo.length === 0) return null

        return (
          <div key={grupo.chave} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{grupo.rotulo}</h2>
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
                    <TableCell className="font-medium">{campo.rotulo}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {ROTULOS_TIPO[campo.tipo] ?? campo.tipo}
                    </TableCell>
                    <FlagCell marcado={campo.obrigatorio_importacao} />
                    <FlagCell marcado={campo.obrigatorio_finalizacao} />
                    <FlagCell marcado={campo.ativo} />
                    <TableCell className="text-right">
                      <CampoForm campo={campo} listas={listas} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })}
    </div>
  )
}
