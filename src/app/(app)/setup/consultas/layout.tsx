import { AbasSetup } from '../abas-setup'

const ABAS = [
  { rotulo: 'Setups', href: '/setup/consultas/setups' },
  { rotulo: 'Trocas de rolo', href: '/setup/consultas/trocas' },
]

export default function ConsultasSetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasSetup tabs={ABAS} />
      {children}
    </div>
  )
}
