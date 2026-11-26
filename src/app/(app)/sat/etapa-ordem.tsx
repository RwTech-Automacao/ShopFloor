import { Badge } from '@/components/ui/badge'
import { ROTULO_ETAPA, rotuloTipo, type Etapa, type TipoOrdem } from '@/modules/sat/domain/ordem'
import { cn } from '@/lib/utils'

const COR_ETAPA: Record<Etapa, string> = {
  recebido: 'bg-slate-100 text-slate-800',
  nota_pendente: 'bg-red-100 text-red-800',
  disponivel: 'bg-amber-100 text-amber-900',
  em_manutencao: 'bg-sky-100 text-sky-900',
  qualidade: 'bg-emerald-100 text-emerald-800',
}

/** A etapa da OS do SAT, com a cor da etapa. */
export function EtapaOrdem({ etapa }: { etapa: Etapa }) {
  return <Badge className={cn(COR_ETAPA[etapa])}>{ROTULO_ETAPA[etapa]}</Badge>
}

/** Em garantia / fora da garantia / garantia a definir (ainda sem a coluna da planilha). */
export function TipoOrdemSelo({ tipo }: { tipo: TipoOrdem | null }) {
  const cor = tipo === 'em_garantia' ? 'bg-emerald-50 text-emerald-800'
    : tipo === null ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-800'
  return <Badge className={cn(cor)}>{rotuloTipo(tipo)}</Badge>
}
