import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Lançamento', href: '/shopfloor/operar/lancamento' },
  { rotulo: 'Manutenção', href: '/shopfloor/operar/manutencao' },
]

export default function OperarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
