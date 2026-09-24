import { Cpu, Factory, Inbox, Workflow, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HISTORICO_VERSOES, VERSAO } from '@/shared/lib/versao'

type Modulo = { icone: LucideIcon; nome: string; descricao: string }

const MODULOS: Modulo[] = [
  { icone: Inbox, nome: 'Recebimento', descricao: 'Importação, processos e conferência' },
  { icone: Workflow, nome: 'Fluxo de Processos', descricao: 'Operação, análise e rastreio da produção' },
  { icone: Cpu, nome: 'Setup', descricao: 'Estrutura de componentes por PMO, montagem de setup das máquinas SMT/PTH e conferência da troca de rolos.' },
]

const INFORMACOES: { rotulo: string; valor: string }[] = [
  { rotulo: 'Sistema', valor: 'ShopFloor — Enterplak MES' },
  { rotulo: 'Versão', valor: VERSAO },
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
              <Badge variant="secondary">v{VERSAO}</Badge>
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

      {/* Histórico de versões */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de versões</CardTitle>
        </CardHeader>
        <CardContent>
          {/* A lista cresce a cada deploy e esticaria a página sem fim. Teto em rem (não em vh), no
              mesmo padrão dos quadros do Setup e do Lançamento: a caixa ocupa o mesmo espaço no
              celular e no desktop, e a entrada mais nova cabe inteira com a seguinte aparecendo em
              parte — é o que sinaliza que há mais histórico abaixo. A lista continua completa. */}
          <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto text-sm">
            {HISTORICO_VERSOES.map((v) => (
              <li key={v.versao} className="flex gap-3">
                <span className="w-14 shrink-0 font-medium tabular-nums">{v.versao}</span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground tabular-nums">{v.data}</p>
                  <p>{v.resumo}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
