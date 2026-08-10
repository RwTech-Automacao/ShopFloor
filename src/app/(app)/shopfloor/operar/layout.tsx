import { AbasFluxo } from '../abas-fluxo'
import { ABAS_OPERAR } from '@/shared/ui/kiosk/abas'

export default function OperarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS_OPERAR} />
      {children}
    </div>
  )
}
