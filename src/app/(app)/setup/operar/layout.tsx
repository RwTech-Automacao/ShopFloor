import { AbasSetup } from '../abas-setup'

const ABAS = [
  { rotulo: 'Montar Setup', href: '/setup/operar/montar' },
  { rotulo: 'Abastecimento', href: '/setup/operar/abastecimento' },
]

export default function OperarSetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasSetup tabs={ABAS} />
      {children}
    </div>
  )
}
