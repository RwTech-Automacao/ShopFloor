import { Factory, Inbox, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const MODULOS: { icone: LucideIcon; nome: string; descricao: string }[] = [
  { icone: Inbox, nome: 'Recebimento', descricao: 'Importação, processos e conferência' },
]

const INFORMACOES: { rotulo: string; valor: string }[] = [
  { rotulo: 'Sistema', valor: 'ShopFloor — Enterplak MES' },
  { rotulo: 'Versão', valor: '1.0.0' },
  { rotulo: 'Empresa', valor: 'Enterplak Indústria Eletrônica Ltda.' },
]

export default function SobrePage() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {/* Identidade */}
      <Card>
        <CardContent className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Factory className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">ShopFloor</h2>
              <Badge variant="secondary">v1.0.0</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Sistema de gestão de chão de fábrica (MES) da Enterplak — controle, registro e
              rastreio das operações de produção em um só lugar.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Informações */}
      <Card>
        <CardHeader>
          <CardTitle>Informações</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {INFORMACOES.map((info) => (
              <div key={info.rotulo} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {info.rotulo}
                </dt>
                <dd className="text-foreground">{info.valor}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Módulos */}
      <Card>
        <CardHeader>
          <CardTitle>Módulos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MODULOS.map((modulo) => (
              <li
                key={modulo.nome}
                className="flex flex-col gap-2 rounded-lg border border-border p-4"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <modulo.icone className="size-[18px]" />
                </div>
                <div>
                  <p className="text-sm font-medium">{modulo.nome}</p>
                  <p className="text-xs text-muted-foreground">{modulo.descricao}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
