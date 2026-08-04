import { AbasFluxo } from '../abas-fluxo'

const ABAS = [
  { rotulo: 'Dashboard', href: '/shopfloor/analisar/dashboard' },
  { rotulo: 'Pesquisa', href: '/shopfloor/analisar/pesquisa' },
  { rotulo: 'Burn-in', href: '/shopfloor/analisar/burn-in' },
  { rotulo: 'Caixas', href: '/shopfloor/analisar/caixas' },
  { rotulo: 'Fluxo', href: '/shopfloor/analisar/fluxo' },
]

export default function AnalisarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS} />
      {children}
    </div>
  )
}
