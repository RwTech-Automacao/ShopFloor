import { AbasFluxo } from '../abas-fluxo'
import { ABAS_ANALISE } from '@/shared/ui/kiosk/abas'

export default function AnalisarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <AbasFluxo tabs={ABAS_ANALISE} />
      {children}
    </div>
  )
}
